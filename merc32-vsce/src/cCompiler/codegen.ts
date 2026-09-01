import { Merc32Object, ObjectSymbol } from '../linker/objectFormat';
import { Merc32Module } from './ir';

export function generateAssembly(module: Merc32Module): string {
  const lines: string[] = [];
  for (const func of module.functions) {
    lines.push(`${func.name}:`);
    for (const block of func.blocks) {
      if (block.label !== `${func.name}.entry`) lines.push(`${block.label}:`);
      for (const instruction of block.instructions) {
        if (instruction.op === 'ret') lines.push('  jmp r14');
      }
    }
  }
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

export function generateObject(module: Merc32Module): Merc32Object {
  const assembly = generateAssembly(module);
  const symbols: ObjectSymbol[] = module.functions.map((func, index) => ({
    name: func.name, binding: 'global', section: 'text', offset: index, defined: true,
  }));
  return {
    version: 1,
    target: 'merc32',
    abi: module.abi,
    sections: [{ name: 'text', alignment: 4, size: assembly.length, content: assembly }],
    symbols,
    relocations: [],
  };
}
