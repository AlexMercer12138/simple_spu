const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '../../runtime/merc32');
const { assembleToObject, linkObjects } = require('../out/linker');
const { loadRuntimeObjects } = require('../out/runtime/runtimeCatalog');

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
assert(startup.symbols.some(symbol => symbol.name === 'main' && symbol.binding === 'global' && !symbol.defined));
assert(startup.relocations.some(relocation => relocation.symbol === 'main' && relocation.kind === 'CALL16'));
assert.strictEqual(startup.symbols.find(symbol => symbol.name === 'halt').binding, 'local');
assert(runtime.some(object => object.relocations.length > 0));
assert.throws(() => linkObjects(runtime), /unresolved symbol 'main'/);
const userMain = assembleToObject('main:\n  jmp r14\n', { abi: manifest.abi, exports: ['main'] });
const image = linkObjects([...runtime, userMain], { entrySymbol: 'startup' });
assert.strictEqual(image.entryAddress, 0);
assert.strictEqual(image.symbols.get('main'), runtime.reduce((size, object) => size + object.sections.find(section => section.name === 'text').size, 0));

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

withRuntimeManifest({ abi: manifest.abi, objects: [{ file: 'startup.asm', exports: ['missing'] }], symbols: ['missing'] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /runtime export 'missing' is not defined by 'startup.asm'/);
});
withRuntimeManifest({ abi: manifest.abi, objects: [{ file: 'startup.asm', exports: ['startup', 'startup'] }], symbols: ['startup'] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /duplicate runtime export 'startup'/);
});
withRuntimeManifest({ abi: manifest.abi, objects: [{ file: 'startup.asm' }], symbols: [] }, tempRoot => {
  assert.throws(() => loadRuntimeObjects({ root: tempRoot }), /invalid runtime object exports for 'startup.asm'/);
});

console.log('runtime packaging tests passed');
