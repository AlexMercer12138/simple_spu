import * as path from 'path';
import * as vscode from 'vscode';
import { installCli } from './cliInstall';

export function registerCli(context: vscode.ExtensionContext, output: vscode.OutputChannel): vscode.Disposable {
    const setup = () => {
        const bin = installCli(context.extensionPath);
        context.environmentVariableCollection.prepend('PATH', bin + path.delimiter);
        return bin;
    };
    // Development/test hosts must not replace a user's installed launcher.
    // Explicit setup still works in those hosts.
    try {
        if (context.extensionMode === vscode.ExtensionMode.Production) setup();
    } catch (error) {
        output.appendLine(`MERC32 CLI setup failed: ${String(error)}`);
    }
    return vscode.commands.registerCommand('merc32.cli.setup', async () => {
        try {
            const bin = setup();
            output.appendLine(`MERC32 CLI directory: ${bin}`);
            output.appendLine('Install Node.js, add this directory to your user PATH once, and open a new terminal.');
            output.appendLine('Check with: merc32 --version');
            output.show(true);
            const action = await vscode.window.showInformationMessage(
                `MERC32 CLI ready. Add ${bin} to PATH for external terminals. New VS Code terminals include it automatically.`,
                'Copy PATH Directory',
            );
            if (action) await vscode.env.clipboard.writeText(bin);
            return bin;
        } catch (error) {
            void vscode.window.showErrorMessage(`MERC32 CLI setup failed: ${String(error)}`);
            return undefined;
        }
    });
}
