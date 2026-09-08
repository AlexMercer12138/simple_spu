const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { SimpleCPUAssembler } = require('../out/assembler');
const { assembleToObject, linkObjects } = require('../out/linker');
const { loadRuntimeObjects } = require('../out/runtime/runtimeCatalog');
const { compileCFileToObjectDetailed } = require('../out/cCompiler');

const repoRoot = path.resolve(__dirname, '../..');
const base = 0x08000000;
const pointer = (offset) => ({ offset });
const cases = [
    { fn: 'memcpy', name: 'unaligned copy preserves guards', bytes: [91, 128, 255, 0, 42, 92, 93, 94, 95, 96, 97, 98], args: [pointer(7), pointer(1), 4], result: pointer(7), want: [91, 128, 255, 0, 42, 92, 93, 128, 255, 0, 42, 98] },
    { fn: 'memcpy', name: 'zero copy', bytes: [91, 92], args: [pointer(1), pointer(0), 0], result: pointer(1) },
    { fn: 'memcpy', name: 'single byte', bytes: [255, 0, 91], args: [pointer(1), pointer(0), 1], result: pointer(1), want: [255, 255, 91] },
    { fn: 'memset', name: 'unaligned fill truncates int', bytes: [91, 1, 2, 3, 4, 5, 92], args: [pointer(1), 0x1234, 5], result: pointer(1), want: [91, 52, 52, 52, 52, 52, 92] },
    { fn: 'memset', name: 'negative fill', bytes: [91, 0, 92], args: [pointer(1), -1, 1], result: pointer(1), want: [91, 255, 92] },
    { fn: 'memset', name: 'zero fill', bytes: [91, 92], args: [pointer(1), 0, 0], result: pointer(1) },
    { fn: 'memcmp', name: 'equal bytes including embedded NUL', bytes: [91, 128, 0, 255, 92, 128, 0, 255], args: [pointer(1), pointer(5), 3], result: 0 },
    { fn: 'memcmp', name: 'unsigned high byte greater', bytes: [128, 127], args: [pointer(0), pointer(1), 1], sign: '>' },
    { fn: 'memcmp', name: 'unsigned high byte less', bytes: [127, 255], args: [pointer(0), pointer(1), 1], sign: '<' },
    { fn: 'memcmp', name: 'difference after NUL', bytes: [0, 1, 0, 2], args: [pointer(0), pointer(2), 2], sign: '<' },
    { fn: 'memcmp', name: 'first difference decides', bytes: [1, 255, 2, 0], args: [pointer(0), pointer(2), 2], sign: '<' },
    { fn: 'memcmp', name: 'difference beyond count ignored', bytes: [1, 2, 1, 3], args: [pointer(0), pointer(2), 1], result: 0 },
    { fn: 'memcmp', name: 'zero compare', bytes: [1, 2], args: [pointer(0), pointer(1), 0], result: 0 },
    { fn: 'strlen', name: 'unaligned string with high byte', bytes: [91, 128, 255, 65, 0, 66], args: [pointer(1)], result: 3 },
    { fn: 'strlen', name: 'empty string', bytes: [91, 0, 92], args: [pointer(1)], result: 0 },
    { fn: 'strcmp', name: 'equal ignores trailing bytes', bytes: [128, 65, 0, 1, 128, 65, 0, 2], args: [pointer(0), pointer(4)], result: 0 },
    { fn: 'strcmp', name: 'unsigned high byte greater', bytes: [128, 0, 127, 0], args: [pointer(0), pointer(2)], sign: '>' },
    { fn: 'strcmp', name: 'unsigned high byte less', bytes: [127, 0, 255, 0], args: [pointer(0), pointer(2)], sign: '<' },
    { fn: 'strcmp', name: 'shorter prefix', bytes: [65, 0, 65, 66, 0], args: [pointer(0), pointer(2)], sign: '<' },
    { fn: 'strcmp', name: 'longer prefix', bytes: [65, 66, 0, 65, 0], args: [pointer(0), pointer(3)], sign: '>' },
    { fn: 'strcmp', name: 'both empty', bytes: [0, 0], args: [pointer(0), pointer(1)], result: 0 },
    { fn: 'memmove', name: 'overlap backward', bytes: [91, 1, 2, 3, 4, 5, 6, 92], args: [pointer(3), pointer(1), 4], result: pointer(3), want: [91, 1, 2, 1, 2, 3, 4, 92] },
    { fn: 'memmove', name: 'overlap forward', bytes: [91, 1, 2, 3, 4, 5, 6, 92], args: [pointer(1), pointer(3), 4], result: pointer(1), want: [91, 3, 4, 5, 6, 5, 6, 92] },
    { fn: 'memmove', name: 'identical addresses', bytes: [91, 1, 2, 3, 92], args: [pointer(1), pointer(1), 3], result: pointer(1) },
    { fn: 'memmove', name: 'zero move', bytes: [91, 92], args: [pointer(1), pointer(0), 0], result: pointer(1) },
    { fn: 'memmove', name: 'disjoint move', bytes: [91, 128, 255, 92, 0, 0, 93], args: [pointer(4), pointer(1), 2], result: pointer(4), want: [91, 128, 255, 92, 128, 255, 93] },
];

