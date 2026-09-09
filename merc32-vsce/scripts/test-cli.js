'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const workspace = path.resolve(__dirname, '..');
const scratchParent = process.argv[2] === '--vsix' ? os.tmpdir() : path.join(workspace, '.test-results');
fs.mkdirSync(scratchParent, { recursive: true });
const scratch = fs.mkdtempSync(path.join(scratchParent, 'cli space-'));
let root = workspace;
if (process.argv[2] === '--vsix') {
    const Zip = require('adm-zip');
    new Zip(path.resolve(process.argv[3])).extractAllTo(path.join(scratch, 'package space'));
    root = path.join(scratch, 'package space', 'extension');
}
let cli = path.join(root, 'out', 'cli.js');
if (root !== workspace) {
    const { installCli } = require(path.join(root, 'out', 'cliInstall'));
    cli = path.join(installCli(root, path.join(scratch, 'installed bin')), 'merc32-launcher.js');
}
function run(args, status = 0) {
    const result = spawnSync(process.execPath, [cli, ...args], {
        cwd: scratch, encoding: 'utf8', timeout: 30000,
        env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' },
    });
    assert.equal(result.status, status, `${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
    return result;
}

assert.match(run(['--help']).stdout, /merc32 build/);
assert.equal(run(['--version']).stdout.trim(), JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).version);
fs.mkdirSync(path.join(scratch, 'headers space'));
fs.writeFileSync(path.join(scratch, 'headers space', 'value.h'), '#define VALUE 40\n');
const source = path.join(scratch, 'main space.c');
fs.writeFileSync(source, '#include <stdint.h>\n#include "value.h"\nint main(void) { return VALUE + ADD; }\n');
const common = ['-I', 'headers space', '-DADD=2'];
run(['compile', source, '--emit', 'asm', ...common, '--out-dir', 'assembly']);
const asmFile = path.join(scratch, 'assembly', 'main space.asm');
assert.match(fs.readFileSync(asmFile, 'utf8'), /\.prog main_space/);

// CLI output must equal the editor's existing core pipeline for identical settings.
const { compileCFile } = require(path.join(root, 'out', 'cCompiler'));
const { SimpleCPUAssembler } = require(path.join(root, 'out', 'assembler'));
const { formatAssemblyOutput, OUTPUT_EXTENSIONS } = require(path.join(root, 'out', 'outputFormatters'));
const compiled = compileCFile(source, {
    moduleName: 'main space', optimization: 'basic',
    includePaths: [path.join(scratch, 'headers space')], defines: { ADD: '2' },
});
assert.equal(fs.readFileSync(asmFile, 'utf8'), compiled.assembly);
const assembled = new SimpleCPUAssembler().assemble(compiled.assembly, { sourceFileName: asmFile });
for (const format of ['verilog', 'coe', 'mif', 'hex', 'bin', 'mem']) {
    const output = `output ${format}`;
    const result = run(['build', source, ...common, '--format', format, '--out-dir', output]);
    const file = path.join(scratch, output, `main_space${OUTPUT_EXTENSIONS[format]}`);
    assert.deepEqual(fs.readFileSync(file), Buffer.from(formatAssemblyOutput(assembled.machineCodes, format, 'main_space')));
    assert.ok(result.stdout.includes(file));
}
run(['assemble', asmFile, '--format', 'bin', '--out-dir', 'assembled']);
assert.deepEqual(fs.readFileSync(path.join(scratch, 'assembled', 'main_space.bin')),
    fs.readFileSync(path.join(scratch, 'output bin', 'main_space.bin')));
const printed = run(['build', asmFile, '--format', 'mem', '--mode', 'print']);
assert.equal(printed.stdout.trim(), fs.readFileSync(path.join(scratch, 'output mem', 'main_space.mem'), 'utf8').trim());
const noAssembly = run(['build', source, ...common, '--format', 'bin', '--out-dir', 'custom', '--code-base', '0x1000',
    '--data-base', '0x08000000', '--dlb-addr-width', '13', '--optimization', 'none', '--no-keep-assembly']);
assert.ok(fs.existsSync(path.join(scratch, 'custom', 'main_space.bin')));
assert.ok(!fs.existsSync(path.join(scratch, 'custom', 'main space.asm')));
assert.ok(!noAssembly.stdout.includes('main space.asm'), 'Do not report a nonexistent artifact');

const warning = path.join(scratch, 'warning.c');
fs.writeFileSync(warning, '#warning cli-warning\nint main(void) { return 0; }\n');
assert.match(run(['build', warning]).stderr, /warning\.c:1:\d+: warning.*cli-warning/);
const broken = path.join(scratch, 'broken.c');
fs.writeFileSync(broken, 'int main(void) { return unknown_identifier; }\n');
assert.match(run(['build', broken, '--out-dir', 'failed'], 1).stderr, /broken\.c:1:\d+: error/);
assert.ok(!fs.existsSync(path.join(scratch, 'failed')));
assert.match(run(['build', 'missing.c'], 1).stderr, /missing\.c/);
for (const args of [[], ['wat'], ['build'], ['build', source, '--wat'],
    ['build', source, '--format', 'elf'], ['build', source, '--code-base', '0x100oops'],
    ['build', source, '--dlb-addr-width', '0'], ['build', source, '--out-dir'],
    ['build', source, 'extra.c'], ['assemble', source], ['compile', asmFile],
    ['compile', source, '--emit', 'elf'], ['build', source, '-D1BAD=1']]) {
    run(args, 2);
}
for (const options of [['--code-base', '1'], ['--data-base', '0'],
    ['--data-base', '0x0fffffff', '--dlb-addr-width', '16']]) run(['build', source, ...options], 2);
console.log(`CLI integration passed (${root === workspace ? 'checkout' : 'VSIX'}, artifacts: ${scratch}).`);
