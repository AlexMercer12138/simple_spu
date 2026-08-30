const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let probeApi = {};
let loadFailure;
try {
    probeApi = require('./extension-resource-probe');
} catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND'
        || !String(error.message).includes('extension-resource-probe')) throw error;
    loadFailure = error;
}

assert.strictEqual(
    typeof probeApi.buildResourceProbePlan,
    'function',
    `resource probe plan builder is missing${loadFailure ? `: ${loadFailure.message}` : ''}`,
);
assert.strictEqual(
    typeof probeApi.runResourceProbe,
    'function',
    'resource probe transaction is missing',
);
assert.strictEqual(
    typeof probeApi.createNodeFsAdapter,
    'function',
    'native filesystem adapter is missing',
);

const { buildResourceProbePlan, createNodeFsAdapter, runResourceProbe } = probeApi;
const PROBE_TOKEN = '0123456789abcdef01234567';
const SKIP_CASE = Symbol('skip case');
let completedCases = 0;
let skippedCases = 0;

function run() {
runCase('rejects a reparse resource root before the first mutation', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-resources');
    const victimFile = path.join(victimRoot, 'victim.txt');
    fixture.fsApi.seedDirectory(victimRoot, 'resources-victim-root');
    fixture.fsApi.seedFile(victimFile, Buffer.from('external victim\n'), 3131,
        'resources-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    fixture.fsApi.replaceWithSymlink(
        fixture.plan.resourcesRoot,
        victimRoot,
        'resources-reparse-entry',
    );

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.match(thrown.message, /resources root is not an exact directory/u);
    assert.strictEqual(fixture.fsApi.operationCount('mkdir'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rename'), 0);
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assertProbeAbsent(fixture);
});

runCase('rejects a reparse schema directory before schema access or mutation', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const schemaRoot = path.dirname(fixture.plan.schemaFile);
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-schema');
    const victimFile = path.join(victimRoot, 'merc32.schema.json');
    fixture.fsApi.seedDirectory(victimRoot, 'schema-victim-root');
    fixture.fsApi.seedFile(victimFile, Buffer.from('external schema victim\n'), 3232,
        'schema-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    fixture.fsApi.replaceWithSymlink(schemaRoot, victimRoot, 'schema-reparse-entry');
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assert.match(thrown.message, /schema.+not an exact directory/u);
    assert.strictEqual(prepareCalled, false);
    assert.strictEqual(fixture.fsApi.operationCount('mkdir'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rename'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('writeFile'), 0);
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assertProbeAbsent(fixture);
});

runCase('rejects a reparse backup parent and preserves its replacement victim', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-backups');
    const victimFile = path.join(victimRoot, 'victim.txt');
    fixture.fsApi.seedDirectory(victimRoot, 'backup-victim-root');
    fixture.fsApi.seedFile(victimFile, Buffer.from('external backup victim\n'), 3333,
        'backup-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'mkdir' && args[0] === fixture.plan.probeRoot) {
            fixture.fsApi.replaceWithSymlink(
                fixture.plan.probeRoot,
                victimRoot,
                'owned-probe-reparse-entry',
            );
        }
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assertErrorIncludes(thrown, /schema backup.+not an exact directory/u);
    assert.strictEqual(prepareCalled, false);
    assert.strictEqual(fixture.fsApi.operationCount('rename'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('writeFile'), 0);
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.probeRoot), {
        kind: 'symlink',
        id: 'owned-probe-reparse-entry',
        target: victimRoot,
    });
});

runCase('revalidates the schema directory between schema stat and read', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const schemaRoot = path.dirname(fixture.plan.schemaFile);
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-schema-read');
    const victimFile = path.join(victimRoot, 'merc32.schema.json');
    fixture.fsApi.seedDirectory(victimRoot, 'schema-read-victim-root');
    fixture.fsApi.seedFile(victimFile, Buffer.from('schema read victim\n'), 3737,
        'schema-read-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    const unsafeRead = new Error('schema read reached an unsafe adapter call');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'stat' && args[0] === fixture.plan.schemaFile) {
            fixture.fsApi.replaceWithSymlink(schemaRoot, victimRoot, 'schema-read-reparse');
        }
    };
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation === 'readFile' && args[0] === fixture.plan.schemaFile) throw unsafeRead;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.notStrictEqual(thrown, unsafeRead);
    assertErrorIncludes(thrown, /schema.+not an exact directory/u);
    assert.strictEqual(fixture.fsApi.operationCount('readFile'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rename'), 0);
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assertProbeAbsent(fixture);
});

runCase('revalidates the schema directory before writing the working copy', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const schemaRoot = path.dirname(fixture.plan.schemaFile);
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-schema-write');
    const victimFile = path.join(victimRoot, 'merc32.schema.json');
    fixture.fsApi.seedDirectory(victimRoot, 'schema-write-victim-root');
    fixture.fsApi.seedFile(victimFile, Buffer.from('schema write victim\n'), 3838,
        'schema-write-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    const originalSchema = fixture.fsApi.describe(fixture.plan.schemaFile);
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'rename' && args[0] === fixture.plan.schemaFile) {
            fixture.fsApi.replaceWithSymlink(schemaRoot, victimRoot, 'schema-write-reparse');
        }
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assertErrorIncludes(thrown, /schema.+not an exact directory/u);
    assert.strictEqual(prepareCalled, false);
    assert.strictEqual(fixture.fsApi.operationCount('writeFile'), 0);
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.schemaBackup), originalSchema);
});

