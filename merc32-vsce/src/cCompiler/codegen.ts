import { Merc32Object, ObjectSymbol, Relocation } from '../linker/objectFormat';
import { IRFunction, IRInstruction, Merc32Module } from './ir';

export function generateAssembly(module: Merc32Module): string {
  return emitModule(module).assembly;
}

export function generateObject(module: Merc32Module): Merc32Object {
  const emitted = emitModule(module);
  return {
    version: 1,
    target: 'merc32',
    abi: module.abi,
    sections: [{ name: 'text', alignment: 4, size: emitted.size, content: emitted.assembly }],
    symbols: emitted.symbols,
    relocations: emitted.relocations,
  };
}

interface EmittedModule {
  readonly assembly: string;
  readonly size: number;
  readonly symbols: readonly ObjectSymbol[];
  readonly relocations: readonly Relocation[];
}

function emitModule(module: Merc32Module): EmittedModule {
  const lines: string[] = [];
  const symbols: ObjectSymbol[] = [];
  const relocations: Relocation[] = [];
  const defined = new Set(module.functions.map(func => func.name));
  const occupiedLabels = new Set(defined);
  for (const func of module.functions) {
    for (const instruction of func.blocks.flatMap(block => block.instructions)) {
      if (instruction.op === 'label') occupiedLabels.add(String(instruction.args[0]));
    }
  }
  const referenced = new Set<string>();
  let offset = 0;
  const emitInstruction = (instruction: string) => { lines.push(`  ${instruction}`); offset += 4; };
  const emitLocalLabel = (label: string) => {
    symbols.push({ name: label, binding: 'local', section: 'text', offset, defined: true });
    lines.push(`${label}:`);
  };

  for (const func of module.functions) {
    symbols.push({ name: func.name, binding: 'global', section: 'text', offset, defined: true });
    lines.push(`${func.name}:`);
    const returnLabel = allocateLabel(func.returnLabel ?? `__${func.name}_return`, occupiedLabels);
    emitFunction(func, returnLabel, emitInstruction, (symbol, instruction) => {
      referenced.add(symbol);
      relocations.push({ section: 'text', offset, kind: 'CALL16', symbol, addend: 0,
        ...(instruction.location ? { debug: instruction.location } : {}) });
    }, emitLocalLabel);
  }

  for (const name of referenced) {
    if (!defined.has(name)) symbols.push({ name, binding: 'global', defined: false });
  }
  return { assembly: lines.length === 0 ? '' : `${lines.join('\n')}\n`, size: offset, symbols, relocations };
}

