import { readFileSync } from 'fs';
import { Merc32Object } from './objectFormat';
import { deserializeObject, validateObject } from './objectJson';
import { applyRelocations } from './relocations';
import { LinkedSection } from './relocations';
import { LayoutOptions, layoutSections, LinkerError, resolveSymbols } from './resolver';

export interface LinkOptions extends LayoutOptions { readonly entrySymbol?: string; }
export interface LinkedImage {
  readonly assembly: string;
  readonly machineCodes?: readonly number[];
  readonly sections: readonly LinkedSection[];
  readonly symbols: ReadonlyMap<string, number>;
  readonly entryAddress?: number;
}

export function linkObjects(objects: readonly Merc32Object[], options: LinkOptions = {}): LinkedImage {
  objects.forEach(validateObject);
  resolveSymbols(objects);
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
      machineCodes.push(...section.content.map(word => word >>> 0));
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

export function linkFiles(files: readonly string[], options?: LinkOptions): LinkedImage {
  return linkObjects(files.map(file => deserializeObject(readFileSync(file, 'utf8'))), options);
}