runCase('preserves a victim inserted before schema working-copy creation', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimBytes = Buffer.from('schema create victim\n');
    const createFailure = new Error('schema create reached an unsafe adapter call');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation !== 'createFile' || args[0] !== fixture.plan.schemaFile) return;
        fixture.fsApi.seedFile(fixture.plan.schemaFile, victimBytes, 4141,
            'schema-create-victim');
        throw createFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.strictEqual(thrown.errors[0], createFailure);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.schemaFile), {
        kind: 'file',
        id: 'schema-create-victim',
        bytes: victimBytes.toString('hex'),
        mtimeMs: 4141,
        atimeMs: 4141,
    });
    assertErrorIncludes(thrown, /unowned entry occupies tracked schema/u);
});

runCase('preserves a replacement installed after schema working-copy creation', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimBytes = Buffer.from('schema post-create victim\n');
    const createFailure = new Error('schema create failed after a replacement appeared');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'createFile' || args[0] !== fixture.plan.schemaFile) return;
        fixture.fsApi.replaceWithFile(
            fixture.plan.schemaFile,
            victimBytes,
            4242,
            'schema-post-create-victim',
        );
        throw createFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.strictEqual(thrown.errors[0], createFailure);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.schemaFile), {
        kind: 'file',
        id: 'schema-post-create-victim',
        bytes: victimBytes.toString('hex'),
        mtimeMs: 4242,
        atimeMs: 4242,
    });
    assertErrorIncludes(thrown, /tracked schema replacement identity changed/u);
});

runCase('preserves a schema replacement installed inside unlink', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimBytes = Buffer.from('schema unlink victim\n');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation !== 'unlink' || args[0] !== fixture.plan.schemaFile) return;
        fixture.fsApi.replaceWithFile(
            fixture.plan.schemaFile,
            victimBytes,
            4646,
            'schema-unlink-victim',
        );
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.schemaFile), {
        kind: 'file',
        id: 'schema-unlink-victim',
        bytes: victimBytes.toString('hex'),
        mtimeMs: 4646,
        atimeMs: 4646,
    });
    assertErrorIncludes(thrown, /tracked schema replacement identity changed/u);
});

runCase('reconciles schema unlink that reports failure after removal', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const unlinkFailure = new Error('schema unlink failed after removal');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'unlink' && args[0] === fixture.plan.schemaFile) throw unlinkFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.ok(thrown.errors.some((error) => error.cause === unlinkFailure));
});

runCase('revalidates the target parent before moving an original target', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-targets');
    const victimFile = path.join(victimRoot, 'victim.txt');
    fixture.fsApi.seedDirectory(victimRoot, 'target-victim-root');
    fixture.fsApi.seedFile(victimFile, Buffer.from('target victim\n'), 3939,
        'target-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation === 'rename' && args[0] === fixture.plan.targets[0].target) {
            fixture.fsApi.replaceWithSymlink(
                fixture.plan.resourcesRoot,
                victimRoot,
                'target-parent-reparse',
            );
        }
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assertErrorIncludes(thrown, /resources root is not an exact directory/u);
    assert.strictEqual(prepareCalled, false);
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
});

runCase('does not restore a replacement installed after the schema rename', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const renameFailure = new Error('schema rename failed after destination replacement');
    const victimTarget = path.join(fixture.plan.extensionRoot, 'outside-schema-rename');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'rename' || args[0] !== fixture.plan.schemaFile) return;
        fixture.fsApi.replaceWithSymlink(
            fixture.plan.schemaBackup,
            victimTarget,
            'schema-rename-destination-victim',
        );
        throw renameFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.strictEqual(thrown.errors[0], renameFailure);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.schemaBackup), {
        kind: 'symlink',
        id: 'schema-rename-destination-victim',
        target: victimTarget,
    });
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.schemaFile), undefined);
    assertErrorIncludes(thrown, /tracked schema backup identity changed/u);
});

runCase('restores the first moved entry when the second original rename fails', () => {
    const fixture = createFixture({ present: [true, true, true] });
    const renameFailure = new Error('second original rename failed');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation === 'rename' && args[0] === fixture.plan.targets[1].target) {
            throw renameFailure;
        }
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assert.strictEqual(thrown, renameFailure);
    assert.strictEqual(prepareCalled, false);
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.deepStrictEqual(fixture.observedStates.map(stateFlags), [
        [true, true, false, true],
        [true, false, false, true],
        [true, false, false, true],
    ]);
});

runCase('reconciles the second original when rename fails after moving the entry', () => {
    const fixture = createFixture({ present: [true, true, true] });
    const renameFailure = new Error('second original rename failed after moving');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'rename' && args[0] === fixture.plan.targets[1].target) {
            throw renameFailure;
        }
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assert.strictEqual(thrown, renameFailure);
    assert.strictEqual(prepareCalled, false);
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.deepStrictEqual(fixture.observedStates.map(stateFlags), [
        [true, true, false, true],
        [true, true, false, true],
        [true, false, false, true],
    ]);
});

