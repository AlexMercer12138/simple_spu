const assert = require('assert');
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

const { buildResourceProbePlan, runResourceProbe } = probeApi;
const PROBE_TOKEN = '0123456789abcdef01234567';

function run() {
runCase('rejects a reparse resource root before the first mutation', () => {
    const fixture = createFixture({ present: [true, false, true] });
    fixture.fsApi.replaceWithSymlink(
        fixture.plan.resourcesRoot,
        path.join(fixture.plan.extensionRoot, 'outside-resources'),
        'resources-reparse-entry',
    );

    const thrown = captureThrown(() => executeFixture(fixture, () => {}));

    assert.match(thrown.message, /resources root is not an exact directory/u);
    assert.strictEqual(fixture.fsApi.operationCount('mkdir'), 0);
    assert.strictEqual(fixture.fsApi.operationCount('rename'), 0);
    assertProbeAbsent(fixture);
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

console.log('Extension resource probe fault-injection tests passed (9 cases).');
}

function runCase(name, action) {
    try {
        action();
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

    mkdir(target) {
        return this.operate('mkdir', [this.key(target)], () => {
            const key = this.key(target);
            if (this.entries.has(key)) throw fileSystemError('EEXIST', key);
            const parent = this.entries.get(path.dirname(key));
            if (!parent || parent.kind !== 'directory') throw fileSystemError('ENOENT', key);
            this.entries.set(key, { kind: 'directory', id: `mkdir-${key}` });
        });
    }

    rmdir(target) {
        return this.operate('rmdir', [this.key(target)], () => {
            const key = this.key(target);
            const entry = this.requiredEntry(key);
            if (entry.kind !== 'directory') throw fileSystemError('ENOTDIR', key);
            if ([...this.entries.keys()].some((candidate) => path.dirname(candidate) === key)) {
                throw fileSystemError('ENOTEMPTY', key);
            }
            this.entries.delete(key);
        });
    }

    rename(source, destination) {
        return this.operate('rename', [this.key(source), this.key(destination)], () => {
            const sourceKey = this.key(source);
            const destinationKey = this.key(destination);
            const sourceEntry = this.requiredEntry(sourceKey);
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
            this.entries.set(key, {
                kind: 'file',
                id: current?.id ?? `write-${key}`,
                bytes: Buffer.from(bytes),
                mtimeMs: this.clock++,
                atimeMs: current?.atimeMs ?? this.clock++,
            });
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

    unlink(target) {
        return this.operate('unlink', [this.key(target)], () => {
            const key = this.key(target);
            const entry = this.requiredEntry(key);
            if (entry.kind === 'directory') throw fileSystemError('EISDIR', key);
            this.entries.delete(key);
        });
    }

    rmTree(target) {
        return this.operate('rmTree', [this.key(target)], () => {
            const key = this.key(target);
            const entry = this.requiredEntry(key);
            if (entry.kind !== 'directory') throw fileSystemError('ENOTDIR', key);
            for (const candidate of [...this.entries.keys()]) {
                if (candidate === key || candidate.startsWith(`${key}${path.sep}`)) {
                    this.entries.delete(candidate);
                }
            }
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
