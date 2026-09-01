const assert = require('assert');
const { tokenizeC, parseTranslationUnit } = require('../out/cCompiler');
function parse(source) { return parseTranslationUnit(tokenizeC(source)); }
const unit = parse('typedef unsigned long word; struct S { int x; word y; }; int f(int (*cb)(int), int a[2][3]);');
assert.strictEqual(unit.declarations[0].kind, 'typedef');
assert.strictEqual(unit.declarations[1].type.kind, 'struct');
assert.strictEqual(unit.declarations[2].declarators[0].type.kind, 'function');
const comma = parse('int a, *b, c[2][3];');
assert.strictEqual(comma.declarations[0].declarators.length, 3);
const literals = tokenizeC('unsigned long long x = 1ULL; double y = 1.5e-2;');
assert(literals.some(t => t.text === '1ULL'));
assert(literals.some(t => t.text === '1.5e-2'));
console.log('c parser tests passed');
