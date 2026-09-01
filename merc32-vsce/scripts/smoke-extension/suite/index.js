const assert = require('assert');
const fs = require('fs');
const path = require('path');

const vscode = require('vscode');
const { runIcarusElaboration } = require('./icarus');

const EXTENSION_ID = 'Vikai-mercer.merc32-vsce';
const GUARD_EXTENSION_ID = 'merc32-smoke.merc32-network-guard';
const SMOKE_EXTENSION_ID = 'merc32-smoke.merc32-vsix-smoke';
const GENERATE_COMMAND = 'merc32.soc.generate';
const REQUIRED_GUARD_SELF_TEST_APIS = Object.freeze([
    'dgram.createSocket',
    'dgram.Socket.prototype.send',
    'dns.Resolver.prototype.resolve',
    'dns.lookup',
    'dns.promises.Resolver.prototype.resolve',
    'dns.promises.resolve',
    'http.request',
    'http2.connect',
    'https.request',
    'net.Socket.prototype.connect',
    'net.connect',
    'net.createConnection',
    'tls.connect',
]);

async function run() {
    const configFile = requiredEnvironment('MERC32_SMOKE_CONFIG');
    const extensionsDir = requiredEnvironment('MERC32_SMOKE_EXTENSIONS_DIR');
    const installedExtensionPath = requiredEnvironment('MERC32_SMOKE_INSTALLED_EXTENSION');
    const outputDir = requiredEnvironment('MERC32_SMOKE_OUTPUT');
    const repositoryRoot = requiredEnvironment('MERC32_SMOKE_REPOSITORY');
    const tempRoot = requiredEnvironment('MERC32_SMOKE_TEMP_ROOT');
    const workspaceRoot = requiredEnvironment('MERC32_SMOKE_WORKSPACE');
    const networkGuardLog = requiredEnvironment('MERC32_SMOKE_NETWORK_GUARD_LOG');
    const networkGuardToken = requiredEnvironment('MERC32_SMOKE_NETWORK_GUARD_TOKEN');

    assert.strictEqual(vscode.version, requiredEnvironment('MERC32_SMOKE_VSCODE_VERSION'));
    assertOfflineHostEnvironment(tempRoot, networkGuardLog, networkGuardToken);
    assert.ok(process.argv.every((argument) =>
        !String(argument).startsWith('--extensionDevelopmentPath')
            && !String(argument).startsWith('--extensionTestsPath')),
    'installed smoke host received an extension development or test path');
    assertContained(tempRoot, workspaceRoot, 'smoke workspace');
    assertContained(workspaceRoot, configFile, 'maximal configuration');
    assertContained(workspaceRoot, outputDir, 'generated output');

    const harness = vscode.extensions.getExtension(SMOKE_EXTENSION_ID);
    assert.ok(harness, 'VSCode did not discover the installed smoke extension');
    assert.deepStrictEqual(harness.packageJSON.extensionDependencies, [GUARD_EXTENSION_ID]);
    assertContained(extensionsDir, harness.extensionPath, 'installed smoke extension');

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `VSCode did not discover installed extension ${EXTENSION_ID}`);
    assert.strictEqual(extension.isActive, false,
        'installed MERC32 extension activated before the network guard was ready');
    assert.strictEqual(comparablePath(extension.extensionPath),
        comparablePath(installedExtensionPath));
    assertContained(extensionsDir, extension.extensionPath, 'installed MERC32 extension');
    assert.ok(!pathsOverlap(repositoryRoot, extension.extensionPath),
        'MERC32 extension was loaded from the repository checkout');
    assert.strictEqual(extension.packageJSON.publisher, 'Vikai-mercer');
    assert.strictEqual(extension.packageJSON.name, 'merc32-vsce');

    const guard = vscode.extensions.getExtension(GUARD_EXTENSION_ID);
    assert.ok(guard, 'VSCode did not discover the installed network guard extension');
    assert.strictEqual(guard.isActive, true,
        'network guard dependency was not active before the smoke runner');
    const guardApi = await guard.activate();
    assert.strictEqual(guardApi.assertReady(networkGuardToken), true,
        'network guard did not authenticate its ready state');
    const guardSelfTest = guardApi.runSelfTests(networkGuardToken);
    assert.strictEqual(guardSelfTest.namedPipeAllowed, true,
        'network guard self-test did not preserve named-pipe IPC');
    assert.ok(Array.isArray(guardSelfTest.deniedApis),
        'network guard self-test did not report denied APIs');
    for (const api of REQUIRED_GUARD_SELF_TEST_APIS) {
        assert.ok(guardSelfTest.deniedApis.includes(api),
            `network guard self-test did not cover ${api}`);
    }

    guardApi.heartbeat(networkGuardToken, 'before-target');
    assertNoNetworkAttempts(networkGuardLog, networkGuardToken, [
        'active',
        'before-target',
        'self-test-complete',
    ]);
    assert.strictEqual(extension.isActive, false,
        'installed MERC32 extension activated while recording guard readiness');
    await extension.activate();
    assert.strictEqual(extension.isActive, true,
        'explicit installed MERC32 extension activation did not complete');

    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes(GENERATE_COMMAND),
        `installed extension did not register ${GENERATE_COMMAND}`);
    const generated = await vscode.commands.executeCommand(
        GENERATE_COMMAND,
        vscode.Uri.file(configFile),
    );
    assert.strictEqual(generated, true, 'registered installed Generate command failed');
    assert.strictEqual(extension.isActive, true, 'installed extension did not activate');

    const requiredOutputs = [
        'README.md',
        'manifest.json',
        'hardware/all_peripherals_soc.v',
        'software/all_peripherals_soc.h',
        'software/main.c',
    ];
    for (const logicalPath of requiredOutputs) {
        requireExactFile(path.join(outputDir, ...logicalPath.split('/')),
            `generated ${logicalPath}`);
    }

    for (const logicalPath of [
        'rtl/files.f',
        'software/src/main.c',
        'software/include/all_peripherals_soc.h',
        'config/all_peripherals_soc.resolved.json',
        'address-map.json',
        'LICENSE',
    ]) {
        assert.strictEqual(fs.existsSync(path.join(outputDir, ...logicalPath.split('/'))), false,
            `generated output retained legacy path ${logicalPath}`);
    }

    const hardwareFile = path.join(outputDir, 'hardware', 'all_peripherals_soc.v');
    assert.ok(!pathsOverlap(repositoryRoot, hardwareFile),
        'generated hardware bundle escaped to the repository checkout');
    const manifestFile = path.join(outputDir, 'manifest.json');
    const manifestText = fs.readFileSync(manifestFile, 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.strictEqual(manifest.manifestVersion, 2);
    assert.strictEqual(manifest.projectName, 'all_peripherals_soc');
    assert.strictEqual(comparablePath(manifest.sourceConfig), comparablePath(configFile));
    assertContained(workspaceRoot, manifest.sourceConfig, 'manifest source configuration');
    assert.ok(!containsPath(manifestText, repositoryRoot),
        'generated manifest contains the repository checkout path');
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0,
        'generated manifest has no file records');
    for (const record of manifest.files) {
        assert.ok(record && typeof record.path === 'string',
            'generated manifest contains an invalid file record');
        assertSafeRelativePath(record.path, 'generated manifest file path');
        const generatedFile = path.resolve(outputDir, ...record.path.split('/'));
        assertContained(outputDir, generatedFile, `manifest file ${record.path}`);
        requireExactFile(generatedFile, `manifest file ${record.path}`);
        assert.ok(!pathsOverlap(repositoryRoot, generatedFile),
            `manifest output escaped to the repository checkout: ${record.path}`);
        if (typeof record.logicalSource === 'string') {
            assert.ok(!containsPath(record.logicalSource, repositoryRoot),
                `manifest logical source contains the repository checkout: ${record.path}`);
        }
    }

    requireExactFile(runIcarusElaboration({
        outputDir,
        hardwareFile,
        topModule: manifest.projectName,
    }), 'Icarus elaboration output');
    guardApi.heartbeat(networkGuardToken, 'after-target');
    assertNoNetworkAttempts(networkGuardLog, networkGuardToken, [
        'active',
        'after-target',
        'before-target',
        'self-test-complete',
    ]);

    console.log(`Installed ${EXTENSION_ID} generated the maximal SoC through ${GENERATE_COMMAND}.`);
    console.log('Icarus elaborated one RTL source with top all_peripherals_soc.');
}

