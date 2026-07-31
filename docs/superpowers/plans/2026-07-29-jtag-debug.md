# MERC32 JTAG Debug Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standard four-pin JTAG TAP that transports the existing MERC32 CPU debug interface and integrate it into `MERC32_top`.

**Architecture:** One Verilog-2005 `jtag_debug` module owns the IEEE 1149.1 TAP, custom scan registers, toggle-based asynchronous CDC channels, and the CPU-clock debug controller. `MERC32_top` exposes only `tck`, `tms`, `tdi`, and `tdo` as new chip-level ports and wires the module to `merc32_core`.

**Tech Stack:** Verilog-2005, VKS CLI compile/simulate flow (the VKS MCP tools are not exposed in this session), and Icarus Verilog as an independent cross-check.

**Execution Constraint:** Work directly on the current `main` branch in this session, as explicitly requested. Do not create a worktree or use subagents. Do not stage unrelated pre-existing worktree changes.

**Execution Result:** Implementation, independent Icarus verification, top-level
integration verification, and CPU/Tiny C regressions are complete. VKS lint and
compile pass for the module and top-level tests. VKS dynamic simulation is
recorded as a tool limitation: even the shortened IDCODE/BYPASS path did not
finish within 44 seconds, and the full scan test did not finish within 120
seconds; Icarus completes the full module test with 49 checks and the real-core
top test with 12 checks.

---

## File Map

- Create `rtl/debug/jtag_debug.v`: TAP, scan registers, CDC, CPU debug controller.
- Create `rtl/sim/jtag_debug_tb.v`: independent protocol and CDC verification.
- Create `rtl/sim/MERC32_top_tb.v`: real-core integration verification.
- Modify `rtl/cpu/MERC32_top.v`: four JTAG ports, debug wires, and module instance.
- Modify `rtl/sim/core_full_tb.v`: update renamed core debug ports.
- Modify `rtl/sim/merc32_core_tb.v`: update renamed core debug ports.
- Modify `rtl/sim/tinyc_cpu_tb.v`: update renamed core debug ports.
- Modify `rtl/sim/tinyc_irq_tb.v` only if it still exists when integration begins: update renamed core debug ports without changing its stimulus.
- Modify `docs/superpowers/specs/2026-07-29-jtag-debug-design.md`: keep reset wording consistent with the mandatory synchronous-reset RTL standard.

## Task 1: TAP Test Harness and Initial RED

**Files:**
- Create: `rtl/sim/jtag_debug_tb.v`
- Test target: `rtl/debug/jtag_debug.v`

- [x] **Step 1: Create the independent testbench shell and JTAG drivers**

Use asynchronous clocks and instantiate the wished-for production interface:

```verilog
`timescale 1ns / 1ps

module jtag_debug_tb;
    localparam CLK_HALF_PERIOD = 5;
    localparam TCK_HALF_PERIOD = 17;
    localparam IDCODE_VALUE = 32'h4d32_0001;

    reg clk = 1'b0;
    reg rst_n = 1'b0;
    reg tck = 1'b0;
    reg tms = 1'b1;
    reg tdi = 1'b0;
    wire tdo;

    wire dbg_rst_req;
    wire dbg_halt_req;
    wire dbg_step_req;
    wire dbg_regi_req;
    reg dbg_regi_vld = 1'b0;
    reg [31:0] dbg_regi_data = 32'd0;
    reg dbg_halted = 1'b0;
    wire dbg_rden;
    wire dbg_wren;
    wire [31:0] dbg_addr;
    wire [31:0] dbg_wdata;
    reg [31:0] dbg_rdata = 32'd0;
    reg dbg_ack = 1'b0;

    integer checks = 0;
    integer failures = 0;
    reg [511:0] scan_in;
    reg [511:0] scan_out;
    reg sampled_tdo;

    always #(CLK_HALF_PERIOD) clk = ~clk;
    always #(TCK_HALF_PERIOD) tck = ~tck;
    initial #(CLK_HALF_PERIOD * 7) rst_n = 1'b1;

    jtag_debug #(.IDCODE_VALUE(IDCODE_VALUE)) jtag_debug_inst (
        .clk(clk), .rst_n(rst_n), .tck(tck), .tms(tms), .tdi(tdi),
        .tdo(tdo), .dbg_rst_req(dbg_rst_req),
        .dbg_halt_req(dbg_halt_req), .dbg_step_req(dbg_step_req),
        .dbg_regi_req(dbg_regi_req), .dbg_regi_vld(dbg_regi_vld),
        .dbg_regi_data(dbg_regi_data), .dbg_halted(dbg_halted),
        .dbg_rden(dbg_rden), .dbg_wren(dbg_wren), .dbg_addr(dbg_addr),
        .dbg_wdata(dbg_wdata), .dbg_rdata(dbg_rdata), .dbg_ack(dbg_ack));
