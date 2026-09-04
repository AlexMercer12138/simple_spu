# Aro MERC32 C Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every production handwritten C preprocessing, parsing, and semantic-analysis path with a pinned Aro WASM frontend that emits `MERC32 Typed C Unit v1`, while preserving the MERC32 backend, object format, linker, runtime, RTL, and existing successful API result shapes.

**Architecture:** A freestanding Zig bridge drives vendored Aro with `DataModel.merc32`, resolves source only through one bounded host import, and emits deterministic JSON using a versioned frontend-neutral contract. A strict synchronous TypeScript host validates the envelope, identities, references, layouts, constants, and limits before adapting it into a backend-owned lowering model. The old frontends remain reachable only from an explicit differential harness until the object, assembly, diagnostics, RTL, offline-package, and provenance gates pass, then are deleted.

**Tech Stack:** Aro at commit `ec463262c14c1111fc9323086b708ad3b0b9ca11` (MIT), Zig `0.17.0-dev.1936+5a625d5f3`, freestanding `wasm32`, TypeScript 6, Node.js, AJV 8, VS Code diagnostics, existing MERC32 assembler/linker/runtime, Icarus Verilog, `@vscode/vsce` 3.6.2.

**Spec:** `docs/superpowers/specs/2026-09-04-aro-merc32-c-frontend-design.md`

## Global Constraints

- The public target identifiers are exactly `merc32`, `merc32-c-v1`, and `merc32-ilp32`; public APIs, diagnostics, manifests, and documentation expose no substitute architecture identity.
- The only initially exposed language mode is ISO C17 freestanding; no hosted headers, host include paths, host compiler discovery, POSIX APIs, or implicit Aro extension mode are allowed.
- Keep `cCompiler/ir.ts`, `cCompiler/lower.ts`, `cCompiler/codegen.ts`, `.mobj` version 1, linker semantics, runtime algorithms, ISA encoding, and CPU RTL project-owned.
- The WASM module has no WASI and exactly one host capability, `merc32_source.resolve`; runtime and ordinary VSIX packaging require neither Zig nor network access.
- Include lookup is quoted-source directory, explicit include directories in caller order, then packaged MERC32 headers; angle includes omit the source-directory step.
- Hard maxima are 4 MiB per source file, 32 MiB total translation-unit source, 4,096 source files, include depth 32, 40 MiB request, 64 MiB result, and 128 MiB WASM linear memory.
- Calls are synchronous and non-reentrant. A warm WASM instance is reused, a trap discards it, and the next call creates a fresh instance.
- Existing successful API shapes remain `CompileResult` and `Merc32Object`; detailed APIs add artifact-plus-diagnostics results. Compilation failure never triggers automatic fallback to a handwritten frontend.
- Integers outside JavaScript's safe range use width, signedness, and string spelling; floating constants use exact IEEE bit strings; addresses use symbol ID plus signed string addend; strings use exact bytes.
- `DataModel.merc32` is the frontend layout authority. A separate TypeScript `Merc32Abi` validates every serialized size, alignment, member offset, and supported lowering capability before code generation.
- The vendored source, required licenses, verified WASM, headers, schema/build identities, digests, and build instructions are committed and auditable; the WASM artifact must not exceed 4 MiB.
- This is a backward-compatible feature release: determine the actual last published version immediately before packaging, increment MINOR and reset PATCH, and do not increment again when rebuilding the same intended release.
- Before final packaging, update `merc32-vsce/package.json`, the top-level and `packages[""]` version fields in `merc32-vsce/package-lock.json`, and the README version badge; commit those three metadata changes before the final provenance rebuild.
- Existing uncommitted aggregate-initializer work is preserved and committed independently before Aro files are introduced.

## File And Ownership Map

- `third_party/aro/`: exact upstream source snapshot, upstream licenses, revision metadata, and the documented MERC32-owned Aro changes.
- `tools/aro-frontend/`: Zig bridge, dependency/build definition, deterministic serializer, bridge tests, vendor verification, and provenance rebuild tooling.
- `merc32-vsce/resources/c-frontend/`: committed WASM, freestanding headers, third-party notices, build manifest, and contract schema shipped in the VSIX.
- `merc32-vsce/src/cFrontend/`: public contract types, diagnostics, limits, source providers, WASM lifecycle, validation, and frontend service.
- `merc32-vsce/src/cCompiler/loweringModel.ts`: frontend-neutral typed nodes consumed by the retained MERC32 lowering/backend.
- `merc32-vsce/scripts/test-c-frontend-*.js`: contract, host, backend, differential, diagnostics, package, and resource-boundary gates.

---

### Task 1: Stabilize And Commit The Aggregate-Initializer Baseline

**Files:**
- Modify: `merc32-vsce/scripts/test-c-sema.js`
- Preserve and commit: `merc32-vsce/scripts/test-c-integration.js`
- Preserve and commit: `merc32-vsce/scripts/test-c-parser.js`
- Preserve and commit: `merc32-vsce/src/cCompiler/declarations.ts`
- Preserve and commit: `merc32-vsce/src/cCompiler/index.ts`
- Preserve and commit: `merc32-vsce/src/cCompiler/initializers.ts`
- Preserve and commit: `merc32-vsce/src/cCompiler/lexer.ts`
- Preserve and commit: `merc32-vsce/src/cCompiler/lower.ts`
- Preserve and commit: `merc32-vsce/src/cCompiler/parser.ts`
- Preserve and commit: `merc32-vsce/src/cCompiler/sema.ts`

**Interfaces:**
- Consumes the current `CInitializer = Expression | Initializer` model already present in the worktree.
- Produces one green, separately reviewable handwritten aggregate-initializer baseline for later Aro differential tests.

- [ ] **Step 1: Reproduce the known stale-fixture failure**

Run from `merc32-vsce`: `npm run compile; node scripts/test-c-sema.js`.
Expected: FAIL because `lowerInitializer` receives the removed `{ tokens: [...] }` representation.

- [ ] **Step 2: Replace the stale semantic-test initializer with the current structured shape**

Use this exact fixture and strengthen the assertions:

```js
const normalized = lowerInitializer(record, {
  kind: 'initializer',
  entries: [{
    designators: [{ kind: 'field-designator', field: 'x' }],
    value: { kind: 'integer-literal', value: 3 },
  }],
});
assert.strictEqual(normalized.size, 8);
assert.deepStrictEqual([...normalized.bytes], [0, 0, 0, 0, 0, 0, 0, 0]);
assert.deepStrictEqual(normalized.writes.map(write => [write.offset, write.value.value]), [[4, 3]]);
```

- [ ] **Step 3: Run the complete current typed-C baseline**

Run from `merc32-vsce`:

```text
npm run compile
node scripts/test-c-types.js
node scripts/test-c-parser.js
node scripts/test-c-sema.js
node scripts/test-c-backend.js
node scripts/test-c-advanced-backend.js
node scripts/test-c-integration.js
node scripts/test-c-typed-rtl.js
npm run test:c
npm run test:c:preprocessor
npm run test:c:rtl
```

Expected: every command exits 0. Run `git diff --check` from the repository root as well.

- [ ] **Step 4: Commit only the aggregate-initializer baseline**

```bash
git add merc32-vsce/scripts/test-c-integration.js merc32-vsce/scripts/test-c-parser.js merc32-vsce/scripts/test-c-sema.js merc32-vsce/src/cCompiler/declarations.ts merc32-vsce/src/cCompiler/index.ts merc32-vsce/src/cCompiler/initializers.ts merc32-vsce/src/cCompiler/lexer.ts merc32-vsce/src/cCompiler/lower.ts merc32-vsce/src/cCompiler/parser.ts merc32-vsce/src/cCompiler/sema.ts
git commit -m "feat: support typed C aggregate initializers"
```

### Task 2: Vendor And Verify The Pinned Aro Snapshot

