'use strict';

const assert = require('assert');
const { assertBridgeContract } = require('./test-c-frontend-package');

const expectedManifest = {
    bridgeBuildId: `merc32-aro-v1-${'a'.repeat(64)}`,
    bridgeProtocolVersion: 1,
};
const expectedFacts = {
    imports: [{ module: 'merc32_source', name: 'resolve', kind: 'function' }],
    exports: [
        'memory', 'merc32_alloc', 'merc32_analyze', 'merc32_build_id_len',
        'merc32_build_id_ptr', 'merc32_protocol_version', 'merc32_reset',
        'merc32_result_len', 'merc32_result_ptr',
    ],
    memoryMaximumPages: 2048,
    bridgeBuildId: expectedManifest.bridgeBuildId,
    protocolVersion: 1,
};

assert.doesNotThrow(() => assertBridgeContract(expectedFacts, expectedManifest));

assert.throws(() => assertBridgeContract({
    ...expectedFacts,
    exports: expectedFacts.exports.filter((name) => name !== 'merc32_reset'),
}, expectedManifest), /exports do not match/u,
'a missing WASM export must fail the package contract');

assert.throws(() => assertBridgeContract({
    ...expectedFacts,
    bridgeBuildId: `merc32-aro-v1-${'b'.repeat(64)}`,
}, expectedManifest), /build ID does not match/u,
'a wrong embedded build ID must fail the package contract');

assert.throws(() => assertBridgeContract({
    ...expectedFacts,
    protocolVersion: 2,
}, expectedManifest), /protocol version does not match/u,
'a wrong bridge protocol must fail the package contract');

process.stdout.write('C frontend package WASM contract tests passed.\n');
