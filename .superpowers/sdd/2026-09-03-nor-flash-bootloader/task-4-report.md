# Task 4 Report: Reference QSPI NOR Bootloader

## Implementation

- Added `example/nor_flash_bootloader.c`, compiled with Tiny C `codeBase=0` and
  assembled at ILB origin zero.
- Implemented the fixed `apb_qspi` register setup for 1-1-1 `0x03` reads,
  including 24-bit address configuration, clock value `1`, RX FIFO draining
  while `STATUS.BUSY` is set, IRQ W1C handling, and finite idle/progress
  timeouts.
- Added big-endian header/payload assembly, application-ILB and flash-range
  validation, chunked reads capped at 65532 bytes, volatile ILB stores, IEEE
  reflected CRC32 (`0xedb88320`, initial `0xffffffff`, final inversion),
  success status plus indirect `__jump`, and distinct failure reasons.
- Added `merc32-vsce/scripts/test-nor-flash-bootloader.js`. The test compiles
  and assembles the real source, checks origin/entry, observable QSPI setup and
  RX draining, bounded polling, CRC instructions, status/reason values,
  indirect jump, and enforces the 4 KiB machine-code limit.
- Added `npm run test:bootloader` and documented the fixed layout, image
  constants, programming workflow, and application `codeBase=0x1000`
  requirement in the repository README.

## Files

- `example/nor_flash_bootloader.c`
- `merc32-vsce/scripts/test-nor-flash-bootloader.js`
- `merc32-vsce/package.json`
- `README.md`

## RED evidence

Command (before creating the source):

```text
npm run test:bootloader
```

Result:

```text
> merc32-vsce@2.1.0 test:bootloader
> npm run compile && node scripts/test-nor-flash-bootloader.js

> merc32-vsce@2.1.0 compile
> tsc -p ./

AssertionError [ERR_ASSERTION]: missing reference bootloader source: ...\\example\\nor_flash_bootloader.c
EXIT=1
```

The test failed for the intended missing-production-source reason after a
clean TypeScript compile.

## GREEN evidence

Focused command:

```text
npm run test:bootloader
```

Result:

```text
> merc32-vsce@2.1.0 test:bootloader
> npm run compile && node scripts/test-nor-flash-bootloader.js

> merc32-vsce@2.1.0 compile
> tsc -p ./

NOR flash bootloader tests passed (3328 bytes)
EXIT=0
```

Repository suite command:

```text
npm test
```

Result:

```text
MERC32 test infrastructure tests passed.
pseudo-instruction tests passed
Tiny C preprocessor tests passed.
MERC32 VSCE C compiler integration test passed
EXIT=0
```

## Self-review

- `git diff --check` passed; only the intended four Task 4 files are changed.
- The bootloader assembles to 3328 bytes, leaving 768 bytes below the reserved
  4096-byte ILB window.
- All QSPI waits have finite counters. RX is drained before BUSY completion is
  accepted, and a stalled/no-progress transaction returns the QSPI failure.
- Range checks use subtraction against fixed exclusive limits after ordering
  checks, avoiding overflowing end-address arithmetic.

## Concerns

- This is a reference bare-metal loader; hardware integration still depends on
  the SoC wiring the documented QSPI APB base, status sink, and ILB write path.
- The build test validates compiled/assembled behavior and size, but does not
  simulate a physical flash transaction.
