const assert = require('assert');
const { tokenizeC, parseTranslationUnit } = require('../out/cCompiler');
function parse(source) { return parseTranslationUnit(tokenizeC(source)); }
const unit = parse('typedef unsigned long word; struct S { int x; word y; }; int f(int (*cb)(int), int a[2][3]);');
assert.strictEqual(unit.declarations[0].kind, 'typedef');
assert.strictEqual(unit.declarations[1].type.kind, 'struct');
assert.strictEqual(unit.declarations[2].declarators[0].type.kind, 'function');
const comma = parse('int a, *b, c[2][3];');
assert.strictEqual(comma.declarations[0].declarators.length, 3);
const initialized = parse('int a = 1, b = 2;');
assert.strictEqual(initialized.declarations[0].declarators.length, 2);
const callback = parse('int f(int (*cb)(int), int a[2][3]);');
const callbackType = callback.declarations[0].declarators[0].type;
assert.strictEqual(callbackType.kind, 'function');
assert.strictEqual(callbackType.parameters[0].kind, 'pointer');
assert.strictEqual(callbackType.parameters[0].pointee.kind, 'function');
assert.strictEqual(callbackType.parameters[1].kind, 'pointer');
assert.strictEqual(callbackType.parameters[1].pointee.kind, 'array');
const literals = tokenizeC('unsigned long long x = 1ULL; double y = 1.5e-2;');
assert(literals.some(t => t.text === '1ULL'));
assert(literals.some(t => t.text === '1.5e-2'));
const hexadecimal = parse('unsigned int x = 0x11223344; unsigned int y = 0xDEAD;');
assert.strictEqual(hexadecimal.declarations[0].declarators[0].initializer.value, 0x11223344);
assert.strictEqual(hexadecimal.declarations[1].declarators[0].initializer.value, 0xDEAD);

const expressionUnit = parse(`
struct Pair { int value; };
int choose(struct Pair *items, int index, int (*callback)(int *), int condition) {
    return condition ? callback(&items[index].value) : sizeof(struct Pair) + _Alignof(int);
}
double floating(void) { return 1.5; }
int character(void) { return '\\n'; }
char *text(void) { return "hi"; }
`);
const chooseBody = expressionUnit.declarations[1].declarators[0].body;
const conditional = chooseBody.statements[0].expression;
assert.strictEqual(conditional.kind, 'conditional');
assert.strictEqual(conditional.consequent.kind, 'call');
assert.strictEqual(conditional.consequent.callee.kind, 'identifier');
assert.strictEqual(conditional.consequent.arguments[0].kind, 'unary');
assert.strictEqual(conditional.consequent.arguments[0].operator, '&');
assert.strictEqual(conditional.consequent.arguments[0].operand.kind, 'member');
assert.strictEqual(conditional.consequent.arguments[0].operand.object.kind, 'subscript');
assert.strictEqual(conditional.alternate.kind, 'binary');
assert.strictEqual(conditional.alternate.left.kind, 'sizeof');
assert.strictEqual(conditional.alternate.left.typeOperand.kind, 'struct');
assert.strictEqual(conditional.alternate.right.kind, 'alignof');
assert.strictEqual(conditional.alternate.right.typeOperand.name, 'int');
assert.strictEqual(expressionUnit.declarations[2].declarators[0].body.statements[0].expression.kind, 'floating-literal');
assert.strictEqual(expressionUnit.declarations[3].declarators[0].body.statements[0].expression.value, 10);
assert.strictEqual(expressionUnit.declarations[4].declarators[0].body.statements[0].expression.value, 'hi');

const qualified = parse('int qualified(int * restrict const value);');
assert.deepStrictEqual(
    qualified.declarations[0].declarators[0].type.parameters[0].qualifiers,
    { const: true, volatile: false, restrict: true },
);
console.log('c parser tests passed');
