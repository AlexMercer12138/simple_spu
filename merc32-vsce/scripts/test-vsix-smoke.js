const assert = require('assert');
const crypto = require('crypto');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath } = require('url');

const AdmZip = require('adm-zip');
const { createVSIX } = require('@vscode/vsce');
const {
    resolveCliPathFromVSCodeExecutablePath,
} = require('@vscode/test-electron');

const EXTENSION_ID = 'Vikai-mercer.merc32-vsce';
const GUARD_EXTENSION_ID = 'merc32-smoke.merc32-network-guard';
const SMOKE_EXTENSION_ID = 'merc32-smoke.merc32-vsix-smoke';
const VSCODE_VERSION = '1.74.3';
const TEMP_PREFIX = 'merc32-vsix-smoke-';
const RESOURCE_MANIFEST = 'extension/resources/resource-manifest.json';
const NETWORK_LAUNCH_ARGS = Object.freeze([
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-domain-reliability',
    '--disable-sync',
    '--host-resolver-rules=MAP * ~NOTFOUND',
    '--metrics-recording-only',
    '--no-pings',
    '--proxy-server=http://127.0.0.1:9',
    '--proxy-bypass-list=<-loopback>',
]);
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
        assertColdCacheFailsWithoutNetwork(tempReceipt.root);
        assertNetworkGuardAuthenticationContracts(tempReceipt.root);
        assertStandaloneNetworkGuardCoverage(extensionRoot, tempReceipt.root);
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
    console.log('VSIX cold-cache network-denial contract passed.');
    console.log('VSIX uncompressed file-map determinism passed (ZIP timestamps ignored).');
    if (result.hostOutput) process.stdout.write(result.hostOutput);
    console.log('Installed VSIX command, workspaceState artifacts, and Icarus smoke passed.');
    console.log(`VSIX smoke temp root removed: ${tempReceipt.root}`);
}

function assertColdCacheFailsWithoutNetwork(tempRoot) {
    const coldExtensionRoot = createChildDirectory(tempRoot, 'cold-cache-extension');
    const attempts = [];
    const patches = [
        [http, 'request'],
        [http, 'get'],
        [https, 'request'],
        [https, 'get'],
        [dns, 'lookup'],
        [dns, 'resolve'],
    ];
    const originals = patches.map(([owner, name]) => [owner, name, owner[name]]);
    const fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
    const forbid = (name) => (...args) => {
        attempts.push({ name, argumentCount: args.length });
        throw new Error(`Forbidden cold-cache network API: ${name}`);
    };
    for (const [owner, name] of patches) owner[name] = forbid(name);
    Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        value: forbid('fetch'),
        writable: true,
    });

    let failure;
    try {
        resolveCachedVSCodeExecutable(coldExtensionRoot);
    } catch (error) {
        failure = error;
    } finally {
        for (const [owner, name, original] of originals) owner[name] = original;
        if (fetchDescriptor === undefined) delete globalThis.fetch;
        else Object.defineProperty(globalThis, 'fetch', fetchDescriptor);
    }
    assert.ok(failure instanceof Error, 'cold VSCode cache was accepted');
    assert.match(failure.message,
        /Cached VSCode 1\.74\.3.*npm run test:extension/u,
        `cold-cache failure lacks bootstrap guidance: ${failure.message}`);
    assert.deepStrictEqual(attempts, [],
        'cold-cache resolution attempted network access');
}

function assertNetworkGuardAuthenticationContracts(tempRoot) {
    const expectedToken = 'a'.repeat(64);
    const contracts = [
        {
            expected: /network guard log is missing/u,
            label: 'missing guard log',
            path: path.join(tempRoot, 'missing-guard.log'),
        },
        {
            expected: /network guard log is empty/u,
            label: 'empty guard log',
            path: path.join(tempRoot, 'empty-guard.log'),
            text: '',
        },
        {
            expected: /network guard authentication token mismatch/u,
            label: 'wrong-token guard log',
            path: path.join(tempRoot, 'wrong-token-guard.log'),
            text: `${JSON.stringify({
                event: 'installed',
                pid: process.pid,
                token: 'b'.repeat(64),
                version: 1,
            })}\n`,
        },
    ];
    const failures = [];
    for (const contract of contracts) {
        if (contract.text !== undefined) {
            fs.writeFileSync(contract.path, contract.text, { encoding: 'utf8', flag: 'wx' });
        }
        try {
            assert.throws(
                () => assertNoRecordedNetworkAttempts(contract.path, expectedToken),
                contract.expected,
                contract.label,
            );
        } catch (error) {
            failures.push(`${contract.label}: ${error.actual?.message || error.message}`);
        }
    }
    assert.deepStrictEqual(failures, [],
        `network guard authentication contract failure(s):\n${failures.join('\n')}`);
}

