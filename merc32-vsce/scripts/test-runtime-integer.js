const assert = require('assert');
const { add64, sub64 } = require('./runtimeReference');
assert.deepStrictEqual(add64(0xffffffff, 0, 1, 0), { lo: 0, hi: 1 });
assert.deepStrictEqual(sub64(0, 1, 1, 0), { lo: 0xffffffff, hi: 0 });
console.log('runtime integer reference tests passed');
