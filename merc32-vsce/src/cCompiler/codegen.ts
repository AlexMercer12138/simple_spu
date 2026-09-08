import { Merc32Object, ObjectFunction, ObjectSymbol, Relocation } from '../linker/objectFormat';
import { IRFunction, IRInstruction, Merc32Module } from './ir';
import { BackendCompileOptions, CType, typeAlignment, typeSize } from './types';
import { allocateTemporarySlots, optimizeModule } from './optimize';
import { allocateLocalRegisters } from './localRegisters';

export function generateAssembly(module: Merc32Module, options: BackendCompileOptions = {}): string {
  return emitModule(module, options).assembly;
}

export function generateObject(module: Merc32Module, options: BackendCompileOptions = {}): Merc32Object {
  const emitted = emitModule(module, options);
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
    functions: emitted.functions,
  };
}

interface EmittedModule {
  readonly functions: readonly ObjectFunction[];
  readonly assembly: string;
  readonly size: number;
  readonly symbols: readonly ObjectSymbol[];
  readonly relocations: readonly Relocation[];
}

function emitModule(module: Merc32Module, options: BackendCompileOptions): EmittedModule {
  if (options.optimization === 'basic') module = optimizeModule(module);
  const lines: string[] = [];
  const symbols: ObjectSymbol[] = [];
  const relocations: Relocation[] = [];
  const functions: ObjectFunction[] = [];
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
  const emitInstruction = (instruction: string, relaxationRegister = 8) => {
    const jump = instruction.match(/^jmp ([A-Za-z_][A-Za-z0-9_]*)(?:, r\d+)?$/);
    const branch = instruction.match(/^(?:bz|bnz) r\d+, r0 \+ ([A-Za-z_][A-Za-z0-9_]*)$/);
    const symbol = jump?.[1] ?? branch?.[1];
    if (symbol && !/^r\d+$/.test(symbol) && relocations[relocations.length - 1]?.offset !== offset) {
      referenced.add(symbol);
      relocations.push({ section: 'text', offset, kind: jump ? 'CALL16' : 'BRANCH16',
        symbol, addend: 0, relaxationRegister });
    }
    lines.push(`  ${instruction}`);
    offset += 4;
  };
  const emitLocalLabel = (label: string) => {
    defined.add(label);
    symbols.push({ name: label, binding: 'local', section: 'text', offset, defined: true });
    lines.push(`${label}:`);
  };

  for (const func of module.functions) {
    const start = offset;
    symbols.push({ name: func.name, binding: func.binding ?? 'global', section: 'text', offset, defined: true });
    lines.push(`${func.name}:`);
    const returnLabel = allocateLabel(func.returnLabel ?? `__${func.name}_return`, occupiedLabels);
    emitFunction(func, returnLabel, emitInstruction, (symbol, instruction, kind) => {
      referenced.add(symbol);
      relocations.push({ section: 'text', offset, kind, symbol, addend: 0,
        ...(kind === 'CALL16' || kind === 'BRANCH16' ? { relaxationRegister: 8 } : {}),
        ...(instruction.location ? { debug: instruction.location } : {}) });
    }, emitLocalLabel, prefix => allocateLabel(prefix, occupiedLabels), options);
    functions.push({ name: func.name, offset: start, size: offset - start });
  }

  for (const name of referenced) {
    if (!defined.has(name)) symbols.push({ name, binding: 'global', defined: false });
  }
  return { assembly: lines.length === 0 ? '' : `${lines.join('\n')}\n`, size: offset, symbols, relocations, functions };
}

