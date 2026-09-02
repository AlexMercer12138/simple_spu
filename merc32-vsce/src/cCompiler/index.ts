import { CPreprocessOptions, preprocessCFile } from '../cPreprocessor';
import { compileC, CompilerError, CompileOptions, CompileResult } from './tinyc';
import { DebugLocation, Merc32Object } from '../linker/objectFormat';

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
export * from './codegen';
export * from './registers';
export * from '../runtime/runtimeCatalog';

export interface CompileFileOptions extends CompileOptions {
    preprocess?: CPreprocessOptions;
}

export function compileCFile(sourceFile: string, options: CompileFileOptions = {}): CompileResult {
    const { preprocess, ...compileOptions } = options;
    const preprocessed = preprocessCFile(sourceFile, preprocess);
    try {
        return compileC(preprocessed.code, compileOptions);
    } catch (error) {
        throw remapPreprocessedError(error, preprocessed.lineMap);
    }
}

/** Returns a versioned object while preserving the established assembly generator. */
export function compileCToObject(source: string, options: CompileOptions = {}): Merc32Object {
    const assembly = compileC(source, options).assembly;
    return objectFromAssembly(assembly);
}

export function compileCFileToObject(sourceFile: string, options: CompileFileOptions = {}): Merc32Object {
    const { preprocess, ...compileOptions } = options;
    const preprocessed = preprocessCFile(sourceFile, preprocess);
    try {
        return objectFromAssembly(
            compileC(preprocessed.code, compileOptions).assembly,
            preprocessed.lineMap.map((location): DebugLocation => ({ ...location, column: 1 })),
        );
    } catch (error) {
        throw remapPreprocessedError(error, preprocessed.lineMap);
    }
}

function objectFromAssembly(assembly: string, debug?: readonly DebugLocation[]): Merc32Object {
    return {
        version: 1,
        target: 'merc32',
        abi: 'merc32-c-v1',
        sections: [{ name: 'text', alignment: 4, size: assembly.length, content: assembly }],
        symbols: [],
        relocations: [],
        ...(debug ? { debug } : {}),
    };
}

function remapPreprocessedError(error: unknown, lineMap: readonly { file: string; line: number }[]): unknown {
    if (!(error instanceof CompilerError) || error.line === undefined) return error;
    const sourceLocation = lineMap[error.line - 1];
    if (!sourceLocation) return error;
    return new CompilerError(error.detail, sourceLocation.line, error.column, sourceLocation.file);
}

export {
    compileC,
    CompilerError,
    type CompileOptions,
    type CompileResult,
} from './tinyc';
