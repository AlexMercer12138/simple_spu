import * as fs from 'fs';
import * as path from 'path';

import {
    activateStagedFiles,
    ActivationRecoveryError,
    ActivationTarget,
    assertPathContained,
    assertPathHasNoLinks,
    assertNoCaseInsensitivePathCollisions,
    createSiblingStagingDirectory,
    generatedPath,
    identityOf,
    normalizeGeneratedPath,
    sha256,
    sha256File,
    StagedFile,
    writeStagedFiles,
} from './fileManager';
import { loadCatalog } from './catalog';
import { parseSocConfig } from './config';
import {
    expectedGeneratedFiles,
    headerFileName,
    renderGeneratedReadme,
    renderSocHeader,
    renderStarterMain,
} from './emitSoftware';
import { renderRtlBundle } from './emitRtlBundle';
import {
    ManifestFileRecord,
    ManifestManagedRecord,
    parseSocManifest,
    SocManifest,
    V2_MAIN_PATH,
} from './manifest';
import { SocDiagnostic, SocPlan } from './model';
import { planSoc } from './planner';

export interface GenerateSocOptions {
    configFile: string;
    assetRoot: string;
    force?: boolean;
    adoptOutput?: boolean;
}

export interface GenerateSocResult {
    outputDir: string;
    manifestFile: string;
    files: readonly string[];
    warnings: readonly SocDiagnostic[];
    skippedUserFiles: readonly string[];
}

export interface SocFileConflict {
    path: string;
    reason: 'modified-managed' | 'modified-stale' | 'output-owned';
}

export class SocGenerationError extends Error {
    readonly diagnostics: readonly SocDiagnostic[];
    readonly conflicts: readonly SocFileConflict[];
    readonly recoveryPath?: string;
    readonly recoveryFailures?: readonly Error[];

    constructor(
        message: string,
        diagnostics: readonly SocDiagnostic[] = [],
        conflicts: readonly SocFileConflict[] = [],
        cause?: unknown,
        recovery?: { path: string; failures: readonly Error[] },
    ) {
        super(message);
        this.name = 'SocGenerationError';
        this.diagnostics = Object.freeze([...diagnostics]);
        this.conflicts = Object.freeze([...conflicts]);
        if (recovery !== undefined) {
            this.recoveryPath = recovery.path;
            this.recoveryFailures = Object.freeze([...recovery.failures]);
        }
        if (cause !== undefined) {
            Object.defineProperty(this, 'cause', { value: cause, enumerable: false });
        }
    }
}

interface GeneratedFile {
    path: string;
    content: Buffer;
    logicalSource: string;
    kind: string;
}

interface PreparedGeneration {
    expectedFiles: readonly string[];
    generatedFiles: readonly GeneratedFile[];
    mainFile: GeneratedFile;
    manifest: SocManifest;
    manifestText: Buffer;
    outputDir: string;
    warnings: readonly SocDiagnostic[];
}

type InspectedTargetState = ActivationTarget['expected'];

interface TargetInspection {
    conflicts: SocFileConflict[];
    replacePaths: ActivationTarget[];
    stalePaths: ActivationTarget[];
}

interface ExistingManifest {
    manifest: SocManifest;
    state: InspectedTargetState;
}

const MANIFEST_PATH = 'manifest.json';

