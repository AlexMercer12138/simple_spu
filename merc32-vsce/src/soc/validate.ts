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
const VERILOG_RESERVED_WORDS = new Set([
    'always', 'and', 'assign', 'automatic', 'begin', 'buf', 'bufif0', 'bufif1',
    'case', 'casex', 'casez', 'cell', 'cmos', 'config', 'deassign', 'default',
    'defparam', 'design', 'disable', 'edge', 'else', 'end', 'endcase',
    'endconfig', 'endfunction', 'endgenerate', 'endmodule', 'endprimitive',
    'endspecify', 'endtable', 'endtask', 'event', 'for', 'force', 'forever',
    'fork', 'function', 'generate', 'genvar', 'highz0', 'highz1', 'if',
    'ifnone', 'incdir', 'include', 'initial', 'inout', 'input', 'instance',
    'integer', 'join', 'large', 'liblist', 'library', 'localparam',
    'macromodule', 'medium', 'module', 'nand', 'negedge', 'nmos', 'nor',
    'noshowcancelled', 'not', 'notif0', 'notif1', 'or', 'output', 'parameter',
    'pmos', 'posedge', 'primitive', 'pull0', 'pull1', 'pulldown', 'pullup',
    'pulsestyle_ondetect', 'pulsestyle_onevent', 'rcmos', 'real', 'realtime',
    'reg', 'release', 'repeat', 'rnmos', 'rpmos', 'rtran', 'rtranif0',
    'rtranif1', 'scalared', 'showcancelled', 'signed', 'small', 'specify',
    'specparam', 'strong0', 'strong1', 'supply0', 'supply1', 'table', 'task',
    'time', 'tran', 'tranif0', 'tranif1', 'tri', 'tri0', 'tri1', 'triand',
    'trior', 'trireg', 'unsigned', 'use', 'uwire', 'vectored', 'wait', 'wand', 'weak0',
    'weak1', 'while', 'wire', 'wor', 'xnor', 'xor',
]);
const FIXED_PACKAGED_MODULES = new Set([
    'MERC32_top', 'merc32_core', 'div', 'mul', 'jtag_debug', 'spram',
    'lb2apb', 'lb2axi_lite', 'lb2wbc', 'lb2avalon', 'lb2drp',
]);

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

    const projectNameValid = validateIdentifier(
        config.project?.name, ['project', 'name'], 'project name', add);
    if (projectNameValid) {
        validateGeneratedModuleNames(config, catalog, add);
    }
    if (!isSafeOutputDirectory(config.project?.outputDir)) {
        add('SOC_PROJECT_OUTPUT', ['project', 'outputDir'],
            'Project outputDir must be a non-empty relative path without a root, drive, dot, or parent segment.');
    }
    validateMemory(config.memory?.ilb?.size, ['memory', 'ilb', 'size'], add);
    validateMemory(config.memory?.dlb?.size, ['memory', 'dlb', 'size'], add);

    const names = new Map<string, readonly (string | number)[]>();
    const macros = new Map<string, readonly (string | number)[]>();
    const headerMacros = new Map<string, readonly (string | number)[]>();
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

    const recordHeaderMacro = (
        name: string,
        sourcePath: readonly (string | number)[],
    ): void => {
        if (headerMacros.has(name)) {
            add('SOC_MACRO_COLLISION', sourcePath,
                `Generated C macro ${name} collides with another generated macro name.`);
        } else {
            headerMacros.set(name, sourcePath);
        }
    };
    if (projectNameValid) {
        reserveGeneratedHeaderMacros(config, recordHeaderMacro);
    }

    for (let index = 0; index < (config.peripherals?.length ?? 0); index += 1) {
        const peripheral = config.peripherals[index];
        const rootPath: readonly (string | number)[] = ['peripherals', index];
        recordInstanceName(peripheral.name, [...rootPath, 'name'], 'peripheral name');
        if (projectNameValid && typeof peripheral.name === 'string') {
            recordEndpointHeaderMacros(config.project.name, peripheral.name,
                [...rootPath, 'name'], recordHeaderMacro);
        }
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
        if (projectNameValid && typeof endpoint.name === 'string') {
            recordEndpointHeaderMacros(config.project.name, endpoint.name,
                [...rootPath, 'name'], recordHeaderMacro);
        }
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
        recordHeaderMacro,
        projectNameValid,
        add,
    );
    validateGeneratedVerilogSymbols(config, catalog, add);
    return diagnostics;
}

