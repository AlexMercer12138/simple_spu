import { Merc32Object, ObjectSectionName, ObjectSection, normalizeSectionContent, RelocationKind } from './objectFormat';

const maxAddress = 0xffffffff;

export function validateObject(object: Merc32Object): void {
  if (!object || object.version !== 1 || object.target !== 'merc32' || typeof object.abi !== 'string') throw new Error('invalid MERC32 object header');
  const names = new Set<ObjectSectionName>(['text', 'rodata', 'data', 'bss']);
  if (!Array.isArray(object.sections) || !Array.isArray(object.symbols) || !Array.isArray(object.relocations)) throw new Error('invalid MERC32 object tables');
  const sections = new Map<ObjectSectionName, ObjectSection>();
  for (const section of object.sections) {
    if (!names.has(section.name)) throw new Error(`invalid section '${section.name}'`);
    if (sections.has(section.name)) throw new Error(`duplicate section '${section.name}'`);
    if (!Number.isSafeInteger(section.size) || section.size < 0 || section.size > maxAddress) throw new Error('invalid section size');
    if (!Number.isSafeInteger(section.alignment) || section.alignment <= 0 || section.alignment > maxAddress || !Number.isInteger(Math.log2(section.alignment))) throw new Error('invalid section alignment');
    const content = normalizeSectionContent(section);
    const byteLength = section.name === 'text' ? content.length * 4 : section.name === 'bss' ? section.size : content.length;
    if (byteLength !== section.size) throw new Error(`section size/content mismatch for '${section.name}'`);
    sections.set(section.name, section);
  }
  const symbols = new Set<string>();
  const definedGlobals = new Set<string>();
  for (const symbol of object.symbols) {
    if (!symbol || typeof symbol.name !== 'string') throw new Error('invalid symbol');
    if (symbol.binding !== 'local' && symbol.binding !== 'global' || typeof symbol.defined !== 'boolean') throw new Error('invalid symbol');
    if (symbol.defined) {
      if (!symbol.section || !sections.has(symbol.section) || !Number.isSafeInteger(symbol.offset) || symbol.offset < 0 || symbol.offset > sections.get(symbol.section)!.size) throw new Error(`invalid defined symbol '${symbol.name}' section/offset`);
      if (symbol.binding === 'global' && definedGlobals.has(symbol.name)) throw new Error(`duplicate defined global symbol '${symbol.name}'`);
      if (symbol.binding === 'global') definedGlobals.add(symbol.name);
    } else if (symbol.section !== undefined || symbol.offset !== undefined) throw new Error(`undefined symbol '${symbol.name}' must not have section/offset`);
    symbols.add(symbol.name);
  }
  const kinds = new Set<RelocationKind>(['ABS32', 'IMM16', 'CALL16', 'BRANCH16', 'HI16', 'LO16']);
  for (const relocation of object.relocations) {
    if (!names.has(relocation.section) || !sections.has(relocation.section) || !symbols.has(relocation.symbol) || !kinds.has(relocation.kind) || !Number.isSafeInteger(relocation.offset) || relocation.offset < 0 || !Number.isSafeInteger(relocation.addend)) throw new Error('invalid relocation');
    if (relocation.section === 'bss') throw new Error("relocation patch section 'bss' is not supported");
    const width = relocation.kind === 'ABS32' || relocation.section === 'text' ? 4 : 2;
    if (relocation.section === 'text' && relocation.offset % 4 !== 0) throw new Error('text relocation offset must be 4-byte aligned');
    if (relocation.offset + width > sections.get(relocation.section)!.size) throw new Error('relocation offset outside section');
  }
}

export function serializeObject(object: Merc32Object): string { validateObject(object); return JSON.stringify(object, null, 2); }
export function deserializeObject(text: string): Merc32Object { const object = JSON.parse(text) as Merc32Object; validateObject(object); return object; }