```

Add tasks `jtag_cycle`, `tap_reset`, `shift_ir`, `shift_dr`, and `check_value`.
`shift_dr` uses 512-bit arguments plus an integer bit count so the same task
drives all DR widths. Every stimulus assignment that crosses a sampled edge
uses nonblocking assignment.

```verilog
    task jtag_cycle;
        input next_tms;
        input next_tdi;
        output sampled;
        begin
            @(negedge tck);
            tms <= next_tms;
            tdi <= next_tdi;
            @(posedge tck);
            #1 sampled = tdo;
        end
    endtask

    task tap_reset;
        integer bit_index;
        begin
            for (bit_index = 0; bit_index < 6; bit_index = bit_index + 1)
                jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
        end
    endtask
```

- [x] **Step 2: Add the first behavior checks**

The first test keeps `tck` stopped while `rst_n` is low, verifies that all
CPU-facing debug outputs remain inactive after reset release, then resets the
TAP using TMS. It scans the default 32-bit DR and expects `IDCODE_VALUE`, checks
that the TCK-domain status is fully initialized, selects IR `5'b11111`, shifts
a one-bit bypass value, and checks the one-bit delay. End with `TEST PASS` or
`TEST FAIL`, `$finish`, commented `$dumpfile/$dumpvars`, and an independent
timeout block.

- [x] **Step 3: Run RED and confirm the intended failure**

Run:

```powershell
New-Item -ItemType Directory -Force build
vks --compile rtl/sim/jtag_debug_tb.v -o build/jtag_debug_tb.vks
```

Expected: compile failure because `jtag_debug` is undefined. This is the
required TDD RED, not a testbench syntax error.

## Task 2: Minimal IEEE 1149.1 TAP

**Files:**
- Create: `rtl/debug/jtag_debug.v`
- Test: `rtl/sim/jtag_debug_tb.v`

- [x] **Step 1: Implement the TAP state machine and standard DRs**

Create a Verilog-2005 module with the exact ports used by the testbench. Define
all 16 TAP states as 4-bit localparams and calculate transitions in a function:

```verilog
    function [3:0] tap_next_state;
        input [3:0] state;
        input       select;
        begin
            case (state)
                TAP_TEST_LOGIC_RESET: tap_next_state = select ? TAP_TEST_LOGIC_RESET : TAP_RUN_TEST_IDLE;
                TAP_RUN_TEST_IDLE:    tap_next_state = select ? TAP_SELECT_DR_SCAN : TAP_RUN_TEST_IDLE;
                TAP_SELECT_DR_SCAN:   tap_next_state = select ? TAP_SELECT_IR_SCAN : TAP_CAPTURE_DR;
                TAP_CAPTURE_DR:       tap_next_state = select ? TAP_EXIT1_DR : TAP_SHIFT_DR;
                TAP_SHIFT_DR:         tap_next_state = select ? TAP_EXIT1_DR : TAP_SHIFT_DR;
                TAP_EXIT1_DR:         tap_next_state = select ? TAP_UPDATE_DR : TAP_PAUSE_DR;
                TAP_PAUSE_DR:         tap_next_state = select ? TAP_EXIT2_DR : TAP_PAUSE_DR;
                TAP_EXIT2_DR:         tap_next_state = select ? TAP_UPDATE_DR : TAP_SHIFT_DR;
                TAP_UPDATE_DR:        tap_next_state = select ? TAP_SELECT_DR_SCAN : TAP_RUN_TEST_IDLE;
                TAP_SELECT_IR_SCAN:   tap_next_state = select ? TAP_TEST_LOGIC_RESET : TAP_CAPTURE_IR;
                TAP_CAPTURE_IR:       tap_next_state = select ? TAP_EXIT1_IR : TAP_SHIFT_IR;
                TAP_SHIFT_IR:         tap_next_state = select ? TAP_EXIT1_IR : TAP_SHIFT_IR;
                TAP_EXIT1_IR:         tap_next_state = select ? TAP_UPDATE_IR : TAP_PAUSE_IR;
                TAP_PAUSE_IR:         tap_next_state = select ? TAP_EXIT2_IR : TAP_PAUSE_IR;
                TAP_EXIT2_IR:         tap_next_state = select ? TAP_UPDATE_IR : TAP_SHIFT_IR;
                TAP_UPDATE_IR:        tap_next_state = select ? TAP_SELECT_DR_SCAN : TAP_RUN_TEST_IDLE;
                default:              tap_next_state = TAP_TEST_LOGIC_RESET;
            endcase
        end
    endfunction
```

