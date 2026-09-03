const assert = require('assert');
const { assembleToObject, linkObjects } = require('../out/linker');
const image = linkObjects([
  assembleToObject('main:\n  jmp helper, r14\n', { exports: ['main'] }),
  assembleToObject('helper:\n  jmp r14\n', { exports: ['helper'] }),
], { entrySymbol: 'main' });
assert(image.assembly.includes('main:'));
assert.strictEqual(image.symbols.get('helper'), 4);
assert.strictEqual(image.entryAddress, 0);
assert.match(image.assembly, /jmp 0x4, r14/);
console.log('linker integration tests passed');
