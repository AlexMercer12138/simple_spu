# MERC32 Software Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide startup, memory, 64-bit helper, and software floating-point runtime objects that execute on the unchanged MERC32 RTL and link through the new `.mobj` pipeline.

**Architecture:** Runtime routines are ordinary MERC32 objects. The first bootstrap implementation is hand-written MERC32 assembly and is tested against the host; compiler lowering calls named runtime symbols. Binary32 is implemented first, while binary64 ABI and word layout are fixed for later completion.

**Tech Stack:** MERC32 assembly, TypeScript object/linker APIs, Node.js host reference tests, Icarus Verilog RTL simulation.

**Spec:** `docs/superpowers/specs/2026-09-01-merc32-c-compiler-linker-design.md`

## Global Constraints

- No floating-point hardware, floating-point registers, or new ISA instructions.
- Preserve scalar ABI: `r4-r7` arguments, `r4` scalar return, `r12/r13/r14` frame/stack/link roles.
- `float` is one IEEE-754 binary32 word; `double` and `long long` are low-word-first two-word values.
- Runtime code is linked as ordinary `.mobj`; no compiler/linker special case may bypass symbol resolution.
- Existing Tiny C and RTL tests remain passing; final outputs keep current formats.
- Record provenance and licenses for any imported algorithms; do not copy GPL code without review.

---

### Task 1: Runtime ABI and Startup Object

**Files:**
- Create: `runtime/merc32/startup.asm`
- Create: `runtime/merc32/runtime.manifest.json`
- Create: `merc32-vsce/src/runtime/runtimeCatalog.ts`
- Test: `merc32-vsce/scripts/test-runtime-startup.js`

**Interfaces:**
- Runtime manifest names object sources and exported symbols.
- `loadRuntimeObjects(options): Merc32Object[]` loads staged runtime resources synchronously because the compiler/linker build path is synchronous.

- [ ] **Step 1: Write startup execution tests**

Build a minimal program with global zero/data initialization, `main`, and optional `__irq_handler`; assert stack setup, global stores, vector placement, and halt behavior match the existing generated startup.

- [ ] **Step 2: Run current startup tests as a baseline**

Run `npm run compile; node scripts/test-runtime-startup.js`. Expected: FAIL until runtime manifest and object loader exist.

- [ ] **Step 3: Implement startup assembly**

Move startup responsibilities out of the compiler-generated monolith into `startup.asm`: set `r13`, perform linked data initialization symbols, install optional interrupt vector at byte address 4, call `main`, and enter a halt loop. Keep the existing interrupt context ABI.

- [ ] **Step 4: Add manifest/resource loading**

Define a versioned manifest with required symbols and ABI id. Resolve runtime assembly through the existing resource staging mechanism so VSIX packaging includes it.

- [ ] **Step 5: Run startup and RTL tests, then commit**

Run `npm run compile; node scripts/test-runtime-startup.js; npm run test:c:rtl`, then:

```bash
git add runtime/merc32 merc32-vsce/src/runtime merc32-vsce/scripts/test-runtime-startup.js
git commit -m "feat: add linkable Merc32 startup runtime"
```

### Task 2: Memory and 64-bit Integer Helpers

**Files:**
- Create: `runtime/merc32/mem.asm`
- Create: `runtime/merc32/int64.asm`
- Create: `merc32-vsce/scripts/runtimeReference.js`
- Test: `merc32-vsce/scripts/test-runtime-integer.js`

**Interfaces:**
- Exports `memcpy`, `memset`, `memcmp`, `strlen`, `strcmp`.
- Exports compiler-runtime style helpers for 64-bit add/sub/shift/multiply/divide/compare using low-word-first pairs.

- [ ] **Step 1: Write host-reference tests**

Generate deterministic and randomized vectors for overlapping/non-overlapping memory copies, zero-length operations, string boundaries, signed/unsigned 64-bit arithmetic, and shifts by 0, 31, 32, and 63.

- [ ] **Step 2: Run tests before runtime implementation**

Run `npm run compile; node scripts/test-runtime-integer.js`. Expected: FAIL because MERC32 runtime symbols are unavailable.

- [ ] **Step 3: Implement memory routines**

Use byte/half/word accesses with alignment-safe paths. Define return values and overlap behavior explicitly: `memcpy` requires non-overlap, `memset` returns the original destination, comparisons return negative/zero/positive conventions.

- [ ] **Step 4: Implement 64-bit helpers**

Use existing 32-bit add/sub/shift/multiply/divide and explicit carry/borrow handling. Preserve the documented low-word-first ABI and avoid clobbering `r12-r14`.

- [ ] **Step 5: Execute runtime on MERC32 RTL**

Add a small C/assembly harness that writes pass/fail status to the existing DLB test address, assemble/link it, and run through the hardware test runner.

- [ ] **Step 6: Commit**

```bash
git add runtime/merc32 merc32-vsce/scripts/runtimeReference.js merc32-vsce/scripts/test-runtime-integer.js rtl/sim
git commit -m "feat: add Merc32 memory and 64-bit runtime helpers"
```

### Task 3: Binary32 Arithmetic and Conversions

**Files:**
- Create: `runtime/merc32/float32.asm`
- Create: `merc32-vsce/scripts/float32Reference.js`
- Test: `merc32-vsce/scripts/test-runtime-float32.js`

