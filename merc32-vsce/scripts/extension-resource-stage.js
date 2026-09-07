const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    discoverResourceInputs,
    loadSocApi,
    prepareResourcesAtRoots,
    readSourceRevision,
} = require('./prepare-resources');

const STAGE_PREFIX = 'merc32-extension-resources-';
const GENERATED_OUTPUTS = Object.freeze([
    'resources/rtl',
    'resources/licenses',
    'resources/resource-manifest.json',
    'resources/schema',
]);

function runIsolatedResourcePreparation(options) {
    requireOptions(options);
    const extensionRoot = requireAbsolutePath(options.extensionRoot, 'extension root');
    const repositoryRoot = requireAbsolutePath(options.repositoryRoot, 'repository root');
    const inputs = discoverResourceInputs({ extensionRoot, repositoryRoot });
    const cFrontendHashes = new Map(inputs.cFrontendFiles.map((logicalPath) => [
        logicalPath,
        sha256File(path.join(extensionRoot, 'resources', ...logicalPath.split('/'))),
    ]));
    const socApiRoot = requireAbsolutePath(
        options.socApiRoot || extensionRoot,
        'SoC API root',
    );
    const socApi = options.socApi || loadSocApi(socApiRoot);
    const sourceRevision = options.sourceRevision || readSourceRevision(repositoryRoot);
    const prepareResourcesFn = options.prepareResourcesFn || prepareResourcesAtRoots;
    assert.strictEqual(typeof prepareResourcesFn, 'function',
        'prepareResourcesFn must be a function');

    const receipt = createOwnedStagingRoot(options.tempRoot || os.tmpdir());
    const stage = Object.freeze({
        stageRoot: receipt.stageRoot,
        repositoryRoot: path.join(receipt.stageRoot, 'repository'),
        extensionRoot: path.join(receipt.stageRoot, 'extension'),
    });
    let result;
    let primaryFailure;
    try {
        fs.mkdirSync(stage.repositoryRoot);
        fs.mkdirSync(stage.extensionRoot);
        copyPreparationInputs(
            { extensionRoot, repositoryRoot, inputs },
            stage,
        );
        assertNoGeneratedOutputs(stage.extensionRoot);
        result = prepareResourcesFn({
            extensionRoot: stage.extensionRoot,
            repositoryRoot: stage.repositoryRoot,
            socApi,
            sourceRevision,
        }, stage);
        assertPreparedStage(
            stage.extensionRoot,
            inputs,
            result,
            sourceRevision,
            cFrontendHashes,
        );
    } catch (error) {
        primaryFailure = error;
    }

    let cleanupFailure;
    try {
        removeOwnedStagingRoot(receipt);
    } catch (error) {
        cleanupFailure = error;
    }
    if (primaryFailure !== undefined && cleanupFailure !== undefined) {
        throw new AggregateError(
            [primaryFailure, cleanupFailure],
            'Isolated resource preparation and cleanup both failed.',
        );
    }
    if (primaryFailure !== undefined) throw primaryFailure;
    if (cleanupFailure !== undefined) throw cleanupFailure;
    return Object.freeze({
        files: Object.freeze([...result.files]),
        sourceRevision: result.sourceRevision,
    });
}

function createOwnedStagingRoot(tempRoot = os.tmpdir()) {
    const systemTempRoot = path.resolve(os.tmpdir());
    const resolvedTempRoot = requireAbsolutePath(tempRoot, 'temporary root');
    assertContained(systemTempRoot, resolvedTempRoot, 'temporary root');
    const ancestors = captureDirectoryChain(systemTempRoot, resolvedTempRoot);
    const stageRoot = fs.mkdtempSync(path.join(resolvedTempRoot, STAGE_PREFIX));
    const status = fs.lstatSync(stageRoot, { bigint: true });
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error(`Created staging root is not an exact directory: ${stageRoot}`);
    }
    return Object.freeze({
        stageRoot,
        stageIdentity: identityOf(status),
        ancestors: Object.freeze(ancestors),
    });
}

function removeOwnedStagingRoot(receipt) {
    assert.ok(receipt && typeof receipt === 'object', 'staging-root receipt is required');
    assert.ok(Array.isArray(receipt.ancestors), 'staging-root ancestor receipt is missing');
    for (const ancestor of receipt.ancestors) {
        requireIdentity(ancestor.target, ancestor.identity, 'temporary ancestor');
    }
    requireIdentity(receipt.stageRoot, receipt.stageIdentity, 'owned staging root');
    fs.rmSync(receipt.stageRoot, { recursive: true });
    if (lstatOptional(receipt.stageRoot) !== undefined) {
        throw new Error(`Owned staging root remains after cleanup: ${receipt.stageRoot}`);
    }
}

function copyPreparationInputs(source, stage) {
    for (const logicalPath of source.inputs.staticFiles) {
        copyLogicalFile(
            path.join(source.extensionRoot, 'resources'),
            path.join(stage.extensionRoot, 'resources'),
            logicalPath,
        );
    }
    for (const logicalPath of source.inputs.cFrontendFiles) {
        copyLogicalFile(
            path.join(source.extensionRoot, 'resources'),
            path.join(stage.extensionRoot, 'resources'),
            logicalPath,
        );
    }
    for (const logicalPath of source.inputs.rtlFiles) {
        copyLogicalFile(source.repositoryRoot, stage.repositoryRoot, logicalPath);
    }
    copyLogicalFile(source.repositoryRoot, stage.repositoryRoot, 'LICENSE');
}

