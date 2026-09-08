import { SimpleCPUAssembler } from '../assembler';
import { Merc32Object, ObjectSection, ObjectSymbol, Relocation } from './objectFormat';
import { LayoutOptions, layoutSections, LinkerError } from './resolver';
import { maskAssemblyComments } from './sourceText';

export interface InstructionRecord { readonly opcode: string; readonly target?: string; readonly condition?: string; readonly address: number; }
export function relaxControlFlow(records: readonly InstructionRecord[], symbols: ReadonlyMap<string, number>): InstructionRecord[] {
  return records.map(record => {
    if (!record.target) return record;
    const target = symbols.get(record.target);
    if (target === undefined) return record;
    if (target >= 0 && target <= 0xffff) return record;
    return { ...record, opcode: record.opcode === 'jmp' ? 'long-jmp' : 'long-branch' };
  });
}

interface Expansion {
  readonly lines: readonly string[];
  readonly words: readonly number[];
  readonly addressOffset: number;
}

function instructionLines(source: string): Map<number, { line: number; code: string; label: string }> {
  const result = new Map<number, { line: number; code: string; label: string }>();
  let offset = 0;
  maskAssemblyComments(source).forEach((line, index) => {
    const label = line.match(/^\s*[A-Za-z_][A-Za-z0-9_]*\s*[:\uff1a]\s*/)?.[0] ?? '';
    const code = line.slice(label.length).trim();
    if (!code || code.startsWith('.')) return;
    result.set(offset, { line: index, code, label });
    offset += 4;
  });
  return result;
}

function encode(code: string): number {
  const assembler = new SimpleCPUAssembler();
  return assembler.encodeInstruction(assembler.parseLine(code, 1).instruction!, 0) >>> 0;
}

function withoutSymbol(code: string, symbol: string): string {
  const mnemonic = code.match(/^\S+\s*/)?.[0] ?? '';
  return mnemonic + code.slice(mnemonic.length).replace(/\b[A-Za-z_][A-Za-z0-9_]*\b/g,
    token => token === symbol ? '0' : token);
}

function expand(section: ObjectSection, relocation: Relocation,
    objectIndex: number, code?: string): Expansion {
  const fail = (message: string): never => {
    throw new LinkerError(message, relocation.symbol, objectIndex, 'text', relocation.offset, relocation.debug);
  };
  const symbolicCode = code === undefined ? undefined : withoutSymbol(code, relocation.symbol);
  const sourceWord = symbolicCode === undefined ? undefined : encode(symbolicCode);
  const word = Array.isArray(section.content) ? section.content[relocation.offset / 4] : sourceWord;
  if (word === undefined) return fail('control-flow relaxation requires instruction content');
  const opcode = word & 0xff;
  if (relocation.kind === 'CALL16' ? opcode !== 0x2c : opcode !== 0x2a && opcode !== 0x2b) {
    return fail(`invalid ${relocation.kind} instruction for relaxation`);
  }
  if (((word >>> 12) & 15) !== 0) return fail(`${relocation.kind} relaxation requires r0 base`);
  if (sourceWord !== undefined && (sourceWord & 0xffff) !== (word & 0xffff)) {
    return fail('control-flow source and canonical instruction disagree');
  }
  const scratch = `r${relocation.relaxationRegister}`;
  const rd = (word >>> 8) & 15;
  const branch = relocation.kind === 'BRANCH16';
  // Test the original condition before clobbering scratch, including when rd == scratch.
  const lines = [
    ...(branch ? [`${opcode === 0x2a ? 'bnz' : 'bz'} r${rd}, r15 + 20`] : []),
    `mov ${scratch}, ${relocation.symbol}`,
    `mov ${scratch}, ${scratch} << 16`,
    `mov ${scratch}, ${scratch} | ${relocation.symbol}`,
    `jmp ${scratch}${branch || rd === 0 ? '' : `, r${rd}`}`,
  ];
  return { lines, words: lines.map(line => encode(withoutSymbol(line, relocation.symbol))),
    addressOffset: branch ? 4 : 0 };
}

