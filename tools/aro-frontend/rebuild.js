'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { verifyVendoredAro } = require('./verify-vendor');

const ZIG_VERSION = '0.17.0-dev.1936+5a625d5f3';
const ARO_REVISION = 'ec463262c14c1111fc9323086b708ad3b0b9ca11';
const FRONTEND_ROOT = path.resolve(__dirname);
const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const RESOURCE_ROOT = path.join(REPOSITORY_ROOT, 'merc32-vsce', 'resources', 'c-frontend');
const WASM_LIMIT = 4 * 1024 * 1024;
const MEMORY_LIMIT_PAGES = (128 * 1024 * 1024) / 65536;
const GENERATED_FRONTEND_DIRECTORIES = new Set(['.zig-cache', 'zig-out']);
const ORPHAN_GENERATION_NEW = /^\.(?:c-frontend-install\.json|aro-merc32\.wasm|build-manifest\.json)\.gen-[a-z0-9][a-z0-9-]{0,127}\.new$/u;

function main() {
    const zig = resolveZig(process.argv.slice(2));
    assertExactZig(zig);
    const vendor = verifyVendoredAro(path.join(REPOSITORY_ROOT, 'third_party', 'aro'));
    assert.strictEqual(vendor.commit, ARO_REVISION);
    const sourceTreeSha256 = computeSourceTreeSha256({ vendor, frontendRoot: FRONTEND_ROOT });
    const bridgeBuildId = `merc32-aro-v1-${sourceTreeSha256}`;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-aro-rebuild-'));
    try {
        const cache = path.join(temporary, 'cache');
        const globalCache = path.join(temporary, 'global-cache');
        const prefix = path.join(temporary, 'prefix');
        fs.mkdirSync(cache);
        fs.mkdirSync(globalCache);
        fs.mkdirSync(prefix);
        runZigBuild(zig, cache, globalCache, prefix, bridgeBuildId);
        const candidate = findWasm(cache);
        assert.ok(candidate, 'zig build did not produce aro-merc32.wasm');
        const snapshot = captureCandidateSnapshot(candidate);
        assert.ok(snapshot.length <= WASM_LIMIT,
            `Aro WASM exceeds ${WASM_LIMIT} bytes: ${snapshot.length}`);
        auditWasm(snapshot.bytes(), sourceTreeSha256);
        runNodeContract(snapshot.bytes(), bridgeBuildId);

        const wasmSha256 = snapshot.sha256();
        const manifest = {
            manifestVersion: 1,
            aroRevision: ARO_REVISION,
            zigVersion: ZIG_VERSION,
            bridgeProtocolVersion: 1,
            typedUnitSchemaVersion: 1,
            target: 'merc32',
            abi: 'merc32-c-v1',
            dataModel: 'merc32-ilp32',
            bridgeBuildId,
            sourceTreeSha256,
            wasmSha256,
        };
        const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        replacePair(snapshot.bytes(), manifestBytes);
        process.stdout.write(`Rebuilt Aro WASM ${wasmSha256} from ${sourceTreeSha256}.\n`);
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

function resolveZig(args) {
    const index = args.indexOf('--zig');
    const value = index >= 0 ? args[index + 1] : process.env.MERC32_ZIG;
    if (index >= 0 && (!value || value.startsWith('--'))) {
        throw new Error('Usage: node tools/aro-frontend/rebuild.js --zig <absolute zig executable>');
    }
    if (typeof value !== 'string' || !path.isAbsolute(value)) {
        throw new Error('MERC32_ZIG/--zig must be an absolute path to the Zig executable.');
    }
    return path.resolve(value);
}

function assertExactZig(zig) {
    const status = fs.lstatSync(zig);
    assert.ok(status.isFile() && !status.isSymbolicLink(),
        `Zig executable is not a regular file: ${zig}`);
    assert.strictEqual(status.nlink, 1, `Zig executable is hard-linked: ${zig}`);
    assert.strictEqual(path.normalize(fs.realpathSync.native(zig)), path.normalize(zig),
        `Zig executable is redirected: ${zig}`);
    const result = spawnSync(zig, ['version'], { encoding: 'utf8' });
    assertSpawnPassed(result, 'zig version');
    assert.strictEqual(result.stdout.trim(), ZIG_VERSION,
        `unsupported Zig version: ${result.stdout.trim()}`);
}

function runZigBuild(zig, cache, globalCache, prefix, bridgeBuildId) {
    const result = spawnSync(zig, [
        'build',
        'test-data-model',
        'test-bridge',
        'test-serializer-types',
        'test-serializer-nodes',
        '-Doptimize=small',
        `-Dbridge-build-id=${bridgeBuildId}`,
        '--cache-dir', cache,
        '--prefix', prefix,
    ], {
        cwd: FRONTEND_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
        env: { ...process.env, ZIG_GLOBAL_CACHE_DIR: globalCache },
    });
    assertSpawnPassed(result, 'Aro Zig contract build', result.stdout + result.stderr);
}

function findWasm(root) {
    const matches = [];
    const visit = (directory) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
            const target = path.join(directory, entry.name);
            if (entry.isDirectory()) visit(target);
            else if (entry.isFile() && entry.name === 'aro-merc32.wasm') matches.push(target);
        }
    };
    visit(root);
    assert.strictEqual(matches.length, 1,
        `expected one temporary aro-merc32.wasm, found ${matches.length}`);
    return matches[0];
}

