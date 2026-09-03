# Task 3 Report: Symbol Resolution and Deterministic Layout

## Implementation

- Added link-contextual `LinkerError` metadata for symbol, object index, section, offset, and relocation debug locations.
- Resolution publishes only defined global symbols, rejects duplicate global definitions, and treats an undefined declaration as insufficient for a relocation target. Defined local names satisfy relocations only in their owning object and never enter public symbol maps.
- Object version, target, ABI, section alignment, symbol offsets, and relocation field bounds are checked before resolution/layout.
- Layout places sections in deterministic `text`, `rodata`, `data`, `bss` category order, aligning every placed section. It supports `textBase` and `dataBase`, rejects overlapping explicit layouts, and returns absolute addresses for defined globals.

## Tests

RED was observed after adding the layout/resolution suite: `textBase` was ignored and the first text section was placed at `0` instead of `0x20`.

After adding the overlap assertion, RED was observed again: the prior layout accepted the overlapping explicit text/data bases without throwing.

GREEN passed:

- `npm run compile`
- `node scripts/test-linker-layout.js`
- `node scripts/test-linker-relocations.js`
- `node scripts/test-mobj-format.js`
- `node scripts/test-assemble-object.js`

The current linker integration fixture initially remained RED before exercising Task 3 behavior: it declared text `size` as assembly-source string length (`6` for `main:\n`) while the canonical object contract requires encoded word bytes (`4`). `validateObject` rejected it with `section size/content mismatch for 'text'`. The fixture was updated to contain one real instruction per object with a four-byte text size; the integration test now asserts `helper` at byte address `4` while retaining the linked-assembly assertion.

The complete Task 3 linker check set is GREEN:

- `npm run compile`
- `node scripts/test-linker-layout.js`
- `node scripts/test-linker-integration.js`
- `node scripts/test-linker-relocations.js`

## Scope and concerns

Only `resolver.ts`, `test-linker-layout.js`, and the stale canonical-object integration fixture changed for Task 3. Relocation patching, linked-image assembly behavior, runtime loading, packaging, and versioning remain later work.
