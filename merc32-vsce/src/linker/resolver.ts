import { Merc32Object, ObjectSymbol } from './objectFormat';

export class LinkerError extends Error { constructor(message: string, readonly symbol?: string) { super(message); } }
export interface ResolvedSymbol { readonly symbol: ObjectSymbol; readonly objectIndex: number; }
export type ResolvedSymbolTable = ReadonlyMap<string, ResolvedSymbol>;

export function resolveSymbols(objects: readonly Merc32Object[]): ResolvedSymbolTable {
  const table = new Map<string, ResolvedSymbol>();
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    for (const symbol of objects[objectIndex].symbols) {
      if (!symbol.defined) continue;
      if (symbol.binding === 'global' && table.has(symbol.name)) throw new LinkerError(`duplicate symbol '${symbol.name}'`, symbol.name);
      if (symbol.binding === 'global') table.set(symbol.name, { symbol, objectIndex });
    }
  }
  for (const object of objects) for (const relocation of object.relocations) if (!table.has(relocation.symbol) && !objects.some(item => item.symbols.some(symbol => symbol.name === relocation.symbol && !symbol.defined))) throw new LinkerError(`unresolved symbol '${relocation.symbol}'`, relocation.symbol);
  return table;
}

export interface LayoutResult { readonly sections: ReadonlyMap<string, number>; readonly symbols: ReadonlyMap<string, number>; readonly objects?: readonly Merc32Object[]; }
export function layoutSections(objects: readonly Merc32Object[], options: { dataBase?: number } = {}): LayoutResult {
  const sectionBases = new Map<string, number>();
  const symbols = new Map<string, number>();
  let text = 0;
  const dataBase = options.dataBase ?? 0;
  for (const object of objects) {
    for (const section of object.sections) {
      const base = section.name === 'text' ? text : dataBase;
      if (section.name === 'text') text += section.size;
      sectionBases.set(`${section.name}:${sectionBases.size}`, base);
      for (const symbol of object.symbols) if (symbol.defined && symbol.section === section.name) symbols.set(symbol.name, base + (symbol.offset ?? 0));
    }
  }
  return { sections: sectionBases, symbols, objects };
}