/** Expand only explicitly annotated sites; repeated layouts account for cascading growth. */
export function relaxObjects(inputs: readonly Merc32Object[], options: LayoutOptions): readonly Merc32Object[] {
  let objects = inputs;
  for (;;) {
    const layout = layoutSections(objects, options);
    const bases = objects.map(() => new Map<string, number>());
    const addresses = [...layout.sections.values()];
    let cursor = 0;
    for (const name of ['text', 'rodata', 'data', 'bss']) {
      objects.forEach((object, index) => {
        if (object.sections.some(section => section.name === name)) bases[index].set(name, addresses[cursor++]);
      });
    }
    const globals = new Map<string, { index: number; symbol: ObjectSymbol }>();
    objects.forEach((object, index) => object.symbols.forEach(symbol => {
      if (symbol.defined && symbol.binding === 'global') globals.set(symbol.name, { index, symbol });
    }));
    const resolve = (index: number, name: string) => {
      const local = objects[index].symbols.find(symbol => symbol.name === name && symbol.defined && symbol.binding === 'local');
      return local ? { index, symbol: local } : globals.get(name)!;
    };
    const expansions = objects.map((object, index) => {
      const result = new Map<number, Expansion>();
      const text = object.sections.find(section => section.name === 'text');
      if (!text) return result;
      const source = text.source ?? (typeof text.content === 'string' ? text.content : undefined);
      const instructions = source === undefined ? undefined : instructionLines(source);
      for (const relocation of object.relocations) {
        if (relocation.relaxationRegister === undefined) continue;
        const target = resolve(index, relocation.symbol);
        const address = bases[target.index].get(target.symbol.section!)! + target.symbol.offset! + relocation.addend;
        if (!Number.isSafeInteger(address) || address < 0 || address > 0xffffffff || address % 4 !== 0) {
          throw new LinkerError('invalid control-flow relaxation target', relocation.symbol, index,
            relocation.section, relocation.offset, relocation.debug);
        }
        if (address <= 0xffff) continue;
        if (object.relocations.filter(other => other.section === 'text' && other.offset === relocation.offset).length !== 1) {
          throw new LinkerError('overlapping control-flow relaxations', relocation.symbol, index, 'text', relocation.offset);
        }
        result.set(relocation.offset, expand(text, relocation, index, instructions?.get(relocation.offset)?.code));
      }
      return result;
    });
    if (expansions.every(map => map.size === 0)) return objects;
    const shifts = objects.map((object, index) => {
      const size = object.sections.find(section => section.name === 'text')?.size ?? 0;
      const result = new Uint32Array(size / 4 + 1);
      for (const [offset, expansion] of expansions[index]) result[offset / 4 + 1] = (expansion.words.length - 1) * 4;
      for (let i = 1; i < result.length; i++) result[i] += result[i - 1];
      return result;
    });
    const moved = (index: number, offset: number) => offset + shifts[index][Math.floor(offset / 4)];
    objects = objects.map((object, index) => ({
      ...object,
      ...(object.functions === undefined ? {} : { functions: object.functions.map(func => ({
        ...func, offset: moved(index, func.offset), size: moved(index, func.offset + func.size) - moved(index, func.offset),
      })) }),
      sections: object.sections.map(section => {
        if (section.name !== 'text' || expansions[index].size === 0) return section;
        const source = section.source ?? (typeof section.content === 'string' ? section.content : undefined);
        let rewritten: string | undefined;
        if (source !== undefined) {
          // Mask the whole section so replacing a line cannot strand a block-comment delimiter.
          const lines = maskAssemblyComments(source);
          for (const [offset, instruction] of instructionLines(source)) {
            const expansion = expansions[index].get(offset);
            if (expansion) lines[instruction.line] = `${instruction.label}\n${expansion.lines.join('\n')}`;
          }
          rewritten = lines.join('\n');
        }
        const content = typeof section.content === 'string' ? rewritten! :
          section.content!.flatMap((word, wordIndex) => expansions[index].get(wordIndex * 4)?.words ?? [word]);
        return { ...section, size: moved(index, section.size), content,
          ...(section.source !== undefined ? { source: rewritten } : {}) };
      }),
      symbols: object.symbols.map(symbol => symbol.defined && symbol.section === 'text'
        ? { ...symbol, offset: moved(index, symbol.offset!) } : symbol),
      relocations: object.relocations.flatMap(relocation => {
        const target = resolve(index, relocation.symbol);
        const targetOffset = target.symbol.offset! + relocation.addend;
        const textSize = objects[target.index].sections.find(section => section.name === 'text')?.size ?? 0;
        const addend = target.symbol.section === 'text' && targetOffset >= 0 && targetOffset <= textSize
          ? moved(target.index, targetOffset) - moved(target.index, target.symbol.offset!) : relocation.addend;
        const adjusted = { ...relocation, addend, offset: relocation.section === 'text'
          ? moved(index, relocation.offset) : relocation.offset };
        const expansion = relocation.section === 'text' ? expansions[index].get(relocation.offset) : undefined;
        if (!expansion) return [adjusted];
        const { relaxationRegister, ...base } = adjusted;
        return [
          { ...base, kind: 'HI16' as const, offset: adjusted.offset + expansion.addressOffset },
          { ...base, kind: 'LO16' as const, offset: adjusted.offset + expansion.addressOffset + 8 },
        ];
      }),
    }));
  }
}