/** Generates a complete SoC without depending on the VSCode API. */
export function generateSoc(options: GenerateSocOptions): GenerateSocResult {
    let stagingDir: string | undefined;
    let preserveStaging = false;
    try {
        const prepared = prepareGeneration(options);
        const previousManifest = readExistingManifest(prepared.outputDir);
        const previous = previousManifest?.manifest;
        const ownershipChanged = previous !== undefined
            && (!sameCanonicalPath(previous.sourceConfig, prepared.manifest.sourceConfig)
                || previous.projectName !== prepared.manifest.projectName);
        if (ownershipChanged && !options.adoptOutput) {
            throw new SocGenerationError('The output directory belongs to another configuration.', [], [{
                path: MANIFEST_PATH,
                reason: 'output-owned',
            }]);
        }

        const desiredManaged = new Map(prepared.generatedFiles.map((file) => [file.path, file]));
        const inspection = inspectTarget(
            prepared.outputDir,
            previous,
            desiredManaged,
            ownershipChanged && options.adoptOutput === true,
            options.force === true,
        );
        if (inspection.conflicts.length > 0) {
            throw new SocGenerationError('Generated files conflict with the existing output.', [],
                inspection.conflicts);
        }
        const mainState = inspectRegularTarget(generatedPath(prepared.outputDir, V2_MAIN_PATH));
        const mainExists = mainState.kind === 'regular-file';

        stagingDir = createSiblingStagingDirectory(prepared.outputDir);
        const stagedFiles: StagedFile[] = prepared.generatedFiles.map((file) => ({
            path: file.path,
            content: file.content,
            sha256: sha256(file.content),
        }));
        stagedFiles.push({
            path: V2_MAIN_PATH,
            content: prepared.mainFile.content,
            sha256: sha256(prepared.mainFile.content),
        });
        stagedFiles.push({
            path: MANIFEST_PATH,
            content: prepared.manifestText,
            sha256: sha256(prepared.manifestText),
        });
        writeStagedFiles(stagingDir, stagedFiles);

        const manifestFile = generatedPath(prepared.outputDir, MANIFEST_PATH);
        const manifestState = previousManifest?.state ?? { kind: 'missing' };
        const replaceManifest = manifestState.kind === 'missing'
            || !fs.readFileSync(manifestFile).equals(prepared.manifestText);
        activateStagedFiles({
            outputDir: prepared.outputDir,
            stagingDir,
            replacePaths: [
                ...inspection.replacePaths.map((operation) => ({
                    ...operation,
                    installedSha256: sha256(desiredManaged.get(operation.path)!.content),
                })),
                ...(replaceManifest ? [{
                    path: MANIFEST_PATH,
                    expected: manifestState,
                    installedSha256: sha256(prepared.manifestText),
                }] : []),
            ],
            createOnlyPaths: mainExists ? [] : [{
                path: V2_MAIN_PATH,
                expected: mainState,
                installedSha256: sha256(prepared.mainFile.content),
            }],
            removePaths: inspection.stalePaths,
            invariantPaths: mainExists ? [{ path: V2_MAIN_PATH, expected: mainState }] : [],
        });

        return Object.freeze({
            outputDir: prepared.outputDir,
            manifestFile: generatedPath(prepared.outputDir, MANIFEST_PATH),
            files: Object.freeze([...prepared.expectedFiles]),
            warnings: Object.freeze([...prepared.warnings]),
            skippedUserFiles: Object.freeze(mainExists ? [V2_MAIN_PATH] : []),
        });
    } catch (error) {
        if (error instanceof ActivationRecoveryError) {
            preserveStaging = true;
            throw recoveryFailure(error);
        }
        if (error instanceof SocGenerationError) throw error;
        throw generationFailure(error);
    } finally {
        if (stagingDir !== undefined && !preserveStaging) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
    }
}

