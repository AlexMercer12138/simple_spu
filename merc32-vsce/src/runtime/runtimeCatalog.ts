import * as fs from 'fs';
import * as path from 'path';
import { Merc32Object } from '../linker/objectFormat';

export interface RuntimeOptions { readonly root?: string; }
export function loadRuntimeObjects(options: RuntimeOptions = {}): Merc32Object[] {
  const root = options.root ?? path.resolve(__dirname, '../../../runtime/merc32');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.manifest.json'), 'utf8')) as { objects: string[]; abi: string };
  return manifest.objects.map(file => ({ version: 1, target: 'merc32', abi: manifest.abi, sections: [{ name: 'text', alignment: 4, size: fs.readFileSync(path.join(root, file), 'utf8').length, content: fs.readFileSync(path.join(root, file), 'utf8') }], symbols: [], relocations: [] }));
}
