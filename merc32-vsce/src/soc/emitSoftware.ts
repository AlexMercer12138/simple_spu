import { formatHex32 } from './address';
import {
    PlannedExternalInterface,
    PlannedInterruptSource,
    PlannedPeripheral,
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
            ['Name', 'Type', 'Module', 'Base address', 'End address', 'Size', 'Parameters', 'Interrupt outputs'],
            plan.peripherals.map((peripheral) => [
                peripheral.name,
                peripheral.type,
                peripheral.module,
                formatHex32(peripheral.baseAddress),
                formatHex32(peripheral.endAddress),
                formatByteSize(peripheral.sizeBytes),
                formatParameters(peripheral.parameters),
                formatInterruptOutputs(peripheral.interrupts),
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
        INTERRUPT_ROUTING: renderInterruptRouting(plan),
        MEMORIES: renderTable([
            'Name', 'Type', 'Base address', 'End address', 'Size', 'Word-address width', 'Firmware binding',
        ], [
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
        'README.md',
        'manifest.json',
        `hardware/${plan.topModule}.v`,
    ];
    for (const memory of [plan.memory.ilb, plan.memory.dlb]) {
        if (memory.initFile !== undefined) files.push(`firmware/${memory.initFile.outputName}`);
    }
    files.push(
        `software/${headerFileName(plan)}`,
        'software/main.c',
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
        `${memory.wordAddressWidth} bits`,
        memory.initFile === undefined
            ? 'None'
            : `\`$readmemh("../firmware/${memory.initFile.outputName}")\``,
    ];
}

function renderInterruptRouting(plan: SocPlan): string {
    const summary = renderTable([
        ['Mode', plan.interrupt.mode],
        ['Controller', plan.interrupt.mode === 'controller' ? plan.interrupt.controller : 'None'],
        ['IRQ count', plan.interrupt.mode === 'controller' ? plan.interrupt.irqCount.toString() : 'None'],
    ]);
    const routes = renderTableOrNone(
        ['Source', 'ID', 'Trigger', 'Top-level port'],
        plan.interrupt.sources.map((source) => [
            source.source,
            source.id === undefined ? 'None' : source.id.toString(),
            source.trigger ?? 'None',
            source.topPort ?? 'None',
        ]),
    );
    return `${summary}\n\n${routes}`;
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

function formatInterruptOutputs(interrupts: readonly string[]): string {
    return interrupts.length === 0 ? 'None' : interrupts.join(', ');
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
