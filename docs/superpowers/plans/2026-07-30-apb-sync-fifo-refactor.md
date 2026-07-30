# APB Synchronous FIFO Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the private APB I2C and UART FIFO arrays with the current byte-wide synchronous `sync_fifo`, and expose single-byte UART/APB FIFO transactions with the approved registered-read semantics.

**Architecture:** Each APB peripheral owns independent 8-bit TX and RX `sync_fifo` instances. I2C protocol engines request TX reads and consume `dout` on the following cycle; UART uses the same demand-read sequence. APB RX reads return the prior registered `dout`, so software performs one discarded priming read followed by the saved FIFO level number of data reads.

**Tech Stack:** Verilog-2005, 32-bit APB, synchronous active-low reset, Icarus Verilog, ModelSim.

**Execution:** Run inline in the current session on `main`, as explicitly requested. Preserve unrelated dirty-worktree files and stage only paths named by each task.

---

## File Structure

- `rtl/misc/sync_fifo.v`: user-provided synchronous FIFO implementation; preserve its current logic and commit it as the shared dependency.
- `rtl/sim/sync_fifo_tb.v`: new independent characterization test for registered reads and full/empty behavior.
- `rtl/i2c/i2c_master_lite.v`: replace TX ready/valid with synchronous FIFO request/latch states.
- `rtl/sim/i2c_master_lite_tb.v`: drive the master through a real `sync_fifo` and verify first-byte ordering.
- `rtl/i2c/i2c_slave.v`: fetch slave TX bytes through synchronous FIFO timing while stretching SCL.
- `rtl/sim/i2c_slave_tb.v`: drive the slave through a real `sync_fifo` and distinguish normal fetch stretch from underflow.
- `rtl/i2c/apb_i2c.v`: instantiate TX/RX FIFOs, route core FIFO ports, and implement dummy-first APB RX reads.
- `rtl/sim/apb_i2c_tb.v`: update unit and two-controller integration expectations for the new FIFO timing.
- `rtl/i2c/apb_i2c_manual.md`: document supported depths, registered RX reads, and full-FIFO simultaneous access behavior.
- `rtl/uart/apb_uart.v`: replace grouped buffers and private FIFO arrays with single-byte synchronous FIFOs and the approved control/status definitions.
- `rtl/sim/apb_uart_tb.v`: new correctly named UART regression using single-byte FIFO accesses.
- `rtl/sim/tb_apb_uart.v`: remove after its user-enabled VCD and timeout behavior have been preserved in `apb_uart_tb.v`.

Generated simulator outputs go under `build/apb_sync_fifo/` and are removed after the final regression.

### Task 1: Characterize and Adopt the Shared `sync_fifo`

**Files:**
- Preserve and stage: `rtl/misc/sync_fifo.v`
- Create: `rtl/sim/sync_fifo_tb.v`

- [x] **Step 1: Write the independent FIFO characterization test**

Create a Verilog-2005 self-checking test with `FIFO_DEPTH=8`. The test shall prove that `dout` changes only after an accepted `rd_en`, FIFO order is preserved, an empty read does not change the level, and a full simultaneous read/write rejects the write while accepting the read.

Use this exact read sequence in the test:

```verilog
task fifo_read;
    input [7:0] expected;
    begin
        @(negedge clk);
        rd_en <= 1'b1;
        @(posedge clk);
        #1;
        rd_en <= 1'b0;
        check_equal("registered FIFO read", {24'd0, dout},
                    {24'd0, expected});
    end
endtask
```

For the full simultaneous case, fill all eight entries, assert both enables for one clock, then require `data_cnt==7` and require the attempted replacement byte not to appear while draining.

- [x] **Step 2: Run the characterization test**

Run:

```powershell
New-Item -ItemType Directory -Force build\apb_sync_fifo | Out-Null
iverilog -g2005 -s sync_fifo_tb -o build\apb_sync_fifo\sync_fifo_tb.vvp rtl\misc\sync_fifo.v rtl\sim\sync_fifo_tb.v
vvp build\apb_sync_fifo\sync_fifo_tb.vvp
```

Expected: `TEST PASS`. This is a characterization of user-provided production code, not a new behavior test, so it is expected to pass immediately.

- [x] **Step 3: Verify that the shared FIFO was not rewritten**

Run:

