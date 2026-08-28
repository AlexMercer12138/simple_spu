# MERC32 CPU Resource Optimization Design

## Goal

Reduce MERC32 LUT and flip-flop use without changing the instruction set,
software-visible register behavior, or local-bus request/ack protocol. Add one
registered instruction-decode stage to remove BRAM output delay from operand
selection. Preserve the full 64-bit multiplier for future high-word
instructions and close timing at 200 MHz in the 13-bit-memory build.

## Debug Configuration

`MERC32_top` gains an integer `DEBUG_EN` parameter with a default value of 1.
When enabled, the existing JTAG TAP, halt, step, reset, memory transfer, and
register inspection features are present. When disabled, the JTAG transport is
not instantiated, `tdo` is tied low, and every debug request into the CPU is
tied inactive. The CPU and all three functional bus paths remain available.

The parameter is resolved by a Verilog generate block so synthesis removes the
JTAG state, CDC registers, and debug-only routing instead of merely disabling
them at run time.

## Single-Register JTAG Access

The `IR_DBG_REGS` data register changes from a 512-bit snapshot to a 37-bit
single-register transaction:

| Bits | Meaning |
|---|---|
| `[0]` | Request flag written by the debugger; captured as zero |
| `[4:1]` | Register index |
| `[36:5]` | Captured register value |

Updating `IR_DBG_REGS` with bit 0 set starts one request if no register request
is already active. Updating with bit 0 clear only reads the previous response.
Status bit 5 remains the register-request busy bit and status bit 6 remains the
register-response valid bit. `IR_DBG_CTRL[3]` becomes reserved; halt, reset, and
single-step retain their current control bits.

The CPU debug register interface gains `dbg_regi_addr[3:0]`. A request samples
exactly one register and produces one `dbg_regi_vld` pulse with its value. The
register transaction is rejected when the core is not halted, just as the old
snapshot operation was unavailable while running.

## Register File

Registers `r1`, `r2`, and `r3` remain dedicated flip-flop registers because
interrupt entry can update more than one of them in the same clock. `r0` is a
constant zero and `r15` reads the current `prog_addr`; writes to either retain
their current architectural behavior. Registers `r4` through `r14` move to one
11x32 distributed-memory array with one synchronous write port.

The array is not connected to a reset pin. Instead, after external or debug
reset, the core remains in `ST_IDLE` and clears one array entry per clock. This
preserves the existing zero-after-reset behavior while allowing distributed
RAM inference. Instruction fetching starts after all eleven entries have been
cleared.

On instruction response, the core captures only the 32-bit instruction. A new
`ST_DECODE` state then captures the values addressed by `rs2`, `rs1` or the
decoded immediate, and `rd` into three operand registers. Normal execution,
branching, stores, multiplication, and division use only these registered
operands. This separates BRAM clock-to-output delay from instruction decode and
adds one clock to ordinary instruction execution.

## Shared Execution Logic

Immediate extension is selected once while operands are captured. The core
then uses one `operand_b` path for immediate and register forms.

One shared addition result serves ALU addition, effective addresses, and branch
or jump targets. One shared subtraction result serves ALU subtraction and
ordered comparisons. Equality is evaluated directly from the two operands so
EQ/NE do not traverse the subtract carry chain. The ten comparison relations
select among equality, signed-less-than, and unsigned-less-than flags. Load
byte/halfword lane selection and sign or zero extension are implemented once
for both immediate and register address forms.

Variable shifts use only `operand_b[4:0]` in the barrel shifter. A decode-stage
flag preserves the existing behavior for shift counts greater than 31: logical
shifts return zero and arithmetic right shifts return the sign fill. The
complete 64-bit iterative multiplier remains unchanged. Multiplier and divider
inputs connect directly to the captured operands; redundant operand staging
registers in the core are removed.

## Shared Bus Request Payload

The core keeps one registered request payload containing request type, target,
byte address, byte strobe, and write data. A request is loaded from exactly one
of three sources: normal instruction fetch, normal data access, or a halted
debug access. The target selects ILB, DLB, or PLB.

External request pulses and payloads are simple decodes of these registers.
Consequently every RAM-facing data path still crosses a CPU register before it
leaves the core. The selected target and payload remain stable while waiting
for acknowledgement. Response data and CPU/debug acknowledgements retain their
registered consumption boundary.

Unmapped accesses retain the current behavior: no slave request is emitted and
the requester waits indefinitely because no bus error mechanism exists.

## Divider

The restoring divider reuses its quotient work register as the dividend shift
register. It is initialized with the dividend magnitude; each iteration shifts
out the next dividend bit and shifts in the newly resolved quotient bit. The
standalone `dividend_reg` is removed.

Nonzero division performs 32 quotient-bit iterations, then uses a separate
finalization clock to apply quotient and remainder signs. `done` is therefore
asserted 33 clocks after a nonzero request is accepted. Divide-by-zero results,
ignored `start` while running or finalizing, one-cycle `done`, and stable
outputs retain their existing behavior.

## Verification

The JTAG unit test verifies the 37-bit register protocol, all sixteen indices,
one request pulse per transaction, response-valid/busy status, running-core
rejection, TAP reset cancellation, and coexistence with memory transfers.
A top-level no-debug test verifies that `DEBUG_EN=0` elaborates, ties `tdo` low,
and still fetches instructions.

Existing divider, core ISA, interrupt, top-level JTAG, Tiny C firmware,
assembler, and compiler regressions remain authoritative for functional
compatibility. The environment does not expose VKS tools, so Icarus
Verilog-2005 is used for simulation and this limitation is recorded.

Vivado 2020.2 synthesis and routed implementation target
`xc7a200tfbg484-2` with 13-bit ILB and DLB memories. Reports compare enabled
and disabled debug configurations against the recorded baseline, including
hierarchical LUT/FF counts, BRAM inference, WNS, and the main-clock critical
path. Success requires no regression below the current routed frequency and a
material reduction in total FF use with debug disabled or the single-register
debug transport enabled.

## Scope

This work modifies `MERC32_top`, `merc32_core`, `jtag_debug`, `div`, their
testbenches, and the debug-facing documentation needed to describe the new
parameter and register protocol. It does not change the ISA, assembler,
compiler, multiplier implementation, peripheral RTL, or external bus protocol.
