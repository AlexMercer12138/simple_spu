import * as path from 'path';
import type * as vscode from 'vscode';

import {
    SOC_COMMANDS,
    SOC_CONFIG_SUFFIX,
    SOC_EDITOR_VIEW_TYPE,
    SOC_HOST_COMMANDS,
} from './constants';
import { parseSocManifest } from './soc';
import type { SocManifest } from './soc';
import { assertPathHasNoLinks } from './soc/fileManager';
import type { GeneratedSocArtifactRecord } from './socCommands';
import type { ToolchainArtifact } from './types';

type VscodeApi = typeof import('vscode');

export const SOC_ARTIFACT_STATE_KEY = 'merc32.soc.generatedArtifacts';

export interface ConfigurationCandidate<TUri> {
    uri: TUri;
    workspaceRelativePath: string;
}

export interface ConfigurationModel<TUri> extends ConfigurationCandidate<TUri> {
    kind: 'configuration';
    label: string;
    description?: string;
}

/** Builds deterministic configuration nodes without parsing ordinary JSON documents. */
export function buildConfigurationModels<TUri>(
    candidates: readonly ConfigurationCandidate<TUri>[],
): ConfigurationModel<TUri>[] {
    return candidates
        .map((candidate) => {
            const normalized = candidate.workspaceRelativePath.replace(/\\/g, '/');
            const directory = path.posix.dirname(normalized);
            return {
                ...candidate,
                workspaceRelativePath: normalized,
                kind: 'configuration' as const,
                label: path.posix.basename(normalized),
                ...(directory === '.' ? {} : { description: directory }),
            };
        })
        .sort((left, right) => compareText(left.workspaceRelativePath, right.workspaceRelativePath));
}

export const SOC_ACTION_MODELS = Object.freeze([
    { label: 'Validate', command: SOC_COMMANDS.validate, icon: 'check' },
    { label: 'Auto-assign', command: SOC_COMMANDS.autoAssign, icon: 'symbol-ruler' },
    { label: 'Generate', command: SOC_COMMANDS.generate, icon: 'play' },
    { label: 'Force Generate', command: SOC_COMMANDS.forceGenerate, icon: 'debug-restart' },
] as const);

interface InfoNode {
    kind: 'info';
    label: string;
    description?: string;
    command?: string;
}

type ConfigurationTreeNode = ConfigurationModel<vscode.Uri> | InfoNode;

/** Workspace configuration discovery with one exact-suffix watcher per root. */
export class SocConfigurationProvider implements vscode.TreeDataProvider<ConfigurationTreeNode>, vscode.Disposable {
    private readonly changeEmitter: vscode.EventEmitter<ConfigurationTreeNode | undefined | null | void>;
    readonly onDidChangeTreeData: vscode.Event<ConfigurationTreeNode | undefined | null | void>;
    private readonly workspaceFolderSubscription: vscode.Disposable;
    private watcherDisposables: vscode.Disposable[] = [];
    private configurations: ConfigurationModel<vscode.Uri>[] = [];
    private refreshQueue: Promise<void> = Promise.resolve();
    private disposed = false;

    private constructor(
        private readonly vscodeApi: VscodeApi,
        private enabled: boolean,
        private readonly onError: (error: unknown) => void,
    ) {
        this.changeEmitter = new vscodeApi.EventEmitter<ConfigurationTreeNode | undefined | null | void>();
        this.onDidChangeTreeData = this.changeEmitter.event;
        this.workspaceFolderSubscription = vscodeApi.workspace.onDidChangeWorkspaceFolders(() => {
            this.configureWatchers();
            void this.refresh();
        });
        this.configureWatchers();
    }

    static async create(
        vscodeApi: VscodeApi = loadVscode(),
        enabled = true,
        onError: (error: unknown) => void = () => {},
    ): Promise<SocConfigurationProvider> {
        const provider = new SocConfigurationProvider(vscodeApi, enabled, onError);
        await provider.refresh();
        return provider;
    }

    setEnabled(enabled: boolean): void {
        if (this.enabled === enabled) return;
        this.enabled = enabled;
        void this.refresh();
    }

