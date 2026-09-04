import * as fs from 'fs';
import * as path from 'path';

export interface SourceCandidate {
    readonly path: string;
    readonly includingPath?: string;
    readonly includeKind: 'quoted' | 'angle';
}

export type SourceResolution =
    | Readonly<{ status: 'found'; canonicalPath: string; source: string }>
    | Readonly<{ status: 'not-found' }>
    | Readonly<{ status: 'error'; message: string }>;

export interface SourceProvider {
    resolve(candidate: SourceCandidate): SourceResolution;
}

export interface VirtualSourceFile {
    readonly path: string;
    readonly source: string;
}

export interface SourceProviderSearchOptions {
    readonly includePaths?: readonly string[];
    readonly sourceName?: string;
}

export interface NodeSourceProviderOptions extends SourceProviderSearchOptions {
    readonly mainFile?: string;
    readonly mainDirectory?: string;
    readonly packagedHeaderRoot?: string;
    readonly readFile?: (file: string) => string;
    readonly realPath?: (file: string) => string;
}

export interface CPreprocessOptions {
    readonly readFile?: (file: string) => string;
    readonly realPath?: (file: string) => string;
    readonly maxIncludeDepth?: number;
}

export class SourceProviderError extends Error {
    public readonly name = 'SourceProviderError';

    public constructor(message: string) {
        super(message);
        Object.setPrototypeOf(this, new.target.prototype);
    }
}

export function normalizeLogicalPath(value: string): string | undefined {
    if (typeof value !== 'string' || value.length === 0 || value.includes('\0')) return undefined;
    if (value.includes('\\')) return undefined;
    const replaced = value;
    if (replaced.startsWith('/') || /^[A-Za-z]:\//u.test(replaced)) return undefined;
    const parts: string[] = [];
    for (const part of replaced.split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
            if (parts.length === 0) return undefined;
            parts.pop();
            continue;
        }
        parts.push(part);
    }
    return parts.length === 0 ? undefined : parts.join('/');
}

function isAbsoluteAny(value: string): boolean {
    return path.isAbsolute(value) || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)
        || /^[A-Za-z]:[\\/]/u.test(value);
}

function samePath(left: string, right: string): boolean {
    const a = path.normalize(left);
    const b = path.normalize(right);
    return process.platform === 'win32'
        ? a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US')
        : a === b;
}

function logicalKey(value: string): string {
    return process.platform === 'win32' ? value.toLocaleLowerCase('en-US') : value;
}

