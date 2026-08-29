const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const soc = require('../out/soc');
const { compileCFile } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

assert.strictEqual(typeof soc.renderSocTop, 'function',
    'renderSocTop must be exported from the SoC package');
assert.strictEqual(typeof soc.renderPlbRouter, 'function',
    'renderPlbRouter must be exported from the SoC package');
assert.strictEqual(typeof soc.renderApbInterconnect, 'function',
    'renderApbInterconnect must be exported from the SoC package');
assert.strictEqual(typeof soc.renderResolvedConfig, 'function',
    'renderResolvedConfig must be exported from the SoC package');
assert.strictEqual(typeof soc.renderAddressMap, 'function',
    'renderAddressMap must be exported from the SoC package');
assert.strictEqual(typeof soc.renderSocHeader, 'function',
    'renderSocHeader must be exported from the SoC package');
assert.strictEqual(typeof soc.renderGeneratedReadme, 'function',
    'renderGeneratedReadme must be exported from the SoC package');
assert.strictEqual(typeof soc.renderStarterMain, 'function',
    'renderStarterMain must be exported from the SoC package');
assert.strictEqual(typeof soc.generateSoc, 'function',
    'generateSoc must be exported from the SoC package');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const fixtureDirectory = path.join(__dirname, 'fixtures', 'soc');
const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-emitter-assets-'));

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function planFixture(config, fileName) {
    const text = `${JSON.stringify(config, null, 2)}\n`;
    const parsed = soc.parseSocConfig(text, path.join(fixtureDirectory, fileName), catalog);
    assert.ok(parsed.config, JSON.stringify(parsed.diagnostics, null, 2));
    const result = soc.planSoc(parsed.config, catalog);
    assert.ok(result.plan, JSON.stringify(result.diagnostics, null, 2));
    return result.plan;
}

function assertSortedObjectKeys(value) {
    if (Array.isArray(value)) {
        value.forEach(assertSortedObjectKeys);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    const keys = Object.keys(value);
    assert.deepStrictEqual(keys, [...keys].sort(), `generated object keys must be sorted: ${keys}`);
    Object.values(value).forEach(assertSortedObjectKeys);
}

function writeFile(file, content) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function writeGenerationConfig(directory, fileName, projectName, outputDir, transform = (value) => value) {
    const config = transform({
        schemaVersion: 1,
        project: { name: projectName, outputDir },
        cpu: { debug: false },
        memory: {
            ilb: { type: 'external_local_bus', size: '32KiB' },
            dlb: { type: 'external_local_bus', size: '64KiB' },
        },
        peripherals: [],
        externalInterfaces: [],
        interrupt: { mode: 'none' },
    });
    const file = path.join(directory, fileName);
    writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
    return file;
}

function prepareGenerationAssets(root, resourceRevision = 'test-resource-revision') {
    fs.cpSync(path.join(__dirname, '..', 'resources', 'catalog'),
        path.join(root, 'catalog'), { recursive: true });
    fs.cpSync(path.join(__dirname, '..', 'resources', 'templates'),
        path.join(root, 'templates'), { recursive: true });
    fs.appendFileSync(path.join(root, 'templates', 'README.md.tpl'), '\nAsset README template.\n');
    fs.appendFileSync(path.join(root, 'templates', 'main.c.tpl'), '\n/* asset main template */\n');
    for (const logicalPath of [
        'rtl/cpu/MERC32_top.v', 'rtl/cpu/core.v',
        'rtl/misc/div.v', 'rtl/misc/mul.v', 'rtl/misc/spram.v',
        'rtl/debug/jtag_debug.v', 'rtl/bridge/lb2apb.v',
        ...fs.readdirSync(path.join(__dirname, '..', 'resources', 'catalog', 'modules'))
            .map((file) => JSON.parse(fs.readFileSync(path.join(
                __dirname, '..', 'resources', 'catalog', 'modules', file), 'utf8')))
            .flatMap((descriptor) => descriptor.rtlFiles),
        ...JSON.parse(fs.readFileSync(path.join(
            __dirname, '..', 'resources', 'catalog', 'protocols.json'), 'utf8'))
            .flatMap((descriptor) => descriptor.rtlFiles),
    ]) {
        writeFile(path.join(root, ...logicalPath.split('/')),
            `opaque ${logicalPath}\n`);
    }
    writeFile(path.join(root, 'licenses', 'LICENSE'), 'opaque generator license\n');
    writeFile(path.join(root, 'resource-manifest.json'), `${JSON.stringify({
        resourceRevision,
    }, null, 2)}\n`);
}

function readManifest(outputDir) {
    return JSON.parse(fs.readFileSync(path.join(outputDir, 'manifest.json'), 'utf8'));
}

function snapshotDirectory(root, relative = '') {
    if (!fs.existsSync(root)) return [];
    const directory = path.join(root, relative);
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name))) {
        const child = path.join(relative, entry.name);
        const childPath = path.join(root, child);
        const status = fs.lstatSync(childPath);
        if (status.isSymbolicLink()) {
            result.push({
                path: child.replace(/\\/g, '/'),
                symlink: fs.readlinkSync(childPath),
            });
        } else if (status.isDirectory()) {
            result.push(...snapshotDirectory(root, child));
        } else {
            const content = fs.readFileSync(childPath);
            result.push({
                path: child.replace(/\\/g, '/'),
                sha256: crypto.createHash('sha256').update(content).digest('hex'),
            });
        }
    }
    return result;
}

function expectGenerationError(run, expectedConflictReason) {
    let error;
    try {
        run();
    } catch (caught) {
        error = caught;
    }
    assert.ok(error instanceof soc.SocGenerationError,
        `expected SocGenerationError, got ${error && error.stack}`);
    if (expectedConflictReason !== undefined) {
        assert.ok(error.conflicts.some((conflict) => conflict.reason === expectedConflictReason),
            `missing ${expectedConflictReason}: ${JSON.stringify(error.conflicts, null, 2)}`);
    }
    return error;
}

function tryCreateLink(target, link, type) {
    try {
        fs.symlinkSync(target, link, process.platform === 'win32' && type === 'dir' ? 'junction' : type);
        return true;
    } catch (error) {
        if (['EACCES', 'EINVAL', 'ENOTSUP', 'EPERM'].includes(error.code)) return false;
        throw error;
    }
}

function withStagingWriteMutation(run, mutation) {
    const originalWrite = fs.writeFileSync;
    let mutated = false;
    fs.writeFileSync = (file, ...args) => {
        const result = originalWrite.call(fs, file, ...args);
        if (!mutated && path.basename(file) === 'manifest.json'
            && path.basename(path.dirname(file)).includes('-staging-')) {
            mutated = true;
            mutation(originalWrite);
        }
        return result;
    };
    try {
        return run();
    } finally {
        fs.writeFileSync = originalWrite;
    }
}

