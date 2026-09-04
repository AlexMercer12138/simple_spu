const assert = require('assert');
const fs = require('fs');
const path = require('path');

const {
    CFrontendInternalError,
    hasErrors,
    normalizeDiagnostics,
    validateEnvelope,
} = require('../out/cFrontend/validate');
const { MERC32_ABI } = require('../out/cFrontend/merc32Abi');
const { HARD_C_FRONTEND_LIMITS } = require('../out/cFrontend/limits');

const fixtureDirectory = path.join(__dirname, 'fixtures', 'c-frontend');
const validFixture = JSON.parse(fs.readFileSync(
    path.join(fixtureDirectory, 'valid-unit-v1.json'), 'utf8'));
const malformedFixture = JSON.parse(fs.readFileSync(
    path.join(fixtureDirectory, 'malformed-units.json'), 'utf8'));

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function applyOperations(value, operations) {
    for (const operation of operations) {
        const parent = operation.path.slice(0, -1).reduce((current, segment) => current[segment], value);
        const key = operation.path[operation.path.length - 1];
        if (operation.op === 'delete') {
            delete parent[key];
        } else {
            parent[key] = clone(operation.value);
        }
    }
    return value;
}

function assertDeeplyFrozen(value, seen = new Set()) {
    if (value === null || typeof value !== 'object' || seen.has(value)) {
        return;
    }
    seen.add(value);
    assert.ok(Object.isFrozen(value), 'accepted contract data must be deeply frozen');
    for (const nested of Object.values(value)) {
        assertDeeplyFrozen(nested, seen);
    }
}

const accepted = validateEnvelope(validFixture, 'test-build');
assert.deepStrictEqual(accepted, validFixture);
assert.notStrictEqual(accepted, validFixture, 'validation must not retain the caller-owned envelope');
assert.notStrictEqual(accepted.unit, validFixture.unit, 'validation must not retain nested caller-owned objects');
assertDeeplyFrozen(accepted);

const pointerRecursive = clone(validFixture);
pointerRecursive.unit.types.push(
    { id: 2, kind: 'struct', name: 'Node', complete: true, members: [
        { name: 'next', type: 3, offset: 0, range: { file: 1, start: { line: 1, column: 1, byteOffset: 0 }, end: { line: 1, column: 2, byteOffset: 1 } } },
    ], qualifiers: [], size: 4, alignment: 4 },
    { id: 3, kind: 'pointer', pointee: 2, qualifiers: [], size: 4, alignment: 4 },
);
assert.doesNotThrow(() => validateEnvelope(pointerRecursive, 'test-build'),
    'pointer-mediated recursive types are legal');

const exactUint64 = clone(validFixture);
exactUint64.unit.types[0] = {
    id: 1, kind: 'builtin', name: 'unsigned long long', qualifiers: [], size: 8, alignment: 4,
};
exactUint64.unit.nodes.push({
    id: 1,
    category: 'expression',
    kind: 'integer-literal',
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    type: 1,
    valueCategory: 'rvalue',
    children: [],
    constant: { kind: 'integer', bits: 64, signed: false, value: '18446744073709551615' },
});
assert.doesNotThrow(() => validateEnvelope(exactUint64, 'test-build'),
    'unsigned 64-bit constants must retain exact values beyond Number.MAX_SAFE_INTEGER');

const sourcedFailure = {
    protocolVersion: 1,
    bridgeBuildId: 'test-build',
    status: 'diagnostics',
    sourceFiles: [{ id: 1, path: 'broken.c', byteLength: 4 }],
    diagnostics: [{
        severity: 'error',
        code: 'C1000',
        message: 'failure with source context',
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        related: [],
        notes: [],
        includeTrace: [],
        macroExpansionTrace: [],
    }],
};
const acceptedFailure = validateEnvelope(sourcedFailure, 'test-build');
assert.strictEqual(acceptedFailure.status, 'diagnostics');
assert.notStrictEqual(acceptedFailure.sourceFiles, sourcedFailure.sourceFiles);
assertDeeplyFrozen(acceptedFailure);

