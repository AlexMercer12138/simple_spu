import { Merc32Object, ObjectSymbol, Relocation } from '../linker/objectFormat';
import { Merc32Module } from './ir';

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
  const referenced = new Set<string>();
  let offset = 0;
  const emitInstruction = (instruction: string) => { lines.push(`  ${instruction}`); offset += 4; };

  for (const func of module.functions) {
    symbols.push({ name: func.name, binding: 'global', section: 'text', offset, defined: true });
    lines.push(`${func.name}:`);
    emitInstruction('mov r13, r13 - 8');
    emitInstruction('mov [r13 + 0], r14');
    emitInstruction('mov [r13 + 4], r12');
    emitInstruction('mov r12, r13');
    for (const block of func.blocks) {
      if (block.label !== `${func.name}.entry`) lines.push(`${block.label}:`);
      for (const instruction of block.instructions) {
        if (instruction.op === 'constant') {
          emitInstruction(`mov r4, ${String(instruction.args[0])}`);
        } else if (instruction.op === 'call' || instruction.op === 'runtime-call') {
          const symbol = String(instruction.args[0]);
          referenced.add(symbol);
          relocations.push({ section: 'text', offset, kind: 'CALL16', symbol, addend: 0,
            ...(instruction.location ? { debug: instruction.location } : {}) });
          emitInstruction(`jmp ${symbol}, r14`);
        } else if (instruction.op === 'ret') {
          emitInstruction(`jmp __${func.name}_return`);
        }
      }
    }
    lines.push(`__${func.name}_return:`);
    emitInstruction('mov r14, [r12 + 0]');
    emitInstruction('mov r8, [r12 + 4]');
    emitInstruction('mov r13, r12 + 8');
    emitInstruction('mov r12, r8');
    emitInstruction('jmp r14');
  }

  for (const name of referenced) {
    if (!defined.has(name)) symbols.push({ name, binding: 'global', defined: false });
  }
  return { assembly: lines.length === 0 ? '' : `${lines.join('\n')}\n`, size: offset, symbols, relocations };
}