function auditWasm(bytes, sourceTreeSha256) {
    const moduleObject = new WebAssembly.Module(bytes);
    assert.deepStrictEqual(WebAssembly.Module.imports(moduleObject), [{
        module: 'merc32_source', name: 'resolve', kind: 'function',
    }]);
    const exports = WebAssembly.Module.exports(moduleObject).map((item) => item.name).sort();
    assert.deepStrictEqual(exports, [
        'memory', 'merc32_alloc', 'merc32_analyze', 'merc32_build_id_len',
        'merc32_build_id_ptr', 'merc32_protocol_version', 'merc32_reset',
        'merc32_result_len', 'merc32_result_ptr',
    ]);
    assert.strictEqual(readMemoryMaximumPages(bytes), MEMORY_LIMIT_PAGES,
        'linear memory maximum must be exactly 128 MiB');
    assert.match(sourceTreeSha256, /^[a-f0-9]{64}$/u);
}

function readMemoryMaximumPages(bytes) {
    let offset = 8;
    while (offset < bytes.length) {
        const sectionId = bytes[offset++];
        const sectionSize = readUleb(bytes, offset);
        offset = sectionSize.next;
        const sectionEnd = offset + sectionSize.value;
        if (sectionId === 5) {
            const count = readUleb(bytes, offset);
            offset = count.next;
            assert.ok(count.value > 0, 'WASM memory section is empty');
            const flags = readUleb(bytes, offset);
            offset = flags.next;
            const initial = readUleb(bytes, offset);
            offset = initial.next;
            assert.strictEqual(flags.value & 1, 1, 'WASM memory has no declared maximum');
            return readUleb(bytes, offset).value;
        }
        offset = sectionEnd;
    }
    throw new Error('WASM memory section is missing');
}

function readUleb(bytes, offset) {
    let value = 0;
    let shift = 0;
    while (offset < bytes.length) {
        const byte = bytes[offset++];
        value += (byte & 0x7f) * 2 ** shift;
        if ((byte & 0x80) === 0) return { value, next: offset };
        shift += 7;
        if (shift > 53) throw new Error('WASM ULEB exceeds safe integer range');
    }
    throw new Error('truncated WASM ULEB');
}

function runNodeContract(candidateBytes, bridgeBuildId) {
    const result = spawnSync(process.execPath, [
        path.join(FRONTEND_ROOT, 'tests', 'bridge-host.js'), '--stdin', bridgeBuildId,
    ], {
        cwd: FRONTEND_ROOT,
        encoding: 'utf8',
        input: candidateBytes,
        maxBuffer: 32 * 1024 * 1024,
    });
    assertSpawnPassed(result, 'Aro WASM host contract', result.stdout + result.stderr);
}

