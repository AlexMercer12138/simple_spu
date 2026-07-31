# Tiny C I2C Master Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bounded Tiny C I2C master driver and prove write, read, write-then-read with RESTART, synchronous RX draining, and address-NACK handling over a real two-controller open-drain bus.

**Architecture:** The CPU controls one `apb_i2c` in master mode. A second `apb_i2c`, configured by private testbench APB tasks as slave `0x52`, supplies and captures bytes on resolved SCL/SDA wires; no protocol signal is forced. Firmware and peer setup synchronize through a third DLB mailbox word.

**Tech Stack:** Tiny C, MERC32 assembler/CPU, Verilog-2005, APB I2C master/slave cores, `sync_fifo`, Node.js RTL runner, Icarus Verilog; use vks lint/compile/simulate if available.

---

## File Map

- Create `example/tinyc_i2c_test.c`: master driver, status retention, bounded cleanup, and self-test.
- Create `rtl/sim/tinyc_i2c_tb.v`: CPU master integration, APB-configured peer, bus monitor, and verdict.
- Modify `merc32-vsce/scripts/test-c-rtl.js`: register I2C firmware and all protocol dependencies.

### Task 1: Build a Real-Bus RED Test

**Files:**
- Create: `example/tinyc_i2c_test.c`
- Create: `rtl/sim/tinyc_i2c_tb.v`
- Modify: `merc32-vsce/scripts/test-c-rtl.js`

- [ ] **Step 1: Add a peer-ready firmware scaffold**

```c
int main(void) {
    volatile unsigned int *peer_ready =
        (volatile unsigned int *)0x008003C8;
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    int remaining = 100000;

    while ((*peer_ready == 0) && (remaining > 0)) {
        remaining = remaining - 1;
    }
    *status = 0x600D;
    return 0;
}
```

This lets the harness configure its peer deterministically but performs no I2C
transaction, so physical-bus completion must remain RED.

- [ ] **Step 2: Create the CPU master and resolved open-drain bus**

Create `rtl/sim/tinyc_i2c_tb.v` with:

```verilog
`timescale 1ns/1ps

module tinyc_i2c_tb();
    localparam SYS_CLK_FREQ = 1_000_000;
    localparam FIFO_DEPTH = 16;
    localparam CLK_PERIOD = 10;
    localparam STATUS_ADDR = 16'd240;
    localparam DETAIL_ADDR = 16'd241;
    localparam PEER_READY_ADDR = 16'd242;

    localparam ADDR_CTRL = 32'h0000_0000;
    localparam ADDR_RX_DATA = 32'h0000_0014;
    localparam ADDR_FIFO_STATUS = 32'h0000_0018;
    localparam ADDR_SLAVE_CFG = 32'h0000_001c;
    localparam ADDR_STRETCH_TIMEOUT = 32'h0000_0020;
    localparam ADDR_IRQ_STATUS = 32'h0000_0024;
    localparam ADDR_TX_DATA = 32'h0000_0010;

    reg clk = 1'b0;
    reg rst_n = 1'b0;
    wire ilb_en;
    wire ilb_we;
    wire [15:0] ilb_addr;
    wire [31:0] ilb_wdata;
    wire [31:0] ilb_rdata;
    wire dlb_en;
    wire dlb_we;
    wire [15:0] dlb_addr;
    wire [31:0] dlb_wdata;
    reg [31:0] dlb_rdata = 32'd0;
    wire cpu_psel;
    wire cpu_penable;
    wire [31:0] cpu_paddr;
    wire cpu_pwrite;
    wire [31:0] cpu_pwdata;
    wire [31:0] cpu_prdata;
    wire cpu_pready;
    wire cpu_pslverr;
    wire master_interrupt;

    reg peer_psel = 1'b0;
    reg peer_penable = 1'b0;
    reg peer_pwrite = 1'b0;
    reg [31:0] peer_paddr = 32'd0;
    reg [31:0] peer_pwdata = 32'd0;
    wire [31:0] peer_prdata;
    wire peer_pready;
    wire peer_pslverr;
    wire peer_interrupt;
    wire master_scl_t;
    wire master_sda_t;
    wire peer_scl_t;
    wire peer_sda_t;
    wire shared_scl;
    wire shared_sda;

    assign shared_scl = master_scl_t && peer_scl_t;
    assign shared_sda = master_sda_t && peer_sda_t;

    always #(CLK_PERIOD/2) clk = ~clk;
    initial #(CLK_PERIOD*5) rst_n = 1'b1;
