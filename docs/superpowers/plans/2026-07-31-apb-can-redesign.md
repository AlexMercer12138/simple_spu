# APB CAN Classic Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incomplete CAN RTL with a Verilog-2005 Classic CAN 2.0A/B APB peripheral that has whole-frame FIFOs, correct arbitration/ACK/error confinement, filtering, interrupts, loopback, and listen-only operation.

**Architecture:** `apb_can.v` owns APB registers, two 99-bit `sync_fifo` instances, thresholds, and interrupt aggregation. `can_core.v` owns the coupled transmit/receive/error state machine and instantiates the rewritten `can_bit_timing.v` and `can_crc.v`; the old split TX/RX/top/FIFO design is removed. One integrated `apb_can_tb.v` incrementally verifies component behavior and two-node bus behavior.

**Tech Stack:** Verilog-2005, APB3-style register interface, Classic CAN 2.0A/B, project `sync_fifo`, OSS CAD Suite Icarus Verilog.

---

## File Map

- Create `rtl/can/can_core.v`: unified Classic CAN protocol, retry, error confinement, modes, and bus-off recovery.
- Replace `rtl/can/can_bit_timing.v`: TQ generation, sampling, hard synchronization, and SJW resynchronization.
- Replace `rtl/can/can_crc.v`: serial CRC-15 accumulator with polynomial `0x4599`.
- Replace `rtl/can/apb_can.v`: APB register bank, whole-frame FIFOs, commands, status, and interrupts.
- Create `rtl/sim/apb_can_tb.v`: the only retained CAN simulation, including component checks and two APB CAN nodes.
- Delete `rtl/sim/tb_apb_can.v`: obsolete CAN testbench name and behavior.
- Delete `rtl/can/can_top.v`, `rtl/can/can_tx.v`, `rtl/can/can_rx.v`, `rtl/can/can_fifo.v`: replaced architecture.
- Replace `rtl/can/apb_can_manual.md`: Chinese programming manual following the UART manual structure.
- Delete `tmp/pdfs/axi_can_cover.png` if it still exists: temporary PDF inspection output.

The Icarus command used throughout is:

```powershell
cmd /d /c "call C:\oss-cad-suite\environment.bat >nul && iverilog -g2005 -s apb_can_tb -o tmp\apb_can_tb.vvp rtl\misc\sync_fifo.v rtl\can\can_crc.v rtl\can\can_bit_timing.v rtl\can\can_core.v rtl\can\apb_can.v rtl\sim\apb_can_tb.v && vvp tmp\apb_can_tb.vvp"
```

## Task 1: Establish the APB/FIFO Contract

**Files:**
- Create: `rtl/sim/apb_can_tb.v`
- Create: `rtl/can/can_core.v`
- Replace: `rtl/can/apb_can.v`
- Delete: `rtl/sim/tb_apb_can.v`
- Reuse: `rtl/misc/sync_fifo.v`

- [ ] **Step 1: Write the failing APB and TX FIFO tests**

Create the new testbench with two independent APB master signal sets, a shared dominant-low bus, a global failure counter, bounded APB tasks, and these first checks:

```verilog
localparam ADDR_CTRL        = 32'h0000_0000;
localparam ADDR_BIT_TIMING  = 32'h0000_0004;
localparam ADDR_STATUS      = 32'h0000_0008;
localparam ADDR_TX_ID       = 32'h0000_000c;
localparam ADDR_TX_CTRL     = 32'h0000_0010;
localparam ADDR_TX_DATA0    = 32'h0000_0014;
localparam ADDR_TX_DATA1    = 32'h0000_0018;
localparam ADDR_TX_CMD      = 32'h0000_001c;
localparam ADDR_FIFO_STATUS = 32'h0000_0034;

task check32;
    input [8*80-1:0] name;
    input [31:0] actual;
    input [31:0] expected;
    begin
        if (actual !== expected) begin
            failures = failures + 1;
            $display("[FAIL] %0s expected=%08x actual=%08x",
                     name, expected, actual);
        end
    end
endtask
```

The APB write/read tasks must count clocks while waiting for `PREADY` and fail after 16 clocks. Test reset defaults, undefined reads returning zero, eight valid pushes, ninth-push overflow, invalid DLC rejection, standard-ID validation, TX clear, and the fact that each APB transfer completes exactly once.

- [ ] **Step 2: Run Icarus and verify the new contract fails**

