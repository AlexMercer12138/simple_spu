const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { prepareResources } = require('./prepare-resources');

const extensionRoot = path.resolve(__dirname, '..');
const resourcesRoot = path.join(extensionRoot, 'resources');
const cacheRoot = path.join(extensionRoot, '.vscode-test');
const schemaFile = path.join(resourcesRoot, 'schema', 'merc32.schema.json');
const generatedTargets = Object.freeze([
    Object.freeze({
        label: 'resources/rtl',
        target: path.join(resourcesRoot, 'rtl'),
        backupName: 'rtl',
    }),
    Object.freeze({
        label: 'resources/licenses',
        target: path.join(resourcesRoot, 'licenses'),
        backupName: 'licenses',
    }),
    Object.freeze({
        label: 'resources/resource-manifest.json',
        target: path.join(resourcesRoot, 'resource-manifest.json'),
        backupName: 'resource-manifest.json',
    }),
]);

function run() {
    assertPackageScriptContract();

    const cacheRootExisted = fs.existsSync(cacheRoot);
    fs.mkdirSync(cacheRoot, { recursive: true });
    const backupRoot = fs.mkdtempSync(path.join(cacheRoot, 'resource-probe-'));
    const schemaSnapshot = snapshotSchema();
    const targetSnapshots = generatedTargets.map((entry) => ({
        ...entry,
        backup: path.join(backupRoot, entry.backupName),
        existed: fs.existsSync(entry.target),
        moved: false,
    }));
    let contractFailure;

    try {
        for (const snapshot of targetSnapshots) {
            if (!snapshot.existed) continue;
            fs.renameSync(snapshot.target, snapshot.backup);
            snapshot.moved = true;
        }

        prepareResources();
        assertPreparedResources();
    } catch (error) {
        contractFailure = error;
    }

    const cleanupFailures = restoreProbeState(
        backupRoot,
        cacheRootExisted,
        schemaSnapshot,
        targetSnapshots,
    );
    if (contractFailure && cleanupFailures.length > 0) {
        throw new AggregateError(
            [contractFailure, ...cleanupFailures],
            'Extension resource contract and cleanup both failed.',
        );
    }
    if (contractFailure) throw contractFailure;
    if (cleanupFailures.length > 0) {
        throw new AggregateError(cleanupFailures, 'Extension resource contract cleanup failed.');
    }

    console.log('Extension resource preparation contract passed; prior outputs restored.');
}

