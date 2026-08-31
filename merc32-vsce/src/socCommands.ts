import * as crypto from 'crypto';
import * as path from 'path';
import type * as vscode from 'vscode';

import {
    SOC_COMMANDS,
    SOC_CONFIG_SUFFIX,
    SOC_DEFAULT_CONFIG_FILE,
    SOC_EDITOR_VIEW_TYPE,
} from './constants';
import { applySocDocumentUpdates, SocEditorCommandOutcome } from './socEditorProvider';
import {
    assignMissingAddresses,
    formatHex32,
    generateSoc,
    GenerateSocOptions,
    GenerateSocResult,
    ModuleCatalog,
    parseSocConfig,
    planSoc,
    SocDiagnostic,
    SocGenerationError,
} from './soc';
import type { SocActionProgress } from './socWebviewProtocol';

type VscodeApi = typeof import('vscode');
type GenerationMode = 'normal' | 'force' | 'adopt';
type GenerationStatusReporter = (status: SocActionProgress) => void | PromiseLike<void>;

interface ConfirmedGenerationSnapshot {
    readonly configUri: string;
    readonly documentVersion: number;
    readonly source: string;
    readonly projectName: string;
    readonly outputDir: string;
}

export interface SocDiagnosticsService {
    refresh(
        document: vscode.TextDocument,
        additionalDiagnostics?: readonly SocDiagnostic[],
    ): readonly SocDiagnostic[];
}

export interface GeneratedSocArtifactRecord {
    configUri: vscode.Uri;
    outputUri: vscode.Uri;
    manifestUri: vscode.Uri;
}

/** Narrow Task 5 integration point; command registration owns no artifact state. */
export interface GeneratedSocArtifactSink {
    recordGeneratedSoc(record: GeneratedSocArtifactRecord): void | PromiseLike<void>;
}

export interface SocCommandServices {
    catalog: ModuleCatalog;
    diagnostics: SocDiagnosticsService;
    output: Pick<vscode.OutputChannel, 'appendLine' | 'show'>;
    artifacts?: GeneratedSocArtifactSink;
    vscodeApi?: VscodeApi;
    generate?: (options: GenerateSocOptions) => GenerateSocResult;
    applyUpdates?: typeof applySocDocumentUpdates;
}

interface RuntimeSocCommandServices extends SocCommandServices {
    extensionUri: vscode.Uri;
}

interface SocQuickPickItem extends vscode.QuickPickItem {
    uri: vscode.Uri;
}

/** Resolves only compound-suffix SoC configurations in strict priority order. */
export async function resolveSocConfigUri(
    argument: unknown,
    vscodeApi: VscodeApi = loadVscode(),
): Promise<vscode.Uri | undefined> {
    const explicit = explicitUri(argument, vscodeApi);
    if (explicit) return isSocConfigUri(explicit) ? explicit : undefined;

    const activeInput = vscodeApi.window.tabGroups.activeTabGroup.activeTab?.input as unknown;
    if (isObject(activeInput)
        && activeInput.viewType === SOC_EDITOR_VIEW_TYPE
        && isVscodeUri(activeInput.uri, vscodeApi)
        && isSocConfigUri(activeInput.uri)) {
        return activeInput.uri;
    }

    const matches = await vscodeApi.workspace.findFiles(
        `**/*${SOC_CONFIG_SUFFIX}`,
        '**/{.git,node_modules}/**',
    );
    if (matches.length === 1) return matches[0];
    if (matches.length === 0) return undefined;

    const items = [...matches]
        .sort((left, right) => left.toString().localeCompare(right.toString()))
        .map((uri): SocQuickPickItem => ({
            label: vscodeApi.workspace.asRelativePath(uri, false),
            description: uri.fsPath,
            uri,
        }));
    return (await vscodeApi.window.showQuickPick(items, {
        placeHolder: 'Select a MERC32 SoC configuration',
    }))?.uri;
}

