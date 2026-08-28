# MERC32 CPU Resource Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce MERC32 CPU and debug resource use while preserving ISA behavior, registered local-bus timing, and the full 64-bit multiplier, then close the 13-bit-memory build at 200 MHz.

**Architecture:** Replace the 512-bit JTAG snapshot with indexed 37-bit transactions and make JTAG optional at elaboration. Register each instruction response before a new decode/operand-capture state, move general registers into a reset-cleared distributed RAM, share arithmetic/comparison/load logic and one registered bus payload, and split divider iteration from signed-result finalization.

**Tech Stack:** Verilog-2005, Icarus Verilog, Node.js toolchain regressions, Vivado 2020.2, XC7A200T.

**Spec:** `docs/superpowers/specs/2026-08-28-cpu-resource-optimization-design.md`

## Global Constraints

- Keep the current MERC32 instruction encodings and software-visible semantics.
- Add exactly one `ST_DECODE` state between instruction response and execution.
- Preserve one-cycle registered local-bus request pulses and one-cycle acknowledgements.
- Keep `mul.v` and its 64-bit result unchanged.
- Use only Verilog-2005 syntax and the existing naming/style conventions.
- Do not modify peripheral RTL.

---

### Task 1: Establish Functional and Resource Baselines

**Files:**
- Verify: `rtl/cpu/core.v`
- Verify: `rtl/debug/jtag_debug.v`
- Verify: `rtl/misc/div.v`
- Verify: `rtl/sim/*.v`

**Interfaces:**
- Consumes: current committed RTL and testbenches
- Produces: recorded pass/fail output and hierarchical Vivado utilization for later comparison

- [ ] **Step 1: Run standalone RTL tests**

Compile and run `div_tb`, `merc32_core_tb`, `jtag_debug_tb`, and
`MERC32_top_tb` with `iverilog -Wall -g2005`, placing `.vvp` files under the
system temporary directory. Confirm every test prints its existing pass marker.

- [ ] **Step 2: Run toolchain and firmware regressions**

Run `npm test` and `npm run test:c:rtl` from `merc32-vsce`. Record the exact
number of passing RTL firmware programs.

- [ ] **Step 3: Synthesize the baseline**

Use Vivado 2020.2 non-project mode, `xc7a200tfbg484-2`, hierarchy preservation,
and 13-bit core address parameters. Report total and hierarchical LUT, LUTRAM,
FF, DSP, and BRAM counts for `MERC32_top`, `u_merc32_core`, `jtag_debug_inst`,
`mul_inst`, and `div_inst`.

### Task 2: Add Optional Debug and Indexed Register Tests

**Files:**
- Modify: `rtl/sim/jtag_debug_tb.v`
- Modify: `rtl/sim/MERC32_top_tb.v`
- Create: `rtl/sim/MERC32_top_nodebug_tb.v`

**Interfaces:**
- Consumes: proposed `dbg_regi_addr[3:0]` and 37-bit `IR_DBG_REGS` protocol
- Produces: failing tests for the new JTAG interface and `DEBUG_EN` parameter

- [ ] **Step 1: Convert the JTAG model to indexed reads**

Replace the sixteen-word stream model with one-cycle `dbg_regi_req`, explicit
`dbg_regi_addr`, and a delayed `dbg_regi_vld` response. Add a 37-bit shift task
using bit 0 as request, bits 4:1 as index, and bits 36:5 as response data.

- [ ] **Step 2: Add protocol assertions**

Read all sixteen register indices and compare against hand-derived values.
Assert exactly one core request for each transaction, correct response index,
busy/valid status behavior, no request while the core is running, and TAP reset
cancellation of an outstanding request.

- [ ] **Step 3: Convert the full-top test**

Read `r0` and `r15` independently, single-step once, read `r15` again, and
verify the PC advances by four. Count core register-valid pulses and require one
per indexed transaction.

- [ ] **Step 4: Add the disabled-debug top test**

