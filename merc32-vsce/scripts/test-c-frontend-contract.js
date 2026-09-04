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
            && errorValue.message.includes(fixtureCase.invariant),
        `${fixtureCase.name} must be rejected by ${fixtureCase.invariant}`,
    );
}

console.log(`C frontend contract tests passed (${malformedFixture.cases.length} malformed cases)`);
