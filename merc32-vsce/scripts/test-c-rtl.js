const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { compileC } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandTimeoutEnv = 'MERC32_RTL_COMMAND_TIMEOUT_MS';
const defaultCommandTimeoutMs = 120_000;

function parseCommandTimeoutMs(value) {
    if (value === undefined) {
        return defaultCommandTimeoutMs;
    }

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

const firmwareTests = [
    {
        name: 'tinyc_feature_test',
        top: 'tinyc_cpu_tb',
        rtlFiles: [
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'sim', 'tinyc_cpu_tb.v'],
        ],
    },
    {
        name: 'tinyc_uart_test',
        top: 'tinyc_uart_tb',
        rtlFiles: [
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'bridge', 'lb2apb.v'],
            ['rtl', 'cpu', 'MERC32_top.v'],
            ['rtl', 'misc', 'sync_fifo.v'],
            ['rtl', 'uart', 'apb_uart.v'],
            ['rtl', 'sim', 'tinyc_uart_tb.v'],
        ],
    },
    {
        name: 'tinyc_gpio_test',
        top: 'tinyc_gpio_tb',
        rtlFiles: [
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'bridge', 'lb2apb.v'],
            ['rtl', 'cpu', 'MERC32_top.v'],
            ['rtl', 'gpio', 'apb_gpio.v'],
            ['rtl', 'sim', 'tinyc_gpio_tb.v'],
        ],
    },
    {
        name: 'tinyc_timer_test',
        top: 'tinyc_timer_tb',
        rtlFiles: [
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'bridge', 'lb2apb.v'],
            ['rtl', 'cpu', 'MERC32_top.v'],
            ['rtl', 'timer', 'timer_channel.v'],
            ['rtl', 'timer', 'apb_timer.v'],
            ['rtl', 'sim', 'tinyc_timer_tb.v'],
        ],
    },
    {
        name: 'tinyc_i2c_test',
        top: 'tinyc_i2c_tb',
        rtlFiles: [
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'bridge', 'lb2apb.v'],
            ['rtl', 'cpu', 'MERC32_top.v'],
            ['rtl', 'misc', 'sync_fifo.v'],
            ['rtl', 'i2c', 'i2c_master_lite.v'],
            ['rtl', 'i2c', 'i2c_slave.v'],
            ['rtl', 'i2c', 'apb_i2c.v'],
            ['rtl', 'sim', 'tinyc_i2c_tb.v'],
        ],
    },
    {
        name: 'tinyc_irq_test',
        top: 'tinyc_irq_tb',
        rtlFiles: [
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'sim', 'tinyc_irq_tb.v'],
        ],
    },
];

function run(command, args) {
    const result = spawnSync(command, args, {
        encoding: 'utf8',
        timeout: commandTimeoutMs,
        windowsHide: true,
    });

    if (result.error) {
        let detail = result.error.message;
        if (result.error.code === 'ENOENT') {
            detail = `${command} was not found on PATH`;
        } else if (result.error.code === 'ETIMEDOUT') {
            detail = `${command} timed out after ${commandTimeoutMs} ms`;
        }
        throw new Error(detail);
    }

    return result;
}

function requireSuccess(label, result) {
    if (result.status === 0) {
        return;
    }

    const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
    const detail = result.signal
        ? `${label} terminated by signal ${result.signal}`
        : Number.isInteger(result.status)
            ? `${label} failed with exit code ${result.status}`
            : `${label} failed without an exit code`;
    throw new Error(`${detail}${output ? `\n${output}` : ''}`);
}

function writeMemoryImage(file, machineCodes) {
    if (machineCodes.length === 0 || machineCodes.length > 65_536) {
        throw new Error(`invalid ROM image size: ${machineCodes.length} words`);
    }

    const memoryImage = machineCodes
        .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
        .join('\n');
    fs.writeFileSync(file, `${memoryImage}\n`, 'ascii');
}

function runFirmwareTest(test) {
    const sourcePath = path.join(repoRoot, 'example', `${test.name}.c`);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const { assembly } = compileC(source, { moduleName: test.name });
    const assemblyResult = new SimpleCPUAssembler().assemble(assembly, {
        sourceFileName: sourcePath,
    });

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-tinyc-rtl-'));
    try {
        const memoryPath = path.join(tempDir, `${test.name}.mem`);
        const simulationPath = path.join(tempDir, `${test.top}.vvp`);
        writeMemoryImage(memoryPath, assemblyResult.machineCodes);

        const rtlFiles = test.rtlFiles.map((segments) => path.join(repoRoot, ...segments));
        const compileResult = run('iverilog', [
            '-Wall',
            '-Wno-timescale',
            '-g2005',
            '-s',
            test.top,
            '-o',
            simulationPath,
            ...rtlFiles,
        ]);
        requireSuccess(`${test.name} RTL compilation`, compileResult);
        if (compileResult.stderr) {
            process.stderr.write(compileResult.stderr);
        }

        const portableMemoryPath = memoryPath.replace(/\\/g, '/');
        const simulationResult = run('vvp', [
            simulationPath,
            `+ROM_FILE=${portableMemoryPath}`,
            `+ROM_WORDS=${assemblyResult.machineCodes.length}`,
        ]);
        if (simulationResult.stdout) {
            process.stdout.write(simulationResult.stdout);
        }
        if (simulationResult.stderr) {
            process.stderr.write(simulationResult.stderr);
        }
        requireSuccess(`${test.name} RTL simulation`, simulationResult);

        const output = `${simulationResult.stdout || ''}\n${simulationResult.stderr || ''}`;
        if (/^TEST (?:FAIL|TIMEOUT)/m.test(output)) {
            throw new Error('RTL simulation reported firmware failure');
        }
        const passMarkers = output.match(/^TEST PASS$/gm) || [];
        if (passMarkers.length !== 1) {
            throw new Error(`RTL simulation reported ${passMarkers.length} TEST PASS markers; expected exactly 1`);
        }

        console.log(`${test.name} RTL execution test passed (${assemblyResult.machineCodes.length} words)`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function main() {
    for (const test of firmwareTests) {
        runFirmwareTest(test);
    }
    console.log(`MERC32 Tiny C RTL suite passed (${firmwareTests.length} tests)`);
}

main();
