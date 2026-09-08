const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { runIsolatedResourcePreparation } = require('./extension-resource-stage');
const { prepareResourcesAtRoots } = require('./prepare-resources');

const extensionRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(extensionRoot, '..');

function run() {
    assertPackageScriptContract();
    const liveSnapshot = snapshotLiveGeneratedResources();
    let stageRoot;
    const result = runIsolatedResourcePreparation({
        extensionRoot,
        repositoryRoot,
        socApiRoot: extensionRoot,
        prepareResourcesFn: (options, stage) => {
            stageRoot = stage.stageRoot;
            const prepared = prepareResourcesAtRoots(options);
            for (const file of ['mem.asm', 'runtime.manifest.json', 'PROVENANCE.md']) {
                assert.deepStrictEqual(fs.readFileSync(path.join(stage.extensionRoot, 'resources/runtime/merc32', file)),
                    fs.readFileSync(path.join(repositoryRoot, 'runtime/merc32', file)),
                    `packaged runtime differs from authoritative source: ${file}`);
            }
            return prepared;
        },
    });
    assert.ok(result.files.includes('rtl/cpu/MERC32_top.v'),
        'isolated preparation did not produce the CPU top');
    assert.ok(result.files.includes('licenses/LICENSE'),
        'isolated preparation did not produce the packaged license');
    assert.ok(result.files.includes('schema/merc32.schema.json'),
        'isolated preparation did not produce the generated schema');
    assert.ok(result.files.includes('c-frontend/aro-merc32.wasm'),
        'isolated preparation did not retain the committed Aro WASM');
    assert.ok(result.files.includes('c-frontend/include/stdint.h'),
        'isolated preparation did not retain the committed freestanding headers');
    assert.ok(result.files.includes('runtime/merc32/mem.asm'), 'memory runtime missing from resource manifest');
    assert.deepStrictEqual(snapshotLiveGeneratedResources(), liveSnapshot,
        'isolated preparation changed live extension resources');
    assert.strictEqual(lstatOptional(stageRoot), undefined,
        'isolated preparation leaked its owned staging root');
    console.log('Extension resource preparation passed in an isolated fresh fixture.');
}

function assertPackageScriptContract() {
    const packageFile = path.join(extensionRoot, 'package.json');
    const packageJson = JSON.parse(fs.readFileSync(packageFile, 'utf8'));
    const scripts = packageJson.scripts || {};
    assert.strictEqual(
        scripts['test:extension:resources:unit'],
        'node scripts/test-extension-resource-stage.js',
        'test:extension:resources:unit must execute the staging boundary suite',
    );
    assert.strictEqual(
        scripts['test:extension:resources'],
        'npm run test:extension:resources:unit && node scripts/test-extension-resources.js',
        'test:extension:resources must execute focused and real staging contracts',
    );
    assert.deepStrictEqual(
        splitCommandStages(scripts['test:extension']),
        [
            'npm run test:extension:resources',
            'npm run prepare:resources',
            'npm run compile',
            'node out/test/runTest.js',
        ],
        'test:extension must prove freshness, prepare live resources, compile, and launch',
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

function snapshotLiveGeneratedResources() {
    return [
        'resources/rtl',
        'resources/runtime',
        'resources/licenses',
        'resources/resource-manifest.json',
        'resources/schema/merc32.schema.json',
    ].map((logicalPath) => [
        logicalPath,
        snapshotEntry(path.join(extensionRoot, ...logicalPath.split('/'))),
    ]);
}

function snapshotEntry(target) {
    const status = lstatOptional(target, true);
    if (status === undefined) return undefined;
    if (status.isSymbolicLink()) return Object.freeze({ kind: 'link' });
    if (status.isFile()) {
        return Object.freeze({
            kind: 'file',
            dev: status.dev.toString(),
            ino: status.ino.toString(),
            size: status.size.toString(),
            mtimeNs: status.mtimeNs.toString(),
            sha256: sha256File(target),
        });
    }
    assert.ok(status.isDirectory(), `live resource has unsupported type: ${target}`);
    return Object.freeze({
        kind: 'directory',
        dev: status.dev.toString(),
        ino: status.ino.toString(),
        entries: Object.freeze(fs.readdirSync(target).sort().map((name) => [
            name,
            snapshotEntry(path.join(target, name)),
        ])),
    });
}

function sha256File(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function lstatOptional(target, bigint = false) {
    if (target === undefined) return undefined;
    try {
        return fs.lstatSync(target, bigint ? { bigint: true } : undefined);
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
}

run();
