import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import { COMMANDS } from '../../constants';

suite('MERC32 C Problems integration', () => {
    const workspacePath = requiredEnvironment('MERC32_TEST_WORKSPACE');
    const sourceFile = path.join(workspacePath, 'problems.c');

    teardown(async () => {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    });

    test('publishes warnings on success and clears stale diagnostics', async () => {
        fs.writeFileSync(sourceFile, '#warning extension-warning\nint main(void) { return 0; }\n', 'utf8');
        const uri = vscode.Uri.file(sourceFile);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
        await settle(vscode.commands.executeCommand(COMMANDS.compileCToAsm));

        const warning = await waitFor(() => cDiagnostics(uri)
            .find((item) => item.severity === vscode.DiagnosticSeverity.Warning) ?? false);
        assert.strictEqual(warning.source, 'MERC32 C');
        assert.strictEqual(String(warning.code), '#warnings');

        fs.writeFileSync(sourceFile, 'int main(void) { return 0; }\n', 'utf8');
        await vscode.workspace.openTextDocument(uri).then((document) => vscode.window.showTextDocument(document));
        await settle(vscode.commands.executeCommand(COMMANDS.compileCToAsm));
        await waitFor(() => cDiagnostics(uri).length === 0 ? true : false);
    });

    test('publishes every error and macro-related header location before reporting failure', async () => {
        const headerFile = path.join(workspacePath, 'problems-trace.h');
        fs.writeFileSync(headerFile, '#define BAD(value) ((value) + missing_from_header)\n', 'utf8');
        fs.writeFileSync(sourceFile, [
            '#include "problems-trace.h"',
            'int first(void) { return BAD(1); }',
            'int second(void) { return missing_second; }',
            '',
        ].join('\n'), 'utf8');
        const uri = vscode.Uri.file(sourceFile);
        await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
        await settle(vscode.commands.executeCommand(COMMANDS.compileCToAsm));

        const published = await waitFor(() => {
            const values = cDiagnostics(uri).filter((item) =>
                item.severity === vscode.DiagnosticSeverity.Error);
            return values.length >= 2 ? values : false;
        });
        const macro = published.find((item) => /missing_from_header/u.test(item.message));
        assert.ok(macro, 'the macro-originated diagnostic is missing');
        assert.ok(macro.relatedInformation?.some((related) =>
            comparablePath(related.location.uri.fsPath) === comparablePath(headerFile)
                && related.message === 'Expanded from macro here'));
    });
});

function cDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(uri).filter((item) => item.source === 'MERC32 C');
}

async function settle<T>(command: Thenable<T>): Promise<T> {
    const settlement = Promise.resolve(command);
    const timer = setInterval(() => {
        void vscode.commands.executeCommand('notifications.clearAll');
    }, 25);
    try {
        return await settlement;
    } finally {
        clearInterval(timer);
    }
}

async function waitFor<T>(probe: () => T | false, deadlineMs = 15_000): Promise<T> {
    const deadline = Date.now() + deadlineMs;
    while (Date.now() <= deadline) {
        const value = probe();
        if (value) return value;
        await new Promise<void>((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for MERC32 C diagnostics');
}

function requiredEnvironment(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is required`);
    return value;
}

function comparablePath(file: string): string {
    const resolved = path.resolve(file);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}
