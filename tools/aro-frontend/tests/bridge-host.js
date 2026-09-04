'use strict';

const assert = require('assert');
const fs = require('fs');

const wasmPath = process.argv[2];
assert.ok(wasmPath, 'the WASM artifact path is required');
const wasmBytes = fs.readFileSync(wasmPath);
const moduleObject = new WebAssembly.Module(wasmBytes);

assert.deepStrictEqual(WebAssembly.Module.imports(moduleObject), [{
    module: 'merc32_source', name: 'resolve', kind: 'function',
}], 'the bridge must expose exactly the narrow source resolver import');

const expectedExports = [
    'memory',
    'merc32_alloc',
    'merc32_analyze',
    'merc32_build_id_len',
    'merc32_build_id_ptr',
    'merc32_protocol_version',
    'merc32_reset',
    'merc32_result_len',
    'merc32_result_ptr',
];
assert.deepStrictEqual(
    WebAssembly.Module.exports(moduleObject).map((item) => item.name).sort(),
    expectedExports,
    'the exported ABI must be closed',
);
assert.strictEqual(readMemoryMaximumPages(wasmBytes), 2048,
    'linear memory must declare the 128 MiB hard maximum');

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

class Resolver {
    constructor(files = new Map()) {
        this.files = files;
        this.candidates = [];
    }

    resolve(memory, candidatePtr, candidateLen, resultPtr, resultCapacity) {
        const candidate = decoder.decode(new Uint8Array(memory.buffer, candidatePtr, candidateLen));
        this.candidates.push(candidate);
        const file = this.files.get(candidate);
        if (file === undefined) return -1;
        if (file.hostFailure) return -2;
        if (file.rawRecord) {
            if (file.rawRecord.length > resultCapacity) return -2;
            new Uint8Array(memory.buffer, resultPtr, file.rawRecord.length).set(file.rawRecord);
            return file.rawRecord.length;
        }
        const pathBytes = encoder.encode(file.path ?? candidate);
        const sourceBytes = encoder.encode(file.source);
        const encodedLength = 4 + pathBytes.length + sourceBytes.length;
        if (encodedLength > resultCapacity) return -2;
        const view = new DataView(memory.buffer, resultPtr, encodedLength);
        view.setUint32(0, pathBytes.length, true);
        new Uint8Array(memory.buffer, resultPtr + 4, pathBytes.length).set(pathBytes);
        new Uint8Array(memory.buffer, resultPtr + 4 + pathBytes.length, sourceBytes.length).set(sourceBytes);
        return encodedLength;
    }
}

let activeResolver = new Resolver();
let instance;
instance = new WebAssembly.Instance(moduleObject, {
    merc32_source: {
        resolve(candidatePtr, candidateLen, resultPtr, resultCapacity) {
            return activeResolver.resolve(
                instance.exports.memory,
                candidatePtr,
                candidateLen,
                resultPtr,
                resultCapacity,
            );
        },
    },
});

const abi = instance.exports;
assert.strictEqual(abi.merc32_protocol_version(), 1);
const buildId = decoder.decode(new Uint8Array(
    abi.memory.buffer,
    abi.merc32_build_id_ptr(),
    abi.merc32_build_id_len(),
));
assert.strictEqual(
    buildId,
    'merc32-aro-v1-58502f21fa9c03d3e484c17e806b72e3fd6cc7bf40320b5b304988615bdfe009',
    'the exact pinned source digest must flow through the Zig build option',
);

const hardLimits = Object.freeze({
    fileBytes: 4 * 1024 * 1024,
    totalSourceBytes: 32 * 1024 * 1024,
    fileCount: 4096,
    includeDepth: 32,
    requestBytes: 40 * 1024 * 1024,
    resultBytes: 64 * 1024 * 1024,
    memoryBytes: 128 * 1024 * 1024,
});

function makeRequest(overrides = {}) {
    return {
        protocolVersion: 1,
        mainPath: 'main.c',
        source: 'int value;\n',
        standard: 'c17',
        defines: {},
        includePaths: [],
        virtualFiles: [],
        limits: { ...hardLimits },
        ...overrides,
    };
}