/** Emits the schema-version-1 starter used by the Create command. */
export function createConfigText(projectName: string): string {
    return `${JSON.stringify({
        schemaVersion: 1,
        project: {
            name: projectName,
            outputDir: `generated/${projectName}`,
        },
        cpu: { debug: false },
        memory: {
            ilb: { type: 'internal_ram', size: '32KiB' },
            dlb: { type: 'internal_ram', size: '32KiB' },
        },
        peripherals: [],
        externalInterfaces: [],
        interrupt: { mode: 'none' },
    }, null, 2)}\n`;
}

/** Builds the three intentionally distinct generator calls. */
export function buildGenerateSocOptions(
    configFile: string,
    assetRoot: string,
    mode: GenerationMode,
): GenerateSocOptions {
    if (mode === 'force') return { configFile, assetRoot, force: true };
    if (mode === 'adopt') return { configFile, assetRoot, adoptOutput: true };
    return { configFile, assetRoot };
}

/** Maps an extension-host path back into the configuration's workspace provider. */
export function workspaceUriFromFsPath(
    configUri: vscode.Uri,
    absoluteFsPath: string,
    vscodeApi: VscodeApi = loadVscode(),
): vscode.Uri {
    const fileUri = vscodeApi.Uri.file(absoluteFsPath);
    if (configUri.scheme === 'file') return fileUri;
    return configUri.with({ path: fileUri.path, query: '', fragment: '' });
}

/** Previews and applies every missing address as one WorkspaceEdit. */
export async function runAutoAssign(
    argument: unknown,
    services: SocCommandServices,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    const document = await vscodeApi.workspace.openTextDocument(uri);
    const documentVersion = document.version;
    const source = document.getText();
    const parsed = parseSocConfig(source, document.fileName, services.catalog);
    if (!parsed.config || hasErrors(parsed.diagnostics)) {
        services.diagnostics.refresh(document);
        await vscodeApi.window.showErrorMessage('The MERC32 SoC configuration is invalid.');
        return false;
    }

    const result = assignMissingAddresses(parsed.config, services.catalog);
    if (hasErrors(result.diagnostics)) {
        services.diagnostics.refresh(document);
        await vscodeApi.window.showErrorMessage('MERC32 SoC address assignment failed validation.');
        return false;
    }
    if (result.assignments.length === 0) {
        await vscodeApi.window.showInformationMessage('All MERC32 SoC addresses are already assigned.');
        return true;
    }

    const detail = result.assignments
        .map((assignment) => `${assignment.path.join('.')} -> ${assignment.address}`)
        .join('\n');
    const action = await vscodeApi.window.showWarningMessage(
        'Assign the previewed MERC32 SoC addresses?',
        { modal: true, detail },
        'Assign',
    );
    if (action !== 'Assign') return false;
    if (document.version !== documentVersion || document.getText() !== source) return false;

    const applyUpdates = services.applyUpdates ?? applySocDocumentUpdates;
    const applied = await applyUpdates(document, result.assignments.map((assignment) => ({
        path: assignment.path,
        value: assignment.address,
    })), vscodeApi);
    if (!applied) {
        await vscodeApi.window.showErrorMessage('VS Code could not apply the address assignments.');
        return false;
    }
    return true;
}

