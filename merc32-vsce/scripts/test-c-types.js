const assert = require('assert');
const { builtinType, pointerType, arrayType, structLayout, typeSize, typeAlignment, isIntegerType, isScalarType, isCompleteType } = require('../out/cCompiler/types');

assert.strictEqual(typeSize(builtinType('int')), 4);
assert.strictEqual(typeSize(builtinType('unsigned int')), 4);
assert.strictEqual(typeSize(builtinType('float')), 4);
assert.strictEqual(pointerType(builtinType('char')).kind, 'pointer');
assert.strictEqual(typeSize(pointerType(builtinType('char'))), 4);
assert.strictEqual(typeSize(arrayType(builtinType('short'), 3)), 6);
const layout = structLayout([{ name: 'a', type: builtinType('char') }, { name: 'b', type: builtinType('int') }]);
assert.strictEqual(layout.size, 8);
assert.strictEqual(layout.alignment, 4);
assert.strictEqual(typeAlignment(builtinType('int')), 4);
assert.ok(isIntegerType(builtinType('int')));
assert.ok(isScalarType(pointerType(builtinType('char'))));
assert.ok(!isCompleteType(builtinType('void')));
console.log('C type model tests passed');