function computeSourceTreeSha256({ vendor, frontendRoot }) {
    assert.ok(vendor && typeof vendor === 'object', 'verified vendor snapshot is required');
    assert.ok(Array.isArray(vendor.files), 'verified vendor file list is required');
    const records = [];
    const seenVendorFiles = new Set();
    for (const relativePath of vendor.files) {
        assertSourcePath(relativePath, 'vendored Aro source path');
        assert.ok(!seenVendorFiles.has(relativePath), `duplicate vendored Aro source path: ${relativePath}`);
        seenVendorFiles.add(relativePath);
        records.push(readSourceRecord(
            vendor.root,
            relativePath,
            `third_party/aro/${relativePath}`,
        ));
    }
    for (const relativePath of listFrontendSourceFiles(frontendRoot)) {
        records.push(readSourceRecord(
            frontendRoot,
            relativePath,
            `tools/aro-frontend/${relativePath}`,
        ));
    }
    records.sort((left, right) => Buffer.compare(
        Buffer.from(left.path, 'utf8'),
        Buffer.from(right.path, 'utf8'),
    ));
    const normalizedPaths = new Set();
    for (const record of records) {
        const normalizedPath = record.path.toLocaleLowerCase('en-US');
        assert.ok(!normalizedPaths.has(normalizedPath),
            `case-ambiguous source input path: ${record.path}`);
        normalizedPaths.add(normalizedPath);
    }
    const digest = crypto.createHash('sha256');
    digest.update('merc32-aro-source-closure-v1\0', 'utf8');
    for (const record of records) {
        const pathBytes = Buffer.from(record.path, 'utf8');
        digest.update(encodeLength(pathBytes.length));
        digest.update(pathBytes);
        digest.update(encodeLength(record.bytes.length));
        digest.update(record.bytes);
    }
    return digest.digest('hex');
}

function listFrontendSourceFiles(frontendRoot) {
    const files = [];
    const visit = (directory, relativeDirectory) => {
        const status = fs.lstatSync(directory);
        assert.ok(status.isDirectory() && !status.isSymbolicLink(),
            `source input directory is not an exact directory: ${relativeDirectory || '.'}`);
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name, 'en-US'))) {
            if (!relativeDirectory && GENERATED_FRONTEND_DIRECTORIES.has(entry.name)) continue;
            const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
            assertSourcePath(relativePath, 'frontend source path');
            const absolutePath = path.join(directory, entry.name);
            const entryStatus = fs.lstatSync(absolutePath);
            assert.ok(!entryStatus.isSymbolicLink(), `source input is a symbolic link: ${relativePath}`);
            if (entryStatus.isDirectory()) {
                visit(absolutePath, relativePath);
            } else {
                assert.ok(entryStatus.isFile(), `source input is not a regular file: ${relativePath}`);
                files.push(relativePath);
            }
        }
    };
    visit(path.resolve(frontendRoot), '');
    return files;
}

function readSourceRecord(root, relativePath, logicalPath) {
    const absoluteRoot = path.resolve(root);
    const absolutePath = path.resolve(absoluteRoot, ...relativePath.split('/'));
    const relative = path.relative(absoluteRoot, absolutePath);
    assert.ok(relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..'
        && !path.isAbsolute(relative), `source input escapes its root: ${relativePath}`);
    const status = fs.lstatSync(absolutePath);
    assert.ok(status.isFile() && !status.isSymbolicLink(),
        `source input is not an exact regular file: ${relativePath}`);
    assert.strictEqual(status.nlink, 1, `hard-linked source input: ${relativePath}`);
    assert.strictEqual(path.normalize(fs.realpathSync.native(absolutePath)), path.normalize(absolutePath),
        `redirected source input: ${relativePath}`);
    return { path: logicalPath, bytes: fs.readFileSync(absolutePath) };
}