function analyze(request, resolver = new Resolver()) {
    activeResolver = resolver;
    abi.merc32_reset();
    const bytes = encoder.encode(JSON.stringify(request));
    const ptr = abi.merc32_alloc(bytes.length);
    assert.notStrictEqual(ptr, 0, `request allocation rejected ${bytes.length} bytes`);
    new Uint8Array(abi.memory.buffer, ptr, bytes.length).set(bytes);
    assert.doesNotThrow(() => abi.merc32_analyze(ptr, bytes.length),
        'a rejected request must return an envelope rather than trap');
    const result = Buffer.from(new Uint8Array(
        abi.memory.buffer,
        abi.merc32_result_ptr(),
        abi.merc32_result_len(),
    ));
    return { bytes: result, envelope: JSON.parse(result.toString('utf8')), resolver };
}

const first = analyze(makeRequest({ source: 'const char *date = __DATE__;\nint value;\n' }));
const second = analyze(makeRequest({ source: 'const char *date = __DATE__;\nint value;\n' }));
assert.deepStrictEqual(first.bytes, second.bytes,
    'identical requests must produce byte-identical results without a host clock');
assert.strictEqual(first.envelope.status, 'ok');
assert.ok(first.envelope.unit);
assert.strictEqual(first.envelope.sourceFiles, undefined,
    'successful envelopes resolve file IDs through unit.sourceFiles only');
assert.deepStrictEqual(first.envelope.unit.sourceFiles, [
    { id: 1, path: 'main.c', byteLength: 40 },
]);

const includeFiles = new Map([
    ['project/choice.h', { source: '#define CHOICE 1\n' }],
    ['include/choice.h', { source: '#define CHOICE 2\n' }],
]);
const quoted = analyze(makeRequest({
    mainPath: 'project/main.c',
    source: '#include "choice.h"\nint selected = CHOICE;\n',
    includePaths: ['include'],
}), new Resolver(includeFiles));
assert.strictEqual(quoted.envelope.status, 'ok');
assert.strictEqual(quoted.resolver.candidates[0], 'project/choice.h',
    'quoted includes must search the including file directory first');

const angled = analyze(makeRequest({
    mainPath: 'project/main.c',
    source: '#include <choice.h>\nint selected = CHOICE;\n',
    includePaths: ['include'],
}), new Resolver(includeFiles));
assert.strictEqual(angled.envelope.status, 'ok');
assert.strictEqual(angled.resolver.candidates[0], 'include/choice.h',
    'angle includes must begin at the explicit include roots');

const virtualOverlayResolver = new Resolver(new Map([
    ['overlay.h', { source: '#define OVERLAY_VALUE 2\n' }],
]));
const virtualOverlay = analyze(makeRequest({
    source: '#include "overlay.h"\nint selected = OVERLAY_VALUE;\n',
    virtualFiles: [{ path: 'overlay.h', source: '#define OVERLAY_VALUE 1\n' }],
}), virtualOverlayResolver);
assert.strictEqual(virtualOverlay.envelope.status, 'ok',
    'request virtual files must be usable as include overlays');
assert.deepStrictEqual(virtualOverlayResolver.candidates, [],
    'an exact virtual overlay must resolve before calling the host');
assert.deepStrictEqual(virtualOverlay.envelope.unit.sourceFiles.map((file) => file.path),
    ['main.c', 'overlay.h'], 'the canonical registry must include seeded virtual files once');

const combinedCount = analyze(makeRequest({
    source: '#include "host.h"\n',
    virtualFiles: [{ path: 'unused.h', source: '' }],
    limits: { ...hardLimits, fileCount: 2 },
}), new Resolver(new Map([
    ['host.h', { source: 'int host_value;\n' }],
])));
assert.strictEqual(combinedCount.envelope.status, 'diagnostics',
    'main, virtual, and host-resolved files must share one file-count limit');
assert.ok(combinedCount.envelope.diagnostics.some((item) => item.code === 'source-file-count'));

