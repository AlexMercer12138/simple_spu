import { Merc32Object, ObjectSymbol, Relocation } from './objectFormat';

export function assembleToObject(sourceCode: string, options: { abi?: string } = {}): Merc32Object {
  const symbols: ObjectSymbol[] = [];
  const relocations: Relocation[] = [];
  const lines = sourceCode.split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    const stripped = line.replace(/\/\/.*$/, '').trim();
    const label = stripped.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*:/);
    if (label) symbols.push({ name: label[1], binding: 'global', section: 'text', offset, defined: true });
    const instruction = stripped.replace(/^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/, '').trim();
    if (!instruction || instruction.startsWith('.')) continue;
    const operands = instruction.split(/\s+/, 2)[1] ?? '';
    const target = operands.split(',')[0].trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(target) && !/^r\d+$/.test(target)) {
      if (!symbols.some(symbol => symbol.name === target)) symbols.push({ name: target, binding: 'global', defined: false });
      relocations.push({ section: 'text', offset, kind: /^b(nz|z)\b/i.test(instruction) ? 'BRANCH16' : 'CALL16', symbol: target, addend: 0, debug: { file: '', line: lines.indexOf(line) + 1, column: 1 } });
    }
    offset += 4;
  }
  return { version: 1, target: 'merc32', abi: options.abi ?? 'merc32-c-v1', sections: [{ name: 'text', alignment: 4, size: offset, content: sourceCode }], symbols, relocations };
}
