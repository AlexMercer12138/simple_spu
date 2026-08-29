import * as pathModule from 'path';

import { parseByteSize } from './address';
import {
    CatalogParameter,
    ModuleCatalog,
    ModuleDescriptor,
    PeripheralSource,
    SocDiagnostic,
    SocSourceConfig,
} from './model';

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEX_ADDRESS = /^0[xX][0-9a-fA-F]{1,8}$/;
const PLB_BASE = 0x10000000n;
const MAX_U32 = 0xffffffffn;
const MAX_MEMORY_BYTES = 1n << 27n;
const IRQ_TRIGGERS = new Set(['high', 'low', 'rising', 'falling']);

interface PeripheralRecord {
    source: PeripheralSource;
    descriptor: ModuleDescriptor;
    index: number;
}

interface ValidRange {
    base: bigint;
    end: bigint;
    path: readonly (string | number)[];
}

/** Validates every catalog-aware rule that cannot be represented by JSON Schema. */
export function validateSocConfig(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): readonly SocDiagnostic[] {
    const diagnostics: SocDiagnostic[] = [];
    const add = (
        code: string,
        path: readonly (string | number)[],
        message: string,
        severity: SocDiagnostic['severity'] = 'error',
    ): void => {
        diagnostics.push({ severity, code, path: [...path], message });
    };

    validateIdentifier(config.project?.name, ['project', 'name'], 'project name', add);
    if (!isSafeOutputDirectory(config.project?.outputDir)) {
        add('SOC_PROJECT_OUTPUT', ['project', 'outputDir'],
            'Project outputDir must be a non-empty relative path without dot or parent segments.');
    }
    validateMemory(config.memory?.ilb?.size, ['memory', 'ilb', 'size'], add);
    validateMemory(config.memory?.dlb?.size, ['memory', 'dlb', 'size'], add);

    const names = new Map<string, readonly (string | number)[]>();
    const macros = new Map<string, readonly (string | number)[]>();
    const topPorts = new Map<string, readonly (string | number)[]>();
    const peripheralRecords: PeripheralRecord[] = [];
    const peripheralByName = new Map<string, PeripheralRecord>();
    const moduleCounts = new Map<string, number>();
    const ranges: ValidRange[] = [];
    const intcIndices: number[] = [];

    const recordInstanceName = (
        name: unknown,
        instancePath: readonly (string | number)[],
        label: string,
    ): name is string => {
        const valid = validateIdentifier(name, instancePath, label, add);
        if (typeof name !== 'string') {
            return false;
        }
        if (names.has(name)) {
            add('SOC_DUPLICATE_NAME', instancePath, `Duplicate instance name: ${name}.`);
        } else {
            names.set(name, instancePath);
        }
        const macro = name.toUpperCase();
        if (macros.has(macro)) {
            add('SOC_MACRO_COLLISION', instancePath,
                `Instance name ${name} collides with another generated macro name.`);
        } else {
            macros.set(macro, instancePath);
        }
        return valid;
    };

    const recordTopPort = (
        name: string,
        sourcePath: readonly (string | number)[],
    ): void => {
        if (topPorts.has(name)) {
            add('SOC_PORT_COLLISION', sourcePath, `Generated top-level port ${name} is not unique.`);
        } else {
            topPorts.set(name, sourcePath);
        }
    };

    for (let index = 0; index < (config.peripherals?.length ?? 0); index += 1) {
        const peripheral = config.peripherals[index];
        const rootPath: readonly (string | number)[] = ['peripherals', index];
        recordInstanceName(peripheral.name, [...rootPath, 'name'], 'peripheral name');
        const descriptor = catalog.modules.get(peripheral.type);
        if (!descriptor) {
            add('SOC_MODULE_TYPE', [...rootPath, 'type'],
                `Unknown peripheral module type: ${String(peripheral.type)}.`);
            continue;
        }

        const count = (moduleCounts.get(descriptor.type) ?? 0) + 1;
        moduleCounts.set(descriptor.type, count);
        if (!descriptor.multiple && count > 1) {
            add('SOC_MODULE_MULTIPLE', [...rootPath, 'type'],
                `Module type ${descriptor.type} permits only one instance.`);
        }
        if (descriptor.type === 'apb_intc') {
            intcIndices.push(index);
            if (intcIndices.length > 1) {
                add('SOC_INTERRUPT_CONTROLLER_COUNT', [...rootPath, 'type'],
                    'At most one apb_intc instance is allowed.');
            }
        }

        const parameters = validateParameters(peripheral.parameters, descriptor, rootPath, add);
        for (const port of descriptor.ports) {
            if (typeof port.width !== 'number') {
                const width = parameters[port.width.parameter];
                if (!Number.isSafeInteger(width) || (width as number) <= 0) {
                    add('SOC_PORT_WIDTH', [...rootPath, 'parameters', port.width.parameter],
                        `Parameter ${port.width.parameter} must resolve to a positive port width.`);
                }
            }
            if (typeof peripheral.name === 'string') {
                recordTopPort(`${peripheral.name}_${port.name}`, [...rootPath, 'name']);
            }
        }

        const record = { source: peripheral, descriptor, index };
        peripheralRecords.push(record);
        if (typeof peripheral.name === 'string' && !peripheralByName.has(peripheral.name)) {
            peripheralByName.set(peripheral.name, record);
        }
        if (peripheral.baseAddress !== undefined) {
            validateEndpointRange(
                peripheral.baseAddress,
                BigInt(descriptor.addressSize),
                BigInt(descriptor.alignment),
                [...rootPath, 'baseAddress'],
                [...rootPath, 'baseAddress'],
                ranges,
                add,
            );
        }
    }

    for (let index = 0; index < (config.externalInterfaces?.length ?? 0); index += 1) {
        const endpoint = config.externalInterfaces[index];
        const rootPath: readonly (string | number)[] = ['externalInterfaces', index];
        recordInstanceName(endpoint.name, [...rootPath, 'name'], 'external interface name');
        const protocol = catalog.protocols.get(endpoint.type);
        if (!protocol) {
            add('SOC_PROTOCOL_TYPE', [...rootPath, 'type'],
                `Unknown external protocol type: ${String(endpoint.type)}.`);
            continue;
        }
        for (const name of Object.keys(endpoint.parameters ?? {})) {
            add('SOC_PARAMETER', [...rootPath, 'parameters', name],
                `Protocol ${protocol.type} has no user-settable parameter named ${name}.`);
        }

        const widthValid = Number.isSafeInteger(endpoint.addressWidth)
            && endpoint.addressWidth >= 1 && endpoint.addressWidth <= 32;
        if (!widthValid) {
            add('SOC_ENDPOINT_WIDTH', [...rootPath, 'addressWidth'],
                'External addressWidth must be an integer from 1 through 32.');
        }
        let windowSize: bigint | undefined;
        try {
            windowSize = parseByteSize(endpoint.windowSize);
        } catch {
            add('SOC_ADDRESS_RANGE', [...rootPath, 'windowSize'],
                'External windowSize must be a positive byte size.');
        }
        if (widthValid && windowSize !== undefined
            && windowSize > (1n << BigInt(endpoint.addressWidth))) {
            add('SOC_ENDPOINT_WIDTH', [...rootPath, 'addressWidth'],
                'External windowSize exceeds the downstream address port capacity.');
        }

        if (typeof endpoint.name === 'string') {
            for (const port of protocol.ports) {
                recordTopPort(`${endpoint.name}_${port.name}`, [...rootPath, 'name']);
            }
        }
        if (endpoint.baseAddress !== undefined && windowSize !== undefined && widthValid) {
            const alignment = endpoint.addressWidth < 32
                ? 1n << BigInt(endpoint.addressWidth)
                : BigInt(protocol.alignment);
            validateEndpointRange(
                endpoint.baseAddress,
                windowSize,
                alignment,
                [...rootPath, 'baseAddress'],
                [...rootPath, 'windowSize'],
                ranges,
                add,
            );
        }
    }

    reportAddressHoles(ranges, add);
    validateInterrupts(
        config,
        peripheralRecords,
        peripheralByName,
        intcIndices,
        recordTopPort,
        add,
    );
    return diagnostics;
}

