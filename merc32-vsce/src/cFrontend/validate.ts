import Ajv, { ErrorObject } from 'ajv';

import {
    AggregateMemberRecord,
    BuiltinTypeName,
    CFrontendDiagnostic,
    SourceFileId,
    SourceFileRecord,
    SourceRange,
    SymbolId,
    TypedCEnvelopeV1,
    TypedCUnitV1,
    TypedConstant,
    TypedInitializer,
    TypedNodeKind,
    TypedNodeRecord,
    TypedSymbolRecord,
    TypedTypeRecord,
    TypeId,
} from './contract';
import { HARD_C_FRONTEND_LIMITS } from './limits';
import { MERC32_ABI } from './merc32Abi';

export class CFrontendInternalError extends Error {
    public readonly name = 'CFrontendInternalError';

    public constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

type JsonSchema = Readonly<Record<string, unknown>>;

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const idSchema: JsonSchema = { type: 'integer', minimum: 1, maximum: MAX_SAFE_INTEGER };
const nonNegativeIntegerSchema: JsonSchema = {
    type: 'integer', minimum: 0, maximum: MAX_SAFE_INTEGER,
};
const positiveIntegerSchema: JsonSchema = {
    type: 'integer', minimum: 1, maximum: MAX_SAFE_INTEGER,
};
const CANONICAL_DECIMAL_PATTERN = '^(0|-[1-9][0-9]*|[1-9][0-9]*)$';
const rangeReference: JsonSchema = { $ref: '#/$defs/range' };
const constantReference: JsonSchema = { $ref: '#/$defs/constant' };

function objectSchema(
    properties: Readonly<Record<string, JsonSchema>>,
    required: readonly string[],
): JsonSchema {
    return { type: 'object', additionalProperties: false, properties, required };
}

const positionSchema = objectSchema({
    line: positiveIntegerSchema,
    column: positiveIntegerSchema,
    byteOffset: nonNegativeIntegerSchema,
}, ['line', 'column', 'byteOffset']);

const rangeSchema = objectSchema({
    file: idSchema,
    start: positionSchema,
    end: positionSchema,
}, ['file', 'start', 'end']);

const integerConstantSchema = objectSchema({
    kind: { const: 'integer' },
    bits: { type: 'integer', minimum: 1, maximum: 1024 },
    signed: { type: 'boolean' },
    value: { type: 'string', pattern: CANONICAL_DECIMAL_PATTERN },
}, ['kind', 'bits', 'signed', 'value']);

const floatingConstantSchema = objectSchema({
    kind: { const: 'floating' },
    type: idSchema,
    ieeeBits: { type: 'string', pattern: '^[0-9A-Fa-f]+$' },
}, ['kind', 'type', 'ieeeBits']);

const addressConstantSchema = objectSchema({
    kind: { const: 'address' },
    symbol: idSchema,
    addend: { type: 'string', pattern: CANONICAL_DECIMAL_PATTERN },
}, ['kind', 'symbol', 'addend']);

const stringConstantSchema = objectSchema({
    kind: { const: 'string' },
    elementType: idSchema,
    bytes: {
        type: 'array',
        items: { type: 'integer', minimum: 0, maximum: 255 },
    },
}, ['kind', 'elementType', 'bytes']);

const constantSchema: JsonSchema = {
    oneOf: [integerConstantSchema, floatingConstantSchema, addressConstantSchema, stringConstantSchema],
};

const initializerWriteSchema = objectSchema({
    offset: nonNegativeIntegerSchema,
    type: idSchema,
    value: constantReference,
}, ['offset', 'type', 'value']);

const initializerSchema = objectSchema({
    size: nonNegativeIntegerSchema,
    zeroFill: { const: true },
    writes: { type: 'array', items: initializerWriteSchema },
}, ['size', 'zeroFill', 'writes']);

const qualifierSchema: JsonSchema = {
    type: 'array',
    uniqueItems: true,
    items: { enum: ['const', 'volatile', 'restrict', 'atomic'] },
};

const typeBaseProperties: Readonly<Record<string, JsonSchema>> = {
    id: idSchema,
    qualifiers: qualifierSchema,
    size: nonNegativeIntegerSchema,
    alignment: positiveIntegerSchema,
};

function typeSchema(
    kind: string,
    properties: Readonly<Record<string, JsonSchema>>,
    required: readonly string[],
): JsonSchema {
    return objectSchema(
        { ...typeBaseProperties, kind: { const: kind }, ...properties },
        ['id', 'kind', 'qualifiers', 'size', 'alignment', ...required],
    );
}

const builtinNames: readonly BuiltinTypeName[] = [
    'void', '_Bool', 'char', 'signed char', 'unsigned char', 'short', 'unsigned short',
    'int', 'unsigned int', 'long', 'unsigned long', 'long long', 'unsigned long long',
    'float', 'double', 'long double',
];

const aggregateMemberSchema = objectSchema({
    name: { type: 'string' },
    type: idSchema,
    offset: nonNegativeIntegerSchema,
    bitOffset: nonNegativeIntegerSchema,
    bitWidth: positiveIntegerSchema,
    range: rangeReference,
}, ['name', 'type', 'offset', 'range']);

const enumValueSchema = objectSchema({
    name: { type: 'string', minLength: 1 },
    value: { type: 'string', pattern: CANONICAL_DECIMAL_PATTERN },
    range: rangeReference,
}, ['name', 'value', 'range']);

const typeRecordSchema: JsonSchema = {
    oneOf: [
        typeSchema('builtin', { name: { enum: builtinNames } }, ['name']),
        typeSchema('pointer', { pointee: idSchema }, ['pointee']),
        typeSchema('array', { element: idSchema, count: nonNegativeIntegerSchema }, ['element', 'count']),
        typeSchema('function', {
            returnType: idSchema,
            parameters: { type: 'array', items: idSchema },
            variadic: { type: 'boolean' },
        }, ['returnType', 'parameters', 'variadic']),
        typeSchema('struct', {
            name: { type: 'string' },
            nominalId: idSchema,
            complete: { type: 'boolean' },
            members: { type: 'array', items: aggregateMemberSchema },
        }, ['complete', 'members']),
        typeSchema('union', {
            name: { type: 'string' },
            nominalId: idSchema,
            complete: { type: 'boolean' },
            members: { type: 'array', items: aggregateMemberSchema },
        }, ['complete', 'members']),
        typeSchema('enum', {
            name: { type: 'string' },
            nominalId: idSchema,
            underlyingType: idSchema,
            enumerators: { type: 'array', items: enumValueSchema },
        }, ['underlyingType', 'enumerators']),
        typeSchema('typedef', { name: { type: 'string', minLength: 1 }, target: idSchema }, ['name', 'target']),
    ],
};

const symbolBaseProperties: Readonly<Record<string, JsonSchema>> = {
    id: idSchema,
    name: { type: 'string', minLength: 1 },
    range: rangeReference,
};

function symbolSchema(
    kind: string,
    properties: Readonly<Record<string, JsonSchema>>,
    required: readonly string[],
): JsonSchema {
    return objectSchema(
        { ...symbolBaseProperties, kind: { const: kind }, ...properties },
        ['id', 'kind', 'name', 'range', ...required],
    );
}

const symbolRecordSchema: JsonSchema = {
    oneOf: [
        symbolSchema('variable', {
            type: idSchema,
            linkage: { enum: ['none', 'internal', 'external'] },
            storage: { enum: ['automatic', 'static', 'extern', 'register', 'thread'] },
            definition: { type: 'boolean' },
            initializer: initializerSchema,
        }, ['type', 'linkage', 'storage', 'definition']),
        symbolSchema('function', {
            type: idSchema,
            linkage: { enum: ['internal', 'external'] },
            definition: { type: 'boolean' },
        }, ['type', 'linkage', 'definition']),
        symbolSchema('parameter', { type: idSchema, owner: idSchema }, ['type', 'owner']),
        symbolSchema('typedef', { type: idSchema }, ['type']),
        symbolSchema('record', { type: idSchema }, ['type']),
        symbolSchema('enum', { type: idSchema }, ['type']),
        symbolSchema('enumerator', {
            type: idSchema,
            owner: idSchema,
            value: integerConstantSchema,
        }, ['type', 'owner', 'value']),
        symbolSchema('label', { owner: idSchema }, ['owner']),
    ],
};

const nodeBaseProperties: Readonly<Record<string, JsonSchema>> = {
    id: idSchema,
    range: rangeReference,
    spellingRange: rangeReference,
    children: { type: 'array', items: idSchema },
};

function nodeSchema(
    kind: TypedNodeKind,
    category: 'expression' | 'statement' | 'declaration',
    properties: Readonly<Record<string, JsonSchema>> = {},
    required: readonly string[] = [],
): JsonSchema {
    return objectSchema({
        ...nodeBaseProperties,
        kind: { const: kind },
        category: { const: category },
        ...properties,
    }, ['id', 'category', 'kind', 'range', 'children', ...required]);
}

const declarationKinds = [
    'variable-declaration', 'function-declaration', 'function-definition',
    'parameter-declaration', 'typedef-declaration', 'record-declaration', 'enum-declaration',
] as const;
const plainStatementKinds = [
    'compound', 'declaration-statement', 'expression-statement', 'return', 'if', 'while',
    'do-while', 'for', 'switch', 'default', 'break', 'continue', 'empty',
] as const;
const expressionProperties: Readonly<Record<string, JsonSchema>> = {
    type: idSchema,
    valueCategory: { enum: ['lvalue', 'function', 'rvalue'] },
    constant: constantReference,
};

function expressionSchema(
    kind: TypedNodeKind,
    properties: Readonly<Record<string, JsonSchema>> = {},
    required: readonly string[] = [],
): JsonSchema {
    return nodeSchema(kind, 'expression', {
        ...expressionProperties,
        ...properties,
    }, ['type', 'valueCategory', ...required]);
}

const nodeRecordSchema: JsonSchema = {
    oneOf: [
        ...declarationKinds.map((kind) => nodeSchema(
            kind, 'declaration', { type: idSchema, symbol: idSchema }, ['type', 'symbol'])),
        nodeSchema('static-assert', 'declaration'),
        ...plainStatementKinds.map((kind) => nodeSchema(kind, 'statement')),
        nodeSchema('case', 'statement', { caseValue: integerConstantSchema }, ['caseValue']),
        nodeSchema('goto', 'statement', { label: { type: 'string', minLength: 1 } }, ['label']),
        nodeSchema('label', 'statement', { label: { type: 'string', minLength: 1 } }, ['label']),
        expressionSchema('integer-literal', { constant: integerConstantSchema }, ['constant']),
        expressionSchema('character-literal', { constant: integerConstantSchema }, ['constant']),
        expressionSchema('floating-literal', { constant: floatingConstantSchema }, ['constant']),
        expressionSchema('string-literal', { constant: stringConstantSchema }, ['constant']),
        expressionSchema('declaration-reference', { symbol: idSchema }, ['symbol']),
        ...(['unary', 'binary', 'conditional', 'assignment'] as const).map((kind) =>
            expressionSchema(kind, { operator: { type: 'string', minLength: 1 } }, ['operator'])),
        expressionSchema('call'),
        expressionSchema('subscript'),
        expressionSchema('member', { memberIndex: nonNegativeIntegerSchema }, ['memberIndex']),
        expressionSchema('sizeof', {
            targetType: idSchema, constant: integerConstantSchema,
        }, ['targetType', 'constant']),
        expressionSchema('alignof', {
            targetType: idSchema, constant: integerConstantSchema,
        }, ['targetType', 'constant']),
        expressionSchema('conversion', {
            conversion: { enum: [
                'lvalue-to-rvalue', 'array-to-pointer', 'function-to-pointer',
                'integer-promotion', 'usual-arithmetic', 'assignment', 'argument', 'return',
                'no-op', 'bitcast', 'pointer-to-bool', 'pointer-to-int', 'bool-to-int',
                'bool-to-float', 'bool-to-pointer', 'int-to-bool', 'int-to-float',
                'complex-int-to-complex-float', 'int-to-pointer', 'float-to-bool',
                'float-to-int', 'complex-float-to-complex-int', 'int-cast',
                'complex-int-cast', 'complex-int-to-real', 'real-to-complex-int',
                'float-cast', 'complex-float-cast', 'complex-float-to-real',
                'real-to-complex-float', 'to-void', 'null-to-pointer', 'union-cast',
                'vector-splat', 'atomic-to-non-atomic', 'non-atomic-to-atomic',
            ] },
            targetType: idSchema,
        }, ['conversion', 'targetType']),
        expressionSchema('compound-literal', { targetType: idSchema }, ['targetType']),
        expressionSchema('generic-selection', { memberIndex: nonNegativeIntegerSchema }, ['memberIndex']),
    ],
};

const sourceFileSchema = objectSchema({
    id: idSchema,
    path: { type: 'string', minLength: 1 },
    byteLength: nonNegativeIntegerSchema,
    utf8BoundaryBitmap: { type: 'string' },
}, ['id', 'path', 'byteLength', 'utf8BoundaryBitmap']);

const diagnosticSchema = objectSchema({
    severity: { enum: ['note', 'warning', 'error', 'fatal'] },
    code: { type: 'string', minLength: 1 },
    message: { type: 'string', minLength: 1 },
    range: rangeReference,
    related: {
        type: 'array',
        items: objectSchema({
            message: { type: 'string', minLength: 1 },
            range: rangeReference,
        }, ['message', 'range']),
    },
    notes: { type: 'array', items: { type: 'string' } },
    includeTrace: { type: 'array', items: rangeReference },
    macroExpansionTrace: { type: 'array', items: rangeReference },
}, [
    'severity', 'code', 'message', 'range', 'related', 'notes',
    'includeTrace', 'macroExpansionTrace',
]);

const unitSchema = objectSchema({
    schema: { type: 'string' },
    schemaVersion: { type: 'integer' },
    target: { type: 'string' },
    abi: { type: 'string' },
    dataModel: { type: 'string' },
    language: { type: 'string' },
    sourceFiles: { type: 'array', items: sourceFileSchema },
    types: { type: 'array', items: typeRecordSchema },
    symbols: { type: 'array', items: symbolRecordSchema },
    nodes: { type: 'array', items: nodeRecordSchema },
    declarations: { type: 'array', items: idSchema },
}, [
    'schema', 'schemaVersion', 'target', 'abi', 'dataModel', 'language',
    'sourceFiles', 'types', 'symbols', 'nodes', 'declarations',
]);

const envelopeSchema: JsonSchema = {
    ...objectSchema({
        protocolVersion: { type: 'integer' },
        bridgeBuildId: { type: 'string', minLength: 1 },
        status: { enum: ['ok', 'diagnostics', 'internal-error'] },
        diagnostics: { type: 'array', items: diagnosticSchema },
        sourceFiles: { type: 'array', items: sourceFileSchema },
        unit: { $ref: '#/$defs/unit' },
    }, ['protocolVersion', 'bridgeBuildId', 'status', 'diagnostics']),
    $defs: {
        range: rangeSchema,
        integerConstant: integerConstantSchema,
        constant: constantSchema,
        unit: unitSchema,
    },
};

const ajv = new Ajv({
    allErrors: true,
    strict: true,
    coerceTypes: false,
    removeAdditional: false,
    useDefaults: false,
});
const structurallyValid = ajv.compile<TypedCEnvelopeV1>(envelopeSchema);

const NODE_KINDS = new Set<TypedNodeKind>([
    ...declarationKinds,
    'static-assert',
    ...plainStatementKinds, 'case',
    'goto', 'label',
    'integer-literal', 'floating-literal', 'character-literal', 'string-literal',
    'declaration-reference', 'unary', 'binary', 'conditional', 'assignment',
    'call', 'subscript', 'member', 'sizeof', 'alignof', 'conversion',
    'compound-literal', 'generic-selection',
]);
const TYPE_KINDS = new Set(['builtin', 'pointer', 'array', 'function', 'struct', 'union', 'enum', 'typedef']);
const SYMBOL_KINDS = new Set([
    'variable', 'function', 'parameter', 'typedef', 'record', 'enum', 'enumerator', 'label',
]);
const CONSTANT_KINDS = new Set(['integer', 'floating', 'address', 'string']);
const ENVELOPE_STATUSES = new Set(['ok', 'diagnostics', 'internal-error']);

export function validateEnvelope(value: unknown, expectedBuildId: string): TypedCEnvelopeV1 {
    if (!structurallyValid(value)) {
        throw structuralError(value, structurallyValid.errors ?? []);
    }

    const envelope = cloneJson(value, '$') as unknown as TypedCEnvelopeV1;
    validateEnvelopeSemantics(envelope, expectedBuildId);
    return deepFreeze(envelope);
}

export function normalizeDiagnostics(
    records: readonly CFrontendDiagnostic[],
): readonly CFrontendDiagnostic[] {
    const cloned = records.map((record, index) =>
        cloneJson(record, `$[${index}]`) as unknown as CFrontendDiagnostic);
    const severityOrder: Readonly<Record<CFrontendDiagnostic['severity'], number>> = {
        fatal: 0, error: 1, warning: 2, note: 3,
    };
    cloned.sort((left, right) =>
        left.range.file - right.range.file
        || left.range.start.byteOffset - right.range.start.byteOffset
        || severityOrder[left.severity] - severityOrder[right.severity]
        || left.code.localeCompare(right.code)
        || left.message.localeCompare(right.message));
    const unique: CFrontendDiagnostic[] = [];
    const seen = new Set<string>();
    for (const record of cloned) {
        const key = JSON.stringify(record);
        if (!seen.has(key)) {
            unique.push(record);
            seen.add(key);
        }
    }
    return deepFreeze(unique);
}

export function hasErrors(diagnostics: readonly CFrontendDiagnostic[]): boolean {
    return diagnostics.some((diagnostic) =>
        diagnostic.severity === 'error' || diagnostic.severity === 'fatal');
}

function structuralError(value: unknown, errors: readonly ErrorObject[]): CFrontendInternalError {
    const status = isObject(value) ? value.status : undefined;
    if (typeof status === 'string' && !ENVELOPE_STATUSES.has(status)) {
        return failure('STATUS_KIND', `unknown envelope status ${JSON.stringify(status)}`);
    }
    const unit = isObject(value) ? value.unit : undefined;
    const types = isObject(unit) && Array.isArray(unit.types) ? unit.types : [];
    for (const type of types) {
        if (isObject(type) && typeof type.kind === 'string' && !TYPE_KINDS.has(type.kind)) {
            return failure('TYPE_KIND', `unknown type kind ${JSON.stringify(type.kind)}`);
        }
        if (isObject(type) && type.kind === 'enum' && Array.isArray(type.enumerators)
            && type.enumerators.some((value) => isObject(value) && value.value === '-0')) {
            return failure('INTEGER_CONSTANT', 'enum value must be a canonical decimal integer string');
        }
    }
    const symbols = isObject(unit) && Array.isArray(unit.symbols) ? unit.symbols : [];
    for (const symbol of symbols) {
        if (isObject(symbol) && typeof symbol.kind === 'string' && !SYMBOL_KINDS.has(symbol.kind)) {
            return failure('SYMBOL_KIND', `unknown symbol kind ${JSON.stringify(symbol.kind)}`);
        }
    }
    const nodes = isObject(unit) && Array.isArray(unit.nodes) ? unit.nodes : [];
    for (const node of nodes) {
        if (isObject(node) && typeof node.kind === 'string'
            && !NODE_KINDS.has(node.kind as TypedNodeKind)) {
            return failure('NODE_KIND', `unknown node kind ${JSON.stringify(node.kind)}`);
        }
        if (isObject(node) && node.category === 'expression'
            && (node.type === undefined || node.valueCategory === undefined)) {
            return failure('NODE_EXPRESSION_METADATA',
                'every expression must carry both type and valueCategory');
        }
    }
    for (const constant of collectStructuralConstants(unit)) {
        if (typeof constant.kind === 'string' && !CONSTANT_KINDS.has(constant.kind)) {
            return failure('CONSTANT_KIND', `unknown constant kind ${JSON.stringify(constant.kind)}`);
        }
        if (constant.kind === 'integer' && constant.value === '-0') {
            return failure('INTEGER_CONSTANT',
                'integer constant must be a canonical decimal integer string');
        }
        if (constant.kind === 'address' && constant.addend === '-0') {
            return failure('ADDRESS_CONSTANT',
                'address addend must be a canonical decimal integer string');
        }
    }
    const additional = errors.find((error) => error.keyword === 'additionalProperties');
    if (additional !== undefined) {
        const property = String((additional.params as { additionalProperty?: unknown }).additionalProperty);
        return failure('STRUCTURE_CLOSED',
            `unknown field ${JSON.stringify(property)} at ${additional.instancePath || '$'}`);
    }
    const first = errors[0];
    return failure('STRUCTURE_VALIDATION', first === undefined
        ? 'value does not match the v1 JSON vocabulary'
        : `${first.instancePath || '$'} ${first.message ?? 'is invalid'}`);
}

function collectStructuralConstants(unit: unknown): readonly Record<string, unknown>[] {
    if (!isObject(unit)) {
        return [];
    }
    const constants: Record<string, unknown>[] = [];
    if (Array.isArray(unit.nodes)) {
        for (const node of unit.nodes) {
            if (isObject(node) && isObject(node.constant)) {
                constants.push(node.constant);
            }
        }
    }
    if (Array.isArray(unit.symbols)) {
        for (const symbol of unit.symbols) {
            if (!isObject(symbol)) {
                continue;
            }
            if (isObject(symbol.value)) {
                constants.push(symbol.value);
            }
            if (isObject(symbol.initializer) && Array.isArray(symbol.initializer.writes)) {
                for (const write of symbol.initializer.writes) {
                    if (isObject(write) && isObject(write.value)) {
                        constants.push(write.value);
                    }
                }
            }
        }
    }
    return constants;
}

function validateEnvelopeSemantics(envelope: TypedCEnvelopeV1, expectedBuildId: string): void {
    assertInvariant(envelope.protocolVersion === 1, 'ENVELOPE_IDENTITY',
        'protocolVersion must be exactly 1');
    assertInvariant(envelope.bridgeBuildId === expectedBuildId, 'BUILD_ID',
        `bridgeBuildId ${JSON.stringify(envelope.bridgeBuildId)} does not match the expected build`);
    assertInvariant(envelope.status === 'ok' ? envelope.unit !== undefined : envelope.unit === undefined,
        'STATUS_CONSISTENCY', 'status ok requires a unit and non-ok status forbids a unit');
    assertInvariant(envelope.status !== 'ok' || envelope.sourceFiles === undefined,
        'STATUS_CONSISTENCY', 'status ok forbids envelope sourceFiles; use unit.sourceFiles');
    assertInvariant(envelope.status !== 'ok' || !hasErrors(envelope.diagnostics),
        'STATUS_CONSISTENCY', 'status ok cannot carry error or fatal diagnostics');

    if (envelope.unit === undefined) {
        assertInvariant(envelope.diagnostics.length === 0 || envelope.sourceFiles !== undefined,
            'FAILURE_SOURCE_FILES', 'a non-ok envelope with ranged diagnostics requires sourceFiles');
        const files = envelope.sourceFiles === undefined
            ? undefined
            : validateSourceFileTable(envelope.sourceFiles);
        const positions = createSourcePositionCoherence();
        for (const diagnostic of envelope.diagnostics) {
            validateRange(diagnostic.range, files, 'diagnostic range', positions);
            for (const related of diagnostic.related) {
                validateRange(related.range, files, 'related diagnostic range', positions);
            }
            diagnostic.includeTrace.forEach((range) =>
                validateRange(range, files, 'include trace', positions));
            diagnostic.macroExpansionTrace.forEach((range) =>
                validateRange(range, files, 'macro expansion trace', positions));
        }
        return;
    }
    validateUnit(envelope.unit, envelope.diagnostics);
}

function validateUnit(unit: TypedCUnitV1, diagnostics: readonly CFrontendDiagnostic[]): void {
    assertInvariant(
        unit.schema === 'merc32.typed-c-unit'
        && unit.schemaVersion === 1
        && unit.target === MERC32_ABI.target
        && unit.abi === MERC32_ABI.abi
        && unit.dataModel === MERC32_ABI.dataModel
        && unit.language === 'c17-freestanding',
        'UNIT_IDENTITY',
        'unit identities must be merc32.typed-c-unit v1 for merc32/merc32-c-v1/merc32-ilp32/c17-freestanding',
    );

    const files = validateSourceFileTable(unit.sourceFiles);
    const types = uniqueMap(unit.types, 'type');
    const symbols = uniqueMap(unit.symbols, 'symbol');
    const nodes = uniqueMap(unit.nodes, 'node');

    const positions = createSourcePositionCoherence();
    const checkRange = (range: SourceRange, label: string): void =>
        validateRange(range, files, label, positions);
    for (const diagnostic of diagnostics) {
        checkRange(diagnostic.range, 'diagnostic range');
        diagnostic.related.forEach((related) => checkRange(related.range, 'related diagnostic range'));
        diagnostic.includeTrace.forEach((range) => checkRange(range, 'include trace'));
        diagnostic.macroExpansionTrace.forEach((range) => checkRange(range, 'macro expansion trace'));
    }
    for (const type of unit.types) {
        if (type.kind === 'struct' || type.kind === 'union') {
            type.members.forEach((member) => checkRange(member.range, `${type.kind} member`));
        } else if (type.kind === 'enum') {
            type.enumerators.forEach((enumerator) => checkRange(enumerator.range, 'enum value'));
        }
    }
    unit.symbols.forEach((symbol) => checkRange(symbol.range, `${symbol.kind} symbol`));
    unit.nodes.forEach((node) => {
        checkRange(node.range, `${node.kind} node`);
        if (node.spellingRange !== undefined) {
            checkRange(node.spellingRange, `${node.kind} node spelling range`);
            assertInvariant(!sameRange(node.range, node.spellingRange), 'SOURCE_RANGE',
                `${node.kind} node ${node.id} repeats its primary range as spellingRange`);
        }
    });

    validateTypeReferences(unit.types, types);
    rejectByValueCycles(unit.types, types);
    validateTypeLayouts(unit.types, types);
    validateSymbols(unit.symbols, types, symbols);
    validateNodes(unit.nodes, unit.declarations, types, symbols, nodes);
}

function validateSourceFileTable(
    sourceFiles: readonly SourceFileRecord[],
): ReadonlyMap<number, SourceFileRecord> {
    assertInvariant(sourceFiles.length <= HARD_C_FRONTEND_LIMITS.fileCount,
        'SOURCE_LIMIT', 'source file count exceeds the hard frontend limit');
    let totalSourceBytes = 0;
    for (const file of sourceFiles) {
        assertInvariant(file.byteLength <= HARD_C_FRONTEND_LIMITS.fileBytes,
            'SOURCE_LIMIT', `source file ${file.path} exceeds the per-file byte limit`);
        totalSourceBytes += file.byteLength;
        assertInvariant(Number.isSafeInteger(totalSourceBytes)
            && totalSourceBytes <= HARD_C_FRONTEND_LIMITS.totalSourceBytes,
        'SOURCE_LIMIT', 'total source byte length exceeds the hard frontend limit');
        validateUtf8BoundaryBitmap(file);
    }
    return uniqueMap(sourceFiles, 'source file');
}

function validateUtf8BoundaryBitmap(file: SourceFileRecord): void {
    const expectedBytes = Math.ceil((file.byteLength + 1) / 8);
    assertInvariant(/^[0-9a-f]+$/u.test(file.utf8BoundaryBitmap), 'SOURCE_BOUNDARIES',
        `source file ${file.path} boundary bitmap must use canonical lowercase hexadecimal`);
    assertInvariant(file.utf8BoundaryBitmap.length === expectedBytes * 2, 'SOURCE_BOUNDARIES',
        `source file ${file.path} boundary bitmap has the wrong length`);

    const usedBits = (file.byteLength + 1) % 8;
    if (usedBits !== 0) {
        const lastByte = Number.parseInt(file.utf8BoundaryBitmap.slice(-2), 16);
        const paddingMask = 0xff & ~((1 << usedBits) - 1);
        assertInvariant((lastByte & paddingMask) === 0, 'SOURCE_BOUNDARIES',
            `source file ${file.path} boundary bitmap has nonzero padding bits`);
    }
    assertInvariant(hasUtf8Boundary(file, 0), 'SOURCE_BOUNDARIES',
        `source file ${file.path} boundary bitmap must include offset zero`);
    assertInvariant(hasUtf8Boundary(file, file.byteLength), 'SOURCE_BOUNDARIES',
        `source file ${file.path} boundary bitmap must include EOF`);
}

function validateTypeReferences(
    records: readonly TypedTypeRecord[],
    types: ReadonlyMap<number, TypedTypeRecord>,
): void {
    for (const type of records) {
        switch (type.kind) {
            case 'builtin':
                break;
            case 'pointer':
                requireType(types, type.pointee, `pointer type ${type.id} pointee`);
                break;
            case 'array': {
                const element = unaliasType(
                    requireType(types, type.element, `array type ${type.id} element`), types);
                assertInvariant(element.kind !== 'function'
                    && !(element.kind === 'builtin' && element.name === 'void'),
                'CROSS_KIND_REFERENCE', `array type ${type.id} must reference an object element type`);
                break;
            }
            case 'function': {
                const result = unaliasType(
                    requireType(types, type.returnType, `function type ${type.id} return`), types);
                assertInvariant(result.kind !== 'array' && result.kind !== 'function',
                    'CROSS_KIND_REFERENCE', `function type ${type.id} has an illegal return type`);
                for (const parameterId of type.parameters) {
                    const parameter = unaliasType(
                        requireType(types, parameterId, `function type ${type.id} parameter`), types);
                    assertInvariant(parameter.kind !== 'array' && parameter.kind !== 'function'
                        && !(parameter.kind === 'builtin' && parameter.name === 'void'),
                    'CROSS_KIND_REFERENCE', `function type ${type.id} has a non-parameter type`);
                }
                break;
            }
            case 'struct':
            case 'union':
                for (const member of type.members) {
                    const memberType = unaliasType(
                        requireType(types, member.type, `${type.kind} type ${type.id} member`), types);
                    assertInvariant(memberType.kind !== 'function'
                        && !(memberType.kind === 'builtin' && memberType.name === 'void'),
                    'CROSS_KIND_REFERENCE', `${type.kind} type ${type.id} member is not an object type`);
                }
                break;
            case 'enum': {
                const underlying = unaliasType(
                    requireType(types, type.underlyingType, `enum type ${type.id} underlying`), types);
                assertInvariant(underlying.kind === 'builtin' && isIntegerBuiltin(underlying.name),
                    'CROSS_KIND_REFERENCE', `enum type ${type.id} underlying type must be an integer builtin`);
                for (const enumerator of type.enumerators) {
                    validateIntegerValue(enumerator.value, underlying.size * 8,
                        builtinIsSigned(underlying.name), 'enum value');
                }
                break;
            }
            case 'typedef':
                requireType(types, type.target, `typedef type ${type.id} target`);
                break;
        }
    }
}

function rejectByValueCycles(
    records: readonly TypedTypeRecord[],
    types: ReadonlyMap<number, TypedTypeRecord>,
): void {
    const active = new Set<number>();
    const complete = new Set<number>();
    const visit = (type: TypedTypeRecord): void => {
        if (active.has(type.id)) {
            throw failure('TYPE_VALUE_CYCLE', `type ${type.id} participates in an illegal by-value cycle`);
        }
        if (complete.has(type.id)) {
            return;
        }
        active.add(type.id);
        for (const reference of byValueReferences(type)) {
            visit(requireType(types, reference, `type ${type.id} by-value edge`));
        }
        active.delete(type.id);
        complete.add(type.id);
    };
    records.forEach(visit);
}

function byValueReferences(type: TypedTypeRecord): readonly TypeId[] {
    switch (type.kind) {
        case 'array':
            return [type.element];
        case 'struct':
        case 'union':
            return type.members.map((member) => member.type);
        case 'typedef':
            return [type.target];
        default:
            return [];
    }
}

function validateTypeLayouts(
    records: readonly TypedTypeRecord[],
    types: ReadonlyMap<number, TypedTypeRecord>,
): void {
    for (const type of records) {
        switch (type.kind) {
            case 'builtin': {
                const expected = builtinLayout(type.name);
                assertInvariant(type.size === expected[0] && type.alignment === expected[1],
                    'ABI_LAYOUT', `builtin ${type.name} layout must be ${expected[0]}/${expected[1]}`);
                break;
            }
            case 'pointer':
                assertInvariant(type.size === MERC32_ABI.pointerSize
                    && type.alignment === MERC32_ABI.pointerAlignment,
                'ABI_LAYOUT', `pointer type ${type.id} disagrees with MERC32_ABI`);
                break;
            case 'function':
                assertInvariant(type.size === 0 && type.alignment === MERC32_ABI.functionAlignment,
                    'ABI_LAYOUT', `function type ${type.id} disagrees with MERC32_ABI`);
                break;
            case 'array': {
                const element = requireType(types, type.element, `array type ${type.id} element`);
                const expectedSize = element.size * type.count;
                assertInvariant(Number.isSafeInteger(expectedSize)
                    && type.size === expectedSize && type.alignment === element.alignment,
                'ABI_LAYOUT', `array type ${type.id} layout disagrees with its element type`);
                break;
            }
            case 'enum': {
                const underlying = unaliasType(
                    requireType(types, type.underlyingType, `enum type ${type.id} underlying`), types);
                assertInvariant(type.size === underlying.size && type.alignment === underlying.alignment,
                    'ABI_LAYOUT', `enum type ${type.id} layout disagrees with its underlying type`);
                break;
            }
            case 'typedef': {
                const target = requireType(types, type.target, `typedef type ${type.id} target`);
                assertInvariant(type.size === target.size && type.alignment === target.alignment,
                    'ABI_LAYOUT', `typedef type ${type.id} layout disagrees with its target`);
                break;
            }
            case 'struct':
            case 'union':
                validateAggregateLayout(type, types);
                break;
        }
    }
}

function validateAggregateLayout(
    aggregate: Extract<TypedTypeRecord, { kind: 'struct' | 'union' }>,
    types: ReadonlyMap<number, TypedTypeRecord>,
): void {
    if (!aggregate.complete) {
        assertInvariant(aggregate.members.length === 0
            && aggregate.size === 0
            && aggregate.alignment === 1,
        'AGGREGATE_LAYOUT',
        `incomplete ${aggregate.kind} type ${aggregate.id} must have no members, size 0, alignment 1`);
        return;
    }
    assertInvariant(aggregate.members.length > 0, 'AGGREGATE_LAYOUT',
        `complete ${aggregate.kind} type ${aggregate.id} must contain a member`);

    // V1 retains frontend bit metadata, but MERC32_ABI does not yet define canonical bit placement.
    if (aggregate.members.some((member) =>
        member.bitOffset !== undefined || member.bitWidth !== undefined)) {
        validateAggregateWithBitFields(aggregate, types);
        return;
    }

    let expectedAlignment = 1;
    let extent = 0;
    for (const member of aggregate.members) {
        const memberType = unaliasType(
            requireType(types, member.type, `${aggregate.kind} type ${aggregate.id} member`), types);
        assertInvariant(memberType.size > 0, 'AGGREGATE_LAYOUT',
            `${aggregate.kind} type ${aggregate.id} has an incomplete member`);
        const memberAlignment = Math.min(
            memberType.alignment, MERC32_ABI.maximumNaturalAlignment);
        expectedAlignment = Math.max(expectedAlignment, memberAlignment);
        if (aggregate.kind === 'union') {
            assertInvariant(member.offset === 0, 'AGGREGATE_LAYOUT',
                `union type ${aggregate.id} members must start at byte offset zero`);
            extent = Math.max(extent, memberType.size);
        } else {
            const expectedOffset = roundUp(extent, memberAlignment);
            assertInvariant(member.offset === expectedOffset, 'AGGREGATE_LAYOUT',
                `struct type ${aggregate.id} member ${member.name} expected byte offset ${expectedOffset}`);
            extent = expectedOffset + memberType.size;
        }
    }
    const expectedSize = roundUp(extent, expectedAlignment);
    assertInvariant(aggregate.alignment === expectedAlignment && aggregate.size === expectedSize,
        'AGGREGATE_LAYOUT',
        `${aggregate.kind} type ${aggregate.id} expected layout ${expectedSize}/${expectedAlignment}`);
}

function validateAggregateWithBitFields(
    aggregate: Extract<TypedTypeRecord, { kind: 'struct' | 'union' }>,
    types: ReadonlyMap<number, TypedTypeRecord>,
): void {

    let expectedAlignment = 1;
    let extent = 0;
    let previousStart = -1;
    let previousEnd = 0;
    for (const member of aggregate.members) {
        const memberType = unaliasType(
            requireType(types, member.type, `${aggregate.kind} type ${aggregate.id} member`), types);
        assertInvariant(memberType.size > 0, 'AGGREGATE_LAYOUT',
            `${aggregate.kind} type ${aggregate.id} has an incomplete member`);
        expectedAlignment = Math.max(expectedAlignment,
            Math.min(memberType.alignment, MERC32_ABI.maximumNaturalAlignment));
        assertInvariant(member.offset % memberType.alignment === 0, 'AGGREGATE_LAYOUT',
            `${aggregate.kind} type ${aggregate.id} member ${member.name} is misaligned`);
        assertInvariant((member.bitOffset === undefined) === (member.bitWidth === undefined),
            'AGGREGATE_LAYOUT', 'bitOffset and bitWidth must be supplied together');
        let startBit = member.offset * 8;
        let endBit = startBit + memberType.size * 8;
        if (member.bitOffset !== undefined && member.bitWidth !== undefined) {
            assertInvariant(isIntegerType(memberType), 'AGGREGATE_LAYOUT',
                'bit-field members must use an integer type');
            assertInvariant(member.bitOffset + member.bitWidth <= memberType.size * 8,
                'AGGREGATE_LAYOUT', 'bit-field exceeds its declared storage unit');
            startBit += member.bitOffset;
            endBit = startBit + member.bitWidth;
        }
        if (aggregate.kind === 'union') {
            assertInvariant(member.offset === 0, 'AGGREGATE_LAYOUT',
                `union type ${aggregate.id} members must start at byte offset zero`);
        } else {
            assertInvariant(startBit >= previousStart, 'AGGREGATE_LAYOUT',
                `struct type ${aggregate.id} members are out of order`);
            assertInvariant(startBit >= previousEnd, 'AGGREGATE_LAYOUT',
                `struct type ${aggregate.id} members overlap`);
            previousStart = startBit;
            previousEnd = endBit;
        }
        extent = Math.max(extent, member.offset + memberType.size);
    }
    const expectedSize = roundUp(extent, expectedAlignment);
    assertInvariant(aggregate.alignment === expectedAlignment && aggregate.size === expectedSize,
        'AGGREGATE_LAYOUT', `${aggregate.kind} type ${aggregate.id} expected layout ${expectedSize}/${expectedAlignment}`);
}

function validateSymbols(
    records: readonly TypedSymbolRecord[],
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
): void {
    for (const symbol of records) {
        switch (symbol.kind) {
            case 'variable': {
                const type = requireType(types, symbol.type, `variable symbol ${symbol.id}`);
                assertInvariant(isObjectType(type, types), 'CROSS_KIND_REFERENCE',
                    `variable symbol ${symbol.id} must reference an object type`);
                if (symbol.initializer !== undefined) {
                    assertInvariant(symbol.definition, 'DECLARATION_SEMANTICS',
                        `initializer for symbol ${symbol.id} requires a defined variable`);
                    assertInvariant(symbol.initializer.size === type.size, 'INITIALIZER_LAYOUT',
                        `initializer for symbol ${symbol.id} must match its object size`);
                    validateInitializer(symbol.initializer, types, symbols);
                }
                break;
            }
            case 'function': {
                const type = unaliasType(
                    requireType(types, symbol.type, `function symbol ${symbol.id}`), types);
                assertInvariant(type.kind === 'function', 'CROSS_KIND_REFERENCE',
                    `function symbol ${symbol.id} must reference a function type`);
                break;
            }
            case 'parameter': {
                const type = requireType(types, symbol.type, `parameter symbol ${symbol.id}`);
                assertInvariant(isObjectType(type, types), 'CROSS_KIND_REFERENCE',
                    `parameter symbol ${symbol.id} must reference an object type`);
                requireSymbolKind(symbols, symbol.owner, ['function'], `parameter symbol ${symbol.id} owner`);
                break;
            }
            case 'typedef':
                assertInvariant(requireType(types, symbol.type, `typedef symbol ${symbol.id}`).kind === 'typedef',
                    'CROSS_KIND_REFERENCE', `typedef symbol ${symbol.id} must reference a typedef type`);
                break;
            case 'record': {
                const type = unaliasType(
                    requireType(types, symbol.type, `record symbol ${symbol.id}`), types);
                assertInvariant(type.kind === 'struct' || type.kind === 'union',
                    'CROSS_KIND_REFERENCE', `record symbol ${symbol.id} must reference an aggregate type`);
                break;
            }
            case 'enum':
                assertInvariant(unaliasType(
                    requireType(types, symbol.type, `enum symbol ${symbol.id}`), types).kind === 'enum',
                    'CROSS_KIND_REFERENCE', `enum symbol ${symbol.id} must reference an enum type`);
                break;
            case 'enumerator':
                assertInvariant(unaliasType(
                    requireType(types, symbol.type, `enumerator symbol ${symbol.id}`), types).kind === 'enum',
                    'CROSS_KIND_REFERENCE', `enumerator symbol ${symbol.id} must reference an enum type`);
                requireSymbolKind(symbols, symbol.owner, ['enum'], `enumerator symbol ${symbol.id} owner`);
                validateConstant(symbol.value, types, symbols);
                break;
            case 'label':
                requireSymbolKind(symbols, symbol.owner, ['function'], `label symbol ${symbol.id} owner`);
                break;
        }
    }
}

function validateInitializer(
    initializer: TypedInitializer,
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
): void {
    let previousOffset = -1;
    let previousEnd = 0;
    for (const write of initializer.writes) {
        const type = requireType(types, write.type, 'initializer write type');
        assertInvariant(type.size > 0 && write.offset + type.size <= initializer.size,
            'INITIALIZER_LAYOUT', `initializer write at ${write.offset} is outside its object`);
        assertInvariant(write.offset >= previousOffset, 'INITIALIZER_LAYOUT',
            'initializer writes must be sorted by ascending offset');
        assertInvariant(write.offset >= previousEnd, 'INITIALIZER_LAYOUT',
            'initializer writes must not overlap');
        previousOffset = write.offset;
        previousEnd = write.offset + type.size;
        validateConstantForDestination(
            write.value, type, types, symbols, `initializer write at ${write.offset}`,
            { kind: 'initializer', zeroFill: initializer.zeroFill });
    }
}

function validateNodes(
    records: readonly TypedNodeRecord[],
    declarations: readonly number[],
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
    nodes: ReadonlyMap<number, TypedNodeRecord>,
): void {
    for (const node of records) {
        for (const child of node.children) {
            requireNode(nodes, child, `node ${node.id} child`);
        }
        if (node.category === 'expression') {
            const expressionType = requireType(types, node.type, `expression node ${node.id} type`);
            validateExpressionCategory(node, expressionType, types, symbols, nodes);
            if (node.constant !== undefined) {
                validateConstantForDestination(
                    node.constant, expressionType, types, symbols, `expression node ${node.id}`,
                    { kind: 'node' });
            }
        }
        if ('targetType' in node) {
            requireType(types, node.targetType, `node ${node.id} targetType`);
        }
        if (node.category === 'declaration' && node.kind !== 'static-assert') {
            const type = requireType(types, node.type, `declaration node ${node.id} type`);
            const allowed = declarationSymbolKinds(node.kind);
            const symbol = requireSymbolKind(symbols, node.symbol, allowed, `declaration node ${node.id} symbol`);
            if ('type' in symbol) {
                assertInvariant(symbol.type === type.id, 'CROSS_KIND_REFERENCE',
                    `declaration node ${node.id} type disagrees with symbol ${symbol.id}`);
            }
            if (node.kind === 'function-definition') {
                assertInvariant(symbol.kind === 'function' && symbol.definition,
                    'DECLARATION_SEMANTICS',
                    `function-definition node ${node.id} requires a function symbol marked definition`);
            }
        }
        validateNodeChildren(node, types, nodes);
        if (node.kind === 'case') {
            const caseExpression = requireNode(nodes, node.children[0], `case node ${node.id} expression`);
            assertInvariant(caseExpression.category === 'expression', 'NODE_CHILDREN',
                `case node ${node.id} requires an expression as its first child`);
            validateConstantForDestination(
                node.caseValue,
                requireType(types, caseExpression.type, `case node ${node.id} expression type`),
                types,
                symbols,
                `case node ${node.id} value`,
                { kind: 'node' },
            );
        }
    }
    for (const declarationId of declarations) {
        const node = requireNode(nodes, declarationId, 'top-level declaration');
        assertInvariant(node.category === 'declaration', 'CROSS_KIND_REFERENCE',
            `top-level declaration ${declarationId} is not a declaration node`);
        assertInvariant(node.kind !== 'parameter-declaration', 'DECLARATION_SEMANTICS',
            `top-level declaration ${declarationId} is not a file-scope declaration kind`);
    }
    rejectNodeCycles(records, nodes);
    validateLabelScopes(records, nodes);
}

function validateNodeChildren(
    node: TypedNodeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
    nodes: ReadonlyMap<number, TypedNodeRecord>,
): void {
    const children = node.children.map((id) => requireNode(nodes, id, `node ${node.id} child`));
    const count = (minimum: number, maximum = minimum): void => assertInvariant(
        children.length >= minimum && children.length <= maximum,
        'NODE_CHILDREN',
        `node ${node.id} (${node.kind}) requires ${minimum === maximum ? minimum : `${minimum}..${maximum}`} children`,
    );
    const category = (index: number, expected: TypedNodeRecord['category']): void =>
        assertInvariant(children[index]?.category === expected, 'NODE_CHILDREN',
            `node ${node.id} (${node.kind}) child ${index} must be ${expected}`);
    const kind = (index: number, expected: TypedNodeKind): void =>
        assertInvariant(children[index]?.kind === expected, 'NODE_CHILDREN',
            `node ${node.id} (${node.kind}) child ${index} must be ${expected}`);
    const conversion = (
        index: number,
        expected: Extract<TypedNodeRecord, { kind: 'conversion' }>['conversion'],
    ): void => {
        const child = children[index];
        assertInvariant(child?.kind === 'conversion' && child.conversion === expected, 'NODE_CHILDREN',
            `node ${node.id} (${node.kind}) child ${index} must be an ${expected} conversion`);
    };

    switch (node.kind) {
        case 'function-declaration':
            assertInvariant(children.every((child) => child.kind === 'parameter-declaration'),
                'NODE_CHILDREN', `function declaration ${node.id} may contain only parameters`);
            break;
        case 'function-definition':
            count(1, Number.MAX_SAFE_INTEGER);
            kind(children.length - 1, 'compound');
            assertInvariant(children.slice(0, -1).every((child) => child.kind === 'parameter-declaration'),
                'NODE_CHILDREN', `function definition ${node.id} must place parameters before its compound body`);
            break;
        case 'variable-declaration':
            count(0, 1);
            if (children.length === 1) conversion(0, 'assignment');
            break;
        case 'parameter-declaration':
        case 'typedef-declaration':
        case 'record-declaration':
        case 'enum-declaration':
            count(0);
            break;
        case 'static-assert':
            count(1, 2);
            children.forEach((_child, index) => category(index, 'expression'));
            break;
        case 'compound':
            children.forEach((_child, index) => category(index, 'statement'));
            break;
        case 'declaration-statement':
            count(1, Number.MAX_SAFE_INTEGER);
            children.forEach((_child, index) => category(index, 'declaration'));
            break;
        case 'expression-statement':
            count(1);
            category(0, 'expression');
            break;
        case 'return':
            count(0, 1);
            if (children.length === 1) conversion(0, 'return');
            break;
        case 'if':
            count(2, 3);
            category(0, 'expression');
            category(1, 'statement');
            if (children.length === 3) category(2, 'statement');
            break;
        case 'while':
        case 'switch':
            count(2);
            category(0, 'expression');
            category(1, 'statement');
            break;
        case 'do-while':
            count(2);
            category(0, 'statement');
            category(1, 'expression');
            break;
        case 'for': {
            count(1, 4);
            category(children.length - 1, 'statement');
            const clauses = children.slice(0, -1);
            const statementClauses = clauses.filter((child) => child.category === 'statement');
            assertInvariant(statementClauses.length <= 1
                && (statementClauses.length === 0 || clauses[0].category === 'statement')
                && clauses.every((child, index) => child.category === 'expression'
                    || (index === 0 && child.category === 'statement')),
            'NODE_CHILDREN', `for node ${node.id} has invalid initializer/condition/increment ordering`);
            break;
        }
        case 'case':
            count(2, 3);
            category(0, 'expression');
            if (children.length === 3) category(1, 'expression');
            category(children.length - 1, 'statement');
            break;
        case 'default':
        case 'label':
            count(1);
            category(0, 'statement');
            break;
        case 'break':
        case 'continue':
        case 'goto':
        case 'empty':
            count(0);
            break;
        case 'integer-literal':
        case 'floating-literal':
        case 'character-literal':
        case 'string-literal':
        case 'declaration-reference':
            count(0);
            break;
        case 'unary':
        case 'member':
        case 'generic-selection':
            count(1);
            category(0, 'expression');
            break;
        case 'binary':
        case 'subscript':
            count(2);
            category(0, 'expression');
            category(1, 'expression');
            break;
        case 'assignment':
            count(2);
            category(0, 'expression');
            conversion(1, 'assignment');
            break;
        case 'conditional':
            count(3);
            children.forEach((_child, index) => category(index, 'expression'));
            break;
        case 'call':
            count(1, Number.MAX_SAFE_INTEGER);
            category(0, 'expression');
            for (let index = 1; index < children.length; index += 1) conversion(index, 'argument');
            break;
        case 'sizeof':
        case 'alignof':
            count(0, 1);
            if (children.length === 1) category(0, 'expression');
            break;
        case 'conversion':
            count(1);
            category(0, 'expression');
            validateConversion(node, children[0], types);
            break;
        case 'compound-literal':
            children.forEach((_child, index) => category(index, 'expression'));
            break;
    }
}

function validateConversion(
    node: Extract<TypedNodeRecord, { kind: 'conversion' }>,
    child: TypedNodeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
): void {
    assertInvariant(child.category === 'expression', 'NODE_CONVERSION',
        `conversion node ${node.id} requires an expression child`);
    assertInvariant(node.type === node.targetType, 'NODE_CONVERSION',
        `conversion node ${node.id} type must equal targetType`);
    const source = unaliasType(requireType(types, child.type, `conversion node ${node.id} source`), types);
    const target = unaliasType(requireType(types, node.targetType, `conversion node ${node.id} target`), types);
    switch (node.conversion) {
        case 'no-op':
            assertInvariant(sameUnqualifiedType(source, target, types), 'NODE_CONVERSION',
                `no-op conversion ${node.id} requires equivalent source and target types`);
            break;
        case 'bitcast':
            assertInvariant(source.size === target.size, 'NODE_CONVERSION',
                `bitcast conversion ${node.id} requires equal-sized source and target types`);
            break;
        case 'lvalue-to-rvalue':
            assertInvariant(child.valueCategory === 'lvalue' && sameUnqualifiedType(source, target, types),
                'NODE_CONVERSION', `lvalue conversion ${node.id} requires a same-type lvalue source`);
            break;
        case 'array-to-pointer': {
            assertInvariant(source.kind === 'array' && target.kind === 'pointer', 'NODE_CONVERSION',
                `array conversion ${node.id} requires array and pointer types`);
            const element = unaliasType(requireType(types, source.element, `array conversion ${node.id} element`), types);
            const pointee = unaliasType(requireType(types, target.pointee, `array conversion ${node.id} pointee`), types);
            assertInvariant(sameResolvedType(element, pointee), 'NODE_CONVERSION',
                `array conversion ${node.id} target must point to its source element type`);
            break;
        }
        case 'function-to-pointer': {
            assertInvariant(source.kind === 'function' && child.valueCategory === 'function'
                && target.kind === 'pointer', 'NODE_CONVERSION',
            `function conversion ${node.id} requires a function source and pointer target`);
            const pointee = unaliasType(requireType(types, target.pointee,
                `function conversion ${node.id} pointee`), types);
            assertInvariant(pointee.kind === 'function' && sameResolvedType(source, pointee),
                'NODE_CONVERSION', `function conversion ${node.id} target must point to its source function type`);
            break;
        }
        case 'integer-promotion': {
            const sourceRepresentation = integerRepresentation(source, types);
            const targetRepresentation = integerRepresentation(target, types);
            assertInvariant(sourceRepresentation !== undefined && targetRepresentation !== undefined
                && sourceRepresentation.bits < targetRepresentation.bits
                && targetRepresentation.bits === MERC32_ABI.builtin.int[0] * 8,
            'NODE_CONVERSION', `integer promotion ${node.id} must widen to int width`);
            break;
        }
        case 'usual-arithmetic':
            assertInvariant(isArithmeticType(source) && isArithmeticType(target), 'NODE_CONVERSION',
                `usual arithmetic conversion ${node.id} requires arithmetic source and target types`);
            break;
        case 'pointer-to-bool':
            assertInvariant(source.kind === 'pointer' && isBoolType(target), 'NODE_CONVERSION',
                `pointer-to-bool conversion ${node.id} requires pointer and boolean types`);
            break;
        case 'pointer-to-int':
            assertInvariant(source.kind === 'pointer' && isIntegerType(target), 'NODE_CONVERSION',
                `pointer-to-int conversion ${node.id} requires pointer and integer types`);
            break;
        case 'bool-to-int':
            assertInvariant(isBoolType(source) && isIntegerType(target), 'NODE_CONVERSION',
                `bool-to-int conversion ${node.id} requires boolean and integer types`);
            break;
        case 'bool-to-float':
            assertInvariant(isBoolType(source) && isFloatingType(target), 'NODE_CONVERSION',
                `bool-to-float conversion ${node.id} requires boolean and floating types`);
            break;
        case 'bool-to-pointer':
            assertInvariant(isBoolType(source) && target.kind === 'pointer', 'NODE_CONVERSION',
                `bool-to-pointer conversion ${node.id} requires boolean and pointer types`);
            break;
        case 'int-to-bool':
            assertInvariant(isIntegerType(source) && isBoolType(target), 'NODE_CONVERSION',
                `int-to-bool conversion ${node.id} requires integer and boolean types`);
            break;
        case 'int-to-float':
            assertInvariant(isIntegerType(source) && isFloatingType(target), 'NODE_CONVERSION',
                `int-to-float conversion ${node.id} requires integer and floating types`);
            break;
        case 'int-to-pointer':
            assertInvariant(isIntegerType(source) && target.kind === 'pointer', 'NODE_CONVERSION',
                `int-to-pointer conversion ${node.id} requires integer and pointer types`);
            break;
        case 'float-to-bool':
            assertInvariant(isFloatingType(source) && isBoolType(target), 'NODE_CONVERSION',
                `float-to-bool conversion ${node.id} requires floating and boolean types`);
            break;
        case 'float-to-int':
            assertInvariant(isFloatingType(source) && isIntegerType(target), 'NODE_CONVERSION',
                `float-to-int conversion ${node.id} requires floating and integer types`);
            break;
        case 'null-to-pointer':
            assertInvariant(isIntegerType(source) && target.kind === 'pointer'
                && (child.kind === 'integer-literal' || child.kind === 'character-literal')
                && child.constant.value === '0',
            'NODE_CONVERSION', `null-to-pointer conversion ${node.id} requires an integer zero and pointer target`);
            break;
        case 'to-void':
            assertInvariant(target.kind === 'builtin' && target.name === 'void', 'NODE_CONVERSION',
                `to-void conversion ${node.id} requires a void target`);
            break;
        case 'complex-int-to-complex-float':
        case 'complex-float-to-complex-int':
        case 'complex-int-cast':
        case 'complex-int-to-real':
        case 'real-to-complex-int':
        case 'complex-float-cast':
        case 'complex-float-to-real':
        case 'real-to-complex-float':
        case 'int-cast':
        case 'float-cast':
            assertInvariant(isArithmeticType(source) && isArithmeticType(target), 'NODE_CONVERSION',
                `arithmetic conversion ${node.id} requires arithmetic source and target types`);
            break;
        case 'union-cast':
        case 'vector-splat':
        case 'atomic-to-non-atomic':
        case 'non-atomic-to-atomic':
            assertInvariant(source.size === target.size, 'NODE_CONVERSION',
                `representation conversion ${node.id} requires equal-sized source and target types`);
            break;
        case 'assignment':
        case 'argument':
        case 'return':
            assertInvariant(isImplicitConversionPair(source, target, types), 'NODE_CONVERSION',
                `${node.conversion} conversion ${node.id} has incompatible source and target types`);
            break;
    }
}

function validateLabelScopes(
    records: readonly TypedNodeRecord[],
    nodes: ReadonlyMap<number, TypedNodeRecord>,
): void {
    const owned = new Map<number, number>();
    for (const functionNode of records) {
        if (functionNode.kind !== 'function-definition') continue;
        const labels = new Set<string>();
        const gotos: { readonly id: number; readonly label: string }[] = [];
        const visited = new Set<number>();
        const visit = (node: TypedNodeRecord): void => {
            if (visited.has(node.id)) return;
            visited.add(node.id);
            if (node.kind === 'label' || node.kind === 'goto') {
                const previousOwner = owned.get(node.id);
                assertInvariant(previousOwner === undefined || previousOwner === functionNode.id,
                    'LABEL_SCOPE', `node ${node.id} belongs to more than one function`);
                owned.set(node.id, functionNode.id);
            }
            if (node.kind === 'label') {
                assertInvariant(!labels.has(node.label), 'LABEL_SCOPE',
                    `function node ${functionNode.id} has duplicate label ${JSON.stringify(node.label)}`);
                labels.add(node.label);
            } else if (node.kind === 'goto') {
                gotos.push(node);
            }
            node.children.forEach((child) => visit(requireNode(nodes, child, `node ${node.id} child`)));
        };
        visit(functionNode);
        for (const goto of gotos) {
            assertInvariant(labels.has(goto.label), 'LABEL_SCOPE',
                `goto node ${goto.id} has no target ${JSON.stringify(goto.label)} in its function`);
        }
    }
    for (const node of records) {
        if (node.kind === 'label' || node.kind === 'goto') {
            assertInvariant(owned.has(node.id), 'LABEL_SCOPE',
                `${node.kind} node ${node.id} is outside a function definition`);
        }
    }
}

function validateConstantForDestination(
    constant: TypedConstant,
    destinationType: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
    label: string,
    context: Readonly<{ kind: 'node' }> | Readonly<{ kind: 'initializer'; zeroFill: true }>,
): void {
    validateConstant(constant, types, symbols);
    const destination = unaliasType(destinationType, types);
    switch (constant.kind) {
        case 'integer': {
            const representation = integerRepresentation(destination, types);
            if (representation !== undefined) {
                assertInvariant(constant.bits === representation.bits
                    && constant.signed === representation.signed,
                'CONSTANT_TYPE', `${label} integer width or signedness disagrees with its destination`);
                if (destination.kind === 'builtin' && destination.name === '_Bool') {
                    const value = parseExactInteger(constant.value, 'INTEGER_CONSTANT', 'boolean constant');
                    assertInvariant(value === 0n || value === 1n, 'CONSTANT_TYPE',
                        `${label} boolean destination accepts only integer zero or one`);
                }
                return;
            }
            assertInvariant(destination.kind === 'pointer' && constant.value === '0',
                'CONSTANT_TYPE', `${label} pointer destination accepts only canonical integer zero as a null pointer`);
            return;
        }
        case 'floating': {
            const constantType = unaliasType(
                requireType(types, constant.type, 'floating constant type'), types);
            assertInvariant(destination.kind === 'builtin' && isFloatingBuiltin(destination.name),
                'CONSTANT_TYPE', `${label} floating constant is incompatible with an integer destination`);
            assertInvariant(constantType.kind === 'builtin'
                && constantType.name === destination.name
                && constantType.size === destination.size,
            'CONSTANT_TYPE', `${label} floating constant type or width disagrees with its destination`);
            return;
        }
        case 'address': {
            assertInvariant(destination.kind === 'pointer', 'CONSTANT_TYPE',
                `${label} address destination must be a pointer type`);
            const pointee = unaliasType(
                requireType(types, destination.pointee, `${label} pointer target`), types);
            const symbol = requireSymbolKind(
                symbols, constant.symbol, ['variable', 'function'], 'address constant symbol',
                'ADDRESS_CONSTANT');
            if (symbol.kind === 'function') {
                const symbolType = unaliasType(
                    requireType(types, symbol.type, `function symbol ${symbol.id} type`), types);
                assertInvariant(pointee.kind === 'function'
                    && sameResolvedType(pointee, symbolType),
                'CONSTANT_TYPE', `${label} function address requires a compatible function pointer`);
            } else {
                assertInvariant(pointee.kind !== 'function', 'CONSTANT_TYPE',
                    `${label} object address cannot initialize a function pointer`);
            }
            return;
        }
        case 'string': {
            assertInvariant(destination.kind === 'array', 'CONSTANT_TYPE',
                `${label} string destination must be an array type`);
            const destinationElement = unaliasType(
                requireType(types, destination.element, `${label} string array element`), types);
            const constantElement = unaliasType(
                requireType(types, constant.elementType, 'string constant element type'), types);
            assertInvariant(destinationElement.kind === 'builtin'
                && isCharacterBuiltin(destinationElement.name)
                && constantElement.kind === 'builtin'
                && constantElement.name === destinationElement.name,
            'CONSTANT_TYPE', `${label} string destination has an incompatible element type`);
            if (context.kind === 'initializer' && context.zeroFill) {
                assertInvariant(constant.bytes.length <= destination.size,
                    'CONSTANT_TYPE', `${label} string constant byte size exceeds its array destination`);
            } else {
                assertInvariant(constant.bytes.length === destination.size,
                    'CONSTANT_TYPE', `${label} string constant byte size disagrees with its array destination`);
            }
            return;
        }
    }
}

function sameResolvedType(left: TypedTypeRecord, right: TypedTypeRecord): boolean {
    if (left.id === right.id) {
        return true;
    }
    return left.kind === 'builtin' && right.kind === 'builtin' && left.name === right.name;
}

function sameUnqualifiedType(
    left: TypedTypeRecord,
    right: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
): boolean {
    return sameTypeShape(left, right, types, true, new Set<string>());
}

function sameTypeShape(
    left: TypedTypeRecord,
    right: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
    ignoreQualifiers: boolean,
    seen: Set<string>,
): boolean {
    const leftType = unaliasType(left, types);
    const rightType = unaliasType(right, types);
    if (!ignoreQualifiers && (leftType.qualifiers.length !== rightType.qualifiers.length
        || leftType.qualifiers.some((qualifier) => !rightType.qualifiers.includes(qualifier)))) {
        return false;
    }
    if (leftType.kind !== rightType.kind) return false;
    const pair = `${leftType.id}:${rightType.id}`;
    if (seen.has(pair)) return true;
    seen.add(pair);
    switch (leftType.kind) {
        case 'builtin':
            return rightType.kind === 'builtin' && leftType.name === rightType.name;
        case 'pointer':
            return rightType.kind === 'pointer'
                && sameTypeShape(requireType(types, leftType.pointee, 'pointer source pointee'),
                    requireType(types, rightType.pointee, 'pointer target pointee'), types, true, seen);
        case 'array':
            return rightType.kind === 'array' && leftType.count === rightType.count
                && sameTypeShape(requireType(types, leftType.element, 'array source element'),
                    requireType(types, rightType.element, 'array target element'), types, true, seen);
        case 'function':
            return rightType.kind === 'function'
                && leftType.variadic === rightType.variadic
                && leftType.parameters.length === rightType.parameters.length
                && sameTypeShape(requireType(types, leftType.returnType, 'function source return'),
                    requireType(types, rightType.returnType, 'function target return'), types, true, seen)
                && leftType.parameters.every((parameter, index) => sameTypeShape(
                    requireType(types, parameter, 'function source parameter'),
                    requireType(types, rightType.parameters[index]!, 'function target parameter'), types, true, seen));
        case 'struct':
        case 'union':
            if (rightType.kind !== leftType.kind) return false;
            return sameAggregateShape(leftType, rightType, types, seen);
        case 'enum':
            if (rightType.kind !== 'enum') return false;
            return sameNominalIdentity(leftType, rightType)
                && leftType.name === rightType.name
                && leftType.size === rightType.size
                && leftType.alignment === rightType.alignment
                && leftType.enumerators.length === rightType.enumerators.length
                && sameTypeShape(requireType(types, leftType.underlyingType, 'enum source underlying'),
                    requireType(types, rightType.underlyingType, 'enum target underlying'), types, true, seen)
                && leftType.enumerators.every((enumerator, index) => {
                    const other = rightType.enumerators[index]!;
                    return enumerator.name === other.name && enumerator.value === other.value;
                });
        case 'typedef':
            return leftType.id === rightType.id;
    }
}

function sameAggregateShape(
    left: Extract<TypedTypeRecord, { kind: 'struct' | 'union' }>,
    right: Extract<TypedTypeRecord, { kind: 'struct' | 'union' }>,
    types: ReadonlyMap<number, TypedTypeRecord>,
    seen: Set<string>,
): boolean {
    return sameNominalIdentity(left, right)
        && left.name === right.name
        && left.complete === right.complete
        && left.size === right.size
        && left.alignment === right.alignment
        && left.members.length === right.members.length
        && left.members.every((member, index) => {
            const other = right.members[index]!;
            return member.name === other.name
                && member.offset === other.offset
                && member.bitOffset === other.bitOffset
                && member.bitWidth === other.bitWidth
                && sameTypeShape(requireType(types, member.type, `${left.kind} source member`),
                    requireType(types, other.type, `${right.kind} target member`), types, true, seen);
        });
}

function sameNominalIdentity(
    left: Extract<TypedTypeRecord, { kind: 'struct' | 'union' | 'enum' }>,
    right: Extract<TypedTypeRecord, { kind: 'struct' | 'union' | 'enum' }>,
): boolean {
    if (left.nominalId === undefined && right.nominalId === undefined) return left.id === right.id;
    return left.nominalId !== undefined && left.nominalId === right.nominalId;
}

function integerRepresentation(
    type: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
): Readonly<{ bits: number; signed: boolean }> | undefined {
    const unaliased = unaliasType(type, types);
    if (unaliased.kind === 'enum') {
        return integerRepresentation(
            requireType(types, unaliased.underlyingType, `enum type ${unaliased.id} underlying`), types);
    }
    return unaliased.kind === 'builtin' && isIntegerBuiltin(unaliased.name)
        ? { bits: unaliased.size * 8, signed: builtinIsSigned(unaliased.name) }
        : undefined;
}

function unaliasType(
    type: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
): TypedTypeRecord {
    let current = type;
    const seen = new Set<number>();
    while (current.kind === 'typedef') {
        assertInvariant(!seen.has(current.id), 'TYPE_VALUE_CYCLE',
            `typedef type ${current.id} participates in an illegal by-value cycle`);
        seen.add(current.id);
        current = requireType(types, current.target, `typedef type ${current.id} target`);
    }
    return current;
}

function validateExpressionCategory(
    node: Extract<TypedNodeRecord, { category: 'expression' }>,
    type: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
    nodes: ReadonlyMap<number, TypedNodeRecord>,
): void {
    if (node.kind === 'declaration-reference') {
        const symbol = requireSymbolKind(symbols, node.symbol,
            ['variable', 'function', 'parameter', 'enumerator'], `expression node ${node.id} symbol`);
        const typeMatches = symbol.kind === 'enumerator'
            ? integerRepresentation(type, types) !== undefined
            : symbol.type === type.id;
        assertInvariant(typeMatches, 'CROSS_KIND_REFERENCE',
            `expression node ${node.id} type disagrees with its referenced symbol`);
        const expected = symbol.kind === 'function' ? 'function'
            : symbol.kind === 'enumerator' ? 'rvalue' : 'lvalue';
        assertInvariant(node.valueCategory === expected, 'NODE_EXPRESSION_METADATA',
            `declaration reference ${node.id} must have ${expected} value category`);
        return;
    }
    let expected: Extract<TypedNodeRecord, { category: 'expression' }>['valueCategory'] = 'rvalue';
    if (node.kind === 'string-literal' || node.kind === 'compound-literal'
        || node.kind === 'subscript') {
        expected = 'lvalue';
    } else if (node.kind === 'member') {
        const base = requireNode(nodes, node.children[0], `member node ${node.id} base expression`);
        assertInvariant(base.category === 'expression', 'NODE_EXPRESSION_METADATA',
            `member node ${node.id} must have an expression base`);
        expected = unaliasType(requireType(types, base.type, `member node ${node.id} base type`), types).kind === 'pointer'
            ? 'lvalue'
            : base.valueCategory;
    } else if (node.kind === 'generic-selection') {
        const chosen = requireNode(nodes, node.children[0], `generic selection ${node.id} chosen expression`);
        assertInvariant(chosen.category === 'expression', 'NODE_EXPRESSION_METADATA',
            `generic selection ${node.id} must select an expression`);
        expected = chosen.valueCategory;
    } else if (node.kind === 'unary' && node.operator === 'parentheses') {
        const operand = requireNode(nodes, node.children[0], `parentheses node ${node.id} operand`);
        assertInvariant(operand.category === 'expression', 'NODE_EXPRESSION_METADATA',
            `parentheses node ${node.id} must contain an expression`);
        expected = operand.valueCategory;
    } else if (node.kind === 'unary' && node.operator === '*') {
        expected = unaliasType(type, types).kind === 'function' ? 'function' : 'lvalue';
    }
    assertInvariant(node.valueCategory === expected, 'NODE_EXPRESSION_METADATA',
        `expression node ${node.id} must have ${expected} value category`);
}

function rejectNodeCycles(
    records: readonly TypedNodeRecord[],
    nodes: ReadonlyMap<number, TypedNodeRecord>,
): void {
    const active = new Set<number>();
    const complete = new Set<number>();
    const visit = (node: TypedNodeRecord): void => {
        assertInvariant(!active.has(node.id), 'NODE_GRAPH', `node ${node.id} creates an AST cycle`);
        if (complete.has(node.id)) {
            return;
        }
        active.add(node.id);
        node.children.forEach((child) => visit(requireNode(nodes, child, `node ${node.id} child`)));
        active.delete(node.id);
        complete.add(node.id);
    };
    records.forEach(visit);
}

function validateConstant(
    constant: TypedConstant,
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
): void {
    switch (constant.kind) {
        case 'integer':
            validateIntegerValue(constant.value, constant.bits, constant.signed, 'integer constant');
            break;
        case 'floating': {
            const type = unaliasType(
                requireType(types, constant.type, 'floating constant type'), types);
            assertInvariant(type.kind === 'builtin'
                && (type.name === 'float' || type.name === 'double' || type.name === 'long double'),
            'FLOATING_CONSTANT', 'floating constant must reference a floating builtin type');
            assertInvariant(constant.ieeeBits.length === type.size * 2,
                'FLOATING_CONSTANT', `floating constant requires exactly ${type.size * 2} hexadecimal digits`);
            break;
        }
        case 'address': {
            const addend = parseExactInteger(constant.addend, 'ADDRESS_CONSTANT', 'address addend');
            const pointerBits = BigInt(MERC32_ABI.pointerSize * 8);
            const minimum = -(1n << (pointerBits - 1n));
            const maximum = (1n << (pointerBits - 1n)) - 1n;
            assertInvariant(addend >= minimum && addend <= maximum,
                'ADDRESS_CONSTANT', 'address addend exceeds the signed pointer-width range');
            requireSymbolKind(symbols, constant.symbol, ['variable', 'function'], 'address constant symbol',
                'ADDRESS_CONSTANT');
            break;
        }
        case 'string': {
            const element = unaliasType(
                requireType(types, constant.elementType, 'string constant element type'), types);
            assertInvariant(element.kind === 'builtin'
                && ['char', 'signed char', 'unsigned char'].includes(element.name),
            'STRING_CONSTANT', 'string constant elementType must be a character builtin');
            break;
        }
    }
}

function validateIntegerValue(valueText: string, bits: number, signed: boolean, label: string): void {
    const value = parseExactInteger(valueText, 'INTEGER_CONSTANT', label);
    const width = BigInt(bits);
    const minimum = signed ? -(1n << (width - 1n)) : 0n;
    const maximum = signed ? (1n << (width - 1n)) - 1n : (1n << width) - 1n;
    assertInvariant(value >= minimum && value <= maximum, 'INTEGER_CONSTANT',
        `${label} ${valueText} is outside its declared ${signed ? 'signed' : 'unsigned'} ${bits}-bit range`);
}

function parseExactInteger(text: string, invariant: string, label: string): bigint {
    assertInvariant(/^(0|-[1-9][0-9]*|[1-9][0-9]*)$/.test(text), invariant,
        `${label} must be a canonical decimal integer string`);
    try {
        return BigInt(text);
    } catch {
        throw failure(invariant, `${label} is not an exact integer`);
    }
}

function validateRange(
    range: SourceRange,
    files: ReadonlyMap<number, SourceFileRecord> | undefined,
    label: string,
    positions: SourcePositionCoherence,
): void {
    const file = files?.get(range.file);
    if (files !== undefined) {
        assertInvariant(file !== undefined, 'MISSING_REFERENCE',
            `${label} references missing source file ${range.file}`);
    }
    if (file !== undefined) {
        assertInvariant(range.start.byteOffset <= file.byteLength
            && range.end.byteOffset <= file.byteLength,
        'SOURCE_RANGE', `${label} exceeds UTF-8 byte length ${file.byteLength}`);
        assertInvariant(hasUtf8Boundary(file, range.start.byteOffset)
            && hasUtf8Boundary(file, range.end.byteOffset),
        'SOURCE_RANGE', `${label} endpoint is not a UTF-8 code-point boundary`);
    }
    assertInvariant(range.start.byteOffset <= range.end.byteOffset,
        'SOURCE_RANGE', `${label} has inverted byte offsets`);
    assertInvariant(range.start.line < range.end.line
        || (range.start.line === range.end.line && range.start.column <= range.end.column),
    'SOURCE_RANGE', `${label} has inverted line/column positions`);
    const sameByteOffset = range.start.byteOffset === range.end.byteOffset;
    const sameCoordinates = range.start.line === range.end.line
        && range.start.column === range.end.column;
    assertInvariant(sameByteOffset === sameCoordinates, 'SOURCE_RANGE',
        `${label} violates source position coherence between byte offset and line/column`);
    recordSourcePosition(range.file, range.start, label, positions);
    recordSourcePosition(range.file, range.end, label, positions);
}

function hasUtf8Boundary(file: SourceFileRecord, byteOffset: number): boolean {
    const byteIndex = Math.floor(byteOffset / 8);
    const encodedByte = file.utf8BoundaryBitmap.slice(byteIndex * 2, byteIndex * 2 + 2);
    const packed = Number.parseInt(encodedByte, 16);
    return (packed & (1 << (byteOffset % 8))) !== 0;
}

function sameRange(left: SourceRange, right: SourceRange): boolean {
    return left.file === right.file
        && left.start.line === right.start.line
        && left.start.column === right.start.column
        && left.start.byteOffset === right.start.byteOffset
        && left.end.line === right.end.line
        && left.end.column === right.end.column
        && left.end.byteOffset === right.end.byteOffset;
}

interface SourcePositionCoherence {
    readonly coordinatesByByte: Map<string, string>;
    readonly byteByCoordinates: Map<string, number>;
}

function createSourcePositionCoherence(): SourcePositionCoherence {
    return { coordinatesByByte: new Map(), byteByCoordinates: new Map() };
}

function recordSourcePosition(
    file: SourceFileId,
    position: SourceRange['start'],
    label: string,
    coherence: SourcePositionCoherence,
): void {
    const coordinates = `${position.line}:${position.column}`;
    const byteKey = `${file}:${position.byteOffset}`;
    const coordinateKey = `${file}:${coordinates}`;
    const knownCoordinates = coherence.coordinatesByByte.get(byteKey);
    const knownByte = coherence.byteByCoordinates.get(coordinateKey);
    assertInvariant(knownCoordinates === undefined || knownCoordinates === coordinates,
        'SOURCE_RANGE', `${label} violates source position coherence for byte offset ${position.byteOffset}`);
    assertInvariant(knownByte === undefined || knownByte === position.byteOffset,
        'SOURCE_RANGE', `${label} violates source position coherence for line/column ${coordinates}`);
    coherence.coordinatesByByte.set(byteKey, coordinates);
    coherence.byteByCoordinates.set(coordinateKey, position.byteOffset);
}

function uniqueMap<T extends { readonly id: number }>(
    records: readonly T[],
    label: string,
): ReadonlyMap<number, T> {
    const result = new Map<number, T>();
    for (const record of records) {
        assertInvariant(!result.has(record.id), 'DUPLICATE_ID', `duplicate ${label} ID ${record.id}`);
        result.set(record.id, record);
    }
    return result;
}

function requireType(
    types: ReadonlyMap<number, TypedTypeRecord>,
    id: number,
    label: string,
): TypedTypeRecord {
    const type = types.get(id);
    assertInvariant(type !== undefined, 'MISSING_REFERENCE', `${label} references missing type ${id}`);
    return type;
}

function requireNode(
    nodes: ReadonlyMap<number, TypedNodeRecord>,
    id: number,
    label: string,
): TypedNodeRecord {
    const node = nodes.get(id);
    assertInvariant(node !== undefined, 'MISSING_REFERENCE', `${label} references missing node ${id}`);
    return node;
}

function requireSymbolKind<K extends TypedSymbolRecord['kind']>(
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
    id: number,
    allowed: readonly K[],
    label: string,
    invariant = 'CROSS_KIND_REFERENCE',
): Extract<TypedSymbolRecord, { kind: K }> {
    const symbol = symbols.get(id);
    assertInvariant(symbol !== undefined, invariant === 'ADDRESS_CONSTANT' ? invariant : 'MISSING_REFERENCE',
        `${label} references missing symbol ${id}`);
    assertInvariant((allowed as readonly TypedSymbolRecord['kind'][]).includes(symbol.kind),
        invariant, `${label} references ${symbol.kind}, expected ${allowed.join(' or ')}`);
    return symbol as Extract<TypedSymbolRecord, { kind: K }>;
}

function declarationSymbolKinds(kind: TypedNodeKind): readonly TypedSymbolRecord['kind'][] {
    switch (kind) {
        case 'variable-declaration': return ['variable'];
        case 'function-declaration':
        case 'function-definition': return ['function'];
        case 'parameter-declaration': return ['parameter'];
        case 'typedef-declaration': return ['typedef'];
        case 'record-declaration': return ['record'];
        case 'enum-declaration': return ['enum'];
        default: return [];
    }
}

function isObjectType(
    type: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
): boolean {
    const resolved = unaliasType(type, types);
    return resolved.kind !== 'function'
        && !(resolved.kind === 'builtin' && resolved.name === 'void');
}

function isIntegerType(type: TypedTypeRecord): boolean {
    return type.kind === 'enum' || (type.kind === 'builtin' && isIntegerBuiltin(type.name));
}

function isArithmeticType(type: TypedTypeRecord): boolean {
    return isIntegerType(type) || (type.kind === 'builtin' && isFloatingBuiltin(type.name));
}

function isBoolType(type: TypedTypeRecord): boolean {
    return type.kind === 'builtin' && type.name === '_Bool';
}

function isFloatingType(type: TypedTypeRecord): boolean {
    return type.kind === 'builtin' && isFloatingBuiltin(type.name);
}

function isImplicitConversionPair(
    source: TypedTypeRecord,
    target: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
): boolean {
    if (sameUnqualifiedType(source, target, types) || (isArithmeticType(source) && isArithmeticType(target))) {
        return true;
    }
    if (target.kind === 'pointer') {
        return source.kind === 'pointer' || isIntegerType(source);
    }
    return target.kind === 'builtin' && target.name === '_Bool'
        && (isArithmeticType(source) || source.kind === 'pointer');
}

function isIntegerBuiltin(name: BuiltinTypeName): boolean {
    return name !== 'void' && name !== 'float' && name !== 'double' && name !== 'long double';
}

function isFloatingBuiltin(name: BuiltinTypeName): boolean {
    return name === 'float' || name === 'double' || name === 'long double';
}

function isCharacterBuiltin(name: BuiltinTypeName): boolean {
    return name === 'char' || name === 'signed char' || name === 'unsigned char';
}

function builtinIsSigned(name: BuiltinTypeName): boolean {
    return name !== '_Bool' && !name.startsWith('unsigned');
}

function builtinLayout(name: BuiltinTypeName): readonly [number, number] {
    switch (name) {
        case 'void': return [0, 1];
        case '_Bool': return MERC32_ABI.builtin.bool;
        case 'char':
        case 'signed char':
        case 'unsigned char': return MERC32_ABI.builtin.char;
        case 'short':
        case 'unsigned short': return MERC32_ABI.builtin.short;
        case 'int':
        case 'unsigned int': return MERC32_ABI.builtin.int;
        case 'long':
        case 'unsigned long': return MERC32_ABI.builtin.long;
        case 'long long':
        case 'unsigned long long': return MERC32_ABI.builtin.longLong;
        case 'float': return MERC32_ABI.builtin.float;
        case 'double': return MERC32_ABI.builtin.double;
        case 'long double': return MERC32_ABI.builtin.longDouble;
    }
}

function roundUp(value: number, alignment: number): number {
    return Math.ceil(value / alignment) * alignment;
}

function assertInvariant(
    condition: unknown,
    invariant: string,
    message: string,
): asserts condition {
    if (!condition) {
        throw failure(invariant, message);
    }
}

function failure(invariant: string, message: string): CFrontendInternalError {
    return new CFrontendInternalError(`${invariant}: ${message}`);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value: unknown, path: string): unknown {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'number') {
        assertInvariant(Number.isFinite(value), 'JSON_VALUE', `${path} must contain a finite number`);
        return value;
    }
    if (Array.isArray(value)) {
        return value.map((item, index) => cloneJson(item, `${path}[${index}]`));
    }
    assertInvariant(isObject(value), 'JSON_VALUE', `${path} must contain only JSON values`);
    const prototype = Object.getPrototypeOf(value);
    assertInvariant(prototype === Object.prototype || prototype === null,
        'JSON_VALUE', `${path} must be a plain JSON object`);
    const result: Record<string, unknown> = {};
    for (const key of Reflect.ownKeys(value)) {
        assertInvariant(typeof key === 'string', 'JSON_VALUE', `${path} cannot contain symbol keys`);
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        assertInvariant(descriptor !== undefined && descriptor.enumerable && 'value' in descriptor,
            'JSON_VALUE', `${path}.${key} must be an enumerable data property`);
        Object.defineProperty(result, key, {
            value: cloneJson(descriptor.value, `${path}.${key}`),
            enumerable: true,
            configurable: true,
            writable: true,
        });
    }
    return result;
}

function deepFreeze<T>(value: T, seen = new Set<object>()): T {
    if (value !== null && typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        for (const nested of Object.values(value as Record<string, unknown>)) {
            deepFreeze(nested, seen);
        }
        Object.freeze(value);
    }
    return value;
}
