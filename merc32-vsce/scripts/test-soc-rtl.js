const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { fileURLToPath, pathToFileURL } = require('url');

const {
    generateSoc, loadCatalog, parseSocConfig, planSoc,
    renderSocTop, renderPlbRouter, renderApbInterconnect,
} = require('../out/soc');
const { prepareResources } = require('./prepare-resources');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const extensionRoot = path.resolve(__dirname, '..');
const packagedAssetRoot = path.join(extensionRoot, 'resources');
const fixtureDirectory = path.join(__dirname, 'fixtures', 'soc');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-soc-rtl-'));

const guardedSyncMethods = new Map([
    ['createReadStream', [0]], ['existsSync', [0]], ['linkSync', [0, 1]],
    ['lstatSync', [0]], ['mkdirSync', [0]], ['mkdtempSync', [0]], ['openSync', [0]],
    ['readFileSync', [0]], ['readdirSync', [0]], ['realpathSync', [0]],
    ['renameSync', [0, 1]], ['rmdirSync', [0]], ['rmSync', [0]], ['statSync', [0]],
    ['unlinkSync', [0]], ['writeFileSync', [0]],
]);
const guardedCallbackMethods = new Map([
    ['readFile', [0]], ['writeFile', [0]],
]);
const guardedPromiseMethods = new Map([
    ['open', [0]], ['readFile', [0]], ['writeFile', [0]],
]);
const guardedFileSystemApiTargets = [
    [fs, 'fs', [...guardedSyncMethods.keys(), ...guardedCallbackMethods.keys()]],
    [fs.promises, 'fs.promises', [...guardedPromiseMethods.keys()]],
];

function observableFunctionShape(value) {
    const prototype = Object.getOwnPropertyDescriptor(value, 'prototype');
    const native = Object.getOwnPropertyDescriptor(value, 'native');
    return {
        name: value.name,
        length: value.length,
        prototype: prototype === undefined ? undefined : {
            writable: prototype.writable,
            enumerable: prototype.enumerable,
            configurable: prototype.configurable,
        },
        native: native === undefined ? undefined : {
            writable: native.writable,
            enumerable: native.enumerable,
            configurable: native.configurable,
            function: typeof native.value === 'function'
                ? observableFunctionShape(native.value) : undefined,
        },
    };
}

function snapshotGuardedFileSystemApis() {
    return guardedFileSystemApiTargets.flatMap(([owner, label, methods]) => methods
        .filter((method) => typeof owner[method] === 'function')
        .map((method) => ({
            owner,
            label: `${label}.${method}`,
            method,
            descriptor: Object.getOwnPropertyDescriptor(owner, method),
            shape: observableFunctionShape(owner[method]),
        })));
}

function assertGuardedApiCompatibility(snapshot) {
    const mismatches = [];
    for (const entry of snapshot) {
        try {
            assert.deepStrictEqual(observableFunctionShape(entry.owner[entry.method]), entry.shape);
            const currentDescriptor = Object.getOwnPropertyDescriptor(entry.owner, entry.method);
            assert.deepStrictEqual({
                writable: currentDescriptor.writable,
                enumerable: currentDescriptor.enumerable,
                configurable: currentDescriptor.configurable,
            }, {
                writable: entry.descriptor.writable,
                enumerable: entry.descriptor.enumerable,
                configurable: entry.descriptor.configurable,
            });
        } catch {
            mismatches.push(entry.label);
        }
    }
    assert.deepStrictEqual(mismatches, [],
        `filesystem guard API compatibility mismatches:\n${mismatches.join('\n')}`);
}

function assertGuardedApisRestored(snapshot) {
    const mismatches = [];
    for (const entry of snapshot) {
        try {
            assert.deepStrictEqual(Object.getOwnPropertyDescriptor(entry.owner, entry.method),
                entry.descriptor);
        } catch (error) {
            mismatches.push(`${entry.label}: ${error.message}`);
        }
    }
    assert.deepStrictEqual(mismatches, [],
        `filesystem APIs not restored:\n${mismatches.join('\n')}`);
}

function denyRepositoryRtlAfterPreparation(
    repositoryRtlPath = path.join(repositoryRoot, 'rtl'),
) {
    const repositoryRtlRoot = path.resolve(repositoryRtlPath).toLowerCase();
    const originals = [];
    const normalizeDecodedPath = (value) => {
        if (process.platform !== 'win32') return path.resolve(value).toLowerCase();
        const namespace = value.match(/^[\\/]{2}\?[\\/](.*)$/s);
        if (namespace === null) return path.resolve(value).toLowerCase();
        const payload = namespace[1];
        if (/^[a-z]:[\\/]/i.test(payload)) {
            return path.resolve(payload).toLowerCase();
        }
        const unc = payload.match(/^unc[\\/]([^\\/]+)[\\/]([^\\/]+)(?:[\\/](.*))?$/is);
        if (unc !== null && !['.', '..'].includes(unc[1])
            && !['.', '..'].includes(unc[2])) {
            const remainder = unc[3] === undefined ? '' : `\\${unc[3]}`;
            return path.resolve(`\\\\${unc[1]}\\${unc[2]}${remainder}`).toLowerCase();
        }
        return value.toLowerCase();
    };
    const normalizePathLike = (value, operation) => {
        let decoded;
        if (typeof value === 'string') {
            decoded = value;
        } else if (Buffer.isBuffer(value)) {
            decoded = value.toString('utf8');
        } else if (value instanceof URL) {
            try {
                decoded = fileURLToPath(value);
            } catch {
                return undefined;
            }
        } else {
            return undefined;
        }
        try {
            return normalizeDecodedPath(decoded);
        } catch {
            return undefined;
        }
    };
    const deny = (value, operation) => {
        const normalized = normalizePathLike(value, operation);
        if (normalized !== undefined && (normalized === repositoryRtlRoot
            || normalized.startsWith(`${repositoryRtlRoot}${path.sep}`))) {
            throw new Error(`repository-root RTL ${operation} after preparation: ${value}`);
        }
    };
    const guardArguments = (args, indices, operation) => {
        for (const index of indices) deny(args[index], operation);
    };
    const replace = (owner, method, applyGuard, nativeApplyGuard) => {
        const descriptor = Object.getOwnPropertyDescriptor(owner, method);
        if (descriptor === undefined || typeof descriptor.value !== 'function') return;
        const original = descriptor.value;
        originals.push({ owner, method, descriptor });
        let guardedNative;
        const handler = {
            apply(target, thisArgument, args) {
                return applyGuard(target, thisArgument, args);
            },
        };
        const nativeDescriptor = Object.getOwnPropertyDescriptor(original, 'native');
        if (nativeApplyGuard !== undefined && nativeDescriptor !== undefined
            && typeof nativeDescriptor.value === 'function') {
            guardedNative = new Proxy(nativeDescriptor.value, {
                apply(target, thisArgument, args) {
                    return nativeApplyGuard(target, thisArgument, args);
                },
            });
            handler.get = (target, property, receiver) => property === 'native'
                ? guardedNative : Reflect.get(target, property, receiver);
            handler.getOwnPropertyDescriptor = (target, property) => property === 'native'
                ? { ...nativeDescriptor, value: guardedNative }
                : Reflect.getOwnPropertyDescriptor(target, property);
        }
        Object.defineProperty(owner, method, {
            ...descriptor,
            value: new Proxy(original, handler),
        });
    };
    for (const [method, indices] of guardedSyncMethods) {
        replace(fs, method, (original, thisArgument, args) => {
            guardArguments(args, indices, method);
            return Reflect.apply(original, thisArgument, args);
        }, method === 'realpathSync' ? (original, thisArgument, args) => {
            guardArguments(args, indices, 'realpathSync.native');
            return Reflect.apply(original, thisArgument, args);
        } : undefined);
    }
    for (const [method, indices] of guardedCallbackMethods) {
        replace(fs, method, (original, thisArgument, args) => {
            try {
                guardArguments(args, indices, method);
            } catch (error) {
                const callback = args[args.length - 1];
                if (typeof callback !== 'function') throw error;
                process.nextTick(callback, error);
                return undefined;
            }
            return Reflect.apply(original, thisArgument, args);
        });
    }
    for (const [method, indices] of guardedPromiseMethods) {
        replace(fs.promises, method, (original, thisArgument, args) => {
            try {
                guardArguments(args, indices, `promises.${method}`);
            } catch (error) {
                return Promise.reject(error);
            }
            return Reflect.apply(original, thisArgument, args);
        });
    }
    return () => {
        for (const { owner, method, descriptor } of originals.reverse()) {
            Object.defineProperty(owner, method, descriptor);
        }
    };
}

