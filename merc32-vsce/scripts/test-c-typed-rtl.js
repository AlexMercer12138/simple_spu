const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const { compileCToObject } = require('../out/cCompiler');
const { linkObjects } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');

const source = `
int five(int a, int b, int c, int d, int e) {
    return a + b + c + d + e;
}
int main(void) {
    return five(1, 2, 3, 4, 5) + 24574;
}
`;
const linked = linkObjects([compileCToObject(source, { moduleName: 'typed_rtl' })]);
const startup = `.prog typed_rtl_startup
.entry typed_start

typed_start:
  mov r13, 0x804
  mov r13, r13 << 16
  jmp main, r14
  mov r7, r4
  mov r8, 0x0800
  mov r8, r8 << 16
  mov r8, r8 + 0x03C0
  mov r9, 0x600D
  cmp r10, r7 == r9
  bz r10, r0 + typed_fail
  sw [r8], r7
  jmp typed_halt
typed_fail:
  mov r7, 0x0BAD
  sw [r8], r7
typed_halt:
  jmp typed_halt
`;
const assembly = `${startup}\n${linked.assembly}`;
const assembled = new SimpleCPUAssembler().assemble(assembly, {
    sourceFileName: 'typed_rtl.asm',
});
assert.ok(assembled.machineCodes.length > 0, 'typed startup wrapper must assemble');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-typed-rtl-'));
try {
    const memoryPath = path.join(tempDir, 'typed_rtl.mem');
    const simulationPath = path.join(tempDir, 'typed_cpu_tb.vvp');
    fs.writeFileSync(memoryPath, `${assembled.machineCodes.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('\n')}\n`, 'ascii');
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

console.log('typed C RTL execution test passed');
