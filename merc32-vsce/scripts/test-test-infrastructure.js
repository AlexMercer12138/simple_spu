const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const extensionRoot = path.resolve(__dirname, '..');
const controlledTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-infrastructure-test-'));

async function main() {
    try {
        testSharedVSCodeCache();
        await testSharedVSCodeCacheLock();
        testOwnedTempPreservesFalsyFailure();
        testScriptTempCleanup('test-pseudo-instructions.js', 'merc32-pre-');
        testScriptTempCleanup('test-soc-config.js', 'merc32-builtins-');
        console.log('MERC32 test infrastructure tests passed.');
    } finally {
        fs.rmSync(controlledTemp, { recursive: true, force: true });
    }
}

function testOwnedTempPreservesFalsyFailure() {
    const { withOwnedTempRoot } = require('./test-owned-temp');
    let caught = false;
    try {
        withOwnedTempRoot('merc32-falsy-failure-', () => { throw 0; });
    } catch (error) {
        caught = true;
        assert.strictEqual(error, 0);
    }
    assert.strictEqual(caught, true, 'test temp helper swallowed a falsy callback failure');
}

function testSharedVSCodeCache() {
    const {
        ensureVSCodeTestCachePath,
        resolveVSCodeTestCachePath,
    } = require('./vscode-test-cache');
    const firstCheckout = path.join(controlledTemp, 'checkout-a');
    const secondCheckout = path.join(controlledTemp, 'checkout-b');
    fs.mkdirSync(firstCheckout);
    fs.mkdirSync(secondCheckout);

    const ensuredDefault = ensureVSCodeTestCachePath();
    const first = resolveFromCheckout(resolveVSCodeTestCachePath, firstCheckout);
    const second = resolveFromCheckout(resolveVSCodeTestCachePath, secondCheckout);
    assert.strictEqual(first, second, 'VSCode cache path depends on the checkout');
    assert.strictEqual(ensuredDefault, first);
    assert.strictEqual(fs.realpathSync.native(first), first,
        'default VSCode cache path is redirected by the operating system');
    assert.ok(!isWithin(firstCheckout, first), 'VSCode cache is stored in the first checkout');
    assert.ok(!isWithin(secondCheckout, second), 'VSCode cache is stored in the second checkout');

    const override = path.join(controlledTemp, 'custom-vscode-cache');
    assert.strictEqual(resolveVSCodeTestCachePath({
        ...process.env,
        MERC32_VSCODE_TEST_CACHE: override,
    }), path.resolve(override));
    assert.strictEqual(ensureVSCodeTestCachePath({
        ...process.env,
        MERC32_VSCODE_TEST_CACHE: override,
    }), path.resolve(override));
    assert.ok(fs.statSync(override).isDirectory(), 'shared VSCode cache was not created');
}

