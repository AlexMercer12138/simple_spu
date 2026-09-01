const fs = require('fs');
const path = require('path');
const { spawnSync: defaultSpawnSync } = require('child_process');

const ICARUS_TIMEOUT_MS = 30_000;
const ICARUS_KILL_SIGNAL = 'SIGKILL';

function runIcarusElaboration({
    outputDir,
    hardwareFile,
    topModule,
    timeoutMs = ICARUS_TIMEOUT_MS,
    spawnSync = defaultSpawnSync,
}) {
    const outputFile = path.join(outputDir, 'all_peripherals.vvp');
    const result = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005',
        '-s', topModule,
        '-o', outputFile,
        hardwareFile,
    ], {
        cwd: outputDir,
        encoding: 'utf8',
        killSignal: ICARUS_KILL_SIGNAL,
        timeout: timeoutMs,
    });
    if (result.error?.code === 'ETIMEDOUT') {
        fs.rmSync(outputFile, { force: true });
        throw new Error(`Icarus elaboration timed out after ${timeoutMs} ms; child terminated with `
            + `${result.signal || ICARUS_KILL_SIGNAL}`);
    }
    if (result.error) {
        fs.rmSync(outputFile, { force: true });
        throw new Error(`iverilog failed to launch: ${result.error.message}`);
    }
    if (result.signal) {
        fs.rmSync(outputFile, { force: true });
        throw new Error(`iverilog elaboration terminated by ${result.signal}`);
    }
    if (result.status !== 0) {
        fs.rmSync(outputFile, { force: true });
        throw new Error(`iverilog elaboration failed (${result.status}):\n`
            + `${result.stdout || ''}${result.stderr || ''}`);
    }
    return outputFile;
}

module.exports = { ICARUS_TIMEOUT_MS, runIcarusElaboration };