function emitFunction(
  func: IRFunction,
  returnLabel: string,
  emit: (instruction: string) => void,
  reference: (symbol: string, instruction: IRInstruction) => void,
  emitLabel: (label: string) => void,
): void {
  const argumentRegisters = ['r4', 'r5', 'r6', 'r7'];
  const parameterNames = func.parameterNames ?? [];
  const localNames = func.localNames ?? [];
  const slots = new Map<string, number>();
  [...parameterNames, ...localNames].forEach((name, index) => {
    if (name) slots.set(name, 8 + index * 4);
  });
  const instructionList = func.blocks.flatMap(block => block.instructions);
  const valueSlots = Math.max(0, ...instructionList
    .filter(instruction => instruction.dest !== undefined)
    .map(instruction => (instruction.dest ?? -1) + 1));
  const valueBase = 8 + slots.size * 4;
  const frameSize = valueBase + valueSlots * 4;
  const valueRegister = (value: number) => `r${4 + value % 8}`;
  const valueOffset = (value: number) => valueBase + value * 4;
  const readValue = (value: number, target: string) => emit(`mov ${target}, [r12 + ${valueOffset(value)}]`);
  const spillValue = (value: number) => emit(`sw [r12 + ${valueOffset(value)}], ${valueRegister(value)}`);
  const slot = (name: string) => {
    const offset = slots.get(name);
    if (offset === undefined) throw new Error(`typed code generation cannot resolve scalar '${name}'`);
    return offset;
  };

  emit(`mov r13, r13 - ${frameSize}`);
  emit('mov [r13 + 0], r14');
  emit('mov [r13 + 4], r12');
  emit('mov r12, r13');
  parameterNames.forEach((name, index) => {
    if (!name) return;
    if (index < argumentRegisters.length) {
      emit(`sw [r12 + ${slot(name)}], ${argumentRegisters[index]}`);
    } else {
      emit(`mov r7, [r12 + ${frameSize + (index - argumentRegisters.length) * 4}]`);
      emit(`sw [r12 + ${slot(name)}], r7`);
    }
  });

  for (const block of func.blocks) {
    if (block.label !== `${func.name}.entry`) emitLabel(block.label);
    for (const instruction of block.instructions) {
      switch (instruction.op) {
        case 'label': emitLabel(String(instruction.args[0])); break;
        case 'jump': emit(`jmp ${String(instruction.args[0])}`); break;
        case 'branch-zero': readValue(Number(instruction.args[0]), 'r7'); emit(`bz r7, r0 + ${String(instruction.args[1])}`); break;
        case 'branch-nonzero': readValue(Number(instruction.args[0]), 'r7'); emit(`bnz r7, r0 + ${String(instruction.args[1])}`); break;
        case 'constant':
          emit(`mov ${valueRegister(instruction.dest ?? 0)}, ${String(instruction.args[0])}`);
          spillValue(instruction.dest ?? 0);
          break;
        case 'load':
          emit(`mov ${valueRegister(instruction.dest ?? 0)}, [r12 + ${slot(String(instruction.args[0]))}]`);
          spillValue(instruction.dest ?? 0);
          break;
        case 'store':
          readValue(Number(instruction.args[1]), 'r7');
          emit(`sw [r12 + ${slot(String(instruction.args[0]))}], r7`);
          break;
        case 'binary':
          emitBinary(instruction, valueRegister, readValue, emit);
          spillValue(instruction.dest ?? 0);
          break;
        case 'call':
        case 'runtime-call': {
          const symbol = String(instruction.args[0]);
          const argumentsList = instruction.args.slice(1);
          const extraBytes = Math.max(0, argumentsList.length - argumentRegisters.length) * 4;
          if (extraBytes > 0) emit(`mov r13, r13 - ${extraBytes}`);
          argumentsList.slice(argumentRegisters.length).forEach((argument, index) => {
            readValue(Number(argument), 'r7');
            emit(`sw [r13 + ${index * 4}], r7`);
          });
          argumentsList.slice(0, argumentRegisters.length).forEach((argument, index) => {
            if (index < argumentRegisters.length) {
              readValue(Number(argument), argumentRegisters[index]);
            }
          });
          reference(symbol, instruction);
          emit(`jmp ${symbol}, r14`);
          if (extraBytes > 0) emit(`mov r13, r13 + ${extraBytes}`);
          if (instruction.dest !== undefined && valueRegister(instruction.dest) !== 'r4') {
            emit(`mov ${valueRegister(instruction.dest)}, r4`);
          }
          if (instruction.dest !== undefined) spillValue(instruction.dest);
          break;
        }
        case 'ret':
          if (instruction.args.length > 0) {
            readValue(Number(instruction.args[0]), 'r4');
          }
          emit(`jmp ${returnLabel}`);
          break;
      }
    }
  }
  emitLabel(returnLabel);
  emit('mov r14, [r12 + 0]');
  emit('mov r8, [r12 + 4]');
  emit(`mov r13, r12 + ${frameSize}`);
  emit('mov r12, r8');
  emit('jmp r14');
}

function emitBinary(
  instruction: IRInstruction,
  valueRegister: (value: number) => string,
  readValue: (value: number, target: string) => void,
  emit: (instruction: string) => void,
): void {
  const [operator, leftValue, rightValue] = instruction.args;
  const destination = valueRegister(instruction.dest ?? 0);
  readValue(Number(leftValue), 'r7');
  readValue(Number(rightValue), 'r8');
  const left = 'r7';
  const right = 'r8';
  switch (operator) {
    case '+': case '-': case '&': case '|': case '^': case '<<': case '>>':
      emit(`mov ${destination}, ${left} ${String(operator)} ${right}`);
      return;
    case '*':
      emit(`mul ${destination}, ${left}, ${right}`);
      return;
    case '/':
      emit(`div ${destination}, ${left}, ${right}`);
      return;
    case '%':
      emit(`rem ${destination}, ${left}, ${right}`);
      return;
    case '==': case '!=': case '<': case '<=': case '>': case '>=':
      emit(`cmp ${destination}, ${left} ${String(operator)} ${right}`);
      return;
    default:
      throw new Error(`typed code generation does not support '${String(operator)}'`);
  }
}

function allocateLabel(preferred: string, occupiedLabels: Set<string>): string {
  let label = preferred;
  let serial = 0;
  while (occupiedLabels.has(label)) {
    label = `${preferred}_generated_${serial++}`;
  }
  occupiedLabels.add(label);
  return label;
}
