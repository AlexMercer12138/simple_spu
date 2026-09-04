import { CPreprocessOptions, preprocessCFile } from '../cPreprocessor';
import { DebugLocation, Merc32Object } from '../linker/objectFormat';
import { CFrontendError, SourceLocation } from './source';
import { CType } from './types';
import { CInitializer, Expression, Statement, TranslationUnit } from './declarations';
import { tokenizeC } from './lexer';
import { parseTranslationUnit } from './parser';
import { analyzeTranslationUnit } from './sema';
import { lowerProgram } from './lower';
import { generateObject } from './codegen';
import type { CompileOptions } from './tinyc';

let invocationCount = 0;

/** Temporary handwritten frontend entry point for the explicit differential harness only. */
export function compileLegacyCToObject(source: string, options: CompileOptions = {}): Merc32Object {
    invocationCount += 1;
    rejectObjectLayoutOptions(options, { file: '', line: 1, column: 1 });
    const tokens = tokenizeC(source);
    rejectUnsupportedTypedLiterals(tokens);
    const unit = parseTranslationUnit(tokens);
    validateTypedObjectSubset(unit, tokens[0]?.location ?? { file: '', line: 1, column: 1 });
    return generateObject(lowerProgram(analyzeTranslationUnit(unit)));
}

/** Temporary handwritten file entry point for differential diagnostics only. */
export function compileLegacyCFileToObject(sourceFile: string, options: CompileOptions & {
    readonly preprocess?: CPreprocessOptions;
} = {}): Merc32Object {
    invocationCount += 1;
    const { preprocess, ...compileOptions } = options;
    const preprocessed = preprocessCFile(sourceFile, preprocess);
    rejectObjectLayoutOptions(compileOptions, {
        file: preprocessed.lineMap[0]?.file ?? '', line: preprocessed.lineMap[0]?.line ?? 1, column: 1,
    });
    const tokens = tokenizeC(preprocessed.code, preprocessed.lineMap);
    rejectUnsupportedTypedLiterals(tokens);
    const unit = parseTranslationUnit(tokens);
    validateTypedObjectSubset(unit, tokens[0]?.location ?? { file: '', line: 1, column: 1 });
    const object = generateObject(lowerProgram(analyzeTranslationUnit(unit)));
    return {
        ...object,
        debug: preprocessed.lineMap.map((location): DebugLocation => ({ ...location, column: 1 })),
    };
}

export function getLegacyFrontendInvocationCount(): number {
    return invocationCount;
}

export function resetLegacyFrontendInvocationCount(): void {
    invocationCount = 0;
}

function rejectObjectLayoutOptions(options: CompileOptions, location: SourceLocation): void {
    if (options.dataBase !== undefined || options.dlbAddrWidth !== undefined) {
        throw new CFrontendError('typed C object backend does not support dataBase or dlbAddrWidth options', location);
    }
}

function rejectUnsupportedTypedLiterals(tokens: readonly {
    readonly kind: string; readonly text: string; readonly location: SourceLocation;
}[]): void {
    for (const token of tokens) {
        if (token.kind !== 'number') continue;
        if (/[.]/.test(token.text)
            || /[eE][+-]?\d/.test(token.text)
            || /[pP][+-]?\d/.test(token.text)
            || (/[fF]$/.test(token.text) && !/^0[xX]/.test(token.text))) {
            throw new CFrontendError('typed C object backend does not support floating-point function bodies', token.location);
        }
    }
}

function validateTypedObjectSubset(unit: TranslationUnit, fallback: SourceLocation): void {
    for (const declaration of unit.declarations) {
        for (const declarator of declaration.declarators) {
            if (!declarator.name || declaration.kind === 'typedef') continue;
            if (declarator.type.kind !== 'function') {
                if (!isSupportedObjectType(declarator.type)) {
                    throw new CFrontendError('typed C object backend does not support this global object type',
                        declaration.location ?? fallback);
                }
                if (declarator.initializer) validateTypedInitializer(declarator.initializer, fallback, declarator.type);
                continue;
            }
            if (!declarator.body) continue;
            if (!isSupportedFunctionType(declarator.type.returnType)
                || declarator.type.parameters.some((parameter) => !isSupportedFunctionType(parameter))) {
                throw new CFrontendError(unsupportedTypeMessage(declarator.type.returnType, declarator.type.parameters),
                    declaration.location ?? fallback);
            }
            validateTypedStatements(declarator.body.statements, fallback);
        }
    }
}

function isSupportedFunctionType(type: CType): boolean {
    if (type.kind === 'builtin') {
        return type.name === 'void'
            || ['char', 'unsigned char', 'short', 'unsigned short', 'int', 'unsigned int', 'long', 'unsigned long'].includes(type.name);
    }
    if (type.kind === 'enum') return true;
    if (type.kind === 'pointer') {
        return type.pointee.kind === 'function'
            ? isSupportedFunctionType(type.pointee.returnType)
                && type.pointee.parameters.every(isSupportedFunctionType)
            : isSupportedObjectType(type.pointee) || type.pointee.kind === 'builtin' && type.pointee.name === 'void';
    }
    return type.kind === 'typedef' && type.target !== undefined && isSupportedFunctionType(type.target);
}

