const assert = require('assert');
const { lowerFloatOperation, lowerAggregateReturn } = require('../out/cCompiler/lower');
const { builtinType, structType } = require('../out/cCompiler/types');
const { generateObject } = require('../out/cCompiler/codegen');

const add = lowerFloatOperation('add', 'float');
assert.strictEqual(add.op, 'runtime-call');
assert.strictEqual(add.args[0], '__addsf3');
assert.strictEqual(lowerFloatOperation('mul', 'double').args[0], '__muldf3');
const result = lowerAggregateReturn(structType([{ name: 'x', type: builtinType('int') }]));
assert.strictEqual(result.hiddenParameter, 'sret');
const object = generateObject({ abi: 'merc32-c-v1', globals: [], functions: [{
  name: 'f', parameters: [], blocks: [{ label: 'f.entry', instructions: [add] }],
}] });
assert(object.relocations.some(relocation => relocation.symbol === '__addsf3'));
console.log('c advanced backend tests passed');
