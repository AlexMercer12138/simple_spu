# MERC32 Object and Linker Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `.mobj` normalization, section layout, symbol resolution, relocation application, and runtime object loading reliable without changing the legacy C default path.

**Architecture:** Normalize assembly-backed and typed objects into canonical byte-oriented sections with explicit symbols and relocations. Layout and resolution produce deterministic addresses; relocation application patches encoded instruction/data fields and returns a linked image. Runtime assembly uses the same normalization path. Typed-language expansion and default API migration remain later projects.

**Tech Stack:** TypeScript 6, Node.js test scripts, existing MERC32 assembler, Icarus Verilog RTL harness.

**Spec:** `docs/superpowers/specs/2026-09-02-merc32-object-linker-foundation-design.md`

## Global Constraints

- The CPU RTL and instruction encoding remain unchanged.
- Section `size` and every symbol/relocation `offset` are byte counts.
- Existing `compileC`, `compileCFile`, output formatters, and Tiny C RTL tests remain passing.
- No ELF, optimizer, typed-C language expansion, software-float implementation, or VSIX packaging is included.
- Undefined declarations never satisfy relocations; duplicate defined global symbols are errors.
- Runtime source provenance remains recorded in `runtime/merc32/PROVENANCE.md`.

---

### Task 1: Canonical Object Sections and Validation

**Files:**
- Modify: `merc32-vsce/src/linker/objectFormat.ts`
- Modify: `merc32-vsce/src/linker/objectJson.ts`
- Modify: `merc32-vsce/src/linker/index.ts`
- Test: `merc32-vsce/scripts/test-mobj-format.js`

**Interfaces:**
- Produces `normalizeSectionContent(section): readonly number[]` for canonical byte/word validation.
- Produces strict `validateObject(object): void` rejecting malformed sections, symbols, and relocations.
- Preserves `serializeObject` and `deserializeObject` JSON APIs.

- [ ] **Step 1: Write the failing tests**

Add assertions that a text section with two 32-bit words has `size === 8`, a byte data section has `size === content.length`, and invalid objects fail for non-byte sizes, non-power-of-two alignment, missing defined-symbol section/offset, undefined-symbol section/offset, duplicate symbol names, and relocation offsets outside the target section.

```js
assert.throws(() => validateObject({ ...valid, sections: [{ name: 'text', alignment: 4, size: 4, content: [0, 0] }] }), /size|content/);
assert.throws(() => validateObject({ ...valid, sections: [{ name: 'text', alignment: 3, size: 4, content: [0, 0, 0, 0] }] }), /alignment/);
assert.throws(() => validateObject({ ...valid, relocations: [{ section: 'text', offset: 4, kind: 'CALL16', symbol: 'main', addend: 0 }] }), /offset/);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run from `merc32-vsce`: `npm run compile; node scripts/test-mobj-format.js`.
Expected: FAIL because current validation accepts inconsistent content and offsets.

- [ ] **Step 3: Implement canonical validation**

Define byte-count semantics for every section. Validate content as either a byte array or assembly-backed source only at the normalization boundary; require content length/word count to agree with `size`. Validate symbol section/offset pairs, unique symbol names within an object, relocation symbol existence, integer addends, section membership, and field-width bounds.

- [ ] **Step 4: Run focused and regression tests**

Run: `npm run compile; node scripts/test-mobj-format.js; node scripts/test-assemble-object.js; npm test`.
Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/linker merc32-vsce/scripts/test-mobj-format.js
git commit -m "fix: enforce canonical MERC32 object sections"
```

### Task 2: Assembly-to-Object Normalization

**Files:**
- Modify: `merc32-vsce/src/linker/assembleObject.ts`
- Modify: `merc32-vsce/src/assembler.ts` only if a public encoding helper is required
- Test: `merc32-vsce/scripts/test-assemble-object.js`

**Interfaces:**
- Consumes assembly source and existing assembler encoding rules.
- Produces `assembleToObject(sourceCode, options): Merc32Object` with text bytes, defined/undefined symbols, and relocation records.

- [ ] **Step 1: Add failing normalization tests**

Cover labels separated by blank lines, forward calls, symbolic branches, `.entry` directives, comments, and source lines. Assert two instructions produce `size === 8`, label offsets are `0` and `4`, a forward call creates one undefined symbol plus one relocation at the call instruction offset, and `.entry` is metadata rather than an injected reset instruction.

```js
const object = assembleToObject('start:\n  jmp helper, r14\n  bz r4, r0 + done\nhelper:\n  jmp r14\ndone:\n');
assert.strictEqual(object.sections[0].size, 12);
assert.strictEqual(object.symbols.find(s => s.name === 'helper').offset, 8);
assert.strictEqual(object.relocations[0].offset, 0);
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile; node scripts/test-assemble-object.js`.
Expected: FAIL because current implementation stores source-character length and does not encode canonical words.

- [ ] **Step 3: Implement normalization**

Parse labels/directives without reset-vector injection, encode each instruction through the existing instruction encoder, increment byte offsets by four, detect symbolic operands in call/branch/immediate/address positions, emit undefined records only for referenced externals, and attach one-based source locations to relocations. Preserve assembly text separately for linked assembly output.

