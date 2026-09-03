const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { SimpleCPUAssembler } = require('../out/assembler');
const { assembleToObject, linkObjects, LinkerError } = require('../out/linker');

const repoRoot = path.resolve(__dirname, '..', '..');
const userObject = assembleToObject(`
start:
  jmp runtime_helper, r14
  mov r7, r4
  mov r8, 0x0800
  mov r8, r8 << 16
  mov r8, r8 + 0x03c0
  mov r9, 0x5a
  cmp r10, r7 == r9
  bz r10, r0 + link_fail
  mov r7, 0x600d
  sw [r8], r7
link_halt:
  jmp link_halt
link_fail:
  mov r7, 0x0bad
  sw [r8], r7
  jmp link_halt
`, { exports: ['start'] });
const runtimeObject = assembleToObject(`
runtime_helper:
  mov r4, 0x2a
  mov r4, r4 + 0x30
  jmp r14
`, { exports: ['runtime_helper'] });

const linked = linkObjects([userObject, runtimeObject], { entrySymbol: 'start' });
assert.strictEqual(linked.entryAddress, 0, 'the user start symbol must be the reset entry point');
assert.strictEqual(linked.symbols.get('runtime_helper'), 0x38,
    'the helper begins after the 14-word user object');
assert.strictEqual(linked.machineCodes[0] >>> 0, 0x00380e2c,
    'the cross-object CALL16 must encode the helper absolute byte address 0x38');
assert.match(linked.assembly, /jmp 0x38, r14/,
    'linked assembly must preserve the patched direct call for reassembly');

const assembled = new SimpleCPUAssembler().assemble(linked.assembly, {
    sourceFileName: 'linker-runtime-execution.asm',
});
assert.deepStrictEqual(assembled.machineCodes.map((word) => word >>> 0),
    linked.machineCodes.map((word) => word >>> 0),
    'reassembling linked text must retain the patched cross-object call word');

assert.throws(
    () => linkObjects([assembleToObject('start:\n  jmp missing_helper, r14\n', { exports: ['start'] })]),
    (error) => error instanceof LinkerError && error.symbol === 'missing_helper' &&
        error.message === "unresolved symbol 'missing_helper'",
    'an unresolved cross-object helper must report LinkerError',
);
assert.throws(
    () => linkObjects([
        assembleToObject('start:\n  jmp far_helper, r14\n', { exports: ['start'] }),
        assembleToObject('far_helper:\n  jmp r14\n', { exports: ['far_helper'] }),
    ], { textBase: 0x10000 }),
    (error) => error instanceof LinkerError && error.symbol === 'far_helper' &&
        error.message === "CALL16 relocation 'far_helper' target out of range: 65540",
    'a helper outside the direct CALL16 absolute-address range must report LinkerError',
);

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-linker-runtime-'));
try {
    const memoryPath = path.join(tempDir, 'linker-runtime.mem');
    const simulationPath = path.join(tempDir, 'linker-runtime.vvp');
    fs.writeFileSync(memoryPath,
        `${assembled.machineCodes.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('\n')}\n`,
        'ascii');
    const rtlFiles = [
        ['rtl', 'cpu', 'core.v'],
        ['rtl', 'misc', 'mul.v'],
        ['rtl', 'misc', 'div.v'],
        ['rtl', 'sim', 'tinyc_cpu_tb.v'],
    ].map((segments) => path.join(repoRoot, ...segments));
    const compile = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005', '-s', 'tinyc_cpu_tb', '-o', simulationPath, ...rtlFiles,
    ], { encoding: 'utf8', windowsHide: true });
    assert.strictEqual(compile.status, 0, `${compile.stdout || ''}${compile.stderr || ''}`);
    const simulation = spawnSync('vvp', [
        simulationPath,
        `+ROM_FILE=${memoryPath.replace(/\\/g, '/')}`,
        `+ROM_WORDS=${assembled.machineCodes.length}`,
    ], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    const output = `${simulation.stdout || ''}${simulation.stderr || ''}`;
    assert.strictEqual(simulation.status, 0, output);
    assert.match(output, /^TEST PASS$/m, output);
    assert.doesNotMatch(output, /^TEST (?:FAIL|TIMEOUT)/m, output);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('cross-object linker runtime execution test passed');
