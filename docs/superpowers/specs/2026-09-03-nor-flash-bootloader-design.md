# MERC32 NOR Flash Bootloader Design

## Goal

Boot MERC32 applications from a SPI NOR flash without adding XIP or a second
instruction-fetch path. A small program resident at ILB address zero reads an
application image through `apb_qspi`, copies it into writable ILB RAM, verifies
it, and jumps to the image entry address.

## Scope

The first version supports one compile-time-selected NOR flash partition and
the existing `apb_qspi` controller in SPI 1-1-1 mode with the standard `0x03`
read command and a 24-bit flash address. It does not implement a filesystem,
partition table, image fallback, signatures, compression, DMA, or XIP.

The reference bootloader uses these defaults, which may be edited at the top
of the source before compilation:

- QSPI APB base: `0x10004000`
- flash image offset: `0x00100000`
- reserved bootloader ILB range: `0x00000000..0x00000fff`
- application ILB range: `0x00001000..0x00007fff`
- QSPI clock half-period register value: `1`

## Architecture

### CPU local-bus access

The existing local-bus address map remains unchanged. Instruction fetches use
ILB, ordinary loads and stores decode all three ILB/DLB/PLB regions, and JTAG
debug accesses continue to use all three regions.

`merc32_core` records the origin of every outstanding request as fetch, CPU
data, or debug. This replaces the current inference that every ILB response is
an instruction-fetch response. An ILB acknowledgement therefore completes an
ordinary load/store when its request origin is CPU data and only updates the
instruction register when its origin is fetch.

No CPU top-level port changes are required. The existing `spram` and generated
SoC connections already support ILB writes and byte strobes.

### Relocatable application image

The assembler accepts one optional `.org <aligned-u32-address>` directive.
The origin changes label and debug addresses but does not pad emitted machine
code. `.entry` inserts the reset/entry jump at the first emitted word, so an
application assembled with `.org 0x1000` starts with a jump whose target is
resolved in the relocated address space.

Tiny C gains a `codeBase` option. A nonzero value emits `.org <codeBase>` before
`.entry`; the default remains zero and preserves all existing output. Tiny C
also gains the non-returning intrinsic `__jump(address)`, which emits a register
indirect jump. It accepts exactly one integer argument and cannot be used where
a value is required.

### Flash image format

The flash image starts with a 20-byte header followed immediately by the raw
application binary. Every 32-bit field and every instruction word is stored in
big-endian byte order, matching the existing MERC32 `.bin` output.

| Offset | Field | Value |
| ---: | --- | --- |
| `0x00` | magic | `0x4d333246` (`M32F`) |
| `0x04` | image size | payload byte count; nonzero and divisible by four |
| `0x08` | load address | aligned ILB byte address |
| `0x0c` | entry address | aligned address inside the loaded payload |
| `0x10` | CRC32 | IEEE CRC32 of payload bytes |

The image packer accepts a raw application `.bin`, load address, and optional
entry address (defaulting to load address). It validates unsigned 32-bit values,
alignment, nonempty word-sized payloads, and entry containment before emitting
the header and payload.

### Boot flow and errors

The bootloader disables interrupts, clears the QSPI FIFOs and sticky status,
configures a 1-1-1 receive transaction, then reads the header. It rejects an
invalid magic, size, load range, entry range, alignment, or flash-address
overflow before writing application memory.

For each payload chunk of at most 65535 bytes, software starts one `0x03` read
transaction and drains `RX_DATA` while the transaction is active. Four incoming
bytes are assembled most-significant byte first into one 32-bit word and stored
to ILB. CRC32 is calculated over the received byte stream. On success, software
writes status `0x600d0000` to DLB address `0x08000000` and calls
`__jump(entry_address)`.

On failure the bootloader writes `0x0bad0000 | reason` to the status address and
halts in a loop. Reason values identify QSPI failure, magic, size, load range,
entry range, flash range, and CRC mismatch. A timeout protects every QSPI wait
so absent or misconfigured flash hardware cannot hang without a status code.

## Verification

- Core RTL test: CPU stores a word into ILB, reads it back as data, then jumps
  to and executes the newly written instruction. Existing fetch, DLB, PLB, and
  debug protocol checks remain enabled.
- Assembler tests: relocated labels, `.entry`, debug symbols, invalid/duplicate
  origins, and unchanged origin-zero behavior.
- Tiny C tests: `codeBase` emission and validation plus `__jump` arity, type,
  value-context rejection, and generated indirect jump.
- Image tests: exact golden header bytes, CRC32, default/explicit entry, and all
  validation failures.
- Bootloader build test: compile the reference C source at origin zero and
  assemble it without diagnostics.
- Full repository toolchain and hardware suites.

