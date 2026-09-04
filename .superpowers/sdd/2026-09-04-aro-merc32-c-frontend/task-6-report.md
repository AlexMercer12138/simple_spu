# Task 6 Report

Status: **DONE_WITH_CONCERNS**

## TDD Evidence

The semantic golden was added before production serialization. The pinned focused gate failed with an empty Task 5 table:

```text
zig build test-serializer-types
0 pass, 1 fail
missing expected "kind":"builtin"
exit 1
```

After type, symbol, constant, and initializer serialization, the focused test passed. Extending the bridge to a string-valued predefined macro then exposed two real integration failures in sequence: the original pointer initializer returned `UnsupportedValue`, and the first synthetic backing-symbol implementation returned `InvalidSourceMapping` for Aro's generated `__DATE__` token. Mapping generated literal ranges to the owning source declaration made the existing deterministic bridge scenario green without changing its diagnostic, resolver, resource, ABI, or memory behavior.

A zero-initialized bit-field regression was also added before its fix. It failed with `UnsupportedInitializer` because Aro normalizes `{ 0 }` to explicit semantic zero items. The initializer walker now lets zero-fill represent those bits while continuing to reject nonzero bit-field writes, for which the public contract has no bit-slice initializer form.

Final green:

```text
zig build test-serializer-types
exit 0

zig build test-bridge
Aro WASM bridge contract tests passed
exit 0

npm run compile
node scripts/test-c-frontend-contract.js
C frontend contract tests passed (75 malformed cases)
exit 0
```

All Zig commands used only `zig-x86_64-windows-0.17.0-dev.1936+5a625d5f3` from the task-provided toolchain.

## Implementation

- Added stable insertion-order type interning for public builtin, pointer, fixed array, prototype function, struct, union, enum, and typedef records. Structural equality deduplicates equivalent Aro types within the same public family without conflating enums with their integer representation.
- Serialized canonical MERC32 size/alignment, public qualifier strings, aggregate byte offsets, bit-field offset/width metadata, enum values, and source ranges. Function layout is normalized from Aro's internal sentinel to the contract's `0` size and `4` alignment.
- Added source-order variable, function, parameter, typedef, record, enum, enumerator, and internal string-backing symbols. Generated Aro declarations are excluded unless their declaration token belongs to the registered public source set.
- Serialized exact integer decimal strings, semantic IEEE hexadecimal float bits, embedded-NUL byte arrays, and relocatable object/function addresses with signed decimal byte addends. Nonzero integer pointer constants and unsupported Aro values fail serialization and retain the bridge's `internal-error` taxonomy.
- Normalized static objects to `{ size, zeroFill: true, writes }` by walking Aro's selected array, struct, and union subobjects. Writes are emitted in ascending, non-overlapping layout order; omitted and semantic-zero subobjects remain zero-filled.
- Added deterministic internal backing arrays for pointer-to-string initializers, including predefined macro strings whose Aro literal token is generated. Array string initializers remain direct string writes and do not create redundant backing symbols.

## Files And Scope

- `tools/aro-frontend/src/serialize_types.zig`
- `tools/aro-frontend/src/serialize_symbols.zig`
- `tools/aro-frontend/src/serialize_values.zig`
- `tools/aro-frontend/src/serialize_initializers.zig`
- `tools/aro-frontend/src/serializer.zig`
- `tools/aro-frontend/tests/fixtures/types-and-initializers.c`
- `tools/aro-frontend/tests/serializer_types.zig`
- `merc32-vsce/scripts/fixtures/c-frontend/valid-unit-v1.json`
- `tools/aro-frontend/build.zig`
- `tools/aro-frontend/src/bridge.zig`
- `.superpowers/sdd/2026-09-04-aro-merc32-c-frontend/task-6-report.md`

Scope ruling 1: `tools/aro-frontend/build.zig` is required to expose the brief's `test-serializer-types` gate and import the production serializer/Aro modules. The parent explicitly approved this minimal out-of-list edit.

Scope ruling 2: `tools/aro-frontend/src/bridge.zig` is required to pass the already analyzed Aro tree into the Task 6 serializer. The parent explicitly approved this one-line out-of-list edit.

No vendored Aro file, package version, lockfile, README badge, extension resource, backend, or packaging artifact changed. The repository release policy is not triggered because no package release or VSIX build is part of Task 6.

## Verification And Review

- Pinned `zig fmt --check` passed for all changed Zig files.
- Pinned `zig build test-serializer-types` passed, including byte-identical repeated output and parsed golden assertions for every required type/value/initializer family.
- Pinned `zig build test-bridge` passed, preserving Task 5 ABI, deterministic macro, diagnostics, resolver, source, resource, allocation, and result-limit coverage.
- The real WASM serializer output for `types-and-initializers.c` passed the compiled Task 4 `validateEnvelope` runtime validator.
- A direct WASM probe for `int *p = (int *)1;` returned `internal-error` with `UnsupportedValue` instead of an invalid successful envelope.
- `npm run compile` and all 75 TypeScript contract mutation cases passed.
- Reviewed the complete diff for closed JSON fields, canonical MERC32 layouts, ordered/non-overlapping writes, exact decimal and hexadecimal values, coherent original-source ranges, public spelling, structural ID reuse, and absence of Aro enum ordinals/private tags.
- `tools/aro-frontend/.zig-cache/` remains untracked and will not be staged. No generated WASM or extension resource is included.

## Concern

Vendored Aro canonicalizes unary floating negative zero before the serializer sees it: its negation path computes `+0 - +0`, which interns the positive-zero sentinel. Task 6 intentionally consumes analyzed Aro values rather than reparsing source spelling, so the serializer cannot preserve a negative-zero sign bit that is absent from the analyzed tree. Nonzero and representable floating constants are serialized from exact semantic bits.
