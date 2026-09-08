const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runIsolatedResourcePreparation } = require('./extension-resource-stage');
const { prepareResourcesAtRoots } = require('./prepare-resources');
const root = path.resolve(__dirname, '../../runtime/merc32');
const { assembleToObject, linkObjects } = require('../out/linker');
const { loadRuntimeObjects, loadMemoryRuntimeObject } = require('../out/runtime/runtimeCatalog');

for (const file of ['startup.asm','mem.asm','float32.asm','float64.asm','runtime.manifest.json','PROVENANCE.md']) assert(fs.existsSync(path.join(root, file)), file);

const manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.manifest.json'), 'utf8'));
const runtime = loadRuntimeObjects({ root });
assert.strictEqual(runtime.length, manifest.objects.length);
assert(runtime.every(object => object.abi === manifest.abi));
assert(runtime.every(object => {
  const text = object.sections.find(section => section.name === 'text');
  return text && text.size > 0 && text.size % 4 === 0 && text.content.length * 4 === text.size;
}));
for (const name of manifest.symbols) {
  const definitions = runtime.flatMap(object => object.symbols)
    .filter(symbol => symbol.name === name && symbol.binding === 'global' && symbol.defined);
  assert.strictEqual(definitions.length, 1, `${name} must have one defined global runtime export`);
}

const startup = runtime.find(object => object.symbols.some(symbol => symbol.name === 'startup' && symbol.defined));
assert(startup);
assert(startup.symbols.some(symbol => symbol.name === '__merc32_init_globals' && symbol.binding === 'global' && !symbol.defined));
assert(startup.symbols.some(symbol => symbol.name === 'main' && symbol.binding === 'global' && !symbol.defined));
assert(startup.relocations.some(relocation => relocation.symbol === '__merc32_init_globals' && relocation.kind === 'CALL16'));
assert(startup.relocations.some(relocation => relocation.symbol === 'main' && relocation.kind === 'CALL16'));
assert.strictEqual(startup.symbols.find(symbol => symbol.name === 'halt').binding, 'local');
assert(runtime.some(object => object.relocations.length > 0));
assert.throws(() => linkObjects(runtime), /unresolved symbol '__merc32_init_globals'/);
const globalsOnly = assembleToObject('__merc32_init_globals:\n  jmp r14\n', {
  abi: manifest.abi,
  exports: ['__merc32_init_globals'],
});
assert.throws(() => linkObjects([...runtime, globalsOnly]), /unresolved symbol 'main'/);
const userMain = assembleToObject('__merc32_init_globals:\n  jmp r14\nmain:\n  jmp r14\n', {
  abi: manifest.abi,
  exports: ['__merc32_init_globals', 'main'],
});
const image = linkObjects([...runtime, userMain], { entrySymbol: 'startup' });
assert.strictEqual(image.entryAddress, 0);
const runtimeTextSize = runtime.reduce((size, object) => size + object.sections.find(section => section.name === 'text').size, 0);
assert.strictEqual(image.symbols.get('__merc32_init_globals'), runtimeTextSize);
assert.strictEqual(image.symbols.get('main'), runtimeTextSize + 4);

function withRuntimeManifest(value, run) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-runtime-catalog-'));
  try {
    for (const file of ['startup.asm', 'mem.asm', 'float32.asm', 'float64.asm']) fs.copyFileSync(path.join(root, file), path.join(tempRoot, file));
    fs.writeFileSync(path.join(tempRoot, 'runtime.manifest.json'), JSON.stringify(value), 'utf8');
    run(tempRoot);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

withRuntimeManifest({ ...manifest, version: 2 }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /invalid runtime manifest version/);
});
withRuntimeManifest({ ...manifest, target: 'other-target' }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /invalid runtime manifest target/);
});
withRuntimeManifest({ ...manifest, abi: '' }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /invalid runtime manifest ABI/);
});
withRuntimeManifest({ ...manifest, symbols: manifest.symbols.slice(1) }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /runtime manifest symbols must match object exports/);
});
withRuntimeManifest({ ...manifest, symbols: [...manifest.symbols.slice(1), manifest.symbols[1]] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /runtime manifest symbols must match object exports/);
});
withRuntimeManifest({ ...manifest, symbols: [...manifest.symbols, 'extra'] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /runtime manifest symbols must match object exports/);
});
withRuntimeManifest({ ...manifest, objects: [{ file: '../outside.asm', exports: ['startup'] }], symbols: ['startup'] }, tempRoot => {
  assert.throws(
    () => loadRuntimeObjects({ root: tempRoot }),
    error => error instanceof Error && error.message === "invalid runtime object file '../outside.asm'",
  );
});
withRuntimeManifest({ ...manifest, objects: [{ file: 'missing.asm', exports: ['startup'] }], symbols: ['startup'] }, tempRoot => {
  assert.throws(
    () => loadRuntimeObjects({ root: tempRoot }),
    error => error instanceof Error && error.message === "invalid runtime object file 'missing.asm'",
  );
});
withRuntimeManifest({ ...manifest, objects: [{ file: 'directory.asm', exports: ['startup'] }], symbols: ['startup'] }, tempRoot => {
  fs.mkdirSync(path.join(tempRoot, 'directory.asm'));
  assert.throws(
    () => loadRuntimeObjects({ root: tempRoot }),
    error => error instanceof Error && error.message === "invalid runtime object file 'directory.asm'",
  );
});
withRuntimeManifest({ ...manifest, objects: [{ file: 'startup.txt', exports: ['startup'] }], symbols: ['startup'] }, tempRoot => {
  fs.copyFileSync(path.join(tempRoot, 'startup.asm'), path.join(tempRoot, 'startup.txt'));
  assert.throws(
    () => loadRuntimeObjects({ root: tempRoot }),
    error => error instanceof Error && error.message === "invalid runtime object file 'startup.txt'",
  );
});