    refresh(): Promise<void> {
        this.refreshQueue = this.refreshQueue.then(
            () => this.performRefresh(),
            () => this.performRefresh(),
        );
        return this.refreshQueue;
    }

    getChildren(): ConfigurationTreeNode[] {
        if (!this.enabled) {
            return [{ kind: 'info', label: 'SoC tools unavailable', description: 'Packaged catalog failed to load' }];
        }
        if (this.configurations.length === 0) {
            return [{
                kind: 'info',
                label: 'Create Configuration',
                description: `No *${SOC_CONFIG_SUFFIX} files in this workspace`,
                command: SOC_COMMANDS.createConfig,
            }];
        }
        return [...this.configurations];
    }

    getTreeItem(element: ConfigurationTreeNode): vscode.TreeItem {
        const item = new this.vscodeApi.TreeItem(
            element.label,
            this.vscodeApi.TreeItemCollapsibleState.None,
        );
        item.description = element.description;
        if (element.kind === 'configuration') {
            item.resourceUri = element.uri;
            item.iconPath = new this.vscodeApi.ThemeIcon('json');
            item.command = {
                command: 'vscode.openWith',
                title: 'Open MERC32 SoC Configuration',
                arguments: [element.uri, SOC_EDITOR_VIEW_TYPE],
            };
        } else if (element.command) {
            item.iconPath = new this.vscodeApi.ThemeIcon('new-file');
            item.command = { command: element.command, title: element.label };
        } else {
            item.iconPath = new this.vscodeApi.ThemeIcon('warning');
        }
        return item;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.disposeWatchers();
        this.workspaceFolderSubscription.dispose();
        this.changeEmitter.dispose();
    }

    private async performRefresh(): Promise<void> {
        if (this.disposed) return;
        if (!this.enabled) {
            this.configurations = [];
            this.changeEmitter.fire();
            return;
        }
        try {
            const folders = this.vscodeApi.workspace.workspaceFolders ?? [];
            const matches = await Promise.all(folders.map((folder) =>
                this.vscodeApi.workspace.findFiles(
                    new this.vscodeApi.RelativePattern(folder, `**/*${SOC_CONFIG_SUFFIX}`),
                    '**/{.git,node_modules}/**',
                )));
            const candidates = new Map<string, ConfigurationCandidate<vscode.Uri>>();
            for (const uri of matches.flat()) {
                if (!uri.path.endsWith(SOC_CONFIG_SUFFIX)) continue;
                candidates.set(uri.toString(), {
                    uri,
                    workspaceRelativePath: this.vscodeApi.workspace.asRelativePath(uri, true),
                });
            }
            this.configurations = buildConfigurationModels([...candidates.values()]);
        } catch (error) {
            this.onError(error);
        }
        this.changeEmitter.fire();
    }

    private configureWatchers(): void {
        this.disposeWatchers();
        for (const folder of this.vscodeApi.workspace.workspaceFolders ?? []) {
            try {
                const pattern = new this.vscodeApi.RelativePattern(folder, `**/*${SOC_CONFIG_SUFFIX}`);
                const watcher = this.vscodeApi.workspace.createFileSystemWatcher(pattern);
                const refresh = () => { void this.refresh(); };
                this.watcherDisposables.push(
                    watcher.onDidCreate(refresh),
                    watcher.onDidChange(refresh),
                    watcher.onDidDelete(refresh),
                    watcher,
                );
            } catch (error) {
                this.onError(error);
            }
        }
    }

    private disposeWatchers(): void {
        for (const disposable of this.watcherDisposables) disposable.dispose();
        this.watcherDisposables = [];
    }
}

type ActionTreeNode = typeof SOC_ACTION_MODELS[number] | InfoNode;

export class SocActionProvider implements vscode.TreeDataProvider<ActionTreeNode>, vscode.Disposable {
    private readonly changeEmitter: vscode.EventEmitter<ActionTreeNode | undefined | null | void>;
    readonly onDidChangeTreeData: vscode.Event<ActionTreeNode | undefined | null | void>;

    constructor(
        private enabled = true,
        private readonly vscodeApi: VscodeApi = loadVscode(),
    ) {
        this.changeEmitter = new vscodeApi.EventEmitter<ActionTreeNode | undefined | null | void>();
        this.onDidChangeTreeData = this.changeEmitter.event;
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
        this.changeEmitter.fire();
    }