function assertNoGeneratedOutputs(extensionRoot) {
    for (const logicalPath of GENERATED_OUTPUTS) {
        const target = path.join(extensionRoot, ...logicalPath.split('/'));
        assert.strictEqual(lstatOptional(target), undefined,
            `staging fixture contains prior generated output ${logicalPath}`);
    }
}

function assertPreparedStage(extensionRoot, inputs, result, sourceRevision,
    cFrontendHashes) {
    assert.ok(result && typeof result === 'object', 'preparation returned no result');
    const expectedFiles = [
        ...inputs.rtlFiles,
        ...inputs.staticFiles,
        ...inputs.cFrontendFiles,
        'licenses/LICENSE',
        'schema/merc32.schema.json',
    ].sort();
    assert.deepStrictEqual(result.files, expectedFiles,
        'prepared resource allowlist is incomplete or contains extras');
    assert.strictEqual(result.sourceRevision, sourceRevision,
        'prepared source revision changed');

    const resourcesRoot = path.join(extensionRoot, 'resources');
    const manifestFile = path.join(resourcesRoot, 'resource-manifest.json');
    requireExactFile(manifestFile, 'resource manifest');
    const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    assert.strictEqual(manifest.manifestVersion, 1, 'unexpected manifest version');
    assert.strictEqual(manifest.sourceRevision, sourceRevision,
        'resource manifest source revision changed');
    assert.ok(Array.isArray(manifest.files), 'resource manifest files must be an array');
    assert.deepStrictEqual(manifest.files.map((entry) => entry.path), expectedFiles,
        'resource manifest paths are incomplete or contain extras');
    for (const entry of manifest.files) {
        assert.ok(entry && typeof entry === 'object', 'manifest entry must be an object');
        assert.match(entry.sha256, /^[0-9a-f]{64}$/u,
            `invalid checksum for ${entry.path}`);
        const target = path.join(resourcesRoot, ...entry.path.split('/'));
        requireExactFile(target, `manifest resource ${entry.path}`);
        assert.strictEqual(entry.sha256, sha256File(target),
            `resource checksum mismatch for ${entry.path}`);
    }
    for (const logicalPath of inputs.cFrontendFiles) {
        const staged = path.join(resourcesRoot, ...logicalPath.split('/'));
        assert.strictEqual(sha256File(staged), cFrontendHashes.get(logicalPath),
            `resource preparation changed authoritative c-frontend input ${logicalPath}`);
    }

    const actualFiles = listLogicalFiles(resourcesRoot);
    assert.deepStrictEqual(actualFiles, [...expectedFiles, 'resource-manifest.json'].sort(),
        'staged resources contain files outside the prepared closure');
}

function captureDirectoryChain(root, target) {
    const components = path.relative(root, target);
    const paths = [root];
    if (components !== '') {
        let current = root;
        for (const component of components.split(path.sep)) {
            current = path.join(current, component);
            paths.push(current);
        }
    }
    return paths.map((entryPath) => {
        const status = fs.lstatSync(entryPath, { bigint: true });
        if (status.isSymbolicLink() || !status.isDirectory()) {
            throw new Error(`Temporary path is not an exact directory: ${entryPath}`);
        }
        return Object.freeze({ target: entryPath, identity: identityOf(status) });
    });
}

function requireIdentity(target, expected, label) {
    const status = lstatOptional(target, true);
    if (status === undefined || status.isSymbolicLink() || !status.isDirectory()
        || !sameIdentity(identityOf(status), expected)) {
        throw new Error(`${label} identity changed or was replaced: ${target}`);
    }
}

function identityOf(status) {
    return Object.freeze({ dev: status.dev.toString(), ino: status.ino.toString() });
}

function sameIdentity(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}

function requireAbsolutePath(value, label) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error(`Isolated resource ${label} must be an absolute path.`);
    }
    const resolved = path.resolve(value);
    const status = fs.lstatSync(resolved);
    if (status.isSymbolicLink() || !status.isDirectory()) {
        throw new Error(`Isolated resource ${label} is not an exact directory: ${resolved}.`);
    }
    return resolved;
}

function assertContained(root, target, label) {
    const relative = path.relative(root, target);
    if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
        throw new Error(`Isolated resource ${label} must be under the OS temporary root.`);
    }
}

function copyLogicalFile(sourceRoot, destinationRoot, logicalPath) {
    const source = path.join(sourceRoot, ...logicalPath.split('/'));
    const destination = path.join(destinationRoot, ...logicalPath.split('/'));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.copyFileSync(source, destination);
}

function listLogicalFiles(root) {
    const result = [];
    const visit = (current, prefix) => {
        const entries = fs.readdirSync(current, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const logicalPath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
            const target = path.join(current, entry.name);
            if (entry.isDirectory()) visit(target, logicalPath);
            else {
                assert.ok(entry.isFile(), `staged resource is not an exact file: ${logicalPath}`);
                result.push(logicalPath);
            }
        }
    };
    visit(root, '');
    return result.sort();
}

function requireExactFile(target, label) {
    const status = fs.lstatSync(target);
    assert.ok(!status.isSymbolicLink() && status.isFile(), `${label} is not an exact file`);
}

function sha256File(target) {
    return crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
}

function lstatOptional(target, bigint = false) {
    try {
        return fs.lstatSync(target, bigint ? { bigint: true } : undefined);
    } catch (error) {
        if (error.code === 'ENOENT') return undefined;
        throw error;
    }
}

function requireOptions(options) {
    if (options === null || typeof options !== 'object') {
        throw new TypeError('Isolated resource preparation options are required.');
    }
}

module.exports = {
    STAGE_PREFIX,
    createOwnedStagingRoot,
    removeOwnedStagingRoot,
    runIsolatedResourcePreparation,
};
