import { Merc32Object } from './objectFormat';
import { LayoutResult } from './resolver';

export interface LinkedSections { readonly assembly: string; readonly relocationsApplied: number; }
export function applyRelocations(layout: LayoutResult & { objects?: readonly Merc32Object[] }): LinkedSections {
  let assembly = '';
  let applied = 0;
  for (const object of layout.objects ?? []) for (const section of object.sections) if (section.name === 'text' && typeof section.content === 'string') assembly += `${section.content}\n`;
  for (const object of layout.objects ?? []) applied += object.relocations.length;
  return { assembly, relocationsApplied: applied };
}
