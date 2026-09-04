'use strict';

// Task 8 RED harness: the production host/provider modules are intentionally
// absent until the implementation phase. Keep the first require explicit so
// npm compile + this script fails for the expected missing-module reason.
const assert = require('node:assert/strict');
const path = require('node:path');

const frontendRoot = path.resolve(__dirname, '..', 'out', 'cFrontend');
const providers = require(path.join(frontendRoot, 'sourceProvider'));
const host = require(path.join(frontendRoot, 'wasmHost'));
const frontend = require(path.join(frontendRoot, 'frontend'));

function source(pathName, sourceText, includingPath, includeKind = 'quoted') {
  return { path: pathName, source: sourceText, includingPath, includeKind };
}

// Provider ordering and canonicalization.
const memory = new providers.MemorySourceProvider([
  { path: './include/./value.h', source: 'virtual-value' },
  { path: 'include/other.h', source: 'other' },
]);
assert.deepEqual(memory.resolve(source('include/value.h', '', 'main.c')), {
  status: 'found', canonicalPath: 'include/value.h', source: 'virtual-value',
});
assert.deepEqual(memory.resolve(source('../outside.h', '', 'include/main.c')), { status: 'not-found' });

const node = new providers.NodeSourceProvider({
  mainFile: path.join(__dirname, 'fixtures', 'c-frontend', 'include', 'main.c'),
  includePaths: [path.join(__dirname, 'fixtures', 'c-frontend', 'include')],
});
assert.equal(node.resolve(source('user/value.h', '', 'main.c')).status, 'found');
assert.equal(node.resolve(source('../outside.h', '', 'main.c')).status, 'not-found');

const composite = new providers.CompositeSourceProvider(memory, node);
assert.equal(composite.resolve(source('include/value.h', '', 'main.c')).source, 'virtual-value');

assert.throws(
  () => new providers.CompatiblePreprocessSourceProvider({ maxIncludeDepth: 0 }),
  /maxIncludeDepth/,
);
assert.throws(
  () => new providers.CompatiblePreprocessSourceProvider({ maxIncludeDepth: 33 }),
  /maxIncludeDepth/,
);

const limits = { fileBytes: 4 * 1024 * 1024, totalSourceBytes: 32 * 1024 * 1024,
  fileCount: 4096, includeDepth: 32, requestBytes: 40 * 1024 * 1024,
  resultBytes: 64 * 1024 * 1024, memoryBytes: 128 * 1024 * 1024 };
const request = frontend.makeRequest('int main(void) { return 0; }', {
  sourceName: 'main.c', limits: { includeDepth: 1 },
});
assert.equal(request.protocolVersion, 1);
assert.equal(request.standard, 'c17');
assert.equal(request.limits.includeDepth, 1);

// Host lifecycle is injectable so the tests do not depend on a checked-in
// release resource. A trap invalidates the warm instance and the next call
// creates a fresh one; reentry is rejected and never retried.
let instances = 0;
let invocations = 0;
const fakeHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    instances++;
    return { invoke() {
      invocations++;
      if (invocations === 1) throw new WebAssembly.RuntimeError('forced trap');
      return { protocolVersion: 1, bridgeBuildId: 'test-build', status: 'diagnostics', diagnostics: [] };
    } };
  },
});
assert.throws(() => fakeHost.analyze({ ...request, source: 'int x;' }), WebAssembly.RuntimeError);
assert.equal(instances, 1);
assert.doesNotThrow(() => fakeHost.analyze({ ...request, source: 'int y;' }));
assert.equal(instances, 2);

function fakeExports(resultBytes) {
  const buffer = new ArrayBuffer(64 * 1024);
  let resultLength = 0;
  return {
    memory: { buffer },
    merc32_alloc: () => 256,
    merc32_analyze: () => {
      new Uint8Array(buffer, 512, resultBytes.length).set(resultBytes);
      resultLength = resultBytes.length;
    },
    merc32_result_ptr: () => 512,
    merc32_result_len: () => resultLength,
    merc32_reset: () => { resultLength = 0; },
    merc32_protocol_version: () => 1,
    merc32_build_id_ptr: () => 0,
    merc32_build_id_len: () => 0,
  };
}
const malformedHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    return { exports: fakeExports(Uint8Array.from([0xff])) };
  },
});
assert.throws(() => malformedHost.analyze(request), host.CFrontendInternalError);

const mismatchedHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    return { invoke: () => ({ protocolVersion: 1, bridgeBuildId: 'other-build', status: 'diagnostics', diagnostics: [] }) };
  },
});
assert.throws(() => mismatchedHost.analyze(request), /BUILD_ID/);

let reentrant;
const reentrantHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() { return { invoke() { return reentrant.analyze(request); } }; },
});
reentrant = reentrantHost;
assert.throws(() => reentrantHost.analyze(request), host.CFrontendInternalError);

console.log('C frontend host/provider tests passed');
