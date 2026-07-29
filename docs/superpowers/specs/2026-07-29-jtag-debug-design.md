# MERC32 JTAG Debug Design

## Goal

Add an IEEE 1149.1 TAP-based debug transport to MERC32 and integrate it into
`MERC32_top`. The only new chip-level debug pins are `tck`, `tms`, `tdi`, and
`tdo`. The TAP connects internally to the existing `merc32_core` debug
interface and treats `tck` as fully asynchronous to the CPU `clk`.

## Scope

The implementation provides:

- the standard 16-state IEEE 1149.1 TAP controller;
- `IDCODE` and `BYPASS` instructions;
- custom instructions for CPU control, status, memory access, and register
  snapshots;
- asynchronous request/acknowledge clock-domain crossings;
- integration into `MERC32_top`;
- independent and top-level simulation coverage.

Boundary-scan instructions such as `EXTEST` and `SAMPLE/PRELOAD` are outside
this debug-only scope.

## Existing CPU Debug Interface

`jtag_debug` connects to these `merc32_core` signals in the CPU clock domain:

```text
dbg_rst_req
dbg_halt_req
dbg_step_req
dbg_halted
dbg_regi_req
dbg_regi_vld
dbg_regi_data[31:0]
dbg_rden
dbg_wren
dbg_addr[31:0]
dbg_wdata[31:0]
dbg_rdata[31:0]
dbg_ack
```

The CPU enters halt at an instruction boundary when `dbg_halt_req` is high.
While halted, a `dbg_step_req` pulse leaves halt for one instruction. Keeping
`dbg_halt_req` high makes the CPU halt again; clearing it before the pulse
resumes continuous execution. Debug memory accesses are valid only while the
CPU is halted. A `dbg_regi_req` pulse starts a 16-cycle stream in which
`dbg_regi_vld` qualifies `r0` through `r15` on `dbg_regi_data`.

## Module Boundary

Create `rtl/debug/jtag_debug.v` with one `jtag_debug` module. It owns the TAP,
all JTAG data registers, the CDC handshakes, and the CPU-side debug controller.
Its chip-facing ports are the four JTAG pins. Its integration-facing ports are
`clk`, `rst_n`, and the `dbg_*` signals listed above.

`MERC32_top` adds the four JTAG ports, declares the internal debug wires,
instantiates `jtag_debug`, and connects those wires to `merc32_core`. Existing
core instantiations that still use the old `dbg_halt`, `dbg_step`, and
`dbg_reset` names are updated to the current interface so regression
testbenches continue to compile.

## TAP Behavior

The TAP samples `tms` and `tdi` on the rising edge of `tck`. `tdo` changes on
the falling edge and is driven with the selected shift register's least
significant bit in `Shift-IR` or `Shift-DR`; it is zero in other states. All
IR and DR scans are least-significant-bit first.

There is no `trst` pin. Five or more rising `tck` edges with `tms=1` drive the
TAP to `Test-Logic-Reset`. The existing top-level `rst_n` also resets the TAP
and CDC logic. Reset assertion is asynchronous; reset release is synchronized
independently into the `tck` and `clk` domains.

The instruction register is five bits wide. `Capture-IR` loads a value whose
two least significant bits are `01`. `Test-Logic-Reset` selects `IDCODE`.
Undefined instructions use the one-bit bypass data register.

## Instruction Map

| IR value | Instruction  | Data register |
|----------|--------------|---------------|
| `00001`  | `IDCODE`     | 32 bits       |
| `10000`  | `DBG_CTRL`   | 4 bits        |
| `10001`  | `DBG_STATUS` | 32 bits       |
| `10010`  | `DBG_XFER`   | 66 bits       |
| `10011`  | `DBG_REGS`   | 512 bits      |
| `11111`  | `BYPASS`     | 1 bit         |

`IDCODE` returns parameter `IDCODE_VALUE`, defaulting to private project value
`32'h4D32_0001`. Bit zero remains one as required by the IDCODE format.

## Debug Control Register

`DBG_CTRL[3:0]` has these fields:

| Bit | Name           | Behavior |
|-----|----------------|----------|
| 0   | `halt_req`     | Read/write level sent to `dbg_halt_req` |
| 1   | `rst_req`      | Read/write level sent to `dbg_rst_req` |
| 2   | `execute_req`  | Write-one pulse; single-step or resume according to bit 0 |
| 3   | `snapshot_req` | Write-one pulse requesting an `r0`-`r15` snapshot |

`Capture-DR` returns the current level fields in bits 1:0 and zero in the
pulse fields. `Update-DR` replaces both level fields and conditionally launches
the pulse operations. A second execute or snapshot pulse is ignored while the
same operation is busy.

The execute request carries the requested halt level as held data. After the
request toggle reaches the CPU domain, the bridge allows one additional CPU
clock for the synchronized halt level to settle before pulsing `dbg_step_req`.
For single-step, completion requires observing `dbg_halted` deassert and then
assert again. For resume, completion requires observing it deassert.

## Debug Status Register

`DBG_STATUS` is read-only:

| Bits | Name             | Meaning |
|------|------------------|---------|
| 0    | `halted`         | Synchronized `dbg_halted` state |
| 1    | `halt_req`       | Current JTAG halt level |
| 2    | `rst_req`        | Current JTAG reset level |
| 3    | `xfer_busy`      | A memory request has not been acknowledged |
| 4    | `xfer_error`     | The last completed transfer failed |
| 5    | `snapshot_busy`  | A register snapshot is being collected |
| 6    | `snapshot_valid` | A complete 512-bit snapshot is available |
| 7    | `execute_busy`   | A step/resume request has not completed |
| 15:8 | `version`        | Protocol version `8'h01` |
| 31:16| Reserved         | Zero |

