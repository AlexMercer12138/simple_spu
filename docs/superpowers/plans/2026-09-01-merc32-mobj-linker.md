# MERC32 Object Format and Linker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a versioned project-owned `.mobj` format and linker that resolves multi-file symbols and expands MERC32 near/far calls and branches while preserving current final output formats.

**Architecture:** Compiler and assembly inputs become relocatable object records. The linker merges sections, resolves symbols, applies relocations, and emits final MERC32 assembly or machine-image input for the existing formatters. Development serialization is JSON; ELF is explicitly out of scope.

**Tech Stack:** TypeScript 6, Node.js, Mocha scripts, existing `SimpleCPUAssembler` and output formatters.

**Spec:** `docs/superpowers/specs/2026-09-01-merc32-c-compiler-linker-design.md`

## Global Constraints

- The CPU RTL and instruction encoding remain unchanged.
- The final output remains assembly, Verilog, COE, MIF, HEX, BIN, or MEM.
- The object format is project-owned; do not add ELF compatibility.
- Direct 16-bit symbolic targets must not make large programs fail; use long forms.
- Preserve source file/line/column information in linker diagnostics.
- Existing assembler-only workflows and all current tests must remain passing.

---

### Task 1: Define and Serialize `.mobj`

**Files:**
- Create: `merc32-vsce/src/linker/objectFormat.ts`
- Create: `merc32-vsce/src/linker/objectJson.ts`
- Test: `merc32-vsce/scripts/test-mobj-format.js`

**Interfaces:**
- `Merc32Object`, `ObjectSection`, `ObjectSymbol`, `Relocation`, `DebugLocation`.
- `serializeObject(object): string`
- `deserializeObject(text): Merc32Object`
- `validateObject(object): void`

- [ ] **Step 1: Write failing round-trip tests**

Construct an object with text/data/bss, defined/undefined symbols, a call relocation, and a source location. Assert JSON round-trip preserves every field and rejects a missing version/target/section.

- [ ] **Step 2: Run the focused test**

Run `npm run compile; node scripts/test-mobj-format.js`. Expected: FAIL because object types and serializers are absent.

- [ ] **Step 3: Implement the schema**

Use explicit version `1`, target `merc32`, ABI/data-model id, section arrays, symbol binding (`local`, `global`, `weak` reserved but rejected unless implemented), relocation kind, addend, and debug location. Keep JSON deterministic by sorting map-like arrays by stable source order.

- [ ] **Step 4: Validate malformed objects**

Reject unknown section names, overlapping offsets, invalid symbol references, negative sizes, unsupported ABI ids, and malformed relocation fields with actionable errors.

- [ ] **Step 5: Run and commit**

Run `npm run compile; node scripts/test-mobj-format.js`, then:

```bash
git add merc32-vsce/src/linker merc32-vsce/scripts/test-mobj-format.js
git commit -m "feat: add Merc32 relocatable object format"
```

### Task 2: Produce Objects from MERC32 Assembly Records

**Files:**
- Create: `merc32-vsce/src/linker/assembleObject.ts`
- Modify: `merc32-vsce/src/assembler.ts`
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Test: `merc32-vsce/scripts/test-assemble-object.js`

**Interfaces:**
- `assembleToObject(sourceCode, options): Merc32Object`
- `objectFromCompilerModule(module): Merc32Object`

- [ ] **Step 1: Add unresolved-symbol fixtures**

Use assembly containing a local label, `jmp external, r14`, a data address, and a branch label beyond the direct range. Assert object output retains symbolic operands and source locations instead of throwing during assembly.

- [ ] **Step 2: Run focused test and verify current failure**

Run `npm run compile; node scripts/test-assemble-object.js`. Expected: current assembler reports an unresolved/invalid jump target.

- [ ] **Step 3: Split parse from final encoding**

Expose instruction records and symbol tables before immediate encoding. Encode local fully-resolved instructions immediately; emit a relocation record for unresolved symbolic calls, branches, and addresses. Preserve existing `assemble()` behavior by linking a single object internally.

- [ ] **Step 4: Connect compiler object emission**

Make `generateObject` produce the same object schema and use shared instruction/relocation helpers. Do not duplicate symbol or relocation definitions in the compiler.

- [ ] **Step 5: Run assembler regressions and commit**

Run `npm run compile; node scripts/test-assemble-object.js; npm run test:pseudo; npm run test:c`. Then commit:

```bash
git add merc32-vsce/src/assembler.ts merc32-vsce/src/linker merc32-vsce/src/cCompiler/index.ts merc32-vsce/scripts/test-assemble-object.js
git commit -m "feat: emit relocatable objects from assembly and C"
```

### Task 3: Symbol Resolution and Section Layout

**Files:**
- Create: `merc32-vsce/src/linker/resolver.ts`
- Create: `merc32-vsce/src/linker/layout.ts`
- Test: `merc32-vsce/scripts/test-linker-layout.js`