function assertPackageScriptContract() {
    const packageFile = path.join(extensionRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const scripts = packageJson.scripts || {};
    assert.strictEqual(
        scripts['test:extension:resources'],
        'node scripts/test-extension-resources.js',
        'test:extension:resources must execute the fresh-resource contract',
    );
    assert.deepStrictEqual(
        splitCommandStages(scripts['test:extension']),
        [
            'npm run test:extension:resources',
            'npm run prepare:resources',
            'npm run compile',
            'node out/test/runTest.js',
        ],
        'test:extension must verify and prepare resources before compile and host launch',
    );
    assert.ok(
        !scripts['test:extension'].includes('--unhandled-rejections'),
        'test:extension must use Node default unhandled-rejection behavior',
    );
}

function splitCommandStages(command) {
    assert.strictEqual(typeof command, 'string', 'test:extension script is missing');
    return command.split(/\s*&&\s*/u);
}

function snapshotSchema() {
    const status = fs.statSync(schemaFile);
    assert.ok(status.isFile(), 'tracked MERC32 schema is missing');
    return Object.freeze({
        bytes: fs.readFileSync(schemaFile),
        mtimeMs: status.mtimeMs,
    });
}

function assertPreparedResources() {
    assertDirectory(path.join(resourcesRoot, 'rtl'), 'generated RTL directory');
    assertFile(path.join(resourcesRoot, 'licenses', 'LICENSE'), 'packaged license');
    const manifestFile = path.join(resourcesRoot, 'resource-manifest.json');
    assertFile(manifestFile, 'resource manifest');

    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.strictEqual(manifest.manifestVersion, 1, 'unexpected resource manifest version');
    assert.strictEqual(typeof manifest.sourceRevision, 'string');
    assert.ok(manifest.sourceRevision.length > 0, 'resource manifest source revision is empty');
    assert.ok(Array.isArray(manifest.files), 'resource manifest files must be an array');

    const manifestPaths = new Set();
    for (const entry of manifest.files) {
        assert.ok(entry && typeof entry === 'object', 'resource manifest entry must be an object');
        assert.strictEqual(typeof entry.path, 'string', 'resource manifest path must be a string');
        assert.match(entry.sha256, /^[0-9a-f]{64}$/u, `invalid checksum for ${entry.path}`);
        assert.ok(!manifestPaths.has(entry.path), `duplicate resource manifest path: ${entry.path}`);
        manifestPaths.add(entry.path);
    }

    for (const logicalPath of [
        'rtl/cpu/MERC32_top.v',
        'licenses/LICENSE',
        'schema/merc32.schema.json',
    ]) {
        assert.ok(manifestPaths.has(logicalPath), `resource manifest is missing ${logicalPath}`);
        assertFile(
            path.join(resourcesRoot, ...logicalPath.split('/')),
            `manifest resource ${logicalPath}`,
        );
    }
}

function assertDirectory(target, label) {
    assert.ok(fs.lstatSync(target).isDirectory(), `${label} is not a directory`);
}

function assertFile(target, label) {
    assert.ok(fs.lstatSync(target).isFile(), `${label} is not a file`);
}

function restoreProbeState(backupRoot, cacheRootExisted, schemaSnapshot, targetSnapshots) {
    const failures = [];

    for (const snapshot of targetSnapshots) {
        captureFailure(failures, `remove generated ${snapshot.label}`, () => {
            removeExactGeneratedTarget(snapshot.target);
        });
        if (snapshot.moved) {
            captureFailure(failures, `restore prior ${snapshot.label}`, () => {
                fs.renameSync(snapshot.backup, snapshot.target);
            });
        }
    }

    captureFailure(failures, 'restore tracked schema', () => {
        fs.writeFileSync(schemaFile, schemaSnapshot.bytes);
        restoreSchemaTimestamps(schemaSnapshot);
        assert.deepStrictEqual(fs.readFileSync(schemaFile), schemaSnapshot.bytes);
        restoreSchemaTimestamps(schemaSnapshot);
        const restoredStatus = fs.statSync(schemaFile);
        assert.strictEqual(restoredStatus.mtimeMs, schemaSnapshot.mtimeMs);
    });

    captureFailure(failures, 'remove resource probe root', () => {
        fs.rmdirSync(backupRoot);
    });
    if (!cacheRootExisted) {
        captureFailure(failures, 'remove newly created VSCode test cache root', () => {
            fs.rmdirSync(cacheRoot);
        });
    }

    captureFailure(failures, 'verify resource probe postconditions', () => {
        assert.ok(!fs.existsSync(backupRoot), 'resource probe backup root remains');
        for (const snapshot of targetSnapshots) {
            assert.strictEqual(
                fs.existsSync(snapshot.target),
                snapshot.existed,
                `${snapshot.label} was not restored to its prior state`,
            );
        }
    });
    return failures;
}

function removeExactGeneratedTarget(target) {
    const resolved = path.resolve(target);
    assert.ok(
        generatedTargets.some((entry) => path.resolve(entry.target) === resolved),
        `refusing to remove unexpected resource target: ${resolved}`,
    );
    fs.rmSync(resolved, { recursive: true, force: true });
}

function restoreSchemaTimestamps(snapshot) {
    const currentAtimeMs = fs.statSync(schemaFile).atimeMs;
    fs.utimesSync(schemaFile, currentAtimeMs / 1000, snapshot.mtimeMs / 1000);
}

function captureFailure(failures, label, action) {
    try {
        action();
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        failures.push(new Error(`${label}: ${detail}`, { cause: error }));
    }
}

run();
