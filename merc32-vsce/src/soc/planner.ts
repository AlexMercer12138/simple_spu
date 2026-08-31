import * as path from 'path';

import { parseByteSize, rangeEnd } from './address';
import {
    CatalogPort,
    ControllerInterruptSource,
    ModuleCatalog,
    PlannedExternalInterface,
    PlannedInterrupt,
    PlannedInterruptSource,
    PlannedMemory,
    PlannedParameterValue,
    PlannedPeripheral,
    PlannedPort,
    PlannedRouterTarget,
    SocDiagnostic,
    SocPlan,
    SocPlanResult,
    SocSourceConfig,
    SOC_SOURCE_FILE,
} from './model';
import { validateSocConfig } from './validate';

const DEFAULT_JTAG_ID_CODE = 0x4d320001n;
const BASE_RTL_FILES = [
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
];
const TRIGGER_ENCODING = {
    high: 0n,
    low: 1n,
    rising: 2n,
    falling: 3n,
} as const;

export interface PlanSocOptions {
    /** Absolute directory used to resolve source-relative paths without parser provenance. */
    baseDirectory: string;
}

/** Converts a validated source configuration into the sole emitter input. */
export function planSoc(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    options?: PlanSocOptions,
): SocPlanResult {
    const diagnostics = [...validateSocConfig(config, catalog)];
    recordMissingAddresses(config, diagnostics);
    const sourceFile = config[SOC_SOURCE_FILE] ?? '';
    const sourceDirectory = planningSourceDirectory(config, sourceFile, options, diagnostics);
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
        return deepFreeze({ diagnostics });
    }

    const interrupt = planInterrupt(config);
    const peripherals = planPeripherals(config, catalog, interrupt);
    const externalInterfaces = planExternalInterfaces(config, catalog);
    const endpoints = [...peripherals, ...externalInterfaces]
        .sort((left, right) => compareBigints(left.baseAddress, right.baseAddress));
    const routerTargets = planRouterTargets(peripherals, externalInterfaces);
    const memory = {
        ilb: planMemory('ilb', config.memory.ilb, sourceDirectory),
        dlb: planMemory('dlb', config.memory.dlb, sourceDirectory),
    };
    const cpu = {
        debug: config.cpu.debug ?? false,
        jtagIdCode: config.cpu.jtagIdCode === undefined
            ? DEFAULT_JTAG_ID_CODE
            : BigInt(config.cpu.jtagIdCode),
    };
    const topPorts = planTopPorts(memory, peripherals, externalInterfaces, interrupt, cpu.debug);
    const rtlFiles = planRtlFiles(config, catalog, memory, cpu.debug);
    const plan: SocPlan = {
        sourceFile,
        projectName: config.project.name,
        outputDir: path.resolve(sourceDirectory, config.project.outputDir),
        topModule: config.project.name,
        cpu,
        memory,
        peripherals,
        externalInterfaces,
        endpoints,
        routerTargets,
        topPorts,
        interrupt,
        rtlFiles,
    };
    return deepFreeze({ plan, diagnostics });
}

function planRouterTargets(
    peripherals: readonly PlannedPeripheral[],
    externalInterfaces: readonly PlannedExternalInterface[],
): PlannedRouterTarget[] {
    const targets: PlannedRouterTarget[] = externalInterfaces.map((endpoint) => ({
        name: endpoint.name,
        ranges: [{ baseAddress: endpoint.baseAddress, endAddress: endpoint.endAddress }],
    }));
    if (peripherals.length > 0) {
        targets.push({
            name: 'builtin_apb',
            ranges: peripherals.map((peripheral) => ({
                baseAddress: peripheral.baseAddress,
                endAddress: peripheral.endAddress,
            })),
        });
    }
    return targets.sort((left, right) =>
        compareBigints(left.ranges[0].baseAddress, right.ranges[0].baseAddress));
}

function planningSourceDirectory(
    config: SocSourceConfig,
    sourceFile: string,
    options: PlanSocOptions | undefined,
    diagnostics: SocDiagnostic[],
): string {
    if (sourceFile !== '' && path.isAbsolute(sourceFile)) {
        return path.dirname(sourceFile);
    }
    if (typeof options?.baseDirectory === 'string' && path.isAbsolute(options.baseDirectory)) {
        return path.normalize(options.baseDirectory);
    }

    const message = sourceFile === '' && options === undefined
        ? 'Planning relative paths requires parser provenance or an explicit absolute baseDirectory.'
        : 'Planning path provenance and baseDirectory values must be absolute.';
    diagnostics.push({
        severity: 'error',
        code: 'SOC_PATH_CONTEXT',
        path: ['project', 'outputDir'],
        message,
    });
    for (const slot of ['ilb', 'dlb'] as const) {
        const memory = config.memory?.[slot];
        if (memory?.type === 'internal_ram' && memory.initFile !== undefined
            && !path.isAbsolute(memory.initFile)) {
            diagnostics.push({
                severity: 'error',
                code: 'SOC_PATH_CONTEXT',
                path: ['memory', slot, 'initFile'],
                message,
            });
        }
    }
    return '';
}

