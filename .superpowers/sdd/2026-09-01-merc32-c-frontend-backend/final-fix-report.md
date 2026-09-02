# Final Whole-Branch Fix Wave

## Final Whole-Branch Fix Wave

### Root Causes

- The review exposed a migration-gate failure: `compilerService` was feeding the incomplete typed object path before startup/runtime parity existed. The generated user text could precede startup, and typed object options did not implement the configured data stack layout. This made the default C build unsafe for the shipped Tiny C corpus.
- The typed object backend was still a scalar subset. It could otherwise accept and miscompile unsupported globals, floating bodies, and wider values, so the experimental path needed explicit rejection rather than silent lowering.
- Typed calls staged extra arguments through `r7` before loading the fourth register argument, and the callee's incoming stack address was not defined relative to the caller-owned area. Relocations were also recorded before the call instruction was emitted.
- Generated labels were built by concatenating raw identifiers. Legal C names could therefore produce the same user label, and generated return labels were not reserved against every raw symbol.
- Preprocessed typed tokens and diagnostics did not consistently carry the include-origin file and line. Typed errors also used plain `Error`, so callers could not reliably inspect a source location.
- Typed integration only assembled generated text. It did not execute a typed object through the CPU RTL, leaving startup, stack, and ABI defects unobserved.

### Changes

- Restored `compileC` and `compileCFile` as the authoritative legacy compiler APIs. `compilerService` now uses that proven path, preserving the existing startup entry and configured `r13` initialization for extension and ROM builds. `compileCToObject` and `compileCFileToObject` remain explicit typed object APIs and are not selected by the public/service default.
- Added typed object subset validation in `merc32-vsce/src/cCompiler/index.ts`: global declarations, floating literals/bodies, unsupported function/local types, and `dataBase`/`dlbAddrWidth` options fail with `CFrontendError` instead of being discarded or lowered as integers.
- Fixed scalar calls in `merc32-vsce/src/cCompiler/codegen.ts` to reserve caller-owned stack words for arguments after `r7`, store them through the caller `r13`, then load `r4` through `r7`. The callee reads those words after its frame allocation. Call relocation records now use the byte offset of the emitted `jmp` instruction.
- Made typed label allocation globally aware in `merc32-vsce/src/cCompiler/lower.ts` and `codegen.ts`. User labels use length-framed function/label components, and generated control/return labels are allocated against all raw top-level symbols and generated labels.
- Added `CFrontendError` and source-map-aware tokenization/parser/sema diagnostics in `merc32-vsce/src/cCompiler/source.ts`, `lexer.ts`, `parser.ts`, and `sema.ts`. `compileCFileToObject` retains included-file origins in relocation/debug data and error locations.
- Added real executable typed scalar coverage in `merc32-vsce/scripts/test-c-typed-rtl.js` and expanded `scripts/test-c-integration.js` for startup selection, five-argument ABI/relocation behavior, unsupported constructs, source mapping, and raw-symbol label collisions. CPU RTL and instruction encoding were unchanged.

### TDD Evidence

RED evidence captured before the corresponding production changes:

- `node scripts/test-c-integration.js` failed with `AssertionError [ERR_ASSERTION]: typed calls with five arguments must allocate caller stack storage` before the caller stack-area fix.
- The label regression in the preceding fix round failed through the real assembler with duplicate label `__a_user_b_user_x` before length framing.
- The earlier migration-gate integration run failed because typed object compilation could not consume a normal function definition (the declaration-only parser exhausted Node's heap); the legacy default was restored only after this behavior was reproduced through the public API.

GREEN evidence from this checkout:

- `npm run compile` -> exit 0.
- `node scripts/test-c-types.js` -> `C type model tests passed`.
- `node scripts/test-c-parser.js` -> `c parser tests passed`.
- `node scripts/test-c-sema.js` -> `c semantic tests passed`.
- `node scripts/test-c-backend.js` -> `c backend tests passed`.
- `node scripts/test-c-advanced-backend.js` -> `c advanced backend tests passed`.
- `node scripts/test-c-compiler.js` -> `MERC32 VSCE C compiler integration test passed`.
- `node scripts/test-c-integration.js` -> `C public API integration tests passed`.
- `node scripts/test-c-typed-rtl.js` -> `typed C RTL execution test passed`.

Required serial baseline, run without concurrent npm tests:

- `npm run test:c` -> exit 0, `MERC32 VSCE C compiler integration test passed`.
- `npm run test:c:preprocessor` -> exit 0, `Tiny C preprocessor tests passed.`
- `npm run test:c:rtl` -> exit 0; all six RTL tests printed `TEST PASS`, ending `MERC32 Tiny C RTL suite passed (6 tests)`.
- `node scripts/test-c-integration.js` -> exit 0, `C public API integration tests passed`.

### Files

- `merc32-vsce/src/cCompiler/index.ts`
- `merc32-vsce/src/cCompiler/codegen.ts`
- `merc32-vsce/src/cCompiler/ir.ts`
- `merc32-vsce/src/cCompiler/lexer.ts`
- `merc32-vsce/src/cCompiler/lower.ts`
- `merc32-vsce/src/cCompiler/parser.ts`
- `merc32-vsce/src/cCompiler/sema.ts`
- `merc32-vsce/src/cCompiler/source.ts`
- `merc32-vsce/src/compilerService.ts`
- `merc32-vsce/scripts/test-c-integration.js`
- `merc32-vsce/scripts/test-c-typed-rtl.js`
- This report file.

### Commits

- `32bb933` - `fix: keep C defaults bootable and harden typed ABI`
- `f193bde` - `test: execute typed scalar object ABI`
- `f5d7371` - `fix: isolate typed generated return labels`
- The documentation commit adds this report section after the verification listed above and is the final commit reported with the handoff.

### Self-Review

- The default extension/service path is again the legacy path that owns startup, stack initialization, and the shipped Tiny C corpus. The typed APIs remain available for continued development without becoming a hidden second user-facing compiler mode.
- The five-argument test links, assembles, and executes a typed object. It checks that the fifth word is caller-staged, the fourth register argument is loaded afterward, and the relocation points at `jmp five, r14`.
- Unsupported typed constructs are rejected at the object boundary. The integration suite asserts failures for globals, floating bodies, custom memory-layout options, and `long long`, preventing silent miscompilation.
- Label tests exercise the public typed API, linker, and assembler against both cross-function user-label collisions and raw return-label collisions. Source-map tests exercise included headers and inspect real relocation/debug/error locations.
- No CPU RTL, startup source, instruction encoding, package metadata, or version metadata was changed in this wave.

### Residual Concerns

- The typed object backend is intentionally experimental and not full plan/spec parity. It does not yet lower globals/data sections, aggregate or pointer/function-pointer values, floating-point operations/runtime helpers, or `long long`/`double` pairs, and it does not own startup/data-base layout. Those cases fail loudly through the explicit typed object APIs; the legacy compiler remains the safe default and is covered by the complete C and RTL baseline.
- Typed object debug entries generated from a preprocessed line map use column 1 for synthetic per-line entries; token and relocation diagnostics preserve the precise mapped column.
