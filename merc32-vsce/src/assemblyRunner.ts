import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { assembleFile } from './assemblyService';
import { OUTPUT_CHANNEL_NAME } from './constants';
import { getAssemblerSettings } from './configuration';
import { CompileMode, FileAssemblyResult } from './types';

export class AssemblyRunner implements vscode.Disposable {
    private readonly channel: vscode.OutputChannel;
    private readonly ownsChannel: boolean;

    constructor(channel?: vscode.OutputChannel) {
        this.channel = channel ?? vscode.window.createOutputChannel(OUTPUT_CHANNEL_NAME);
        this.ownsChannel = channel === undefined;
    }

    run(file: string, mode: CompileMode): FileAssemblyResult | undefined {
        try {
            const sourceCode = fs.readFileSync(file, 'utf-8');
            const { outputFormat, outputDir } = getAssemblerSettings(file);
            const result = assembleFile(sourceCode, file, outputFormat, mode, outputDir);
            this.showSuccess(mode, result);
            return result;
        } catch (error) {
            this.showFailure(error);
            return undefined;
        }
    }

    showInfo(message: string): void {
        this.channel.appendLine(message);
        this.channel.show(true);
    }

    showError(error: unknown): void {
        this.showFailure(error);
    }

    dispose(): void {
        if (this.ownsChannel) this.channel.dispose();
    }

    private showSuccess(mode: CompileMode, result: FileAssemblyResult): void {
        if (mode === 'print') {
            this.channel.clear();
            this.channel.appendLine(result.output.toString());
            this.channel.show(true);
            vscode.window.showInformationMessage('汇编完成 (打印模式)');
            return;
        }

        if (mode === 'debug') {
            this.channel.clear();
            if (result.outputFile) {
                this.channel.appendLine(`输出文件: ${result.outputFile}`);
            }
            if (result.debugInfo) {
                this.channel.appendLine('\n=== 标签表 ===');
                this.channel.appendLine(result.debugInfo.debugSymbols);
                this.channel.appendLine('\n=== 替换标签后的代码 ===');
                this.channel.appendLine(result.debugInfo.replacedCode);
            }
            this.channel.show(true);
            vscode.window.showInformationMessage(`汇编完成 (调试模式): ${path.basename(result.outputFile || '')}`);
            return;
        }

        vscode.window.showInformationMessage(`汇编成功: ${path.basename(result.outputFile || '')}`);
    }

    private showFailure(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`汇编失败: ${message}`);
        this.channel.clear();
        this.channel.appendLine(message);
        this.channel.show(true);
    }
}