```powershell
git diff --check -- rtl/misc/sync_fifo.v rtl/sim/sync_fifo_tb.v
git diff -- rtl/misc/sync_fifo.v
```

Expected: the `sync_fifo.v` diff is exactly the user's width-converter-to-simple-FIFO change already present before this task; no additional timing or interface change is introduced.

- [x] **Step 4: Commit the shared FIFO baseline**

```powershell
git add -- rtl/misc/sync_fifo.v rtl/sim/sync_fifo_tb.v
git commit -m "refactor: adopt byte-wide synchronous FIFO"
```

### Task 2: Convert the I2C Master TX Interface

**Files:**
- Modify: `rtl/sim/i2c_master_lite_tb.v:1`
- Modify: `rtl/i2c/i2c_master_lite.v:6`

- [x] **Step 1: Replace the testbench TX source with a real FIFO**

Remove `tx_valid`, `tx_ready`, and the same-cycle `tx_memory` driver. Connect the desired interface and instantiate the dependency:

```verilog
reg         tx_fifo_wr_en = 1'b0;
reg  [7:0]  tx_fifo_din = 8'd0;
wire [7:0]  tx_fifo_dout;
wire        tx_fifo_rd_en;
wire        tx_fifo_empty;
wire        tx_fifo_full;
wire [3:0]  tx_fifo_count;

sync_fifo #(
    .DATA_WIDTH (8),
    .FIFO_DEPTH (8)
) tx_fifo_inst (
    .clk      (clk),
    .rst_n    (rst_n),
    .wr_en    (tx_fifo_wr_en),
    .din      (tx_fifo_din),
    .rd_en    (tx_fifo_rd_en),
    .dout     (tx_fifo_dout),
    .empty    (tx_fifo_empty),
    .full     (tx_fifo_full),
    .data_cnt (tx_fifo_count)
);
```

Connect `tx_data`, `tx_empty`, and `tx_rd_en` on the DUT. Add a `fifo_push` task and preload bytes before every write or write-read command. Record the cycle of each `tx_fifo_rd_en` and assert that the data byte is consumed from `dout` on the next cycle. Keep all existing protocol, timeout, arbitration, NACK, abort, RESTART, and SCL timing checks.

- [x] **Step 2: Run the new master test and verify RED**

Run:

```powershell
iverilog -g2005 -s i2c_master_lite_tb -o build\apb_sync_fifo\i2c_master_lite_tb.vvp rtl\misc\sync_fifo.v rtl\i2c\i2c_master_lite.v rtl\sim\i2c_master_lite_tb.v
```

Expected: compile failure reporting that the old master has no `tx_empty` or `tx_rd_en` ports. The failure must be interface-related, not a testbench syntax error.

- [x] **Step 3: Implement the synchronous master fetch states**

Change the TX ports to:

```verilog
input   wire [7:0]  tx_data,
input   wire        tx_empty,
output  wire        tx_rd_en,
```

Add one state and a combinational FIFO request:

```verilog
localparam ST_LATCH_TX   = 5'd14;

assign tx_rd_en = enable && (state == ST_LOAD_TX) && !tx_empty;
```

Replace `ST_LOAD_TX` and add the latch state:

```verilog
ST_LOAD_TX: begin
    scl_t <= 1'b0;
    if (abort_pending) begin
        phase <= 2'd0;
        state <= ST_STOP;
    end else if (!tx_empty) begin
        state <= ST_LATCH_TX;
    end
end

ST_LATCH_TX: begin
    shift_reg <= tx_data;
    bit_index <= 3'd7;
    address_byte <= 1'b0;
    phase <= 2'd0;
    state <= ST_SEND_BIT;
end
```

Remove all assignments to `tx_ready`. Do not alter the master RX ready/valid path.

- [x] **Step 4: Run the master test and verify GREEN**

```powershell
iverilog -g2005 -s i2c_master_lite_tb -o build\apb_sync_fifo\i2c_master_lite_tb.vvp rtl\misc\sync_fifo.v rtl\i2c\i2c_master_lite.v rtl\sim\i2c_master_lite_tb.v
vvp build\apb_sync_fifo\i2c_master_lite_tb.vvp
```

Expected: `TEST PASS`, including correct first TX byte, direct read, RESTART write-read, NACK, arbitration, timeout, abort, and SCL period checks.

- [x] **Step 5: Commit the master interface**