async function assertRepositoryRtlDenialCoverage() {
    const target = path.join(repositoryRoot, 'rtl', 'cpu', 'core.v');
    const bypasses = [];
    const falseDenials = [];
    const isDenial = (error) => error instanceof Error
        && /repository-root RTL .* after preparation/.test(error.message);
    const expectSynchronousDenial = (label, operation) => {
        try {
            const result = operation();
            if (result && typeof result.destroy === 'function') result.destroy();
            bypasses.push(label);
        } catch (error) {
            if (!isDenial(error)) throw error;
        }
    };
    const expectSynchronousDelegation = (label, operation, expected) => {
        try {
            assert.deepStrictEqual(operation(), expected);
        } catch (error) {
            if (!isDenial(error)) throw error;
            falseDenials.push(label);
        }
    };

    expectSynchronousDenial('fs.readFileSync(string)', () => fs.readFileSync(target));
    expectSynchronousDenial('fs.createReadStream(string)', () => fs.createReadStream(target));
    expectSynchronousDenial('fs.readFileSync(file URL)',
        () => fs.readFileSync(pathToFileURL(target)));
    expectSynchronousDenial('fs.readFileSync(Buffer)',
        () => fs.readFileSync(Buffer.from(target)));
    if (process.platform === 'win32') {
        const extendedTarget = path.toNamespacedPath(target);
        const extendedTargetWithForwardSeparators = extendedTarget.slice(0, 4)
            + extendedTarget.slice(4).replaceAll(path.sep, '/');
        const extendedTargetWithMixedPrefix = extendedTarget.slice(0, 3) + '/'
            + extendedTarget.slice(4).replaceAll(path.sep, '/');
        const extendedTargetWithForwardPrefix = extendedTarget.replaceAll(path.sep, '/');
        expectSynchronousDenial('fs.readFileSync(extended-length string)',
            () => fs.readFileSync(extendedTarget));
        expectSynchronousDenial('fs.readFileSync(extended-length Buffer)',
            () => fs.readFileSync(Buffer.from(extendedTarget)));
        expectSynchronousDenial('fs.readFileSync(extended-length string, forward separators)',
            () => fs.readFileSync(extendedTargetWithForwardSeparators));
        expectSynchronousDenial('fs.readFileSync(extended-length Buffer, forward separators)',
            () => fs.readFileSync(Buffer.from(extendedTargetWithForwardSeparators)));
        expectSynchronousDenial('fs.readFileSync(extended-length string, mixed prefix)',
            () => fs.readFileSync(extendedTargetWithMixedPrefix));
        expectSynchronousDenial('fs.readFileSync(extended-length Buffer, forward prefix)',
            () => fs.readFileSync(Buffer.from(extendedTargetWithForwardPrefix)));

        const unrelatedNamespaces = [
            ['GLOBALROOT traversal', `\\\\?\\GLOBALROOT\\..\\${target}`],
            ['Volume GUID-like traversal',
                `\\\\?\\Volume{00000000-0000-0000-0000-000000000000}\\..\\${target}`],
            ['Device traversal', `\\\\?\\Device\\..\\${target}`],
            ['malformed UNC traversal', `\\\\?\\UNC\\server\\..\\..\\${target}`],
        ];
        for (const [label, candidate] of unrelatedNamespaces) {
            expectSynchronousDelegation(`fs.existsSync(${label})`,
                () => fs.existsSync(candidate), true);
        }

        const uncRepositoryRtlRoot = '\\\\server\\share\\repository\\rtl';
        const extendedUncTarget = '\\\\?\\UNC\\server\\share\\repository\\rtl\\cpu\\core.v';
        const extendedUncTargetWithMixedSeparators = '\\\\?\\UNC/server/share/repository/rtl/cpu/core.v';
        const extendedUncTargetWithForwardPrefix = '//?/UNC/server/share/repository/rtl/cpu/core.v';
        const restoreUncRepositoryRtlAccess = denyRepositoryRtlAfterPreparation(
            uncRepositoryRtlRoot);
        try {
            expectSynchronousDenial('fs.existsSync(extended UNC string)',
                () => fs.existsSync(extendedUncTarget));
            expectSynchronousDenial('fs.existsSync(extended UNC Buffer)',
                () => fs.existsSync(Buffer.from(extendedUncTarget)));
            expectSynchronousDenial('fs.existsSync(extended UNC string, mixed separators)',
                () => fs.existsSync(extendedUncTargetWithMixedSeparators));
            expectSynchronousDenial('fs.existsSync(extended UNC Buffer, forward prefix)',
                () => fs.existsSync(Buffer.from(extendedUncTargetWithForwardPrefix)));
        } finally {
            restoreUncRepositoryRtlAccess();
        }
    }
    expectSynchronousDelegation('fs.existsSync(ordinary non-repository path)',
        () => fs.existsSync(temporaryRoot), true);
    expectSynchronousDenial('fs.linkSync(repository RTL source)',
        () => fs.linkSync(target, path.join(temporaryRoot, 'denied-source-link')));
    expectSynchronousDenial('fs.linkSync(repository RTL destination)',
        () => fs.linkSync(path.join(temporaryRoot, 'missing-link-source'), target));

    const callbackError = await new Promise((resolve) => {
        fs.readFile(target, (error) => resolve(error));
    });
    if (!isDenial(callbackError)) bypasses.push('fs.readFile(callback)');

    try {
        await fs.promises.readFile(target);
        bypasses.push('fs.promises.readFile');
    } catch (error) {
        if (!isDenial(error)) throw error;
    }

    assert.deepStrictEqual({ bypasses, falseDenials }, { bypasses: [], falseDenials: [] },
        `repository RTL guard failures:\n${[
            ...bypasses.map((label) => `bypass: ${label}`),
            ...falseDenials.map((label) => `false denial: ${label}`),
        ].join('\n')}`);
}

