const assert = require('assert');
const path = require('path');

const TARGET_DEFINITIONS = Object.freeze([
    Object.freeze({ label: 'resources/rtl', relativePath: 'resources/rtl', backupName: 'rtl' }),
    Object.freeze({
        label: 'resources/licenses',
        relativePath: 'resources/licenses',
        backupName: 'licenses',
    }),
    Object.freeze({
        label: 'resources/resource-manifest.json',
        relativePath: 'resources/resource-manifest.json',
        backupName: 'resource-manifest.json',
    }),
]);

function buildResourceProbePlan(extensionRoot, token) {
    assert.match(token, /^[0-9a-f]{24}$/u, 'resource probe token must contain 24 lowercase hex digits');
    const resolvedExtensionRoot = path.resolve(extensionRoot);
    const resourcesRoot = path.join(resolvedExtensionRoot, 'resources');
    const cacheRoot = path.join(resolvedExtensionRoot, '.vscode-test');
    const probeRoot = path.join(cacheRoot, `resource-probe-${token}`);
    const plan = {
        extensionRoot: resolvedExtensionRoot,
        resourcesRoot,
        cacheRoot,
        probeRoot,
        schemaFile: path.join(resourcesRoot, 'schema', 'merc32.schema.json'),
        schemaBackup: path.join(probeRoot, 'merc32.schema.json'),
        targets: TARGET_DEFINITIONS.map((definition) => Object.freeze({
            label: definition.label,
            target: path.join(resolvedExtensionRoot, ...definition.relativePath.split('/')),
            backup: path.join(probeRoot, definition.backupName),
            backupName: definition.backupName,
        })),
    };
    validateResourceProbePlan(plan);
    plan.targets = Object.freeze(plan.targets);
    return Object.freeze(plan);
}

function runResourceProbe(options) {
    const {
        plan,
        fsApi,
        beforeMutation,
        prepare,
        assertPrepared,
        observeStates,
    } = options;
    let primaryFailure;
    const cleanupFailures = [];
    let cacheCreated = false;
    let probeCreated = false;
    let schemaSnapshot;
    let preparationStarted = false;
    let targetStates = [];
    const schemaState = {
        snapshotSucceeded: false,
        moveSucceeded: false,
        workingCreated: false,
        restoreSucceeded: false,
    };

    try {
        validateResourceProbePlan(plan);
        validateFsAdapter(fsApi);
        assert.strictEqual(typeof beforeMutation, 'function', 'beforeMutation callback is required');
        assert.strictEqual(typeof prepare, 'function', 'prepare callback is required');
        assert.strictEqual(typeof assertPrepared, 'function', 'assertPrepared callback is required');
        beforeMutation();

        requireExactDirectoryEntry(fsApi, plan.extensionRoot, 'extension root');
        requireExactDirectoryEntry(fsApi, plan.resourcesRoot, 'resources root');
        requireExactFileEntry(fsApi, plan.schemaFile, 'tracked schema');
        const cacheEntry = fsApi.lstat(plan.cacheRoot);
        if (cacheEntry !== undefined
            && (cacheEntry.isSymbolicLink() || !cacheEntry.isDirectory())) {
            throw new Error(`VSCode test cache root is not an exact directory: ${plan.cacheRoot}`);
        }
        if (fsApi.lstat(plan.probeRoot) !== undefined) {
            throw new Error(`Resource probe root already exists: ${plan.probeRoot}`);
        }
        targetStates = plan.targets.map((entry) => ({
            ...entry,
            originalDetected: fsApi.lstat(entry.target) !== undefined,
            moveSucceeded: false,
            generatedCreated: false,
            restoreSucceeded: false,
        }));

        if (cacheEntry === undefined) {
            fsApi.mkdir(plan.cacheRoot);
            cacheCreated = true;
        }
        fsApi.mkdir(plan.probeRoot);
        probeCreated = true;
        schemaSnapshot = snapshotSchema(fsApi, plan.schemaFile);
        schemaState.snapshotSucceeded = true;
        preserveSchemaEntry(fsApi, plan, schemaSnapshot, schemaState);

        for (const state of targetStates) {
            if (!state.originalDetected) continue;
            moveOriginalTarget(fsApi, state);
        }

        preparationStarted = true;
        prepare();
        assertPrepared();
    } catch (error) {
        primaryFailure = error;
    } finally {
        if (preparationStarted) {
            markGeneratedEntries(plan, fsApi, targetStates, cleanupFailures);
        }
        for (const state of [...targetStates].reverse()) {
            restoreTargetEntry(plan, fsApi, state, cleanupFailures);
        }
        if (schemaSnapshot !== undefined) {
            restoreSchemaEntry(plan, fsApi, schemaSnapshot, schemaState, cleanupFailures);
        }
        if (probeCreated) {
            captureCleanupFailure(cleanupFailures, 'remove exact resource probe root', () => {
                fsApi.rmdir(plan.probeRoot);
            });
        }
        if (cacheCreated) {
            captureCleanupFailure(cleanupFailures, 'remove newly created VSCode test cache root', () => {
                fsApi.rmdir(plan.cacheRoot);
            });
        }
        if (observeStates !== undefined) {
            captureCleanupFailure(cleanupFailures, 'publish resource probe state', () => {
                observeStates(snapshotTargetStates(targetStates));
            });
        }
    }

    throwProbeFailures(primaryFailure, cleanupFailures);
    return snapshotTargetStates(targetStates);
}

