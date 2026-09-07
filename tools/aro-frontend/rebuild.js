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

function main() {
    const zig = resolveZig(process.argv.slice(2));
    assertExactZig(zig);
    const vendor = verifyVendoredAro(path.join(REPOSITORY_ROOT, 'third_party', 'aro'));
    assert.strictEqual(vendor.commit, ARO_REVISION);
    const sourceTreeSha256 = vendor.digest;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-aro-rebuild-'));
    try {
        const cache = path.join(temporary, 'cache');
        const globalCache = path.join(temporary, 'global-cache');
        const prefix = path.join(temporary, 'prefix');
        fs.mkdirSync(cache);
        fs.mkdirSync(globalCache);
        fs.mkdirSync(prefix);
        runZigBuild(zig, cache, globalCache, prefix);
        const candidate = findWasm(cache);
        assert.ok(candidate, 'zig build did not produce aro-merc32.wasm');
        const candidateBytes = fs.readFileSync(candidate);
        assert.ok(candidateBytes.length <= WASM_LIMIT,
            `Aro WASM exceeds ${WASM_LIMIT} bytes: ${candidateBytes.length}`);
        auditWasm(candidateBytes, sourceTreeSha256);
        const candidatePath = path.join(temporary, 'aro-merc32.wasm');
        fs.copyFileSync(candidate, candidatePath);
        runNodeContract(candidatePath);

        const wasmSha256 = sha256(candidateBytes);
        const manifest = {
            manifestVersion: 1,
            aroRevision: ARO_REVISION,
            zigVersion: ZIG_VERSION,
            bridgeProtocolVersion: 1,
            typedUnitSchemaVersion: 1,
            target: 'merc32',
            abi: 'merc32-c-v1',
            dataModel: 'merc32-ilp32',
            bridgeBuildId: `merc32-aro-v1-${sourceTreeSha256}`,
            sourceTreeSha256,
            wasmSha256,
        };
        const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
        replacePair(candidateBytes, manifestBytes);
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
    assert.strictEqual(path.normalize(fs.realpathSync.native(zig)), path.normalize(zig),
        `Zig executable is redirected: ${zig}`);
    const result = spawnSync(zig, ['version'], { encoding: 'utf8' });
    assertSpawnPassed(result, 'zig version');
    assert.strictEqual(result.stdout.trim(), ZIG_VERSION,
        `unsupported Zig version: ${result.stdout.trim()}`);
}

function runZigBuild(zig, cache, globalCache, prefix) {
    const result = spawnSync(zig, [
        'build',
        'test-data-model',
        'test-bridge',
        'test-serializer-types',
        'test-serializer-nodes',
        '-Doptimize=small',
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

function runNodeContract(candidate) {
    const result = spawnSync(process.execPath, [
        path.join(FRONTEND_ROOT, 'tests', 'bridge-host.js'), candidate,
    ], { cwd: FRONTEND_ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    assertSpawnPassed(result, 'Aro WASM host contract', result.stdout + result.stderr);
}

function replacePair(wasmBytes, manifestBytes, options = {}) {
    const fileSystem = options.fileSystem || fs;
    const resourceRoot = path.resolve(options.resourceRoot || RESOURCE_ROOT);
    fileSystem.mkdirSync(resourceRoot, { recursive: true });
    const wasmTemp = path.join(resourceRoot, `.aro-merc32.wasm.tmp-${process.pid}`);
    const manifestTemp = path.join(resourceRoot, `.build-manifest.json.tmp-${process.pid}`);
    const wasmTarget = path.join(resourceRoot, 'aro-merc32.wasm');
    const manifestTarget = path.join(resourceRoot, 'build-manifest.json');
    const wasmBackup = path.join(resourceRoot, `.aro-merc32.wasm.bak-${process.pid}`);
    const manifestBackup = path.join(resourceRoot, `.build-manifest.json.bak-${process.pid}`);
    const state = {
        wasmBackedUp: false,
        manifestBackedUp: false,
        wasmInstalled: false,
        manifestInstalled: false,
    };
    try {
        for (const temporary of [wasmTemp, manifestTemp, wasmBackup, manifestBackup]) {
            fileSystem.rmSync(temporary, { force: true });
        }
        writeSynced(wasmTemp, wasmBytes, fileSystem);
        writeSynced(manifestTemp, manifestBytes, fileSystem);
        if (fileSystem.existsSync(wasmTarget)) {
            fileSystem.renameSync(wasmTarget, wasmBackup);
            state.wasmBackedUp = true;
        }
        if (fileSystem.existsSync(manifestTarget)) {
            fileSystem.renameSync(manifestTarget, manifestBackup);
            state.manifestBackedUp = true;
        }
        fileSystem.renameSync(wasmTemp, wasmTarget);
        state.wasmInstalled = true;
        fileSystem.renameSync(manifestTemp, manifestTarget);
        state.manifestInstalled = true;
    } catch (error) {
        const rollbackFailures = [];
        const rollback = (action) => {
            try { action(); } catch (rollbackError) { rollbackFailures.push(rollbackError); }
        };
        if (state.wasmInstalled) rollback(() => fileSystem.rmSync(wasmTarget, { force: true }));
        if (state.manifestInstalled) rollback(() => fileSystem.rmSync(manifestTarget, { force: true }));
        if (state.wasmBackedUp) rollback(() => fileSystem.renameSync(wasmBackup, wasmTarget));
        if (state.manifestBackedUp) rollback(() => fileSystem.renameSync(manifestBackup, manifestTarget));
        rollback(() => fileSystem.rmSync(wasmTemp, { force: true }));
        rollback(() => fileSystem.rmSync(manifestTemp, { force: true }));
        if (rollbackFailures.length > 0) {
            throw new AggregateError([error, ...rollbackFailures],
                'Aro resource replacement and rollback both failed');
        }
        throw error;
    }
    fileSystem.rmSync(wasmBackup, { force: true });
    fileSystem.rmSync(manifestBackup, { force: true });
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

module.exports = { auditWasm, main, readMemoryMaximumPages, replacePair };
