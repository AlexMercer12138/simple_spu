# Aro MERC32 C Frontend Integration Design

**Status:** Approved design draft for review

**Goal:** Replace the handwritten production C frontend with a pinned Aro
frontend while preserving the project-owned MERC32 IR, ABI lowering, code
generator, `.mobj` format, linker, runtime, and final output formats.

## Approved Decisions

- Aro is the production parser and semantic frontend after a gated migration.
- Aro receives an explicit `DataModel.merc32`; the public target identity is
  `merc32`, the ABI is `merc32-c-v1`, and the data model is `merc32-ilp32`.
- The default language mode is ISO C17 in a freestanding environment.
- Aro emits a versioned, frontend-neutral `MERC32 Typed C Unit v1`; it does not
  expose its private AST or enum values to TypeScript.
- The migration uses the handwritten frontend only for temporary differential
  validation. There is no permanent user-facing frontend selector and no
  automatic fallback after an Aro failure.
- A pinned Aro source snapshot and a verified WASM artifact are committed to
  the repository. Ordinary extension packaging and runtime use require neither
  Zig nor network access.

## Current Context and Feasibility

The repository currently has three overlapping frontend paths:

- `cCompiler/tinyc.ts` is the legacy direct-to-assembly compiler used by
  `compileC` and `compileCFile`.
- `cPreprocessor.ts` is the handwritten file preprocessor.
- `cCompiler/lexer.ts`, `parser.ts`, and `sema.ts` feed the typed MERC32 IR and
  `.mobj` backend through `compileCToObject`.

The typed MERC32 IR, object code generator, linker, runtime catalog, and RTL
tests are project-specific and remain valuable. Replacing them with a foreign
backend would add work without improving C parsing or semantic correctness.

A throwaway feasibility probe used Aro commit
`ec463262c14c1111fc9323086b708ad3b0b9ca11` and Zig
`0.17.0-dev.1936+5a625d5f3`. It demonstrated:

- a freestanding WASM frontend with an in-memory request/result ABI;
- preprocessing with macros and virtual headers;
- structured diagnostics and original source locations;
- typed declarations, designated initializers, integer constants, and object
  and function address constants;
- a 1,582,175-byte WASM artifact;
- about 18-22 MiB of observed host RSS growth;
- about 19-22 ms for the first small analysis and about 0.5 ms mean time for
  100 warm small analyses.

The probe is not production code. The production bridge uses dynamically sized
buffers, the MERC32 data model, a complete typed-unit serializer, explicit
resource limits, and reproducible build metadata.

## Scope

This project delivers:

- the pinned Aro source snapshot and third-party notices;
- `DataModel.merc32` and its conformance tests;
- a freestanding Zig-to-WASM bridge;
- a restricted host source-provider interface for includes;
- the versioned `MERC32 Typed C Unit v1` contract and TypeScript validator;
- adapters from the typed unit to the existing MERC32 IR lowering;
- structured diagnostic propagation into the extension;
- differential, integration, RTL, package, and offline VSIX gates;
- removal of the handwritten production lexer, parser, semantic analyzer, and
  preprocessor after cutover.

The project does not change the CPU RTL, ISA encoding, `.mobj` version, linker
semantics, calling convention, or runtime algorithms merely to integrate Aro.

## Non-goals

- No hosted C environment, operating-system API, POSIX API, host libc, or host
  system headers.
- No Aro native-code backend, ELF backend, or Aro object-file format.
- No Zig fork and no new Zig CPU architecture enum.
- No runtime network fetch, dynamic package installation, or native helper
  executable.
- No permanent maintenance of two production C frontends.
- No promise that every valid C17 program is immediately lowerable by the
  existing MERC32 backend. Valid but unavailable target operations receive an
  explicit backend-capability diagnostic.
- No new variadic, atomic, thread-local, complex-number, packed-layout, or
  bit-field ABI as part of the frontend integration. Those features require
  separate ABI and backend work before code generation is enabled.

## Architecture

The production flow is:

```text
C source, logical path, macros, include paths, virtual files
        |
        v
Aro WASM using DataModel.merc32
  preprocess -> parse -> type check -> constant evaluation
        |
        v
MERC32 Typed C Unit v1 plus structured diagnostics
        |
        v
TypeScript schema and semantic-contract validation
        |
        v
existing MERC32 IR lowering and ABI lowering
        |
        v
existing code generator -> .mobj -> linker -> runtime -> output formats
```