runCase('does not restore a replacement installed after an original rename', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const renameFailure = new Error('original rename failed after destination replacement');
    const backup = fixture.plan.targets[0].backup;
    const victimTarget = path.join(fixture.plan.extensionRoot, 'outside-rename-victim');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'rename' || args[0] !== fixture.plan.targets[0].target) return;
        fixture.fsApi.replaceWithSymlink(backup, victimTarget, 'rename-destination-victim');
        throw renameFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.strictEqual(thrown.errors[0], renameFailure);
    assert.deepStrictEqual(fixture.fsApi.describe(backup), {
        kind: 'symlink',
        id: 'rename-destination-victim',
        target: victimTarget,
    });
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.targets[0].target), undefined);
    assertErrorIncludes(thrown, /backup identity changed/u);
});

runCase('preserves a replacement installed after a restore rename', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const restoreFailure = new Error('restore rename failed after destination replacement');
    const target = fixture.plan.targets[0].target;
    const victimTarget = path.join(fixture.plan.extensionRoot, 'outside-restore-victim');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'rename' || args[0] !== fixture.plan.targets[0].backup) return;
        fixture.fsApi.replaceWithSymlink(target, victimTarget, 'restore-destination-victim');
        throw restoreFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.deepStrictEqual(fixture.fsApi.describe(target), {
        kind: 'symlink',
        id: 'restore-destination-victim',
        target: victimTarget,
    });
    assertErrorIncludes(thrown, /resources\/rtl identity changed after restore/u);
});

runCase('removes the probe root and leaves schema untouched when snapshotting fails', () => {
    const fixture = createFixture({ cacheExists: false, present: [true, false, true] });
    const snapshotFailure = new Error('schema read failed');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation === 'readFile' && args[0] === fixture.plan.schemaFile) {
            throw snapshotFailure;
        }
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assert.strictEqual(thrown, snapshotFailure);
    assert.strictEqual(prepareCalled, false);
    assert.strictEqual(fixture.fsApi.operationCount('writeFile'), 0);
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), undefined);
});

runCase('removes an absent cache root created before mkdir reports failure', () => {
    const fixture = createFixture({ cacheExists: false, present: [true, false, true] });
    const mkdirFailure = new Error('cache mkdir failed after creation');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'mkdir' && args[0] === fixture.plan.cacheRoot) throw mkdirFailure;
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assert.strictEqual(thrown, mkdirFailure);
    assert.strictEqual(prepareCalled, false);
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), undefined);
    assertProbeAbsent(fixture);
    assertFixtureRestored(fixture);
});

runCase('removes a probe root created before mkdir reports failure', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const cacheSnapshot = fixture.fsApi.describe(fixture.plan.cacheRoot);
    const mkdirFailure = new Error('probe mkdir failed after creation');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'mkdir' && args[0] === fixture.plan.probeRoot) throw mkdirFailure;
    };
    let prepareCalled = false;

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        prepareCalled = true;
    }));

    assert.strictEqual(thrown, mkdirFailure);
    assert.strictEqual(prepareCalled, false);
    assertProbeAbsent(fixture);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), cacheSnapshot);
    assertFixtureRestored(fixture);
});

runCase('preserves a replacement installed after probe mkdir succeeds then reports failure', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-mkdir-replacement');
    const victimFile = path.join(victimRoot, 'victim.txt');
    const mkdirFailure = new Error('probe mkdir failed after a replacement appeared');
    fixture.fsApi.seedDirectory(victimRoot, 'mkdir-replacement-victim');
    fixture.fsApi.seedFile(victimFile, Buffer.from('mkdir replacement victim\n'), 4040,
        'mkdir-replacement-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'mkdir' || args[0] !== fixture.plan.probeRoot) return;
        fixture.fsApi.replaceWithSymlink(
            fixture.plan.probeRoot,
            victimRoot,
            'post-mkdir-replacement',
        );
        throw mkdirFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.ok(thrown instanceof AggregateError);
    assert.strictEqual(thrown.errors[0], mkdirFailure);
    assertErrorIncludes(thrown, /probe root identity changed after creation/u);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.probeRoot), {
        kind: 'symlink',
        id: 'post-mkdir-replacement',
        target: victimRoot,
    });
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assertFixtureRestored(fixture);
});

runCase('leaves an absent cache root absent when mkdir fails before creation', () => {
    const fixture = createFixture({ cacheExists: false, present: [true, false, true] });
    const mkdirFailure = new Error('cache mkdir failed before creation');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation === 'mkdir' && args[0] === fixture.plan.cacheRoot) throw mkdirFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.strictEqual(thrown, mkdirFailure);
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), undefined);
    assertProbeAbsent(fixture);
    assert.strictEqual(fixture.fsApi.operationCount('rmdir'), 0);
    assertFixtureRestored(fixture);
});

