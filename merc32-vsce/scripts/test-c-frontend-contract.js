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
    sourceFiles: [{ id: 1, path: 'broken.c', byteLength: 4, utf8BoundaryBitmap: '1f' }],
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

function expectContractFailure(value, invariant, message) {
    assert.throws(
        () => validateEnvelope(value, 'test-build'),
        (errorValue) => errorValue instanceof CFrontendInternalError
            && errorValue.message.includes(invariant),
        message,
    );
}

for (const [name, bitmap] of [
    ['wrong byte length', 'ff'],
    ['uppercase hex', 'FFFFFF07'],
    ['non-hex character', 'fffffg07'],
    ['nonzero padding', 'ffffff87'],
    ['missing offset zero', 'feffff07'],
    ['missing EOF offset', 'ffffff03'],
]) {
    const malformedBitmap = clone(validFixture);
    malformedBitmap.unit.sourceFiles[0].utf8BoundaryBitmap = bitmap;
    expectContractFailure(malformedBitmap, 'SOURCE_BOUNDARIES',
        `${name} UTF-8 boundary bitmap must be rejected`);
}

const multibyteSource = clone(validFixture);
multibyteSource.unit.sourceFiles = [{
    id: 1, path: 'utf8.c', byteLength: 3, utf8BoundaryBitmap: '0b',
}];
multibyteSource.diagnostics.push({
    severity: 'warning', code: 'W_UTF8', message: 'multibyte range',
    range: {
        file: 1,
        start: { line: 1, column: 2, byteOffset: 1 },
        end: { line: 1, column: 3, byteOffset: 3 },
    },
    related: [], notes: [], includeTrace: [], macroExpansionTrace: [],
});
assert.doesNotThrow(() => validateEnvelope(multibyteSource, 'test-build'),
    'ranges on both boundaries of a multibyte UTF-8 code point are valid');

const continuationByteRange = clone(multibyteSource);
continuationByteRange.diagnostics[0].range.start = { line: 1, column: 2, byteOffset: 2 };
expectContractFailure(continuationByteRange, 'SOURCE_RANGE',
    'ranges at a UTF-8 continuation byte must be rejected');

const spellingRange = clone(exactUint64);
spellingRange.unit.nodes[0].spellingRange = {
    file: 1,
    start: { line: 1, column: 3, byteOffset: 2 },
    end: { line: 1, column: 4, byteOffset: 3 },
};
assert.doesNotThrow(() => validateEnvelope(spellingRange, 'test-build'),
    'a distinct closed spelling range is valid');

const duplicateSpellingRange = clone(exactUint64);
duplicateSpellingRange.unit.nodes[0].spellingRange = clone(duplicateSpellingRange.unit.nodes[0].range);
expectContractFailure(duplicateSpellingRange, 'SOURCE_RANGE',
    'a spelling range identical to the primary range must be rejected');

const nodeRange = {
    file: 1,
    start: { line: 1, column: 1, byteOffset: 0 },
    end: { line: 1, column: 2, byteOffset: 1 },
};
const scopedLabels = clone(validFixture);
scopedLabels.unit.types.push({
    id: 2, kind: 'function', returnType: 1, parameters: [], variadic: false,
    qualifiers: [], size: 0, alignment: 4,
});
scopedLabels.unit.symbols.push({
    id: 1, kind: 'function', name: 'f', type: 2, range: nodeRange,
    linkage: 'external', definition: true,
});
scopedLabels.unit.nodes = [{
    id: 1, category: 'declaration', kind: 'function-definition', type: 2, symbol: 1,
    range: nodeRange, children: [2],
}, {
    id: 2, category: 'statement', kind: 'compound', range: nodeRange, children: [3, 5],
}, {
    id: 3, category: 'statement', kind: 'label', label: 'done', range: nodeRange, children: [4],
}, {
    id: 4, category: 'statement', kind: 'empty', range: nodeRange, children: [],
}, {
    id: 5, category: 'statement', kind: 'goto', label: 'done', range: nodeRange, children: [],
}];
scopedLabels.unit.declarations = [1];
assert.doesNotThrow(() => validateEnvelope(scopedLabels, 'test-build'),
    'labels and gotos in one function are valid');