Both `compileC` and `compileCToObject` use one `AroFrontend` service. The
source-string entry point uses an in-memory source provider. The file entry
point uses a Node source provider constrained by the compiler's include search
rules. The VS Code command layer remains a thin consumer of the same service.

The frontend/backend boundary is the typed-unit contract rather than an Aro
tree. An Aro upgrade therefore changes the vendored source and Zig serializer,
while a MERC32 ABI change remains in the TypeScript lowering and backend.

## Component Ownership

### Pinned Aro Source

`third_party/aro/` contains the tracked upstream source snapshot without its
`.git`, build cache, or generated output. It includes:

- the upstream revision in machine-readable metadata;
- Aro's MIT license;
- licenses for bundled Unicode data and any other retained third-party data;
- the local `DataModel.merc32` changes;
- a concise list of MERC32-owned files and modifications needed when updating
  the snapshot.

The initial snapshot is based on the probe's verified commit. Updating Aro is
an explicit change that updates the revision, reapplies or revises the MERC32
changes, rebuilds the WASM, and runs the entire conformance suite.

### MERC32 Bridge

`tools/aro-frontend/` owns the Zig bridge and its build definition. Keeping the
bridge outside the upstream snapshot makes its ownership and update boundary
clear. The bridge:

- initializes Aro in C17 freestanding mode with `DataModel.merc32`;
- obtains source contents only through the supplied source provider;
- invokes preprocessing, parsing, and semantic analysis;
- converts Aro's analyzed tree into the stable typed-unit vocabulary;
- serializes all diagnostics, including related locations and expansion
  traces;
- normalizes compile-time constants and static initializers;
- returns a protocol error rather than silently omitting an unknown Aro node
  introduced by an upstream update.

### TypeScript Frontend Host

`merc32-vsce/src/cFrontend/` owns:

- WASM loading and instance lifecycle;
- request construction and UTF-8 transfer;
- source-provider implementations;
- response decoding and limits;
- typed-unit structural and semantic validation;
- normalized public diagnostics;
- bridge build-manifest verification.

The host reuses a warm WASM instance for normal compilation. Calls are
synchronous and non-reentrant so the existing synchronous compile APIs remain
compatible. A trap invalidates the instance; the next invocation constructs a
fresh one.

### MERC32 Backend Adapter

The adapter converts validated contract records into frontend-neutral typed
nodes consumed by `cCompiler/lower.ts`. The adapter does not rerun the
handwritten semantic analyzer. It preserves:

- stable type, symbol, and node identities;
- explicit implicit conversions and value categories;
- evaluated constants and aggregate layout;
- source locations for every lowerable operation;
- normalized initialization writes and relocatable address values.

The existing `cCompiler/ir.ts`, `lower.ts`, `codegen.ts`, object format, linker,
and runtime stay TypeScript-owned.

## MERC32 Data Model

`DataModel.merc32` is an explicit Aro target profile. Aro's C-observable
queries must consult it for type widths, alignment, layout, predefined macros,
literal typing, integer ranks, floating formats, target capabilities, and
function alignment.

The profile is:

| C type or property | MERC32 definition |
|---|---:|
| `CHAR_BIT` | 8 |
| plain `char` | signed, 8-bit, align 1 |
| `signed char`, `unsigned char` | 8-bit, align 1 |
| `short`, `unsigned short` | 16-bit, align 2 |
| `int`, `unsigned int` | 32-bit, align 4 |
| `long`, `unsigned long` | 32-bit, align 4 |
| `long long`, `unsigned long long` | 64-bit, align 4 |
| `float` | IEEE-754 binary32, align 4 |
| `double` | IEEE-754 binary64, align 4 |
| `long double` | same representation as `double`, align 4 |
| object and function pointers | 32-bit byte addresses, align 4 |
| `enum` | `int` unless a later ABI revision states otherwise |
| `size_t` | `unsigned int` |
| `ptrdiff_t` | `int` |
| `intmax_t`, `uintmax_t` | signed and unsigned `long long` |
| byte order | little-endian |
| maximum natural aggregate alignment | 4 bytes |
| default function alignment | 4 bytes |