    getChildren(): ActionTreeNode[] {
        return this.enabled
            ? [...SOC_ACTION_MODELS]
            : [{ kind: 'info', label: 'SoC tools unavailable', description: 'Packaged catalog failed to load' }];
    }

    getTreeItem(element: ActionTreeNode): vscode.TreeItem {
        const item = new this.vscodeApi.TreeItem(
            element.label,
            this.vscodeApi.TreeItemCollapsibleState.None,
        );
        item.description = 'description' in element ? element.description : undefined;
        item.iconPath = new this.vscodeApi.ThemeIcon('icon' in element ? element.icon : 'warning');
        if ('command' in element && element.command) {
            item.command = { command: element.command, title: element.label };
        }
        return item;
    }

    dispose(): void {
        this.changeEmitter.dispose();
    }
}

interface ArtifactManifestBinding {
    paths: readonly string[];
    sourceConfig: string;
}

/** Selects compact artifacts only from a structurally valid version-2 manifest. */
export function artifactPathsFromManifest(value: unknown): string[] | undefined {
    const binding = artifactManifestBinding(value);
    return binding ? [...binding.paths] : undefined;
}

interface PersistedSocArtifact {
    configUri: string;
    outputUri: string;
}

export interface ResolvedArtifact {
    kind: 'file' | 'directory';
    label: string;
    uri: vscode.Uri;
    relativePath?: string;
    description?: string;
}

export interface ResolvedGeneratedSocArtifacts {
    configUri: vscode.Uri;
    outputUri: vscode.Uri;
    artifacts: readonly ResolvedArtifact[];
}

export interface ArtifactSnapshot {
    compiler: readonly (ToolchainArtifact & { uri: vscode.Uri })[];
    generatedSocs: readonly ResolvedGeneratedSocArtifacts[];
}

/** Shared session/compiler and persisted/generated-SoC artifact state. */
export class Merc32ArtifactStore implements vscode.Disposable {
    private compiler: (ToolchainArtifact & { uri: vscode.Uri })[] = [];
    private compilerRevision = 0;
    private generatedSocs: ResolvedGeneratedSocArtifacts[] = [];
    private persisted: PersistedSocArtifact[];
    private readonly listeners = new Set<() => void>();
    private operationQueue: Promise<void> = Promise.resolve();
    private disposed = false;

    constructor(
        private readonly workspaceState: vscode.Memento,
        private readonly vscodeApi: VscodeApi = loadVscode(),
        private readonly onError: (error: unknown) => void = () => {},
    ) {
        this.persisted = parsePersistedArtifacts(
            workspaceState.get<unknown>(SOC_ARTIFACT_STATE_KEY, []),
        );
    }

    setCompilerArtifacts(artifacts: readonly ToolchainArtifact[]): void {
        this.compiler = artifacts.map((artifact) => ({
            ...artifact,
            uri: this.vscodeApi.Uri.file(artifact.file),
        }));
        this.compilerRevision += 1;
        this.fireChanged();
    }

    getCompilerArtifacts(): readonly ToolchainArtifact[] {
        return this.compiler;
    }

    getSnapshot(): ArtifactSnapshot {
        return {
            compiler: [...this.compiler],
            generatedSocs: this.generatedSocs.map((record) => ({
                ...record,
                artifacts: [...record.artifacts],
            })),
        };
    }

    subscribe(listener: () => void): vscode.Disposable {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
    }

    refresh(): Promise<void> {
        return this.enqueue(() => this.performRefresh());
    }

    recordGeneratedSoc(record: GeneratedSocArtifactRecord): Promise<void> {
        return this.enqueue(async () => {
            const persisted = {
                configUri: record.configUri.toString(),
                outputUri: record.outputUri.toString(),
            };
            this.persisted = this.persisted.filter((item) =>
                item.configUri !== persisted.configUri && item.outputUri !== persisted.outputUri);
            this.persisted.push(persisted);
            await this.performRefresh(true);
        });
    }

    dispose(): void {
        this.disposed = true;
        this.listeners.clear();
    }

