import { formatHex32 } from './address';
import {
    PlannedExternalInterface,
    PlannedInterruptSource,
    PlannedPeripheral,
    PlannedPort,
    SocPlan,
} from './model';

const ILB_BASE = 0x00000000n;
const DLB_BASE = 0x08000000n;
const TRIGGER_MACROS = {
    high: 'MERC32_IRQ_TRIGGER_HIGH',
    low: 'MERC32_IRQ_TRIGGER_LOW',
    rising: 'MERC32_IRQ_TRIGGER_RISING',
    falling: 'MERC32_IRQ_TRIGGER_FALLING',
} as const;

/** Renders the normalized, machine-readable configuration used for this SoC. */
export function renderResolvedConfig(plan: SocPlan): string {
    return renderJson({
        cpu: {
            debug: plan.cpu.debug,
            jtagIdCode: formatHex32(plan.cpu.jtagIdCode),
        },
        externalInterfaces: plan.externalInterfaces.map(resolvedExternal),
        interrupt: resolvedInterrupt(plan),
        memory: {
            dlb: resolvedMemory(plan.memory.dlb, DLB_BASE),
            ilb: resolvedMemory(plan.memory.ilb, ILB_BASE),
        },
        peripherals: plan.peripherals.map(resolvedPeripheral),
        project: {
            name: plan.projectName,
            outputDir: plan.outputDir,
            topModule: plan.topModule,
        },
        rtlFiles: [...plan.rtlFiles],
        topPorts: plan.topPorts.map(resolvedPort),
    });
}

/** Renders the sole address-map presentation; callers must not create a Markdown map. */
export function renderAddressMap(plan: SocPlan): string {
    return renderJson({
        endpoints: plan.endpoints.map((endpoint) => ({
            baseAddress: formatHex32(endpoint.baseAddress),
            endAddress: formatHex32(endpoint.endAddress),
            kind: endpoint.kind,
            name: endpoint.name,
            sizeBytes: jsonInteger(endpoint.sizeBytes),
            type: endpoint.type,
        })),
        memory: {
            dlb: addressRange('dlb', DLB_BASE, plan.memory.dlb.sizeBytes),
            ilb: addressRange('ilb', ILB_BASE, plan.memory.ilb.sizeBytes),
        },
        project: plan.projectName,
    });
}

/** Renders the Tiny C-compatible generated SoC configuration header. */
export function renderSocHeader(plan: SocPlan): string {
    const project = macroIdentifier(plan.projectName);
    assertUniqueHeaderMacros(plan, project);
    const guard = `${project}_H`;
    const lines = [`#ifndef ${guard}`, `#define ${guard}`];

    emitMemoryMacros(lines, project, 'ILB', ILB_BASE, plan.memory.ilb.sizeBytes, plan.memory.ilb.type);
    emitMemoryMacros(lines, project, 'DLB', DLB_BASE, plan.memory.dlb.sizeBytes, plan.memory.dlb.type);
    lines.push(`#define ${project}_FEATURE_DEBUG ${plan.cpu.debug ? '1' : '0'}`);
    for (const peripheral of plan.peripherals) {
        emitEndpointMacros(lines, project, peripheral);
        lines.push(`#define ${project}_FEATURE_${macroIdentifier(peripheral.name)} 1`);
    }
    for (const endpoint of plan.externalInterfaces) {
        emitEndpointMacros(lines, project, endpoint);
        lines.push(`#define ${project}_FEATURE_${macroIdentifier(endpoint.name)} 1`);
    }
    lines.push('#define MERC32_IRQ_TRIGGER_HIGH 0');
    lines.push('#define MERC32_IRQ_TRIGGER_LOW 1');
    lines.push('#define MERC32_IRQ_TRIGGER_RISING 2');
    lines.push('#define MERC32_IRQ_TRIGGER_FALLING 3');
    if (plan.interrupt.mode === 'controller') {
        for (const source of plan.interrupt.sources) {
            emitInterruptMacros(lines, project, source);
        }
    }
    lines.push('#endif', '');
    return lines.join('\n');
}

export interface GeneratedReadmeMetadata {
    sourceIdentity: string;
    generatorVersion: string;
    resourceRevision: string;
    integration: readonly string[];
    outputFiles: readonly string[];
    rtlSources: readonly string[];
}

