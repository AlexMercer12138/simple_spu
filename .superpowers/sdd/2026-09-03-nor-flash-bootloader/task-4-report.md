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

- `git diff --check` passed for the initial Task 4 implementation; only the
  intended four Task 4 files were changed at that stage.
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

## Final-review fix wave (2026-09-03)

Addressed all four review findings in one scoped change set:

- Defined the smallest valid `void __irq_handler(void) {}` and emit
  `__irq_disable()` as the first statement in `main`, before any QSPI call.
  The bootloader artifact test now checks the compiled IRQ vector/epilogue,
  the emitted `mov r1, 0`, and its ordering before `jmp qspi_read, r14`.
- Constrained legacy Tiny C `codeBase` to the direct-label signed-16-bit
  near-code range (`0x00000000..0x00007FFF`, exclusive upper bound
  `0x00008000`). Relocated (nonzero-base) compilations additionally reject
  generated code that would place a direct label outside that range, making
  the compile/assemble contract deterministic. README, ABI, and the setting
  description explain the ISA/textual-immediate boundary; the required
  `codeBase=0x1000` flow remains covered by the existing regression.
- Changed QSPI `IRQ_STATUS` W1C cleanup from `7` to the complete sticky-bit
  mask `0x0000003f`; cleanup now runs through one exit path after both success
  and failure/timeout paths, while the pre-start clear remains in place.
  The artifact test asserts the full mask is present.
- Gated the RTL `ST_LOAD` transition on
  `(bus_req_origin == REQ_FETCH) && ilb_ack`. The core testbench injects stale
  ILB acknowledgements for both `REQ_DATA` and `REQ_DEBUG` and verifies the
  CPU remains in `ST_LOAD` (hardware marker increased to 370 checks).
- Reused the existing CRC accumulator for the header read and reset it before
  payload reads, removing the unused `header_crc`. Added an exact-u32-boundary
  flash-image test for a four-byte payload at `0xFFFFFFFC`.

RED checks before implementation:

```text
npm run test:bootloader
AssertionError: compiled QSPI reader is missing 0x3f

node scripts/test-c-compiler.js
AssertionError: Missing expected exception (codeBase=0x10000)

npm run test:hardware
TEST FAIL: stale ILB origin 2 advanced ST_LOAD to decode
TEST FAIL: stale ILB origin 3 advanced ST_LOAD to decode
```

Final focused verification (all exit 0):

```text
npm run test:bootloader
NOR flash bootloader tests passed (3440 bytes)

npm run test:c
MERC32 VSCE C compiler integration test passed

npm run test:pseudo
pseudo-instruction tests passed

npm run test:flash-image
flash image tests passed

npm run test:hardware
TEST PASS: merc32_core checks=370
MERC32 hardware suite passed (9 tests)

npm test
MERC32 test infrastructure tests passed.
pseudo-instruction tests passed
Tiny C preprocessor tests passed.
MERC32 VSCE C compiler integration test passed

git diff --check
(no output)
```