function validateGeneratedModuleNames(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    add: DiagnosticAdder,
): void {
    const projectName = config.project.name;
    if (VERILOG_RESERVED_WORDS.has(projectName)) {
        add('SOC_VERILOG_RESERVED', ['project', 'name'],
            `Project module name ${projectName} is a Verilog-2005 reserved word.`);
        return;
    }
    const packagedModules = new Set(FIXED_PACKAGED_MODULES);
    for (const descriptor of catalog.modules.values()) {
        packagedModules.add(descriptor.module);
    }
    const generatedModules = [projectName, `${projectName}_plb_router`];
    if ((config.peripherals?.length ?? 0) > 0) {
        generatedModules.push(`${projectName}_apb_interconnect`);
    }
    const collision = generatedModules.find((name) => packagedModules.has(name));
    if (collision !== undefined) {
        add('SOC_VERILOG_MODULE_COLLISION', ['project', 'name'],
            `Generated module name ${collision} collides with a packaged RTL module.`);
    }
}

function reserveGeneratedHeaderMacros(
    config: SocSourceConfig,
    record: (name: string, sourcePath: readonly (string | number)[]) => void,
): void {
    const project = config.project.name.toUpperCase();
    const projectPath: readonly (string | number)[] = ['project', 'name'];
    record(`${project}_H`, projectPath);
    for (const [name, memory] of [['ILB', config.memory.ilb], ['DLB', config.memory.dlb]] as const) {
        for (const suffix of ['BASE', 'SIZE', 'END']) {
            record(`${project}_${name}_${suffix}`, projectPath);
        }
        const type = memory.type === 'internal_ram' ? 'INTERNAL_RAM' : 'EXTERNAL_LOCAL_BUS';
        record(`${project}_FEATURE_${name}_${type}`, projectPath);
    }
    record(`${project}_FEATURE_DEBUG`, projectPath);
    for (const trigger of ['HIGH', 'LOW', 'RISING', 'FALLING']) {
        record(`MERC32_IRQ_TRIGGER_${trigger}`, projectPath);
    }
}

function recordEndpointHeaderMacros(
    projectName: string,
    instanceName: string,
    sourcePath: readonly (string | number)[],
    record: (name: string, sourcePath: readonly (string | number)[]) => void,
): void {
    const prefix = `${projectName.toUpperCase()}_${instanceName.toUpperCase()}`;
    for (const suffix of ['BASE', 'SIZE', 'END']) {
        record(`${prefix}_${suffix}`, sourcePath);
    }
    record(`${projectName.toUpperCase()}_FEATURE_${instanceName.toUpperCase()}`, sourcePath);
}