Struct fields use their natural alignment capped at four bytes. Struct size is
rounded to the aggregate alignment. Unions use offset zero for every member and
round the largest member size to the union alignment. Arrays inherit element
alignment. Explicit over-alignment beyond what the object format and backend
can guarantee is rejected during lowering.

The target defines `__MERC32__` and `__merc32__` as `1`, along with standard C
implementation macros derived from the table. The capability profile does not
claim binary128, 128-bit integers, TLS, hosted-library facilities, or target
builtins that the MERC32 backend cannot implement. MERC32-specific operations
remain explicit, documented intrinsics rather than generic target extensions.

Aro is the source of truth for frontend layout. The TypeScript backend retains
an independent `Merc32Abi` description because it must lower calls and memory
operations. Every typed unit carries explicit sizes, alignments, and member
offsets; the TypeScript validator compares them with `Merc32Abi` and fails on
drift before generating code.

## Language and Header Policy

The default and initially exposed language mode is ISO C17 freestanding. Aro
extensions are not enabled merely because Aro can parse them. A later explicit
option may add another dialect without changing the C17 default.

Include lookup order is deterministic:

1. for quoted includes, the including file's logical directory;
2. explicit user include directories in caller order;
3. packaged MERC32 freestanding compiler headers.

Angle-bracket includes skip step 1. No host compiler include path is inferred.
The package includes only headers whose definitions agree with the MERC32 data
model. A header may expose a type or macro before the backend implements every
operation on it, but use of an unavailable operation must produce a target
capability diagnostic. Headers whose public representation depends on an
undefined ABI are withheld until that ABI is designed.

Existing `CPreprocessOptions.readFile`, `realPath`, and `maxIncludeDepth`
behavior remains available through a compatibility adapter during this
release. New internal APIs use the source-provider abstraction directly.

## WASM and Source-Provider ABI

The WASM module is freestanding and has no WASI imports. It cannot open files,
read environment variables, access the clock, start processes, or use the
network. Its only host capability is a narrow synchronous source resolver.

The resolver accepts a normalized logical candidate path and returns either:

- a canonical logical path plus UTF-8 source contents;
- a not-found result; or
- a bounded host-read error.

The Node provider resolves only the main file directory, explicit include
directories, and packaged header root used by the current compilation. The
memory provider resolves only request-supplied virtual files. Canonical paths
support include-cycle detection and stable diagnostic locations.

The module exports a small versioned ABI for allocation, analysis, result
location, result length, reset, and build identity. Request and result buffers
are dynamically sized rather than fixed at the probe limits. Production
defaults are:

| Resource | Default and bridge hard maximum |
|---|---:|
| one source file | 4 MiB |
| all source files in one translation unit | 32 MiB |
| source file count | 4,096 |
| include depth | 32 |
| encoded request | 40 MiB |
| encoded result | 64 MiB |
| WASM linear memory | 128 MiB |

The constants live in one TypeScript limits module and are copied into the
request. Callers may lower a per-request limit but cannot exceed the bridge's
compiled hard maximum. The limits are tested at the boundary and reported as
resource diagnostics, not traps.

## Typed C Unit Contract

The result envelope contains:

```text
protocolVersion
bridgeBuildId
status: ok | diagnostics | internal-error
diagnostics[]
unit?: MERC32 Typed C Unit v1
```

The unit header contains exact identifiers:

```text
schema: merc32.typed-c-unit
schemaVersion: 1
target: merc32
abi: merc32-c-v1
dataModel: merc32-ilp32
language: c17-freestanding
```

The unit stores deterministic arrays of source files, types, symbols, nodes,
and top-level declarations. References use integer IDs, never JSON object
identity. The validator rejects duplicate IDs, missing references, illegal
cycles, invalid source ranges, impossible type/layout combinations, and values
outside the declared width.

Every expression records its type, value category, source range, and explicit
conversion operations required by C semantics. Symbols record linkage, storage
duration, definition state, type, declaration range, and stable source name.
Type records include qualifiers, size, alignment, and kind-specific fields;
aggregate records include member offsets and bit information even when the
current backend will reject bit-field lowering.

Constants never rely on JavaScript `number` for values wider than the safe
integer range:

