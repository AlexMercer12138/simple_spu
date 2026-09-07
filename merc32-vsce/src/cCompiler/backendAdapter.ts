import {
    CFrontendDiagnostic,
    SourceRange,
    TypedCUnitV1,
    TypedConstant,
    TypedNodeRecord,
    TypedSymbolRecord,
    TypedTypeRecord,
} from '../cFrontend/contract';
import { MERC32_ABI } from '../cFrontend/merc32Abi';
import { CFrontendInternalError } from '../cFrontend/validate';
import { SourceLocation } from './source';
import {
    CType,
    isIntegerType,
    isScalarType,
    typeAlignment,
    typeSize,
} from './types';
import {
    LoweringAddress,
    LoweringConstant,
    LoweringExpression,
    LoweringFunction,
    LoweringGlobal,
    LoweringInitializer,
    LoweringInitializerWrite,
    LoweringProgram,
    LoweringStatement,
} from './loweringModel';

export class CBackendCapabilityError extends Error {
    public readonly name = 'CBackendCapabilityError';
    public readonly diagnostics: readonly CFrontendDiagnostic[];

    public constructor(diagnostics: readonly CFrontendDiagnostic[]) {
        super(diagnostics[0]?.message ?? 'MERC32 backend capability is unavailable');
        Object.setPrototypeOf(this, new.target.prototype);
        this.diagnostics = Object.freeze([...diagnostics]);
    }
}

const rangeLocation = (range: SourceRange, files: ReadonlyMap<number, string>): SourceLocation => ({
    file: files.get(Number(range.file)) ?? String(range.file),
    line: range.start.line,
    column: range.start.column,
});

function diagnostic(message: string, range: SourceRange, files: ReadonlyMap<number, string>, code = 'C_BACKEND_CAPABILITY'): CFrontendDiagnostic {
    return {
        severity: 'error', code, message, range,
        related: [], notes: [], includeTrace: [], macroExpansionTrace: [],
    };
}

function fail(message: string, range: SourceRange, files: ReadonlyMap<number, string>): never {
    throw new CBackendCapabilityError([diagnostic(message, range, files)]);
}

function qualifiers(record: TypedTypeRecord): { const: boolean; volatile: boolean; restrict: boolean; atomic: boolean } {
    return {
        const: record.qualifiers.includes('const'),
        volatile: record.qualifiers.includes('volatile'),
        restrict: record.qualifiers.includes('restrict'),
        atomic: record.qualifiers.includes('atomic'),
    };
}

function parseInteger(value: string): bigint {
    try { return BigInt(value); } catch { throw new CFrontendInternalError(`invalid integer constant ${value}`); }
}

function constantValue(constant: TypedConstant, symbols: ReadonlyMap<number, TypedSymbolRecord>, files: ReadonlyMap<number, string>, range: SourceRange): LoweringConstant {
    switch (constant.kind) {
        case 'integer': {
            const value = parseInteger(constant.value);
            const limit = 1n << BigInt(constant.bits);
            const minimum = constant.signed ? -(limit >> 1n) : 0n;
            const maximum = constant.signed ? (limit >> 1n) - 1n : limit - 1n;
            if (value < minimum || value > maximum) {
                fail(`integer constant ${constant.value} does not fit ${constant.bits}-bit ${constant.signed ? 'signed' : 'unsigned'} value`, range, files);
            }
            return value;
        }
        case 'address': {
            const symbol = symbols.get(Number(constant.symbol));
            if (!symbol) throw new CFrontendInternalError(`address constant references unknown symbol ${constant.symbol}`);
            const addend = parseInteger(constant.addend);
            if (addend < -2147483648n || addend > 2147483647n) fail('address relocation addend is outside signed 32-bit range', range, files);
            return { symbol: symbol.name, addend } satisfies LoweringAddress;
        }
        case 'string': return { bytes: Object.freeze([...constant.bytes]) };
        case 'floating': fail('floating-point constants are not lowered by the MERC32 backend', range, files);
    }
}