Use a 5-bit IR shift register, a 5-bit latched IR, a 512-bit DR shift register,
and a one-bit bypass register. In `Capture-IR`, load `5'b00001`. In
`Test-Logic-Reset`, select `IR_IDCODE`. In `Capture-DR`, load IDCODE or bypass.
Undefined instructions select bypass. Shift toward bit zero with TDI entering
the selected register's MSB. Register `tdo` only on `negedge tck` from bit zero.
All reset branches are synchronous active-low branches inside the corresponding
clocked blocks.

- [x] **Step 2: Run GREEN for IDCODE and BYPASS**

Run:

```powershell
vks --linter rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v
vks --compile rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v -o build/jtag_debug_tb.vks
vks --sim build/jtag_debug_tb.vks
```

Expected: explicit `TEST PASS` with no failures.

## Task 3: Control/Status CDC RED and GREEN

**Files:**
- Modify: `rtl/sim/jtag_debug_tb.v`
- Modify: `rtl/debug/jtag_debug.v`

- [x] **Step 1: Add failing control and status tests**

Add tasks to scan `IR_DBG_CTRL=5'b10000` and `IR_DBG_STATUS=5'b10001`.
Verify these separate behaviors:

```text
halt level crosses to clk domain and status bits [1:0] echo halt/reset
reset level asserts and deasserts without changing halt
execute request while halt=1 produces one dbg_step_req pulse
execute_busy stays high until dbg_halted is observed low then high
execute request while halt=0 clears busy once dbg_halted goes low
second execute request while busy is ignored
```

Count `dbg_step_req` pulses in a CPU-clock monitor and assert the count rather
than relying on a single sampled cycle.

- [x] **Step 2: Run RED**

Compile and simulate with the Task 2 commands. Expected: TAP tests pass and the
new control/status checks fail because custom DR capture/update and execute CDC
are not implemented.

- [x] **Step 3: Implement control/status registers and execute handshake**

Add TCK-domain level registers, an execute request toggle, an execute mode hold
bit, and synchronized acknowledgement. Define busy as request toggle unequal to
synchronized acknowledgement. Add two-flop level synchronizers and a CPU-domain
execute FSM:

```text
EXEC_IDLE -> EXEC_SETTLE -> EXEC_PULSE -> EXEC_WAIT_LOW
EXEC_WAIT_LOW -> EXEC_WAIT_HIGH when held halt mode is one
EXEC_WAIT_LOW -> EXEC_IDLE and acknowledge when held halt mode is zero
EXEC_WAIT_HIGH -> EXEC_IDLE and acknowledge when dbg_halted is one
```

`EXEC_PULSE` asserts `dbg_step_req` for exactly one `clk`. Drive
`dbg_halt_req` and `dbg_rst_req` from the synchronized control levels. Build the
32-bit status word with one continuous assignment matching the approved bit map.

- [x] **Step 4: Run GREEN**

Run lint, compile, and simulate. Expected: TAP plus control/status checks pass.

## Task 4: Memory Transfer RED and GREEN

**Files:**
- Modify: `rtl/sim/jtag_debug_tb.v`
- Modify: `rtl/debug/jtag_debug.v`

- [x] **Step 1: Add a behavioral debug-memory responder**