runCase('does not remove a cache victim inserted before a failed mkdir', () => {
    const fixture = createFixture({ cacheExists: false, present: [true, false, true] });
    const mkdirFailure = new Error('cache mkdir failed before a concurrent insert');
    const sentinel = path.join(fixture.plan.cacheRoot, 'victim.txt');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation !== 'mkdir' || args[0] !== fixture.plan.cacheRoot) return;
        fixture.fsApi.seedDirectory(fixture.plan.cacheRoot, 'concurrent-cache-victim');
        fixture.fsApi.seedFile(sentinel, Buffer.from('concurrent victim\n'), 3434,
            'concurrent-cache-sentinel');
        throw mkdirFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.strictEqual(thrown, mkdirFailure);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), {
        kind: 'directory',
        id: 'concurrent-cache-victim',
    });
    assert.deepStrictEqual(fixture.fsApi.describe(sentinel), {
        kind: 'file',
        id: 'concurrent-cache-sentinel',
        bytes: Buffer.from('concurrent victim\n').toString('hex'),
        mtimeMs: 3434,
        atimeMs: 3434,
    });
    assert.strictEqual(fixture.fsApi.operationCount('rmdir'), 0);
    assertFixtureRestored(fixture);
});

runCase('restores present entries, removes absent outputs, and restores schema after prepare fails', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const prepareFailure = new Error('resource preparation failed');

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
        throw prepareFailure;
    }));

    assert.strictEqual(thrown, prepareFailure);
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.deepStrictEqual(fixture.observedStates.map(stateFlags), [
        [true, true, true, true],
        [false, false, true, true],
        [true, true, true, true],
    ]);
});

runCase('continues all restores and removes the probe after a post-rename cleanup failure', () => {
    const fixture = createFixture({ present: [true, true, true] });
    const cleanupFailure = new Error('restore rename reported failure after completion');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'rename' && args[0] === fixture.plan.targets[2].backup) {
            throw cleanupFailure;
        }
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.ok(thrown instanceof AggregateError);
    assert.match(thrown.message, /cleanup failed/u);
    assert.ok(thrown.errors.some((error) => error.cause === cleanupFailure));
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.ok(fixture.observedStates.every((state) => state.restoreSucceeded));
});

runCase('preserves the primary error when cache cleanup also fails', () => {
    const fixture = createFixture({ cacheExists: false, present: [true, false, true] });
    const prepareFailure = new Error('primary preparation failure');
    const cleanupFailure = new Error('cache cleanup failure');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation === 'rmdir' && args[0] === fixture.plan.cacheRoot) throw cleanupFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
        throw prepareFailure;
    }));

    assert.ok(thrown instanceof AggregateError);
    assert.strictEqual(thrown.errors[0], prepareFailure);
    assert.ok(thrown.errors.some((error) => error.cause === cleanupFailure));
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.notStrictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), undefined);
});

runCase('preserves the primary error and reconciles both post-effect root removals', () => {
    const fixture = createFixture({ cacheExists: false, present: [true, false, true] });
    const prepareFailure = new Error('primary preparation failure');
    const probeCleanupFailure = new Error('probe rmdir failed after removal');
    const cacheCleanupFailure = new Error('cache rmdir failed after removal');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'rmdir') return;
        if (args[0] === fixture.plan.probeRoot) throw probeCleanupFailure;
        if (args[0] === fixture.plan.cacheRoot) throw cacheCleanupFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
        throw prepareFailure;
    }));

    assert.ok(thrown instanceof AggregateError);
    assert.strictEqual(thrown.errors[0], prepareFailure);
    assert.ok(thrown.errors.some((error) => error.cause === probeCleanupFailure));
    assert.ok(thrown.errors.some((error) => error.cause === cacheCleanupFailure));
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), undefined);
});

runCase('preserves a replacement installed immediately before owned-root removal', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const sentinel = path.join(fixture.plan.probeRoot, 'replacement-victim.txt');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation !== 'rmdir' || args[0] !== fixture.plan.probeRoot) return;
        fixture.fsApi.replaceWithDirectory(fixture.plan.probeRoot, 'pre-rmdir-victim');
        fixture.fsApi.seedFile(sentinel, Buffer.from('pre-rmdir victim\n'), 4343,
            'pre-rmdir-victim-file');
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.probeRoot), {
        kind: 'directory',
        id: 'pre-rmdir-victim',
    });
    assert.deepStrictEqual(fixture.fsApi.describe(sentinel), {
        kind: 'file',
        id: 'pre-rmdir-victim-file',
        bytes: Buffer.from('pre-rmdir victim\n').toString('hex'),
        mtimeMs: 4343,
        atimeMs: 4343,
    });
    assertErrorIncludes(thrown, /resource probe root identity changed/u);
    assertFixtureRestored(fixture);
});

runCase('does not retry root removal after a post-effect replacement appears', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const cleanupFailure = new Error('probe rmdir failed after a replacement appeared');
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-root-cleanup');
    const victimFile = path.join(victimRoot, 'victim.txt');
    fixture.fsApi.seedDirectory(victimRoot, 'root-cleanup-victim');
    fixture.fsApi.seedFile(victimFile, Buffer.from('root cleanup victim\n'), 3535,
        'root-cleanup-victim-file');
    const victimSnapshot = fixture.fsApi.describe(victimFile);
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation !== 'rmdir' || args[0] !== fixture.plan.probeRoot) return;
        fixture.fsApi.seedSymlink(
            fixture.plan.probeRoot,
            victimRoot,
            'post-rmdir-replacement',
        );
        throw cleanupFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.ok(thrown instanceof AggregateError);
    assert.ok(thrown.errors.some((error) => error.cause === cleanupFailure));
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.probeRoot), {
        kind: 'symlink',
        id: 'post-rmdir-replacement',
        target: victimRoot,
    });
    assert.deepStrictEqual(fixture.fsApi.describe(victimFile), victimSnapshot);
    assertFixtureRestored(fixture);
});