function isUnsupportedBuiltin(name: string): boolean {
    return name === 'long long' || name === 'unsigned long long'
        || name === 'float' || name === 'double' || name === 'long double';
}

export function adaptTypedUnit(unit: TypedCUnitV1): LoweringProgram {
    if (unit.abi !== MERC32_ABI.abi || unit.target !== MERC32_ABI.target || unit.dataModel !== MERC32_ABI.dataModel) {
        throw new CFrontendInternalError('typed unit identity does not match the MERC32 backend');
    }
    const files = new Map(unit.sourceFiles.map((file) => [Number(file.id), file.path]));
    const symbols = new Map(unit.symbols.map((symbol) => [Number(symbol.id), symbol]));
    const records = new Map(unit.types.map((record) => [Number(record.id), record]));
    const shells = new Map<number, CType>();
    for (const record of unit.types) {
        const q = qualifiers(record);
        if (q.atomic) fail('atomic-qualified types are not supported by the MERC32 backend', findRange(record, unit), files);
        if (record.alignment > MERC32_ABI.maximumNaturalAlignment) fail('over-aligned types are not supported by the MERC32 object ABI', findRange(record, unit), files);
        let shell: CType;
        switch (record.kind) {
            case 'builtin': shell = { kind: 'builtin', name: record.name, qualifiers: q } as CType; break;
            case 'pointer': shell = { kind: 'pointer', pointee: undefined, qualifiers: q } as unknown as CType; break;
            case 'array': shell = { kind: 'array', element: undefined, length: record.count, qualifiers: q } as unknown as CType; break;
            case 'function': shell = { kind: 'function', returnType: undefined, parameters: [], variadic: record.variadic, qualifiers: q } as unknown as CType; break;
            case 'struct': shell = { kind: 'struct', name: record.name, fields: [], qualifiers: q } as unknown as CType; break;
            case 'union': shell = { kind: 'union', name: record.name, fields: [], qualifiers: q } as unknown as CType; break;
            case 'enum': shell = { kind: 'enum', name: record.name, values: {}, qualifiers: q } as unknown as CType; break;
            case 'typedef': shell = { kind: 'typedef', name: record.name, target: undefined, qualifiers: q } as unknown as CType; break;
        }
        shells.set(Number(record.id), shell);
    }
    for (const record of unit.types) {
        const shell = shells.get(Number(record.id)) as any;
        switch (record.kind) {
            case 'pointer': shell.pointee = shells.get(Number(record.pointee)); break;
            case 'array': shell.element = shells.get(Number(record.element)); break;
            case 'function': shell.returnType = shells.get(Number(record.returnType)); shell.parameters = Object.freeze(record.parameters.map((id) => shells.get(Number(id)))); break;
            case 'typedef': shell.target = shells.get(Number(record.target)); break;
            case 'struct': case 'union':
                if (record.packed) fail('packed record layout is not supported by the MERC32 backend', findRange(record, unit), files);
                shell.fields = Object.freeze(record.members.map((member) => ({
                    name: member.name, type: shells.get(Number(member.type)), offset: member.offset,
                    ...(member.bitOffset === undefined ? {} : { bitOffset: member.bitOffset }),
                    ...(member.bitWidth === undefined ? {} : { bitWidth: member.bitWidth }),
                })));
                shell.nominalId = record.nominalId === undefined ? undefined : Number(record.nominalId);
                if (record.members.some((member) => member.bitWidth !== undefined)) fail('bit-field lowering is not supported by the MERC32 backend', findRange(record, unit), files);
                break;
            case 'enum':
                shell.values = Object.freeze(Object.fromEntries(record.enumerators.map((entry) => [entry.name, Number(parseInteger(entry.value))])));
                shell.nominalId = record.nominalId === undefined ? undefined : Number(record.nominalId);
                break;
            case 'builtin': break;
        }
    }
    for (const symbol of unit.symbols) {
        const consumesValueType = symbol.kind === 'function' && symbol.definition
            || symbol.kind === 'variable' && symbol.definition && symbol.storage !== 'automatic';
        if (!consumesValueType) continue;
        const type = shells.get(Number(symbol.type));
        if (!type) throw new CFrontendInternalError(`${symbol.kind} ${symbol.name} references unknown type`);
        requireSupportedValueType(type, symbol.range, files);
    }
    for (const record of unit.types) {
        const shell = shells.get(Number(record.id)) as CType;
        const functionShape = unwrapType(shell);
        if (functionShape.kind === 'function') {
            if (functionShape.variadic) fail('variadic functions are not supported by the MERC32 backend', findRange(record, unit), files);
            if (typeSize(functionShape.returnType) > 4 || functionShape.parameters.some((parameter: CType) => typeSize(parameter) > 4)) {
                fail('aggregate function return and parameter values are not supported by the MERC32 backend', findRange(record, unit), files);
            }
        }
        if (functionShape.kind !== 'function' && (typeSize(shell) !== record.size || typeAlignment(shell) !== record.alignment)) {
            throw new CFrontendInternalError(`serialized layout disagrees with MERC32 ABI for type ${record.id}`);
        }
    }
    for (const shell of shells.values()) Object.freeze(shell);

    const nodeRecords = new Map(unit.nodes.map((node) => [Number(node.id), node]));
    const functionScopedVariables = new Set<number>();
    for (const root of unit.declarations) {
        const rootNode = nodeRecords.get(Number(root));
        if (!rootNode || rootNode.kind !== 'function-definition') continue;
        const visit = (id: number): void => {
            const current = nodeRecords.get(id); if (!current) return;
            if (current.category === 'declaration' && 'symbol' in current) {
                const symbol = symbols.get(Number(current.symbol));
                if (symbol?.kind === 'variable') functionScopedVariables.add(Number(symbol.id));
            }
            current.children.forEach((child) => visit(Number(child)));
        };
        rootNode.children.forEach((child) => visit(Number(child)));
    }
    const expressionMemo = new Map<number, LoweringExpression>();
    const adaptExpression = (id: number): LoweringExpression => {
        const cached = expressionMemo.get(id); if (cached) return cached;
        const node = nodeRecords.get(id); if (!node || node.category !== 'expression') throw new CFrontendInternalError(`node ${id} is not an expression`);
        const typed = node as Extract<TypedNodeRecord, { category: 'expression' }>;
        const type = shells.get(Number(typed.type)); if (!type) throw new CFrontendInternalError(`expression ${id} references unknown type`);
        requireSupportedValueType(type, typed.range, files);
        if (typed.kind === 'generic-selection' || typed.kind === 'compound-literal' || typed.kind === 'string-literal') {
            fail(`${typed.kind} is not supported by the MERC32 backend`, typed.range, files);
        }
        const operands = Object.freeze(typed.children.map((child) => adaptExpression(Number(child))));
        const expression: LoweringExpression = {
            kind: typed.kind,
            type,
            valueCategory: typed.valueCategory,
            location: rangeLocation(typed.range, files),
            operands,
            ...(typed.constant ? { constant: constantValue(typed.constant, symbols, files, typed.range) } : {}),
            ...('operator' in typed ? { operator: typed.operator } : {}),
            ...('conversion' in typed ? { conversion: typed.conversion, targetType: shells.get(Number(typed.targetType)) } : {}),
            ...('symbol' in typed ? symbolBinding(Number(typed.symbol), symbols) : {}),
            ...('memberIndex' in typed ? {
                memberIndex: Number(typed.memberIndex),
                memberOffset: memberOffset(operands[0]?.type ?? type, Number(typed.memberIndex), files),
            } : {}),
            ...('targetType' in typed && !('conversion' in typed) ? { targetType: shells.get(Number(typed.targetType)) } : {}),
        };
        if ((typed.kind === 'binary' && !['+', '-', '*', '/', '%', '&', '|', '^', '<<', '>>', '==', '!=', '<', '<=', '>', '>=', '&&', '||'].includes(typed.operator))
            || (typed.kind === 'assignment' && typed.operator !== '=')
            || (typed.kind === 'unary' && !['+', '-', '!', '~', '&', '*', 'parentheses', 'cast'].includes(typed.operator))) {
            fail(`operator '${'operator' in typed ? typed.operator : String((typed as { kind: string }).kind)}' is not supported by the MERC32 backend`, typed.range, files);
        }
        if (typed.kind === 'unary' && typed.operator === 'parentheses'
            && (type !== operands[0].type || typed.valueCategory !== operands[0].valueCategory)) {
            fail('parenthesized expressions must preserve type and value category', typed.range, files);
        }
        if (typed.kind === 'unary' && typed.operator === 'cast'
            && !isSupportedIdentityCast(operands[0].type, type)) {
            fail('narrowing or widening explicit casts are not supported by the MERC32 backend', typed.range, files);
        }
        if (typed.kind === 'conversion' && !['lvalue-to-rvalue', 'array-to-pointer', 'function-to-pointer', 'integer-promotion', 'usual-arithmetic', 'assignment', 'argument', 'return', 'no-op', 'bitcast', 'int-cast', 'pointer-to-bool', 'pointer-to-int', 'bool-to-int', 'int-to-bool', 'int-to-pointer', 'to-void', 'null-to-pointer'].includes(typed.conversion)) {
            fail(`conversion '${typed.conversion}' is not supported by the MERC32 backend`, typed.range, files);
        }
        if (typed.kind === 'conversion' && typed.conversion === 'int-cast'
            && typeSize(type) !== typeSize(operands[0].type)) {
            fail('narrowing or widening integer casts are not supported by the MERC32 backend', typed.range, files);
        }
        const transparentParentheses = typed.kind === 'unary' && typed.operator === 'parentheses';
        if (typed.kind !== 'declaration-reference' && typed.kind !== 'member'
            && !transparentParentheses && typeSize(type) > 4) {
            fail('aggregate-valued operations are not supported by the MERC32 backend', typed.range, files);
        }
        expressionMemo.set(id, expression);
        return expression;
    };

    const statementMemo = new Map<number, LoweringStatement>();
    const adaptStatement = (id: number): LoweringStatement => {
        const cached = statementMemo.get(id); if (cached) return cached;
        const node = nodeRecords.get(id); if (!node || node.category !== 'statement') throw new CFrontendInternalError(`node ${id} is not a statement`);
        const location = rangeLocation(node.range, files);
        const child = (index: number): LoweringStatement => adaptStatement(Number(node.children[index]));
        const expr = (index: number): LoweringExpression => adaptExpression(Number(node.children[index]));
        let statement: LoweringStatement;
        switch (node.kind) {
            case 'compound': statement = { kind: 'compound', statements: Object.freeze(node.children.map((id) => adaptStatement(Number(id)))), location }; break;
            case 'declaration-statement': {
                const declarations = node.children.map((id) => nodeRecords.get(Number(id))).filter((item): item is Extract<TypedNodeRecord, { category: 'declaration' }> & { symbol: number } => item?.category === 'declaration' && 'symbol' in item);
                const variableDeclarations = declarations.filter((declaration) => symbols.get(Number(declaration.symbol))?.kind === 'variable');
                if (variableDeclarations.length === 0) { statement = { kind: 'empty', location }; break; }
                const statements = variableDeclarations.map((declaration) => {
                    const symbol = symbols.get(Number(declaration.symbol)); if (!symbol || !('type' in symbol)) throw new CFrontendInternalError('declaration statement has no symbol');
                    if (symbol.kind !== 'variable') throw new CFrontendInternalError('declaration statement variable filter failed');
                    if (symbol.storage === 'thread') fail('thread-local storage is not supported by the MERC32 backend', symbol.range, files);
                    if (symbol.storage !== 'automatic') fail(`${symbol.storage} block-scope objects are not supported by the MERC32 backend`, symbol.range, files);
                    const initializer = declaration.children.length === 1 ? adaptExpression(Number(declaration.children[0])) : undefined;
                    const binding = localBinding(symbol);
                    const type = shells.get(Number(symbol.type)) as CType;
                    requireSupportedValueType(type, symbol.range, files);
                    return { kind: 'declaration' as const, name: symbol.name, ...(binding ? { binding } : {}), symbolId: Number(symbol.id), type, ...(initializer ? { initializer } : {}), location };
                });
                statement = statements.length === 1 ? statements[0] : { kind: 'compound', statements, location };
                break;
            }
            case 'expression-statement': statement = { kind: 'expression', expression: expr(0), location }; break;
            case 'return': statement = { kind: 'return', ...(node.children.length ? { expression: expr(0) } : {}), location }; break;
            case 'if': statement = { kind: 'if', test: expr(0), thenBranch: child(1), ...(node.children.length > 2 ? { elseBranch: child(2) } : {}), location }; break;
            case 'while': statement = { kind: 'while', test: expr(0), body: child(1), location }; break;
            case 'do-while': statement = { kind: 'do-while', body: child(0), test: expr(1), location }; break;
            case 'for': {
                const mask = node.forClauseMask ?? (node.children.length === 1 ? 0 : 7);
                let index = 0;
                const init = mask & 1 ? nodeRecords.get(Number(node.children[index]))?.category === 'expression' ? expr(index++) : child(index++) : undefined;
                const test = mask & 2 ? expr(index++) : undefined;
                const step = mask & 4 ? expr(index++) : undefined;
                statement = { kind: 'for', init, test, step, body: child(index), location };
                break;
            }
            case 'switch': statement = { kind: 'switch', test: expr(0), body: child(1), location }; break;
            case 'case': statement = { kind: 'case', value: parseInteger(node.caseValue.value), statement: child(node.children.length - 1), location }; break;
            case 'default': statement = { kind: 'default', statement: child(0), location }; break;
            case 'goto': statement = { kind: 'goto', label: node.label, location }; break;
            case 'label': statement = { kind: 'label', label: node.label, statement: child(0), location }; break;
            case 'break': case 'continue': case 'empty': statement = { kind: node.kind, location }; break;
            default: throw new CFrontendInternalError('unsupported statement node');
        }
        statementMemo.set(id, statement); return statement;
    };

    const globals: LoweringGlobal[] = [];
    for (const symbol of unit.symbols) {
        if (symbol.kind !== 'variable') continue;
        if (symbol.storage === 'thread') fail('thread-local storage is not supported by the MERC32 backend', symbol.range, files);
        if (symbol.storage === 'automatic' || !symbol.definition) continue;
        if (functionScopedVariables.has(Number(symbol.id))) fail(`${symbol.storage} block-scope objects are not supported by the MERC32 backend`, symbol.range, files);
        const type = shells.get(Number(symbol.type)); if (!type) throw new CFrontendInternalError(`global ${symbol.name} references unknown type`);
        requireSupportedValueType(type, symbol.range, files);
        const initializer = symbol.initializer?.writes.length
            ? adaptInitializer(symbol.initializer, type, unit, shells, symbols, files, symbol.range)
            : undefined;
        globals.push({ name: symbol.name, binding: symbol.linkage === 'internal' ? 'local' : 'global', type, ...(initializer ? { initializer } : {}), location: rangeLocation(symbol.range, files) });
    }
    const functions: LoweringFunction[] = [];
    for (const symbol of unit.symbols) {
        if (symbol.kind !== 'function' || !symbol.definition) continue;
        const type = unwrapType(shells.get(Number(symbol.type)) as CType);
        if (type.kind !== 'function') throw new CFrontendInternalError(`function ${symbol.name} has non-function type`);
        requireSupportedValueType(type, symbol.range, files);
        if (type.variadic) fail('variadic functions are not supported by the MERC32 backend', symbol.range, files);
        const definition = unit.declarations.map((id) => nodeRecords.get(Number(id))).find((node) => node?.kind === 'function-definition' && 'symbol' in node && Number(node.symbol) === Number(symbol.id));
        const bodyNode = definition?.children.map((id) => nodeRecords.get(Number(id))).find((node) => node?.category === 'statement' && node.kind === 'compound');
        const body: LoweringStatement = bodyNode ? adaptStatement(Number(bodyNode.id)) : { kind: 'compound', statements: [], location: rangeLocation(symbol.range, files) };
        const parameters = (definition?.children ?? []).flatMap((id) => {
            const declaration = nodeRecords.get(Number(id));
            if (declaration?.kind !== 'parameter-declaration') return [];
            const parameter = symbols.get(Number(declaration.symbol));
            if (parameter?.kind !== 'parameter' || parameter.owner !== symbol.id) {
                throw new CFrontendInternalError('function definition has an invalid parameter binding');
            }
            return [parameter];
        });
        const locals: TypedSymbolRecord[] = [];
        const collectLocals = (statement: LoweringStatement): void => {
            if (statement.kind === 'declaration') {
                const local = unit.symbols.find((candidate) => candidate.kind === 'variable' && Number(candidate.id) === statement.symbolId && candidate.storage === 'automatic');
                if (local) locals.push(local);
            }
            if (statement.kind === 'compound') statement.statements.forEach(collectLocals);
            else if ('body' in statement && statement.body) collectLocals(statement.body);
            if (statement.kind === 'if') { collectLocals(statement.thenBranch); if (statement.elseBranch) collectLocals(statement.elseBranch); }
            if (statement.kind === 'for' && statement.init && isLoweringStatement(statement.init)) collectLocals(statement.init);
            if ((statement.kind === 'case' || statement.kind === 'default' || statement.kind === 'label') && statement.statement) collectLocals(statement.statement);
        };
        collectLocals(body);
        const parameterNames = type.parameters.map((_parameter, index) => parameters[index] ? localBinding(parameters[index]) ?? parameters[index].name : '');
        functions.push({ name: symbol.name, binding: symbol.linkage === 'internal' ? 'local' : 'global', returnType: type.returnType, parameters: type.parameters, parameterNames, localNames: locals.map((local) => localBinding(local) ?? local.name), localTypes: locals.map((local) => shells.get(Number((local as Extract<TypedSymbolRecord, { kind: 'variable' }>).type)) as CType), body, location: rangeLocation(symbol.range, files) });
    }
    return freezeLowering({ abi: 'merc32-c-v1' as const, globals, functions });
}

