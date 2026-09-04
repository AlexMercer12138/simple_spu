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
            complete: { type: 'boolean' },
            members: { type: 'array', items: aggregateMemberSchema },
        }, ['complete', 'members']),
        typeSchema('union', {
            name: { type: 'string' },
            complete: { type: 'boolean' },
            members: { type: 'array', items: aggregateMemberSchema },
        }, ['complete', 'members']),
        typeSchema('enum', {
            name: { type: 'string' },
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
    'do-while', 'for', 'switch', 'case', 'default', 'break', 'continue', 'empty',
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
}, ['id', 'path', 'byteLength']);

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
        status: { enum: ['ok', 'error', 'internal-error'] },
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
    ...plainStatementKinds,
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
    unit.nodes.forEach((node) => checkRange(node.range, `${node.kind} node`));

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
    }
    return uniqueMap(sourceFiles, 'source file');
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
            write.value, type, types, symbols, `initializer write at ${write.offset}`);
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
            validateExpressionCategory(node, expressionType, symbols);
            if (node.constant !== undefined) {
                validateConstantForDestination(
                    node.constant, expressionType, types, symbols, `expression node ${node.id}`);
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
    }
    for (const declarationId of declarations) {
        const node = requireNode(nodes, declarationId, 'top-level declaration');
        assertInvariant(node.category === 'declaration', 'CROSS_KIND_REFERENCE',
            `top-level declaration ${declarationId} is not a declaration node`);
        assertInvariant(node.kind !== 'parameter-declaration', 'DECLARATION_SEMANTICS',
            `top-level declaration ${declarationId} is not a file-scope declaration kind`);
    }
    rejectNodeCycles(records, nodes);
}

function validateConstantForDestination(
    constant: TypedConstant,
    destinationType: TypedTypeRecord,
    types: ReadonlyMap<number, TypedTypeRecord>,
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
    label: string,
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
                const symbolType = unaliasType(
                    requireType(types, symbol.type, `variable symbol ${symbol.id} type`), types);
                const pointsToVoid = pointee.kind === 'builtin' && pointee.name === 'void';
                assertInvariant(pointsToVoid || sameResolvedType(pointee, symbolType),
                    'CONSTANT_TYPE', `${label} address pointee type disagrees with its symbol`);
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
            assertInvariant(constant.bytes.length === destination.size,
                'CONSTANT_TYPE', `${label} string constant byte size disagrees with its array destination`);
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
    symbols: ReadonlyMap<number, TypedSymbolRecord>,
): void {
    if (node.kind === 'declaration-reference') {
        const symbol = requireSymbolKind(symbols, node.symbol,
            ['variable', 'function', 'parameter', 'enumerator'], `expression node ${node.id} symbol`);
        assertInvariant('type' in symbol && symbol.type === type.id, 'CROSS_KIND_REFERENCE',
            `expression node ${node.id} type disagrees with its referenced symbol`);
        const expected = symbol.kind === 'function' ? 'function'
            : symbol.kind === 'enumerator' ? 'rvalue' : 'lvalue';
        assertInvariant(node.valueCategory === expected, 'NODE_EXPRESSION_METADATA',
            `declaration reference ${node.id} must have ${expected} value category`);
        return;
    }
    const expected = node.kind === 'string-literal' || node.kind === 'compound-literal'
        ? 'lvalue' : 'rvalue';
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