**Interfaces:**
- `resolveSymbols(objects): ResolvedSymbolTable`
- `layoutSections(objects, options): LayoutResult`
- `LinkerError` carries symbol and source location when available.

- [ ] **Step 1: Write failing multi-object tests**

Link one object defining `main`, one defining `helper`, and one defining a data symbol. Assert stable text/data addresses, local symbol privacy, external resolution, and diagnostics for duplicate strong and unresolved symbols.

- [ ] **Step 2: Run focused tests**

Run `npm run compile; node scripts/test-linker-layout.js`. Expected: FAIL before resolver/layout exists.

- [ ] **Step 3: Implement symbol resolution**

Build per-object local namespaces, a global definition table, undefined-reference collection, duplicate-definition checks, and ABI/data-model compatibility checks. Attach the first referencing location to unresolved diagnostics.

- [ ] **Step 4: Implement deterministic layout**

Lay out startup/text/rodata/data/bss using explicit alignment, place DLB data at configured `dataBase`, keep code byte addresses and instruction word indexes distinct, and expose symbol absolute byte addresses.

- [ ] **Step 5: Run tests and commit**

Run `npm run compile; node scripts/test-linker-layout.js`, then:

```bash
git add merc32-vsce/src/linker merc32-vsce/scripts/test-linker-layout.js
git commit -m "feat: resolve symbols and lay out Merc32 objects"
```

### Task 4: Relocations, Long Calls, and Long Branches

**Files:**
- Create: `merc32-vsce/src/linker/relocations.ts`
- Create: `merc32-vsce/src/linker/relaxation.ts`
- Test: `merc32-vsce/scripts/test-linker-relocations.js`

**Interfaces:**
- `applyRelocations(layout): LinkedSections`
- `relaxControlFlow(records, symbols): InstructionRecord[]`
- Relocation kinds include `ABS32`, `IMM16`, `CALL16`, `BRANCH16`, `HI16`, and `LO16`.

- [ ] **Step 1: Add failing near/far fixtures**

Create synthetic objects with calls and branches within 16-bit range and beyond it. Assert near forms retain `jmp label, r14`; far calls construct a full address and use indirect JAL; far branches invert the condition around a long jump.

- [ ] **Step 2: Run focused test and verify failure**

Run `npm run compile; node scripts/test-linker-relocations.js`. Expected: FAIL because symbolic records cannot yet be expanded.

- [ ] **Step 3: Implement direct relocations**

Patch immediate fields only after layout; validate unsigned address targets and signed compare immediates according to `docs/ISA.md`. Reject impossible alignment and overflow with source locations.

- [ ] **Step 4: Implement long-form expansion**

Expand far calls into complete-address construction plus register-indirect JAL. Expand far `bz/bnz` into inverse-condition-to-local-skip followed by a long indirect jump. Recompute addresses until no expansion changes layout; use a deterministic scratch register that is legal under the ABI.

- [ ] **Step 5: Run linker and assembler verification**

Run `npm run compile; node scripts/test-linker-relocations.js; npm run test:pseudo`. Assemble the linked output and assert machine-code generation succeeds for programs larger than 64 KiB.

- [ ] **Step 6: Commit**

```bash
git add merc32-vsce/src/linker merc32-vsce/scripts/test-linker-relocations.js
git commit -m "feat: add Merc32 relocations and long control flow"
```

### Task 5: Linker API and Existing Output Integration

**Files:**
- Create: `merc32-vsce/src/linker/linker.ts`
- Modify: `merc32-vsce/src/linker/index.ts`
- Modify: `merc32-vsce/src/compilerService.ts`
- Modify: `merc32-vsce/src/assemblyService.ts`
- Test: `merc32-vsce/scripts/test-linker-integration.js`

**Interfaces:**
- `linkObjects(objects, options): LinkedImage`
- `linkFiles(files, options): LinkedImage`
- `LinkedImage.assembly` is accepted by the existing output formatters.

- [ ] **Step 1: Add pipeline tests**

Compile two C/ASM inputs with an external function and global object, link them with a startup fixture, and assert the existing Verilog/HEX/MEM formatters receive the same shape as `assembleFile`.

- [ ] **Step 2: Implement linker orchestration**

Run validation, symbol resolution, layout, relaxation, relocation, startup/runtime insertion, and final assembly rendering in a fixed order. Preserve debug symbol/source maps in `LinkedImage`.

- [ ] **Step 3: Preserve assembler-only workflows**

Keep `assembleFile` behavior unchanged for standalone `.asm`; route only C builds and explicit object-link calls through the linker.

- [ ] **Step 4: Run complete link/output regression and commit**

Run `npm run compile; node scripts/test-linker-integration.js; npm run test:c; npm run test:c:rtl; npm run test:extension:resources`. Then:

```bash
git add merc32-vsce/src/linker merc32-vsce/src/compilerService.ts merc32-vsce/src/assemblyService.ts merc32-vsce/scripts/test-linker-integration.js
git commit -m "feat: integrate Merc32 linker with C build outputs"
```

