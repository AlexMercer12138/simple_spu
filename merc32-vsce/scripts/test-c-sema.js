const assert = require('assert');
const {
  Scope,
  analyzeTranslationUnit,
  layoutAggregate,
} = require('../out/cCompiler/sema');
const {
  builtinType,
  structType,
  pointerType,
  arrayType,
  typedefType,
} = require('../out/cCompiler/types');
const { lowerInitializer } = require('../out/cCompiler/initializers');

const root = new Scope();
root.defineTypedef('T', builtinType('int'));
const child = root.child();
assert.strictEqual(child.resolveTypedef('T').name, 'int');
child.defineTypedef('T', builtinType('short'));
assert.strictEqual(child.resolveTypedef('T').name, 'short');
assert.strictEqual(root.resolveTypedef('T').name, 'int');

const record = structType([
  { name: 'c', type: builtinType('char') },
  { name: 'x', type: builtinType('int') },
]);
const layout = layoutAggregate(record);
assert.strictEqual(layout.size, 8);
assert.strictEqual(layout.fields[1].offset, 4);

const normalized = lowerInitializer(record, { kind: 'initializer', tokens: ['{', '.', 'x', '=', '3', '}'] });
assert.strictEqual(normalized.size, 8);
assert.strictEqual(normalized.bytes[0], 0);

const unit = { kind: 'translation-unit', declarations: [
  { kind: 'typedef', type: builtinType('int'), declarators: [{ name: 'T', type: typedefType('T', builtinType('int')) }] },
] };
const program = analyzeTranslationUnit(unit);
assert.strictEqual(program.typedefs.get('T').name, 'int');
console.log('c semantic tests passed');
