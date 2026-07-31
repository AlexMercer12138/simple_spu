const assert = require('assert');
const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'merc32-firmware-test-'),
);

try {
    const builder = path.join(__dirname, 'build_firmware.js');
    const result = childProcess.spawnSync(
        process.execPath,
        [builder, '--output-dir', temporaryDirectory],
        { encoding: 'utf8' },
    );

    assert.strictEqual(
        result.status,
        0,
        `firmware builder failed:\n${result.stdout}\n${result.stderr}`,
    );

    const assemblyPath = path.join(temporaryDirectory,
        'peripheral_test.asm');
    const memoryPath = path.join(temporaryDirectory, 'peripheral_test.mem');
    assert.ok(fs.statSync(assemblyPath).isFile(),
        'missing peripheral_test.asm');
    assert.ok(fs.statSync(memoryPath).isFile(),
        'missing peripheral_test.mem');

    const words = fs.readFileSync(memoryPath, 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.length > 0);
    assert.ok(words.length >= 1, 'memory image is empty');
    assert.ok(words.length <= 65536, 'memory image exceeds 65536 words');
    for (const word of words) {
        assert.match(word, /^[0-9a-f]{8}$/);
    }

    console.log('TEST PASS');
} finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
