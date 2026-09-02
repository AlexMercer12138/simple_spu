const assert = require('assert');
const { lowerFloatOperation } = require('../out/cCompiler/lower');
const operation = lowerFloatOperation('add', 'double');
assert.strictEqual(operation.args[0], '__adddf3');
assert.strictEqual(operation.args.length, 1);
console.log('runtime float64 ABI tests passed');
