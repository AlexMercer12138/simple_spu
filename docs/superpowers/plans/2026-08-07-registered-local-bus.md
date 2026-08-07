# Registered Local Bus Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the single-cycle request/ack local-bus integration, prevent repeated JTAG transactions, preserve CPU behavior, and verify 150 MHz timing plus block-RAM inference on an XC7A200T with 13-bit local memories.

**Architecture:** `merc32_core` emits registered one-cycle ILB, DLB, and PLB requests and waits for a one-cycle acknowledgement. `MERC32_top` carries the ILB/DLB acknowledgement ports, while `jtag_debug` converts each accepted debug transfer into one request pulse followed by an acknowledgement wait state. Repository simulations use synchronous memory models; a temporary Vivado wrapper connects the complete CPU top to two 8192x32 `spram` instances.

**Tech Stack:** Verilog-2005, Icarus Verilog, Node.js RTL regression runner, Vivado 2020.2, XC7A200T.

---

### Task 1: Add Request-Pulse and Synchronous-RAM Regression Coverage

**Files:**
- Create: `rtl/sim/spram_tb.v`
- Modify: `rtl/sim/jtag_debug_tb.v`
- Test: `rtl/sim/spram_tb.v`
- Test: `rtl/sim/jtag_debug_tb.v`

- [ ] **Step 1: Add a failing JTAG request-width check**

Add previous-cycle request state and pulse counters to `jtag_debug_tb.v`:

```verilog
reg dbg_request_d = 1'b0;
integer dbg_request_pulses = 0;

always @(posedge clk) begin
    dbg_request_d <= dbg_rden | dbg_wren;
    if ((dbg_rden | dbg_wren) && !dbg_request_d)
        dbg_request_pulses <= dbg_request_pulses + 1;
    if ((dbg_rden | dbg_wren) && dbg_request_d) begin
        failures <= failures + 1;
        $display("TEST FAIL: debug request wider than one clk cycle");
    end
end
```

Before a delayed read and write, save `dbg_request_pulses`; after the response,
check that the count increased by exactly one. Keep the existing delayed-ack and
TCK-stop cases so the pulse is tested independently of response latency.

- [ ] **Step 2: Run the JTAG test and verify RED**

Run:

```powershell
iverilog -Wall -g2005 -s jtag_debug_tb -o "$env:TEMP\jtag_debug_tb.vvp" rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v
vvp "$env:TEMP\jtag_debug_tb.vvp"
```

Expected: simulation reports `TEST FAIL: debug request wider than one clk cycle`
because `XFER_WAIT_ACK` currently holds `dbg_rden_clk` or `dbg_wren_clk` high.

- [ ] **Step 3: Create the independent synchronous RAM testbench**

Create `spram_tb.v` with `ADDR_WIDTH=4`, a 10 ns clock, synchronous reset-free
stimulus, and a watchdog. Drive every request for one cycle and check that `ack`
is high only on the following cycle:

```verilog
spram #(.ADDR_WIDTH(4), .INIT_FILE("")) spram_inst (
    .clk(clk), .wr(wr), .rd(rd), .be(be), .din(din),
    .dout(dout), .addr(addr), .ack(ack));

task write_word;
    input [3:0] address;
    input [3:0] byte_enable;
    input [31:0] data;
    begin
        @(negedge clk);
        addr <= address;
        be <= byte_enable;
        din <= data;
        wr <= 1'b1;
        @(negedge clk);
        wr <= 1'b0;
        if (ack !== 1'b1) fail("write ack missing");
        @(negedge clk);
        if (ack !== 1'b0) fail("write ack wider than one cycle");
    end
endtask
```

Add equivalent `read_word`, verify full-word writes, all four byte enables,
read-before-write behavior for a same-cycle read/write, and no acknowledgement
while idle. Finish with exactly one `TEST PASS: spram` marker.

- [ ] **Step 4: Compile and run the RAM test**

Run:

```powershell
iverilog -Wall -g2005 -s spram_tb -o "$env:TEMP\spram_tb.vvp" rtl/misc/spram.v rtl/sim/spram_tb.v
vvp "$env:TEMP\spram_tb.vvp"
```

Expected: `TEST PASS: spram` and no compiler warnings.

### Task 2: Emit One Debug Request Pulse Per JTAG Transfer

**Files:**
- Modify: `rtl/debug/jtag_debug.v:527-608`
- Test: `rtl/sim/jtag_debug_tb.v`

- [ ] **Step 1: Change the debug transfer FSM**

Keep request assertion in `XFER_VALIDATE`, but unconditionally clear both
request registers in `XFER_WAIT_ACK`:

```verilog
XFER_VALIDATE: begin
    dbg_rden_clk <= 1'b0;
    dbg_wren_clk <= 1'b0;
    xfer_response_addr_clk <= xfer_addr_clk;
    if (!dbg_halted ||
        (xfer_addr_clk[1:0] != 2'b00) ||
        ((xfer_op_clk != XFER_READ) && (xfer_op_clk != XFER_WRITE))) begin
        xfer_response_data_clk <= xfer_data_clk;
        xfer_response_status_clk <= RESP_FAILED;
        xfer_state_clk <= XFER_RESPOND;
    end else begin
        dbg_rden_clk <= xfer_op_clk == XFER_READ;
        dbg_wren_clk <= xfer_op_clk == XFER_WRITE;
        dbg_addr_clk <= xfer_addr_clk;
        dbg_wdata_clk <= xfer_data_clk;
        xfer_state_clk <= XFER_WAIT_ACK;
    end
end
XFER_WAIT_ACK: begin
    dbg_rden_clk <= 1'b0;
    dbg_wren_clk <= 1'b0;
    if (dbg_ack) begin
        xfer_response_data_clk <= xfer_op_clk == XFER_READ ?
                                  dbg_rdata : xfer_data_clk;
        xfer_response_status_clk <= RESP_SUCCESS;
        xfer_state_clk <= XFER_RESPOND;
    end
end
```

Do not add a timeout or retry; the protocol intentionally waits indefinitely
for user-provided hardware to return `ack`.

- [ ] **Step 2: Re-run JTAG verification and verify GREEN**

Run the Task 1 JTAG commands.

Expected: one `TEST PASS: jtag_debug` marker, no request-width failure, delayed
responses still complete, and TAP reset still cancels an outstanding transfer.

- [ ] **Step 3: Commit the JTAG protocol change and focused tests**

```powershell
git add -- rtl/debug/jtag_debug.v rtl/sim/jtag_debug_tb.v rtl/sim/spram_tb.v
git commit -m "fix: pulse JTAG debug bus requests"
```

Do not stage the user-owned `rtl/cpu/core.v`, `rtl/misc/spram.v`, or unrelated
`rtl/apb_sdio/` changes.

### Task 3: Integrate the Registered ILB/DLB Interface

**Files:**
- Modify: `rtl/cpu/MERC32_top.v:47-75,199-244`
- Modify: `rtl/sim/merc32_core_tb.v`
- Modify: `rtl/sim/MERC32_top_tb.v`
- Modify: `rtl/sim/tinyc_cpu_tb.v`
- Modify: `rtl/sim/tinyc_irq_tb.v`
- Modify: `rtl/sim/tinyc_uart_tb.v`
- Modify: `rtl/sim/tinyc_gpio_tb.v`
- Modify: `rtl/sim/tinyc_timer_tb.v`
- Modify: `rtl/sim/tinyc_i2c_tb.v`
- Test: all files above

- [ ] **Step 1: Update the top-level interface**

Replace the old enable/write pairs with explicit request and response signals:

```verilog
output                              dlb_rden,
output                              dlb_wren,
output      [DLB_ADDR_WIDTH-1:0]    dlb_addr,
output      [3:0]                   dlb_strb,
output      [31:0]                  dlb_wdata,
input       [31:0]                  dlb_rdata,
input                               dlb_ack,

output                              ilb_rden,
output                              ilb_wren,
output      [ILB_ADDR_WIDTH-1:0]    ilb_addr,
output      [3:0]                   ilb_strb,
output      [31:0]                  ilb_wdata,
input       [31:0]                  ilb_rdata,
input                               ilb_ack
```

Connect these names directly to the corresponding `merc32_core` ports. Update
the instantiation template at the beginning of the file as well.

- [ ] **Step 2: Convert direct-core testbenches to synchronous handshakes**

In `merc32_core_tb.v`, `tinyc_cpu_tb.v`, and `tinyc_irq_tb.v`, use separate
`rden`, `wren`, and registered `ack` signals. Convert instruction data from a
combinational wire to a registered response:

```verilog
always @(posedge clk) begin
    ilb_ack <= ilb_rden | ilb_wren;
    if (ilb_rden)
        ilb_rdata <= program_rom[ilb_addr];

    dlb_ack <= dlb_rden | dlb_wren;
    if (dlb_wren) begin
        if (dlb_strb[0]) dlb_ram[dlb_addr][7:0] <= dlb_wdata[7:0];
        if (dlb_strb[1]) dlb_ram[dlb_addr][15:8] <= dlb_wdata[15:8];
        if (dlb_strb[2]) dlb_ram[dlb_addr][23:16] <= dlb_wdata[23:16];
        if (dlb_strb[3]) dlb_ram[dlb_addr][31:24] <= dlb_wdata[31:24];
    end
    if (dlb_rden)
        dlb_rdata <= dlb_ram[dlb_addr];
end
```