function validateResourceProbePlan(plan) {
    assert.ok(plan && typeof plan === 'object', 'resource probe plan is required');
    const extensionRoot = path.resolve(plan.extensionRoot);
    assertSamePath(plan.extensionRoot, extensionRoot, 'extension root');
    const resourcesRoot = path.join(extensionRoot, 'resources');
    const cacheRoot = path.join(extensionRoot, '.vscode-test');
    assertSamePath(plan.resourcesRoot, resourcesRoot, 'resources root');
    assertSamePath(plan.cacheRoot, cacheRoot, 'VSCode test cache root');
    assertExactDescendant(extensionRoot, resourcesRoot, 'resources root');
    assertExactDescendant(extensionRoot, cacheRoot, 'VSCode test cache root');

    assert.strictEqual(path.dirname(path.resolve(plan.probeRoot)), path.resolve(cacheRoot),
        'resource probe root must be an exact child of the VSCode test cache root');
    assert.match(path.basename(plan.probeRoot), /^resource-probe-[0-9a-f]{24}$/u,
        'resource probe root has an invalid name');
    assertExactDescendant(extensionRoot, plan.probeRoot, 'resource probe root');
    assertSamePath(
        plan.schemaFile,
        path.join(resourcesRoot, 'schema', 'merc32.schema.json'),
        'tracked schema',
    );
    assertSamePath(
        plan.schemaBackup,
        path.join(plan.probeRoot, 'merc32.schema.json'),
        'tracked schema backup',
    );
    assertExactDescendant(plan.probeRoot, plan.schemaBackup, 'tracked schema backup');

    assert.ok(Array.isArray(plan.targets), 'resource probe targets must be an array');
    assert.strictEqual(plan.targets.length, TARGET_DEFINITIONS.length,
        'resource probe must contain only the exact generated targets');
    const targetKeys = new Set();
    plan.targets.forEach((entry, index) => {
        const definition = TARGET_DEFINITIONS[index];
        const expectedTarget = path.join(extensionRoot, ...definition.relativePath.split('/'));
        const expectedBackup = path.join(plan.probeRoot, definition.backupName);
        assert.strictEqual(entry.label, definition.label);
        assert.strictEqual(entry.backupName, definition.backupName);
        assertSamePath(entry.target, expectedTarget, `${definition.label} target`);
        assertSamePath(entry.backup, expectedBackup, `${definition.label} backup`);
        assertExactDescendant(resourcesRoot, entry.target, `${definition.label} target`);
        assertExactDescendant(plan.probeRoot, entry.backup, `${definition.label} backup`);
        const key = comparablePath(entry.target);
        assert.ok(!targetKeys.has(key), `duplicate resource probe target: ${entry.target}`);
        targetKeys.add(key);
    });
}

function validateFsAdapter(fsApi) {
    for (const method of [
        'lstat', 'stat', 'mkdir', 'rmdir', 'rename', 'readFile', 'writeFile',
        'unlink', 'rmTree',
    ]) {
        assert.strictEqual(typeof fsApi?.[method], 'function', `filesystem adapter lacks ${method}`);
    }
}

function requireExactDirectoryEntry(fsApi, target, label) {
    const status = fsApi.lstat(target);
    if (status === undefined || status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error(`${label} is not an exact directory: ${target}`);
    }
}

function requireExactFileEntry(fsApi, target, label) {
    const status = fsApi.lstat(target);
    if (status === undefined || status.isSymbolicLink() || !status.isFile()) {
        throw new Error(`${label} is not an exact file: ${target}`);
    }
}

function snapshotSchema(fsApi, schemaFile) {
    const status = fsApi.stat(schemaFile);
    assert.ok(status.isFile(), 'tracked MERC32 schema is missing');
    const bytes = fsApi.readFile(schemaFile);
    return Object.freeze({ bytes: Buffer.from(bytes), mtimeMs: status.mtimeMs });
}