function immediate(register, value) {
    return typeof value === 'object'
        ? `mov ${register}, r9 + ${0x100 + value.offset}`
        : `mov ${register}, ${value}`;
}

function firmware(test) {
    const lines = ['start:', 'mov r9, 0x800', 'mov r9, r9 << 16'];
    const preserved = [2, 3, 10, 11, 12, 13];
    for (const reg of preserved) lines.push(`mov r${reg}, ${1000 + reg}`);
    test.bytes.forEach((byte, i) => lines.push(`mov r7, ${byte}`, `sb [r9 + ${0x100 + i}], r7`));
    test.args.forEach((arg, i) => lines.push(immediate(`r${4 + i}`, arg)));
    lines.push(`jmp ${test.fn}, r14`);
    if (test.sign) lines.push(`cmp r8, r4 ${test.sign} 0`);
    else lines.push(immediate('r7', test.result), 'cmp r8, r4 == r7');
    lines.push('bz r8, r0 + fail');
    // Inspect the entire fixture, including untouched source bytes and guards.
    (test.want || test.bytes).forEach((byte, i) => lines.push(
        `lbu r7, [r9 + ${0x100 + i}]`, `cmp r8, r7 == ${byte}`, 'bz r8, r0 + fail'));
    for (const reg of preserved) lines.push(`cmp r8, r${reg} == ${1000 + reg}`, 'bz r8, r0 + fail');
    lines.push('mov r7, 0x800', 'mov r7, r7 << 16', 'cmp r8, r9 == r7',
        'bz r8, r0 + fail', 'cmp r8, r1 == 0', 'bz r8, r0 + fail',
        'mov r7, 0x600d', 'sw [r9 + 0x3c0], r7', 'halt:', 'jmp halt',
        'fail:', 'mov r9, 0x800', 'mov r9, r9 << 16',
        'sw [r9 + 0x3c4], r4', 'mov r7, 0x0bad', 'sw [r9 + 0x3c0], r7', 'jmp halt');
    return lines.join('\n');
}

function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    assert.ifError(result.error);
    assert.strictEqual(result.status, 0, `${result.stdout || ''}${result.stderr || ''}`);
    return `${result.stdout || ''}${result.stderr || ''}`;
}

