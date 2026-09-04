const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { verifyVendoredAro } = require('../../tools/aro-frontend/verify-vendor');

const vendorRoot = path.resolve(__dirname, '..', '..', 'third_party', 'aro');
const receipt = verifyVendoredAro(vendorRoot);
const expectedDigest = '58502f21fa9c03d3e484c17e806b72e3fd6cc7bf40320b5b304988615bdfe009';

assert.strictEqual(receipt.commit, 'ec463262c14c1111fc9323086b708ad3b0b9ca11');
assert.strictEqual(receipt.tree, '7ddef8bd24b01ed7088d5d58d64d41e3d7529ed8');
assert.strictEqual(receipt.trackedFileCount, 791);
assert.strictEqual(receipt.zigVersion, '0.17.0-dev.1936+5a625d5f3');
assert.strictEqual(receipt.digest, expectedDigest);
assert.match(fs.readFileSync(path.join(receipt.root, 'LICENSE'), 'utf8'), /^MIT License/m);
assert.match(fs.readFileSync(path.join(receipt.root, 'LICENSE-UNICODE'), 'utf8'), /^UNICODE LICENSE V3/m);
assert.ok(!receipt.files.some((file) => file === '.git' || file.startsWith('.git/')));
assert.ok(!receipt.files.some((file) => file.startsWith('.zig-cache/') || file.startsWith('zig-out/')));

function withFixture(name, mutate, verify) {
    const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-aro-vendor-' + name + '-'));
    const fixtureRoot = path.join(fixtureParent, 'aro');
    try {
        fs.cpSync(vendorRoot, fixtureRoot, { recursive: true, dereference: false });
        mutate(fixtureRoot);
        verify(fixtureRoot);
    } finally {
        fs.rmSync(fixtureParent, { recursive: true, force: true });
    }
}

function expectRejected(name, mutate, message) {
    withFixture(name, mutate, (fixtureRoot) => {
        assert.throws(() => verifyVendoredAro(fixtureRoot), (error) => {
            assert.match(error.message, message);
            return true;
        });
    });
}

function readJson(root, file) {
    return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
}

function writeJson(root, file, value) {
    fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
}

