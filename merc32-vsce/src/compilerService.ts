import * as fs from 'fs';
import * as path from 'path';
import { compileCFileToObject } from './cCompiler';
import { assembleFile } from './assemblyService';
import { getAssemblerSettings } from './configuration';
import { CompileMode, FileAssemblyResult, ToolchainArtifact } from './types';
import { getDefaultRuntimeObjects } from './runtime/runtimeCatalog';
import { linkObjects } from './linker';

export interface CCompileResult {
    assembly: string;
    assemblyFile: string;
    artifacts: ToolchainArtifact[];
}

export interface CBuildResult extends CCompileResult {
    assemblyResult: FileAssemblyResult;
}

export function compileCFileToAssembly(sourceFile: string): CCompileResult {
    const settings = getAssemblerSettings(sourceFile);
    const baseName = path.basename(sourceFile, path.extname(sourceFile));
    const assemblyFile = path.join(settings.outputDir, `${baseName}.asm`);
    const image = linkObjects([compileCFileToObject(sourceFile, {
        dataBase: settings.cDataBase,
        dlbAddrWidth: settings.cDlbAddrWidth,
        moduleName: baseName,
    }), ...getDefaultRuntimeObjects()]);

    fs.mkdirSync(settings.outputDir, { recursive: true });
    fs.writeFileSync(assemblyFile, image.assembly, 'utf-8');

    return {
        assembly: image.assembly,
        assemblyFile,
        artifacts: [
            { label: `${baseName}.asm`, file: assemblyFile, description: 'Linked assembly' },
        ],
    };
}

export function compileCFileToLinkedAssembly(sourceFile: string): CCompileResult {
    return compileCFileToAssembly(sourceFile);
}

export function buildCFileToRom(sourceFile: string, mode: CompileMode): CBuildResult {
    const compiled = compileCFileToAssembly(sourceFile);
    const settings = getAssemblerSettings(sourceFile);
    const assemblyResult = assembleFile(
        compiled.assembly,
        compiled.assemblyFile,
        settings.outputFormat,
        mode,
        settings.outputDir,
    );

    const artifacts = [...compiled.artifacts];
    if (assemblyResult.outputFile) {
        artifacts.push({
            label: path.basename(assemblyResult.outputFile),
            file: assemblyResult.outputFile,
            description: `${settings.outputFormat.toUpperCase()} output`,
        });
    }

    if (!settings.cKeepAssembly && fs.existsSync(compiled.assemblyFile)) {
        fs.unlinkSync(compiled.assemblyFile);
    }

    return {
        ...compiled,
        assemblyResult,
        artifacts,
    };
}