const missingFunctionBody = clone(scopedLabels);
missingFunctionBody.unit.nodes[0].children = [];
expectContractFailure(missingFunctionBody, 'NODE_CHILDREN',
    'a function definition without a compound body must be rejected');

const wrongFunctionBody = clone(scopedLabels);
wrongFunctionBody.unit.nodes[0].children = [3];
expectContractFailure(wrongFunctionBody, 'NODE_CHILDREN',
    'a function definition whose last child is not a compound body must be rejected');

const labelOutsideFunction = clone(validFixture);
labelOutsideFunction.unit.nodes = [{
    id: 1, category: 'statement', kind: 'label', label: 'loose', range: nodeRange, children: [2],
}, {
    id: 2, category: 'statement', kind: 'empty', range: nodeRange, children: [],
}];
expectContractFailure(labelOutsideFunction, 'LABEL_SCOPE',
    'a label outside a function must be rejected');

const missingGotoTarget = clone(scopedLabels);
missingGotoTarget.unit.nodes[4].label = 'missing';
expectContractFailure(missingGotoTarget, 'LABEL_SCOPE',
    'a goto target must exist in the same function');

const duplicateLabel = clone(scopedLabels);
duplicateLabel.unit.nodes[1].children = [3, 5, 6];
duplicateLabel.unit.nodes.push({
    id: 6, category: 'statement', kind: 'label', label: 'done', range: nodeRange, children: [7],
}, {
    id: 7, category: 'statement', kind: 'empty', range: nodeRange, children: [],
});
expectContractFailure(duplicateLabel, 'LABEL_SCOPE',
    'duplicate labels in one function must be rejected');

const invalidIfOrdering = clone(scopedLabels);
invalidIfOrdering.unit.nodes[1].children = [6];
invalidIfOrdering.unit.nodes.push({
    id: 6, category: 'statement', kind: 'if', range: nodeRange, children: [4, 4],
});
expectContractFailure(invalidIfOrdering, 'NODE_CHILDREN',
    'an if condition must be an expression and its body must be a statement');

const validPromotion = clone(validFixture);
validPromotion.unit.types.push({
    id: 2, kind: 'builtin', name: 'char', qualifiers: [], size: 1, alignment: 1,
});
validPromotion.unit.nodes = [{
    id: 1, category: 'expression', kind: 'conversion', type: 1, targetType: 1,
    valueCategory: 'rvalue', conversion: 'integer-promotion', range: nodeRange, children: [2],
}, {
    id: 2, category: 'expression', kind: 'character-literal', type: 2,
    valueCategory: 'rvalue', range: nodeRange, children: [],
    constant: { kind: 'integer', bits: 8, signed: true, value: '65' },
}];
assert.doesNotThrow(() => validateEnvelope(validPromotion, 'test-build'),
    'an integer promotion from char to int is valid');

const preservedLvalue = clone(validFixture);
preservedLvalue.unit.types.push({
    id: 2, kind: 'pointer', pointee: 1, qualifiers: [], size: 4, alignment: 4,
}, {
    id: 3, kind: 'array', element: 1, count: 1, qualifiers: [], size: 4, alignment: 4,
});
preservedLvalue.unit.nodes = [{
    id: 1, category: 'expression', kind: 'subscript', type: 1,
    valueCategory: 'lvalue', range: nodeRange, children: [2, 4],
}, {
    id: 2, category: 'expression', kind: 'conversion', type: 2, targetType: 2,
    valueCategory: 'rvalue', conversion: 'array-to-pointer', range: nodeRange, children: [3],
}, {
    id: 3, category: 'expression', kind: 'compound-literal', type: 3, targetType: 3,
    valueCategory: 'lvalue', range: nodeRange, children: [],
}, {
    id: 4, category: 'expression', kind: 'integer-literal', type: 1,
    valueCategory: 'rvalue', range: nodeRange, children: [],
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
}, {
    id: 5, category: 'expression', kind: 'generic-selection', type: 1,
    valueCategory: 'lvalue', memberIndex: 1, range: nodeRange, children: [1],
}];
assert.doesNotThrow(() => validateEnvelope(preservedLvalue, 'test-build'),
    'subscripts are lvalues and generic selections preserve the chosen value category');

