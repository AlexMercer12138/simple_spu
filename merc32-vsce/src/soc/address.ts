import { ModuleCatalog, SocDiagnostic, SocSourceConfig } from './model';
import { validateSocConfig } from './validate';

const MAX_U32 = 0xffffffffn;
const ADDRESS_SPACE_SIZE = 1n << 32n;
const PLB_BASE = 0x10000000n;
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
    if (alignment > ADDRESS_SPACE_SIZE) {
        throw new RangeError('alignment must not exceed the 32-bit address space');
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

export interface AddressAssignment {
    path: readonly (string | number)[];
    address: string;
}

export interface AddressAssignmentResult {
    config: SocSourceConfig;
    assignments: readonly AddressAssignment[];
    diagnostics: readonly SocDiagnostic[];
}

interface OccupiedRange {
    base: bigint;
    end: bigint;
}

/** Assigns only absent endpoint addresses, preserving every explicit source value. */
export function assignMissingAddresses(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): AddressAssignmentResult {
    const originalClone = cloneJson(config);
    const existingDiagnostics = validateSocConfig(config, catalog);
    if (existingDiagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        return { config: originalClone, assignments: [], diagnostics: existingDiagnostics };
    }

    const working = cloneJson(config);
    const occupied = collectExplicitRanges(config, catalog);
    const assignments: AddressAssignment[] = [];

    const allocate = (
        size: bigint,
        alignment: bigint,
        path: readonly (string | number)[],
        write: (address: string) => void,
    ): boolean => {
        const base = findLowestFreeRange(occupied, size, alignment);
        if (base === undefined) {
            return false;
        }
        const address = formatHex32(base);
        occupied.push({ base, end: base + size - 1n });
        assignments.push({ path: [...path], address });
        write(address);
        return true;
    };

    for (let index = 0; index < working.peripherals.length; index += 1) {
        const peripheral = working.peripherals[index];
        if (peripheral.baseAddress !== undefined) {
            continue;
        }
        const descriptor = catalog.modules.get(peripheral.type)!;
        const path: readonly (string | number)[] = ['peripherals', index, 'baseAddress'];
        if (!allocate(BigInt(descriptor.addressSize), BigInt(descriptor.alignment), path,
            (address) => { peripheral.baseAddress = address; })) {
            return allocationFailure(originalClone, existingDiagnostics, path);
        }
    }

    for (let index = 0; index < working.externalInterfaces.length; index += 1) {
        const endpoint = working.externalInterfaces[index];
        if (endpoint.baseAddress !== undefined) {
            continue;
        }
        const protocol = catalog.protocols.get(endpoint.type)!;
        const alignment = endpoint.addressWidth < 32
            ? 1n << BigInt(endpoint.addressWidth)
            : BigInt(protocol.alignment);
        const path: readonly (string | number)[] = ['externalInterfaces', index, 'baseAddress'];
        if (!allocate(parseByteSize(endpoint.windowSize), alignment, path,
            (address) => { endpoint.baseAddress = address; })) {
            return allocationFailure(originalClone, existingDiagnostics, path);
        }
    }

    const diagnostics = validateSocConfig(working, catalog);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        return { config: originalClone, assignments: [], diagnostics };
    }
    return { config: working, assignments, diagnostics };
}

function collectExplicitRanges(config: SocSourceConfig, catalog: ModuleCatalog): OccupiedRange[] {
    const ranges: OccupiedRange[] = [];
    for (const peripheral of config.peripherals) {
        if (peripheral.baseAddress === undefined) {
            continue;
        }
        const size = BigInt(catalog.modules.get(peripheral.type)!.addressSize);
        const base = BigInt(peripheral.baseAddress);
        ranges.push({ base, end: base + size - 1n });
    }
    for (const endpoint of config.externalInterfaces) {
        if (endpoint.baseAddress === undefined) {
            continue;
        }
        const base = BigInt(endpoint.baseAddress);
        const size = parseByteSize(endpoint.windowSize);
        ranges.push({ base, end: base + size - 1n });
    }
    return ranges;
}

function findLowestFreeRange(
    occupied: readonly OccupiedRange[],
    size: bigint,
    alignment: bigint,
): bigint | undefined {
    const ordered = [...occupied]
        .sort((left, right) => left.base < right.base ? -1 : left.base > right.base ? 1 : 0);
    let candidate = alignUp(PLB_BASE, alignment);
    while (candidate <= MAX_U32) {
        const end = candidate + size - 1n;
        if (end > MAX_U32) {
            return undefined;
        }
        const conflict = ordered.find((range) => candidate <= range.end && range.base <= end);
        if (!conflict) {
            return candidate;
        }
        if (conflict.end === MAX_U32) {
            return undefined;
        }
        try {
            candidate = alignUp(conflict.end + 1n, alignment);
        } catch {
            return undefined;
        }
    }
    return undefined;
}

function allocationFailure(
    config: SocSourceConfig,
    diagnostics: readonly SocDiagnostic[],
    path: readonly (string | number)[],
): AddressAssignmentResult {
    return {
        config,
        assignments: [],
        diagnostics: [
            ...diagnostics,
            {
                severity: 'error',
                code: 'SOC_ADDRESS_SPACE',
                path: [...path],
                message: 'No aligned PLB range is available for this endpoint.',
            },
        ],
    };
}

function cloneJson<T>(value: T): T {
    if (Array.isArray(value)) {
        return value.map((item) => cloneJson(item)) as T;
    }
    if (value !== null && typeof value === 'object') {
        const clone: Record<PropertyKey, unknown> = {};
        for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
            clone[key] = cloneJson(item);
        }
        for (const key of Object.getOwnPropertySymbols(value)) {
            clone[key] = cloneJson((value as Record<PropertyKey, unknown>)[key]);
        }
        return clone as T;
    }
    return value;
}
