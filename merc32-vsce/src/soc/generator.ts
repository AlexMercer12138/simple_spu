import * as fs from 'fs';
import * as path from 'path';

import {
    activateStagedFiles,
    assertNoCaseInsensitivePathCollisions,
    createSiblingStagingDirectory,
    generatedPath,
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
    renderAddressMap,
    renderGeneratedReadme,
    renderResolvedConfig,
    renderSocHeader,
    renderStarterMain,
} from './emitSoftware';
import { renderApbInterconnect, renderPlbRouter, renderSocTop } from './emitVerilog';
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

    constructor(
        message: string,
        diagnostics: readonly SocDiagnostic[] = [],
        conflicts: readonly SocFileConflict[] = [],
        cause?: unknown,
    ) {
        super(message);
        this.name = 'SocGenerationError';
        this.diagnostics = Object.freeze([...diagnostics]);
        this.conflicts = Object.freeze([...conflicts]);
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

interface ManifestManagedRecord {
    kind: string;
    logicalSource: string;
    path: string;
    sha256: string;
}

interface ManifestUserRecord {
    kind: 'scaffold/user-owned';
    logicalSource: string;
    path: 'software/src/main.c';
}

type ManifestFileRecord = ManifestManagedRecord | ManifestUserRecord;

interface SocManifest {
    files: readonly ManifestFileRecord[];
    generatorVersion: string;
    manifestVersion: 1;
    projectName: string;
    resourceRevision: string;
    sourceConfig: string;
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

const MAIN_PATH = 'software/src/main.c' as const;
const MANIFEST_PATH = 'manifest.json';

/** Generates a complete SoC without depending on the VSCode API. */
export function generateSoc(options: GenerateSocOptions): GenerateSocResult {
    let stagingDir: string | undefined;
    try {
        const prepared = prepareGeneration(options);
        const previous = readExistingManifest(prepared.outputDir);
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

        stagingDir = createSiblingStagingDirectory(prepared.outputDir);
        const stagedFiles: StagedFile[] = prepared.generatedFiles.map((file) => ({
            path: file.path,
            content: file.content,
        }));
        stagedFiles.push({ path: MAIN_PATH, content: prepared.mainFile.content });
        stagedFiles.push({ path: MANIFEST_PATH, content: prepared.manifestText });
        writeStagedFiles(stagingDir, stagedFiles);

        const mainExists = fs.existsSync(generatedPath(prepared.outputDir, MAIN_PATH));
        const manifestFile = generatedPath(prepared.outputDir, MANIFEST_PATH);
        const replaceManifest = !fs.existsSync(manifestFile)
            || !fs.statSync(manifestFile).isFile()
            || !fs.readFileSync(manifestFile).equals(prepared.manifestText);
        activateStagedFiles({
            outputDir: prepared.outputDir,
            stagingDir,
            replacePaths: [
                ...inspection.replacePaths,
                ...(replaceManifest ? [MANIFEST_PATH] : []),
            ],
            createOnlyPaths: mainExists ? [] : [MAIN_PATH],
            removePaths: inspection.stalePaths,
        });

        return Object.freeze({
            outputDir: prepared.outputDir,
            manifestFile: generatedPath(prepared.outputDir, MANIFEST_PATH),
            files: Object.freeze([...prepared.expectedFiles]),
            warnings: Object.freeze([...prepared.warnings]),
            skippedUserFiles: Object.freeze(mainExists ? [MAIN_PATH] : []),
        });
    } catch (error) {
        if (error instanceof SocGenerationError) throw error;
        throw generationFailure(error);
    } finally {
        if (stagingDir !== undefined) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
        }
    }
}

function prepareGeneration(options: GenerateSocOptions): PreparedGeneration {
    const configFile = canonicalExistingFile(options.configFile, 'configuration');
    const assetRoot = canonicalExistingDirectory(options.assetRoot, 'asset root');
    let catalog;
    try {
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
    const readmeTemplate = requireAssetFile(assetRoot, 'templates/README.md.tpl').toString('utf8');
    const mainTemplate = requireAssetFile(assetRoot, 'templates/main.c.tpl').toString('utf8');
    const generatedFiles = renderGeneratedFiles(plan, assetRoot, readmeTemplate, portablePath(configFile));
    const mainFile = generatedFile(
        MAIN_PATH,
        renderStarterMain(plan, mainTemplate),
        'templates/main.c.tpl',
        'scaffold/user-owned',
    );
    const expectedFiles = expectedGeneratedFiles(plan).map(normalizeGeneratedPath);
    assertNoCaseInsensitivePathCollisions(expectedFiles);
    const actualFiles = new Set([...generatedFiles.map((file) => file.path), MAIN_PATH, MANIFEST_PATH]);
    if (expectedFiles.length !== actualFiles.size
        || expectedFiles.some((file) => !actualFiles.has(file))) {
        throw new Error(`Generated file inventory differs from expectedGeneratedFiles:\nexpected ${JSON.stringify(expectedFiles)}\nactual ${JSON.stringify([...actualFiles])}`);
    }

    const manifest: SocManifest = {
        files: Object.freeze(expectedFiles
            .filter((file) => file !== MANIFEST_PATH)
            .map((file): ManifestFileRecord => {
                if (file === MAIN_PATH) {
                    return {
                        kind: 'scaffold/user-owned',
                        logicalSource: 'templates/main.c.tpl',
                        path: MAIN_PATH,
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
        generatorVersion: readGeneratorVersion(),
        manifestVersion: 1,
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
    readmeTemplate: string,
    sourceIdentity: string,
): GeneratedFile[] {
    const result: GeneratedFile[] = [
        generatedFile(`rtl/${plan.topModule}.v`, renderSocTop(plan),
            'generator:renderSocTop', 'generated/rtl'),
        generatedFile(`rtl/generated/${plan.topModule}_plb_router.v`, renderPlbRouter(plan),
            'generator:renderPlbRouter', 'generated/rtl'),
    ];
    const apb = renderApbInterconnect(plan);
    if (apb !== undefined) {
        result.push(generatedFile(`rtl/generated/${plan.topModule}_apb_interconnect.v`, apb,
            'generator:renderApbInterconnect', 'generated/rtl'));
    }
    for (const logicalPath of plan.rtlFiles) {
        result.push(generatedFile(logicalPath, requireAssetFile(assetRoot, logicalPath),
            logicalPath, 'asset/rtl'));
    }
    const rtlFiles = result.filter((file) => file.path.startsWith('rtl/') && file.path.endsWith('.v'))
        .map((file) => file.path.slice('rtl/'.length))
        .sort();
    result.push(generatedFile('rtl/files.f', `${rtlFiles.join('\n')}\n`,
        'generator:rtlFiles', 'generated/rtl-file-list'));
    for (const [slot, memory] of [['ilb', plan.memory.ilb], ['dlb', plan.memory.dlb]] as const) {
        if (memory.initFile === undefined) continue;
        result.push(generatedFile(`memory/${memory.initFile.outputName}`,
            readRequiredFile(memory.initFile.source, `${slot} memory initialization file`),
            `config:memory.${slot}.initFile`, 'source/memory-init'));
    }
    result.push(
        generatedFile(`software/include/${headerFileName(plan)}`, renderSocHeader(plan),
            'generator:renderSocHeader', 'generated/software-header'),
        generatedFile(`config/${plan.projectName}.resolved.json`, renderResolvedConfig(plan),
            'generator:renderResolvedConfig', 'generated/config'),
        generatedFile('address-map.json', renderAddressMap(plan),
            'generator:renderAddressMap', 'generated/address-map'),
        generatedFile('README.md', renderGeneratedReadme(
            plan, readmeTemplate, sourceIdentity),
            'templates/README.md.tpl', 'generated/documentation'),
        generatedFile('LICENSE', requireAssetFile(assetRoot, 'licenses/LICENSE'),
            'licenses/LICENSE', 'asset/license'),
    );
    return result;
}

function inspectTarget(
    outputDir: string,
    previous: SocManifest | undefined,
    desiredManaged: ReadonlyMap<string, GeneratedFile>,
    adopting: boolean,
    force: boolean,
): { conflicts: SocFileConflict[]; replacePaths: string[]; stalePaths: string[] } {
    const conflicts: SocFileConflict[] = [];
    const replacePaths = new Set<string>();
    const stalePaths: string[] = [];
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
    const desiredPaths = [...desiredManaged.keys(), MAIN_PATH, MANIFEST_PATH];
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
            || (desiredDirectories.has(desiredPath) && !existing.directory))) {
            conflicts.push({ path: existing.path, reason: 'modified-managed' });
        }
    }

    for (const [relativePath, oldRecord] of previousManaged) {
        const target = generatedPath(outputDir, relativePath);
        const desired = desiredManaged.get(relativePath);
        if (!fs.existsSync(target)) {
            if (desired !== undefined) replacePaths.add(relativePath);
            continue;
        }
        if (!fs.statSync(target).isFile()) {
            conflicts.push({
                path: relativePath,
                reason: desiredManaged.has(relativePath) ? 'modified-managed' : 'modified-stale',
            });
            continue;
        }
        if (sha256File(target) === oldRecord.sha256) {
            if (desired === undefined) {
                stalePaths.push(relativePath);
            } else if (oldRecord.sha256 !== sha256(desired.content)) {
                replacePaths.add(relativePath);
            }
            continue;
        }
        const reason = desiredManaged.has(relativePath) ? 'modified-managed' : 'modified-stale';
        if (reason === 'modified-stale' || adopting || !force) {
            conflicts.push({ path: relativePath, reason });
        } else {
            replacePaths.add(relativePath);
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
            replacePaths.add(relativePath);
        }
    }
    return {
        conflicts: deduplicateConflicts(conflicts),
        replacePaths: [...desiredManaged.keys()].filter((candidate) => replacePaths.has(candidate)),
        stalePaths: [...new Set(stalePaths)].sort(),
    };
}

function readExistingManifest(outputDir: string): SocManifest | undefined {
    const manifestFile = generatedPath(outputDir, MANIFEST_PATH);
    if (!fs.existsSync(manifestFile)) return undefined;
    try {
        const value = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as unknown;
        return validateManifest(value);
    } catch (error) {
        throw diagnosticFailure('SOC_MANIFEST', error);
    }
}

function validateManifest(value: unknown): SocManifest {
    if (!isObject(value) || value.manifestVersion !== 1
        || typeof value.projectName !== 'string'
        || typeof value.sourceConfig !== 'string'
        || typeof value.generatorVersion !== 'string'
        || typeof value.resourceRevision !== 'string'
        || !Array.isArray(value.files)) {
        throw new Error('Existing manifest has an unsupported shape.');
    }
    const records: ManifestFileRecord[] = value.files.map((record): ManifestFileRecord => {
        if (!isObject(record) || typeof record.path !== 'string'
            || typeof record.kind !== 'string' || typeof record.logicalSource !== 'string') {
            throw new Error('Existing manifest contains an invalid file record.');
        }
        const recordPath = normalizeGeneratedPath(record.path);
        if (record.kind === 'scaffold/user-owned') {
            if (recordPath !== MAIN_PATH || record.sha256 !== undefined) {
                throw new Error('Existing user-owned scaffold record is invalid.');
            }
            return {
                kind: 'scaffold/user-owned',
                logicalSource: record.logicalSource,
                path: MAIN_PATH,
            };
        }
        if (recordPath === MANIFEST_PATH || !isSha256(record.sha256)) {
            throw new Error('Existing managed file record is invalid.');
        }
        return {
            kind: record.kind,
            logicalSource: record.logicalSource,
            path: recordPath,
            sha256: record.sha256,
        };
    });
    assertNoCaseInsensitivePathCollisions(records.map((record) => record.path));
    return {
        files: records,
        generatorVersion: value.generatorVersion,
        manifestVersion: 1,
        projectName: value.projectName,
        resourceRevision: value.resourceRevision,
        sourceConfig: value.sourceConfig,
    };
}

function listOutputEntries(root: string, relative = ''): { path: string; directory: boolean }[] {
    if (!fs.existsSync(root)) return [];
    const directory = path.join(root, relative);
    if (!fs.statSync(directory).isDirectory()) {
        return [{ path: normalizeGeneratedPath(relative), directory: false }];
    }
    const result: { path: string; directory: boolean }[] = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = normalizeGeneratedPath(relative === '' ? entry.name : `${relative}/${entry.name}`);
        result.push({ path: child, directory: entry.isDirectory() });
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
    const normalized = normalizeGeneratedPath(logicalPath);
    let current = assetRoot;
    for (const component of normalized.split('/')) {
        if (!fs.existsSync(current) || !fs.statSync(current).isDirectory()
            || !fs.readdirSync(current).includes(component)) {
            throw new Error(`Missing asset or case mismatch: ${normalized}`);
        }
        current = path.join(current, component);
    }
    if (!fs.statSync(current).isFile()) throw new Error(`Asset is not a file: ${normalized}`);
    return fs.readFileSync(current);
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
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
        throw diagnosticFailure('SOC_INPUT', new Error(`Missing ${label}: ${resolved}`));
    }
    return fs.realpathSync.native(resolved);
}

function canonicalExistingDirectory(value: string, label: string): string {
    const resolved = path.resolve(value);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
        throw diagnosticFailure('SOC_ASSET', new Error(`Missing ${label}: ${resolved}`));
    }
    return fs.realpathSync.native(resolved);
}

function readRequiredFile(file: string, label: string): Buffer {
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
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

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
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
