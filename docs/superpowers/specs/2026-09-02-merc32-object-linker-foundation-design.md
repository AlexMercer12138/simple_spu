# MERC32 Object and Linker Foundation Design

**Status:** Approved design draft for review

**Goal:** Make the project-owned `.mobj` format and MERC32 linker semantically reliable for multi-object code, while keeping the legacy C compiler as the production default until typed C parity is complete.

## Scope

This sub-project implements the object/linker foundation required by the typed compiler and runtime migration gate. It does not expand the typed C language, implement software floating point, or switch `compileC` and the VS Code build path away from the legacy compiler.

The CPU RTL, instruction encoding, existing output formats, and legacy Tiny C behavior remain unchanged.

## Current Problems

- Object section sizes are not consistently measured in emitted bytes.
- Assembly-backed objects expose incomplete symbol metadata.
- `linkObjects` lays out text but does not apply relocations.
- Undefined references can survive linking when only an undefined declaration exists.
- Runtime objects have empty symbol/relocation tables and cannot participate in normal resolution.
- Existing relocation tests exercise relaxation helpers but not actual instruction/data patching.

## Architecture

The linker consumes `Merc32Object` values. Each object has canonical section bytes or words, symbol records, relocation records, and optional source/debug metadata. Assembly text may be retained as an inspectable representation, but layout and relocation calculations use canonical byte offsets and encoded instruction words.

The pipeline is:

```text
assembly source or typed IR
        |
        v
object normalization / encoding
        |
        v
validated Merc32Object values
        |
        v
section layout and symbol resolution
        |
        v
relocation application
        |
        v
LinkedImage and existing output formatters
```

Runtime assembly uses the same normalization path as user assembly. The runtime catalog does not hand-author empty symbol tables.

## Object Contract

The existing versioned header remains:

```ts
interface Merc32Object {
  readonly version: 1;
  readonly target: 'merc32';
  readonly abi: string;
  readonly sections: readonly ObjectSection[];
  readonly symbols: readonly ObjectSymbol[];
  readonly relocations: readonly Relocation[];
  readonly debug?: readonly DebugLocation[];
}
```

Section rules:

- `size` is always a byte count.
- `text` content is encoded as four-byte instruction words in emission order.
- `rodata` and `data` content is byte-addressable; `bss` has size but no content.
- `alignment` is a positive power-of-two byte alignment.
- An optional source field may preserve assembly for diagnostics and inspection, but it is not authoritative for layout.
- Section content length must agree with `size` after normalization.

Symbol rules:

- Defined symbols have a section and byte offset within that section.
- Undefined symbols have `defined: false` and no section/offset.
- Local symbols are visible only inside their object.
- Global definitions participate in the link-wide symbol table.
- Multiple defined global symbols with the same name are errors.
- An undefined declaration never satisfies a relocation by itself.

Relocation rules:

- `offset` is a byte offset from the beginning of the named section.
- The relocation must point at the complete instruction word or data field it patches.
- `addend` is applied after symbol address resolution.
- `debug` is preserved through normalization and link errors.

The JSON serializer remains inspectable and versioned. Any binary representation is explicitly out of scope for this sub-project.

## Object Normalization

`assembleToObject(source, options)` becomes the single path for assembly-backed objects.

It must:

1. Parse labels and directives without injecting a reset vector into the object.
2. Encode each instruction to one 32-bit word and increment offsets by four bytes.
3. Emit global/local symbol records according to the source visibility policy.
4. Emit undefined symbol records only for referenced external names.
5. Emit relocation records for symbolic call, branch, immediate, and address operands.
6. Retain source line/column information for each relocation.

The assembler used to produce final ROM output remains responsible for `.entry` reset-vector behavior. Object normalization must not duplicate that behavior.

## Layout and Resolution

`layoutSections(objects, options)` lays out sections in deterministic order:

1. `text`
2. `rodata`
3. `data`
4. `bss`

Each section category is aligned independently. The API accepts explicit bases, including `textBase` and `dataBase`, and returns section bases plus resolved symbol addresses.

The resolver must reject:

- duplicate defined global symbols;
- relocations naming no defined symbol;
- target/ABI/version mismatches;
- section offsets outside their section;
- relocation offsets outside the target field;
- invalid alignment or overlapping section layout.

Errors use `LinkerError` and include the symbol, object/section, relocation offset, and debug source location whenever available.

## Relocation Semantics

The first implementation supports these kinds:

