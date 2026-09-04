const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const { compileCToObjectDetailed, loadRuntimeObjects } = require('../out/cCompiler');
const { assembleToObject, linkObjects } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');

const source = `
void test_pass(int value);
struct Pair { int value; };
int global_seed = 5;
int global_result;
int five(int a, int b, int c, int d, int e) {
    return a + b + c + d + e;
}
int scalar_expression(int value) {
    return value ? -value + !0 : sizeof(int) + _Alignof(int) + '\\n' + ~0;
}
int increment(int *value) {
    *value = *value + 3;
    return *value;
}
int apply(int (*callback)(int *), int *value) {
    return callback(value);
}
int memory_expression(int initial) {
    struct Pair pair;
    int *pointer = &pair.value;
    pair.value = initial + global_seed + global_result;
    global_result = apply(increment, pointer);
    return pointer[0] + global_result - pair.value;
}
int pointer_distance(void) {
    int values[4];
    return &values[3] - values;
}
int main(void) {
    test_pass(five(1, 2, 3, 4, 5) + scalar_expression(3) + memory_expression(4) + pointer_distance() + 24561);
    return 0;
}
`;
const observerObject = assembleToObject(`
test_pass:
  mov r7, r4
  mov r8, 0x0800
  mov r8, r8 << 16
  mov r8, r8 + 0x03C0
  mov r9, 0x600D
  cmp r10, r7 == r9
  bz r10, r0 + typed_fail
  mov r7, 0x600D
  sw [r8], r7
  jmp typed_halt
typed_fail:
  mov r6, 0x0800
  mov r6, r6 << 16
  mov r6, r6 + 0x03C4
  sw [r6], r7
  mov r7, 0x0BAD
  sw [r8], r7
typed_halt:
  jmp typed_halt
`, { exports: ['test_pass'] });
const startupObject = loadRuntimeObjects().find((object) =>
    object.symbols.some((symbol) => symbol.name === 'startup' && symbol.defined));
assert(startupObject, 'runtime catalog must provide startup');
const typedCompile = compileCToObjectDetailed(source, {
    moduleName: 'typed_rtl', sourceName: 'typed_rtl.c',
});
assert.deepStrictEqual(typedCompile.diagnostics.filter((item) => item.severity === 'error'), [],
    'the Aro object path must reach RTL without frontend diagnostics');
assert(typedCompile.artifact, 'the detailed Aro object path must produce an artifact');
const linked = linkObjects([
    startupObject,
    observerObject,
    typedCompile.artifact,
], { entrySymbol: 'startup', dataBase: 0x08000000 });
assert.strictEqual(linked.entryAddress, 0, 'the linked startup wrapper must remain at the reset address');
const firstUserAddress = startupObject.sections[0].size + observerObject.sections[0].size;
assert.strictEqual(linked.symbols.get('five'), firstUserAddress,
    'the typed helper must begin after the runtime and observer objects');
assert.match(linked.assembly, new RegExp(`jmp 0x${firstUserAddress.toString(16)}, r14`),
    'the typed cross-function call must use the helper final absolute byte address');
const assembled = new SimpleCPUAssembler().assemble(linked.assembly, {
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
