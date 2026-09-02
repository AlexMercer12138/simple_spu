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
