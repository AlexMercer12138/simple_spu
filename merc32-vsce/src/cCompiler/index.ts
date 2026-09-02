import { CPreprocessOptions, preprocessCFile } from '../cPreprocessor';
import { compileC as compileLegacyC, CompilerError, CompileOptions, CompileResult } from './tinyc';
import { DebugLocation, Merc32Object } from '../linker/objectFormat';
import { tokenizeC } from './lexer';
import { parseTranslationUnit } from './parser';
import { analyzeTranslationUnit } from './sema';
import { lowerProgram } from './lower';
import { generateObject } from './codegen';

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
        return compileLegacyC(preprocessed.code, compileOptions);
    } catch (error) {
        throw remapPreprocessedError(error, preprocessed.lineMap);
    }
}

/** Compile through the typed lexer, parser, semantic analysis, IR, and object backend. */
export function compileCToObject(source: string, _options: CompileOptions = {}): Merc32Object {
    const tokens = tokenizeC(source);
    const unit = parseTranslationUnit(tokens);
    const program = analyzeTranslationUnit(unit);
    return generateObject(lowerProgram(program));
}

export function compileCFileToObject(sourceFile: string, options: CompileFileOptions = {}): Merc32Object {
    const { preprocess, ...compileOptions } = options;
    const preprocessed = preprocessCFile(sourceFile, preprocess);
    try {
        const object = compileCToObject(preprocessed.code, compileOptions);
        return {
            ...object,
            debug: preprocessed.lineMap.map((location): DebugLocation => ({ ...location, column: 1 })),
        };
    } catch (error) {
        throw remapPreprocessedError(error, preprocessed.lineMap);
    }
}

function remapPreprocessedError(error: unknown, lineMap: readonly { file: string; line: number }[]): unknown {
    if (!(error instanceof CompilerError) || error.line === undefined) return error;
    const sourceLocation = lineMap[error.line - 1];
    if (!sourceLocation) return error;
    return new CompilerError(error.detail, sourceLocation.line, error.column, sourceLocation.file);
}

export { compileLegacyC as compileC };
export {
    CompilerError,
    type CompileOptions,
    type CompileResult,
} from './tinyc';
