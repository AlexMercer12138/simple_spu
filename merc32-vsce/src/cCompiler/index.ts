import { CPreprocessOptions, preprocessCFile } from '../cPreprocessor';
import { compileC, CompilerError, CompileOptions, CompileResult } from './tinyc';
import { Merc32Object } from '../linker/objectFormat';

export type { Merc32Object } from '../linker/objectFormat';
export * from './types';
export * from './source';
export * from './ast';
export * from './lexer';
export * from './parser';
export * from './declarations';
export * from './sema';
export * from './initializers';

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
    const assembly = compileC(source, options).assembly;
    return {
        version: 1,
        target: 'merc32',
        abi: 'merc32-c-v1',
        sections: [{ name: 'text', alignment: 4, size: assembly.length, content: assembly }],
        symbols: [],
        relocations: [],
    };
}

export {
    compileC,
    CompilerError,
    type CompileOptions,
    type CompileResult,
} from './tinyc';