`xfer_error` clears when a new valid transfer is accepted or the TAP is reset.
`snapshot_valid` clears when a new snapshot request is accepted and sets only
after all 16 qualified register values have been captured.

## Debug Transfer Register

`DBG_XFER[65:0]` is formatted as:

```text
[65:34] address
[33:2]  data
[1:0]   operation or response status
```

Request operations are:

| Value | Operation |
|-------|-----------|
| `00`  | NOP; do not launch a request |
| `01`  | Read one 32-bit word |
| `10`  | Write one 32-bit word |
| `11`  | Invalid |

Response status values are:

| Value | Result |
|-------|--------|
| `00`  | Success |
| `10`  | Failure |
| `11`  | Busy |

`Capture-DR` returns the current response. While a request is outstanding,
the response status is busy, the address is the active address, and data is
zero. On completion it returns the original address, read data for a read, or
the submitted write data for a write. `Update-DR` submits the shifted request.

A request fails immediately if the CPU is not halted, the address is not
four-byte aligned, or the operation is invalid. An update received while busy
is ignored and cannot overwrite the active held address or data. Once launched,
`dbg_rden` or `dbg_wren` remains asserted in the CPU domain until `dbg_ack`.
There is no hardware timeout because peripheral latency is system-specific;
the response remains busy until acknowledgement or TAP reset.

## Register Snapshot Register

`DBG_REGS` is a 512-bit read-only register:

```text
[31:0]    r0
[63:32]   r1
...
[511:480] r15
```

The CPU-side bridge accepts a snapshot only when `dbg_halted` is high. It
pulses `dbg_regi_req`, collects exactly 16 cycles qualified by
`dbg_regi_vld`, and writes each `dbg_regi_data` word into the corresponding
slice. It publishes the completed, stable snapshot before returning the CDC
acknowledgement. `Capture-DR` copies that published snapshot into a private
shift register so the scan cannot be changed by later CPU-domain activity.

If a snapshot is requested while the CPU is running, the request completes
without setting `snapshot_valid`. A request received while `snapshot_busy` is
high is ignored.

## Clock-Domain Crossings

Single-bit levels use two-stage synchronizers. Event and transaction channels
use request/acknowledge toggles:

1. The source latches its multi-bit payload and toggles the request bit.
2. The destination synchronizes and detects the toggle.
3. The destination samples the payload only after the synchronized event,
   processes the operation, and holds its response stable.
4. The destination toggles the acknowledgement.
5. The source synchronizes the acknowledgement and then samples the response.

Payload buses are never synchronized bit by bit. They remain unchanged from
before request launch until the corresponding acknowledgement returns. This
permits either clock to stop without corrupting a transaction.

Entering `Test-Logic-Reset` creates a soft-reset event for the CPU-domain
bridge. The bridge cancels asserted `dbg_rden`/`dbg_wren`, aborts collection,
and aligns its acknowledgement toggles to the synchronized request toggles.
This safely clears pending operations without resetting CDC toggles
asynchronously. The TAP also clears `halt_req` and `rst_req`; a CPU already in
its halt state remains halted until a later execute request.

## Host Operation Sequences

Pause:

1. Update `DBG_CTRL` with `halt_req=1`.
2. Poll `DBG_STATUS.halted` until it is one.

Single-step:

1. Keep `halt_req=1` and update `execute_req=1`.
2. Poll `execute_busy` until it returns to zero.

Resume:

1. Update `DBG_CTRL` with `halt_req=0` and `execute_req=1`.
2. Poll until `execute_busy=0` and `halted=0`.

CPU reset:

1. Update `DBG_CTRL` with `rst_req=1`.
2. Update it again with `rst_req=0`.
3. Keep `halt_req=1` in both writes if the CPU should halt after reset.

Memory access:

1. Halt the CPU.
2. Scan a read or write request through `DBG_XFER`.
3. Repeatedly scan NOP requests until the captured response is not busy.

Register snapshot:

1. Halt the CPU.
2. Update `DBG_CTRL` with `snapshot_req=1`.
3. Poll until `snapshot_busy=0` and `snapshot_valid=1`.
4. Scan `DBG_REGS` once to obtain all 16 registers.

## Verification

Create `rtl/sim/jtag_debug_tb.v` with asynchronous, non-harmonic `clk` and
`tck` periods and a behavioral CPU debug responder. It verifies:

- TMS reset from every TAP state and default IDCODE selection;
- IR capture pattern, all defined instructions, undefined-instruction bypass,
  bit order, and TDO falling-edge behavior;
- persistent halt/reset control and execute request CDC;
- reliable single-step completion using `execute_busy`;
- successful delayed reads and writes;
- busy polling and rejection of overwrite attempts;
- failures for running-CPU access, misalignment, and invalid operations;
- TCK stopping while the CPU completes a request;
- collection and scan ordering of all 16 registers;
- rejection of a snapshot while running;
- TAP soft reset while operations are pending.

Create `rtl/sim/MERC32_top_tb.v` as an integration test using the real core and
simple instruction/data memories. It drives only the four JTAG pins for debug
operations and verifies halt, one-instruction step, resume, register snapshot,
and instruction/data memory access through the integrated top level.

Simulation follows the project Verilog flow: lint when needed, compile, then
simulate each module independently and finally the integrated top level. Each
testbench contains its own watchdog and prints an explicit pass or fail result.
