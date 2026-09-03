import { SimpleCPUAssembler } from '../assembler';
import { Merc32Object, ObjectSymbol, Relocation } from './objectFormat';

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
function cleanLine(line: string): string { return line.replace(/\/\/.*$/, '').trim(); }
function splitLabel(line: string): [string | undefined, string] {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:\uff1a]\s*(.*)$/);
  return match ? [match[1], match[2].trim()] : [undefined, line];
}
function symbolicOperands(code: string): Array<{ name: string; kind: Relocation['kind'] }> {
  const mnemonic = code.split(/\s+/, 1)[0].toLowerCase();
  const operands = code.slice(mnemonic.length).trim();
  const names: Array<{ name: string; kind: Relocation['kind'] }> = [];
  if (mnemonic === 'jmp') {
    const target = operands.split(',')[0].trim();
    if (identifier.test(target) && !/^r\d+$/.test(target)) names.push({ name: target, kind: 'CALL16' });
    return names;
  }
  if (mnemonic === 'bz' || mnemonic === 'bnz') {
    const target = operands.split(/\s*\+\s*/)[1]?.split(',')[0]?.trim();
    if (target && identifier.test(target) && !/^r\d+$/.test(target)) names.push({ name: target, kind: 'BRANCH16' });
    return names;
  }
  const tokens = operands.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
  for (const name of tokens) if (!/^r\d+$/.test(name) && !names.some(item => item.name === name)) names.push({ name, kind: 'IMM16' });
  return names;
}
function replaceSymbols(code: string, symbols: Set<string>): string {
  return code.replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g, token => symbols.has(token) ? '0' : token);
}

export function assembleToObject(sourceCode: string, options: { abi?: string } = {}): Merc32Object {
  const assembler = new SimpleCPUAssembler();
  const lines = sourceCode.split(/\r?\n/);
  let inBlockComment = false;
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    while (true) {
      if (inBlockComment) {
        const end = line.indexOf('*/');
        if (end < 0) { line = ''; break; }
        line = line.slice(end + 2);
        inBlockComment = false;
      }
      const start = line.indexOf('/*');
      if (start < 0) break;
      const end = line.indexOf('*/', start + 2);
      if (end < 0) { line = line.slice(0, start); inBlockComment = true; break; }
      line = line.slice(0, start) + line.slice(end + 2);
    }
    lines[index] = line;
  }
  const labels = new Map<string, number>();
  const instructions: Array<{ code: string; line: number; offset: number }> = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = cleanLine(lines[index]);
    if (!line) continue;
    const [label, code] = splitLabel(line);
    if (label) {
      if (assembler.isValidRegister(label) || labels.has(label)) throw new Error(`invalid or duplicate label '${label}'`);
      labels.set(label, offset);
    }
    if (!code || code.startsWith('.')) continue;
    instructions.push({ code, line: index + 1, offset });
    offset += 4;
  }
  const referenced = new Set<string>();
  for (const item of instructions) for (const relocation of symbolicOperands(item.code)) referenced.add(relocation.name);
  const symbols: ObjectSymbol[] = [];
  for (const [name, address] of labels) symbols.push({ name, binding: 'global', section: 'text', offset: address, defined: true });
  for (const name of referenced) if (!labels.has(name)) symbols.push({ name, binding: 'global', defined: false });
  const words: number[] = [];
  const relocations: Relocation[] = [];
  const knownSymbols = new Set([...labels.keys(), ...referenced]);
  for (const item of instructions) {
    const parsed = assembler.parseLine(replaceSymbols(item.code, knownSymbols), item.line);
    if (!parsed.instruction) continue;
    words.push(assembler.encodeInstruction(parsed.instruction, item.offset) >>> 0);
    for (const symbolic of symbolicOperands(item.code)) relocations.push({ section: 'text', offset: item.offset, kind: symbolic.kind, symbol: symbolic.name, addend: 0, debug: { file: '', line: item.line, column: 1 } });
  }
  return { version: 1, target: 'merc32', abi: options.abi ?? 'merc32-c-v1', sections: [{ name: 'text', alignment: 4, size: words.length * 4, content: words }], symbols, relocations };
}
