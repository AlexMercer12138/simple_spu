import { normalizeSectionContent, ObjectSectionName, Relocation } from './objectFormat';
import { LayoutResult, LinkerError } from './resolver';

export interface LinkedSection {
  readonly objectIndex: number;
  readonly name: ObjectSectionName;
  readonly address: number;
  readonly content: readonly number[];
}

export interface LinkedSections {
  readonly assembly: string;
  readonly sections: readonly LinkedSection[];
  readonly relocationsApplied: number;
}

const sectionOrder: readonly ObjectSectionName[] = ['text', 'rodata', 'data', 'bss'];
type SourceReplacement = { readonly symbol: string; readonly value: number };

function formatImmediate(value: number): string {
  return `0x${value.toString(16)}`;
}

function relocationError(message: string, relocation: Relocation, objectIndex: number): LinkerError {
  return new LinkerError(message, relocation.symbol, objectIndex, relocation.section, relocation.offset, relocation.debug);
}

function write16(content: number[], section: ObjectSectionName, offset: number, value: number): void {
  const index = section === 'text' ? offset / 4 : offset;
  if (section === 'text') content[index] = ((value << 16) | (content[index] & 0xffff)) >>> 0;
  else {
    content[index] = value & 0xff;
    content[index + 1] = (value >>> 8) & 0xff;
  }
}

function patchControlFlow(
  content: number[],
  relocation: Relocation,
  objectIndex: number,
  value: number,
): void {
  const index = relocation.offset / 4;
  if (((content[index] >>> 12) & 0xf) !== 0) {
    throw relocationError(`${relocation.kind} relocation '${relocation.symbol}' requires r0 base`, relocation, objectIndex);
  }
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
    throw relocationError(`${relocation.kind} relocation '${relocation.symbol}' target out of range: ${value}`, relocation, objectIndex);
  }
  if ((value & 0x3) !== 0) {
    throw relocationError(`${relocation.kind} relocation '${relocation.symbol}' target is not 4-byte aligned: ${value}`, relocation, objectIndex);
  }
  write16(content, relocation.section, relocation.offset, value);
}

function patchSource(source: string, replacements: ReadonlyMap<number, readonly SourceReplacement[]>): string {
  let instructionOffset = 0;
  return source.split(/\r?\n/).map(line => {
    const uncommented = line.replace(/\/\/.*$/, '').trim();
    const code = uncommented.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*[:\uff1a]\s*/, '').trim();
    if (!code || code.startsWith('.')) return line;
    let patched = line;
    for (const replacement of replacements.get(instructionOffset) ?? []) {
      const escaped = replacement.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      patched = patched.replace(new RegExp(`\\b${escaped}\\b`), formatImmediate(replacement.value));
    }
    instructionOffset += 4;
    return patched;
  }).join('\n');
}

export function applyRelocations(layout: LayoutResult): LinkedSections {
  const objects = layout.objects ?? [];
  const layoutEntries = Array.from(layout.sections.entries());
  const sections: Array<{ objectIndex: number; name: ObjectSectionName; address: number; content: number[] }> = [];
  let layoutIndex = 0;
  for (const name of sectionOrder) {
    for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
      const section = objects[objectIndex].sections.find(candidate => candidate.name === name);
      if (!section) continue;
      const entry = layoutEntries[layoutIndex++];
      if (!entry || !entry[0].startsWith(`${name}:`)) throw new LinkerError('invalid section layout', undefined, objectIndex, name);
      sections.push({ objectIndex, name, address: entry[1], content: [...normalizeSectionContent(section)] });
    }
  }

  let relocationsApplied = 0;
  const sourceReplacements = new Map<number, Map<number, SourceReplacement[]>>();
  for (let objectIndex = 0; objectIndex < objects.length; objectIndex++) {
    const object = objects[objectIndex];
    for (const relocation of object.relocations) {
      const linked = sections.find(section => section.objectIndex === objectIndex && section.name === relocation.section)!;
      const local = object.symbols.find(symbol => symbol.name === relocation.symbol && symbol.binding === 'local' && symbol.defined);
      const targetSection = local && sections.find(section => section.objectIndex === objectIndex && section.name === local.section);
      const symbolAddress = local ? targetSection!.address + local.offset! : layout.symbols.get(relocation.symbol);
      if (symbolAddress === undefined) throw relocationError(`unresolved symbol '${relocation.symbol}'`, relocation, objectIndex);
      const value = symbolAddress + relocation.addend;
      if (['ABS32', 'HI16', 'LO16'].includes(relocation.kind) &&
          (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff)) {
        throw relocationError(`${relocation.kind} relocation '${relocation.symbol}' value out of range: ${value}`, relocation, objectIndex);
      }
      if (relocation.kind === 'ABS32') {
        if (relocation.section === 'text') linked.content[relocation.offset / 4] = value >>> 0;
        else for (let byte = 0; byte < 4; byte++) linked.content[relocation.offset + byte] = (value >>> (byte * 8)) & 0xff;
      } else if (relocation.kind === 'HI16') {
        write16(linked.content, relocation.section, relocation.offset, value >>> 16);
      } else if (relocation.kind === 'LO16') {
        write16(linked.content, relocation.section, relocation.offset, value & 0xffff);
      } else if (relocation.kind === 'IMM16') {
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff) {
          throw relocationError(`IMM16 relocation '${relocation.symbol}' value out of range: ${value}`, relocation, objectIndex);
        }
        write16(linked.content, relocation.section, relocation.offset, value);
      } else {
        patchControlFlow(linked.content, relocation, objectIndex, value);
      }
      if (relocation.section === 'text') {
        const objectReplacements = sourceReplacements.get(objectIndex) ?? new Map<number, SourceReplacement[]>();
        const atOffset = objectReplacements.get(relocation.offset) ?? [];
        const fieldValue = relocation.kind === 'HI16' ? value >>> 16 : relocation.kind === 'LO16' ? value & 0xffff : value;
        atOffset.push({ symbol: relocation.symbol, value: fieldValue });
        objectReplacements.set(relocation.offset, atOffset);
        sourceReplacements.set(objectIndex, objectReplacements);
      }
      relocationsApplied++;
    }
  }

  const assembly = objects.flatMap((object, objectIndex) => {
      const section = object.sections.find(candidate => candidate.name === 'text');
      if (!section) return [];
      const source = section.source ?? (typeof section.content === 'string' ? section.content : '');
      return [patchSource(source, sourceReplacements.get(objectIndex) ?? new Map())];
    })
    .filter(Boolean)
    .join('\n');
  return { assembly, sections, relocationsApplied };
}
