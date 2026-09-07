const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runIcarusElaboration } = require('./smoke-extension/suite/icarus');
const { withHostCompilerBlocked } = require('./smoke-extension/suite/process-launch-guard');

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

async function testHostCompilerGuard() {
    const childProcess = require('child_process');
    const names = ['exec', 'execFile', 'execFileSync', 'fork', 'spawn', 'spawnSync'];
    const originalMethods = Object.fromEntries(names.map((name) => [name, childProcess[name]]));
    const environmentNames = ['PATH', 'Path', 'PATHEXT', 'CC', 'CXX', 'AR', 'AS', 'LD'];
    const originalEnvironment = Object.fromEntries(environmentNames.map((name) => [name, process.env[name]]));
    process.env.CC = 'host-cc';
    let guardedFailure;
    try {
        await withHostCompilerBlocked(async () => {
            assert.strictEqual(process.env.PATH, '');
            if (process.platform === 'win32') assert.strictEqual(process.env.Path, '');
            else assert.strictEqual(process.env.Path, undefined);
            assert.strictEqual(process.env.PATHEXT, undefined);
            assert.strictEqual(process.env.CC, undefined);
            const { spawnSync } = require('child_process');
            assert.throws(
                () => spawnSync(process.execPath, ['--version']),
                (error) => error?.code === 'MERC32_PROCESS_LAUNCH_DENIED'
                    && error.processApi === 'spawnSync',
                'a child-process reference acquired after guard installation escaped blocking',
            );
            throw new Error('forced guarded-action failure');
        });
    } catch (error) {
        guardedFailure = error;
    }
    assert.match(guardedFailure?.message || '', /forced guarded-action failure/u);
    for (const name of names) {
        assert.strictEqual(childProcess[name], originalMethods[name],
            `child_process.${name} was not restored`);
    }
    for (const name of environmentNames) {
        if (name === 'CC') assert.strictEqual(process.env[name], 'host-cc');
        else if (originalEnvironment[name] === undefined) assert.strictEqual(process.env[name], undefined);
        else assert.strictEqual(process.env[name], originalEnvironment[name]);
    }
    if (originalEnvironment.CC === undefined) delete process.env.CC;
    else process.env.CC = originalEnvironment.CC;
}

testHostCompilerGuard().then(() => {
    console.log('Installed smoke pre-activation process/compiler guard contracts passed.');
}).catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
