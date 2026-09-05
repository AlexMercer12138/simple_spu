import * as fs from 'fs';
import * as path from 'path';

import type { CPreprocessOptions } from '../cFrontend/sourceProvider';
import type {
    CCompileDetailedResult,
    CFrontendDiagnostic,
    SourceFileRecord,
    SourceRange,
    TypedCEnvelopeV1,
} from '../cFrontend/contract';
import {
    CFrontendOptions,
    getAroFrontend,
} from '../cFrontend/frontend';
import { normalizeLogicalPath } from '../cFrontend/sourceProvider';
import { hasErrors, normalizeDiagnostics } from '../cFrontend/validate';
import { LinkedImage, LinkerError, linkObjects } from '../linker';
import { Merc32Object } from '../linker/objectFormat';
import { adaptTypedUnit, CBackendCapabilityError } from './backendAdapter';
import { generateObject } from './codegen';
import { lowerProgram } from './lower';
import { CFrontendError } from './source';
import { BackendCompileOptions, CompileResult } from './types';

export type { Merc32Object } from '../linker/objectFormat';
export * from './types';
export * from './source';
export * from './ir';
export * from './lower';
export * from './loweringModel';
export * from './backendAdapter';
export * from './codegen';
export * from './registers';
export * from '../runtime/runtimeCatalog';

export interface CompileOptions extends BackendCompileOptions, CFrontendOptions {}

export interface CompileFileOptions extends CompileOptions {
    readonly preprocess?: CPreprocessOptions;
}

export function splitCompileOptions(options: CompileOptions = {}): Readonly<{
    frontend: CFrontendOptions;
    backend: BackendCompileOptions;
}> {
    const frontend: Record<string, unknown> = {};
    const backend: Record<string, unknown> = {};
    copyDefined(options, frontend, [
        'standard', 'sourceName', 'defines', 'includePaths', 'virtualFiles', 'limits',
    ] as const);
    copyDefined(options, backend, [
        'dataBase', 'dlbAddrWidth', 'codeBase', 'moduleName', 'tempSlots',
    ] as const);
    return Object.freeze({
        frontend: Object.freeze(frontend) as CFrontendOptions,
        backend: Object.freeze(backend) as BackendCompileOptions,
    });
}

function copyDefined<T extends object>(source: T, target: Record<string, unknown>,
    keys: readonly (keyof T)[]): void {
    for (const key of keys) {
        const value = source[key];
        if (value !== undefined) target[String(key)] = value;
    }
}

export function compileCToObjectDetailed(
    source: string,
    options: CompileOptions = {},
): CCompileDetailedResult<Merc32Object> {
    const standardFailure = validateStandard<Merc32Object>(options, source,
        options.sourceName ?? 'merc32-input.c');
    if (standardFailure) return standardFailure;
    const { frontend } = splitCompileOptions(options);
    const envelope = getAroFrontend().analyzeSource(source, frontend);
    return compileEnvelope(envelope, sourceSnapshots(envelopeSources(envelope), source, frontend));
}

export function compileCFileToObjectDetailed(
    sourceFile: string,
    options: CompileFileOptions = {},
): CCompileDetailedResult<Merc32Object> {
    const { preprocess, ...compileOptions } = options;
    const standardFailure = validateStandard<Merc32Object>(options,
        readSourceForDiagnostic(sourceFile, preprocess), sourceFile);
    if (standardFailure) return standardFailure;
    const { frontend } = splitCompileOptions(compileOptions);
    const envelope = getAroFrontend().analyzeFile(sourceFile, frontend, preprocess);
    const sources = envelopeSources(envelope);
    return compileEnvelope(envelope, fileSnapshots(sourceFile, sources, frontend, preprocess));
}

export function compileCToObject(source: string, options: CompileOptions = {}): Merc32Object {
    return requireArtifact(compileCToObjectDetailed(source, options));
}

export function compileCFileToObject(sourceFile: string, options: CompileFileOptions = {}): Merc32Object {
    return requireArtifact(compileCFileToObjectDetailed(sourceFile, options));
}

function compileEnvelope(envelope: TypedCEnvelopeV1,
    snapshots: readonly CCompileDiagnosticSource[]): CCompileDetailedResult<Merc32Object> {
    const diagnostics = normalizeDiagnostics(envelope.diagnostics);
    const sources = envelopeSources(envelope);
    if (envelope.unit === undefined || hasErrors(diagnostics)) {
        return withCCompileDiagnosticSources({ diagnostics }, sources, snapshots);
    }
    try {
        const artifact = generateObject(lowerProgram(adaptTypedUnit(envelope.unit)));
        return withCCompileDiagnosticSources({ artifact, diagnostics }, sources, snapshots);
    } catch (error) {
        if (!(error instanceof CBackendCapabilityError)) throw error;
        const combined = normalizeDiagnostics([...diagnostics, ...error.diagnostics]);
        return withCCompileDiagnosticSources({ diagnostics: combined }, sources, snapshots);
    }
}

