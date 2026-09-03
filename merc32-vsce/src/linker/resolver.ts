import { DebugLocation, Merc32Object, ObjectSection, ObjectSectionName, ObjectSymbol } from './objectFormat';
import { validateObject } from './objectJson';

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
const maxAddress = 0xffffffff;
const addressSpaceSize = 0x100000000;

function align(address: number, alignment: number): number {
  const remainder = address % alignment;
  return remainder === 0 ? address : address + alignment - remainder;
}

function isAddress(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= maxAddress;
}

function sectionsFor(object: Merc32Object): ReadonlyMap<ObjectSectionName, ObjectSection> {
  const sections = new Map<ObjectSectionName, ObjectSection>();
  for (const section of object.sections) {
    sections.set(section.name, section);
  }
  return sections;
}

function validationError(object: Merc32Object, objectIndex: number, error: unknown): LinkerError {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (Array.isArray(object.sections) && Array.isArray(object.symbols)) {
      const sections = new Map(object.sections.map(section => [section.name, section]));
      const symbol = object.symbols.find(candidate => candidate.defined &&
        (!candidate.section || !sections.has(candidate.section) || !Number.isInteger(candidate.offset) ||
         candidate.offset! < 0 || candidate.offset! > sections.get(candidate.section)!.size));
      if (symbol) {
        return new LinkerError(`symbol '${symbol.name}' offset outside section`, symbol.name, objectIndex, symbol.section, symbol.offset);
      }
      if (Array.isArray(object.relocations)) {
        const relocation = object.relocations.find(candidate => {
          const section = sections.get(candidate.section);
          const width = candidate.kind === 'ABS32' || candidate.section === 'text' ? 4 : 2;
          return !section || !Number.isInteger(candidate.offset) || candidate.offset < 0 || candidate.offset + width > section.size;
        });
        if (relocation) {
          return new LinkerError(`relocation '${relocation.symbol}' offset outside section`, relocation.symbol, objectIndex, relocation.section, relocation.offset, relocation.debug);
        }
      }
    }
  } catch {
    // The original validation error is the only reliable diagnostic for malformed table shapes.
  }
  return new LinkerError(message, undefined, objectIndex);
}

function validateObjects(objects: readonly Merc32Object[]): readonly ReadonlyMap<ObjectSectionName, ObjectSection>[] {
  const objectSections: ReadonlyMap<ObjectSectionName, ObjectSection>[] = [];
  const abi = objects[0]?.abi;
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    const object = objects[objectIndex];
    if (!object) throw new LinkerError('invalid MERC32 object', undefined, objectIndex);
    if (object.version !== 1) throw new LinkerError('version mismatch', undefined, objectIndex);
    if (object.target !== 'merc32') throw new LinkerError('target mismatch', undefined, objectIndex);
    if (typeof object.abi !== 'string' || object.abi !== abi) throw new LinkerError('abi mismatch', undefined, objectIndex);
    try {
      validateObject(object);
    } catch (error) {
      throw validationError(object, objectIndex, error);
    }
    objectSections.push(sectionsFor(object));
  }
  return objectSections;
}

function localDefinition(object: Merc32Object, name: string): ObjectSymbol | undefined {
  return object.symbols.find(symbol => symbol.name === name && symbol.binding === 'local' && symbol.defined);
}

function resolveValidatedSymbols(objects: readonly Merc32Object[]): ResolvedSymbolTable {
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

export function resolveSymbols(objects: readonly Merc32Object[]): ResolvedSymbolTable {
  validateObjects(objects);
  return resolveValidatedSymbols(objects);
}

export interface LayoutResult {
  readonly sections: ReadonlyMap<string, number>;
  readonly symbols: ReadonlyMap<string, number>;
  readonly objects?: readonly Merc32Object[];
}

export interface LayoutOptions { readonly textBase?: number; readonly dataBase?: number; }

export function layoutSections(objects: readonly Merc32Object[], options: LayoutOptions = {}): LayoutResult {
  const objectSections = validateObjects(objects);
  const resolved = resolveValidatedSymbols(objects);
  const textBase = options.textBase ?? 0;
  if (!isAddress(textBase) || (options.dataBase !== undefined && !isAddress(options.dataBase))) {
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
      if (!isAddress(base)) {
        throw new LinkerError('section layout exceeds 32-bit address space', undefined, objectIndex, category, base);
      }
      const end = base + section.size;
      if (!Number.isSafeInteger(end) || end > addressSpaceSize) {
        throw new LinkerError('section layout exceeds 32-bit address space', undefined, objectIndex, category, base);
      }
      if (section.size > 0 && occupied.some(range => base < range.end && range.start < end)) {
        throw new LinkerError('section layout overlap', undefined, objectIndex, category, base);
      }
      sections.set(`${category}:${sections.size}`, base);
      sectionAddresses.set(`${objectIndex}:${category}`, base);
      if (section.size > 0) occupied.push({ start: base, end });
      cursor = end;
    }
    if (category === 'data') dataCursor = cursor;
  }

  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    for (const symbol of objects[objectIndex].symbols) {
      if (!symbol.defined) continue;
      const address = sectionAddresses.get(`${objectIndex}:${symbol.section!}`)! + symbol.offset!;
      if (!isAddress(address)) {
        throw new LinkerError(`symbol '${symbol.name}' address outside 32-bit address space`, symbol.name, objectIndex, symbol.section, symbol.offset);
      }
    }
  }

  const symbols = new Map<string, number>();
  for (const [name, definition] of resolved) {
    const section = definition.symbol.section!;
    const base = sectionAddresses.get(`${definition.objectIndex}:${section}`)!;
    symbols.set(name, base + definition.symbol.offset!);
  }
  return { sections, symbols, objects };
}
