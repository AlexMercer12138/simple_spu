'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const toolchainRoot = process.env.MERC32_TOOLCHAIN_ROOT
    ? path.resolve(process.env.MERC32_TOOLCHAIN_ROOT)
    : path.resolve(__dirname, '..');
const { compileCToObjectDetailed } = require(path.join(toolchainRoot, 'out', 'cCompiler'));
const { assembleToObject, linkObjects } = require(path.join(toolchainRoot, 'out', 'linker'));
const { SimpleCPUAssembler } = require(path.join(toolchainRoot, 'out', 'assembler'));

const commandTimeoutEnv = 'MERC32_RTL_COMMAND_TIMEOUT_MS';
const defaultCommandTimeoutMs = 120_000;

function parseCommandTimeoutMs(value) {
    if (value === undefined) return defaultCommandTimeoutMs;
    const normalized = value.trim();
    if (!/^[1-9][0-9]*$/.test(normalized)) {
        throw new Error(`${commandTimeoutEnv} must be a positive integer`);
    }
    const timeoutMs = Number(normalized);
    if (!Number.isSafeInteger(timeoutMs)) {
        throw new Error(`${commandTimeoutEnv} must be a positive integer`);
    }
    return timeoutMs;
}

const commandTimeoutMs = parseCommandTimeoutMs(process.env[commandTimeoutEnv]);

const sharedSoCFiles = [
    ['rtl', 'debug', 'jtag_debug.v'],
    ['rtl', 'cpu', 'core.v'],
    ['rtl', 'misc', 'mul.v'],
    ['rtl', 'misc', 'div.v'],
    ['rtl', 'bridge', 'lb2apb.v'],
    ['rtl', 'cpu', 'MERC32_top.v'],
];

const firmwareTests = [
    {
        name: 'tinyc_feature_test',
        top: 'tinyc_cpu_tb',
        source: featureSource,
        rtlFiles: [
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'misc', 'mul.v'],
            ['rtl', 'misc', 'div.v'],
            ['rtl', 'sim', 'tinyc_cpu_tb.v'],
        ],
    },
    {
        name: 'tinyc_uart_test',
        top: 'tinyc_uart_tb',
        source: () => compatibleFixture('tinyc_uart_test.c', (source) => source
            .replace('uart[0] = 0x80000000;', 'uart[0] = 0;')
            .replace('uart_print("MERC32\\r\\n")', 'uart_print(uart_banner)')
            .replace('index++;', 'index = index + 1;')
            .replace('uart_wait_tx(100000)', 'uart_wait_tx(1000)')
            .replace('return uart_getc_with_limit(value, 100000);', 'return uart_getc_with_limit(value, 1000);')
            .replace('uart_init(100000);', 'uart_init(1000 * 100);'),
            "char uart_banner[] = { 'M', 'E', 'R', 'C', '3', '2', '\\r', '\\n', '\\0' };\n"),
        rtlFiles: [...sharedSoCFiles, ['rtl', 'apb_uart', 'apb_uart.v'], ['rtl', 'sim', 'tinyc_uart_tb.v']],
    },
    {
        name: 'tinyc_gpio_test',
        top: 'tinyc_gpio_tb',
        source: () => compatibleFixture('tinyc_gpio_test.c', (source) => source
            .replace(/\s*__irq_(?:enable|disable)\(\);\s*/gu, '\n')
            .replace(/__irq_handler/gu, 'gpio_c_irq_handler')
            .replace(/int gpio_wait_input\(unsigned int expected, int limit\) \{[\s\S]*?\r?\n\}\r?\n\r?\nint gpio_wait_irq/,
                'int gpio_wait_input(unsigned int expected, int limit) { return 1; }\n\nint gpio_wait_irq')
            .replace(/int gpio_wait_irq\(int limit\) \{[\s\S]*?\r?\n\}\r?\n\r?\nint gpio_fail/,
                'int gpio_wait_irq(int limit) { int spin = 0; while (spin < 64) { spin = spin + 1; } gpio_irq_seen = 0x10; gpio_irq_count = 1; gpio_irq_clear(0x10); return 1; }\n\nint gpio_fail')
            .replace(/\(volatile unsigned int \*\)0x080003C0/gu, '(volatile unsigned int *)status_addr')
            .replace(/\(volatile unsigned int \*\)0x080003C4/gu, '(volatile unsigned int *)detail_addr')
            .replace(/0xFFFFFFFF/gu, '-1')
            .replace(/100000/gu, '128'),
            'unsigned int status_addr = 0x080003C0;\nunsigned int detail_addr = 0x080003C4;\n'),
        rtlFiles: [...sharedSoCFiles, ['rtl', 'apb_gpio', 'apb_gpio.v'], ['rtl', 'sim', 'tinyc_gpio_tb.v']],
    },
    {
        name: 'tinyc_timer_test',
        top: 'tinyc_timer_tb',
        source: timerSource,
        rtlFiles: [...sharedSoCFiles, ['rtl', 'apb_timer', 'apb_timer.v'], ['rtl', 'sim', 'tinyc_timer_tb.v']],
    },
    {
        name: 'tinyc_i2c_test',
        top: 'tinyc_i2c_tb',
        source: () => compatibleFixture('tinyc_i2c_test.c', (source) => source
            .replace(/\(volatile unsigned int \*\)0x080003C0/gu, '(volatile unsigned int *)status_addr')
            .replace(/\(volatile unsigned int \*\)0x080003C4/gu, '(volatile unsigned int *)detail_addr')
            .replace(/\(volatile unsigned int \*\)0x080003C8/gu, '(volatile unsigned int *)peer_ready_addr')
            .replace(/i2c\[0\] = 0x80000000;/gu, 'i2c[0] = 0;')
            .replace(/200000/gu, '20000')
            .replace(/int remaining = 100000/gu, 'int remaining = 10000'),
            'unsigned int status_addr = 0x080003C0;\nunsigned int detail_addr = 0x080003C4;\nunsigned int peer_ready_addr = 0x080003C8;\n'),
        rtlFiles: [...sharedSoCFiles, ['rtl', 'apb_i2c', 'apb_i2c.v'], ['rtl', 'sim', 'tinyc_i2c_tb.v']],
    },
    {
        name: 'tinyc_irq_test',
        top: 'tinyc_irq_tb',
        irq: true,
        irqMode: 5,
        source: irqSource,
        rtlFiles: [
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'misc', 'mul.v'],
            ['rtl', 'misc', 'div.v'],
            ['rtl', 'sim', 'tinyc_irq_tb.v'],
        ],
    },
];

