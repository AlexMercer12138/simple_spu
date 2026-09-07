'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { AroFrontendService } = require('../out/cFrontend/frontend');
const { HARD_C_FRONTEND_LIMITS } = require('../out/cFrontend/limits');
const { readMemoryMaximumPages } = require('./test-c-frontend-package');

const extensionRoot = path.resolve(__dirname, '..');
const wasmPath = path.join(extensionRoot, 'resources', 'c-frontend', 'aro-merc32.wasm');
const source = 'int value;\n';

function run() {
    const coldStart = process.hrtime.bigint();
    const coldService = new AroFrontendService();
    const cold = coldService.analyzeSource(source, { sourceName: 'benchmark.c' });
    const coldMs = Number(process.hrtime.bigint() - coldStart) / 1e6;
    assert.strictEqual(cold.status, 'ok', 'cold benchmark request did not compile');

    const warmService = new AroFrontendService();
    warmService.analyzeSource(source, { sourceName: 'benchmark.c' });
    const beforeRss = process.memoryUsage().rss;
    const warmStart = process.hrtime.bigint();
    for (let index = 0; index < 100; index += 1) {
        const result = warmService.analyzeSource(source, { sourceName: 'benchmark.c' });
        assert.strictEqual(result.status, 'ok', `warm benchmark request ${index} did not compile`);
    }
    const warmMeanMs = Number(process.hrtime.bigint() - warmStart) / 1e6 / 100;
    const rssDelta = process.memoryUsage().rss - beforeRss;
    const wasmBytes = fs.statSync(wasmPath).size;
    const memoryMaximumPages = readMemoryMaximumPages(fs.readFileSync(wasmPath));
    const memoryMaximumBytes = memoryMaximumPages * 65536;
    assert.ok(wasmBytes <= 4 * 1024 * 1024, 'WASM artifact exceeds 4 MiB ceiling');
    assert.strictEqual(memoryMaximumBytes, HARD_C_FRONTEND_LIMITS.memoryBytes,
        'WASM configured memory maximum differs from frontend hard limit');
    process.stdout.write(JSON.stringify({
        coldMs: Number(coldMs.toFixed(3)),
        warmMeanMs: Number(warmMeanMs.toFixed(3)),
        rssDelta,
        wasmBytes,
        memoryMaximumBytes,
    }, null, 2) + '\n');
}

if (require.main === module) {
    try { run(); } catch (error) {
        console.error(error.stack || error.message);
        process.exitCode = 1;
    }
}

module.exports = { run };