/** Runs one selected generator mode and converts only handled generator failures to false. */
export async function runSocGeneration(
    argument: unknown,
    mode: GenerationMode,
    services: RuntimeSocCommandServices,
    reportStatus?: GenerationStatusReporter,
    confirmedSnapshot?: ConfirmedGenerationSnapshot,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    const document = await vscodeApi.workspace.openTextDocument(uri);
    if (confirmedSnapshot
        && !isConfirmedGenerationSnapshotCurrent(document, confirmedSnapshot, services.catalog)) {
        return false;
    }
    if (document.isDirty) {
        try {
            if (!await document.save()) return false;
        } catch {
            await vscodeApi.window.showErrorMessage(
                'MERC32 SoC generation stopped because the configuration could not be saved.',
            );
            return false;
        }
    }

    const assetRoot = vscodeApi.Uri.joinPath(services.extensionUri, 'resources').fsPath;
    const options = buildGenerateSocOptions(uri.fsPath, assetRoot, mode);
    const generate = services.generate ?? generateSoc;

    let result: GenerateSocResult | undefined;
    try {
        result = await vscodeApi.window.withProgress({
            location: vscodeApi.ProgressLocation.Notification,
            title: 'Generating MERC32 SoC',
            cancellable: false,
        }, async (progress) => {
            progress.report({ message: 'Running generator...' });
            await reportStatus?.({ phase: 'generating', message: 'Running generator...' });
            if (confirmedSnapshot
                && !isConfirmedGenerationSnapshotCurrent(document, confirmedSnapshot, services.catalog)) {
                return undefined;
            }
            const generated = generate(options);
            progress.report({ message: 'Output activated.' });
            await reportStatus?.({ phase: 'generating', message: 'Generated output activated.' });
            return generated;
        });

    } catch (error) {
        if (!(error instanceof SocGenerationError)) throw error;
        services.diagnostics.refresh(document, error.diagnostics);
        writeGenerationFailure(services.output, uri, error);
        services.output.show(true);
        await vscodeApi.window.showErrorMessage(`MERC32 SoC generation failed: ${error.message}`);
        return false;
    }
    if (!result) return false;

    writeGenerationSummary(services.output, uri, result);
    const outputUri = workspaceUriFromFsPath(uri, result.outputDir, vscodeApi);
    try {
        await services.artifacts?.recordGeneratedSoc({
            configUri: uri,
            outputUri,
            manifestUri: workspaceUriFromFsPath(uri, result.manifestFile, vscodeApi),
        });
    } catch (error) {
        await reportGenerationWarning(vscodeApi, services.output,
            'the generated artifact record could not be saved', error);
    }
    void Promise.resolve(vscodeApi.commands.executeCommand('revealFileInOS', outputUri))
        .catch((error: unknown) => reportGenerationWarning(
            vscodeApi,
            services.output,
            'the generated output directory could not be revealed',
            error,
        ));
    return true;
}

/** Registers the safe configuration and generation actions. */
export function registerSocCommands(
    context: vscode.ExtensionContext,
    services: SocCommandServices,
): vscode.Disposable[] {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const runtime = { ...services, extensionUri: context.extensionUri };
    return [
        vscodeApi.commands.registerCommand(SOC_COMMANDS.createConfig,
            () => createConfig(services)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.openConfig,
            (argument) => openConfig(argument, services)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.autoAssign,
            (argument) => runAutoAssign(argument, services)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.validate,
            (argument) => validateSocConfigDocument(argument, services)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.generate,
            (argument, reportStatus?: GenerationStatusReporter) =>
                runSocGeneration(argument, 'normal', runtime, reportStatus)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.forceGenerate,
            (argument, reportStatus?: GenerationStatusReporter) =>
                confirmForceGeneration(argument, runtime, reportStatus)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.adoptOutput,
            (argument, reportStatus?: GenerationStatusReporter) =>
                confirmAdoptOutput(argument, runtime, reportStatus)),
        vscodeApi.commands.registerCommand(SOC_COMMANDS.reopenAsText,
            (argument) => reopenAsText(argument, services)),
    ];
}