runCase('preserves a pre-existing cache directory and sentinel exactly', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const sentinel = path.join(fixture.plan.cacheRoot, 'cache-sentinel.txt');
    fixture.fsApi.seedFile(sentinel, Buffer.from('pre-existing cache\n'), 3636,
        'cache-sentinel');
    const cacheSnapshot = fixture.fsApi.describe(fixture.plan.cacheRoot);
    const sentinelSnapshot = fixture.fsApi.describe(sentinel);

    executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    });

    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.cacheRoot), cacheSnapshot);
    assert.deepStrictEqual(fixture.fsApi.describe(sentinel), sentinelSnapshot);
    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
});

runCase('preserves a generated target replacement installed inside recursive removal', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const target = fixture.plan.targets[0].target;
    const sentinel = path.join(target, 'replacement-victim.txt');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation !== 'rmTree' || args[0] !== target) return;
        fixture.fsApi.replaceWithDirectory(target, 'pre-rmtree-victim');
        fixture.fsApi.seedFile(sentinel, Buffer.from('pre-rmtree victim\n'), 4444,
            'pre-rmtree-victim-file');
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.deepStrictEqual(fixture.fsApi.describe(target), {
        kind: 'directory',
        id: 'pre-rmtree-victim',
    });
    assert.deepStrictEqual(fixture.fsApi.describe(sentinel), {
        kind: 'file',
        id: 'pre-rmtree-victim-file',
        bytes: Buffer.from('pre-rmtree victim\n').toString('hex'),
        mtimeMs: 4444,
        atimeMs: 4444,
    });
    assertErrorIncludes(thrown, /generated resources\/rtl identity changed/u);
});

runCase('preserves a generated file replacement installed inside unlink', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const target = fixture.plan.targets[2].target;
    const victimBytes = Buffer.from('pre-unlink victim\n');
    fixture.fsApi.beforeFault = ({ operation, args }) => {
        if (operation !== 'unlink' || args[0] !== target) return;
        fixture.fsApi.replaceWithFile(target, victimBytes, 4545, 'pre-unlink-victim');
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assert.deepStrictEqual(fixture.fsApi.describe(target), {
        kind: 'file',
        id: 'pre-unlink-victim',
        bytes: victimBytes.toString('hex'),
        mtimeMs: 4545,
        atimeMs: 4545,
    });
    assertErrorIncludes(thrown, /generated resources\/resource-manifest\.json identity changed/u);
});

runCase('reconciles a generated file unlink that reports failure after removal', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const target = fixture.plan.targets[2].target;
    const unlinkFailure = new Error('generated unlink failed after removal');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'unlink' && args[0] === target) throw unlinkFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.ok(thrown.errors.some((error) => error.cause === unlinkFailure));
});

runCase('reconciles recursive removal that reports failure after deletion', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const target = fixture.plan.targets[0].target;
    const removalFailure = new Error('generated tree removal failed after deletion');
    fixture.fsApi.afterFault = ({ operation, args }) => {
        if (operation === 'rmTree' && args[0] === target) throw removalFailure;
    };

    const thrown = captureThrown(() => executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    }));

    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.ok(thrown.errors.some((error) => error.cause === removalFailure));
});

runCase('rejects a pre-existing probe entry without mutating it', () => {
    const fixture = createFixture({ present: [true, false, true] });
    const victimRoot = path.join(fixture.plan.extensionRoot, 'outside-preexisting-probe');
    fixture.fsApi.seedDirectory(victimRoot, 'preexisting-probe-victim');
    fixture.fsApi.seedSymlink(
        fixture.plan.probeRoot,
        victimRoot,
        'preexisting-probe-entry',
    );
    const probeSnapshot = fixture.fsApi.describe(fixture.plan.probeRoot);

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.match(thrown.message, /probe root already exists/u);
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.probeRoot), probeSnapshot);
    assert.strictEqual(fixture.fsApi.operationCount('mkdir'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rename'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('unlink'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rmTree'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rmdir'), 0);
    assertFixtureRestored(fixture);
});

runCase('detects and restores a dangling link as an entry without traversing it', () => {
    const fixture = createFixture({ present: [false, false, false] });
    const target = fixture.plan.targets[0].target;
    fixture.fsApi.seedSymlink(target, path.join(fixture.plan.extensionRoot, 'missing-target'),
        'dangling-rtl-link');
    fixture.baseline = snapshotFixture(fixture);

    executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    });

    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.deepStrictEqual(fixture.fsApi.describe(target), {
        kind: 'symlink',
        id: 'dangling-rtl-link',
        target: path.join(fixture.plan.extensionRoot, 'missing-target'),
    });
    assert.deepStrictEqual(stateFlags(fixture.observedStates[0]), [true, true, true, true]);
});

runCase('restores an exact present and absent target mix on the happy path', () => {
    const fixture = createFixture({ present: [true, false, true] });

    const result = executeFixture(fixture, () => {
        generateAllOutputs(fixture);
    });

    assertFixtureRestored(fixture);
    assertProbeAbsent(fixture);
    assert.deepStrictEqual(result.map(stateFlags), [
        [true, true, true, true],
        [false, false, true, true],
        [true, true, true, true],
    ]);
});

