const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PINNED_UPSTREAM = Object.freeze({
    repository: 'https://github.com/Vexu/arocc.git',
    commit: 'ec463262c14c1111fc9323086b708ad3b0b9ca11',
    tree: '7ddef8bd24b01ed7088d5d58d64d41e3d7529ed8',
    trackedFileCount: 791,
    zigVersion: '0.17.0-dev.1936+5a625d5f3',
    manifest: 'UPSTREAM-MANIFEST.json',
    licenses: ['LICENSE', 'LICENSE-UNICODE'],
});

const METADATA_FILES = new Set([
    'UPSTREAM.json',
    'UPSTREAM-MANIFEST.json',
    'MERC32-CHANGES.json',
    'MERC32-CHANGES.md',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

function verifyVendoredAro(root) {
    const resolvedRoot = path.resolve(root);
    const metadataPath = path.join(resolvedRoot, 'UPSTREAM.json');
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`${formatRootPath(resolvedRoot, 'UPSTREAM.json')} is missing`);
    }

    assertDirectory(resolvedRoot, 'vendor root');
    const upstream = readJson(metadataPath, 'UPSTREAM.json');
    assertExactObject(upstream, Object.keys(PINNED_UPSTREAM), 'UPSTREAM.json');
    for (const [field, expected] of Object.entries(PINNED_UPSTREAM)) {
        if (JSON.stringify(upstream[field]) !== JSON.stringify(expected)) {
            throw new Error(`UPSTREAM.json ${field} does not match the pinned upstream`);
        }
    }

    const manifest = readManifest(path.join(resolvedRoot, upstream.manifest));
    const changes = readChanges(path.join(resolvedRoot, 'MERC32-CHANGES.json'));
    const actualFiles = listRegularFiles(resolvedRoot);
    const sourceFiles = new Map();
    for (const [file, hash] of actualFiles) {
        if (!METADATA_FILES.has(file)) sourceFiles.set(file, hash);
    }

    verifySnapshot(manifest, sourceFiles, changes);
    verifyLicenses(resolvedRoot, upstream.licenses);

    return Object.freeze({
        root: resolvedRoot,
        commit: upstream.commit,
        tree: upstream.tree,
        trackedFileCount: upstream.trackedFileCount,
        zigVersion: upstream.zigVersion,
        files: Object.freeze([...sourceFiles.keys()].sort()),
        digest: sha256(Buffer.from(JSON.stringify(manifest))),
    });
}

function readManifest(manifestPath) {
    if (!fs.existsSync(manifestPath)) throw new Error(`${path.basename(manifestPath)} is missing`);
    const manifest = readJson(manifestPath, path.basename(manifestPath));
    if (!Array.isArray(manifest) || manifest.length !== PINNED_UPSTREAM.trackedFileCount) {
        throw new Error(`UPSTREAM-MANIFEST.json must contain ${PINNED_UPSTREAM.trackedFileCount} files`);
    }

    const files = new Map();
    let previousPath = '';
    for (const entry of manifest) {
        assertExactObject(entry, ['path', 'sha256'], 'UPSTREAM-MANIFEST.json entry');
        assertVendorPath(entry.path, 'UPSTREAM-MANIFEST.json path');
        assertSha256(entry.sha256, `UPSTREAM-MANIFEST.json hash for ${entry.path}`);
        if (entry.path <= previousPath) throw new Error('UPSTREAM-MANIFEST.json paths must be sorted and unique');
        if (METADATA_FILES.has(entry.path)) throw new Error(`UPSTREAM-MANIFEST.json includes local metadata ${entry.path}`);
        previousPath = entry.path;
        files.set(entry.path, entry.sha256);
    }
    return files;
}

function readChanges(changesPath) {
    if (!fs.existsSync(changesPath)) throw new Error('MERC32-CHANGES.json is missing');
    const changes = readJson(changesPath, 'MERC32-CHANGES.json');
    assertExactObject(changes, ['formatVersion', 'files'], 'MERC32-CHANGES.json');
    if (changes.formatVersion !== 1 || !Array.isArray(changes.files)) {
        throw new Error('MERC32-CHANGES.json has an unsupported format');
    }

    const records = new Map();
    for (const record of changes.files) {
        assertExactObject(record, ['path', 'upstreamSha256', 'sha256', 'reason'], 'MERC32-CHANGES.json record');
        assertVendorPath(record.path, 'MERC32-CHANGES.json path');
        if (METADATA_FILES.has(record.path)) throw new Error(`MERC32-CHANGES.json cannot allowlist metadata ${record.path}`);
        if (record.upstreamSha256 !== null) assertSha256(record.upstreamSha256, `upstream hash for ${record.path}`);
        assertSha256(record.sha256, `current hash for ${record.path}`);
        if (typeof record.reason !== 'string' || record.reason.trim() === '') {
            throw new Error(`MERC32-CHANGES.json reason for ${record.path} is missing`);
        }
        if (records.has(record.path)) throw new Error(`MERC32-CHANGES.json duplicates ${record.path}`);
        records.set(record.path, record);
    }
    return records;
}