function prepareGeneration(options: GenerateSocOptions): PreparedGeneration {
    const configFile = canonicalExistingFile(options.configFile, 'configuration');
    const assetRoot = canonicalExistingDirectory(options.assetRoot, 'asset root');
    let catalog;
    try {
        assertAssetTreeHasNoLinks(assetRoot);
        catalog = loadCatalog(assetRoot);
    } catch (error) {
        throw diagnosticFailure('SOC_ASSET', error);
    }
    const parsed = parseSocConfig(fs.readFileSync(configFile, 'utf8'), configFile, catalog);
    if (parsed.config === undefined || parsed.diagnostics.some((item) => item.severity === 'error')) {
        throw new SocGenerationError('The SoC configuration is invalid.', parsed.diagnostics);
    }
    const planned = planSoc(parsed.config, catalog);
    const diagnostics = [...planned.diagnostics];
    if (planned.plan === undefined || diagnostics.some((item) => item.severity === 'error')) {
        throw new SocGenerationError('The SoC configuration cannot be planned.', diagnostics);
    }

    const plan = planned.plan;
    const resourceRevision = readResourceRevision(assetRoot);
    const generatorVersion = readGeneratorVersion();
    const readmeTemplate = requireAssetFile(assetRoot, 'templates/README.md.tpl').toString('utf8');
    const mainTemplate = requireAssetFile(assetRoot, 'templates/main.c.tpl').toString('utf8');
    const generatedFiles = renderGeneratedFiles(
        plan, assetRoot, path.dirname(configFile), readmeTemplate, portablePath(configFile),
        generatorVersion, resourceRevision);
    const mainFile = generatedFile(
        V2_MAIN_PATH,
        renderStarterMain(plan, mainTemplate),
        'templates/main.c.tpl',
        'scaffold/user-owned',
    );
    const expectedFiles = expectedGeneratedFiles(plan).map(normalizeGeneratedPath);
    assertNoCaseInsensitivePathCollisions(expectedFiles);
    const actualFiles = new Set([
        ...generatedFiles.map((file) => file.path), V2_MAIN_PATH, MANIFEST_PATH,
    ]);
    if (expectedFiles.length !== actualFiles.size
        || expectedFiles.some((file) => !actualFiles.has(file))) {
        throw new Error(`Generated file inventory differs from expectedGeneratedFiles:\nexpected ${JSON.stringify(expectedFiles)}\nactual ${JSON.stringify([...actualFiles])}`);
    }

    const manifest: SocManifest = {
        files: Object.freeze(expectedFiles
            .filter((file) => file !== MANIFEST_PATH)
            .map((file): ManifestFileRecord => {
                if (file === V2_MAIN_PATH) {
                    return {
                        kind: 'scaffold/user-owned',
                        logicalSource: 'templates/main.c.tpl',
                        path: V2_MAIN_PATH,
                    };
                }
                const generated = generatedFiles.find((candidate) => candidate.path === file);
                if (generated === undefined) {
                    throw new Error(`Expected generated file has no content: ${file}`);
                }
                return {
                    kind: generated.kind,
                    logicalSource: generated.logicalSource,
                    path: generated.path,
                    sha256: sha256(generated.content),
                };
            })),
        generatorVersion,
        manifestFile: {
            hashPolicy: 'excluded-self',
            kind: 'control/manifest',
            path: MANIFEST_PATH,
        },
        manifestVersion: 2,
        projectName: plan.projectName,
        resourceRevision,
        sourceConfig: portablePath(configFile),
    };
    return {
        expectedFiles,
        generatedFiles,
        mainFile,
        manifest,
        manifestText: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8'),
        outputDir: plan.outputDir,
        warnings: diagnostics.filter((item) => item.severity === 'warning'),
    };
}

function renderGeneratedFiles(
    plan: SocPlan,
    assetRoot: string,
    sourceRoot: string,
    readmeTemplate: string,
    sourceIdentity: string,
    generatorVersion: string,
    resourceRevision: string,
): GeneratedFile[] {
    const rtlBundle = renderRtlBundle(
        plan, (logicalPath) => requireAssetFile(assetRoot, logicalPath));
    const result: GeneratedFile[] = [
        generatedFile(`hardware/${plan.topModule}.v`, rtlBundle.content,
            'generator:renderRtlBundle', 'generated/rtl-bundle'),
    ];
    for (const [slot, memory] of [['ilb', plan.memory.ilb], ['dlb', plan.memory.dlb]] as const) {
        if (memory.initFile === undefined) continue;
        result.push(generatedFile(`firmware/${memory.initFile.outputName}`,
            readRequiredFile(memory.initFile.source, sourceRoot,
                `${slot} memory initialization file`),
            `config:memory.${slot}.initFile`, 'source/firmware'));
    }
    result.push(
        generatedFile(`software/${headerFileName(plan)}`, renderSocHeader(plan),
            'generator:renderSocHeader', 'generated/software-header'),
        generatedFile('README.md', renderGeneratedReadme(
            plan, {
                sourceIdentity,
                generatorVersion,
                resourceRevision,
                integration: [
                    `Compile with \`iverilog -g2005 -s ${plan.topModule} hardware/${plan.topModule}.v\`.`,
                    `Edit \`software/main.c\` and include \`software/${headerFileName(plan)}\`.`,
                ],
                outputFiles: expectedGeneratedFiles(plan),
                rtlSources: rtlBundle.logicalSources,
            }, readmeTemplate),
            'templates/README.md.tpl', 'generated/documentation'),
    );
    return result;
}

