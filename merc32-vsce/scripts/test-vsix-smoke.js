const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

const AdmZip = require('adm-zip');
const { createVSIX } = require('@vscode/vsce');
const {
    download,
    resolveCliPathFromVSCodeExecutablePath,
} = require('@vscode/test-electron');

const EXTENSION_ID = 'Vikai-mercer.merc32-vsce';
const SMOKE_EXTENSION_ID = 'merc32-smoke.merc32-vsix-smoke';
const VSCODE_VERSION = '1.74.3';
const TEMP_PREFIX = 'merc32-vsix-smoke-';
const RESOURCE_MANIFEST = 'extension/resources/resource-manifest.json';
const REQUIRED_BASE_RTL = Object.freeze([
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/debug/jtag_debug.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
    'rtl/misc/spram.v',
    'rtl/bridge/lb2apb.v',
]);

async function main() {
    const extensionRoot = path.resolve(__dirname, '..');
    const repositoryRoot = path.resolve(extensionRoot, '..');
    const requestedVsix = process.argv[2];
    assert.ok(requestedVsix, 'Usage: node scripts/test-vsix-smoke.js <path-to-vsix>');
    const inputVsix = path.resolve(extensionRoot, requestedVsix);
    requireExactFile(inputVsix, 'input VSIX');

    const tempReceipt = createOwnedTempRoot();
    let result;
    try {
        result = await testVsix({
            extensionRoot,
            inputVsix,
            repositoryRoot,
            tempRoot: tempReceipt.root,
        });
    } finally {
        removeOwnedTempRoot(tempReceipt);
    }

    console.log(`VSIX archive audit passed (${result.entryCount} files).`);
    console.log('VSIX uncompressed file-map determinism passed (ZIP timestamps ignored).');
    if (result.hostOutput) process.stdout.write(result.hostOutput);
    console.log('Installed VSIX command, workspaceState artifacts, and Icarus smoke passed.');
    console.log(`VSIX smoke temp root removed: ${tempReceipt.root}`);
}

async function testVsix(options) {
    const firstVsix = path.join(options.tempRoot, 'first.vsix');
    fs.copyFileSync(options.inputVsix, firstVsix, fs.constants.COPYFILE_EXCL);
    const first = auditVsix(firstVsix, options.extensionRoot);
    assertVsixContents(first, options.extensionRoot);
    assertPackageContract(options.extensionRoot);

    packageAgain(options.extensionRoot);
    const packagedVsix = path.join(options.extensionRoot, 'merc32-vsce.vsix');
    requireExactFile(packagedVsix, 'second packaged VSIX');
    const second = auditVsix(packagedVsix, options.extensionRoot);
    assertVsixContents(second, options.extensionRoot);
    assert.deepStrictEqual(second.fileMap, first.fileMap,
        'two VSIX packages from the same tree have different uncompressed file maps or hashes');

    const smoke = await runInstalledSmoke({
        extensionRoot: options.extensionRoot,
        repositoryRoot: options.repositoryRoot,
        tempRoot: options.tempRoot,
        vsixFile: packagedVsix,
    });
    assertPersistedArtifactState(smoke.userDataDir, smoke.configFile, smoke.outputDir);
    return { entryCount: second.fileMap.length, hostOutput: smoke.hostOutput };
}

function auditVsix(vsixFile, extensionRoot) {
    const zip = new AdmZip(vsixFile);
    const entries = new Map();
    const fileMap = [];
    for (const entry of zip.getEntries()) {
        const name = normalizeArchivePath(entry.entryName);
        assert.ok(!entries.has(name), `VSIX contains duplicate entry ${name}`);
        entries.set(name, entry);
        if (entry.isDirectory) continue;
        const bytes = entry.getData();
        fileMap.push(Object.freeze({
            path: name,
            size: bytes.length,
            sha256: sha256(bytes),
        }));
    }
    fileMap.sort((left, right) => compareText(left.path, right.path));
    assert.ok(fileMap.length > 0, `VSIX is empty: ${vsixFile}`);
    return Object.freeze({
        entries,
        extensionRoot,
        fileMap: Object.freeze(fileMap),
        vsixFile,
        zip,
    });
}

