'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Ajv2020 = require('ajv/dist/2020');

const extensionRoot = path.resolve(__dirname, '..');
const schema = JSON.parse(fs.readFileSync(
    path.join(extensionRoot, 'resources', 'c-frontend', 'typed-c-unit-v1.schema.json'),
    'utf8',
));
const fixture = JSON.parse(fs.readFileSync(
    path.join(__dirname, 'fixtures', 'c-frontend', 'valid-unit-v1.json'),
    'utf8',
)).unit;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

assert.strictEqual(validate(fixture), true,
    `schema rejects a valid typed unit: ${JSON.stringify(validate.errors)}`);

const { analyzeSource } = require('../out/cFrontend/frontend');
for (const source of [
    'int main(void) { for (;;) break; return 0; }',
    'struct Bits { unsigned int : 0; unsigned int x : 1; };',
    'struct __attribute__((packed)) Packed { char a; int b; };',
    'typedef int Number; const Number value = 1;',
]) {
    const result = analyzeSource(source);
    assert.strictEqual(result.status, 'ok');
    assert.strictEqual(validate(result.unit), true, JSON.stringify(validate.errors));
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function rejects(name, mutate) {
    const value = clone(fixture);
    mutate(value);
    assert.strictEqual(validate(value), false,
        `${name} was accepted by the typed-unit schema`);
}

rejects('empty type record', (unit) => { unit.types = [{}]; });
rejects('unknown nested type property', (unit) => { unit.types[0].hostBits = 64; });
rejects('missing type alignment', (unit) => { delete unit.types[0].alignment; });
rejects('invalid type qualifier', (unit) => { unit.types[0].qualifiers = ['mutable']; });
rejects('invalid builtin name', (unit) => { unit.types[0].name = 'host long'; });
rejects('invalid pointer reference', (unit) => {
    unit.types = [{
        id: 1, kind: 'pointer', qualifiers: [], size: 4, alignment: 4, pointee: 0,
    }];
});
rejects('unknown symbol property', (unit) => {
    unit.symbols = [{
        id: 1,
        kind: 'variable',
        name: 'x',
        type: 1,
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        linkage: 'external',
        storage: 'static',
        definition: true,
        hostAddress: 4096,
    }];
});
rejects('invalid symbol storage enum', (unit) => {
    unit.symbols = [{
        id: 1,
        kind: 'variable',
        name: 'x',
        type: 1,
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        linkage: 'external',
        storage: 'heap',
        definition: true,
    }];
});
rejects('node category does not match its kind', (unit) => {
    unit.nodes = [{
        id: 1,
        category: 'statement',
        kind: 'integer-literal',
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        children: [],
        type: 1,
        valueCategory: 'rvalue',
        constant: { kind: 'integer', bits: 32, signed: true, value: '1' },
    }];
});
rejects('nested range property', (unit) => {
    unit.symbols = [{
        id: 1,
        kind: 'typedef',
        name: 'word',
        type: 1,
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0, utf16Offset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
    }];
});
rejects('malformed integer constant', (unit) => {
    unit.nodes = [{
        id: 1,
        category: 'expression',
        kind: 'integer-literal',
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        children: [],
        type: 1,
        valueCategory: 'rvalue',
        constant: { kind: 'integer', bits: 32, value: '1' },
    }];
});
rejects('invalid declaration node reference', (unit) => { unit.declarations = [0]; });

process.stdout.write('C frontend typed-unit schema tests passed.\n');
