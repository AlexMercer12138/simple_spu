import { Merc32Object, ObjectSectionName } from './objectFormat';

export function validateObject(object: Merc32Object): void {
  if (!object || object.version !== 1 || object.target !== 'merc32' || typeof object.abi !== 'string') throw new Error('invalid MERC32 object header');
  const names = new Set<ObjectSectionName>(['text', 'rodata', 'data', 'bss']);
  const symbols = new Set(object.symbols.map(symbol => symbol.name));
  for (const section of object.sections) {
    if (!names.has(section.name)) throw new Error(`invalid section '${section.name}'`);
    if (!Number.isInteger(section.size) || section.size < 0 || !Number.isInteger(section.alignment) || section.alignment <= 0) throw new Error('invalid section size/alignment');
  }
  for (const relocation of object.relocations) {
    if (!names.has(relocation.section) || !symbols.has(relocation.symbol) || !Number.isInteger(relocation.offset) || relocation.offset < 0) throw new Error('invalid relocation');
  }
}

export function serializeObject(object: Merc32Object): string { validateObject(object); return JSON.stringify(object, null, 2); }
export function deserializeObject(text: string): Merc32Object { const object = JSON.parse(text) as Merc32Object; validateObject(object); return object; }