Run the common Icarus command. Expected: compile failure because the old `apb_can` lacks `TX_FIFO_DEPTH`, `RX_FIFO_DEPTH`, the new register map, and `can_core`.

- [ ] **Step 3: Implement the APB wrapper and an idle core shell**

Define the new top-level parameters and preserve the external ports:

```verilog
module apb_can #(
    parameter SYS_CLK_FREQ    = 50_000_000,
    parameter DEFAULT_BIT_RATE = 500_000,
    parameter TX_FIFO_DEPTH   = 8,
    parameter RX_FIFO_DEPTH   = 8
)(
    input wire s_apb_pclk,
    input wire s_apb_presetn,
    input wire s_apb_psel,
    input wire s_apb_penable,
    input wire s_apb_pwrite,
    input wire [31:0] s_apb_paddr,
    input wire [31:0] s_apb_pwdata,
    output wire s_apb_pready,
    output wire s_apb_pslverr,
    output wire [31:0] s_apb_prdata,
    output wire interrupt,
    input wire can_rx,
    output wire can_tx
);
```

Use `FRAME_WIDTH=99`, instantiate independent `sync_fifo` blocks, implement setup-stage reads and registered `PREADY` following `apb_i2c`, and add exact register masks from the design spec. Create a compilable `can_core` with the final port contract and idle outputs (`can_tx=1`, no events, `running=enable_req`) so the wrapper tests isolate APB/FIFO behavior.

The final core contract established by the shell is:

```verilog
module can_core (
    input wire clk,
    input wire rst_n,
    input wire enable_req,
    input wire listen_only,
    input wire loopback,
    input wire auto_retry,
    input wire [9:0] brp,
    input wire [1:0] sjw,
    input wire [3:0] tseg1,
    input wire [2:0] tseg2,
    input wire filter_enable,
    input wire [30:0] accept_code,
    input wire [30:0] accept_mask,
    output reg tx_frame_request,
    input wire tx_frame_valid,
    input wire [98:0] tx_frame,
    input wire tx_abort,
    output reg rx_frame_valid,
    output reg [98:0] rx_frame,
    output reg tx_done_event,
    output reg tx_failed_event,
    output reg tx_aborted_event,
    output reg arbitration_lost_event,
    output reg protocol_error_event,
    output reg warning_enter_event,
    output reg passive_enter_event,
    output reg bus_off_enter_event,
    output reg bus_recovered_event,
    output reg [2:0] last_error_type,
    output reg [3:0] last_error_field,
    output reg [5:0] arbitration_lost_pos,
    output wire running,
    output wire bus_idle,
    output wire tx_active,
    output wire rx_active,
    output wire retry_pending,
    output wire error_warning,
    output wire error_passive,
    output wire bus_off,
    output wire [8:0] tec,
    output wire [7:0] rec,
    input wire can_rx,
    output wire can_tx
);
```

The shell may mirror `enable_req` to `running`, but it must otherwise remain recessive and event-free until the protocol tasks replace it. The wrapper owns FIFO overflow/underflow and configuration-error events; the core owns bus protocol events.

- [ ] **Step 4: Run Icarus and verify APB/FIFO checks pass**

Run the common command. Expected final output includes `[PASS] APB_FIFO` and `failures=0`; no APB task reaches its 16-cycle timeout.

- [ ] **Step 5: Commit the contract**

```powershell
git add -- rtl/can/apb_can.v rtl/can/can_core.v rtl/sim/apb_can_tb.v rtl/sim/tb_apb_can.v
git commit -m "feat: define APB CAN register and FIFO contract"
```

## Task 2: Rewrite and Characterize CRC-15

**Files:**
- Replace: `rtl/can/can_crc.v`
- Modify: `rtl/sim/apb_can_tb.v`

- [ ] **Step 1: Add CRC characterization to the integrated testbench**

Instantiate one standalone CRC block inside `apb_can_tb`. Shift the 19 destuffed bits for SOF, standard ID `0x123`, RTR/IDE/r0, and DLC 2:

```verilog
reg [18:0] crc_bits;
initial crc_bits = 19'b0_00100100011_0_0_0_0010;
```

Check reset, synchronous clear priority, hold while `enable=0`, and final `crc_value == 15'h26f3`.

- [ ] **Step 2: Run the characterization test**