function recordMissingAddresses(config: SocSourceConfig, diagnostics: SocDiagnostic[]): void {
    config.peripherals.forEach((peripheral, index) => {
        if (peripheral.baseAddress === undefined) {
            diagnostics.push({
                severity: 'error',
                code: 'SOC_ADDRESS_REQUIRED',
                path: ['peripherals', index, 'baseAddress'],
                message: 'Generation requires an explicit peripheral base address.',
            });
        }
    });
    config.externalInterfaces.forEach((endpoint, index) => {
        if (endpoint.baseAddress === undefined) {
            diagnostics.push({
                severity: 'error',
                code: 'SOC_ADDRESS_REQUIRED',
                path: ['externalInterfaces', index, 'baseAddress'],
                message: 'Generation requires an explicit external-interface base address.',
            });
        }
    });
}

function planMemory(
    slot: 'ilb' | 'dlb',
    memory: SocSourceConfig['memory']['ilb'],
    sourceDirectory: string,
): PlannedMemory {
    const sizeBytes = parseByteSize(memory.size);
    const result: PlannedMemory = {
        type: memory.type,
        sizeBytes,
        wordAddressWidth: powerOfTwoLog2(sizeBytes / 4n),
    };
    if (memory.type === 'internal_ram' && memory.initFile !== undefined) {
        result.initFile = {
            source: path.resolve(sourceDirectory, memory.initFile),
            outputName: `${slot}_${path.basename(memory.initFile)}`,
        };
    }
    return result;
}

function planPeripherals(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    interrupt: PlannedInterrupt,
): PlannedPeripheral[] {
    return config.peripherals.map((source, index): PlannedPeripheral => {
        const descriptor = catalog.modules.get(source.type)!;
        const parameters: Record<string, PlannedParameterValue> = {};
        for (const [name, definition] of Object.entries(descriptor.parameters)) {
            parameters[name] = source.parameters?.[name] ?? definition.default;
        }
        if (descriptor.type === 'apb_intc' && interrupt.mode === 'controller'
            && source.name === interrupt.controller) {
            parameters.IRQ_COUNT = interrupt.irqCount;
            parameters.IRQ_MODE = interrupt.irqMode;
        }
        const baseAddress = BigInt(source.baseAddress!);
        const sizeBytes = BigInt(descriptor.addressSize);
        return {
            kind: 'peripheral',
            name: source.name,
            type: source.type,
            module: descriptor.module,
            baseAddress,
            sizeBytes,
            endAddress: rangeEnd(baseAddress, sizeBytes),
            sourcePath: ['peripherals', index],
            parameters,
            ports: planCatalogPorts(source.name, descriptor.ports, parameters),
            interrupts: [...descriptor.interrupts],
        };
    }).sort((left, right) => compareBigints(left.baseAddress, right.baseAddress));
}

function planExternalInterfaces(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): PlannedExternalInterface[] {
    return config.externalInterfaces.map((source, index): PlannedExternalInterface => {
        const descriptor = catalog.protocols.get(source.type)!;
        const parameters: Record<string, PlannedParameterValue> = descriptor.addressWidthParameter
            ? { [descriptor.addressWidthParameter]: source.addressWidth }
            : {};
        const baseAddress = BigInt(source.baseAddress!);
        const sizeBytes = parseByteSize(source.windowSize);
        return {
            kind: 'external',
            name: source.name,
            type: source.type,
            baseAddress,
            sizeBytes,
            endAddress: rangeEnd(baseAddress, sizeBytes),
            sourcePath: ['externalInterfaces', index],
            addressWidth: source.addressWidth,
            parameters,
            ports: planCatalogPorts(
                source.name,
                descriptor.ports,
                parameters,
                source.type === 'local_bus' ? source.addressWidth : undefined,
            ),
        };
    }).sort((left, right) => compareBigints(left.baseAddress, right.baseAddress));
}

function planCatalogPorts(
    instanceName: string,
    catalogPorts: readonly CatalogPort[],
    parameters: Readonly<Record<string, PlannedParameterValue>>,
    localBusAddressWidth?: number,
): PlannedPort[] {
    return catalogPorts.map((port): PlannedPort => ({
        name: `${instanceName}_${port.name}`,
        direction: port.direction,
        width: localBusAddressWidth !== undefined && port.name === 'lb_addr'
            ? localBusAddressWidth
            : typeof port.width === 'number'
                ? port.width
                : parameters[port.width.parameter] as number,
    }));
}