function freezeLowering<T>(value: T, seen = new Set<object>()): T {
    if (value !== null && typeof value === 'object' && !seen.has(value)) {
        seen.add(value);
        for (const child of Object.values(value)) freezeLowering(child, seen);
        Object.freeze(value);
    }
    return value;
}

function findRange(record: TypedTypeRecord, unit: TypedCUnitV1): SourceRange {
    const node = unit.nodes.find((candidate) => candidate.category === 'expression' && Number(candidate.type) === Number(record.id))
        ?? unit.nodes.find((candidate) => candidate.category === 'declaration' && 'type' in candidate && Number(candidate.type) === Number(record.id));
    if (node) return node.range;
    if ((record.kind === 'struct' || record.kind === 'union') && record.members[0]) return record.members[0].range;
    const first = unit.sourceFiles[0];
    return { file: first.id, start: { line: 1, column: 1, byteOffset: 0 }, end: { line: 1, column: 1, byteOffset: 0 } };
}

function isLoweringStatement(value: LoweringExpression | LoweringStatement): value is LoweringStatement {
    return value.kind !== 'integer-literal' && value.kind !== 'character-literal'
        && value.kind !== 'floating-literal' && value.kind !== 'string-literal'
        && value.kind !== 'declaration-reference' && value.kind !== 'unary'
        && value.kind !== 'binary' && value.kind !== 'conditional' && value.kind !== 'assignment'
        && value.kind !== 'call' && value.kind !== 'subscript' && value.kind !== 'member'
        && value.kind !== 'sizeof' && value.kind !== 'alignof' && value.kind !== 'conversion';
}

