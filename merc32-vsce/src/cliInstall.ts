import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export function cliBinDirectory(): string {
    const root = process.env.MERC32_CLI_HOME;
    if (root && !path.isAbsolute(root)) throw new Error('MERC32_CLI_HOME must be an absolute directory.');
    return path.join(root || path.join(os.homedir(), '.merc32'), 'bin');
}

function writeAtomic(file: string, content: string | Buffer, mode?: number): void {
    // Unique temporary names allow concurrent VS Code windows to refresh safely.
    const temporary = `${file}.${crypto.randomBytes(8).toString('hex')}.tmp`;
    fs.writeFileSync(temporary, content, { flag: 'wx', mode });
    fs.renameSync(temporary, file);
}

export function installCli(extensionRoot: string, binDirectory = cliBinDirectory()): string {
    extensionRoot = path.resolve(extensionRoot);
    binDirectory = path.resolve(binDirectory);
    if (!fs.existsSync(path.join(extensionRoot, 'out', 'cli.js'))) {
        throw new Error(`MERC32 CLI entry is missing in ${extensionRoot}.`);
    }
    const launcher = fs.readFileSync(path.join(__dirname, 'cliLauncher.js'));
    fs.mkdirSync(binDirectory, { recursive: true });
    writeAtomic(path.join(binDirectory, 'merc32-launcher.js'), launcher);
    writeAtomic(path.join(binDirectory, 'merc32.ps1'), [
        '# Preserve literal quotes, percent signs and empty arguments in PowerShell 5 and 7.',
        '$node = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1',
        'if (-not $node) {',
        '    [Console]::Error.WriteLine("merc32: Install Node.js and add it to PATH, then open a new terminal.")',
        '    exit 1',
        '}',
        '$payload = ConvertTo-Json -InputObject @($args | ForEach-Object { [string]$_ }) -Compress',
        '$encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))',
        '& $node.Source (Join-Path $PSScriptRoot "merc32-launcher.js") --merc32-launcher-base64 $encoded',
        'exit $LASTEXITCODE',
        '',
    ].join('\r\n'));
    writeAtomic(path.join(binDirectory, 'merc32.cmd'), [
        '@echo off',
        'setlocal DisableDelayedExpansion',
        'where node >nul 2>nul',
        'if errorlevel 1 (',
        '  echo merc32: Install Node.js and add it to PATH, then open a new terminal. 1>&2',
        '  exit /b 1',
        ')',
        'node "%~dp0merc32-launcher.js" %*',
        'exit /b %errorlevel%',
        '',
    ].join('\r\n'));
    writeAtomic(path.join(binDirectory, 'merc32'), [
        '#!/bin/sh',
        'if ! command -v node >/dev/null 2>&1; then',
        '  echo "merc32: Install Node.js and add it to PATH, then open a new terminal." >&2',
        '  exit 1',
        'fi',
        'exec node "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/merc32-launcher.js" "$@"',
        '',
    ].join('\n'), 0o755);
    writeAtomic(path.join(binDirectory, 'merc32-target.json'), JSON.stringify({ extensionRoot }, null, 2) + '\n');
    return binDirectory;
}