Instantiate `MERC32_top` with `.DEBUG_EN(0)`, model synchronous ILB/DLB
responses, hold arbitrary JTAG inputs, require `tdo==0`, and require at least
one instruction fetch after reset.

- [ ] **Step 5: Verify RED**

Compile all three tests before production edits. Expected failures are missing
`DEBUG_EN`, missing `dbg_regi_addr`, and the old 512-bit register behavior.

### Task 3: Implement Optional Debug and Indexed Register Access

**Files:**
- Modify: `rtl/debug/jtag_debug.v`
- Modify: `rtl/cpu/core.v`
- Modify: `rtl/cpu/MERC32_top.v`

**Interfaces:**
- Consumes: 37-bit register packets from Task 2
- Produces: `dbg_regi_req`, `dbg_regi_addr[3:0]`, `dbg_regi_vld`, and `dbg_regi_data[31:0]`

- [ ] **Step 1: Replace snapshot state**

Use a TCK request toggle and index register, a two-flop request synchronizer, a
clock-domain one-register read FSM, an acknowledgement toggle, and stable
response index/data registers. Remove every 512-bit shift/snapshot register.

- [ ] **Step 2: Simplify the core register debug port**

On one `dbg_regi_req` pulse, sample the indexed architectural register and emit
one `dbg_regi_vld` pulse on the following registered response. Remove the
sixteen-word streaming counter.

- [ ] **Step 3: Add the top-level generate block**

Default `DEBUG_EN` to 1. Instantiate `jtag_debug` only in the enabled branch;
in the disabled branch tie all debug inputs into the core inactive and tie
`tdo` low.

- [ ] **Step 4: Verify GREEN**

Run the three Task 2 tests and require their pass markers with no compile
warnings or protocol failures.

### Task 4: Compress Divider State

**Files:**
- Modify: `rtl/misc/div.v`
- Verify: `rtl/sim/div_tb.v`

**Interfaces:**
- Consumes: existing `start`, `signed_mode`, operands, and start/done interface
- Produces: unchanged quotient/remainder/done behavior with one fewer 32-bit work register

- [ ] **Step 1: Run the existing divider characterization test**

Confirm signed, unsigned, zero divisor, ignored start, latency, and output
stability checks pass before the refactor.

- [ ] **Step 2: Reuse the quotient register**

Initialize `quotient_reg` with `dividend_magnitude`, shift its bit 31 into the
partial remainder, and shift each resolved quotient bit into bit 0. Delete
`dividend_reg` and its assignments.

- [ ] **Step 3: Re-run divider verification**

Require exactly 32 quotient-bit iterations followed by one finalization clock
for every nonzero divisor, and require all arithmetic/identity cases to pass.

### Task 5: Capture Operands and Restructure the Register File

**Files:**
- Modify: `rtl/cpu/core.v`
- Modify: `rtl/sim/merc32_core_tb.v` only if the simulation-only register view changes

**Interfaces:**
- Consumes: registered instruction response and existing writeback/interrupt events
- Produces: registered `operand_a`, `operand_b`, and `operand_d`; zeroed r4-r14 distributed RAM after reset

- [ ] **Step 1: Add a register-read function and operand capture**

Map r0 to zero, r1-r3 to dedicated registers, r4-r14 to the general array, and
r15 to `prog_addr`. Capture the instruction when its response is accepted, then
capture rs2, selected rs1/immediate, and rd values in `ST_DECODE`.

- [ ] **Step 2: Preserve reset semantics through sequential clearing**

Hold `ST_IDLE` after reset and clear one r4-r14 array entry per clock through
the array's normal write port. Start fetching only after all eleven entries are
zero. Keep r1-r3 on synchronous reset.

- [ ] **Step 3: Route all execution consumers to captured operands**

Branches, stores, ALU operations, multiplication, division, and effective
addresses must not dynamically read the register file during `ST_EXEC`.