const rvalueMember = clone(validFixture);
rvalueMember.unit.types.push({
    id: 2, kind: 'struct', name: 'Pair', complete: true,
    members: [{ name: 'first', type: 1, offset: 0, range: nodeRange }],
    qualifiers: [], size: 4, alignment: 4,
});
rvalueMember.unit.nodes = [{
    id: 1, category: 'expression', kind: 'member', type: 1,
    valueCategory: 'rvalue', memberIndex: 0, range: nodeRange, children: [2],
}, {
    id: 2, category: 'expression', kind: 'conditional', type: 2,
    valueCategory: 'rvalue', operator: '?:', range: nodeRange, children: [3, 4, 6],
}, {
    id: 3, category: 'expression', kind: 'integer-literal', type: 1,
    valueCategory: 'rvalue', range: nodeRange, children: [],
    constant: { kind: 'integer', bits: 32, signed: true, value: '1' },
}, {
    id: 4, category: 'expression', kind: 'conversion', type: 2, targetType: 2,
    valueCategory: 'rvalue', conversion: 'lvalue-to-rvalue', range: nodeRange, children: [5],
}, {
    id: 5, category: 'expression', kind: 'compound-literal', type: 2, targetType: 2,
    valueCategory: 'lvalue', range: nodeRange, children: [],
}, {
    id: 6, category: 'expression', kind: 'conversion', type: 2, targetType: 2,
    valueCategory: 'rvalue', conversion: 'lvalue-to-rvalue', range: nodeRange, children: [7],
}, {
    id: 7, category: 'expression', kind: 'compound-literal', type: 2, targetType: 2,
    valueCategory: 'lvalue', range: nodeRange, children: [],
}];
assert.doesNotThrow(() => validateEnvelope(rvalueMember, 'test-build'),
    'dot member access on an rvalue aggregate remains an rvalue');

const wrongRvalueMember = clone(rvalueMember);
wrongRvalueMember.unit.nodes[0].valueCategory = 'lvalue';
expectContractFailure(wrongRvalueMember, 'NODE_EXPRESSION_METADATA',
    'dot member access must inherit its aggregate base value category');

const enumeratorReference = clone(validFixture);
enumeratorReference.unit.types.push({
    id: 2, kind: 'enum', name: 'Choice', underlyingType: 3,
    enumerators: [{ name: 'choice', value: '1', range: nodeRange }],
    qualifiers: [], size: 4, alignment: 4,
}, {
    id: 3, kind: 'builtin', name: 'int', qualifiers: [], size: 4, alignment: 4,
});
enumeratorReference.unit.symbols.push({
    id: 1, kind: 'enum', name: 'Choice', type: 2, range: nodeRange,
}, {
    id: 2, kind: 'enumerator', name: 'choice', type: 2, owner: 1, range: nodeRange,
    value: { kind: 'integer', bits: 32, signed: true, value: '1' },
});
enumeratorReference.unit.nodes.push({
    id: 1, category: 'expression', kind: 'declaration-reference', symbol: 2, type: 1,
    valueCategory: 'rvalue', range: nodeRange, children: [],
});
assert.doesNotThrow(() => validateEnvelope(enumeratorReference, 'test-build'),
    'an enumerator reference may use its promoted integer expression type');

const emptyConversion = clone(validPromotion);
emptyConversion.unit.nodes[0].children = [];
expectContractFailure(emptyConversion, 'NODE_CHILDREN',
    'every conversion must have exactly one expression child');

const mismatchedConversionTarget = clone(validPromotion);
mismatchedConversionTarget.unit.nodes[0].targetType = 2;
expectContractFailure(mismatchedConversionTarget, 'NODE_CONVERSION',
    'conversion type and targetType must agree');

const rvalueLoad = clone(validPromotion);
rvalueLoad.unit.nodes[0].conversion = 'lvalue-to-rvalue';
expectContractFailure(rvalueLoad, 'NODE_CONVERSION',
    'lvalue-to-rvalue must not accept an rvalue child');