async function assertFileSystemContractCompatibility(apiSnapshot) {
    const failures = [];
    const check = async (label, operation) => {
        try {
            await operation();
        } catch (error) {
            failures.push(`${label}: ${error.message}`);
        }
    };
    const compatibilityFile = path.join(temporaryRoot, 'filesystem-contract.txt');
    fs.writeFileSync(compatibilityFile, 'descriptor data');

    await check('fs.readFileSync(numeric fd)', () => {
        const descriptor = fs.openSync(compatibilityFile, 'r');
        try {
            assert.strictEqual(fs.readFileSync(descriptor, 'utf8'), 'descriptor data');
        } finally {
            fs.closeSync(descriptor);
        }
    });
    await check('fs.readFile(callback numeric fd)', async () => {
        const descriptor = fs.openSync(compatibilityFile, 'r');
        try {
            const content = await new Promise((resolve, reject) => {
                fs.readFile(descriptor, 'utf8', (error, value) => {
                    if (error) reject(error);
                    else resolve(value);
                });
            });
            assert.strictEqual(content, 'descriptor data');
        } finally {
            fs.closeSync(descriptor);
        }
    });
    await check('fs.writeFileSync(numeric fd)', () => {
        const descriptor = fs.openSync(compatibilityFile, 'w');
        try {
            fs.writeFileSync(descriptor, 'sync descriptor write');
        } finally {
            fs.closeSync(descriptor);
        }
        assert.strictEqual(fs.readFileSync(compatibilityFile, 'utf8'),
            'sync descriptor write');
    });
    await check('fs.writeFile(callback numeric fd)', async () => {
        const descriptor = fs.openSync(compatibilityFile, 'w');
        try {
            await new Promise((resolve, reject) => {
                fs.writeFile(descriptor, 'callback descriptor write', (error) => {
                    if (error) reject(error);
                    else resolve();
                });
            });
        } finally {
            fs.closeSync(descriptor);
        }
        assert.strictEqual(fs.readFileSync(compatibilityFile, 'utf8'),
            'callback descriptor write');
    });
    await check('fs.promises.readFile(FileHandle)', async () => {
        fs.writeFileSync(compatibilityFile, 'promise descriptor data');
        const handle = await fs.promises.open(compatibilityFile, 'r');
        try {
            assert.strictEqual(await fs.promises.readFile(handle, 'utf8'),
                'promise descriptor data');
        } finally {
            await handle.close();
        }
    });
    await check('fs.promises.writeFile(FileHandle)', async () => {
        const handle = await fs.promises.open(compatibilityFile, 'w');
        try {
            await fs.promises.writeFile(handle, 'promise descriptor write');
        } finally {
            await handle.close();
        }
        assert.strictEqual(fs.readFileSync(compatibilityFile, 'utf8'),
            'promise descriptor write');
    });
    await check('fs.existsSync(unknown object)', () => {
        const previousNoDeprecation = process.noDeprecation;
        process.noDeprecation = true;
        try {
            assert.strictEqual(fs.existsSync({}), false);
        } finally {
            process.noDeprecation = previousNoDeprecation;
        }
    });
    await check('fs.createReadStream(undefined, { fd })', async () => {
        fs.writeFileSync(compatibilityFile, 'stream descriptor data');
        const descriptor = fs.openSync(compatibilityFile, 'r');
        try {
            const stream = fs.createReadStream(undefined, { fd: descriptor, autoClose: false });
            let content = '';
            for await (const chunk of stream) content += chunk;
            assert.strictEqual(content, 'stream descriptor data');
        } finally {
            fs.closeSync(descriptor);
        }
    });
    await check('wrapped API observable properties', () => {
        assertGuardedApiCompatibility(apiSnapshot);
    });

    assert.deepStrictEqual(failures, [],
        `filesystem guard contract regressions:\n${failures.join('\n')}`);
}

const expectedPreparedRtl = [
    'rtl/apb_can/apb_can.v',
    'rtl/apb_gpio/apb_gpio.v',
    'rtl/apb_i2c/apb_i2c.v',
    'rtl/apb_intc/apb_intc.v',
    'rtl/apb_qspi/apb_qspi.v',
    'rtl/apb_sdio/apb_sdio.v',
    'rtl/apb_timer/apb_timer.v',
    'rtl/apb_uart/apb_uart.v',
    'rtl/bridge/lb2apb.v',
    'rtl/bridge/lb2avalon.v',
    'rtl/bridge/lb2axi_lite.v',
    'rtl/bridge/lb2drp.v',
    'rtl/bridge/lb2wbc.v',
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/debug/jtag_debug.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
    'rtl/misc/spram.v',
];

