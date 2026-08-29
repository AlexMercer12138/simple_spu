export type MemorySource =
    | { type: 'internal_ram'; size: number | string; initFile?: string }
    | { type: 'external_local_bus'; size: number | string };

export interface ProjectSource {
    name: string;
    outputDir: string;
}

export interface CpuSource {
    debug?: boolean;
    jtagIdCode?: string;
}

export interface PeripheralSource {
    type: string;
    name: string;
    baseAddress?: string;
    parameters?: Record<string, number | string | boolean>;
}

export interface ExternalInterfaceSource {
    type: 'local_bus' | 'apb' | 'axi4_lite' | 'wishbone' | 'avalon' | 'drp';
    name: string;
    baseAddress?: string;
    windowSize: number | string;
    addressWidth: number;
    parameters?: Record<string, number | string | boolean>;
}

export type InterruptTrigger = 'high' | 'low' | 'rising' | 'falling';

export interface ControllerInterruptSource {
    /** A peripheral interrupt name or `external.<identifier>`. */
    source: string;
    id: number;
    trigger: InterruptTrigger;
}

export type InterruptSource =
    | { mode: 'none' }
    /** `source` is a peripheral interrupt name or `external.<identifier>`. */
    | { mode: 'direct'; source: string }
    | {
        mode: 'controller';
        controller: string;
        sources: readonly ControllerInterruptSource[];
    };

export interface SocSourceConfig {
    /** Non-JSON provenance attached by parseSocConfig. */
    readonly [SOC_SOURCE_FILE]?: string;
    schemaVersion: 1;
    project: ProjectSource;
    cpu: CpuSource;
    memory: { ilb: MemorySource; dlb: MemorySource };
    peripherals: readonly PeripheralSource[];
    externalInterfaces: readonly ExternalInterfaceSource[];
    interrupt: InterruptSource;
}

export const SOC_SOURCE_FILE: unique symbol = Symbol('merc32.socSourceFile');

export interface SocDiagnostic {
    severity: 'error' | 'warning';
    code: string;
    path: readonly (string | number)[];
    message: string;
}

export interface SocJsonRange {
    offset: number;
    length: number;
}

export interface SocSourceMap {
    rangeFor(path: readonly (string | number)[]): SocJsonRange | undefined;
}

export type CatalogParameterType =
    | 'integer' | 'boolean' | 'string' | 'enum' | 'powerOfTwo';

export interface CatalogParameter {
    type: CatalogParameterType;
    default: number | string | boolean;
    minimum?: number;
    maximum?: number;
    values?: readonly (number | string | boolean)[];
}

export interface CatalogPort {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number | { parameter: string };
}

export interface ModuleDescriptor {
    type: string;
    module: string;
    rtlFiles: readonly string[];
    multiple: boolean;
    addressSize: number;
    alignment: number;
    parameters: Readonly<Record<string, CatalogParameter>>;
    ports: readonly CatalogPort[];
    interrupts: readonly string[];
}

export interface ProtocolDescriptor {
    type: ExternalInterfaceSource['type'];
    rtlFiles: readonly string[];
    alignment: number;
    addressWidthParameter?: string;
    ports: readonly CatalogPort[];
}

export interface ModuleCatalog {
    modules: ReadonlyMap<string, ModuleDescriptor>;
    protocols: ReadonlyMap<string, ProtocolDescriptor>;
}

export interface PlannedPort {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number;
}

export interface PlannedMemory {
    type: MemorySource['type'];
    sizeBytes: bigint;
    wordAddressWidth: number;
    initFile?: { source: string; outputName: string };
}

export interface PlannedRange {
    name: string;
    type: string;
    baseAddress: bigint;
    sizeBytes: bigint;
    endAddress: bigint;
    sourcePath: readonly (string | number)[];
}

export interface PlannedPeripheral extends PlannedRange {
    kind: 'peripheral';
    module: string;
    parameters: Readonly<Record<string, PlannedParameterValue>>;
    ports: readonly PlannedPort[];
    interrupts: readonly string[];
}

export interface PlannedExternalInterface extends PlannedRange {
    kind: 'external';
    addressWidth: number;
    parameters: Readonly<Record<string, PlannedParameterValue>>;
    ports: readonly PlannedPort[];
}

export type PlannedParameterValue = number | string | boolean | bigint;

export interface SocPlanResult {
    plan?: SocPlan;
    diagnostics: readonly SocDiagnostic[];
}

export interface PlannedInterruptSource {
    source: string;
    topPort?: string;
    id?: number;
    trigger?: InterruptTrigger;
}

export type PlannedInterrupt =
    | { mode: 'none'; sources: readonly [] }
    | { mode: 'direct'; sources: readonly [PlannedInterruptSource] }
    | {
        mode: 'controller';
        controller: string;
        irqCount: number;
        irqMode: bigint;
        sources: readonly PlannedInterruptSource[];
    };

export interface SocPlan {
    sourceFile: string;
    projectName: string;
    outputDir: string;
    topModule: string;
    cpu: { debug: boolean; jtagIdCode: bigint };
    memory: { ilb: PlannedMemory; dlb: PlannedMemory };
    peripherals: readonly PlannedPeripheral[];
    externalInterfaces: readonly PlannedExternalInterface[];
    endpoints: readonly (PlannedPeripheral | PlannedExternalInterface)[];
    topPorts: readonly PlannedPort[];
    interrupt: PlannedInterrupt;
    rtlFiles: readonly string[];
}