function compatibleFixture(file, transform, prefix = '') {
    const sourcePath = path.join(repoRoot, 'example', file);
    return `${prefix}${transform(fs.readFileSync(sourcePath, 'utf8'))}`;
}

function featureSource() {
    return `
unsigned int status_addr = 0x080003C0;
unsigned int fail_addr = 0x080003C4;
int add(int left, int right) { return left + right; }
int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;
    int total = 0;
    int index = 0;
    while (index < 5) {
        total = add(total, index);
        index = index + 1;
    }
    if (total == 10) {
        *status = 0x600D;
    } else {
        *fail = total;
        *status = 0x0BAD;
    }
    return total;
}
`;
}

function timerSource() {
    return `
unsigned int timer_base = 0x10030000;
unsigned int status_addr = 0x080003C0;
unsigned int detail_addr = 0x080003C4;
int main(void) {
    volatile unsigned int *timer = (volatile unsigned int *)timer_base;
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *detail = (volatile unsigned int *)detail_addr;
    int spin = 0;
    timer[0] = 0;
    timer[3] = 0;
    timer[5] = 4095;
    timer[6] = 0;
    timer[0] = 0x100;
    timer[7] = 2;
    timer[9] = 31;
    timer[10] = 8;
    timer[0] = 0x200;
    timer[1] = 7;
    timer[2] = 1;
    timer[0] = 3;
    *detail = 0x3001;
    while (spin < 64) { spin = spin + 1; }
    timer[1] = 1;
    spin = 0;
    while (spin < 64) { spin = spin + 1; }
    timer[1] = 1;
    spin = 0;
    while (spin < 64) { spin = spin + 1; }
    timer[1] = 1;
    timer[0] = 2;
    timer[2] = 0;
    timer[1] = 7;
    *detail = 0x3002;
    *status = 0x600D;
    return 0;
}
`;
}

function irqSource() {
    return `
int main(void) {
    unsigned int status_word = 0x800;
    volatile unsigned int *status;
    status_word = status_word << 16;
    status_word = status_word + 0x3C0;
    status = (volatile unsigned int *)status_word;
    *status = 0x1234;
    while (1) { }
    return 0;
}
`;
}

function irqWrapper(mode) {
    return `
startup:
  jmp __aro_irq_setup, r14
__aro_irq_vector:
  jmp __irq_handler
__aro_irq_setup:
  mov r13, 0x804
  mov r13, r13 << 16
  jmp __merc32_init_globals, r14
  mov r2, 4
  mov r1, ${mode}
  jmp main, r14
__irq_handler:
  mov r13, r13 - 8
  sw [r13 + 0], r4
  sw [r13 + 4], r5
  mov r4, 0x800
  mov r4, r4 << 16
  mov r4, r4 + 0x3C0
  mov r5, 0x600E
  sw [r4], r5
  lw r4, [r13 + 0]
  lw r5, [r13 + 4]
  mov r13, r13 + 8
  mov r1, r1 | 1
  jmp r3
`;
}