const runtime = loadRuntimeObjects({ root: path.join(repoRoot, 'runtime/merc32') })
    .filter((object) => object.symbols.some((symbol) => symbol.name === 'memcpy' && symbol.defined));
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-memory-runtime-'));
const failures = [];
try {
    const simulationPath = path.join(tempDir, 'runtime.vvp');
    run('iverilog', ['-Wall', '-Wno-timescale', '-g2005', '-s', 'tinyc_cpu_tb', '-o', simulationPath,
        ...['rtl/cpu/core.v', 'rtl/misc/mul.v', 'rtl/misc/div.v', 'rtl/sim/tinyc_cpu_tb.v']
            .map((file) => path.join(repoRoot, file))]);
    for (const test of cases) {
        try {
            const user = assembleToObject(firmware(test), { exports: ['start'] });
            const linked = linkObjects([user, ...runtime], { entrySymbol: 'start' });
            const memoryPath = path.join(tempDir, 'runtime.mem');
            fs.writeFileSync(memoryPath, `${linked.machineCodes.map((word) =>
                (word >>> 0).toString(16).padStart(8, '0')).join('\n')}\n`, 'ascii');
            const output = run('vvp', [simulationPath, `+ROM_FILE=${memoryPath.replace(/\\/g, '/')}`,
                `+ROM_WORDS=${linked.machineCodes.length}`]);
            assert.match(output, /^TEST PASS$/m, output);
            assert.doesNotMatch(output, /^TEST (?:FAIL|TIMEOUT)/m, output);
        } catch (error) {
            failures.push(`${test.fn}: ${test.name}: ${error.message}`);
        }
    }
    const sourcePath = path.join(tempDir, 'memory.c');
    fs.writeFileSync(sourcePath, `
#include <string.h>
#include <string.h>
int main(void) {
    char source[6];
    char destination[8];
    source[0] = 65; source[1] = 66; source[2] = 67;
    source[3] = 0; source[4] = 68; source[5] = 0;
    memset(destination, 0, 8);
    if (memcpy(destination + 1, source, 4) != destination + 1) return 1;
    if (strlen(destination + 1) != 3) return 2;
    if (strcmp(destination + 1, source) != 0) return 3;
    if (memcmp(destination + 1, source, 4) != 0) return 4;
    if (memmove(destination + 2, destination + 1, 4) != destination + 2) return 5;
    if (strcmp(destination + 2, source) != 0) return 6;
    if (memset(destination + 1, 0, 1) != destination + 1) return 7;
    if (strlen(destination + 1) != 0) return 8;
    if (destination[0] != 0) return 9;
    if (destination[6] != 0) return 10;
    return 0;
}
`, 'ascii');
    const compiled = compileCFileToObjectDetailed(sourcePath);
    assert.deepStrictEqual(compiled.diagnostics.filter((diagnostic) =>
        diagnostic.severity === 'error' || diagnostic.severity === 'fatal'), [], 'packaged string.h must compile');
    assert.ok(compiled.artifact, 'memory calls must generate an object');
    const wrapper = assembleToObject(`start:
mov r13, 0x804
mov r13, r13 << 16
jmp __merc32_init_globals, r14
jmp main, r14
mov r8, 0x800
mov r8, r8 << 16
sw [r8 + 0x3c4], r4
bnz r4, r0 + fail
mov r7, 0x600d
sw [r8 + 0x3c0], r7
halt:
jmp halt
fail:
mov r7, 0x0bad
sw [r8 + 0x3c0], r7
jmp halt
`, { exports: ['start'] });
    const linked = linkObjects([wrapper, compiled.artifact, ...runtime], { entrySymbol: 'start', dataBase: base });
    const assembled = new SimpleCPUAssembler().assemble(linked.assembly);
    const memoryPath = path.join(tempDir, 'memory-c.mem');
    fs.writeFileSync(memoryPath, `${assembled.machineCodes.map((word) =>
        (word >>> 0).toString(16).padStart(8, '0')).join('\n')}\n`, 'ascii');
    const output = run('vvp', [simulationPath, `+ROM_FILE=${memoryPath.replace(/\\/g, '/')}`,
        `+ROM_WORDS=${assembled.machineCodes.length}`]);
    assert.match(output, /^TEST PASS$/m, output);
    assert.doesNotMatch(output, /^TEST (?:FAIL|TIMEOUT)/m, output);
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
assert.deepStrictEqual(failures, [], failures.join('\n'));
console.log(`MERC32 memory/string runtime RTL execution passed (${cases.length} ABI cases and packaged-header C integration)`);
