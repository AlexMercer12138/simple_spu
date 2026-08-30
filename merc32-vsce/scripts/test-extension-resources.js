const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const {
    buildResourceProbePlan,
    createNodeFsAdapter,
    runResourceProbe,
} = require('./extension-resource-probe');
const { prepareResources } = require('./prepare-resources');

const extensionRoot = path.resolve(__dirname, '..');
const resourcesRoot = path.join(extensionRoot, 'resources');

function run() {
    const plan = buildResourceProbePlan(extensionRoot, crypto.randomBytes(12).toString('hex'));
    runResourceProbe({
        plan,
        fsApi: createNodeFsAdapter(fs),
        beforeMutation: assertPackageScriptContract,
        prepare: () => prepareResources(),
        assertPrepared: assertPreparedResources,
    });
    console.log('Extension resource preparation contract passed; prior outputs restored.');
}

function assertPackageScriptContract() {
    const packageFile = path.join(extensionRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const scripts = packageJson.scripts || {};
    assert.strictEqual(
        scripts['test:extension:resources:unit'],
        'node scripts/test-extension-resource-probe.js',
        'test:extension:resources:unit must execute the resource fault-injection suite',
    );
    assert.strictEqual(
        scripts['test:extension:resources'],
        'npm run test:extension:resources:unit && node scripts/test-extension-resources.js',
        'test:extension:resources must execute unit and real-path resource contracts',
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

run();
