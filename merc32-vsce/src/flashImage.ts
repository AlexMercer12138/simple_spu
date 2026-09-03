import * as fs from 'fs';

const HEADER_SIZE = 20;
const MAGIC = 0x4d333246;
const U32_LIMIT = 0x1_0000_0000;

export interface FlashImageOptions {
    readonly loadAddress: number;
    readonly entryAddress?: number;
}

/** Creates an M32F flash image around an already-relocated raw binary payload. */
export function createFlashImage(payload: Buffer, options: FlashImageOptions): Buffer {
    if (!Buffer.isBuffer(payload)) throw new Error('payload must be a Buffer');
    if (payload.length === 0) throw new Error('payload must be nonempty');
    if (payload.length % 4 !== 0) throw new Error('payload length must be a multiple of four bytes');

    const loadAddress = requireUint32(options.loadAddress, 'load address');
    const entryAddress = requireUint32(options.entryAddress ?? loadAddress, 'entry address');
    if (loadAddress % 4 !== 0) throw new Error('load address must be four-byte aligned');
    if (entryAddress % 4 !== 0) throw new Error('entry address must be four-byte aligned');

    const payloadEnd = loadAddress + payload.length;
    if (payloadEnd > U32_LIMIT) throw new Error('load range exceeds the 32-bit address space');
    if (entryAddress < loadAddress || entryAddress >= payloadEnd) {
        throw new Error('entry address must lie inside the loaded payload');
    }

    const image = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
    image.writeUInt32BE(MAGIC, 0);
    image.writeUInt32BE(payload.length, 4);
    image.writeUInt32BE(loadAddress, 8);
    image.writeUInt32BE(entryAddress, 12);
    image.writeUInt32BE(crc32(payload), 16);
    payload.copy(image, HEADER_SIZE);
    return image;
}

function requireUint32(value: number, name: string): number {
    if (!Number.isInteger(value) || value < 0 || value >= U32_LIMIT) {
        throw new Error(`${name} must be an unsigned 32-bit integer`);
    }
    return value;
}

function crc32(payload: Buffer): number {
    let crc = 0xffffffff;
    for (const byte of payload) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
            crc = (crc >>> 1) ^ ((crc & 1) === 0 ? 0 : 0xedb88320);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function main(arguments_: readonly string[]): void {
    if (arguments_.length !== 3 && arguments_.length !== 4) {
        throw new Error('usage: flashImage <input.bin> <output.img> <load-address> [entry-address]');
    }
    const [inputPath, outputPath, loadAddress, entryAddress] = arguments_;
    const payload = fs.readFileSync(inputPath);
    fs.writeFileSync(outputPath, createFlashImage(payload, {
        loadAddress: Number(loadAddress),
        ...(entryAddress === undefined ? {} : { entryAddress: Number(entryAddress) }),
    }));
}

if (require.main === module) {
    try {
        main(process.argv.slice(2));
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    }
}
