import * as fs from 'fs';
import * as path from 'path';

import {
    CatalogParameter,
    CatalogPort,
    CatalogParameterType,
    ModuleCatalog,
    ModuleDescriptor,
    ProtocolDescriptor,
} from './model';

type JsonObject = Record<string, unknown>;

const MODULE_FIELDS = new Set([
    'type', 'module', 'rtlFiles', 'multiple', 'addressSize', 'alignment',
    'parameters', 'ports', 'interrupts',
]);
const PROTOCOL_FIELDS = new Set([
    'type', 'rtlFiles', 'alignment', 'addressWidthParameter', 'ports',
]);
const PARAMETER_FIELDS = new Set(['type', 'default', 'minimum', 'maximum', 'values']);
const PORT_FIELDS = new Set(['name', 'direction', 'width']);
const WIDTH_FIELDS = new Set(['parameter']);
const PARAMETER_TYPES = new Set<CatalogParameterType>([
    'integer', 'boolean', 'string', 'enum', 'powerOfTwo',
]);
const DIRECTIONS = new Set(['input', 'output', 'inout']);
const PROTOCOL_TYPES = new Set(['local_bus', 'apb', 'axi4_lite', 'wishbone', 'avalon', 'drp']);

export function loadCatalog(assetRoot: string): ModuleCatalog {
    const modulesDirectory = resolveAssetPath(assetRoot, 'catalog/modules');
    if (!directoryExistsWithExactCase(assetRoot, 'catalog/modules')) {
        throw new Error(`Missing catalog module directory: ${modulesDirectory}`);
    }
    const moduleFiles = fs.readdirSync(modulesDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));
    const modules = new Map<string, ModuleDescriptor>();
    for (const fileName of moduleFiles) {
        const logicalPath = `catalog/modules/${fileName}`;
        const module = parseModule(readJson(resolveAssetPath(assetRoot, logicalPath), logicalPath), assetRoot);
        if (modules.has(module.type)) {
            throw new Error(`Duplicate module type: ${module.type}`);
        }
        modules.set(module.type, module);
    }

    const protocolsPath = resolveAssetPath(assetRoot, 'catalog/protocols.json');
    const protocolsData = readJson(protocolsPath, 'catalog/protocols.json');
    if (!Array.isArray(protocolsData)) {
        throw new Error('catalog/protocols.json must contain an array');
    }
    const protocols = new Map<string, ProtocolDescriptor>();
    for (const data of protocolsData) {
        const protocol = parseProtocol(data, assetRoot);
        if (protocols.has(protocol.type)) {
            throw new Error(`Duplicate protocol type: ${protocol.type}`);
        }
        protocols.set(protocol.type, protocol);
    }
    for (const type of PROTOCOL_TYPES) {
        if (!protocols.has(type)) {
            throw new Error(`Missing required protocol type: ${type}`);
        }
    }

    return Object.freeze({
        modules: immutableMap(modules),
        protocols: immutableMap(protocols),
    });
}

export function getModule(catalog: ModuleCatalog, type: string): ModuleDescriptor {
    const descriptor = catalog.modules.get(type);
    if (!descriptor) {
        throw new Error(`Unknown module type: ${type}`);
    }
    return descriptor;
}

export function getProtocol(catalog: ModuleCatalog, type: string): ProtocolDescriptor {
    const descriptor = catalog.protocols.get(type);
    if (!descriptor) {
        throw new Error(`Unknown protocol type: ${type}`);
    }
    return descriptor;
}