```powershell
git add -- rtl/i2c/i2c_master_lite.v rtl/sim/i2c_master_lite_tb.v
git commit -m "refactor: use synchronous FIFO reads in I2C master"
```

### Task 3: Convert the I2C Slave TX Interface

**Files:**
- Modify: `rtl/sim/i2c_slave_tb.v:1`
- Modify: `rtl/i2c/i2c_slave.v:6`

- [x] **Step 1: Drive the slave with a real synchronous FIFO**

Replace the ready/valid TX model with an 8-entry `sync_fifo`, using the same signal layout as Task 2. Refill tests shall call a `fifo_push` task rather than changing `tx_valid`.

Add assertions with these required outcomes:

```verilog
check_equal("preloaded fetch stretches", stretch_observed_low, 1);
check_equal("preloaded fetch no underflow", underflow_seen, 0);
check_equal("empty refill underflow", underflow_seen, 1);
check_equal("empty refill data", transmitted[0], 8'hC7);
```

Keep the address mismatch, raw RX, RESTART, RX overflow, address timeout, and mid-read `8'hFF` tests.

- [x] **Step 2: Run the new slave test and verify RED**

```powershell
iverilog -g2005 -s i2c_slave_tb -o build\apb_sync_fifo\i2c_slave_tb.vvp rtl\misc\sync_fifo.v rtl\i2c\i2c_slave.v rtl\sim\i2c_slave_tb.v
```

Expected: compile failure because the old slave lacks `tx_empty` and `tx_rd_en`.

- [x] **Step 3: Implement slave fetch and latch states**

Change the TX ports to the FIFO interface and add:

```verilog
localparam ST_TX_LATCH    = 4'd9;

assign tx_rd_en = enable && (state == ST_TX_WAIT) && !tx_empty;
```

All slave-read byte requests enter `ST_TX_WAIT` with SCL held low. Set
`tx_underflow` only when `tx_empty` is true at the byte request. In
`ST_TX_WAIT`, timeout counting runs only while `tx_empty` remains true. A
nonempty FIFO transitions to `ST_TX_LATCH`; on the next clock load the existing
shift register directly from `tx_data`:

```verilog
ST_TX_LATCH: begin
    shift_reg <= tx_data;
    tx_loaded <= 1'b1;
    bit_count <= 4'd7;
    stretch_count <= 32'd0;
    if (wait_address_ack) begin
        scl_t <= 1'b0;
        sda_t <= 1'b0;
        state <= ST_ADDR_RELEASE;
    end else begin
        stretch_active <= 1'b0;
        scl_t <= 1'b1;
        sda_t <= tx_data[7];
        state <= ST_TX_BYTE;
    end
end
```

Preserve address-stage NACK timeout and mid-read fallback behavior. Remove all
`tx_valid` and `tx_ready` logic.

- [x] **Step 4: Run the slave test and verify GREEN**

```powershell
iverilog -g2005 -s i2c_slave_tb -o build\apb_sync_fifo\i2c_slave_tb.vvp rtl\misc\sync_fifo.v rtl\i2c\i2c_slave.v rtl\sim\i2c_slave_tb.v
vvp build\apb_sync_fifo\i2c_slave_tb.vvp
```

Expected: `TEST PASS`; preloaded bytes cause only routine fetch stretch, while an empty request alone sets underflow and starts the programmable timeout.

- [x] **Step 5: Commit the slave interface**

```powershell
git add -- rtl/i2c/i2c_slave.v rtl/sim/i2c_slave_tb.v
git commit -m "refactor: use synchronous FIFO reads in I2C slave"
```

### Task 4: Replace `apb_i2c` Private FIFOs

**Files:**
- Modify: `rtl/sim/apb_i2c_tb.v:1`
- Modify: `rtl/i2c/apb_i2c.v:1`
- Modify: `rtl/i2c/apb_i2c_manual.md:1`

- [x] **Step 1: Update APB I2C tests for the approved FIFO contract**

Set the unit-test FIFO depth to 8. Replace direct private-array checks with
instance outputs and update RX helpers for the dummy-first sequence:

```verilog
task apb_drain_rx_byte;
    output [31:0] data;
    reg [31:0] discarded;
    begin
        apb_read(ADDR_RX_DATA, discarded);
        apb_read(ADDR_RX_DATA, data);
    end
endtask
```

