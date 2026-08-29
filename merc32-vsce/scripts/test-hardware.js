const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '..', '..');
const commandTimeoutEnv = 'MERC32_RTL_COMMAND_TIMEOUT_MS';
const defaultCommandTimeoutMs = 120_000;

const hardwareTests = [
    {
        name: 'merc32_core',
        top: 'merc32_core_tb',
        marker: 'TEST PASS: merc32_core checks=358',
        rtlFiles: [
            ['rtl', 'misc', 'mul.v'],
            ['rtl', 'misc', 'div.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'sim', 'merc32_core_tb.v'],
        ],
    },
    {
        name: 'MERC32_top JTAG',
        top: 'MERC32_top_tb',
        marker: 'TEST PASS: MERC32_top JTAG checks=15',
        rtlFiles: [
            ['rtl', 'misc', 'mul.v'],
            ['rtl', 'misc', 'div.v'],
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'bridge', 'lb2apb.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'cpu', 'MERC32_top.v'],
            ['rtl', 'sim', 'MERC32_top_tb.v'],
        ],
    },
    {
        name: 'MERC32_top DEBUG_EN=0',
        top: 'MERC32_top_nodebug_tb',
        marker: 'TEST PASS: MERC32_top DEBUG_EN=0 fetches=11',
        rtlFiles: [
            ['rtl', 'misc', 'mul.v'],
            ['rtl', 'misc', 'div.v'],
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'cpu', 'core.v'],
            ['rtl', 'cpu', 'MERC32_top.v'],
            ['rtl', 'sim', 'MERC32_top_nodebug_tb.v'],
        ],
    },
    {
        name: 'jtag_debug',
        top: 'jtag_debug_tb',
        marker: 'TEST PASS: jtag_debug checks=99',
        rtlFiles: [
            ['rtl', 'debug', 'jtag_debug.v'],
            ['rtl', 'sim', 'jtag_debug_tb.v'],
        ],
    },
    {
        name: 'mul',
        top: 'mul_tb',
        marker: 'PASS: mul_tb',
        rtlFiles: [
            ['rtl', 'misc', 'mul.v'],
            ['rtl', 'sim', 'mul_tb.v'],
        ],
    },
    {
        name: 'div',
        top: 'div_tb',
        marker: 'PASS: div_tb',
        rtlFiles: [
            ['rtl', 'misc', 'div.v'],
            ['rtl', 'sim', 'div_tb.v'],
        ],
    },
    {
        name: 'spram',
        top: 'spram_tb',
        marker: 'TEST PASS: spram checks=23',
        rtlFiles: [
            ['rtl', 'misc', 'spram.v'],
            ['rtl', 'sim', 'spram_tb.v'],
        ],
    },
    {
        name: 'apb_intc protected',
        top: 'apb_intc_tb',
        marker: 'TEST PASS: apb_intc',
        rtlFiles: [
            ['rtl', 'apb_intc', 'apb_intc.v'],
            ['rtl', 'sim', 'apb_intc_tb.v'],
        ],
    },
];

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

function processOutput(result) {
    return `${result.stdout || ''}\n${result.stderr || ''}`;
}

function writeProcessOutput(result) {
    if (result.stdout) {
        process.stdout.write(result.stdout);
    }
    if (result.stderr) {
        process.stderr.write(result.stderr);
    }
}

function requireSuccess(label, result) {
    if (result.status === 0) {
        return;
    }

    const output = processOutput(result).trim();
    const detail = result.signal
        ? `${label} terminated by signal ${result.signal}`
        : Number.isInteger(result.status)
            ? `${label} failed with exit code ${result.status}`
            : `${label} failed without an exit code`;
    throw new Error(`${detail}${output ? `\n${output}` : ''}`);
}

function requireExactMarker(label, result, expectedMarker) {
    const output = processOutput(result);
    const markerCount = output
        .split(/\r?\n/)
        .filter((line) => line === expectedMarker)
        .length;
    const failureMarker = /^(?:TEST (?:FAIL|TIMEOUT)(?::|$)|FAIL:)/m.test(output);

    if (result.status !== 0 || markerCount !== 1 || failureMarker) {
        const status = Number.isInteger(result.status) ? result.status : 'none';
        throw new Error(
            `${label} expected exactly marker "${expectedMarker}" once `
            + `with status 0 and no failure markers; found ${markerCount}, status ${status}`,
        );
    }
}

function compileSimulation(test, tempDir, compilerArgs = []) {
    const simulationPath = path.join(tempDir, `${test.top}-${test.name.replace(/[^A-Za-z0-9]+/g, '-')}.vvp`);
    const rtlFiles = test.rtlFiles.map((segments) => path.join(repoRoot, ...segments));
    const compileResult = run('iverilog', [
        '-Wall',
        '-Wno-timescale',
        '-g2005',
        '-s',
        test.top,
        ...compilerArgs,
        '-o',
        simulationPath,
        ...rtlFiles,
    ]);
    requireSuccess(`${test.name} RTL compilation`, compileResult);
    writeProcessOutput(compileResult);
    return simulationPath;
}

function runHardwareTest(test, tempDir, compilerArgs = []) {
    const simulationPath = compileSimulation(test, tempDir, compilerArgs);
    const simulationResult = run('vvp', [simulationPath]);
    writeProcessOutput(simulationResult);
    requireExactMarker(`${test.name} RTL simulation`, simulationResult, test.marker);
    console.log(`${test.name} hardware test passed`);
}

function main() {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-hardware-'));
    try {
        for (const test of hardwareTests) {
            runHardwareTest(test, tempDir);
        }

        runHardwareTest(
            {
                ...hardwareTests[0],
                name: 'merc32_core invalid DLB width',
                marker: 'CONFIG ERROR: DLB_ADDR_WIDTH must be in range 1..25',
            },
            tempDir,
            ['-P', 'merc32_core_tb.TEST_DLB_ADDR_WIDTH=26'],
        );
        console.log(`MERC32 hardware suite passed (${hardwareTests.length + 1} tests)`);
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

module.exports = { requireExactMarker };

if (require.main === module) {
    main();
}