function preserveSchemaEntry(fsApi, plan, snapshot, state) {
    try {
        fsApi.rename(plan.schemaFile, plan.schemaBackup);
        state.moveSucceeded = true;
    } catch (error) {
        reconcileMoveAfterFailure(fsApi, plan.schemaFile, plan.schemaBackup, state, error,
            'tracked schema');
        throw error;
    }

    try {
        fsApi.writeFile(plan.schemaFile, snapshot.bytes);
        state.workingCreated = true;
    } catch (error) {
        try {
            state.workingCreated = fsApi.lstat(plan.schemaFile) !== undefined;
        } catch (reconcileError) {
            throw new AggregateError(
                [error, reconcileError],
                'Tracked schema working-copy creation failed ambiguously.',
            );
        }
        throw error;
    }
}

function reconcileMoveAfterFailure(fsApi, source, destination, state, error, label) {
    try {
        if (fsApi.lstat(source) === undefined && fsApi.lstat(destination) !== undefined) {
            state.moveSucceeded = true;
        }
    } catch (reconcileError) {
        throw new AggregateError(
            [error, reconcileError],
            `${label} move failed ambiguously.`,
        );
    }
}

function moveOriginalTarget(fsApi, state) {
    try {
        fsApi.rename(state.target, state.backup);
        state.moveSucceeded = true;
    } catch (error) {
        reconcileMoveAfterFailure(fsApi, state.target, state.backup, state, error, state.label);
        throw error;
    }
}

function markGeneratedEntries(plan, fsApi, states, failures) {
    for (const state of states) {
        if (state.originalDetected && !state.moveSucceeded) continue;
        captureCleanupFailure(failures, `inspect generated ${state.label}`, () => {
            assertAllowedTarget(plan, state.target);
            state.generatedCreated = fsApi.lstat(state.target) !== undefined;
        });
    }
}

function restoreTargetEntry(plan, fsApi, state, failures) {
    if (state.originalDetected && !state.moveSucceeded) {
        const result = attemptCleanup(failures, `verify untouched ${state.label}`, () => {
            if (fsApi.lstat(state.target) === undefined) {
                throw new Error(`untouched original disappeared: ${state.target}`);
            }
        });
        state.restoreSucceeded = result.ok;
        return;
    }

    let targetReady = true;
    if (state.generatedCreated) {
        const removal = attemptCleanup(failures, `remove generated ${state.label}`, () => {
            removeExactEntry(plan, fsApi, state.target);
        });
        if (!removal.ok) {
            targetReady = reconcileAbsentTarget(fsApi, state.target, failures, state.label);
        }
    } else {
        const absent = attemptCleanup(failures, `verify absent ${state.label}`, () => {
            if (fsApi.lstat(state.target) !== undefined) {
                throw new Error(`unrecorded entry occupies ${state.target}`);
            }
        });
        targetReady = absent.ok;
    }

    if (!state.originalDetected) {
        state.restoreSucceeded = targetReady;
        return;
    }
    if (!targetReady) return;

    const restored = attemptCleanup(failures, `restore prior ${state.label}`, () => {
        fsApi.rename(state.backup, state.target);
    });
    if (restored.ok) {
        state.restoreSucceeded = true;
        return;
    }
    const reconciled = attemptCleanup(failures, `reconcile restored ${state.label}`, () => {
        if (fsApi.lstat(state.backup) !== undefined || fsApi.lstat(state.target) === undefined) {
            throw new Error(`prior entry was not restored to ${state.target}`);
        }
    });
    state.restoreSucceeded = reconciled.ok;
}

function reconcileAbsentTarget(fsApi, target, failures, label) {
    return attemptCleanup(failures, `reconcile removed ${label}`, () => {
        if (fsApi.lstat(target) !== undefined) {
            throw new Error(`generated entry remains at ${target}`);
        }
    }).ok;
}

function removeExactEntry(plan, fsApi, target) {
    assertAllowedTarget(plan, target);
    const status = fsApi.lstat(target);
    if (status === undefined) return;
    if (status.isSymbolicLink() || !status.isDirectory()) {
        fsApi.unlink(target);
        return;
    }
    fsApi.rmTree(target);
}

function assertAllowedTarget(plan, target) {
    assert.ok(
        plan.targets.some((entry) => samePath(entry.target, target)),
        `refusing to access unexpected resource target: ${path.resolve(target)}`,
    );
}

