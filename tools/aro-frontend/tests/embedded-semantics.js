'use strict';

const assert = require('assert');

module.exports = function testEmbeddedSemantics(analyze, makeRequest) {
    const failures = [];
    function check(name, test) {
        try { test(); } catch (error) { failures.push(new Error(`${name}: ${error.message}`)); }
    }
    function unit(source) {
        const { envelope } = analyze(makeRequest({ source }));
        assert.strictEqual(envelope.status, 'ok', JSON.stringify(envelope.diagnostics));
        return envelope.unit;
    }
    check('offsetof becomes a typed integer constant', () => {
        const result = unit('struct S { char c; int values[3]; }; unsigned f(void) { return __builtin_offsetof(struct S, values[2]); }');
        assert.ok(result.nodes.some((node) => node.kind === 'integer-literal'
            && node.constant?.value === '12' && node.constant.bits === 32 && node.constant.signed === false));
    });
    check('compound assignments preserve their computation and operand types', () => {
        const result = unit('void f(unsigned char c, int s, unsigned u, int *p) { c /= 256; s /= u; s >>= 1U; p += 2; }');
        const assignments = result.nodes.filter((node) => node.kind === 'assignment');
        const type = (id) => result.types.find((item) => item.id === id);
        const rhs = (node) => result.nodes.find((item) => item.id === node.children[1]);
        assert.strictEqual(assignments.length, 4);
        assert.strictEqual(type(assignments[0].type).name, 'unsigned char');
        assert.strictEqual(type(assignments[0].computationType).name, 'int');
        assert.strictEqual(type(rhs(assignments[0]).type).name, 'int');
        assert.strictEqual(type(assignments[1].computationType).name, 'unsigned int');
        assert.strictEqual(type(assignments[2].computationType).name, 'int');
        assert.strictEqual(type(assignments[3].computationType).kind, 'pointer');
        assert.strictEqual(type(rhs(assignments[3]).type).name, 'int');
    });
    check('aggregate initializer positions survive omitted zero elements', () => {
        const result = unit('struct S { int a, b, c; }; union U { int a; unsigned b; }; void f(void) { int a[6] = {[3]=7,[5]=9}; struct S s = {.c=4}; union U u = {.b=8}; int scalar = (int){6}; }');
        const literals = result.nodes.filter((node) => node.kind === 'compound-literal');
        assert.ok(literals.some((node) => JSON.stringify(node.initializerIndices) === '[3,5]'));
        assert.ok(literals.some((node) => JSON.stringify(node.initializerIndices) === '[2]'));
        assert.ok(literals.some((node) => JSON.stringify(node.initializerIndices) === '[1]'));
        assert.ok(literals.some((node) => JSON.stringify(node.initializerIndices) === '[0]'));
        for (const literal of literals) assert.strictEqual(literal.initializerIndices.length, literal.children.length);
    });
    check('shifts promote each operand independently', () => {
        const result = unit('_Static_assert((-8 >> 1U) == -4, "signed shift"); int f(int x, unsigned n) { return x >> n; }');
        const shift = result.nodes.find((node) => node.kind === 'binary' && node.operator === '>>'
            && result.nodes.find((child) => child.id === node.children[0])?.kind === 'conversion');
        assert.ok(shift);
        const type = (id) => result.types.find((item) => item.id === id);
        assert.strictEqual(type(shift.type).name, 'int');
        assert.strictEqual(type(result.nodes.find((node) => node.id === shift.children[1]).type).name, 'unsigned int');
    });
    check('generic selection retains the selected lvalue', () => {
        const result = unit('int f(void) { int x=1,y=2; _Generic(x,int:x,default:y)=12; return x; }');
        assert.ok(result.nodes.some((node) => node.kind === 'generic-selection' && node.valueCategory === 'lvalue'));
        const { envelope } = analyze(makeRequest({
            source: 'void f(void) { const int x=1; _Generic(0,int:x,default:0)=2; }',
        }));
        assert.strictEqual(envelope.status, 'diagnostics', 'selected const lvalues remain read-only');
    });
    check('file-scope compound literals emit static objects and relocations', () => {
        const result = unit('struct S { int x; }; struct S *p = &(struct S){7}; struct S s = (struct S){9};');
        const pointer = result.symbols.find((symbol) => symbol.name === 'p');
        const address = pointer.initializer.writes[0].value;
        assert.strictEqual(address.kind, 'address');
        const object = result.symbols.find((symbol) => symbol.id === address.symbol);
        assert.strictEqual(object.storage, 'static');
        assert.strictEqual(object.linkage, 'internal');
        assert.strictEqual(object.initializer.writes[0].value.value, '7');
        assert.strictEqual(result.symbols.find((symbol) => symbol.name === 's').initializer.writes[0].value.value, '9');
        const pointerValue = unit('int *p = (int *){0};');
        assert.deepStrictEqual(pointerValue.symbols.find((symbol) => symbol.name === 'p').initializer.writes, []);
    });
    for (const [name, source] of [
        ['weak', 'int value __attribute__((weak));'],
        ['section', 'int value __attribute__((section(".custom")));'],
        ['weak function', '__attribute__((weak)) int f(void) { return 1; }'],
        ['section function', '__attribute__((section(".custom"))) int f(void) { return 1; }'],
    ]) check(`unsupported ${name} reports a compiler error`, () => {
        const { envelope } = analyze(makeRequest({ source }));
        assert.strictEqual(envelope.status, 'diagnostics');
        assert.strictEqual(envelope.unit, undefined);
        assert.ok(envelope.diagnostics.some((diagnostic) => diagnostic.severity === 'error'
            && diagnostic.message.includes(name.split(' ')[0])
            && diagnostic.message.includes('not supported')));
    });
    check('Aro retains its existing local section warning', () => {
        const { envelope } = analyze(makeRequest({
            source: 'void f(void) { static int value __attribute__((section(".custom"))); }',
        }));
        assert.ok(envelope.diagnostics.some((diagnostic) => diagnostic.severity === 'warning'
            && diagnostic.code === 'ignored-attributes' && diagnostic.message.includes('section')));
    });
    if (failures.length) throw new AggregateError(failures, failures.map((error) => error.message).join('\n'));
};
