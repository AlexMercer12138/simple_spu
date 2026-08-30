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
    const schemaRoot = path.join(resourcesRoot, 'schema');
    const cacheRoot = path.join(resolvedExtensionRoot, '.vscode-test');
    const probeRoot = path.join(cacheRoot, `resource-probe-${token}`);
    const plan = {
        extensionRoot: resolvedExtensionRoot,
        resourcesRoot,
        schemaRoot,
        cacheRoot,
        probeRoot,
        schemaFile: path.join(schemaRoot, 'merc32.schema.json'),
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
    const cacheState = createRootState(plan.cacheRoot);
    const probeState = createRootState(plan.probeRoot);
    let schemaSnapshot;
    let preparationStarted = false;
    let targetStates = [];
    const schemaState = {
        snapshotSucceeded: false,
        moveSucceeded: false,
        workingCreated: false,
        workingIdentity: undefined,
        restoreSucceeded: false,
    };

    try {
        validateResourceProbePlan(plan);
        validateFsAdapter(fsApi);
        assert.strictEqual(typeof beforeMutation, 'function', 'beforeMutation callback is required');
        assert.strictEqual(typeof prepare, 'function', 'prepare callback is required');
        assert.strictEqual(typeof assertPrepared, 'function', 'assertPrepared callback is required');
        beforeMutation();

        requireExactSchemaEntry(fsApi, plan);
        const cacheEntry = lstatWithRealParent(
            fsApi,
            plan,
            plan.cacheRoot,
            'VSCode test cache root',
        );
        cacheState.originalDetected = cacheEntry !== undefined;
        if (cacheEntry !== undefined
            && (cacheEntry.isSymbolicLink() || !cacheEntry.isDirectory())) {
            throw new Error(`VSCode test cache root is not an exact directory: ${plan.cacheRoot}`);
        }
        const probeEntry = cacheEntry === undefined
            ? undefined
            : lstatWithRealParent(
                fsApi,
                plan,
                plan.probeRoot,
                'resource probe root',
            );
        probeState.originalDetected = probeEntry !== undefined;
        if (probeEntry !== undefined) {
            throw new Error(`Resource probe root already exists: ${plan.probeRoot}`);
        }
        targetStates = plan.targets.map((entry) => {
            const originalEntry = lstatWithRealParent(
                fsApi,
                plan,
                entry.target,
                entry.label,
            );
            return {
                ...entry,
                originalDetected: originalEntry !== undefined,
                originalIdentity: identityOf(originalEntry, entry.label),
                moveSucceeded: false,
                generatedCreated: false,
                generatedIdentity: undefined,
                restoreSucceeded: false,
            };
        });

        if (cacheEntry === undefined) {
            createOwnedDirectory(fsApi, plan, cacheState, 'VSCode test cache root');
        }
        createOwnedDirectory(fsApi, plan, probeState, 'resource probe root');
        schemaSnapshot = snapshotSchema(fsApi, plan);
        schemaState.snapshotSucceeded = true;
        preserveSchemaEntry(fsApi, plan, schemaSnapshot, schemaState);

        for (const state of targetStates) {
            if (!state.originalDetected) continue;
            moveOriginalTarget(fsApi, plan, state);
        }

        requirePreparationRoots(fsApi, plan);
        preparationStarted = true;
        prepare();
        requirePreparationRoots(fsApi, plan);
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
        cleanupOwnedRoot(
            fsApi,
            plan,
            probeState,
            cleanupFailures,
            'remove exact resource probe root',
            'resource probe root',
        );
        cleanupOwnedRoot(
            fsApi,
            plan,
            cacheState,
            cleanupFailures,
            'remove newly created VSCode test cache root',
            'VSCode test cache root',
        );
        if (observeStates !== undefined) {
            captureCleanupFailure(cleanupFailures, 'publish resource probe state', () => {
                observeStates(snapshotTargetStates(targetStates));
            });
        }
    }

    throwProbeFailures(primaryFailure, cleanupFailures);
    return snapshotTargetStates(targetStates);
}

function createRootState(target) {
    return {
        target,
        originalDetected: false,
        createSucceeded: false,
        createdIdentity: undefined,
        removeSucceeded: false,
    };
}