    private enqueue(operation: () => Promise<void>): Promise<void> {
        this.operationQueue = this.operationQueue.then(operation, operation).catch((error) => {
            this.onError(error);
        });
        return this.operationQueue;
    }

    private async performRefresh(persistAfterValidation = false): Promise<void> {
        if (this.disposed) return;
        const compilerRevision = this.compilerRevision;
        const compilerSnapshot = [...this.compiler];
        const compiler = await filterAsync(
            compilerSnapshot,
            (artifact) => this.pathExists(artifact.uri, 'file'),
        );
        const livePersisted: PersistedSocArtifact[] = [];
        const generatedSocs: ResolvedGeneratedSocArtifacts[] = [];
        for (const persisted of this.persisted) {
            let configUri: vscode.Uri;
            let outputUri: vscode.Uri;
            try {
                configUri = this.vscodeApi.Uri.parse(persisted.configUri);
                outputUri = this.vscodeApi.Uri.parse(persisted.outputUri);
                if (!configUri.scheme || !outputUri.scheme) continue;
            } catch {
                continue;
            }
            const manifestUri = this.vscodeApi.Uri.joinPath(outputUri, 'manifest.json');
            if (!await this.pathExists(outputUri, 'directory', outputUri)
                || !await this.pathExists(manifestUri, 'file', outputUri)) {
                continue;
            }
            let manifest: ArtifactManifestBinding | undefined;
            try {
                const bytes = await this.vscodeApi.workspace.fs.readFile(manifestUri);
                manifest = artifactManifestBinding(JSON.parse(Buffer.from(bytes).toString('utf8')));
            } catch (error) {
                this.onError(error);
            }
            if (!manifest || !sameConfigIdentity(manifest.sourceConfig, configUri)) {
                if (!manifest) {
                    this.onError(new Error(`Ignoring invalid MERC32 SoC manifest: ${manifestUri.toString()}`));
                }
                continue;
            }
            livePersisted.push(persisted);
            const artifacts: ResolvedArtifact[] = [
                { kind: 'directory', label: 'Output directory', uri: outputUri },
                { kind: 'file', label: 'manifest.json', uri: manifestUri, relativePath: 'manifest.json' },
            ];
            for (const relativePath of manifest.paths) {
                const uri = this.vscodeApi.Uri.joinPath(outputUri, ...relativePath.split('/'));
                if (!await this.pathExists(uri, 'file', outputUri)) continue;
                artifacts.push({
                    kind: 'file',
                    label: path.posix.basename(relativePath),
                    uri,
                    relativePath,
                });
            }
            generatedSocs.push({ configUri, outputUri, artifacts });
        }
        const persistenceChanged = !samePersistedArtifacts(this.persisted, livePersisted);
        if (this.compilerRevision === compilerRevision) this.compiler = compiler;
        this.persisted = livePersisted;
        this.generatedSocs = generatedSocs;
        if (persistenceChanged || persistAfterValidation) await this.persist();
        this.fireChanged();
    }

    private async pathExists(
        uri: vscode.Uri,
        expected: 'file' | 'directory',
        artifactRoot?: vscode.Uri,
    ): Promise<boolean> {
        try {
            if (artifactRoot !== undefined
                && !await this.hasSafeArtifactAncestors(artifactRoot, uri)) return false;
            return await this.pathHasType(uri, expected);
        } catch {
            return false;
        }
    }

    private async hasSafeArtifactAncestors(root: vscode.Uri, target: vscode.Uri): Promise<boolean> {
        if (root.scheme !== target.scheme || root.authority !== target.authority) return false;
        const relative = path.posix.relative(root.path, target.path);
        if (relative === '..' || relative.startsWith('../') || path.posix.isAbsolute(relative)) return false;
        if (target.scheme === 'file') assertPathHasNoLinks(target.fsPath);
        if (relative === '') return true;
        if (!await this.pathHasType(root, 'directory')) return false;
        let ancestor = root;
        for (const component of relative.split('/').slice(0, -1)) {
            if (component === '' || component === '.' || component === '..') return false;
            ancestor = this.vscodeApi.Uri.joinPath(ancestor, component);
            if (!await this.pathHasType(ancestor, 'directory')) return false;
        }
        return true;
    }

