const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

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
const sourceInputs = prepareApi.discoverResourceInputs({
    extensionRoot: sourceExtensionRoot,
    repositoryRoot: sourceRepositoryRoot,
});
const fixtureSocApi = Object.freeze({
    loadCatalog: () => Object.freeze({}),
    generateSocSchema: () => Object.freeze({ type: 'object' }),
});

function run() {
    const cases = [
        ['isolates preexisting and during-prepare live victims',
            testLiveVictimsAndOrdinaryResourceSwap],
        ['retains a same-path victim after an ordinary temp ancestor swap',
            testOrdinaryAncestorSwap],
        ['cleans the exact owned stage after preparation fails',
            testPreparationFailureCleanup],
        ['requires absolute explicit preparation roots', testExplicitRootValidation],
        ['keeps wrapper defaults module-relative', testWrapperDefaults],
        ['rejects a relative wrapper repository override before mutation',
            () => testWrapperRelativeOverride('repositoryRoot')],
        ['rejects a relative wrapper extension override before mutation',
            () => testWrapperRelativeOverride('extensionRoot')],
        ['allows a partial absolute wrapper repository override',
            () => testWrapperPartialOverride('repositoryRoot')],
        ['allows a partial absolute wrapper extension override',
            () => testWrapperPartialOverride('extensionRoot')],
        ['rejects identical extension and repository roots before mutation',
            () => testPreparationTopology('identical extension and repository roots',
                (root) => ({
                    repositoryRoot: path.join(root, 'combined'),
                    extensionRoot: path.join(root, 'combined'),
                }))],
        ['rejects repository equal to extension resources before mutation',
            () => testPreparationTopology('repository equals extension resources', (root) => {
                const extensionRoot = path.join(root, 'extension');
                return { extensionRoot, repositoryRoot: path.join(extensionRoot, 'resources') };
            })],
        ['rejects repository below generated RTL before mutation',
            () => testPreparationTopology('repository is nested below generated RTL', (root) => {
                const extensionRoot = path.join(root, 'extension');
                return {
                    extensionRoot,
                    repositoryRoot: path.join(
                        extensionRoot, 'resources', 'rtl', 'repository'),
                };
            })],
        ['rejects generated resources below repository RTL before mutation',
            () => testPreparationTopology(
                'generated resources are nested below repository RTL',
                (root) => {
                    const repositoryRoot = path.join(root, 'repository');
                    return {
                        repositoryRoot,
                        extensionRoot: path.join(repositoryRoot, 'rtl', 'nested-extension'),
                    };
                })],
        ['rejects overlapping authoritative input roles before mutation',
            () => testPreparationTopology(
                'repository is nested below the extension catalog input',
                (root) => {
                    const extensionRoot = path.join(root, 'extension');
                    return {
                        extensionRoot,
                        repositoryRoot: path.join(
                            extensionRoot, 'resources', 'catalog', 'repository'),
                    };
                })],
        ['rejects a generated-output junction to an input before mutation',
            testGeneratedOutputAlias],
        ['rejects a webview-input junction to an output before mutation',
            testWebviewInputAlias],
        ['rejects a root reached through a junction ancestor before mutation',
            testRootAncestorAlias],
        ['rejects concrete input/output hardlink aliases before mutation',
            testConcreteInputOutputHardlinks],
        ['accepts distinct concrete input and output identities',
            testDistinctConcreteInputOutputIdentities],
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

function testWrapperDefaults() {
    withPreparationModuleFixture('wrapper-defaults',
        ({ api, repositoryRoot, extensionRoot }) => {
            installFixtureSocRuntime(extensionRoot);
            const revision = initializeFixtureRepository(repositoryRoot);
            const result = api.prepareResources();
            assert.strictEqual(result.sourceRevision, revision);
            assert.ok(result.files.includes('rtl/cpu/MERC32_top.v'),
                'module-relative default repository root was not used');
            assert.ok(fs.lstatSync(path.join(extensionRoot, 'resources',
                'resource-manifest.json')).isFile(),
            'module-relative default extension root was not used');
        });
}

function testWrapperRelativeOverride(overriddenRole) {
    withPreparationModuleFixture(`wrapper-relative-${overriddenRole}`,
        ({ api, fixtureRoot, repositoryRoot, extensionRoot }) => {
            const options = {
                repositoryRoot,
                extensionRoot,
                socApi: fixtureSocApi,
                sourceRevision: 'relative-override-revision',
            };
            options[overriddenRole] = path.basename(options[overriddenRole]);
            const workingDirectory = overriddenRole === 'extensionRoot'
                ? repositoryRoot
                : fixtureRoot;
            assertRejectedWithoutMutation(
                fixtureRoot,
                () => withWorkingDirectory(workingDirectory, () => api.prepareResources(options)),
                /absolute/u,
                `${overriddenRole} relative override`,
            );
        });
}

function testWrapperPartialOverride(overriddenRole) {
    withPreparationModuleFixture(`wrapper-partial-${overriddenRole}`,
        ({ api, fixtureRoot, extensionRoot }) => {
            const alternateRoot = path.join(fixtureRoot, `alternate-${overriddenRole}`);
            let expectedExtensionRoot = extensionRoot;
            const options = {
                socApi: fixtureSocApi,
                sourceRevision: `partial-${overriddenRole}-revision`,
            };
            if (overriddenRole === 'repositoryRoot') {
                copyRepositoryInputs(alternateRoot);
                options.repositoryRoot = alternateRoot;
            } else {
                copyAuthoritativeExtensionInputs(path.join(alternateRoot, 'resources'));
                options.extensionRoot = alternateRoot;
                expectedExtensionRoot = alternateRoot;
            }

            const result = api.prepareResources(options);
            assert.strictEqual(result.sourceRevision,
                `partial-${overriddenRole}-revision`);
            assert.ok(fs.lstatSync(path.join(expectedExtensionRoot, 'resources',
                'resource-manifest.json')).isFile(),
            `${overriddenRole} partial override did not use its deterministic counterpart`);
        });
}

function testPreparationTopology(name, layout) {
    withTopologyFixture(name, layout, ({ fixtureRoot, repositoryRoot, extensionRoot }) => {
        assertTopologyRejectedWithoutMutation(
            fixtureRoot,
            () => prepareApi.prepareResourcesAtRoots({
                repositoryRoot,
                extensionRoot,
                socApi: fixtureSocApi,
                sourceRevision: 'topology-fixture-revision',
            }),
            name,
        );
    });
}

function testGeneratedOutputAlias() {
    withTopologyFixture('generated RTL aliases repository RTL', (root) => ({
        repositoryRoot: path.join(root, 'repository'),
        extensionRoot: path.join(root, 'extension'),
    }), ({ fixtureRoot, repositoryRoot, extensionRoot }) => {
        const outputRtlRoot = path.join(extensionRoot, 'resources', 'rtl');
        if (!tryCreateDirectoryLink(path.join(repositoryRoot, 'rtl'), outputRtlRoot)) return;
        assertTopologyRejectedWithoutMutation(
            fixtureRoot,
            () => prepareApi.prepareResourcesAtRoots({
                repositoryRoot,
                extensionRoot,
                socApi: fixtureSocApi,
                sourceRevision: 'output-alias-revision',
            }),
            'generated RTL aliases repository RTL',
        );
    });
}

function testWebviewInputAlias() {
    withTopologyFixture('webview input aliases generated RTL', (root) => ({
        repositoryRoot: path.join(root, 'repository'),
        extensionRoot: path.join(root, 'extension'),
    }), ({ fixtureRoot, repositoryRoot, extensionRoot }) => {
        const resourcesRoot = path.join(extensionRoot, 'resources');
        const webviewRoot = path.join(resourcesRoot, 'webview');
        const outputRtlRoot = path.join(resourcesRoot, 'rtl');
        fs.renameSync(webviewRoot, outputRtlRoot);
        if (!tryCreateDirectoryLink(outputRtlRoot, webviewRoot)) {
            fs.renameSync(outputRtlRoot, webviewRoot);
            return;
        }
        assertTopologyRejectedWithoutMutation(
            fixtureRoot,
            () => prepareApi.prepareResourcesAtRoots({
                repositoryRoot,
                extensionRoot,
                socApi: fixtureSocApi,
                sourceRevision: 'webview-alias-revision',
            }),
            'webview input aliases generated RTL',
        );
    });
}

function testRootAncestorAlias() {
    const aliasFixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-root-alias-test-'));
    try {
        const realParent = path.join(aliasFixtureRoot, 'real-parent');
        const aliasParent = path.join(aliasFixtureRoot, 'alias-parent');
        const repositoryRoot = path.join(aliasFixtureRoot, 'repository');
        const realExtensionRoot = path.join(realParent, 'extension');
        copyRepositoryInputs(repositoryRoot);
        copyAuthoritativeExtensionInputs(path.join(realExtensionRoot, 'resources'));
        if (tryCreateDirectoryLink(realParent, aliasParent)) {
            const aliasedExtensionRoot = path.join(aliasParent, 'extension');
            assertTopologyRejectedWithoutMutation(
                aliasFixtureRoot,
                () => prepareApi.prepareResourcesAtRoots({
                    repositoryRoot,
                    extensionRoot: aliasedExtensionRoot,
                    socApi: fixtureSocApi,
                    sourceRevision: 'root-alias-revision',
                }),
                'extension root has a redirected ancestor',
            );
        }
    } finally {
        fs.rmSync(aliasFixtureRoot, { recursive: true, force: true });
    }
}

function testConcreteInputOutputHardlinks() {
    const aliases = [
        {
            name: 'schema output aliases catalog JSON',
            input: ['extension', 'resources', 'catalog', 'protocols.json'],
            output: ['extension', 'resources', 'schema', 'merc32.schema.json'],
        },
        {
            name: 'schema output aliases template',
            input: ['extension', 'resources', 'templates', 'main.c.tpl'],
            output: ['extension', 'resources', 'schema', 'merc32.schema.json'],
        },
        {
            name: 'schema output aliases readable RTL',
            input: ['repository', 'rtl', 'cpu', 'core.v'],
            output: ['extension', 'resources', 'schema', 'merc32.schema.json'],
        },
        {
            name: 'schema output aliases static license',
            input: ['repository', 'LICENSE'],
            output: ['extension', 'resources', 'schema', 'merc32.schema.json'],
        },
        {
            name: 'manifest output aliases catalog JSON',
            input: ['extension', 'resources', 'catalog', 'protocols.json'],
            output: ['extension', 'resources', 'resource-manifest.json'],
        },
        {
            name: 'generated RTL output aliases readable RTL input',
            input: ['repository', 'rtl', 'cpu', 'core.v'],
            output: ['extension', 'resources', 'rtl', 'cpu', 'core.v'],
        },
        {
            name: 'generated license output aliases static license input',
            input: ['repository', 'LICENSE'],
            output: ['extension', 'resources', 'licenses', 'LICENSE'],
        },
    ];
    const failures = [];
    for (const alias of aliases) {
        try {
            withTopologyFixture(alias.name, (root) => ({
                repositoryRoot: path.join(root, 'repository'),
                extensionRoot: path.join(root, 'extension'),
            }), ({ fixtureRoot, repositoryRoot, extensionRoot }) => {
                const roleRoots = { fixture: fixtureRoot, repository: repositoryRoot,
                    extension: extensionRoot };
                const input = path.join(roleRoots[alias.input[0]], ...alias.input.slice(1));
                const output = path.join(roleRoots[alias.output[0]], ...alias.output.slice(1));
                fs.mkdirSync(path.dirname(output), { recursive: true });
                fs.linkSync(input, output);
                assertTopologyRejectedWithoutMutation(
                    fixtureRoot,
                    () => prepareApi.prepareResourcesAtRoots({
                        repositoryRoot,
                        extensionRoot,
                        socApi: fixtureSocApi,
                        sourceRevision: 'hardlink-alias-revision',
                    }),
                    alias.name,
                );
            });
        } catch (error) {
            failures.push(new Error(`${alias.name}: ${error.message}`, { cause: error }));
        }
    }
    if (failures.length > 0) {
        throw new AggregateError(failures,
            `${failures.length} concrete hardlink topology contract(s) failed.`);
    }
}

function testDistinctConcreteInputOutputIdentities() {
    withTopologyFixture('distinct concrete identities', (root) => ({
        repositoryRoot: path.join(root, 'repository'),
        extensionRoot: path.join(root, 'extension'),
    }), ({ repositoryRoot, extensionRoot }) => {
        const result = prepareApi.prepareResourcesAtRoots({
            repositoryRoot,
            extensionRoot,
            socApi: fixtureSocApi,
            sourceRevision: 'distinct-identities-revision',
        });
        assert.strictEqual(result.sourceRevision, 'distinct-identities-revision');
        assert.ok(result.files.includes('rtl/cpu/core.v'),
            'valid topology did not prepare the readable CPU core');
        assert.ok(result.files.includes('licenses/LICENSE'),
            'valid topology did not prepare the static license');
    });
}

function withPreparationModuleFixture(name, action) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), `merc32-${name}-`));
    try {
        const repositoryRoot = path.join(fixtureRoot, 'repository');
        const extensionRoot = path.join(repositoryRoot, 'extension');
        copyRepositoryInputs(repositoryRoot);
        copyAuthoritativeExtensionInputs(path.join(extensionRoot, 'resources'));
        const scriptsRoot = path.join(extensionRoot, 'scripts');
        fs.mkdirSync(scriptsRoot);
        const moduleFile = path.join(scriptsRoot, 'prepare-resources.js');
        fs.copyFileSync(path.join(__dirname, 'prepare-resources.js'), moduleFile);
        const api = require(moduleFile);
        action({ api, fixtureRoot, repositoryRoot, extensionRoot });
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function installFixtureSocRuntime(extensionRoot) {
    const typescriptModule = path.join(extensionRoot, 'node_modules', 'typescript', 'index.js');
    fs.mkdirSync(path.dirname(typescriptModule), { recursive: true });
    fs.writeFileSync(typescriptModule, [
        'module.exports = {',
        '    ModuleKind: { CommonJS: 1 },',
        '    ScriptTarget: { ES2020: 1 },',
        '    transpileModule: (source) => ({ outputText: source }),',
        '};',
        '',
    ].join('\n'));
    const socModule = path.join(extensionRoot, 'src', 'soc', 'index.ts');
    fs.mkdirSync(path.dirname(socModule), { recursive: true });
    fs.writeFileSync(socModule, [
        'module.exports = {',
        '    loadCatalog: () => ({}),',
        '    generateSocSchema: () => ({ type: "object" }),',
        '};',
        '',
    ].join('\n'));
}

function initializeFixtureRepository(repositoryRoot) {
    runGit(repositoryRoot, ['init', '--quiet']);
    runGit(repositoryRoot, ['add', '--', 'LICENSE']);
    runGit(repositoryRoot, [
        '-c', 'user.name=MERC32 Test',
        '-c', 'user.email=merc32-test@example.invalid',
        'commit', '--quiet', '-m', 'fixture',
    ]);
    return runGit(repositoryRoot, ['rev-parse', 'HEAD']).trim();
}

function runGit(repositoryRoot, args) {
    const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
    assert.strictEqual(result.status, 0,
        `fixture git ${args[0]} failed: ${result.stderr || result.stdout}`);
    return result.stdout;
}

function withTopologyFixture(name, layout, action) {
    const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-topology-test-'));
    try {
        const { repositoryRoot, extensionRoot } = layout(fixtureRoot);
        copyRepositoryInputs(repositoryRoot);
        copyAuthoritativeExtensionInputs(path.join(extensionRoot, 'resources'));
        action({ name, fixtureRoot, repositoryRoot, extensionRoot });
    } finally {
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
}

function assertTopologyRejectedWithoutMutation(fixtureRoot, operation, label) {
    assertRejectedWithoutMutation(
        fixtureRoot,
        operation,
        /topology|overlap|linked|redirected/u,
        label,
    );
}

function assertRejectedWithoutMutation(fixtureRoot, operation, errorPattern, label) {
    const before = snapshotTree(fixtureRoot);
    let failure;
    try {
        operation();
    } catch (error) {
        failure = error;
    }
    const after = snapshotTree(fixtureRoot);
    assert.deepStrictEqual(after, before,
        `${label} mutated an authoritative input or output before rejection`);
    assert.ok(failure instanceof Error, `${label} was accepted`);
    assert.match(failure.message, errorPattern,
        `${label} failed after validation should have completed: ${failure.message}`);
}

function copyRepositoryInputs(destinationRoot) {
    for (const logicalPath of sourceInputs.rtlFiles) {
        const source = path.join(sourceRepositoryRoot, ...logicalPath.split('/'));
        const destination = path.join(destinationRoot, ...logicalPath.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(source, destination);
    }
    fs.mkdirSync(destinationRoot, { recursive: true });
    fs.copyFileSync(path.join(sourceRepositoryRoot, 'LICENSE'),
        path.join(destinationRoot, 'LICENSE'));
}

function snapshotTree(root) {
    const result = [];
    const visit = (target, logicalPath) => {
        const status = fs.lstatSync(target, { bigint: true });
        const metadata = [
            status.dev.toString(),
            status.ino.toString(),
            status.size.toString(),
            status.mtimeNs.toString(),
            status.ctimeNs.toString(),
        ];
        if (status.isSymbolicLink()) {
            result.push([logicalPath, 'link', ...metadata, fs.readlinkSync(target)]);
            return;
        }
        if (status.isFile()) {
            result.push([logicalPath, 'file', ...metadata, sha256File(target)]);
            return;
        }
        assert.ok(status.isDirectory(), `unsupported fixture entry: ${target}`);
        result.push([logicalPath, 'directory', ...metadata]);
        for (const name of fs.readdirSync(target).sort()) {
            visit(path.join(target, name), logicalPath === '' ? name : `${logicalPath}/${name}`);
        }
    };
    visit(root, '');
    return crypto.createHash('sha256').update(JSON.stringify(result)).digest('hex');
}

function sha256File(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function tryCreateDirectoryLink(target, link) {
    fs.mkdirSync(path.dirname(link), { recursive: true });
    try {
        fs.symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir');
        return true;
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES' || error.code === 'ENOSYS') {
            console.log(`  linked-root case skipped: ${error.code}`);
            return false;
        }
        throw error;
    }
}

function withWorkingDirectory(target, action) {
    const prior = process.cwd();
    process.chdir(target);
    try {
        action();
    } finally {
        process.chdir(prior);
    }
}

function copyAuthoritativeExtensionInputs(destinationResourcesRoot) {
    fs.cpSync(path.join(sourceExtensionRoot, 'resources', 'catalog'),
        path.join(destinationResourcesRoot, 'catalog'), { recursive: true });
    fs.cpSync(path.join(sourceExtensionRoot, 'resources', 'templates'),
        path.join(destinationResourcesRoot, 'templates'), { recursive: true });
    fs.cpSync(path.join(sourceExtensionRoot, 'resources', 'webview'),
        path.join(destinationResourcesRoot, 'webview'), { recursive: true });
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