function assertVsixContents(audit, extensionRoot) {
    const requiredFiles = [
        '[Content_Types].xml',
        'extension.vsixmanifest',
        'extension/package.json',
        'extension/readme.md',
        'extension/out/extension.js',
        'extension/language-configuration/language-configuration.json',
        'extension/syntaxes/merc32-asm.tmLanguage.json',
        'extension/snippets/merc32-asm.json',
        'extension/resources/webview/socEditor.css',
        'extension/resources/webview/socEditor.js',
        RESOURCE_MANIFEST,
    ];
    for (const logicalPath of requiredFiles) requireArchiveFile(audit, logicalPath);
    assert.ok(
        hasArchiveFile(audit, 'extension/LICENSE')
            || hasArchiveFile(audit, 'extension/LICENSE.txt'),
        'VSIX is missing the extension license',
    );

    const resourceManifest = readArchiveJson(audit, RESOURCE_MANIFEST);
    assert.strictEqual(resourceManifest.manifestVersion, 1,
        'resource manifest version is unsupported');
    assert.strictEqual(resourceManifest.sourceRevision, readGitRevision(extensionRoot),
        'resource manifest does not identify the packaged Git revision');
    assert.ok(Array.isArray(resourceManifest.files) && resourceManifest.files.length > 0,
        'resource manifest has no files');
    const resources = new Map();
    for (const record of resourceManifest.files) {
        assert.ok(record && typeof record.path === 'string'
            && typeof record.sha256 === 'string' && /^[0-9a-f]{64}$/u.test(record.sha256),
        'resource manifest contains an invalid file record');
        assert.strictEqual(normalizeResourcePath(record.path), record.path,
            `resource manifest path is not canonical: ${record.path}`);
        assert.ok(!resources.has(record.path), `duplicate resource manifest path ${record.path}`);
        resources.set(record.path, record.sha256);
        const archivePath = `extension/resources/${record.path}`;
        const bytes = readArchiveFile(audit, archivePath);
        assert.strictEqual(sha256(bytes), record.sha256,
            `resource hash mismatch for ${record.path}`);
    }

    for (const webviewPath of ['webview/socEditor.css', 'webview/socEditor.js']) {
        assert.ok(resources.has(webviewPath),
            `resource manifest is missing checked-in ${webviewPath}`);
    }
    for (const resourcePath of collectRequiredRtl(audit)) {
        assert.ok(resources.has(resourcePath),
            `resource manifest is missing catalog RTL dependency ${resourcePath}`);
        requireArchiveFile(audit, `extension/resources/${resourcePath}`);
    }
    assert.ok(resources.has('rtl/apb_intc/apb_intc.v'),
        'resource manifest is missing the protected INTC RTL');
    assert.ok(resources.has('licenses/LICENSE'),
        'resource manifest is missing the generated repository license');
    assert.ok(resources.has('schema/merc32.schema.json'),
        'resource manifest is missing the generated schema');
    assert.ok(resources.has('templates/main.c.tpl')
        && resources.has('templates/README.md.tpl'),
    'resource manifest is missing generator templates');

    assertRuntimeDependencies(audit, extensionRoot);
    assertArchiveExclusions(audit);
}

function collectRequiredRtl(audit) {
    const rtl = new Set(REQUIRED_BASE_RTL);
    const catalogPrefix = 'extension/resources/catalog/modules/';
    const moduleFiles = audit.fileMap
        .map((entry) => entry.path)
        .filter((entry) => entry.startsWith(catalogPrefix) && entry.endsWith('.json'))
        .sort();
    assert.ok(moduleFiles.length > 0, 'VSIX contains no module catalog JSON');
    for (const moduleFile of moduleFiles) {
        addDescriptorRtl(readArchiveJson(audit, moduleFile), moduleFile, rtl);
    }
    const protocolsFile = 'extension/resources/catalog/protocols.json';
    const protocols = readArchiveJson(audit, protocolsFile);
    assert.ok(Array.isArray(protocols), `${protocolsFile} must contain an array`);
    protocols.forEach((descriptor, index) =>
        addDescriptorRtl(descriptor, `${protocolsFile}[${index}]`, rtl));
    return [...rtl].sort();
}

