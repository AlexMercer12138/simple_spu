const assert = require('assert');
const { loadRuntimeObjects } = require('../out/runtime/runtimeCatalog');
const objects = loadRuntimeObjects();
assert.strictEqual(objects.length, 4);
assert(objects.every(object => object.abi === 'merc32-c-v1'));
console.log('runtime startup tests passed');
