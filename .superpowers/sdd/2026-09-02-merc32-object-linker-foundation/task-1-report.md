# Task 1 Report: Canonical Object Sections and Validation

## Implementation

- Added `normalizeSectionContent(section)` to provide the canonical numeric section payload boundary.
- Text numeric payloads are validated as 32-bit words and measured as four bytes per entry.
- `data` and `rodata` numeric payloads are validated as bytes and measured one byte per entry.
- `bss` rejects content and uses its declared byte size; assembly-backed text is normalized to instruction-word placeholders for validation.
- Strengthened `validateObject` with section uniqueness, power-of-two alignment, canonical content/size agreement, symbol section/offset invariants, unique symbol names, relocation symbol/kind/addend checks, and relocation field bounds.
- Existing JSON serialize/deserialize APIs remain unchanged.

## Tests

RED was observed after adding the focused assertions: `normalizeSectionContent` was not exported/implemented.

GREEN and regression checks passed:

- `npm run compile`
- `node scripts/test-mobj-format.js`
- `node scripts/test-assemble-object.js`
- `npm test`

## Scope and concerns

Only object-format validation and its focused tests were changed. Linker relocation application, layout, runtime packaging, versioning, and VSIX packaging remain outside Task 1. Assembly-backed source normalization intentionally validates instruction count at this boundary; instruction encoding remains the responsibility of the assembler/linker tasks.

## Review fix round 1

Added focused regressions for inline-label assembly (`main: jmp external, r14`), duplicate local/undefined declarations, and unaligned text relocations. RED was observed on the inline-label assertion before the fix (`0 !== 1`).

The normalization boundary now strips a leading label while retaining any trailing instruction. Symbol validation now rejects only duplicate defined global names; local names and repeated undefined declarations remain object-scoped/valid. Text relocation offsets must be 4-byte aligned in addition to fitting their field width.

Fix verification passed:

- `npm run compile`
- `node scripts/test-mobj-format.js`
- `node scripts/test-assemble-object.js`
- `npm test`