function fileHash(file) {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function manifestEntry(root, file) {
    return readJson(root, 'UPSTREAM-MANIFEST.json').find((entry) => entry.path === file);
}

expectRejected('missing', (root) => {
    fs.rmSync(path.join(root, 'README.md'));
}, /upstream file is missing: README\.md/u);

expectRejected('extra', (root) => {
    fs.writeFileSync(path.join(root, 'unexpected.txt'), 'unexpected\n');
}, /unknown vendor file: unexpected\.txt/u);

expectRejected('changed', (root) => {
    fs.appendFileSync(path.join(root, 'README.md'), 'changed\n');
}, /upstream file changed without a matching allowlist record: README\.md/u);

expectRejected('forbidden-cache', (root) => {
    const cache = path.join(root, '.zig-cache');
    fs.mkdirSync(cache);
    fs.writeFileSync(path.join(cache, 'entry'), 'cache\n');
}, /forbidden vendor path: \.zig-cache/u);

expectRejected('partial-allowlist', (root) => {
    writeJson(root, 'MERC32-CHANGES.json', {
        formatVersion: 1,
        files: [{ path: 'README.md' }],
    });
}, /MERC32-CHANGES\.json record must contain only/u);

expectRejected('malformed-allowlist', (root) => {
    fs.writeFileSync(path.join(root, 'MERC32-CHANGES.json'), '{ not JSON\n');
}, /MERC32-CHANGES\.json is not valid JSON/u);

expectRejected('stale-current-hash', (root) => {
    const readme = path.join(root, 'README.md');
    fs.appendFileSync(readme, 'changed\n');
    const original = manifestEntry(root, 'README.md');
    writeJson(root, 'MERC32-CHANGES.json', {
        formatVersion: 1,
        files: [{
            path: 'README.md',
            upstreamSha256: original.sha256,
            sha256: '0'.repeat(64),
            reason: 'test fixture',
        }],
    });
}, /upstream file changed without a matching allowlist record: README\.md/u);

expectRejected('modified-null-upstream-hash', (root) => {
    const readme = path.join(root, 'README.md');
    fs.appendFileSync(readme, 'changed\n');
    writeJson(root, 'MERC32-CHANGES.json', {
        formatVersion: 1,
        files: [{
            path: 'README.md',
            upstreamSha256: null,
            sha256: fileHash(readme),
            reason: 'test fixture',
        }],
    });
}, /upstream file changed without a matching allowlist record: README\.md/u);

expectRejected('new-nonnull-upstream-hash', (root) => {
    const added = path.join(root, 'added.txt');
    fs.writeFileSync(added, 'added\n');
    writeJson(root, 'MERC32-CHANGES.json', {
        formatVersion: 1,
        files: [{
            path: 'added.txt',
            upstreamSha256: manifestEntry(root, 'README.md').sha256,
            sha256: fileHash(added),
            reason: 'test fixture',
        }],
    });
}, /unknown vendor file: added\.txt/u);

expectRejected('unsorted-manifest', (root) => {
    const manifest = readJson(root, 'UPSTREAM-MANIFEST.json');
    [manifest[0], manifest[1]] = [manifest[1], manifest[0]];
    writeJson(root, 'UPSTREAM-MANIFEST.json', manifest);
}, /UPSTREAM-MANIFEST\.json paths must be sorted and unique/u);

expectRejected('duplicate-manifest', (root) => {
    const manifest = readJson(root, 'UPSTREAM-MANIFEST.json');
    manifest[1].path = manifest[0].path;
    writeJson(root, 'UPSTREAM-MANIFEST.json', manifest);
}, /UPSTREAM-MANIFEST\.json paths must be sorted and unique/u);

expectRejected('case-ambiguous-manifest', (root) => {
    const manifest = readJson(root, 'UPSTREAM-MANIFEST.json');
    const readme = manifest.find((entry) => entry.path === 'README.md');
    readme.path = 'license';
    manifest.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
    writeJson(root, 'UPSTREAM-MANIFEST.json', manifest);
}, /case-ambiguous vendor path: LICENSE and license/u);

expectRejected('unknown-directory', (root) => {
    fs.mkdirSync(path.join(root, 'not-a-file'));
}, /unknown vendor directory: not-a-file/u);

let symlinkCreated = false;
withFixture('symlink', (root) => {
    try {
        fs.symlinkSync('README.md', path.join(root, 'linked-readme'));
        symlinkCreated = true;
    } catch (error) {
        if (error.code === 'EPERM' || error.code === 'EACCES') return;
        throw error;
    }
}, (root) => {
    if (!symlinkCreated) return;
    const link = path.join(root, 'linked-readme');
    assert.ok(fs.lstatSync(link).isSymbolicLink());
    assert.throws(() => verifyVendoredAro(root), /vendor snapshot contains a symlink: linked-readme/u);
});

async function testNonRegularFixture() {
    if (process.platform === 'win32') {
        assert.strictEqual(process.platform, 'win32');
        console.log('Non-regular fixture skipped: Windows does not create Unix-domain sockets in vendor directories.');
        return;
    }

    const fixtureParent = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-aro-vendor-non-regular-'));
    const fixtureRoot = path.join(fixtureParent, 'aro');
    const socketPath = path.join(fixtureRoot, 'non-regular.sock');
    const server = net.createServer();
    try {
        fs.cpSync(vendorRoot, fixtureRoot, { recursive: true, dereference: false });
        await new Promise((resolve, reject) => {
            server.once('error', reject);
            server.listen(socketPath, resolve);
        });
        assert.ok(fs.lstatSync(socketPath).isSocket());
        assert.throws(
            () => verifyVendoredAro(fixtureRoot),
            /vendor snapshot contains a non-file: non-regular\.sock/u,
        );
    } finally {
        if (server.listening) {
            await new Promise((resolve) => server.close(resolve));
        }
        fs.rmSync(fixtureParent, { recursive: true, force: true });
    }
}

void testNonRegularFixture().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});

console.log(`Aro vendor verified: commit=${receipt.commit} tree=${receipt.tree} files=${receipt.trackedFileCount} digest=${receipt.digest}`);
