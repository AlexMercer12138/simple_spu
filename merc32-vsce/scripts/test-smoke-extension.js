const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runIcarusElaboration } = require('./smoke-extension/suite/icarus');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-icarus-timeout-unit-'));
try {
    const hardwareRoot = path.join(root, 'hardware');
    const hardwareFile = path.join(hardwareRoot, 'all_peripherals_soc.v');
    fs.mkdirSync(hardwareRoot);
    let received;
    const timedOut = Object.assign(new Error('spawnSync iverilog ETIMEDOUT'), { code: 'ETIMEDOUT' });
    assert.throws(() => runIcarusElaboration({
        outputDir: root,
        hardwareFile,
        topModule: 'all_peripherals_soc',
        timeoutMs: 1234,
        spawnSync(command, args, options) {
            received = { command, args, options };
            fs.writeFileSync(path.join(root, 'all_peripherals.vvp'), 'partial');
            return { error: timedOut, signal: 'SIGKILL', status: null, stdout: '', stderr: '' };
        },
    }), /Icarus elaboration timed out after 1234 ms; child terminated with SIGKILL/u,
    'Icarus timeout was not distinguishable from launch/elaboration failures');
    assert.strictEqual(received.command, 'iverilog');
    assert.strictEqual(received.options.timeout, 1234, 'Icarus child did not receive a direct timeout');
    assert.strictEqual(received.options.killSignal, 'SIGKILL',
        'timed-out Icarus child was not forcibly terminated');
    assert.strictEqual(received.options.cwd, root);
    assert.deepStrictEqual(received.args.filter((argument) => argument.endsWith('.v')),
        [hardwareFile]);
    assert.ok(!received.args.includes('-f') && !received.args.includes('files.f'));
    assert.ok(received.args.includes('-s') && received.args.includes('all_peripherals_soc'));
    assert.ok(!fs.existsSync(path.join(root, 'all_peripherals.vvp')),
        'timed-out Icarus child left a partial elaboration artifact behind');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

console.log('Installed smoke Icarus timeout contracts passed.');