function assertStandaloneNetworkGuardCoverage(extensionRoot, tempRoot) {
    const guardModule = path.join(
        extensionRoot,
        'scripts',
        'smoke-network-guard',
        'suite',
        'index.js',
    );
    requireExactFile(guardModule, 'standalone network guard module');
    const logFile = path.join(tempRoot, 'standalone-network-guard.log');
    const token = crypto.randomBytes(32).toString('hex');
    const script = [
        "const guard = require(process.env.MERC32_SMOKE_GUARD_MODULE);",
        "const token = process.env.MERC32_SMOKE_NETWORK_GUARD_TOKEN;",
        'const api = guard.activate();',
        "if (api.assertReady(token) !== true) throw new Error('guard not ready');",
        'process.stdout.write(JSON.stringify(api.runSelfTests(token)));',
    ].join('\n');
    const result = spawnSync(process.execPath, ['-e', script], {
        cwd: tempRoot,
        encoding: 'utf8',
        env: offlineEnvironment({
            MERC32_SMOKE_GUARD_MODULE: guardModule,
            MERC32_SMOKE_NETWORK_GUARD_LOG: logFile,
            MERC32_SMOKE_NETWORK_GUARD_TOKEN: token,
        }),
        maxBuffer: 16 * 1024 * 1024,
        timeout: 30_000,
    });
    assertSpawnPassed(result, 'standalone network guard self-test');
    const selfTest = JSON.parse(result.stdout);
    assert.strictEqual(selfTest.namedPipeAllowed, true,
        'standalone guard self-test did not preserve named-pipe IPC');
    for (const api of REQUIRED_GUARD_SELF_TEST_APIS) {
        assert.ok(selfTest.deniedApis.includes(api),
            `standalone guard self-test did not cover ${api}`);
    }
    for (const api of ['fetch', 'WebSocket']) {
        if (typeof globalThis[api] === 'function') {
            assert.ok(selfTest.deniedApis.includes(api),
                `standalone guard self-test did not cover reachable ${api}`);
        }
    }
    try {
        require.resolve('undici');
        assert.ok(selfTest.deniedApis.includes('undici.Dispatcher.prototype.dispatch'),
            'standalone guard self-test did not cover reachable Undici dispatch');
    } catch (error) {
        if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    }
    assertNoRecordedNetworkAttempts(logFile, token, ['active', 'self-test-complete']);
}

