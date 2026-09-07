'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const Ajv2020 = require('ajv/dist/2020');
const {
    computeSourceTreeSha256,
    replacePair,
} = require('../../tools/aro-frontend/rebuild');
const { verifyVendoredAro } = require('../../tools/aro-frontend/verify-vendor');

const extensionRoot = path.resolve(__dirname, '..');
const repositoryRoot = path.resolve(extensionRoot, '..');
const resourceRoot = path.join(extensionRoot, 'resources', 'c-frontend');
const expectedManifest = Object.freeze({
    manifestVersion: 1,
    aroRevision: 'ec463262c14c1111fc9323086b708ad3b0b9ca11',
    zigVersion: '0.17.0-dev.1936+5a625d5f3',
    bridgeProtocolVersion: 1,
    typedUnitSchemaVersion: 1,
    target: 'merc32',
    abi: 'merc32-c-v1',
    dataModel: 'merc32-ilp32',
});
const REQUIRED_HEADERS = Object.freeze([
    'include/float.h', 'include/iso646.h', 'include/limits.h', 'include/stdalign.h',
    'include/stdbool.h', 'include/stddef.h', 'include/stdint.h', 'include/stdnoreturn.h',
]);
const REQUIRED_FILES = Object.freeze([
    'aro-merc32.wasm', 'build-manifest.json', 'typed-c-unit-v1.schema.json',
    ...REQUIRED_HEADERS, 'licenses/ARO-LICENSE', 'licenses/UNICODE-LICENSE',
]);
const WASM_MEMORY_MAX_PAGES = 2048;
const EXPECTED_WASM_EXPORTS = Object.freeze([
    'memory', 'merc32_alloc', 'merc32_analyze', 'merc32_build_id_len',
    'merc32_build_id_ptr', 'merc32_protocol_version', 'merc32_reset',
    'merc32_result_len', 'merc32_result_ptr',
]);
const HARD_LIMITS = Object.freeze({
    fileBytes: 4 * 1024 * 1024,
    totalSourceBytes: 32 * 1024 * 1024,
    fileCount: 4096,
    includeDepth: 32,
    requestBytes: 40 * 1024 * 1024,
    resultBytes: 64 * 1024 * 1024,
    memoryBytes: 128 * 1024 * 1024,
});

function run(vsixPath = process.argv[2]) {
    const manifest = auditResources();
    auditAtomicReplacement();
    if (vsixPath !== undefined) auditVsix(path.resolve(extensionRoot, vsixPath), manifest);
    console.log(vsixPath === undefined
        ? 'C frontend resources and package boundary passed.'
        : 'C frontend resources and VSIX package boundary passed.');
}

function auditResources() {
    requireExactDirectory(resourceRoot, 'c-frontend resource root');
    const files = listRegularFiles(resourceRoot);
    assert.deepStrictEqual(files, [...REQUIRED_FILES].sort(),
        'c-frontend resource tree contains missing, extra, or aliased files');
    const manifest = readJson(path.join(resourceRoot, 'build-manifest.json'));
    assert.deepStrictEqual(Object.keys(manifest).sort(), [
        ...Object.keys(expectedManifest), 'bridgeBuildId', 'sourceTreeSha256', 'wasmSha256',
    ].sort(), 'Aro build manifest fields changed');
    for (const [key, value] of Object.entries(expectedManifest)) assert.strictEqual(manifest[key], value);
    assert.strictEqual(manifest.bridgeBuildId, `merc32-aro-v1-${manifest.sourceTreeSha256}`);
    const vendor = verifyVendoredAro(path.join(repositoryRoot, 'third_party', 'aro'));
    const sourceTreeSha256 = computeSourceTreeSha256({
        vendor,
        frontendRoot: path.join(repositoryRoot, 'tools', 'aro-frontend'),
    });
    assert.strictEqual(manifest.sourceTreeSha256, sourceTreeSha256,
        'build manifest source digest differs from the verified build-input closure');
    assert.match(manifest.wasmSha256, /^[a-f0-9]{64}$/u);
    const wasmBytes = fs.readFileSync(path.join(resourceRoot, 'aro-merc32.wasm'));
    assert.ok(wasmBytes.length <= 4 * 1024 * 1024,
        `Aro WASM exceeds the 4 MiB package ceiling: ${wasmBytes.length}`);
    assert.strictEqual(sha256(wasmBytes), manifest.wasmSha256,
        'build manifest WASM digest does not match the committed bytes');
    const bridge = instantiateAuditedBridge(wasmBytes, manifest);
    assert.strictEqual(fs.readFileSync(path.join(resourceRoot, 'licenses', 'ARO-LICENSE'))
        .compare(fs.readFileSync(path.join(repositoryRoot, 'third_party', 'aro', 'LICENSE'))), 0);
    assert.strictEqual(fs.readFileSync(path.join(resourceRoot, 'licenses', 'UNICODE-LICENSE'))
        .compare(fs.readFileSync(path.join(repositoryRoot, 'third_party', 'aro', 'LICENSE-UNICODE'))), 0);
    auditHeaders();
    const typedUnit = auditHeaderCompilation(bridge);
    auditVscodeIgnore();
    const schema = readJson(path.join(resourceRoot, 'typed-c-unit-v1.schema.json'));
    auditSchema(schema, typedUnit);
    return manifest;
}

