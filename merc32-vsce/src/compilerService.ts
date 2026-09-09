import * as build from './buildService';
import { getAssemblerSettings } from './configuration';
import { CompileMode } from './types';
export type { CCompileResult, CBuildResult } from './buildService';

export function compileCFileToAssembly(sourceFile: string): build.CCompileResult {
    return build.compileCFileToAssembly(sourceFile, getAssemblerSettings(sourceFile));
}

export function compileCFileToAssemblyDetailed(sourceFile: string) {
    return build.compileCFileToAssemblyDetailed(sourceFile, getAssemblerSettings(sourceFile));
}

export function compileCFileToLinkedAssembly(sourceFile: string): build.CCompileResult {
    return compileCFileToAssembly(sourceFile);
}

export function buildCFileToRom(sourceFile: string, mode: CompileMode): build.CBuildResult {
    return build.buildCFileToRom(sourceFile, mode, getAssemblerSettings(sourceFile));
}

export function buildCFileToRomDetailed(sourceFile: string, mode: CompileMode) {
    return build.buildCFileToRomDetailed(sourceFile, mode, getAssemblerSettings(sourceFile));
}