const diagnosticSources = Symbol('c-frontend diagnostic sources');
type DetailedWithSources<T> = CCompileDetailedResult<T> & {
    readonly [diagnosticSources]?: Readonly<{
        files: readonly SourceFileRecord[];
        snapshots: readonly CCompileDiagnosticSource[];
    }>;
};

export interface CCompileDiagnosticSource {
    readonly file: SourceFileRecord;
    readonly canonicalPath: string;
    readonly source: string;
}

export function withCCompileDiagnosticSources<T>(result: CCompileDetailedResult<T>,
    files: readonly SourceFileRecord[] = [],
    snapshots: readonly CCompileDiagnosticSource[] = []): CCompileDetailedResult<T> {
    const copy = { ...result };
    Object.defineProperty(copy, diagnosticSources, {
        value: Object.freeze({ files: Object.freeze([...files]), snapshots: Object.freeze([...snapshots]) }),
        enumerable: false,
    });
    return Object.freeze(copy);
}

export function getCCompileDiagnosticSources<T>(result: CCompileDetailedResult<T>):
readonly CCompileDiagnosticSource[] {
    return (result as DetailedWithSources<T>)[diagnosticSources]?.snapshots ?? [];
}

export function getCCompileSourceFiles<T>(result: CCompileDetailedResult<T>):
readonly SourceFileRecord[] {
    return (result as DetailedWithSources<T>)[diagnosticSources]?.files ?? [];
}

export function mapCCompileDetailedResult<T, U>(result: CCompileDetailedResult<T>,
    artifact: U | undefined): CCompileDetailedResult<U> {
    const metadata = (result as DetailedWithSources<T>)[diagnosticSources];
    return withCCompileDiagnosticSources({
        ...(artifact === undefined ? {} : { artifact }),
        diagnostics: result.diagnostics,
    }, metadata?.files, metadata?.snapshots);
}

function requireArtifact<T>(result: CCompileDetailedResult<T>): T {
    if (result.artifact !== undefined) return result.artifact;
    const sources = (result as DetailedWithSources<T>)[diagnosticSources]?.files;
    throw new CFrontendError(result.diagnostics, sources);
}

export function compileCDetailed(source: string,
    options: CompileOptions = {}): CCompileDetailedResult<CompileResult> {
    const optionFailure = validateAssemblyOptions(options, source, options.sourceName ?? 'merc32-input.c');
    if (optionFailure) return optionFailure;
    const objectResult = compileCToObjectDetailed(source, options);
    return linkDetailed(objectResult, options);
}

export function compileCFileDetailed(sourceFile: string,
    options: CompileFileOptions = {}): CCompileDetailedResult<CompileResult> {
    const source = readSourceForDiagnostic(sourceFile, options.preprocess);
    const optionFailure = validateAssemblyOptions(options, source, sourceFile);
    if (optionFailure) return optionFailure;
    const objectResult = compileCFileToObjectDetailed(sourceFile, options);
    return linkDetailed(objectResult, options);
}

export function compileC(source: string, options: CompileOptions = {}): CompileResult {
    return requireArtifact(compileCDetailed(source, options));
}

export function compileCFile(sourceFile: string, options: CompileFileOptions = {}): CompileResult {
    return requireArtifact(compileCFileDetailed(sourceFile, options));
}

function linkDetailed(objectResult: CCompileDetailedResult<Merc32Object>,
    options: CompileOptions): CCompileDetailedResult<CompileResult> {
    if (objectResult.artifact === undefined) {
        return mapCCompileDetailedResult<Merc32Object, CompileResult>(objectResult, undefined);
    }
    try {
        const dataBase = options.dataBase ?? 0x0800_0000;
        const codeBase = options.codeBase ?? 0;
        const image = linkObjects([objectResult.artifact], { textBase: codeBase, dataBase });
        validateIlbImage(image);
        validateDlbImage(image, dataBase, options.dlbAddrWidth ?? 16);
        const moduleName = sanitizeIdentifier(options.moduleName || 'merc32_c_program');
        const prefix = [`.prog ${moduleName}`, ...(codeBase === 0 ? [] : [`.org 0x${codeBase.toString(16)}`])];
        const artifact = Object.freeze({ assembly: `${prefix.join('\n')}\n${image.assembly}` });
        return mapCCompileDetailedResult(objectResult, artifact);
    } catch (error) {
        if (!(error instanceof LinkerError) && !(error instanceof ImageCapacityError)) throw error;
        const diagnostic = diagnosticForLinkFailure(error, objectResult);
        const failed = withCCompileDiagnosticSources<CompileResult>({
            diagnostics: normalizeDiagnostics([...objectResult.diagnostics, diagnostic]),
        }, getCCompileSourceFiles(objectResult), getCCompileDiagnosticSources(objectResult));
        return failed;
    }
}