async function createConfig(
    services: SocCommandServices,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const workspaceFolder = vscodeApi.workspace.workspaceFolders?.[0]?.uri;
    const defaultUri = workspaceFolder
        ? vscodeApi.Uri.joinPath(workspaceFolder, SOC_DEFAULT_CONFIG_FILE)
        : vscodeApi.Uri.file(SOC_DEFAULT_CONFIG_FILE);
    const uri = await vscodeApi.window.showSaveDialog({
        defaultUri,
        filters: { 'MERC32 SoC configuration': ['merc32.json'] },
        saveLabel: 'Create Configuration',
    });
    if (!uri) return false;
    if (!isSocConfigUri(uri)) {
        await vscodeApi.window.showErrorMessage(
            `MERC32 SoC configurations must end with ${SOC_CONFIG_SUFFIX}.`,
        );
        return false;
    }
    try {
        await vscodeApi.workspace.fs.stat(uri);
        await vscodeApi.window.showErrorMessage('The selected configuration file already exists.');
        return false;
    } catch (error) {
        if (!isFileNotFound(error)) throw error;
    }

    const fileName = path.posix.basename(uri.path);
    const sourceStem = fileName.slice(0, -SOC_CONFIG_SUFFIX.length);
    const projectName = legalStarterProjectName(sourceStem, uri.fsPath, services.catalog);
    const temporaryUri = uri.with({
        path: `${uri.path}.tmp-${crypto.randomBytes(12).toString('hex')}`,
    });
    try {
        await vscodeApi.workspace.fs.writeFile(
            temporaryUri,
            Buffer.from(createConfigText(projectName), 'utf8'),
        );
        await vscodeApi.workspace.fs.rename(temporaryUri, uri, { overwrite: false });
    } catch (error) {
        await deleteTemporaryConfig(temporaryUri, vscodeApi);
        if (isFileExists(error)) {
            await vscodeApi.window.showErrorMessage(
                'The selected configuration file was created before this operation completed.',
            );
            return false;
        }
        throw error;
    }
    await vscodeApi.commands.executeCommand('vscode.openWith', uri, SOC_EDITOR_VIEW_TYPE);
    return true;
}

async function openConfig(
    argument: unknown,
    services: SocCommandServices,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    await vscodeApi.commands.executeCommand('vscode.openWith', uri, SOC_EDITOR_VIEW_TYPE);
    return true;
}

async function reopenAsText(
    argument: unknown,
    services: SocCommandServices,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    await vscodeApi.commands.executeCommand('vscode.openWith', uri, 'default');
    return true;
}

async function validateSocConfigDocument(
    argument: unknown,
    services: SocCommandServices,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    const document = await vscodeApi.workspace.openTextDocument(uri);
    services.diagnostics.refresh(document);
    const parsed = parseSocConfig(document.getText(), document.fileName, services.catalog);
    const planned = parsed.config ? planSoc(parsed.config, services.catalog) : undefined;
    const diagnostics = deduplicateDiagnostics([
        ...parsed.diagnostics,
        ...(planned?.diagnostics ?? []),
    ]);

    services.output.appendLine(`MERC32 SoC validation: ${uri.fsPath}`);
    writeWarnings(services.output, diagnostics);
    if (planned?.plan) writeAddressTable(services.output, planned.plan.endpoints);
    services.output.show(true);
    if (hasErrors(diagnostics)) {
        await vscodeApi.window.showErrorMessage('MERC32 SoC validation failed.');
        return false;
    }
    return true;
}

async function confirmForceGeneration(
    argument: unknown,
    services: RuntimeSocCommandServices,
    reportStatus?: GenerationStatusReporter,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    const snapshot = await prepareGenerationConfirmation(uri, services);
    if (!snapshot) return false;
    const selected = await vscodeApi.window.showWarningMessage(
        'Force generate this MERC32 SoC?',
        {
            modal: true,
            detail: `Configuration: ${uri.fsPath}\nOutput directory: ${snapshot.outputDir}\n\n`
                + 'Force generation may replace modified managed files, but it will not replace main.c.',
        },
        'Force Generate',
    );
    return selected === 'Force Generate'
        ? runSocGeneration(uri, 'force', services, reportStatus, snapshot)
        : false;
}