function validateGeneratedVerilogSymbols(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    add: DiagnosticAdder,
): void {
    type ScopeName = 'top' | 'router' | 'APB interconnect';
    const scopes: Record<ScopeName, Map<string, string>> = {
        top: new Map(),
        router: new Map(),
        'APB interconnect': new Map(),
    };
    const reportedPaths = new Set<string>();
    const reserve = (scope: ScopeName, names: readonly string[]): void => {
        for (const name of names) {
            scopes[scope].set(name, 'internal generator symbol');
        }
    };
    const record = (
        scope: ScopeName,
        names: readonly string[],
        sourcePath: readonly (string | number)[],
    ): void => {
        const pathKey = JSON.stringify(sourcePath);
        for (const name of names) {
            const existing = scopes[scope].get(name);
            if (existing !== undefined && !reportedPaths.has(pathKey)) {
                add('SOC_VERILOG_SYMBOL_COLLISION', sourcePath,
                    `Generated Verilog symbol ${name} collides in the ${scope} module.`);
                reportedPaths.add(pathKey);
            } else if (existing === undefined) {
                scopes[scope].set(name, pathKey);
            }
        }
    };

    reserve('top', [
        'clk', 'rst_n', 'cpu_inst', 'plb_router_inst',
        'cpu_ilb_rden', 'cpu_ilb_wren', 'cpu_ilb_addr', 'cpu_ilb_strb',
        'cpu_ilb_wdata', 'cpu_ilb_rdata', 'cpu_ilb_ack',
        'cpu_dlb_rden', 'cpu_dlb_wren', 'cpu_dlb_addr', 'cpu_dlb_strb',
        'cpu_dlb_wdata', 'cpu_dlb_rdata', 'cpu_dlb_ack',
        'cpu_plb_rden', 'cpu_plb_wren', 'cpu_plb_addr', 'cpu_plb_strb',
        'cpu_plb_wdata', 'cpu_plb_rdata', 'cpu_plb_ack',
    ]);
    if (config.cpu?.debug ?? false) {
        reserve('top', ['tck', 'tms', 'tdi', 'tdo']);
    } else {
        reserve('top', ['cpu_tdo_unused']);
    }
    for (const prefix of ['ilb', 'dlb'] as const) {
        if (config.memory?.[prefix]?.type === 'internal_ram') {
            reserve('top', [`${prefix}_ram_inst`]);
        } else {
            reserve('top', [
                `${prefix}_rden`, `${prefix}_wren`, `${prefix}_addr`,
                `${prefix}_strb`, `${prefix}_wdata`, `${prefix}_rdata`, `${prefix}_ack`,
            ]);
        }
    }
    if ((config.peripherals?.length ?? 0) > 0) {
        reserve('top', [
            'builtin_apb_lb_rden', 'builtin_apb_lb_wren',
            'builtin_apb_lb_rdata', 'builtin_apb_lb_valid',
            'builtin_apb_psel', 'builtin_apb_penable', 'builtin_apb_paddr',
            'builtin_apb_pwrite', 'builtin_apb_pwdata', 'builtin_apb_pstrb',
            'builtin_apb_prdata', 'builtin_apb_pready',
            'builtin_apb_bridge_inst', 'apb_interconnect_inst',
            'builtin_apb_router_rden', 'builtin_apb_router_wren',
            'builtin_apb_router_addr', 'builtin_apb_router_strb',
            'builtin_apb_router_wdata', 'builtin_apb_router_rdata',
            'builtin_apb_router_ack',
        ]);
        reserve('router', [
            'builtin_apb_rden', 'builtin_apb_wren', 'builtin_apb_addr',
            'builtin_apb_strb', 'builtin_apb_wdata', 'builtin_apb_rdata',
            'builtin_apb_ack', 'ENDPOINT_TARGET_BUILTIN_APB',
        ]);
    }
    reserve('router', [
        'clk', 'rst_n', 'm_rden', 'm_wren', 'm_addr', 'm_strb', 'm_wdata',
        'm_rdata', 'm_ack', 'ACTIVE_WIDTH', 'ENDPOINT_NONE', 'active_endpoint',
        'decoded_endpoint', 'response_rdata', 'response_ack', 'start_request',
    ]);
    reserve('APB interconnect', [
        'm_psel', 'm_penable', 'm_paddr', 'm_prdata', 'm_pready',
        'response_rdata', 'response_ready',
    ]);

    const recordExternalRouterTargetSymbols = (
        name: unknown,
        sourcePath: readonly (string | number)[],
    ): void => {
        if (typeof name !== 'string' || !IDENTIFIER.test(name)) {
            return;
        }
        record('top', [
            `${name}_router_rden`, `${name}_router_wren`, `${name}_router_addr`,
            `${name}_router_strb`, `${name}_router_wdata`, `${name}_router_rdata`,
            `${name}_router_ack`,
        ], sourcePath);
        record('router', [
            `${name}_rden`, `${name}_wren`, `${name}_addr`, `${name}_strb`,
            `${name}_wdata`, `${name}_rdata`, `${name}_ack`,
            `ENDPOINT_TARGET_${name.toUpperCase()}`,
        ], sourcePath);
    };

    for (let index = 0; index < (config.peripherals?.length ?? 0); index += 1) {
        const peripheral = config.peripherals[index];
        const sourcePath: readonly (string | number)[] = ['peripherals', index, 'name'];
        if (typeof peripheral.name !== 'string' || !IDENTIFIER.test(peripheral.name)) {
            continue;
        }
        const name = peripheral.name;
        record('top', [
            `${name}_psel`, `${name}_pready`, `${name}_pslverr`,
            `${name}_prdata`, `${name}_interrupt`, `${name}_inst`,
        ], sourcePath);
        record('APB interconnect', [
            `${name}_psel`, `${name}_prdata`, `${name}_pready`,
        ], sourcePath);
        const descriptor = catalog.modules.get(peripheral.type);
        if (descriptor !== undefined) {
            record('top', descriptor.ports.map((port) => `${name}_${port.name}`), sourcePath);
            if (descriptor.type === 'apb_intc') {
                record('top', [`${name}_irq_sources`], sourcePath);
            }
        }
    }

    for (let index = 0; index < (config.externalInterfaces?.length ?? 0); index += 1) {
        const endpoint = config.externalInterfaces[index];
        const sourcePath: readonly (string | number)[] = ['externalInterfaces', index, 'name'];
        if (typeof endpoint.name !== 'string' || !IDENTIFIER.test(endpoint.name)) {
            continue;
        }
        const name = endpoint.name;
        recordExternalRouterTargetSymbols(name, sourcePath);
        const protocol = catalog.protocols.get(endpoint.type);
        if (protocol !== undefined) {
            record('top', protocol.ports.map((port) => `${name}_${port.name}`), sourcePath);
        }
        if (endpoint.type !== 'local_bus') {
            record('top', [
                `${name}_bridge_rdata`, `${name}_bridge_valid`, `${name}_inst`,
            ], sourcePath);
        }
    }

    const interrupt = config.interrupt;
    const sources = interrupt?.mode === 'direct'
        ? [{ source: interrupt.source, trigger: undefined, path: ['interrupt', 'source'] as const }]
        : interrupt?.mode === 'controller'
            ? (interrupt.sources ?? []).map((source, index) => ({
                source: source.source,
                trigger: source.trigger,
                path: ['interrupt', 'sources', index, 'source'] as const,
            }))
            : [];
    let externalOccurrence = 0;
    for (const source of sources) {
        const match = typeof source.source === 'string'
            ? /^external\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(source.source)
            : null;
        if (match === null) {
            continue;
        }
        const port = `external_interrupt${externalOccurrence++}`;
        record('top', [port], source.path);
        if (interrupt.mode === 'controller') {
            const names = [
                `${port}_meta`, `${port}_sync`, `${port}_history_valid`,
                `${port}_conditioned`,
            ];
            if (source.trigger === 'rising' || source.trigger === 'falling') {
                names.push(`${port}_armed`);
            }
            record('top', names, source.path);
        }
    }
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
        || pathModule.posix.isAbsolute(value) || pathModule.win32.parse(value).root !== '') {
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
        if (size < 8n || size > MAX_MEMORY_BYTES || size % 4n !== 0n || !isPowerOfTwo(size)) {
            throw new RangeError('invalid memory size');
        }
        const wordCount = size / 4n;
        if (wordCount > (1n << 25n)) {
            throw new RangeError('word address width exceeds 25 bits');
        }
    } catch {
        add('SOC_MEMORY_SIZE', path,
            'Memory size must be a power of two from 8 bytes through 128 MiB.');
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
    recordHeaderMacro: (name: string, path: readonly (string | number)[]) => void,
    projectNameValid: boolean,
    add: DiagnosticAdder,
): void {
    const usedSources = new Set<string>();

    const validateSource = (
        source: unknown,
        path: readonly (string | number)[],
        forbidControllerOutput: boolean,
        externalOccurrence: number,
    ): source is string => {
        if (typeof source !== 'string') {
            add('SOC_IRQ_SOURCE', path, 'Interrupt source must be a source reference.');
            return false;
        }
        const external = /^external\.([A-Za-z_][A-Za-z0-9_]*)$/.exec(source);
        if (external) {
            recordTopPort(`external_interrupt${externalOccurrence}`, path);
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
        if (validateSource(interrupt.source, ['interrupt', 'source'], false, 0)) {
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
        let externalOccurrence = 0;
        for (let index = 0; index < (interrupt.sources?.length ?? 0); index += 1) {
            const source = interrupt.sources[index];
            const rootPath: readonly (string | number)[] = ['interrupt', 'sources', index];
            const external = typeof source.source === 'string'
                && /^external\.[A-Za-z_][A-Za-z0-9_]*$/.test(source.source);
            const routeExternalOccurrence = external ? externalOccurrence++ : 0;
            const sourceValid = validateSource(
                source.source, [...rootPath, 'source'], true, routeExternalOccurrence);
            if (typeof source.source === 'string') {
                if (!external && sourceNames.has(source.source)) {
                    add('SOC_IRQ_SOURCE_DUPLICATE', [...rootPath, 'source'],
                        `Interrupt source ${source.source} is assigned more than once.`);
                } else if (!external) {
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
            if (projectNameValid && sourceValid && Number.isSafeInteger(source.id)
                && source.id >= 0 && source.id <= 31 && IRQ_TRIGGERS.has(source.trigger)) {
                const instance = external
                    ? `external_interrupt${routeExternalOccurrence}`
                    : source.source.replace(/\.interrupt$/, '');
                const prefix = `${config.project.name.toUpperCase()}_${instance.toUpperCase()}`;
                recordHeaderMacro(`${prefix}_IRQ`, [...rootPath, 'source']);
                recordHeaderMacro(`${prefix}_IRQ_TRIGGER`, [...rootPath, 'source']);
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