- integers carry bit width, signedness, and a decimal or hexadecimal string;
- floating constants carry their semantic type and exact IEEE bit string;
- addresses carry symbol ID plus a signed addend;
- strings carry their element type and exact encoded bytes.

Static initialization is normalized into zero-fill plus ordered writes. A
write contains byte offset, target type, and either an exact constant or a
relocatable address. The backend therefore does not repeat C initializer-list
selection or constant-expression evaluation.

The schema is append-only within version 1 only for optional fields that old
readers explicitly permit. A required-field or semantic change increments the
schema version and updates both sides in one commit.

## Public API Compatibility

The established successful return types remain unchanged:

```ts
compileC(source, options): CompileResult
compileCFile(sourceFile, options): CompileResult
compileCToObject(source, options): Merc32Object
compileCFileToObject(sourceFile, options): Merc32Object
```

The compatible option surface adds:

```ts
interface CFrontendOptions {
  readonly standard?: 'c17';
  readonly sourceName?: string;
  readonly defines?: Readonly<Record<string, string | undefined>>;
  readonly includePaths?: readonly string[];
  readonly virtualFiles?: readonly {
    readonly path: string;
    readonly source: string;
  }[];
}
```

`sourceName` supplies the logical main path for a source-string compile. A file
entry point derives it from `sourceFile`. An unsupported `standard` value is an
option error rather than an implicit dialect change.

`compileCDetailed`, `compileCFileDetailed`, `compileCToObjectDetailed`, and
`compileCFileToObjectDetailed` return the artifact together with all
diagnostics. Existing methods delegate to them, return the artifact when there
are no errors, and throw `CFrontendError` when compilation cannot continue. The
error preserves the first primary location for compatibility and adds the
complete normalized diagnostic array.

`compileCToObject` switches first because it already owns the typed pipeline.
After the migration gates pass, `compileC` performs the existing single-object
link and returns the same assembly-oriented `CompileResult` shape. File entry
points allow Aro to preprocess original files directly, so the handwritten
preprocessor and its line-remapping layer leave the production path.

## Diagnostics and Failure Handling

Each normalized diagnostic contains severity, message, primary source range,
related ranges, notes, include trace, and macro-expansion trace when Aro
provides them.

- Frontend errors or fatal diagnostics prevent typed-unit consumption.
- Warnings accompany a successful detailed result and appear in the VS Code
  Problems view.
- A valid C construct that cannot yet be lowered produces a MERC32 backend
  capability diagnostic at the construct's range.
- A protocol mismatch, build-manifest mismatch, unknown serialized node,
  invalid reference, or invalid layout is an internal compiler error.
- A WASM trap is an internal compiler error and invalidates the current
  instance.
- Resource-cap violations are normal, actionable diagnostics.

Compilation never falls back to the handwritten frontend after any of these
failures. During migration, differential runs are explicit test-harness
operations whose two results are reported independently.

## Migration

Migration proceeds in bounded, reviewable stages:

1. Import the pinned source and licenses; add reproducible build metadata and
   baseline package-content tests.
2. Add `DataModel.merc32` and pass the standalone data-model conformance matrix.
3. Implement the bridge protocol, source provider, diagnostics, and typed-unit
   serializer with Zig-side contract tests.
4. Implement the TypeScript WASM host and strict typed-unit validator.
5. Adapt `compileCToObject` and the existing lowering to consume the typed unit.
6. Run explicit dual-frontend comparison on the overlap corpus and close
   backend gaps required by existing examples, runtime objects, and RTL tests.
7. Switch `compileC`, file compilation, and VS Code commands to Aro.
8. Run the complete post-switch gate, then remove handwritten frontend and
   preprocessor production modules and their obsolete tests.
9. Perform release versioning, provenance rebuild, VSIX packaging, archive
   inspection, and clean-install smoke.

Existing aggregate-initializer behavior may be removed from the handwritten
path only after equivalent Aro-path regression coverage passes.

## Testing

### Data-Model Conformance

A generated C matrix verifies:

- every scalar size and alignment in the profile table;
- signedness, integer ranks, literal suffix selection, and usual arithmetic
  conversions;
- `sizeof`, `_Alignof`, arrays, structs, unions, enums, and nested aggregates;
- little-endian constant representation;
- predefined MERC32 and standard implementation macros;
- absence of undeclared target capabilities;
- agreement between Aro layout records and the TypeScript `Merc32Abi` model.