function assertSourcePath(relativePath, label) {
    assert.ok(typeof relativePath === 'string' && relativePath.length > 0,
        `${label} must be non-empty`);
    assert.strictEqual(relativePath.normalize('NFC'), relativePath, `${label} is not Unicode-normalized`);
    assert.ok(!relativePath.includes('\\') && !relativePath.startsWith('/')
        && !/^[A-Za-z]:/u.test(relativePath)
        && relativePath.split('/').every((part) => part !== '' && part !== '.' && part !== '..'),
    `${label} is not a normalized relative path: ${relativePath}`);
}

function encodeLength(length) {
    const encoded = Buffer.alloc(8);
    encoded.writeBigUInt64LE(BigInt(length));
    return encoded;
}

function captureCandidateSnapshot(candidate, options = {}) {
    const fileSystem = options.fileSystem || fs;
    const ownedBytes = Buffer.from(fileSystem.readFileSync(candidate));
    return Object.freeze({
        length: ownedBytes.length,
        bytes: () => Buffer.from(ownedBytes),
        sha256: () => sha256(ownedBytes),
    });
}

/*
 * Pair replacement is recoverable, not physically atomic across two paths.
 * Each generation owns .new and .old files plus one synced journal. Before the
 * journal's durable "committed" phase, recovery restores the prior presence and
 * bytes of each target independently. At or after "committed", both new targets
 * must exist and recovery only finishes cleanup. Every file and namespace change
 * is synced where the host filesystem supports directory fsync. A process may
 * observe an interrupted mixed namespace before the next rebuild performs
 * recovery; no filesystem primitive can make two independent renames crash-atomic.
 */