function verifySnapshot(manifest, actualFiles, changes) {
    const consumedChanges = new Set();
    for (const [file, upstreamHash] of manifest) {
        const currentHash = actualFiles.get(file);
        if (currentHash === undefined) throw new Error(`upstream file is missing: ${file}`);
        if (currentHash === upstreamHash) continue;

        const change = changes.get(file);
        if (!change || change.upstreamSha256 !== upstreamHash || change.sha256 !== currentHash) {
            throw new Error(`upstream file changed without a matching allowlist record: ${file}`);
        }
        consumedChanges.add(file);
    }

    for (const [file, currentHash] of actualFiles) {
        if (manifest.has(file)) continue;
        const change = changes.get(file);
        if (!change || change.upstreamSha256 !== null || change.sha256 !== currentHash) {
            throw new Error(`unknown vendor file: ${file}`);
        }
        consumedChanges.add(file);
    }

    for (const file of changes.keys()) {
        if (!consumedChanges.has(file)) {
            throw new Error(`MERC32-CHANGES.json has a stale allowlist record: ${file}`);
        }
    }
}

function verifyLicenses(root, licenses) {
    const [license, unicodeLicense] = licenses;
    const licenseText = fs.readFileSync(path.join(root, license), 'utf8');
    const unicodeLicenseText = fs.readFileSync(path.join(root, unicodeLicense), 'utf8');
    if (!/^MIT License/mu.test(licenseText)) throw new Error(`${license} is not the MIT license`);
    if (!/^UNICODE LICENSE V3/mu.test(unicodeLicenseText)) {
        throw new Error(`${unicodeLicense} is not the Unicode license`);
    }
}

function listRegularFiles(root) {
    const files = new Map();
    const visit = (directory, relativeDirectory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            const absolutePath = path.join(directory, entry.name);
            const status = fs.lstatSync(absolutePath);
            if (status.isSymbolicLink()) throw new Error(`vendor snapshot contains a symlink: ${relativePath}`);
            if (status.isDirectory()) {
                visit(absolutePath, relativePath);
                continue;
            }
            if (!status.isFile()) throw new Error(`vendor snapshot contains a non-file: ${relativePath}`);
            files.set(relativePath.replace(/\\/gu, '/'), sha256(fs.readFileSync(absolutePath)));
        }
    };
    visit(root, '');
    return files;
}

function readJson(file, label) {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`${label} is not valid JSON: ${error.message}`);
    }
}

function assertExactObject(value, keys, label) {
    if (value === null || Array.isArray(value) || typeof value !== 'object') {
        throw new Error(`${label} must be an object`);
    }
    const actualKeys = Object.keys(value).sort();
    const expectedKeys = [...keys].sort();
    if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
        throw new Error(`${label} must contain only ${expectedKeys.join(', ')}`);
    }
}

function assertVendorPath(value, label) {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\\') || value.startsWith('/')
        || value.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(`${label} is not a normalized relative path`);
    }
}

function assertSha256(value, label) {
    if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) throw new Error(`${label} is not a SHA-256 digest`);
}

function assertDirectory(directory, label) {
    const status = fs.lstatSync(directory);
    if (status.isSymbolicLink() || !status.isDirectory()) throw new Error(`${label} must be a directory, not a link`);
}

function formatRootPath(root, file) {
    const normalizedRoot = root.replace(/\\/gu, '/');
    const marker = '/third_party/aro';
    const markerIndex = normalizedRoot.lastIndexOf(marker);
    const displayRoot = markerIndex >= 0 ? normalizedRoot.slice(markerIndex + 1) : normalizedRoot;
    return `${displayRoot}/${file}`;
}

function sha256(contents) {
    return crypto.createHash('sha256').update(contents).digest('hex');
}

module.exports = { verifyVendoredAro };