- [ ] **Step 4: Run core and interrupt tests**

Require all compare, branch, jump, load/store, multiply/divide, r0/r15,
interrupt-entry, and reset cases to pass.

### Task 6: Share ALU, Compare, and Load Logic

**Files:**
- Modify: `rtl/cpu/core.v`
- Verify: `rtl/sim/merc32_core_tb.v`

**Interfaces:**
- Consumes: captured operands, decoded operation group/function, bus response
- Produces: unchanged `alu_data`, `prog_next`, and memory results

- [ ] **Step 1: Collapse immediate/register decode pairs**

Decode on `{opt, fun}` and use the captured `operand_b`, eliminating duplicate
IALU/RALU, IPCU/RPCU, and IMCU/RMCU result cases.

- [ ] **Step 2: Share add and subtract paths**

Use one addition for ADD/effective address/branch target and one subtraction
for SUB plus compare flags. Derive signed/unsigned relations from equality,
subtraction sign, operand signs, and unsigned borrow.

- [ ] **Step 3: Share narrow-load extraction**

Implement byte/halfword lane selection once and select sign or zero extension
from the function code.

- [ ] **Step 4: Re-run the complete core test**

Require every existing ISA check to pass without changing expected instruction
addresses or ordinary execution-state counts.

### Task 7: Consolidate the Registered Bus Payload

**Files:**
- Modify: `rtl/cpu/core.v`
- Verify: `rtl/sim/merc32_core_tb.v`
- Verify: `rtl/sim/MERC32_top_tb.v`

**Interfaces:**
- Consumes: fetch, data, and halted-debug requests
- Produces: registered request target/address/strobe/data and decoded ILB/DLB/PLB outputs

- [ ] **Step 1: Add one request record**

Register request read/write bits, byte address, strobe, data, and target in one
functional always block. Default request bits low every clock and hold payload
fields until replaced by a later request.

- [ ] **Step 2: Decode registered outputs**

Drive each external request only when its target matches. Slice ILB/DLB word
addresses from the registered byte address and drive all write payloads from
the same registers.

- [ ] **Step 3: Route response by target**

Select acknowledgement and read data using the retained target. Preserve the
registered CPU/debug response boundary and unmapped-access behavior.

- [ ] **Step 4: Re-run bus integration tests**

Require one-cycle, mutually exclusive requests and correct delayed
acknowledgements for instruction, data, peripheral, and debug transactions.

### Task 8: Full Verification and Vivado Comparison

**Files:**
- Verify: all modified RTL and testbenches
- Generate temporarily: Vivado wrappers, constraints, reports, and checkpoints outside the repository

**Interfaces:**
- Consumes: optimized debug-enabled and debug-disabled top configurations
- Produces: final functional results, resource deltas, BRAM/LUTRAM inference, and routed timing results

- [ ] **Step 1: Run every standalone RTL regression**

Run multiplier, divider, JTAG, no-debug top, core, RAM, and full-top tests.
Require one pass marker per test and no warning, failure, or timeout.

- [ ] **Step 2: Run Tiny C and toolchain suites**

Run `npm test` and `npm run test:c:rtl`; require all compiler, assembler, and
firmware tests to pass.

- [ ] **Step 3: Synthesize enabled and disabled debug builds**

Use 13-bit address parameters and hierarchical reports. Confirm the disabled
build contains no `jtag_debug` hierarchy, compare LUT/FF/LUTRAM counts to Task
1, and confirm the full multiplier remains present.

- [ ] **Step 4: Place and route the complete memory configuration**

Instantiate two 8192x32 `spram` memories, constrain the main clock to the
previous measurement target, and run optimization, placement, physical
optimization, and routing. Confirm both memories infer BRAM and report WNS and
critical path endpoints.

- [ ] **Step 5: Check repository integrity**

Run `git diff --check`, inspect `git status --short`, and leave only intended
source, test, and documentation changes. Remove only temporary outputs created
by this task.