async function confirmAdoptOutput(
    argument: unknown,
    services: RuntimeSocCommandServices,
    reportStatus?: GenerationStatusReporter,
): Promise<SocEditorCommandOutcome> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const uri = await resolveSocConfigUri(argument, vscodeApi);
    if (!uri) return false;
    const snapshot = await prepareGenerationConfirmation(uri, services);
    if (!snapshot) return false;
    const selected = await vscodeApi.window.showWarningMessage(
        `Adopt output for ${path.basename(uri.fsPath)}?`,
        {
            modal: true,
            detail: `Configuration: ${uri.fsPath}\nOutput directory: ${snapshot.outputDir}`,
        },
        'Adopt Output',
    );
    return selected === 'Adopt Output'
        ? runSocGeneration(uri, 'adopt', services, reportStatus, snapshot)
        : false;
}

async function prepareGenerationConfirmation(
    uri: vscode.Uri,
    services: RuntimeSocCommandServices,
): Promise<ConfirmedGenerationSnapshot | undefined> {
    const vscodeApi = services.vscodeApi ?? loadVscode();
    const document = await vscodeApi.workspace.openTextDocument(uri);
    if (document.isDirty) {
        try {
            if (!await document.save()) return undefined;
        } catch {
            await vscodeApi.window.showErrorMessage(
                'MERC32 SoC generation stopped because the configuration could not be saved.',
            );
            return undefined;
        }
    }
    const source = document.getText();
    const parsed = parseSocConfig(source, document.fileName, services.catalog);
    if (!parsed.config || hasErrors(parsed.diagnostics)) {
        services.diagnostics.refresh(document);
        await vscodeApi.window.showErrorMessage('The MERC32 SoC configuration is invalid.');
        return undefined;
    }
    return {
        configUri: uri.toString(),
        documentVersion: document.version,
        source,
        projectName: parsed.config.project.name,
        outputDir: path.resolve(path.dirname(uri.fsPath), parsed.config.project.outputDir),
    };
}

function isConfirmedGenerationSnapshotCurrent(
    document: vscode.TextDocument,
    snapshot: ConfirmedGenerationSnapshot,
    catalog: ModuleCatalog,
): boolean {
    if (document.uri.toString() !== snapshot.configUri
        || document.version !== snapshot.documentVersion
        || document.getText() !== snapshot.source) return false;
    const parsed = parseSocConfig(document.getText(), document.fileName, catalog);
    return Boolean(parsed.config
        && !hasErrors(parsed.diagnostics)
        && parsed.config.project.name === snapshot.projectName
        && path.resolve(path.dirname(document.fileName), parsed.config.project.outputDir) === snapshot.outputDir);
}

async function reportGenerationWarning(
    vscodeApi: VscodeApi,
    output: Pick<vscode.OutputChannel, 'appendLine' | 'show'>,
    detail: string,
    error: unknown,
): Promise<void> {
    const reason = error instanceof Error ? error.message : String(error);
    const message = `MERC32 SoC generated successfully with a warning: ${detail}: ${reason}`;
    output.appendLine(`WARNING SOC_GENERATION_FOLLOW_UP: ${detail}: ${reason}`);
    output.show(true);
    try {
        await vscodeApi.window.showWarningMessage(message);
    } catch {
        // The output channel still retains the warning if notifications are unavailable.
    }
}