async function testVsix(options) {
    const firstVsix = path.join(options.tempRoot, 'first.vsix');
    fs.copyFileSync(options.inputVsix, firstVsix, fs.constants.COPYFILE_EXCL);
    const first = auditVsix(firstVsix, options.extensionRoot);
    assertVsixContents(first, options.extensionRoot);
    runArchiveMutationContracts(firstVsix, options.extensionRoot, options.tempRoot);
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
    const zip = new AdmZip(vsixFile, { noSort: true });
    const entries = new Map();
    const pathTrie = { children: new Map() };
    const fileMap = [];
    for (const entry of zip.getEntries()) {
        const name = normalizeArchivePath(entry.entryName, entry.isDirectory);
        assert.ok(!entries.has(name), `VSIX contains duplicate entry ${name}`);
        registerArchivePath(pathTrie, name, entry.isDirectory);
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

function registerArchivePath(root, name, isDirectory) {
    const segments = (isDirectory ? name.slice(0, -1) : name).split('/');
    let node = root;
    for (const [index, segment] of segments.entries()) {
        const foldedSegment = segment.toLocaleLowerCase('en-US');
        const logicalPath = segments.slice(0, index + 1).join('/');
        let child = node.children.get(foldedSegment);
        if (child === undefined) {
            child = {
                children: new Map(),
                explicitType: undefined,
                logicalPath,
                requiredDirectory: false,
                spelling: segment,
            };
            node.children.set(foldedSegment, child);
        } else {
            assert.strictEqual(child.spelling, segment,
                archivePathConflict(child, name, 'segment spelling differs'));
        }

        const isLeaf = index === segments.length - 1;
        if (!isLeaf) {
            assert.notStrictEqual(child.explicitType, 'file',
                archivePathConflict(child, name, 'descendant is below a file'));
            child.requiredDirectory = true;
        }
        node = child;
    }

    if (isDirectory) {
        assert.notStrictEqual(node.explicitType, 'file',
            archivePathConflict(node, name, 'directory conflicts with a file'));
        assert.notStrictEqual(node.explicitType, 'directory',
            archivePathConflict(node, name, 'duplicate explicit directory'));
        node.explicitType = 'directory';
        return;
    }

    assert.strictEqual(node.explicitType, undefined,
        archivePathConflict(node, name, 'file conflicts with an explicit entry'));
    assert.ok(!node.requiredDirectory && node.children.size === 0,
        archivePathConflict(node, name, 'file conflicts with existing descendants'));
    node.explicitType = 'file';
}

function archivePathConflict(node, incomingName, reason) {
    const existingName = `${node.logicalPath}${node.explicitType === 'file' ? '' : '/'}`;
    return `case-insensitive VSIX entry alias ${existingName} and ${incomingName} (${reason})`;
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
    assertExactResourceClosure(audit, resources);

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

function assertExactResourceClosure(audit, resources) {
    const prefix = 'extension/resources/';
    const foldedPrefix = prefix.toLocaleLowerCase('en-US');
    const packaged = audit.fileMap
        .map((entry) => entry.path)
        .filter((entry) => entry.toLocaleLowerCase('en-US').startsWith(foldedPrefix))
        .map((entry) => {
            assert.ok(entry.startsWith(prefix),
                `case-insensitive resource path alias ${entry}`);
            return entry.slice(prefix.length);
        });
    const folded = new Map();
    for (const resourcePath of packaged) {
        const key = resourcePath.toLocaleLowerCase('en-US');
        assert.ok(!folded.has(key),
            `case-insensitive resource path alias ${folded.get(key)} and ${resourcePath}`);
        folded.set(key, resourcePath);
    }

    const expected = new Set([...resources.keys(), 'resource-manifest.json']);
    const actual = new Set(packaged);
    const extra = [...actual].filter((entry) => !expected.has(entry)).sort(compareText);
    const missing = [...expected].filter((entry) => !actual.has(entry)).sort(compareText);
    assert.deepStrictEqual({ extra, missing }, { extra: [], missing: [] },
        'resource manifest file set does not match packaged resources');
}

function runArchiveMutationContracts(baseVsix, extensionRoot, tempRoot) {
    const contracts = [
        {
            label: 'unmanifested resource file',
            expected: /resource manifest file set does not match packaged resources/u,
            mutate(zip) {
                zip.addFile('extension/resources/notes.txt',
                    Buffer.from('unmanifested resource\n', 'utf8'));
            },
        },
        {
            label: 'catalog file omitted from resource manifest',
            expected: /resource manifest file set does not match packaged resources/u,
            mutate(zip) {
                const manifest = readZipJson(zip, RESOURCE_MANIFEST);
                const record = requireCatalogManifestRecord(manifest);
                manifest.files = manifest.files.filter((entry) => entry.path !== record.path);
                updateZipJson(zip, RESOURCE_MANIFEST, manifest);
            },
        },
        {
            label: 'case-only resource path alias',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                const manifest = readZipJson(zip, RESOURCE_MANIFEST);
                const record = requireCatalogManifestRecord(manifest);
                const aliasPath = toggleFileNameCase(record.path);
                const archivePath = `extension/resources/${record.path}`;
                const source = zip.getEntry(archivePath);
                assert.ok(source && !source.isDirectory,
                    `mutation source is missing ${archivePath}`);
                zip.addFile(`extension/resources/${aliasPath}`, source.getData());
                manifest.files.push({ ...record, path: aliasPath });
                updateZipJson(zip, RESOURCE_MANIFEST, manifest);
            },
        },
        {
            label: 'repeated archive separator',
            expected: /archive path is not canonical/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension//resources/repeated.txt');
            },
        },
        {
            label: 'leading archive separator',
            expected: /VSIX entry is absolute/u,
            mutate(zip) {
                addRawArchiveEntry(zip, '/extension/resources/leading.txt');
            },
        },
        {
            label: 'trailing separator alias to a file',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, `${RESOURCE_MANIFEST}/`, Buffer.alloc(0));
            },
        },
        {
            label: 'dot archive segment',
            expected: /VSIX entry escapes the archive root/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/./resources/dot.txt');
            },
        },
        {
            label: 'dot-dot archive segment',
            expected: /VSIX entry escapes the archive root/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/resources/../resources/dot-dot.txt');
            },
        },
        {
            label: 'backslash archive alias',
            expected: /VSIX entry uses backslashes/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension\\resources\\backslash.txt');
            },
        },
        {
            label: 'percent-encoded archive ambiguity',
            expected: /VSIX entry uses percent encoding/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/resources/%6eotes.txt');
            },
        },
        {
            label: 'Unicode-normalization archive ambiguity',
            expected: /VSIX entry uses non-canonical Unicode/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/resources/cafe\u0301.txt');
            },
        },
        {
            label: 'case-only non-resource path alias',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                const source = zip.getEntry('extension/package.json');
                assert.ok(source && !source.isDirectory,
                    'mutation source is missing extension/package.json');
                addRawArchiveEntry(zip, 'extension/Package.json', source.getData());
            },
        },
        {
            label: 'case-varied file ancestor before resource descendant',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/Resources');
                addRawArchiveEntry(zip, 'extension/resources/item.txt');
            },
        },
        {
            label: 'resource descendant before case-varied file ancestor',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/resources/item.txt');
                addRawArchiveEntry(zip, 'extension/Resources');
            },
        },
        {
            label: 'case-varied explicit directory aliases an implicit directory',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/Resources/', Buffer.alloc(0));
            },
        },
        {
            label: 'descendant below an existing file',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'a');
                addRawArchiveEntry(zip, 'a/b');
            },
        },
        {
            label: 'file replaces an ancestor required by a descendant',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'b/c');
                addRawArchiveEntry(zip, 'b');
            },
        },
        {
            label: 'nested segment case variants',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/archive-trie/nested/left.txt');
                addRawArchiveEntry(zip, 'extension/archive-trie/Nested/right.txt');
            },
        },
        {
            label: 'case-varied explicit directory variants',
            expected: /case-insensitive VSIX entry alias/u,
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/archive-trie-directory/', Buffer.alloc(0));
                addRawArchiveEntry(zip, 'extension/Archive-Trie-Directory/', Buffer.alloc(0));
            },
        },
    ];
    const failures = [];
    for (const [index, contract] of contracts.entries()) {
        const mutatedVsix = path.join(tempRoot, `archive-mutation-${index}.vsix`);
        const zip = loadWritableZip(baseVsix);
        contract.mutate(zip);
        zip.writeZip(mutatedVsix);
        try {
            assert.throws(
                () => assertVsixContents(auditVsix(mutatedVsix, extensionRoot), extensionRoot),
                contract.expected,
                contract.label,
            );
        } catch (error) {
            failures.push(`${contract.label}: ${error.actual?.message || error.message}`);
        }
    }
    assert.deepStrictEqual(failures, [],
        `VSIX resource mutation contract failure(s):\n${failures.join('\n')}`);

    const acceptedContracts = [
        {
            label: 'canonical directory matching an implicit resource directory',
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/resources/', Buffer.alloc(0));
            },
        },
        {
            label: 'explicit canonical directory before its child',
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/archive-trie/', Buffer.alloc(0));
                addRawArchiveEntry(zip, 'extension/archive-trie/child.txt');
            },
        },
        {
            label: 'explicit canonical directory after its child',
            mutate(zip) {
                addRawArchiveEntry(zip, 'extension/archive-trie-implicit/child.txt');
                addRawArchiveEntry(zip, 'extension/archive-trie-implicit/', Buffer.alloc(0));
            },
        },
    ];
    for (const [index, contract] of acceptedContracts.entries()) {
        const acceptedVsix = path.join(tempRoot, `archive-accepted-${index}.vsix`);
        const zip = loadWritableZip(baseVsix);
        contract.mutate(zip);
        zip.writeZip(acceptedVsix);
        assert.doesNotThrow(
            () => assertVsixContents(auditVsix(acceptedVsix, extensionRoot), extensionRoot),
            `${contract.label} was rejected`,
        );
    }
}