async function testSharedVSCodeCacheLock() {
    const { withVSCodeTestCacheLock } = require('./vscode-test-cache-lock');
    const cachePath = path.join(controlledTemp, 'lock-cache');
    fs.mkdirSync(cachePath);
    let active = 0;
    let maximumActive = 0;
    const entries = [];
    const run = (name) => withVSCodeTestCacheLock(cachePath, '1.74.3', async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        entries.push(`${name}:start`);
        await new Promise((resolve) => setTimeout(resolve, 100));
        entries.push(`${name}:end`);
        active -= 1;
    }, { pollIntervalMs: 10, staleAfterMs: 1_000, timeoutMs: 5_000 });

    await Promise.all([run('first'), run('second')]);
    assert.strictEqual(maximumActive, 1, 'shared cache lock allowed concurrent writers');
    assert.deepStrictEqual(entries, [
        'first:start', 'first:end', 'second:start', 'second:end',
    ]);

    const worker = path.join(controlledTemp, 'cache-lock-worker.js');
    const log = path.join(controlledTemp, 'cache-lock-worker.log');
    fs.writeFileSync(worker, [
        "const fs = require('fs');",
        "const { withVSCodeTestCacheLock } = require(process.env.LOCK_MODULE);",
        'withVSCodeTestCacheLock(process.env.CACHE_PATH, process.env.VERSION, async () => {',
        "    fs.appendFileSync(process.env.LOG_PATH, `${process.env.NAME}:start\\n`);",
        '    await new Promise((resolve) => setTimeout(resolve, 150));',
        "    fs.appendFileSync(process.env.LOG_PATH, `${process.env.NAME}:end\\n`);",
        '}, { pollIntervalMs: 10, staleAfterMs: 1_000, timeoutMs: 5_000 })',
        "    .catch((error) => { console.error(error); process.exitCode = 1; });",
        '',
    ].join('\n'));
    const lockModule = path.join(__dirname, 'vscode-test-cache-lock.js');
    await Promise.all(['alpha', 'beta'].map((name) => runLockWorker(worker, {
        CACHE_PATH: cachePath,
        LOCK_MODULE: lockModule,
        LOG_PATH: log,
        NAME: name,
        VERSION: '1.74.3',
    })));
    const processEntries = fs.readFileSync(log, 'utf8').trim().split(/\r?\n/u);
    assert.ok(
        (processEntries.join(',') === 'alpha:start,alpha:end,beta:start,beta:end')
        || (processEntries.join(',') === 'beta:start,beta:end,alpha:start,alpha:end'),
        `shared cache lock did not serialize child processes: ${processEntries.join(',')}`,
    );
}

function runLockWorker(worker, environment) {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [worker], {
            cwd: extensionRoot,
            env: { ...process.env, ...environment },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let output = '';
        child.stdout.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
        child.stderr.setEncoding('utf8').on('data', (chunk) => { output += chunk; });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`cache lock worker exited ${code}: ${output}`));
        });
    });
}

function testScriptTempCleanup(scriptName, prefix) {
    const script = path.join(__dirname, scriptName);
    runScript(script, [], `${scriptName} success path`);
    assertNoChildren(prefix, `${scriptName} leaked its success-path temp root`);

    const preload = path.join(controlledTemp,
        `inject-${prefix.replace(/[^a-z0-9]/giu, '_')}-failure.js`);
    fs.writeFileSync(preload, [
        "const fs = require('fs');",
        'const original = fs.writeFileSync;',
        'fs.writeFileSync = function (file, ...args) {',
        `    if (String(file).includes(${JSON.stringify(prefix)})) {`,
        "        throw new Error('injected test infrastructure failure');",
        '    }',
        '    return original.call(this, file, ...args);',
        '};',
        '',
    ].join('\n'));
    const failed = runScript(script, ['-r', preload], `${scriptName} failure path`, false);
    assert.notStrictEqual(failed.status, 0, `${scriptName} ignored the injected failure`);
    assert.match(`${failed.stdout || ''}${failed.stderr || ''}`,
        /injected test infrastructure failure/u);
    assertNoChildren(prefix, `${scriptName} leaked its failure-path temp root`);
}

function resolveFromCheckout(resolver, checkout) {
    const previous = process.cwd();
    try {
        process.chdir(checkout);
        return resolver(process.env);
    } finally {
        process.chdir(previous);
    }
}

function runScript(script, nodeArguments, label, expectSuccess = true) {
    const result = spawnSync(process.execPath, [...nodeArguments, script], {
        cwd: extensionRoot,
        encoding: 'utf8',
        env: {
            ...process.env,
            TEMP: controlledTemp,
            TMP: controlledTemp,
            TMPDIR: controlledTemp,
        },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 120_000,
    });
    if (result.error) throw result.error;
    if (expectSuccess) {
        assert.strictEqual(result.status, 0,
            `${label} failed:\n${result.stdout || ''}${result.stderr || ''}`);
    }
    return result;
}

function assertNoChildren(prefix, message) {
    const matches = fs.readdirSync(controlledTemp)
        .filter((entry) => entry.startsWith(prefix));
    assert.deepStrictEqual(matches, [], `${message}: ${matches.join(', ')}`);
}

function isWithin(parent, candidate) {
    const relative = path.relative(path.resolve(parent), path.resolve(candidate));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
        && !path.isAbsolute(relative));
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