function createOwnedDirectory(fsApi, plan, state, label) {
    assert.strictEqual(state.originalDetected, false, `refusing to replace prior ${label}`);
    const validateCreation = () => {
        requireRealDirectoryChain(
            fsApi,
            plan.extensionRoot,
            path.dirname(state.target),
            `${label} parent`,
        );
        if (fsApi.lstat(state.target) !== undefined) {
            throw new Error(`${label} appeared before creation: ${state.target}`);
        }
    };
    validateCreation();

    const receipt = { applied: false };
    try {
        fsApi.mkdir(state.target, receipt, validateCreation);
        state.createSucceeded = true;
        state.createdIdentity = receipt.identity;
    } catch (error) {
        try {
            const entry = lstatWithRealParent(fsApi, plan, state.target, label);
            if (receipt.applied) {
                state.createSucceeded = true;
                state.createdIdentity = receipt.identity;
                state.removeSucceeded = entry === undefined;
            }
        } catch (reconcileError) {
            throw new AggregateError(
                [error, reconcileError],
                `${label} creation failed ambiguously.`,
            );
        }
        throw error;
    }
}

function cleanupOwnedRoot(fsApi, plan, state, failures, cleanupLabel, entryLabel) {
    if (!state.createSucceeded || state.removeSucceeded) return;
    captureCleanupFailure(failures, cleanupLabel, () => {
        removeOwnedRootEntry(fsApi, plan, state, entryLabel);
    });
}