function parseModule(value: unknown, assetRoot: string): ModuleDescriptor {
    const source = asObject(value, 'module descriptor');
    rejectUnknownFields(source, MODULE_FIELDS, 'module descriptor');
    const parameters = parseParameters(source.parameters);
    const ports = parsePorts(source.ports, parameters);
    const descriptor: ModuleDescriptor = {
        type: asIdentifier(source.type, 'module type'),
        module: asIdentifier(source.module, 'module name'),
        rtlFiles: parseRtlFiles(source.rtlFiles, assetRoot),
        multiple: asBoolean(source.multiple, 'multiple'),
        addressSize: asPositiveInteger(source.addressSize, 'addressSize'),
        alignment: asPositiveInteger(source.alignment, 'alignment'),
        parameters,
        ports,
        interrupts: parseIdentifiers(source.interrupts, 'interrupt'),
    };
    if (!isPowerOfTwo(descriptor.addressSize) || !isPowerOfTwo(descriptor.alignment)) {
        throw new Error(`Module ${descriptor.type} addressSize and alignment must be powers of two`);
    }
    if (descriptor.addressSize !== descriptor.alignment) {
        throw new Error(`Module ${descriptor.type} addressSize must equal alignment`);
    }
    return freezeModule(descriptor);
}

function parseProtocol(value: unknown, assetRoot: string): ProtocolDescriptor {
    const source = asObject(value, 'protocol descriptor');
    rejectUnknownFields(source, PROTOCOL_FIELDS, 'protocol descriptor');
    const type = asIdentifier(source.type, 'protocol type');
    if (!PROTOCOL_TYPES.has(type)) {
        throw new Error(`Unknown protocol type: ${type}`);
    }
    if (type === 'local_bus' && source.addressWidthParameter !== undefined) {
        throw new Error('local_bus must not define addressWidthParameter');
    }
    if (type !== 'local_bus' && typeof source.addressWidthParameter !== 'string') {
        throw new Error(`Protocol ${type} must define addressWidthParameter`);
    }
    const addressWidthParameter = source.addressWidthParameter === undefined
        ? undefined
        : asIdentifier(source.addressWidthParameter, 'addressWidthParameter');
    const descriptor: ProtocolDescriptor = {
        type: type as ProtocolDescriptor['type'],
        rtlFiles: parseRtlFiles(source.rtlFiles, assetRoot),
        alignment: asPositiveInteger(source.alignment, 'alignment'),
        ...(addressWidthParameter === undefined ? {} : { addressWidthParameter }),
        ports: parsePorts(source.ports, addressWidthParameter === undefined
            ? {} : { [addressWidthParameter]: { type: 'integer', default: 1 } }),
    };
    if (!isPowerOfTwo(descriptor.alignment)) {
        throw new Error(`Protocol ${type} alignment must be a power of two`);
    }
    return Object.freeze({
        ...descriptor,
        rtlFiles: Object.freeze([...descriptor.rtlFiles]),
        ports: Object.freeze([...descriptor.ports]),
    });
}

function parseParameters(value: unknown): Readonly<Record<string, CatalogParameter>> {
    const source = asObject(value, 'parameters');
    const result: Record<string, CatalogParameter> = {};
    for (const [name, data] of Object.entries(source)) {
        const parameter = asObject(data, `parameter ${name}`);
        rejectUnknownFields(parameter, PARAMETER_FIELDS, `parameter ${name}`);
        const type = asString(parameter.type, `parameter ${name}.type`) as CatalogParameterType;
        if (!PARAMETER_TYPES.has(type)) {
            throw new Error(`Invalid parameter type for ${name}: ${type}`);
        }
        const defaultValue = parameter.default;
        validateParameterValue(name, type, defaultValue, parameter.minimum, parameter.maximum, parameter.values);
        const resultParameter: CatalogParameter = {
            type,
            default: defaultValue as number | string | boolean,
            ...(parameter.minimum === undefined ? {} : { minimum: asPositiveOrZeroInteger(parameter.minimum, `${name}.minimum`) }),
            ...(parameter.maximum === undefined ? {} : { maximum: asPositiveOrZeroInteger(parameter.maximum, `${name}.maximum`) }),
            ...(parameter.values === undefined ? {} : { values: parseValues(parameter.values, name) }),
        };
        if (resultParameter.minimum !== undefined && resultParameter.maximum !== undefined
            && resultParameter.minimum > resultParameter.maximum) {
            throw new Error(`Parameter ${name} minimum exceeds maximum`);
        }
        result[name] = Object.freeze(resultParameter);
    }
    return Object.freeze(result);
}