function auditSchema(schema, typedUnit) {
    assert.strictEqual(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
    assert.strictEqual(schema.$id, 'https://merc32.invalid/schema/typed-c-unit-v1.schema.json');
    assert.strictEqual(schema.properties.schema.const, 'merc32.typed-c-unit');
    assert.strictEqual(schema.properties.schemaVersion.const, 1);
    assert.strictEqual(schema.properties.target.const, 'merc32');
    assert.strictEqual(schema.properties.abi.const, 'merc32-c-v1');
    assert.strictEqual(schema.properties.dataModel.const, 'merc32-ilp32');
    const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
    assert.strictEqual(validate(typedUnit), true,
        `packaged schema rejects a real typed unit: ${JSON.stringify(validate.errors)}`);
    assert.strictEqual(validate({ ...typedUnit, unexpected: true }), false,
        'packaged schema accepts an unknown top-level property');
}

function auditAtomicReplacement() {
    assert.strictEqual(typeof replacePair, 'function',
        'the rebuild helper must expose its transactional pair replacement for verification');
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-rebuild-rollback-'));
    try {
        const wasmTarget = path.join(temporary, 'aro-merc32.wasm');
        const manifestTarget = path.join(temporary, 'build-manifest.json');
        const originalWasm = Buffer.from('original wasm bytes');
        const originalManifest = Buffer.from('{"original":true}\n');
        fs.writeFileSync(wasmTarget, originalWasm);
        fs.writeFileSync(manifestTarget, originalManifest);
        const operations = Object.create(fs);
        let injected = false;
        operations.renameSync = (source, target) => {
            if (!injected && path.basename(source).startsWith('.build-manifest.json.gen-')
                && path.basename(source).endsWith('.new')
                && target === manifestTarget) {
                injected = true;
                throw new Error('forced manifest installation failure');
            }
            return fs.renameSync(source, target);
        };
        assert.throws(
            () => replacePair(Buffer.from('candidate wasm'), Buffer.from('{"candidate":true}\n'), {
                resourceRoot: temporary,
                fileSystem: operations,
            }),
            /forced manifest installation failure/u,
        );
        assert.deepStrictEqual(fs.readFileSync(wasmTarget), originalWasm,
            'failed pair replacement changed the committed WASM');
        assert.deepStrictEqual(fs.readFileSync(manifestTarget), originalManifest,
            'failed pair replacement changed the committed manifest');
        assert.deepStrictEqual(fs.readdirSync(temporary).sort(), [
            'aro-merc32.wasm', 'build-manifest.json',
        ], 'failed pair replacement leaked temporary or backup files');
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
}

function auditHeaders() {
    const headers = Object.fromEntries(REQUIRED_HEADERS.map((logicalPath) => [
        logicalPath, fs.readFileSync(path.join(resourceRoot, ...logicalPath.split('/')), 'utf8'),
    ]));
    assert.match(headers['include/stddef.h'], /typedef unsigned int size_t/u);
    assert.match(headers['include/stddef.h'], /typedef int ptrdiff_t/u);
    assert.match(headers['include/stddef.h'], /typedef int wchar_t/u);
    assert.match(headers['include/stdint.h'], /typedef int intptr_t/u);
    assert.match(headers['include/stdint.h'], /typedef unsigned int uintptr_t/u);
    assert.match(headers['include/stdint.h'], /typedef long long intmax_t/u);
    assert.match(headers['include/stdint.h'], /typedef unsigned long long uintmax_t/u);
    assert.match(headers['include/stdint.h'], /typedef int16_t int_least16_t/u);
    assert.match(headers['include/stdint.h'], /typedef int16_t int_fast16_t/u);
    assert.match(headers['include/stdint.h'], /#define INT64_C\(value\) value##LL/u);
    assert.match(headers['include/stdint.h'], /#define UINTMAX_C\(value\) value##ULL/u);
    assert.match(headers['include/stdalign.h'], /#define alignas _Alignas/u);
    assert.match(headers['include/stdalign.h'], /#define alignof _Alignof/u);
    assert.match(headers['include/iso646.h'], /#define and &&/u);
    assert.match(headers['include/stdnoreturn.h'], /#define noreturn _Noreturn/u);
    assert.match(headers['include/limits.h'], /#define CHAR_BIT 8/u);
    assert.match(headers['include/float.h'], /#define LDBL_MANT_DIG 53/u);
    assert.strictEqual(fs.existsSync(path.join(resourceRoot, 'include', 'stdarg.h')), false,
        'stdarg.h must remain withheld until a MERC32 va_list exists');
    for (const forbidden of ['stdio.h', 'stdlib.h', 'time.h', 'signal.h', 'threads.h', 'stdatomic.h']) {
        assert.strictEqual(fs.existsSync(path.join(resourceRoot, 'include', forbidden)), false,
            `${forbidden} must not be shipped in the freestanding profile`);
    }
    const abiModule = path.join(extensionRoot, 'out', 'cFrontend', 'merc32Abi.js');
    if (fs.existsSync(abiModule)) {
        const { MERC32_ABI: abi } = require(abiModule);
        assert.strictEqual(abi.target, 'merc32');
        assert.strictEqual(abi.abi, 'merc32-c-v1');
        assert.strictEqual(abi.dataModel, 'merc32-ilp32');
        assert.deepStrictEqual(abi.builtin.int, [4, 4]);
        assert.deepStrictEqual(abi.builtin.long, [4, 4]);
        assert.deepStrictEqual(abi.builtin.longLong, [8, 4]);
        assert.deepStrictEqual(abi.builtin.longDouble, [8, 4]);
        assert.strictEqual(abi.maximumNaturalAlignment, 4);
    }
}

function auditHeaderCompilation(bridge) {
    const source = [
            '#include <stddef.h>',
            '#include <stdint.h>',
            '#include <stdbool.h>',
            '#include <limits.h>',
            '#include <float.h>',
            '#include <stdalign.h>',
            '#include <iso646.h>',
            '#include <stdnoreturn.h>',
            '_Static_assert(sizeof(size_t) == 4, "size_t");',
            '_Static_assert(sizeof(ptrdiff_t) == 4, "ptrdiff_t");',
            '_Static_assert(sizeof(wchar_t) == 4, "wchar_t");',
            '_Static_assert(sizeof(intptr_t) == 4 && sizeof(uintptr_t) == 4, "intptr_t");',
            '_Static_assert(sizeof(intmax_t) == 8 && sizeof(uintmax_t) == 8, "intmax_t");',
            '_Static_assert(sizeof(int_least8_t) == 1 && sizeof(uint_least8_t) == 1, "least8");',
            '_Static_assert(sizeof(int_least16_t) == 2 && sizeof(uint_least16_t) == 2, "least16");',
            '_Static_assert(sizeof(int_least32_t) == 4 && sizeof(uint_least32_t) == 4, "least32");',
            '_Static_assert(sizeof(int_least64_t) == 8 && sizeof(uint_least64_t) == 8, "least64");',
            '_Static_assert(sizeof(int_fast8_t) == 1 && sizeof(uint_fast8_t) == 1, "fast8");',
            '_Static_assert(sizeof(int_fast16_t) == 2 && sizeof(uint_fast16_t) == 2, "fast16");',
            '_Static_assert(sizeof(int_fast32_t) == 4 && sizeof(uint_fast32_t) == 4, "fast32");',
            '_Static_assert(sizeof(int_fast64_t) == 8 && sizeof(uint_fast64_t) == 8, "fast64");',
            '_Static_assert(alignof(max_align_t) == 4, "max_align_t");',
            '_Static_assert(CHAR_BIT == 8 && UINT32_MAX == 4294967295U, "integer limits");',
            '_Static_assert(INT_LEAST8_MIN == INT8_MIN && UINT_LEAST64_MAX == UINT64_MAX, "least limits");',
            '_Static_assert(INT_FAST16_MIN == INT16_MIN && UINT_FAST32_MAX == UINT32_MAX, "fast limits");',
            '_Static_assert(WCHAR_MIN == INT32_MIN && WINT_MAX == UINT32_MAX, "wide limits");',
            '_Static_assert(INT8_C(127) == INT8_MAX && UINT16_C(65535) == UINT16_MAX, "small constants");',
            '_Static_assert(INT64_C(9223372036854775807) == INT64_MAX, "int64 constant");',
            '_Static_assert(UINTMAX_C(18446744073709551615) == UINTMAX_MAX, "uintmax constant");',
            '_Static_assert(FLT_RADIX == 2 && LDBL_MANT_DIG == 53, "floating limits");',
            '_Static_assert(FLT_EVAL_METHOD == __FLT_EVAL_METHOD__, "floating evaluation");',
            '_Static_assert(FLT_MIN_10_EXP == __FLT_MIN_10_EXP__, "float minimum decimal exponent");',
            '_Static_assert(DBL_MIN_10_EXP == __DBL_MIN_10_EXP__, "double minimum decimal exponent");',
            '_Static_assert(LDBL_MIN_10_EXP == __LDBL_MIN_10_EXP__, "long double minimum decimal exponent");',
            '_Static_assert(FLT_MAX_10_EXP == __FLT_MAX_10_EXP__, "float maximum decimal exponent");',
            '_Static_assert(DBL_MAX_10_EXP == __DBL_MAX_10_EXP__, "double maximum decimal exponent");',
            '_Static_assert(LDBL_MAX_10_EXP == __LDBL_MAX_10_EXP__, "long double maximum decimal exponent");',
            '_Static_assert(DECIMAL_DIG == __DECIMAL_DIG__, "decimal digits");',
            '_Static_assert(FLT_DECIMAL_DIG == __FLT_DECIMAL_DIG__, "float decimal digits");',
            '_Static_assert(DBL_DECIMAL_DIG == __DBL_DECIMAL_DIG__, "double decimal digits");',
            '_Static_assert(LDBL_DECIMAL_DIG == __LDBL_DECIMAL_DIG__, "long double decimal digits");',
            '_Static_assert(true and not false, "freestanding macros");',
            'alignas(4) int aligned_value;',
            'noreturn void stop(void);',
            '',
        ].join('\n');
    const virtualFiles = REQUIRED_HEADERS.map((logicalPath) => ({
        path: logicalPath,
        source: fs.readFileSync(path.join(resourceRoot, ...logicalPath.split('/')), 'utf8'),
    }));
    const result = bridge.analyze({
        protocolVersion: 1,
        mainPath: 'headers.c',
        source,
        standard: 'c17',
        defines: {},
        includePaths: ['include'],
        virtualFiles,
        limits: { ...HARD_LIMITS },
    });
    assert.strictEqual(result.status, 'ok',
        `packaged header conformance source failed: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.unit && result.unit.nodes.length > 0,
        'real packaged WASM returned no typed syntax for header conformance source');
    return result.unit;
}

function auditVscodeIgnore() {
    const lines = fs.readFileSync(path.join(extensionRoot, '.vscodeignore'), 'utf8')
        .split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
        if (line.startsWith('!') || line.startsWith('#')) continue;
        const normalized = line.replace(/\\/gu, '/').replace(/^\//u, '');
        assert.ok(normalized !== 'resources' && !normalized.startsWith('resources/'),
            `.vscodeignore excludes packaged resources: ${line}`);
    }
}

function instantiateAuditedBridge(bytes, manifest) {
    const moduleObject = new WebAssembly.Module(bytes);
    const imports = WebAssembly.Module.imports(moduleObject);
    const exports = WebAssembly.Module.exports(moduleObject).map((entry) => entry.name).sort();
    let instance;
    instance = new WebAssembly.Instance(moduleObject, {
        merc32_source: {
            resolve() { return -1; },
        },
    });
    const abi = instance.exports;
    const bridgeBuildId = readUtf8(abi.memory, abi.merc32_build_id_ptr(), abi.merc32_build_id_len(),
        'embedded bridge build ID');
    assertBridgeContract({
        imports,
        exports,
        memoryMaximumPages: readMemoryMaximumPages(bytes),
        bridgeBuildId,
        protocolVersion: abi.merc32_protocol_version(),
    }, manifest);
    return Object.freeze({
        analyze(request) {
            const requestBytes = Buffer.from(JSON.stringify(request), 'utf8');
            abi.merc32_reset();
            const requestPointer = abi.merc32_alloc(requestBytes.length);
            assert.ok(Number.isSafeInteger(requestPointer) && requestPointer > 0,
                'packaged WASM rejected the conformance request allocation');
            memorySlice(abi.memory, requestPointer, requestBytes.length, 'request').set(requestBytes);
            abi.merc32_analyze(requestPointer, requestBytes.length);
            const resultPointer = abi.merc32_result_ptr();
            const resultLength = abi.merc32_result_len();
            assert.ok(Number.isSafeInteger(resultLength) && resultLength >= 0
                && resultLength <= HARD_LIMITS.resultBytes,
            'packaged WASM returned an invalid result length');
            const resultText = readUtf8(abi.memory, resultPointer, resultLength, 'analysis result');
            const result = JSON.parse(resultText);
            assert.strictEqual(result.protocolVersion, manifest.bridgeProtocolVersion,
                'real WASM output protocol differs from the build manifest');
            assert.strictEqual(result.bridgeBuildId, manifest.bridgeBuildId,
                'real WASM output build ID differs from the build manifest');
            return result;
        },
    });
}

function assertBridgeContract(facts, manifest) {
    assert.deepStrictEqual(facts.imports, [{
        module: 'merc32_source', name: 'resolve', kind: 'function',
    }], 'WASM imports must be exactly merc32_source.resolve');
    assert.deepStrictEqual([...facts.exports].sort(), [...EXPECTED_WASM_EXPORTS].sort(),
        'WASM exports do not match the closed bridge ABI');
    assert.strictEqual(facts.memoryMaximumPages, WASM_MEMORY_MAX_PAGES,
        'WASM memory maximum must be 128 MiB');
    assert.strictEqual(facts.bridgeBuildId, manifest.bridgeBuildId,
        'WASM embedded build ID does not match the build manifest');
    assert.strictEqual(facts.protocolVersion, manifest.bridgeProtocolVersion,
        'WASM protocol version does not match the build manifest');
}

function memorySlice(memory, pointer, length, label) {
    assert.ok(memory && memory.buffer instanceof ArrayBuffer,
        'packaged WASM memory export is invalid');
    assert.ok(Number.isSafeInteger(pointer) && pointer >= 0
        && Number.isSafeInteger(length) && length >= 0
        && pointer + length <= memory.buffer.byteLength,
    `packaged WASM ${label} lies outside linear memory`);
    return new Uint8Array(memory.buffer, pointer, length);
}

function readUtf8(memory, pointer, length, label) {
    return new TextDecoder('utf-8', { fatal: true }).decode(memorySlice(memory, pointer, length, label));
}

function auditVsix(vsixFile, manifest) {
    requireExactFile(vsixFile, 'VSIX');
    const zip = new AdmZip(vsixFile);
    const entries = new Map();
    const foldedEntries = new Map();
    const pathTrie = { children: new Map() };
    for (const entry of zip.getEntries()) {
        const logicalPath = normalizeArchivePath(entry.entryName, entry.isDirectory);
        assert.ok(!entries.has(logicalPath), `VSIX contains duplicate entry ${logicalPath}`);
        registerArchivePath(pathTrie, logicalPath, entry.isDirectory);
        const folded = logicalPath.toLocaleLowerCase('en-US');
        assert.ok(!foldedEntries.has(folded),
            `VSIX contains a case-insensitive resource alias: ${foldedEntries.get(folded)} and ${logicalPath}`);
        foldedEntries.set(folded, logicalPath);
        entries.set(logicalPath, entry);
        assert.doesNotMatch(logicalPath, /(?:^|\/)(?:zig(?:\.exe)?|third_party\/aro|tools\/aro-frontend)(?:\/|$)/iu,
            `VSIX contains a development Zig/Aro entry: ${logicalPath}`);
    }
    const packageEntry = entries.get('extension/package.json');
    assert.ok(packageEntry && !packageEntry.isDirectory, 'VSIX is missing extension/package.json');
    assert.strictEqual(packageEntry.getData().compare(
        fs.readFileSync(path.join(extensionRoot, 'package.json'))), 0,
        'VSIX extension/package.json differs from source');
    for (const logicalPath of REQUIRED_FILES) {
        const entry = entries.get(`extension/resources/c-frontend/${logicalPath}`);
        assert.ok(entry && !entry.isDirectory,
            `VSIX is missing c-frontend resource ${logicalPath}`);
        const sourceBytes = fs.readFileSync(path.join(resourceRoot, ...logicalPath.split('/')));
        assert.strictEqual(entry.getData().compare(sourceBytes), 0,
            `VSIX c-frontend resource differs from source: ${logicalPath}`);
    }
    const archivedFiles = [...entries.keys()]
        .filter((logicalPath) => logicalPath.startsWith('extension/resources/c-frontend/'))
        .map((logicalPath) => logicalPath.slice('extension/resources/c-frontend/'.length))
        .filter((logicalPath) => logicalPath.length > 0 && !logicalPath.endsWith('/'))
        .sort();
    assert.deepStrictEqual(archivedFiles, [...REQUIRED_FILES].sort(),
        'VSIX c-frontend resource closure contains missing or extra files');
    const allowedDirectories = new Set(['extension/resources/c-frontend/']);
    for (const logicalPath of REQUIRED_FILES) {
        const components = logicalPath.split('/');
        components.pop();
        while (components.length > 0) {
            allowedDirectories.add(`extension/resources/c-frontend/${components.join('/')}/`);
            components.pop();
        }
    }
    const archivedDirectories = [...entries.entries()]
        .filter(([logicalPath, entry]) => entry.isDirectory
            && logicalPath.startsWith('extension/resources/c-frontend/'))
        .map(([logicalPath]) => logicalPath);
    for (const logicalPath of archivedDirectories) {
        assert.ok(allowedDirectories.has(logicalPath),
            `VSIX c-frontend resource closure contains extra directory ${logicalPath}`);
    }
    const archivedManifest = JSON.parse(entries.get('extension/resources/c-frontend/build-manifest.json')
        .getData().toString('utf8'));
    assert.deepStrictEqual(archivedManifest, manifest,
        'VSIX c-frontend manifest differs from the resource tree');
    instantiateAuditedBridge(
        entries.get('extension/resources/c-frontend/aro-merc32.wasm').getData(),
        archivedManifest,
    );
}

function normalizeArchivePath(entryName, isDirectory) {
    assert.strictEqual(typeof entryName, 'string', 'VSIX entry name must be a string');
    assert.strictEqual(typeof isDirectory, 'boolean', 'VSIX entry type must be a boolean');
    assert.ok(entryName.length > 0, 'VSIX contains an empty entry name');
    assert.ok(!entryName.includes('\\'), `VSIX entry uses a backslash: ${entryName}`);
    assert.ok(!entryName.startsWith('/') && !/^[A-Za-z]:/u.test(entryName),
        `VSIX entry is absolute: ${entryName}`);
    assert.strictEqual(entryName.normalize('NFC'), entryName,
        `VSIX entry is not Unicode-normalized: ${entryName}`);
    const components = entryName.split('/');
    const hasTrailingSlash = components[components.length - 1] === '';
    assert.strictEqual(hasTrailingSlash, isDirectory,
        `VSIX entry type and trailing separator disagree: ${entryName}`);
    if (hasTrailingSlash) components.pop();
    assert.ok(components.every((component) => component !== '' && component !== '.' && component !== '..'),
        `VSIX entry is not canonical: ${entryName}`);
    return `${components.join('/')}${isDirectory ? '/' : ''}`;
}

function registerArchivePath(root, name, isDirectory) {
    const segments = (isDirectory ? name.slice(0, -1) : name).split('/');
    let node = root;
    for (const [index, segment] of segments.entries()) {
        const foldedSegment = segment.toLocaleLowerCase('en-US');
        const logicalPath = segments.slice(0, index + 1).join('/');
        let child = node.children.get(foldedSegment);
        if (child === undefined) {
            child = {
                children: new Map(),
                explicitType: undefined,
                logicalPath,
                requiredDirectory: false,
                spelling: segment,
            };
            node.children.set(foldedSegment, child);
        } else {
            assert.strictEqual(child.spelling, segment,
                archivePathConflict(child, name, 'segment spelling differs'));
        }
        const isLeaf = index === segments.length - 1;
        if (!isLeaf) {
            assert.notStrictEqual(child.explicitType, 'file',
                archivePathConflict(child, name, 'descendant is below a file'));
            child.requiredDirectory = true;
        }
        node = child;
    }
    if (isDirectory) {
        assert.notStrictEqual(node.explicitType, 'file',
            archivePathConflict(node, name, 'directory conflicts with a file'));
        assert.notStrictEqual(node.explicitType, 'directory',
            archivePathConflict(node, name, 'duplicate explicit directory'));
        node.explicitType = 'directory';
        return;
    }
    assert.strictEqual(node.explicitType, undefined,
        archivePathConflict(node, name, 'file conflicts with an explicit entry'));
    assert.ok(!node.requiredDirectory && node.children.size === 0,
        archivePathConflict(node, name, 'file conflicts with existing descendants'));
    node.explicitType = 'file';
}

function archivePathConflict(node, incomingName, reason) {
    const existingName = `${node.logicalPath}${node.explicitType === 'file' ? '' : '/'}`;
    return `case-insensitive VSIX entry alias ${existingName} and ${incomingName} (${reason})`;
}

function listRegularFiles(root) {
    const result = [];
    const visit = (directory, prefix) => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const target = path.join(directory, entry.name);
            const logicalPath = prefix ? `${prefix}/${entry.name}` : entry.name;
            const status = fs.lstatSync(target);
            assert.ok(!status.isSymbolicLink(), `c-frontend resource is a symbolic link: ${logicalPath}`);
            if (entry.isDirectory()) visit(target, logicalPath);
            else {
                assert.ok(entry.isFile() && status.isFile(), `c-frontend resource is not a regular file: ${logicalPath}`);
                assert.strictEqual(status.nlink, 1,
                    `c-frontend resource is hard-linked: ${logicalPath}`);
                result.push(logicalPath);
            }
        }
    };
    visit(root, '');
    return result.sort();
}

function readMemoryMaximumPages(bytes) {
    let offset = 8;
    while (offset < bytes.length) {
        const sectionId = bytes[offset++];
        const size = readUleb(bytes, offset);
        offset = size.next;
        const end = offset + size.value;
        if (sectionId === 5) {
            const count = readUleb(bytes, offset);
            offset = count.next;
            assert.ok(count.value > 0);
            const flags = readUleb(bytes, offset);
            offset = flags.next;
            const initial = readUleb(bytes, offset);
            offset = initial.next;
            assert.strictEqual(flags.value & 1, 1);
            return readUleb(bytes, offset).value;
        }
        offset = end;
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
    }
    throw new Error('truncated WASM ULEB');
}

function sha256(bytes) {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function requireExactDirectory(target, label) {
    const status = fs.lstatSync(target);
    assert.ok(status.isDirectory() && !status.isSymbolicLink(), `${label} is not an exact directory`);
}

function requireExactFile(target, label) {
    const status = fs.lstatSync(target);
    assert.ok(status.isFile() && !status.isSymbolicLink(), `${label} is not an exact file`);
}

if (require.main === module) {
    try { run(); } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    assertBridgeContract,
    auditResources,
    auditVsix,
    instantiateAuditedBridge,
    normalizeArchivePath,
    readMemoryMaximumPages,
    registerArchivePath,
    run,
};
