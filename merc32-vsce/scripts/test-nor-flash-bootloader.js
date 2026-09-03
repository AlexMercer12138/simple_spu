const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { compileCFile } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

const sourceFile = path.join(__dirname, '..', '..', 'example', 'nor_flash_bootloader.c');
assert.ok(fs.existsSync(sourceFile), `missing reference bootloader source: ${sourceFile}`);

const { assembly } = compileCFile(sourceFile, {
    moduleName: 'nor_flash_bootloader',
    codeBase: 0,
});
const result = new SimpleCPUAssembler().assemble(assembly, {
    sourceFileName: 'nor_flash_bootloader.asm',
});

function functionBody(name) {
    const body = assembly.match(new RegExp(`^${name}:\\r?\\n([\\s\\S]*?)^__${name}_return:`, 'm'))?.[1];
    assert.ok(body, `missing compiled function ${name}`);
    return body;
}

function hasImmediate(body, value) {
    const unsigned = value >>> 0;
    const high = unsigned >>> 16;
    const low = unsigned & 0xffff;
    const hex = (part) => part > 9 ? `0x${part.toString(16).toUpperCase()}` : String(part);
    if (high === 0) return new RegExp(`^mov r\\d+, ${hex(low)}$`, 'm').test(body);
    const lowPart = low === 0 ? '' : `\\r?\\nmov (r\\d+), \\1 \\+ ${hex(low)}`;
    return new RegExp(`^mov (r\\d+), ${hex(high)}\\r?\\nmov \\1, \\1 << 16${lowPart}$`, 'm').test(body);
}

assert.strictEqual(result.origin, 0, 'bootloader must assemble at ILB address zero');
assert.strictEqual(result.entryLabel, '__start', 'compiler startup must remain the reset entry');
assert.match(result.debugSymbols, /^__irq_vector\s+=\s+4 \(0x0004\)$/m);
assert.match(result.debugSymbols, /^__start\s+=\s+8 \(0x0008\)$/m);
assert.ok(result.machineCodes.length > 0, 'bootloader emitted no machine code');
assert.ok(result.machineCodes.length * 4 <= 0x1000,
    `bootloader uses ${result.machineCodes.length * 4} bytes and exceeds its 4 KiB reservation`);

const qspiReadBody = functionBody('qspi_read');
for (const value of [0x10004000, 0x00000088, 0x00001808, 0x03, 0x00100000, 0x0000003f]) {
    assert.ok(hasImmediate(qspiReadBody, value),
        `compiled QSPI reader is missing 0x${value.toString(16)}`);
}
assert.match(qspiReadBody, /^lbu r\d+, \[r\d+\]$/m,
    'QSPI reader must drain RX_DATA as bytes while the transaction runs');
assert.match(qspiReadBody, /^cmpu r\d+, r\d+ != r\d+$/m,
    'QSPI reader must use bounded progress polling');

const crcBody = functionBody('crc32_byte');
assert.ok(hasImmediate(crcBody, 0xedb88320), 'compiled CRC32 polynomial is not IEEE reflected CRC32');
assert.match(crcBody, /^mov r\d+, r\d+ >> r\d+$/m);
assert.match(crcBody, /^mov r\d+, r\d+ \^ r\d+$/m);

const mainBody = functionBody('main');
const failBody = functionBody('fail');
const irqHandlerBody = functionBody('__irq_handler');
assert.ok(irqHandlerBody, 'compiled bootloader must contain the concrete IRQ handler');
assert.match(assembly, /^____irq_handler_return:[\s\S]*^jmp r3$/m,
    'bootloader interrupt handler must return through the IRQ epilogue');
const mainLines = mainBody.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
const irqDisableIndex = mainLines.indexOf('mov r1, 0');
const firstQspiCallIndex = mainLines.indexOf('jmp qspi_read, r14');
assert.ok(irqDisableIndex >= 0,
    'compiled bootloader must emit an explicit interrupt disable');
assert.ok(firstQspiCallIndex >= 0 && irqDisableIndex < firstQspiCallIndex,
    'interrupts must be disabled before the first QSPI transaction');
for (const value of [0x4d333246, 0x00100000, 0x01000000, 0x00001000,
    0x00008000, 0x0000fffc, 0x08000000, 0x600d0000,
    0x0bad0000, 1, 2, 3, 4, 5, 6, 7]) {
    const body = value === 0x0bad0000 ? failBody : mainBody;
    assert.ok(hasImmediate(body, value),
        `compiled bootloader is missing 0x${value.toString(16)}`);
}
assert.match(mainBody, /^sw \[r\d+\], r\d+$/m,
    'compiled bootloader must write payload words and status through volatile pointers');
assert.match(mainBody, /^jmp r\d+$/m,
    'successful boot must end in an indirect jump to the validated entry address');

console.log(`NOR flash bootloader tests passed (${result.machineCodes.length * 4} bytes)`);
