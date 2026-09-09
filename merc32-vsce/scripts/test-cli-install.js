'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const installerPath = path.join(root, 'out', 'cliInstall.js');
assert.ok(fs.existsSync(installerPath), 'CLI launcher installer must exist');
const { installCli } = require(installerPath);
const scratchParent = path.join(root, '.test-results');
fs.mkdirSync(scratchParent, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchParent, 'cli install space-'));
const bin = path.join(scratch, 'bin space');
function fakeExtension(version) {
    const extension = path.join(scratch, `extension ${version}`);
    fs.mkdirSync(path.join(extension, 'out'), { recursive: true });
    fs.writeFileSync(path.join(extension, 'out', 'cli.js'),
        `exports.runCli = args => { console.log(JSON.stringify({version:${JSON.stringify(version)}, args, cwd:process.cwd()})); return args.includes('fail') ? 7 : 0; };`);
    return extension;
}
function launch(args, status = 0) {
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
    env.PATH = `${bin}${path.delimiter}${path.dirname(process.execPath)}${path.delimiter}${process.env.PATH || process.env.Path || ''}`;
    // Use the actual shell's PATH lookup and wrappers, not a require of the launcher.
    const command = 'merc32 "input space.c" "-DVALUE=hello world"';
    const result = process.platform === 'win32'
        ? spawnSync('cmd.exe', ['/d', '/s', '/c', `"${command} ${args}"`], {
            env, cwd: scratch, encoding: 'utf8', timeout: 10000, windowsVerbatimArguments: true,
        })
        : spawnSync('/bin/sh', ['-c', `${command} ${args}`], { env, cwd: scratch, encoding: 'utf8', timeout: 10000 });
    assert.equal(result.status, status, result.stderr);
    return result;
}
const first = fakeExtension('1');
assert.equal(installCli(first, bin), bin);
let launched = JSON.parse(launch('').stdout);
assert.deepEqual(launched.args, ['input space.c', '-DVALUE=hello world']);
assert.equal(launched.cwd, scratch);
assert.equal(launched.version, '1');
launch('fail', 7);
if (process.platform === 'win32') {
    for (const shell of ['powershell.exe', 'pwsh.exe']) {
        const shellArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
            '$env:PATH = $env:MERC32_TEST_BIN + ";" + $env:PATH; merc32 \'-DVALUE="hello world"\' \'-DPERCENT=%MERC32_TEST_PERCENT%\' --code-base 0 --dlb-addr-width 16 \'\''];
        const result = spawnSync(shell, shellArgs, { encoding: 'utf8', timeout: 10000,
            env: { ...process.env, MERC32_TEST_BIN: bin, MERC32_TEST_PERCENT: 'MUST_NOT_EXPAND' } });
        if (result.error?.code === 'ENOENT' && shell === 'pwsh.exe') continue;
        assert.equal(result.status, 0, result.stderr);
        assert.deepEqual(JSON.parse(result.stdout).args, ['-DVALUE="hello world"', '-DPERCENT=%MERC32_TEST_PERCENT%',
            '--code-base', '0', '--dlb-addr-width', '16', ''], shell);
    }
}
const second = fakeExtension('2');
installCli(second, bin);
assert.equal(JSON.parse(launch('').stdout).version, '2');
fs.renameSync(second, `${second}.uninstalled`);
assert.match(launch('', 1).stderr, /MERC32.*Set Up Command Line/);
assert.throws(() => installCli(path.join(scratch, 'missing'), bin), /CLI entry/);
installCli(root, bin);
const real = spawnSync(process.execPath, [path.join(bin, 'merc32-launcher.js'), '--version'], { encoding: 'utf8' });
assert.equal(real.status, 0, real.stderr);
assert.equal(real.stdout.trim(), require('../package.json').version);
console.log(`CLI launcher install/upgrade tests passed (${scratch}).`);
