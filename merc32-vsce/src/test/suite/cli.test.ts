import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

suite('MERC32 CLI setup', () => {
    test('registers setup and points the stable launcher at the active extension', async () => {
        const extension = vscode.extensions.getExtension('Vikai-mercer.merc32-vsce');
        assert.ok(extension);
        await extension!.activate();
        const pending = vscode.commands.executeCommand<string>('merc32.cli.setup');
        const timer = setInterval(() => { void vscode.commands.executeCommand('notifications.clearAll'); }, 25);
        let bin: string;
        try { bin = await pending; } finally { clearInterval(timer); }
        assert.strictEqual(bin!, path.join(process.env.MERC32_CLI_HOME!, 'bin'));
        const manifest = JSON.parse(fs.readFileSync(path.join(bin!, 'merc32-target.json'), 'utf8'));
        assert.strictEqual(fs.realpathSync.native(manifest.extensionRoot), fs.realpathSync.native(extension!.extensionPath));
        assert.ok(fs.existsSync(path.join(bin!, process.platform === 'win32' ? 'merc32.cmd' : 'merc32')));
    });
});