function isContained(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return relative === '' || (!path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function resolveSearchCandidates(
    candidate: SourceCandidate,
    includePaths: readonly string[],
    packagedHeaderRoot?: string,
): readonly string[] {
    if (isAbsoluteAny(candidate.path)) return [candidate.path];
    const normalizedCandidate = normalizeLogicalPath(candidate.path);
    if (normalizedCandidate === undefined) return [];
    const result: string[] = [];
    if (candidate.includeKind === 'quoted' && candidate.includingPath !== undefined) {
        const including = normalizeLogicalPath(candidate.includingPath);
        if (including !== undefined) {
            const directory = including.includes('/') ? including.slice(0, including.lastIndexOf('/')) : '';
            const relative = directory ? `${directory}/${normalizedCandidate}` : normalizedCandidate;
            const normalized = normalizeLogicalPath(relative);
            if (normalized !== undefined) result.push(normalized);
        }
    }
    if (candidate.includingPath === undefined) {
        result.push(normalizedCandidate);
    }
    for (const includePath of includePaths) {
        const root = normalizeLogicalPath(includePath);
        if (root !== undefined) {
            const joined = normalizeLogicalPath(`${root}/${normalizedCandidate}`);
            if (joined !== undefined) result.push(joined);
        }
    }
    if (packagedHeaderRoot !== undefined && !isAbsoluteAny(packagedHeaderRoot)) {
        const root = normalizeLogicalPath(packagedHeaderRoot);
        if (root !== undefined) {
            const joined = normalizeLogicalPath(`${root}/${normalizedCandidate}`);
            if (joined !== undefined) result.push(joined);
        }
    }
    return [...new Set(result)];
}

export class MemorySourceProvider implements SourceProvider {
    private readonly files = new Map<string, string>();
    private readonly includePaths: readonly string[];
    private readonly sourceName?: string;

    public constructor(
        filesOrOptions: readonly VirtualSourceFile[] | {
            readonly virtualFiles?: readonly VirtualSourceFile[];
            readonly includePaths?: readonly string[];
            readonly sourceName?: string;
        } = [],
        searchOptions: SourceProviderSearchOptions = {},
    ) {
        let options: {
            readonly virtualFiles?: readonly VirtualSourceFile[];
            readonly includePaths?: readonly string[];
            readonly sourceName?: string;
        };
        if (Array.isArray(filesOrOptions)) {
            options = { virtualFiles: filesOrOptions as readonly VirtualSourceFile[], ...searchOptions };
        } else {
            options = filesOrOptions as {
                readonly virtualFiles?: readonly VirtualSourceFile[];
                readonly includePaths?: readonly string[];
                readonly sourceName?: string;
            };
        }
        this.includePaths = Object.freeze((options.includePaths ?? []).map((item) => {
            const normalized = normalizeLogicalPath(item);
            if (normalized === undefined) throw new SourceProviderError(`invalid logical include path: ${item}`);
            return normalized;
        }));
        if (options.sourceName !== undefined) {
            const sourceName = normalizeLogicalPath(options.sourceName);
            if (sourceName === undefined) throw new SourceProviderError(`invalid logical source name: ${options.sourceName}`);
            this.sourceName = sourceName;
        } else {
            this.sourceName = undefined;
        }
        for (const file of options.virtualFiles ?? []) {
            const normalized = normalizeLogicalPath(file.path);
            if (normalized === undefined) throw new SourceProviderError(`invalid virtual file path: ${file.path}`);
            if (this.files.has(logicalKey(normalized))) throw new SourceProviderError(`duplicate virtual file path: ${normalized}`);
            this.files.set(logicalKey(normalized), file.source);
        }
    }

    public resolve(candidate: SourceCandidate): SourceResolution {
        for (const logicalPath of this.getSearchCandidates(candidate)) {
            const source = this.files.get(logicalKey(logicalPath));
            if (source !== undefined) return { status: 'found', canonicalPath: logicalPath, source };
        }
        return { status: 'not-found' };
    }

    public resolveExact(logicalPath: string): SourceResolution {
        const normalized = normalizeLogicalPath(logicalPath);
        if (normalized === undefined) return { status: 'not-found' };
        const source = this.files.get(logicalKey(normalized));
        return source === undefined
            ? { status: 'not-found' }
            : { status: 'found', canonicalPath: normalized, source };
    }

    public getSourceName(): string | undefined {
        return this.sourceName;
    }

    public getSearchCandidates(candidate: SourceCandidate): readonly string[] {
        return resolveSearchCandidates(candidate, this.includePaths);
    }
}

export class NodeSourceProvider implements SourceProvider {
    private readonly mainFile: string;
    private readonly mainDirectory: string;
    private readonly includePaths: readonly string[];
    private readonly includeLogicalNames: readonly string[];
    private readonly packagedHeaderRoot?: string;
    private readonly readFile: (file: string) => string;
    private readonly realPath: (file: string) => string;
    private readonly mainCanonical: string;
    private readonly roots: readonly string[];

    public constructor(optionsOrMainFile: NodeSourceProviderOptions | string,
        includePaths: readonly string[] = [], packagedHeaderRoot?: string) {
        const options: NodeSourceProviderOptions = typeof optionsOrMainFile === 'string'
            ? { mainFile: optionsOrMainFile, includePaths, packagedHeaderRoot }
            : optionsOrMainFile;
        this.readFile = options.readFile ?? ((file) => fs.readFileSync(file, 'utf8'));
        this.realPath = options.realPath ?? ((file) => fs.realpathSync.native(file));
        const mainFile = options.mainFile
            ?? (options.mainDirectory === undefined ? undefined : path.join(options.mainDirectory, 'main.c'));
        if (mainFile === undefined) throw new SourceProviderError('mainFile or mainDirectory is required');
        this.mainFile = path.resolve(mainFile);
        this.mainDirectory = path.dirname(this.mainFile);
        this.mainCanonical = this.canonicalize(this.mainFile);
        this.includePaths = Object.freeze((options.includePaths ?? []).map((item) => path.resolve(item)));
        const usedNames = new Set<string>();
        this.includeLogicalNames = Object.freeze(this.includePaths.map((item, index) => {
            const base = normalizeLogicalPath(path.basename(item)) ?? `include${index}`;
            let name = base;
            let suffix = 1;
            while (usedNames.has(name)) name = `${base}${suffix++}`;
            usedNames.add(name);
            return name;
        }));
        this.packagedHeaderRoot = options.packagedHeaderRoot === undefined
            ? undefined : path.resolve(options.packagedHeaderRoot);
        this.roots = Object.freeze([
            this.mainDirectory,
            ...this.includePaths,
            ...(this.packagedHeaderRoot === undefined ? [] : [this.packagedHeaderRoot]),
        ].map((root) => this.canonicalize(root, true)));
    }

    public getMainPath(): string {
        return this.mainCanonical;
    }

    public getMainLogicalPath(): string {
        return this.logicalPathFor(this.mainCanonical) ?? path.basename(this.mainCanonical);
    }

    public readMain(): string {
        return this.readFile(this.mainCanonical);
    }

    public getIncludeLogicalPaths(): readonly string[] {
        return this.includeLogicalNames;
    }

    public getPackagedLogicalPath(): string | undefined {
        return this.packagedHeaderRoot === undefined ? undefined : 'packaged';
    }

    public resolve(candidate: SourceCandidate): SourceResolution {
        const candidates = this.getSearchCandidates(candidate);
        if (candidates.length === 0) {
            if (!isAbsoluteAny(candidate.path)) return { status: 'not-found' };
            return this.resolveAbsolute(candidate.path);
        }
        for (const logicalPath of candidates) {
            const absolute = isAbsoluteAny(logicalPath)
                ? logicalPath : this.absoluteForLogical(logicalPath);
            const result = this.resolveAbsolute(absolute, logicalPath);
            if (result.status !== 'not-found') return result;
        }
        return { status: 'not-found' };
    }

    public getSearchCandidates(candidate: SourceCandidate): readonly string[] {
        return resolveSearchCandidates(
            candidate,
            this.includeLogicalNames,
            this.packagedHeaderRoot === undefined ? undefined : this.logicalRootFor(this.packagedHeaderRoot),
        );
    }

    public resolveExact(logicalPath: string): SourceResolution {
        const normalized = normalizeLogicalPath(logicalPath);
        if (normalized === undefined) return { status: 'not-found' };
        return this.resolveAbsolute(this.absoluteForLogical(normalized), normalized);
    }

    private resolveAbsolute(requested: string, logicalHint?: string): SourceResolution {
        const absolute = path.resolve(requested);
        let canonical: string;
        try {
            canonical = this.canonicalize(absolute);
        } catch {
            return { status: 'not-found' };
        }
        if (!this.roots.some((root) => isContained(root, canonical))) {
            return { status: 'error', message: `source path escapes an allowed include root: ${requested}` };
        }
        let status: fs.Stats;
        try {
            status = fs.statSync(canonical);
        } catch {
            return { status: 'not-found' };
        }
        if (!status.isFile()) return { status: 'not-found' };
        let source: string;
        try {
            source = this.readFile(canonical);
        } catch (error) {
            return { status: 'error', message: `cannot read source file: ${String(error)}` };
        }
        const canonicalPath = this.logicalPathFor(canonical) ?? logicalHint;
        if (canonicalPath === undefined) {
            return { status: 'error', message: `source path has no logical include name: ${canonical}` };
        }
        return { status: 'found', canonicalPath, source };
    }

    private canonicalize(file: string, tolerateMissing = false): string {
        try {
            return path.resolve(this.realPath(file));
        } catch (error) {
            if (tolerateMissing) return path.resolve(file);
            throw error;
        }
    }

    private logicalRootFor(root: string): string {
        if (samePath(root, this.mainDirectory)) return '';
        const index = this.includePaths.findIndex((item) => samePath(item, root));
        if (index >= 0) return this.includeLogicalNames[index];
        return 'packaged';
    }

    private absoluteForLogical(logicalPath: string): string {
        const normalized = normalizeLogicalPath(logicalPath) ?? logicalPath;
        const segments = normalized.split('/');
        const rootName = segments[0];
        const includeIndex = rootName === undefined ? -1 : this.includeLogicalNames.indexOf(rootName);
        if (includeIndex >= 0) {
            segments.shift();
            return path.join(this.includePaths[includeIndex], ...segments);
        }
        if (/^include[0-9]+$/u.test(rootName ?? '')) {
            const index = Number(rootName!.slice('include'.length));
            if (index >= 0 && index < this.includePaths.length) {
                segments.shift();
                return path.join(this.includePaths[index], ...segments);
            }
        }
        if (segments[0] === 'packaged' && this.packagedHeaderRoot !== undefined) {
            return path.join(this.packagedHeaderRoot, ...segments.slice(1));
        }
        return path.join(this.mainDirectory, ...segments);
    }

    private logicalPathFor(file: string): string | undefined {
        const canonical = path.resolve(file);
        if (isContained(this.mainDirectory, canonical)) {
            return normalizeLogicalPath(path.relative(this.mainDirectory, canonical).replace(/\\/gu, '/'));
        }
        for (let index = 0; index < this.includePaths.length; index++) {
            if (isContained(this.includePaths[index], canonical)) {
                const relative = path.relative(this.includePaths[index], canonical).replace(/\\/gu, '/');
                return normalizeLogicalPath(`${this.includeLogicalNames[index]}/${relative}`);
            }
        }
        if (this.packagedHeaderRoot !== undefined && isContained(this.packagedHeaderRoot, canonical)) {
            const relative = path.relative(this.packagedHeaderRoot, canonical).replace(/\\/gu, '/');
            return normalizeLogicalPath(`packaged/${relative}`);
        }
        return undefined;
    }
}

export class CompositeSourceProvider implements SourceProvider {
    private readonly providers: readonly SourceProvider[];

    public constructor(...providers: readonly (SourceProvider | undefined)[]) {
        const supplied = providers.length === 1 && Array.isArray(providers[0])
            ? providers[0] as readonly (SourceProvider | undefined)[]
            : providers;
        this.providers = supplied.filter((provider): provider is SourceProvider => provider !== undefined);
    }

    public resolve(candidate: SourceCandidate): SourceResolution {
        const positional = this.providers.filter((provider): provider is SourceProvider & {
            getSearchCandidates(value: SourceCandidate): readonly string[];
            resolveExact(value: string): SourceResolution;
        } => typeof (provider as { getSearchCandidates?: unknown }).getSearchCandidates === 'function'
            && typeof (provider as { resolveExact?: unknown }).resolveExact === 'function');
        if (!isAbsoluteAny(candidate.path) && positional.length > 0) {
            const lists = positional.map((provider) => provider.getSearchCandidates(candidate));
            const count = Math.max(...lists.map((list) => list.length));
            for (let index = 0; index < count; index++) {
                for (let providerIndex = 0; providerIndex < positional.length; providerIndex++) {
                    const logicalPath = lists[providerIndex][index];
                    if (logicalPath === undefined) continue;
                    const result = positional[providerIndex].resolveExact(logicalPath);
                    if (result.status !== 'not-found') return result;
                }
            }
            for (const provider of this.providers) {
                if (positional.includes(provider as typeof positional[number])) continue;
                const result = provider.resolve(candidate);
                if (result.status !== 'not-found') return result;
            }
            return { status: 'not-found' };
        }
        for (const provider of this.providers) {
            const result = provider.resolve(candidate);
            if (result.status !== 'not-found') return result;
        }
        return { status: 'not-found' };
    }
}

export class CompatiblePreprocessSourceProvider implements SourceProvider {
    private readonly readFile: (file: string) => string;
    private readonly realPath: (file: string) => string;
    public readonly maxIncludeDepth: number;

    public constructor(options: CPreprocessOptions = {}) {
        const maxIncludeDepth = options.maxIncludeDepth ?? 32;
        if (!Number.isSafeInteger(maxIncludeDepth) || maxIncludeDepth < 1 || maxIncludeDepth > 32) {
            throw new SourceProviderError('maxIncludeDepth must be a finite safe integer in range 1..32');
        }
        this.maxIncludeDepth = maxIncludeDepth;
        this.readFile = options.readFile ?? ((file) => fs.readFileSync(file, 'utf8'));
        this.realPath = options.realPath ?? ((file) => fs.realpathSync.native(file));
    }

    public resolve(candidate: SourceCandidate): SourceResolution {
        const requested = isAbsoluteAny(candidate.path)
            ? [candidate.path]
            : candidate.includingPath !== undefined && candidate.includeKind === 'quoted'
                ? [path.resolve(path.dirname(candidate.includingPath), candidate.path), candidate.path]
                : [candidate.path];
        for (const file of requested) {
            let canonical: string;
            try {
                canonical = path.resolve(this.realPath(file));
            } catch {
                continue;
            }
            try {
                return { status: 'found', canonicalPath: canonical, source: this.readFile(canonical) };
            } catch (error) {
                return { status: 'error', message: `cannot read source file: ${String(error)}` };
            }
        }
        return { status: 'not-found' };
    }
}
