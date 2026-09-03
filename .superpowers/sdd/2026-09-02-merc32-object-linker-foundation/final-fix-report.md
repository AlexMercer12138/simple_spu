# MERC32 Object/Linker Final Fix Report

## Scope

- Branch: `codex/2026-09-02-object-linker-foundation`
- Fix base: `5e66cce`
- Contract: all six Important findings in `final-review-findings.md`
- Packaging/version metadata, RTL, runtime algorithms/provenance, default C APIs,
  typed language coverage, and far-control policy were not changed.
- No deferred minor was implemented. The shared stateful comment masker is
  inseparable from Findings 1 and 3 because source-backed relocation validation
  must count the same instructions as object assembly.

## Finding 1: Control-flow relocation validation

Regression coverage was added to
`merc32-vsce/scripts/test-linker-relocations.js` for both `CALL16` and
`BRANCH16`:

- patch sections other than `text`;
- canonical words with the wrong instruction opcode/function;
- source-backed words with the wrong mnemonic at the relocation offset.

RED:

```text
npm run compile; node scripts/test-linker-relocations.js
exit 1
AssertionError: Missing expected exception
test-linker-relocations.js:199
```

The first non-text `CALL16` was accepted. After the initial focused fix, the
broader typed-object integration exposed the source-only representation case:

```text
node scripts/test-c-integration.js
exit 1
LinkerError: CALL16 relocation 'included' must patch a JAL instruction
```

Source-only typed sections use assembly text and placeholder normalized words,
so canonical opcode validation now applies only to numeric content. Source
mnemonic validation applies to both the optional `source` field and string
section content. Existing `r0`, range, and alignment checks remain unchanged.

GREEN:

```text
npm run compile; node scripts/test-linker-relocations.js
exit 0: linker relocation tests passed
node scripts/test-c-integration.js
exit 0: C public API integration tests passed
```

Production file: `merc32-vsce/src/linker/relocations.ts`.

## Finding 2: Quote-aware linked-source rewriting

The regression assembles, links, and reassembles an object where local label
`A` coexists with the literal in `mov r1, "A"`.

RED:

```text
node scripts/test-linker-relocations.js
exit 1
AssertionError: expected /mov r1, "A"/
actual: mov r1, "__mobj_0_A"
```

Identifier replacement now recognizes quoted strings and replaces only
unquoted identifier tokens in the operand region.

GREEN:

```text
npm run compile; node scripts/test-linker-relocations.js
exit 0: linker relocation tests passed
```

Files: `merc32-vsce/src/linker/relocations.ts` and
`merc32-vsce/scripts/test-linker-relocations.js`.

## Finding 3: Stateful block comments in object assembly

Inline and multiline block-comment regressions assert instruction byte sizes,
relocation offsets, and original debug line/column values. A composite
link/reassembly regression verifies that retained multiline comments do not
shift source-backed relocation lookup.

RED, object assembly:

```text
node scripts/test-assemble-object.js
exit 1
Error: unknown instruction: */
```

RED, retained-source linking:

```text
node scripts/test-linker-relocations.js
exit 1
LinkerError: CALL16 relocation 'external' must patch a source jmp instruction
```

`maskAssemblyComments` carries block-comment state across lines while
preserving line and character positions. Both object passes consume its masked
lines; source mnemonic validation and linked-source offset mapping use the same
lexical view.

GREEN:

```text
npm run compile; node scripts/test-assemble-object.js; node scripts/test-linker-relocations.js
exit 0: assemble object tests passed; linker relocation tests passed
```

Files: `merc32-vsce/src/linker/sourceText.ts`,
`merc32-vsce/src/linker/assembleObject.ts`,
`merc32-vsce/src/linker/relocations.ts`,
`merc32-vsce/scripts/test-assemble-object.js`, and
`merc32-vsce/scripts/test-linker-relocations.js`.

## Finding 4: Typed internal local symbols

Two real source-only typed objects are generated with distinct global function
names and the same internal `__main_return` label. The regression requires each
object to publish that label as a defined local, then links and reassembles the
pair with distinct object namespaces.

RED:

```text
node scripts/test-linker-integration.js
exit 1
AssertionError: object.symbols.some(...) evaluated to false
```

Typed code generation now records every emitted non-function label at its
current text byte offset as a local symbol. Existing C integration assertions
were narrowed to defined globals where their intent is function-export
coverage, and internal-label matching accepts the linker namespace.

GREEN:

```text
npm run compile; node scripts/test-linker-integration.js; node scripts/test-c-integration.js
exit 0: linker integration tests passed; C public API integration tests passed
```

Files: `merc32-vsce/src/cCompiler/codegen.ts`,
`merc32-vsce/scripts/test-linker-integration.js`, and
`merc32-vsce/scripts/test-c-integration.js`.

## Finding 5: 32-bit layout bounds

Boundary regressions accept a final byte at `0xffffffff` and a large BSS range
ending there. Overflow regressions use content-free BSS sections to cover
out-of-range and unsafe bases, section-end overflow, alignment overflow, unsafe
section size, and a section-end symbol resolving to `0x100000000`.

RED:

```text
node scripts/test-linker-layout.js
exit 1
AssertionError: Missing expected exception
test-linker-layout.js:102
```

