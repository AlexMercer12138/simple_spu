import { DebugLocation, Merc32Object, ObjectSection, ObjectSectionName, ObjectSymbol, Relocation } from './objectFormat';

export class LinkerError extends Error {
  constructor(
    message: string,
    readonly symbol?: string,
    readonly objectIndex?: number,
    readonly section?: ObjectSectionName,
    readonly offset?: number,
    readonly debug?: DebugLocation,
  ) {
    super(message);
    this.name = 'LinkerError';
  }
}

export interface ResolvedSymbol { readonly symbol: ObjectSymbol; readonly objectIndex: number; }
export type ResolvedSymbolTable = ReadonlyMap<string, ResolvedSymbol>;

const sectionOrder: readonly ObjectSectionName[] = ['text', 'rodata', 'data', 'bss'];

function align(address: number, alignment: number): number {
  return Math.ceil(address / alignment) * alignment;
}

function relocationWidth(relocation: Relocation): number {
  return relocation.kind === 'ABS32' || relocation.section === 'text' ? 4 : 2;
}

function sectionsFor(object: Merc32Object, objectIndex: number): ReadonlyMap<ObjectSectionName, ObjectSection> {
  const sections = new Map<ObjectSectionName, ObjectSection>();
  for (const section of object.sections) {
    if (!sectionOrder.includes(section.name) || sections.has(section.name)) {
      throw new LinkerError(`invalid section '${section.name}'`, undefined, objectIndex, section.name);
    }
    if (!Number.isInteger(section.size) || section.size < 0 || !Number.isInteger(section.alignment) ||
        section.alignment <= 0 || (section.alignment & (section.alignment - 1)) !== 0) {
      throw new LinkerError(`invalid section '${section.name}'`, undefined, objectIndex, section.name);
    }
    sections.set(section.name, section);
  }
  return sections;
}

function validateHeadersAndBounds(objects: readonly Merc32Object[]): readonly ReadonlyMap<ObjectSectionName, ObjectSection>[] {
  const objectSections: ReadonlyMap<ObjectSectionName, ObjectSection>[] = [];
  const abi = objects[0]?.abi;
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    const object = objects[objectIndex];
    if (object.version !== 1) throw new LinkerError('version mismatch', undefined, objectIndex);
    if (object.target !== 'merc32') throw new LinkerError('target mismatch', undefined, objectIndex);
    if (typeof object.abi !== 'string' || object.abi !== abi) throw new LinkerError('abi mismatch', undefined, objectIndex);

    const sections = sectionsFor(object, objectIndex);
    objectSections.push(sections);
    for (const symbol of object.symbols) {
      if (!symbol.defined) continue;
      const section = symbol.section === undefined ? undefined : sections.get(symbol.section);
      if (!section || !Number.isInteger(symbol.offset) || symbol.offset! < 0 || symbol.offset! > section.size) {
        throw new LinkerError(`symbol '${symbol.name}' offset outside section`, symbol.name, objectIndex, symbol.section, symbol.offset);
      }
    }
    for (const relocation of object.relocations) {
      const section = sections.get(relocation.section);
      if (!section || !Number.isInteger(relocation.offset) || relocation.offset < 0 || relocation.offset + relocationWidth(relocation) > section.size) {
        throw new LinkerError(`relocation '${relocation.symbol}' offset outside section`, relocation.symbol, objectIndex, relocation.section, relocation.offset, relocation.debug);
      }
    }
  }
  return objectSections;
}

function localDefinition(object: Merc32Object, name: string): ObjectSymbol | undefined {
  return object.symbols.find(symbol => symbol.name === name && symbol.binding === 'local' && symbol.defined);
}

export function resolveSymbols(objects: readonly Merc32Object[]): ResolvedSymbolTable {
  validateHeadersAndBounds(objects);
  const table = new Map<string, ResolvedSymbol>();
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    for (const symbol of objects[objectIndex].symbols) {
      if (!symbol.defined || symbol.binding !== 'global') continue;
      if (table.has(symbol.name)) throw new LinkerError(`duplicate symbol '${symbol.name}'`, symbol.name, objectIndex, symbol.section, symbol.offset);
      table.set(symbol.name, { symbol, objectIndex });
    }
  }
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    const object = objects[objectIndex];
    for (const relocation of object.relocations) {
      if (!localDefinition(object, relocation.symbol) && !table.has(relocation.symbol)) {
        throw new LinkerError(`unresolved symbol '${relocation.symbol}'`, relocation.symbol, objectIndex, relocation.section, relocation.offset, relocation.debug);
      }
    }
  }
  return table;
}

export interface LayoutResult {
  readonly sections: ReadonlyMap<string, number>;
  readonly symbols: ReadonlyMap<string, number>;
  readonly objects?: readonly Merc32Object[];
}

export interface LayoutOptions { readonly textBase?: number; readonly dataBase?: number; }

export function layoutSections(objects: readonly Merc32Object[], options: LayoutOptions = {}): LayoutResult {
  const objectSections = validateHeadersAndBounds(objects);
  const resolved = resolveSymbols(objects);
  const textBase = options.textBase ?? 0;
  if (!Number.isInteger(textBase) || textBase < 0 || (options.dataBase !== undefined && (!Number.isInteger(options.dataBase) || options.dataBase < 0))) {
    throw new LinkerError('invalid section base');
  }

  const sections = new Map<string, number>();
  const sectionAddresses = new Map<string, number>();
  const occupied: Array<{ readonly start: number; readonly end: number }> = [];
  let cursor = textBase;
  let dataCursor: number | undefined;
  for (const category of sectionOrder) {
    if (category === 'data') {
      cursor = options.dataBase ?? cursor;
      dataCursor = cursor;
    } else if (category === 'bss') {
      cursor = dataCursor ?? cursor;
    }
    for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
      const section = objectSections[objectIndex].get(category);
      if (!section) continue;
      const base = align(cursor, section.alignment);
      if (section.size > 0 && occupied.some(range => base < range.end && range.start < base + section.size)) {
        throw new LinkerError('section layout overlap', undefined, objectIndex, category, base);
      }
      sections.set(`${category}:${sections.size}`, base);
      sectionAddresses.set(`${objectIndex}:${category}`, base);
      if (section.size > 0) occupied.push({ start: base, end: base + section.size });
      cursor = base + section.size;
    }
    if (category === 'data') dataCursor = cursor;
  }

  const symbols = new Map<string, number>();
  for (const [name, definition] of resolved) {
    const section = definition.symbol.section!;
    const base = sectionAddresses.get(`${definition.objectIndex}:${section}`)!;
    symbols.set(name, base + definition.symbol.offset!);
  }
  return { sections, symbols, objects };
}