function planInterrupt(config: SocSourceConfig): PlannedInterrupt {
    const source = config.interrupt;
    if (source.mode === 'none') {
        return { mode: 'none', sources: [] };
    }
    if (source.mode === 'direct') {
        return {
            mode: 'direct',
            sources: [planInterruptSource(source.source)],
        };
    }
    const ordered = [...source.sources].sort((left, right) => left.id - right.id);
    let irqMode = 0n;
    for (const item of ordered) {
        irqMode |= TRIGGER_ENCODING[item.trigger] << BigInt(item.id * 2);
    }
    return {
        mode: 'controller',
        controller: source.controller,
        irqCount: Math.max(...ordered.map((item) => item.id)) + 1,
        irqMode: BigInt.asUintN(64, irqMode),
        sources: ordered.map(planControllerInterruptSource),
    };
}

function planControllerInterruptSource(source: ControllerInterruptSource): PlannedInterruptSource {
    return {
        ...planInterruptSource(source.source),
        id: source.id,
        trigger: source.trigger,
    };
}

function planInterruptSource(source: string): PlannedInterruptSource {
    const externalName = /^external\.(.+)$/.exec(source)?.[1];
    return {
        source,
        ...(externalName === undefined ? {} : { topPort: `external_${externalName}` }),
    };
}

function planTopPorts(
    memory: SocPlan['memory'],
    peripherals: readonly PlannedPeripheral[],
    externalInterfaces: readonly PlannedExternalInterface[],
    interrupt: PlannedInterrupt,
    debug: boolean,
): PlannedPort[] {
    const ports: PlannedPort[] = [
        { name: 'clk', direction: 'input', width: 1 },
        { name: 'rst_n', direction: 'input', width: 1 },
    ];
    if (debug) {
        ports.push(
            { name: 'tck', direction: 'input', width: 1 },
            { name: 'tms', direction: 'input', width: 1 },
            { name: 'tdi', direction: 'input', width: 1 },
            { name: 'tdo', direction: 'output', width: 1 },
        );
    }
    if (memory.ilb.type === 'external_local_bus') {
        ports.push(...planMemoryPorts('ilb', memory.ilb.wordAddressWidth));
    }
    if (memory.dlb.type === 'external_local_bus') {
        ports.push(...planMemoryPorts('dlb', memory.dlb.wordAddressWidth));
    }
    for (const peripheral of peripherals) {
        ports.push(...peripheral.ports);
    }
    for (const endpoint of externalInterfaces) {
        ports.push(...endpoint.ports);
    }
    const externalInterrupts = interrupt.sources
        .filter((source): source is PlannedInterruptSource & { topPort: string } => source.topPort !== undefined)
        .map((source) => source.topPort!);
    for (const name of [...new Set(externalInterrupts)].sort()) {
        ports.push({ name, direction: 'input', width: 1 });
    }
    return ports;
}

function planMemoryPorts(prefix: 'ilb' | 'dlb', addressWidth: number): PlannedPort[] {
    return [
        { name: `${prefix}_rden`, direction: 'output', width: 1 },
        { name: `${prefix}_wren`, direction: 'output', width: 1 },
        { name: `${prefix}_addr`, direction: 'output', width: addressWidth },
        { name: `${prefix}_strb`, direction: 'output', width: 4 },
        { name: `${prefix}_wdata`, direction: 'output', width: 32 },
        { name: `${prefix}_rdata`, direction: 'input', width: 32 },
        { name: `${prefix}_ack`, direction: 'input', width: 1 },
    ];
}

function planRtlFiles(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    memory: SocPlan['memory'],
    debug: boolean,
): string[] {
    const files = new Set(BASE_RTL_FILES);
    if (debug) {
        files.add('rtl/debug/jtag_debug.v');
    }
    if (memory.ilb.type === 'internal_ram' || memory.dlb.type === 'internal_ram') {
        files.add('rtl/misc/spram.v');
    }
    if (config.peripherals.length > 0) {
        files.add('rtl/bridge/lb2apb.v');
    }
    for (const peripheral of config.peripherals) {
        for (const logicalPath of catalog.modules.get(peripheral.type)!.rtlFiles) {
            files.add(logicalPath);
        }
    }
    for (const endpoint of config.externalInterfaces) {
        for (const logicalPath of catalog.protocols.get(endpoint.type)!.rtlFiles) {
            files.add(logicalPath);
        }
    }
    return [...files].sort();
}

function powerOfTwoLog2(value: bigint): number {
    let result = 0;
    let remaining = value;
    while (remaining > 1n) {
        remaining >>= 1n;
        result += 1;
    }
    return result;
}

function compareBigints(left: bigint, right: bigint): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
        for (const child of Reflect.ownKeys(value as object)) {
            deepFreeze((value as Record<PropertyKey, unknown>)[child]);
        }
        Object.freeze(value);
    }
    return value;
}