function legalStarterProjectName(
    sourceStem: string,
    sourceFile: string,
    catalog: ModuleCatalog,
): string {
    const normalized = sourceStem.replace(/[^A-Za-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    let candidate = normalized === '' ? 'soc' : normalized;
    if (!/^[A-Za-z_]/.test(candidate)) candidate = `_${candidate}`;
    while (parseSocConfig(createConfigText(candidate), sourceFile, catalog).diagnostics
        .some((diagnostic) => diagnostic.severity === 'error')) {
        candidate = `${candidate}_soc`;
    }
    return candidate;
}

function writeGenerationSummary(
    output: Pick<vscode.OutputChannel, 'appendLine'>,
    configUri: vscode.Uri,
    result: GenerateSocResult,
): void {
    output.appendLine(`Generated MERC32 SoC: ${configUri.fsPath}`);
    output.appendLine(`Output directory: ${result.outputDir}`);
    output.appendLine(`Manifest: ${result.manifestFile}`);
    output.appendLine(`Generated files: ${result.files.length}`);
    writeWarnings(output, result.warnings);
}

function writeGenerationFailure(
    output: Pick<vscode.OutputChannel, 'appendLine'>,
    configUri: vscode.Uri,
    error: SocGenerationError,
): void {
    output.appendLine(`MERC32 SoC generation failed: ${configUri.fsPath}`);
    for (const diagnostic of error.diagnostics) {
        output.appendLine(`${diagnostic.severity.toUpperCase()} ${diagnostic.code} `
            + `${formatDiagnosticPath(diagnostic.path)}: ${diagnostic.message}`);
    }
    for (const conflict of error.conflicts) {
        output.appendLine(`CONFLICT ${conflict.path}: ${conflict.reason}`);
    }
}

function writeWarnings(
    output: Pick<vscode.OutputChannel, 'appendLine'>,
    diagnostics: readonly SocDiagnostic[],
): void {
    const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === 'warning');
    output.appendLine(warnings.length === 0 ? 'Warnings: none' : 'Warnings:');
    for (const warning of warnings) {
        output.appendLine(`WARNING ${warning.code} ${formatDiagnosticPath(warning.path)}: ${warning.message}`);
    }
}

function writeAddressTable(
    output: Pick<vscode.OutputChannel, 'appendLine'>,
    endpoints: readonly { name: string; baseAddress: bigint; endAddress: bigint }[],
): void {
    output.appendLine('Address table:');
    if (endpoints.length === 0) {
        output.appendLine('(no PLB endpoints)');
        return;
    }
    for (const endpoint of endpoints) {
        output.appendLine(`${endpoint.name}: ${formatHex32(endpoint.baseAddress)} - ${formatHex32(endpoint.endAddress)}`);
    }
}

function explicitUri(argument: unknown, vscodeApi: VscodeApi): vscode.Uri | undefined {
    if (isVscodeUri(argument, vscodeApi)) return argument;
    if (!isObject(argument)) return undefined;
    if (isVscodeUri(argument.resourceUri, vscodeApi)) return argument.resourceUri;
    if (isVscodeUri(argument.uri, vscodeApi)) return argument.uri;
    return undefined;
}

function isVscodeUri(value: unknown, vscodeApi: VscodeApi): value is vscode.Uri {
    const runtimeGuard = (vscodeApi.Uri as unknown as {
        isUri?: (candidate: unknown) => candidate is vscode.Uri;
    }).isUri;
    if (runtimeGuard) return runtimeGuard(value);
    return isObject(value)
        && typeof value.scheme === 'string'
        && typeof value.path === 'string'
        && typeof value.fsPath === 'string'
        && typeof value.toString === 'function';
}

function isSocConfigUri(uri: vscode.Uri): boolean {
    return uri.path.endsWith(SOC_CONFIG_SUFFIX);
}

function isFileNotFound(error: unknown): boolean {
    return isObject(error) && (error.code === 'FileNotFound' || error.code === 'ENOENT');
}

function isFileExists(error: unknown): boolean {
    return isObject(error) && (error.code === 'FileExists' || error.code === 'EEXIST');
}

async function deleteTemporaryConfig(uri: vscode.Uri, vscodeApi: VscodeApi): Promise<void> {
    try {
        await vscodeApi.workspace.fs.delete(uri, { useTrash: false });
    } catch (error) {
        if (!isFileNotFound(error)) throw error;
    }
}

function hasErrors(diagnostics: readonly SocDiagnostic[]): boolean {
    return diagnostics.some((diagnostic) => diagnostic.severity === 'error');
}

function deduplicateDiagnostics(diagnostics: readonly SocDiagnostic[]): SocDiagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.code}\0${JSON.stringify(diagnostic.path)}\0${diagnostic.message}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function formatDiagnosticPath(pathValue: readonly (string | number)[]): string {
    return pathValue.length === 0 ? '<root>' : pathValue.join('.');
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function loadVscode(): VscodeApi {
    return require('vscode');
}