    private async pathHasType(uri: vscode.Uri, expected: 'file' | 'directory'): Promise<boolean> {
        const stat = await this.vscodeApi.workspace.fs.stat(uri);
        if ((stat.type & this.vscodeApi.FileType.SymbolicLink) !== 0) return false;
        const fileType = expected === 'file'
            ? this.vscodeApi.FileType.File
            : this.vscodeApi.FileType.Directory;
        return (stat.type & fileType) === fileType;
    }

    private async persist(): Promise<void> {
        try {
            await this.workspaceState.update(SOC_ARTIFACT_STATE_KEY, this.persisted.map((item) => ({ ...item })));
        } catch (error) {
            this.onError(error);
        }
    }

    private fireChanged(): void {
        for (const listener of this.listeners) listener();
    }
}

type ArtifactTreeNode = ArtifactGroupNode | ArtifactLeafNode | InfoNode;

interface ArtifactGroupNode {
    kind: 'group';
    label: string;
    description?: string;
    children: ArtifactLeafNode[];
}

interface ArtifactLeafNode extends ResolvedArtifact {
    description?: string;
}

/** Artifacts view and the sole validator of artifact command arguments. */
export class Merc32ArtifactsProvider implements vscode.TreeDataProvider<ArtifactTreeNode>, vscode.Disposable {
    private readonly changeEmitter: vscode.EventEmitter<ArtifactTreeNode | undefined | null | void>;
    readonly onDidChangeTreeData: vscode.Event<ArtifactTreeNode | undefined | null | void>;
    private readonly storeSubscription: vscode.Disposable;
    private ownedArtifacts = new WeakSet<object>();

    constructor(
        private readonly store: Merc32ArtifactStore,
        private readonly vscodeApi: VscodeApi = loadVscode(),
    ) {
        this.changeEmitter = new vscodeApi.EventEmitter<ArtifactTreeNode | undefined | null | void>();
        this.onDidChangeTreeData = this.changeEmitter.event;
        this.storeSubscription = store.subscribe(() => this.changeEmitter.fire());
    }

    refresh(): Promise<void> {
        return this.store.refresh();
    }

    getChildren(element?: ArtifactTreeNode): ArtifactTreeNode[] {
        if (element?.kind === 'group') {
            for (const child of element.children) this.ownedArtifacts.add(child);
            return element.children;
        }
        if (element) return [];

        this.ownedArtifacts = new WeakSet<object>();
        const snapshot = this.store.getSnapshot();
        const roots: ArtifactTreeNode[] = snapshot.compiler.map((artifact) => ({
            kind: 'file',
            label: artifact.label || path.basename(artifact.file),
            description: artifact.description || artifact.file,
            uri: artifact.uri,
        }));
        for (const generated of snapshot.generatedSocs) {
            const label = this.vscodeApi.workspace.asRelativePath(generated.configUri, true);
            roots.push({
                kind: 'group',
                label,
                description: generated.outputUri.fsPath,
                children: generated.artifacts.map((artifact) => ({ ...artifact })),
            });
        }
        if (roots.length === 0) {
            return [{ kind: 'info', label: 'No artifacts yet', description: 'Build or generate to populate this view' }];
        }
        for (const root of roots) {
            if (root.kind === 'file' || root.kind === 'directory') this.ownedArtifacts.add(root);
        }
        return roots;
    }

    getTreeItem(element: ArtifactTreeNode): vscode.TreeItem {
        const collapsibleState = element.kind === 'group'
            ? this.vscodeApi.TreeItemCollapsibleState.Expanded
            : this.vscodeApi.TreeItemCollapsibleState.None;
        const item = new this.vscodeApi.TreeItem(element.label, collapsibleState);
        item.description = element.description;
        if (element.kind === 'group') {
            item.iconPath = new this.vscodeApi.ThemeIcon('project');
        } else if (element.kind === 'file' || element.kind === 'directory') {
            item.resourceUri = element.uri;
            item.iconPath = new this.vscodeApi.ThemeIcon(element.kind === 'file' ? 'file' : 'folder-opened');
            item.command = {
                command: SOC_COMMANDS.openArtifact,
                title: element.kind === 'file' ? 'Open Artifact' : 'Reveal Artifact Directory',
                arguments: [element],
            };
        } else {
            item.iconPath = new this.vscodeApi.ThemeIcon('info');
        }
        return item;
    }