function addDescriptorRtl(descriptor, label, rtl) {
    assert.ok(descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor),
        `${label} is not an object`);
    assert.ok(Array.isArray(descriptor.rtlFiles), `${label}.rtlFiles is not an array`);
    for (const resourcePath of descriptor.rtlFiles) {
        assert.strictEqual(normalizeResourcePath(resourcePath), resourcePath,
            `${label} contains an unsafe RTL path`);
        assert.ok(resourcePath.startsWith('rtl/') && resourcePath.endsWith('.v'),
            `${label} contains a non-RTL dependency`);
        rtl.add(resourcePath);
    }
}

function assertRuntimeDependencies(audit, extensionRoot) {
    const packageLock = JSON.parse(fs.readFileSync(
        path.join(extensionRoot, 'package-lock.json'), 'utf8'));
    const productionPackages = Object.entries(packageLock.packages)
        .filter(([logicalPath, metadata]) => logicalPath.startsWith('node_modules/')
            && !metadata.dev)
        .map(([logicalPath]) => logicalPath.replace(/\\/g, '/'))
        .sort();
    assert.ok(productionPackages.includes('node_modules/ajv'));
    assert.ok(productionPackages.includes('node_modules/jsonc-parser'));
    for (const logicalPath of productionPackages) {
        const prefix = `extension/${logicalPath}/`;
        assert.ok(audit.fileMap.some((entry) => entry.path.startsWith(prefix)),
            `VSIX is missing runtime dependency ${logicalPath}`);
    }
}

function assertArchiveExclusions(audit) {
    const forbiddenPrefixes = [
        'extension/src/',
        'extension/scripts/',
        'extension/rtl/',
        'extension/node_modules/@types/',
        'extension/node_modules/@vscode/',
        'extension/node_modules/adm-zip/',
        'extension/node_modules/mocha/',
        'extension/node_modules/typescript/',
    ];
    for (const entry of audit.fileMap) {
        const name = entry.path;
        assert.ok(!forbiddenPrefixes.some((prefix) => name.startsWith(prefix)),
            `VSIX contains excluded development path ${name}`);
        assert.ok(!name.split('/').some((segment) => segment === '.git'
            || segment === 'fixtures' || segment === 'test' || segment === 'tests'),
        `VSIX contains excluded repository/test path ${name}`);
        assert.ok(!name.endsWith('.map'), `VSIX contains source map ${name}`);
        assert.ok(!name.includes('/rtl/sim/'), `VSIX contains RTL simulation source ${name}`);
        assert.ok(!name.endsWith('_manual.md'),
            `VSIX contains readable RTL maintenance documentation ${name}`);
    }
}