async function activate() {
    const resultFile = requiredEnvironment('MERC32_SMOKE_RESULT');
    let result;
    try {
        await run();
        result = { status: 'passed' };
    } catch (error) {
        result = {
            status: 'failed',
            error: error instanceof Error ? error.stack || error.message : String(error),
        };
    }
    const temporary = `${resultFile}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
    });
    fs.renameSync(temporary, resultFile);
    void vscode.commands.executeCommand('workbench.action.quit');
}

function assertOfflineHostEnvironment(tempRoot, networkGuardLog, networkGuardToken) {
    for (const name of [
        'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
        'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy',
        'npm_config_proxy', 'npm_config_https_proxy',
    ]) {
        assert.strictEqual(process.env[name], undefined,
            `installed smoke host inherited network proxy variable ${name}`);
    }
    assert.strictEqual(process.env.MERC32_SMOKE_NETWORK_GUARD_ACTIVE, '1',
        'installed smoke network guard was not preloaded');
    assertContained(tempRoot, networkGuardLog, 'network guard log');
    assertNoNetworkAttempts(networkGuardLog, networkGuardToken, ['active']);
}

function assertNoNetworkAttempts(networkGuardLog, expectedToken, requiredHeartbeats) {
    requireExactFile(networkGuardLog, 'network guard log');
    const text = fs.readFileSync(networkGuardLog, 'utf8');
    assert.ok(text.trim().length > 0, 'network guard log is empty');
    const lines = text.split(/\r?\n/u);
    if (lines[lines.length - 1] === '') lines.pop();
    const records = lines.map((line, index) => {
        assert.ok(line.length > 0, 'network guard log contains an empty record');
        const record = JSON.parse(line);
        assert.ok(record && typeof record === 'object' && !Array.isArray(record),
            `network guard log record ${index} is not an object`);
        assert.strictEqual(record.version, 1,
            `network guard log record ${index} has an unsupported version`);
        assert.strictEqual(record.token, expectedToken,
            'network guard authentication token mismatch');
        assert.ok(Number.isInteger(record.pid) && record.pid > 0,
            `network guard log record ${index} has an invalid pid`);
        assert.ok(['denied', 'heartbeat', 'installed'].includes(record.event),
            `network guard log record ${index} has an invalid event`);
        return record;
    });
    assert.strictEqual(records.filter((record) => record.event === 'installed').length, 1,
        'network guard log must contain exactly one installed record');
    const heartbeats = new Set(records
        .filter((record) => record.event === 'heartbeat')
        .map((record) => record.stage));
    for (const stage of requiredHeartbeats) {
        assert.ok(heartbeats.has(stage), `network guard log is missing heartbeat ${stage}`);
    }
    const attempts = records.filter((record) => record.event === 'denied');
    const runtimeAttempts = attempts.filter((record) => record.phase !== 'self-test');
    assert.deepStrictEqual(runtimeAttempts, [],
        `installed smoke attempted forbidden network access:\n${JSON.stringify(runtimeAttempts)}`);
    const selfTestApis = attempts.map((record) => record.api);
    assert.strictEqual(new Set(selfTestApis).size, selfTestApis.length,
        'network guard self-test recorded a duplicate denial');
    if (requiredHeartbeats.includes('self-test-complete')) {
        for (const api of REQUIRED_GUARD_SELF_TEST_APIS) {
            assert.ok(selfTestApis.includes(api),
                `network guard log is missing self-test denial ${api}`);
        }
    }
}

function requiredEnvironment(name) {
    const value = process.env[name];
    if (!value) throw new Error(`Missing installed-smoke environment variable ${name}.`);
    return value;
}

function requireExactFile(target, label) {
    const status = fs.lstatSync(target);
    assert.ok(status.isFile() && !status.isSymbolicLink(),
        `${label} is not an exact file: ${target}`);
}

function assertSafeRelativePath(value, label) {
    assert.ok(typeof value === 'string' && value.length > 0
        && !value.includes('\\') && !value.startsWith('/')
        && !/^[A-Za-z]:/u.test(value), `${label} is not a portable relative path: ${value}`);
    assert.ok(value.split('/').every((segment) =>
        segment !== '' && segment !== '.' && segment !== '..'),
    `${label} escapes its output root: ${value}`);
}

function assertContained(root, candidate, label) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    assert.ok(relative !== '' && !path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`),
    `${label} is outside its owned root: ${candidate}`);
}

function pathsOverlap(left, right) {
    const leftPath = comparablePath(left);
    const rightPath = comparablePath(right);
    const relative = path.relative(leftPath, rightPath);
    const reverse = path.relative(rightPath, leftPath);
    return relative === ''
        || (!path.isAbsolute(relative) && relative !== '..'
            && !relative.startsWith(`..${path.sep}`))
        || (!path.isAbsolute(reverse) && reverse !== '..'
            && !reverse.startsWith(`..${path.sep}`));
}

function containsPath(text, candidate) {
    const normalizedText = String(text).replace(/\\/g, '/');
    const normalizedCandidate = path.resolve(candidate).replace(/\\/g, '/');
    return process.platform === 'win32'
        ? normalizedText.toLocaleLowerCase('en-US')
            .includes(normalizedCandidate.toLocaleLowerCase('en-US'))
        : normalizedText.includes(normalizedCandidate);
}

function comparablePath(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32'
        ? resolved.toLocaleLowerCase('en-US')
        : resolved;
}

module.exports = { activate, run };