runCase('rejects a real Windows schema junction without changing its victim', () => {
    if (process.platform !== 'win32') return SKIP_CASE;

    const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-resource-probe-junction-'));
    const extensionRoot = path.join(sandboxRoot, 'extension');
    const resourcesRoot = path.join(extensionRoot, 'resources');
    const schemaRoot = path.join(resourcesRoot, 'schema');
    const victimRoot = path.join(sandboxRoot, 'schema-victim');
    const victimFile = path.join(victimRoot, 'merc32.schema.json');
    let junctionCreated = false;
    try {
        fs.mkdirSync(resourcesRoot, { recursive: true });
        fs.mkdirSync(victimRoot);
        fs.writeFileSync(victimFile, Buffer.from('external real schema victim\n'));
        const victimBytes = fs.readFileSync(victimFile);
        const victimMtimeMs = fs.statSync(victimFile).mtimeMs;
        try {
            fs.symlinkSync(victimRoot, schemaRoot, 'junction');
            junctionCreated = true;
        } catch (error) {
            if (['EACCES', 'EINVAL', 'ENOSYS', 'EPERM'].includes(error?.code)) return SKIP_CASE;
            throw error;
        }

        const plan = buildResourceProbePlan(extensionRoot, PROBE_TOKEN);
        let prepareCalled = false;
        const thrown = captureThrown(() => runResourceProbe({
            plan,
            fsApi: createNodeFsAdapter(fs),
            beforeMutation: () => {},
            prepare: () => { prepareCalled = true; },
            assertPrepared: () => {},
        }));

        assert.match(thrown.message, /schema.+not an exact directory/u);
        assert.strictEqual(prepareCalled, false);
        assert.deepStrictEqual(fs.readFileSync(victimFile), victimBytes);
        assert.strictEqual(fs.statSync(victimFile).mtimeMs, victimMtimeMs);
        assert.strictEqual(fs.lstatSync(plan.cacheRoot, { throwIfNoEntry: false }), undefined);
        assert.strictEqual(fs.lstatSync(plan.probeRoot, { throwIfNoEntry: false }), undefined);
    } finally {
        if (junctionCreated) {
            const junction = fs.lstatSync(schemaRoot, { throwIfNoEntry: false });
            if (junction !== undefined) {
                assert.ok(junction.isSymbolicLink(), 'refusing to remove a non-junction schema root');
                fs.unlinkSync(schemaRoot);
            }
        }
        assert.strictEqual(
            path.resolve(path.dirname(sandboxRoot)),
            path.resolve(os.tmpdir()),
            'refusing to remove a resource-probe sandbox outside the system temp directory',
        );
        assert.match(path.basename(sandboxRoot), /^merc32-resource-probe-junction-/u);
        fs.rmSync(sandboxRoot, { recursive: true, force: false });
    }
});

const skipSummary = skippedCases === 0 ? '' : `; ${skippedCases} explicitly skipped`;
console.log(`Extension resource probe fault-injection tests passed (${completedCases} cases${skipSummary}).`);
}

function runCase(name, action) {
    try {
        const result = action();
        if (result === SKIP_CASE) {
            skippedCases += 1;
            console.log(`Skipped: ${name}`);
        } else {
            completedCases += 1;
        }
    } catch (error) {
        error.message = `${name}: ${error.message}`;
        throw error;
    }
}

function createFixture({ cacheExists = true, present }) {
    const extensionRoot = path.resolve(__dirname, '.virtual-extension');
    const plan = buildResourceProbePlan(extensionRoot, PROBE_TOKEN);
    const fsApi = new MemoryFsAdapter();
    fsApi.seedDirectory(plan.extensionRoot, 'extension-root');
    fsApi.seedDirectory(plan.resourcesRoot, 'resources-root');
    fsApi.seedDirectory(path.dirname(plan.schemaFile), 'schema-root');
    fsApi.seedFile(plan.schemaFile, Buffer.from('original schema\n'), 4242,
        'schema-original');
    if (cacheExists) fsApi.seedDirectory(plan.cacheRoot, 'cache-root');
    present.forEach((isPresent, index) => {
        if (!isPresent) return;
        const target = plan.targets[index].target;
        if (index < 2) fsApi.seedDirectory(target, `original-target-${index}`);
        else fsApi.seedFile(target, Buffer.from('original manifest\n'), 5252,
            `original-target-${index}`);
    });
    const fixture = {
        plan,
        fsApi,
        observedStates: undefined,
    };
    fixture.baseline = snapshotFixture(fixture);
    return fixture;
}

function executeFixture(fixture, prepare) {
    return runResourceProbe({
        plan: fixture.plan,
        fsApi: fixture.fsApi,
        beforeMutation: () => {},
        prepare,
        assertPrepared: () => {},
        observeStates: (states) => { fixture.observedStates = states; },
    });
}

function generateAllOutputs(fixture) {
    for (const [index, entry] of fixture.plan.targets.entries()) {
        if (index < 2) fixture.fsApi.seedDirectory(entry.target, `generated-target-${index}`);
        else fixture.fsApi.seedFile(entry.target, Buffer.from('generated manifest\n'), 6262,
            `generated-target-${index}`);
    }
    fixture.fsApi.writeFile(fixture.plan.schemaFile, Buffer.from('generated schema\n'));
}