function assertPackageContract(extensionRoot) {
    const packageJson = JSON.parse(fs.readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
    assert.strictEqual(packageJson.devDependencies['@vscode/vsce'], '3.6.2');
    assert.strictEqual(packageJson.devDependencies['adm-zip'], '0.5.16');
    assert.strictEqual(packageJson.scripts['package:vsix'],
        'npm run vscode:prepublish && vsce package --out merc32-vsce.vsix');
    assert.strictEqual(packageJson.scripts['test:vsix'],
        'node scripts/test-vsix-smoke.js merc32-vsce.vsix');
}

function packageAgain(extensionRoot) {
    const npmCli = resolveNpmCli();
    const result = spawnSync(process.execPath, [npmCli, 'run', 'package:vsix'], {
        cwd: extensionRoot,
        encoding: 'utf8',
        env: process.env,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 180_000,
    });
    assertSpawnPassed(result, 'second deterministic VSIX package');
}

async function runInstalledSmoke(options) {
    const harnessSource = path.join(options.extensionRoot, 'scripts', 'smoke-extension');
    assert.deepStrictEqual(listRelativeFiles(harnessSource), [
        'package.json',
        'suite/index.js',
    ], 'installed smoke harness is missing or contains unexpected checkout files');

    const harnessPackageRoot = path.join(options.tempRoot, 'smoke-extension');
    copyExactTree(harnessSource, harnessPackageRoot);
    const harnessVsix = path.join(options.tempRoot, 'smoke-extension.vsix');
    await createVSIX({
        allowMissingRepository: true,
        cwd: harnessPackageRoot,
        dependencies: false,
        packagePath: harnessVsix,
        skipLicense: true,
    });
    requireExactFile(harnessVsix, 'packaged smoke extension');

    const extensionsDir = createChildDirectory(options.tempRoot, 'extensions');
    const userDataDir = createChildDirectory(options.tempRoot, 'user-data');
    const workspaceDir = createChildDirectory(options.tempRoot, 'workspace');
    const configFile = path.join(workspaceDir, 'all-peripherals.merc32.json');
    fs.copyFileSync(
        path.join(options.extensionRoot, 'scripts', 'fixtures', 'soc',
            'all-peripherals.merc32.json'),
        configFile,
        fs.constants.COPYFILE_EXCL,
    );

    const cachePath = path.join(options.extensionRoot, '.vscode-test');
    const executable = await download({
        version: VSCODE_VERSION,
        cachePath,
    });
    requireExactFile(executable, `cached VSCode ${VSCODE_VERSION} executable`);
    installVsix(executable, options.vsixFile, extensionsDir, userDataDir);
    const installedExtension = findInstalledExtension(extensionsDir, EXTENSION_ID);
    installVsix(executable, harnessVsix, extensionsDir, userDataDir);
    const harnessDir = findInstalledExtension(extensionsDir, SMOKE_EXTENSION_ID);
    const harnessManifest = JSON.parse(fs.readFileSync(
        path.join(harnessDir, 'package.json'), 'utf8'));
    assert.deepStrictEqual(harnessManifest.extensionDependencies, [EXTENSION_ID],
        'smoke extension must depend on the installed MERC32 extension');

    const outputDir = path.join(workspaceDir, 'generated', 'all_peripherals_soc');
    const resultFile = path.join(options.tempRoot, 'smoke-result.json');
    const launchArgs = [
        workspaceDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--new-window',
        '--no-sandbox',
        '--no-proxy-server',
        '--disable-gpu-sandbox',
        '--disable-telemetry',
        '--disable-updates',
        '--skip-welcome',
        '--skip-release-notes',
        '--disable-workspace-trust',
        '--disable-gpu',
    ];
    assert.ok(launchArgs.every((argument) =>
        !argument.startsWith('--extensionDevelopmentPath')
            && !argument.startsWith('--extensionTestsPath')),
    'installed smoke must not use extension development or test paths');
    const hostEnvironment = offlineEnvironment({
        MERC32_SMOKE_CONFIG: configFile,
        MERC32_SMOKE_EXTENSIONS_DIR: extensionsDir,
        MERC32_SMOKE_INSTALLED_EXTENSION: installedExtension,
        MERC32_SMOKE_OUTPUT: outputDir,
        MERC32_SMOKE_REPOSITORY: options.repositoryRoot,
        MERC32_SMOKE_RESULT: resultFile,
        MERC32_SMOKE_TEMP_ROOT: options.tempRoot,
        MERC32_SMOKE_VSCODE_VERSION: VSCODE_VERSION,
        MERC32_SMOKE_WORKSPACE: workspaceDir,
    });
    const host = spawnSync(executable, launchArgs, {
        cwd: options.tempRoot,
        encoding: 'utf8',
        env: hostEnvironment,
        maxBuffer: 32 * 1024 * 1024,
        timeout: 180_000,
    });
    assertSpawnPassed(host, 'installed VSIX extension host',
        describeHostFailure(userDataDir, extensionsDir, resultFile));
    requireExactFile(resultFile, 'installed smoke result');
    const smokeResult = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
    assert.strictEqual(smokeResult.status, 'passed',
        `installed smoke harness failed: ${smokeResult.error || 'unknown failure'}`);
    return {
        configFile,
        hostOutput: `${host.stdout || ''}${host.stderr || ''}`,
        outputDir,
        userDataDir,
    };
}

function installVsix(executable, vsixFile, extensionsDir, userDataDir) {
    const cli = resolveCliPathFromVSCodeExecutablePath(executable);
    requireExactFile(cli, 'cached VSCode CLI');
    const result = spawnSync(cli, [
        '--install-extension', vsixFile,
        '--force',
        `--extensions-dir=${extensionsDir}`,
        `--user-data-dir=${userDataDir}`,
    ], {
        encoding: 'utf8',
        env: offlineEnvironment(),
        maxBuffer: 16 * 1024 * 1024,
        shell: process.platform === 'win32',
        timeout: 60_000,
        windowsHide: true,
    });
    assertSpawnPassed(result, 'cached VSCode CLI VSIX install');
}

function findInstalledExtension(extensionsDir, extensionId) {
    const matches = [];
    for (const name of fs.readdirSync(extensionsDir).sort()) {
        const candidate = path.join(extensionsDir, name);
        const status = fs.lstatSync(candidate);
        if (!status.isDirectory() || status.isSymbolicLink()) continue;
        const manifestFile = path.join(candidate, 'package.json');
        if (!isExactFile(manifestFile)) continue;
        const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
        if (`${manifest.publisher}.${manifest.name}`.toLocaleLowerCase('en-US')
            === extensionId.toLocaleLowerCase('en-US')) matches.push(candidate);
    }
    assert.strictEqual(matches.length, 1,
        `expected one installed ${extensionId} extension, found ${matches.length}`);
    assertContainedPath(extensionsDir, matches[0], 'installed extension');
    return fs.realpathSync.native(matches[0]);
}

function assertPersistedArtifactState(userDataDir, configFile, outputDir) {
    const databaseFiles = listFilesNamed(userDataDir, 'state.vscdb');
    assert.ok(databaseFiles.length > 0, 'installed VSCode host wrote no workspace state database');
    let matchingRecord;
    for (const databaseFile of databaseFiles) {
        const records = readArtifactStateRecords(databaseFile);
        matchingRecord = records.find((record) => {
            try {
                return samePath(fileUriPath(record.configUri), configFile)
                    && samePath(fileUriPath(record.outputUri), outputDir);
            } catch {
                return false;
            }
        });
        if (matchingRecord) break;
    }
    assert.ok(matchingRecord,
        'registered installed Generate command did not persist its real artifact record');
}

function readArtifactStateRecords(databaseFile) {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(databaseFile, { readOnly: true });
    try {
        const rows = database.prepare('SELECT key, value FROM ItemTable').all();
        const records = [];
        for (const row of rows) {
            const text = Buffer.isBuffer(row.value)
                ? row.value.toString('utf8')
                : String(row.value);
            if (!text.includes('merc32.soc.generatedArtifacts')) continue;
            let value;
            try {
                value = JSON.parse(text);
            } catch {
                continue;
            }
            collectArtifactRecords(value, records);
        }
        return records;
    } finally {
        database.close();
    }
}

function collectArtifactRecords(value, records) {
    if (Array.isArray(value)) {
        value.forEach((item) => collectArtifactRecords(item, records));
        return;
    }
    if (!value || typeof value !== 'object') return;
    const artifacts = value['merc32.soc.generatedArtifacts'];
    if (Array.isArray(artifacts)) {
        for (const item of artifacts) {
            if (item && typeof item.configUri === 'string' && typeof item.outputUri === 'string') {
                records.push(item);
            }
        }
    }
    Object.values(value).forEach((item) => collectArtifactRecords(item, records));
}

function offlineEnvironment(additions = {}) {
    const env = { ...process.env, ...additions };
    for (const name of [
        'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
        'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy',
        'npm_config_proxy', 'npm_config_https_proxy',
    ]) delete env[name];
    env.NO_PROXY = '*';
    env.no_proxy = '*';
    return env;
}

function createOwnedTempRoot() {
    const tempParent = fs.realpathSync.native(path.resolve(os.tmpdir()));
    const parentIdentity = fileIdentity(tempParent, 'smoke temp parent');
    const root = fs.mkdtempSync(path.join(tempParent, TEMP_PREFIX));
    assert.strictEqual(fs.realpathSync.native(root), path.resolve(root),
        'smoke temp root is redirected');
    return Object.freeze({
        parentIdentity,
        root,
        rootIdentity: fileIdentity(root, 'smoke temp root'),
        tempParent,
    });
}

function removeOwnedTempRoot(receipt) {
    const resolvedRoot = path.resolve(receipt.root);
    assert.strictEqual(path.dirname(resolvedRoot), receipt.tempParent,
        `refusing to remove non-child smoke root ${resolvedRoot}`);
    assert.ok(path.basename(resolvedRoot).startsWith(TEMP_PREFIX),
        `refusing to remove unowned smoke root ${resolvedRoot}`);
    assert.deepStrictEqual(fileIdentity(receipt.tempParent, 'smoke temp parent'),
        receipt.parentIdentity, 'smoke temp parent identity changed');
    assert.deepStrictEqual(fileIdentity(resolvedRoot, 'smoke temp root'),
        receipt.rootIdentity, 'smoke temp root identity changed');
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
    assert.ok(!fs.existsSync(resolvedRoot), `smoke temp root still exists: ${resolvedRoot}`);
}

function fileIdentity(target, label) {
    const status = fs.lstatSync(target, { bigint: true });
    assert.ok(status.isDirectory() && !status.isSymbolicLink(), `${label} is not an exact directory`);
    return Object.freeze({ dev: status.dev.toString(), ino: status.ino.toString() });
}

function createChildDirectory(root, name) {
    const target = path.join(root, name);
    assertContainedPath(root, target, name);
    fs.mkdirSync(target);
    return target;
}

function copyExactTree(source, destination) {
    fs.mkdirSync(destination);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        assert.ok(!entry.isSymbolicLink(), `smoke harness contains link ${sourcePath}`);
        if (entry.isDirectory()) copyExactTree(sourcePath, destinationPath);
        else if (entry.isFile()) fs.copyFileSync(sourcePath, destinationPath,
            fs.constants.COPYFILE_EXCL);
        else throw new Error(`unsupported smoke harness entry ${sourcePath}`);
    }
}

