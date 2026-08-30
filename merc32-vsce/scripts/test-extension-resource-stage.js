const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const prepareApi = require('./prepare-resources');

let stageApi = {};
try {
    stageApi = require('./extension-resource-stage');
} catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND'
        || !String(error.message).includes('extension-resource-stage')) throw error;
}

const sourceExtensionRoot = path.resolve(__dirname, '..');
const sourceRepositoryRoot = path.resolve(sourceExtensionRoot, '..');

function run() {
    const cases = [
        ['isolates preexisting and during-prepare live victims',
            testLiveVictimsAndOrdinaryResourceSwap],
        ['retains a same-path victim after an ordinary temp ancestor swap',
            testOrdinaryAncestorSwap],
        ['cleans the exact owned stage after preparation fails',
            testPreparationFailureCleanup],
        ['requires absolute explicit preparation roots', testExplicitRootValidation],
    ];
    const failures = [];
    for (const [name, testCase] of cases) {
        try {
            testCase();
        } catch (error) {
            failures.push(new Error(`${name}: ${error.message}`, { cause: error }));
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures,
            `${failures.length} isolated resource staging contract(s) failed.`);
    }
    console.log(`Extension resource staging tests passed (${cases.length} cases).`);
}

function testLiveVictimsAndOrdinaryResourceSwap() {
    requireFunction(stageApi.runIsolatedResourcePreparation,
        'isolated resource preparation runner');
    requireFunction(prepareApi.prepareResourcesAtRoots,
        'explicit-root resource preparation API');

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-stage-isolation-test-'));
    try {
        const liveExtensionRoot = path.join(fixtureRoot, 'live-extension');
        const liveResourcesRoot = path.join(liveExtensionRoot, 'resources');
        copyAuthoritativeExtensionInputs(liveResourcesRoot);
        writeVictimOutputs(liveResourcesRoot, 'before');

        const displacedResourcesRoot = path.join(liveExtensionRoot, 'resources-before-swap');
        let replacementSnapshot;
        const beforeSnapshot = snapshotVictimOutputs(liveResourcesRoot, 'before');
        const result = stageApi.runIsolatedResourcePreparation({
            extensionRoot: liveExtensionRoot,
            repositoryRoot: sourceRepositoryRoot,
            socApiRoot: sourceExtensionRoot,
            sourceRevision: 'isolated-fixture-revision',
            tempRoot: fixtureRoot,
            prepareResourcesFn: (options, stage) => {
                assert.notStrictEqual(options.extensionRoot, liveExtensionRoot,
                    'preparation must receive the staged extension root');
                assert.notStrictEqual(options.repositoryRoot, sourceRepositoryRoot,
                    'preparation must receive the staged repository root');
                assertStageStartsWithoutGeneratedOutputs(stage.extensionRoot);

                fs.renameSync(liveResourcesRoot, displacedResourcesRoot);
                fs.mkdirSync(liveResourcesRoot, { recursive: true });
                writeVictimOutputs(liveResourcesRoot, 'during');
                replacementSnapshot = snapshotVictimOutputs(liveResourcesRoot, 'during');
                return prepareApi.prepareResourcesAtRoots(options);
            },
        });

        assert.strictEqual(result.sourceRevision, 'isolated-fixture-revision');
        assert.ok(result.files.includes('rtl/cpu/MERC32_top.v'),
            'staged output is missing the CPU top');
        assert.ok(result.files.includes('licenses/LICENSE'),
            'staged output is missing the packaged license');
        assert.ok(result.files.includes('schema/merc32.schema.json'),
            'staged output is missing the generated schema');
        assert.deepStrictEqual(
            snapshotVictimOutputs(displacedResourcesRoot, 'before'),
            beforeSnapshot,
            'preexisting live generated outputs changed',
        );
        assert.deepStrictEqual(
            snapshotVictimOutputs(liveResourcesRoot, 'during'),
            replacementSnapshot,
            'during-prepare ordinary-directory victim changed',
        );
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function testOrdinaryAncestorSwap() {
    requireFunction(stageApi.createOwnedStagingRoot, 'owned staging-root creator');
    requireFunction(stageApi.removeOwnedStagingRoot, 'owned staging-root cleanup');

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-stage-ancestor-test-'));
    try {
        const tempParent = path.join(fixtureRoot, 'temp-parent');
        const displacedParent = path.join(fixtureRoot, 'temp-parent-owned');
        fs.mkdirSync(tempParent);
        const receipt = stageApi.createOwnedStagingRoot(tempParent);
        const stageName = path.basename(receipt.stageRoot);

        fs.renameSync(tempParent, displacedParent);
        fs.mkdirSync(tempParent);
        const victimRoot = path.join(tempParent, stageName);
        fs.mkdirSync(victimRoot);
        const victimFile = path.join(victimRoot, 'victim.txt');
        fs.writeFileSync(victimFile, 'ordinary-directory-victim\n');

        assert.throws(
            () => stageApi.removeOwnedStagingRoot(receipt),
            /identity changed|replaced/u,
            'cleanup must reject an ordinary ancestor replacement',
        );
        assert.strictEqual(fs.readFileSync(victimFile, 'utf8'),
            'ordinary-directory-victim\n', 'cleanup deleted or changed the victim');
        assert.ok(fs.lstatSync(path.join(displacedParent, stageName)).isDirectory(),
            'cleanup must retain the ambiguously displaced owned root');
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function testPreparationFailureCleanup() {
    requireFunction(stageApi.runIsolatedResourcePreparation,
        'isolated resource preparation runner');

    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-stage-failure-test-'));
    try {
        const liveExtensionRoot = path.join(fixtureRoot, 'live-extension');
        copyAuthoritativeExtensionInputs(path.join(liveExtensionRoot, 'resources'));
        let createdStageRoot;
        assert.throws(() => stageApi.runIsolatedResourcePreparation({
            extensionRoot: liveExtensionRoot,
            repositoryRoot: sourceRepositoryRoot,
            socApiRoot: sourceExtensionRoot,
            sourceRevision: 'failure-fixture-revision',
            tempRoot: fixtureRoot,
            prepareResourcesFn: (_options, stage) => {
                createdStageRoot = stage.stageRoot;
                throw new Error('injected preparation failure');
            },
        }), /injected preparation failure/u);
        assert.strictEqual(lstatOptional(createdStageRoot), undefined,
            'failed preparation leaked its owned staging root');
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function testExplicitRootValidation() {
    requireFunction(prepareApi.prepareResourcesAtRoots,
        'explicit-root resource preparation API');
    assert.throws(() => prepareApi.prepareResourcesAtRoots({
        extensionRoot: '.',
        repositoryRoot: '..',
        socApi: {},
        sourceRevision: 'relative-root-test',
    }), /absolute/u, 'explicit preparation roots must reject relative paths');
}

function copyAuthoritativeExtensionInputs(destinationResourcesRoot) {
    fs.cpSync(path.join(sourceExtensionRoot, 'resources', 'catalog'),
        path.join(destinationResourcesRoot, 'catalog'), { recursive: true });
    fs.cpSync(path.join(sourceExtensionRoot, 'resources', 'templates'),
        path.join(destinationResourcesRoot, 'templates'), { recursive: true });
}

function writeVictimOutputs(resourcesRoot, marker) {
    const entries = [
        ['rtl/victim.v', `rtl-${marker}\n`],
        ['licenses/LICENSE', `license-${marker}\n`],
        ['resource-manifest.json', `manifest-${marker}\n`],
        ['schema/merc32.schema.json', `schema-${marker}\n`],
    ];
    for (const [logicalPath, bytes] of entries) {
        const target = path.join(resourcesRoot, ...logicalPath.split('/'));
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
    }
}

function snapshotVictimOutputs(resourcesRoot, marker) {
    return [
        'rtl/victim.v',
        'licenses/LICENSE',
        'resource-manifest.json',
        'schema/merc32.schema.json',
    ].map((logicalPath) => {
        const target = path.join(resourcesRoot, ...logicalPath.split('/'));
        return [logicalPath, fs.readFileSync(target, 'utf8'), marker];
    });
}

function assertStageStartsWithoutGeneratedOutputs(stageExtensionRoot) {
    for (const logicalPath of [
        'resources/rtl',
        'resources/licenses',
        'resources/resource-manifest.json',
        'resources/schema',
    ]) {
        assert.strictEqual(
            lstatOptional(path.join(stageExtensionRoot, ...logicalPath.split('/'))),
            undefined,
            `staging fixture already contains generated output ${logicalPath}`,
        );
    }
}

function lstatOptional(target) {
    if (target === undefined) return undefined;
    try {
        return fs.lstatSync(target);
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
}

function requireFunction(value, label) {
    assert.strictEqual(typeof value, 'function', `${label} is missing`);
}

run();