Object numeric fields now require safe integers; section sizes and alignments
are bounded to the 32-bit domain, with alignment checked as a true numeric
power of two. Layout validates configured bases, aligned starts, nonempty
inclusive ends, and every defined symbol address.

GREEN:

```text
npm run compile; node scripts/test-linker-layout.js; node scripts/test-linker-relocations.js; node scripts/test-linker-integration.js
exit 0: all four commands passed
```

Files: `merc32-vsce/src/linker/objectJson.ts`,
`merc32-vsce/src/linker/resolver.ts`, and
`merc32-vsce/scripts/test-linker-layout.js`.

## Finding 6: BSS relocation rejection

Direct object validation and public linking regressions use an `ABS32`
relocation whose patch section is BSS.

RED:

```text
node scripts/test-mobj-format.js; node scripts/test-linker-relocations.js
both exit 1
AssertionError: Missing expected exception
```

Object validation now rejects every relocation with patch section `bss` before
field width or offset handling, so fabricated BSS content cannot be applied or
counted.

GREEN:

```text
npm run compile; node scripts/test-mobj-format.js; node scripts/test-linker-relocations.js
exit 0: mobj format tests passed; linker relocation tests passed
```

Files: `merc32-vsce/src/linker/objectJson.ts`,
`merc32-vsce/scripts/test-mobj-format.js`, and
`merc32-vsce/scripts/test-linker-relocations.js`.

## Complete Task 6 Matrix

Run from `merc32-vsce`; every command exited 0:

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

Notable execution evidence:

- Legacy C RTL: 6/6 simulations passed.
- Typed C RTL execution passed.
- Cross-object linker runtime execution passed.
- Runtime startup, integer, float32, and float64 ABI suites passed.

Repository-root `git diff --check` exited 0.

## Self-review

- Each Important finding has a focused real-behavior regression observed RED
  before its production change and rerun GREEN afterward.
- Source-only and numeric text representations are distinguished when checking
  canonical opcode bits, while both validate source mnemonics when available.
- Control-flow target encoding remains fixed-width and retains all existing
  `r0`, unsigned-16-bit, and four-byte-alignment enforcement.
- Internal typed labels remain absent from the global resolver table and are
  namespaced only in linked source.
- Exact top-of-address-space content remains representable; only aligned bases,
  occupied ends, and symbols beyond the 32-bit address domain are rejected.
- BSS remains content-free and cannot be a relocation patch site.
- No RTL, package/version, runtime/provenance, default API, language-coverage,
  ABI documentation, or far-control-flow policy files changed.

## Concerns

None.

## Second Final Fix Wave

This explicitly authorized follow-up fixes only the regression introduced in
`c559e18`: a `/*` sequence occurring after an earlier `//` comment incorrectly
opened persistent block-comment state and caused later instructions to be
silently dropped.

### TDD evidence

Focused regressions were added to
`merc32-vsce/scripts/test-assemble-object.js` for:

- `main:\n  mov r1, 1 // /* harmless\n  jmp external, r14`, requiring
  an eight-byte text section and one `CALL16` relocation for `external` at
  offset 4;
- supported two-byte quoted immediates `"//"` and `"/*"`, requiring both
  instructions to remain code and the following call relocation to remain at
  offset 8.

Initial RED:

```text
npm run compile; node scripts/test-assemble-object.js
exit 1
AssertionError: Expected values to be strictly equal:
4 !== 8
test-assemble-object.js:25
```

After changing only the shared masker, the required line-comment case advanced
and exposed an independent quote boundary in the single-line comment pass used
by `SimpleCPUAssembler.parseLine`:

```text
npm run compile; node scripts/test-assemble-object.js
exit 1
Error: 字符串立即数缺少结束双引号
at SimpleCPUAssembler.splitOperands
test-assemble-object.js:30
```

The implementation now scans each source line once from left to right. In
normal state the earliest token wins, `//` masks the rest of that line without
changing block state, `/* ... */` carries block state across lines, and quoted
or escaped content is preserved. Comment masking still replaces characters
with spaces so source positions remain stable. The assembler's existing
single-line `removeComments` helper received the corresponding quote-aware
ordering because the focused object path necessarily calls it through
`parseLine`; its public shape and unclosed-inline-block behavior are unchanged.

Focused GREEN:

```text
npm run compile
exit 0
node scripts/test-assemble-object.js
exit 0: assemble object tests passed
node scripts/test-linker-relocations.js
exit 0: linker relocation tests passed
node scripts/test-linker-integration.js
exit 0: linker integration tests passed
```

Existing inline and multiline block-comment regressions remained green.

### Complete Task 6 verification

The following commands were rerun from `merc32-vsce`; all 17 exited 0:

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

Notable fresh output:

- `npm test`: infrastructure, pseudo-instruction, C preprocessor, and legacy C
  compiler tests passed.
- `npm run test:c:rtl`: 6/6 RTL simulations passed.
- Typed C RTL and cross-object linker runtime execution passed.
- Runtime packaging, startup, integer, float32, and float64 ABI tests passed.
- Repository-root `git diff --check` exited 0 before staging.

Files changed in this wave:

- `merc32-vsce/src/linker/sourceText.ts`
- `merc32-vsce/src/assembler.ts`
- `merc32-vsce/scripts/test-assemble-object.js`
- this report

No other deferred finding was changed. Concerns: none.