let rawArchiveEntryId = 0;

function addRawArchiveEntry(zip, entryName, contents = Buffer.from('mutation\n', 'utf8')) {
    const seed = `archive-mutation-seed-${rawArchiveEntryId += 1}.tmp`;
    const entry = zip.addFile(seed, contents);
    entry.entryName = entryName;
    return entry;
}

function loadWritableZip(vsixFile) {
    const zip = new AdmZip(vsixFile, { noSort: true });
    for (const entry of zip.getEntries()) {
        if (!entry.isDirectory) entry.setData(entry.getData());
        entry.header.flags_desc = false;
    }
    return zip;
}

function readZipJson(zip, logicalPath) {
    const entry = zip.getEntry(logicalPath);
    assert.ok(entry && !entry.isDirectory, `mutation archive is missing ${logicalPath}`);
    return JSON.parse(entry.getData().toString('utf8'));
}

function updateZipJson(zip, logicalPath, value) {
    zip.updateFile(logicalPath, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8'));
}

function requireCatalogManifestRecord(manifest) {
    assert.ok(Array.isArray(manifest.files), 'mutation manifest has no files array');
    const record = manifest.files.find((entry) => entry.path.startsWith('catalog/')
        && entry.path.endsWith('.json'));
    assert.ok(record, 'mutation manifest has no catalog record');
    return record;
}

function toggleFileNameCase(resourcePath) {
    const slash = resourcePath.lastIndexOf('/');
    const prefix = resourcePath.slice(0, slash + 1);
    const fileName = resourcePath.slice(slash + 1);
    const index = fileName.search(/[A-Za-z]/u);
    assert.notStrictEqual(index, -1,
        `mutation resource filename has no ASCII letter: ${resourcePath}`);
    const character = fileName[index];
    const toggled = character === character.toLocaleLowerCase('en-US')
        ? character.toLocaleUpperCase('en-US')
        : character.toLocaleLowerCase('en-US');
    return `${prefix}${fileName.slice(0, index)}${toggled}${fileName.slice(index + 1)}`;
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
        assert.ok(!name.toLocaleLowerCase('en-US').endsWith('.ts'),
            `VSIX contains TypeScript source or declaration ${name}`);
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
    const guardSource = path.join(options.extensionRoot, 'scripts', 'smoke-network-guard');
    assert.deepStrictEqual(listRelativeFiles(guardSource), [
        'package.json',
        'suite/index.js',
    ], 'installed network guard is missing or contains unexpected checkout files');
    const harnessSource = path.join(options.extensionRoot, 'scripts', 'smoke-extension');
    assert.deepStrictEqual(listRelativeFiles(harnessSource), [
        'package.json',
        'suite/index.js',
    ], 'installed smoke harness is missing or contains unexpected checkout files');

    const guardPackageRoot = path.join(options.tempRoot, 'smoke-network-guard');
    copyExactTree(guardSource, guardPackageRoot);
    const guardVsix = path.join(options.tempRoot, 'smoke-network-guard.vsix');
    await createVSIX({
        allowMissingRepository: true,
        cwd: guardPackageRoot,
        dependencies: false,
        packagePath: guardVsix,
        skipLicense: true,
    });
    requireExactFile(guardVsix, 'packaged network guard extension');

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
    const networkGuardLog = path.join(options.tempRoot, 'network-attempts.log');
    const networkGuardToken = crypto.randomBytes(32).toString('hex');
    const configFile = path.join(workspaceDir, 'all-peripherals.merc32.json');
    fs.copyFileSync(
        path.join(options.extensionRoot, 'scripts', 'fixtures', 'soc',
            'all-peripherals.merc32.json'),
        configFile,
        fs.constants.COPYFILE_EXCL,
    );

    const executable = resolveCachedVSCodeExecutable(options.extensionRoot);
    const guardedEnvironment = offlineEnvironment({
        MERC32_SMOKE_NETWORK_GUARD_LOG: networkGuardLog,
        MERC32_SMOKE_NETWORK_GUARD_TOKEN: networkGuardToken,
    });
    installVsix(executable, options.vsixFile, extensionsDir, userDataDir,
        guardedEnvironment);
    const installedExtension = findInstalledExtension(extensionsDir, EXTENSION_ID);
    installVsix(executable, guardVsix, extensionsDir, userDataDir,
        guardedEnvironment);
    findInstalledExtension(extensionsDir, GUARD_EXTENSION_ID);
    installVsix(executable, harnessVsix, extensionsDir, userDataDir,
        guardedEnvironment);
    const harnessDir = findInstalledExtension(extensionsDir, SMOKE_EXTENSION_ID);
    const harnessManifest = JSON.parse(fs.readFileSync(
        path.join(harnessDir, 'package.json'), 'utf8'));
    assert.deepStrictEqual(harnessManifest.extensionDependencies, [GUARD_EXTENSION_ID],
        'smoke extension must depend only on the installed network guard');

    const outputDir = path.join(workspaceDir, 'generated', 'all_peripherals_soc');
    const resultFile = path.join(options.tempRoot, 'smoke-result.json');
    const launchArgs = [
        workspaceDir,
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        '--new-window',
        '--no-sandbox',
        ...NETWORK_LAUNCH_ARGS,
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
    for (const argument of NETWORK_LAUNCH_ARGS) {
        assert.ok(launchArgs.includes(argument),
            `installed smoke is missing network-denial flag ${argument}`);
    }
    const hostEnvironment = offlineEnvironment({
        MERC32_SMOKE_CONFIG: configFile,
        MERC32_SMOKE_EXTENSIONS_DIR: extensionsDir,
        MERC32_SMOKE_INSTALLED_EXTENSION: installedExtension,
        MERC32_SMOKE_NETWORK_GUARD_LOG: networkGuardLog,
        MERC32_SMOKE_NETWORK_GUARD_TOKEN: networkGuardToken,
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
    assertNoRecordedNetworkAttempts(networkGuardLog, networkGuardToken, [
        'active',
        'after-target',
        'before-target',
        'self-test-complete',
    ]);
    return {
        configFile,
        hostOutput: `${host.stdout || ''}${host.stderr || ''}`,
        outputDir,
        userDataDir,
    };
}

function resolveCachedVSCodeExecutable(extensionRoot) {
    const platform = vscodeCachePlatform();
    const cacheRoot = path.join(
        extensionRoot,
        '.vscode-test',
        `vscode-${platform}-${VSCODE_VERSION}`,
    );
    const executable = process.platform === 'win32'
        ? path.join(cacheRoot, 'Code.exe')
        : process.platform === 'darwin'
            ? path.join(cacheRoot, 'Visual Studio Code.app', 'Contents', 'MacOS', 'Electron')
            : path.join(cacheRoot, 'code');
    try {
        requireExactDirectory(cacheRoot, `cached VSCode ${VSCODE_VERSION} install`);
        requireExactFile(path.join(cacheRoot, 'is-complete'),
            `cached VSCode ${VSCODE_VERSION} completion marker`);
        requireExactFile(executable, `cached VSCode ${VSCODE_VERSION} executable`);
        requireExactFile(resolveCliPathFromVSCodeExecutablePath(executable),
            `cached VSCode ${VSCODE_VERSION} CLI`);
    } catch (error) {
        throw new Error(
            `Cached VSCode ${VSCODE_VERSION} is unavailable at ${cacheRoot}. `
                + 'Run npm run test:extension to bootstrap and verify the Task 6 cache.',
            { cause: error },
        );
    }
    return executable;
}

function vscodeCachePlatform() {
    if (process.platform === 'win32') {
        return process.arch === 'arm64' ? 'win32-arm64-archive' : 'win32-x64-archive';
    }
    if (process.platform === 'darwin') {
        return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin';
    }
    if (process.arch === 'arm64') return 'linux-arm64';
    if (process.arch === 'arm') return 'linux-armhf';
    return 'linux-x64';
}

function installVsix(executable, vsixFile, extensionsDir, userDataDir, environment) {
    const cli = resolveCliPathFromVSCodeExecutablePath(executable);
    requireExactFile(cli, 'cached VSCode CLI');
    const result = spawnSync(cli, [
        '--install-extension', vsixFile,
        '--force',
        `--extensions-dir=${extensionsDir}`,
        `--user-data-dir=${userDataDir}`,
    ], {
        encoding: 'utf8',
        env: environment,
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
    const env = { ...process.env };
    for (const name of [
        'ALL_PROXY', 'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY',
        'all_proxy', 'http_proxy', 'https_proxy', 'no_proxy',
        'npm_config_proxy', 'npm_config_https_proxy',
    ]) delete env[name];
    delete env.NODE_OPTIONS;
    Object.assign(env, additions);
    return env;
}

function assertNoRecordedNetworkAttempts(logFile, expectedToken, requiredHeartbeats = []) {
    const records = readAuthenticatedNetworkGuardRecords(logFile, expectedToken);
    assert.strictEqual(records.filter((record) => record.event === 'installed').length, 1,
        'network guard log must contain exactly one installed record');
    const heartbeats = new Set(records
        .filter((record) => record.event === 'heartbeat')
        .map((record) => record.stage));
    for (const stage of requiredHeartbeats) {
        assert.ok(heartbeats.has(stage),
            `network guard log is missing heartbeat ${stage}`);
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

function readAuthenticatedNetworkGuardRecords(logFile, expectedToken) {
    assert.match(expectedToken, /^[0-9a-f]{64}$/u,
        'expected network guard token is invalid');
    assert.ok(isExactFile(logFile), `network guard log is missing: ${logFile}`);
    const text = fs.readFileSync(logFile, 'utf8');
    assert.ok(text.trim().length > 0, `network guard log is empty: ${logFile}`);
    const lines = text.split(/\r?\n/u);
    if (lines[lines.length - 1] === '') lines.pop();
    assert.ok(lines.every((line) => line.length > 0),
        'network guard log contains an empty record');
    return lines.map((line, index) => {
        let record;
        try {
            record = JSON.parse(line);
        } catch (error) {
            throw new Error(`network guard log record ${index} is invalid JSON`, { cause: error });
        }
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
        if (record.event === 'denied') {
            assert.ok(typeof record.api === 'string' && record.api.length > 0,
                `network guard log record ${index} has an invalid denied API`);
            assert.ok(['runtime', 'self-test'].includes(record.phase),
                `network guard log record ${index} has an invalid denial phase`);
        }
        if (record.event === 'heartbeat') {
            assert.ok(typeof record.stage === 'string' && record.stage.length > 0,
                `network guard log record ${index} has an invalid heartbeat stage`);
        }
        return record;
    });
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

function normalizeArchivePath(value, isDirectory) {
    assert.strictEqual(typeof value, 'string');
    assert.strictEqual(typeof isDirectory, 'boolean');
    assert.ok(value.length > 0, 'VSIX entry path is empty');
    assert.strictEqual(value.normalize('NFC'), value,
        `VSIX entry uses non-canonical Unicode: ${value}`);
    assert.ok(/^[\x20-\x7e]+$/u.test(value),
        `VSIX entry uses non-ASCII characters: ${value}`);
    assert.ok(!value.includes('%'), `VSIX entry uses percent encoding: ${value}`);
    assert.ok(!value.includes('\\'), `VSIX entry uses backslashes: ${value}`);
    assert.ok(!value.startsWith('/') && !/^[A-Za-z]:/u.test(value),
        `VSIX entry is absolute: ${value}`);
    const segments = value.split('/');
    const hasTrailingSeparator = segments[segments.length - 1] === '';
    assert.strictEqual(hasTrailingSeparator, isDirectory,
        `VSIX entry type and trailing separator disagree: ${value}`);
    if (hasTrailingSeparator) segments.pop();
    assert.ok(segments.length > 0 && segments.every((segment) => segment !== ''),
        `VSIX archive path is not canonical: ${value}`);
    assert.ok(segments.every((segment) => segment !== '.' && segment !== '..'),
        `VSIX entry escapes the archive root: ${value}`);
    const canonical = `${segments.join('/')}${isDirectory ? '/' : ''}`;
    assert.strictEqual(canonical, value,
        `VSIX archive path is not canonical: ${value}`);
    return canonical;
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

function requireExactDirectory(target, label) {
    const status = fs.lstatSync(target);
    assert.ok(status.isDirectory() && !status.isSymbolicLink(),
        `${label} is missing or not an exact directory: ${target}`);
    assert.ok(samePath(fs.realpathSync.native(target), target),
        `${label} is linked or redirected: ${target}`);
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
