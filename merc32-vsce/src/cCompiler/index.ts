import type { CPreprocessOptions } from '../cPreprocessor';
import type {
    CCompileDetailedResult,
    SourceFileRecord,
    TypedCEnvelopeV1,
} from '../cFrontend/contract';
import {
    CFrontendOptions,
    getAroFrontend,
} from '../cFrontend/frontend';
import { hasErrors, normalizeDiagnostics } from '../cFrontend/validate';
import { Merc32Object } from '../linker/objectFormat';
import { adaptTypedUnit, CBackendCapabilityError } from './backendAdapter';
import { generateObject } from './codegen';
import { lowerProgram } from './lower';
import { CFrontendError } from './source';
import { compileC as compileLegacyC, CompilerError, CompileResult } from './tinyc';

export type { Merc32Object } from '../linker/objectFormat';
export * from './types';
export * from './source';
export * from './ast';
export * from './lexer';
export * from './parser';
export * from './declarations';
export * from './sema';
export * from './initializers';
export * from './ir';
export * from './lower';
export * from './loweringModel';
export * from './backendAdapter';
export * from './codegen';
export * from './registers';
export * from '../runtime/runtimeCatalog';

export interface BackendCompileOptions {
    readonly dataBase?: number;
    readonly dlbAddrWidth?: number;
    readonly codeBase?: number;
    readonly moduleName?: string;
    readonly tempSlots?: number;
}

export interface CompileOptions extends BackendCompileOptions, CFrontendOptions {}

export interface CompileFileOptions extends CompileOptions {
    readonly preprocess?: CPreprocessOptions;
}

export function splitCompileOptions(options: CompileOptions = {}): Readonly<{
    frontend: CFrontendOptions;
    backend: BackendCompileOptions;
}> {
    const frontend: Record<string, unknown> = {};
    const backend: Record<string, unknown> = {};
    copyDefined(options, frontend, [
        'standard', 'sourceName', 'defines', 'includePaths', 'virtualFiles', 'limits',
    ] as const);
    copyDefined(options, backend, [
        'dataBase', 'dlbAddrWidth', 'codeBase', 'moduleName', 'tempSlots',
    ] as const);
    return Object.freeze({
        frontend: Object.freeze(frontend) as CFrontendOptions,
        backend: Object.freeze(backend) as BackendCompileOptions,
    });
}

function copyDefined<T extends object>(source: T, target: Record<string, unknown>,
    keys: readonly (keyof T)[]): void {
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined) target[String(key)] = value;
    }
}

/** Task 11 switches this assembly-oriented API after the object cutover is gated. */
export function compileCFile(sourceFile: string, options: CompileFileOptions = {}): CompileResult {
    const { preprocess, ...compileOptions } = options;
    const { preprocessCFile } = require('../cPreprocessor') as typeof import('../cPreprocessor');
    const preprocessed = preprocessCFile(sourceFile, preprocess);
    try {
        return compileLegacyC(preprocessed.code, compileOptions);
    } catch (error) {
        if (!(error instanceof CompilerError) || error.line === undefined) throw error;
        const location = preprocessed.lineMap[error.line - 1];
        if (!location) throw error;
        throw new CompilerError(error.detail, location.line, error.column, location.file);
    }
}

export function compileCToObjectDetailed(
    source: string,
    options: CompileOptions = {},
): CCompileDetailedResult<Merc32Object> {
    const { frontend } = splitCompileOptions(options);
    return compileEnvelope(getAroFrontend().analyzeSource(source, frontend));
}

export function compileCFileToObjectDetailed(
    sourceFile: string,
    options: CompileFileOptions = {},
): CCompileDetailedResult<Merc32Object> {
    const { preprocess, ...compileOptions } = options;
    const { frontend } = splitCompileOptions(compileOptions);
    return compileEnvelope(getAroFrontend().analyzeFile(sourceFile, frontend, preprocess));
}

export function compileCToObject(source: string, options: CompileOptions = {}): Merc32Object {
    return requireArtifact(compileCToObjectDetailed(source, options));
}

export function compileCFileToObject(sourceFile: string, options: CompileFileOptions = {}): Merc32Object {
    return requireArtifact(compileCFileToObjectDetailed(sourceFile, options));
}

function compileEnvelope(envelope: TypedCEnvelopeV1): CCompileDetailedResult<Merc32Object> {
    const diagnostics = normalizeDiagnostics(envelope.diagnostics);
    if (envelope.unit === undefined || hasErrors(diagnostics)) {
        return attachDiagnosticSources({ diagnostics }, envelope.sourceFiles);
    }
    try {
        const artifact = generateObject(lowerProgram(adaptTypedUnit(envelope.unit)));
        return attachDiagnosticSources({ artifact, diagnostics }, envelope.unit.sourceFiles);
    } catch (error) {
        if (!(error instanceof CBackendCapabilityError)) throw error;
        const combined = normalizeDiagnostics([...diagnostics, ...error.diagnostics]);
        return attachDiagnosticSources({ diagnostics: combined }, envelope.unit.sourceFiles);
    }
}

const diagnosticSources = Symbol('c-frontend diagnostic sources');
type DetailedWithSources<T> = CCompileDetailedResult<T> & {
    readonly [diagnosticSources]?: readonly SourceFileRecord[];
};

function attachDiagnosticSources<T>(result: CCompileDetailedResult<T>,
    sources: readonly SourceFileRecord[] | undefined): CCompileDetailedResult<T> {
    if (sources !== undefined) {
        Object.defineProperty(result, diagnosticSources, { value: sources, enumerable: false });
    }
    return Object.freeze(result);
}

function requireArtifact<T>(result: CCompileDetailedResult<T>): T {
    if (result.artifact !== undefined) return result.artifact;
    const sources = (result as DetailedWithSources<T>)[diagnosticSources];
    throw new CFrontendError(result.diagnostics, sources);
}

export { compileLegacyC as compileC };
export {
    CompilerError,
    type CompileResult,
} from './tinyc';

export type { CCompileDetailedResult, CFrontendDiagnostic } from '../cFrontend/contract';
export type { CFrontendOptions } from '../cFrontend/frontend';