### Bridge and Contract

Tests cover:

- main source plus virtual and filesystem headers;
- quoted and angle-bracket search order;
- include cycles, depth limits, missing files, and canonical paths;
- object-like and function-like macros, conditionals, token pasting, stringizing,
  variadic macros, and macro diagnostic traces;
- typed declarations, expressions, statements, implicit conversions, and
  source locations;
- exact signed and unsigned 64-bit values, IEEE floating bits, strings, object
  addresses, function addresses, and addends;
- scalar, aggregate, designated, partial, and zero initialization;
- malformed requests, malformed responses, stale versions, resource limits,
  and trap recovery;
- deterministic byte-identical JSON for the same request and bridge build.

### Differential and Backend Tests

The overlap corpus is compiled by both frontends. Comparisons operate on
observable behavior:

- `.mobj` section contents, symbols, relocations, ABI, and debug locations;
- linked assembly or machine words where deterministic equivalence applies;
- emulator or RTL-visible results for control flow, memory, calls, globals,
  aggregates, interrupt/MMIO examples, and runtime helpers.

Diagnostic wording and internal IDs need not match. Tests for newly accepted C
syntax use Aro-path golden semantic units and backend behavior rather than
forcing the handwritten frontend to learn the same feature.

### Repository and Package Gates

The complete gate includes existing C, preprocessor, object, linker, runtime,
extension, and RTL/Icarus suites plus new Aro tests. The packaged gate verifies:

- WASM, MERC32 headers, Aro license, Unicode/data licenses, and build manifest
  are present in the VSIX;
- their SHA-256 values match the staged resource manifest;
- `WebAssembly.Module.imports` contains only the documented source-provider
  capability and no WASI surface;
- a clean installed extension compiles a multi-file C sample while network
  access and host compiler discovery are blocked;
- packaging the same committed tree twice yields identical audited content;
- `extension/package.json` inside the VSIX has the same version as source.

Wall-clock measurements are recorded as regression evidence but are not flaky
CI pass/fail thresholds. WASM size and linear-memory hard maxima are enforced.

## Source, Build, and Package Provenance

The committed runtime artifacts are placed under
`merc32-vsce/resources/c-frontend/` and include:

- `aro-merc32.wasm`;
- packaged freestanding headers;
- a build manifest containing Aro revision, Zig version, bridge protocol,
  typed-unit schema version, source-tree digest, and WASM SHA-256;
- required third-party license files.

The exact Zig version is pinned but the large Zig toolchain is not committed.
The rebuild command accepts an explicit Zig executable, verifies its complete
version string, builds in a temporary output directory, and replaces the
artifact only after contract tests and digest generation succeed. Ordinary
`npm run package:vsix` validates and stages the committed artifact without
requiring Zig. CI and release provenance jobs rebuild it from the pinned source
before packaging.

This integration is a backward-compatible feature change, so its release uses
a MINOR version increment from the last published version and resets PATCH.
Immediately before the release package is built, determine the actual last
published version and update:

- `merc32-vsce/package.json`;
- both version fields in `merc32-vsce/package-lock.json`;
- the version badge in `merc32-vsce/README.md`.

Commit those version fields before the final provenance rebuild. Rebuilding the
same intended release does not increment the version again. After packaging,
verify the VSIX `extension/package.json` version and run the repository VSIX
smoke.

## Acceptance Criteria

The migration is complete only when:

1. Aro is the only production preprocessor, parser, and semantic frontend.
2. `DataModel.merc32` passes the full C data-model and capability matrix.
3. Existing compile API success shapes and object/linker contracts remain
   compatible.
4. The existing C examples compile, link, and pass their current runtime or RTL
   assertions through Aro.
5. Valid but unavailable target features fail with precise backend diagnostics;
   they never generate silently incorrect code.
6. The typed-unit validator detects version, layout, identity, and reference
   drift before lowering.
7. The VSIX works in a clean offline installation with no host C compiler or
   Zig installation.
8. Source revision, tool version, licenses, and WASM digest are auditable from
   the packaged resources.
9. The handwritten lexer, parser, semantic analyzer, and preprocessor are no
   longer reachable from production code and are removed after the final
   post-switch regression passes.