function replacePair(wasmBytes, manifestBytes, options = {}) {
    const fileSystem = options.fileSystem || fs;
    const resourceRoot = path.resolve(options.resourceRoot || RESOURCE_ROOT);
    fileSystem.mkdirSync(resourceRoot, { recursive: true });
    recoverPair({ resourceRoot, fileSystem });
    const generation = options.generation || `${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    const paths = transactionPaths(resourceRoot, generation);
    const journal = {
        protocolVersion: 1,
        generation,
        phase: 'preparing',
        originals: {
            wasm: exactFileExists(paths.wasmTarget, fileSystem),
            manifest: exactFileExists(paths.manifestTarget, fileSystem),
        },
    };
    let journalInstalled = false;
    let committed = false;
    try {
        writeJournal(paths, journal, fileSystem);
        journalInstalled = true;
        writeSynced(paths.wasmNew, wasmBytes, fileSystem);
        writeSynced(paths.manifestNew, manifestBytes, fileSystem);
        syncDirectory(resourceRoot, fileSystem);
        journal.phase = 'prepared';
        writeJournal(paths, journal, fileSystem);

        if (journal.originals.wasm) {
            fileSystem.renameSync(paths.wasmTarget, paths.wasmOld);
            syncDirectory(resourceRoot, fileSystem);
        }
        if (journal.originals.manifest) {
            fileSystem.renameSync(paths.manifestTarget, paths.manifestOld);
            syncDirectory(resourceRoot, fileSystem);
        }
        journal.phase = 'installing';
        writeJournal(paths, journal, fileSystem);
        fileSystem.renameSync(paths.wasmNew, paths.wasmTarget);
        syncDirectory(resourceRoot, fileSystem);
        fileSystem.renameSync(paths.manifestNew, paths.manifestTarget);
        syncDirectory(resourceRoot, fileSystem);

        // This is the durable commit decision. Before it recovery restores the old
        // generation; after it recovery keeps the new pair and removes debris.
        journal.phase = 'committed';
        writeJournal(paths, journal, fileSystem);
        committed = true;
        finishCommittedCleanup(paths, fileSystem);
    } catch (error) {
        journalInstalled ||= fileSystem.existsSync(paths.journal);
        if (!journalInstalled) {
            removePaths([paths.journalTemp, paths.wasmNew, paths.manifestNew], fileSystem);
            syncDirectory(resourceRoot, fileSystem);
            throw error;
        }
        if (committed) throw error;
        try {
            recoverPair({ resourceRoot, fileSystem });
        } catch (recoveryError) {
            throw new AggregateError([error, recoveryError],
                'Aro resource replacement failed and its journal remains for recovery');
        }
        throw error;
    }
}

function recoverPair(options = {}) {
    const fileSystem = options.fileSystem || fs;
    const resourceRoot = path.resolve(options.resourceRoot || RESOURCE_ROOT);
    fileSystem.mkdirSync(resourceRoot, { recursive: true });
    const journalPath = path.join(resourceRoot, '.c-frontend-install.json');
    if (!fileSystem.existsSync(journalPath)) {
        return removeOrphanGenerationNewFiles(resourceRoot, fileSystem);
    }
    const journal = readJournal(journalPath, fileSystem);
    const paths = transactionPaths(resourceRoot, journal.generation);
    if (journal.phase === 'committed') {
        requireExactTransactionFile(paths.wasmTarget, 'committed WASM', fileSystem);
        requireExactTransactionFile(paths.manifestTarget, 'committed manifest', fileSystem);
        finishCommittedCleanup(paths, fileSystem);
        removeOrphanGenerationNewFiles(resourceRoot, fileSystem);
        return true;
    }

    restoreOriginal(paths.wasmTarget, paths.wasmOld, journal.originals.wasm, fileSystem);
    syncDirectory(resourceRoot, fileSystem);
    restoreOriginal(paths.manifestTarget, paths.manifestOld, journal.originals.manifest, fileSystem);
    syncDirectory(resourceRoot, fileSystem);
    removePaths([
        paths.wasmNew,
        paths.manifestNew,
        paths.wasmOld,
        paths.manifestOld,
        paths.journalTemp,
    ], fileSystem);
    syncDirectory(resourceRoot, fileSystem);
    fileSystem.rmSync(paths.journal, { force: true });
    syncDirectory(resourceRoot, fileSystem);
    removeOrphanGenerationNewFiles(resourceRoot, fileSystem);
    return true;
}

function removeOrphanGenerationNewFiles(resourceRoot, fileSystem) {
    const orphanPaths = fileSystem.readdirSync(resourceRoot)
        .filter((name) => ORPHAN_GENERATION_NEW.test(name))
        .map((name) => path.join(resourceRoot, name));
    for (const orphanPath of orphanPaths) {
        requireExactTransactionFile(orphanPath, 'orphan transaction generation file', fileSystem);
    }
    if (orphanPaths.length === 0) return false;
    removePaths(orphanPaths, fileSystem);
    syncDirectory(resourceRoot, fileSystem);
    return true;
}

function transactionPaths(resourceRoot, generation) {
    assert.ok(typeof generation === 'string' && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(generation),
        'transaction generation must contain only lowercase letters, digits, and hyphens');
    return {
        resourceRoot,
        wasmTarget: path.join(resourceRoot, 'aro-merc32.wasm'),
        manifestTarget: path.join(resourceRoot, 'build-manifest.json'),
        wasmNew: path.join(resourceRoot, `.aro-merc32.wasm.gen-${generation}.new`),
        manifestNew: path.join(resourceRoot, `.build-manifest.json.gen-${generation}.new`),
        wasmOld: path.join(resourceRoot, `.aro-merc32.wasm.gen-${generation}.old`),
        manifestOld: path.join(resourceRoot, `.build-manifest.json.gen-${generation}.old`),
        journal: path.join(resourceRoot, '.c-frontend-install.json'),
        journalTemp: path.join(resourceRoot, `.c-frontend-install.json.gen-${generation}.new`),
    };
}

function writeJournal(paths, journal, fileSystem) {
    fileSystem.rmSync(paths.journalTemp, { force: true });
    writeSynced(paths.journalTemp, Buffer.from(`${JSON.stringify(journal, null, 2)}\n`), fileSystem);
    fileSystem.renameSync(paths.journalTemp, paths.journal);
    syncDirectory(paths.resourceRoot, fileSystem);
}

function readJournal(journalPath, fileSystem) {
    requireExactTransactionFile(journalPath, 'transaction journal', fileSystem);
    let journal;
    try {
        journal = JSON.parse(fileSystem.readFileSync(journalPath, 'utf8'));
    } catch (error) {
        throw new Error(`Aro transaction journal is invalid JSON: ${error.message}`);
    }
    assert.ok(journal !== null && !Array.isArray(journal) && typeof journal === 'object',
        'Aro transaction journal must be an object');
    assert.deepStrictEqual(Object.keys(journal).sort(),
        ['generation', 'originals', 'phase', 'protocolVersion'],
        'Aro transaction journal fields changed');
    assert.strictEqual(journal.protocolVersion, 1, 'unsupported Aro transaction journal');
    assert.ok(['preparing', 'prepared', 'installing', 'committed'].includes(journal.phase),
        'unsupported Aro transaction phase');
    assert.ok(journal.originals !== null && !Array.isArray(journal.originals)
        && typeof journal.originals === 'object', 'Aro transaction originals must be an object');
    assert.deepStrictEqual(Object.keys(journal.originals).sort(), ['manifest', 'wasm'],
        'Aro transaction original fields changed');
    assert.strictEqual(typeof journal.originals.wasm, 'boolean');
    assert.strictEqual(typeof journal.originals.manifest, 'boolean');
    transactionPaths(path.dirname(journalPath), journal.generation);
    return journal;
}

function restoreOriginal(target, backup, existed, fileSystem) {
    if (!existed) {
        fileSystem.rmSync(target, { force: true });
        return;
    }
    if (fileSystem.existsSync(backup)) {
        requireExactTransactionFile(backup, 'transaction backup', fileSystem);
        fileSystem.rmSync(target, { force: true });
        fileSystem.renameSync(backup, target);
        return;
    }
    requireExactTransactionFile(target, 'unmoved original', fileSystem);
}

function finishCommittedCleanup(paths, fileSystem) {
    const cleanup = () => {
        removePaths([
            paths.wasmNew,
            paths.manifestNew,
            paths.wasmOld,
            paths.manifestOld,
            paths.journalTemp,
        ], fileSystem);
        syncDirectory(paths.resourceRoot, fileSystem);
        fileSystem.rmSync(paths.journal, { force: true });
        syncDirectory(paths.resourceRoot, fileSystem);
    };
    try {
        cleanup();
    } catch (firstError) {
        try {
            cleanup();
        } catch (secondError) {
            throw new AggregateError([firstError, secondError],
                'committed Aro generation is valid but cleanup must be recovered');
        }
    }
}

function removePaths(paths, fileSystem) {
    for (const target of paths) fileSystem.rmSync(target, { force: true });
}

function exactFileExists(target, fileSystem) {
    if (!fileSystem.existsSync(target)) return false;
    requireExactTransactionFile(target, 'resource target', fileSystem);
    return true;
}

function requireExactTransactionFile(target, label, fileSystem) {
    const status = fileSystem.lstatSync(target);
    assert.ok(status.isFile() && !status.isSymbolicLink(), `${label} is not an exact regular file`);
    assert.strictEqual(status.nlink, 1, `${label} is hard-linked`);
}

function syncDirectory(directory, fileSystem = fs) {
    let descriptor;
    try {
        descriptor = fileSystem.openSync(directory, 'r');
        fileSystem.fsyncSync(descriptor);
    } catch (error) {
        if (!['EBADF', 'EINVAL', 'EISDIR', 'ENOTSUP', 'EPERM'].includes(error.code)) throw error;
    } finally {
        if (descriptor !== undefined) fileSystem.closeSync(descriptor);
    }
}

function writeSynced(target, bytes, fileSystem = fs) {
    const descriptor = fileSystem.openSync(target, 'wx');
    try {
        fileSystem.writeFileSync(descriptor, bytes);
        fileSystem.fsyncSync(descriptor);
    } finally {
        fileSystem.closeSync(descriptor);
    }
}

function assertSpawnPassed(result, label, details = '') {
    assert.ok(!result.error, `${label} failed to launch: ${result.error?.message || ''}`);
    assert.strictEqual(result.status, 0,
        `${label} failed (${result.status}):\n${details}`);
}

function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    assertExactZig,
    auditWasm,
    captureCandidateSnapshot,
    computeSourceTreeSha256,
    main,
    readMemoryMaximumPages,
    recoverPair,
    replacePair,
};