In the testbench CPU domain, hold a small word array. When `dbg_rden` or
`dbg_wren` is first observed, wait a configurable number of `clk` cycles,
perform the operation, drive `dbg_rdata`, and pulse `dbg_ack`. Keep this model
independent of JTAG internals.

- [x] **Step 2: Add failing 66-bit transaction tests**

Add `debug_xfer` and `poll_xfer` tasks using
`{address[31:0], data[31:0], op[1:0]}`. Test one behavior at a time:

```text
delayed aligned read returns status 00 and expected data
delayed aligned write returns status 00, echoes write data, and changes memory
capture while outstanding returns status 11 and active address
an update while busy cannot replace the active request
running CPU access returns status 10 without asserting dbg_rden/dbg_wren
misaligned access returns status 10
operation 11 returns status 10
NOP never launches a request
TCK may stop while the CPU acknowledges; response is correct after TCK resumes
```

- [x] **Step 3: Run RED**

Expected: new DMI checks fail because `DBG_XFER` still behaves as bypass.

- [x] **Step 4: Implement the transaction CDC and CPU FSM**

TCK domain holds request address/data/op until acknowledgement. CPU domain
synchronizes the request toggle, validates the held payload after one settle
cycle, and either publishes an immediate failure or enters read/write wait.

```text
XFER_IDLE -> XFER_SETTLE -> XFER_VALIDATE
XFER_VALIDATE -> XFER_RESPOND for invalid/running/misaligned requests
XFER_VALIDATE -> XFER_WAIT_ACK for valid read/write
XFER_WAIT_ACK -> XFER_RESPOND when dbg_ack is one
XFER_RESPOND -> XFER_IDLE after response data/status are held and ack toggles
```

Keep `dbg_rden` or `dbg_wren` asserted throughout `XFER_WAIT_ACK`. Synchronize
the response acknowledgement back to TCK, then copy the stable response bus.
`Capture-DR` loads busy or completed response; `Update-DR` launches only when
idle and op is not NOP.

- [x] **Step 5: Run GREEN**

Run VKS lint/compile/simulate. Expected: all transfer checks pass.

## Task 5: Register Snapshot and TAP Soft Reset

**Files:**
- Modify: `rtl/sim/jtag_debug_tb.v`
- Modify: `rtl/debug/jtag_debug.v`

- [x] **Step 1: Add failing snapshot tests**

The testbench responds to `dbg_regi_req` with 16 qualified CPU-clock cycles,
driving values `32'h1000_0000 + index`. Verify:

```text
snapshot_busy asserts after DBG_CTRL[3]
snapshot_valid remains low until all 16 values arrive
DBG_REGS[31:0] is r0 and DBG_REGS[511:480] is r15
the entire captured scan remains stable while shifting
snapshot while running completes with valid low
second snapshot while busy is ignored
```

Add a pending-transfer soft-reset test: launch a delayed memory access, drive
TMS high into `Test-Logic-Reset`, and verify debug strobes and all busy bits
clear without a phantom request.

- [x] **Step 2: Run RED**

Expected: snapshot and soft-reset checks fail while earlier tests remain green.

- [x] **Step 3: Implement snapshot CDC and soft-reset cancellation**

Add a snapshot request/ack toggle pair. In the CPU domain, reject while
running; otherwise pulse `dbg_regi_req`, count only `dbg_regi_vld` cycles, and
store each word into `snapshot_hold_cpu[reg_index*32 +: 32]`. Toggle ack only
after r15 is stored. In TCK, copy the stable 512-bit bus on ack and load it on
`DBG_REGS` Capture-DR.

Generate a TCK-domain reset request level while in `Test-Logic-Reset` and hold
it until a synchronized CPU-domain acknowledgement returns. In the CPU domain,
the asserted request synchronously deasserts `dbg_rden`, `dbg_wren`,
`dbg_step_req`, and `dbg_regi_req`, returns all FSMs to idle, and aligns CPU ack
toggles to the initialized request toggles. Gate all CPU-facing debug commands
with a ready bit that becomes true only after the reset request has gone high
and returned low. Do not asynchronously reset CDC state.

- [x] **Step 4: Run GREEN and independent cross-check**

