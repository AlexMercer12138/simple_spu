import { Merc32Object, ObjectSymbol, Relocation } from './objectFormat';
import { LinkerError, ResolvedSymbol, resolveDefinitions } from './resolver';
import { maskAssemblyComments } from './sourceText';

interface FunctionNode {
  readonly objectIndex: number;
  readonly offset: number;
  readonly size: number;
  readonly relocations: Relocation[];
  live: boolean;
}

/** Only producers declaring complete function boundaries opt into text removal. */
export function collectFunctions(objects: readonly Merc32Object[], entrySymbol?: string,
    keepSymbols: readonly string[] = []): readonly Merc32Object[] {
  if (!entrySymbol) throw new LinkerError('function GC requires an entry symbol');
  const definitions = resolveDefinitions(objects);
  const locals = objects.map((object, objectIndex) => {
    const result = new Map<string, ResolvedSymbol>();
    for (const symbol of object.symbols) {
      if (symbol.defined && symbol.binding === 'local' && !result.has(symbol.name)) {
        result.set(symbol.name, { symbol, objectIndex });
      }
    }
    return result;
  });
  const resolve = (index: number, name: string) => locals[index].get(name) ?? definitions.get(name);
  const nodes = objects.map((object, objectIndex): FunctionNode[] => {
    const size = object.sections.find(section => section.name === 'text')?.size ?? 0;
    const ranges = object.functions ?? (size ? [{ offset: 0, size }] : []);
    return ranges.map(range => ({ objectIndex, offset: range.offset, size: range.size, live: false, relocations: [] }));
  });
  const owner = (index: number, offset: number, allowEnd = false): FunctionNode | undefined => {
    const ranges = nodes[index];
    let low = 0, high = ranges.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (ranges[middle].offset <= offset) low = middle + 1;
      else high = middle;
    }
    const node = ranges[low - 1];
    return node && (offset < node.offset + node.size || allowEnd && low === ranges.length && offset === node.offset + node.size)
      ? node : undefined;
  };
  const queue: FunctionNode[] = [];
  const mark = (node?: FunctionNode) => {
    if (node && !node.live) { node.live = true; queue.push(node); }
  };
  const markSymbol = (resolved: ResolvedSymbol) => {
    if (resolved.symbol.section === 'text') mark(owner(resolved.objectIndex, resolved.symbol.offset!, true));
  };
  const follow = (index: number, relocation: Relocation) => {
    const target = resolve(index, relocation.symbol);
    // Missing references in live code are diagnosed by the normal resolver after collection.
    if (!target || target.symbol.section !== 'text') return;
    markSymbol(target);
    const destination = owner(target.objectIndex, target.symbol.offset! + relocation.addend, true);
    if (destination) mark(destination);
    else {
      // Cross-section numeric arithmetic cannot be remapped reliably; retain the original text layout.
      for (const ranges of nodes) for (const node of ranges) mark(node);
    }
  };

  for (const name of [entrySymbol, ...keepSymbols]) {
    const target = definitions.get(name);
    if (!target) throw new LinkerError(`function GC root '${name}' not found`, name);
    markSymbol(target);
  }
  objects.forEach((object, index) => {
    if (object.functions === undefined) nodes[index].forEach(mark);
    const label = object.sections.find(section => section.name === 'text')?.entryLabel;
    if (label) {
      const target = resolve(index, label);
      if (!target) throw new LinkerError(`function GC entry '${label}' not found`, label, index);
      markSymbol(target);
    }
    for (const relocation of object.relocations) {
      if (relocation.section === 'text') owner(index, relocation.offset)!.relocations.push(relocation);
      else follow(index, relocation);
    }
  });
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const node = queue[cursor];
    node.relocations.forEach(relocation => follow(node.objectIndex, relocation));
  }

  const removedBefore = nodes.map(ranges => {
    const offsets = new Map<FunctionNode, number>();
    let removed = 0;
    for (const node of ranges) {
      offsets.set(node, removed);
      if (!node.live) removed += node.size;
    }
    return { offsets, removed };
  });
  const moved = (index: number, offset: number): number => {
    const node = owner(index, offset);
    return offset - (node ? removedBefore[index].offsets.get(node)! : removedBefore[index].removed);
  };
  const kept = (index: number, offset: number, allowEnd = false) => owner(index, offset, allowEnd)?.live ?? false;
  const adjustedAddend = (index: number, relocation: Relocation) => {
    const target = resolve(index, relocation.symbol);
    if (!target || target.symbol.section !== 'text') return relocation.addend;
    const end = target.symbol.offset! + relocation.addend;
    return owner(target.objectIndex, end, true)
      ? moved(target.objectIndex, end) - moved(target.objectIndex, target.symbol.offset!) : relocation.addend;
  };
  return objects.map((object, index) => {
    const relocations = object.relocations
      .filter(relocation => relocation.section !== 'text' || kept(index, relocation.offset))
      .map(relocation => ({ ...relocation,
        offset: relocation.section === 'text' ? moved(index, relocation.offset) : relocation.offset,
        addend: adjustedAddend(index, relocation),
      }));
    const references = new Set(relocations.map(relocation => relocation.symbol));
    const symbols = object.symbols.filter(symbol => symbol.defined
      ? symbol.section !== 'text' || kept(index, symbol.offset!, true) : references.has(symbol.name))
      .map((symbol): ObjectSymbol => symbol.defined && symbol.section === 'text'
        ? { ...symbol, offset: moved(index, symbol.offset!) } : symbol);
    const trimSource = (source: string) => {
      let offset = 0;
      return maskAssemblyComments(source).filter(line => {
        const code = line.trim().replace(/^[A-Za-z_][A-Za-z0-9_]*\s*[:\uff1a]\s*/, '').trim();
        const instruction = code !== '' && !code.startsWith('.');
        const retain = kept(index, offset, !instruction);
        if (instruction) offset += 4;
        return retain;
      }).join('\n');
    };
    return { ...object, symbols, relocations,
      ...(object.functions === undefined ? {} : { functions: object.functions
        .filter(func => kept(index, func.offset)).map(func => ({ ...func, offset: moved(index, func.offset) })) }),
      sections: object.sections.map(section => {
        if (section.name !== 'text' || removedBefore[index].removed === 0) return section;
        return { ...section, size: section.size - removedBefore[index].removed,
          content: typeof section.content === 'string' ? trimSource(section.content)
            : section.content!.filter((_, word) => kept(index, word * 4)),
          ...(section.source === undefined ? {} : { source: trimSource(section.source) }),
        };
      }),
    };
  });
}
