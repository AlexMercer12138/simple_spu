const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createFlashImage } = require('../out/flashImage');

function expectError(label, action, pattern) {
    assert.throws(action, pattern, label);
}

const payload = Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0]);
const explicitEntry = createFlashImage(payload, { loadAddress: 0x00001000, entryAddress: 0x00001004 });
assert.deepStrictEqual(explicitEntry, Buffer.from([
    0x4d, 0x33, 0x32, 0x46,
    0x00, 0x00, 0x00, 0x08,
    0x00, 0x00, 0x10, 0x00,
    0x00, 0x00, 0x10, 0x04,
    0xa8, 0x5a, 0x34, 0xa3,
    0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0xde, 0xf0,
]), 'image must use the specified big-endian header and preserve every payload byte');

const defaultEntry = createFlashImage(payload, { loadAddress: 0x00002000 });
assert.strictEqual(defaultEntry.readUInt32BE(12), 0x00002000, 'entry defaults to the load address');
assert.deepStrictEqual(defaultEntry.subarray(20), payload, 'the packer must not relocate or byte-swap the payload');

const exactU32Boundary = createFlashImage(Buffer.from([0xde, 0xad, 0xbe, 0xef]), {
    loadAddress: 0xffff_fffc,
});
assert.strictEqual(exactU32Boundary.readUInt32BE(8), 0xffff_fffc,
    'a four-byte payload may end exactly at the 32-bit address-space boundary');
assert.strictEqual(exactU32Boundary.readUInt32BE(12), 0xffff_fffc,
    'the default entry remains valid at the exact 32-bit boundary');

expectError('empty payload', () => createFlashImage(Buffer.alloc(0), { loadAddress: 0 }), /payload.*nonempty|nonempty.*payload/i);
expectError('non-word payload', () => createFlashImage(Buffer.from([1, 2, 3]), { loadAddress: 0 }), /payload.*multiple.*four|multiple.*four.*payload/i);
expectError('unaligned load address', () => createFlashImage(payload, { loadAddress: 2 }), /load.*align|align.*load/i);
expectError('unaligned entry address', () => createFlashImage(payload, { loadAddress: 0x1000, entryAddress: 0x1002 }), /entry.*align|align.*entry/i);
expectError('entry below payload', () => createFlashImage(payload, { loadAddress: 0x1000, entryAddress: 0x0ffc }), /entry.*payload|payload.*entry/i);
expectError('entry at payload end', () => createFlashImage(payload, { loadAddress: 0x1000, entryAddress: 0x1008 }), /entry.*payload|payload.*entry/i);
expectError('load address outside u32', () => createFlashImage(payload, { loadAddress: 0x1_0000_0000 }), /load.*32|32.*load|unsigned/i);
expectError('entry address outside u32', () => createFlashImage(payload, { loadAddress: 0x1000, entryAddress: 0x1_0000_0000 }), /entry.*32|32.*entry|unsigned/i);
expectError('payload range overflow', () => createFlashImage(payload, { loadAddress: 0xffff_fffc }), /load.*range|range.*load|overflow/i);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-flash-image-'));
try {
    const input = path.join(tempRoot, 'application.bin');
    const output = path.join(tempRoot, 'application.img');
    fs.writeFileSync(input, payload);
    childProcess.execFileSync(process.execPath, [path.join(__dirname, '..', 'out', 'flashImage.js'), input, output, '0x1000', '0x1004'], { stdio: 'pipe' });
    assert.deepStrictEqual(fs.readFileSync(output), explicitEntry, 'the CLI must write the same deterministic image as the API');
} finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('flash image tests passed');
