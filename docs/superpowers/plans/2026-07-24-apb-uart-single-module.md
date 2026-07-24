# APB UART Single-Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained `apb_uart_new` Verilog-2005 module with the existing APB register behavior and standard synchronous TX/RX FIFOs whose reads complete one cycle after the request.

**Architecture:** Start from the current APB register/control logic and inline the locally modified UART divider, receiver, and transmitter. Replace both custom prefetch FIFOs with pointer/count synchronous FIFOs, then bridge each registered FIFO output to its consumer with an explicit one-cycle `rd_valid` pipeline and a pending flag. Hold RX output valid until the APB receive controller accepts it, and include pending/output bytes in software-visible FIFO counts.

**Tech Stack:** Verilog-2005, APB, self-checking Verilog testbench, Icarus Verilog (`iverilog` and `vvp`). The required vks MCP tools are not exposed in this session, so the final report must record that vks lint/compile/simulate could not be run and that Icarus was used as the available verification fallback.

---

## File Structure

- Create `rtl/uart/apb_uart_new.v`: the complete APB register block, interrupt logic, two inline synchronous FIFOs, baud divider, UART RX, and UART TX in one `apb_uart_new` module.
- Create `rtl/sim/apb_uart_new_tb.v`: an independent loopback testbench that compiles with only `apb_uart_new.v` and verifies the current register map plus FIFO read latency.
- Preserve `rtl/uart/apb_uart.v`, `rtl/uart/uart_top.v`, and `rtl/sim/tb_apb_uart.v` without modification.

## Confirmed Checklist

- [ ] The new source file contains exactly one module named `apb_uart_new`.
- [ ] External parameters and ports match the current `apb_uart` module.
- [ ] Register offsets `0x00` through `0x18`, field behavior, and side effects remain unchanged.
- [ ] TX and RX use standard pointer/count FIFOs with registered one-cycle reads.
- [ ] FIFO consumers act on `rd_valid`, never on the same-cycle read request.
- [ ] The current local `uart_top.v` FIFO-related edits are not overwritten.
- [ ] The new module compiles and simulates without any other custom RTL source.

### Task 1: Add the Failing Single-Module Test

**Files:**
- Create: `rtl/sim/apb_uart_new_tb.v`
- Test: `rtl/sim/apb_uart_new_tb.v`

- [ ] **Step 1: Create a self-checking Verilog-2005 testbench**

Use the following testbench structure and behavior:

```verilog
`timescale 1ns / 1ps