function validateIdentifier(
    value: unknown,
    path: readonly (string | number)[],
    label: string,
    add: DiagnosticAdder,
): value is string {
    if (typeof value !== 'string' || !IDENTIFIER.test(value)) {
        add('SOC_IDENTIFIER', path, `${label} must be a legal Verilog identifier.`);
        return false;
    }
    return true;
}

function isSafeOutputDirectory(value: unknown): value is string {
    if (typeof value !== 'string' || value.trim() === ''
        || pathModule.posix.isAbsolute(value) || pathModule.win32.isAbsolute(value)) {
        return false;
    }
    const segments = value.split(/[\\/]+/);
    return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..');
}

function validateMemory(
    value: unknown,
    path: readonly (string | number)[],
    add: DiagnosticAdder,
): void {
    try {
        const size = parseByteSize(value as number | string);
        if (size < 4n || size > MAX_MEMORY_BYTES || size % 4n !== 0n || !isPowerOfTwo(size)) {
            throw new RangeError('invalid memory size');
        }
        const wordCount = size / 4n;
        if (wordCount > (1n << 25n)) {
            throw new RangeError('word address width exceeds 25 bits');
        }
    } catch {
        add('SOC_MEMORY_SIZE', path,
            'Memory size must be a power of two, divisible by four, and no larger than 128 MiB.');
    }
}