const invalidArrayDecay = clone(validPromotion);
invalidArrayDecay.unit.nodes[0].conversion = 'array-to-pointer';
expectContractFailure(invalidArrayDecay, 'NODE_CONVERSION',
    'array-to-pointer must require an array source and matching pointer target');

const missingCaseValue = clone(scopedLabels);
missingCaseValue.unit.nodes[1].children = [6];
missingCaseValue.unit.nodes.push({
    id: 6, category: 'statement', kind: 'case', range: nodeRange, children: [7, 8],
}, {
    id: 7, category: 'expression', kind: 'integer-literal', type: 1,
    valueCategory: 'rvalue', range: nodeRange, children: [],
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
}, {
    id: 8, category: 'statement', kind: 'empty', range: nodeRange, children: [],
});
expectContractFailure(missingCaseValue, 'STRUCTURE_VALIDATION',
    'a case node without its evaluated integer constant must be rejected');

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
    children: [2],
    conversion: 'assignment',
    targetType: 2,
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
}, {
    id: 2,
    category: 'expression',
    kind: 'integer-literal',
    range: nodeRange,
    type: 1,
    valueCategory: 'rvalue',
    children: [],
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
});
assert.doesNotThrow(() => validateEnvelope(nullPointer, 'test-build'),
    'canonical integer zero may represent a converted null pointer');

const pointerConversions = clone(validFixture);
pointerConversions.unit.types.push({
    id: 2, kind: 'pointer', pointee: 1, qualifiers: [], size: 4, alignment: 4,
});
pointerConversions.unit.symbols.push({
    id: 1, kind: 'variable', name: 'pointer', type: 2, range: nodeRange,
    linkage: 'none', storage: 'automatic', definition: true,
});
pointerConversions.unit.nodes.push({
    id: 1, category: 'expression', kind: 'conversion', range: nodeRange,
    type: 1, valueCategory: 'rvalue', children: [2],
    conversion: 'pointer-to-int', targetType: 1,
}, {
    id: 2, category: 'expression', kind: 'declaration-reference', range: nodeRange,
    type: 2, valueCategory: 'lvalue', children: [], symbol: 1,
}, {
    id: 3, category: 'expression', kind: 'conversion', range: nodeRange,
    type: 2, valueCategory: 'rvalue', children: [4],
    conversion: 'null-to-pointer', targetType: 2,
}, {
    id: 4, category: 'expression', kind: 'integer-literal', range: nodeRange,
    type: 1, valueCategory: 'rvalue', children: [],
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
});
assert.doesNotThrow(() => validateEnvelope(pointerConversions, 'test-build'),
    'pointer and null implicit conversions must retain their source and target kinds');

const qualifiedAggregateConversions = clone(validFixture);
qualifiedAggregateConversions.unit.types.push({
    id: 2, kind: 'struct', name: 'QualifiedPair', complete: true,
    nominalId: 10,
    members: [{ name: 'value', type: 1, offset: 0, range: nodeRange }],
    qualifiers: [], size: 4, alignment: 4,
}, {
    id: 3, kind: 'struct', name: 'QualifiedPair', complete: true,
    nominalId: 10,
    members: [{ name: 'value', type: 1, offset: 0, range: nodeRange }],
    qualifiers: ['const'], size: 4, alignment: 4,
}, {
    id: 4, kind: 'builtin', name: 'int', qualifiers: [], size: 4, alignment: 4,
}, {
    id: 5, kind: 'pointer', pointee: 4, qualifiers: [], size: 4, alignment: 4,
}, {
    id: 6, kind: 'pointer', pointee: 1, qualifiers: [], size: 4, alignment: 4,
});
qualifiedAggregateConversions.unit.symbols.push({
    id: 1, kind: 'variable', name: 'qualified', type: 3, range: nodeRange,
    linkage: 'none', storage: 'automatic', definition: true,
}, {
    id: 2, kind: 'variable', name: 'pointer', type: 5, range: nodeRange,
    linkage: 'none', storage: 'automatic', definition: true,
});
qualifiedAggregateConversions.unit.nodes.push({
    id: 1, category: 'expression', kind: 'conversion', range: nodeRange,
    type: 2, valueCategory: 'rvalue', children: [2],
    conversion: 'lvalue-to-rvalue', targetType: 2,
}, {
    id: 2, category: 'expression', kind: 'declaration-reference', range: nodeRange,
    type: 3, valueCategory: 'lvalue', children: [], symbol: 1,
}, {
    id: 3, category: 'expression', kind: 'conversion', range: nodeRange,
    type: 2, valueCategory: 'rvalue', children: [4],
    conversion: 'assignment', targetType: 2,
}, {
    id: 4, category: 'expression', kind: 'declaration-reference', range: nodeRange,
    type: 3, valueCategory: 'lvalue', children: [], symbol: 1,
}, {
    id: 5, category: 'expression', kind: 'conversion', range: nodeRange,
    type: 6, valueCategory: 'rvalue', children: [6],
    conversion: 'no-op', targetType: 6,
}, {
    id: 6, category: 'expression', kind: 'declaration-reference', range: nodeRange,
    type: 5, valueCategory: 'lvalue', children: [], symbol: 2,
});
assert.doesNotThrow(() => validateEnvelope(qualifiedAggregateConversions, 'test-build'),
    'qualified aggregate and pointer conversions must compare nominal type shape');

