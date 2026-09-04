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
const validation = require(path.join(frontendRoot, 'validate'));

function source(pathName, sourceText, includingPath, includeKind = 'quoted') {
  return { path: pathName, source: sourceText, includingPath, includeKind };
}

// Provider ordering and canonicalization.
const memory = new providers.MemorySourceProvider([
  { path: './include/./value.h', source: 'virtual-value' },
  { path: 'include/other.h', source: 'other' },
]);
assert.equal(providers.normalizeLogicalPath('C:relative.h'), undefined);
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
assert.throws(() => new providers.NodeSourceProvider({
  mainFile: path.join(__dirname, 'fixtures', 'c-frontend', 'include', 'main.c'),
  realPath(file) {
    return file.endsWith(path.join('include', 'main.c')) ? path.join(__dirname, 'outside-main.c') : file;
  },
}), /containment|main file|allowed/);
const absoluteIncluding = path.join(__dirname, 'fixtures', 'c-frontend', 'include', 'main.c');
const absoluteIncludingProvider = new providers.NodeSourceProvider({ mainFile: absoluteIncluding });
assert.equal(absoluteIncludingProvider.resolve(source('user/value.h', '', absoluteIncluding)).status, 'found');

const caseDistinct = new providers.MemorySourceProvider([
  { path: 'Foo.h', source: 'upper' },
  { path: 'foo.h', source: 'lower' },
]);
assert.equal(caseDistinct.resolve(source('Foo.h', undefined)).source, 'upper');
assert.equal(caseDistinct.resolve(source('foo.h', undefined)).source, 'lower');

let compatibilityRealPath;
let compatibilityReadFile;
const compatibility = new providers.CompatiblePreprocessSourceProvider({
  realPath(file) { compatibilityRealPath = file; return file; },
  readFile(file) { compatibilityReadFile = file; return 'compat-source'; },
});
const compatibilityResult = compatibility.resolve(source('include/value.h', '', path.join(__dirname, 'main.c')));
assert.equal(compatibilityResult.status, 'found');
assert.equal(compatibilityResult.canonicalPath, 'include/value.h');
assert.equal(compatibilityRealPath, path.resolve(__dirname, 'include', 'value.h'));
assert.equal(compatibilityReadFile, path.resolve(__dirname, 'include', 'value.h'));
const compatibilityRealPathError = new providers.CompatiblePreprocessSourceProvider({
  realPath() {
    const error = new Error('permission denied');
    error.code = 'EACCES';
    throw error;
  },
});
assert.equal(compatibilityRealPathError.resolve(source('value.h', '')).status, 'error');

const composite = new providers.CompositeSourceProvider(memory, node);
assert.equal(composite.resolve(source('include/value.h', '', 'main.c')).source, 'virtual-value');
assert.equal(composite.resolve(source('user/value.h', '', absoluteIncluding)).status, 'found');

let capturedFileRequest;
const fileFrontend = new frontend.AroFrontendService({
  analyze(request) {
    capturedFileRequest = request;
    return { protocolVersion: 1, bridgeBuildId: 'test-build', status: 'diagnostics', diagnostics: [] };
  },
});
fileFrontend.analyzeFile(absoluteIncluding, { limits: { includeDepth: 32 } }, { maxIncludeDepth: 1 });
assert.equal(capturedFileRequest.limits.includeDepth, 1);

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
assert.throws(() => frontend.makeRequest('int x;', { limits: { bogus: 1 } }), /unknown|limits/);
const loweredRequest = frontend.makeRequest('int x;', { limits: { fileBytes: 1 } });
assert.equal(loweredRequest.limits.fileBytes, 1);

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
assert.throws(() => malformedHost.analyze(request), validation.CFrontendInternalError);

