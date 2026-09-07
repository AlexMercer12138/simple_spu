'use strict';

const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
    assertExactZig,
    captureCandidateSnapshot,
    computeSourceTreeSha256,
    recoverPair,
    replacePair,
} = require('../rebuild');

{
    const repositoryRoot = path.resolve(__dirname, '..', '..', '..');
    const listed = childProcess.spawnSync(
        'git', ['ls-files', '-z', '--', 'tools/aro-frontend'],
        { cwd: repositoryRoot },
    );
    assert.strictEqual(listed.status, 0, listed.stderr?.toString('utf8'));
    const attributes = childProcess.spawnSync(
        'git', ['check-attr', '-z', '--stdin', 'text', 'eol'],
        { cwd: repositoryRoot, input: listed.stdout },
    );
    assert.strictEqual(attributes.status, 0, attributes.stderr?.toString('utf8'));
    const fields = attributes.stdout.toString('utf8').split('\0');
    fields.pop();
    assert.strictEqual(fields.length % 6, 0, 'Git returned incomplete source attribute records');
    for (let index = 0; index < fields.length; index += 6) {
        const [textPath, textName, textValue, eolPath, eolName, eolValue] = fields.slice(index, index + 6);
        assert.strictEqual(textName, 'text');
        assert.strictEqual(eolName, 'eol');
        assert.strictEqual(eolPath, textPath);
        assert.ok(textValue === 'unset' || eolValue === 'lf',
            `provenance input can change bytes across Git checkouts: ${textPath}`);
    }
}

function withFixture(run) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-rebuild-test-'));
    try {
        const vendorRoot = path.join(root, 'third_party', 'aro');
        const frontendRoot = path.join(root, 'tools', 'aro-frontend');
        fs.mkdirSync(path.join(vendorRoot, 'src'), { recursive: true });
        fs.mkdirSync(path.join(frontendRoot, 'src'), { recursive: true });
        fs.mkdirSync(path.join(frontendRoot, 'tests', 'fixtures'), { recursive: true });
        fs.mkdirSync(path.join(frontendRoot, '.zig-cache'), { recursive: true });
        fs.writeFileSync(path.join(vendorRoot, 'src', 'patched.zig'), 'patched-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'build.zig'), 'build-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'build.zig.zon'), 'dependencies-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'rebuild.js'), 'rebuild-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'verify-vendor.js'), 'verify-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'src', 'bridge.zig'), 'bridge-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'tests', 'bridge-host.js'), 'host-v1\n');
        fs.writeFileSync(path.join(frontendRoot, 'tests', 'fixtures', 'input.c'), 'int x;\n');
        fs.writeFileSync(path.join(frontendRoot, '.zig-cache', 'ignored.bin'), 'cache-v1\n');
        run({ root, vendorRoot, frontendRoot });
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function digest(fixture) {
    return computeSourceTreeSha256({
        vendor: {
            root: fixture.vendorRoot,
            files: ['src/patched.zig'],
        },
        frontendRoot: fixture.frontendRoot,
    });
}

withFixture((fixture) => {
    const original = digest(fixture);
    assert.match(original, /^[a-f0-9]{64}$/u);

    fs.writeFileSync(path.join(fixture.vendorRoot, 'src', 'patched.zig'), 'patched-v2\n');
    assert.notStrictEqual(digest(fixture), original,
        'patched vendored bytes must participate in provenance');

    fs.writeFileSync(path.join(fixture.vendorRoot, 'src', 'patched.zig'), 'patched-v1\n');
    fs.writeFileSync(path.join(fixture.frontendRoot, 'src', 'bridge.zig'), 'bridge-v2\n');
    assert.notStrictEqual(digest(fixture), original,
        'bridge bytes must participate in provenance');

    fs.writeFileSync(path.join(fixture.frontendRoot, 'src', 'bridge.zig'), 'bridge-v1\n');
    fs.writeFileSync(path.join(fixture.frontendRoot, 'build.zig'), 'build-v2\n');
    assert.notStrictEqual(digest(fixture), original,
        'build configuration bytes must participate in provenance');

    fs.writeFileSync(path.join(fixture.frontendRoot, 'build.zig'), 'build-v1\n');
    fs.writeFileSync(path.join(fixture.frontendRoot, '.zig-cache', 'ignored.bin'), 'cache-v2\n');
    assert.strictEqual(digest(fixture), original,
        'generated Zig cache bytes must not participate in provenance');
});