function validateParameterValue(
    name: string,
    type: CatalogParameterType,
    value: unknown,
    minimum: unknown,
    maximum: unknown,
    values: unknown,
): void {
    if (type === 'integer' || type === 'powerOfTwo') {
        if (!Number.isSafeInteger(value) || (value as number) < 0) {
            throw new Error(`Parameter ${name} default must be a non-negative integer`);
        }
        if (type === 'powerOfTwo' && !isPowerOfTwo(value as number)) {
            throw new Error(`Parameter ${name} default must be a power of two`);
        }
        if (minimum !== undefined && (value as number) < asPositiveOrZeroInteger(minimum, `${name}.minimum`)) {
            throw new Error(`Parameter ${name} default is below minimum`);
        }
        if (maximum !== undefined && (value as number) > asPositiveOrZeroInteger(maximum, `${name}.maximum`)) {
            throw new Error(`Parameter ${name} default is above maximum`);
        }
    } else if (type === 'boolean') {
        if (typeof value !== 'boolean') {
            throw new Error(`Parameter ${name} default must be a boolean`);
        }
    } else if (type === 'string') {
        if (typeof value !== 'string') {
            throw new Error(`Parameter ${name} default must be a string`);
        }
    } else {
        const choices = parseValues(values, name);
        if (!choices.some((candidate) => candidate === value)) {
            throw new Error(`Parameter ${name} default must be one of values`);
        }
    }
}

function parsePorts(value: unknown, parameters: Readonly<Record<string, CatalogParameter>>): readonly CatalogPort[] {
    if (!Array.isArray(value)) {
        throw new Error('ports must be an array');
    }
    const names = new Set<string>();
    const ports = value.map((item): CatalogPort => {
        const source = asObject(item, 'port');
        rejectUnknownFields(source, PORT_FIELDS, 'port');
        const name = asIdentifier(source.name, 'port name');
        if (names.has(name)) {
            throw new Error(`Duplicate port name: ${name}`);
        }
        names.add(name);
        const direction = asString(source.direction, `port ${name}.direction`);
        if (!DIRECTIONS.has(direction)) {
            throw new Error(`Invalid port direction for ${name}: ${direction}`);
        }
        return Object.freeze({
            name,
            direction: direction as CatalogPort['direction'],
            width: parseWidth(source.width, parameters),
        });
    });
    return Object.freeze(ports);
}

function parseWidth(value: unknown, parameters: Readonly<Record<string, CatalogParameter>>): CatalogPort['width'] {
    if (Number.isSafeInteger(value) && (value as number) > 0) {
        return value as number;
    }
    const source = asObject(value, 'port width');
    rejectUnknownFields(source, WIDTH_FIELDS, 'port width');
    const parameter = asIdentifier(source.parameter, 'dynamic width parameter');
    if (!Object.prototype.hasOwnProperty.call(parameters, parameter)) {
        throw new Error(`Unknown parameter for dynamic port width: ${parameter}`);
    }
    return Object.freeze({ parameter });
}

function parseRtlFiles(value: unknown, assetRoot: string): readonly string[] {
    if (!Array.isArray(value)) {
        throw new Error('rtlFiles must be an array');
    }
    const files = value.map((item) => {
        const logicalPath = asString(item, 'RTL path');
        if (!logicalPath.startsWith('rtl/') || path.isAbsolute(logicalPath)
            || logicalPath.split(/[\\/]+/).some((part) => part === '..')) {
            throw new Error(`RTL path must be asset-relative under rtl/: ${logicalPath}`);
        }
        resolveAssetPath(assetRoot, logicalPath);
        if (!fileExistsWithExactCase(assetRoot, logicalPath)) {
            throw new Error(`Missing RTL file or case mismatch: ${logicalPath}`);
        }
        return logicalPath;
    });
    return Object.freeze(files);
}

function parseIdentifiers(value: unknown, label: string): readonly string[] {
    if (!Array.isArray(value)) {
        throw new Error(`${label}s must be an array`);
    }
    const names = new Set<string>();
    for (const item of value) {
        const name = asIdentifier(item, label);
        if (names.has(name)) {
            throw new Error(`Duplicate ${label}: ${name}`);
        }
        names.add(name);
    }
    return Object.freeze([...names]);
}