function listRelativeFiles(root) {
    if (!fs.existsSync(root)) return [];
    const result = [];
    const visit = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            assert.ok(!entry.isSymbolicLink(), `smoke harness contains link ${logicalPath}`);
            if (entry.isDirectory()) visit(path.join(directory, entry.name), logicalPath);
            else if (entry.isFile()) result.push(logicalPath);
            else throw new Error(`unsupported smoke harness entry ${logicalPath}`);
        }
    };
    visit(root, '');
    return result.sort();
}

function listFilesNamed(root, expectedName) {
    const result = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) visit(target);
            else if (entry.isFile() && entry.name === expectedName) result.push(target);
        }
    };
    visit(root);
    return result.sort();
}

function describeHostFailure(userDataDir, extensionsDir, resultFile) {
    const details = [
        `smokeResultExists=${fs.existsSync(resultFile)}`,
        `extensionFolders=${fs.readdirSync(extensionsDir).sort().join(',')}`,
    ];
    if (isExactFile(resultFile)) {
        details.push(`smokeResult=${fs.readFileSync(resultFile, 'utf8')}`);
    }
    const logs = listFilesMatching(userDataDir, (name) => name.endsWith('.log')).slice(-12);
    for (const logFile of logs) {
        const text = fs.readFileSync(logFile, 'utf8');
        details.push(`LOG ${path.relative(userDataDir, logFile)}\n${text.slice(-8_000)}`);
    }
    return details.join('\n');
}

