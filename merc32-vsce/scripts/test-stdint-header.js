'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { instantiateAuditedBridge } = require('./test-c-frontend-package');

const extensionRoot = path.resolve(__dirname, '..');
const resourceRoot = path.join(extensionRoot, 'resources', 'c-frontend');
const manifest = JSON.parse(fs.readFileSync(path.join(resourceRoot, 'build-manifest.json'), 'utf8'));
const bytes = fs.readFileSync(path.join(resourceRoot, 'aro-merc32.wasm'));
const stdint = fs.readFileSync(path.join(resourceRoot, 'include', 'stdint.h'), 'utf8');
const bridge = instantiateAuditedBridge(bytes, manifest);
const source = [
    '#include <stdint.h>',
    '_Static_assert(_Generic((UINT8_MAX), int: 1, default: 0), "UINT8_MAX type");',
    '_Static_assert(_Generic((UINT16_MAX), int: 1, default: 0), "UINT16_MAX type");',
    '_Static_assert(_Generic((UINT_LEAST8_MAX), int: 1, default: 0), "UINT_LEAST8_MAX type");',
    '_Static_assert(_Generic((UINT_LEAST16_MAX), int: 1, default: 0), "UINT_LEAST16_MAX type");',
    '_Static_assert(_Generic((UINT_FAST8_MAX), int: 1, default: 0), "UINT_FAST8_MAX type");',
    '_Static_assert(_Generic((UINT_FAST16_MAX), int: 1, default: 0), "UINT_FAST16_MAX type");',
    '_Static_assert(_Generic((UINT32_MAX), unsigned int: 1, default: 0), "UINT32_MAX type");',
    '_Static_assert(_Generic((UINT_LEAST32_MAX), unsigned int: 1, default: 0), "UINT_LEAST32_MAX type");',
    '_Static_assert(_Generic((UINT_FAST32_MAX), unsigned int: 1, default: 0), "UINT_FAST32_MAX type");',
    '_Static_assert(_Generic((UINT64_MAX), unsigned long long: 1, default: 0), "UINT64_MAX type");',
    '_Static_assert(sizeof(int_least8_t) == 1 && sizeof(uint_least8_t) == 1, "least8");',
    '_Static_assert(sizeof(int_least16_t) == 2 && sizeof(uint_least16_t) == 2, "least16");',
    '_Static_assert(sizeof(int_least32_t) == 4 && sizeof(uint_least32_t) == 4, "least32");',
    '_Static_assert(sizeof(int_least64_t) == 8 && sizeof(uint_least64_t) == 8, "least64");',
    '_Static_assert(sizeof(int_fast8_t) == 1 && sizeof(uint_fast8_t) == 1, "fast8");',
    '_Static_assert(sizeof(int_fast16_t) == 2 && sizeof(uint_fast16_t) == 2, "fast16");',
    '_Static_assert(sizeof(int_fast32_t) == 4 && sizeof(uint_fast32_t) == 4, "fast32");',
    '_Static_assert(sizeof(int_fast64_t) == 8 && sizeof(uint_fast64_t) == 8, "fast64");',
    '_Static_assert(sizeof(intmax_t) == 8 && sizeof(uintmax_t) == 8, "max");',
    '_Static_assert(sizeof(intptr_t) == 4 && sizeof(uintptr_t) == 4, "pointer");',
    '_Static_assert(INT_LEAST8_MIN == INT8_MIN && INT_LEAST64_MAX == INT64_MAX, "least limits");',
    '_Static_assert(UINT_LEAST16_MAX == UINT16_MAX && UINT_LEAST32_MAX == UINT32_MAX, "least unsigned");',
    '_Static_assert(INT_FAST8_MIN == INT8_MIN && INT_FAST16_MAX == INT16_MAX, "fast limits");',
    '_Static_assert(UINT_FAST8_MAX == UINT8_MAX && UINT_FAST32_MAX == UINT32_MAX, "fast unsigned");',
    '_Static_assert(INT_FAST64_MIN == INT64_MIN && UINT_FAST64_MAX == UINT64_MAX, "fast64 limits");',
    '_Static_assert(INTMAX_MIN == INT64_MIN && UINTMAX_MAX == UINT64_MAX, "max limits");',
    '_Static_assert(INTPTR_MIN == INT32_MIN && UINTPTR_MAX == UINT32_MAX, "pointer limits");',
    '_Static_assert(INT8_C(127) == INT8_MAX && UINT8_C(255) == UINT8_MAX, "constant8");',
    '_Static_assert(INT16_C(32767) == INT16_MAX && UINT16_C(65535) == UINT16_MAX, "constant16");',
    '_Static_assert(INT32_C(2147483647) == INT32_MAX, "constant32");',
    '_Static_assert(UINT32_C(4294967295) == UINT32_MAX, "uconstant32");',
    '_Static_assert(INT64_C(9223372036854775807) == INT64_MAX, "constant64");',
    '_Static_assert(UINT64_C(18446744073709551615) == UINT64_MAX, "uconstant64");',
    '_Static_assert(INTMAX_C(9223372036854775807) == INTMAX_MAX, "constantmax");',
    '_Static_assert(UINTMAX_C(18446744073709551615) == UINTMAX_MAX, "uconstantmax");',
    '',
].join('\n');
const result = bridge.analyze({
    protocolVersion: 1,
    mainPath: 'stdint-test.c',
    source,
    standard: 'c17',
    defines: {},
    includePaths: ['include'],
    virtualFiles: [{ path: 'include/stdint.h', source: stdint }],
    limits: {
        fileBytes: 4 * 1024 * 1024,
        totalSourceBytes: 32 * 1024 * 1024,
        fileCount: 4096,
        includeDepth: 32,
        requestBytes: 40 * 1024 * 1024,
        resultBytes: 64 * 1024 * 1024,
        memoryBytes: 128 * 1024 * 1024,
    },
});
assert.strictEqual(result.status, 'ok',
    `C17 stdint conformance failed through committed WASM: ${JSON.stringify(result.diagnostics)}`);
assert.ok(result.unit && result.unit.nodes.length > 0, 'stdint conformance returned no typed unit');
process.stdout.write('C17 stdint header tests passed through committed WASM.\n');