```

Instantiate the CPU and both I2C controllers with these connections:

```verilog
MERC32_top #(
    .ILB_ADDR_WIDTH (16),
    .DLB_ADDR_WIDTH (16)
) MERC32_top_inst (
    .clk           (clk),
    .rst_n         (rst_n),
    .interrupt     (master_interrupt),
    .tck           (1'b0),
    .tms           (1'b1),
    .tdi           (1'b0),
    .tdo           (),
    .dlb_en        (dlb_en),
    .dlb_we        (dlb_we),
    .dlb_addr      (dlb_addr),
    .dlb_wdata     (dlb_wdata),
    .dlb_rdata     (dlb_rdata),
    .ilb_en        (ilb_en),
    .ilb_we        (ilb_we),
    .ilb_addr      (ilb_addr),
    .ilb_wdata     (ilb_wdata),
    .ilb_rdata     (ilb_rdata),
    .m_apb_psel    (cpu_psel),
    .m_apb_penable (cpu_penable),
    .m_apb_paddr   (cpu_paddr),
    .m_apb_pwrite  (cpu_pwrite),
    .m_apb_pwdata  (cpu_pwdata),
    .m_apb_prdata  (cpu_prdata),
    .m_apb_pready  (cpu_pready)
);

apb_i2c #(
    .SYS_CLK_FREQ (SYS_CLK_FREQ),
    .FIFO_DEPTH   (FIFO_DEPTH)
) master_i2c_inst (
    .s_apb_pclk    (clk),
    .s_apb_presetn (rst_n),
    .s_apb_psel    (cpu_psel),
    .s_apb_penable (cpu_penable),
    .s_apb_pwrite  (cpu_pwrite),
    .s_apb_paddr   (cpu_paddr),
    .s_apb_pwdata  (cpu_pwdata),
    .s_apb_pready  (cpu_pready),
    .s_apb_pslverr (cpu_pslverr),
    .s_apb_prdata  (cpu_prdata),
    .interrupt     (master_interrupt),
    .scl_o         (),
    .scl_t         (master_scl_t),
    .scl_i         (shared_scl),
    .sda_o         (),
    .sda_t         (master_sda_t),
    .sda_i         (shared_sda)
);

apb_i2c #(
    .SYS_CLK_FREQ (SYS_CLK_FREQ),
    .FIFO_DEPTH   (FIFO_DEPTH)
) peer_i2c_inst (
    .s_apb_pclk    (clk),
    .s_apb_presetn (rst_n),
    .s_apb_psel    (peer_psel),
    .s_apb_penable (peer_penable),
    .s_apb_pwrite  (peer_pwrite),
    .s_apb_paddr   (peer_paddr),
    .s_apb_pwdata  (peer_pwdata),
    .s_apb_pready  (peer_pready),
    .s_apb_pslverr (peer_pslverr),
    .s_apb_prdata  (peer_prdata),
    .interrupt     (peer_interrupt),
    .scl_o         (),
    .scl_t         (peer_scl_t),
    .scl_i         (shared_scl),
    .sda_o         (),
    .sda_t         (peer_sda_t),
    .sda_i         (shared_sda)
);
```

Tie neither controller's line input directly high and do not use `force` on
protocol or FIFO internals.

Add the 65536-word ROM/DLB arrays, asynchronous ILB read, synchronous ROM/DLB
writes and DLB reads, plusarg image loading, and standard PASS/FAIL mailbox
monitor. Initialize `dlb_ram[PEER_READY_ADDR]` to zero before releasing peer
setup.

- [ ] **Step 3: Add complete private APB tasks for the peer**

```verilog
task peer_apb_write;
    input [31:0] address;
    input [31:0] data;
    begin
        @(negedge clk);
        peer_psel <= 1'b1;
        peer_penable <= 1'b0;
        peer_pwrite <= 1'b1;
        peer_paddr <= address;
        peer_pwdata <= data;
        @(negedge clk);
        peer_penable <= 1'b1;
        while (peer_pready !== 1'b1)
            @(negedge clk);
        @(negedge clk);
        peer_psel <= 1'b0;
        peer_penable <= 1'b0;
        peer_pwrite <= 1'b0;
        peer_paddr <= 32'd0;
        peer_pwdata <= 32'd0;
    end
endtask

task peer_apb_read;
    input [31:0] address;
    output [31:0] data;
    begin
        @(negedge clk);
        peer_psel <= 1'b1;
        peer_penable <= 1'b0;
        peer_pwrite <= 1'b0;
        peer_paddr <= address;
        @(negedge clk);
        peer_penable <= 1'b1;
        while (peer_pready !== 1'b1)
            @(negedge clk);
        data = peer_prdata;
        @(negedge clk);
        peer_psel <= 1'b0;
        peer_penable <= 1'b0;
        peer_paddr <= 32'd0;
    end
endtask
```

Declare and initialize every `peer_*` APB register to zero at its declaration.

- [ ] **Step 4: Configure and preload the real peer**

After reset, execute this exact APB order:

```verilog
initial begin : peer_setup
    wait (rst_n);
    peer_apb_write(ADDR_CTRL, 32'h8000_0000);
    peer_apb_write(ADDR_CTRL, 32'h0000_0000);
    peer_apb_write(ADDR_SLAVE_CFG, 32'h0000_0052);
    peer_apb_write(ADDR_STRETCH_TIMEOUT, 32'd5000);
    peer_apb_write(ADDR_IRQ_STATUS, 32'h0000_3fff);
    peer_apb_write(ADDR_TX_DATA, 32'h0000_003c);
    peer_apb_write(ADDR_TX_DATA, 32'h0000_00c3);
    peer_apb_write(ADDR_TX_DATA, 32'h0000_00de);
    peer_apb_write(ADDR_TX_DATA, 32'h0000_00ad);
    peer_apb_write(ADDR_CTRL, 32'h0000_0001);
    dlb_ram[PEER_READY_ADDR] = 32'h0000_0001;
end
```

The first two TX bytes serve direct read; the last two serve combined read.

- [ ] **Step 5: Add bus monitoring and peer RX verification**

Count SDA transitions while SCL is high:

```verilog
reg previous_scl = 1'b1;
reg previous_sda = 1'b1;
integer start_count = 0;
integer stop_count = 0;

always @(posedge clk) begin
    if (!rst_n) begin
        previous_scl <= 1'b1;
        previous_sda <= 1'b1;
    end else begin
        if (previous_sda && !shared_sda && shared_scl)
            start_count <= start_count + 1;
        if (!previous_sda && shared_sda && shared_scl)
            stop_count <= stop_count + 1;
        previous_scl <= shared_scl;
        previous_sda <= shared_sda;
    end
end
```

After firmware detail `0x4001`, read `FIFO_STATUS` and require RX level 3.
Perform one discarded `RX_DATA` read followed by three reads and require the
low bytes `a5`, `5a`, `10`. Require `start_count==5`, `stop_count==4`, both
shared lines released high, and no peer `CMD_ERROR`, overflow, underflow,
stretch-timeout, or bus-error bit. Only then set `bus_checks_done=1`.

- [ ] **Step 6: Add timeout and final two-dimensional verdict**

Firmware `0x600D` is necessary but not sufficient. Print exactly one
`TEST PASS` only after both firmware pass and `bus_checks_done`; reject
`0x0BAD` immediately. Add:

```verilog
initial #(CLK_PERIOD*1000000) begin
    $display("TEST TIMEOUT: detail=0x%08h status=0x%08h starts=%0d stops=%0d",
             dlb_ram[DETAIL_ADDR], dlb_ram[STATUS_ADDR],
             start_count, stop_count);
    $finish;
end

// initial begin
//     $dumpfile("tinyc_i2c_tb.vcd");
//     $dumpvars(0, tinyc_i2c_tb);
// end
```

- [ ] **Step 7: Register all I2C dependencies in the runner**

Append:

```javascript
{
    name: 'tinyc_i2c_test',
    top: 'tinyc_i2c_tb',
    rtlFiles: [
        ['rtl', 'debug', 'jtag_debug.v'],
        ['rtl', 'cpu', 'core.v'],
        ['rtl', 'bridge', 'lb2apb.v'],
        ['rtl', 'cpu', 'MERC32_top.v'],
        ['rtl', 'misc', 'sync_fifo.v'],
        ['rtl', 'i2c', 'i2c_master_lite.v'],
        ['rtl', 'i2c', 'i2c_slave.v'],
        ['rtl', 'i2c', 'apb_i2c.v'],
        ['rtl', 'sim', 'tinyc_i2c_tb.v'],
    ],
},
```

- [ ] **Step 8: Run and observe RED**

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: prior tests pass; I2C fails because the scaffold produces no bus
traffic, no detail `0x4001`, and no peer RX bytes.

- [ ] **Step 9: Commit the failing real-bus test**

```powershell
git add -- example/tinyc_i2c_test.c rtl/sim/tinyc_i2c_tb.v `
  merc32-vsce/scripts/test-c-rtl.js
git diff --cached --check
git commit -m "test: add Tiny C I2C master closed loop"
```

### Task 2: Implement I2C Master Initialization and Completion

**Files:**
- Modify: `example/tinyc_i2c_test.c`
- Test: `rtl/sim/tinyc_i2c_tb.v`

- [ ] **Step 1: Add driver state, initialization, and cleanup**

```c
unsigned int i2c_base = 0x10010000;
unsigned int i2c_last_status = 0;

void i2c_master_init(unsigned int prescale, unsigned int timeout) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    i2c[0] = 0x80000000;
    i2c[0] = 0x00000002;
    i2c[2] = prescale;
    i2c[8] = timeout;
    i2c[9] = 0x3FFF;
    i2c_last_status = 0;
}

void i2c_prepare(void) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    i2c[0] = 0x00000002;
    i2c[0] = 0x00000032;
    i2c[9] = 0x3FFF;
}

void i2c_cleanup(void) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    i2c[0] = 0x0000000B;
    i2c[0] = 0x00000002;
    i2c[0] = 0x00000032;
}

unsigned int i2c_get_last_status(void) {
    return i2c_last_status;
}
```

- [ ] **Step 2: Add bounded command completion**

```c
int i2c_wait_done(int limit) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    unsigned int status = i2c[9];

    while (((status & 1) == 0) && (limit > 0)) {
        limit = limit - 1;
        status = i2c[9];
    }
    i2c_last_status = status;
    if (limit == 0) {
        i2c_cleanup();
        return 0;
    }
    if ((status & 0x203E) != 0) {
        return 0;
    }
    return 1;
}

int i2c_valid_length(int length) {
    if (length < 1) {
        return 0;
    }
    if (length > 16) {
        return 0;
    }
    return 1;
}
```

Run the full RTL suite. Expected: I2C remains RED because transaction APIs and
test calls do not exist yet; compiler and prior test behavior remain green.

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

- [ ] **Step 3: Commit the initialization layer**

```powershell
git add -- example/tinyc_i2c_test.c
git diff --cached --check
git commit -m "feat: add bounded Tiny C I2C master core"
```

### Task 3: Implement Write, Read, and Combined Operations

**Files:**
- Modify: `example/tinyc_i2c_test.c`
- Test: `rtl/sim/tinyc_i2c_tb.v`

- [ ] **Step 1: Add TX loading and RX draining helpers**

```c
int i2c_load_tx(unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    int index = 0;
    if (i2c_valid_length(length) == 0) {
        return 0;
    }
    while (index < length) {
        i2c[4] = data[index] & 0xFF;
        index = index + 1;
    }
    return 1;
}

int i2c_drain_rx(unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    unsigned int level = (i2c[6] >> 8) & 0xFF;
    unsigned int discarded = 0;
    int index = 0;
    if (level != length) {
        return 0;
    }
    discarded = i2c[5];
    while (index < length) {
        data[index] = i2c[5] & 0xFF;
        index = index + 1;
    }
    return 1;
}
```

- [ ] **Step 2: Add direct write and direct read**

```c
int i2c_master_write(unsigned int address,
                     unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    if (i2c_valid_length(length) == 0) {
        return 0;
    }
    i2c_prepare();
    if (i2c_load_tx(data, length) == 0) {
        return 0;
    }
    i2c[1] = (address << 8) | (length << 16);
    i2c[0] = 3;
    i2c[0] = 7;
    return i2c_wait_done(200000);
}

int i2c_master_read(unsigned int address,
                    unsigned int *data, int length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    if (i2c_valid_length(length) == 0) {
        return 0;
    }
    i2c_prepare();
    i2c[1] = 1 | (address << 8) | (length << 24);
    i2c[0] = 3;
    i2c[0] = 7;
    if (i2c_wait_done(200000) == 0) {
        return 0;
    }
    return i2c_drain_rx(data, length);
}
```

- [ ] **Step 3: Add write-then-read with RESTART**

```c
int i2c_master_write_read(unsigned int address,
                          unsigned int *tx_data, int tx_length,
                          unsigned int *rx_data, int rx_length) {
    volatile unsigned int *i2c =
        (volatile unsigned int *)i2c_base;
    if (i2c_valid_length(tx_length) == 0) {
        return 0;
    }
    if (i2c_valid_length(rx_length) == 0) {
        return 0;
    }
    i2c_prepare();
    if (i2c_load_tx(tx_data, tx_length) == 0) {
        return 0;
    }
    i2c[1] = 2 | (address << 8) |
             (tx_length << 16) | (rx_length << 24);
    i2c[0] = 3;
    i2c[0] = 7;
    if (i2c_wait_done(200000) == 0) {
        return 0;
    }
    return i2c_drain_rx(rx_data, rx_length);
}
```

- [ ] **Step 4: Add the complete data and NACK self-test**

```c
int i2c_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;
    *detail = stage;
    *status = 0x0BAD;
    return 1;
}

int main(void) {
    volatile unsigned int *peer_ready =
        (volatile unsigned int *)0x008003C8;
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;
    unsigned int write_data[2];
    unsigned int read_data[2];
    unsigned int combined_tx[1];
    unsigned int combined_rx[2];
    int remaining = 100000;

    while ((*peer_ready == 0) && (remaining > 0)) {
        remaining = remaining - 1;
    }
    if (remaining == 0) {
        return i2c_fail(1);
    }

    i2c_master_init(0, 5000);
    write_data[0] = 0xA5;
    write_data[1] = 0x5A;
    if (i2c_master_write(0x52, write_data, 2) == 0) {
        return i2c_fail(2);
    }
    if (i2c_master_read(0x52, read_data, 2) == 0) {
        return i2c_fail(3);
    }
    if ((read_data[0] != 0x3C) || (read_data[1] != 0xC3)) {
        return i2c_fail(4);
    }

    combined_tx[0] = 0x10;
    if (i2c_master_write_read(0x52, combined_tx, 1,
                              combined_rx, 2) == 0) {
        return i2c_fail(5);
    }
    if ((combined_rx[0] != 0xDE) ||
        (combined_rx[1] != 0xAD)) {
        return i2c_fail(6);
    }

    if (i2c_master_read(0x53, read_data, 1) != 0) {
        return i2c_fail(7);
    }
    if ((i2c_get_last_status() & 2) == 0) {
        return i2c_fail(8);
    }

    *detail = 0x4001;
    *status = 0x600D;
    return 0;
}
```

- [ ] **Step 5: Run the real-bus closed loop and observe GREEN**

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: `tinyc_i2c_test RTL execution test passed`; peer RX is `a5 5a 10`,
master RX is `3c c3 de ad`, five STARTs and four STOPs are observed, address
`0x53` sets `ADDR_NACK`, and no failure/timeout marker appears.

- [ ] **Step 6: Commit transaction support**

```powershell
git add -- example/tinyc_i2c_test.c
git diff --cached --check
git commit -m "feat: add Tiny C I2C master transactions"
```

### Task 4: Run I2C Unit and Final Suite Regressions

**Files:**
- Test: `rtl/sim/apb_i2c_tb.v`
- Test: `rtl/sim/tinyc_i2c_tb.v`
- Test: all Tiny C RTL descriptors

- [ ] **Step 1: Run the APB I2C unit test**

```powershell
$i2cVvp = Join-Path $env:TEMP 'apb_i2c_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_i2c_tb -o $i2cVvp `
  rtl/misc/sync_fifo.v rtl/i2c/i2c_master_lite.v `
  rtl/i2c/i2c_slave.v rtl/i2c/apb_i2c.v rtl/sim/apb_i2c_tb.v
vvp $i2cVvp
```

Expected: exactly one final `TEST PASS` and no `[FAIL]`, `TEST FAIL`, or
`TEST TIMEOUT` marker.

- [ ] **Step 2: Run all compiler and CPU firmware tests**

```powershell
Push-Location merc32-vsce
npm test
npm run test:c:rtl
Pop-Location
```

Expected: compiler tests and every registered feature, IRQ, UART, GPIO, timer,
and I2C RTL case pass.

- [ ] **Step 3: Run all four peripheral unit tests as the final gate**

```powershell
$uartVvp = Join-Path $env:TEMP 'apb_uart_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_uart_tb -o $uartVvp `
  rtl/misc/sync_fifo.v rtl/uart/apb_uart.v rtl/sim/apb_uart_tb.v
Push-Location $env:TEMP
vvp $uartVvp
Pop-Location

$gpioVvp = Join-Path $env:TEMP 'apb_gpio_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_gpio_tb -o $gpioVvp `
  rtl/gpio/apb_gpio.v rtl/sim/apb_gpio_tb.v
vvp $gpioVvp

$timerVvp = Join-Path $env:TEMP 'apb_timer_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_timer_tb -o $timerVvp `
  rtl/timer/timer_channel.v rtl/timer/apb_timer.v rtl/sim/apb_timer_tb.v
vvp $timerVvp

$i2cVvp = Join-Path $env:TEMP 'apb_i2c_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_i2c_tb -o $i2cVvp `
  rtl/misc/sync_fifo.v rtl/i2c/i2c_master_lite.v `
  rtl/i2c/i2c_slave.v rtl/i2c/apb_i2c.v rtl/sim/apb_i2c_tb.v
vvp $i2cVvp
```

Each command must have a zero exit code, exactly one final pass marker, and no
`[FAIL]`, `TEST FAIL`, or `TEST TIMEOUT` marker.

- [ ] **Step 4: Check vks coverage, whitespace, and artifacts**

Run vks lint/compile/simulate for `tinyc_i2c_tb` and the other new testbenches
if vks is exposed. If it remains unavailable, report that explicitly and rely
only on the captured Icarus results.

```powershell
git diff --check
rg --files -g '*.vvp' -g '*.vcd' -g '*.mem'
git status --short
```

Expected: no new generated artifacts, no whitespace errors, and no unrelated
user file staged or modified by this work.