const expectedPreparedResources = [
    ...expectedPreparedRtl,
    'catalog/modules/apb_can.json',
    'catalog/modules/apb_gpio.json',
    'catalog/modules/apb_i2c.json',
    'catalog/modules/apb_intc.json',
    'catalog/modules/apb_qspi.json',
    'catalog/modules/apb_sdio.json',
    'catalog/modules/apb_timer.json',
    'catalog/modules/apb_uart.json',
    'catalog/protocols.json',
    'licenses/LICENSE',
    'schema/merc32.schema.json',
    'templates/README.md.tpl',
    'templates/main.c.tpl',
    'webview/socEditor.css',
    'webview/socEditor.js',
].sort();

function copyLogicalFile(sourceRoot, destinationRoot, logicalPath) {
    const source = path.join(sourceRoot, ...logicalPath.split('/'));
    const destination = path.join(destinationRoot, ...logicalPath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

function makePreparationFixture(name) {
    const root = path.join(temporaryRoot, `prepare-${name}`);
    const sourceRepository = path.join(root, 'repository');
    const extensionRoot = path.join(root, 'merc32-vsce');
    for (const logicalPath of expectedPreparedRtl) {
        copyLogicalFile(repositoryRoot, sourceRepository, logicalPath);
    }
    fs.copyFileSync(path.join(repositoryRoot, 'LICENSE'), path.join(sourceRepository, 'LICENSE'));
    fs.cpSync(path.join(__dirname, '..', 'resources', 'catalog'),
        path.join(extensionRoot, 'resources', 'catalog'), { recursive: true });
    fs.cpSync(path.join(__dirname, '..', 'resources', 'templates'),
        path.join(extensionRoot, 'resources', 'templates'), { recursive: true });
    fs.cpSync(path.join(__dirname, '..', 'resources', 'webview'),
        path.join(extensionRoot, 'resources', 'webview'), { recursive: true });
    fs.mkdirSync(path.join(extensionRoot, 'resources'), { recursive: true });
    fs.writeFileSync(path.join(extensionRoot, 'resources', 'keep.txt'), 'preserve\n');
    return { sourceRepository, extensionRoot };
}

function runPreparationContractTests() {
    const complete = makePreparationFixture('complete');
    const result = prepareResources({
        repositoryRoot: complete.sourceRepository,
        extensionRoot: complete.extensionRoot,
        socApi: require('../out/soc'),
        sourceRevision: 'fixture-revision',
    });
    assert.deepStrictEqual(result.files, expectedPreparedResources,
        'the prepared allowlist must contain every and only required packaged resource');
    assert.ok(result.files.every((logicalPath) => !logicalPath.startsWith('rtl/sim/')),
        'simulation RTL must not enter packaged resources');
    assert.strictEqual(fs.readFileSync(
        path.join(complete.extensionRoot, 'resources', 'keep.txt'), 'utf8'), 'preserve\n',
    'preparation must not delete unrelated resource files or the extension root');
    const manifest = JSON.parse(fs.readFileSync(path.join(
        complete.extensionRoot, 'resources', 'resource-manifest.json'), 'utf8'));
    assert.strictEqual(manifest.sourceRevision, 'fixture-revision');
    assert.deepStrictEqual(manifest.files.map((record) => record.path), expectedPreparedResources);
    for (const record of manifest.files) {
        const resource = fs.readFileSync(path.join(complete.extensionRoot, 'resources',
            ...record.path.split('/')));
        assert.strictEqual(record.sha256,
            crypto.createHash('sha256').update(resource).digest('hex'),
        `resource manifest hash mismatch for ${record.path}`);
    }
    const preparedCatalog = require('../out/soc').loadCatalog(
        path.join(complete.extensionRoot, 'resources'));
    assert.strictEqual(fs.readFileSync(path.join(complete.extensionRoot, 'resources',
        'schema', 'merc32.schema.json'), 'utf8'),
    `${JSON.stringify(require('../out/soc').generateSocSchema(preparedCatalog), null, 2)}\n`,
    'preparation must regenerate the schema from the prepared catalog');

    const missing = makePreparationFixture('missing');
    fs.unlinkSync(path.join(missing.sourceRepository, 'rtl', 'misc', 'mul.v'));
    assert.throws(() => prepareResources({
        repositoryRoot: missing.sourceRepository,
        extensionRoot: missing.extensionRoot,
        socApi: require('../out/soc'),
        sourceRevision: 'fixture-revision',
    }), /Missing resource.*rtl\/misc\/mul\.v/);

    const wrongCase = makePreparationFixture('wrong-case');
    const descriptorFile = path.join(wrongCase.extensionRoot, 'resources',
        'catalog', 'modules', 'apb_uart.json');
    const descriptor = JSON.parse(fs.readFileSync(descriptorFile, 'utf8'));
    descriptor.rtlFiles = ['rtl/APB_UART/apb_uart.v'];
    fs.writeFileSync(descriptorFile, `${JSON.stringify(descriptor, null, 2)}\n`);
    assert.throws(() => prepareResources({
        repositoryRoot: wrongCase.sourceRepository,
        extensionRoot: wrongCase.extensionRoot,
        socApi: require('../out/soc'),
        sourceRevision: 'fixture-revision',
    }), /Case mismatch.*rtl\/APB_UART\/apb_uart\.v/);
    console.log(`MERC32 resource preparation contract passed (${result.files.length} files).`);
}

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
}

function withProject(config, name) {
    return {
        ...config,
        project: { name: `${name}_soc`, outputDir: `generated/${name}_soc` },
    };
}

function listVerilogFiles(root, relative = '') {
    const directory = path.join(root, relative);
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) {
            result.push(...listVerilogFiles(root, child));
        } else if (entry.name.endsWith('.v')) {
            result.push(child.replace(/\\/g, '/'));
        }
    }
    return result.sort();
}

