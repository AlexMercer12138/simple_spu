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
