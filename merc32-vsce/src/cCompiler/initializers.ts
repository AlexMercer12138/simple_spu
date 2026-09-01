import { CType, typeSize, structLayout, unionLayout } from './types';
import { Initializer } from './declarations';

export interface NormalizedInitializer {
  readonly size: number;
  readonly bytes: Uint8Array;
  readonly entries: ReadonlyMap<string, number>;
}

export function lowerInitializer(type: CType, initializer: Initializer): NormalizedInitializer {
  const size = typeSize(type);
  const bytes = new Uint8Array(size);
  const entries = new Map<string, number>();
  const tokens = initializer.tokens;
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (tokens[i] === '.' && type.kind === 'struct') {
      const field = tokens[i + 1];
      const value = Number(tokens[i + 3]);
      if (Number.isFinite(value)) {
        const layout = structLayout(type.fields).fields.find(item => item.name === field);
        if (layout) {
          entries.set(field, value);
          new DataView(bytes.buffer).setInt32(layout.offset, value, true);
        }
      }
    }
  }
  if (type.kind === 'union' && tokens.length >= 4 && tokens[1] === '=') {
    const value = Number(tokens[2]);
    if (Number.isFinite(value)) new DataView(bytes.buffer).setInt32(0, value, true);
    unionLayout(type.fields);
  }
  return { size, bytes, entries };
}