/** Renders the human-readable description of a generated SoC. */
export function renderGeneratedReadme(
    plan: SocPlan,
    metadata: GeneratedReadmeMetadata,
    template: string = readBundledTemplate('README.md.tpl'),
): string {
    return applyTemplateContent(template, {
        APB_PERIPHERALS: renderTableOrNone(
            ['Name', 'Type', 'Module', 'Base address', 'End address', 'Size', 'Parameters'],
            plan.peripherals.map((peripheral) => [
                peripheral.name,
                peripheral.type,
                peripheral.module,
                formatHex32(peripheral.baseAddress),
                formatHex32(peripheral.endAddress),
                formatByteSize(peripheral.sizeBytes),
                formatParameters(peripheral.parameters),
            ]),
        ),
        CPU: renderTable([
            ['Debug', plan.cpu.debug ? 'enabled' : 'disabled'],
            ['JTAG ID code', formatHex32(plan.cpu.jtagIdCode)],
        ]),
        EXTERNAL_INTERFACES: renderTableOrNone(
            ['Name', 'Type', 'Base address', 'End address', 'Size', 'Address width', 'Parameters'],
            plan.externalInterfaces.map((endpoint) => [
                endpoint.name,
                endpoint.type,
                formatHex32(endpoint.baseAddress),
                formatHex32(endpoint.endAddress),
                formatByteSize(endpoint.sizeBytes),
                `${endpoint.addressWidth} bits`,
                formatParameters(endpoint.parameters),
            ]),
        ),
        GENERATION_IDENTITY: renderTable([
            ['Project', plan.projectName],
            ['Top module', plan.topModule],
            ['Source configuration', metadata.sourceIdentity],
            ['Generator version', metadata.generatorVersion],
            ['Resource revision', metadata.resourceRevision],
        ]),
        INTEGRATION: renderListOrNone(metadata.integration),
        INTERRUPT_ROUTING: renderTableOrNone(
            ['Source', 'ID', 'Trigger', 'Top-level port'],
            plan.interrupt.sources.map((source) => [
                source.source,
                source.id === undefined ? 'None' : source.id.toString(),
                source.trigger === undefined ? plan.interrupt.mode : source.trigger,
                source.topPort ?? 'None',
            ]),
        ),
        MEMORIES: renderTable([
            renderMemoryRow('ILB', plan.memory.ilb, ILB_BASE),
            renderMemoryRow('DLB', plan.memory.dlb, DLB_BASE),
        ]),
        OUTPUT_FILES: renderTableOrNone(['Path'], metadata.outputFiles.map((file) => [`\`${file}\``])),
        PORTS: renderTableOrNone(
            ['Direction', 'Name', 'Width'],
            plan.topPorts.map((port) => [port.direction, port.name, port.width.toString()]),
        ),
        PROJECT_NAME: plan.projectName,
        RTL_SOURCES: renderTableOrNone(['Source'], metadata.rtlSources.map((source) => [`\`${source}\``])),
        TOP_MODULE: plan.topModule,
    });
}

/** Renders the intentionally minimal, user-owned application scaffold. */
export function renderStarterMain(
    plan: SocPlan,
    template: string = readBundledTemplate('main.c.tpl'),
): string {
    return applyTemplateContent(template, { HEADER_FILE: headerFileName(plan) });
}

export function headerFileName(plan: SocPlan): string {
    return `${plan.projectName}.h`;
}

/** Returns the deterministic output layout shared by the README and generator. */
export function expectedGeneratedFiles(plan: SocPlan): readonly string[] {
    const files = [
        `rtl/${plan.topModule}.v`,
        `rtl/generated/${plan.topModule}_plb_router.v`,
    ];
    if (plan.peripherals.length > 0) {
        files.push(`rtl/generated/${plan.topModule}_apb_interconnect.v`);
    }
    files.push(...plan.rtlFiles, 'rtl/files.f');
    for (const memory of [plan.memory.ilb, plan.memory.dlb]) {
        if (memory.initFile !== undefined) files.push(`memory/${memory.initFile.outputName}`);
    }
    files.push(
        `software/include/${headerFileName(plan)}`,
        'software/src/main.c',
        `config/${plan.projectName}.resolved.json`,
        'address-map.json',
        'manifest.json',
        'README.md',
        'LICENSE',
    );
    return files;
}

function renderMemoryRow(
    name: string,
    memory: SocPlan['memory']['ilb'],
    baseAddress: bigint,
): string[] {
    return [
        name,
        memory.type,
        formatHex32(baseAddress),
        formatHex32(baseAddress + memory.sizeBytes - 1n),
        formatByteSize(memory.sizeBytes),
        memory.initFile === undefined
            ? 'None'
            : `\`$readmemh("memory/${memory.initFile.outputName}")\``,
    ];
}

