const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { verifyVendoredAro } = require('../../tools/aro-frontend/verify-vendor');

const receipt = verifyVendoredAro(path.resolve(__dirname, '..', '..', 'third_party', 'aro'));

assert.strictEqual(receipt.commit, 'ec463262c14c1111fc9323086b708ad3b0b9ca11');
assert.strictEqual(receipt.tree, '7ddef8bd24b01ed7088d5d58d64d41e3d7529ed8');
assert.strictEqual(receipt.trackedFileCount, 791);
assert.strictEqual(receipt.zigVersion, '0.17.0-dev.1936+5a625d5f3');
assert.match(fs.readFileSync(path.join(receipt.root, 'LICENSE'), 'utf8'), /^MIT License/m);
assert.match(fs.readFileSync(path.join(receipt.root, 'LICENSE-UNICODE'), 'utf8'), /^UNICODE LICENSE V3/m);
assert.ok(!receipt.files.some((file) => file === '.git' || file.startsWith('.git/')));
assert.ok(!receipt.files.some((file) => file.startsWith('.zig-cache/') || file.startsWith('zig-out/')));

console.log(`Aro vendor verified: commit=${receipt.commit} tree=${receipt.tree} files=${receipt.trackedFileCount} digest=${receipt.digest}`);
