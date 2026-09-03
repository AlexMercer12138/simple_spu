# Task 4 Report: Relocation Patching and Linked Image

## Status

Implemented the revised fixed-width relocation contract. `CALL16` and `BRANCH16`
encode aligned absolute unsigned 16-bit byte targets through an `r0` base and
reject far targets without expanding sections or claiming a scratch register.

## RED / GREEN Evidence

Each behavior was introduced as a focused failing assertion, run with
`npm run compile; node scripts/test-linker-relocations.js`, and followed by the
minimum implementation needed to make the focused script pass.

| Behavior | RED evidence | GREEN evidence |
|---|---|---|
| `ABS32` local data patch and applied count | `linked.sections` was absent (`TypeError`) | Little-endian bytes were `[0x04, 0x00, 0x34, 0x12]`; count was `1` |
| `HI16` after addend | Actual bytes remained `[0, 0]` | `0x1234fff0 + 0x20` emitted `[0x35, 0x12]` |
| `LO16` after addend | Actual bytes remained `[0, 0]` | `0x1234fff0 + 0x20` emitted `[0x10, 0x00]` |
| `IMM16` instruction patch | Actual word remained `0x00000501` | Patched word was `0x45670501` |
| Near `CALL16` | Actual word remained `0x00000e2c` | Patched word was `0x00080e2c` |
| Near `BRANCH16` | Actual word remained `0x0000042a` | Patched word was `0x0024042a` |
| Far `CALL16` diagnostic and debug context | Missing expected exception | Exact `CALL16 relocation 'farTarget' target out of range: 65536` `LinkerError` |
| Far `BRANCH16` diagnostic | Missing expected exception | Exact `BRANCH16 relocation 'farTarget' target out of range: 65536` `LinkerError` |
| Control-flow alignment | Missing expected exception | Exact per-kind `target is not 4-byte aligned: 6` errors |
| Control-flow `r0` base | Missing expected exception | Exact per-kind `requires r0 base` errors |
| Linked image and entry | `machineCodes` was absent (`TypeError`) | Patched words, symbols, assembly, and `entryAddress` matched |
| Missing entry | Missing expected exception | Exact `entry symbol 'missing' not found` `LinkerError` |
| JSON file linking | Paths reached object validation and failed | Serialized `.mobj` paths linked with forwarded options |
| 32-bit address overflow | Missing expected exception | Exact `ABS32`/`HI16`/`LO16` overflow errors |
| `IMM16` overflow | Missing expected exception | Exact `IMM16 ... value out of range: 65536` error |
| Text `ABS32` word patch | Word array was incorrectly replaced by four bytes | One complete word changed; adjacent word was preserved |
| Patched assembly above `0x7fff` | Assembly emitted invalid decimal `32768` | Assembly emitted `0x8000` and reproduced `machineCodes` |

One intermediate alignment fixture initially failed in Task 3 layout validation
because its data base overlapped text. The fixture was corrected from address `2`
to non-overlapping misaligned address `6`, then rerun to obtain the intended RED.
The assembly equivalence test also identified and corrected a hand-authored
`jmp r14` fixture from direct-JAL bits to the real register-indirect encoding.

## Files Changed

- `merc32-vsce/src/linker/relocations.ts`
  - Copies canonical sections with final addresses.
  - Resolves object-local and link-global symbols.
  - Applies all six relocation kinds to words or little-endian byte fields.
  - Preserves symbol, object, section, offset, and debug metadata on errors.
  - Emits assembly with relocated symbolic operands rendered as hexadecimal.
- `merc32-vsce/src/linker/linker.ts`
  - Adds `LinkOptions` and the extended `LinkedImage` fields.
  - Runs layout and relocation application and builds deterministic text words.
  - Resolves or rejects `entrySymbol`.
  - Deserializes JSON object files in `linkFiles`.
- `merc32-vsce/scripts/test-linker-relocations.js`
  - Adds exact patch, addend, range, alignment, debug, assembly, entry, and file tests.

`merc32-vsce/src/linker/index.ts` already re-exported `linker.ts` and
`relocations.ts`, so no source change was required there. No RTL, compiler
default path, or package/version file was modified.

## Verification

Required commands:

```text
npm run compile
node scripts/test-linker-relocations.js
node scripts/test-linker-layout.js
node scripts/test-linker-integration.js
npm run test:c
npm run test:c:rtl
```

The final verification run passed all commands. The RTL suite reported `TEST PASS` for
all six programs and ended with `MERC32 Tiny C RTL suite passed (6 tests)`.

## Self-Review

- Every requested relocation kind has an exact literal patch test.
- Addends are applied before `HI16`/`LO16` splitting, including a carry boundary.
- Control-flow targets use absolute byte addresses, not PC-relative displacement.
- Far calls and branches fail deterministically and never change section length.
- Local symbols take precedence within their object; globals use Task 3 addresses.
- Relocation errors retain contextual `LinkerError` fields and source debug data.
- Patched numeric text produces `machineCodes`; source-only text preserves assembly.
- Patched assembly uses hexadecimal raw-bit literals and is assembler-checked.
- `linkFiles` exercises real JSON serialization/deserialization and filesystem I/O.
- Input objects are not mutated; relocation operates on canonical section copies.
- No independent subagent review was run because the task explicitly prohibited delegation.

## Concerns / Deferred Work

- Fixed-size far-call/far-branch templates and an ABI-reserved scratch register
  remain explicitly deferred by the revised specification.
- `machineCodes` represents linked text from its first laid-out text section;
  callers using a nonzero `textBase` must load it at that base.

## Fix Round 1: Assembly Layout and Local Labels

### RED / GREEN Evidence

Each review finding was reproduced in `scripts/test-linker-relocations.js` and
run with `npm run compile; node scripts/test-linker-relocations.js` before the
corresponding production edit.

| Behavior | RED evidence | GREEN evidence |
|---|---|---|
| Text alignment gaps | Reassembly produced two words while `machineCodes` contained `[0x000e003c, 0, 0, 0, 0x000e003c]` | Assembly now emits three `mov r0, 0` fillers and reassembles byte-for-byte |
| Self-referencing label | `loop: jmp loop` became invalid `0x0: jmp loop` | Label is namespaced as `__mobj_0_loop` and only the operand becomes `0x0` |
| Duplicate local labels | Reassembly failed with `duplicate label: loop` on the second object | Object-local labels receive deterministic object-index namespaces and reassembly matches `machineCodes` |

The first namespacing GREEN attempt still failed on label-only lines because
they returned before rewriting. Moving optional-label handling ahead of the
instruction/directive early return made the duplicate-label test pass.

### Verification

The final fix-round verification passed:

```text
npm run compile
node scripts/test-linker-relocations.js
node scripts/test-linker-integration.js
node scripts/test-linker-layout.js
node scripts/test-assemble-object.js
node scripts/test-pseudo-instructions.js
```

### Self-Review

- Assembly gap filling follows the same laid-out section addresses and zero-word
  policy as `machineCodes`; it does not prepend words for a nonzero `textBase`.
- Symbol relocation replacement is restricted to instruction text after an
  optional label and before a trailing comment.
- Global label names remain unchanged; only defined object-local text symbols
  receive `__mobj_<objectIndex>_<name>` names.
- Local names in unrelocated instruction operands are namespaced as well, while
  relocated operands remain their final hexadecimal value.
- Label-only lines are namespaced without consuming an instruction offset.
- No BSS behavior, RTL, compiler path, package metadata, or version metadata was changed.