function memberOffset(type: CType, index: number, files: ReadonlyMap<number, string>): number {
    type = unwrapType(type);
    if (type.kind === 'pointer') type = unwrapType(type.pointee);
    if (type.kind !== 'struct' && type.kind !== 'union') throw new CFrontendInternalError('member expression base is not an aggregate');
    const member = type.fields[index];
    if (!member) throw new CFrontendInternalError(`aggregate member index ${index} is out of range`);
    return member.offset ?? 0;
}

function unwrapType(type: CType): CType {
    const seen = new Set<CType>();
    let current = type;
    while (current.kind === 'typedef' && current.target && !seen.has(current)) {
        seen.add(current);
        current = current.target;
    }
    return current;
}

function requireSupportedValueType(type: CType, range: SourceRange,
    files: ReadonlyMap<number, string>): void {
    const unsupported = unsupportedValueBuiltin(type, new Set());
    if (unsupported) fail(`${unsupported} operations are not supported by the MERC32 backend`, range, files);
}

function unsupportedValueBuiltin(type: CType, seen: Set<CType>): string | undefined {
    type = unwrapType(type);
    if (seen.has(type)) return undefined;
    seen.add(type);
    if (type.kind === 'builtin') return isUnsupportedBuiltin(type.name) ? type.name : undefined;
    if (type.kind === 'array') return unsupportedValueBuiltin(type.element, seen);
    if (type.kind === 'function') {
        return unsupportedValueBuiltin(type.returnType, seen)
            ?? type.parameters.map((parameter) => unsupportedValueBuiltin(parameter, seen))
                .find((name) => name !== undefined);
    }
    if (type.kind === 'struct' || type.kind === 'union') {
        return type.fields.map((field) => unsupportedValueBuiltin(field.type, seen))
            .find((name) => name !== undefined);
    }
    return undefined;
}