function listFilesMatching(root, predicate) {
    const result = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isSymbolicLink()) continue;
            if (entry.isDirectory()) visit(target);
            else if (entry.isFile() && predicate(entry.name)) result.push(target);
        }
    };
    visit(root);
    return result.sort();
}

function requireArchiveFile(audit, logicalPath) {
    assert.ok(hasArchiveFile(audit, logicalPath), `VSIX is missing ${logicalPath}`);
}

function hasArchiveFile(audit, logicalPath) {
    const entry = audit.entries.get(logicalPath);
    return entry !== undefined && !entry.isDirectory;
}

function readArchiveFile(audit, logicalPath) {
    requireArchiveFile(audit, logicalPath);
    return audit.entries.get(logicalPath).getData();
}

function readArchiveJson(audit, logicalPath) {
    return JSON.parse(readArchiveFile(audit, logicalPath).toString('utf8'));
}

function normalizeArchivePath(value) {
    assert.strictEqual(typeof value, 'string');
    assert.ok(!value.includes('\\'), `VSIX entry uses backslashes: ${value}`);
    assert.ok(!value.startsWith('/') && !/^[A-Za-z]:/u.test(value),
        `VSIX entry is absolute: ${value}`);
    const segments = value.split('/').filter((segment) => segment !== '');
    assert.ok(segments.every((segment) => segment !== '.' && segment !== '..'),
        `VSIX entry escapes the archive root: ${value}`);
    return value;
}