| Kind | Use | Required behavior |
|---|---|---|
| `CALL16` | near `jmp symbol, r14` with `r0` as the base | Encode the final absolute byte address plus addend as an unsigned 16-bit target. Reject unaligned or out-of-range targets. |
| `BRANCH16` | `bz`/`bnz` symbolic target with `r0` as the base | Encode the final absolute byte address plus addend as an unsigned 16-bit target. Reject unaligned or out-of-range targets. |
| `ABS32` | full data/function address | Write the resolved 32-bit address plus addend. |
| `HI16` | high half of an address | Write bits 31..16 of the resolved value plus addend according to the documented split rule. |
| `LO16` | low half of an address | Write bits 15..0 of the resolved value plus addend according to the documented split rule. |
| `IMM16` | symbolic immediate field | Patch the immediate field and diagnose overflow. |

MERC32 `JAL`, `BZ`, and `BNZ` compute their destination as `R[rs2] + zero_extend(imm16)`; they are not PC-relative. This foundation emits only the fixed-width direct form whose object producer selected. It reports a deterministic `LinkerError` when an absolute target does not fit in 16 bits rather than inserting words after layout has frozen offsets. Far control flow is a follow-up feature: the object producer must emit a fixed-size long-form template using `HI16`/`LO16`, after the ABI explicitly reserves a scratch register and the compiler stops allocating live values to it. No scratch register is implicitly claimed in this phase.

`applyRelocations(layout)` returns patched canonical content and the number of applied records. It must not merely concatenate source text or count records.

## Runtime Catalog

`loadRuntimeObjects()` reads the manifest and converts every listed assembly file through `assembleToObject`.

The resulting objects must expose:

- defined symbols for every manifest-exported entry point;
- undefined symbols for calls to other runtime/startup symbols;
- correct text byte sizes based on encoded instruction count;
- relocation records for symbolic calls and branches;
- the manifest ABI identifier.

The runtime catalog remains a data provider. It does not silently insert runtime objects into `compileC` during this phase.

## LinkedImage API

The public linker API is extended without removing current fields:

```ts
interface LinkOptions {
  readonly textBase?: number;
  readonly dataBase?: number;
  readonly entrySymbol?: string;
}

interface LinkedImage {
  readonly assembly: string;
  readonly machineCodes?: readonly number[];
  readonly symbols: ReadonlyMap<string, number>;
  readonly entryAddress?: number;
}

function linkObjects(objects: readonly Merc32Object[], options?: LinkOptions): LinkedImage;
function linkFiles(files: readonly string[], options?: LinkOptions): LinkedImage;
```

`assembly` remains available for existing formatters. `machineCodes` is produced when all linked text is encodable. `entrySymbol` must resolve when provided; otherwise `entryAddress` is omitted.

## Testing and Acceptance

The sub-project is complete only when tests demonstrate:

1. Section sizes and bases use bytes, alignment, and deterministic ordering.
2. JSON object validation rejects malformed sections, symbols, and relocations.
3. Local/global symbol visibility behaves correctly across two objects.
4. Duplicate global and unresolved relocation references fail with `LinkerError`.
5. `CALL16`, `BRANCH16`, `ABS32`, `HI16`, and `LO16` patch actual machine words/data fields.
6. Near and far control-flow cases either encode correctly or produce the documented diagnostic.
7. Runtime manifest objects expose real symbols, correct sizes, and relocations.
8. A two-object program using a runtime-style helper links, assembles, and executes in the existing Icarus harness.
9. Existing `npm test`, `npm run test:c`, `npm run test:c:preprocessor`, `npm run test:c:rtl`, output-format tests, and typed scalar object tests remain passing.

Required new or updated scripts should include:

- `merc32-vsce/scripts/test-mobj-format.js`
- `merc32-vsce/scripts/test-assemble-object.js`
- `merc32-vsce/scripts/test-linker-layout.js`
- `merc32-vsce/scripts/test-linker-relocations.js`
- `merc32-vsce/scripts/test-runtime-packaging.js`
- `merc32-vsce/scripts/test-linker-runtime-execution.js`

## Non-goals and Migration Gate

This phase does not:

- add unary/pointer/array/aggregate/float parsing or lowering;
- implement runtime algorithms;
- change the legacy `compileC` or `compileCFile` default;
- change the CPU RTL or instruction encoding;
- package or publish a VSIX.

The typed compiler becomes the default only after its corpus parity, runtime linkage, and full migration tests pass in a later phase.

## Provenance

Runtime algorithm provenance and license records remain in `runtime/merc32/PROVENANCE.md`. This sub-project adds no third-party implementation code.