const DLB_BASE_ADDRESS = 0x0800_0000;
const DLB_EXCLUSIVE_LIMIT = 0x1000_0000;
const DIRECT_LABEL_EXCLUSIVE_LIMIT = 0x0000_8000;

class ImageCapacityError extends Error {
    public constructor(readonly code: 'MERC32_C_DLB_CAPACITY' | 'MERC32_C_ILB_CAPACITY',
        message: string) {
        super(message);
        this.name = 'ImageCapacityError';
    }
}

export function validateDlbImage(image: LinkedImage, dataBase: number, dlbAddrWidth: number): void {
    if (!Number.isSafeInteger(dlbAddrWidth) || dlbAddrWidth < 1 || dlbAddrWidth > 25) {
        throw new ImageCapacityError('MERC32_C_DLB_CAPACITY',
            'dlbAddrWidth must be an integer in range 1..25');
    }
    if (!Number.isSafeInteger(dataBase) || dataBase < DLB_BASE_ADDRESS || dataBase >= DLB_EXCLUSIVE_LIMIT) {
        throw new ImageCapacityError('MERC32_C_DLB_CAPACITY',
            'dataBase must be within DLB 0x08000000..0x0FFFFFFF');
    }
    const capacity = 2 ** (dlbAddrWidth + 2);
    if (dataBase + capacity > DLB_EXCLUSIVE_LIMIT) {
        throw new ImageCapacityError('MERC32_C_DLB_CAPACITY',
            'DLB data range exceeds exclusive limit 0x10000000');
    }
    const limit = dataBase + capacity;
    const dataSections = image.sections.filter((section) => section.name === 'data' || section.name === 'bss');
    if (dataSections.some((section) => section.address < dataBase)) {
        throw new ImageCapacityError('MERC32_C_DLB_CAPACITY',
            'linked data or bss section starts before dataBase and is outside the selected DLB image');
    }
    const imageEnd = Math.max(dataBase, ...dataSections.map((section) => section.address + section.size));
    if (imageEnd > limit) {
        throw new ImageCapacityError('MERC32_C_DLB_CAPACITY',
            `linked DLB image exceeds ${capacity} bytes selected by dlbAddrWidth ${dlbAddrWidth}`);
    }
}

function validateIlbImage(image: LinkedImage): void {
    const textEnd = Math.max(0, ...image.sections
        .filter((section) => section.name === 'text')
        .map((section) => section.address + section.size));
    if (textEnd > DIRECT_LABEL_EXCLUSIVE_LIMIT) {
        throw new ImageCapacityError('MERC32_C_ILB_CAPACITY',
            'linked ILB image exceeds exclusive direct-label limit 0x00008000');
    }
}

function validateAssemblyOptions(options: CompileOptions, source: string,
    sourceName: string): CCompileDetailedResult<CompileResult> | undefined {
    const fail = (message: string): CCompileDetailedResult<CompileResult> =>
        optionFailure(message, source, sourceName);
    const standardFailure = validateStandard<CompileResult>(options, source, sourceName);
    if (standardFailure) return standardFailure;
    const dataBase = options.dataBase ?? DLB_BASE_ADDRESS;
    if (!Number.isSafeInteger(dataBase)) return fail('dataBase must be a finite safe integer');
    if (dataBase < DLB_BASE_ADDRESS || dataBase >= DLB_EXCLUSIVE_LIMIT) {
        return fail('dataBase must be within DLB 0x08000000..0x0FFFFFFF');
    }
    const dlbAddrWidth = options.dlbAddrWidth ?? 16;
    if (!Number.isSafeInteger(dlbAddrWidth) || dlbAddrWidth < 1 || dlbAddrWidth > 25) {
        return fail('dlbAddrWidth must be an integer in range 1..25');
    }
    if (dataBase + 2 ** (dlbAddrWidth + 2) > DLB_EXCLUSIVE_LIMIT) {
        return fail('DLB data range exceeds exclusive limit 0x10000000');
    }
    const codeBase = options.codeBase ?? 0;
    if (!Number.isSafeInteger(codeBase)) return fail('codeBase must be an integer');
    if (codeBase < 0 || codeBase >= DIRECT_LABEL_EXCLUSIVE_LIMIT) {
        return fail('codeBase must be within ILB direct-label range 0x00000000..0x00007FFF (exclusive upper bound 0x00008000)');
    }
    if ((codeBase & 3) !== 0) return fail('codeBase must be 4-byte aligned');
    if (options.moduleName !== undefined && typeof options.moduleName !== 'string') {
        return fail('moduleName must be a string');
    }
    if (options.tempSlots !== undefined) {
        return fail('tempSlots is not supported by the Aro backend; omit it to use automatic frame allocation');
    }
    return undefined;
}

