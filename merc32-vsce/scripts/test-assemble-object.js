const assert = require('assert');
const { assembleToObject } = require('../out/linker');
const object = assembleToObject('main:\n  jmp external, r14\n');
assert(object.symbols.some(symbol => symbol.name === 'external' && !symbol.defined));
assert.strictEqual(object.relocations[0].symbol, 'external');
console.log('assemble object tests passed');
