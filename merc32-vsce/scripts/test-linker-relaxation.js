'use strict';

const assert = require('node:assert/strict');
const { assembleToObject } = require('../out/linker/assembleObject');
const { linkObjects } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');
const { validateObject, serializeObject, deserializeObject } = require('../out/linker/objectJson');

assert.equal(new SimpleCPUAssembler().assemble('.org 0x7ffc\n.entry start\nstart:\njmp start')
    .machineCodes[0] >>> 0, 0x8000002c);

function relaxable(source, exports = []) {
    const object = assembleToObject(source, { exports });
    return { ...object, relocations: object.relocations.map(r =>
        ['CALL16', 'BRANCH16'].includes(r.kind) ? { ...r, relaxationRegister: 8 } : r) };
}

for (const instruction of ['jmp target, r14', 'jmp target', 'bz r7, r0 + target', 'bnz r8, r0 + target']) {
    const object = relaxable(`start:\n${instruction}\nmov r4, 7\ntarget:\njmp r14`, ['start', 'target']);
    const snapshot = JSON.stringify(object);
    const linked = linkObjects([object], { textBase: 0x10000 });
    assert.equal(JSON.stringify(object), snapshot, 'linking must not mutate input');
    const branch = instruction.startsWith('b');
    assert.equal(linked.sections[0].size, branch ? 28 : 24);
    assert.equal(linked.symbols.get('target'), 0x10000 + (branch ? 24 : 20));
    assert.match(linked.assembly, /mov r8, 0x1/);
    const assembled = new SimpleCPUAssembler().assemble(`.org 0x10000\n${linked.assembly}`);
    assert.deepEqual(assembled.machineCodes.map(w => w >>> 0), linked.machineCodes);
}

// Near absolute targets above signed-decimal range still use one instruction.
for (const base of [0x7ffc, 0x8000, 0xfff8]) {
    const linked = linkObjects([relaxable('jmp target\ntarget:\njmp r14', ['target'])], { textBase: base });
    assert.equal(linked.sections[0].size, 8);
}

// Unannotated assembly retains strict relocation semantics.
assert.throws(() => linkObjects([assembleToObject('jmp target\ntarget:\njmp r14')],
    { textBase: 0x10000 }), /out of range/);

for (const source of [
    'jmp target /* comment\n still comment */\ntarget:\njmp r14',
    '/* comment\n end */ jmp target\ntarget:\njmp r14',
    'jmp target /* first\n */\ntarget: /* second\n */ jmp r14',
]) {
    const linked = linkObjects([relaxable(source)], { textBase: 0x10000 });
    assert.deepEqual(new SimpleCPUAssembler().assemble(linked.assembly).machineCodes.map(w => w >>> 0), linked.machineCodes);
}

// The first expansion pushes a previously short second jump over the boundary.
{
    const caller = relaxable('start:\njmp far, r14\njmp near, r14', ['start']);
    const padding = assembleToObject('mov r0, 0\n'.repeat((0xfffc - 8) / 4));
    const targets = assembleToObject('near:\njmp r14\nfar:\njmp r14', { exports: ['near', 'far'] });
    const pointer = { version: 1, target: 'merc32', abi: caller.abi,
        sections: [{ name: 'data', alignment: 4, size: 4, content: [0, 0, 0, 0] }],
        symbols: [{ name: 'start', binding: 'global', defined: false }],
        relocations: [{ section: 'data', offset: 0, kind: 'ABS32', symbol: 'start', addend: 4 }] };
    const linked = linkObjects([caller, padding, targets, pointer], { dataBase: 0x08000000 });
    assert.equal(linked.sections[0].size, 32);
    assert.equal(linked.symbols.get('near'), 0xfffc + 24);
    assert.deepEqual(linked.sections.find(s => s.name === 'data').content, [16, 0, 0, 0]);
    assert.deepEqual(new SimpleCPUAssembler().assemble(linked.assembly).machineCodes.map(w => w >>> 0), linked.machineCodes);
}

{
    const object = relaxable('jmp target\ntarget:\njmp r14');
    assert.equal(serializeObject(deserializeObject(serializeObject(object))), serializeObject(object));
    for (const register of [0, 3, 12, 15, 8.5, '8']) {
        assert.throws(() => validateObject({ ...object, relocations: object.relocations.map(r =>
            ({ ...r, relaxationRegister: register })) }), /relaxation register/);
    }
    const bad = { ...object, sections: object.sections.map(s => ({ ...s, source: s.source.replace('jmp target', 'jmp r4 + target') })) };
    assert.throws(() => linkObjects([bad], { textBase: 0x10000 }), /disagree/);
    const unaligned = { ...object, relocations: object.relocations.map(r => ({ ...r, addend: 1 })) };
    assert.throws(() => linkObjects([unaligned], { textBase: 0x10000 }), /invalid control-flow.*target/);
}

console.log('linker relaxation tests passed');