- [ ] **Step 4: Run focused and compatibility tests**

Run: `npm run compile; node scripts/test-assemble-object.js; node scripts/test-mobj-format.js; npm run test:c`.
Expected: all pass and legacy assembly output is unchanged.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/linker/assembleObject.ts merc32-vsce/src/assembler.ts merc32-vsce/scripts/test-assemble-object.js
git commit -m "feat: normalize assembly into relocatable objects"
```

### Task 3: Symbol Resolution and Deterministic Layout

**Files:**
- Modify: `merc32-vsce/src/linker/resolver.ts`
- Modify: `merc32-vsce/src/linker/objectJson.ts` if shared validation is needed
- Test: `merc32-vsce/scripts/test-linker-layout.js`

**Interfaces:**
- Produces `resolveSymbols(objects): ResolvedSymbolTable` with only defined global symbols in the external table.
- Produces `layoutSections(objects, options): LayoutResult` with text/rodata/data/bss bases and absolute symbol addresses.
- `LinkerError` includes symbol, object/section, offset, and optional debug location.

- [ ] **Step 1: Add failing layout and resolution tests**

Create two objects with text/data/bss sections and assert deterministic order, independent alignment, explicit `textBase`/`dataBase`, local-symbol privacy, duplicate-global rejection, unresolved-reference rejection even when an undefined declaration exists, ABI mismatch rejection, and section-offset bounds.

```js
assert.throws(() => linkObjects([callerOnly]), /unresolved.*foo/);
assert.throws(() => linkObjects([defineA, defineA]), /duplicate.*main/);
assert.strictEqual(layout.symbols.get('helper'), 8);
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `npm run compile; node scripts/test-linker-layout.js`.
Expected: FAIL because undefined declarations currently mask unresolved references and non-text sections share one base.

- [ ] **Step 3: Implement resolution and layout**

Group section categories in `text`, `rodata`, `data`, `bss` order; align each section base; maintain per-object local symbol namespaces; reject duplicate defined globals and every relocation without a defined target; enforce matching `version`, `target`, and `abi`; and return address maps plus section bases.

- [ ] **Step 4: Run focused and current linker tests**

Run: `npm run compile; node scripts/test-linker-layout.js; node scripts/test-linker-integration.js; node scripts/test-linker-relocations.js`.
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/linker/resolver.ts merc32-vsce/scripts/test-linker-layout.js
git commit -m "feat: resolve symbols and lay out MERC32 sections"
```

### Task 4: Relocation Patching and Linked Image

**Files:**
- Modify: `merc32-vsce/src/linker/relocations.ts`
- Modify: `merc32-vsce/src/linker/linker.ts`
- Modify: `merc32-vsce/src/linker/index.ts`
- Test: `merc32-vsce/scripts/test-linker-relocations.js`

**Interfaces:**
- Produces `applyRelocations(layout): LinkedSections` with patched canonical content and `relocationsApplied` count.
- Extends `linkObjects(objects, options?: LinkOptions): LinkedImage` with optional `machineCodes` and `entryAddress`, preserving `assembly` and `symbols`.
- `linkFiles(files, options)` accepts object file paths and uses JSON deserialization.

- [ ] **Step 1: Write failing relocation tests**

Build synthetic objects containing one instruction/data field for each relocation kind. Assert the patched machine word/data value, addend handling, out-of-range diagnostics, and `relocationsApplied === records.length`. Add near and far target cases with exact expected instruction sequences.

```js
const image = linkObjects([caller, callee], { entrySymbol: 'start' });
assert.strictEqual(image.machineCodes[0] >>> 0, expectedCallWord >>> 0);
assert.strictEqual(image.entryAddress, image.symbols.get('start'));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile; node scripts/test-linker-relocations.js`.
Expected: FAIL because `applyRelocations` currently concatenates source text and counts records without patching.

- [ ] **Step 3: Implement relocation application**

Patch complete 32-bit words or byte fields at section-relative offsets. Compute branch displacement from the documented PC convention, encode near calls/branches when representable, and emit the documented far sequence using an approved scratch register when not. Implement `ABS32`, `HI16`, `LO16`, `IMM16`, `CALL16`, and `BRANCH16`; preserve debug locations in `LinkerError` messages.

- [ ] **Step 4: Implement linked image assembly and machine words**

Make `linkObjects` validate, resolve, lay out, apply relocations, concatenate sections in deterministic order, and return patched assembly plus machine words when text is encodable. Resolve `entrySymbol` or reject it. Make `linkFiles` load JSON objects from disk.

- [ ] **Step 5: Run linker and existing output tests**

Run: `npm run compile; node scripts/test-linker-relocations.js; node scripts/test-linker-layout.js; node scripts/test-linker-integration.js; npm run test:c; npm run test:c:rtl`.
Expected: all pass without RTL or instruction-encoding changes.

- [ ] **Step 6: Commit**

```bash
git add merc32-vsce/src/linker merc32-vsce/scripts/test-linker-relocations.js
git commit -m "feat: apply MERC32 relocations in linked images"
```

### Task 5: Runtime Catalog Object Metadata

**Files:**
- Modify: `merc32-vsce/src/runtime/runtimeCatalog.ts`
- Modify: `runtime/merc32/runtime.manifest.json` only if exported symbol metadata needs to be declared explicitly
- Test: `merc32-vsce/scripts/test-runtime-packaging.js`

**Interfaces:**
- Produces `loadRuntimeObjects(options): Merc32Object[]` using `assembleToObject`.
- Each runtime object contains real defined/undefined symbols, byte-accurate text size, relocations, and manifest ABI.

- [ ] **Step 1: Add failing runtime metadata tests**

Assert that loaded startup/memory/float objects have nonzero byte sizes divisible by four, define manifest-listed entry points, expose undefined calls where present, and link without empty symbol-table hacks.

```js
const runtime = loadRuntimeObjects({ root });
assert.ok(runtime.flatMap(o => o.symbols).some(s => s.name === 'startup' && s.defined));
assert.ok(runtime.every(o => o.sections.find(s => s.name === 'text').size % 4 === 0));
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile; node scripts/test-runtime-packaging.js`.
Expected: FAIL because current catalog returns empty symbols/relocations and character-count sizes.

- [ ] **Step 3: Implement catalog loading**

Read the manifest, call `assembleToObject` for every listed assembly file, filter or normalize source directives consistently, add the manifest ABI, and verify that every manifest-exported symbol is defined by exactly one runtime object. Keep provenance files untouched.

- [ ] **Step 4: Run runtime and linker regressions**

Run: `npm run compile; node scripts/test-runtime-packaging.js; node scripts/test-linker-runtime-execution.js; node scripts/test-runtime-startup.js; node scripts/test-runtime-integer.js; node scripts/test-runtime-float32.js; node scripts/test-runtime-float64-abi.js`.
Expected: all pass; runtime loading remains side-effect free.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/runtime/runtimeCatalog.ts merc32-vsce/scripts/test-runtime-packaging.js
git commit -m "fix: publish linkable runtime object metadata"
```

