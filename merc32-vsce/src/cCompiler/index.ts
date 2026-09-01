import { CPreprocessOptions, preprocessCFile } from '../cPreprocessor';
import { compileC, CompilerError, CompileOptions, CompileResult } from './tinyc';
import { Merc32Object } from './ast';

export type { Merc32Object } from './ast';
export * from './types';
export * from './source';
export * from './ast';

export interface CompileFileOptions extends CompileOptions {
    preprocess?: CPreprocessOptions;
}

export function compileCFile(sourceFile: string, options: CompileFileOptions = {}): CompileResult {
    const { preprocess, ...compileOptions } = options;
    const preprocessed = preprocessCFile(sourceFile, preprocess);
    try {
        return compileC(preprocessed.code, compileOptions);
    } catch (error) {
        if (!(error instanceof CompilerError) || error.line === undefined) {
            throw error;
        }
        const sourceLocation = preprocessed.lineMap[error.line - 1];
        if (!sourceLocation) {
            throw error;
        }
        throw new CompilerError(
            error.detail,
            sourceLocation.line,
            error.column,
            sourceLocation.file,
        );
    }
}

/** Compatibility boundary for the typed frontend; code generation remains the existing compiler. */
export function compileCToObject(source: string, options: CompileOptions = {}): Merc32Object {
    return { format: 'merc32-object', assembly: compileC(source, options).assembly };
}

export {
    compileC,
    CompilerError,
    type CompileOptions,
    type CompileResult,
} from './tinyc';