Run Icarus. Expected: the known vector passes against the old CRC implementation, establishing that its polynomial behavior is the one reusable part of the old CAN code.

- [ ] **Step 3: Replace `can_crc.v` with the project-style implementation**

Keep the public accumulator contract and implement the next value exactly as:

```verilog
function [14:0] crc15_next;
    input [14:0] crc_in;
    input bit_in;
    reg feedback;
    begin
        feedback = bit_in ^ crc_in[14];
        crc15_next = {crc_in[13:0], 1'b0};
        if (feedback)
            crc15_next = crc15_next ^ 15'h4599;
    end
endfunction
```

Use one synchronous sequential block with reset, clear, and enable priority. Do not feed stuffed bits to this module from `can_core`.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] CRC15`, with the APB/FIFO tests still passing.

```powershell
git add -- rtl/can/can_crc.v rtl/sim/apb_can_tb.v
git commit -m "refactor: rewrite CAN CRC-15 accumulator"
```

## Task 3: Implement Bit Timing and Resynchronization

**Files:**
- Replace: `rtl/can/can_bit_timing.v`
- Modify: `rtl/sim/apb_can_tb.v`
- Modify: `rtl/can/can_core.v`

- [ ] **Step 1: Add timing tests that fail on the old design**

Instantiate a standalone timing block with `BRP=1`, `SJW=1`, `TSEG1=6`, and `TSEG2=1`, all using plus-one encoding. Check that one bit lasts 20 clocks, the sample pulse occurs after 8 of 10 TQ, and output-update/bit-end pulses are one clock wide. Drive recessive-to-dominant edges two TQ early and one TQ late and verify phase correction never exceeds two TQ. Also verify hard synchronization from idle aligns the first sample point.

- [ ] **Step 2: Run Icarus and verify timing checks fail**

Expected: failure because the old block treats several fields as direct lengths and has only a coarse early-edge reset.

- [ ] **Step 3: Implement the new timing contract**

Use this interface:

```verilog
module can_bit_timing (
    input wire clk,
    input wire rst_n,
    input wire enable,
    input wire hard_sync_enable,
    input wire resync_enable,
    input wire [9:0] brp,
    input wire [1:0] sjw,
    input wire [3:0] tseg1,
    input wire [2:0] tseg2,
    input wire can_rx,
    output wire rx_bit,
    output reg bit_start,
    output reg sample_point,
    output reg bit_end
);
```

Synchronize `can_rx` through two flops, detect both edge polarity changes, and maintain BRP/TQ counters. Hard synchronization resets the bit phase on the idle recessive-to-dominant edge. Resynchronization lengthens TSEG1 for a late edge or shortens TSEG2 for an early edge by at most `SJW+1`, and applies at most once per nominal bit.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] BIT_TIMING`, `[PASS] CRC15`, and `[PASS] APB_FIFO`.

```powershell
git add -- rtl/can/can_bit_timing.v rtl/can/can_core.v rtl/sim/apb_can_tb.v
git commit -m "feat: implement CAN bit timing resynchronization"
```

## Task 4: Implement Nominal Loopback Frames

**Files:**
- Modify: `rtl/can/can_core.v`
- Modify: `rtl/can/apb_can.v`
- Modify: `rtl/sim/apb_can_tb.v`

- [ ] **Step 1: Add end-to-end loopback tests**

Add `push_frame_a` and `pop_frame_a` APB tasks. Verify standard data DLC 0, standard data DLC 8, extended data DLC 8, standard remote, and extended remote. For every frame, check TX done, RX FIFO level, ID/IDE/RTR/DLC, byte order, CRC behavior, and that external `can_tx` remains recessive in loopback.

- [ ] **Step 2: Run Icarus and verify loopback fails**

Expected: timeout waiting for TX done because the Task 1 core shell never consumes a frame.

- [ ] **Step 3: Implement nominal frame generation and parsing**

In `can_core`, add the protocol states:

```verilog
localparam ST_STOP        = 5'd0;
localparam ST_IDLE        = 5'd1;
localparam ST_FRAME       = 5'd2;
localparam ST_CRC_DELIM   = 5'd3;
localparam ST_ACK_SLOT    = 5'd4;
localparam ST_ACK_DELIM   = 5'd5;
localparam ST_EOF         = 5'd6;
localparam ST_INTERMISSION = 5'd7;
localparam ST_ERROR_FLAG  = 5'd8;
localparam ST_ERROR_DELIM = 5'd9;
localparam ST_SUSPEND     = 5'd10;
localparam ST_BUS_OFF     = 5'd11;
```