function snapshotFixture(fixture) {
    return {
        targets: fixture.plan.targets.map((entry) => fixture.fsApi.describe(entry.target)),
        schema: fixture.fsApi.describe(fixture.plan.schemaFile),
    };
}

function assertFixtureRestored(fixture) {
    assert.deepStrictEqual(
        fixture.plan.targets.map((entry) => fixture.fsApi.describe(entry.target)),
        fixture.baseline.targets,
    );
    assert.deepStrictEqual(fixture.fsApi.describe(fixture.plan.schemaFile), fixture.baseline.schema);
}

function assertProbeAbsent(fixture) {
    assert.strictEqual(fixture.fsApi.describe(fixture.plan.probeRoot), undefined);
}

function stateFlags(state) {
    return [
        state.originalDetected,
        state.moveSucceeded,
        state.generatedCreated,
        state.restoreSucceeded,
    ];
}

function assertErrorIncludes(error, pattern) {
    const pending = [error];
    const seen = new Set();
    const messages = [];
    while (pending.length > 0) {
        const current = pending.shift();
        if (!(current instanceof Error) || seen.has(current)) continue;
        seen.add(current);
        messages.push(current.message);
        if (current instanceof AggregateError) pending.push(...current.errors);
        if (current.cause instanceof Error) pending.push(current.cause);
    }
    assert.ok(
        messages.some((message) => pattern.test(message)),
        `expected an error matching ${pattern}; received: ${messages.join(' | ')}`,
    );
}

function captureThrown(action) {
    try {
        action();
    } catch (error) {
        return error;
    }
    assert.fail('expected operation to throw');
}

class MemoryFsAdapter {
    constructor() {
        this.entries = new Map();
        this.counts = new Map();
        this.beforeFault = undefined;
        this.afterFault = undefined;
        this.clock = 10_000;
    }

    operationCount(operation) {
        return this.counts.get(operation) ?? 0;
    }

    seedDirectory(target, id = `directory-${this.entries.size}`) {
        this.seed(target, { kind: 'directory', id });
    }

    seedFile(target, bytes, mtimeMs = this.clock++, id = `file-${this.entries.size}`) {
        this.seed(target, {
            kind: 'file',
            id,
            bytes: Buffer.from(bytes),
            mtimeMs,
            atimeMs: mtimeMs,
        });
    }

    seedSymlink(target, linkTarget, id = `symlink-${this.entries.size}`) {
        this.seed(target, { kind: 'symlink', id, target: linkTarget });
    }

    replaceWithSymlink(target, linkTarget, id) {
        const key = this.key(target);
        assert.ok(this.entries.has(key), `entry does not exist: ${key}`);
        this.entries.set(key, { kind: 'symlink', id, target: linkTarget });
    }

    replaceWithDirectory(target, id) {
        const key = this.key(target);
        assert.ok(this.entries.has(key), `entry does not exist: ${key}`);
        this.entries.set(key, { kind: 'directory', id });
    }

    replaceWithFile(target, bytes, mtimeMs, id) {
        const key = this.key(target);
        assert.ok(this.entries.has(key), `entry does not exist: ${key}`);
        this.entries.set(key, {
            kind: 'file',
            id,
            bytes: Buffer.from(bytes),
            mtimeMs,
            atimeMs: mtimeMs,
        });
    }

    seed(target, entry) {
        const key = this.key(target);
        assert.ok(!this.entries.has(key), `entry already exists: ${key}`);
        this.entries.set(key, entry);
    }

    describe(target) {
        const entry = this.entries.get(this.key(target));
        if (!entry) return undefined;
        if (entry.kind === 'file') {
            return {
                kind: entry.kind,
                id: entry.id,
                bytes: entry.bytes.toString('hex'),
                mtimeMs: entry.mtimeMs,
                atimeMs: entry.atimeMs,
            };
        }
        if (entry.kind === 'symlink') {
            return { kind: entry.kind, id: entry.id, target: entry.target };
        }
        return { kind: entry.kind, id: entry.id };
    }

    lstat(target) {
        return this.operate('lstat', [this.key(target)], () => {
            const entry = this.entries.get(this.key(target));
            return entry ? new MemoryStats(entry) : undefined;
        });
    }

    stat(target) {
        return this.operate('stat', [this.key(target)], () => {
            const entry = this.requiredEntry(target);
            return new MemoryStats(entry);
        });
    }

    mkdir(target, receipt, validate) {
        return this.operate('mkdir', [this.key(target)], () => {
            validate();
            const key = this.key(target);
            if (this.entries.has(key)) throw fileSystemError('EEXIST', key);
            const parent = this.entries.get(path.dirname(key));
            if (!parent || parent.kind !== 'directory') throw fileSystemError('ENOENT', key);
            this.entries.set(key, { kind: 'directory', id: `mkdir-${key}` });
            receipt.applied = true;
            receipt.identity = this.entries.get(key);
        });
    }

    rmdir(target, expectedIdentity, receipt, validate) {
        return this.operate('rmdir', [this.key(target)], () => {
            validate();
            const key = this.key(target);
            const entry = this.requiredEntry(key);
            if (entry !== expectedIdentity) throw new Error('directory before removal identity changed');
            if (entry.kind !== 'directory') throw fileSystemError('ENOTDIR', key);
            if ([...this.entries.keys()].some((candidate) => path.dirname(candidate) === key)) {
                throw fileSystemError('ENOTEMPTY', key);
            }
            this.entries.delete(key);
            receipt.applied = true;
        });
    }

