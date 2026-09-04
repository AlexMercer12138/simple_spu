import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

import { CFrontendLimits, HARD_C_FRONTEND_LIMITS } from './limits';
import { SourceProvider, SourceResolution } from './sourceProvider';
import { CFrontendInternalError, validateEnvelope } from './validate';
import type { CFrontendRequest } from './frontend';
import { TypedCEnvelopeV1 } from './contract';

// TypeScript is compiled without the DOM library in the extension. Keep the
// small runtime surface we use here local while still using the native WASM
// implementation supplied by Node.
declare const WebAssembly: any;
interface WasmMemory { readonly buffer: ArrayBufferLike; }

export interface BridgeManifest {
    readonly bridgeBuildId: string;
    readonly wasmSha256: string;
    readonly protocolVersion?: number;
    readonly schemaVersion?: number;
    readonly [key: string]: unknown;
}

interface WasmExports {
    readonly memory: WasmMemory;
    readonly merc32_alloc: (length: number) => number;
    readonly merc32_analyze: (pointer: number, length: number) => number;
    readonly merc32_result_ptr: () => number;
    readonly merc32_result_len: () => number;
    readonly merc32_reset: () => void;
    readonly merc32_protocol_version: () => number;
    readonly merc32_build_id_ptr: () => number;
    readonly merc32_build_id_len: () => number;
}

interface WasmInstance {
    readonly exports: WasmExports;
    readonly invoke?: (request: CFrontendRequest) => unknown;
}

export type HostSourceResolver = (
    memory: WasmMemory,
    candidatePointer: number,
    candidateLength: number,
    resultPointer: number,
    resultCapacity: number,
) => number;

export interface AroWasmHostOptions {
    readonly resourceRoot?: string;
    readonly manifest?: BridgeManifest;
    readonly wasmBytes?: Uint8Array;
    readonly sourceProvider?: SourceProvider;
    readonly instantiate?: (resolve: HostSourceResolver) => WasmInstance;
}

const EXPECTED_IMPORTS = Object.freeze([
    { module: 'merc32_source', name: 'resolve', kind: 'function' as const },
]);
const EXPECTED_EXPORTS = Object.freeze([
    'memory', 'merc32_alloc', 'merc32_analyze', 'merc32_build_id_len', 'merc32_build_id_ptr',
    'merc32_protocol_version', 'merc32_reset', 'merc32_result_len', 'merc32_result_ptr',
]);
const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();

function extensionRoot(): string {
    return path.resolve(__dirname, '..', '..');
}

function assertManifest(manifest: BridgeManifest): void {
    if (manifest === null || typeof manifest !== 'object'
        || typeof manifest.bridgeBuildId !== 'string' || manifest.bridgeBuildId.length === 0
        || typeof manifest.wasmSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(manifest.wasmSha256)) {
        throw new CFrontendInternalError('invalid c-frontend build manifest');
    }
    if (manifest.protocolVersion !== undefined && manifest.protocolVersion !== 1) {
        throw new CFrontendInternalError('unsupported c-frontend bridge protocol version');
    }
}

function readManifest(resourceRoot: string): BridgeManifest {
    let value: unknown;
    try {
        value = JSON.parse(fs.readFileSync(path.join(resourceRoot, 'build-manifest.json'), 'utf8'));
    } catch (error) {
        throw new CFrontendInternalError(`cannot load c-frontend build manifest: ${String(error)}`);
    }
    assertManifest(value as BridgeManifest);
    return value as BridgeManifest;
}

function sha256(bytes: Uint8Array): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function auditModule(module: any): void {
    const imports = WebAssembly.Module.imports(module).map((item: { module: string; name: string; kind: string }) => ({
        module: item.module, name: item.name, kind: item.kind,
    }));
    if (JSON.stringify(imports) !== JSON.stringify(EXPECTED_IMPORTS)) {
        throw new CFrontendInternalError('c-frontend WASM imports are outside the allowed bridge ABI');
    }
    const exports = WebAssembly.Module.exports(module).map((item: { name: string }) => item.name).sort();
    if (JSON.stringify(exports) !== JSON.stringify([...EXPECTED_EXPORTS].sort())) {
        throw new CFrontendInternalError('c-frontend WASM exports do not match the bridge ABI');
    }
}

function hasExport(exports: Partial<WasmExports>, name: keyof WasmExports): boolean {
    if (name === 'memory') {
        const memory = exports.memory as { readonly buffer?: unknown } | undefined;
        const buffer = memory?.buffer as { readonly byteLength?: unknown } | undefined;
        return typeof buffer?.byteLength === 'number' && Number.isSafeInteger(buffer.byteLength)
            && buffer.byteLength >= 0;
    }
    return typeof exports[name] === 'function';
}