function validateStandard<T>(options: CFrontendOptions, source: string,
    sourceName: string): CCompileDetailedResult<T> | undefined {
    return options.standard !== undefined && options.standard !== 'c17'
        ? optionFailure(`unsupported C standard: ${String(options.standard)}`, source, sourceName)
        : undefined;
}

function optionFailure<T>(message: string, source: string,
    sourceName: string): CCompileDetailedResult<T> {
    const context = syntheticDiagnosticContext(source, sourceName);
    return withCCompileDiagnosticSources({
        diagnostics: normalizeDiagnostics([
            makeDiagnostic('MERC32_C_OPTION', message, zeroRange(context.file)),
        ]),
    }, [context.file], [context]);
}

function diagnosticForLinkFailure(error: LinkerError | ImageCapacityError,
    result: CCompileDetailedResult<Merc32Object>): CFrontendDiagnostic {
    const snapshots = getCCompileDiagnosticSources(result);
    const sourceFiles = getCCompileSourceFiles(result);
    const fallback = sourceFiles[0] ?? syntheticDiagnosticContext('', 'merc32-input.c').file;
    let range = zeroRange(fallback);
    if (error instanceof LinkerError && error.debug) {
        const snapshot = snapshots.find((candidate) =>
            candidate.file.path === error.debug!.file
                || path.basename(candidate.canonicalPath) === path.basename(error.debug!.file));
        if (snapshot) range = rangeFromLocation(snapshot, error.debug.line, error.debug.column);
    }
    return makeDiagnostic(error instanceof ImageCapacityError ? error.code : 'MERC32_C_LINK',
        error.message, range);
}

function makeDiagnostic(code: string, message: string, range: SourceRange): CFrontendDiagnostic {
    return Object.freeze({
        severity: 'error' as const,
        code,
        message,
        range,
        related: Object.freeze([]),
        notes: Object.freeze([]),
        includeTrace: Object.freeze([]),
        macroExpansionTrace: Object.freeze([]),
    });
}

function zeroRange(file: SourceFileRecord): SourceRange {
    const position = Object.freeze({ line: 1, column: 1, byteOffset: 0 });
    return Object.freeze({ file: file.id, start: position, end: position });
}

function rangeFromLocation(snapshot: CCompileDiagnosticSource, line: number, column: number): SourceRange {
    const lines = snapshot.source.split(/(?<=\n)/u);
    const lineIndex = Math.max(0, Math.min(lines.length - 1, line - 1));
    const prefix = lines.slice(0, lineIndex).join('');
    const current = lines[lineIndex] ?? '';
    const characters = Array.from(current);
    const character = Math.max(0, Math.min(characters.length, column - 1));
    const utf16Index = characters.slice(0, character).join('').length;
    const selected = characters[character] ?? '';
    const startOffset = Buffer.byteLength(prefix + current.slice(0, utf16Index), 'utf8');
    const endOffset = Math.min(snapshot.file.byteLength,
        startOffset + Buffer.byteLength(selected, 'utf8'));
    return Object.freeze({
        file: snapshot.file.id,
        start: Object.freeze({ line: lineIndex + 1, column: character + 1, byteOffset: startOffset }),
        end: Object.freeze({
            line: lineIndex + 1,
            column: character + (selected === '' ? 1 : 2),
            byteOffset: endOffset,
        }),
    });
}

function envelopeSources(envelope: TypedCEnvelopeV1): readonly SourceFileRecord[] {
    return envelope.unit?.sourceFiles ?? envelope.sourceFiles ?? [];
}