const nullPointer = clone(validFixture);
nullPointer.unit.types.push({
    id: 2, kind: 'pointer', pointee: 1, qualifiers: [], size: 4, alignment: 4,
});
nullPointer.unit.nodes.push({
    id: 1,
    category: 'expression',
    kind: 'conversion',
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    type: 2,
    valueCategory: 'rvalue',
    children: [],
    conversion: 'assignment',
    targetType: 2,
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
});
assert.doesNotThrow(() => validateEnvelope(nullPointer, 'test-build'),
    'canonical integer zero may represent a converted null pointer');

const definedPrototype = clone(validFixture);
definedPrototype.unit.types.push({
    id: 2, kind: 'function', returnType: 1, parameters: [], variadic: false,
    qualifiers: [], size: 0, alignment: 4,
});
definedPrototype.unit.symbols.push({
    id: 1, kind: 'function', name: 'f', type: 2,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    linkage: 'external', definition: true,
});
definedPrototype.unit.nodes.push({
    id: 1, category: 'declaration', kind: 'function-declaration', type: 2, symbol: 1,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    children: [],
}, {
    id: 2, category: 'declaration', kind: 'function-definition', type: 2, symbol: 1,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    children: [],
});
definedPrototype.unit.declarations.push(1, 2);
assert.doesNotThrow(() => validateEnvelope(definedPrototype, 'test-build'),
    'a declaration and later definition may share one function symbol marked definition');

const subobjectRelocation = clone(validFixture);
subobjectRelocation.unit.types.push({
    id: 2,
    kind: 'struct',
    name: 'Pair',
    complete: true,
    members: [{
        name: 'first', type: 1, offset: 0,
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
    }, {
        name: 'second', type: 1, offset: 4,
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
    }],
    qualifiers: [], size: 8, alignment: 4,
}, {
    id: 3, kind: 'pointer', pointee: 1, qualifiers: [], size: 4, alignment: 4,
});
subobjectRelocation.unit.symbols.push({
    id: 1, kind: 'variable', name: 'pair', type: 2,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    linkage: 'internal', storage: 'static', definition: true,
});
subobjectRelocation.unit.nodes.push({
    id: 1, category: 'expression', kind: 'conversion', type: 3,
    valueCategory: 'rvalue', children: [], conversion: 'assignment', targetType: 3,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    constant: { kind: 'address', symbol: 1, addend: '4' },
});
assert.doesNotThrow(() => validateEnvelope(subobjectRelocation, 'test-build'),
    'symbol-plus-addend may address an int subobject within a larger object');

const paddedStringInitializer = clone(validFixture);
paddedStringInitializer.unit.types = [
    { id: 1, kind: 'builtin', name: 'char', qualifiers: [], size: 1, alignment: 1 },
    { id: 2, kind: 'array', element: 1, count: 4, qualifiers: [], size: 4, alignment: 1 },
];
paddedStringInitializer.unit.symbols.push({
    id: 1, kind: 'variable', name: 'text', type: 2,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    linkage: 'internal', storage: 'static', definition: true,
    initializer: {
        size: 4,
        zeroFill: true,
        writes: [{
            offset: 0,
            type: 2,
            value: { kind: 'string', elementType: 1, bytes: [65, 0] },
        }],
    },
});
assert.doesNotThrow(() => validateEnvelope(paddedStringInitializer, 'test-build'),
    'zeroFill supplies the remaining bytes of a short character-array initializer');