For multi-byte drains, issue one priming read and then one read per saved level,
not one priming read per byte. Change simultaneous-full expectations:

- Full TX pop plus APB push produces level `FIFO_DEPTH-1`, drops the new byte,
  and sets `CMD_ERROR`.
- Full RX APB pop plus forced core push produces level `FIFO_DEPTH-1` and drops
  the forced replacement byte.

Keep all command validation, mode switch, soft reset, IRQ, error, timeout,
abort, 1-byte and 16-byte master/slave integration, and RESTART scenarios.
Because the unit FIFO depth changes from 4 to 8, change the above-depth command
case from length 5 to length 9 and preload all eight legal entries before that
rejection check.

- [x] **Step 2: Run APB I2C test and verify RED**

```powershell
iverilog -g2005 -s apb_i2c_tb -o build\apb_sync_fifo\apb_i2c_tb.vvp rtl\misc\sync_fifo.v rtl\i2c\i2c_master_lite.v rtl\i2c\i2c_slave.v rtl\i2c\apb_i2c.v rtl\sim\apb_i2c_tb.v
```

Expected: compile failure at the old ready/valid I2C core connections or failed
dummy-first FIFO assertions. Confirm the failure is caused by the missing APB
FIFO refactor.

- [x] **Step 3: Instantiate TX and RX `sync_fifo` modules**

Delete private RAM arrays, pointers, and count-update blocks. Add separate FIFO
resets and instances:

```verilog
assign tx_fifo_rst_n = rst_n && !soft_reset_write &&
                       !mode_change_accepted && !tx_clear_accepted;
assign rx_fifo_rst_n = rst_n && !soft_reset_write &&
                       !mode_change_accepted && !rx_clear_accepted;

sync_fifo #(
    .DATA_WIDTH (8),
    .FIFO_DEPTH (FIFO_DEPTH)
) tx_fifo_inst (
    .clk      (clk),
    .rst_n    (tx_fifo_rst_n),
    .wr_en    (tx_apb_push),
    .din      (s_apb_pwdata[7:0]),
    .rd_en    (tx_fifo_rd_en),
    .dout     (tx_fifo_data),
    .empty    (tx_empty),
    .full     (tx_full),
    .data_cnt (tx_fifo_count)
);
```

Instantiate RX identically with core data on `din`, core valid on `wr_en`, and
the completed APB RX read on `rd_en`. Select `tx_fifo_rd_en` from the active
master or slave core. Connect each core's new `tx_empty/tx_rd_en/tx_data` ports.

- [x] **Step 4: Implement registered APB RX reads**

Track only output validity:

```verilog
always @(posedge clk) begin
    if (!rx_fifo_rst_n)
        rx_read_valid <= 1'b0;
    else if (rx_apb_pop)
        rx_read_valid <= 1'b1;
end
```

The read mux uses current `dout` during APB setup:

```verilog
10'd5: apb_prdata <= rx_read_valid ?
                     {24'd0, rx_fifo_data} : 32'd0;
```

`rx_apb_pop` asserts only at APB transfer completion and only when nonempty.
Derive levels and command validation directly from `data_cnt`. Do not restore
the old full pop-and-replace exception.

- [x] **Step 5: Run APB I2C test and verify GREEN**

```powershell
iverilog -g2005 -s apb_i2c_tb -o build\apb_sync_fifo\apb_i2c_tb.vvp rtl\misc\sync_fifo.v rtl\i2c\i2c_master_lite.v rtl\i2c\i2c_slave.v rtl\i2c\apb_i2c.v rtl\sim\apb_i2c_tb.v
vvp build\apb_sync_fifo\apb_i2c_tb.vvp
```

Expected: `TEST PASS` for register/FIFO unit checks and all two-controller
master, slave, error, IRQ, and RESTART integration tests.

- [x] **Step 6: Update the I2C programming guide**

In `apb_i2c_manual.md`, change supported FIFO depths to `8/16/32/64/128`,
replace the old same-cycle replacement guarantee with current `sync_fifo`
behavior, and document the exact `N+1` RX read loop:

```text
N = FIFO_STATUS.RX_LEVEL
discard read(RX_DATA)
repeat N times: consume read(RX_DATA)
```

- [x] **Step 7: Commit the APB I2C integration**

