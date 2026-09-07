import { Merc32Object, ObjectSymbol, Relocation } from '../linker/objectFormat';
import { IRFunction, IRInstruction, Merc32Module } from './ir';
import { CType, typeAlignment, typeSize } from './types';

export function generateAssembly(module: Merc32Module): string {
  return emitModule(module).assembly;
}

export function generateObject(module: Merc32Module): Merc32Object {
  const emitted = emitModule(module);
  const sections: Merc32Object['sections'][number][] = [
    { name: 'text', alignment: 4, size: emitted.size, content: emitted.assembly },
  ];
  const symbols = [...emitted.symbols];
  const emittedDataRelocations: Relocation[] = [];
  const data: number[] = [];
  let dataAlignment = 1;
  let bssSize = 0;
  let bssAlignment = 1;
  for (const global of module.globals) {
    const alignment = typeAlignment(global.type);
    const initializer = global.initializerBytes ?? global.initializer;
    if (initializer) {
      dataAlignment = Math.max(dataAlignment, alignment);
      while (data.length < alignUp(data.length, alignment)) data.push(0);
      const dataOffset = data.length;
      symbols.push({ name: global.name, binding: global.binding ?? 'global', section: 'data', offset: dataOffset, defined: true });
      data.push(...initializer);
      for (const relocation of global.initializerRelocations ?? []) {
        emittedDataRelocations.push({ ...relocation, section: 'data', offset: dataOffset + relocation.offset });
      }
    } else {
      bssAlignment = Math.max(bssAlignment, alignment);
      bssSize = alignUp(bssSize, alignment);
      symbols.push({ name: global.name, binding: global.binding ?? 'global', section: 'bss', offset: bssSize, defined: true });
      bssSize += typeSize(global.type);
    }
  }
  if (data.length > 0) sections.push({ name: 'data', alignment: dataAlignment, size: data.length, content: data });
  if (bssSize > 0) sections.push({ name: 'bss', alignment: bssAlignment, size: bssSize });
  const definedNames = new Set(symbols.map((symbol) => symbol.name));
  for (const relocation of emittedDataRelocations) {
    if (!definedNames.has(relocation.symbol)) {
      symbols.push({ name: relocation.symbol, binding: 'global', defined: false });
      definedNames.add(relocation.symbol);
    }
  }
  return {
    version: 1,
    target: 'merc32',
    abi: module.abi,
    sections,
    symbols,
    relocations: [...emitted.relocations, ...emittedDataRelocations],
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
  const defined = new Set([
    ...module.functions.map(func => func.name),
    ...module.globals.map(global => global.name),
  ]);
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
    symbols.push({ name: func.name, binding: func.binding ?? 'global', section: 'text', offset, defined: true });
    lines.push(`${func.name}:`);
    const returnLabel = allocateLabel(func.returnLabel ?? `__${func.name}_return`, occupiedLabels);
    emitFunction(func, returnLabel, emitInstruction, (symbol, instruction, kind) => {
      referenced.add(symbol);
      relocations.push({ section: 'text', offset, kind, symbol, addend: 0,
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
  reference: (symbol: string, instruction: IRInstruction, kind: Relocation['kind']) => void,
  emitLabel: (label: string) => void,
): void {
  const argumentRegisters = ['r4', 'r5', 'r6', 'r7'];
  const parameterNames = func.parameterNames ?? [];
  const localNames = func.localNames ?? [];
  const localTypes = func.localTypes ?? localNames.map(() => undefined);
  const slots = new Map<string, { readonly offset: number; readonly type?: CType }>();
  let nextVariableOffset = 8;
  const variables = [
    ...parameterNames.map((name, index) => ({ name, type: func.parameters[index] })),
    ...localNames.map((name, index) => ({ name, type: localTypes[index] })),
  ];
  for (const variable of variables) {
    if (!variable.name) continue;
    const alignment = variable.type ? typeAlignment(variable.type) : 4;
    nextVariableOffset = alignUp(nextVariableOffset, alignment);
    slots.set(variable.name, { offset: nextVariableOffset, type: variable.type });
    nextVariableOffset += variable.type ? typeSize(variable.type) : 4;
  }
  const instructionList = func.blocks.flatMap(block => block.instructions);
  const valueSlots = Math.max(0, ...instructionList
    .filter(instruction => instruction.dest !== undefined)
    .map(instruction => (instruction.dest ?? -1) + 1));
  const valueBase = alignUp(nextVariableOffset, 4);
  const frameSize = alignUp(valueBase + valueSlots * 4, 4);
  const valueRegister = (value: number) => `r${4 + value % 8}`;
  const valueOffset = (value: number) => valueBase + value * 4;
  const readValue = (value: number, target: string) => emit(`mov ${target}, [r12 + ${valueOffset(value)}]`);
  const spillValue = (value: number) => emit(`sw [r12 + ${valueOffset(value)}], ${valueRegister(value)}`);
  const slot = (name: string) => {
    const entry = slots.get(name);
    if (entry === undefined) throw new Error(`typed code generation cannot resolve scalar '${name}'`);
    return entry.offset;
  };
  const variableType = (name: string) => slots.get(name)?.type;

  emit(`mov r13, r13 - ${frameSize}`);
  emit('mov [r13 + 0], r14');
  emit('mov [r13 + 4], r12');
  emit('mov r12, r13');
  parameterNames.forEach((name, index) => {
    if (!name) return;
    if (index < argumentRegisters.length) {
      emitStore(variableType(name), `[r12 + ${slot(name)}]`, argumentRegisters[index], emit);
    } else {
      emit(`mov r7, [r12 + ${frameSize + (index - argumentRegisters.length) * 4}]`);
      emitStore(variableType(name), `[r12 + ${slot(name)}]`, 'r7', emit);
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
          emitConstant(valueRegister(instruction.dest ?? 0), Number(instruction.args[0]), emit);
          spillValue(instruction.dest ?? 0);
          break;
        case 'convert-integer': {
          const destination = valueRegister(instruction.dest ?? 0);
          readValue(Number(instruction.args[0]), destination);
          const shift = 32 - Number(instruction.args[1]);
          emit(`mov ${destination}, ${destination} << ${shift}`);
          emit(`mov ${destination}, ${destination} ${instruction.args[2] ? '>>>' : '>>'} ${shift}`);
          spillValue(instruction.dest ?? 0);
          break;
        }
        case 'load':
          emitLoad(variableType(String(instruction.args[0])), valueRegister(instruction.dest ?? 0), `[r12 + ${slot(String(instruction.args[0]))}]`, emit);
          spillValue(instruction.dest ?? 0);
          break;
        case 'store':
          readValue(Number(instruction.args[1]), 'r7');
          emitStore(variableType(String(instruction.args[0])), `[r12 + ${slot(String(instruction.args[0]))}]`, 'r7', emit);
          break;
        case 'address-local':
          emit(`mov ${valueRegister(instruction.dest ?? 0)}, r12 + ${slot(String(instruction.args[0]))}`);
          spillValue(instruction.dest ?? 0);
          break;
        case 'address-symbol': {
          const symbol = String(instruction.args[0]);
          const destination = valueRegister(instruction.dest ?? 0);
          reference(symbol, instruction, 'HI16');
          emit(`mov ${destination}, ${symbol}`);
          emit(`mov ${destination}, ${destination} << 16`);
          reference(symbol, instruction, 'LO16');
          emit(`mov ${destination}, ${destination} + ${symbol}`);
          spillValue(instruction.dest ?? 0);
          break;
        }
        case 'load-memory':
          readValue(Number(instruction.args[0]), 'r8');
          emitLoadBySize(Number(instruction.args[1]), Number(instruction.args[2]) !== 0,
            valueRegister(instruction.dest ?? 0), '[r8]', emit);
          spillValue(instruction.dest ?? 0);
          break;
        case 'store-memory':
          readValue(Number(instruction.args[0]), 'r8');
          readValue(Number(instruction.args[1]), 'r7');
          emitStoreBySize(Number(instruction.args[2]), '[r8]', 'r7', emit);
          break;
        case 'move-value':
          readValue(Number(instruction.args[0]), valueRegister(instruction.dest ?? 0));
          spillValue(instruction.dest ?? 0);
          break;
        case 'binary':
          emitBinary(instruction, valueRegister, readValue, emit);
          spillValue(instruction.dest ?? 0);
          break;
        case 'call':
        case 'runtime-call':
        case 'call-indirect': {
          const indirect = instruction.op === 'call-indirect';
          const target = instruction.args[0];
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
          if (indirect) {
            readValue(Number(target), 'r8');
            emit('jmp r8, r14');
          } else {
            const symbol = String(target);
            reference(symbol, instruction, 'CALL16');
            emit(`jmp ${symbol}, r14`);
          }
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

function alignUp(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function emitConstant(destination: string, value: number, emit: (instruction: string) => void): void {
  const word = value >>> 0;
  if (word <= 0xffff) {
    emit(`mov ${destination}, ${word <= 32767 ? word : `0x${word.toString(16)}`}`);
  } else {
    emit(`mov ${destination}, 0x${(word >>> 16).toString(16)}`);
    emit(`mov ${destination}, ${destination} << 16`);
    emit(`mov ${destination}, ${destination} | 0x${(word & 0xffff).toString(16)}`);
  }
}

function emitLoad(type: CType | undefined, destination: string, address: string, emit: (instruction: string) => void): void {
  if (!type) {
    emit(`lw ${destination}, ${address}`);
    return;
  }
  const size = typeSize(type);
  const signed = type.kind === 'builtin' && (type.name === 'char' || type.name === 'signed char' || type.name === 'short');
  emitLoadBySize(size, signed, destination, address, emit);
}

function emitLoadBySize(size: number, signed: boolean, destination: string, address: string, emit: (instruction: string) => void): void {
  const mnemonic = size === 1 ? signed ? 'lb' : 'lbu' : size === 2 ? signed ? 'lh' : 'lhu' : size === 4 ? 'lw' : undefined;
  if (!mnemonic) throw new Error(`typed code generation cannot load ${size}-byte values`);
  emit(`${mnemonic} ${destination}, ${address}`);
}

function emitStore(type: CType | undefined, address: string, source: string, emit: (instruction: string) => void): void {
  emitStoreBySize(type ? typeSize(type) : 4, address, source, emit);
}

function emitStoreBySize(size: number, address: string, source: string, emit: (instruction: string) => void): void {
  const mnemonic = size === 1 ? 'sb' : size === 2 ? 'sh' : size === 4 ? 'sw' : undefined;
  if (!mnemonic) throw new Error(`typed code generation cannot store ${size}-byte values`);
  emit(`${mnemonic} ${address}, ${source}`);
}

function emitBinary(
  instruction: IRInstruction,
  valueRegister: (value: number) => string,
  readValue: (value: number, target: string) => void,
  emit: (instruction: string) => void,
): void {
  const [operator, leftValue, rightValue, unsigned] = instruction.args;
  const destination = valueRegister(instruction.dest ?? 0);
  readValue(Number(leftValue), 'r7');
  readValue(Number(rightValue), 'r8');
  const left = 'r7';
  const right = 'r8';
  switch (operator) {
    case '+': case '-': case '&': case '|': case '^': case '<<':
      emit(`mov ${destination}, ${left} ${String(operator)} ${right}`);
      return;
    case '>>':
      emit(`mov ${destination}, ${left} ${unsigned ? '>>' : '>>>'} ${right}`);
      return;
    case '*':
      emit(`mul ${destination}, ${left}, ${right}`);
      return;
    case '/':
      emit(`${unsigned ? 'divu' : 'div'} ${destination}, ${left}, ${right}`);
      return;
    case '%':
      emit(`${unsigned ? 'remu' : 'rem'} ${destination}, ${left}, ${right}`);
      return;
    case '==': case '!=': case '<': case '<=': case '>': case '>=':
      emit(`${unsigned ? 'cmpu' : 'cmp'} ${destination}, ${left} ${String(operator)} ${right}`);
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