Run:

```powershell
vks --linter rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v
vks --compile rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v -o build/jtag_debug_tb.vks
vks --sim build/jtag_debug_tb.vks
iverilog -g2005 -s jtag_debug_tb -o build/jtag_debug_tb.vvp rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v
vvp build/jtag_debug_tb.vvp
```

Expected: both simulators print `TEST PASS` and report no failures.

## Task 6: Top-Level Integration RED and GREEN

**Files:**
- Create: `rtl/sim/MERC32_top_tb.v`
- Modify: `rtl/cpu/MERC32_top.v`
- Modify: current core testbench port maps listed in the File Map

- [x] **Step 1: Write the failing integration test**

Instantiate `MERC32_top` with instruction/data memory models and APB tied ready.
Connect only `tck/tms/tdi/tdo` for debug control. Reuse local JTAG driver tasks,
then verify through real CPU behavior:

```text
IDCODE is readable through top
halt request reaches a real instruction boundary
snapshot returns r0=0 and a stable r15 program counter
single-step completes and advances r15 by four for an all-zero instruction
resume leaves halt and the program counter continues advancing
halt again, write/read instruction memory at 0x00000100
write/read data memory at 0x00800000
```

- [x] **Step 2: Run integration RED**

Run:

```powershell
vks --compile rtl/debug/jtag_debug.v rtl/bridge/lb2apb.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/MERC32_top_tb.v -o build/MERC32_top_tb.vks
```

Expected: compile failure because `MERC32_top` does not yet expose the four
JTAG ports and its core instance still uses old debug port names.

- [x] **Step 3: Integrate the module without top-level functional logic**

Add `tck`, `tms`, `tdi`, and `tdo` to `MERC32_top`. Declare internal wires for
every `dbg_*` signal, instantiate `jtag_debug` as `jtag_debug_inst`, and connect
the current `merc32_core` ports. Keep the top change to declarations,
instantiations, and connections.

Update old port maps from:

```verilog
.dbg_halt(1'b0), .dbg_step(1'b0), .dbg_reset(1'b0)
```

to:

```verilog
.dbg_rst_req(1'b0), .dbg_halt_req(1'b0), .dbg_step_req(1'b0),
.dbg_regi_req(1'b0), .dbg_regi_vld(), .dbg_regi_data()
```

Do not alter unrelated testbench stimulus or the user's in-progress CPU logic.

- [x] **Step 4: Run integration GREEN**

Run VKS lint, compile, and simulate for the top file list. Expected: explicit
`TEST PASS` covering all real-core JTAG operations.

- [x] **Step 5: Cross-check top integration with Icarus**

```powershell
iverilog -g2005 -s merc32_top_tb -o build/MERC32_top_tb.vvp rtl/debug/jtag_debug.v rtl/bridge/lb2apb.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/MERC32_top_tb.v
vvp build/MERC32_top_tb.vvp
```

Expected: `TEST PASS` with the same check count as VKS.

## Task 7: Regression and Cleanup

**Files:**
- Verify all modified RTL and testbench files

- [x] **Step 1: Run focused regression compiles**

Compile and simulate `merc32_core_tb` and `core_full_tb` with their current
file lists, using both VKS and Icarus when VKS output is incomplete or
questionable. Compile `tinyc_cpu_tb` and `tinyc_irq_tb` when their firmware
images and files are present. Record pre-existing failures separately from
JTAG regressions.

- [x] **Step 2: Run final static and whitespace checks**

```powershell
vks --linter rtl/debug/jtag_debug.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/jtag_debug_tb.v rtl/sim/MERC32_top_tb.v
git diff --check
```

Expected: no new lint errors and no whitespace errors in files changed for this
feature.

- [x] **Step 3: Inspect the final diff and clean generated outputs**

Confirm that only the planned source, test, and documentation files changed for
this feature. Remove generated `.vks`, `.vvp`, `.vcd`, and simulator logs from
`build/` while preserving all source files and pre-existing user files.

- [x] **Step 4: Record verification evidence**

Report every VKS command, result, check count, any VKS-specific bug observed,
whether Icarus agreed, and any skipped regression with its reason. Do not claim
completion until the independent module and top-level tests both pass freshly.