Use a raw-field index and a `function frame_bit` to serialize MSB-first standard or extended arbitration/control fields followed by data. Maintain a stuffing run counter from SOF through the CRC sequence. The receive path uses the sampled destuffed bit stream to reconstruct fields and compares the received CRC sequence against the RX CRC accumulator. Loopback feeds the internal TX bit into the timing/receive path, supplies internal ACK, and commits the validated frame through `rx_frame_valid`.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] LOOPBACK_FRAMES`; all earlier groups remain passing.

```powershell
git add -- rtl/can/can_core.v rtl/can/apb_can.v rtl/sim/apb_can_tb.v
git commit -m "feat: add CAN standard and extended frame engine"
```

## Task 5: Add Two-Node Receive, ACK, and Filtering

**Files:**
- Modify: `rtl/can/can_core.v`
- Modify: `rtl/can/apb_can.v`
- Modify: `rtl/sim/apb_can_tb.v`

- [ ] **Step 1: Add two-node and filter tests**

Connect both DUT outputs as `can_bus = can_tx_a & can_tx_b`, with both RX inputs observing the same bus. Send standard, extended, data, and remote frames from A to B. Configure B with:

```text
ACCEPT_CODE = {29'h00000123, 1'b0, 1'b0}
ACCEPT_MASK = {29'h000007ff, 1'b1, 1'b1}
```

Verify ID `0x123` enters B's FIFO, ID `0x124` is filtered, and A still reports TX success for the filtered frame. Fill B's RX FIFO, send one more valid frame, and verify B ACKs while raising RX overflow.

- [ ] **Step 2: Run Icarus and verify external receive/ACK fails**

Expected: A reports ACK error or B receives no frame because only internal loopback is implemented.

- [ ] **Step 3: Implement shared-bus receive and ACK timing**

Parse external SOF while idle, validate destuffed fields/CRC/form, and set an `ack_drive` decision before ACK slot. Define physical output as dominant-low wired-AND behavior:

```verilog
assign can_tx = (!running || listen_only || loopback || bus_off) ? 1'b1
              : (tx_drive & ack_drive & error_drive);
```

Make the ACK decision independent of the acceptance result and `rx_fifo_ready`. Apply the exact code/mask expression only when deciding whether to pulse `rx_frame_valid`.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] TWO_NODE_ACK` and `[PASS] ACCEPT_FILTER`.

```powershell
git add -- rtl/can/can_core.v rtl/can/apb_can.v rtl/sim/apb_can_tb.v
git commit -m "feat: add CAN receive ACK and acceptance filtering"
```

## Task 6: Add Arbitration, Retry, and Safe Abort

**Files:**
- Modify: `rtl/can/can_core.v`
- Modify: `rtl/can/apb_can.v`
- Modify: `rtl/sim/apb_can_tb.v`

- [ ] **Step 1: Add simultaneous-transmit tests**

Queue frames in both nodes while disabled, then enable both on the same clock. Test lower standard ID winning, standard frame beating an extended frame with the same 11-bit base ID, and a losing node receiving the winner before retrying its retained frame. Repeat with `AUTO_RETRY=0` and check TX failed. Request `TX_ABORT` during retry wait and check that the active frame is discarded only at a safe boundary.

- [ ] **Step 2: Run Icarus and verify arbitration order fails**

Expected: bit-error/ACK behavior instead of clean arbitration loss, or the losing frame disappears.

- [ ] **Step 3: Implement arbitration and active-frame retention**

Track whether the current destuffed bit belongs to the arbitration field and its zero-based position. At sample point:

```verilog
if (tx_participating && arbitration_field && tx_drive_bit && !rx_bit) begin
    arbitration_lost_event <= 1'b1;
    arbitration_lost_pos <= arbitration_bit_pos;
    tx_participating <= 1'b0;
    retry_pending <= auto_retry;
end
```

Continue parsing the winning frame after loss. Retain the active 99-bit frame for retry, implement passive-transmitter suspend delay, and honor abort only after the current frame/error/intermission boundary.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] ARBITRATION_RETRY` and `[PASS] SAFE_ABORT`.

```powershell
git add -- rtl/can/can_core.v rtl/can/apb_can.v rtl/sim/apb_can_tb.v
git commit -m "feat: implement CAN arbitration retry and abort"
```

## Task 7: Add Protocol Errors and Error Confinement

**Files:**
- Modify: `rtl/can/can_core.v`
- Modify: `rtl/can/apb_can.v`
- Modify: `rtl/sim/apb_can_tb.v`

- [ ] **Step 1: Add controlled error injection tests**

Add testbench tasks that drive a pre-stuffed external frame one nominal bit at a time and a bus override that can force a sampled dominant or recessive value. Construct one bad frame for each Stuff, Form, CRC, ACK, and Bit Error. Check `ERROR_STATUS` type/field, protocol-error interrupt, six-bit Active Error Flag, Error Delimiter, and that invalid frames never enter RX FIFO. Repeatedly inject receiver errors until REC reaches 128, then verify Error Passive produces a six-bit recessive Passive Error Flag. Follow with valid receive and transmit operations and verify REC/TEC decrease according to the specified success rules.

- [ ] **Step 2: Run Icarus and verify error checks fail**

Expected: missing error flags and incorrect or unchanged TEC/REC.

- [ ] **Step 3: Implement error generation and ISO counter transitions**

Centralize error entry in one sequential path carrying `error_type` and `error_field`. A transmitting node increments TEC by 8 for transmit errors; a receiving node increments REC according to the Classic CAN rules; successful TX decrements TEC and successful RX decrements/normalizes REC. Derive states with:

```verilog
assign error_warning = (tec >= 9'd96) || (rec >= 8'd96);
assign error_passive = (tec >= 9'd128) || (rec >= 8'd128);
assign bus_off = tec > 9'd255;
```

Drive six dominant bits when active or six recessive bits when passive. Require eight consecutive recessive delimiter bits; restart the delimiter count if dominant is sampled. Generate edge events only when entering Warning, Passive, or Bus-off.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] PROTOCOL_ERRORS` and `[PASS] ERROR_CONFINEMENT`.

```powershell
git add -- rtl/can/can_core.v rtl/can/apb_can.v rtl/sim/apb_can_tb.v
git commit -m "feat: implement CAN error flags and confinement"
```

## Task 8: Complete Bus-off, Modes, Thresholds, and Interrupts

**Files:**
- Modify: `rtl/can/can_core.v`
- Modify: `rtl/can/apb_can.v`
- Modify: `rtl/sim/apb_can_tb.v`

- [ ] **Step 1: Add state-transition and interrupt tests**

Run one transmitter without an ACK peer until TEC exceeds 255. Verify Bus-off keeps `can_tx=1`. Provide 127 complete groups plus 10 recessive bits and verify it remains Bus-off, then provide the final recessive bit and verify recovery. Insert a dominant bit inside a group and verify only that group's 11-bit counter resets. Also check Listen-only never ACKs or changes counters, loopback never drives the external bus, FIFO threshold interrupts trigger only on crossings, IRQ masking works, and W1C clears only requested bits. While a frame is active, request `ENABLE=0` and verify `RUNNING` clears only at the safe protocol boundary while the active frame remains available for re-enable. Attempt to change bit timing, filtering, and mode fields while running and verify the valid configuration is preserved with CONFIG_ERROR set.

- [ ] **Step 2: Run Icarus and verify recovery/interrupt checks fail**

Expected: the core shell or partial counter logic recovers at the wrong count, and one or more interrupt bits are missing.

- [ ] **Step 3: Implement remaining state and wrapper events**

In Bus-off, count consecutive sampled recessive bits to 11 and completed groups to 128. Clear TEC/REC and pulse `bus_recovered_event` only after the final group. In `apb_can`, implement all 16 approved IRQ bits as sticky event latches, with W1C followed by same-cycle event set priority so an arriving event cannot be lost:

```verilog
irq_status_reg <= irq_status_reg & ~irq_clear_mask;
if (rx_frame_accepted)
    irq_status_reg[0] <= 1'b1;
if (tx_done_event)
    irq_status_reg[1] <= 1'b1;
```

Implement separate armed/crossing state for RX and TX thresholds and exact `ERROR_STATUS` diagnostic fields.

- [ ] **Step 4: Run Icarus and commit**

Expected output includes `[PASS] BUS_OFF_RECOVERY`, `[PASS] MODES`, and `[PASS] INTERRUPTS` with every previous group still passing.

```powershell
git add -- rtl/can/can_core.v rtl/can/apb_can.v rtl/sim/apb_can_tb.v
git commit -m "feat: complete CAN modes recovery and interrupts"
```

## Task 9: Remove Obsolete RTL and Rewrite the Chinese Manual

**Files:**
- Delete: `rtl/can/can_top.v`
- Delete: `rtl/can/can_tx.v`
- Delete: `rtl/can/can_rx.v`
- Delete: `rtl/can/can_fifo.v`
- Replace: `rtl/can/apb_can_manual.md`

- [ ] **Step 1: Remove references to obsolete module names**

Delete the four replaced RTL files. Search the repository and require that retained source, tests, and the new manual do not instantiate or link them:

```powershell
rg -n "can_top|can_tx|can_rx|can_fifo|tb_apb_can" rtl -g "*.v" -g "*.md"
```

Expected: no matches referring to deleted modules; signal names such as `can_tx` and `can_rx` are allowed and must be inspected rather than mechanically removed.

- [ ] **Step 2: Rewrite `apb_can_manual.md` in Chinese**

Follow the UART manual's exact top-level organization:

```markdown
# APB CAN 中文编程手册
## 1. 模块概述
## 2. 参数与接口
## 3. APB 访问行为
## 4. 寄存器总表
## 5. 寄存器说明
## 6. 编程指导
## 7. 使用限制与检查清单
```

Document every field and reset value from the approved design. Include formulas for a 50 MHz/500 kbit/s 10-TQ configuration, complete polling TX/RX C pseudocode, code/mask examples, ISR ordering, error diagnostics, and Bus-off recovery observation. Explicitly explain that `interrupt` connects to the CPU and is not a transceiver pin.

- [ ] **Step 3: Run the complete Icarus regression**

Run the common command. Expected: all named test groups pass, final `APB CAN TEST PASS`, no timeout, exit code 0.

- [ ] **Step 4: Commit RTL cleanup and documentation**

```powershell
git add -- rtl/can/can_top.v rtl/can/can_tx.v rtl/can/can_rx.v rtl/can/can_fifo.v rtl/can/apb_can_manual.md rtl/sim/apb_can_tb.v rtl/sim/tb_apb_can.v
git commit -m "docs: publish APB CAN programming manual"
```

## Task 10: Final Verification and Temporary File Cleanup

**Files:**
- Verify: `rtl/can/apb_can.v`
- Verify: `rtl/can/can_core.v`
- Verify: `rtl/can/can_bit_timing.v`
- Verify: `rtl/can/can_crc.v`
- Verify: `rtl/sim/apb_can_tb.v`
- Delete if present: `tmp/apb_can_tb.vvp`
- Delete if present: `tmp/pdfs/axi_can_cover.png`

- [ ] **Step 1: Compile with warnings and run the full test**

```powershell
cmd /d /c "call C:\oss-cad-suite\environment.bat >nul && iverilog -g2005 -Wall -s apb_can_tb -o tmp\apb_can_tb.vvp rtl\misc\sync_fifo.v rtl\can\can_crc.v rtl\can\can_bit_timing.v rtl\can\can_core.v rtl\can\apb_can.v rtl\sim\apb_can_tb.v && vvp tmp\apb_can_tb.vvp"
```

Expected: compile and run exit 0, no actionable warning, every test group passes, and the final line is `APB CAN TEST PASS`.

- [ ] **Step 2: Check source hygiene and the scoped diff**

```powershell
git diff --check
rg -n "TODO|TBD|always @\(\*\)|\.sv\b" rtl/can rtl/sim/apb_can_tb.v rtl/can/apb_can_manual.md
git status --short
```

Expected: no whitespace errors, placeholders, SystemVerilog files, or `always @(*)` in the new CAN implementation. Existing unrelated dirty files remain untouched.

- [ ] **Step 3: Remove only generated temporary outputs**

Resolve and verify that both targets are under `D:\Software\simple_cpu\tmp`, then remove `tmp/apb_can_tb.vvp` and `tmp/pdfs/axi_can_cover.png` if present. Do not delete source, manuals, or existing project build files.

- [ ] **Step 4: Record the verification result**

Report the exact Icarus command, pass groups, lack of vks verification because no vks tools are available, and that Yosys synthesis was intentionally deferred at the user's request. Do not claim board or synthesis verification.