function validateParameters(
    suppliedValue: PeripheralSource['parameters'],
    descriptor: ModuleDescriptor,
    rootPath: readonly (string | number)[],
    add: DiagnosticAdder,
): Record<string, number | string | boolean> {
    const supplied = suppliedValue && typeof suppliedValue === 'object' && !Array.isArray(suppliedValue)
        ? suppliedValue
        : {};
    const resolved: Record<string, number | string | boolean> = {};

    for (const name of Object.keys(supplied)) {
        const parameter = descriptor.parameters[name];
        if (!parameter) {
            add('SOC_PARAMETER', [...rootPath, 'parameters', name],
                `Unknown parameter ${name} for ${descriptor.type}.`);
            continue;
        }
        const value = supplied[name];
        if (!parameterValueIsValid(value, parameter)) {
            add('SOC_PARAMETER', [...rootPath, 'parameters', name],
                `Invalid value for parameter ${name}.`);
        }
        resolved[name] = value;
    }
    for (const [name, parameter] of Object.entries(descriptor.parameters)) {
        if (!Object.prototype.hasOwnProperty.call(resolved, name)) {
            resolved[name] = parameter.default;
        }
    }
    return resolved;
}

function parameterValueIsValid(value: unknown, parameter: CatalogParameter): boolean {
    if (parameter.type === 'integer' || parameter.type === 'powerOfTwo') {
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
            return false;
        }
        if (parameter.type === 'powerOfTwo'
            && ((value as number) === 0 || !Number.isInteger(Math.log2(value as number)))) {
            return false;
        }
        return (parameter.minimum === undefined || (value as number) >= parameter.minimum)
            && (parameter.maximum === undefined || (value as number) <= parameter.maximum);
    }
    if (parameter.type === 'boolean') {
        return typeof value === 'boolean';
    }
    if (parameter.type === 'string') {
        return typeof value === 'string';
    }
    return parameter.values?.some((choice) => choice === value) ?? false;
}

function validateEndpointRange(
    addressValue: unknown,
    size: bigint,
    alignment: bigint,
    addressPath: readonly (string | number)[],
    sizePath: readonly (string | number)[],
    ranges: ValidRange[],
    add: DiagnosticAdder,
): void {
    if (typeof addressValue !== 'string' || !HEX_ADDRESS.test(addressValue)) {
        add('SOC_ADDRESS', addressPath, 'Base addresses must be hexadecimal strings.');
        return;
    }
    const base = BigInt(addressValue);
    if (base % alignment !== 0n) {
        add('SOC_ADDRESS_ALIGNMENT', addressPath,
            `Base address must be aligned to ${alignment.toString()} bytes.`);
    }
    const end = base + size - 1n;
    if (end > MAX_U32) {
        add('SOC_ADDRESS_RANGE', sizePath, 'Endpoint range overflows the unsigned 32-bit address space.');
        return;
    }
    if (base < PLB_BASE) {
        add('SOC_ADDRESS_PLB', addressPath, 'Endpoint range must be contained in the PLB region.');
        return;
    }

    for (const previous of ranges) {
        if (base <= previous.end && previous.base <= end) {
            add('SOC_ADDRESS_OVERLAP', addressPath, 'Endpoint range overlaps an earlier endpoint.');
            break;
        }
    }
    ranges.push({ base, end, path: addressPath });
}

function reportAddressHoles(ranges: readonly ValidRange[], add: DiagnosticAdder): void {
    let next = PLB_BASE;
    for (const range of [...ranges].sort((left, right) => left.base < right.base ? -1 : left.base > right.base ? 1 : 0)) {
        if (range.base > next) {
            add('SOC_ADDRESS_HOLE', range.path,
                `Unmapped PLB hole from ${formatHex(next)} through ${formatHex(range.base - 1n)}.`,
                'warning');
        }
        if (range.end >= next) {
            next = range.end + 1n;
        }
    }
}