const combinedBytes = analyze(makeRequest({
    source: '#include "host.h"\n',
    virtualFiles: [{ path: 'unused.h', source: 'x' }],
    limits: { ...hardLimits, totalSourceBytes: 25 },
}), new Resolver(new Map([
    ['host.h', { source: 'int y;\n' }],
])));
assert.strictEqual(combinedBytes.envelope.status, 'diagnostics',
    'main, virtual, and host-resolved files must share one source-byte limit');
assert.ok(combinedBytes.envelope.diagnostics.some((item) => item.code === 'source-total-bytes'));

const hostReadFailure = analyze(makeRequest({
    source: '#include "read.h"\n',
    includePaths: ['fallback'],
}), new Resolver(new Map([
    ['read.h', { hostFailure: true }],
    ['fallback/read.h', { source: 'int must_not_resolve;\n' }],
])));
assert.strictEqual(hostReadFailure.envelope.status, 'diagnostics',
    'resolver -2 must be an actionable resource diagnostic');
assert.ok(hostReadFailure.envelope.diagnostics.some((item) => item.code === 'source-host-read'));
assert.deepStrictEqual(hostReadFailure.resolver.candidates, ['read.h'],
    'resolver -2 must stop lower-priority include search');

const malformedRecord = new Uint8Array([10, 0, 0, 0]);
const malformedResolution = analyze(makeRequest({
    source: '#include "malformed.h"\n',
    includePaths: ['fallback'],
}), new Resolver(new Map([
    ['malformed.h', { rawRecord: malformedRecord }],
    ['fallback/malformed.h', { source: 'int must_not_resolve;\n' }],
])));
assert.strictEqual(malformedResolution.envelope.status, 'internal-error',
    'malformed resolver records are protocol failures');
assert.ok(malformedResolution.envelope.diagnostics.some((item) => item.code === 'source-invalid-record'));
assert.deepStrictEqual(malformedResolution.resolver.candidates, ['malformed.h'],
    'malformed records must stop lower-priority include search');

const invalidUtf8Record = new Uint8Array([1, 0, 0, 0, 0xff]);
const invalidUtf8Resolution = analyze(makeRequest({
    source: '#include "utf8.h"\n',
    includePaths: ['fallback'],
}), new Resolver(new Map([
    ['utf8.h', { rawRecord: invalidUtf8Record }],
    ['fallback/utf8.h', { source: 'int must_not_resolve;\n' }],
])));
assert.strictEqual(invalidUtf8Resolution.envelope.status, 'internal-error',
    'invalid UTF-8 resolver records are protocol failures');
assert.ok(invalidUtf8Resolution.envelope.diagnostics.some((item) => item.code === 'source-invalid-utf8'));
assert.deepStrictEqual(invalidUtf8Resolution.resolver.candidates, ['utf8.h'],
    'invalid UTF-8 records must stop lower-priority include search');

const missing = analyze(makeRequest({ source: '#include "missing.h"\n' }));
assert.strictEqual(missing.envelope.status, 'diagnostics');
assert.ok(
    missing.envelope.diagnostics.some((item) => /not found/u.test(item.message)),
    JSON.stringify(missing.envelope),
);
assert.ok(missing.envelope.sourceFiles,
    'ranged failure diagnostics must carry envelope.sourceFiles');
assert.strictEqual(missing.envelope.unit, undefined);

const syntax = analyze(makeRequest({ source: 'int value = ;\n' }));
assert.strictEqual(syntax.envelope.status, 'diagnostics');
assert.ok(syntax.envelope.diagnostics.some((item) =>
    item.severity === 'error' || item.severity === 'fatal'));

