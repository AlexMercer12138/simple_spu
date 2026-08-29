const assert = require('assert');

const {
    parseU32, parseByteSize, formatHex32, rangeEnd, alignUp,
} = require('../out/soc');

assert.strictEqual(parseU32('0xFFFFFFFF'), 0xffffffffn);
assert.strictEqual(parseU32('4294967295'), 0xffffffffn);
assert.strictEqual(parseByteSize('32KiB'), 32768n);
assert.strictEqual(parseByteSize('16MiB'), 16777216n);
assert.strictEqual(parseByteSize(4096), 4096n);
assert.strictEqual(formatHex32(0x10000000n), '0x10000000');
assert.strictEqual(rangeEnd(0x10000000n, 4096n), 0x10000fffn);
assert.strictEqual(alignUp(0x10000001n, 4096n), 0x10001000n);

assert.throws(() => parseU32('0x100000000'), /32-bit unsigned/);
assert.throws(() => parseU32(-1), /32-bit unsigned/);
assert.throws(() => parseU32(1.5), /32-bit unsigned/);
assert.throws(() => parseU32(Number.MAX_SAFE_INTEGER + 1), /32-bit unsigned/);
assert.throws(() => parseByteSize(0), /positive byte size/);
assert.throws(() => parseByteSize(-1), /positive byte size/);
assert.throws(() => parseByteSize(1.5), /positive byte size/);
assert.throws(() => parseByteSize('1KB'), /KiB or MiB/);
for (const invalidByteSize of [
    1n,
    true,
    null,
    {},
    { toString: () => '32KiB' },
]) {
    assert.throws(() => parseByteSize(invalidByteSize), /number or string/);
}
assert.throws(() => formatHex32(-1n), /32-bit unsigned/);
assert.throws(() => rangeEnd(0xfffff000n, 8192n), /overflows/);
assert.throws(() => rangeEnd(0n, 0n), /positive size/);
assert.throws(() => alignUp(0n, 0n), /power of two/);
assert.throws(() => alignUp(0n, 3n), /power of two/);
assert.throws(() => alignUp(0xffffffffn, 2n), /overflows/);

console.log('MERC32 SoC configuration tests passed.');
