# Task 2 Report: Assembly-to-Object Normalization

## Implementation

- Replaced the line-count/object stub with a two-pass normalizer in `merc32-vsce/src/linker/assembleObject.ts`.
- Labels are collected at byte offsets, directives (including `.entry`) are ignored without injecting instructions, and blank/comment lines do not consume space.
- Instructions are parsed and encoded through `SimpleCPUAssembler`; text content is canonical encoded 32-bit words and section size is measured in bytes.
- Symbolic `jmp`, `bz`/`bnz`, and other symbolic operand positions produce `CALL16`, `BRANCH16`, or `IMM16` relocations. Referenced external symbols are emitted as undefined records, with one-based source locations.
- Line and block comments and both ASCII/fullwidth label separators are accepted.

## Tests

RED was observed after adding the normalization assertions: the old implementation produced `undefined` for the forward `helper` label offset (expected `8`).

GREEN and regression checks passed:

- `npm run compile`
- `node scripts/test-assemble-object.js`
- `node scripts/test-mobj-format.js`
- `npm test`
- `npm run test:c`

## Scope and concerns

Only `assembleObject.ts` and `test-assemble-object.js` were changed for the implementation. Canonical text words are now stored numerically as required by the object contract; linked assembly text preservation and relocation application remain later linker work.

## Review fix round 1

Added `ObjectSection.source` and `entryLabel` metadata so normalized numeric content remains authoritative while preprocessed assembly and entry information remain inspectable. Assembly normalization now runs `AssemblerPreprocessor`, preserving `.equ`, macros, and related preprocessing behavior without injecting an entry reset instruction.

Symbol scanning and replacement are quote-aware, symbolic address expressions such as `jmp r2 + target, r14` emit `CALL16`, and relocation debug columns identify the actual operand. Labels default to local binding; callers can explicitly export names with `options.exports` (the `.entry` label is also exported).

RED was observed after adding the fix-round assertions: register operands were initially replaced as symbols and address-form relocation metadata/contract fields were absent.

GREEN and regression checks passed:

- `npm run compile`
- `node scripts/test-assemble-object.js`
- `node scripts/test-mobj-format.js`
- `npm test`
- `npm run test:c`