function assembleAndElaborate(name, config) {
    const projectRoot = path.join(temporaryRoot, name);
    const sourceFile = path.join(projectRoot, `${name}.merc32.json`);
    fs.mkdirSync(projectRoot, { recursive: true });
    const generatedConfig = {
        ...config,
        project: { ...config.project, outputDir: 'generated' },
    };
    fs.writeFileSync(sourceFile, `${JSON.stringify(generatedConfig, null, 2)}\n`);
    if (generatedConfig.memory.ilb.initFile !== undefined) {
        const initFile = path.join(projectRoot, generatedConfig.memory.ilb.initFile);
        fs.mkdirSync(path.dirname(initFile), { recursive: true });
        fs.writeFileSync(initFile, '00000013\n');
    }
    if (generatedConfig.memory.dlb.initFile !== undefined) {
        const initFile = path.join(projectRoot, generatedConfig.memory.dlb.initFile);
        fs.mkdirSync(path.dirname(initFile), { recursive: true });
        fs.writeFileSync(initFile, '00000000\n');
    }
    const generationResult = generateSoc({
        configFile: sourceFile,
        assetRoot: packagedAssetRoot,
    });

    const rtlDirectory = path.join(generationResult.outputDir, 'rtl');
    const normalizedList = fs.readFileSync(path.join(rtlDirectory, 'files.f'), 'utf8')
        .trim().split(/\r?\n/).filter(Boolean).sort();
    assert.deepStrictEqual(listVerilogFiles(rtlDirectory), normalizedList,
        `${name}: generated files.f must name every and only generated Verilog file`);

    const outputFile = path.join(temporaryRoot, name, 'soc.vvp');
    const args = [
        '-Wall', '-Wno-timescale', '-g2005',
        '-s', generatedConfig.project.name,
        '-o', outputFile,
        '-f', 'files.f',
    ];
    assert.deepStrictEqual(args.filter((argument) => argument.endsWith('.v')), [],
        `${name}: elaboration source files must come only from files.f`);
    const compile = spawnSync('iverilog', args, { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(compile.status, 0,
        `${name}: iverilog failed\nstdout:\n${compile.stdout}\nstderr:\n${compile.stderr}`);
    assert.strictEqual(compile.stderr, '', `${name}: iverilog warnings:\n${compile.stderr}`);
    assert.ok(fs.existsSync(outputFile), `${name}: iverilog produced no output`);
    console.log(`  ${name}: ${normalizedList.length} files via rtl/files.f`);
    return { rtlDirectory, topModule: generatedConfig.project.name };
}

function assertRejectedBeforeEmission(name, config, catalog, code, expectedPath) {
    const sourceFile = path.join(fixtureDirectory, `${name}.merc32.json`);
    const parsed = parseSocConfig(`${JSON.stringify(config, null, 2)}\n`, sourceFile, catalog);
    assert.ok(parsed.config, `${name} parse failed:\n${JSON.stringify(parsed.diagnostics, null, 2)}`);
    const planned = planSoc(parsed.config, catalog);
    assert.strictEqual(planned.plan, undefined, `${name} unexpectedly produced an RTL plan`);
    assert.ok(planned.diagnostics.some((diagnostic) => diagnostic.code === code
        && JSON.stringify(diagnostic.path) === JSON.stringify(expectedPath)),
        `${name} missing ${code} at ${JSON.stringify(expectedPath)}:\n${JSON.stringify(planned.diagnostics, null, 2)}`);
    assert.strictEqual(fs.existsSync(path.join(temporaryRoot, name)), false,
        `${name} created RTL output before validation completed`);
}

function simulateStatefulRouter() {
    const directory = path.join(temporaryRoot, 'router_behavior');
    fs.mkdirSync(directory, { recursive: true });
    const plan = {
        topModule: 'router_behavior',
        endpoints: [
            { name: 'target_a', baseAddress: 0x10000000n, endAddress: 0x10000fffn },
            { name: 'target_b', baseAddress: 0x20000000n, endAddress: 0x20000fffn },
        ],
    };
    fs.writeFileSync(path.join(directory, 'router.v'), renderPlbRouter(plan));
    fs.writeFileSync(path.join(directory, 'router_tb.v'), `
module router_behavior_tb;
reg clk;
reg rst_n;
reg m_rden;
reg m_wren;
reg [31:0] m_addr;
reg [3:0] m_strb;
reg [31:0] m_wdata;
wire [31:0] m_rdata;
wire m_ack;
wire target_a_rden;
wire target_a_wren;
wire [31:0] target_a_addr;
wire [3:0] target_a_strb;
wire [31:0] target_a_wdata;
reg [31:0] target_a_rdata;
reg target_a_ack;
wire target_b_rden;
wire target_b_wren;
wire [31:0] target_b_addr;
wire [3:0] target_b_strb;
wire [31:0] target_b_wdata;
reg [31:0] target_b_rdata;
reg target_b_ack;

router_behavior_plb_router dut (
    .clk(clk), .rst_n(rst_n),
    .m_rden(m_rden), .m_wren(m_wren), .m_addr(m_addr),
    .m_strb(m_strb), .m_wdata(m_wdata), .m_rdata(m_rdata), .m_ack(m_ack),
    .target_a_rden(target_a_rden), .target_a_wren(target_a_wren),
    .target_a_addr(target_a_addr), .target_a_strb(target_a_strb),
    .target_a_wdata(target_a_wdata), .target_a_rdata(target_a_rdata),
    .target_a_ack(target_a_ack),
    .target_b_rden(target_b_rden), .target_b_wren(target_b_wren),
    .target_b_addr(target_b_addr), .target_b_strb(target_b_strb),
    .target_b_wdata(target_b_wdata), .target_b_rdata(target_b_rdata),
    .target_b_ack(target_b_ack)
);

always #5 clk = ~clk;

initial begin
    clk = 1'b0;
    rst_n = 1'b0;
    m_rden = 1'b0;
    m_wren = 1'b0;
    m_addr = 32'b0;
    m_strb = 4'hf;
    m_wdata = 32'h1234_5678;
    target_a_rdata = 32'haaaa_5555;
    target_a_ack = 1'b0;
    target_b_rdata = 32'hbbbb_6666;
    target_b_ack = 1'b0;

    repeat (2) @(posedge clk);
    rst_n = 1'b1;
    @(negedge clk);
    m_addr = 32'h1000_0040;
    m_rden = 1'b1;
    #1;
    if (!target_a_rden || target_b_rden || m_ack) $fatal(1, "target A request decode failed");
    @(posedge clk);
    #1;
    m_rden = 1'b0;
    m_addr = 32'h2000_0040;
    #1;
    if (target_a_rden || target_b_rden || m_ack) $fatal(1, "request was forwarded more than once");

    repeat (2) @(posedge clk);
    @(negedge clk);
    target_a_ack = 1'b1;
    #1;
    if (!m_ack || m_rdata !== 32'haaaa_5555) $fatal(1, "active target A response was not held");
    if (target_b_ack && m_rdata === 32'hbbbb_6666) $fatal(1, "target B stole the active response");
    @(posedge clk);
    #1;
    target_a_ack = 1'b0;

    @(negedge clk);
    m_addr = 32'h2000_0004;
    m_wren = 1'b1;
    #1;
    if (!target_b_wren || target_a_wren) $fatal(1, "target B write decode failed");
    @(posedge clk);
    #1;
    m_wren = 1'b0;
    @(negedge clk);
    target_b_ack = 1'b1;
    #1;
    if (!m_ack || m_rdata !== 32'hbbbb_6666) $fatal(1, "target B response failed");
    @(posedge clk);
    #1;
    target_b_ack = 1'b0;

    @(negedge clk);
    m_addr = 32'h3000_0000;
    m_rden = 1'b1;
    #1;
    if (target_a_rden || target_b_rden || m_ack) $fatal(1, "unmapped request was acknowledged");
    m_rden = 1'b0;
    $display("router_stateful_behavior: PASS");
    $finish;
end
endmodule
`);
    const compile = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005', '-s', 'router_behavior_tb',
        '-o', 'router.vvp', 'router.v', 'router_tb.v',
    ], { cwd: directory, encoding: 'utf8' });
    assert.strictEqual(compile.status, 0,
        `router behavior compile failed:\n${compile.stdout}\n${compile.stderr}`);
    assert.strictEqual(compile.stderr, '', `router behavior warnings:\n${compile.stderr}`);
    const simulation = spawnSync('vvp', ['router.vvp'], { cwd: directory, encoding: 'utf8' });
    assert.strictEqual(simulation.status, 0,
        `router behavior simulation failed:\n${simulation.stdout}\n${simulation.stderr}`);
    assert.match(simulation.stdout, /router_stateful_behavior: PASS/);
    console.log('  router_stateful_behavior: simulated');
}