    async openArtifact(argument: unknown): Promise<boolean> {
        if (!isObject(argument) || !this.ownedArtifacts.has(argument)
            || (argument.kind !== 'file' && argument.kind !== 'directory')) {
            return false;
        }
        const artifact = argument as unknown as ArtifactLeafNode;
        if (artifact.kind === 'directory') {
            await this.vscodeApi.commands.executeCommand('revealFileInOS', artifact.uri);
            return true;
        }
        const document = await this.vscodeApi.workspace.openTextDocument(artifact.uri);
        await this.vscodeApi.window.showTextDocument(document, { preview: false });
        return true;
    }

    dispose(): void {
        this.storeSubscription.dispose();
        this.changeEmitter.dispose();
    }
}

export function registerSocExplorerCommands(
    configurations: SocConfigurationProvider,
    artifacts: Merc32ArtifactsProvider,
    vscodeApi: VscodeApi = loadVscode(),
): vscode.Disposable[] {
    return [
        vscodeApi.commands.registerCommand(SOC_COMMANDS.openArtifact,
            (argument) => artifacts.openArtifact(argument)),
        vscodeApi.commands.registerCommand(SOC_HOST_COMMANDS.refresh, async () => {
            await Promise.all([configurations.refresh(), artifacts.refresh()]);
        }),
    ];
}

function parsePersistedArtifacts(value: unknown): PersistedSocArtifact[] {
    if (!Array.isArray(value)) return [];
    const seenConfigs = new Set<string>();
    const seenOutputs = new Set<string>();
    const result: PersistedSocArtifact[] = [];
    for (const item of value) {
        if (!isObject(item)
            || Object.keys(item).length !== 2
            || typeof item.configUri !== 'string'
            || typeof item.outputUri !== 'string'
            || seenConfigs.has(item.configUri)
            || seenOutputs.has(item.outputUri)) {
            continue;
        }
        seenConfigs.add(item.configUri);
        seenOutputs.add(item.outputUri);
        result.push({ configUri: item.configUri, outputUri: item.outputUri });
    }
    return result;
}

function samePersistedArtifacts(
    left: readonly PersistedSocArtifact[],
    right: readonly PersistedSocArtifact[],
): boolean {
    return left.length === right.length && left.every((item, index) =>
        item.configUri === right[index].configUri && item.outputUri === right[index].outputUri);
}

async function filterAsync<T>(
    values: readonly T[],
    predicate: (value: T) => Promise<boolean>,
): Promise<T[]> {
    const keep = await Promise.all(values.map(predicate));
    return values.filter((_value, index) => keep[index]);
}

function artifactManifestBinding(value: unknown): ArtifactManifestBinding | undefined {
    let manifest: SocManifest;
    try {
        manifest = parseSocManifest(value);
    } catch {
        return undefined;
    }
    return {
        paths: compactArtifactPaths(manifest),
        sourceConfig: manifest.sourceConfig,
    };
}

function compactArtifactPaths(manifest: SocManifest): string[] {
    const mandatory = [
        'README.md',
        `hardware/${manifest.projectName}.v`,
        `software/${manifest.projectName}.h`,
        'software/main.c',
    ];
    const firmware = manifest.files
        .filter((record) => record.kind === 'source/firmware')
        .map((record) => record.path)
        .sort((left, right) => {
            const leftSlot = left.startsWith('firmware/ilb_') ? 0 : 1;
            const rightSlot = right.startsWith('firmware/ilb_') ? 0 : 1;
            return leftSlot - rightSlot || compareText(left, right);
        });
    return [...mandatory, ...firmware];
}

function sameConfigIdentity(sourceConfig: string, configUri: vscode.Uri): boolean {
    const left = sourceConfig.replace(/\\/g, '/');
    const right = configUri.fsPath.replace(/\\/g, '/');
    return process.platform === 'win32'
        ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
        : left === right;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compareText(left: string, right: string): number {
    return left < right ? -1 : left > right ? 1 : 0;
}

function loadVscode(): VscodeApi {
    return require('vscode') as VscodeApi;
}
