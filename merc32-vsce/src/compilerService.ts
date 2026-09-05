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
import { getAssemblerSettings } from './configuration';
import { CompileMode, FileAssemblyResult, ToolchainArtifact } from './types';

export interface CCompileResult {
    assembly: string;
    assemblyFile: string;
    artifacts: ToolchainArtifact[];
}

export interface CBuildResult extends CCompileResult {
    assemblyResult: FileAssemblyResult;
}

export function compileCFileToAssembly(sourceFile: string): CCompileResult {
    return requireArtifact(compileCFileToAssemblyDetailed(sourceFile));
}

export function compileCFileToAssemblyDetailed(sourceFile: string): CCompileDetailedResult<CCompileResult> {
    const settings = getAssemblerSettings(sourceFile);
    const baseName = path.basename(sourceFile, path.extname(sourceFile));
    const assemblyFile = path.join(settings.outputDir, `${baseName}.asm`);
    const result = compileCFileDetailed(sourceFile, {
        dataBase: settings.cDataBase,
        dlbAddrWidth: settings.cDlbAddrWidth,
        codeBase: settings.cCodeBase,
        moduleName: baseName,
    });

    if (result.artifact === undefined) {
        return mapCCompileDetailedResult<import('./cCompiler').CompileResult, CCompileResult>(result, undefined);
    }

    fs.mkdirSync(settings.outputDir, { recursive: true });
    fs.writeFileSync(assemblyFile, result.artifact.assembly, 'utf-8');

    return mapCCompileDetailedResult(result, {
        assembly: result.artifact.assembly,
        assemblyFile,
        artifacts: [
            { label: `${baseName}.asm`, file: assemblyFile, description: 'Generated assembly' },
        ],
    });
}

export function compileCFileToLinkedAssembly(sourceFile: string): CCompileResult {
    return compileCFileToAssembly(sourceFile);
}

export function buildCFileToRom(sourceFile: string, mode: CompileMode): CBuildResult {
    return requireArtifact(buildCFileToRomDetailed(sourceFile, mode));
}

export function buildCFileToRomDetailed(sourceFile: string,
    mode: CompileMode): CCompileDetailedResult<CBuildResult> {
    const compiled = compileCFileToAssemblyDetailed(sourceFile);
    if (compiled.artifact === undefined) {
        return mapCCompileDetailedResult<CCompileResult, CBuildResult>(compiled, undefined);
    }
    const settings = getAssemblerSettings(sourceFile);
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

    if (!settings.cKeepAssembly && fs.existsSync(compiled.artifact.assemblyFile)) {
        fs.unlinkSync(compiled.artifact.assemblyFile);
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