function emitFunction(
  func: IRFunction,
  returnLabel: string,
  emit: (instruction: string, relaxationRegister?: number) => void,
  reference: (symbol: string, instruction: IRInstruction, kind: Relocation['kind']) => void,
  emitLabel: (label: string) => void,
  newLabel: (prefix: string) => string,
  options: BackendCompileOptions,
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
  const saveReturnAddress = options.optimization !== 'basic'
    || instructionList.some(instruction => ['call', 'runtime-call', 'call-indirect'].includes(instruction.op));
  const localRegisters = options.optimization === 'basic' ? allocateLocalRegisters(func) : undefined;
  const temporarySlots = options.optimization === 'basic' ? new Map([...allocateTemporarySlots(func)]
    .filter(([value]) => !localRegisters?.has(value))) : undefined;
  if (temporarySlots) {
    const dense = new Map<number, number>();
    for (const [value, slot] of temporarySlots) {
      if (!dense.has(slot)) dense.set(slot, dense.size);
      temporarySlots.set(value, dense.get(slot)!);
    }
  }
  const valueSlots = temporarySlots ? Math.max(0, ...[...temporarySlots.values()].map(slot => slot + 1)) : Math.max(0, ...instructionList
    .filter(instruction => instruction.dest !== undefined)
    .map(instruction => (instruction.dest ?? -1) + 1));
  const valueBase = alignUp(nextVariableOffset, 4);
  const frameSize = alignUp(valueBase + valueSlots * 4, 4);
  const valueRegister = (value: number) => localRegisters ? localRegisters.get(value) ?? 'r4' : `r${4 + value % 8}`;
  const valueOffset = (value: number) => valueBase + (temporarySlots?.get(value) ?? value) * 4;
  const readValue = (value: number, target: string) => {
    const register = localRegisters?.get(value);
    if (!register) emit(`mov ${target}, [r12 + ${valueOffset(value)}]`);
    else if (register !== target) emit(`mov ${target}, ${register}`);
  };
  const spillValue = (value: number) => {
    if (!localRegisters?.has(value)) emit(`sw [r12 + ${valueOffset(value)}], ${valueRegister(value)}`);
  };
  const operandRegister = (value: number, scratch: string): string => {
    const register = localRegisters?.get(value);
    if (register) return register;
    readValue(value, scratch);
    return scratch;
  };
  const slot = (name: string) => {
    const entry = slots.get(name);
    if (entry === undefined) throw new Error(`typed code generation cannot resolve scalar '${name}'`);
    return entry.offset;
  };
  const variableType = (name: string) => slots.get(name)?.type;

  emit(`mov r13, r13 - ${frameSize}`);
  if (saveReturnAddress) emit('mov [r13 + 0], r14');
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
          if (instruction.args.length >= 3) {
            emitLoadBySize(Number(instruction.args[1]), !!instruction.args[2], valueRegister(instruction.dest ?? 0), `[r12 + ${slot(String(instruction.args[0]))}]`, emit);
          } else emitLoad(variableType(String(instruction.args[0])), valueRegister(instruction.dest ?? 0), `[r12 + ${slot(String(instruction.args[0]))}]`, emit);
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
        case 'fill-memory': {
          const count = Number(instruction.args[2]);
          if (count === 0) break;
          readValue(Number(instruction.args[0]), 'r8');
          readValue(Number(instruction.args[1]), 'r7');
          const relative = Number(instruction.args[3]);
          if (relative !== 0) {
            emitConstant('r6', relative, emit);
            emit('mov r8, r8 + r6');
          }
          emitConstant('r6', count, emit);
          const loop = newLabel(`__${func.name}_fill`);
          emitLabel(loop);
          emit('sb [r8], r7');
          emit('mov r8, r8 + 1');
          emit('mov r6, r6 - 1');
          // r8 retains the destination pointer across this loop; r4 is dead here.
          emit(`bnz r6, r0 + ${loop}`, 4);
          break;
        }
        case 'move-value':
          readValue(Number(instruction.args[0]), valueRegister(instruction.dest ?? 0));
          spillValue(instruction.dest ?? 0);
          break;
        case 'binary': case 'binary-immediate':
          emitBinary(instruction, valueRegister, operandRegister, emit);
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
          } else if (instruction.op !== 'call' || !emitIrqIntrinsic(String(target), argumentsList.length, emit)) {
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
  if (saveReturnAddress) emit('mov r14, [r12 + 0]');
  emit('mov r8, [r12 + 4]');
  emit(`mov r13, r12 + ${frameSize}`);
  emit('mov r12, r8');
  emit('jmp r14');
}

function emitIrqIntrinsic(symbol: string, argumentCount: number, emit: (instruction: string) => void): boolean {
  switch (symbol) {
    case 'irq_save':
    case 'irq_restore':
    case '__irq_enable':
    case '__irq_disable':
    case '__irq_enable_level':
      if (argumentCount !== (symbol === 'irq_restore' ? 1 : 0)) {
        throw new Error(`invalid argument count for IRQ intrinsic '${symbol}'`);
      }
      break;
    default:
      return false;
  }
  switch (symbol) {
    case 'irq_save':
      // Logical immediates zero-extend, so construct the full-width mask first.
      emit('mov r7, r0 - 2');
      emit('mov r4, r1');
      emit('mov r1, r1 & r7');
      return true;
    case 'irq_restore': emit('mov r1, r4'); break;
    case '__irq_enable': emit('mov r1, 1'); break;
    case '__irq_disable': emit('mov r1, 0'); break;
    case '__irq_enable_level': emit('mov r1, 5'); break;
  }
  emit('mov r4, 0');
  return true;
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
  operandRegister: (value: number, scratch: string) => string,
  emit: (instruction: string) => void,
): void {
  const [operator, leftValue, rightValue, unsigned] = instruction.args;
  const destination = valueRegister(instruction.dest ?? 0);
  const left = operandRegister(Number(leftValue), 'r7');
  const immediate = Number(rightValue);
  const right = instruction.op === 'binary-immediate' ? immediate > 32767 ? `0x${immediate.toString(16)}` : String(immediate) : operandRegister(Number(rightValue), 'r8');
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