function renderListOrNone(values: readonly string[]): string {
    return values.length === 0 ? 'None configured' : values.map((value) => `- ${value}`).join('\n');
}

function renderTableOrNone(headers: readonly string[], rows: readonly (readonly string[])[]): string {
    return rows.length === 0 ? 'None configured' : renderTable(headers, rows);
}

function renderTable(rows: readonly (readonly string[])[]): string;
function renderTable(headers: readonly string[], rows: readonly (readonly string[])[]): string;
function renderTable(
    headersOrRows: readonly (readonly string[])[] | readonly string[],
    rows?: readonly (readonly string[])[],
): string {
    const hasHeaders = rows !== undefined;
    const tableRows = hasHeaders ? rows : headersOrRows as readonly (readonly string[])[];
    const headerCells = hasHeaders ? headersOrRows as readonly string[] : ['Property', 'Value'];
    const renderRow = (cells: readonly string[]): string => `| ${cells.map(escapeTableCell).join(' | ')} |`;
    return [
        renderRow(headerCells),
        `| ${headerCells.map(() => '---').join(' | ')} |`,
        ...tableRows.map(renderRow),
    ].join('\n');
}

function escapeTableCell(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\|/g, '\\|')
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

function formatByteSize(sizeBytes: bigint): string {
    return `${sizeBytes.toString()} bytes`;
}

function formatParameters(parameters: Readonly<Record<string, unknown>>): string {
    const entries = Object.keys(parameters).sort().map((name) => {
        const value = parameters[name];
        return `\`${name}=${typeof value === 'bigint' ? value.toString() : String(value)}\``;
    });
    return entries.length === 0 ? 'None' : entries.join('<br>');
}

function resolvedMemory(memory: SocPlan['memory']['ilb'], baseAddress: bigint): object {
    return {
        baseAddress: formatHex32(baseAddress),
        endAddress: formatHex32(baseAddress + memory.sizeBytes - 1n),
        initFile: memory.initFile?.outputName,
        sizeBytes: jsonInteger(memory.sizeBytes),
        type: memory.type,
        wordAddressWidth: memory.wordAddressWidth,
    };
}

function resolvedPeripheral(peripheral: PlannedPeripheral): object {
    return {
        baseAddress: formatHex32(peripheral.baseAddress),
        endAddress: formatHex32(peripheral.endAddress),
        interrupts: [...peripheral.interrupts],
        module: peripheral.module,
        name: peripheral.name,
        parameters: sortedParameters(peripheral.parameters),
        sizeBytes: jsonInteger(peripheral.sizeBytes),
        type: peripheral.type,
    };
}

function resolvedExternal(endpoint: PlannedExternalInterface): object {
    return {
        addressWidth: endpoint.addressWidth,
        baseAddress: formatHex32(endpoint.baseAddress),
        endAddress: formatHex32(endpoint.endAddress),
        name: endpoint.name,
        parameters: sortedParameters(endpoint.parameters),
        sizeBytes: jsonInteger(endpoint.sizeBytes),
        type: endpoint.type,
    };
}

function resolvedInterrupt(plan: SocPlan): object {
    if (plan.interrupt.mode === 'none') return { mode: 'none', sources: [] };
    if (plan.interrupt.mode === 'direct') {
        return { mode: 'direct', sources: plan.interrupt.sources.map(resolvedInterruptSource) };
    }
    return {
        controller: plan.interrupt.controller,
        irqCount: plan.interrupt.irqCount,
        irqMode: `0x${plan.interrupt.irqMode.toString(16).padStart(16, '0')}`,
        mode: 'controller',
        sources: plan.interrupt.sources.map(resolvedInterruptSource),
    };
}

function resolvedInterruptSource(source: PlannedInterruptSource): object {
    return {
        id: source.id,
        source: source.source,
        topPort: source.topPort,
        trigger: source.trigger,
    };
}

function resolvedPort(port: PlannedPort): object {
    return { direction: port.direction, name: port.name, width: port.width };
}

function sortedParameters(parameters: Readonly<Record<string, unknown>>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const name of Object.keys(parameters).sort()) {
        const value = parameters[name];
        result[name] = typeof value === 'bigint' ? `0x${value.toString(16)}` : value;
    }
    return result;
}

function addressRange(name: string, baseAddress: bigint, sizeBytes: bigint): object {
    return {
        baseAddress: formatHex32(baseAddress),
        endAddress: formatHex32(baseAddress + sizeBytes - 1n),
        name,
        sizeBytes: jsonInteger(sizeBytes),
    };
}