### Task 6: Cross-Object Execution Gate and Documentation

**Files:**
- Create: `merc32-vsce/scripts/test-linker-runtime-execution.js`
- Modify: `merc32-vsce/scripts/test-linker-integration.js`
- Modify: `merc32-vsce/package.json` only if a dedicated script entry is needed
- Modify: `docs/ABI.md` to document relocation PC/base conventions

**Interfaces:**
- Consumes the linked image and runtime objects from Tasks 4–5.
- Produces a reproducible Icarus execution test for a user object calling a runtime-style helper across object boundaries.

- [ ] **Step 1: Add the failing cross-object execution test**

Create a small object pair where `main` calls a helper defined in the second object, link with `entrySymbol: 'start'`, assemble the returned assembly, run the existing `tinyc_cpu_tb.v`, and assert `TEST PASS` plus the expected result word. Include one unresolved-symbol negative case and one far-address diagnostic case.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run compile; node scripts/test-linker-runtime-execution.js`.
Expected: FAIL because current linker leaves symbolic calls unresolved in emitted text.

- [ ] **Step 3: Implement only test-facing glue/documentation**

Use the public linker API, avoid changing RTL, and document the exact PC-relative displacement and section-base equations in `docs/ABI.md` so future backend/runtime work emits compatible relocation records.

- [ ] **Step 4: Run the complete foundation matrix**

Run from `merc32-vsce`:

```text
npm test
npm run test:c
npm run test:c:preprocessor
npm run test:c:rtl
node scripts/test-c-integration.js
node scripts/test-c-typed-rtl.js
node scripts/test-mobj-format.js
node scripts/test-assemble-object.js
node scripts/test-linker-integration.js
node scripts/test-linker-layout.js
node scripts/test-linker-relocations.js
node scripts/test-runtime-packaging.js
node scripts/test-linker-runtime-execution.js
node scripts/test-runtime-startup.js
node scripts/test-runtime-integer.js
node scripts/test-runtime-float32.js
node scripts/test-runtime-float64-abi.js
```

Run from repository root: `git diff --check`.
Expected: every command exits 0 and no RTL files are modified.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/scripts/test-linker-runtime-execution.js merc32-vsce/scripts/test-linker-integration.js docs/ABI.md
git commit -m "test: gate cross-object MERC32 execution"
```

## Self-Review Checklist

- Section byte semantics are covered by Task 1 and consumed consistently by Tasks 2–5.
- Task 2 emits relocation offsets that Task 4 patches; Task 3 rejects unresolved symbols before Task 4 applies records.
- Task 5 depends on Task 2 and Task 4 but does not alter the legacy compiler default.
- Task 6 exercises the public linker/runtime contract and documents the ABI equations without changing the CPU RTL.
- The plan intentionally leaves typed expression parity, aggregate/global lowering, floating implementation, and default API migration for later plans.
- No placeholder terms or undefined function names remain; each task has concrete files, interfaces, commands, and commit messages.
