import * as crypto from 'crypto';
import * as path from 'path';
import type * as vscode from 'vscode';

import { SOC_COMMANDS, SOC_EDITOR_VIEW_TYPE } from './constants';
import {
    IDLE_GENERATION,
    SocEditorSession,
} from './socEditorSession';
import type {
    SocEditorCommandOutcome,
    SocMutationMessage,
} from './socEditorSession';
import { JsonValueUpdate, buildJsonReplacement } from './socJsonEdits';
import {
    formatHex32,
    loadCatalog,
    ModuleCatalog,
    parseSocConfig,
    planSoc,
    SocDiagnostic,
    SocSourceConfig,
} from './soc';
import {
    isConfigRelativePathField,
    isSafeConfigRelativePath,
    isSafeNonPathString,
    JsonObject,
    JsonValue,
    parseWebviewMessage,
    SocCatalogItemPresentation,
    SocEditorActionType,
    SocEditorViewModel,
    SocGenerationState,
    SocInterruptOptionsPresentation,
    SocJsonPath,
    WebviewToHostMessage,
} from './socWebviewProtocol';

type VscodeApi = typeof import('vscode');
type WebviewForHtml = Pick<vscode.Webview, 'asWebviewUri' | 'cspSource'>;
type UriForHtml = Pick<vscode.Uri, 'path' | 'with'>;

type SocEditorCommandType = SocEditorActionType;

export type { SocEditorCommandOutcome } from './socEditorSession';

const SOC_EDITOR_COMMAND_STATUS: Readonly<Record<SocEditorCommandType, {
    command: string;
    start: SocGenerationState;
    success: SocGenerationState;
    failure: SocGenerationState;
}>> = {
    autoAssign: {
        command: SOC_COMMANDS.autoAssign,
        start: { actionId: 0, action: 'autoAssign', phase: 'working', message: 'Assigning addresses...' },
        success: { actionId: 0, action: 'autoAssign', phase: 'success', message: 'Address assignment completed.' },
        failure: { actionId: 0, action: 'autoAssign', phase: 'error', message: 'Address assignment failed.' },
    },
    validate: {
        command: SOC_COMMANDS.validate,
        start: { actionId: 0, action: 'validate', phase: 'validating', message: 'Validating configuration...' },
        success: { actionId: 0, action: 'validate', phase: 'success', message: 'Validation completed.' },
        failure: { actionId: 0, action: 'validate', phase: 'error', message: 'Validation failed.' },
    },
    generate: {
        command: SOC_COMMANDS.generate,
        start: { actionId: 0, action: 'generate', phase: 'generating', message: 'Generating SoC...' },
        success: { actionId: 0, action: 'generate', phase: 'generated', message: 'SoC generation completed.' },
        failure: { actionId: 0, action: 'generate', phase: 'error', message: 'SoC generation failed.' },
    },
};