function assertExports(value: unknown): asserts value is WasmExports {
    if (value === null || typeof value !== 'object') {
        throw new CFrontendInternalError('c-frontend WASM exports are unavailable');
    }
    const exports = value as Partial<WasmExports>;
    for (const name of EXPECTED_EXPORTS) {
        if (!hasExport(exports, name as keyof WasmExports)) {
            throw new CFrontendInternalError(`c-frontend WASM export is missing: ${name}`);
        }
    }
}

export class AroWasmHost {
    private readonly resourceRoot: string;
    private readonly suppliedManifest?: BridgeManifest;
    private readonly suppliedWasmBytes?: Uint8Array;
    private readonly suppliedInstantiate?: (resolve: HostSourceResolver) => WasmInstance;
    private readonly defaultProvider?: SourceProvider;
    private instance?: WasmInstance;
    private active = false;
    private provider?: SourceProvider;
    private activeLimits?: CFrontendLimits;

    public constructor(options: AroWasmHostOptions = {}) {
        this.resourceRoot = path.resolve(options.resourceRoot ?? path.join(extensionRoot(), 'resources', 'c-frontend'));
        this.suppliedManifest = options.manifest;
        this.suppliedWasmBytes = options.wasmBytes;
        this.suppliedInstantiate = options.instantiate;
        this.defaultProvider = options.sourceProvider;
        if (this.suppliedManifest !== undefined) assertManifest(this.suppliedManifest);
    }

    public analyze(request: CFrontendRequest, sourceProvider?: SourceProvider): TypedCEnvelopeV1 {
        if (this.active) throw new CFrontendInternalError('Aro frontend call is reentrant');
        this.active = true;
        const previousProvider = this.provider;
        const previousLimits = this.activeLimits;
        this.provider = sourceProvider ?? this.defaultProvider;
        this.activeLimits = request.limits;
        try {
            const instance = this.instance ?? (this.instance = this.instantiate());
            if (instance.invoke === undefined) assertExports(instance.exports);
            const raw = instance.invoke !== undefined
                ? instance.invoke(request)
                : this.invoke(instance.exports, request);
            const manifest = this.manifest;
            return validateEnvelope(raw, manifest.bridgeBuildId);
        } catch (error) {
            if (error instanceof WebAssembly.RuntimeError) this.instance = undefined;
            throw error;
        } finally {
            this.provider = previousProvider;
            this.activeLimits = previousLimits;
            this.active = false;
        }
    }

    public reset(): void {
        this.instance?.exports.merc32_reset();
    }

    public get manifest(): BridgeManifest {
        return this.manifestValue();
    }

    private manifestValue(): BridgeManifest {
        return this.suppliedManifest ?? readManifest(this.resourceRoot);
    }

    private instantiate(): WasmInstance {
        if (this.suppliedInstantiate !== undefined) {
            return this.suppliedInstantiate((memory, candidatePointer, candidateLength,
                resultPointer, resultCapacity) => this.resolveSource(
                memory, candidatePointer, candidateLength, resultPointer, resultCapacity));
        }
        const manifest = this.manifestValue();
        const wasmPath = path.join(this.resourceRoot, 'aro-merc32.wasm');
        let bytes = this.suppliedWasmBytes;
        if (bytes === undefined) {
            try {
                bytes = fs.readFileSync(wasmPath);
            } catch (error) {
                throw new CFrontendInternalError(`cannot load c-frontend WASM: ${String(error)}`);
            }
        }
        if (sha256(bytes) !== manifest.wasmSha256) {
            throw new CFrontendInternalError('c-frontend WASM SHA-256 does not match the build manifest');
        }
        let module: any;
        try {
            module = new WebAssembly.Module(bytes);
        } catch (error) {
            throw new CFrontendInternalError(`invalid c-frontend WASM module: ${String(error)}`);
        }
        auditModule(module);
        let wasm: any;
        try {
            wasm = new WebAssembly.Instance(module, {
                merc32_source: {
                    resolve: (candidatePointer: number, candidateLength: number,
                        resultPointer: number, resultCapacity: number): number =>
                        wasm === undefined ? -2 : this.resolveSource(wasm.exports.memory,
                            candidatePointer, candidateLength, resultPointer, resultCapacity),
                },
            });
        } catch (error) {
            throw new CFrontendInternalError(`cannot instantiate c-frontend WASM: ${String(error)}`);
        }
        if (wasm === undefined) throw new CFrontendInternalError('c-frontend WASM instance is unavailable');
        const exports = wasm.exports as unknown as Partial<WasmExports>;
        assertExports(exports);
        const actualBuildId = this.readBuildId(exports as WasmExports);
        if (actualBuildId !== manifest.bridgeBuildId) {
            throw new CFrontendInternalError('c-frontend bridge build ID does not match the build manifest');
        }
        if (exports.merc32_protocol_version!() !== 1) {
            throw new CFrontendInternalError('c-frontend bridge protocol version is unsupported');
        }
        return { exports: exports as WasmExports };
    }

