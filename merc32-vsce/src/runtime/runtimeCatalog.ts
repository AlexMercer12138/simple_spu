import * as fs from 'fs';
import * as path from 'path';
import { assembleToObject } from '../linker/assembleObject';
import { Merc32Object } from '../linker/objectFormat';

export interface RuntimeOptions { readonly root?: string; }

interface RuntimeObjectManifest {
  readonly file: string;
  readonly exports: readonly string[];
}

interface RuntimeManifest {
  readonly version: 1;
  readonly target: 'merc32';
  readonly abi: string;
  readonly objects: readonly RuntimeObjectManifest[];
  readonly symbols: readonly string[];
}

export function getDefaultRuntimeObjects(options: RuntimeOptions = {}): Merc32Object[] { return loadRuntimeObjects(options); }
export function loadRuntimeObjects(options: RuntimeOptions = {}): Merc32Object[] {
  return loadSelectedRuntimeObjects(options);
}

export function loadMemoryRuntimeObject(options: RuntimeOptions = {}): Merc32Object {
  const objects = loadSelectedRuntimeObjects(options, 'mem.asm');
  if (objects.length !== 1) throw new Error('runtime manifest must contain exactly one memory runtime object');
  return objects[0];
}

function loadSelectedRuntimeObjects(options: RuntimeOptions, selectedFile?: string): Merc32Object[] {
  const root = options.root ?? path.resolve(__dirname, '../../resources/runtime/merc32');
  const manifest = readManifest(root);
  const exports = new Set<string>();
  for (const object of manifest.objects) {
    for (const name of object.exports) {
      if (exports.has(name)) throw new Error(`duplicate runtime export '${name}'`);
      exports.add(name);
    }
  }
  const manifestSymbols = new Set(manifest.symbols);
  if (manifest.symbols.length !== manifestSymbols.size || manifestSymbols.size !== exports.size
    || [...manifestSymbols].some(name => !exports.has(name))) {
    throw new Error('runtime manifest symbols must match object exports');
  }
  const entries = selectedFile === undefined ? manifest.objects
    : manifest.objects.filter(entry => entry.file === selectedFile);
  const objects = entries.map(entry => {
    const source = runtimeAssemblySource(runtimeObjectSource(root, entry.file));
    const object = assembleToObject(source, { abi: manifest.abi, exports: entry.exports });
    for (const name of entry.exports) {
      const definitions = object.symbols.filter(symbol => symbol.name === name && symbol.binding === 'global' && symbol.defined);
      if (definitions.length !== 1) throw new Error(`runtime export '${name}' is not defined by '${entry.file}'`);
    }
    // Memory routines have no live r8 value across their direct control-flow sites.
    const memoryFunctions = object.symbols.filter(symbol => symbol.defined && entry.exports.includes(symbol.name))
      .sort((left, right) => left.offset! - right.offset!);
    return entry.file !== 'mem.asm' ? object : { ...object,
      functions: memoryFunctions.map((symbol, index) => ({ name: symbol.name, offset: symbol.offset!,
        size: (memoryFunctions[index + 1]?.offset ?? object.sections[0].size) - symbol.offset!,
      })), relocations: object.relocations.map(relocation =>
      ['CALL16', 'BRANCH16'].includes(relocation.kind) ? { ...relocation, relaxationRegister: 8 } : relocation) };
  });
  for (const name of entries.flatMap(entry => entry.exports)) {
    const definitions = objects.flatMap(object => object.symbols)
      .filter(symbol => symbol.name === name && symbol.binding === 'global' && symbol.defined);
    if (definitions.length !== 1) throw new Error(`runtime export '${name}' must be defined exactly once`);
  }
  return objects;
}

function readManifest(root: string): RuntimeManifest {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.manifest.json'), 'utf8')) as {
    version?: unknown;
    target?: unknown;
    abi?: unknown;
    objects?: unknown;
    symbols?: unknown;
  };
  if (manifest.version !== 1) throw new Error('invalid runtime manifest version');
  if (manifest.target !== 'merc32') throw new Error('invalid runtime manifest target');
  if (typeof manifest.abi !== 'string' || manifest.abi.length === 0) throw new Error('invalid runtime manifest ABI');
  if (!Array.isArray(manifest.objects) || !Array.isArray(manifest.symbols)) {
    throw new Error('invalid runtime manifest');
  }
  for (const entry of manifest.objects) {
    if (!entry || typeof entry !== 'object' || !('file' in entry) || typeof entry.file !== 'string'
      || !('exports' in entry) || !Array.isArray(entry.exports) || entry.exports.some((name: unknown) => typeof name !== 'string')) {
      const file = entry && typeof entry === 'object' && 'file' in entry && typeof entry.file === 'string' ? entry.file : 'unknown';
      throw new Error(`invalid runtime object exports for '${file}'`);
    }
  }
  if (manifest.symbols.some((name: unknown) => typeof name !== 'string')) throw new Error('invalid runtime manifest symbols');
  return manifest as unknown as RuntimeManifest;
}

function runtimeAssemblySource(source: string): string {
  return source.split(/\r?\n/)
    .map(line => line.replace(/;.*/, ''))
    .filter(line => line.trim() !== '.text')
    .join('\n');
}

function runtimeObjectPath(root: string, file: string): string {
  if (path.extname(file) !== '.asm') throw new Error(`invalid runtime object file '${file}'`);
  const candidate = path.resolve(root, file);
  if (!isRuntimeChild(root, candidate)) {
    throw new Error(`invalid runtime object file '${file}'`);
  }
  return candidate;
}

function runtimeObjectSource(root: string, file: string): string {
  try {
    const canonicalRoot = fs.realpathSync(path.resolve(root));
    const canonicalFile = fs.realpathSync(runtimeObjectPath(canonicalRoot, file));
    if (!isRuntimeChild(canonicalRoot, canonicalFile) || !fs.statSync(canonicalFile).isFile()) {
      throw new Error(`invalid runtime object file '${file}'`);
    }
    return fs.readFileSync(canonicalFile, 'utf8');
  } catch {
    throw new Error(`invalid runtime object file '${file}'`);
  }
}

function isRuntimeChild(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
