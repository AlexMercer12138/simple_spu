// Copied into the stable user bin directory. Keep this module self-contained.
import * as fs from 'fs';
import * as path from 'path';

try {
    const target = JSON.parse(fs.readFileSync(path.join(__dirname, 'merc32-target.json'), 'utf8'));
    if (typeof target.extensionRoot !== 'string' || !path.isAbsolute(target.extensionRoot)) {
        throw new Error('Invalid MERC32 CLI target.');
    }
    const entry = path.join(target.extensionRoot, 'out', 'cli.js');
    if (!fs.existsSync(entry)) throw new Error('The selected MERC32 extension is no longer installed.');
    const { runCli } = require(entry) as { runCli(args: readonly string[]): number };
    const args = process.argv.slice(2);
    // PowerShell 5's native argument marshalling strips embedded quotes. The
    // PowerShell shim transports the original string array without that loss.
    const forwarded = args.length === 2 && args[0] === '--merc32-launcher-base64'
        ? JSON.parse(Buffer.from(args[1], 'base64').toString('utf8')) : args;
    if (!Array.isArray(forwarded) || !forwarded.every(arg => typeof arg === 'string')) {
        throw new Error('Invalid MERC32 launcher arguments.');
    }
    process.exitCode = runCli(forwarded);
} catch (error) {
    console.error(`merc32: ${error instanceof Error ? error.message : String(error)}\n`
        + 'Open VS Code and run "MERC32: Set Up Command Line" to repair the launcher.');
    process.exitCode = 1;
}