function assertGenerationOrchestration() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-generate-soc-'));
    try {
        const assets = path.join(root, 'assets');
        const project = path.join(root, 'project');
        prepareGenerationAssets(assets);
        const configFile = writeGenerationConfig(project, 'demo.merc32.json',
            'demo_soc', 'generated/demo_soc');
        const outputDir = path.join(project, 'generated', 'demo_soc');
        writeFile(path.join(outputDir, 'unmanaged.txt'), 'keep unmanaged\n');

        const first = soc.generateSoc({ configFile, assetRoot: assets });
        const expectedFiles = [
            'rtl/demo_soc.v', 'rtl/generated/demo_soc_plb_router.v',
            'rtl/cpu/MERC32_top.v', 'rtl/cpu/core.v', 'rtl/misc/div.v',
            'rtl/misc/mul.v', 'rtl/files.f', 'software/include/demo_soc.h',
            'software/src/main.c', 'config/demo_soc.resolved.json',
            'address-map.json', 'manifest.json', 'README.md', 'LICENSE',
        ];
        assert.strictEqual(first.outputDir, outputDir);
        assert.strictEqual(first.manifestFile, path.join(outputDir, 'manifest.json'));
        assert.deepStrictEqual(first.files, expectedFiles);
        assert.deepStrictEqual(first.warnings, []);
        assert.deepStrictEqual(first.skippedUserFiles, []);
        assert.ok(fs.existsSync(path.join(outputDir, 'software', 'src', 'main.c')));
        assert.match(fs.readFileSync(path.join(outputDir, 'software', 'src', 'main.c'), 'utf8'),
            /asset main template/);
        assert.match(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8'),
            /Asset README template/);
        assert.match(fs.readFileSync(path.join(outputDir, 'README.md'), 'utf8'),
            new RegExp(fs.realpathSync.native(configFile).replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.strictEqual(fs.readFileSync(path.join(outputDir, 'LICENSE'), 'utf8'),
            'opaque generator license\n');
        for (const logicalPath of [
            'rtl/cpu/MERC32_top.v', 'rtl/cpu/core.v', 'rtl/misc/div.v', 'rtl/misc/mul.v',
        ]) {
            assert.deepStrictEqual(
                fs.readFileSync(path.join(outputDir, ...logicalPath.split('/'))),
                fs.readFileSync(path.join(assets, ...logicalPath.split('/'))),
                `${logicalPath} must be copied byte-for-byte as an opaque asset`,
            );
        }
        assert.deepStrictEqual(fs.readFileSync(path.join(outputDir, 'rtl', 'files.f'), 'utf8')
            .trimEnd().split('\n'), [
                'cpu/MERC32_top.v', 'cpu/core.v', 'demo_soc.v',
                'generated/demo_soc_plb_router.v', 'misc/div.v', 'misc/mul.v',
            ]);
        assert.strictEqual(fs.readFileSync(path.join(outputDir, 'unmanaged.txt'), 'utf8'),
            'keep unmanaged\n');

        const firstManifest = readManifest(outputDir);
        assert.deepStrictEqual(firstManifest.files.map((record) => record.path),
            expectedFiles.filter((file) => file !== 'manifest.json'));
        assert.strictEqual(firstManifest.projectName, 'demo_soc');
        assert.strictEqual(firstManifest.sourceConfig,
            fs.realpathSync.native(configFile).replace(/\\/g, '/'));
        assert.strictEqual(firstManifest.generatorVersion, '2.0.0');
        assert.strictEqual(firstManifest.resourceRevision, 'test-resource-revision');
        assert.deepStrictEqual(firstManifest.manifestFile, {
            hashPolicy: 'excluded-self',
            kind: 'control/manifest',
            path: 'manifest.json',
        }, 'the manifest format must explicitly identify its unhashed control file');
        assert.strictEqual(firstManifest.files.some((record) => record.path === 'manifest.json'), false,
            'manifest.json must be excluded from ordinary managed-file hash records');
        assert.deepStrictEqual(new Set(firstManifest.files.map((record) => record.path.toLowerCase())).size,
            firstManifest.files.length);
        const managedRecords = firstManifest.files.filter((record) => record.kind !== 'scaffold/user-owned');
        assert.ok(managedRecords.every((record) => /^[0-9a-f]{64}$/.test(record.sha256)
            && typeof record.logicalSource === 'string' && record.logicalSource.length > 0
            && typeof record.kind === 'string' && record.kind.length > 0));
        for (const record of managedRecords) {
            assert.strictEqual(record.sha256, crypto.createHash('sha256')
                .update(fs.readFileSync(path.join(outputDir, ...record.path.split('/')))).digest('hex'));
        }
        assert.deepStrictEqual(firstManifest.files.find((record) => record.path === 'software/src/main.c'), {
            kind: 'scaffold/user-owned',
            logicalSource: 'templates/main.c.tpl',
            path: 'software/src/main.c',
        });
        const firstInventory = snapshotDirectory(outputDir);
        const repeat = soc.generateSoc({ configFile, assetRoot: assets });
        assert.deepStrictEqual(repeat.skippedUserFiles, ['software/src/main.c']);
        assert.deepStrictEqual(snapshotDirectory(outputDir), firstInventory,
            'repeat generation must be byte-identical');

        const invalidMainRecords = [
            (manifest, mainHash) => {
                manifest.files = manifest.files.filter((record) => record.path !== 'software/src/main.c');
                manifest.files.push({
                    kind: 'generated/software', logicalSource: 'legacy-generator',
                    path: 'software/src/main.c', sha256: mainHash,
                });
            },
            (manifest, mainHash) => {
                manifest.files.push({
                    kind: 'generated/software', logicalSource: 'malicious-duplicate',
                    path: 'software/src/main.c', sha256: mainHash,
                });
            },
            (manifest, mainHash) => {
                manifest.files.find((record) => record.path === 'software/src/main.c').sha256 = mainHash;
            },
        ];
        for (const [variant, mutateManifest] of invalidMainRecords.entries()) {
            for (const force of [false, true]) {
                const manifestProject = path.join(root, `invalid-main-manifest-${variant}-${force}`);
                const manifestConfig = writeGenerationConfig(manifestProject, 'demo.merc32.json',
                    `invalid_main_${variant}_${force}`, `generated/invalid_main_${variant}_${force}`);
                const generated = soc.generateSoc({ configFile: manifestConfig, assetRoot: assets });
                const mainPath = path.join(generated.outputDir, 'software', 'src', 'main.c');
                const manifest = readManifest(generated.outputDir);
                mutateManifest(manifest, crypto.createHash('sha256')
                    .update(fs.readFileSync(mainPath)).digest('hex'));
                writeFile(path.join(generated.outputDir, 'manifest.json'),
                    `${JSON.stringify(manifest, null, 2)}\n`);
                const beforeInvalidManifest = snapshotDirectory(generated.outputDir);
                const invalidManifestError = expectGenerationError(() => soc.generateSoc({
                    configFile: manifestConfig, assetRoot: assets, force,
                }));
                assert.ok(invalidManifestError.diagnostics.some((item) => item.code === 'SOC_MANIFEST'));
                assert.deepStrictEqual(snapshotDirectory(generated.outputDir), beforeInvalidManifest,
                    'invalid main.c ownership records must never authorize target mutation');
            }
        }

        const mainDirectoryProject = path.join(root, 'main-directory-project');
        const mainDirectoryConfig = writeGenerationConfig(mainDirectoryProject, 'demo.merc32.json',
            'main_directory_soc', 'generated/main_directory_soc');
        const mainDirectoryOutput = path.join(mainDirectoryProject, 'generated', 'main_directory_soc');
        fs.mkdirSync(path.join(mainDirectoryOutput, 'software', 'src', 'main.c'), { recursive: true });
        const mainDirectorySnapshot = snapshotDirectory(mainDirectoryOutput);
        expectGenerationError(() => soc.generateSoc({
            configFile: mainDirectoryConfig, assetRoot: assets,
        }), 'modified-managed');
        assert.deepStrictEqual(snapshotDirectory(mainDirectoryOutput), mainDirectorySnapshot,
            'a main.c directory must be rejected before activation');

        const mainLinkProject = path.join(root, 'main-link-project');
        const mainLinkConfig = writeGenerationConfig(mainLinkProject, 'demo.merc32.json',
            'main_link_soc', 'generated/main_link_soc');
        const mainLinkOutput = path.join(mainLinkProject, 'generated', 'main_link_soc');
        const externalMain = path.join(root, 'external-user-main.c');
        writeFile(externalMain, '/* external user main */\n');
        const linkedMain = path.join(mainLinkOutput, 'software', 'src', 'main.c');
        fs.mkdirSync(path.dirname(linkedMain), { recursive: true });
        let linkedMainCreated = tryCreateLink(externalMain, linkedMain, 'file');
        if (!linkedMainCreated) {
            const externalMainDirectory = path.join(root, 'external-user-main-directory');
            fs.mkdirSync(externalMainDirectory);
            linkedMainCreated = tryCreateLink(externalMainDirectory, linkedMain, 'dir');
        }
        if (linkedMainCreated) {
            const mainLinkSnapshot = snapshotDirectory(mainLinkOutput);
            try {
                expectGenerationError(() => soc.generateSoc({
                    configFile: mainLinkConfig, assetRoot: assets,
                }), 'modified-managed');
                assert.strictEqual(fs.readFileSync(externalMain, 'utf8'), '/* external user main */\n');
                assert.deepStrictEqual(snapshotDirectory(mainLinkOutput), mainLinkSnapshot,
                    'a linked main.c must be rejected without touching its target');
            } finally {
                fs.unlinkSync(linkedMain);
            }
        }

        const configTimes = Object.fromEntries(readManifest(outputDir).files
            .filter((record) => record.kind !== 'scaffold/user-owned')
            .map((record) => [record.path, fs.statSync(path.join(
                outputDir, ...record.path.split('/'))).mtimeMs]));
        const changedConfig = JSON.parse(fs.readFileSync(configFile, 'utf8'));
        changedConfig.cpu.jtagIdCode = '0x12345678';
        fs.writeFileSync(configFile, `${JSON.stringify(changedConfig, null, 2)}\n`);
        soc.generateSoc({ configFile, assetRoot: assets });
        const changedManifest = readManifest(outputDir);
        for (const record of changedManifest.files.filter((item) => item.kind !== 'scaffold/user-owned')) {
            if (record.path === 'rtl/demo_soc.v' || record.path === 'config/demo_soc.resolved.json'
                || record.path === 'README.md') continue;
            assert.strictEqual(fs.statSync(path.join(outputDir, ...record.path.split('/'))).mtimeMs,
                configTimes[record.path], `${record.path} should not be replaced when its bytes are unchanged`);
        }
        fs.writeFileSync(configFile, `${JSON.stringify({
            ...changedConfig,
            cpu: { debug: false },
        }, null, 2)}\n`);
        soc.generateSoc({ configFile, assetRoot: assets });

        const mainFile = path.join(outputDir, 'software', 'src', 'main.c');
        writeFile(mainFile, '/* user main */\n');
        const userMainTime = new Date('2026-01-02T03:04:05.000Z');
        fs.utimesSync(mainFile, userMainTime, userMainTime);
        const managedFile = path.join(outputDir, 'rtl', 'demo_soc.v');
        writeFile(managedFile, 'modified managed\n');
        const beforeConflict = snapshotDirectory(outputDir);
        expectGenerationError(() => soc.generateSoc({ configFile, assetRoot: assets }),
            'modified-managed');
        assert.deepStrictEqual(snapshotDirectory(outputDir), beforeConflict,
            'conflict gate must not mutate the target');
        const forced = soc.generateSoc({ configFile, assetRoot: assets, force: true });
        assert.deepStrictEqual(forced.skippedUserFiles, ['software/src/main.c']);
        assert.notStrictEqual(fs.readFileSync(managedFile, 'utf8'), 'modified managed\n');
        assert.strictEqual(fs.readFileSync(mainFile, 'utf8'), '/* user main */\n');
        assert.strictEqual(fs.statSync(mainFile).mtimeMs, userMainTime.getTime(),
            'force must not touch main.c timestamp');

        const unchangedStale = path.join(outputDir, 'rtl', 'obsolete.v');
        writeFile(unchangedStale, 'obsolete generated\n');
        const staleHash = crypto.createHash('sha256').update('obsolete generated\n').digest('hex');
        const staleManifest = readManifest(outputDir);
        staleManifest.files.push({
            kind: 'generated/rtl', logicalSource: 'test:obsolete',
            path: 'rtl/obsolete.v', sha256: staleHash,
        });
        staleManifest.files.sort((left, right) => left.path.localeCompare(right.path));
        writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(staleManifest, null, 2)}\n`);
        soc.generateSoc({ configFile, assetRoot: assets });
        assert.strictEqual(fs.existsSync(unchangedStale), false,
            'unchanged stale managed files must be removed');

        writeFile(unchangedStale, 'user modified stale\n');
        const modifiedStaleManifest = readManifest(outputDir);
        modifiedStaleManifest.files.push({
            kind: 'generated/rtl', logicalSource: 'test:obsolete',
            path: 'rtl/obsolete.v', sha256: staleHash,
        });
        modifiedStaleManifest.files.sort((left, right) => left.path.localeCompare(right.path));
        writeFile(path.join(outputDir, 'manifest.json'), `${JSON.stringify(modifiedStaleManifest, null, 2)}\n`);
        const staleConflictSnapshot = snapshotDirectory(outputDir);
        expectGenerationError(() => soc.generateSoc({ configFile, assetRoot: assets }),
            'modified-stale');
        assert.deepStrictEqual(snapshotDirectory(outputDir), staleConflictSnapshot,
            'modified stale conflict must leave all managed files untouched');
        assert.strictEqual(fs.readFileSync(unchangedStale, 'utf8'), 'user modified stale\n');
        expectGenerationError(() => soc.generateSoc({
            configFile, assetRoot: assets, force: true,
        }), 'modified-stale');
        assert.strictEqual(fs.readFileSync(unchangedStale, 'utf8'), 'user modified stale\n',
            'force must not remove a modified stale file');

        writeFile(unchangedStale, 'obsolete generated\n');
        soc.generateSoc({ configFile, assetRoot: assets });

        const activationSource = fs.readFileSync(configFile, 'utf8');
        fs.writeFileSync(configFile, activationSource.replace('"debug": false', '"debug": true'));
        const beforeActivationFailure = snapshotDirectory(outputDir);
        const activationStaging = path.join(path.dirname(outputDir), '.demo_soc-staging-activation');
        const originalMkdtempForActivation = fs.mkdtempSync;
        const originalRenameForActivation = fs.renameSync;
        fs.mkdtempSync = (prefix) => {
            assert.strictEqual(prefix, path.join(path.dirname(outputDir), '.demo_soc-staging-'));
            fs.mkdirSync(activationStaging);
            return activationStaging;
        };
        let activationInstallCount = 0;
        let activationFailureInjected = false;
        fs.renameSync = (oldPath, newPath) => {
            if (!activationFailureInjected
                && path.resolve(oldPath).startsWith(`${path.resolve(activationStaging)}${path.sep}`)
                && !path.resolve(oldPath).includes(`${path.sep}.activation-backup${path.sep}`)) {
                activationInstallCount += 1;
                if (activationInstallCount === 2) {
                    activationFailureInjected = true;
                    throw new Error('injected activation rename failure');
                }
            }
            return originalRenameForActivation.call(fs, oldPath, newPath);
        };
        try {
            expectGenerationError(() => soc.generateSoc({ configFile, assetRoot: assets }));
        } finally {
            fs.mkdtempSync = originalMkdtempForActivation;
            fs.renameSync = originalRenameForActivation;
        }
        assert.deepStrictEqual(snapshotDirectory(outputDir), beforeActivationFailure,
            'a narrow activation failure must roll back every prior managed-path change');
        assert.strictEqual(fs.existsSync(activationStaging), false);
        fs.writeFileSync(configFile, activationSource);

        const recoveryProject = path.join(root, 'recovery-project');
        const recoveryConfig = writeGenerationConfig(recoveryProject, 'demo.merc32.json',
            'recovery_soc', 'generated/recovery_soc');
        const recoveryResult = soc.generateSoc({ configFile: recoveryConfig, assetRoot: assets });
        const recoveryConfigValue = JSON.parse(fs.readFileSync(recoveryConfig, 'utf8'));
        recoveryConfigValue.cpu.debug = true;
        recoveryConfigValue.cpu.jtagIdCode = '0x23456789';
        fs.writeFileSync(recoveryConfig, `${JSON.stringify(recoveryConfigValue, null, 2)}\n`);
        const recoveryStaging = path.join(path.dirname(recoveryResult.outputDir),
            '.recovery_soc-staging-recovery');
        const originalMkdtempForRecovery = fs.mkdtempSync;
        const originalRenameForRecovery = fs.renameSync;
        const originalRmForRecovery = fs.rmSync;
        const installedTargets = [];
        const removalAttempts = [];
        const restorationAttempts = [];
        let installFailureInjected = false;
        let removalFailureInjected = false;
        let restorationFailureInjected = false;
        fs.mkdtempSync = (prefix) => {
            assert.strictEqual(prefix, path.join(path.dirname(recoveryResult.outputDir),
                '.recovery_soc-staging-'));
            fs.mkdirSync(recoveryStaging);
            return recoveryStaging;
        };
        fs.renameSync = (oldPath, newPath) => {
            const resolvedOld = path.resolve(oldPath);
            const isInstall = resolvedOld.startsWith(`${path.resolve(recoveryStaging)}${path.sep}`)
                && !resolvedOld.includes(`${path.sep}.activation-backup${path.sep}`);
            if (isInstall) {
                if (installedTargets.length === 2 && !installFailureInjected) {
                    installFailureInjected = true;
                    throw new Error('injected activation failure before recovery');
                }
                installedTargets.push(path.resolve(newPath));
            }
            if (resolvedOld.includes(`${path.sep}.activation-backup${path.sep}`)) {
                restorationAttempts.push(path.resolve(newPath));
                if (!restorationFailureInjected) {
                    restorationFailureInjected = true;
                    throw new Error('injected backup restoration failure');
                }
            }
            return originalRenameForRecovery.call(fs, oldPath, newPath);
        };
        fs.rmSync = (target, options) => {
            const resolvedTarget = path.resolve(target);
            if (installedTargets.includes(resolvedTarget)) {
                removalAttempts.push(resolvedTarget);
                if (!removalFailureInjected) {
                    removalFailureInjected = true;
                    throw new Error('injected installed-file cleanup failure');
                }
            }
            return originalRmForRecovery.call(fs, target, options);
        };
        let recoveryError;
        try {
            recoveryError = expectGenerationError(() => soc.generateSoc({
                configFile: recoveryConfig, assetRoot: assets,
            }));
        } finally {
            fs.mkdtempSync = originalMkdtempForRecovery;
            fs.renameSync = originalRenameForRecovery;
            fs.rmSync = originalRmForRecovery;
        }
        assert.ok(recoveryError.diagnostics.some((item) => item.code === 'SOC_RECOVERY_INCOMPLETE'));
        assert.strictEqual(recoveryError.recoveryPath, recoveryStaging);
        assert.ok(Array.isArray(recoveryError.recoveryFailures)
            && recoveryError.recoveryFailures.length >= 2);
        assert.deepStrictEqual(new Set(removalAttempts), new Set(installedTargets),
            'rollback must attempt removal of every installed target after one removal fails');
        assert.ok(restorationAttempts.length >= 2,
            'rollback must attempt every backup restoration after one restoration fails');
        assert.strictEqual(fs.existsSync(recoveryStaging), true,
            'incomplete rollback must retain its exact recovery directory');
        assert.ok(snapshotDirectory(path.join(recoveryStaging, '.activation-backup')).length > 0,
            'incomplete rollback must retain unresolved backup files for manual recovery');

        const rollbackRaceProject = path.join(root, 'rollback-race-project');
        const rollbackRaceConfig = writeGenerationConfig(rollbackRaceProject, 'demo.merc32.json',
            'rollback_race_soc', 'generated/rollback_race_soc');
        const rollbackRaceResult = soc.generateSoc({
            configFile: rollbackRaceConfig, assetRoot: assets,
        });
        const rollbackRaceConfigValue = JSON.parse(fs.readFileSync(rollbackRaceConfig, 'utf8'));
        rollbackRaceConfigValue.cpu.debug = true;
        rollbackRaceConfigValue.cpu.jtagIdCode = '0x3456789a';
        fs.writeFileSync(rollbackRaceConfig, `${JSON.stringify(rollbackRaceConfigValue, null, 2)}\n`);
        const rollbackRaceStaging = path.join(path.dirname(rollbackRaceResult.outputDir),
            '.rollback_race_soc-staging-race');
        const originalMkdtempForRollbackRace = fs.mkdtempSync;
        const originalRenameForRollbackRace = fs.renameSync;
        let rollbackRaceInstallCount = 0;
        let racedInstalledTarget;
        fs.mkdtempSync = (prefix) => {
            assert.strictEqual(prefix, path.join(path.dirname(rollbackRaceResult.outputDir),
                '.rollback_race_soc-staging-'));
            fs.mkdirSync(rollbackRaceStaging);
            return rollbackRaceStaging;
        };
        fs.renameSync = (oldPath, newPath) => {
            const resolvedOld = path.resolve(oldPath);
            const isInstall = resolvedOld.startsWith(`${path.resolve(rollbackRaceStaging)}${path.sep}`)
                && !resolvedOld.includes(`${path.sep}.activation-backup${path.sep}`);
            if (isInstall) {
                rollbackRaceInstallCount += 1;
                if (rollbackRaceInstallCount === 2) {
                    fs.writeFileSync(racedInstalledTarget, 'user changed installed target before rollback\n');
                    throw new Error('injected activation failure after concurrent installed change');
                }
                racedInstalledTarget = path.resolve(newPath);
            }
            return originalRenameForRollbackRace.call(fs, oldPath, newPath);
        };
        let rollbackRaceError;
        try {
            rollbackRaceError = expectGenerationError(() => soc.generateSoc({
                configFile: rollbackRaceConfig, assetRoot: assets,
            }));
        } finally {
            fs.mkdtempSync = originalMkdtempForRollbackRace;
            fs.renameSync = originalRenameForRollbackRace;
        }
        assert.ok(rollbackRaceError.diagnostics.some(
            (item) => item.code === 'SOC_RECOVERY_INCOMPLETE'));
        assert.strictEqual(fs.readFileSync(racedInstalledTarget, 'utf8'),
            'user changed installed target before rollback\n',
        'rollback must not delete a target that changed after installation');
        assert.strictEqual(fs.existsSync(rollbackRaceStaging), true);
        assert.ok(snapshotDirectory(path.join(rollbackRaceStaging, '.activation-backup')).length > 0,
            'a rollback race must retain the old backup beside the live user change');

        const toctouProject = path.join(root, 'toctou-project');
        const toctouConfig = writeGenerationConfig(toctouProject, 'demo.merc32.json',
            'toctou_soc', 'generated/toctou_soc');
        const toctouResult = soc.generateSoc({ configFile: toctouConfig, assetRoot: assets });
        const toctouManaged = path.join(toctouResult.outputDir, 'rtl', 'toctou_soc.v');
        const toctouConfigValue = JSON.parse(fs.readFileSync(toctouConfig, 'utf8'));
        toctouConfigValue.cpu.debug = true;
        fs.writeFileSync(toctouConfig, `${JSON.stringify(toctouConfigValue, null, 2)}\n`);
        const changedDuringStaging = 'user changed managed during staging\n';
        expectGenerationError(() => withStagingWriteMutation(
            () => soc.generateSoc({ configFile: toctouConfig, assetRoot: assets }),
            (write) => write.call(fs, toctouManaged, changedDuringStaging),
        ));
        assert.strictEqual(fs.readFileSync(toctouManaged, 'utf8'), changedDuringStaging,
            'a managed target changed during staging must not be overwritten');

        soc.generateSoc({ configFile: toctouConfig, assetRoot: assets, force: true });
        const toctouStale = path.join(toctouResult.outputDir, 'rtl', 'obsolete.v');
        writeFile(toctouStale, 'obsolete generated\n');
        const toctouStaleManifest = readManifest(toctouResult.outputDir);
        toctouStaleManifest.files.push({
            kind: 'generated/rtl', logicalSource: 'test:obsolete', path: 'rtl/obsolete.v',
            sha256: crypto.createHash('sha256').update('obsolete generated\n').digest('hex'),
        });
        writeFile(path.join(toctouResult.outputDir, 'manifest.json'),
            `${JSON.stringify(toctouStaleManifest, null, 2)}\n`);
        const changedStaleDuringStaging = 'user changed stale during staging\n';
        expectGenerationError(() => withStagingWriteMutation(
            () => soc.generateSoc({ configFile: toctouConfig, assetRoot: assets }),
            (write) => write.call(fs, toctouStale, changedStaleDuringStaging),
        ));
        assert.strictEqual(fs.readFileSync(toctouStale, 'utf8'), changedStaleDuringStaging,
            'a stale target changed during staging must not be removed');

        fs.rmSync(toctouStale);
        writeFile(path.join(toctouResult.outputDir, 'manifest.json'),
            `${JSON.stringify(readManifest(toctouResult.outputDir), null, 2)}\n`);
        const toctouMissing = path.join(toctouResult.outputDir, 'rtl', 'toctou_soc.v');
        fs.rmSync(toctouMissing);
        const appearedDuringStaging = 'user created managed during staging\n';
        expectGenerationError(() => withStagingWriteMutation(
            () => soc.generateSoc({ configFile: toctouConfig, assetRoot: assets }),
            (write) => write.call(fs, toctouMissing, appearedDuringStaging),
        ));
        assert.strictEqual(fs.readFileSync(toctouMissing, 'utf8'), appearedDuringStaging,
            'a target created during staging must not be overwritten');

        const mainToctouProject = path.join(root, 'main-toctou-project');
        const mainToctouConfig = writeGenerationConfig(mainToctouProject, 'demo.merc32.json',
            'main_toctou_soc', 'generated/main_toctou_soc');
        const mainToctouPath = path.join(mainToctouProject, 'generated', 'main_toctou_soc',
            'software', 'src', 'main.c');
        expectGenerationError(() => withStagingWriteMutation(
            () => soc.generateSoc({ configFile: mainToctouConfig, assetRoot: assets }),
            (write) => {
                fs.mkdirSync(path.dirname(mainToctouPath), { recursive: true });
                write.call(fs, mainToctouPath, '/* user main appeared during staging */\n');
            },
        ));
        assert.strictEqual(fs.readFileSync(mainToctouPath, 'utf8'),
            '/* user main appeared during staging */\n',
        'a user main appearing during staging must be preserved and abort activation');

        soc.generateSoc({ configFile: toctouConfig, assetRoot: assets, force: true });
        const lateConfigValue = JSON.parse(fs.readFileSync(toctouConfig, 'utf8'));
        lateConfigValue.cpu.jtagIdCode = '0x76543210';
        fs.writeFileSync(toctouConfig, `${JSON.stringify(lateConfigValue, null, 2)}\n`);
        const rollbackBeforeLateChange = snapshotDirectory(toctouResult.outputDir);
        const earlyActivationPath = path.join(toctouResult.outputDir, 'rtl', 'toctou_soc.v');
        const earlyActivationContent = fs.readFileSync(earlyActivationPath);
        const lateActivationPath = path.join(toctouResult.outputDir, 'config',
            'toctou_soc.resolved.json');
        const lateChange = 'user changed later target during activation\n';
        const originalRenameForToctou = fs.renameSync;
        let installRenames = 0;
        fs.renameSync = (oldPath, newPath) => {
            const isInstall = path.resolve(oldPath).includes(
                `${path.sep}.toctou_soc-staging-`);
            if (isInstall && !path.resolve(oldPath).includes(`${path.sep}.activation-backup${path.sep}`)) {
                installRenames += 1;
                if (installRenames === 1) fs.writeFileSync(lateActivationPath, lateChange);
            }
            return originalRenameForToctou.call(fs, oldPath, newPath);
        };
        try {
            expectGenerationError(() => soc.generateSoc({
                configFile: toctouConfig, assetRoot: assets,
            }));
        } finally {
            fs.renameSync = originalRenameForToctou;
        }
        assert.strictEqual(fs.readFileSync(lateActivationPath, 'utf8'), lateChange,
            'the later concurrent change must remain untouched');
        assert.deepStrictEqual(fs.readFileSync(earlyActivationPath), earlyActivationContent,
            'an earlier installed path must be restored after a later precondition failure');
        const rollbackAfterLateChange = snapshotDirectory(toctouResult.outputDir)
            .filter((entry) => entry.path !== 'config/toctou_soc.resolved.json');
        assert.deepStrictEqual(rollbackAfterLateChange,
            rollbackBeforeLateChange.filter((entry) => entry.path !== 'config/toctou_soc.resolved.json'),
            'a later precondition failure must roll back every earlier activation');

        soc.generateSoc({ configFile: toctouConfig, assetRoot: assets, force: true });
        const manifestToctouConfigValue = JSON.parse(fs.readFileSync(toctouConfig, 'utf8'));
        manifestToctouConfigValue.cpu.jtagIdCode = '0x456789ab';
        fs.writeFileSync(toctouConfig, `${JSON.stringify(manifestToctouConfigValue, null, 2)}\n`);
        const manifestChangedDuringStaging = 'user replaced manifest during staging\n';
        expectGenerationError(() => withStagingWriteMutation(
            () => soc.generateSoc({ configFile: toctouConfig, assetRoot: assets }),
            (write) => write.call(fs, path.join(toctouResult.outputDir, 'manifest.json'),
                manifestChangedDuringStaging),
        ));
        assert.strictEqual(fs.readFileSync(path.join(toctouResult.outputDir, 'manifest.json'), 'utf8'),
            manifestChangedDuringStaging,
            'the manifest state inspected before staging must be revalidated before replacement');

        const renamedConfig = writeGenerationConfig(project, 'renamed.merc32.json',
            'demo_soc', 'generated/demo_soc');
        const ownedSnapshot = snapshotDirectory(outputDir);
        expectGenerationError(() => soc.generateSoc({
            configFile: renamedConfig, assetRoot: assets, force: true,
        }), 'output-owned');
        assert.deepStrictEqual(snapshotDirectory(outputDir), ownedSnapshot,
            'force cannot bypass output ownership');
        const adopted = soc.generateSoc({
            configFile: renamedConfig, assetRoot: assets, adoptOutput: true,
        });
        assert.strictEqual(readManifest(outputDir).sourceConfig,
            fs.realpathSync.native(renamedConfig).replace(/\\/g, '/'));
        assert.strictEqual(adopted.outputDir, outputDir);

        writeFile(managedFile, 'changed before adoption\n');
        const thirdConfig = writeGenerationConfig(project, 'third.merc32.json',
            'demo_soc', 'generated/demo_soc');
        const beforeBadAdoption = snapshotDirectory(outputDir);
        expectGenerationError(() => soc.generateSoc({
            configFile: thirdConfig, assetRoot: assets, adoptOutput: true, force: true,
        }), 'modified-managed');
        assert.deepStrictEqual(snapshotDirectory(outputDir), beforeBadAdoption,
            'adoption must verify old hashes before any mutation');
        writeFile(managedFile, fs.readFileSync(path.join(assets, 'rtl', 'cpu', 'MERC32_top.v')));
        // Restore exactly through the current owner before testing staged failures.
        soc.generateSoc({ configFile: renamedConfig, assetRoot: assets, force: true });

        const missingAsset = path.join(assets, 'rtl', 'misc', 'mul.v');
        fs.renameSync(missingAsset, `${missingAsset}.missing`);
        const beforeMissingAsset = snapshotDirectory(outputDir);
        expectGenerationError(() => soc.generateSoc({ configFile: renamedConfig, assetRoot: assets }));
        assert.deepStrictEqual(snapshotDirectory(outputDir), beforeMissingAsset,
            'missing dependency must fail before target mutation');
        fs.renameSync(`${missingAsset}.missing`, missingAsset);

        const linkedAssets = path.join(root, 'linked-assets');
        prepareGenerationAssets(linkedAssets);
        const externalCpuAssets = path.join(root, 'external-cpu-assets');
        fs.cpSync(path.join(linkedAssets, 'rtl', 'cpu'), externalCpuAssets, { recursive: true });
        const linkedCpuAssets = path.join(linkedAssets, 'rtl', 'cpu');
        fs.rmSync(linkedCpuAssets, { recursive: true, force: true });
        if (tryCreateLink(externalCpuAssets, linkedCpuAssets, 'dir')) {
            const linkedAssetProject = path.join(root, 'linked-asset-project');
            const linkedAssetConfig = writeGenerationConfig(linkedAssetProject, 'demo.merc32.json',
                'linked_asset_soc', 'generated/linked_asset_soc');
            try {
                const linkedAssetError = expectGenerationError(() => soc.generateSoc({
                    configFile: linkedAssetConfig, assetRoot: linkedAssets,
                }));
                assert.ok(linkedAssetError.diagnostics.some((item) => item.code === 'SOC_ASSET'),
                    'linked logical asset paths must report an asset provenance error');
                assert.strictEqual(fs.existsSync(path.join(linkedAssetProject, 'generated',
                    'linked_asset_soc')), false);
            } finally {
                fs.unlinkSync(linkedCpuAssets);
            }
        }

        const linkedCatalogAssets = path.join(root, 'linked-catalog-assets');
        prepareGenerationAssets(linkedCatalogAssets);
        const externalCatalog = path.join(root, 'external-catalog');
        fs.cpSync(path.join(linkedCatalogAssets, 'catalog'), externalCatalog, { recursive: true });
        const linkedCatalog = path.join(linkedCatalogAssets, 'catalog');
        fs.rmSync(linkedCatalog, { recursive: true, force: true });
        if (tryCreateLink(externalCatalog, linkedCatalog, 'dir')) {
            const linkedCatalogProject = path.join(root, 'linked-catalog-project');
            const linkedCatalogConfig = writeGenerationConfig(linkedCatalogProject,
                'demo.merc32.json', 'linked_catalog_soc', 'generated/linked_catalog_soc');
            try {
                const linkedCatalogError = expectGenerationError(() => soc.generateSoc({
                    configFile: linkedCatalogConfig, assetRoot: linkedCatalogAssets,
                }));
                assert.ok(linkedCatalogError.diagnostics.some((item) => item.code === 'SOC_ASSET'));
                assert.strictEqual(fs.existsSync(path.join(linkedCatalogProject, 'generated',
                    'linked_catalog_soc')), false,
                'catalog descriptors must not be read through linked asset ancestry');
            } finally {
                fs.unlinkSync(linkedCatalog);
            }
        }

        const outputAncestorProject = path.join(root, 'output-ancestor-project');
        const outputAncestorConfig = writeGenerationConfig(outputAncestorProject, 'demo.merc32.json',
            'output_ancestor_soc', 'generated/output_ancestor_soc');
        const externalOutputAncestor = path.join(root, 'external-output-ancestor');
        writeFile(path.join(externalOutputAncestor, 'sentinel.txt'), 'external output sentinel\n');
        const outputAncestorLink = path.join(outputAncestorProject, 'generated');
        if (tryCreateLink(externalOutputAncestor, outputAncestorLink, 'dir')) {
            try {
                expectGenerationError(() => soc.generateSoc({
                    configFile: outputAncestorConfig, assetRoot: assets,
                }));
                assert.deepStrictEqual(fs.readdirSync(externalOutputAncestor), ['sentinel.txt'],
                    'linked output ancestry must not receive generated files');
            } finally {
                fs.unlinkSync(outputAncestorLink);
            }
        }

        const managedLinkProject = path.join(root, 'managed-link-project');
        const managedLinkConfig = writeGenerationConfig(managedLinkProject, 'demo.merc32.json',
            'managed_link_soc', 'generated/managed_link_soc');
        const managedLinkResult = soc.generateSoc({
            configFile: managedLinkConfig, assetRoot: assets,
        });
        const managedLinkPath = path.join(managedLinkResult.outputDir, 'rtl', 'managed_link_soc.v');
        const externalManagedTarget = path.join(root, 'external-managed-target.v');
        fs.copyFileSync(managedLinkPath, externalManagedTarget);
        fs.rmSync(managedLinkPath);
        if (tryCreateLink(externalManagedTarget, managedLinkPath, 'file')) {
            try {
                expectGenerationError(() => soc.generateSoc({
                    configFile: managedLinkConfig, assetRoot: assets,
                }), 'modified-managed');
                assert.deepStrictEqual(fs.readFileSync(externalManagedTarget),
                    fs.readFileSync(managedLinkPath));
            } finally {
                fs.unlinkSync(managedLinkPath);
            }
        }

        const stagedLinkProject = path.join(root, 'staged-link-project');
        const stagedLinkConfig = writeGenerationConfig(stagedLinkProject, 'demo.merc32.json',
            'staged_link_soc', 'generated/staged_link_soc');
        const stagedLinkOutput = path.join(stagedLinkProject, 'generated', 'staged_link_soc');
        const externalStagedRtl = path.join(root, 'external-staged-rtl');
        writeFile(path.join(externalStagedRtl, 'sentinel.txt'), 'staged link sentinel\n');
        let stagedRtlLinkCreated = false;
        try {
            expectGenerationError(() => withStagingWriteMutation(
                () => soc.generateSoc({ configFile: stagedLinkConfig, assetRoot: assets }),
                () => {
                    fs.mkdirSync(stagedLinkOutput, { recursive: true });
                    stagedRtlLinkCreated = tryCreateLink(externalStagedRtl,
                        path.join(stagedLinkOutput, 'rtl'), 'dir');
                    if (!stagedRtlLinkCreated) throw new Error('link creation unavailable');
                },
            ));
            assert.deepStrictEqual(fs.readdirSync(externalStagedRtl), ['sentinel.txt'],
                'a managed ancestor linked during staging must not receive generated files');
        } finally {
            if (stagedRtlLinkCreated) fs.unlinkSync(path.join(stagedLinkOutput, 'rtl'));
        }

        const sourceText = fs.readFileSync(renamedConfig, 'utf8');
        fs.writeFileSync(renamedConfig, sourceText.replace('"debug": false', '"debug": true'));
        const failingStage = path.join(path.dirname(outputDir), '.demo_soc-staging-fixed');
        const originalMkdtemp = fs.mkdtempSync;
        const originalWrite = fs.writeFileSync;
        fs.mkdtempSync = (prefix) => {
            assert.strictEqual(prefix, path.join(path.dirname(outputDir), '.demo_soc-staging-'));
            fs.mkdirSync(failingStage);
            return failingStage;
        };
        fs.writeFileSync = (file, ...args) => {
            if (path.resolve(file) === path.join(failingStage, 'rtl', 'generated',
                'demo_soc_plb_router.v')) {
                throw new Error('injected staging write failure');
            }
            return originalWrite.call(fs, file, ...args);
        };
        const beforeStageFailure = snapshotDirectory(outputDir);
        try {
            expectGenerationError(() => soc.generateSoc({
                configFile: renamedConfig, assetRoot: assets,
            }));
        } finally {
            fs.mkdtempSync = originalMkdtemp;
            fs.writeFileSync = originalWrite;
        }
        assert.deepStrictEqual(snapshotDirectory(outputDir), beforeStageFailure,
            'pre-activation staging failure must leave old output byte-for-byte unchanged');
        assert.strictEqual(fs.existsSync(failingStage), false,
            'only the exact staging directory must be removed in finally');

        const warningProject = path.join(root, 'warning-project');
        const warningConfig = writeGenerationConfig(warningProject, 'warning.merc32.json',
            'warning_soc', 'generated/warning_soc', (value) => ({
                ...value,
                peripherals: [{
                    type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000',
                }],
            }));
        const warningResult = soc.generateSoc({ configFile: warningConfig, assetRoot: assets });
        assert.deepStrictEqual(warningResult.warnings.map((warning) => warning.code),
            ['SOC_IRQ_UNCONNECTED'], 'parse/planning warnings must not be duplicated');

        const caseProject = path.join(root, 'case-project');
        const caseConfig = writeGenerationConfig(caseProject, 'case.merc32.json',
            'case_soc', 'generated/case_soc');
        const caseOutput = path.join(caseProject, 'generated', 'case_soc');
        writeFile(path.join(caseOutput, 'RTL', 'user.txt'), 'case sentinel\n');
        const caseSnapshot = snapshotDirectory(caseOutput);
        expectGenerationError(() => soc.generateSoc({
            configFile: caseConfig, assetRoot: assets,
        }), 'modified-managed');
        assert.deepStrictEqual(snapshotDirectory(caseOutput), caseSnapshot,
            'case-insensitive path collisions must be refused before activation');

        const blockedProject = path.join(root, 'blocked-project');
        const blockedConfig = writeGenerationConfig(blockedProject, 'blocked.merc32.json',
            'blocked_soc', 'generated/blocked_soc');
        const blockedOutput = path.join(blockedProject, 'generated', 'blocked_soc');
        writeFile(path.join(blockedOutput, 'rtl'), 'unmanaged parent file\n');
        const blockedSnapshot = snapshotDirectory(blockedOutput);
        expectGenerationError(() => soc.generateSoc({
            configFile: blockedConfig, assetRoot: assets,
        }), 'modified-managed');
        assert.deepStrictEqual(snapshotDirectory(blockedOutput), blockedSnapshot,
            'a file blocking a managed directory must be rejected before activation');

        const invalidProject = path.join(root, 'invalid-project');
        const invalidConfig = writeGenerationConfig(invalidProject, 'invalid.merc32.json',
            'invalid_soc', 'generated/invalid_soc');
        const invalidOutput = path.join(invalidProject, 'generated', 'invalid_soc');
        writeFile(path.join(invalidOutput, 'sentinel.txt'), 'validation sentinel\n');
        fs.writeFileSync(invalidConfig, '{ invalid JSON\n');
        const invalidSnapshot = snapshotDirectory(invalidOutput);
        const invalidError = expectGenerationError(() => soc.generateSoc({
            configFile: invalidConfig, assetRoot: assets,
        }));
        assert.ok(invalidError.diagnostics.some((diagnostic) => diagnostic.code === 'SOC_JSON_SYNTAX'));
        assert.deepStrictEqual(snapshotDirectory(invalidOutput), invalidSnapshot,
            'parse/validation failure must leave an existing output untouched');

        const memoryProject = path.join(root, 'memory-project');
        writeFile(path.join(memoryProject, 'boot', 'firmware.mem'), '11aa22bb\n');
        writeFile(path.join(memoryProject, 'data', 'firmware.mem'), '33cc44dd\n');
        const memoryConfig = writeGenerationConfig(memoryProject, 'memory.merc32.json',
            'memory_soc', 'generated/memory_soc', (value) => ({
                ...value,
                memory: {
                    ilb: { type: 'internal_ram', size: '32KiB', initFile: 'boot/firmware.mem' },
                    dlb: { type: 'internal_ram', size: '64KiB', initFile: 'data/firmware.mem' },
                },
            }));
        const memoryResult = soc.generateSoc({ configFile: memoryConfig, assetRoot: assets });
        assert.deepStrictEqual(memoryResult.files.filter((file) => file.startsWith('memory/')), [
            'memory/ilb_firmware.mem', 'memory/dlb_firmware.mem',
        ]);
        assert.strictEqual(fs.readFileSync(path.join(memoryResult.outputDir,
            'memory', 'ilb_firmware.mem'), 'utf8'), '11aa22bb\n');
        assert.strictEqual(fs.readFileSync(path.join(memoryResult.outputDir,
            'memory', 'dlb_firmware.mem'), 'utf8'), '33cc44dd\n');

        const externalMemory = path.join(root, 'external-memory.mem');
        writeFile(externalMemory, 'feedface\n');
        const linkedMemoryProject = path.join(root, 'linked-memory-project');
        const linkedMemoryFile = path.join(linkedMemoryProject, 'boot', 'firmware.mem');
        fs.mkdirSync(path.dirname(linkedMemoryFile), { recursive: true });
        if (tryCreateLink(externalMemory, linkedMemoryFile, 'file')) {
            const linkedMemoryConfig = writeGenerationConfig(linkedMemoryProject,
                'memory.merc32.json', 'linked_memory_soc', 'generated/linked_memory_soc',
                (value) => ({
                    ...value,
                    memory: {
                        ...value.memory,
                        ilb: { type: 'internal_ram', size: '32KiB', initFile: 'boot/firmware.mem' },
                    },
                }));
            expectGenerationError(() => soc.generateSoc({
                configFile: linkedMemoryConfig, assetRoot: assets,
            }));
            assert.strictEqual(fs.existsSync(path.join(linkedMemoryProject, 'generated',
                'linked_memory_soc')), false);
            fs.unlinkSync(linkedMemoryFile);
        }

        const escapedMemoryProject = path.join(root, 'escaped-memory-project');
        writeFile(path.join(root, 'escaped-memory.mem'), 'decafbad\n');
        const escapedMemoryConfig = writeGenerationConfig(escapedMemoryProject,
            'memory.merc32.json', 'escaped_memory_soc', 'generated/escaped_memory_soc',
            (value) => ({
                ...value,
                memory: {
                    ...value.memory,
                    ilb: { type: 'internal_ram', size: '32KiB', initFile: '../escaped-memory.mem' },
                },
            }));
        expectGenerationError(() => soc.generateSoc({
            configFile: escapedMemoryConfig, assetRoot: assets,
        }));
        assert.strictEqual(fs.existsSync(path.join(escapedMemoryProject, 'generated',
            'escaped_memory_soc')), false,
        'memory-init provenance must remain within the canonical configuration directory');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

let catalog;
try {
    fs.cpSync(path.join(__dirname, '..', 'resources', 'catalog'),
        path.join(assetRoot, 'catalog'), { recursive: true });
    fs.cpSync(path.join(repositoryRoot, 'rtl'), path.join(assetRoot, 'rtl'),
        { recursive: true });
    catalog = soc.loadCatalog(assetRoot);

    const multi = JSON.parse(fs.readFileSync(
        path.join(fixtureDirectory, 'multi-peripheral.merc32.json'), 'utf8'));
    const controllerPlan = planFixture(multi, 'multi-peripheral.merc32.json');
    const resolvedConfig = soc.renderResolvedConfig(controllerPlan);
    const addressMap = soc.renderAddressMap(controllerPlan);
    const header = soc.renderSocHeader(controllerPlan);
    const readme = soc.renderGeneratedReadme(controllerPlan);
    const starterMain = soc.renderStarterMain(controllerPlan);

    assert.strictEqual(resolvedConfig, soc.renderResolvedConfig(controllerPlan));
    const resolved = JSON.parse(resolvedConfig);
    assert.strictEqual(`${JSON.stringify(resolved, null, 2)}\n`, resolvedConfig);
    assertSortedObjectKeys(resolved);
    assert.deepStrictEqual(resolved.cpu, { debug: true, jtagIdCode: '0x4d320001' });
    assert.deepStrictEqual(resolved.memory, {
        dlb: {
            baseAddress: '0x08000000', endAddress: '0x0800ffff',
            sizeBytes: 65536, type: 'external_local_bus', wordAddressWidth: 14,
        },
        ilb: {
            baseAddress: '0x00000000', endAddress: '0x00007fff', initFile: 'ilb_firmware.mem',
            sizeBytes: 32768, type: 'internal_ram', wordAddressWidth: 13,
        },
    });
    assert.deepStrictEqual(resolved.interrupt, {
        controller: 'intc0', irqCount: 4, irqMode: '0x00000000000000e4', mode: 'controller',
        sources: [
            { id: 0, source: 'uart0.interrupt', trigger: 'high' },
            { id: 1, source: 'uart1.interrupt', trigger: 'low' },
            { id: 2, source: 'gpio0.interrupt', trigger: 'rising' },
            { id: 3, source: 'external.wake', topPort: 'external_wake', trigger: 'falling' },
        ],
    });
    assert.deepStrictEqual(resolved.peripherals.map((item) => ({
        baseAddress: item.baseAddress, endAddress: item.endAddress, interrupts: item.interrupts,
        module: item.module, name: item.name, sizeBytes: item.sizeBytes, type: item.type,
    })), [
        { baseAddress: '0x10000000', endAddress: '0x10000fff', interrupts: ['interrupt'], module: 'apb_uart', name: 'uart0', sizeBytes: 4096, type: 'apb_uart' },
        { baseAddress: '0x10001000', endAddress: '0x10001fff', interrupts: ['interrupt'], module: 'apb_uart', name: 'uart1', sizeBytes: 4096, type: 'apb_uart' },
        { baseAddress: '0x10002000', endAddress: '0x10002fff', interrupts: ['interrupt'], module: 'apb_gpio', name: 'gpio0', sizeBytes: 4096, type: 'apb_gpio' },
        { baseAddress: '0x10003000', endAddress: '0x10003fff', interrupts: ['interrupt'], module: 'apb_intc', name: 'intc0', sizeBytes: 4096, type: 'apb_intc' },
    ]);
    assert.deepStrictEqual(resolved.externalInterfaces.map((item) => ({
        addressWidth: item.addressWidth, baseAddress: item.baseAddress, endAddress: item.endAddress,
        name: item.name, sizeBytes: item.sizeBytes, type: item.type,
    })), [
        { addressWidth: 12, baseAddress: '0x10004000', endAddress: '0x10004fff', name: 'apb_ext0', sizeBytes: 4096, type: 'apb' },
        { addressWidth: 32, baseAddress: '0x20000000', endAddress: '0x20ffffff', name: 'axi0', sizeBytes: 16777216, type: 'axi4_lite' },
    ]);
    assert.deepStrictEqual(resolved.rtlFiles, controllerPlan.rtlFiles);
    assert.deepStrictEqual(resolved.topPorts, controllerPlan.topPorts);

    assert.strictEqual(addressMap, soc.renderAddressMap(controllerPlan));
    assert.strictEqual(addressMap, [
        '{', '  "endpoints": [',
        '    {', '      "baseAddress": "0x10000000",', '      "endAddress": "0x10000fff",', '      "kind": "peripheral",', '      "name": "uart0",', '      "sizeBytes": 4096,', '      "type": "apb_uart"', '    },',
        '    {', '      "baseAddress": "0x10001000",', '      "endAddress": "0x10001fff",', '      "kind": "peripheral",', '      "name": "uart1",', '      "sizeBytes": 4096,', '      "type": "apb_uart"', '    },',
        '    {', '      "baseAddress": "0x10002000",', '      "endAddress": "0x10002fff",', '      "kind": "peripheral",', '      "name": "gpio0",', '      "sizeBytes": 4096,', '      "type": "apb_gpio"', '    },',
        '    {', '      "baseAddress": "0x10003000",', '      "endAddress": "0x10003fff",', '      "kind": "peripheral",', '      "name": "intc0",', '      "sizeBytes": 4096,', '      "type": "apb_intc"', '    },',
        '    {', '      "baseAddress": "0x10004000",', '      "endAddress": "0x10004fff",', '      "kind": "external",', '      "name": "apb_ext0",', '      "sizeBytes": 4096,', '      "type": "apb"', '    },',
        '    {', '      "baseAddress": "0x20000000",', '      "endAddress": "0x20ffffff",', '      "kind": "external",', '      "name": "axi0",', '      "sizeBytes": 16777216,', '      "type": "axi4_lite"', '    }', '  ],', '  "memory": {',
        '    "dlb": {', '      "baseAddress": "0x08000000",', '      "endAddress": "0x0800ffff",', '      "name": "dlb",', '      "sizeBytes": 65536', '    },',
        '    "ilb": {', '      "baseAddress": "0x00000000",', '      "endAddress": "0x00007fff",', '      "name": "ilb",', '      "sizeBytes": 32768', '    }', '  },', '  "project": "demo_soc"', '}', '',
    ].join('\n'));

    assert.strictEqual(header, [
        '#ifndef DEMO_SOC_H', '#define DEMO_SOC_H', '#define DEMO_SOC_ILB_BASE 0x00000000', '#define DEMO_SOC_ILB_SIZE 32768', '#define DEMO_SOC_ILB_END 0x00007fff', '#define DEMO_SOC_FEATURE_ILB_INTERNAL_RAM 1', '#define DEMO_SOC_DLB_BASE 0x08000000', '#define DEMO_SOC_DLB_SIZE 65536', '#define DEMO_SOC_DLB_END 0x0800ffff', '#define DEMO_SOC_FEATURE_DLB_EXTERNAL_LOCAL_BUS 1', '#define DEMO_SOC_FEATURE_DEBUG 1', '#define DEMO_SOC_UART0_BASE 0x10000000', '#define DEMO_SOC_UART0_SIZE 4096', '#define DEMO_SOC_UART0_END 0x10000fff', '#define DEMO_SOC_FEATURE_UART0 1', '#define DEMO_SOC_UART1_BASE 0x10001000', '#define DEMO_SOC_UART1_SIZE 4096', '#define DEMO_SOC_UART1_END 0x10001fff', '#define DEMO_SOC_FEATURE_UART1 1', '#define DEMO_SOC_GPIO0_BASE 0x10002000', '#define DEMO_SOC_GPIO0_SIZE 4096', '#define DEMO_SOC_GPIO0_END 0x10002fff', '#define DEMO_SOC_FEATURE_GPIO0 1', '#define DEMO_SOC_INTC0_BASE 0x10003000', '#define DEMO_SOC_INTC0_SIZE 4096', '#define DEMO_SOC_INTC0_END 0x10003fff', '#define DEMO_SOC_FEATURE_INTC0 1', '#define DEMO_SOC_APB_EXT0_BASE 0x10004000', '#define DEMO_SOC_APB_EXT0_SIZE 4096', '#define DEMO_SOC_APB_EXT0_END 0x10004fff', '#define DEMO_SOC_FEATURE_APB_EXT0 1', '#define DEMO_SOC_AXI0_BASE 0x20000000', '#define DEMO_SOC_AXI0_SIZE 16777216', '#define DEMO_SOC_AXI0_END 0x20ffffff', '#define DEMO_SOC_FEATURE_AXI0 1', '#define MERC32_IRQ_TRIGGER_HIGH 0', '#define MERC32_IRQ_TRIGGER_LOW 1', '#define MERC32_IRQ_TRIGGER_RISING 2', '#define MERC32_IRQ_TRIGGER_FALLING 3', '#define DEMO_SOC_UART0_IRQ 0', '#define DEMO_SOC_UART0_IRQ_TRIGGER MERC32_IRQ_TRIGGER_HIGH', '#define DEMO_SOC_UART1_IRQ 1', '#define DEMO_SOC_UART1_IRQ_TRIGGER MERC32_IRQ_TRIGGER_LOW', '#define DEMO_SOC_GPIO0_IRQ 2', '#define DEMO_SOC_GPIO0_IRQ_TRIGGER MERC32_IRQ_TRIGGER_RISING', '#define DEMO_SOC_EXTERNAL_WAKE_IRQ 3', '#define DEMO_SOC_EXTERNAL_WAKE_IRQ_TRIGGER MERC32_IRQ_TRIGGER_FALLING', '#endif', '',
    ].join('\n'));
    assert.doesNotMatch(header, /#define\s+\w+\s*\(/);

    const expectedFiles = [
        'rtl/demo_soc.v', 'rtl/generated/demo_soc_plb_router.v',
        'rtl/generated/demo_soc_apb_interconnect.v',
        'rtl/apb_gpio/apb_gpio.v', 'rtl/apb_intc/apb_intc.v', 'rtl/apb_uart/apb_uart.v',
        'rtl/bridge/lb2apb.v', 'rtl/bridge/lb2axi_lite.v', 'rtl/cpu/MERC32_top.v',
        'rtl/cpu/core.v', 'rtl/debug/jtag_debug.v', 'rtl/misc/div.v', 'rtl/misc/mul.v',
        'rtl/misc/spram.v', 'rtl/files.f', 'memory/ilb_firmware.mem',
        'software/include/demo_soc.h', 'software/src/main.c',
        'config/demo_soc.resolved.json', 'address-map.json', 'manifest.json', 'README.md', 'LICENSE',
    ];
    assert.deepStrictEqual(soc.expectedGeneratedFiles(controllerPlan), expectedFiles);
    const readmeFiles = readme.slice(
        readme.indexOf('## Generated files\n\n') + '## Generated files\n\n'.length,
        readme.indexOf('\n## Generation identity'),
    );
    assert.strictEqual(readmeFiles, `${expectedFiles.map((file) => `- \`${file}\``).join('\n')}\n`);
    assert.match(readme, /^# demo_soc\n\nTop module: `demo_soc`\n/m);
    assert.doesNotMatch(readme, /successfully generated/i);

    assert.strictEqual(starterMain, [
        '#include "../include/demo_soc.h"',
        '',
        'int main(void) {',
        '    while (1) {',
        '    }',
        '    return 0;',
        '}',
        '',
    ].join('\n'));
    const softwareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-software-emitter-'));
    try {
        const headerFile = path.join(softwareRoot, 'include', 'demo_soc.h');
        const mainFile = path.join(softwareRoot, 'src', 'main.c');
        fs.mkdirSync(path.dirname(headerFile), { recursive: true });
        fs.mkdirSync(path.dirname(mainFile), { recursive: true });
        fs.writeFileSync(headerFile, header);
        fs.writeFileSync(mainFile, starterMain);
        const result = compileCFile(mainFile, { moduleName: 'generated_main' });
        assert.ok(new SimpleCPUAssembler().assemble(result.assembly, {
            sourceFileName: 'generated_main.asm',
        }).machineCodes.length > 0);
    } finally {
        fs.rmSync(softwareRoot, { recursive: true, force: true });
    }
    const top = soc.renderSocTop(controllerPlan);
    const router = soc.renderPlbRouter(controllerPlan);
    const apb = soc.renderApbInterconnect(controllerPlan);

    // Removing the integration top, bridge parameters, physical ports, stateful
    // router, or shared APB decoder must break these observable RTL contracts.
    assert.match(top, /^module demo_soc\b/m);
    assert.match(top, /MERC32_top #\(/);
    assert.match(top, /apb_uart[^;]*uart0_inst/s);
    assert.match(top, /\.AXI_ADDR_WIDTH\s*\(32\)/);
    assert.match(top, /output wire \[11:0\] apb_ext0_m_apb_paddr/);
    assert.match(top, /\.lb_addr\s*\(apb_ext0_router_addr\[11:0\]\)/);
    assert.match(top, /\.lb_addr\s*\(axi0_router_addr\[31:0\]\)/);
    assert.strictEqual((top.match(/builtin_apb_bridge_inst/g) || []).length, 1);
    assert.match(top, /apb_intc[^;]*intc0_inst/s);
    assert.strictEqual((top.match(/\bapb_intc\b/g) || []).length, 1);
    assert.match(top, /\.IRQ_COUNT\s*\(4\)/);
    assert.match(top, /\.IRQ_MODE\s*\(64'he4\)/);
    assert.match(top, /reg external_wake_meta/);
    assert.match(top, /reg external_wake_sync/);
    assert.match(top, /reg \[1:0\] external_wake_history_valid/);
    assert.match(top, /reg external_wake_conditioned/);
    assert.match(top, /reg external_wake_armed/);
    assert.match(top, /intc0_irq_sources\[3\] = external_wake_conditioned/);
    assert.match(top, /\.interrupt\s*\(intc0_interrupt\)/);
    assert.match(router, /32'h2000_0000/);
    assert.match(router, /active_endpoint/);
    assert.match(router, /if \(m_ack\)/);
    assert.match(apb, /^module demo_soc_apb_interconnect\b/m);
    assert.match(apb, /output wire uart0_psel/);
    assert.match(apb, /output wire intc0_psel/);
    assert.doesNotMatch(`${top}\n${router}\n${apb}`,
        /\b(?:logic|always_comb|interface|package|struct)\b|`ifdef IF_/);
    assert.strictEqual(soc.renderSocTop(controllerPlan), top);
    assert.strictEqual(soc.renderPlbRouter(controllerPlan), router);
    assert.strictEqual(soc.renderApbInterconnect(controllerPlan), apb);

    const all = JSON.parse(fs.readFileSync(
        path.join(fixtureDirectory, 'all-peripherals.merc32.json'), 'utf8'));
    const allTop = soc.renderSocTop(planFixture(all, 'all-peripherals.merc32.json'));
    assert.match(allTop, /assign av0_router_ack = av0_bridge_valid;/);
    assert.doesNotMatch(allTop, /av0_bridge_valid\s*\|/);

    const minimal = JSON.parse(fs.readFileSync(
        path.join(fixtureDirectory, 'minimal.merc32.json'), 'utf8'));
    const minimalPlan = planFixture(minimal, 'minimal.merc32.json');
    assert.deepStrictEqual(soc.expectedGeneratedFiles(minimalPlan), [
        'rtl/minimal_soc.v', 'rtl/generated/minimal_soc_plb_router.v',
        'rtl/cpu/MERC32_top.v', 'rtl/cpu/core.v', 'rtl/misc/div.v', 'rtl/misc/mul.v',
        'rtl/files.f', 'software/include/minimal_soc.h', 'software/src/main.c',
        'config/minimal_soc.resolved.json', 'address-map.json', 'manifest.json', 'README.md', 'LICENSE',
    ]);
    const memoryInitInventory = clone(minimal);
    memoryInitInventory.memory.ilb = {
        type: 'internal_ram', size: '32KiB', initFile: 'boot/firmware.mem',
    };
    memoryInitInventory.memory.dlb = {
        type: 'internal_ram', size: '64KiB', initFile: 'data/firmware.mem',
    };
    const memoryInitPlan = planFixture(memoryInitInventory, 'memory-init-inventory.merc32.json');
    assert.deepStrictEqual(soc.expectedGeneratedFiles(memoryInitPlan).filter((file) => file.startsWith('memory/')), [
        'memory/ilb_firmware.mem', 'memory/dlb_firmware.mem',
    ]);
    assert.match(soc.renderResolvedConfig(memoryInitPlan), /"initFile": "ilb_firmware\.mem"/);
    assert.match(soc.renderResolvedConfig(memoryInitPlan), /"initFile": "dlb_firmware\.mem"/);
    assert.match(soc.renderGeneratedReadme(memoryInitPlan), /- `memory\/ilb_firmware\.mem`/);
    assert.match(soc.renderGeneratedReadme(memoryInitPlan), /- `memory\/dlb_firmware\.mem`/);
    const inactiveFeatureCollision = clone(minimal);
    inactiveFeatureCollision.memory.ilb.type = 'internal_ram';
    inactiveFeatureCollision.externalInterfaces = [{
        type: 'local_bus', name: 'ilb_external_local_bus', baseAddress: '0x20000000',
        windowSize: '4KiB', addressWidth: 12,
    }];
    assert.ok(soc.planSoc(inactiveFeatureCollision, catalog).plan,
        'an endpoint may use an inactive ILB feature macro namespace');
    const activeFeatureCollision = clone(inactiveFeatureCollision);
    activeFeatureCollision.memory.ilb.type = 'external_local_bus';
    const activeCollision = soc.planSoc(activeFeatureCollision, catalog);
    assert.strictEqual(activeCollision.plan, undefined);
    assert.match(JSON.stringify(activeCollision.diagnostics), /SOC_MACRO_COLLISION/);
    const inactiveDlbFeatureCollision = clone(minimal);
    inactiveDlbFeatureCollision.memory.dlb.type = 'external_local_bus';
    inactiveDlbFeatureCollision.externalInterfaces = [{
        type: 'local_bus', name: 'dlb_internal_ram', baseAddress: '0x20000000',
        windowSize: '4KiB', addressWidth: 12,
    }];
    assert.ok(soc.planSoc(inactiveDlbFeatureCollision, catalog).plan,
        'an endpoint may use an inactive DLB feature macro namespace');
    const activeDlbFeatureCollision = clone(inactiveDlbFeatureCollision);
    activeDlbFeatureCollision.memory.dlb.type = 'internal_ram';
    const activeDlbCollision = soc.planSoc(activeDlbFeatureCollision, catalog);
    assert.strictEqual(activeDlbCollision.plan, undefined);
    assert.match(JSON.stringify(activeDlbCollision.diagnostics), /SOC_MACRO_COLLISION/);
    const noneTop = soc.renderSocTop(minimalPlan);
    assert.match(noneTop, /\.interrupt\s*\(1'b0\)/);
    assert.strictEqual(soc.renderApbInterconnect(
        minimalPlan), undefined);

    const direct = clone(minimal);
    direct.peripherals = [{
        type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000',
    }];
    direct.interrupt = { mode: 'direct', source: 'uart0.interrupt' };
    const directTop = soc.renderSocTop(planFixture(direct, 'direct.merc32.json'));
    assert.match(directTop, /\.interrupt\s*\(uart0_interrupt\)/);
    assert.doesNotMatch(directTop, /\bapb_intc\b/);

    const directExternal = clone(minimal);
    directExternal.interrupt = { mode: 'direct', source: 'external.wake' };
    const directExternalTop = soc.renderSocTop(
        planFixture(directExternal, 'direct-external.merc32.json'));
    assert.match(directExternalTop, /input wire external_wake/);
    assert.match(directExternalTop, /\.interrupt\s*\(external_wake\)/);
    assert.doesNotMatch(directExternalTop, /external_wake_(?:meta|sync)/);

    const reservedName = clone(minimal);
    reservedName.externalInterfaces = [{
        type: 'local_bus', name: 'none', baseAddress: '0x20000000',
        windowSize: '4KiB', addressWidth: 12,
    }];
    const reservedRouter = soc.renderPlbRouter(
        planFixture(reservedName, 'reserved-name.merc32.json'));
    assert.match(reservedRouter, /ENDPOINT_NONE\b/);
    assert.match(reservedRouter, /ENDPOINT_TARGET_NONE\b/);

    assertGenerationOrchestration();

    console.log('MERC32 SoC emitter and safe generation tests passed.');
} finally {
    fs.rmSync(assetRoot, { recursive: true, force: true });
}