module apb_uart_new_tb();

    localparam SYS_CLK_FREQ = 1_000_000;
    localparam FIFO_DEPTH   = 8;
    localparam BAUD_RATE    = 100_000;
    localparam CLK_PERIOD   = 1_000;

    localparam ADDR_CTRL      = 32'h0000_0000;
    localparam ADDR_CONFIG    = 32'h0000_0004;
    localparam ADDR_RX_BUF    = 32'h0000_0008;
    localparam ADDR_RX_STATUS = 32'h0000_000c;
    localparam ADDR_TX_BUF    = 32'h0000_0010;
    localparam ADDR_TX_STATUS = 32'h0000_0014;
    localparam ADDR_INTERRUPT = 32'h0000_0018;

    reg         s_apb_pclk    = 1'b0;
    reg         s_apb_presetn = 1'b0;
    reg         s_apb_psel    = 1'b0;
    reg         s_apb_penable = 1'b0;
    reg         s_apb_pwrite  = 1'b0;
    reg  [31:0] s_apb_paddr   = 32'd0;
    reg  [31:0] s_apb_pwdata  = 32'd0;

    wire        s_apb_pready;
    wire        s_apb_pslverr;
    wire [31:0] s_apb_prdata;
    wire        interrupt;
    wire        serial_line;

    integer     error_count = 0;
    reg  [31:0] read_data;
    reg         tx_fifo_rd_en_d = 1'b0;
    reg         rx_fifo_rd_en_d = 1'b0;

    apb_uart_new #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (FIFO_DEPTH))
    apb_uart_new_inst (
        .s_apb_pclk    (s_apb_pclk),
        .s_apb_presetn (s_apb_presetn),
        .s_apb_psel    (s_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s_apb_pready),
        .s_apb_pslverr (s_apb_pslverr),
        .s_apb_prdata  (s_apb_prdata),
        .interrupt     (interrupt),
        .uart_rx       (serial_line),
        .uart_tx       (serial_line));

    always #(CLK_PERIOD/2) s_apb_pclk = ~s_apb_pclk;

    task apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(posedge s_apb_pclk);
            s_apb_psel    <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b1;
            s_apb_paddr   <= address;
            s_apb_pwdata  <= data;
            @(posedge s_apb_pclk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge s_apb_pclk);
            s_apb_psel    <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b0;
            s_apb_paddr   <= 32'd0;
            s_apb_pwdata  <= 32'd0;
        end
    endtask

    task apb_read;
        input  [31:0] address;
        output [31:0] data;
        begin
            @(posedge s_apb_pclk);
            s_apb_psel    <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b0;
            s_apb_paddr   <= address;
            @(posedge s_apb_pclk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge s_apb_pclk);
            data = s_apb_prdata;
            s_apb_psel    <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr   <= 32'd0;
        end
    endtask

    task check_value;
        input [255:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s expected=%08h actual=%08h", name, expected, actual);
                error_count = error_count + 1;
            end else begin
                $display("[PASS] %0s value=%08h", name, actual);
            end
        end
    endtask

    task transfer_and_check;
        input [1:0]  last_byte;
        input [31:0] tx_word;
        input [31:0] compare_mask;
        reg   [31:0] ctrl_value;
        begin
            ctrl_value = {25'd0, last_byte, 1'b1, 1'b0, last_byte, 1'b1};
            apb_write(ADDR_TX_BUF, tx_word);
            apb_write(ADDR_CTRL, ctrl_value);
            wait (apb_uart_new_inst.rx_en == 1'b1);
            wait (apb_uart_new_inst.rx_en == 1'b0);
            apb_read(ADDR_RX_BUF, read_data);
            check_value("UART loopback", read_data & compare_mask,
                        tx_word & compare_mask);
            apb_read(ADDR_RX_STATUS, read_data);
            check_value("RX pointer cleared", {30'd0, read_data[1:0]}, 32'd0);
        end
    endtask

    always @(posedge s_apb_pclk) begin
        if (s_apb_presetn) begin
            if (apb_uart_new_inst.tx_fifo_rd_valid !== tx_fifo_rd_en_d) begin
                $display("[FAIL] TX FIFO read-valid latency");
                error_count = error_count + 1;
            end
            if (apb_uart_new_inst.rx_fifo_rd_valid !== rx_fifo_rd_en_d) begin
                $display("[FAIL] RX FIFO read-valid latency");
                error_count = error_count + 1;
            end
        end
        tx_fifo_rd_en_d <= apb_uart_new_inst.tx_fifo_rd_en;
        rx_fifo_rd_en_d <= apb_uart_new_inst.rx_fifo_rd_en;
    end

    initial begin
        #(CLK_PERIOD*20) s_apb_presetn = 1'b1;
    end

    initial begin
        wait (s_apb_presetn);
        repeat (4) @(posedge s_apb_pclk);

        apb_read(ADDR_CTRL, read_data);
        check_value("CTRL reset", read_data, 32'd0);
        apb_read(ADDR_CONFIG, read_data);
        check_value("CONFIG reset", read_data, 32'd0);
        if (s_apb_pslverr !== 1'b0) begin
            $display("[FAIL] PSLVERR must remain low");
            error_count = error_count + 1;
        end

        apb_write(ADDR_CONFIG, BAUD_RATE);
        repeat (40) @(posedge s_apb_pclk);

        transfer_and_check(2'd0, 32'hf0_00_00_00, 32'hff00_0000);
        transfer_and_check(2'd1, 32'hde_ad_00_00, 32'hffff_0000);
        transfer_and_check(2'd2, 32'haa_55_a5_00, 32'hffff_ff00);
        transfer_and_check(2'd3, 32'h12_34_56_78, 32'hffff_ffff);

        apb_write(ADDR_INTERRUPT, 32'h0000_0003);
        repeat (2) @(posedge s_apb_pclk);
        check_value("TX-ready interrupt", {31'd0, interrupt}, 32'd1);
        apb_write(ADDR_INTERRUPT, 32'd0);

        apb_write(ADDR_CTRL, 32'h8000_0000);
        repeat (2) @(posedge s_apb_pclk);
        apb_read(ADDR_TX_STATUS, read_data);
        check_value("TX FIFO soft reset", {28'd0, read_data[5:2]}, 32'd0);
        apb_read(ADDR_RX_STATUS, read_data);
        check_value("RX FIFO soft reset", {28'd0, read_data[5:2]}, 32'd0);
        apb_write(ADDR_CTRL, 32'd0);

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial #(CLK_PERIOD*500_000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("apb_uart_new_tb.vcd");
    //     $dumpvars(0, apb_uart_new_tb);
    // end

endmodule
```

- [ ] **Step 2: Compile the test before creating production RTL**

Run:

```powershell
iverilog -g2005 -s apb_uart_new_tb -o build_apb_uart_new_tb.vvp rtl/sim/apb_uart_new_tb.v
```

Expected: FAIL because `apb_uart_new` is an unknown module. This is the required TDD red state; failures caused by testbench syntax must be fixed until the only blocking failure is the missing DUT.

### Task 2: Implement the Self-Contained Module

**Files:**
- Create: `rtl/uart/apb_uart_new.v`
- Test: `rtl/sim/apb_uart_new_tb.v`

- [ ] **Step 1: Copy the external contract and APB register behavior**

Create `apb_uart_new.v` with the existing project banner/style, module name
`apb_uart_new`, parameters `SYS_CLK_FREQ` and `FIFO_DEPTH`, and the exact port
list from `apb_uart.v`. Copy the APB handshake, seven 32-bit registers,
interrupt selection, APB read/write cases, and RX/TX word-buffer ordering
without changing addresses or masks.

Rename only signals that collide after inlining:

```verilog
    wire                            uart_rst_n;
    wire                            rx_data_available;
    wire                            apb_rx_data_valid;
    wire                            apb_rx_data_ready;
    wire    [7:0]                   apb_rx_data;
    wire                            apb_tx_valid;
    wire                            apb_tx_ready;
    wire    [7:0]                   apb_tx_data;

    assign uart_rst_n   = s_apb_presetn & ~soft_rst;
    assign rx_data_available = |rx_data_count;
    assign apb_rx_data_valid = rx_fifo_output_valid;
    assign apb_rx_data       = rx_fifo_rd_data;
    assign apb_tx_ready      = tx_data_count < FIFO_DEPTH;
```

Update APB-side transfer progress only on accepted data. TX acceptance remains
`apb_tx_valid & apb_tx_ready`; RX acceptance becomes
`apb_rx_data_valid & apb_rx_data_ready` so the APB receive buffer never
consumes stale registered FIFO data. Use `rx_data_available` for
`RX_STATUS[8]` and RX-valid interrupt selection, preserving the original
meaning even before an enabled APB receive transfer requests the byte.

- [ ] **Step 2: Add the two standard synchronous FIFOs**

Use separate RX and TX RAMs but the same pointer/count structure. Apply this
exact acceptance and count pattern to each FIFO, with the appropriate signal
prefix:

```verilog
    localparam FIFO_ADDR_WIDTH = $clog2(FIFO_DEPTH);

    wire                            rx_fifo_wr_accept;
    wire                            rx_fifo_rd_accept;
    wire                            rx_fifo_empty;
    wire                            rx_fifo_full;
    reg     [FIFO_ADDR_WIDTH-1:0]   rx_fifo_wr_ptr;
    reg     [FIFO_ADDR_WIDTH-1:0]   rx_fifo_rd_ptr;
    reg     [FIFO_ADDR_WIDTH:0]     rx_fifo_count;
    reg     [7:0]                   rx_fifo_mem [0:FIFO_DEPTH-1];
    reg     [7:0]                   rx_fifo_rd_data;
    reg                             rx_fifo_rd_valid;

    assign rx_fifo_wr_accept = rx_fifo_wr_en & ~rx_fifo_full &
                               (rx_data_count < FIFO_DEPTH);
    assign rx_fifo_rd_accept = rx_fifo_rd_en & ~rx_fifo_empty;
    assign rx_fifo_empty     = rx_fifo_count == 0;
    assign rx_fifo_full      = rx_fifo_count == FIFO_DEPTH;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_fifo_wr_ptr <= {FIFO_ADDR_WIDTH{1'b0}};
            rx_fifo_rd_ptr <= {FIFO_ADDR_WIDTH{1'b0}};
            rx_fifo_count  <= {(FIFO_ADDR_WIDTH+1){1'b0}};
        end else begin
            if (rx_fifo_wr_accept)
                rx_fifo_wr_ptr <= rx_fifo_wr_ptr + 1'b1;
            if (rx_fifo_rd_accept)
                rx_fifo_rd_ptr <= rx_fifo_rd_ptr + 1'b1;
            case ({rx_fifo_wr_accept, rx_fifo_rd_accept})
                2'b10: rx_fifo_count <= rx_fifo_count + 1'b1;
                2'b01: rx_fifo_count <= rx_fifo_count - 1'b1;
                default: rx_fifo_count <= rx_fifo_count;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (rx_fifo_wr_accept)
            rx_fifo_mem[rx_fifo_wr_ptr] <= uart_rx_data;
        if (rx_fifo_rd_accept)
            rx_fifo_rd_data <= rx_fifo_mem[rx_fifo_rd_ptr];
        rx_fifo_rd_valid <= rx_fifo_rd_accept;
    end
```

Do not reset or clear the RAM arrays or registered read-data pipelines. The TX
FIFO uses `apb_tx_data` as its write data and supplies `tx_fifo_rd_data` to the
UART transmitter. Both FIFO count signals retain width
`[$clog2(FIFO_DEPTH):0]` for status-register compatibility. Gate TX writes by
`tx_data_count < FIFO_DEPTH` in the same way so a pending output byte does not
silently increase software-visible capacity beyond `FIFO_DEPTH`.

- [ ] **Step 3: Add one-cycle read bridges**

RX may have only one outstanding read. It requests data while an APB receive
operation is active. A holding valid flag keeps the registered FIFO output
available if the delayed response coincides with an APB register read:

```verilog
    reg rx_fifo_rd_pending;
    reg rx_fifo_output_valid;

    assign rx_fifo_rd_en = rx_en & ~rx_fifo_empty &
                           ~rx_fifo_rd_pending & ~rx_fifo_output_valid &
                           ~slv_reg_rden;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_fifo_rd_pending  <= 1'b0;
            rx_fifo_output_valid <= 1'b0;
        end else begin
            if (rx_fifo_rd_accept)
                rx_fifo_rd_pending <= 1'b1;
            if (rx_fifo_rd_valid)
                rx_fifo_rd_pending <= 1'b0;
            if (rx_fifo_rd_valid)
                rx_fifo_output_valid <= 1'b1;
            else if (apb_rx_data_valid & apb_rx_data_ready)
                rx_fifo_output_valid <= 1'b0;
        end
    end
```

Preserve occupancy semantics across the read-latency bridge:

```verilog
    wire [FIFO_ADDR_WIDTH:0] rx_data_count;
    wire [FIFO_ADDR_WIDTH:0] tx_data_count;

    assign rx_data_count = rx_fifo_count + rx_fifo_rd_pending +
                           rx_fifo_output_valid;
    assign tx_data_count = tx_fifo_count + tx_fifo_rd_pending;
```

On an RX read request, the RAM count decreases while `rx_fifo_rd_pending`
increases. When data returns, pending transfers to `rx_fifo_output_valid`.
The APB-visible count decreases only when the output byte is accepted. TX uses
the same accounting until `tx_fifo_rd_valid` starts the physical transmitter.

TX may have only one outstanding read and may request a byte only while the
physical transmitter is idle:

```verilog
    reg tx_fifo_rd_pending;

    assign tx_fifo_rd_en = ~uart_tx_busy & ~tx_fifo_empty &
                           ~tx_fifo_rd_pending;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_fifo_rd_pending <= 1'b0;
        end else begin
            if (tx_fifo_rd_accept)
                tx_fifo_rd_pending <= 1'b1;
            if (tx_fifo_rd_valid)
                tx_fifo_rd_pending <= 1'b0;
        end
    end
```

Because both `rd_data` and `rd_valid` are registered with non-blocking
assignments, consumers observe matching data and valid on the cycle after the
accepted request.

- [ ] **Step 4: Inline the divider and UART physical logic**

Move the baud divider, receiver synchronizer/state counters, parity logic, and
transmitter counters from the current `uart_top.v` into `apb_uart_new.v`.
Replace `clk` with `s_apb_pclk`, `rst_n` with `uart_rst_n`, `baud_rate` with
`uart_config[23:0]`, `stop_bit` with `uart_config[31]`, and `parity_type` with
`uart_config[30:29]`.

RX FIFO write acceptance replaces the old RX stream handshake:

```verilog
    assign rx_fifo_wr_en = uart_rx_valid;
    assign uart_rx_ready = rx_data_count < FIFO_DEPTH;
```

The receiver keeps `uart_rx_valid` asserted until
`uart_rx_valid & uart_rx_ready`. The transmitter starts only after the FIFO
read result is valid:

```verilog
    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx_busy <= 1'b0;
        end else begin
            uart_tx_busy <=
                tx_fifo_rd_valid ? 1'b1 :
                (uart_tx_bit_cnt == 8 + parity_en + stop_bit_cnt) &&
                (uart_tx_baud_cnt == baud_cnt - 1) ? 1'b0 :
                uart_tx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (tx_fifo_rd_valid)
            uart_tx_data <= tx_fifo_rd_data;
    end
```

All UART frame timing continues to use the existing counter-based design.

- [ ] **Step 5: Compile the new module and testbench**

Run:

```powershell
iverilog -g2005 -Wall -s apb_uart_new_tb -o build_apb_uart_new_tb.vvp rtl/uart/apb_uart_new.v rtl/sim/apb_uart_new_tb.v
```

Expected: PASS with exit code 0 and no syntax, width, implicit-net, or
multi-driver warnings.

- [ ] **Step 6: Run the self-checking simulation**

Run:

```powershell
vvp build_apb_uart_new_tb.vvp
```

Expected: all checks print `[PASS]`, the final line is `TEST PASS`, and no
`[FAIL]` or `TEST TIMEOUT` text appears.

- [ ] **Step 7: Commit the green implementation**

```powershell
git add -- rtl/uart/apb_uart_new.v rtl/sim/apb_uart_new_tb.v
git commit -m "feat: add standalone APB UART module"
```

### Task 3: Review Compatibility and Final Verification

**Files:**
- Verify: `rtl/uart/apb_uart_new.v`
- Verify: `rtl/sim/apb_uart_new_tb.v`
- Preserve: `rtl/uart/apb_uart.v`
- Preserve: `rtl/uart/uart_top.v`

- [ ] **Step 1: Verify old source files were not changed by this task**

Run:

```powershell
git diff -- rtl/uart/apb_uart.v rtl/uart/uart_top.v
```

Expected: `apb_uart.v` has no diff. Any displayed `uart_top.v` diff must be the
pre-existing user change observed before implementation; the task must not add
to it.

- [ ] **Step 2: Verify that the new source is structurally standalone**

Run:

```powershell
Select-String -LiteralPath rtl/uart/apb_uart_new.v -Pattern '^module ','^endmodule','uart_top','sync_fifo'
```

Expected: one `module apb_uart_new`, one `endmodule`, and no `uart_top` or
`sync_fifo` instantiation/reference.

- [ ] **Step 3: Run a fresh full compile and simulation**

Run:

```powershell
iverilog -g2005 -Wall -s apb_uart_new_tb -o build_apb_uart_new_tb.vvp rtl/uart/apb_uart_new.v rtl/sim/apb_uart_new_tb.v
vvp build_apb_uart_new_tb.vvp
```

Expected: compile exit code 0, simulation prints `TEST PASS`, zero failing
checks, and no timeout.

- [ ] **Step 4: Inspect the complete task diff**

Run:

```powershell
git diff HEAD^ --check
git status --short
```

Expected: no whitespace errors. Existing unrelated worktree changes remain
present and untouched.

- [ ] **Step 5: Remove only generated simulation output**

Delete `build_apb_uart_new_tb.vvp` after resolving its absolute path under
`D:\Software\simple_cpu`. Do not delete existing build artifacts, source files,
testbenches, VCD files, or user files.

- [ ] **Step 6: Record verification limitations and skipped top level**

The final report must state that vks MCP tools were unavailable in this
session, so no vks bug could be observed or assessed. Report the exact Icarus
compile/simulation results instead. Top-level wrapper design and top-level
simulation are skipped because the confirmed target is one independent module
with its own passing testbench and no custom RTL dependency.
