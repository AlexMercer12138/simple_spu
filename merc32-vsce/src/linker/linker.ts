import { readFileSync } from 'fs';
import { Merc32Object } from './objectFormat';
import { deserializeObject, validateObject } from './objectJson';
import { applyRelocations } from './relocations';
import { LinkedSection } from './relocations';
import { LayoutOptions, layoutSections, LinkerError, resolveSymbols } from './resolver';
import { assembleToObject } from './assembleObject';
import { relaxObjects } from './relaxation';
import { collectFunctions } from './functionGc';

export interface LinkOptions extends LayoutOptions {
  readonly entrySymbol?: string;
  readonly gcFunctions?: boolean;
  readonly keepSymbols?: readonly string[];
}
export interface LinkedImage {
  readonly assembly: string;
  readonly machineCodes?: readonly number[];
  readonly sections: readonly LinkedSection[];
  readonly symbols: ReadonlyMap<string, number>;
  readonly entryAddress?: number;
}

export function linkObjects(objects: readonly Merc32Object[], options: LinkOptions = {}): LinkedImage {
  objects.forEach(validateObject);
  objects = withGlobalInitialization(objects);
  if (options.gcFunctions) objects = collectFunctions(objects, options.entrySymbol, options.keepSymbols);
  resolveSymbols(objects);
  objects = relaxObjects(objects, options);
  const layout = layoutSections(objects, options);
  const linked = applyRelocations(layout);
  const textSections = linked.sections.filter(section => section.name === 'text');
  const encodable = objects.every(object => object.sections
    .filter(section => section.name === 'text')
    .every(section => Array.isArray(section.content)));
  let machineCodes: number[] | undefined;
  if (encodable && textSections.length > 0) {
    machineCodes = [];
    let address = textSections[0].address;
    for (const section of textSections) {
      while (address < section.address) {
        machineCodes.push(0);
        address += 4;
      }
      for (const word of section.content) machineCodes.push(word >>> 0);
      address += section.content.length * 4;
    }
  }
  const entryAddress = options.entrySymbol === undefined ? undefined : layout.symbols.get(options.entrySymbol);
  if (options.entrySymbol !== undefined && entryAddress === undefined) {
    throw new LinkerError(`entry symbol '${options.entrySymbol}' not found`, options.entrySymbol);
  }
  return {
    assembly: linked.assembly,
    ...(machineCodes ? { machineCodes } : {}),
    sections: linked.sections,
    symbols: layout.symbols,
    ...(entryAddress !== undefined ? { entryAddress } : {}),
  };
}

function withGlobalInitialization(objects: readonly Merc32Object[]): readonly Merc32Object[] {
  const entry = '__merc32_init_globals';
  if (!objects.some(object => object.relocations.some(relocation => relocation.symbol === entry)
      && !object.symbols.some(symbol => symbol.name === entry && symbol.defined && symbol.binding === 'local'))
      || objects.some(object => object.symbols.some(symbol => symbol.name === entry && symbol.defined && symbol.binding === 'global'))) return objects;
  const occupied = new Set(objects.flatMap(object => object.symbols.map(symbol => symbol.name)));
  const calls: string[] = [];
  const prepared = objects.map((object, index) => {
    const initializer = object.symbols.find(symbol => symbol.name === entry && symbol.defined && symbol.binding === 'local');
    if (!initializer) return object;
    let alias = `__merc32_object_init_${index}`;
    while (occupied.has(alias)) alias += '_';
    occupied.add(alias);
    calls.push(`jmp ${alias}, r14`);
    return { ...object, symbols: [...object.symbols, { ...initializer, name: alias, binding: 'global' as const }] };
  });
  if (calls.length === 0) return objects;
  const dispatcher = assembleToObject(`${entry}:\nmov r13, r13 - 4\nsw [r13], r14\n${calls.join('\n')}\nlw r14, [r13]\nmov r13, r13 + 4\njmp r14\n`,
    { abi: objects[0].abi, exports: [entry] });
  return [...prepared, { ...dispatcher, relocations: dispatcher.relocations.map(relocation =>
    relocation.kind === 'CALL16' ? { ...relocation, relaxationRegister: 8 } : relocation) }];
}

export function linkFiles(files: readonly string[], options?: LinkOptions): LinkedImage {
  return linkObjects(files.map(file => deserializeObject(readFileSync(file, 'utf8'))), options);
}