function sourceSnapshots(files: readonly SourceFileRecord[], source: string,
    options: CFrontendOptions): readonly CCompileDiagnosticSource[] {
    const mainPath = normalizeLogicalPath(options.sourceName ?? 'merc32-input.c') ?? 'merc32-input.c';
    const values = new Map<string, string>([[mainPath, source]]);
    for (const virtual of options.virtualFiles ?? []) {
        values.set(normalizeLogicalPath(virtual.path) ?? virtual.path.replace(/\\/gu, '/'), virtual.source);
    }
    return Object.freeze(files.flatMap((file) => {
        const text = values.get(file.path);
        return text === undefined ? [] : [Object.freeze({
            file,
            canonicalPath: path.resolve(file.path),
            source: text,
        })];
    }));
}

function fileSnapshots(sourceFile: string, files: readonly SourceFileRecord[],
    options: CFrontendOptions, access: CPreprocessOptions = {}): readonly CCompileDiagnosticSource[] {
    const mainDirectory = path.dirname(path.resolve(sourceFile));
    const includePaths = options.includePaths ?? [];
    const includeNames = uniqueIncludeNames(includePaths);
    const packagedRoot = path.resolve(__dirname, '..', '..', 'resources', 'c-frontend', 'include');
    const virtual = new Map((options.virtualFiles ?? []).map((item) => [item.path.replace(/\\/gu, '/'), item.source]));
    return Object.freeze(files.flatMap((file) => {
        const logical = file.path.replace(/\\/gu, '/');
        let candidate: string;
        const segments = logical.split('/');
        const includeIndex = includeNames.indexOf(segments[0]);
        if (includeIndex >= 0) candidate = path.join(path.resolve(includePaths[includeIndex]), ...segments.slice(1));
        else if (segments[0] === 'packaged') candidate = path.join(packagedRoot, ...segments.slice(1));
        else candidate = path.join(mainDirectory, ...segments);
        const virtualSource = virtual.get(logical);
        if (virtualSource !== undefined) {
            return [Object.freeze({ file, canonicalPath: diagnosticPath(candidate, access), source: virtualSource })];
        }
        const text = readDiagnosticSnapshot(candidate, access);
        if (text === undefined) return [];
        return [Object.freeze({ file, canonicalPath: diagnosticPath(candidate, access), source: text })];
    }));
}

function readDiagnosticSnapshot(file: string, access: CPreprocessOptions): string | undefined {
    try {
        const canonical = diagnosticPath(file, access);
        return access.readFile === undefined
            ? new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(canonical))
            : access.readFile(canonical);
    } catch {
        return undefined;
    }
}

function uniqueIncludeNames(includePaths: readonly string[]): string[] {
    const used = new Set<string>();
    return includePaths.map((item, index) => {
        const base = normalizeLogicalPath(path.basename(item)) ?? `include${index}`;
        let name = base;
        let suffix = 1;
        while (used.has(name)) name = `${base}${suffix++}`;
        used.add(name);
        return name;
    });
}

function syntheticDiagnosticContext(source: string, sourceName: string): CCompileDiagnosticSource {
    const canonicalPath = path.resolve(sourceName);
    const file = Object.freeze({
        id: 1 as SourceFileRecord['id'],
        path: sourceName,
        byteLength: Buffer.byteLength(source, 'utf8'),
        utf8BoundaryBitmap: utf8BoundaryBitmap(source),
    });
    return Object.freeze({ file, canonicalPath, source });
}

function utf8BoundaryBitmap(source: string): string {
    const bytes = Buffer.from(source, 'utf8');
    const bitmap = Buffer.alloc(Math.ceil((bytes.length + 1) / 8));
    let offset = 0;
    bitmap[0] |= 1;
    for (const character of source) {
        offset += Buffer.byteLength(character, 'utf8');
        bitmap[Math.floor(offset / 8)] |= 1 << (offset % 8);
    }
    return bitmap.toString('hex');
}

function readSourceForDiagnostic(sourceFile: string, access: CPreprocessOptions = {}): string {
    try {
        const canonical = diagnosticPath(sourceFile, access);
        return access.readFile === undefined
            ? new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(canonical))
            : access.readFile(canonical);
    } catch {
        return '';
    }
}

function diagnosticPath(file: string, access: CPreprocessOptions = {}): string {
    try {
        const resolved = access.realPath === undefined ? fs.realpathSync.native(file) : access.realPath(file);
        return path.resolve(resolved);
    } catch {
        return path.resolve(file);
    }
}

function sanitizeIdentifier(name: string): string {
    const sanitized = name.replace(/[^A-Za-z0-9_]/gu, '_');
    return /^[A-Za-z_]/u.test(sanitized) ? sanitized : `_${sanitized}`;
}

export type { BackendCompileOptions, CompileResult } from './types';

export type { CCompileDetailedResult, CFrontendDiagnostic } from '../cFrontend/contract';
export type { CFrontendOptions } from '../cFrontend/frontend';