/** Renders the fixed shell; all changing content is populated with DOM APIs. */
export function renderEditorHtml(
    webview: WebviewForHtml,
    extensionUri: UriForHtml,
    nonce: string,
): string {
    const resourceRoot = joinUriPath(extensionUri, 'resources', 'webview');
    const stylesheetUri = webview.asWebviewUri(joinUriPath(resourceRoot, 'socEditor.css') as vscode.Uri);
    const scriptUri = webview.asWebviewUri(joinUriPath(resourceRoot, 'socEditor.js') as vscode.Uri);
    const csp = `default-src 'none'; img-src ${webview.cspSource}; style-src ${webview.cspSource}; `
        + `font-src ${webview.cspSource}; script-src 'nonce-${nonce}';`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="${escapeAttribute(csp)}">
    <link rel="stylesheet" href="${escapeAttribute(stylesheetUri.toString())}">
    <title>MERC32 SoC Configurator</title>
</head>
<body>
    <div id="editor-shell" class="editor-shell" aria-busy="true">
        <header class="toolbar">
            <div class="toolbar-title">
                <div>
                    <h1 id="project-title">MERC32 SoC</h1>
                    <span id="document-status" class="subtle-status">Loading</span>
                </div>
            </div>
            <div class="toolbar-actions" role="toolbar" aria-label="SoC actions">
                <button type="button" data-command="autoAssign" data-requires-config title="Auto-assign addresses" disabled>
                    Auto-assign
                </button>
                <button type="button" data-command="validate" data-requires-config title="Validate configuration" disabled>
                    Validate
                </button>
                <button type="button" class="primary" data-command="generate" data-requires-config title="Generate SoC" disabled>
                    Generate
                </button>
                <button type="button" id="reopen-text" data-command="reopenAsText" title="Reopen as text">
                    Text
                </button>
            </div>
        </header>
        <div id="invalid-banner" class="invalid-banner" role="alert" hidden></div>
        <main class="workbench">
            <nav class="navigation-pane" aria-label="Configuration objects">
                <div id="component-nav"></div>
            </nav>
            <section class="property-pane" aria-labelledby="property-title">
                <div class="pane-heading">
                    <div>
                        <span class="eyebrow">Properties</span>
                        <h2 id="property-title">Selection</h2>
                    </div>
                </div>
                <form id="property-form" autocomplete="off"></form>
            </section>
            <aside class="summary-pane" aria-label="Configuration summary">
                <div class="summary-tabs" role="tablist" aria-label="Summary views">
                    <button type="button" role="tab" data-summary="validation" aria-selected="true">Validation</button>
                    <button type="button" role="tab" data-summary="address" aria-selected="false">Address</button>
                    <button type="button" role="tab" data-summary="irq" aria-selected="false">IRQ</button>
                    <button type="button" role="tab" data-summary="port" aria-selected="false">Ports</button>
                    <button type="button" role="tab" data-summary="dependency" aria-selected="false">Deps</button>
                </div>
                <div id="summary-content" class="summary-content" role="tabpanel"></div>
            </aside>
        </main>
        <footer class="bottom-band">
            <section class="address-overview" aria-labelledby="address-overview-title">
                <div class="bottom-heading">
                    <h2 id="address-overview-title">PLB address space</h2>
                    <span>0x10000000 - 0xffffffff</span>
                </div>
                <div id="address-map" class="address-map"></div>
            </section>
            <section class="generation-state" aria-labelledby="generation-title">
                <h2 id="generation-title">Status</h2>
                <div id="generation-status" class="generation-status" data-phase="idle"></div>
            </section>
        </footer>
    </div>
    <script nonce="${escapeAttribute(nonce)}" src="${escapeAttribute(scriptUri.toString())}"></script>
</body>
</html>`;
}

/** Builds a serializable snapshot from the current document text every time. */
export function buildSocEditorViewModel(
    source: string,
    sourceFile: string,
    documentVersion: number,
    catalog: ModuleCatalog,
    selectedPath?: SocJsonPath,
    generation: SocGenerationState = IDLE_GENERATION,
    isDirty = false,
): SocEditorViewModel {
    const parsed = parseSocConfig(source, sourceFile, catalog);
    const catalogPresentation = presentCatalog(catalog);
    const selected = parsed.config && selectedPath && isSelectableSocPath(parsed.config, selectedPath)
        ? [...selectedPath]
        : parsed.config ? ['cpu'] : undefined;

    if (!parsed.config) {
        return {
            documentVersion,
            documentState: 'readOnly',
            readOnly: true,
            catalog: catalogPresentation,
            diagnostics: presentDiagnostics(source, sourceFile, parsed.diagnostics, parsed.sourceMap),
            selectedPath: selected,
            addressRows: [],
            interruptRows: [],
            portRows: [],
            dependencyRows: [],
            interruptOptions: emptyInterruptOptions(),
            generation: { ...generation },
        };
    }

    let planned: ReturnType<typeof planSoc>;
    try {
        planned = planSoc(parsed.config, catalog);
    } catch {
        planned = {
            diagnostics: [{
                severity: 'error',
                code: 'SOC_PLAN',
                path: [],
                message: 'Planning summary is unavailable.',
            }],
        };
    }
    const diagnostics = deduplicateDiagnostics([...parsed.diagnostics, ...planned.diagnostics]);
    const plan = planned.plan;

    return {
        documentVersion,
        documentState: isDirty ? 'dirty' : 'saved',
        config: cloneConfig(parsed.config),
        readOnly: false,
        catalog: catalogPresentation,
        diagnostics: presentDiagnostics(source, sourceFile, diagnostics, parsed.sourceMap),
        selectedPath: selected,
        addressRows: plan ? plan.endpoints.map((endpoint) => ({
            name: endpoint.name,
            kind: endpoint.kind,
            baseAddress: formatHex32(endpoint.baseAddress),
            endAddress: formatHex32(endpoint.endAddress),
            size: `${endpoint.sizeBytes.toString()} B`,
        })) : [],
        interruptRows: plan ? plan.interrupt.sources.map((interrupt) => ({
            source: interrupt.source,
            ...(interrupt.id === undefined ? {} : { id: interrupt.id }),
            ...(interrupt.trigger === undefined ? {} : { trigger: interrupt.trigger }),
        })) : [],
        portRows: plan ? plan.topPorts.map((port) => ({ ...port })) : [],
        dependencyRows: plan ? presentDependencies(parsed.config, catalog, plan.rtlFiles.length) : [],
        interruptOptions: presentInterruptOptions(parsed.config, catalog),
        generation: { ...generation },
    };
}

/** Executes a contributed SoC action and reports honest, ordered UI status transitions. */
export async function executeSocEditorCommand(
    type: SocEditorCommandType,
    documentUri: vscode.Uri,
    executeCommand: (command: string, ...args: unknown[]) => PromiseLike<SocEditorCommandOutcome>,
    postStatus: (status: SocGenerationState) => PromiseLike<unknown>,
): Promise<void> {
    const action = SOC_EDITOR_COMMAND_STATUS[type];
    await postStatus(action.start);
    try {
        const outcome = await executeCommand(action.command, documentUri, postStatus);
        await postStatus(outcome === false ? action.failure : action.success);
    } catch {
        await postStatus(action.failure);
    }
}

/** Permits only schema-owned leaf fields for an existing configuration node. */
export function isEditableSocPath(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    pathValue: readonly (string | number)[],
): boolean {
    if (!isSafePath(pathValue)) {
        return false;
    }
    if (matchesStringPath(pathValue, ['project'], new Set(['name', 'outputDir']))) return true;
    if (matchesStringPath(pathValue, ['cpu'], new Set(['debug', 'jtagIdCode']))) return true;
    if (pathValue.length === 3 && pathValue[0] === 'memory'
        && (pathValue[1] === 'ilb' || pathValue[1] === 'dlb')) {
        const field = pathValue[2];
        const memory = config.memory[pathValue[1]];
        return field === 'type' || field === 'size'
            || (field === 'initFile' && memory.type === 'internal_ram');
    }
    if (pathValue[0] === 'peripherals' && typeof pathValue[1] === 'number') {
        const peripheral = config.peripherals[pathValue[1]];
        if (!peripheral) return false;
        if (pathValue.length === 3) {
            return typeof pathValue[2] === 'string'
                && new Set(['type', 'name', 'baseAddress']).has(pathValue[2]);
        }
        return pathValue.length === 4 && pathValue[2] === 'parameters'
            && typeof pathValue[3] === 'string'
            && Object.prototype.hasOwnProperty.call(
                catalog.modules.get(peripheral.type)?.parameters ?? {},
                pathValue[3],
            );
    }
    if (pathValue[0] === 'externalInterfaces' && typeof pathValue[1] === 'number') {
        if (!config.externalInterfaces[pathValue[1]]) return false;
        return pathValue.length === 3 && typeof pathValue[2] === 'string'
            && new Set(['type', 'name', 'baseAddress', 'windowSize', 'addressWidth']).has(pathValue[2]);
    }
    if (pathValue[0] === 'interrupt' && pathValue.length === 2) {
        const allowed = config.interrupt.mode === 'none'
            ? new Set(['mode'])
            : config.interrupt.mode === 'direct'
                ? new Set(['mode', 'source'])
                : new Set(['mode', 'controller', 'sources']);
        return typeof pathValue[1] === 'string' && allowed.has(pathValue[1]);
    }
    return config.interrupt.mode === 'controller'
        && pathValue.length === 4 && pathValue[0] === 'interrupt'
        && pathValue[1] === 'sources' && typeof pathValue[2] === 'number'
        && config.interrupt.sources[pathValue[2]] !== undefined
        && typeof pathValue[3] === 'string'
        && new Set(['source', 'id', 'trigger']).has(pathValue[3]);
}

/** Identifies editable scalar fields whose omission is valid in the active schema node. */
export function isUnsettableSocPath(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    pathValue: readonly (string | number)[],
): boolean {
    if (!isEditableSocPath(config, catalog, pathValue)) return false;
    if (pathValue.length === 2 && pathValue[0] === 'cpu') {
        return pathValue[1] === 'debug' || pathValue[1] === 'jtagIdCode';
    }
    if (pathValue.length === 3 && pathValue[0] === 'memory') {
        return pathValue[2] === 'initFile';
    }
    if (pathValue[0] === 'peripherals' && typeof pathValue[1] === 'number') {
        return pathValue.length === 3 && pathValue[2] === 'baseAddress'
            || pathValue.length === 4 && pathValue[2] === 'parameters';
    }
    return pathValue.length === 3 && pathValue[0] === 'externalInterfaces'
        && typeof pathValue[1] === 'number' && pathValue[2] === 'baseAddress';
}

/** Applies all structured updates through one native workspace replacement. */
export async function applySocDocumentUpdates(
    document: vscode.TextDocument,
    updates: readonly JsonValueUpdate[],
    vscodeApi: VscodeApi = loadVscode(),
): Promise<boolean> {
    const replacement = buildJsonReplacement(document.getText(), updates);
    const edit = new vscodeApi.WorkspaceEdit();
    edit.replace(document.uri, new vscodeApi.Range(
        document.positionAt(replacement.offset),
        document.positionAt(replacement.offset + replacement.length),
    ), replacement.text);
    return vscodeApi.workspace.applyEdit(edit);
}

/** Custom text editor whose only persistent state is its backing TextDocument. */
export class Merc32SocEditorProvider implements vscode.CustomTextEditorProvider {
    private readonly catalog: ModuleCatalog;

    constructor(
        private readonly extensionUri: vscode.Uri,
        catalog: ModuleCatalog,
        private readonly vscodeApi: VscodeApi = loadVscode(),
    ) {
        this.catalog = catalog;
    }

    static register(
        context: vscode.ExtensionContext,
        catalog?: ModuleCatalog,
        vscodeApi: VscodeApi = loadVscode(),
    ): vscode.Disposable {
        const resolvedCatalog = catalog
            ?? loadCatalog(vscodeApi.Uri.joinPath(context.extensionUri, 'resources').fsPath);
        const provider = new Merc32SocEditorProvider(context.extensionUri, resolvedCatalog, vscodeApi);
        return vscodeApi.window.registerCustomEditorProvider(
            SOC_EDITOR_VIEW_TYPE,
            provider,
            { webviewOptions: { retainContextWhenHidden: true } },
        );
    }

    async resolveCustomTextEditor(
        document: vscode.TextDocument,
        panel: vscode.WebviewPanel,
    ): Promise<void> {
        const resourceRoot = this.vscodeApi.Uri.joinPath(this.extensionUri, 'resources', 'webview');
        panel.webview.options = {
            enableScripts: true,
            localResourceRoots: [resourceRoot],
        };
        panel.webview.html = renderEditorHtml(
            panel.webview,
            this.extensionUri,
            crypto.randomBytes(18).toString('base64'),
        );

        const subscriptions: vscode.Disposable[] = [];
        const session = new SocEditorSession({
            currentDocumentVersion: () => document.version,
            normalizeSelection: (candidate, previous) => {
                const parsed = parseSocConfig(document.getText(), document.fileName, this.catalog);
                return parsed.config && isSelectableSocPath(parsed.config, candidate)
                    ? [...candidate]
                    : previous;
            },
            buildState: (selection, generation) => buildSocEditorViewModel(
                document.getText(), document.fileName, document.version,
                this.catalog, selection, generation, document.isDirty,
            ),
            postMessage: (message) => panel.webview.postMessage(message),
            mutate: (message) => this.applyMutationMessage(document, message),
            executeAction: (type, report) => executeSocEditorCommand(
                type, document.uri,
                (command, ...args) => this.vscodeApi.commands.executeCommand(command, ...args),
                report,
            ),
            reopenAsText: async () => {
                await this.vscodeApi.commands.executeCommand('vscode.openWith', document.uri, 'default');
            },
        });

        subscriptions.push(
            this.vscodeApi.workspace.onDidChangeTextDocument((event) => {
                if (sameUri(event.document.uri, document.uri)) void session.documentChanged();
            }),
            this.vscodeApi.workspace.onDidSaveTextDocument((savedDocument) => {
                if (sameUri(savedDocument.uri, document.uri)) void session.presentationChanged();
            }),
            panel.webview.onDidReceiveMessage((value: unknown) => {
                const message = parseWebviewMessage(value);
                if (message) void session.receive(message);
            }),
            panel.onDidDispose(() => {
                session.dispose();
                for (const subscription of subscriptions) subscription.dispose();
            }),
        );
    }

    private async applyMutationMessage(
        document: vscode.TextDocument,
        message: SocMutationMessage,
    ): Promise<boolean> {
        const parsed = parseSocConfig(document.getText(), document.fileName, this.catalog);
        if (!parsed.config) {
            throw new Error('Invalid JSON is read-only. Reopen as text to repair it.');
        }
        const updates = buildSocDocumentUpdates(parsed.config, this.catalog, message);
        if (!updates) {
            throw new Error('That property is not editable for the selected configuration node.');
        }
        if (!updatesPreserveSchema(document.getText(), document.fileName, this.catalog, updates)) {
            throw new Error('The edit does not match the MERC32 SoC schema.');
        }
        try {
            return await applySocDocumentUpdates(document, updates, this.vscodeApi);
        } catch {
            throw new Error('VS Code could not apply the configuration edit.');
        }
    }
}

export function buildSocDocumentUpdates(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    message: Extract<WebviewToHostMessage, {
        type: 'setValue' | 'unsetValue' | 'addInstance' | 'removeInstance';
    }>,
): readonly JsonValueUpdate[] | undefined {
    if (message.type === 'unsetValue') {
        return isUnsettableSocPath(config, catalog, message.path)
            ? [{ path: message.path, value: undefined }]
            : undefined;
    }
    if (message.type === 'setValue') {
        if (!isEditableSocPath(config, catalog, message.path)) return undefined;
        return normalizeDependentUpdates(config, message.path, message.value);
    }
    const collection = config[message.collection];
    if (message.type === 'removeInstance') {
        return message.index < collection.length
            ? [{ path: [message.collection, message.index], value: undefined }]
            : undefined;
    }
    const item = newInstance(config, catalog, message.collection, message.itemType);
    return item
        ? [{ path: [message.collection, collection.length], value: item }]
        : undefined;
}

function normalizeDependentUpdates(
    config: SocSourceConfig,
    pathValue: SocJsonPath,
    value: JsonValue,
): readonly JsonValueUpdate[] {
    if (pathValue.length === 2 && pathValue[0] === 'interrupt' && pathValue[1] === 'mode') {
        if (value === 'none') return [{ path: ['interrupt'], value: { mode: 'none' } }];
        if (value === 'direct') {
            const previous = config.interrupt.mode === 'direct' ? config.interrupt.source : 'external.irq';
            return [{ path: ['interrupt'], value: { mode: 'direct', source: previous } }];
        }
        if (value === 'controller') {
            const controller = config.peripherals.find((item) => item.type === 'apb_intc')?.name ?? 'intc0';
            return [{ path: ['interrupt'], value: { mode: 'controller', controller, sources: [] } }];
        }
    }
    const updates: JsonValueUpdate[] = [{ path: pathValue, value }];
    if (pathValue.length === 3 && pathValue[2] === 'type') {
        if (pathValue[0] === 'peripherals' || pathValue[0] === 'externalInterfaces') {
            updates.push({ path: [pathValue[0], pathValue[1], 'parameters'], value: undefined });
        } else if (pathValue[0] === 'memory' && value === 'external_local_bus') {
            updates.push({ path: ['memory', pathValue[1], 'initFile'], value: undefined });
        }
    }
    return updates;
}

function newInstance(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    collection: 'peripherals' | 'externalInterfaces',
    itemType: string,
): JsonObject | undefined {
    const existing = config[collection];
    if (collection === 'peripherals') {
        const descriptor = catalog.modules.get(itemType);
        if (!descriptor || (!descriptor.multiple && existing.some((item) => item.type === itemType))) {
            return undefined;
        }
        return { type: itemType, name: uniqueInstanceName(existing, itemType.replace(/^apb_/, '')) };
    }
    const descriptor = catalog.protocols.get(itemType);
    if (!descriptor) return undefined;
    const addressWidth = itemType === 'local_bus' ? 32 : 12;
    return {
        type: itemType,
        name: uniqueInstanceName(existing, itemType.replace(/_lite$/, '')),
        windowSize: 1 << Math.min(addressWidth, 20),
        addressWidth,
    };
}

function uniqueInstanceName(
    existing: readonly { name: string }[],
    prefix: string,
): string {
    const names = new Set(existing.map((item) => item.name));
    for (let index = 0; ; index += 1) {
        const candidate = `${prefix}${index}`;
        if (!names.has(candidate)) return candidate;
    }
}

function updatesPreserveSchema(
    source: string,
    sourceFile: string,
    catalog: ModuleCatalog,
    updates: readonly JsonValueUpdate[],
): boolean {
    try {
        const replacement = buildJsonReplacement(source, updates);
        const updated = source.slice(0, replacement.offset)
            + replacement.text
            + source.slice(replacement.offset + replacement.length);
        return parseSocConfig(updated, sourceFile, catalog).config !== undefined;
    } catch {
        return false;
    }
}

function isSelectableSocPath(config: SocSourceConfig, pathValue: SocJsonPath): boolean {
    if (!isSafePath(pathValue)) return false;
    if (pathValue.length === 1) {
        return pathValue[0] === 'project' || pathValue[0] === 'cpu' || pathValue[0] === 'interrupt';
    }
    if (pathValue.length === 2 && pathValue[0] === 'memory') {
        return pathValue[1] === 'ilb' || pathValue[1] === 'dlb';
    }
    if (pathValue.length === 2 && pathValue[0] === 'peripherals'
        && typeof pathValue[1] === 'number') {
        return config.peripherals[pathValue[1]] !== undefined;
    }
    return pathValue.length === 2 && pathValue[0] === 'externalInterfaces'
        && typeof pathValue[1] === 'number'
        && config.externalInterfaces[pathValue[1]] !== undefined;
}

function presentCatalog(catalog: ModuleCatalog): SocEditorViewModel['catalog'] {
    const modules = [...catalog.modules.values()]
        .sort((left, right) => left.type.localeCompare(right.type))
        .map((descriptor): SocCatalogItemPresentation => ({
            type: descriptor.type,
            label: humanizeType(descriptor.type),
            description: `${descriptor.module} peripheral`,
            multiple: descriptor.multiple,
            parameters: Object.entries(descriptor.parameters)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([name, parameter]) => ({
                    name,
                    type: parameter.type,
                    default: parameter.default,
                    ...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }),
                    ...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }),
                    ...(parameter.values === undefined ? {} : { values: [...parameter.values] }),
                })),
        }));
    const externalInterfaces = [...catalog.protocols.values()]
        .sort((left, right) => left.type.localeCompare(right.type))
        .map((descriptor): SocCatalogItemPresentation => ({
            type: descriptor.type,
            label: humanizeType(descriptor.type),
            description: `${descriptor.ports.length} top-level signals`,
            multiple: true,
            parameters: [],
        }));
    return { modules, externalInterfaces };
}

function emptyInterruptOptions(): SocInterruptOptionsPresentation {
    return { controllers: [], directSources: [], routedSources: [] };
}

function presentInterruptOptions(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): SocInterruptOptionsPresentation {
    const controllers = config.peripherals
        .filter((item) => item.type === 'apb_intc')
        .map((item) => item.name);
    const sources = config.peripherals.flatMap((item) =>
        (catalog.modules.get(item.type)?.interrupts ?? [])
            .map((interrupt) => ({
                source: `${item.name}.${interrupt}`,
                controllerOutput: item.type === 'apb_intc',
            })));
    return {
        controllers,
        directSources: sources.map((item) => item.source),
        routedSources: sources
            .filter((item) => !item.controllerOutput)
            .map((item) => item.source),
    };
}

function presentDiagnostics(
    source: string,
    sourceFile: string,
    diagnostics: readonly SocDiagnostic[],
    sourceMap: { rangeFor(pathValue: readonly (string | number)[]): { offset: number; length: number } | undefined },
): SocEditorViewModel['diagnostics'] {
    return diagnostics.map((diagnostic) => {
        const offset = nearestOffset(sourceMap, diagnostic.path);
        const location = lineAndColumn(source, offset);
        return {
            ...diagnostic,
            message: stripSourcePath(diagnostic.message, sourceFile),
            line: location.line,
            column: location.column,
        };
    });
}

function presentDependencies(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
    rtlFileCount: number,
): SocEditorViewModel['dependencyRows'] {
    const rows: SocEditorViewModel['dependencyRows'][number][] = [];
    const moduleTypes = [...new Set(config.peripherals.map((item) => item.type))].sort();
    for (const type of moduleTypes) {
        const descriptor = catalog.modules.get(type)!;
        const count = config.peripherals.filter((item) => item.type === type).length;
        rows.push({
            name: descriptor.module,
            kind: 'module',
            detail: `${humanizeType(type)} (${count} instance${count === 1 ? '' : 's'})`,
        });
    }
    const protocols = [...new Set(config.externalInterfaces.map((item) => item.type))].sort();
    for (const type of protocols) {
        rows.push({ name: humanizeType(type), kind: 'protocol' });
    }
    rows.push({ name: 'RTL closure', kind: 'rtl', detail: `${rtlFileCount} packaged files` });
    return rows;
}

function cloneConfig(config: SocSourceConfig): JsonObject {
    return redactPresentationPaths(JSON.parse(JSON.stringify(config))) as JsonObject;
}

function redactPresentationPaths(
    value: unknown,
    pathValue: readonly (string | number)[] = [],
): unknown {
    if (typeof value === 'string') {
        const safe = isConfigRelativePathField(pathValue)
            ? isSafeConfigRelativePath(value)
            : isSafeNonPathString(value);
        return safe ? value : '';
    }
    if (Array.isArray(value)) {
        return value.map((child, index) => redactPresentationPaths(child, [...pathValue, index]));
    }
    if (value && typeof value === 'object') {
        const result: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            result[key] = redactPresentationPaths(child, [...pathValue, key]);
        }
        return result;
    }
    return value;
}

function deduplicateDiagnostics(diagnostics: readonly SocDiagnostic[]): readonly SocDiagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.code}\0${JSON.stringify(diagnostic.path)}\0${diagnostic.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function nearestOffset(
    sourceMap: { rangeFor(pathValue: readonly (string | number)[]): { offset: number } | undefined },
    pathValue: readonly (string | number)[],
): number {
    for (let length = pathValue.length; length >= 0; length -= 1) {
        const range = sourceMap.rangeFor(pathValue.slice(0, length));
        if (range) return range.offset;
    }
    return 0;
}

function lineAndColumn(source: string, offset: number): { line: number; column: number } {
    const before = source.slice(0, Math.max(0, offset));
    const lastLineBreak = before.lastIndexOf('\n');
    return {
        line: before.split('\n').length,
        column: offset - lastLineBreak,
    };
}

function stripSourcePath(message: string, sourceFile: string): string {
    const prefixes = [`${sourceFile}: `, `${path.normalize(sourceFile)}: `];
    for (const prefix of prefixes) {
        if (message.startsWith(prefix)) return message.slice(prefix.length);
    }
    return message.split(sourceFile).join(path.basename(sourceFile));
}

function matchesStringPath(
    value: readonly (string | number)[],
    prefix: readonly string[],
    fields: ReadonlySet<string>,
): boolean {
    return value.length === prefix.length + 1
        && prefix.every((segment, index) => value[index] === segment)
        && typeof value[value.length - 1] === 'string'
        && fields.has(value[value.length - 1] as string);
}

function isSafePath(value: readonly (string | number)[]): boolean {
    return Array.isArray(value) && value.length > 0 && value.every((segment) =>
        typeof segment === 'number'
            ? Number.isSafeInteger(segment) && segment >= 0
            : typeof segment === 'string' && segment.length > 0
                && !new Set(['__proto__', 'prototype', 'constructor']).has(segment)
                && !segment.includes('/') && !segment.includes('\\') && !/^[A-Za-z]:/.test(segment));
}

function humanizeType(value: string): string {
    return value.split('_').map((part) => part.toUpperCase()).join(' ');
}

function sameUri(left: vscode.Uri, right: vscode.Uri): boolean {
    return left.toString() === right.toString();
}

function joinUriPath(base: UriForHtml, ...segments: string[]): UriForHtml {
    return base.with({ path: path.posix.join(base.path, ...segments) });
}

function escapeAttribute(value: string): string {
    return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function loadVscode(): VscodeApi {
    return require('vscode') as VscodeApi;
}
