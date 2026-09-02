const assert = require('assert');
const { bits, binary, value } = require('./float32Reference');
assert.strictEqual(value(binary('add', bits(1.5), bits(2.25))), 3.75);
assert.strictEqual(value(binary('mul', bits(-2), bits(4))), -8);
assert(Number.isNaN(value(binary('sub', bits(NaN), bits(1)))));
console.log('runtime float32 reference tests passed');
