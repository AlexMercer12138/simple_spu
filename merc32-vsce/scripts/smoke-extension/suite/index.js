const assert = require('assert');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const http2 = require('http2');
const https = require('https');
const net = require('net');
const path = require('path');
const { spawnSync } = require('child_process');
const tls = require('tls');

installNetworkGuard(process.env.MERC32_SMOKE_NETWORK_GUARD_LOG);

const vscode = require('vscode');

const EXTENSION_ID = 'Vikai-mercer.merc32-vsce';
const SMOKE_EXTENSION_ID = 'merc32-smoke.merc32-vsix-smoke';
const GENERATE_COMMAND = 'merc32.soc.generate';

function installNetworkGuard(logFile) {
    if (!logFile) return;
    const deny = (api) => {
        fs.appendFileSync(logFile, `${process.pid} ${api}\n`);
        throw new Error(`MERC32 installed smoke denied network API ${api}.`);
    };
    const replace = (owner, name) => {
        owner[name] = (...args) => deny(`${name}(${args.length})`);
    };
    const dnsNames = [
        'lookup', 'lookupService', 'resolve', 'resolve4', 'resolve6', 'resolveAny',
        'resolveCaa', 'resolveCname', 'resolveMx', 'resolveNaptr', 'resolveNs',
        'resolvePtr', 'resolveSoa', 'resolveSrv', 'resolveTxt', 'reverse',
    ];
    for (const [owner, names] of [
        [http, ['request', 'get']],
        [https, ['request', 'get']],
        [http2, ['connect']],
        [tls, ['connect']],
        [dns, dnsNames],
    ]) {
        for (const name of names) replace(owner, name);
    }
    if (dns.promises) {
        for (const name of dnsNames) replace(dns.promises, name);
    }

    const isIpc = (args) => typeof args[0] === 'string'
        || (args[0] && typeof args[0] === 'object' && typeof args[0].path === 'string');
    for (const name of ['connect', 'createConnection']) {
        const original = net[name];
        net[name] = function (...args) {
            if (isIpc(args)) return Reflect.apply(original, this, args);
            return deny(`net.${name}`);
        };
    }
    if (typeof globalThis.fetch === 'function') {
        globalThis.fetch = (...args) => deny(`fetch(${args.length})`);
    }
    process.env.MERC32_SMOKE_NETWORK_GUARD_ACTIVE = '1';
}

async function run() {
    const configFile = requiredEnvironment('MERC32_SMOKE_CONFIG');
    const extensionsDir = requiredEnvironment('MERC32_SMOKE_EXTENSIONS_DIR');
    const installedExtensionPath = requiredEnvironment('MERC32_SMOKE_INSTALLED_EXTENSION');
    const outputDir = requiredEnvironment('MERC32_SMOKE_OUTPUT');
    const repositoryRoot = requiredEnvironment('MERC32_SMOKE_REPOSITORY');
    const tempRoot = requiredEnvironment('MERC32_SMOKE_TEMP_ROOT');
    const workspaceRoot = requiredEnvironment('MERC32_SMOKE_WORKSPACE');
    const networkGuardLog = requiredEnvironment('MERC32_SMOKE_NETWORK_GUARD_LOG');

    assert.strictEqual(vscode.version, requiredEnvironment('MERC32_SMOKE_VSCODE_VERSION'));
    assertOfflineHostEnvironment(tempRoot, networkGuardLog);
    assert.ok(process.argv.every((argument) =>
        !String(argument).startsWith('--extensionDevelopmentPath')
            && !String(argument).startsWith('--extensionTestsPath')),
    'installed smoke host received an extension development or test path');
    assertContained(tempRoot, workspaceRoot, 'smoke workspace');
    assertContained(workspaceRoot, configFile, 'maximal configuration');
    assertContained(workspaceRoot, outputDir, 'generated output');

    const harness = vscode.extensions.getExtension(SMOKE_EXTENSION_ID);
    assert.ok(harness, 'VSCode did not discover the installed smoke extension');
    assert.deepStrictEqual(harness.packageJSON.extensionDependencies, [EXTENSION_ID]);
    assertContained(extensionsDir, harness.extensionPath, 'installed smoke extension');

    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, `VSCode did not discover installed extension ${EXTENSION_ID}`);
    assert.strictEqual(comparablePath(extension.extensionPath),
        comparablePath(installedExtensionPath));
    assertContained(extensionsDir, extension.extensionPath, 'installed MERC32 extension');
    assert.ok(!pathsOverlap(repositoryRoot, extension.extensionPath),
        'MERC32 extension was loaded from the repository checkout');
    assert.strictEqual(extension.packageJSON.publisher, 'Vikai-mercer');
    assert.strictEqual(extension.packageJSON.name, 'merc32-vsce');

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
        'software/src/main.c',
        'software/include/all_peripherals_soc.h',
        'config/all_peripherals_soc.resolved.json',
        'address-map.json',
        'manifest.json',
        'rtl/files.f',
    ];
    for (const logicalPath of requiredOutputs) {
        requireExactFile(path.join(outputDir, ...logicalPath.split('/')),
            `generated ${logicalPath}`);
    }

    const rtlRoot = path.join(outputDir, 'rtl');
    const fileList = fs.readFileSync(path.join(rtlRoot, 'files.f'), 'utf8')
        .split(/\r?\n/u)
        .map((entry) => entry.trim())
        .filter(Boolean);
    assert.ok(fileList.length > 0, 'generated rtl/files.f is empty');
    for (const entry of fileList) {
        assertSafeRelativePath(entry, 'rtl/files.f entry');
        const sourceFile = path.resolve(rtlRoot, ...entry.split('/'));
        assertContained(rtlRoot, sourceFile, `rtl/files.f source ${entry}`);
        requireExactFile(sourceFile, `rtl/files.f source ${entry}`);
        assert.ok(!pathsOverlap(repositoryRoot, sourceFile),
            `rtl/files.f source escaped to the repository checkout: ${entry}`);
    }

    const manifestFile = path.join(outputDir, 'manifest.json');
    const manifestText = fs.readFileSync(manifestFile, 'utf8');
    const manifest = JSON.parse(manifestText);
    assert.strictEqual(manifest.manifestVersion, 1);
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

    const elaboration = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005',
        '-s', 'all_peripherals_soc',
        '-o', path.join(outputDir, 'all_peripherals.vvp'),
        '-f', 'files.f',
    ], { cwd: rtlRoot, encoding: 'utf8' });
    assert.ok(!elaboration.error,
        `iverilog failed to launch: ${elaboration.error?.message}`);
    assert.strictEqual(elaboration.status, 0,
        `iverilog elaboration failed:\n${elaboration.stdout || ''}${elaboration.stderr || ''}`);
    requireExactFile(path.join(outputDir, 'all_peripherals.vvp'),
        'Icarus elaboration output');
    assertNoNetworkAttempts(networkGuardLog);

    console.log(`Installed ${EXTENSION_ID} generated the maximal SoC through ${GENERATE_COMMAND}.`);
    console.log(`Icarus elaborated ${fileList.length} RTL sources with top all_peripherals_soc.`);
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

function assertOfflineHostEnvironment(tempRoot, networkGuardLog) {
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
    assertNoNetworkAttempts(networkGuardLog);
}

function assertNoNetworkAttempts(networkGuardLog) {
    if (!fs.existsSync(networkGuardLog)) return;
    const attempts = fs.readFileSync(networkGuardLog, 'utf8').trim();
    assert.strictEqual(attempts, '',
        `installed smoke attempted forbidden network access:\n${attempts}`);
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