**Files:**
- Create: `third_party/aro/**` from the tracked upstream archive at the pinned commit
- Create: `third_party/aro/UPSTREAM.json`
- Create: `third_party/aro/UPSTREAM-MANIFEST.json`
- Create: `third_party/aro/MERC32-CHANGES.json`
- Create: `third_party/aro/MERC32-CHANGES.md`
- Create: `tools/aro-frontend/verify-vendor.js`
- Create: `merc32-vsce/scripts/test-aro-vendor.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces immutable metadata `{ repository, commit, tree, trackedFileCount, zigVersion, manifest, licenses }`, per-file upstream hashes, an allowlist of local changes, and `verifyVendoredAro(root): VendorReceipt`.
- No runtime code consumes Aro from the network; all later Zig tasks resolve it from `third_party/aro`.

- [ ] **Step 1: Write a vendor-provenance test that fails while the snapshot is absent**

```js
const receipt = verifyVendoredAro(path.resolve(__dirname, '..', '..', 'third_party', 'aro'));
assert.strictEqual(receipt.commit, 'ec463262c14c1111fc9323086b708ad3b0b9ca11');
assert.strictEqual(receipt.tree, '7ddef8bd24b01ed7088d5d58d64d41e3d7529ed8');
assert.strictEqual(receipt.trackedFileCount, 791);
assert.strictEqual(receipt.zigVersion, '0.17.0-dev.1936+5a625d5f3');
assert.match(fs.readFileSync(path.join(receipt.root, 'LICENSE'), 'utf8'), /^MIT License/m);
assert.match(fs.readFileSync(path.join(receipt.root, 'LICENSE-UNICODE'), 'utf8'), /^UNICODE LICENSE V3/m);
assert.ok(!receipt.files.some(file => file === '.git' || file.startsWith('.git/')));
assert.ok(!receipt.files.some(file => file.startsWith('.zig-cache/') || file.startsWith('zig-out/')));
```

- [ ] **Step 2: Run the focused test and verify absence fails clearly**

Run: `node scripts/test-aro-vendor.js`.
Expected: FAIL with `third_party/aro/UPSTREAM.json is missing`.

- [ ] **Step 3: Import the exact tracked archive and add machine-readable metadata**

`UPSTREAM.json` must be exactly this shape:

```json
{
  "repository": "https://github.com/Vexu/arocc.git",
  "commit": "ec463262c14c1111fc9323086b708ad3b0b9ca11",
  "tree": "7ddef8bd24b01ed7088d5d58d64d41e3d7529ed8",
  "trackedFileCount": 791,
  "zigVersion": "0.17.0-dev.1936+5a625d5f3",
  "manifest": "UPSTREAM-MANIFEST.json",
  "licenses": ["LICENSE", "LICENSE-UNICODE"]
}
```

Generate `UPSTREAM-MANIFEST.json` as a sorted array of all 791 `{ path, sha256 }` upstream files and initialize `MERC32-CHANGES.json` to `{ "formatVersion": 1, "files": [] }`. The verifier rejects links/non-files and unknown files, normalizes paths to `/`, requires every unchanged file to match the upstream manifest, and permits a changed/new file only when `MERC32-CHANGES.json` records its path, upstream hash or `null`, current hash, and reason. `MERC32-CHANGES.md` initially records that the snapshot is unmodified and names the planned ownership boundary.

- [ ] **Step 4: Add and run the repository script**

Add `"test:c:aro-vendor": "node scripts/test-aro-vendor.js"` to `package.json`.
Run: `npm run test:c:aro-vendor`.
Expected: PASS and print the pinned commit, tree, file count, and digest.

- [ ] **Step 5: Commit the pristine snapshot boundary**

```bash
git add third_party/aro tools/aro-frontend/verify-vendor.js merc32-vsce/scripts/test-aro-vendor.js merc32-vsce/package.json
git commit -m "build: vendor pinned Aro source"
```

### Task 3: Add `DataModel.merc32` And Its Conformance Matrix

**Files:**
- Create: `third_party/aro/src/aro/DataModel.zig`
- Modify: `third_party/aro/src/aro.zig`
- Modify: `third_party/aro/src/aro/Compilation.zig`
- Modify: `third_party/aro/src/aro/TypeStore.zig`
- Modify: `third_party/aro/src/aro/record_layout.zig`
- Modify: `third_party/aro/src/aro/Parser.zig`
- Modify: `third_party/aro/MERC32-CHANGES.json`
- Modify: `third_party/aro/MERC32-CHANGES.md`
- Create: `tools/aro-frontend/build.zig`
- Create: `tools/aro-frontend/build.zig.zon`
- Create: `tools/aro-frontend/src/data_model_probe.zig`
- Create: `tools/aro-frontend/tests/data-model.c`
- Create: `tools/aro-frontend/tests/data_model.zig`

**Interfaces:**
- Produces public Zig constant `aro.DataModel.merc32: DataModel` and `Compilation.InitOptions.data_model: ?DataModel`.
- Produces compilation query methods `ptrBitWidth`, `cTypeBitSize`, `cTypeAlignment`, `intPtrType`, `intMaxType`, `wcharType`, `wintType`, `sigAtomicType`, `hasInt128`, `hasFloat128`, `defaultFunctionAlignment`, and `maxFieldAlignment` that use the selected data model.

- [ ] **Step 1: Add a failing Zig conformance matrix**

The C fixture must contain `_Static_assert` rows for every scalar and alias in the spec, plus these layout sentinels:

```c
_Static_assert(__STDC_VERSION__ == 201710L, "C17");
_Static_assert(__STDC_HOSTED__ == 0, "freestanding");
_Static_assert(__MERC32__ == 1 && __merc32__ == 1, "target macros");
#define ASSERT_LAYOUT(type, bytes, align) \
  _Static_assert(sizeof(type) == (bytes) && _Alignof(type) == (align), #type)
ASSERT_LAYOUT(_Bool, 1, 1);
ASSERT_LAYOUT(char, 1, 1);
ASSERT_LAYOUT(signed char, 1, 1);
ASSERT_LAYOUT(unsigned char, 1, 1);
ASSERT_LAYOUT(short, 2, 2);
ASSERT_LAYOUT(unsigned short, 2, 2);
ASSERT_LAYOUT(int, 4, 4);
ASSERT_LAYOUT(unsigned int, 4, 4);
ASSERT_LAYOUT(long, 4, 4);
ASSERT_LAYOUT(unsigned long, 4, 4);
ASSERT_LAYOUT(long long, 8, 4);
ASSERT_LAYOUT(unsigned long long, 8, 4);
ASSERT_LAYOUT(float, 4, 4);
ASSERT_LAYOUT(double, 8, 4);
ASSERT_LAYOUT(long double, 8, 4);
_Static_assert(sizeof(void *) == 4 && _Alignof(void *) == 4, "pointer");
struct S { char c; long long x; short y; };
_Static_assert(sizeof(struct S) == 16 && _Alignof(struct S) == 4, "struct cap");
union U { char c; long long x; };
_Static_assert(sizeof(union U) == 8 && _Alignof(union U) == 4, "union cap");
enum E { E0, E1 };
_Static_assert(sizeof(enum E) == 4, "enum int");
```

The Zig test also asserts plain `char` is signed, byte order is little-endian, integer literal suffix selection follows ILP32 ranks, `size_t/uintptr_t/wint_t` are `unsigned int`, `ptrdiff_t/intptr_t/wchar_t/sig_atomic_t` are `int`, `intmax_t` is `long long`, maximum natural and `max_align_t` alignment are 4, function alignment is 4, and binary128, int128, TLS, and hosted capability macros are absent.

- [ ] **Step 2: Run the matrix and verify the new model is missing**

Run from `tools/aro-frontend`: `zig build test-data-model`.
Expected: FAIL because `aro.DataModel.merc32` and the probe do not exist.

- [ ] **Step 3: Implement the explicit data-model value and compilation query boundary**

Use a value object, not a new Zig CPU enum:

```zig
pub const DataModel = struct {
    pointer_bits: u16,
    maximum_natural_alignment: u16,
    function_alignment: u8,
    char_signedness: std.builtin.Signedness,

    pub const merc32: DataModel = .{
        .pointer_bits = 32,
        .maximum_natural_alignment = 4,
        .function_alignment = 4,
        .char_signedness = .signed,
    };

    pub fn cTypeBitSize(_: DataModel, ty: std.Target.CType) u16 {
        return switch (ty) {
            .char => 8,
            .short, .ushort => 16,
            .int, .uint, .long, .ulong, .float => 32,
            .longlong, .ulonglong, .double, .longdouble => 64,
        };
    }

    pub fn cTypeAlignment(_: DataModel, ty: std.Target.CType) u16 {
        return switch (ty) {
            .char => 1,
            .short, .ushort => 2,
            else => 4,
        };
    }
};
```

Add `data_model: ?DataModel = null` to both `Compilation` and `InitOptions`. Existing targets retain their current behavior when it is null. Replace C-observable target queries with compilation wrappers; record layout caps natural field/record alignment with `comp.maxFieldAlignment()`. Macro generation reads the same wrappers and emits only `__MERC32__`, `__merc32__`, standard implementation macros, and capabilities actually returned by the model. Regenerate `MERC32-CHANGES.json` entries for every changed/new Aro file and make `verify-vendor.js` pass after the patch.

- [ ] **Step 4: Make the freestanding compilation initializer host-independent**

Use this guarded default so the bridge does not require a current-directory import:

```zig
.cwd = options.cwd orelse if (comptime @import("builtin").os.tag == .freestanding)
    .{ .handle = undefined }
else
    .cwd(),
```

- [ ] **Step 5: Run data-model and upstream tests**

Run from `tools/aro-frontend`: `zig build test-data-model`.
Run from `third_party/aro`: `zig build test`.
Expected: both pass. The probe output must use only the public identifiers `merc32`, `merc32-c-v1`, and `merc32-ilp32`.

- [ ] **Step 6: Commit the model separately**

```bash
git add third_party/aro/src/aro.zig third_party/aro/src/aro/DataModel.zig third_party/aro/src/aro/Compilation.zig third_party/aro/src/aro/TypeStore.zig third_party/aro/src/aro/record_layout.zig third_party/aro/src/aro/Parser.zig third_party/aro/MERC32-CHANGES.json third_party/aro/MERC32-CHANGES.md tools/aro-frontend
git commit -m "feat: add explicit Aro MERC32 data model"
```

### Task 4: Define And Strictly Validate `MERC32 Typed C Unit v1`

**Files:**
- Create: `merc32-vsce/src/cFrontend/contract.ts`
- Create: `merc32-vsce/src/cFrontend/validate.ts`
- Create: `merc32-vsce/src/cFrontend/merc32Abi.ts`
- Create: `merc32-vsce/src/cFrontend/limits.ts`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/valid-unit-v1.json`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/malformed-units.json`
- Create: `merc32-vsce/scripts/test-c-frontend-contract.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `TypedCEnvelopeV1`, `TypedCUnitV1`, `TypedTypeRecord`, `TypedSymbolRecord`, `TypedNodeRecord`, `TypedConstant`, `TypedInitializer`, `CFrontendDiagnostic`, `CCompileDetailedResult<T>`, `CFrontendInternalError`, and branded numeric IDs.
- Produces `validateEnvelope(value: unknown, expectedBuildId: string): TypedCEnvelopeV1` and `MERC32_ABI: Merc32Abi`.

- [ ] **Step 1: Add valid and malformed contract fixtures**

The valid unit starts with these exact identities:

```json
{
  "protocolVersion": 1,
  "bridgeBuildId": "test-build",
  "status": "ok",
  "diagnostics": [],
  "unit": {
    "schema": "merc32.typed-c-unit",
    "schemaVersion": 1,
    "target": "merc32",
    "abi": "merc32-c-v1",
    "dataModel": "merc32-ilp32",
    "language": "c17-freestanding",
    "sourceFiles": [{ "id": 1, "path": "main.c", "byteLength": 26 }],
    "types": [{ "id": 1, "kind": "builtin", "name": "int", "qualifiers": [], "size": 4, "alignment": 4 }],
    "symbols": [],
    "nodes": [],
    "declarations": []
  }
}
```

Malformed cases cover unknown keys, wrong identities, duplicate and missing IDs, illegal by-value type cycles, pointer cycles incorrectly rejected, source offsets beyond `byteLength`, inverted ranges, unknown node kind, expression without type/value category, integer outside its declared width, invalid IEEE bit length, unknown address symbol, overlapping initializer writes, bad aggregate member offset, and layout disagreement with `MERC32_ABI`.

- [ ] **Step 2: Run the focused test and verify exports are absent**

Run: `npm run compile; node scripts/test-c-frontend-contract.js`.
Expected: FAIL because `out/cFrontend/validate` does not exist.

- [ ] **Step 3: Define the closed v1 vocabulary**

Use branded IDs and closed discriminated unions. The core shapes are:

```ts
export type SourceFileId = number & { readonly __sourceFileId: unique symbol };
export type TypeId = number & { readonly __typeId: unique symbol };
export type SymbolId = number & { readonly __symbolId: unique symbol };
export type NodeId = number & { readonly __nodeId: unique symbol };
export interface SourcePosition { readonly line: number; readonly column: number; readonly byteOffset: number; }
export interface SourceRange { readonly file: SourceFileId; readonly start: SourcePosition; readonly end: SourcePosition; }
export interface CFrontendDiagnostic {
  readonly severity: 'note' | 'warning' | 'error' | 'fatal';
  readonly code: string;
  readonly message: string;
  readonly range: SourceRange;
  readonly related: readonly Readonly<{ message: string; range: SourceRange }>[];
  readonly notes: readonly string[];
  readonly includeTrace: readonly SourceRange[];
  readonly macroExpansionTrace: readonly SourceRange[];
}
export type IntegerConstant = Readonly<{ kind: 'integer'; bits: number; signed: boolean; value: string }>;
export type FloatingConstant = Readonly<{ kind: 'floating'; type: TypeId; ieeeBits: string }>;
export type AddressConstant = Readonly<{ kind: 'address'; symbol: SymbolId; addend: string }>;
export type StringConstant = Readonly<{ kind: 'string'; elementType: TypeId; bytes: readonly number[] }>;
export type TypedConstant = IntegerConstant | FloatingConstant | AddressConstant | StringConstant;
export type TypedNodeKind =
  | 'variable-declaration' | 'function-declaration' | 'function-definition'
  | 'parameter-declaration' | 'typedef-declaration' | 'record-declaration'
  | 'enum-declaration' | 'static-assert'
  | 'compound' | 'declaration-statement' | 'expression-statement' | 'return'
  | 'if' | 'while' | 'do-while' | 'for' | 'switch' | 'case' | 'default'
  | 'break' | 'continue' | 'goto' | 'label' | 'empty'
  | 'integer-literal' | 'floating-literal' | 'character-literal' | 'string-literal'
  | 'declaration-reference' | 'unary' | 'binary' | 'conditional' | 'assignment'
  | 'call' | 'subscript' | 'member' | 'sizeof' | 'alignof' | 'conversion'
  | 'compound-literal' | 'generic-selection';
export interface TypedInitializerWrite { readonly offset: number; readonly type: TypeId; readonly value: TypedConstant; }
export interface TypedInitializer { readonly size: number; readonly zeroFill: true; readonly writes: readonly TypedInitializerWrite[]; }
export interface TypedNodeRecord {
  readonly id: NodeId;
  readonly category: 'expression' | 'statement' | 'declaration';
  readonly kind: TypedNodeKind;
  readonly range: SourceRange;
  readonly type?: TypeId;
  readonly valueCategory?: 'lvalue' | 'function' | 'rvalue';
  readonly children: readonly NodeId[];
  readonly symbol?: SymbolId;
  readonly operator?: string;
  readonly constant?: TypedConstant;
  readonly conversion?: 'lvalue-to-rvalue' | 'array-to-pointer' | 'function-to-pointer' | 'integer-promotion' | 'usual-arithmetic' | 'assignment' | 'argument' | 'return';
  readonly targetType?: TypeId;
  readonly label?: string;
  readonly memberIndex?: number;
}
export interface CCompileDetailedResult<T> { readonly artifact?: T; readonly diagnostics: readonly CFrontendDiagnostic[]; }
export class CFrontendInternalError extends Error { readonly name = 'CFrontendInternalError'; }
```

In the actual union, `kind` is restricted to the C17 node kinds handled by Tasks 6-7, and each kind permits only its named fields. Type records are closed variants for builtin, pointer, array, function, struct, union, enum, and typedef, with aggregate members carrying name, type, byte offset, optional bit offset/width, and source range.

- [ ] **Step 4: Implement structural, graph, range, exact-value, and ABI validation**

`validateEnvelope` first uses strict AJV with `additionalProperties: false`, then builds ID maps and validates references and semantics. Version 1 rejects unknown fields unless a specific optional field is first added to both serializer and validator; adding or changing a required semantic field creates schema version 2. Define the ABI independently:

```ts
export const MERC32_ABI: Merc32Abi = Object.freeze({
  target: 'merc32', abi: 'merc32-c-v1', dataModel: 'merc32-ilp32',
  endian: 'little', pointerSize: 4, pointerAlignment: 4,
  maximumNaturalAlignment: 4, functionAlignment: 4,
  builtin: Object.freeze({
    bool: [1, 1], char: [1, 1], short: [2, 2], int: [4, 4], long: [4, 4],
    longLong: [8, 4], float: [4, 4], double: [8, 4], longDouble: [8, 4],
  }),
});
export interface CFrontendLimits {
  readonly fileBytes: number;
  readonly totalSourceBytes: number;
  readonly fileCount: number;
  readonly includeDepth: number;
  readonly requestBytes: number;
  readonly resultBytes: number;
  readonly memoryBytes: number;
}
export const HARD_C_FRONTEND_LIMITS: CFrontendLimits = Object.freeze({
  fileBytes: 4 * 1024 * 1024,
  totalSourceBytes: 32 * 1024 * 1024,
  fileCount: 4096,
  includeDepth: 32,
  requestBytes: 40 * 1024 * 1024,
  resultBytes: 64 * 1024 * 1024,
  memoryBytes: 128 * 1024 * 1024,
});
```

Parse integer/addend strings with `BigInt`; never coerce exact constants through `number`. Export `normalizeDiagnostics(records): readonly CFrontendDiagnostic[]` and `hasErrors(diagnostics): boolean`. Reject status `ok` without a unit, non-`ok` with a unit, an unexpected build ID, or any error/fatal diagnostic attached to an `ok` result.

- [ ] **Step 5: Run contract tests and commit**

Run: `npm run compile; node scripts/test-c-frontend-contract.js`.
Expected: all malformed fixtures are rejected by a named invariant and the valid fixture is deeply frozen.

```bash
git add merc32-vsce/src/cFrontend merc32-vsce/scripts/fixtures/c-frontend merc32-vsce/scripts/test-c-frontend-contract.js merc32-vsce/package.json
git commit -m "feat: define MERC32 typed C unit contract"
```

### Task 5: Implement The Bounded Freestanding WASM Protocol And Source Resolver

**Files:**
- Modify: `third_party/aro/src/aro/Compilation.zig`
- Modify: `third_party/aro/src/aro/Preprocessor.zig`
- Modify: `third_party/aro/MERC32-CHANGES.json`
- Modify: `third_party/aro/MERC32-CHANGES.md`
- Create: `tools/aro-frontend/src/abi.zig`
- Create: `tools/aro-frontend/src/bridge.zig`
- Create: `tools/aro-frontend/src/request.zig`
- Create: `tools/aro-frontend/src/source_provider.zig`
- Create: `tools/aro-frontend/src/diagnostics.zig`
- Create: `tools/aro-frontend/src/serializer.zig`
- Create: `tools/aro-frontend/tests/bridge_contract.zig`
- Create: `tools/aro-frontend/tests/bridge-host.js`
- Modify: `tools/aro-frontend/build.zig`

**Interfaces:**
- Imports exactly `merc32_source.resolve(candidatePtr: u32, candidateLen: u32, resultPtr: u32, resultCapacity: u32): i32` where nonnegative is encoded-result length, `-1` is not found, and `-2` is bounded host-read failure.
- Exports `merc32_alloc`, `merc32_analyze`, `merc32_result_ptr`, `merc32_result_len`, `merc32_reset`, `merc32_protocol_version`, `merc32_build_id_ptr`, and `merc32_build_id_len`.

- [ ] **Step 1: Add failing ABI, include, diagnostic, limit, and determinism tests**

The JS harness instantiates the module with only:

```js
const imports = { merc32_source: { resolve(candidatePtr, candidateLen, resultPtr, resultCapacity) {
  return resolver.resolve(memory, candidatePtr, candidateLen, resultPtr, resultCapacity);
} } };
```

Assert exported ABI names exactly match the list above plus `memory`; `WebAssembly.Module.imports(module)` equals one function named `merc32_source.resolve`; repeated requests return byte-identical JSON; quoted and angle include ordering differ as specified; canonical cycles, depth 33, missing include, file-count 4,097, one-file 4 MiB + 1, total 32 MiB + 1, request 40 MiB + 1, result 64 MiB + 1, and memory growth beyond 128 MiB produce bounded diagnostics rather than traps.

- [ ] **Step 2: Run the bridge gate and verify missing exports fail**

Run from `tools/aro-frontend`: `zig build test-bridge`.
Expected: FAIL because the production bridge ABI has not been implemented.

- [ ] **Step 3: Implement dynamic request/result storage and hard maxima**

Define the compiled limits once in Zig:

```zig
pub const Limits = struct {
    file_bytes: u32 = 4 * 1024 * 1024,
    total_source_bytes: u32 = 32 * 1024 * 1024,
    file_count: u32 = 4096,
    include_depth: u32 = 32,
    request_bytes: u32 = 40 * 1024 * 1024,
    result_bytes: u32 = 64 * 1024 * 1024,
    memory_bytes: u32 = 128 * 1024 * 1024,
};
pub const hard_limits = Limits{};
```

`merc32_alloc` rejects requests over 40 MiB, uses a per-call arena, and returns zero on allocation failure. `merc32_analyze` validates protocol 1, C17, caller limits not exceeding hard maxima, normalized relative logical paths, unique virtual files, and sorted define keys. `merc32_reset` clears all request/result/source state without retaining host buffers.

The build passes `bridgeBuildId = "merc32-aro-v1-" ++ sourceTreeSha256` through a Zig build option and the bridge exports those exact UTF-8 bytes. Initialize Aro's source epoch to the provided value zero, so predefined date/time macros are deterministic without importing the host clock or environment.

- [ ] **Step 4: Route every include through the narrow resolver**

Add an optional `Compilation.SourceProvider` callback used by `findInclude` before any path-based I/O. In the freestanding bridge it is mandatory; host file APIs remain compiled out. Encode resolver results as `[u32 pathLength][canonical UTF-8 path][UTF-8 source]`, reject invalid UTF-8 and overlong records, and register the canonical path with Aro for cycle detection. Compile out `Preprocessor.verboseLog` stderr access under freestanding builds. Regenerate the machine-readable change records for `Compilation.zig` and `Preprocessor.zig`.

- [ ] **Step 5: Serialize the result envelope and full diagnostic chains**

`diagnostics.zig` maps Aro effective severity to `note | warning | error | fatal`, primary ranges, related ranges, notes, include trace, and macro expansion trace. The response state machine is exactly:

```zig
const Status = enum { ok, diagnostics, @"internal-error" };
const Envelope = struct {
    protocolVersion: u32 = 1,
    bridgeBuildId: []const u8,
    status: Status,
    diagnostics: []const Diagnostic,
    unit: ?TypedUnit = null,
};
```

Parser/sema errors return `diagnostics` without a unit; protocol and unknown-node failures return `internal-error`; resource failures return `diagnostics`. Do not call any legacy frontend.

- [ ] **Step 6: Run ABI tests and commit**

Run from `tools/aro-frontend`: `zig build test-data-model; zig build test-bridge`.
Expected: both pass; import audit reports one non-WASI import and memory maximum 2,048 pages.

```bash
git add third_party/aro/src/aro/Compilation.zig third_party/aro/src/aro/Preprocessor.zig third_party/aro/MERC32-CHANGES.json third_party/aro/MERC32-CHANGES.md tools/aro-frontend
git commit -m "feat: add bounded Aro WASM frontend bridge"
```

### Task 6: Serialize Types, Symbols, Exact Constants, And Static Initialization

**Files:**
- Create: `tools/aro-frontend/src/serialize_types.zig`
- Create: `tools/aro-frontend/src/serialize_symbols.zig`
- Create: `tools/aro-frontend/src/serialize_values.zig`
- Create: `tools/aro-frontend/src/serialize_initializers.zig`
- Modify: `tools/aro-frontend/src/serializer.zig`
- Create: `tools/aro-frontend/tests/fixtures/types-and-initializers.c`
- Create: `tools/aro-frontend/tests/serializer_types.zig`
- Modify: `merc32-vsce/scripts/fixtures/c-frontend/valid-unit-v1.json`

**Interfaces:**
- Produces stable source-order `TypeId` and `SymbolId` tables, exact `TypedConstant` values, and `TypedInitializer { size, zeroFill: true, writes }`.
- Consumes only analyzed Aro `Tree`, `QualType`, `Value`, and `DataModel.merc32`; no Aro enum ordinal appears in JSON.

- [ ] **Step 1: Add a failing semantic golden test**

The fixture includes typedef-qualified scalars, pointers, arrays, functions, nested struct/union/enum layout, signed/unsigned 64-bit extrema, float/double/long-double bit patterns, embedded-NUL strings, object/function addresses with positive and negative addends, partial aggregate initialization, chained field/index designators, and zero initialization. Assert exact public strings such as `"kind":"pointer"`, never Aro numeric tags.

- [ ] **Step 2: Run the serializer test and verify tables are empty**

Run from `tools/aro-frontend`: `zig build test-serializer-types`.
Expected: FAIL because the envelope contains no complete types, symbols, constants, or normalized writes.

- [ ] **Step 3: Implement deterministic interning and exact values**

Use structural keys with stable insertion order and explicit spelling helpers:

```zig
fn integerConstant(value: aro.Value, qt: aro.QualType, comp: *aro.Compilation) !IntegerConstant {
    var text: std.Io.Writer.Allocating = .init(comp.gpa);
    defer text.deinit();
    _ = try value.print(qt, comp, &text.writer);
    return .{
        .kind = .integer,
        .bits = @intCast(qt.bitSizeof(comp)),
        .signed = qt.signedness(comp) == .signed,
        .value = try text.toOwnedSlice(),
    };
}
```

Serialize floats from semantic bits rather than formatted decimals. Serialize addresses as referenced `SymbolId` plus signed decimal addend. Serialize strings as numeric bytes. Reject an Aro value kind without a contract representation as `internal-error`.

- [ ] **Step 4: Normalize initialization once on the Zig side**

Walk Aro's selected subobjects and constant-value map to emit ordered, non-overlapping writes. Every object starts zero-filled; scalar writes carry target type and exact constant, address writes remain relocatable, and union/designated selection uses Aro member offsets. Do not serialize initializer-list syntax for TypeScript to reinterpret.

- [ ] **Step 5: Run serializer plus TypeScript validation and commit**

Run: `zig build test-serializer-types` from `tools/aro-frontend`, then `npm run compile; node scripts/test-c-frontend-contract.js` from `merc32-vsce`.
Expected: both pass and repeated serializer output is byte-identical.

```bash
git add tools/aro-frontend/src tools/aro-frontend/tests merc32-vsce/scripts/fixtures/c-frontend/valid-unit-v1.json
git commit -m "feat: serialize MERC32 C types and constants"
```

### Task 7: Serialize C17 Expressions, Statements, Conversions, And Locations

**Files:**
- Create: `tools/aro-frontend/src/serialize_nodes.zig`
- Modify: `tools/aro-frontend/src/serializer.zig`
- Create: `tools/aro-frontend/tests/fixtures/control-and-expressions.c`
- Create: `tools/aro-frontend/tests/serializer_nodes.zig`
- Modify: `merc32-vsce/src/cFrontend/contract.ts`
- Modify: `merc32-vsce/src/cFrontend/validate.ts`
- Modify: `merc32-vsce/scripts/test-c-frontend-contract.js`

**Interfaces:**
- Produces every `TypedNodeRecord` needed by existing MERC32 programs: declarations; compound/local/return/if/while/do/for/switch/case/default/break/continue/goto/label/null statements; literals/references; unary/binary/conditional/assignment/call/subscript/member/sizeof/alignof expressions; and explicit conversions.
- Every lowerable node has a source range in an interned source file and every expression has type and value category.

- [ ] **Step 1: Add a failing node golden test**

Compile a fixture containing short-circuit operators, pre/post update, compound assignment, pointer arithmetic, direct and indirect calls, array decay, member access through `.` and `->`, casts, loops, switch fallthrough, labels/goto, `sizeof`, `_Alignof`, and nested macro expansion. Assert exact child ordering, explicit `lvalue-to-rvalue`, `array-to-pointer`, integer-promotion, usual-arithmetic, assignment, argument, and return conversion nodes, and both spelling and expansion locations.

- [ ] **Step 2: Run the node gate and verify unsupported nodes fail**

Run from `tools/aro-frontend`: `zig build test-serializer-nodes`.
Expected: FAIL at the first unmapped Aro node rather than silently omitting it.

- [ ] **Step 3: Implement an exhaustive named mapping**

The dispatcher uses Aro tag names only inside Zig and emits contract names:

```zig
return switch (node) {
    .compound_stmt => serializeCompound(self, index),
    .return_stmt => serializeReturn(self, index),
    .if_stmt => serializeIf(self, index),
    .while_stmt => serializeWhile(self, index),
    .do_while_stmt => serializeDoWhile(self, index),
    .for_stmt => serializeFor(self, index),
    .switch_stmt => serializeSwitch(self, index),
    .case_stmt => serializeCase(self, index),
    .default_stmt => serializeDefault(self, index),
    .break_stmt => serializeLeaf(self, index, "break"),
    .continue_stmt => serializeLeaf(self, index, "continue"),
    .goto_stmt => serializeGoto(self, index),
    .labeled_stmt => serializeLabel(self, index),
    .null_stmt => serializeLeaf(self, index, "empty"),
    else => serializeExpressionOrFail(self, index),
};
```

`serializeExpressionOrFail` has explicit branches for the expression vocabulary above and returns `error.UnknownAroNode` for everything else. Unsupported backend capabilities are still serialized when C semantics are known; the TypeScript adapter diagnoses them at their precise range.

- [ ] **Step 4: Validate location and node invariants on both sides**

Reject missing type/value-category metadata, invalid conversion source/target pairs, declaration/body category mismatches, case nodes without evaluated integer constants, labels outside the current function, and source ranges that are not UTF-8 byte boundaries.

- [ ] **Step 5: Run bridge, contract, and node tests and commit**

Run `zig build test-bridge; zig build test-serializer-types; zig build test-serializer-nodes`, then `npm run compile; node scripts/test-c-frontend-contract.js`.
Expected: all pass.

```bash
git add tools/aro-frontend/src tools/aro-frontend/tests merc32-vsce/src/cFrontend merc32-vsce/scripts/test-c-frontend-contract.js
git commit -m "feat: serialize MERC32 typed C syntax"
```

### Task 8: Build The Synchronous TypeScript WASM Host And Source Providers

**Files:**
- Create: `merc32-vsce/src/cFrontend/sourceProvider.ts`
- Create: `merc32-vsce/src/cFrontend/wasmHost.ts`
- Create: `merc32-vsce/src/cFrontend/frontend.ts`
- Create: `merc32-vsce/src/cFrontend/index.ts`
- Create: `merc32-vsce/scripts/test-c-frontend-host.js`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/include/user/value.h`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/include/main.c`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `SourceProvider.resolve(candidate: SourceCandidate): SourceResolution`, `MemorySourceProvider`, `NodeSourceProvider`, `CompositeSourceProvider`, and `CompatiblePreprocessSourceProvider`.
- Produces `CFrontendRequest`, `AroWasmHost.analyze(request: CFrontendRequest): TypedCEnvelopeV1`, `AroFrontend.analyzeSource`, and `AroFrontend.analyzeFile`.

- [ ] **Step 1: Add failing host/provider/lifecycle tests**

Test quoted versus angle lookup, explicit-directory ordering, virtual-file shadowing rules, canonical path deduplication, symlink/redirect containment rejection, `readFile`/`realPath`/`maxIncludeDepth` compatibility, malformed UTF-8 response, build-ID mismatch, lowered per-call limits, reentrant-call rejection, and one forced trap followed by a successful fresh-instance call. Assert the failed call is never retried on a legacy frontend.

- [ ] **Step 2: Run the focused host test and verify missing classes fail**

Run: `npm run compile; node scripts/test-c-frontend-host.js`.
Expected: FAIL because `out/cFrontend` host modules do not exist.

- [ ] **Step 3: Implement strict providers and compatibility options**

Use these public shapes:

```ts
export interface CFrontendOptions {
  readonly standard?: 'c17';
  readonly sourceName?: string;
  readonly defines?: Readonly<Record<string, string | undefined>>;
  readonly includePaths?: readonly string[];
  readonly virtualFiles?: readonly { readonly path: string; readonly source: string }[];
  readonly limits?: Partial<CFrontendLimits>;
}
export interface CFrontendRequest {
  readonly protocolVersion: 1;
  readonly mainPath: string;
  readonly source: string;
  readonly standard: 'c17';
  readonly defines: Readonly<Record<string, string | undefined>>;
  readonly includePaths: readonly string[];
  readonly virtualFiles: readonly { readonly path: string; readonly source: string }[];
  readonly limits: CFrontendLimits;
}
export type SourceResolution =
  | Readonly<{ status: 'found'; canonicalPath: string; source: string }>
  | Readonly<{ status: 'not-found' }>
  | Readonly<{ status: 'error'; message: string }>;
export interface SourceCandidate {
  readonly path: string;
  readonly includingPath?: string;
  readonly includeKind: 'quoted' | 'angle';
}
export interface SourceProvider { resolve(candidate: SourceCandidate): SourceResolution; }
export interface CPreprocessOptions {
  readonly readFile?: (file: string) => string;
  readonly realPath?: (file: string) => string;
  readonly maxIncludeDepth?: number;
}
```

Normalize logical paths without filesystem access in `MemorySourceProvider`. `NodeSourceProvider` resolves real paths, rejects anything outside the main directory, explicit include roots, or packaged header root, reads exact regular files only, and never consults environment or compiler paths. `CompositeSourceProvider` checks a matching virtual-file candidate before the filesystem candidate at the same include-search position, so virtual files can deliberately shadow that exact logical file without changing directory precedence. The compatibility provider delegates supplied `readFile` and `realPath` callbacks and validates `maxIncludeDepth` in `1..32`.

- [ ] **Step 4: Implement the warm non-reentrant host**

```ts
analyze(request: CFrontendRequest): TypedCEnvelopeV1 {
  if (this.active) throw new CFrontendInternalError('Aro frontend call is reentrant');
  this.active = true;
  try {
    const instance = this.instance ?? (this.instance = this.instantiate());
    return validateEnvelope(this.invoke(instance, request), this.manifest.bridgeBuildId);
  } catch (error) {
    if (error instanceof WebAssembly.RuntimeError) this.instance = undefined;
    throw error;
  } finally {
    this.active = false;
  }
}
```

Load `resources/c-frontend/build-manifest.json` and `aro-merc32.wasm` relative to the compiled extension root, verify the WASM SHA-256 and build identity before instantiation, audit imports, cap request/result decoding, and copy bytes through exported dynamic allocation.

`getAroFrontend(): AroFrontend` returns the process singleton. `analyzeSource(source, options): TypedCEnvelopeV1` uses a memory/composite provider and `sourceName ?? "merc32-input.c"`; `analyzeFile(sourceFile, options, preprocessCompatibility?): TypedCEnvelopeV1` uses a contained Node/composite provider and derives the main logical path from the canonical file.

- [ ] **Step 5: Run host, contract, and resource-boundary tests and commit**

Run: `npm run compile; node scripts/test-c-frontend-contract.js; node scripts/test-c-frontend-host.js`.
Expected: all pass, including trap recovery on the next distinct invocation.

```bash
git add merc32-vsce/src/cFrontend merc32-vsce/scripts/test-c-frontend-host.js merc32-vsce/scripts/fixtures/c-frontend/include merc32-vsce/package.json
git commit -m "feat: host Aro frontend WASM synchronously"
```

### Task 9: Adapt Typed Units Into The Existing MERC32 Backend

**Files:**
- Create: `merc32-vsce/src/cCompiler/loweringModel.ts`
- Create: `merc32-vsce/src/cCompiler/backendAdapter.ts`
- Modify: `merc32-vsce/src/cCompiler/lower.ts`
- Modify: `merc32-vsce/src/cCompiler/types.ts`
- Modify: `merc32-vsce/src/cCompiler/ir.ts`
- Modify: `merc32-vsce/src/cCompiler/codegen.ts`
- Create: `merc32-vsce/scripts/test-c-frontend-backend.js`

**Interfaces:**
- Produces `adaptTypedUnit(unit: TypedCUnitV1): LoweringProgram` and `lowerProgram(program: LoweringProgram): Merc32Module`.
- Produces `CBackendCapabilityError` carrying `readonly diagnostics: readonly CFrontendDiagnostic[]`; it never calls `analyzeTranslationUnit`.

- [ ] **Step 1: Add failing adapter/backend tests from typed-unit fixtures**

Cover scalar arithmetic, conversions, control flow, calls, pointer memory, globals, strings, aggregate member offsets, normalized designated initializers, address relocations, and debug locations. Add precise rejection cases for 64-bit operations lacking backend support, floating operations without runtime lowering, variadic functions, atomics, TLS, complex values, packed records, bit-fields, over-alignment, and unsupported builtins.

- [ ] **Step 2: Run the backend test and verify no adapter exists**

Run: `npm run compile; node scripts/test-c-frontend-backend.js`.
Expected: FAIL because `adaptTypedUnit` is missing.

- [ ] **Step 3: Define backend-owned nodes with explicit semantics**

```ts
export interface LoweringExpression {
  readonly kind: string;
  readonly type: CType;
  readonly valueCategory: 'lvalue' | 'function' | 'rvalue';
  readonly location: SourceLocation;
  readonly operands: readonly LoweringExpression[];
  readonly symbol?: string;
  readonly operator?: string;
  readonly constant?: bigint | Readonly<{ symbol: string; addend: bigint }>;
}
export interface LoweringGlobal {
  readonly name: string;
  readonly type: CType;
  readonly initializer?: Readonly<{ size: number; writes: readonly LoweringInitializerWrite[] }>;
}
export interface LoweringProgram {
  readonly abi: 'merc32-c-v1';
  readonly globals: readonly LoweringGlobal[];
  readonly functions: readonly LoweringFunction[];
}
export type LoweringInitializerValue = bigint | Readonly<{ symbol: string; addend: bigint }>;
export interface LoweringInitializerWrite {
  readonly offset: number;
  readonly type: CType;
  readonly value: LoweringInitializerValue;
  readonly location: SourceLocation;
}
```

The adapter resolves IDs once, preserves explicit conversions and exact constants, checks serialized layout against `MERC32_ABI`, and converts to JavaScript `number` only after proving the backend operation is at most 32 bits and in range.

- [ ] **Step 4: Refactor lowering to consume semantic nodes directly**

Remove imports from `sema.ts`, `declarations.ts`, and `initializers.ts`. Add `IRGlobal.initializerBytes` and `IRGlobal.initializerRelocations`, lower integer writes directly into little-endian bytes, and lower address writes into zero bytes plus `ABS32` data relocations with symbol/addend/debug location. Use serialized member offsets and evaluated case values; retain existing instruction selection. Emit `CBackendCapabilityError` at the typed node's source range for every unavailable operation.

- [ ] **Step 5: Run adapter and existing backend tests and commit**

Run: `npm run compile; node scripts/test-c-frontend-backend.js; node scripts/test-c-backend.js; node scripts/test-c-advanced-backend.js; node scripts/test-mobj-format.js; node scripts/test-linker-relocations.js`.
Expected: all pass and a source scan shows no `analyzeTranslationUnit` reference in `backendAdapter.ts` or `lower.ts`.

```bash
git add merc32-vsce/src/cCompiler/loweringModel.ts merc32-vsce/src/cCompiler/backendAdapter.ts merc32-vsce/src/cCompiler/lower.ts merc32-vsce/src/cCompiler/types.ts merc32-vsce/src/cCompiler/ir.ts merc32-vsce/src/cCompiler/codegen.ts merc32-vsce/scripts/test-c-frontend-backend.js
git commit -m "feat: adapt Aro typed units to MERC32 lowering"
```

### Task 10: Switch The Object APIs And Gate Explicit Differential Parity

**Files:**
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Modify: `merc32-vsce/src/cCompiler/source.ts`
- Create: `merc32-vsce/src/cCompiler/legacyFrontend.ts`
- Create: `merc32-vsce/scripts/c-frontend-differential.js`
- Create: `merc32-vsce/scripts/test-c-frontend-differential.js`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/overlap/scalars.c`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/overlap/control.c`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/overlap/calls.c`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/overlap/globals.c`
- Create: `merc32-vsce/scripts/fixtures/c-frontend/overlap/aggregates.c`
- Modify: `merc32-vsce/scripts/test-c-integration.js`
- Modify: `merc32-vsce/scripts/test-c-typed-rtl.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `compileCToObjectDetailed(source, options): CCompileDetailedResult<Merc32Object>` and `compileCFileToObjectDetailed(sourceFile, options): CCompileDetailedResult<Merc32Object>`.
- Produces `splitCompileOptions(options): { frontend: CFrontendOptions; backend: BackendCompileOptions }` so frontend-only keys never reach linking and backend-only keys never enter the bridge request.
- Existing object APIs delegate to detailed APIs, return `artifact` on success, and throw one `CFrontendError` containing all diagnostics on failure.

- [ ] **Step 1: Add failing object-API and no-fallback tests**

```js
const detailed = compileCToObjectDetailed('int main(void) { return 3; }', { sourceName: 'main.c' });
assert.strictEqual(detailed.artifact.target, 'merc32');
assert.deepStrictEqual(detailed.diagnostics.filter(item => item.severity === 'error'), []);
assert.throws(
  () => compileCToObject('int main( { return 0; }'),
  error => error.name === 'CFrontendError' && error.diagnostics.length > 0,
);
```

Instrument the explicit legacy harness and assert it is invoked only by `c-frontend-differential.js`, never by either production function after an Aro diagnostic, protocol failure, resource failure, or trap.

- [ ] **Step 2: Run object integration and observe the old pipeline**

Run: `npm run compile; node scripts/test-c-integration.js; node scripts/test-c-frontend-differential.js`.
Expected: FAIL because the detailed APIs are missing and `compileCToObject` still calls handwritten tokenize/parse/sema.

- [ ] **Step 3: Implement Aro-only object compilation**

```ts
export function compileCToObjectDetailed(
  source: string,
  options: CompileOptions = {},
): CCompileDetailedResult<Merc32Object> {
  const { frontend: frontendOptions } = splitCompileOptions(options);
  const envelope = getAroFrontend().analyzeSource(source, frontendOptions);
  const diagnostics = normalizeDiagnostics(envelope.diagnostics);
  if (!envelope.unit || hasErrors(diagnostics)) return { diagnostics };
  try {
    const artifact = generateObject(lowerProgram(adaptTypedUnit(envelope.unit)));
    return { artifact, diagnostics };
  } catch (error) {
    if (error instanceof CBackendCapabilityError) {
      return { diagnostics: [...diagnostics, ...error.diagnostics] };
    }
    throw error;
  }
}
```

The throwing wrapper requires `artifact`, otherwise throws from the full diagnostic list. The file API passes the original file to `NodeSourceProvider`; it does not call `preprocessCFile` or remap flattened lines.

- [ ] **Step 4: Compare observable outputs across the overlap corpus**

The differential harness invokes the two frontends independently and compares normalized `.mobj` section bytes/source, symbols, relocations, ABI, and debug locations; where assembly labels differ it links and compares machine words or RTL-visible result. It prints both failures without treating one as fallback. Newly accepted Aro-only syntax is covered by Aro golden tests, not added to the handwritten parser.

- [ ] **Step 5: Run the object, differential, linker, runtime, and RTL gate**

Run from `merc32-vsce`:

```text
npm run compile
node scripts/test-c-frontend-contract.js
node scripts/test-c-frontend-host.js
node scripts/test-c-frontend-backend.js
node scripts/test-c-frontend-differential.js
node scripts/test-c-integration.js
node scripts/test-c-typed-rtl.js
node scripts/test-linker-integration.js
node scripts/test-runtime-startup.js
npm run test:c:rtl
```

Expected: all pass through Aro for production calls and through both explicitly in the differential harness.

- [ ] **Step 6: Commit the first production cutover**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/scripts/c-frontend-differential.js merc32-vsce/scripts/test-c-frontend-differential.js merc32-vsce/scripts/test-c-integration.js merc32-vsce/scripts/test-c-typed-rtl.js merc32-vsce/scripts/fixtures/c-frontend/overlap merc32-vsce/package.json
git commit -m "feat: compile MERC32 objects through Aro"
```

### Task 11: Switch Assembly/File APIs And Publish VS Code Problems

**Files:**
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Modify: `merc32-vsce/src/compilerService.ts`
- Modify: `merc32-vsce/src/extensionCommands.ts`
- Modify: `merc32-vsce/src/extension.ts`
- Create: `merc32-vsce/src/cDiagnostics.ts`
- Create: `merc32-vsce/scripts/test-c-frontend-diagnostics.js`
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/scripts/test-c-preprocessor.js`
- Modify: `merc32-vsce/src/test/suite/extension.test.ts`

**Interfaces:**
- Produces `compileCDetailed` and `compileCFileDetailed` returning `CCompileDetailedResult<CompileResult>` while `compileC` and `compileCFile` still return `{ assembly: string }` on success.
- Produces `validateDlbImage(image: LinkedImage, dataBase: number, dlbAddrWidth: number): void` and converts option/link capacity failures into normalized diagnostics.
- Produces disposable `CDiagnostics` backed by collection `merc32-c`, with source `MERC32 C` and related information.

- [ ] **Step 1: Add failing successful-shape, option, warning, and Problems tests**

Assert source and file entry points preserve `{ assembly }`, `moduleName`, `codeBase`, `dataBase`, `dlbAddrWidth`, and `tempSlots` behavior or return a precise option/capability diagnostic. Test unsupported standard, Aro warning with successful artifact, include and macro traces, backend-capability range, multiple errors, clearing stale diagnostics after success, and related locations in included headers.

- [ ] **Step 2: Run public API and extension tests and verify the old compiler remains active**

Run: `npm run compile; npm run test:c; node scripts/test-c-frontend-diagnostics.js`.
Expected: FAIL because `compileC` still aliases the legacy direct generator and no C diagnostic collection exists.

- [ ] **Step 3: Link one generated object into the legacy result shape**

```ts
export function compileCDetailed(source: string, options: CompileOptions = {}): CCompileDetailedResult<CompileResult> {
  const objectResult = compileCToObjectDetailed(source, options);
  if (!objectResult.artifact) return { diagnostics: objectResult.diagnostics };
  const image = linkObjects([objectResult.artifact], {
    textBase: options.codeBase ?? 0,
    dataBase: options.dataBase ?? 0x0800_0000,
  });
  validateDlbImage(image, options.dataBase ?? 0x0800_0000, options.dlbAddrWidth ?? 16);
  return { artifact: { assembly: image.assembly }, diagnostics: objectResult.diagnostics };
}
```

Move `CompileOptions` and `CompileResult` to a retained backend-neutral module before deleting `tinyc.ts`. Validate `dlbAddrWidth` in `1..25`; preserve `tempSlots` semantics in frame allocation or issue a specific option diagnostic before cutover. File compilation uses Aro on original sources and the same link path.

- [ ] **Step 4: Publish all normalized diagnostics in VS Code**

`CDiagnostics.update(result)` groups diagnostics by canonical URI, reads the corresponding source snapshot, converts UTF-8 byte offsets to VS Code zero-based UTF-16 positions, sets severity/source/code, and adds `DiagnosticRelatedInformation` for related/include/macro ranges. Commands clear affected files, publish warnings even on success, publish errors before calling `runner.showError`, and dispose the collection on deactivation.

- [ ] **Step 5: Run API, diagnostics, integration, and extension tests and commit**

Run: `npm run compile; npm run test:c; npm run test:c:preprocessor; node scripts/test-c-frontend-diagnostics.js; node scripts/test-c-integration.js; npm run test:extension`.
Expected: all pass, multi-file compilation uses Aro, and Problems contains the complete normalized diagnostic set.

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/src/compilerService.ts merc32-vsce/src/extensionCommands.ts merc32-vsce/src/extension.ts merc32-vsce/src/cDiagnostics.ts merc32-vsce/scripts/test-c-compiler.js merc32-vsce/scripts/test-c-preprocessor.js merc32-vsce/scripts/test-c-frontend-diagnostics.js merc32-vsce/src/test/suite/extension.test.ts
git commit -m "feat: switch MERC32 C commands to Aro"
```

### Task 12: Remove Every Handwritten Production Frontend

**Files:**
- Delete: `merc32-vsce/src/cCompiler/tinyc.ts`
- Delete: `merc32-vsce/src/cCompiler/lexer.ts`
- Delete: `merc32-vsce/src/cCompiler/parser.ts`
- Delete: `merc32-vsce/src/cCompiler/sema.ts`
- Delete: `merc32-vsce/src/cCompiler/declarations.ts`
- Delete: `merc32-vsce/src/cCompiler/initializers.ts`
- Delete: `merc32-vsce/src/cCompiler/ast.ts`
- Delete: `merc32-vsce/src/cCompiler/legacyFrontend.ts`
- Delete: `merc32-vsce/src/cPreprocessor.ts`
- Delete: `merc32-vsce/scripts/c-frontend-differential.js`
- Delete: `merc32-vsce/scripts/test-c-parser.js`
- Delete: `merc32-vsce/scripts/test-c-sema.js`
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/scripts/test-c-preprocessor.js`
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/scripts/test-c-integration.js`

**Interfaces:**
- Leaves Aro as the only production and test-supported C preprocessor/parser/sema.
- Retains `CPreprocessOptions` as a compatibility type exported by `cFrontend/sourceProvider.ts`; removes the standalone handwritten `preprocessCFile` API after callers migrate.

- [ ] **Step 1: Add a source-ownership gate that initially fails**

Add assertions to `test-c-integration.js`:

```js
for (const removed of ['tinyc.ts', 'lexer.ts', 'parser.ts', 'sema.ts', 'declarations.ts', 'initializers.ts', 'ast.ts']) {
  assert.ok(!fs.existsSync(path.join(extensionRoot, 'src', 'cCompiler', removed)), `${removed} must be removed`);
}
assert.ok(!fs.existsSync(path.join(extensionRoot, 'src', 'cPreprocessor.ts'));
function readTypeScriptTree(root) {
  return fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
    .map(entry => entry.isDirectory()
      ? readTypeScriptTree(path.join(root, entry.name))
      : entry.name.endsWith('.ts') ? fs.readFileSync(path.join(root, entry.name), 'utf8') : '')
    .join('\n');
}
const production = readTypeScriptTree(path.join(extensionRoot, 'src'));
assert.doesNotMatch(production, /compileLegacyC|tokenizeC|parseTranslationUnit|analyzeTranslationUnit|preprocessCFile/);
```

- [ ] **Step 2: Run the gate and verify old sources are still detected**

Run: `npm run compile; node scripts/test-c-integration.js`.
Expected: FAIL listing the retained handwritten files.

- [ ] **Step 3: Move remaining neutral types and delete the old implementation**

Move any still-used `CType`, `SourceLocation`, and compile option/result definitions into `types.ts`, `loweringModel.ts`, and `cFrontend` before deletion. Convert old preprocessor tests into Aro file/source-provider tests for macros, token pasting, stringizing, variadics, conditionals, cycles, depths, source traces, and compatibility callbacks. Remove the temporary differential script and package command; keep its overlap corpus as permanent Aro backend regression input.

- [ ] **Step 4: Run the complete post-removal C/backend/RTL matrix**

Run from `merc32-vsce`:

```text
npm run compile
npm test
npm run test:c
npm run test:c:preprocessor
npm run test:c:rtl
node scripts/test-c-types.js
node scripts/test-c-frontend-contract.js
node scripts/test-c-frontend-host.js
node scripts/test-c-frontend-backend.js
node scripts/test-c-frontend-diagnostics.js
node scripts/test-c-integration.js
node scripts/test-c-typed-rtl.js
node scripts/test-mobj-format.js
node scripts/test-linker-integration.js
node scripts/test-linker-relocations.js
node scripts/test-runtime-packaging.js
node scripts/test-runtime-startup.js
node scripts/test-runtime-integer.js
node scripts/test-runtime-float32.js
node scripts/test-runtime-float64-abi.js
```

Expected: all pass; `rg` finds no removed symbol in production `src`.

- [ ] **Step 5: Commit permanent cutover**

```bash
git add -A merc32-vsce/src merc32-vsce/scripts merc32-vsce/package.json
git commit -m "refactor: remove handwritten C frontend"
```

### Task 13: Commit Reproducible WASM Resources And Prepare Offline VSIX Audits

**Files:**
- Create: `tools/aro-frontend/rebuild.js`
- Create: `merc32-vsce/resources/c-frontend/aro-merc32.wasm`
- Create: `merc32-vsce/resources/c-frontend/build-manifest.json`
- Create: `merc32-vsce/resources/c-frontend/include/stddef.h`
- Create: `merc32-vsce/resources/c-frontend/include/stdint.h`
- Create: `merc32-vsce/resources/c-frontend/include/stdbool.h`
- Create: `merc32-vsce/resources/c-frontend/include/limits.h`
- Create: `merc32-vsce/resources/c-frontend/include/float.h`
- Create: `merc32-vsce/resources/c-frontend/include/stdalign.h`
- Create: `merc32-vsce/resources/c-frontend/include/iso646.h`
- Create: `merc32-vsce/resources/c-frontend/include/stdnoreturn.h`
- Create: `merc32-vsce/resources/c-frontend/licenses/ARO-LICENSE`
- Create: `merc32-vsce/resources/c-frontend/licenses/UNICODE-LICENSE`
- Create: `merc32-vsce/resources/c-frontend/typed-c-unit-v1.schema.json`
- Modify: `merc32-vsce/scripts/prepare-resources.js`
- Modify: `merc32-vsce/scripts/test-extension-resource-stage.js`
- Modify: `merc32-vsce/scripts/test-extension-resources.js`
- Modify: `merc32-vsce/scripts/test-vsix-runtime-deps.js`
- Modify: `merc32-vsce/scripts/test-vsix-smoke.js`
- Create: `merc32-vsce/scripts/test-c-frontend-package.js`
- Create: `merc32-vsce/scripts/benchmark-c-frontend.js`
- Modify: `merc32-vsce/scripts/smoke-extension/suite/index.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `node tools/aro-frontend/rebuild.js --zig $env:MERC32_ZIG` and an atomic verified artifact/manifest pair; `MERC32_ZIG` is a task-specific absolute path to the pinned Zig executable.
- Extends the resource manifest and VSIX audit to cover every `resources/c-frontend/**` file and its SHA-256.

- [ ] **Step 1: Add failing provenance, resource, import, and offline smoke tests**

Assert committed resources exist, headers agree with `MERC32_ABI`, licenses match vendored bytes, build manifest fields are exact, the manifest WASM digest matches bytes, WASM imports contain only `merc32_source.resolve`, memory maximum is 128 MiB, `.vscodeignore` retains `resources/**`, and the VSIX contains no Zig executable or Aro source tree. Extend installed smoke to compile `main.c` including a sibling header and packaged `stdint.h` while network APIs and host compiler discovery/process launch are blocked.

- [ ] **Step 2: Run package tests and verify resources are absent**

Run: `npm run test:extension:resources; node scripts/test-c-frontend-package.js`.
Expected: FAIL because the committed WASM/headers/manifest are missing.

- [ ] **Step 3: Implement an exact-version, temporary, atomic rebuild**

The script requires an absolute regular Zig executable, runs `zig version`, and requires exact output `0.17.0-dev.1936+5a625d5f3`. It builds in an owned temporary directory, runs all Zig contract tests against the candidate, hashes sorted vendored Aro and bridge sources, audits imports/memory, and writes the following object using the computed variables:

```js
const manifest = {
  manifestVersion: 1,
  aroRevision: 'ec463262c14c1111fc9323086b708ad3b0b9ca11',
  zigVersion: '0.17.0-dev.1936+5a625d5f3',
  bridgeProtocolVersion: 1,
  typedUnitSchemaVersion: 1,
  target: 'merc32',
  abi: 'merc32-c-v1',
  dataModel: 'merc32-ilp32',
  bridgeBuildId: `merc32-aro-v1-${sourceTreeSha256}`,
  sourceTreeSha256,
  wasmSha256,
};
```

Only after every check passes does it atomically replace `aro-merc32.wasm` and `build-manifest.json`. A failed build leaves committed artifacts byte-identical.

- [ ] **Step 4: Add the minimal freestanding headers and stage them as immutable inputs**

Define the shipped aliases and limits directly from the data model. The core declarations are:

```c
/* stddef.h */
typedef unsigned int size_t;
typedef int ptrdiff_t;
typedef int wchar_t;
typedef struct { long long __ll; long double __ld; } max_align_t;

/* stdint.h */
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef int intptr_t;
typedef unsigned int uintptr_t;
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
```

Use model-derived integer and floating limit macros, `_Alignof(max_align_t) == 4`, `alignas/_Alignas`, `alignof/_Alignof`, ISO alternative operator tokens, and `_Noreturn`. Do not ship `stdarg.h` until a MERC32 `va_list` representation exists, and do not ship hosted I/O, allocation, time, signal, wide-character, threads, atomics, or host libc headers. The data-model matrix still verifies `wint_t` and `sig_atomic_t` internally without claiming the withheld library APIs.

- [ ] **Step 5: Extend deterministic resource preparation and archive auditing**

Treat `resources/c-frontend` as authoritative static input: validate exact files/no links, include sorted records in `resource-manifest.json`, never delete or rewrite it during ordinary `prepare:resources`, and make the archive audit reject missing/extra/aliased entries. `test-c-frontend-package.js` runs in resource-only mode without a VSIX and accepts a VSIX path in Task 14 to audit `extension/package.json`, resource hashes, imports, and normalized archive content.

- [ ] **Step 6: Build the committed candidate and run package gates**

Set `$env:MERC32_ZIG` to the absolute pinned Zig executable, run `node tools/aro-frontend/rebuild.js --zig $env:MERC32_ZIG`, then from `merc32-vsce`:

```text
npm run test:extension:resources
npm run prepare:resources
npm run compile
node scripts/test-c-frontend-package.js
node scripts/benchmark-c-frontend.js
npm run test:vsix:deps
```

Expected: all resource/unit gates pass offline after the artifact is built. The benchmark records cold time, 100-call warm mean, RSS delta, WASM bytes, and configured memory maximum as evidence; only the 4 MiB artifact ceiling and 128 MiB memory maximum are pass/fail thresholds. Do not create a VSIX in this task; release packaging occurs only after Task 14's version metadata commit.

- [ ] **Step 7: Commit audited runtime resources**

```bash
git add tools/aro-frontend/rebuild.js merc32-vsce/resources/c-frontend merc32-vsce/scripts/prepare-resources.js merc32-vsce/scripts/test-extension-resource-stage.js merc32-vsce/scripts/test-extension-resources.js merc32-vsce/scripts/test-vsix-runtime-deps.js merc32-vsce/scripts/test-vsix-smoke.js merc32-vsce/scripts/test-c-frontend-package.js merc32-vsce/scripts/benchmark-c-frontend.js merc32-vsce/scripts/smoke-extension/suite/index.js merc32-vsce/package.json
git commit -m "build: package verified Aro frontend resources"
```

### Task 14: Version, Provenance-Rebuild, Package, And Smoke The Feature Release

**Files:**
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/package-lock.json` at top-level `version` and `packages[""].version` only
- Modify: `merc32-vsce/README.md` version badge
- Verify without source changes: `merc32-vsce/resources/c-frontend/**`
- Produce ignored artifact: `merc32-vsce/merc32-vsce.vsix`

**Interfaces:**
- Consumes the last published extension version and applies a single MINOR increment with PATCH reset.
- Produces a provenance-clean VSIX whose internal `extension/package.json` version equals the three source metadata locations.

- [ ] **Step 1: Run the final pre-release implementation gate on a clean commit**

Run every command from Task 12 Step 4, then `npm run test:extension`, `npm run test:soc`, `git diff --check`, and `git status --short`.
Expected: all tests pass and the only worktree changes are generated resources already known to be reproducible; restore none of the user's unrelated work.

- [ ] **Step 2: Determine and record the actual published version**

Run `node node_modules/@vscode/vsce/vsce show Vikai-mercer.merc32-vsce --json` from `merc32-vsce`, parse its latest published version, and record it in the release output. For published `X.Y.Z`, compute the intended release exactly as `X.(Y+1).0`. If source metadata already equals that intended release because this same release is being rebuilt, keep it unchanged. Abort on inconsistent source/package-lock/badge versions or an unexpected newer published version.

- [ ] **Step 3: Update exactly the three required metadata surfaces**

Set `package.json.version`, `package-lock.json.version`, `package-lock.json.packages[""].version`, and the README badge text to the computed intended version. Verify with:

```js
assert.strictEqual(pkg.version, lock.version);
assert.strictEqual(pkg.version, lock.packages[''].version);
assert.ok(readme.includes(`Version-${pkg.version}-blue.svg`));
```

- [ ] **Step 4: Commit version metadata before the provenance build**

```bash
git add merc32-vsce/package.json merc32-vsce/package-lock.json merc32-vsce/README.md
git commit -m "release: prepare MERC32 C frontend feature version"
```

- [ ] **Step 5: Perform the final provenance rebuild and prove no artifact drift**

Set `$env:MERC32_ZIG` to the absolute pinned Zig executable, run `node tools/aro-frontend/rebuild.js --zig $env:MERC32_ZIG`, then `git diff --exit-code -- merc32-vsce/resources/c-frontend third_party/aro tools/aro-frontend`.
Expected: the rebuilt WASM, manifests, schema, headers, and licenses are byte-identical to the committed artifacts. Any diff blocks packaging and is fixed/reviewed as implementation work, not hidden in the release commit.

- [ ] **Step 6: Build and audit the final VSIX**

Run from `merc32-vsce`:

```text
npm run test:extension:resources
npm run prepare:resources
npm run compile
npm run package:vsix
node scripts/test-c-frontend-package.js merc32-vsce.vsix
npm run test:vsix:deps
npm run test:vsix
```

Open `extension/package.json` from `merc32-vsce.vsix` with the existing archive audit and assert its `version` equals source. Assert WASM/headers/licenses/build manifest hashes match `extension/resources/resource-manifest.json`, no WASI import exists, and the clean installed multi-file C smoke passes with network and host-tool discovery blocked.

- [ ] **Step 7: Rebuild once more without a second version increment**

Package the same committed tree to a second temporary VSIX, compare normalized archive contents byte-for-byte, and rerun the version assertions. Expected: identical audited content and unchanged intended version.

## Self-Review Checklist

- Task 1 preserves and independently commits the existing aggregate-initializer work before Aro integration.
- Tasks 2-3 pin Aro, licenses, Zig, explicit `DataModel.merc32`, every scalar/alias/layout rule, target macros, capability absences, and freestanding initialization.
- Tasks 4, 6, and 7 define and exhaustively serialize/validate versioned identities, graph references, source ranges, types, symbols, expressions, statements, conversions, exact constants, and normalized initialization.
- Tasks 5 and 8 enforce one resolver import, no WASI, deterministic include order, canonical paths, all hard limits, synchronous non-reentrancy, warm reuse, and trap invalidation/recovery.
- Tasks 9-11 preserve backend/object/linker/runtime ownership, do not rerun handwritten sema, keep successful public result shapes, add detailed results, surface backend capability failures, and publish complete VS Code diagnostics.
- Tasks 10 and 12 make differential execution explicit, prohibit fallback, gate observable parity and RTL, then remove all handwritten production frontend/preprocessor sources and obsolete tests.
- Tasks 13-14 cover committed WASM/headers/licenses/manifests, SHA-256/import/memory/package audits, no-Zig/no-network ordinary operation, deterministic package content, the required MINOR policy, metadata-first commit order, internal VSIX version verification, and repository VSIX smoke.
- No CPU RTL, ISA encoding, `.mobj` version, linker semantics, calling convention, or runtime algorithm is changed merely for Aro integration.
- Every produced function/type name is defined before or in the task that consumes it; the plan contains no deferred implementation placeholder.
