import * as fs from 'fs';
import * as path from 'path';

import { TypedCEnvelopeV1 } from './contract';
import { CFrontendLimits, HARD_C_FRONTEND_LIMITS } from './limits';
import { AroWasmHost } from './wasmHost';
import {
    CPreprocessOptions,
    CompositeSourceProvider,
    MemorySourceProvider,
    NodeSourceProvider,
    SourceProviderError,
    VirtualSourceFile,
    normalizeLogicalPath,
} from './sourceProvider';
import { CFrontendInternalError } from './validate';

export interface CFrontendOptions {
    readonly standard?: 'c17';
    readonly sourceName?: string;
    readonly defines?: Readonly<Record<string, string | undefined>>;
    readonly includePaths?: readonly string[];
    readonly virtualFiles?: readonly VirtualSourceFile[];
    readonly limits?: Partial<CFrontendLimits>;
}

export interface CFrontendRequest {
    readonly protocolVersion: 1;
    readonly mainPath: string;
    readonly source: string;
    readonly standard: 'c17';
    readonly defines: Readonly<Record<string, string | undefined>>;
    readonly includePaths: readonly string[];
    readonly virtualFiles: readonly VirtualSourceFile[];
    readonly limits: CFrontendLimits;
}

function utf8Length(value: string): number {
    return new TextEncoder().encode(value).length;
}

function normalizeLimit(name: keyof CFrontendLimits, value: number): number {
    const hard = HARD_C_FRONTEND_LIMITS[name];
    if (!Number.isSafeInteger(value) || value < 1 || value > hard) {
        throw new CFrontendInternalError(`${name} must be a safe integer in range 1..${hard}`);
    }
    return value;
}

const C_FRONTEND_LIMIT_KEYS: readonly (keyof CFrontendLimits)[] = Object.freeze([
    'fileBytes', 'totalSourceBytes', 'fileCount', 'includeDepth',
    'requestBytes', 'resultBytes', 'memoryBytes',
]);

function normalizeLimits(partial: Partial<CFrontendLimits> | undefined): CFrontendLimits {
    const result = { ...HARD_C_FRONTEND_LIMITS };
    if (partial !== undefined) {
        for (const key of Object.keys(partial)) {
            if (!(C_FRONTEND_LIMIT_KEYS as readonly string[]).includes(key)) {
                throw new CFrontendInternalError(`unknown c-frontend limit: ${key}`);
            }
            const limitKey = key as keyof CFrontendLimits;
            const value = partial[limitKey];
            if (value !== undefined) result[limitKey] = normalizeLimit(limitKey, value);
        }
    }
    return Object.freeze(result);
}

function normalizeVirtualFiles(files: readonly VirtualSourceFile[] | undefined): readonly VirtualSourceFile[] {
    const seen = new Set<string>();
    const normalized: VirtualSourceFile[] = [];
    for (const file of files ?? []) {
        const logicalPath = normalizeLogicalPath(file.path);
        if (logicalPath === undefined) throw new SourceProviderError(`invalid virtual file path: ${file.path}`);
        if (seen.has(logicalPath)) throw new SourceProviderError(`duplicate virtual file path: ${logicalPath}`);
        seen.add(logicalPath);
        if (typeof file.source !== 'string') throw new TypeError(`virtual file source must be a string: ${logicalPath}`);
        normalized.push(Object.freeze({ path: logicalPath, source: file.source }));
    }
    return Object.freeze(normalized);
}

function normalizeIncludePaths(paths: readonly string[] | undefined): readonly string[] {
    const result: string[] = [];
    for (const item of paths ?? []) {
        const logicalPath = normalizeLogicalPath(item);
        if (logicalPath === undefined) throw new SourceProviderError(`invalid logical include path: ${item}`);
        result.push(logicalPath);
    }
    return Object.freeze(result);
}

function normalizeDefines(defines: Readonly<Record<string, string | undefined>> | undefined): Readonly<Record<string, string>> {
    const result: Record<string, string> = {};
    for (const key of Object.keys(defines ?? {}).sort()) {
        const value = defines![key];
        if (typeof value !== 'string' && value !== undefined) throw new TypeError(`define ${key} must be a string`);
        result[key] = value ?? '';
    }
    return Object.freeze(result);
}