function isSupportedObjectType(type: CType): boolean {
    if (type.kind === 'builtin') {
        return ['char', 'unsigned char', 'short', 'unsigned short', 'int', 'unsigned int', 'long', 'unsigned long'].includes(type.name);
    }
    if (type.kind === 'enum' || type.kind === 'pointer') return true;
    if (type.kind === 'array') return type.length !== null && isSupportedObjectType(type.element);
    if (type.kind === 'struct' || type.kind === 'union') {
        return type.fields.length > 0 && type.fields.every((field) => isSupportedObjectType(field.type));
    }
    return type.kind === 'typedef' && type.target !== undefined && isSupportedObjectType(type.target);
}

function validateTypedStatements(statements: readonly Statement[], fallback: SourceLocation): void {
    for (const statement of statements) {
        switch (statement.kind) {
            case 'compound': validateTypedStatements(statement.statements, statement.location ?? fallback); break;
            case 'local-declaration':
                if (!isSupportedObjectType(statement.type)) {
                    throw new CFrontendError(isFloatingType(statement.type)
                        ? 'typed C object backend does not support floating-point function bodies'
                        : 'typed C object backend does not support non-32-bit function types', statement.location ?? fallback);
                }
                if (statement.initializer) validateTypedInitializer(statement.initializer, fallback, statement.type);
                break;
            case 'if': validateTypedExpression(statement.test, fallback); validateTypedStatement(statement.thenBranch, fallback); if (statement.elseBranch) validateTypedStatement(statement.elseBranch, fallback); break;
            case 'while': validateTypedExpression(statement.test, fallback); validateTypedStatement(statement.body, fallback); break;
            case 'do-while': validateTypedStatement(statement.body, fallback); validateTypedExpression(statement.test, fallback); break;
            case 'switch': validateTypedExpression(statement.test, fallback); validateTypedStatement(statement.body, fallback); break;
            case 'case': if (statement.value) validateTypedExpression(statement.value, fallback); validateTypedStatement(statement.statement, fallback); break;
            case 'for': if (statement.init && 'kind' in statement.init && typeof statement.init.kind === 'string') { if (statement.init.kind === 'local-declaration') validateTypedStatement(statement.init as Statement, fallback); else validateTypedExpression(statement.init as Expression, fallback); } if (statement.test) validateTypedExpression(statement.test, fallback); if (statement.step) validateTypedExpression(statement.step, fallback); validateTypedStatement(statement.body, fallback); break;
            case 'return': if (statement.expression) validateTypedExpression(statement.expression, fallback); break;
            case 'expression': validateTypedExpression(statement.expression, fallback); break;
            case 'label': validateTypedStatement(statement.statement, fallback); break;
            case 'break': case 'continue': case 'goto': case 'empty': break;
        }
    }
}

function validateTypedInitializer(initializer: CInitializer, fallback: SourceLocation, type?: CType): void {
    if (initializer.kind === 'string-literal' && type?.kind === 'array'
        && type.element.kind === 'builtin' && ['char', 'unsigned char'].includes(type.element.name)) return;
    if (initializer.kind !== 'initializer') {
        validateTypedExpression(initializer, fallback);
        return;
    }
    for (const entry of initializer.entries) {
        for (const designator of entry.designators) {
            if (designator.kind === 'index-designator') validateTypedExpression(designator.index, fallback);
        }
        validateTypedInitializer(entry.value, fallback);
    }
}

function unsupportedTypeMessage(returnType: CType, parameters: readonly CType[]): string {
    return [returnType, ...parameters].some(isFloatingType)
        ? 'typed C object backend does not support floating-point function bodies'
        : 'typed C object backend does not support non-32-bit function types';
}

function isFloatingType(type: CType): boolean {
    if (type.kind === 'builtin') return ['float', 'double', 'long double'].includes(type.name);
    return type.kind === 'typedef' && type.target !== undefined && isFloatingType(type.target);
}

function validateTypedStatement(statement: Statement, fallback: SourceLocation): void {
    if (statement.kind === 'compound') validateTypedStatements(statement.statements, statement.location ?? fallback);
    else validateTypedStatements([statement], fallback);
}

function validateTypedExpression(expression: Expression, fallback: SourceLocation): void {
    switch (expression.kind) {
        case 'integer-literal': case 'character-literal': case 'identifier': case 'alignof': break;
        case 'floating-literal': throw new CFrontendError('typed C object backend does not support floating-point function bodies', expression.location ?? fallback);
        case 'string-literal': throw new CFrontendError('typed C object backend does not support string literals yet', expression.location ?? fallback);
        case 'unary': validateTypedExpression(expression.operand, fallback); break;
        case 'call': validateTypedExpression(expression.callee, fallback); expression.arguments.forEach((argument) => validateTypedExpression(argument, fallback)); break;
        case 'subscript': validateTypedExpression(expression.object, fallback); validateTypedExpression(expression.index, fallback); break;
        case 'member': validateTypedExpression(expression.object, fallback); break;
        case 'sizeof': if (expression.expressionOperand) validateTypedExpression(expression.expressionOperand, fallback); break;
        case 'binary': validateTypedExpression(expression.left, fallback); validateTypedExpression(expression.right, fallback); break;
        case 'conditional': validateTypedExpression(expression.condition, fallback); validateTypedExpression(expression.consequent, fallback); validateTypedExpression(expression.alternate, fallback); break;
        case 'assignment': validateTypedExpression(expression.target, fallback); validateTypedExpression(expression.value, fallback); break;
    }
}