const unrelatedQualifiedAggregate = clone(qualifiedAggregateConversions);
unrelatedQualifiedAggregate.unit.types.find((type) => type.id === 3).nominalId = 11;
expectContractFailure(unrelatedQualifiedAggregate, 'NODE_CONVERSION',
    'same-shaped aggregates from different declarations must not compare as equivalent');

const recursiveQualifiedAggregate = clone(validFixture);
recursiveQualifiedAggregate.unit.types.push({
    id: 2, kind: 'struct', name: 'Recursive', nominalId: 20, complete: true,
    members: [{ name: 'next', type: 3, offset: 0, range: nodeRange }],
    qualifiers: [], size: 4, alignment: 4,
}, {
    id: 3, kind: 'pointer', pointee: 2, qualifiers: [], size: 4, alignment: 4,
}, {
    id: 4, kind: 'struct', name: 'Recursive', nominalId: 20, complete: true,
    members: [{ name: 'next', type: 5, offset: 0, range: nodeRange }],
    qualifiers: ['const'], size: 4, alignment: 4,
}, {
    id: 5, kind: 'pointer', pointee: 4, qualifiers: [], size: 4, alignment: 4,
});
recursiveQualifiedAggregate.unit.symbols.push({
    id: 1, kind: 'variable', name: 'recursive', type: 4, range: nodeRange,
    linkage: 'none', storage: 'automatic', definition: true,
});
recursiveQualifiedAggregate.unit.nodes.push({
    id: 1, category: 'expression', kind: 'conversion', range: nodeRange,
    type: 2, valueCategory: 'rvalue', children: [2],
    conversion: 'lvalue-to-rvalue', targetType: 2,
}, {
    id: 2, category: 'expression', kind: 'declaration-reference', range: nodeRange,
    type: 4, valueCategory: 'lvalue', children: [], symbol: 1,
});
assert.doesNotThrow(() => validateEnvelope(recursiveQualifiedAggregate, 'test-build'),
    'recursive aggregate qualifier comparisons must terminate at repeated type pairs');

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
    children: [3],
}, {
    id: 3, category: 'statement', kind: 'compound',
    range: nodeRange, children: [],
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
    valueCategory: 'rvalue', children: [2], conversion: 'assignment', targetType: 3,
    range: {
        file: 1,
        start: { line: 1, column: 1, byteOffset: 0 },
        end: { line: 1, column: 2, byteOffset: 1 },
    },
    constant: { kind: 'address', symbol: 1, addend: '4' },
}, {
    id: 2, category: 'expression', kind: 'integer-literal', type: 1,
    valueCategory: 'rvalue', children: [],
    range: nodeRange,
    constant: { kind: 'integer', bits: 32, signed: true, value: '0' },
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
    { id: 1, kind: 'builtin', name: 'int', qualifiers: [], size: 4, alignment: 4 },
    { id: 2, kind: 'typedef', name: 'Int', target: 1, qualifiers: [], size: 4, alignment: 4 },
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