function simulateExternalIrqReset(catalog) {
    const config = {
        schemaVersion: 1,
        project: { name: 'irq_reset_soc', outputDir: 'generated/irq_reset_soc' },
        cpu: { debug: false },
        memory: {
            ilb: { type: 'external_local_bus', size: '32KiB' },
            dlb: { type: 'external_local_bus', size: '64KiB' },
        },
        peripherals: [{
            type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000',
        }],
        externalInterfaces: [],
        interrupt: {
            mode: 'controller', controller: 'intc0', sources: [
                { source: 'external.active_low', id: 0, trigger: 'low' },
                { source: 'external.rise', id: 1, trigger: 'rising' },
                { source: 'external.fall', id: 2, trigger: 'falling' },
                { source: 'external.high', id: 3, trigger: 'high' },
            ],
        },
    };
    const { rtlDirectory } = assembleAndElaborate('external_irq_reset', config);
    fs.writeFileSync(path.join(rtlDirectory, 'irq_reset_tb.v'), `
module irq_reset_tb;
reg clk;
reg rst_n;
wire ilb_rden;
wire ilb_wren;
wire [12:0] ilb_addr;
wire [3:0] ilb_strb;
wire [31:0] ilb_wdata;
reg [31:0] ilb_rdata;
reg ilb_ack;
wire dlb_rden;
wire dlb_wren;
wire [13:0] dlb_addr;
wire [3:0] dlb_strb;
wire [31:0] dlb_wdata;
reg [31:0] dlb_rdata;
reg dlb_ack;
reg external_active_low;
reg external_rise;
reg external_fall;
reg external_high;

irq_reset_soc dut (
    .clk(clk), .rst_n(rst_n),
    .ilb_rden(ilb_rden), .ilb_wren(ilb_wren), .ilb_addr(ilb_addr),
    .ilb_strb(ilb_strb), .ilb_wdata(ilb_wdata),
    .ilb_rdata(ilb_rdata), .ilb_ack(ilb_ack),
    .dlb_rden(dlb_rden), .dlb_wren(dlb_wren), .dlb_addr(dlb_addr),
    .dlb_strb(dlb_strb), .dlb_wdata(dlb_wdata),
    .dlb_rdata(dlb_rdata), .dlb_ack(dlb_ack),
    .external_active_low(external_active_low),
    .external_rise(external_rise),
    .external_fall(external_fall),
    .external_high(external_high)
);

always #5 clk = ~clk;

task expect_sources;
    input [3:0] expected;
    begin
        if (dut.intc0_irq_sources !== expected) begin
            $display("IRQ SOURCE FAIL expected=%b actual=%b", expected, dut.intc0_irq_sources);
            $finish(1);
        end
    end
endtask

initial begin
    clk = 1'b0;
    rst_n = 1'b0;
    ilb_rdata = 32'b0;
    ilb_ack = 1'b0;
    dlb_rdata = 32'b0;
    dlb_ack = 1'b0;
    external_active_low = 1'b1;
    external_rise = 1'b1;
    external_fall = 1'b0;
    external_high = 1'b0;

    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);
    @(negedge clk);
    rst_n = 1'b1;
    repeat (4) begin
        @(posedge clk);
        #1 expect_sources(4'b0101);
    end

    @(negedge clk);
    external_active_low = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0100);
    @(negedge clk);
    external_active_low = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);

    @(negedge clk);
    external_rise = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);
    @(negedge clk);
    external_rise = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0111);
    @(negedge clk);
    external_rise = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);

    @(negedge clk);
    external_fall = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);
    @(negedge clk);
    external_fall = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0001);

    @(negedge clk);
    external_high = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b1001);

    $display("external_irq_reset_behavior: PASS");
    $finish;
end
endmodule
`);
    const compile = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005', '-s', 'irq_reset_tb',
        '-o', 'irq_reset.vvp', '-f', 'files.f', 'irq_reset_tb.v',
    ], { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(compile.status, 0,
        `external IRQ reset compile failed:\n${compile.stdout}\n${compile.stderr}`);
    assert.strictEqual(compile.stderr, '', `external IRQ reset warnings:\n${compile.stderr}`);
    const simulation = spawnSync('vvp', ['irq_reset.vvp'],
        { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(simulation.status, 0,
        `external IRQ reset simulation failed:\n${simulation.stdout}\n${simulation.stderr}`);
    assert.match(simulation.stdout, /external_irq_reset_behavior: PASS/);
    console.log('  external_irq_reset_behavior: simulated');
}

function simulateSingleSourceController() {
    const config = {
        schemaVersion: 1,
        project: { name: 'single_irq_soc', outputDir: 'generated/single_irq_soc' },
        cpu: { debug: false },
        memory: {
            ilb: { type: 'external_local_bus', size: '32KiB' },
            dlb: { type: 'external_local_bus', size: '64KiB' },
        },
        peripherals: [{
            type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000',
        }],
        externalInterfaces: [],
        interrupt: {
            mode: 'controller', controller: 'intc0', sources: [
                { source: 'external.only', id: 0, trigger: 'high' },
            ],
        },
    };
    const { rtlDirectory } = assembleAndElaborate('single_source_controller_behavior', config);
    fs.writeFileSync(path.join(rtlDirectory, 'single_irq_tb.v'), `
module single_irq_tb;
reg clk;
reg rst_n;
wire ilb_rden;
wire ilb_wren;
wire [12:0] ilb_addr;
wire [3:0] ilb_strb;
wire [31:0] ilb_wdata;
reg [31:0] ilb_rdata;
reg ilb_ack;
wire dlb_rden;
wire dlb_wren;
wire [13:0] dlb_addr;
wire [3:0] dlb_strb;
wire [31:0] dlb_wdata;
reg [31:0] dlb_rdata;
reg dlb_ack;
reg external_only;

single_irq_soc dut (
    .clk(clk), .rst_n(rst_n),
    .ilb_rden(ilb_rden), .ilb_wren(ilb_wren), .ilb_addr(ilb_addr),
    .ilb_strb(ilb_strb), .ilb_wdata(ilb_wdata),
    .ilb_rdata(ilb_rdata), .ilb_ack(ilb_ack),
    .dlb_rden(dlb_rden), .dlb_wren(dlb_wren), .dlb_addr(dlb_addr),
    .dlb_strb(dlb_strb), .dlb_wdata(dlb_wdata),
    .dlb_rdata(dlb_rdata), .dlb_ack(dlb_ack),
    .external_only(external_only)
);

always #5 clk = ~clk;

task intc_enable_source_zero;
    begin
        @(negedge clk);
        force dut.intc0_psel = 1'b1;
        force dut.builtin_apb_penable = 1'b1;
        force dut.builtin_apb_pwrite = 1'b1;
        force dut.builtin_apb_paddr = 32'h0000_0008;
        force dut.builtin_apb_pwdata = 32'h0000_0001;
        force dut.builtin_apb_pstrb = 4'hf;
        @(posedge clk);
        #1;
        @(negedge clk);
        release dut.intc0_psel;
        release dut.builtin_apb_penable;
        release dut.builtin_apb_pwrite;
        release dut.builtin_apb_paddr;
        release dut.builtin_apb_pwdata;
        release dut.builtin_apb_pstrb;
    end
endtask

task intc_clear_source_zero;
    begin
        @(negedge clk);
        force dut.intc0_psel = 1'b1;
        force dut.builtin_apb_penable = 1'b1;
        force dut.builtin_apb_pwrite = 1'b1;
        force dut.builtin_apb_paddr = 32'h0000_0018;
        force dut.builtin_apb_pwdata = 32'h0000_0001;
        force dut.builtin_apb_pstrb = 4'hf;
        @(posedge clk);
        #1;
        @(negedge clk);
        release dut.intc0_psel;
        release dut.builtin_apb_penable;
        release dut.builtin_apb_pwrite;
        release dut.builtin_apb_paddr;
        release dut.builtin_apb_pwdata;
        release dut.builtin_apb_pstrb;
    end
endtask

initial begin
    clk = 1'b0;
    rst_n = 1'b0;
    ilb_rdata = 32'b0;
    ilb_ack = 1'b0;
    dlb_rdata = 32'b0;
    dlb_ack = 1'b0;
    external_only = 1'b0;

    repeat (3) @(posedge clk);
    #1;
    if (dut.intc0_irq_sources !== 1'b0) $fatal(1, "reset source state was not inactive");
    @(negedge clk);
    rst_n = 1'b1;
    external_only = 1'b1;
    repeat (3) @(posedge clk);
    #1;
    if (dut.intc0_irq_sources !== 1'b1) $fatal(1, "single source was not conditioned high");
    intc_enable_source_zero();
    #1;
    if (dut.intc0_interrupt !== 1'b1) $fatal(1, "enabled source did not assert controller IRQ");
    @(negedge clk);
    external_only = 1'b0;
    repeat (3) @(posedge clk);
    #1;
    if (dut.intc0_irq_sources !== 1'b0) $fatal(1, "single source was not conditioned low");
    if (dut.intc0_interrupt !== 1'b1) $fatal(1, "pending controller IRQ did not remain asserted");
    intc_clear_source_zero();
    #1;
    if (dut.intc0_interrupt !== 1'b0) $fatal(1, "cleared inactive source left IRQ asserted");

    $display("single_source_controller_behavior: PASS");
    $finish;
end
endmodule
`);
    const compile = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005', '-s', 'single_irq_tb',
        '-o', 'single_irq.vvp', '-f', 'files.f', 'single_irq_tb.v',
    ], { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(compile.status, 0,
        `single-source controller compile failed:\n${compile.stdout}\n${compile.stderr}`);
    assert.strictEqual(compile.stderr, '',
        `single-source controller warnings:\n${compile.stderr}`);
    const simulation = spawnSync('vvp', ['single_irq.vvp'],
        { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(simulation.status, 0,
        `single-source controller simulation failed:\n${simulation.stdout}\n${simulation.stderr}`);
    assert.match(simulation.stdout, /single_source_controller_behavior: PASS/);
    console.log('  single_source_controller_behavior: simulated');
}

async function run() {
    const guardedApiSnapshot = snapshotGuardedFileSystemApis();
    let restoreRepositoryRtlAccess = () => {};
    try {
        runPreparationContractTests();
        prepareResources();
        restoreRepositoryRtlAccess = denyRepositoryRtlAfterPreparation();
        await assertRepositoryRtlDenialCoverage();
        await assertFileSystemContractCompatibility(guardedApiSnapshot);
        const catalog = loadCatalog(packagedAssetRoot);
        const minimal = readFixture('minimal.merc32.json');
        const multi = readFixture('multi-peripheral.merc32.json');
        const all = readFixture('all-peripherals.merc32.json');

    const internal = withProject(clone(minimal), 'internal_memories');
    internal.memory.ilb = { type: 'internal_ram', size: '32KiB' };
    internal.memory.dlb = { type: 'internal_ram', size: '64KiB' };

    const repeated = withProject(clone(minimal), 'multiple_apb_instances');
    repeated.peripherals = [
        { type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000' },
        { type: 'apb_uart', name: 'uart1', baseAddress: '0x10001000' },
    ];
    repeated.interrupt = { mode: 'direct', source: 'uart1.interrupt' };

    const protocols = withProject(clone(minimal), 'simultaneous_protocols');
    protocols.externalInterfaces = all.externalInterfaces;

    const widths = withProject(clone(minimal), 'downstream_address_widths');
    widths.externalInterfaces = [
        {
            type: 'apb', name: 'apb12', baseAddress: '0x20000000',
            windowSize: '4KiB', addressWidth: 12,
        },
        {
            type: 'axi4_lite', name: 'axi32', baseAddress: '0x21000000',
            windowSize: '16MiB', addressWidth: 32,
        },
    ];

    const debugOff = withProject(clone(multi), 'debug_disabled');
    debugOff.cpu.debug = false;

    const nearCollisions = clone(minimal);
    nearCollisions.project = { name: 'module_soc', outputDir: 'generated/module_soc' };
    nearCollisions.peripherals = [{
        type: 'apb_intc', name: 'cpu0', baseAddress: '0x10000000',
    }];
    nearCollisions.externalInterfaces = [{
        type: 'local_bus', name: 'm0', baseAddress: '0x10001000',
        windowSize: '4KiB', addressWidth: 32,
    }];
    nearCollisions.interrupt = {
        mode: 'controller', controller: 'cpu0', sources: [
            { source: 'external.foo', id: 0, trigger: 'high' },
            { source: 'external.foo_sync0', id: 1, trigger: 'low' },
        ],
    };

    const singleSourceController = withProject(clone(minimal), 'single_source_controller');
    singleSourceController.peripherals = [{
        type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000',
    }];
    singleSourceController.interrupt = {
        mode: 'controller', controller: 'intc0', sources: [
            { source: 'external.only', id: 0, trigger: 'high' },
        ],
    };

    const reservedProject = clone(minimal);
    reservedProject.project.name = 'module';
    assertRejectedBeforeEmission('reserved_project_name', reservedProject, catalog,
        'SOC_VERILOG_RESERVED', ['project', 'name']);

    const packagedModuleProject = clone(minimal);
    packagedModuleProject.project.name = 'MERC32_top';
    assertRejectedBeforeEmission('packaged_module_project_name', packagedModuleProject, catalog,
        'SOC_VERILOG_MODULE_COLLISION', ['project', 'name']);

    const routerMasterCollision = clone(minimal);
    routerMasterCollision.externalInterfaces = [{
        type: 'local_bus', name: 'm', baseAddress: '0x10000000',
        windowSize: '4KiB', addressWidth: 32,
    }];
    assertRejectedBeforeEmission('router_master_symbol_collision', routerMasterCollision, catalog,
        'SOC_VERILOG_SYMBOL_COLLISION', ['externalInterfaces', 0, 'name']);

    const cpuInstanceCollision = clone(minimal);
    cpuInstanceCollision.peripherals = [{
        type: 'apb_uart', name: 'cpu', baseAddress: '0x10000000',
    }];
    assertRejectedBeforeEmission('cpu_instance_symbol_collision', cpuInstanceCollision, catalog,
        'SOC_VERILOG_SYMBOL_COLLISION', ['peripherals', 0, 'name']);

    const synchronizerCollision = clone(minimal);
    synchronizerCollision.peripherals = [{
        type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000',
    }];
    synchronizerCollision.interrupt = {
        mode: 'controller', controller: 'intc0', sources: [
            { source: 'external.foo', id: 0, trigger: 'high' },
            { source: 'external.foo_sync', id: 1, trigger: 'low' },
        ],
    };
    assertRejectedBeforeEmission('synchronizer_symbol_collision', synchronizerCollision, catalog,
        'SOC_VERILOG_SYMBOL_COLLISION', ['interrupt', 'sources', 1, 'source']);

    const generatedModuleDescriptors = new Map(catalog.modules);
    generatedModuleDescriptors.set('collision_fixture', {
        ...catalog.modules.get('apb_uart'),
        type: 'collision_fixture',
        module: 'minimal_soc_plb_router',
    });
    generatedModuleDescriptors.set('apb_collision_fixture', {
        ...catalog.modules.get('apb_uart'),
        type: 'apb_collision_fixture',
        module: 'generated_apb_soc_apb_interconnect',
    });
    const generatedModuleCatalog = {
        modules: generatedModuleDescriptors,
        protocols: catalog.protocols,
    };
    assertRejectedBeforeEmission('generated_module_name_collision', minimal,
        generatedModuleCatalog, 'SOC_VERILOG_MODULE_COLLISION', ['project', 'name']);

    const generatedApbNameCollision = clone(minimal);
    generatedApbNameCollision.project.name = 'generated_apb_soc';
    generatedApbNameCollision.peripherals = [{
        type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000',
    }];
    assertRejectedBeforeEmission('generated_apb_module_name_collision',
        generatedApbNameCollision, generatedModuleCatalog,
        'SOC_VERILOG_MODULE_COLLISION', ['project', 'name']);

    const matrix = [
        ['minimal_external_memory_no_irq', withProject(clone(minimal), 'minimal_external_memory_no_irq')],
        ['internal_memories', internal],
        ['multiple_apb_instances', repeated],
        ['controller_mode', withProject(clone(multi), 'controller_mode')],
        ['single_source_controller', singleSourceController],
        ['simultaneous_protocols', protocols],
        ['downstream_address_widths', widths],
        ['debug_disabled', debugOff],
        ['all_bundled_peripherals', all],
        ['collision_adjacent_names', nearCollisions],
    ];
    console.log('MERC32 generated RTL matrix:');
    for (const [name, config] of matrix) {
        assembleAndElaborate(name, config);
    }
    simulateStatefulRouter();
    simulateExternalIrqReset(catalog);
    simulateSingleSourceController();
        console.log('MERC32 generated RTL matrix passed.');
    } finally {
        restoreRepositoryRtlAccess();
        try {
            assertGuardedApisRestored(guardedApiSnapshot);
        } finally {
            fs.rmSync(temporaryRoot, { recursive: true, force: true });
        }
    }
}

run().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