function normalizeResourcePath(value) {
    assert.strictEqual(typeof value, 'string');
    assert.ok(value.length > 0 && !value.includes('\\') && !value.startsWith('/'),
        `unsafe resource path ${value}`);
    const segments = value.split('/');
    assert.ok(segments.every((segment) => segment !== '' && segment !== '.' && segment !== '..'),
        `unsafe resource path ${value}`);
    return segments.join('/');
}

function requireExactFile(target, label) {
    assert.ok(isExactFile(target), `${label} is missing or not an exact file: ${target}`);
}

function isExactFile(target) {
    try {
        const status = fs.lstatSync(target);
        return status.isFile() && !status.isSymbolicLink();
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function assertContainedPath(root, candidate, label) {
    const relative = path.relative(path.resolve(root), path.resolve(candidate));
    assert.ok(relative !== '' && !path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`),
    `${label} escapes owned root: ${candidate}`);
}

function fileUriPath(value) {
    const parsed = new URL(value);
    assert.strictEqual(parsed.protocol, 'file:', `artifact URI is not a file URI: ${value}`);
    return fileURLToPath(parsed);
}

function samePath(left, right) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32'
            ? resolved.toLocaleLowerCase('en-US')
            : resolved;
    };
    return normalize(left) === normalize(right);
}

function readGitRevision(extensionRoot) {
    const result = spawnSync('git', ['rev-parse', 'HEAD'], {
        cwd: extensionRoot,
        encoding: 'utf8',
    });
    assertSpawnPassed(result, 'read packaged Git revision');
    return result.stdout.trim();
}

function resolveNpmCli() {
    const candidate = process.env.npm_execpath
        || path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js');
    requireExactFile(candidate, 'npm CLI');
    return candidate;
}

function assertSpawnPassed(result, label, details = '') {
    const suffix = details ? `\n${details}` : '';
    assert.ok(!result.error,
        `${label} failed to launch: ${result.error?.message}${suffix}`);
    assert.ok(!result.signal, `${label} terminated by ${result.signal}`);
    assert.strictEqual(result.status, 0,
        `${label} failed (${result.status}):\n${result.stdout || ''}${result.stderr || ''}${suffix}`);
}

function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compareText(left, right) {
    return left < right ? -1 : left > right ? 1 : 0;
}

main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
