import { renderApbInterconnect, renderPlbRouter, renderSocTop } from './emitVerilog';
import { SocPlan } from './model';

export type RtlAssetReader = (logicalPath: string) => Buffer;

export interface RtlBundle {
    content: Buffer;
    logicalSources: readonly string[];
}

const FOUNDATION_ORDER = [
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
    'rtl/misc/spram.v',
] as const;

const NEWLINE = Buffer.from('\n', 'ascii');

/** Assembles the plan-selected Verilog sources into one deterministic file. */
export function renderRtlBundle(plan: SocPlan, readAsset: RtlAssetReader): RtlBundle {
    assertUnique(plan.rtlFiles);
    const packagedSources = orderedPackagedSources(plan.rtlFiles);
    const apbInterconnect = renderApbInterconnect(plan);
    const generatedSources: Array<[string, Buffer]> = [];
    if (apbInterconnect !== undefined) {
        generatedSources.push([
            `generated/${plan.projectName}_apb_interconnect.v`,
            Buffer.from(apbInterconnect, 'utf8'),
        ]);
    }
    generatedSources.push(
        [`generated/${plan.projectName}_plb_router.v`, Buffer.from(renderPlbRouter(plan), 'utf8')],
        [`generated/${plan.projectName}.v`, Buffer.from(renderSocTop(plan), 'utf8')],
    );

    const logicalSources = Object.freeze([
        ...packagedSources,
        ...generatedSources.map(([logicalSource]) => logicalSource),
    ]);
    assertUnique(logicalSources);

    const chunks: Buffer[] = [];
    for (const logicalSource of packagedSources) {
        appendSource(chunks, logicalSource, readAsset(logicalSource));
    }
    for (const [logicalSource, body] of generatedSources) {
        appendSource(chunks, logicalSource, body);
    }
    return { content: Buffer.concat(chunks), logicalSources };
}

function orderedPackagedSources(rtlFiles: readonly string[]): string[] {
    const selected = new Set(rtlFiles);
    const foundation = FOUNDATION_ORDER.filter((logicalSource) => selected.has(logicalSource));
    const debug = rtlFiles.filter((logicalSource) => logicalSource.startsWith('rtl/debug/')).sort();
    const bridge = rtlFiles.filter((logicalSource) => logicalSource.startsWith('rtl/bridge/')).sort();
    const other = rtlFiles.filter((logicalSource) =>
        !FOUNDATION_ORDER.includes(logicalSource as typeof FOUNDATION_ORDER[number])
        && !logicalSource.startsWith('rtl/debug/')
        && !logicalSource.startsWith('rtl/bridge/')).sort();
    return [...foundation, ...debug, ...bridge, ...other];
}

function appendSource(chunks: Buffer[], logicalSource: string, body: Buffer): void {
    const marker = Buffer.from(`// ---- Source: ${logicalSource} ----\n`, 'ascii');
    chunks.push(marker, body);
    if (body.length === 0 || body[body.length - 1] !== 0x0a) chunks.push(NEWLINE);
    chunks.push(NEWLINE);
}

function assertUnique(logicalSources: readonly string[]): void {
    const seen = new Set<string>();
    for (const logicalSource of logicalSources) {
        if (seen.has(logicalSource)) {
            throw new Error(`Duplicate RTL logical source: ${logicalSource}`);
        }
        seen.add(logicalSource);
    }
}