function validateResourceProbePlan(plan) {
    assert.ok(plan && typeof plan === 'object', 'resource probe plan is required');
    const extensionRoot = path.resolve(plan.extensionRoot);
    assertSamePath(plan.extensionRoot, extensionRoot, 'extension root');
    const resourcesRoot = path.join(extensionRoot, 'resources');
    const schemaRoot = path.join(resourcesRoot, 'schema');
    const cacheRoot = path.join(extensionRoot, '.vscode-test');
    assertSamePath(plan.resourcesRoot, resourcesRoot, 'resources root');
    assertSamePath(plan.cacheRoot, cacheRoot, 'VSCode test cache root');
    assertExactDescendant(extensionRoot, resourcesRoot, 'resources root');
    assertExactDescendant(extensionRoot, cacheRoot, 'VSCode test cache root');
    assertSamePath(plan.schemaRoot, schemaRoot, 'schema root');
    assertExactDescendant(resourcesRoot, schemaRoot, 'schema root');

    assert.strictEqual(path.dirname(path.resolve(plan.probeRoot)), path.resolve(cacheRoot),
        'resource probe root must be an exact child of the VSCode test cache root');
    assert.match(path.basename(plan.probeRoot), /^resource-probe-[0-9a-f]{24}$/u,
        'resource probe root has an invalid name');
    assertExactDescendant(extensionRoot, plan.probeRoot, 'resource probe root');
    assertSamePath(
        plan.schemaFile,
        path.join(schemaRoot, 'merc32.schema.json'),
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
        'lstat', 'stat', 'mkdir', 'rmdir', 'rename', 'readFile', 'writeFile', 'createFile',
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

function identityOf(status, label) {
    if (status === undefined) return undefined;
    assert.notStrictEqual(
        status.entryIdentity,
        undefined,
        `filesystem adapter did not identify ${label}`,
    );
    return status.entryIdentity;
}

function requireIdentity(status, expectedIdentity, label) {
    const actualIdentity = identityOf(status, label);
    if (actualIdentity !== expectedIdentity) {
        throw new Error(`${label} identity changed`);
    }
    return status;
}

function requireRealDirectoryChain(fsApi, extensionRoot, directory, label) {
    const resolvedRoot = path.resolve(extensionRoot);
    const resolvedDirectory = path.resolve(directory);
    const relative = path.relative(resolvedRoot, resolvedDirectory);
    assert.ok(
        relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
            && !path.isAbsolute(relative)),
        `${label} must stay at or below ${resolvedRoot}`,
    );

    requireExactDirectoryEntry(fsApi, resolvedRoot, 'extension root');
    if (relative === '') return;
    let current = resolvedRoot;
    for (const component of relative.split(path.sep)) {
        current = path.join(current, component);
        const componentLabel = samePath(current, resolvedDirectory)
            ? label
            : `${path.basename(current)} root`;
        requireExactDirectoryEntry(fsApi, current, componentLabel);
    }
}

function lstatWithRealParent(fsApi, plan, target, label) {
    requireRealDirectoryChain(fsApi, plan.extensionRoot, path.dirname(target), `${label} parent`);
    return fsApi.lstat(target);
}

function requireExactSchemaEntry(fsApi, plan) {
    requireRealDirectoryChain(fsApi, plan.extensionRoot, plan.schemaRoot, 'schema root');
    return requireExactFileEntry(fsApi, plan.schemaFile, 'tracked schema');
}

function requirePreparationRoots(fsApi, plan) {
    requireRealDirectoryChain(fsApi, plan.extensionRoot, plan.resourcesRoot, 'resources root');
    requireRealDirectoryChain(fsApi, plan.extensionRoot, plan.schemaRoot, 'schema root');
    requireRealDirectoryChain(fsApi, plan.extensionRoot, plan.probeRoot, 'resource probe root');
    requireExactSchemaEntry(fsApi, plan);
}

function requireExactFileEntry(fsApi, target, label) {
    const status = fsApi.lstat(target);
    if (status === undefined || status.isSymbolicLink() || !status.isFile()) {
        throw new Error(`${label} is not an exact file: ${target}`);
    }
    identityOf(status, label);
    return status;
}

function snapshotSchema(fsApi, plan) {
    const schemaEntry = requireExactSchemaEntry(fsApi, plan);
    const status = fsApi.stat(plan.schemaFile);
    assert.ok(status.isFile(), 'tracked MERC32 schema is missing');
    requireExactSchemaEntry(fsApi, plan);
    const bytes = fsApi.readFile(plan.schemaFile);
    return Object.freeze({
        bytes: Buffer.from(bytes),
        mtimeMs: status.mtimeMs,
        identity: identityOf(schemaEntry, 'tracked schema'),
    });
}

function preserveSchemaEntry(fsApi, plan, snapshot, state) {
    requireIdentity(requireExactSchemaEntry(fsApi, plan), snapshot.identity, 'tracked schema');
    const validateSchemaMove = () => validateRenameEndpoints(
        fsApi,
        plan,
        plan.schemaFile,
        plan.schemaBackup,
        snapshot.identity,
        'tracked schema',
        'tracked schema backup',
    );
    validateSchemaMove();
    const renameReceipt = { applied: false };
    try {
        fsApi.rename(
            plan.schemaFile,
            plan.schemaBackup,
            snapshot.identity,
            renameReceipt,
            validateSchemaMove,
        );
        state.moveSucceeded = true;
    } catch (error) {
        reconcileMoveAfterFailure(
            fsApi,
            plan,
            plan.schemaFile,
            plan.schemaBackup,
            snapshot.identity,
            renameReceipt,
            state,
            error,
            'tracked schema',
        );
        throw error;
    }

    const createReceipt = { applied: false };
    const validateSchemaCreation = () => {
        requireRealDirectoryChain(fsApi, plan.extensionRoot, plan.schemaRoot, 'schema root');
        if (fsApi.lstat(plan.schemaFile) !== undefined) {
            throw new Error(`tracked schema replacement appeared before creation: ${plan.schemaFile}`);
        }
    };
    try {
        validateSchemaCreation();
        fsApi.createFile(plan.schemaFile, snapshot.bytes, createReceipt, validateSchemaCreation);
        state.workingCreated = true;
        state.workingIdentity = createReceipt.identity;
    } catch (error) {
        try {
            state.workingCreated = lstatWithRealParent(
                fsApi,
                plan,
                plan.schemaFile,
                'tracked schema replacement',
            ) !== undefined && createReceipt.applied;
            if (createReceipt.applied) state.workingIdentity = createReceipt.identity;
        } catch (reconcileError) {
            throw new AggregateError(
                [error, reconcileError],
                'Tracked schema working-copy creation failed ambiguously.',
            );
        }
        throw error;
    }
}

function removeOwnedRootEntry(fsApi, plan, state, label) {
    let status = lstatWithRealParent(fsApi, plan, state.target, label);
    if (status === undefined) {
        state.removeSucceeded = true;
        return;
    }
    if (state.createdIdentity === undefined
        || status.entryIdentity !== state.createdIdentity) {
        throw new Error(`${label} identity changed after creation: ${state.target}`);
    }

    const receipt = { applied: false };
    const validateRemoval = () => {
        status = lstatWithRealParent(fsApi, plan, state.target, label);
        if (status === undefined) throw new Error(`${label} disappeared before removal`);
        requireIdentity(status, state.createdIdentity, label);
    };
    try {
        if (status.isSymbolicLink() || !status.isDirectory()) {
            fsApi.unlink(state.target, state.createdIdentity, receipt, validateRemoval);
        } else {
            fsApi.rmdir(state.target, state.createdIdentity, receipt, validateRemoval);
        }
        state.removeSucceeded = true;
    } catch (error) {
        try {
            state.removeSucceeded = lstatWithRealParent(
                fsApi,
                plan,
                state.target,
                label,
            ) === undefined;
        } catch (reconcileError) {
            throw new AggregateError(
                [error, reconcileError],
                `${label} removal failed ambiguously.`,
            );
        }
        throw error;
    }
}

function reconcileMoveAfterFailure(
    fsApi,
    plan,
    source,
    destination,
    expectedIdentity,
    receipt,
    state,
    error,
    label,
) {
    try {
        const sourceEntry = lstatWithRealParent(fsApi, plan, source, label);
        const destinationEntry = lstatWithRealParent(
            fsApi,
            plan,
            destination,
            `${label} backup`,
        );
        if (receipt.applied && sourceEntry === undefined && destinationEntry !== undefined
            && identityOf(destinationEntry, `${label} backup`) === expectedIdentity) {
            state.moveSucceeded = true;
        }
    } catch (reconcileError) {
        throw new AggregateError(
            [error, reconcileError],
            `${label} move failed ambiguously.`,
        );
    }
}

function moveOriginalTarget(fsApi, plan, state) {
    const validateMove = () => validateRenameEndpoints(
        fsApi,
        plan,
        state.target,
        state.backup,
        state.originalIdentity,
        state.label,
        `${state.label} backup`,
    );
    validateMove();
    const receipt = { applied: false };
    try {
        fsApi.rename(
            state.target,
            state.backup,
            state.originalIdentity,
            receipt,
            validateMove,
        );
        state.moveSucceeded = true;
    } catch (error) {
        reconcileMoveAfterFailure(
            fsApi,
            plan,
            state.target,
            state.backup,
            state.originalIdentity,
            receipt,
            state,
            error,
            state.label,
        );
        throw error;
    }
}

function validateRenameEndpoints(
    fsApi,
    plan,
    source,
    destination,
    expectedSourceIdentity,
    sourceLabel,
    destinationLabel,
) {
    const sourceEntry = lstatWithRealParent(fsApi, plan, source, sourceLabel);
    if (sourceEntry === undefined) {
        throw new Error(`${sourceLabel} is missing before rename: ${source}`);
    }
    requireIdentity(sourceEntry, expectedSourceIdentity, sourceLabel);
    if (lstatWithRealParent(fsApi, plan, destination, destinationLabel) !== undefined) {
        throw new Error(`${destinationLabel} already exists before rename: ${destination}`);
    }
}

function markGeneratedEntries(plan, fsApi, states, failures) {
    for (const state of states) {
        if (state.originalDetected && !state.moveSucceeded) continue;
        captureCleanupFailure(failures, `inspect generated ${state.label}`, () => {
            assertAllowedTarget(plan, state.target);
            const generatedEntry = lstatWithRealParent(
                fsApi,
                plan,
                state.target,
                state.label,
            );
            state.generatedCreated = generatedEntry !== undefined;
            state.generatedIdentity = identityOf(generatedEntry, `generated ${state.label}`);
        });
    }
}

function restoreTargetEntry(plan, fsApi, state, failures) {
    if (state.originalDetected && !state.moveSucceeded) {
        const result = attemptCleanup(failures, `verify untouched ${state.label}`, () => {
            const targetEntry = lstatWithRealParent(fsApi, plan, state.target, state.label);
            if (targetEntry === undefined) {
                const backupEntry = lstatWithRealParent(
                    fsApi,
                    plan,
                    state.backup,
                    `${state.label} backup`,
                );
                if (backupEntry !== undefined
                    && identityOf(backupEntry, `${state.label} backup`) !== state.originalIdentity) {
                    throw new Error(`${state.label} backup identity changed`);
                }
                throw new Error(`untouched original disappeared: ${state.target}`);
            }
            requireIdentity(targetEntry, state.originalIdentity, state.label);
        });
        state.restoreSucceeded = result.ok;
        return;
    }

    let targetReady = true;
    if (state.generatedCreated) {
        const removal = attemptCleanup(failures, `remove generated ${state.label}`, () => {
            removeExactEntry(plan, fsApi, state);
        });
        if (!removal.ok) {
            targetReady = reconcileAbsentTarget(
                fsApi,
                plan,
                state.target,
                failures,
                state.label,
            );
        }
    } else {
        const absent = attemptCleanup(failures, `verify absent ${state.label}`, () => {
            if (lstatWithRealParent(fsApi, plan, state.target, state.label) !== undefined) {
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

    const restoreReceipt = { applied: false };
    const validateRestore = () => validateRenameEndpoints(
        fsApi,
        plan,
        state.backup,
        state.target,
        state.originalIdentity,
        `${state.label} backup`,
        state.label,
    );
    const restored = attemptCleanup(failures, `restore prior ${state.label}`, () => {
        validateRestore();
        fsApi.rename(
            state.backup,
            state.target,
            state.originalIdentity,
            restoreReceipt,
            validateRestore,
        );
    });
    if (restored.ok) {
        state.restoreSucceeded = true;
        return;
    }
    const reconciled = attemptCleanup(failures, `reconcile restored ${state.label}`, () => {
        const backupEntry = lstatWithRealParent(
            fsApi,
            plan,
            state.backup,
            `${state.label} backup`,
        );
        const targetEntry = lstatWithRealParent(
            fsApi,
            plan,
            state.target,
            state.label,
        );
        if (!restoreReceipt.applied || backupEntry !== undefined || targetEntry === undefined
            || identityOf(targetEntry, state.label) !== state.originalIdentity) {
            if (restoreReceipt.applied && targetEntry !== undefined
                && identityOf(targetEntry, state.label) !== state.originalIdentity) {
                throw new Error(`${state.label} identity changed after restore`);
            }
            throw new Error(`prior entry was not restored to ${state.target}`);
        }
    });
    state.restoreSucceeded = reconciled.ok;
}

function reconcileAbsentTarget(fsApi, plan, target, failures, label) {
    return attemptCleanup(failures, `reconcile removed ${label}`, () => {
        if (lstatWithRealParent(fsApi, plan, target, label) !== undefined) {
            throw new Error(`generated entry remains at ${target}`);
        }
    }).ok;
}

function removeExactEntry(plan, fsApi, state) {
    assertAllowedTarget(plan, state.target);
    const status = lstatWithRealParent(fsApi, plan, state.target, state.label);
    if (status === undefined) return;
    requireIdentity(status, state.generatedIdentity, `generated ${state.label}`);
    const receipt = { applied: false };
    const validateRemoval = () => {
        const currentEntry = lstatWithRealParent(fsApi, plan, state.target, state.label);
        if (currentEntry === undefined) {
            throw new Error(`generated ${state.label} disappeared before removal`);
        }
        requireIdentity(currentEntry, state.generatedIdentity, `generated ${state.label}`);
    };
    if (status.isSymbolicLink() || !status.isDirectory()) {
        fsApi.unlink(state.target, state.generatedIdentity, receipt, validateRemoval);
        return;
    }
    fsApi.rmTree(state.target, state.generatedIdentity, receipt, validateRemoval);
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
            const schemaEntry = lstatWithRealParent(
                fsApi,
                plan,
                plan.schemaFile,
                'tracked schema',
            );
            if (schemaEntry === undefined) {
                const backupEntry = lstatWithRealParent(
                    fsApi,
                    plan,
                    plan.schemaBackup,
                    'tracked schema backup',
                );
                if (backupEntry !== undefined
                    && identityOf(backupEntry, 'tracked schema backup') !== snapshot.identity) {
                    throw new Error('tracked schema backup identity changed');
                }
            }
            assertExactSchema(fsApi, plan, snapshot);
        });
        state.restoreSucceeded = untouched.ok;
        return;
    }

    let schemaPathReady = true;
    const currentEntry = attemptCleanup(failures, 'inspect tracked schema replacement', () =>
        lstatWithRealParent(
            fsApi,
            plan,
            plan.schemaFile,
            'tracked schema replacement',
        ));
    if (!currentEntry.ok) {
        schemaPathReady = false;
    } else if (currentEntry.value !== undefined) {
        if (!state.workingCreated) {
            captureCleanupFailure(failures, 'preserve unowned tracked schema entry', () => {
                throw new Error(`unowned entry occupies tracked schema: ${plan.schemaFile}`);
            });
            return;
        }
        if (identityOf(currentEntry.value, 'tracked schema replacement')
            !== state.workingIdentity) {
            captureCleanupFailure(failures, 'preserve replaced tracked schema entry', () => {
                throw new Error('tracked schema replacement identity changed');
            });
            return;
        }
        const removed = attemptCleanup(failures, 'remove tracked schema replacement', () => {
            removeExactSchemaEntry(plan, fsApi, state.workingIdentity);
        });
        if (!removed.ok) {
            schemaPathReady = reconcileAbsentTarget(
                fsApi,
                plan,
                plan.schemaFile,
                failures,
                'tracked schema replacement',
            );
        }
    }
    if (!schemaPathReady) return;

    const restoreReceipt = { applied: false };
    const validateRestore = () => validateRenameEndpoints(
        fsApi,
        plan,
        plan.schemaBackup,
        plan.schemaFile,
        snapshot.identity,
        'tracked schema backup',
        'tracked schema',
    );
    const restored = attemptCleanup(failures, 'restore prior tracked schema entry', () => {
        validateRestore();
        fsApi.rename(
            plan.schemaBackup,
            plan.schemaFile,
            snapshot.identity,
            restoreReceipt,
            validateRestore,
        );
    });
    let renameRestored = restored.ok;
    if (!renameRestored) {
        const reconciled = attemptCleanup(failures, 'reconcile restored tracked schema', () => {
            const backupEntry = lstatWithRealParent(
                fsApi,
                plan,
                plan.schemaBackup,
                'tracked schema backup',
            );
            const schemaEntry = lstatWithRealParent(
                fsApi,
                plan,
                plan.schemaFile,
                'tracked schema',
            );
            if (!restoreReceipt.applied || backupEntry !== undefined || schemaEntry === undefined
                || identityOf(schemaEntry, 'tracked schema') !== snapshot.identity) {
                if (restoreReceipt.applied && schemaEntry !== undefined
                    && identityOf(schemaEntry, 'tracked schema') !== snapshot.identity) {
                    throw new Error('tracked schema identity changed after restore');
                }
                throw new Error(`prior tracked schema was not restored to ${plan.schemaFile}`);
            }
        });
        renameRestored = reconciled.ok;
    }
    if (!renameRestored) return;

    const verified = attemptCleanup(failures, 'verify restored tracked schema', () => {
        assertExactSchema(fsApi, plan, snapshot);
    });
    state.restoreSucceeded = verified.ok;
}

function removeExactSchemaEntry(plan, fsApi, expectedIdentity) {
    assertSamePath(plan.schemaFile,
        path.join(plan.resourcesRoot, 'schema', 'merc32.schema.json'), 'tracked schema');
    const status = lstatWithRealParent(
        fsApi,
        plan,
        plan.schemaFile,
        'tracked schema replacement',
    );
    if (status === undefined) return;
    requireIdentity(status, expectedIdentity, 'tracked schema replacement');
    const receipt = { applied: false };
    const validateRemoval = () => {
        const currentEntry = lstatWithRealParent(
            fsApi,
            plan,
            plan.schemaFile,
            'tracked schema replacement',
        );
        if (currentEntry === undefined) {
            throw new Error('tracked schema replacement disappeared before removal');
        }
        requireIdentity(currentEntry, expectedIdentity, 'tracked schema replacement');
    };
    if (status.isSymbolicLink() || !status.isDirectory()) {
        fsApi.unlink(plan.schemaFile, expectedIdentity, receipt, validateRemoval);
        return;
    }
    fsApi.rmTree(plan.schemaFile, expectedIdentity, receipt, validateRemoval);
}

function assertExactSchema(fsApi, plan, snapshot) {
    const status = lstatWithRealParent(fsApi, plan, plan.schemaFile, 'tracked schema');
    assert.ok(status !== undefined && !status.isSymbolicLink() && status.isFile(),
        'tracked schema was not restored as an exact file entry');
    requireIdentity(status, snapshot.identity, 'tracked schema');
    requireExactSchemaEntry(fsApi, plan);
    assert.deepStrictEqual(fsApi.readFile(plan.schemaFile), snapshot.bytes);
    requireExactSchemaEntry(fsApi, plan);
    assert.strictEqual(fsApi.stat(plan.schemaFile).mtimeMs, snapshot.mtimeMs);
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
    const lstat = (target) => {
        const status = fsModule.lstatSync(target, { bigint: true, throwIfNoEntry: false });
        if (status !== undefined) status.entryIdentity = `${status.dev}:${status.ino}`;
        return status;
    };
    const requireExpectedIdentity = (target, expectedIdentity, label) => {
        const status = lstat(target);
        if (status === undefined) throw new Error(`${label} is missing: ${target}`);
        if (status.entryIdentity !== expectedIdentity) {
            throw new Error(`${label} identity changed`);
        }
        return status;
    };
    return Object.freeze({
        lstat,
        stat: (target) => fsModule.statSync(target),
        mkdir: (target, receipt, validate) => {
            validate();
            fsModule.mkdirSync(target);
            receipt.applied = true;
            receipt.identity = lstat(target)?.entryIdentity;
        },
        rmdir: (target, expectedIdentity, receipt, validate) => {
            validate();
            requireExpectedIdentity(target, expectedIdentity, 'directory before removal');
            fsModule.rmdirSync(target);
            receipt.applied = true;
        },
        rename: (source, destination, expectedIdentity, receipt, validate) => {
            validate();
            requireExpectedIdentity(source, expectedIdentity, 'rename source');
            if (lstat(destination) !== undefined) {
                throw new Error(`rename destination already exists: ${destination}`);
            }
            fsModule.renameSync(source, destination);
            receipt.applied = true;
            receipt.identity = expectedIdentity;
        },
        readFile: (target) => fsModule.readFileSync(target),
        writeFile: (target, bytes) => fsModule.writeFileSync(target, bytes),
        createFile: (target, bytes, receipt, validate) => {
            validate();
            const descriptor = fsModule.openSync(target, 'wx');
            try {
                const status = fsModule.fstatSync(descriptor, { bigint: true });
                receipt.applied = true;
                receipt.identity = `${status.dev}:${status.ino}`;
                fsModule.writeFileSync(descriptor, bytes);
            } finally {
                fsModule.closeSync(descriptor);
            }
        },
        utimes: (target, atime, mtime) => fsModule.utimesSync(target, atime, mtime),
        unlink: (target, expectedIdentity, receipt, validate) => {
            validate();
            requireExpectedIdentity(target, expectedIdentity, 'entry before unlink');
            fsModule.unlinkSync(target);
            receipt.applied = true;
        },
        rmTree: (target, expectedIdentity, receipt, validate) => {
            validate();
            requireExpectedIdentity(target, expectedIdentity, 'directory before recursive removal');
            fsModule.rmSync(target, { recursive: true, force: false });
            receipt.applied = true;
        },
    });
}

module.exports = {
    buildResourceProbePlan,
    createNodeFsAdapter,
    runResourceProbe,
};
