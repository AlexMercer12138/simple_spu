import * as fs from 'fs';
import * as path from 'path';
import {
    CCompileDetailedResult,
    CFrontendError,
    compileCFileDetailed,
    getCCompileSourceFiles,
    mapCCompileDetailedResult,
} from './cCompiler';
import { assembleFile } from './assemblyService';
import type { AssemblerSettings } from './toolchainSettings';
import type { CompileFileOptions } from './cCompiler';
import { CompileMode, FileAssemblyResult, ToolchainArtifact } from './types';

export interface CCompileResult {
    assembly: string;
    assemblyFile: string;
    artifacts: ToolchainArtifact[];
}

export interface CBuildResult extends CCompileResult {
    assemblyResult: FileAssemblyResult;
}

export function compileCFileToAssembly(sourceFile: string, settings: AssemblerSettings, options: CompileFileOptions = {}): CCompileResult {
    return requireArtifact(compileCFileToAssemblyDetailed(sourceFile, settings, options));
}

export function compileCFileToAssemblyDetailed(sourceFile: string, settings: AssemblerSettings, options: CompileFileOptions = {}): CCompileDetailedResult<CCompileResult> {
    return compileAssembly(sourceFile, settings, options, true);
}

function compileAssembly(sourceFile: string, settings: AssemblerSettings,
    options: CompileFileOptions, writeAssembly: boolean): CCompileDetailedResult<CCompileResult> {
    const baseName = path.basename(sourceFile, path.extname(sourceFile));
    const assemblyFile = path.join(settings.outputDir, `${baseName}.asm`);
    const result = compileCFileDetailed(sourceFile, {
        ...options,
        dataBase: settings.cDataBase,
        dlbAddrWidth: settings.cDlbAddrWidth,
        codeBase: settings.cCodeBase,
        optimization: settings.cOptimization,
        moduleName: baseName,
    });

    if (result.artifact === undefined) {
        return mapCCompileDetailedResult<import('./cCompiler').CompileResult, CCompileResult>(result, undefined);
    }

    if (writeAssembly) {
        fs.mkdirSync(settings.outputDir, { recursive: true });
        fs.writeFileSync(assemblyFile, result.artifact.assembly, 'utf-8');
    }

    return mapCCompileDetailedResult(result, {
        assembly: result.artifact.assembly,
        assemblyFile,
        artifacts: writeAssembly ? [
            { label: `${baseName}.asm`, file: assemblyFile, description: 'Generated assembly' },
        ] : [],
    });
}

export function compileCFileToLinkedAssembly(sourceFile: string, settings: AssemblerSettings): CCompileResult {
    return compileCFileToAssembly(sourceFile, settings);
}

export function buildCFileToRom(sourceFile: string, mode: CompileMode, settings: AssemblerSettings, options: CompileFileOptions = {}): CBuildResult {
    return requireArtifact(buildCFileToRomDetailed(sourceFile, mode, settings, options));
}

export function buildCFileToRomDetailed(sourceFile: string,
    mode: CompileMode, settings: AssemblerSettings, options: CompileFileOptions = {}): CCompileDetailedResult<CBuildResult> {
    const compiled = compileAssembly(sourceFile, settings, options, settings.cKeepAssembly);
    if (compiled.artifact === undefined) {
        return mapCCompileDetailedResult<CCompileResult, CBuildResult>(compiled, undefined);
    }
    const assemblyResult = assembleFile(
        compiled.artifact.assembly,
        compiled.artifact.assemblyFile,
        settings.outputFormat,
        mode,
        settings.outputDir,
    );

    const artifacts = [...compiled.artifact.artifacts];
    if (assemblyResult.outputFile) {
        artifacts.push({
            label: path.basename(assemblyResult.outputFile),
            file: assemblyResult.outputFile,
            description: `${settings.outputFormat.toUpperCase()} output`,
        });
    }

    return mapCCompileDetailedResult(compiled, {
        ...compiled.artifact,
        assemblyResult,
        artifacts,
    });
}

function requireArtifact<T>(result: CCompileDetailedResult<T>): T {
    if (result.artifact !== undefined) return result.artifact;
    throw new CFrontendError(result.diagnostics, getCCompileSourceFiles(result));
}
