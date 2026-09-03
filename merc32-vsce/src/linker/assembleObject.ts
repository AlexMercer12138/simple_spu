import { SimpleCPUAssembler } from '../assembler';
import { AssemblerPreprocessor } from '../preprocessor';
import { Merc32Object, ObjectSymbol, Relocation, RelocationKind } from './objectFormat';
import { maskAssemblyComments } from './sourceText';

const identifier = /^[A-Za-z_][A-Za-z0-9_]*$/;
type SymbolicOperand = { name: string; kind: RelocationKind; column: number };

function splitLabel(line: string): [string | undefined, string] {
  const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*[:\uff1a]\s*(.*)$/);
  return match ? [match[1], match[2].trim()] : [undefined, line.trim()];
}
function scanIdentifiers(text: string): Array<{ name: string; index: number }> {
  const result: Array<{ name: string; index: number }> = [];
  let quote = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) { if (escaped) escaped = false; else if (char === '\\') escaped = true; else if (char === '"') quote = false; continue; }
    if (char === '"') { quote = true; continue; }
    const numeric = text.slice(i).match(/^0[xX][0-9a-fA-F]+\b|^0[bB][01]+\b/);
    if (numeric) { i += numeric[0].length - 1; continue; }
    const match = text.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/);
    if (match) { result.push({ name: match[0], index: i }); i += match[0].length - 1; }
  }
  return result;
}
function symbolicOperands(code: string): SymbolicOperand[] {
  const match = code.match(/^(\S+)/);
  const mnemonic = match?.[1].toLowerCase() ?? '';
  const operands = code.slice(match?.[1].length ?? 0);
  const ids = scanIdentifiers(operands).filter(item => !/^r\d+$/.test(item.name));
  if (mnemonic === 'jmp') {
    const first = operands.split(',')[0];
    const target = scanIdentifiers(first).pop();
    if (target && !/^r\d+$/.test(target.name)) return [{ name: target.name, kind: 'CALL16', column: (match?.[1].length ?? 0) + target.index + 1 }];
    return [];
  }
  if (mnemonic === 'bz' || mnemonic === 'bnz') {
    const targetPart = operands.split(/\s*\+\s*/)[1]?.split(',')[0] ?? '';
    const target = scanIdentifiers(targetPart).pop();
    if (target) return [{ name: target.name, kind: 'BRANCH16', column: code.indexOf(target.name) + 1 }];
    return [];
  }
  return ids.filter((item, index) => ids.findIndex(candidate => candidate.name === item.name) === index)
    .map(item => ({ name: item.name, kind: 'IMM16', column: code.indexOf(item.name) + 1 }));
}
function replaceSymbols(code: string, symbols: Set<string>): string {
  return code.replace(/("(?:\\.|[^"\\])*")|\b[A-Za-z_][A-Za-z0-9_]*\b/g, (token, quoted) => quoted || /^r\d+$/.test(token) ? token : symbols.has(token) ? '0' : token);
}

export function assembleToObject(sourceCode: string, options: { abi?: string; exports?: readonly string[] } = {}): Merc32Object {
  const preprocessed = new AssemblerPreprocessor().preprocess(sourceCode);
  const assembler = new SimpleCPUAssembler();
  const lines = maskAssemblyComments(preprocessed.sourceCode).map(line => line.trim());
  const labels = new Map<string, number>();
  const instructions: Array<{ code: string; line: number; offset: number }> = [];
  let offset = 0;
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
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
  const referenced = new Map<string, SymbolicOperand>();
  for (const item of instructions) for (const relocation of symbolicOperands(item.code)) if (!referenced.has(relocation.name)) referenced.set(relocation.name, relocation);
  const exported = new Set(options.exports ?? []);
  if (preprocessed.entryLabel) exported.add(preprocessed.entryLabel);
  const symbols: ObjectSymbol[] = [];
  for (const [name, address] of labels) symbols.push({ name, binding: exported.has(name) ? 'global' : 'local', section: 'text', offset: address, defined: true });
  for (const name of referenced.keys()) if (!labels.has(name)) symbols.push({ name, binding: 'global', defined: false });
  const words: number[] = [];
  const relocations: Relocation[] = [];
  const knownSymbols = new Set([...labels.keys(), ...referenced.keys()]);
  for (const item of instructions) {
    const parsed = assembler.parseLine(replaceSymbols(item.code, knownSymbols), item.line);
    if (!parsed.instruction) continue;
    words.push(assembler.encodeInstruction(parsed.instruction, item.offset) >>> 0);
    for (const symbolic of symbolicOperands(item.code)) relocations.push({ section: 'text', offset: item.offset, kind: symbolic.kind, symbol: symbolic.name, addend: 0, debug: { file: '', line: item.line, column: symbolic.column } });
  }
  return { version: 1, target: 'merc32', abi: options.abi ?? 'merc32-c-v1', sections: [{ name: 'text', alignment: 4, size: words.length * 4, content: words, source: preprocessed.sourceCode, entryLabel: preprocessed.entryLabel }], symbols, relocations };
}