function inspectTarget(
    outputDir: string,
    previous: SocManifest | undefined,
    desiredManaged: ReadonlyMap<string, GeneratedFile>,
    adopting: boolean,
    force: boolean,
): TargetInspection {
    const conflicts: SocFileConflict[] = [];
    const replacePaths = new Map<string, InspectedTargetState>();
    const stalePaths = new Map<string, InspectedTargetState>();
    const previousManaged = new Map<string, ManifestManagedRecord>();
    if (previous !== undefined) {
        for (const record of previous.files) {
            if (isManagedRecord(record)) previousManaged.set(record.path, record);
        }
    }

    const existingEntries = listOutputEntries(outputDir);
    const existingByCase = new Map(existingEntries.map((entry) => [
        entry.path.toLocaleLowerCase('en-US'), entry,
    ]));
    const desiredPaths = [...desiredManaged.keys(), V2_MAIN_PATH, MANIFEST_PATH];
    const desiredPathsAndParents = new Set<string>();
    const desiredDirectories = new Set<string>();
    for (const desiredPath of desiredPaths) {
        const components = desiredPath.split('/');
        for (let length = 1; length <= components.length; length += 1) {
            const candidate = components.slice(0, length).join('/');
            desiredPathsAndParents.add(candidate);
            if (length < components.length) desiredDirectories.add(candidate);
        }
    }
    for (const desiredPath of desiredPathsAndParents) {
        const existing = existingByCase.get(desiredPath.toLocaleLowerCase('en-US'));
        if (existing !== undefined && (existing.path !== desiredPath
            || existing.linked
            || (desiredDirectories.has(desiredPath) && !existing.directory))) {
            conflicts.push({ path: existing.path, reason: 'modified-managed' });
        }
    }
    const mainTarget = generatedPath(outputDir, V2_MAIN_PATH);
    try {
        if (!fs.lstatSync(mainTarget).isFile()) {
            conflicts.push({ path: V2_MAIN_PATH, reason: 'modified-managed' });
        }
    } catch (error) {
        if (!isMissingPathError(error)) throw error;
    }

    for (const [relativePath, oldRecord] of previousManaged) {
        const target = generatedPath(outputDir, relativePath);
        const desired = desiredManaged.get(relativePath);
        if (!fs.existsSync(target)) {
            if (desired !== undefined) replacePaths.set(relativePath, { kind: 'missing' });
            continue;
        }
        const status = fs.lstatSync(target, { bigint: true });
        if (!status.isFile()) {
            conflicts.push({
                path: relativePath,
                reason: desiredManaged.has(relativePath) ? 'modified-managed' : 'modified-stale',
            });
            continue;
        }
        const inspectedHash = sha256File(target);
        if (inspectedHash === oldRecord.sha256) {
            if (desired === undefined) {
                if (oldRecord.kind === 'source/firmware') {
                    conflicts.push({ path: relativePath, reason: 'modified-stale' });
                } else {
                    stalePaths.set(relativePath, {
                        kind: 'regular-file',
                        sha256: inspectedHash,
                        identity: identityOf(status),
                    });
                }
            } else if (oldRecord.sha256 !== sha256(desired.content)) {
                replacePaths.set(relativePath, {
                    kind: 'regular-file',
                    sha256: inspectedHash,
                    identity: identityOf(status),
                });
            }
            continue;
        }
        const reason = desiredManaged.has(relativePath) ? 'modified-managed' : 'modified-stale';
        if (reason === 'modified-stale' || adopting || !force) {
            conflicts.push({ path: relativePath, reason });
        } else {
            replacePaths.set(relativePath, {
                kind: 'regular-file',
                sha256: inspectedHash,
                identity: identityOf(status),
            });
        }
    }

    for (const relativePath of desiredManaged.keys()) {
        const target = generatedPath(outputDir, relativePath);
        if (!fs.existsSync(target) || previousManaged.has(relativePath)) continue;
        conflicts.push({ path: relativePath, reason: 'modified-managed' });
    }
    for (const relativePath of desiredManaged.keys()) {
        if (!previousManaged.has(relativePath)
            && !fs.existsSync(generatedPath(outputDir, relativePath))) {
            replacePaths.set(relativePath, { kind: 'missing' });
        }
    }
    return {
        conflicts: deduplicateConflicts(conflicts),
        replacePaths: [...desiredManaged.keys()].filter((candidate) => replacePaths.has(candidate))
            .map((candidate) => ({ path: candidate, expected: replacePaths.get(candidate)! })),
        stalePaths: [...stalePaths.keys()].sort()
            .map((candidate) => ({ path: candidate, expected: stalePaths.get(candidate)! })),
    };
}