```powershell
git add -- rtl/i2c/apb_i2c.v rtl/sim/apb_i2c_tb.v rtl/i2c/apb_i2c_manual.md
git commit -m "refactor: use shared FIFOs in APB I2C"
```

### Task 5: Redesign UART Data Transfers Around Byte FIFOs

**Files:**
- Create: `rtl/sim/apb_uart_tb.v`
- Modify: `rtl/uart/apb_uart.v:1`
- Delete after migration: `rtl/sim/tb_apb_uart.v`

- [x] **Step 1: Write the new UART APB test before changing RTL**

Create `apb_uart_tb.v` with the approved offsets and fields:

```verilog
localparam CTRL_RX_EN  = 32'h0000_0001;
localparam CTRL_TX_EN  = 32'h0000_0002;
localparam CTRL_RX_CLR = 32'h0000_0004;
localparam CTRL_TX_CLR = 32'h0000_0008;
localparam CTRL_RESET  = 32'h8000_0000;
```

Required tests:

1. Reset values and CONFIG readback.
2. TX disabled: byte writes increase TX level and do not drive a frame.
3. TX enabled: queued low-byte values transmit in FIFO order.
4. RX disabled: looped-back frames do not enter RX FIFO.
5. RX enabled: save `RX_LEVEL`, perform one discarded `RX_DATA` read, then
   consume exactly that many bytes in order.
6. Independent RX/TX clear pulses and readback of only enable bits.
7. Eight writes fill TX; the ninth write is ignored.
8. `RX_STATUS` and `TX_STATUS` level, empty, full, and busy bits.
9. Existing no-parity, odd/even parity, and two-stop-bit loopback modes.
10. Interrupt selections for RX nonempty, TX not full, RX `>=` threshold, and
    TX `<=` threshold.
11. Soft reset clears both FIFOs and drives TX idle.

Preserve the user's explicit timeout block and enabled VCD block from
`tb_apb_uart.v` in the new file.

- [x] **Step 2: Run the new UART test and verify RED**

```powershell
iverilog -g2005 -s apb_uart_tb -o build\apb_sync_fifo\apb_uart_tb.vvp rtl\misc\sync_fifo.v rtl\uart\apb_uart.v rtl\sim\apb_uart_tb.v
vvp build\apb_sync_fifo\apb_uart_tb.vvp
```

Expected: `TEST FAIL` because the old UART still expects grouped 32-bit buffers
and start/count control pulses. If the test instead has a syntax error, fix the
test until it runs and fails on behavior.

- [x] **Step 3: Replace UART register and FIFO control**

Keep APB registered-ready behavior and CONFIG fields. Define control from
stored enable bits plus write pulses:

```verilog
assign rx_enable = uart_ctrl[0];
assign tx_enable = uart_ctrl[1];
assign rx_clear_write = slv_reg_wren && (opt_addr == 0) && s_apb_pwdata[2];
assign tx_clear_write = slv_reg_wren && (opt_addr == 0) && s_apb_pwdata[3];
assign soft_reset_write = slv_reg_wren && (opt_addr == 0) && s_apb_pwdata[31];
```

On CTRL writes, store only `PWDATA[1:0]`. Instantiate byte-wide RX and TX
`sync_fifo` modules. Build status reads directly:

```verilog
2: apb_prdata <= rx_read_valid ? {24'd0, rx_fifo_data} : 32'd0;
3: apb_prdata <= {21'd0, rx_busy, rx_full, rx_empty, rx_level};
5: apb_prdata <= {21'd0, tx_busy_status, tx_full, tx_empty, tx_level};
```

Writing address 4 pushes `PWDATA[7:0]` only when TX is not full. Reading address
2 triggers one RX `rd_en` at APB completion only when RX is nonempty.

- [x] **Step 4: Convert the UART transmitter to demand-read timing**

Use one metadata flag and the FIFO output register, with no data prefetch
register:

```verilog
assign tx_fifo_rd_en = tx_enable && !tx_busy &&
                       !tx_load_pending && !tx_empty;

always @(posedge s_apb_pclk) begin
    if (!s_apb_presetn || soft_reset_write || tx_clear_write)
        tx_load_pending <= 1'b0;
    else
        tx_load_pending <= tx_fifo_rd_en;
end
```

When `tx_load_pending` is observed on the following clock, load `tx_ff` and its
parity from `tx_fifo_data`, initialize bit counters, and set `tx_busy`. TX disable
blocks new FIFO requests but does not abort an active frame.