function isSupportedIdentityCast(source: CType, target: CType): boolean {
    source = unwrapType(source);
    target = unwrapType(target);
    if (!isScalarType(source) || !isScalarType(target)) return false;
    if (typeSize(source) > 4 || typeSize(source) !== typeSize(target)) return false;
    if (target.kind === 'builtin' && target.name === '_Bool'
        && !(source.kind === 'builtin' && source.name === '_Bool')) return false;
    const sourceInteger = isIntegerType(source);
    const targetInteger = isIntegerType(target);
    return sourceInteger && targetInteger
        || sourceInteger && target.kind === 'pointer'
        || source.kind === 'pointer' && targetInteger
        || source.kind === 'pointer' && target.kind === 'pointer';
}

function localBinding(symbol: TypedSymbolRecord): string | undefined {
    if (symbol.kind === 'variable' && symbol.storage !== 'automatic') return undefined;
    if (symbol.kind !== 'variable' && symbol.kind !== 'parameter') return undefined;
    return `${symbol.name}#${Number(symbol.id)}`;
}

function symbolBinding(id: number, symbols: ReadonlyMap<number, TypedSymbolRecord>): Readonly<{ symbol: string; binding?: string; symbolId: number; constant?: LoweringConstant }> {
    const symbol = symbols.get(id);
    if (!symbol) throw new CFrontendInternalError(`declaration-reference references unknown symbol ${id}`);
    if (symbol.kind === 'enumerator') {
        return { symbol: symbol.name, symbolId: id, constant: parseInteger(symbol.value.value) };
    }
    return { symbol: symbol.name, binding: localBinding(symbol), symbolId: id };
}

function adaptInitializer(initializer: NonNullable<Extract<TypedSymbolRecord, { kind: 'variable' }>['initializer']>, _type: CType, unit: TypedCUnitV1, _types: ReadonlyMap<number, CType>, symbols: ReadonlyMap<number, TypedSymbolRecord>, files: ReadonlyMap<number, string>, ownerRange: SourceRange): LoweringInitializer {
    const writes: LoweringInitializerWrite[] = initializer.writes.map((write) => {
        const type = _types.get(Number(write.type)) as CType;
        requireSupportedValueType(type, ownerRange, files);
        return {
            offset: write.offset,
            type,
            value: constantValue(write.value, symbols, files, ownerRange),
            location: rangeLocation(ownerRange, files),
        };
    });
    return { size: initializer.size, writes: Object.freeze(writes) };
}
