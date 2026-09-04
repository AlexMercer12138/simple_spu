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

const normalized = lowerInitializer(record, {
  kind: 'initializer',
  entries: [{
    designators: [{ kind: 'field-designator', field: 'x' }],
    value: { kind: 'integer-literal', value: 3 },
  }],
});
assert.strictEqual(normalized.size, 8);
assert.deepStrictEqual([...normalized.bytes], [0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepStrictEqual(normalized.writes.map(write => [write.offset, write.value.value]), [[4, 3]]);

const unit = { kind: 'translation-unit', declarations: [
  { kind: 'typedef', type: builtinType('int'), declarators: [{ name: 'T', type: typedefType('T', builtinType('int')) }] },
] };
const program = analyzeTranslationUnit(unit);
assert.strictEqual(program.typedefs.get('T').name, 'int');

function analyze(source) {
  const { tokenizeC, parseTranslationUnit } = require('../out/cCompiler');
  return analyzeTranslationUnit(parseTranslationUnit(tokenizeC(source)));
}

const expressionProgram = analyze(`
struct Pair { int value; };
int choose(struct Pair *items, int index, int (*callback)(int *), int condition) {
  return condition ? callback(&items[index].value) : sizeof(struct Pair) + _Alignof(int);
}
`);
const chooseReturn = expressionProgram.unit.declarations[1].declarators[0].body.statements[0].expression;
assert.strictEqual(expressionProgram.expressionTypes.get(chooseReturn).name, 'unsigned int');
assert.strictEqual(expressionProgram.expressionTypes.get(chooseReturn.consequent.arguments[0]).kind, 'pointer');
assert.strictEqual(expressionProgram.expressionTypes.get(chooseReturn.alternate.left).name, 'unsigned int');

assert.doesNotThrow(() => analyze('int shadow(int value) { { int value = 2; } return value; }'));
assert.throws(
  () => analyze('struct Pair { int value; }; int bad(struct Pair pair) { return pair.missing; }'),
  /has no member 'missing'/,
);
assert.throws(
  () => analyze('int bad(int value) { return *value; }'),
  /dereference requires a pointer/,
);
assert.throws(
  () => analyze('int bad(int value) { return value(1); }'),
  /called object is not a function/,
);
assert.throws(
  () => analyze('int target(int value) { return value; } int bad(void) { return target(); }'),
  /expects 1 argument.*got 0/,
);
assert.throws(
  () => analyze('int bad(void) { const int value = 1; value = 2; return value; }'),
  /assignment to const-qualified object/,
);
console.log('c semantic tests passed');