const typedefRepresentations = clone(validFixture);
typedefRepresentations.unit.types = [
    { id: 1, kind: 'builtin', name: 'unsigned int', qualifiers: [], size: 4, alignment: 4 },
    { id: 2, kind: 'typedef', name: 'UInt', target: 1, qualifiers: [], size: 4, alignment: 4 },
    {
        id: 3, kind: 'enum', name: 'Choice', underlyingType: 2,
        enumerators: [{ name: 'choice', value: '0', range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        } }],
        qualifiers: [], size: 4, alignment: 4,
    },
    { id: 4, kind: 'builtin', name: 'float', qualifiers: [], size: 4, alignment: 4 },
    { id: 5, kind: 'typedef', name: 'Float', target: 4, qualifiers: [], size: 4, alignment: 4 },
    { id: 6, kind: 'builtin', name: 'char', qualifiers: [], size: 1, alignment: 1 },
    { id: 7, kind: 'typedef', name: 'Char', target: 6, qualifiers: [], size: 1, alignment: 1 },
    { id: 8, kind: 'array', element: 7, count: 2, qualifiers: [], size: 2, alignment: 1 },
    {
        id: 9, kind: 'struct', name: 'Bits', complete: true,
        members: [{
            name: 'flag', type: 1, offset: 0, bitOffset: 0, bitWidth: 1,
            range: {
                file: 1,
                start: { line: 1, column: 1, byteOffset: 0 },
                end: { line: 1, column: 2, byteOffset: 1 },
            },
        }],
        qualifiers: [], size: 4, alignment: 4,
    },
];
typedefRepresentations.unit.nodes = [
    {
        id: 1, category: 'expression', kind: 'floating-literal', type: 5,
        valueCategory: 'rvalue', children: [],
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        constant: { kind: 'floating', type: 5, ieeeBits: '00000000' },
    },
    {
        id: 2, category: 'expression', kind: 'string-literal', type: 8,
        valueCategory: 'lvalue', children: [],
        range: {
            file: 1,
            start: { line: 1, column: 1, byteOffset: 0 },
            end: { line: 1, column: 2, byteOffset: 1 },
        },
        constant: { kind: 'string', elementType: 7, bytes: [65, 0] },
    },
];
assert.doesNotThrow(() => validateEnvelope(typedefRepresentations, 'test-build'),
    'typedef-wrapped scalar representations and retained bit-field metadata are valid');

assert.strictEqual(MERC32_ABI.target, 'merc32');
assert.strictEqual(MERC32_ABI.abi, 'merc32-c-v1');
assert.strictEqual(MERC32_ABI.dataModel, 'merc32-ilp32');
assert.strictEqual(MERC32_ABI.pointerSize, 4);
assert.strictEqual(HARD_C_FRONTEND_LIMITS.memoryBytes, 128 * 1024 * 1024);
assertDeeplyFrozen(MERC32_ABI);
assertDeeplyFrozen(HARD_C_FRONTEND_LIMITS);

const diagnosticRange = {
    file: 1,
    start: { line: 1, column: 1, byteOffset: 0 },
    end: { line: 1, column: 2, byteOffset: 1 },
};
const warning = {
    severity: 'warning', code: 'W2', message: 'later', range: diagnosticRange,
    related: [], notes: [], includeTrace: [], macroExpansionTrace: [],
};
const error = {
    severity: 'error', code: 'E1', message: 'earlier', range: diagnosticRange,
    related: [], notes: [], includeTrace: [], macroExpansionTrace: [],
};
const normalized = normalizeDiagnostics([warning, error, warning]);
assert.deepStrictEqual(normalized.map((record) => record.code), ['E1', 'W2']);
assertDeeplyFrozen(normalized);
assert.strictEqual(hasErrors(normalized), true);
assert.strictEqual(hasErrors([warning]), false);

assert.ok(Array.isArray(malformedFixture.cases));
assert.ok(malformedFixture.cases.length >= 30, 'fixture must exercise every named malformed category');
for (const fixtureCase of malformedFixture.cases) {
    const malformed = applyOperations(clone(validFixture), fixtureCase.operations);
    assert.throws(
        () => validateEnvelope(malformed, 'test-build'),
        (errorValue) => errorValue instanceof CFrontendInternalError
            && errorValue.message.includes(fixtureCase.invariant)
            && (fixtureCase.messageIncludes === undefined
                || errorValue.message.includes(fixtureCase.messageIncludes)),
        `${fixtureCase.name} must be rejected by ${fixtureCase.invariant}`,
    );
}

console.log(`C frontend contract tests passed (${malformedFixture.cases.length} malformed cases)`);
