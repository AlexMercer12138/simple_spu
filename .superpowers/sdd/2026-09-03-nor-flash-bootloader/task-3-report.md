# Task 3: Flash Image Packer Report

## Implementation

Implemented `createFlashImage(payload, options)` and a direct-execution CLI.
The packer emits the specified 20-byte M32F header with big-endian fields,
computes IEEE CRC32 over the raw payload only, and copies payload bytes without
relocation or byte swapping. It validates Buffer input, nonempty word-sized
payloads, unsigned 32-bit aligned load and entry addresses, payload-range
overflow, and entry containment.

`npm run flash:image -- <input.bin> <output.img> <load-address> [entry-address]`
compiles and invokes the CLI. README usage documents the command and header
layout.

## Files

- `merc32-vsce/src/flashImage.ts`: packer, validation, CRC32, and CLI.
- `merc32-vsce/scripts/test-flash-image.js`: exact bytes, CRC, preservation,
  validation, and direct CLI behavior tests.
- `merc32-vsce/package.json`: `test:flash-image` and `flash:image` commands.
- `merc32-vsce/README.md`: NOR flash image command and header documentation.
- `docs/superpowers/plans/2026-09-03-nor-flash-bootloader.md`: Task 2
  bookkeeping edit preserved and Task 3 checklist completed.

## TDD Evidence

RED command:

```text
node scripts/test-flash-image.js
```

RED output:

```text
Error: Cannot find module '../out/flashImage'
Require stack:
- ...\\merc32-vsce\\scripts\\test-flash-image.js
```

Reason: `src/flashImage.ts` did not yet exist, so TypeScript had no
`out/flashImage` module. This was the expected failure before implementation.

The first implementation run exposed an incorrect hand-written test CRC literal.
The IEEE CRC32 of `12 34 56 78 9a bc de f0` is `0xa85a34a3`; the test was
corrected before the final GREEN run.

GREEN command/output:

```text
npm run test:flash-image
...
flash image tests passed
```

Full suite command/output:

```text
npm test
...
MERC32 test infrastructure tests passed.
pseudo-instruction tests passed
Tiny C preprocessor tests passed.
MERC32 VSCE C compiler integration test passed
```

## Self-Review

- Header values, offsets, and big-endian field encoding match the NOR flash
  design specification.
- CRC is computed over payload bytes only; payload copying is a direct Buffer
  copy and does not transform assembler output.
- The end address permits an image ending exactly at `0x1_0000_0000` and rejects
  only overflow beyond it; entry remains strictly within the loaded payload.
- The CLI shares the API implementation and has no external dependency.
- `git diff --check` and focused/full tests were run before commit.

## Concerns

None. The `flash:image` package command compiles before running the direct CLI,
which is consistent with the repository's TypeScript script conventions.