function inspectRegularTarget(target: string): InspectedTargetState {
    try {
        const status = fs.lstatSync(target, { bigint: true });
        if (!status.isFile()) throw new Error(`Generated target is not a regular file: ${target}`);
        return {
            kind: 'regular-file',
            sha256: sha256File(target),
            identity: identityOf(status),
        };
    } catch (error) {
        if (isMissingPathError(error)) return { kind: 'missing' };
        throw error;
    }
}

function readExistingManifest(outputDir: string): ExistingManifest | undefined {
    const manifestFile = generatedPath(outputDir, MANIFEST_PATH);
    if (!fs.existsSync(manifestFile)) return undefined;
    try {
        assertPathHasNoLinks(manifestFile);
        const content = fs.readFileSync(manifestFile);
        const value = JSON.parse(content.toString('utf8')) as unknown;
        return {
            manifest: parseSocManifest(value),
            state: {
                kind: 'regular-file',
                sha256: sha256(content),
                identity: identityOf(fs.lstatSync(manifestFile, { bigint: true })),
            },
        };
    } catch (error) {
        throw diagnosticFailure('SOC_MANIFEST', error);
    }
}

function listOutputEntries(
    root: string,
    relative = '',
): { path: string; directory: boolean; linked: boolean }[] {
    if (!fs.existsSync(root)) return [];
    const directory = path.join(root, relative);
    const status = fs.lstatSync(directory);
    if (!status.isDirectory() || status.isSymbolicLink()) {
        return [{ path: normalizeGeneratedPath(relative), directory: false, linked: status.isSymbolicLink() }];
    }
    const result: { path: string; directory: boolean; linked: boolean }[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = normalizeGeneratedPath(relative === '' ? entry.name : `${relative}/${entry.name}`);
        result.push({
            path: child,
            directory: entry.isDirectory(),
            linked: entry.isSymbolicLink(),
        });
        if (entry.isDirectory()) result.push(...listOutputEntries(root, child));
    }
    return result;
}

function generatedFile(
    relativePath: string,
    content: string | Buffer,
    logicalSource: string,
    kind: string,
): GeneratedFile {
    return {
        path: normalizeGeneratedPath(relativePath),
        content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'),
        logicalSource,
        kind,
    };
}

function requireAssetFile(assetRoot: string, logicalPath: string): Buffer {
    try {
        const normalized = normalizeGeneratedPath(logicalPath);
        let current = assetRoot;
        for (const component of normalized.split('/')) {
            assertPathHasNoLinks(current);
            if (!fs.existsSync(current) || !fs.lstatSync(current).isDirectory()
                || !fs.readdirSync(current).includes(component)) {
                throw new Error(`Missing asset or case mismatch: ${normalized}`);
            }
            current = path.join(current, component);
        }
        assertPathContained(assetRoot, current, 'Asset path');
        assertPathHasNoLinks(current);
        if (!fs.lstatSync(current).isFile()) throw new Error(`Asset is not a file: ${normalized}`);
        return fs.readFileSync(current);
    } catch (error) {
        if (error instanceof SocGenerationError) throw error;
        throw diagnosticFailure('SOC_ASSET', error);
    }
}

function assertAssetTreeHasNoLinks(root: string, relative = ''): void {
    const directory = relative === '' ? root : generatedPath(root, relative);
    assertPathHasNoLinks(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = relative === '' ? entry.name : `${relative}/${entry.name}`;
        const childPath = generatedPath(root, child);
        assertPathHasNoLinks(childPath);
        if (fs.lstatSync(childPath).isDirectory()) assertAssetTreeHasNoLinks(root, child);
    }
}