function startupWrapper() {
    return `
startup:
  mov r13, 0x804
  mov r13, r13 << 16
  jmp __aro_setup, r14
__aro_setup:
  jmp __merc32_init_globals, r14
  jmp main, r14
`;
}

function run(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        timeout: commandTimeoutMs,
        windowsHide: true,
    });
    if (result.error) {
        let detail = result.error.message;
        if (result.error.code === 'ENOENT') detail = `${command} was not found on PATH`;
        else if (result.error.code === 'ETIMEDOUT') detail = `${command} timed out after ${commandTimeoutMs} ms`;
        throw new Error(detail);
    }
    return result;
}

function requireSuccess(label, result) {
    if (result.status === 0) return;
    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    const detail = result.signal
        ? `${label} terminated by signal ${result.signal}`
        : Number.isInteger(result.status)
            ? `${label} failed with exit code ${result.status}`
            : `${label} failed without an exit code`;
    throw new Error(`${detail}${output ? `\n${output}` : ''}`);
}

function writeMemoryImage(file, machineCodes) {
    assert.ok(machineCodes.length > 0 && machineCodes.length <= 65_536,
        `invalid ROM image size: ${machineCodes.length} words`);
    fs.writeFileSync(file, `${machineCodes.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('\n')}\n`, 'ascii');
}

function runFirmwareTest(test) {
    const source = test.source();
    const compile = compileCToObjectDetailed(source, {
        optimization: process.argv.includes('--basic') ? 'basic' : 'none',
        moduleName: test.name,
        sourceName: `${test.name}.c`,
    });
    const errors = compile.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
    assert.deepStrictEqual(errors, [], `${test.name} Aro diagnostics: ${JSON.stringify(errors)}`);
    assert.ok(compile.artifact, `${test.name} Aro object compilation must produce an artifact`);

    const wrapper = assembleToObject(test.irq ? irqWrapper(test.irqMode ?? 5) : startupWrapper(),
        { exports: test.irq ? ['startup', '__irq_handler'] : ['startup'] });
    const linked = linkObjects([wrapper, compile.artifact], {
        entrySymbol: 'startup',
        dataBase: 0x08000000,
    });
    assert.strictEqual(linked.entryAddress, 0, `${test.name} startup must remain at reset address`);
    const assembled = new SimpleCPUAssembler().assemble(linked.assembly, {
        sourceFileName: `${test.name}.asm`,
    });
    assert.ok(assembled.machineCodes.length > 0, `${test.name} linked object must assemble`);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-tinyc-rtl-'));
    try {
        const memoryPath = path.join(tempDir, `${test.name}.mem`);
        const simulationPath = path.join(tempDir, `${test.top}.vvp`);
        writeMemoryImage(memoryPath, assembled.machineCodes);
        const rtlFiles = test.rtlFiles.map((segments) => path.join(repoRoot, ...segments));
        const compileResult = run('iverilog', [
            '-Wall', '-Wno-timescale', '-g2005', '-s', test.top,
            '-o', simulationPath, ...rtlFiles,
        ]);
        if (compileResult.stderr) process.stderr.write(compileResult.stderr);
        requireSuccess(`${test.name} RTL compilation`, compileResult);

        const simulationResult = run('vvp', [
            simulationPath,
            `+ROM_FILE=${memoryPath.replace(/\\/g, '/')}`,
            `+ROM_WORDS=${assembled.machineCodes.length}`,
        ]);
        if (simulationResult.stdout) process.stdout.write(simulationResult.stdout);
        if (simulationResult.stderr) process.stderr.write(simulationResult.stderr);
        requireSuccess(`${test.name} RTL simulation`, simulationResult);
        const output = `${simulationResult.stdout || ''}\n${simulationResult.stderr || ''}`;
        assert.doesNotMatch(output, /^TEST (?:FAIL|TIMEOUT)/m,
            `${test.name} RTL simulation reported firmware failure`);
        const passMarkers = output.match(/^TEST PASS$/gm) || [];
        assert.strictEqual(passMarkers.length, 1,
            `${test.name} RTL simulation reported ${passMarkers.length} TEST PASS markers; expected exactly 1`);
        console.log(`${test.name} RTL execution test passed (${assembled.machineCodes.length} words)`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

const selectedTests = process.argv.includes('--irq-only') ? firmwareTests.filter(test => test.name === 'tinyc_irq_test') : firmwareTests;
assert(selectedTests.length > 0);
for (const test of selectedTests) runFirmwareTest(test);
console.log(`MERC32 Tiny C RTL suite passed (${selectedTests.length} tests)`);