function parseValues(value: unknown, name: string): readonly (number | string | boolean)[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`Parameter ${name} values must be a non-empty array`);
    }
    for (const item of value) {
        if (typeof item !== 'number' && typeof item !== 'string' && typeof item !== 'boolean') {
            throw new Error(`Parameter ${name} values must be scalar`);
        }
    }
    return Object.freeze([...value] as (number | string | boolean)[]);
}

function readJson(file: string, logicalPath: string): unknown {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (error) {
        throw new Error(`Invalid JSON in ${logicalPath}: ${(error as Error).message}`);
    }
}

function resolveAssetPath(assetRoot: string, logicalPath: string): string {
    if (path.isAbsolute(logicalPath) || logicalPath.split(/[\\/]+/).some((part) => part === '..')) {
        throw new Error(`Asset path must be relative without traversal: ${logicalPath}`);
    }
    return path.join(assetRoot, ...logicalPath.split('/'));
}

function fileExistsWithExactCase(assetRoot: string, logicalPath: string): boolean {
    const target = resolveAssetPath(assetRoot, logicalPath);
    return fs.existsSync(target) && pathHasExactCase(assetRoot, logicalPath) && fs.statSync(target).isFile();
}

function directoryExistsWithExactCase(assetRoot: string, logicalPath: string): boolean {
    const target = resolveAssetPath(assetRoot, logicalPath);
    return fs.existsSync(target) && pathHasExactCase(assetRoot, logicalPath) && fs.statSync(target).isDirectory();
}

function pathHasExactCase(assetRoot: string, logicalPath: string): boolean {
    let current = assetRoot;
    for (const component of logicalPath.split('/')) {
        const entries = fs.readdirSync(current, { withFileTypes: true });
        if (!entries.some((entry) => entry.name === component)) {
            return false;
        }
        current = path.join(current, component);
    }
    return true;
}

function freezeModule(descriptor: ModuleDescriptor): ModuleDescriptor {
    return Object.freeze({
        ...descriptor,
        rtlFiles: Object.freeze([...descriptor.rtlFiles]),
        parameters: Object.freeze({ ...descriptor.parameters }),
        ports: Object.freeze([...descriptor.ports]),
        interrupts: Object.freeze([...descriptor.interrupts]),
    });
}

function immutableMap<Key, Value>(source: Map<Key, Value>): ReadonlyMap<Key, Value> {
    const map = new Map(source);
    const readonly: ReadonlyMap<Key, Value> = {
        get size(): number { return map.size; },
        get: map.get.bind(map),
        has: map.has.bind(map),
        entries: map.entries.bind(map),
        keys: map.keys.bind(map),
        values: map.values.bind(map),
        forEach: map.forEach.bind(map),
        [Symbol.iterator]: map[Symbol.iterator].bind(map),
    };
    return Object.freeze(readonly);
}

function rejectUnknownFields(object: JsonObject, allowed: ReadonlySet<string>, label: string): void {
    for (const key of Object.keys(object)) {
        if (!allowed.has(key)) {
            throw new Error(`Unknown field in ${label}: ${key}`);
        }
    }
}

function asObject(value: unknown, label: string): JsonObject {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new Error(`${label} must be an object`);
    }
    return value as JsonObject;
}

function asString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string`);
    }
    return value;
}

function asIdentifier(value: unknown, label: string): string {
    const identifier = asString(value, label);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(identifier)) {
        throw new Error(`${label} must be a Verilog identifier: ${identifier}`);
    }
    return identifier;
}

function asBoolean(value: unknown, label: string): boolean {
    if (typeof value !== 'boolean') {
        throw new Error(`${label} must be a boolean`);
    }
    return value;
}

function asPositiveInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) <= 0) {
        throw new Error(`${label} must be a positive integer`);
    }
    return value as number;
}

function asPositiveOrZeroInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value) || (value as number) < 0) {
        throw new Error(`${label} must be a non-negative integer`);
    }
    return value as number;
}

function isPowerOfTwo(value: number): boolean {
    return Number.isSafeInteger(value) && value > 0 && Math.log2(value) % 1 === 0;
}
