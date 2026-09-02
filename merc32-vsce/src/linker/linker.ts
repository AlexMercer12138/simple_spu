import { Merc32Object } from './objectFormat';
import { validateObject } from './objectJson';
import { layoutSections, resolveSymbols } from './resolver';

export interface LinkedImage { readonly assembly: string; readonly symbols: ReadonlyMap<string, number>; }

export function linkObjects(objects: readonly Merc32Object[]): LinkedImage {
  objects.forEach(validateObject);
  resolveSymbols(objects);
  const layout = layoutSections(objects);
  const chunks: string[] = [];
  for (const object of objects) for (const section of object.sections) if (section.name === 'text' && typeof section.content === 'string') chunks.push(section.content);
  return { assembly: chunks.join('\n'), symbols: layout.symbols };
}

export function linkFiles(objects: readonly Merc32Object[]): LinkedImage { return linkObjects(objects); }