withRuntimeManifest({ ...manifest, objects: [{ file: 'startup.asm', exports: ['missing'] }], symbols: ['missing'] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /runtime export 'missing' is not defined by 'startup.asm'/);
});
withRuntimeManifest({ ...manifest, objects: [{ file: 'startup.asm', exports: ['startup', 'startup'] }], symbols: ['startup'] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /duplicate runtime export 'startup'/);
});
withRuntimeManifest({ ...manifest, objects: [{ file: 'startup.asm' }], symbols: [] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /invalid runtime object exports for 'startup.asm'/);
});

assert.strictEqual(typeof loadMemoryRuntimeObject, 'function', 'memory-only runtime loader must be available');
withRuntimeManifest(manifest, tempRoot => {
  for (const file of ['startup.asm', 'float32.asm', 'float64.asm']) fs.unlinkSync(path.join(tempRoot, file));
  const memory = loadMemoryRuntimeObject({ root: tempRoot });
  assert.deepStrictEqual(memory.symbols.filter(symbol => symbol.binding === 'global' && symbol.defined)
    .map(symbol => symbol.name).sort(), ['memcmp', 'memcpy', 'memmove', 'memset', 'strcmp', 'strlen']);
  assert.strictEqual(memory.abi, 'merc32-c-v1');
});
withRuntimeManifest({ ...manifest, objects: manifest.objects.filter(entry => entry.file !== 'mem.asm'),
  symbols: manifest.symbols.filter(name => !manifest.objects.find(entry => entry.file === 'mem.asm').exports.includes(name)) }, tempRoot => {
  assert.throws(() => loadMemoryRuntimeObject({ root: tempRoot }), /memory runtime object/);
});

const extensionRoot = path.resolve(__dirname, '..');
runIsolatedResourcePreparation({
  extensionRoot,
  repositoryRoot: path.resolve(extensionRoot, '..'),
  prepareResourcesFn(options, stage) {
    const prepared = prepareResourcesAtRoots(options);
    fs.cpSync(path.join(extensionRoot, 'out'), path.join(stage.extensionRoot, 'out'), { recursive: true });
    const lock = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package-lock.json'), 'utf8'));
    for (const [logicalPath, metadata] of Object.entries(lock.packages)) {
      if (logicalPath.startsWith('node_modules/') && !metadata.dev) {
        fs.cpSync(path.join(extensionRoot, logicalPath), path.join(stage.extensionRoot, logicalPath), { recursive: true });
      }
    }
    fs.writeFileSync(path.join(stage.extensionRoot, 'main.c'),
      '#include <string.h>\nchar bytes[8];\nint main(void) { memset(bytes, 65, 3); bytes[3] = 0; return strlen(bytes); }\n');
    const child = spawnSync(process.execPath, ['-e', `
      const assert = require('node:assert/strict');
      const fs = require('node:fs');
      const path = require('node:path');
      const { loadMemoryRuntimeObject } = require('./out/runtime/runtimeCatalog');
      const { compileCFile } = require('./out/cCompiler');
      const { SimpleCPUAssembler } = require('./out/assembler');
      const memory = loadMemoryRuntimeObject();
      assert.ok(memory.symbols.some(symbol => symbol.name === 'memset' && symbol.defined));
      const result = compileCFile(path.resolve('main.c'));
      const binary = new SimpleCPUAssembler().assemble(result.assembly);
      assert.ok(binary.machineCodes.length > 0);
      fs.renameSync('resources/runtime/merc32', 'resources/runtime/removed');
      assert.throws(() => loadMemoryRuntimeObject(), /ENOENT/);
      fs.renameSync('resources/runtime/removed', 'resources/runtime/merc32');
    `], { cwd: stage.extensionRoot, encoding: 'utf8', timeout: 60000,
      env: { ...process.env, NODE_PATH: '' } });
    assert.strictEqual(child.status, 0, `isolated installed compiler failed:\n${child.stderr || child.stdout}`);
    return prepared;
  },
});

console.log('runtime packaging tests passed');