const repeatedCanonicalSource = [
    '#ifdef SECOND_PASS',
    'int repeated = + later;',
    '#endif',
    '',
].join('\n');
const repeatedCanonical = analyze(makeRequest({
    source: [
        '#include "first.h"',
        '#define SECOND_PASS 1',
        '#include "second.h"',
        '',
    ].join('\n'),
}), new Resolver(new Map([
    ['first.h', { path: 'canonical/shared.h', source: repeatedCanonicalSource }],
    ['second.h', { path: 'canonical/shared.h', source: repeatedCanonicalSource }],
])));
assert.strictEqual(repeatedCanonical.envelope.status, 'diagnostics');
const repeatedDiagnostic = repeatedCanonical.envelope.diagnostics.find((item) => item.range.file === 2);
assert.ok(repeatedDiagnostic, JSON.stringify(repeatedCanonical.envelope));
assert.deepStrictEqual(repeatedDiagnostic.includeTrace.map((range) => range.start.byteOffset), [50],
    'a repeated canonical source must trace the inclusion that produced the diagnostic');
assert.deepStrictEqual(repeatedCanonical.envelope.sourceFiles.map((file) => file.path),
    ['main.c', 'canonical/shared.h'], 'canonical content must remain deduplicated across aliases');

const firstInclusionSource = [
    '#ifndef SECOND_PASS',
    'int first_only = + first_bad;',
    '#endif',
    '',
].join('\n');
const firstInclusion = analyze(makeRequest({
    source: [
        '#include "first.h"',
        '#define SECOND_PASS 1',
        '#include "second.h"',
        '',
    ].join('\n'),
}), new Resolver(new Map([
    ['first.h', { path: 'canonical/first-only.h', source: firstInclusionSource }],
    ['second.h', { path: 'canonical/first-only.h', source: firstInclusionSource }],
])));
assert.strictEqual(firstInclusion.envelope.status, 'diagnostics');
const firstInclusionDiagnostic = firstInclusion.envelope.diagnostics.find((item) => item.range.file === 2);
assert.ok(firstInclusionDiagnostic, JSON.stringify(firstInclusion.envelope));
assert.deepStrictEqual(firstInclusionDiagnostic.includeTrace.map((range) => range.start.byteOffset), [9],
    'a first-inclusion parser diagnostic must retain the first directive after canonical re-inclusion');
assert.deepStrictEqual(firstInclusion.envelope.sourceFiles.map((file) => file.path),
    ['main.c', 'canonical/first-only.h'], 'first-inclusion diagnostics must retain canonical deduplication');

const rangedInclude = analyze(makeRequest({
    source: 'int before;\n#include "broken.h"\n',
}), new Resolver(new Map([
    ['broken.h', { source: '/* π */ int broken = + trailing;\n' }],
])));
assert.strictEqual(rangedInclude.envelope.status, 'diagnostics');
const includedDiagnostic = rangedInclude.envelope.diagnostics.find((item) => item.range.file === 2);
assert.ok(includedDiagnostic, JSON.stringify(rangedInclude.envelope));
assert.deepStrictEqual(includedDiagnostic.range, {
    file: 2,
    start: { line: 1, column: 24, byteOffset: 24 },
    end: { line: 1, column: 32, byteOffset: 32 },
}, 'diagnostic ranges must preserve the exact UTF-8 token span, not caret indentation');
assert.strictEqual(includedDiagnostic.includeTrace[0].file, 1);
assert.strictEqual(includedDiagnostic.includeTrace[0].start.byteOffset, 21,
    'include traces must point at the actual include filename token');

const cycleResolver = new Resolver(new Map([
    ['a.h', { path: 'canonical/a.h', source: '#include "../b.h"\n' }],
    ['b.h', { path: 'canonical/b.h', source: '#include "../a.h"\n' }],
    ['canonical/a.h', { path: 'canonical/a.h', source: '#include "../b.h"\n' }],
    ['canonical/b.h', { path: 'canonical/b.h', source: '#include "../a.h"\n' }],
]));
const cycle = analyze(makeRequest({ source: '#include "a.h"\n' }), cycleResolver);
assert.strictEqual(cycle.envelope.status, 'diagnostics', 'canonical include cycles must be bounded');