    rename(source, destination, expectedIdentity, receipt, validate) {
        return this.operate('rename', [this.key(source), this.key(destination)], () => {
            validate();
            const sourceKey = this.key(source);
            const destinationKey = this.key(destination);
            const sourceEntry = this.requiredEntry(sourceKey);
            if (sourceEntry !== expectedIdentity) throw new Error('rename source identity changed');
            if (this.entries.has(destinationKey)) throw fileSystemError('EEXIST', destinationKey);
            const movedKeys = sourceEntry.kind === 'directory'
                ? [...this.entries.keys()].filter((candidate) =>
                    candidate === sourceKey || candidate.startsWith(`${sourceKey}${path.sep}`))
                : [sourceKey];
            const moved = movedKeys.map((candidate) => ({
                source: candidate,
                destination: `${destinationKey}${candidate.slice(sourceKey.length)}`,
                entry: this.entries.get(candidate),
            }));
            movedKeys.forEach((candidate) => this.entries.delete(candidate));
            moved.forEach((item) => this.entries.set(item.destination, item.entry));
            receipt.applied = true;
            receipt.identity = expectedIdentity;
        });
    }

    readFile(target) {
        return this.operate('readFile', [this.key(target)], () => {
            const entry = this.requiredEntry(target);
            if (entry.kind !== 'file') throw fileSystemError('EISDIR', this.key(target));
            return Buffer.from(entry.bytes);
        });
    }

    writeFile(target, bytes) {
        return this.operate('writeFile', [this.key(target)], () => {
            const key = this.key(target);
            const current = this.entries.get(key);
            if (current && current.kind !== 'file') throw fileSystemError('EISDIR', key);
            if (current) {
                current.bytes = Buffer.from(bytes);
                current.mtimeMs = this.clock++;
                return;
            }
            this.entries.set(key, {
                kind: 'file',
                id: `write-${key}`,
                bytes: Buffer.from(bytes),
                mtimeMs: this.clock++,
                atimeMs: this.clock++,
            });
        });
    }

    createFile(target, bytes, receipt, validate) {
        return this.operate('createFile', [this.key(target)], () => {
            validate();
            const key = this.key(target);
            if (this.entries.has(key)) throw fileSystemError('EEXIST', key);
            const entry = {
                kind: 'file',
                id: `create-${key}`,
                bytes: Buffer.from(bytes),
                mtimeMs: this.clock++,
                atimeMs: this.clock++,
            };
            this.entries.set(key, entry);
            receipt.applied = true;
            receipt.identity = entry;
        });
    }

    utimes(target, atimeSeconds, mtimeSeconds) {
        return this.operate('utimes', [this.key(target)], () => {
            const entry = this.requiredEntry(target);
            if (entry.kind !== 'file') throw fileSystemError('EISDIR', this.key(target));
            entry.atimeMs = atimeSeconds * 1000;
            entry.mtimeMs = mtimeSeconds * 1000;
        });
    }

    unlink(target, expectedIdentity, receipt, validate) {
        return this.operate('unlink', [this.key(target)], () => {
            validate();
            const key = this.key(target);
            const entry = this.requiredEntry(key);
            if (entry !== expectedIdentity) throw new Error('entry before unlink identity changed');
            if (entry.kind === 'directory') throw fileSystemError('EISDIR', key);
            this.entries.delete(key);
            receipt.applied = true;
        });
    }

    rmTree(target, expectedIdentity, receipt, validate) {
        return this.operate('rmTree', [this.key(target)], () => {
            validate();
            const key = this.key(target);
            const entry = this.requiredEntry(key);
            if (entry !== expectedIdentity) {
                throw new Error('directory before recursive removal identity changed');
            }
            if (entry.kind !== 'directory') throw fileSystemError('ENOTDIR', key);
            for (const candidate of [...this.entries.keys()]) {
                if (candidate === key || candidate.startsWith(`${key}${path.sep}`)) {
                    this.entries.delete(candidate);
                }
            }
            receipt.applied = true;
        });
    }

    operate(operation, args, action) {
        const count = (this.counts.get(operation) ?? 0) + 1;
        this.counts.set(operation, count);
        const event = { operation, count, args };
        this.beforeFault?.(event);
        const result = action();
        this.afterFault?.(event);
        return result;
    }

    requiredEntry(target) {
        const key = this.key(target);
        const entry = this.entries.get(key);
        if (!entry) throw fileSystemError('ENOENT', key);
        return entry;
    }

    key(target) {
        return path.resolve(target);
    }
}

class MemoryStats {
    constructor(entry) {
        this.entry = entry;
        this.entryIdentity = entry;
        this.atimeMs = entry.atimeMs;
        this.mtimeMs = entry.mtimeMs;
    }

    isDirectory() {
        return this.entry.kind === 'directory';
    }

    isFile() {
        return this.entry.kind === 'file';
    }

    isSymbolicLink() {
        return this.entry.kind === 'symlink';
    }
}

function fileSystemError(code, target) {
    const error = new Error(`${code}: ${target}`);
    error.code = code;
    return error;
}

run();
