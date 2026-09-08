'use strict';

const assert = require('node:assert/strict');
const { compileCToObject, compileC } = require('../out/cCompiler');
const { linkObjects, assembleToObject, validateObject, serializeObject, deserializeObject } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');
const options = { entrySymbol: 'main', gcFunctions: true, dataBase: 0x08000000 };

const source = `
    int unused_leaf(int x) { return x*9; }
    int unused_chain(void) { return unused_leaf(5); }
    int used(int x) { return x+7; }
    int main(void) { return used(4); }
`;
// Keep direct call edges so this fixture tests collection independently of inlining.
const object = compileCToObject(source, { optimization: 'none' });
const before = linkObjects([object], { ...options, gcFunctions: false });
const snapshot = serializeObject(object);
const after = linkObjects([object], options);
assert(!after.symbols.has('unused_leaf'));
assert(!after.symbols.has('unused_chain'));
assert(after.symbols.has('used'));
assert(after.sections[0].size < before.sections[0].size);
assert.equal(serializeObject(object), snapshot);
assert.deepEqual(deserializeObject(snapshot).functions, object.functions);
assert(object.symbols.some(s => s.name === 'unused_chain' && s.defined), 'object compilation preserves exports');

// Only surviving references must resolve; recursive dead cycles are also removable.
const dead = compileCToObject(`
    int missing(void); int dead_b(int);
    int dead_a(int n) { return n ? dead_b(n-1) : missing(); }
    int dead_b(int n) { return dead_a(n); }
    int main(void) { return 0; }
`);
assert.doesNotThrow(() => linkObjects([dead], options));
assert.throws(() => linkObjects([dead], { ...options, gcFunctions: false }), /unresolved symbol 'missing'/);
assert.throws(() => linkObjects([compileCToObject('int missing(void); int main(void){return missing();}')], options), /missing/);
assert.throws(() => linkObjects([object], { gcFunctions: true }), /entry/);
assert.throws(() => linkObjects([object], { ...options, keepSymbols: ['typo'] }), /typo/);
assert(linkObjects([object], { ...options, keepSymbols: ['unused_chain'] }).symbols.has('unused_leaf'));

// Data pointers, assembly references and equal local names in different objects.
const left = compileCToObject('static int helper(void){return 3;} int left(void){return helper();} int unused(void){return 8;}');
const right = compileCToObject('static int helper(void){return 4;} int right(void){return helper();} int (*callback)(void)=right; int left(void); int main(void){return left()+callback();}');
const assembly = assembleToObject('external_entry:\njmp unused, r14\njmp r14', { exports: ['external_entry'] });
const mixed = linkObjects([left, right, assembly], options);
for (const name of ['left', 'right', 'main', 'unused', 'external_entry']) assert(mixed.symbols.has(name), name);
new SimpleCPUAssembler().assemble(mixed.assembly);

// Public basic builds opt in; none builds and standalone objects retain functions.
assert.doesNotMatch(compileC(source, { optimization: 'basic' }).assembly, /^unused_chain:/m);
assert.match(compileC(source, { optimization: 'none' }).assembly, /^unused_chain:/m);
assert.throws(() => linkObjects([object, object], options), /duplicate/);

for (const functions of [null, [{ name: 'main', offset: 0, size: 4 }],
    [{ name: 'main', offset: 0, size: 1 }], [{ name: 'missing', offset: 0, size: object.sections[0].size }]]) {
    assert.throws(() => validateObject({ ...object, functions }), /function/);
}
console.log(`function GC tests passed: ${before.sections[0].size} -> ${after.sections[0].size} bytes`);

function functionObject(source, names) {
    const object = assembleToObject(source, { exports: names });
    const symbols = names.map(name => object.symbols.find(s => s.name === name)).sort((a, b) => a.offset - b.offset);
    return { ...object, functions: symbols.map((symbol, index) => ({ name: symbol.name, offset: symbol.offset,
        size: (symbols[index+1]?.offset ?? object.sections[0].size) - symbol.offset })) };
}

// Canonical words, source labels and pointers into later functions all move together.
{
    const input = functionObject(`main: jmp r14 /* comment\n comment end */
        dead: mov r4, 123
        jmp r14
        target: mov r4, 8
        jmp r14`, ['main', 'dead', 'target']);
    const pointer = { version: 1, target: 'merc32', abi: input.abi,
        sections: [{ name: 'data', alignment: 4, size: 8, content: Array(8).fill(0) }],
        symbols: [{ name: 'main', binding: 'global', defined: false }, { name: 'target', binding: 'global', defined: false }],
        relocations: [
            { section: 'data', offset: 0, kind: 'ABS32', symbol: 'main', addend: 12 },
            { section: 'data', offset: 4, kind: 'ABS32', symbol: 'target', addend: -12 },
        ] };
    const linked = linkObjects([input, pointer], options);
    assert(!linked.symbols.has('dead'));
    assert.equal(linked.symbols.get('target'), 4);
    assert.deepEqual(linked.sections.find(s => s.name === 'data').content, [4, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(new SimpleCPUAssembler().assemble(linked.assembly).machineCodes.map(w => w >>> 0), linked.machineCodes);
    const high = { ...input, relocations: [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'target', addend: 0,
        relaxationRegister: 8 }], sections: input.sections.map(s => ({ ...s, content: [0x2c, ...s.content.slice(1)],
            source: s.source.replace('main: jmp r14', 'main: jmp target') })) };
    const relaxed = linkObjects([high], { ...options, textBase: 0x10000 });
    assert(!relaxed.symbols.has('dead'));
    assert.equal(relaxed.symbols.get('target'), 0x10010);
    assert.deepEqual(new SimpleCPUAssembler().assemble(relaxed.assembly).machineCodes.map(w => w >>> 0), relaxed.machineCodes);
}

// Function boundaries are optional, but malformed opt-in metadata must never authorize deletion.
{
    const old = { ...object }; delete old.functions;
    assert(linkObjects([old], options).symbols.has('unused_chain'));
    const mismatch = { ...object, abi: 'incompatible' };
    assert.throws(() => linkObjects([object, mismatch], options), /abi mismatch/);
}

// An entire unused translation unit can lose its text without losing its global initialization.
{
    const unused = compileCToObject('int never_called(void){return 8;}');
    const linked = linkObjects([object, unused], options);
    assert.equal(linked.sections.find(s => s.objectIndex === 1 && s.name === 'text').size, 0);
    assert(!linked.symbols.has('never_called'));
    new SimpleCPUAssembler().assemble(linked.assembly);
}

// Section-end aliases remain valid when earlier functions disappear.
{
    const input = functionObject('dead: jmp r14\nmain: jmp r14\nend:', ['dead', 'main']);
    const pointer = { version: 1, target: 'merc32', abi: input.abi,
        sections: [{ name: 'data', alignment: 4, size: 4, content: [0,0,0,0] }],
        symbols: [{ name: 'end', binding: 'global', defined: false }],
        relocations: [{ section: 'data', offset: 0, kind: 'ABS32', symbol: 'end', addend: 0 }] };
    const exported = { ...input, symbols: input.symbols.map(s => s.name === 'end' ? { ...s, binding: 'global' } : s) };
    const linked = linkObjects([exported, pointer], options);
    assert.equal(linked.symbols.get('end'), 4);
    assert.deepEqual(linked.sections.find(s => s.name === 'data').content, [4,0,0,0]);
}