    private invoke(exports: WasmExports, request: CFrontendRequest): unknown {
        const requestBytes = encoder.encode(JSON.stringify(request));
        if (requestBytes.length > HARD_C_FRONTEND_LIMITS.requestBytes) {
            throw new CFrontendInternalError('encoded c-frontend request exceeds requestBytes');
        }
        exports.merc32_reset();
        const pointer = exports.merc32_alloc(requestBytes.length);
        if (!Number.isSafeInteger(pointer) || pointer <= 0) {
            throw new CFrontendInternalError('c-frontend request allocation failed');
        }
        this.memorySlice(exports.memory, pointer, requestBytes.length).set(requestBytes);
        exports.merc32_analyze(pointer, requestBytes.length);
        const resultLength = exports.merc32_result_len();
        if (!Number.isSafeInteger(resultLength) || resultLength > request.limits.resultBytes
            || resultLength > HARD_C_FRONTEND_LIMITS.resultBytes) {
            throw new CFrontendInternalError('c-frontend result exceeds resultBytes');
        }
        const resultPointer = exports.merc32_result_ptr();
        let result: Uint8Array;
        try {
            result = this.memorySlice(exports.memory, resultPointer, resultLength);
        } catch (error) {
            throw new CFrontendInternalError(`c-frontend result buffer is invalid: ${String(error)}`);
        }
        let text: string;
        try {
            text = decoder.decode(result);
        } catch (error) {
            throw new CFrontendInternalError(`c-frontend result is not valid UTF-8: ${String(error)}`);
        }
        try {
            return JSON.parse(text);
        } catch (error) {
            throw new CFrontendInternalError(`c-frontend result is not valid JSON: ${String(error)}`);
        }
    }

    private memorySlice(memory: WasmMemory, pointer: number, length: number): Uint8Array {
        if (!Number.isSafeInteger(pointer) || pointer < 0 || !Number.isSafeInteger(length)
            || length < 0 || pointer + length > memory.buffer.byteLength) {
            throw new CFrontendInternalError('c-frontend buffer lies outside linear memory');
        }
        return new Uint8Array(memory.buffer, pointer, length);
    }

    private readBuildId(exports: WasmExports): string {
        const bytes = this.memorySlice(exports.memory, exports.merc32_build_id_ptr(), exports.merc32_build_id_len());
        try {
            return decoder.decode(bytes);
        } catch (error) {
            throw new CFrontendInternalError(`c-frontend bridge build ID is not valid UTF-8: ${String(error)}`);
        }
    }

    private resolveSource(memory: WasmMemory, candidatePointer: number, candidateLength: number,
        resultPointer: number, resultCapacity: number): number {
        if (!this.provider) return -1;
        if (!Number.isSafeInteger(resultCapacity) || resultCapacity < 0) return -2;
        let candidatePath: string;
        try {
            candidatePath = decoder.decode(this.memorySlice(memory, candidatePointer, candidateLength));
        } catch {
            return -2;
        }
        let resolution: SourceResolution;
        try {
            resolution = this.provider.resolve({ path: candidatePath, includeKind: 'quoted' });
        } catch (error) {
            if (error instanceof CFrontendInternalError
                && error.message === 'Aro frontend call is reentrant') throw error;
            return -2;
        }
        if (resolution.status === 'not-found') return -1;
        if (resolution.status === 'error') return -2;
        const pathBytes = encoder.encode(resolution.canonicalPath);
        const sourceBytes = encoder.encode(resolution.source);
        if (sourceBytes.length > (this.activeLimits?.fileBytes ?? HARD_C_FRONTEND_LIMITS.fileBytes)) return -2;
        const length = 4 + pathBytes.length + sourceBytes.length;
        if (length > resultCapacity || length > HARD_C_FRONTEND_LIMITS.fileBytes + 4 + pathBytes.length) return -2;
        try {
            const result = this.memorySlice(memory, resultPointer, length);
            new DataView(result.buffer, result.byteOffset, 4).setUint32(0, pathBytes.length, true);
            result.set(pathBytes, 4);
            result.set(sourceBytes, 4 + pathBytes.length);
            return length;
        } catch {
            return -2;
        }
    }
}