export function makeRequest(source: string, options: CFrontendOptions = {}): CFrontendRequest {
    if (typeof source !== 'string') throw new TypeError('source must be a string');
    if (options.standard !== undefined && options.standard !== 'c17') {
        throw new CFrontendInternalError(`unsupported C standard: ${String(options.standard)}`);
    }
    const mainPath = normalizeLogicalPath(options.sourceName ?? 'merc32-input.c');
    if (mainPath === undefined) throw new SourceProviderError('sourceName must be a normalized logical path');
    const includePaths = normalizeIncludePaths(options.includePaths);
    const virtualFiles = normalizeVirtualFiles(options.virtualFiles);
    const limits = normalizeLimits(options.limits);
    if (virtualFiles.some((file) => file.path === mainPath)) {
        throw new SourceProviderError(`virtual file duplicates main path: ${mainPath}`);
    }
    return Object.freeze({
        protocolVersion: 1 as const,
        mainPath,
        source,
        standard: 'c17' as const,
        defines: normalizeDefines(options.defines),
        includePaths,
        virtualFiles,
        limits,
    });
}

export interface AroFrontend {
    analyzeSource(source: string, options?: CFrontendOptions): TypedCEnvelopeV1;
    analyzeFile(sourceFile: string, options?: CFrontendOptions, preprocessCompatibility?: CPreprocessOptions): TypedCEnvelopeV1;
}

export class AroFrontendService implements AroFrontend {
    private readonly host: AroWasmHost;
    public constructor(host = new AroWasmHost()) {
        this.host = host;
    }

    public analyzeSource(source: string, options: CFrontendOptions = {}): TypedCEnvelopeV1 {
        const request = makeRequest(source, options);
        const memory = new MemorySourceProvider({
            virtualFiles: request.virtualFiles,
            includePaths: request.includePaths,
            sourceName: request.mainPath,
        });
        return this.host.analyze(request, new CompositeSourceProvider(memory));
    }

    public analyzeFile(sourceFile: string, options: CFrontendOptions = {},
        preprocessCompatibility?: CPreprocessOptions): TypedCEnvelopeV1 {
        if (typeof sourceFile !== 'string' || sourceFile.length === 0) {
            throw new TypeError('sourceFile must be a non-empty path');
        }
        const includePaths = options.includePaths ?? [];
        const node = new NodeSourceProvider({
            mainFile: sourceFile,
            includePaths,
            packagedHeaderRoot: this.packagedHeaderRoot(),
            readFile: preprocessCompatibility?.readFile,
            realPath: preprocessCompatibility?.realPath,
        });
        let source: string;
        try {
            source = node.readMain();
        } catch (error) {
            throw new CFrontendInternalError(`cannot read source file: ${String(error)}`);
        }
        const packagedLogicalPath = node.getPackagedLogicalPath();
        const logicalIncludes: readonly string[] = packagedLogicalPath === undefined
            ? node.getIncludeLogicalPaths()
            : [...node.getIncludeLogicalPaths(), packagedLogicalPath];
        const mergedLimits: Record<string, number> = { ...(options.limits ?? {}) };
        if (preprocessCompatibility?.maxIncludeDepth !== undefined) {
            const depth = preprocessCompatibility.maxIncludeDepth;
            if (!Number.isSafeInteger(depth) || depth < 1 || depth > HARD_C_FRONTEND_LIMITS.includeDepth) {
                throw new SourceProviderError('maxIncludeDepth must be a finite safe integer in range 1..32');
            }
            if (mergedLimits.includeDepth !== undefined) {
                normalizeLimit('includeDepth', mergedLimits.includeDepth);
                mergedLimits.includeDepth = Math.min(mergedLimits.includeDepth, depth);
            } else {
                mergedLimits.includeDepth = depth;
            }
        }
        const request = makeRequest(source, {
            ...options,
            sourceName: node.getMainLogicalPath(),
            includePaths: logicalIncludes,
            limits: mergedLimits,
        });
        const memory = new MemorySourceProvider({
            virtualFiles: request.virtualFiles,
            includePaths: request.includePaths,
            sourceName: request.mainPath,
        });
        return this.host.analyze(request, new CompositeSourceProvider(memory, node));
    }

    private packagedHeaderRoot(): string | undefined {
        const root = path.resolve(__dirname, '..', '..', 'resources', 'c-frontend', 'include');
        try {
            return fs.statSync(root).isDirectory() ? root : undefined;
        } catch {
            return undefined;
        }
    }
}

export const AroFrontend = AroFrontendService;

let singleton: AroFrontend | undefined;

export function getAroFrontend(): AroFrontend {
    return singleton ?? (singleton = new AroFrontendService());
}

export function analyzeSource(source: string, options?: CFrontendOptions): TypedCEnvelopeV1 {
    return getAroFrontend().analyzeSource(source, options);
}

export function analyzeFile(sourceFile: string, options?: CFrontendOptions,
    preprocessCompatibility?: CPreprocessOptions): TypedCEnvelopeV1 {
    return getAroFrontend().analyzeFile(sourceFile, options, preprocessCompatibility);
}