function emitMemoryMacros(
    lines: string[], project: string, name: string, base: bigint, size: bigint,
    type: SocPlan['memory']['ilb']['type'],
): void {
    lines.push(`#define ${project}_${name}_BASE ${formatHex32(base)}`);
    lines.push(`#define ${project}_${name}_SIZE ${jsonInteger(size)}`);
    lines.push(`#define ${project}_${name}_END ${formatHex32(base + size - 1n)}`);
    lines.push(`#define ${project}_FEATURE_${name}_${type === 'internal_ram' ? 'INTERNAL_RAM' : 'EXTERNAL_LOCAL_BUS'} 1`);
}

function emitEndpointMacros(
    lines: string[], project: string, endpoint: PlannedPeripheral | PlannedExternalInterface,
): void {
    const instance = macroIdentifier(endpoint.name);
    lines.push(`#define ${project}_${instance}_BASE ${formatHex32(endpoint.baseAddress)}`);
    lines.push(`#define ${project}_${instance}_SIZE ${jsonInteger(endpoint.sizeBytes)}`);
    lines.push(`#define ${project}_${instance}_END ${formatHex32(endpoint.endAddress)}`);
}

function emitInterruptMacros(lines: string[], project: string, source: PlannedInterruptSource): void {
    if (source.id === undefined || source.trigger === undefined) {
        throw new Error(`Controller interrupt source ${source.source} lacks an ID or trigger.`);
    }
    const name = source.topPort === undefined
        ? source.source.replace(/\.interrupt$/, '')
        : source.topPort;
    const instance = macroIdentifier(name);
    lines.push(`#define ${project}_${instance}_IRQ ${source.id}`);
    lines.push(`#define ${project}_${instance}_IRQ_TRIGGER ${TRIGGER_MACROS[source.trigger]}`);
}

function assertUniqueHeaderMacros(plan: SocPlan, project: string): void {
    const names = new Set<string>();
    const add = (name: string): void => {
        if (names.has(name)) throw new Error(`Generated C macro collision: ${name}`);
        names.add(name);
    };
    add(`${project}_H`);
    for (const fixed of ['MERC32_IRQ_TRIGGER_HIGH', 'MERC32_IRQ_TRIGGER_LOW',
        'MERC32_IRQ_TRIGGER_RISING', 'MERC32_IRQ_TRIGGER_FALLING']) add(fixed);
    for (const memory of ['ILB', 'DLB']) {
        for (const suffix of ['BASE', 'SIZE', 'END']) add(`${project}_${memory}_${suffix}`);
    }
    add(`${project}_FEATURE_ILB_${memoryFeatureSuffix(plan.memory.ilb.type)}`);
    add(`${project}_FEATURE_DLB_${memoryFeatureSuffix(plan.memory.dlb.type)}`);
    for (const endpoint of plan.endpoints) {
        const instance = macroIdentifier(endpoint.name);
        for (const suffix of ['BASE', 'SIZE', 'END']) add(`${project}_${instance}_${suffix}`);
        add(`${project}_FEATURE_${instance}`);
    }
    for (const source of plan.interrupt.sources) {
        if (source.id === undefined) continue;
        const name = source.topPort === undefined
            ? source.source.replace(/\.interrupt$/, '') : source.topPort;
        const instance = macroIdentifier(name);
        add(`${project}_${instance}_IRQ`);
        add(`${project}_${instance}_IRQ_TRIGGER`);
    }
}

function macroIdentifier(value: string): string {
    return value.toUpperCase();
}

function memoryFeatureSuffix(type: SocPlan['memory']['ilb']['type']): string {
    return type === 'internal_ram' ? 'INTERNAL_RAM' : 'EXTERNAL_LOCAL_BUS';
}

function jsonInteger(value: bigint): number | string {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
}

function renderJson(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function readBundledTemplate(name: string): string {
    const file = path.resolve(__dirname, '..', '..', 'resources', 'templates', name);
    return fs.readFileSync(file, 'utf8');
}

function applyTemplateContent(template: string, values: Readonly<Record<string, string>>): string {
    return template.replace(/{{([A-Z_]+)}}/g, (_match, key: string): string => {
        const value = values[key];
        if (value === undefined) throw new Error(`Missing template value: ${key}`);
        return value;
    }).replace(/\r\n/g, '\n').replace(/\n?$/, '\n');
}
import * as fs from 'fs';
import * as path from 'path';