**Interfaces:**
- `__addsf3(aBits, bBits): bits`
- `__subsf3(aBits, bBits): bits`
- `__mulsf3(aBits, bBits): bits`
- `__divsf3(aBits, bBits): bits`
- `__eqsf2`, `__ltsf2`, `__lesf2` return compiler-compatible comparison results.
- `__floatsisf`, `__fixsfsi` convert between 32-bit integers and binary32 bit patterns.

- [ ] **Step 1: Define reference behavior and vectors**

Use `DataView`/`Float32Array` only in the host reference to convert bit patterns. Include normal values, signed zero, subnormal boundaries, infinities, NaNs, overflow, underflow, and rounding ties. Define NaN comparison behavior and integer conversion saturation/trap policy in test expectations.

- [ ] **Step 2: Run focused tests before implementation**

Run `npm run compile; node scripts/test-runtime-float32.js`. Expected: FAIL because runtime symbols are absent.

- [ ] **Step 3: Implement unpack/normalize/pack helpers**

Represent sign, unbiased exponent, and extended mantissa in integer registers/stack slots. Implement NaN/Inf/zero classification, sticky-bit generation, normalization, round-to-nearest-even, and canonical NaN output.

- [ ] **Step 4: Implement arithmetic and comparisons**

Implement add/sub alignment and cancellation, 24x24 multiplication from 16-bit partial products, restoring division, ordered comparisons, and signed-zero rules using existing instructions only.

- [ ] **Step 5: Run host and RTL tests**

Run `npm run compile; node scripts/test-runtime-float32.js; npm run test:c:rtl`. The RTL harness must execute representative arithmetic and compare vectors and report pass/fail through existing peripherals.

- [ ] **Step 6: Commit with provenance**

Add `runtime/merc32/PROVENANCE.md` identifying algorithm sources and licenses, then:

```bash
git add runtime/merc32/float32.asm runtime/merc32/PROVENANCE.md merc32-vsce/scripts/float32Reference.js merc32-vsce/scripts/test-runtime-float32.js rtl/sim
git commit -m "feat: add Merc32 software binary32 runtime"
```

### Task 4: Compiler Runtime Lowering and Binary64 ABI

**Files:**
- Modify: `merc32-vsce/src/cCompiler/lower.ts`
- Modify: `merc32-vsce/src/cCompiler/codegen.ts`
- Create: `runtime/merc32/float64.asm`
- Test: `merc32-vsce/scripts/test-runtime-float64-abi.js`

**Interfaces:**
- `RuntimeSymbol` table maps C operations to runtime names and argument word counts.
- Binary64 symbols use low-word-first pairs and the same stack/register word assignment as `long long`.

- [ ] **Step 1: Add ABI-only binary64 tests**

Compile function declarations and calls involving `double`; assert two-word argument placement, return reconstruction, and relocations to `__adddf3`/conversion symbols. Do not require arithmetic implementation in this task.

- [ ] **Step 2: Implement lowering table**

Replace ad hoc float call strings with a typed runtime table covering binary32 arithmetic/conversions/comparisons and binary64 ABI symbols. Reject unsupported operations with source diagnostics.

- [ ] **Step 3: Implement binary64 runtime routines**

Provide correct add/sub/mul/div/conversion symbols for the supported low-word-first ABI. The compiler must never emit an undefined name silently, and the task is not complete until full binary64 arithmetic has executable tests; diagnostic stubs are not an accepted implementation.

- [ ] **Step 4: Run compiler/runtime integration**

Run `npm run compile; node scripts/test-c-advanced-backend.js; node scripts/test-runtime-float64-abi.js; npm run test:c:rtl`.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/cCompiler runtime/merc32 merc32-vsce/scripts/test-runtime-float64-abi.js
git commit -m "feat: connect C floating operations to Merc32 runtime"
```

### Task 5: Runtime Packaging and End-to-End Build

**Files:**
- Modify: `merc32-vsce/src/compilerService.ts`
- Modify: `merc32-vsce/src/runtime/runtimeCatalog.ts`
- Modify: `merc32-vsce/scripts/prepare-resources.js`
- Test: `merc32-vsce/scripts/test-runtime-packaging.js`

**Interfaces:**
- `getDefaultRuntimeObjects(options): Merc32Object[]`
- `buildCFileToRom` links startup and only the runtime symbols referenced by the program.

- [ ] **Step 1: Add package-content tests**

Stage a temporary VSIX resource tree and assert startup, memory, integer, float32, manifest, and provenance files are present while unrelated source files are absent.

- [ ] **Step 2: Implement selective runtime inclusion**

Use the linker's undefined-symbol graph to include only needed runtime members, while always including startup and required memory initialization support.

- [ ] **Step 3: Preserve output APIs**

Ensure the final linked assembly is passed unchanged to current output formatters and artifact labels remain compatible with existing VSCode commands.

- [ ] **Step 4: Run full verification**

Run `npm run test:c; npm run test:c:preprocessor; npm run test:c:rtl; node scripts/test-runtime-packaging.js; npm run test:extension:resources; npm run test:vsix:unit`. Package only after all tests pass.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/compilerService.ts merc32-vsce/src/runtime merc32-vsce/scripts/prepare-resources.js merc32-vsce/scripts/test-runtime-packaging.js
git commit -m "feat: package and link Merc32 software runtime"
```
