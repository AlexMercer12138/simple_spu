import * as path from 'path';
import * as vscode from 'vscode';
import { AssemblyRunner } from './assemblyRunner';
import { CFrontendError, getCCompileSourceFiles } from './cCompiler';
import { CDiagnostics } from './cDiagnostics';
import { COMMANDS } from './constants';
import {
    buildCFileToRomDetailed,
    compileCFileToAssemblyDetailed,
} from './compilerService';
import { getActiveAsmFile, getActiveCFile, getActiveMerc32SourceFile } from './editor';
import { getCompileModeLabel, getCompileModeQuickPickItems, getCompileModeShortName } from './compileModes';
import {
    CompileMode,
    CompilerArtifactStore,
    DEFAULT_COMPILE_MODE,
    ToolchainArtifact,
} from './types';

export interface ToolchainCommandState {
    currentMode: CompileMode;
}

export function registerAssemblerCommands(
    runner: AssemblyRunner,
    state: ToolchainCommandState,
    artifactStore: CompilerArtifactStore,
    onArtifactsChanged: () => void,
    cDiagnostics: CDiagnostics,
): vscode.Disposable[] {
    let currentMode: CompileMode = state.currentMode || DEFAULT_COMPILE_MODE;

    const setArtifacts = (artifacts: ToolchainArtifact[]) => {
        artifactStore.setCompilerArtifacts(artifacts);
        onArtifactsChanged();
    };

    const artifactFromOutput = (file: string): ToolchainArtifact => ({
        label: path.basename(file),
        file,
        description: 'Assembler output',
    });

    const runAsm = (file: string, mode: CompileMode) => {
        const result = runner.run(file, mode);
        if (result?.outputFile) {
            setArtifacts([artifactFromOutput(result.outputFile)]);
        }
    };

    const runC = <T extends { readonly artifacts: ToolchainArtifact[] }>(
        file: string,
        compile: () => import('./cCompiler').CCompileDetailedResult<T>,
        successMessage: (artifact: T) => string,
    ): void => {
        cDiagnostics.clear(file);
        try {
            const result = compile();
            cDiagnostics.update(result);
            if (result.artifact === undefined) {
                throw new CFrontendError(result.diagnostics, getCCompileSourceFiles(result));
            }
            setArtifacts([...result.artifact.artifacts]);
            vscode.window.showInformationMessage(successMessage(result.artifact));
        } catch (error) {
            runner.showError(error);
        }
    };

    return [
        vscode.commands.registerCommand(COMMANDS.compile, () => {
            const source = getActiveMerc32SourceFile();
            if (!source) return;
            if (source.kind === 'asm') {
                runAsm(source.file, currentMode);
                return;
            }
            runC(source.file,
                () => buildCFileToRomDetailed(source.file, currentMode),
                (result) => `MERC32 C build complete: ${result.assemblyResult.outputFile || result.assemblyFile}`);
        }),
        vscode.commands.registerCommand(COMMANDS.assembleActive, () => {
            const file = getActiveAsmFile();
            if (file) runAsm(file, currentMode);
        }),
        vscode.commands.registerCommand(COMMANDS.compilePrint, () => {
            const file = getActiveAsmFile();
            if (file) runAsm(file, 'print');
        }),
        vscode.commands.registerCommand(COMMANDS.compileDebug, () => {
            const file = getActiveAsmFile();
            if (file) runAsm(file, 'debug');
        }),
        vscode.commands.registerCommand(COMMANDS.compileCToAsm, () => {
            const file = getActiveCFile();
            if (!file) return;
            runC(file,
                () => compileCFileToAssemblyDetailed(file),
                (result) => `MERC32 C compiled to assembly: ${result.assemblyFile}`);
        }),
        vscode.commands.registerCommand(COMMANDS.buildCToRom, () => {
            const file = getActiveCFile();
            if (!file) return;
            runC(file,
                () => buildCFileToRomDetailed(file, currentMode),
                (result) => `MERC32 C build complete: ${result.assemblyResult.outputFile || result.assemblyFile}`);
        }),
        vscode.commands.registerCommand(COMMANDS.openLastArtifact, async (artifact?: ToolchainArtifact) => {
            const artifacts = artifactStore.getCompilerArtifacts();
            const target = artifact || artifacts[artifacts.length - 1];
            if (!target) {
                vscode.window.showInformationMessage('No MERC32 artifact has been generated yet');
                return;
            }
            const doc = await vscode.workspace.openTextDocument(target.file);
            await vscode.window.showTextDocument(doc, { preview: false });
        }),
        vscode.commands.registerCommand(COMMANDS.selectCompileMode, async () => {
            const selected = await vscode.window.showQuickPick(getCompileModeQuickPickItems(), {
                placeHolder: `Select compile mode (current: ${getCompileModeShortName(currentMode)})`,
            });
            if (selected) {
                currentMode = selected.value;
                state.currentMode = currentMode;
                vscode.window.showInformationMessage(`Compile mode switched to: ${getCompileModeLabel(currentMode)}`);
            }
        }),
    ];
}