function validateInterrupts(
    config: SocSourceConfig,
    peripherals: readonly PeripheralRecord[],
    peripheralByName: ReadonlyMap<string, PeripheralRecord>,
    intcIndices: readonly number[],
    recordTopPort: (name: string, path: readonly (string | number)[]) => void,
    add: DiagnosticAdder,
): void {
    const usedSources = new Set<string>();
    const externalPorts = new Set<string>();
    const externalMacros = new Map<string, string>();

    const validateSource = (
        source: unknown,
        path: readonly (string | number)[],
        forbidControllerOutput: boolean,
    ): source is string => {
        if (typeof source !== 'string') {
            add('SOC_IRQ_SOURCE', path, 'Interrupt source must be a source reference.');
            return false;
        }
        const external = /^external\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(source);
        if (external) {
            const identifier = external[1];
            if (!externalPorts.has(identifier)) {
                recordTopPort(`external_${identifier}`, path);
                externalPorts.add(identifier);
            }
            const macro = identifier.toUpperCase();
            const existing = externalMacros.get(macro);
            if (existing !== undefined && existing !== identifier) {
                add('SOC_MACRO_COLLISION', path,
                    `External interrupt ${identifier} collides with another generated macro name.`);
            } else {
                externalMacros.set(macro, identifier);
            }
            return true;
        }
        const peripheral = /^([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(source);
        if (!peripheral) {
            add('SOC_IRQ_SOURCE', path,
                'Interrupt source must be <instance>.<catalogInterrupt> or external.<identifier>.');
            return false;
        }
        const record = peripheralByName.get(peripheral[1]);
        if (!record || !record.descriptor.interrupts.includes(peripheral[2])
            || (forbidControllerOutput && record.descriptor.type === 'apb_intc')) {
            add('SOC_IRQ_SOURCE', path, `Unknown or invalid interrupt source: ${source}.`);
            return false;
        }
        return true;
    };

    const interrupt = config.interrupt as SocSourceConfig['interrupt'];
    if (interrupt.mode === 'direct') {
        if (validateSource(interrupt.source, ['interrupt', 'source'], false)) {
            usedSources.add(interrupt.source);
        }
    } else if (interrupt.mode === 'controller') {
        const controller = peripheralByName.get(interrupt.controller);
        if (intcIndices.length !== 1 || !controller || controller.descriptor.type !== 'apb_intc') {
            add('SOC_IRQ_CONTROLLER', ['interrupt', 'controller'],
                'Controller mode requires the single apb_intc instance by name.');
        }
        if (!Array.isArray(interrupt.sources) || interrupt.sources.length < 1
            || interrupt.sources.length > 32) {
            add('SOC_IRQ_COUNT', ['interrupt', 'sources'],
                'Controller mode requires from 1 through 32 sources.');
        }
        const sourceNames = new Set<string>();
        const ids = new Set<number>();
        for (let index = 0; index < (interrupt.sources?.length ?? 0); index += 1) {
            const source = interrupt.sources[index];
            const rootPath: readonly (string | number)[] = ['interrupt', 'sources', index];
            const sourceValid = validateSource(source.source, [...rootPath, 'source'], true);
            if (typeof source.source === 'string') {
                if (sourceNames.has(source.source)) {
                    add('SOC_IRQ_SOURCE_DUPLICATE', [...rootPath, 'source'],
                        `Interrupt source ${source.source} is assigned more than once.`);
                } else {
                    sourceNames.add(source.source);
                }
                if (sourceValid) {
                    usedSources.add(source.source);
                }
            }
            if (!Number.isSafeInteger(source.id) || source.id < 0 || source.id > 31) {
                add('SOC_IRQ_ID', [...rootPath, 'id'], 'Interrupt IDs must be integers from 0 through 31.');
            } else if (ids.has(source.id)) {
                add('SOC_IRQ_ID_DUPLICATE', [...rootPath, 'id'],
                    `Interrupt ID ${source.id} is assigned more than once.`);
            } else {
                ids.add(source.id);
            }
            if (!IRQ_TRIGGERS.has(source.trigger)) {
                add('SOC_IRQ_TRIGGER', [...rootPath, 'trigger'],
                    'Interrupt trigger must be high, low, rising, or falling.');
            }
        }
    } else if (interrupt.mode !== 'none') {
        add('SOC_INTERRUPT_MODE', ['interrupt', 'mode'], 'Interrupt mode must be none, direct, or controller.');
    }

    for (const record of peripherals) {
        if (record.descriptor.type === 'apb_intc') {
            continue;
        }
        for (const interruptName of record.descriptor.interrupts) {
            const qualified = `${record.source.name}.${interruptName}`;
            if (!usedSources.has(qualified)) {
                add('SOC_IRQ_UNCONNECTED', ['peripherals', record.index, 'name'],
                    `Peripheral interrupt ${qualified} is unconnected.`, 'warning');
            }
        }
    }
}

function isPowerOfTwo(value: bigint): boolean {
    return value > 0n && (value & (value - 1n)) === 0n;
}

function formatHex(value: bigint): string {
    return `0x${value.toString(16).padStart(8, '0')}`;
}

type DiagnosticAdder = (
    code: string,
    path: readonly (string | number)[],
    message: string,
    severity?: SocDiagnostic['severity'],
) => void;