- [x] **Step 5: Convert the UART receiver to direct FIFO writes**

Reset receiver protocol state when RX is disabled, without clearing the RX
FIFO. Make the completed valid-byte indication a one-clock pulse and connect:

```verilog
assign rx_fifo_wr_en = uart_rx_valid && !rx_full;
assign rx_fifo_din = uart_rx_data;
```

If full, drop the completed byte. Do not add an overflow register or interrupt.

- [x] **Step 6: Adapt existing interrupt encoding**

Retain the enable, source selector, sticky observed flag, and threshold fields.
Use:

```verilog
case (uart_interrupt[2:1])
    2'd0: interrupt <= !rx_empty;
    2'd1: interrupt <= !tx_full;
    2'd2: interrupt <= rx_fifo_count >= uart_interrupt[23:16];
    2'd3: interrupt <= tx_fifo_count <= uart_interrupt[31:24];
endcase
```

Keep `PSLVERR` low and preserve invalid-read behavior.

- [x] **Step 7: Run UART test and verify GREEN**

```powershell
iverilog -g2005 -s apb_uart_tb -o build\apb_sync_fifo\apb_uart_tb.vvp rtl\misc\sync_fifo.v rtl\uart\apb_uart.v rtl\sim\apb_uart_tb.v
vvp build\apb_sync_fifo\apb_uart_tb.vvp
```

Expected: `TEST PASS` for control, FIFO timing, loopback framing modes,
interrupts, clears, and soft reset.

- [x] **Step 8: Remove the obsolete grouped-buffer test and commit**

Delete `rtl/sim/tb_apb_uart.v` only after confirming its user-enabled VCD and
timeout behavior are present in `apb_uart_tb.v`.

```powershell
git add -- rtl/uart/apb_uart.v rtl/sim/apb_uart_tb.v rtl/sim/tb_apb_uart.v
git commit -m "refactor: use byte FIFOs in APB UART"
```

### Task 6: Cross-Simulator Regression and Cleanup

**Files:**
- Verify: all files changed in Tasks 1 through 5
- Remove generated outputs only: `build/apb_sync_fifo/`

- [x] **Step 1: Confirm vks availability**

Check the active tool list for `vks_lint`, `vks_compile`, and `vks_simulate`.
The current session exposes none, so record that no vks run is possible unless
the tools become available before this step. This is an environment limitation,
not a passing vks result.

- [x] **Step 2: Run the complete Icarus regression from fresh outputs**

Compile and run these top modules with `-g2005`:

```text
sync_fifo_tb
i2c_master_lite_tb
i2c_slave_tb
apb_i2c_tb
apb_uart_tb
```

Use exactly the dependency lists from Tasks 1 through 5. Expected for every
test: `TEST PASS`, no `TEST FAIL`, no `TEST TIMEOUT`, and zero compile errors.

- [x] **Step 3: Run the same five tests with ModelSim**

Create an isolated library:

```powershell
vlib build\apb_sync_fifo\modelsim_work
```

For each test, compile its Verilog-2005 dependency list with:

```powershell
vlog -work build\apb_sync_fifo\modelsim_work -vlog01compat <dependency files>
vsim -c -lib build\apb_sync_fifo\modelsim_work <top_module> -do "run -all; quit -f"
```

Expected: five `TEST PASS` results and zero ModelSim errors. Review warnings;
there must be no new warning attributable to the changed RTL or tests.

- [x] **Step 4: Review diffs and repository state**

```powershell
git diff --check
git status --short
git log -7 --oneline
```

Confirm that unrelated pre-existing dirty files are still present and were
never staged in these commits. Confirm `rtl/misc/sync_fifo.v` contains the
user's simple synchronous FIFO and was not changed into FWFT behavior.

- [ ] **Step 5: Clean generated outputs**

Resolve `build/apb_sync_fifo` to its absolute path under
`D:\Software\simple_cpu`, verify that boundary, then remove only that generated
directory. Do not remove existing user build outputs elsewhere.

- [x] **Step 6: Final completion report**

Report changed files, register behavior, FIFO read sequence, Icarus and
ModelSim commands/results, the absence of vks tools, any simulator warnings,
skipped system-level CPU firmware changes, and the retained unrelated
worktree modifications.