const depthFiles = new Map();
for (let index = 0; index < 33; index += 1) {
    depthFiles.set(`h${index}.h`, {
        source: index === 32 ? 'int deepest;\n' : `#include "h${index + 1}.h"\n`,
    });
}
const depth = analyze(makeRequest({ source: '#include "h0.h"\n' }), new Resolver(depthFiles));
assert.strictEqual(depth.envelope.status, 'diagnostics', 'include depth 33 must be rejected');

const tooManyFiles = Array.from({ length: 4097 }, (_, index) => ({
    path: `headers/h${index}.h`, source: '',
}));
assert.strictEqual(analyze(makeRequest({ virtualFiles: tooManyFiles })).envelope.status, 'diagnostics',
    'file count 4,097 must be a resource diagnostic');

const tooLargeFile = 'x'.repeat((4 * 1024 * 1024) + 1);
assert.strictEqual(analyze(makeRequest({
    virtualFiles: [{ path: 'large.h', source: tooLargeFile }],
})).envelope.status, 'diagnostics', 'one file over 4 MiB must be a resource diagnostic');

const totalFiles = Array.from({ length: 8 }, (_, index) => ({
    path: `total/h${index}.h`, source: 'x'.repeat(4 * 1024 * 1024),
}));
const totalFailure = analyze(makeRequest({ virtualFiles: totalFiles })).envelope;
assert.strictEqual(totalFailure.status, 'diagnostics',
    `total source over 32 MiB must be a resource diagnostic: ${JSON.stringify(totalFailure)}`);

const loweredMemory = analyze(makeRequest({
    limits: { ...hardLimits, memoryBytes: 1 },
})).envelope;
assert.strictEqual(loweredMemory.status, 'diagnostics',
    'a lowered per-request memory budget must stop analysis with a bounded diagnostic');
assert.ok(loweredMemory.diagnostics.some((item) => item.code === 'memory-bytes'));

const loweredResult = analyze(makeRequest({
    limits: { ...hardLimits, resultBytes: 256 },
}));
assert.strictEqual(loweredResult.envelope.status, 'diagnostics',
    'a serialized result above resultBytes must return a bounded resource diagnostic');
assert.ok(loweredResult.envelope.diagnostics.some((item) => item.code === 'result-bytes'));
assert.ok(loweredResult.bytes.length <= hardLimits.resultBytes,
    'the result-limit diagnostic must stay below the compiled hard maximum');

abi.merc32_reset();
assert.strictEqual(abi.merc32_alloc((40 * 1024 * 1024) + 1), 0,
    'request allocation over 40 MiB must be rejected without growing or trapping');
assert.strictEqual(analyze(makeRequest({
    limits: { ...hardLimits, resultBytes: (64 * 1024 * 1024) + 1 },
})).envelope.status, 'internal-error', 'a caller result limit above the hard maximum must be rejected');
assert.strictEqual(analyze(makeRequest({
    limits: { ...hardLimits, memoryBytes: (128 * 1024 * 1024) + 1 },
})).envelope.status, 'internal-error', 'a caller memory limit above the hard maximum must be rejected');

const remainingPages = 2048 - (abi.memory.buffer.byteLength / 65536);
if (remainingPages > 0) abi.memory.grow(remainingPages);
assert.throws(() => abi.memory.grow(1), RangeError,
    'the declared memory maximum must prevent growth beyond 128 MiB');

const afterFailures = analyze(makeRequest());
assert.strictEqual(afterFailures.envelope.status, 'ok', 'reset must clear all stale failure state');

console.log('Aro WASM bridge contract tests passed');

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
            assert.strictEqual(count.value, 1, 'the module must define one memory');
            const flags = readUleb(bytes, offset);
            offset = flags.next;
            const minimum = readUleb(bytes, offset);
            offset = minimum.next;
            assert.ok((flags.value & 1) !== 0, 'the memory must declare a maximum');
            return readUleb(bytes, offset).value;
        }
        offset = sectionEnd;
    }
    throw new Error('WASM memory section not found');
}

function readUleb(bytes, start) {
    let value = 0;
    let shift = 0;
    let offset = start;
    while (true) {
        const byte = bytes[offset++];
        value |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return { value, next: offset };
        shift += 7;
    }
}