{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-linked-zig-'));
    try {
        const original = path.join(root, 'zig-original.exe');
        const linked = path.join(root, 'zig.exe');
        fs.writeFileSync(original, 'not executed');
        fs.linkSync(original, linked);
        assert.throws(() => assertExactZig(linked), /hard-linked/u,
            'a multiply linked Zig executable must be rejected before launch');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

withFixture((fixture) => {
    const bridge = path.join(fixture.frontendRoot, 'src', 'bridge.zig');
    const alias = path.join(fixture.frontendRoot, 'src', 'alias.zig');
    fs.linkSync(bridge, alias);
    assert.throws(() => digest(fixture), /hard-linked source input/u,
        'multiply linked source inputs must be rejected');
});

withFixture((fixture) => {
    const candidate = path.join(fixture.root, 'candidate.wasm');
    fs.writeFileSync(candidate, Buffer.from([0x00, 0x61, 0x73, 0x6d]));
    let reads = 0;
    const fileSystem = Object.create(fs);
    fileSystem.readFileSync = (...args) => {
        reads += 1;
        return fs.readFileSync(...args);
    };

    const snapshot = captureCandidateSnapshot(candidate, { fileSystem });
    fs.writeFileSync(candidate, Buffer.from([0xff, 0xff, 0xff, 0xff]));
    const exposed = snapshot.bytes();
    exposed.fill(0xee);

    assert.strictEqual(reads, 1, 'candidate bytes must be captured exactly once');
    assert.deepStrictEqual(snapshot.bytes(), Buffer.from([0x00, 0x61, 0x73, 0x6d]),
        'candidate snapshot must not share mutable bytes with callers or the source path');
    assert.strictEqual(snapshot.sha256(),
        'cd5d4935a48c0672cb06407bb443bc0087aff947c6b864bac886982c73b3027f');
});

function assertPair(root, expectedWasm, expectedManifest) {
    const targets = [
        ['aro-merc32.wasm', expectedWasm],
        ['build-manifest.json', expectedManifest],
    ];
    for (const [name, expected] of targets) {
        const target = path.join(root, name);
        if (expected === undefined) assert.strictEqual(fs.existsSync(target), false, `${name} must be absent`);
        else assert.deepStrictEqual(fs.readFileSync(target), Buffer.from(expected), `${name} bytes differ`);
    }
}

function assertNoTransactionDebris(root) {
    assert.deepStrictEqual(fs.readdirSync(root).sort(), [
        'aro-merc32.wasm', 'build-manifest.json',
    ].filter((name) => fs.existsSync(path.join(root, name))).sort());
}

for (const originals of [
    { wasm: undefined, manifest: undefined },
    { wasm: 'old-wasm', manifest: undefined },
    { wasm: undefined, manifest: 'old-manifest' },
    { wasm: 'old-wasm', manifest: 'old-manifest' },
]) {
    for (const failedTarget of ['aro-merc32.wasm', 'build-manifest.json']) {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-replace-failure-'));
        try {
            if (originals.wasm !== undefined) fs.writeFileSync(path.join(root, 'aro-merc32.wasm'), originals.wasm);
            if (originals.manifest !== undefined) {
                fs.writeFileSync(path.join(root, 'build-manifest.json'), originals.manifest);
            }
            const operations = Object.create(fs);
            let injected = false;
            operations.renameSync = (source, target) => {
                if (!injected && path.basename(target) === failedTarget
                    && path.basename(source).startsWith('.')) {
                    injected = true;
                    throw new Error(`forced ${failedTarget} install failure`);
                }
                return fs.renameSync(source, target);
            };
            assert.throws(() => replacePair(Buffer.from('new-wasm'), Buffer.from('new-manifest'), {
                resourceRoot: root,
                fileSystem: operations,
                generation: `failure-${failedTarget.replaceAll('.', '-')}`,
            }), /forced .* install failure/u);
            assertPair(root, originals.wasm, originals.manifest);
            assertNoTransactionDebris(root);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
}

for (const originals of [
    { wasm: undefined, manifest: undefined },
    { wasm: 'old-wasm', manifest: undefined },
    { wasm: undefined, manifest: 'old-manifest' },
    { wasm: 'old-wasm', manifest: 'old-manifest' },
]) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-replace-success-'));
    try {
        if (originals.wasm !== undefined) fs.writeFileSync(path.join(root, 'aro-merc32.wasm'), originals.wasm);
        if (originals.manifest !== undefined) {
            fs.writeFileSync(path.join(root, 'build-manifest.json'), originals.manifest);
        }
        replacePair(Buffer.from('new-wasm'), Buffer.from('new-manifest'), {
            resourceRoot: root,
            generation: `success-${originals.wasm === undefined ? 'no' : 'with'}-wasm-`
                + `${originals.manifest === undefined ? 'no' : 'with'}-manifest`,
        });
        assertPair(root, 'new-wasm', 'new-manifest');
        assertNoTransactionDebris(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-replace-cleanup-'));
    try {
        fs.writeFileSync(path.join(root, 'aro-merc32.wasm'), 'old-wasm');
        fs.writeFileSync(path.join(root, 'build-manifest.json'), 'old-manifest');
        let injected = false;
        const operations = Object.create(fs);
        operations.rmSync = (target, options) => {
            if (!injected && path.basename(target).endsWith('.old')) {
                injected = true;
                throw new Error('forced transient cleanup failure');
            }
            return fs.rmSync(target, options);
        };
        replacePair(Buffer.from('new-wasm'), Buffer.from('new-manifest'), {
            resourceRoot: root,
            fileSystem: operations,
            generation: 'cleanup-retry',
        });
        assert.strictEqual(injected, true, 'cleanup failure injection was not exercised');
        assertPair(root, 'new-wasm', 'new-manifest');
        assertNoTransactionDebris(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-replace-sync-'));
    try {
        const descriptors = new Map();
        let directorySyncs = 0;
        const operations = Object.create(fs);
        operations.openSync = (target, flags, mode) => {
            const descriptor = fs.openSync(target, flags, mode);
            descriptors.set(descriptor, path.resolve(target));
            return descriptor;
        };
        operations.fsyncSync = (descriptor) => {
            if (descriptors.get(descriptor) === path.resolve(root)) directorySyncs += 1;
            return fs.fsyncSync(descriptor);
        };
        operations.closeSync = (descriptor) => {
            descriptors.delete(descriptor);
            return fs.closeSync(descriptor);
        };
        replacePair(Buffer.from('new-wasm'), Buffer.from('new-manifest'), {
            resourceRoot: root,
            fileSystem: operations,
            generation: 'directory-sync',
        });
        assert.ok(directorySyncs >= 3,
            'the transaction must sync directory metadata across prepare, commit, and cleanup');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

function writeInterruptedTransaction(root, phase) {
    const generation = `interrupted-${phase}`;
    const names = {
        wasmNew: `.aro-merc32.wasm.gen-${generation}.new`,
        manifestNew: `.build-manifest.json.gen-${generation}.new`,
        wasmOld: `.aro-merc32.wasm.gen-${generation}.old`,
        manifestOld: `.build-manifest.json.gen-${generation}.old`,
    };
    fs.writeFileSync(path.join(root, names.wasmOld), 'old-wasm');
    fs.writeFileSync(path.join(root, names.manifestOld), 'old-manifest');
    fs.writeFileSync(path.join(root, 'aro-merc32.wasm'), 'new-wasm');
    fs.writeFileSync(path.join(root, 'build-manifest.json'), 'new-manifest');
    fs.writeFileSync(path.join(root, '.c-frontend-install.json'), `${JSON.stringify({
        protocolVersion: 1,
        generation,
        phase,
        originals: { wasm: true, manifest: true },
    }, null, 2)}\n`);
}

{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-recover-uncommitted-'));
    try {
        writeInterruptedTransaction(root, 'installing');
        recoverPair({ resourceRoot: root });
        assertPair(root, 'old-wasm', 'old-manifest');
        assertNoTransactionDebris(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

{
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-recover-committed-'));
    try {
        writeInterruptedTransaction(root, 'committed');
        recoverPair({ resourceRoot: root });
        assertPair(root, 'new-wasm', 'new-manifest');
        assertNoTransactionDebris(root);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

process.stdout.write('Aro rebuild provenance and candidate snapshot tests passed.\n');