function restoreSchemaEntry(plan, fsApi, snapshot, state, failures) {
    if (!state.snapshotSucceeded) return;
    if (!state.moveSucceeded) {
        const untouched = attemptCleanup(failures, 'verify untouched tracked schema', () => {
            assertExactSchema(fsApi, plan.schemaFile, snapshot);
        });
        state.restoreSucceeded = untouched.ok;
        return;
    }

    let schemaPathReady = true;
    const currentEntry = attemptCleanup(failures, 'inspect tracked schema replacement', () =>
        fsApi.lstat(plan.schemaFile));
    if (!currentEntry.ok) {
        schemaPathReady = false;
    } else if (currentEntry.value !== undefined) {
        const removed = attemptCleanup(failures, 'remove tracked schema replacement', () => {
            removeExactSchemaEntry(plan, fsApi);
        });
        if (!removed.ok) {
            schemaPathReady = reconcileAbsentTarget(
                fsApi,
                plan.schemaFile,
                failures,
                'tracked schema replacement',
            );
        }
    }
    if (!schemaPathReady) return;

    const restored = attemptCleanup(failures, 'restore prior tracked schema entry', () => {
        fsApi.rename(plan.schemaBackup, plan.schemaFile);
    });
    let renameRestored = restored.ok;
    if (!renameRestored) {
        const reconciled = attemptCleanup(failures, 'reconcile restored tracked schema', () => {
            if (fsApi.lstat(plan.schemaBackup) !== undefined
                || fsApi.lstat(plan.schemaFile) === undefined) {
                throw new Error(`prior tracked schema was not restored to ${plan.schemaFile}`);
            }
        });
        renameRestored = reconciled.ok;
    }
    if (!renameRestored) return;

    const verified = attemptCleanup(failures, 'verify restored tracked schema', () => {
        assertExactSchema(fsApi, plan.schemaFile, snapshot);
    });
    state.restoreSucceeded = verified.ok;
}

function removeExactSchemaEntry(plan, fsApi) {
    assertSamePath(plan.schemaFile,
        path.join(plan.resourcesRoot, 'schema', 'merc32.schema.json'), 'tracked schema');
    const status = fsApi.lstat(plan.schemaFile);
    if (status === undefined) return;
    if (status.isSymbolicLink() || !status.isDirectory()) {
        fsApi.unlink(plan.schemaFile);
        return;
    }
    fsApi.rmTree(plan.schemaFile);
}

function assertExactSchema(fsApi, schemaFile, snapshot) {
    const status = fsApi.lstat(schemaFile);
    assert.ok(status !== undefined && !status.isSymbolicLink() && status.isFile(),
        'tracked schema was not restored as an exact file entry');
    assert.deepStrictEqual(fsApi.readFile(schemaFile), snapshot.bytes);
    assert.strictEqual(fsApi.stat(schemaFile).mtimeMs, snapshot.mtimeMs);
}

function captureCleanupFailure(failures, label, action) {
    attemptCleanup(failures, label, action);
}

function attemptCleanup(failures, label, action) {
    try {
        return { ok: true, value: action() };
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(new Error(`${label}: ${detail}`, { cause: error }));
        return { ok: false };
    }
}

function throwProbeFailures(primaryFailure, cleanupFailures) {
    if (primaryFailure !== undefined && cleanupFailures.length > 0) {
        throw new AggregateError(
            [primaryFailure, ...cleanupFailures],
            'Extension resource probe and cleanup both failed.',
        );
    }
    if (primaryFailure !== undefined) throw primaryFailure;
    if (cleanupFailures.length > 0) {
        throw new AggregateError(cleanupFailures, 'Extension resource probe cleanup failed.');
    }
}

function snapshotTargetStates(states) {
    return states.map((state) => Object.freeze({
        label: state.label,
        target: state.target,
        backup: state.backup,
        originalDetected: state.originalDetected,
        moveSucceeded: state.moveSucceeded,
        generatedCreated: state.generatedCreated,
        restoreSucceeded: state.restoreSucceeded,
    }));
}

function assertSamePath(actual, expected, label) {
    assert.ok(samePath(actual, expected), `${label} is not the exact validated path`);
}

function assertExactDescendant(parent, child, label) {
    const relative = path.relative(path.resolve(parent), path.resolve(child));
    assert.ok(
        relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
            && !path.isAbsolute(relative),
        `${label} must stay below ${path.resolve(parent)}`,
    );
}

function samePath(left, right) {
    return comparablePath(left) === comparablePath(right);
}

function comparablePath(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}

function createNodeFsAdapter(fsModule) {
    return Object.freeze({
        lstat: (target) => fsModule.lstatSync(target, { throwIfNoEntry: false }),
        stat: (target) => fsModule.statSync(target),
        mkdir: (target) => fsModule.mkdirSync(target),
        rmdir: (target) => fsModule.rmdirSync(target),
        rename: (source, destination) => fsModule.renameSync(source, destination),
        readFile: (target) => fsModule.readFileSync(target),
        writeFile: (target, bytes) => fsModule.writeFileSync(target, bytes),
        utimes: (target, atime, mtime) => fsModule.utimesSync(target, atime, mtime),
        unlink: (target) => fsModule.unlinkSync(target),
        rmTree: (target) => fsModule.rmSync(target, { recursive: true, force: false }),
    });
}

module.exports = {
    buildResourceProbePlan,
    createNodeFsAdapter,
    runResourceProbe,
};
