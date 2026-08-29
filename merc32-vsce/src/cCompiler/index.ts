import { CPreprocessOptions, preprocessCFile } from '../cPreprocessor';
import { compileC, CompilerError, CompileOptions, CompileResult } from './tinyc';

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

export {
    compileC,
    CompilerError,
    type CompileOptions,
    type CompileResult,
} from './tinyc';
