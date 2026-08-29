const MAX_U32 = 0xffffffffn;
const KIBIBYTE = 1024n;
const MEBIBYTE = KIBIBYTE * KIBIBYTE;

type JsonUnsignedInteger = number | string;

function parseUnsignedInteger(value: JsonUnsignedInteger, description: string): bigint {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value < 0) {
            throw new RangeError(`${description} must be an unsigned safe integer`);
        }
        return BigInt(value);
    }

    if (typeof value !== 'string' || !/^(?:[0-9]+|0[xX][0-9a-fA-F]+)$/.test(value)) {
        throw new TypeError(`${description} must be an unsigned integer`);
    }

    return BigInt(value);
}

function requireU32(value: bigint, description: string): void {
    if (typeof value !== 'bigint' || value < 0n || value > MAX_U32) {
        throw new RangeError(`${description} must be a 32-bit unsigned integer`);
    }
}

/** Parses a JSON unsigned integer as an address in the 32-bit address space. */
export function parseU32(value: JsonUnsignedInteger): bigint {
    try {
        const parsed = parseUnsignedInteger(value, 'address');
        requireU32(parsed, 'address');
        return parsed;
    } catch {
        throw new RangeError('address must be a 32-bit unsigned integer');
    }
}

/** Parses a positive byte count written as decimal bytes or an IEC KiB/MiB value. */
export function parseByteSize(value: JsonUnsignedInteger): bigint {
    if (typeof value === 'number') {
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new RangeError('byte size must be a positive byte size');
        }
        return BigInt(value);
    }
    if (typeof value !== 'string') {
        throw new TypeError('byte size must be a number or string');
    }

    const match = /^([0-9]+)(KiB|MiB)?$/i.exec(value);
    if (!match) {
        throw new TypeError('byte size must be decimal bytes or use KiB or MiB');
    }

    const amount = BigInt(match[1]);
    if (amount === 0n) {
        throw new RangeError('byte size must be a positive byte size');
    }
    const unit = match[2]?.toLowerCase();
    return unit === 'kib' ? amount * KIBIBYTE : unit === 'mib' ? amount * MEBIBYTE : amount;
}

/** Formats a normalized 32-bit unsigned address as eight lowercase hex digits. */
export function formatHex32(value: bigint): string {
    requireU32(value, 'address');
    return `0x${value.toString(16).padStart(8, '0')}`;
}

/** Returns the inclusive end address for a non-empty 32-bit address range. */
export function rangeEnd(baseAddress: bigint, sizeBytes: bigint): bigint {
    requireU32(baseAddress, 'base address');
    if (typeof sizeBytes !== 'bigint' || sizeBytes <= 0n) {
        throw new RangeError('range size must be a positive size');
    }
    const endAddress = baseAddress + sizeBytes - 1n;
    if (endAddress > MAX_U32) {
        throw new RangeError('range overflows the 32-bit address space');
    }
    return endAddress;
}

/** Aligns an address upward to a positive power-of-two boundary in the 32-bit space. */
export function alignUp(value: bigint, alignment: bigint): bigint {
    requireU32(value, 'address');
    if (typeof alignment !== 'bigint' || alignment <= 0n) {
        throw new RangeError('alignment must be a positive power of two');
    }

    let factor = alignment;
    while (factor > 1n && factor % 2n === 0n) {
        factor /= 2n;
    }
    if (factor !== 1n) {
        throw new RangeError('alignment must be a positive power of two');
    }

    const remainder = value % alignment;
    const aligned = remainder === 0n ? value : value + alignment - remainder;
    if (aligned > MAX_U32) {
        throw new RangeError('alignment overflows the 32-bit address space');
    }
    return aligned;
}