function readResourceRevision(assetRoot: string): string {
    const file = requireAssetFile(assetRoot, 'resource-manifest.json');
    let value: unknown;
    try {
        value = JSON.parse(file.toString('utf8')) as unknown;
    } catch (error) {
        throw new Error(`Invalid resource-manifest.json: ${(error as Error).message}`);
    }
    if (!isObject(value)) throw new Error('resource-manifest.json must contain an object.');
    const revision = [value.resourceRevision, value.sourceRevision, value.gitRevision, value.revision]
        .find((candidate) => typeof candidate === 'string' && candidate.length > 0);
    if (typeof revision !== 'string') {
        throw new Error('resource-manifest.json does not declare a resource revision.');
    }
    return revision;
}

function readGeneratorVersion(): string {
    const packageFile = path.resolve(__dirname, '..', '..', 'package.json');
    const value = JSON.parse(fs.readFileSync(packageFile, 'utf8')) as unknown;
    if (!isObject(value) || typeof value.version !== 'string') {
        throw new Error('Extension package.json does not declare a version.');
    }
    return value.version;
}

function canonicalExistingFile(value: string, label: string): string {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved)) {
        throw diagnosticFailure('SOC_INPUT', new Error(`Missing ${label}: ${resolved}`));
    }
    try {
        assertPathHasNoLinks(resolved);
    } catch (error) {
        throw diagnosticFailure('SOC_INPUT', error);
    }
    if (!fs.lstatSync(resolved).isFile()) {
        throw diagnosticFailure('SOC_INPUT', new Error(`Missing ${label}: ${resolved}`));
    }
    return fs.realpathSync.native(resolved);
}

function canonicalExistingDirectory(value: string, label: string): string {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved)) {
        throw diagnosticFailure('SOC_ASSET', new Error(`Missing ${label}: ${resolved}`));
    }
    try {
        assertPathHasNoLinks(resolved);
    } catch (error) {
        throw diagnosticFailure('SOC_ASSET', error);
    }
    if (!fs.lstatSync(resolved).isDirectory()) {
        throw diagnosticFailure('SOC_ASSET', new Error(`Missing ${label}: ${resolved}`));
    }
    return fs.realpathSync.native(resolved);
}

function readRequiredFile(file: string, allowedRoot: string, label: string): Buffer {
    assertPathContained(allowedRoot, file, label);
    assertPathHasNoLinks(file);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) {
        throw new Error(`Missing ${label}: ${file}`);
    }
    return fs.readFileSync(file);
}

function portablePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function sameCanonicalPath(left: string, right: string): boolean {
    return process.platform === 'win32'
        ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
        : left === right;
}

function isManagedRecord(record: ManifestFileRecord): record is ManifestManagedRecord {
    return record.kind !== 'scaffold/user-owned';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
    return isObject(error) && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
}

function deduplicateConflicts(conflicts: readonly SocFileConflict[]): SocFileConflict[] {
    const seen = new Set<string>();
    return conflicts.filter((conflict) => {
        const key = `${conflict.reason}\0${conflict.path.toLocaleLowerCase('en-US')}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).sort((left, right) => left.path.localeCompare(right.path));
}

function diagnosticFailure(code: string, error: unknown): SocGenerationError {
    const message = error instanceof Error ? error.message : String(error);
    return new SocGenerationError(message, [{
        severity: 'error',
        code,
        path: [],
        message,
    }], [], error);
}

function generationFailure(error: unknown): SocGenerationError {
    return diagnosticFailure('SOC_GENERATION', error);
}

function recoveryFailure(error: ActivationRecoveryError): SocGenerationError {
    const message = `${error.message} Recovery failures: ${error.failures
        .map((failure) => failure.message).join('; ')}`;
    return new SocGenerationError(message, [{
        severity: 'error',
        code: 'SOC_RECOVERY_INCOMPLETE',
        path: [],
        message,
    }], [], error, { path: error.recoveryPath, failures: error.failures });
}