Initialize acknowledgement registers to zero and reset them to zero. Add
previous-cycle request registers and fail if either ILB or DLB request remains
high for two consecutive clocks.

- [ ] **Step 3: Convert full-top testbenches to the same protocol**

Apply the explicit top-level port mapping and synchronous memory response model
to `MERC32_top_tb.v`, `tinyc_uart_tb.v`, `tinyc_gpio_tb.v`, `tinyc_timer_tb.v`,
and `tinyc_i2c_tb.v`. Replace every status monitor condition of the form
`dlb_en && dlb_we` with `dlb_wren`; retain all existing `dlb_strb` checks.

- [ ] **Step 4: Compile the independent CPU integration tests**

Run:

```powershell
iverilog -Wall -g2005 -s merc32_core_tb -o "$env:TEMP\merc32_core_tb.vvp" rtl/misc/mul.v rtl/misc/div.v rtl/cpu/core.v rtl/sim/merc32_core_tb.v
vvp "$env:TEMP\merc32_core_tb.vvp"

iverilog -Wall -g2005 -s MERC32_top_tb -o "$env:TEMP\MERC32_top_tb.vvp" rtl/misc/mul.v rtl/misc/div.v rtl/debug/jtag_debug.v rtl/bridge/lb2apb.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/MERC32_top_tb.v
vvp "$env:TEMP\MERC32_top_tb.vvp"
```

Expected: both testbenches print one `TEST PASS` marker and no request pulse is
wider than one clock.

- [ ] **Step 5: Commit the top-level interface and testbench integration**

```powershell
git add -- rtl/cpu/MERC32_top.v rtl/sim/merc32_core_tb.v rtl/sim/MERC32_top_tb.v rtl/sim/tinyc_cpu_tb.v rtl/sim/tinyc_irq_tb.v rtl/sim/tinyc_uart_tb.v rtl/sim/tinyc_gpio_tb.v rtl/sim/tinyc_timer_tb.v rtl/sim/tinyc_i2c_tb.v
git commit -m "test: integrate registered local memory buses"
```

Again, leave the user's `core.v`, `spram.v`, and `apb_sdio` work unstaged.

### Task 4: Run the Complete RTL Regression

**Files:**
- Verify: `rtl/cpu/core.v`
- Verify: `rtl/cpu/MERC32_top.v`
- Verify: `rtl/debug/jtag_debug.v`
- Verify: `rtl/misc/spram.v`
- Verify: `rtl/sim/*.v`

- [ ] **Step 1: Run the Tiny C firmware suite**

Run:

```powershell
Set-Location merc32-vsce
npm run test:c:rtl
```

Expected: exactly six `TEST PASS` markers for CPU, UART, GPIO, timer, I2C, and
interrupt firmware, followed by `MERC32 Tiny C RTL suite passed (6 tests)`.

- [ ] **Step 2: Run compiler and assembler tests**

Run:

```powershell
npm test
```

Expected: pseudo-instruction and Tiny C integration tests pass.

- [ ] **Step 3: Re-run the RAM, JTAG, core, and top tests**

Run all commands from Tasks 1 and 3 again from the repository root.

Expected: every test produces one `TEST PASS` marker, with no `TEST FAIL`,
`TEST TIMEOUT`, compiler error, or warning.

- [ ] **Step 4: Check repository integrity**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors; only the intended user RTL, bus integration,
testbench, and unrelated pre-existing `rtl/apb_sdio/` paths are listed.

### Task 5: Implement and Time the 13-Bit Full-SoC Vivado Harness

**Files:**
- Create temporarily: `.vivado_bus_check/merc32_vivado_top.v`
- Create temporarily: `.vivado_bus_check/merc32_vivado_top.xdc`
- Create temporarily: `.vivado_bus_check/run.tcl`
- Verify: `rtl/cpu/MERC32_top.v`
- Verify: `rtl/cpu/core.v`
- Verify: `rtl/debug/jtag_debug.v`
- Verify: `rtl/bridge/lb2apb.v`
- Verify: `rtl/misc/mul.v`
- Verify: `rtl/misc/div.v`
- Verify: `rtl/misc/spram.v`

- [ ] **Step 1: Create the temporary full-SoC wrapper**

The wrapper must expose `clk`, `rst_n`, interrupt, JTAG, and APB ports, instantiate
`MERC32_top` with both address widths set to 13, and connect two RAMs:

```verilog
(* KEEP_HIERARCHY = "yes" *)
module merc32_vivado_top (
    input clk, input rst_n, input interrupt,
    input tck, input tms, input tdi, output tdo,
    output m_apb_psel, output m_apb_penable,
    output [31:0] m_apb_paddr, output m_apb_pwrite,
    output [3:0] m_apb_pstrb, output [31:0] m_apb_pwdata,
    input [31:0] m_apb_prdata, input m_apb_pready
);
localparam ADDR_WIDTH = 13;
wire ilb_rden, ilb_wren, ilb_ack;
wire dlb_rden, dlb_wren, dlb_ack;
wire [ADDR_WIDTH-1:0] ilb_addr, dlb_addr;
wire [3:0] ilb_strb, dlb_strb;
wire [31:0] ilb_wdata, ilb_rdata, dlb_wdata, dlb_rdata;

MERC32_top #(.ILB_ADDR_WIDTH(ADDR_WIDTH), .DLB_ADDR_WIDTH(ADDR_WIDTH))
MERC32_top_inst (
    .clk(clk), .rst_n(rst_n), .interrupt(interrupt),
    .tck(tck), .tms(tms), .tdi(tdi), .tdo(tdo),
    .dlb_rden(dlb_rden), .dlb_wren(dlb_wren),
    .dlb_addr(dlb_addr), .dlb_strb(dlb_strb),
    .dlb_wdata(dlb_wdata), .dlb_rdata(dlb_rdata), .dlb_ack(dlb_ack),
    .ilb_rden(ilb_rden), .ilb_wren(ilb_wren),
    .ilb_addr(ilb_addr), .ilb_strb(ilb_strb),
    .ilb_wdata(ilb_wdata), .ilb_rdata(ilb_rdata), .ilb_ack(ilb_ack),
    .m_apb_psel(m_apb_psel), .m_apb_penable(m_apb_penable),
    .m_apb_paddr(m_apb_paddr), .m_apb_pwrite(m_apb_pwrite),
    .m_apb_pstrb(m_apb_pstrb), .m_apb_pwdata(m_apb_pwdata),
    .m_apb_prdata(m_apb_prdata), .m_apb_pready(m_apb_pready));

(* DONT_TOUCH = "yes" *)
spram #(.ADDR_WIDTH(ADDR_WIDTH), .INIT_FILE("")) ilb_ram_inst (
    .clk(clk), .wr(ilb_wren), .rd(ilb_rden), .be(ilb_strb),
    .din(ilb_wdata), .dout(ilb_rdata), .addr(ilb_addr), .ack(ilb_ack));

(* DONT_TOUCH = "yes" *)
spram #(.ADDR_WIDTH(ADDR_WIDTH), .INIT_FILE("")) dlb_ram_inst (
    .clk(clk), .wr(dlb_wren), .rd(dlb_rden), .be(dlb_strb),
    .din(dlb_wdata), .dout(dlb_rdata), .addr(dlb_addr), .ack(dlb_ack));
endmodule
```

Use the complete named port mappings shown above rather than `.*`.

- [ ] **Step 2: Create timing constraints**

Use a 6.666 ns main clock, a conservative 100 ns JTAG clock, and declare the
two domains asynchronous:

```tcl
create_clock -name clk -period 6.666 [get_ports clk]
create_clock -name tck -period 100.000 [get_ports tck]
set_clock_groups -asynchronous -group [get_clocks clk] -group [get_clocks tck]
```

- [ ] **Step 3: Create and run the non-project Vivado flow**

The Tcl script must use part `xc7a200tfbg484-2`, read only the seven required
RTL files plus the temporary wrapper, then run:

```tcl
synth_design -top merc32_vivado_top -part xc7a200tfbg484-2
opt_design
place_design
phys_opt_design
route_design
report_utilization -hierarchical -file utilization.rpt
report_timing_summary -delay_type max -max_paths 20 -file timing_summary.rpt
report_methodology -file methodology.rpt
set worst_path [get_timing_paths -delay_type max -max_paths 1]
puts "RESULT_WNS [get_property SLACK $worst_path]"
puts "RESULT_BRAM36 [llength [get_cells -hier -filter {REF_NAME == RAMB36E1}]]"
puts "RESULT_BRAM18 [llength [get_cells -hier -filter {REF_NAME == RAMB18E1}]]"
```

Run:

```powershell
vivado -mode batch -nolog -nojournal -source .vivado_bus_check/run.tcl
```

Expected: synthesis, placement, and routing complete without errors; WNS is at
least 0.000 ns; RAMB18/RAMB36 counts are nonzero and hierarchical utilization
shows both ILB and DLB arrays implemented as block RAM.

- [ ] **Step 4: Inspect reports and clean temporary files**

Read the timing summary, utilization, methodology, and Vivado console output.
Record the exact WNS, achieved frequency estimate, failing path endpoints if
WNS is negative, BRAM primitive counts, LUT/FF counts, and critical warnings.
Then remove only the verified absolute directory
`D:\Software\simple_cpu\.vivado_bus_check` and confirm that it no longer exists.

Do not modify CPU RTL merely to force timing closure during this measurement;
if 150 MHz fails, report the routed critical path for a separate optimization.