let resolverCalls = 0;
const abiProvider = new providers.MemorySourceProvider([{ path: 'header.h', source: 'int h;' }]);
const abiHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  sourceProvider: abiProvider,
  instantiate(resolve) {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    const analyze = abi.merc32_analyze;
    abi.merc32_analyze = (pointer, length) => {
      const candidate = Buffer.from('header.h');
      new Uint8Array(abi.memory.buffer, 1024, candidate.length).set(candidate);
      const encodedLength = resolve(abi.memory, 1024, candidate.length, 2048, 4096);
      resolverCalls++;
      assert.ok(encodedLength > 4);
      analyze(pointer, length);
    };
    return { exports: abi };
  },
});
assert.doesNotThrow(() => abiHost.analyze(request));
assert.equal(resolverCalls, 1);
const lowRequestBytes = { ...request, limits: { ...request.limits, requestBytes: 1 } };
assert.doesNotThrow(() => abiHost.analyze(lowRequestBytes));
const lowResultBytes = { ...request, limits: { ...request.limits, resultBytes: 1 } };
const lowResultHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    return { exports: fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}')) };
  },
});
assert.equal(lowResultHost.analyze(lowResultBytes).status, 'diagnostics');
const hardResultHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    abi.merc32_result_len = () => 64 * 1024 * 1024 + 1;
    return { exports: abi };
  },
});
assert.throws(() => hardResultHost.analyze(request), validation.CFrontendInternalError);

const missingMemoryHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    delete abi.memory;
    return { exports: abi };
  },
});
assert.throws(() => missingMemoryHost.analyze(request), validation.CFrontendInternalError);
const malformedMemoryHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    abi.memory = {};
    return { exports: abi };
  },
});
assert.throws(() => malformedMemoryHost.analyze(request), validation.CFrontendInternalError);

let resolverReentrant;
const resolverReentrantProvider = {
  resolve() {
    return resolverReentrant.analyze(request);
  },
};
const resolverReentrantHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  sourceProvider: resolverReentrantProvider,
  instantiate(resolve) {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    const analyze = abi.merc32_analyze;
    abi.merc32_analyze = (pointer, length) => {
      const candidate = Buffer.from('header.h');
      new Uint8Array(abi.memory.buffer, 1024, candidate.length).set(candidate);
      assert.throws(() => resolve(abi.memory, 1024, candidate.length, 2048, 4096), validation.CFrontendInternalError);
      analyze(pointer, length);
    };
    return { exports: abi };
  },
});
resolverReentrant = resolverReentrantHost;
assert.doesNotThrow(() => resolverReentrantHost.analyze(request));

const badResultPointerHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  instantiate() {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    abi.merc32_result_ptr = () => abi.memory.buffer.byteLength + 1;
    return { exports: abi };
  },
});
assert.throws(() => badResultPointerHost.analyze(request), validation.CFrontendInternalError);

let badResultCapacity;
const badResultCapacityHost = new host.AroWasmHost({
  manifest: { bridgeBuildId: 'test-build', wasmSha256: '00'.repeat(32) },
  sourceProvider: abiProvider,
  instantiate(resolve) {
    const abi = fakeExports(Buffer.from('{"protocolVersion":1,"bridgeBuildId":"test-build","status":"diagnostics","diagnostics":[]}'));
    const analyze = abi.merc32_analyze;
    abi.merc32_analyze = (pointer, length) => {
      const candidate = Buffer.from('header.h');
      new Uint8Array(abi.memory.buffer, 1024, candidate.length).set(candidate);
      badResultCapacity = resolve(abi.memory, 1024, candidate.length, 2048, Number.NaN);
      analyze(pointer, length);
    };
    return { exports: abi };
  },
});
assert.doesNotThrow(() => badResultCapacityHost.analyze(request));
assert.equal(badResultCapacity, -2);

assert.equal(typeof frontend.AroFrontend, 'function');

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
assert.throws(() => reentrantHost.analyze(request), validation.CFrontendInternalError);

// Canonical include roots must retain their logical name when realPath resolves a symlink.
const symlinkRoot = path.join(__dirname, 'fixtures', 'c-frontend', 'include-link');
const physicalRoot = path.join(__dirname, 'fixtures', 'c-frontend', 'include');
const symlinkNode = new providers.NodeSourceProvider({
  mainFile: path.join(__dirname, 'main-outside', 'driver.c'),
  includePaths: [symlinkRoot],
  realPath(file) {
    return file.startsWith(symlinkRoot) ? path.join(physicalRoot, file.slice(symlinkRoot.length)) : file;
  },
});
assert.equal(symlinkNode.resolve(source(path.join(physicalRoot, 'user', 'value.h'), '', undefined)).canonicalPath,
  'include-link/user/value.h');

console.log('C frontend host/provider tests passed');
