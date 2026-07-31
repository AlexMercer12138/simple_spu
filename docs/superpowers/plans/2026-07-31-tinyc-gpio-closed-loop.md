# Tiny C GPIO Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a standalone Tiny C GPIO driver and prove direction control, direct and atomic output operations, synchronized input, rising-edge interrupt entry, and W1C service on the real RTL.

**Architecture:** A dedicated `tinyc_gpio_tb` contains the current CPU, ROM/DLB RAM, APB GPIO, external pin stimulus, and a monitor for firmware and pin completion. The firmware uses the detail mailbox to request deterministic input changes and defines the only CPU ISR used by this test.

**Tech Stack:** Tiny C, MERC32 assembler/CPU, Verilog-2005, APB GPIO, Node.js RTL runner, Icarus Verilog; use vks lint/compile/simulate if available.

---

## File Map

- Create `example/tinyc_gpio_test.c`: single-file driver, ISR, and self-test.
- Create `rtl/sim/tinyc_gpio_tb.v`: CPU/APB integration and external GPIO checker.
- Modify `merc32-vsce/scripts/test-c-rtl.js`: add the GPIO firmware descriptor without changing existing descriptors.

### Task 1: Add a Compilable RED GPIO Closed Loop

**Files:**
- Create: `rtl/sim/tinyc_gpio_tb.v`
- Create: `example/tinyc_gpio_test.c`
- Modify: `merc32-vsce/scripts/test-c-rtl.js`

- [ ] **Step 1: Add a mailbox-only firmware scaffold**

Create `example/tinyc_gpio_test.c` with no GPIO access:

```c
int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    *status = 0x600D;
    return 0;
}
```

This source exists only to let the new behavioral test compile. The testbench
must reject its premature pass because no pin sequence or interrupt occurred.

- [ ] **Step 2: Create the Verilog-2005 CPU-plus-GPIO testbench**

Create `rtl/sim/tinyc_gpio_tb.v` with these declarations and address checks:

```verilog
`timescale 1ns/1ps

module tinyc_gpio_tb();
    localparam CLK_PERIOD = 10;
    localparam STATUS_ADDR = 16'd240;
    localparam DETAIL_ADDR = 16'd241;
    localparam PASS_CODE = 32'h0000_600d;
    localparam FAIL_CODE = 32'h0000_0bad;

    reg clk = 1'b0;
    reg rst_n = 1'b0;
    reg [31:0] gpio_i = 32'd0;
    wire [31:0] gpio_o;
    wire [31:0] gpio_t;
    wire gpio_interrupt;

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
    wire apb_psel;
    wire apb_penable;
    wire [31:0] apb_paddr;
    wire apb_pwrite;
    wire [31:0] apb_pwdata;
    wire [31:0] apb_prdata;
    wire apb_pready;
    wire apb_pslverr;

    reg [31:0] rom [0:65535];
    reg [31:0] dlb_ram [0:65535];
    integer rom_words = 0;
    integer index = 0;
    integer errors = 0;
    integer irq_rise_count = 0;
    reg gpio_checks_done = 1'b0;
    reg firmware_pass_seen = 1'b0;

    always #(CLK_PERIOD/2) clk = ~clk;
    initial #(CLK_PERIOD*5) rst_n = 1'b1;
```

Instantiate the CPU and peripheral with these complete connections:

```verilog
MERC32_top #(
    .ILB_ADDR_WIDTH (16),
    .DLB_ADDR_WIDTH (16)
) MERC32_top_inst (
    .clk           (clk),
    .rst_n         (rst_n),
    .interrupt     (gpio_interrupt),
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
    .m_apb_psel    (apb_psel),
    .m_apb_penable (apb_penable),
    .m_apb_paddr   (apb_paddr),
    .m_apb_pwrite  (apb_pwrite),
    .m_apb_pwdata  (apb_pwdata),
    .m_apb_prdata  (apb_prdata),
    .m_apb_pready  (apb_pready)
);

apb_gpio apb_gpio_inst (
    .s_apb_pclk    (clk),
    .s_apb_presetn (rst_n),
    .s_apb_psel    (apb_psel),
    .s_apb_penable (apb_penable),
    .s_apb_pwrite  (apb_pwrite),
    .s_apb_paddr   (apb_paddr),
    .s_apb_pwdata  (apb_pwdata),
    .s_apb_pready  (apb_pready),
    .s_apb_pslverr (apb_pslverr),
    .s_apb_prdata  (apb_prdata),
    .gpio_i        (gpio_i),
    .gpio_o        (gpio_o),
    .gpio_t        (gpio_t),
    .interrupt     (gpio_interrupt)
);
```

Use the memory timing required by the current CPU:

```verilog
assign ilb_rdata = rom[ilb_addr];

always @(posedge clk) begin
    if (ilb_en && ilb_we)
        rom[ilb_addr] <= ilb_wdata;
    if (dlb_en && dlb_we)
        dlb_ram[dlb_addr] <= dlb_wdata;
    if (dlb_en && !dlb_we)
        dlb_rdata <= dlb_ram[dlb_addr];
end
```

Load `+ROM_FILE` and optional `+ROM_WORDS`, clear both arrays before
`$readmemh`, and fail immediately when the plusarg is absent.

- [ ] **Step 3: Add deterministic GPIO checks and stimulus**

Define this task and interrupt-edge monitor:

```verilog
task check_gpio;
    input [8*40-1:0] name;
    input [31:0] actual;
    input [31:0] expected;
    begin
        if (actual !== expected) begin
            $display("TEST FAIL: %0s expected=%08h actual=%08h",
                     name, expected, actual);
            errors = errors + 1;
        end
    end
endtask

always @(posedge gpio_interrupt)
    irq_rise_count = irq_rise_count + 1;
```

Use a bounded `initial` stimulus process that waits on detail mailbox values
and checks the exact output sequence:

```verilog
initial begin : gpio_stimulus
    wait (rst_n);
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2001);
    check_gpio("direction", gpio_t, 32'hffff_fff0);
    check_gpio("direct write", gpio_o, 32'h0000_0005);
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2002);
    check_gpio("atomic set", gpio_o, 32'h0000_0007);
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2003);
    check_gpio("atomic clear", gpio_o, 32'h0000_0006);
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2004);
    check_gpio("atomic toggle", gpio_o, 32'h0000_0009);

    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2100);
    gpio_i <= 32'h0000_00a0;
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2101);
    gpio_i <= 32'd0;
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2102);
    gpio_i <= 32'h0000_0010;
    wait (dlb_ram[DETAIL_ADDR] == 32'h0000_2103);
    if (gpio_interrupt !== 1'b0) begin
        $display("TEST FAIL: GPIO interrupt did not clear");
        errors = errors + 1;
    end
    if (irq_rise_count != 1) begin
        $display("TEST FAIL: GPIO IRQ rises expected=1 actual=%0d",
                 irq_rise_count);
        errors = errors + 1;
    end
    gpio_checks_done = 1'b1;
end
```

Add a sequential mailbox monitor. Record `firmware_pass_seen` on `PASS_CODE`,
finish with the only `TEST PASS` when both completion flags are true and
`errors==0`, and immediately print `TEST FAIL` on `FAIL_CODE`. Add:

```verilog
initial #(CLK_PERIOD*300000) begin
    $display("TEST TIMEOUT: detail=0x%08h status=0x%08h",
             dlb_ram[DETAIL_ADDR], dlb_ram[STATUS_ADDR]);
    $finish;
end

// initial begin
//     $dumpfile("tinyc_gpio_tb.vcd");
//     $dumpvars(0, tinyc_gpio_tb);
// end
```

- [ ] **Step 4: Register the GPIO firmware test**

Append this descriptor to `firmwareTests` in
`merc32-vsce/scripts/test-c-rtl.js`:

```javascript
{
    name: 'tinyc_gpio_test',
    top: 'tinyc_gpio_tb',
    rtlFiles: [
        ['rtl', 'debug', 'jtag_debug.v'],
        ['rtl', 'cpu', 'core.v'],
        ['rtl', 'bridge', 'lb2apb.v'],
        ['rtl', 'cpu', 'MERC32_top.v'],
        ['rtl', 'gpio', 'apb_gpio.v'],
        ['rtl', 'sim', 'tinyc_gpio_tb.v'],
    ],
},
```

- [ ] **Step 5: Run the new closed loop and observe RED**

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: prior cases pass; `tinyc_gpio_test` times out or fails because the
scaffold writes PASS without producing detail `0x2001` or any GPIO activity.

- [ ] **Step 6: Commit the failing test scaffold**

```powershell
git add -- example/tinyc_gpio_test.c rtl/sim/tinyc_gpio_tb.v `
  merc32-vsce/scripts/test-c-rtl.js
git diff --cached --check
git commit -m "test: add Tiny C GPIO closed loop"
```

### Task 2: Implement the Tiny C GPIO Driver

**Files:**
- Modify: `example/tinyc_gpio_test.c`
- Test: `rtl/sim/tinyc_gpio_tb.v`

- [ ] **Step 1: Add the complete GPIO API and ISR state**

Replace the scaffold with these driver functions before `main`:

```c
unsigned int gpio_base = 0x10020000;
volatile unsigned int gpio_irq_seen = 0;
volatile unsigned int gpio_irq_count = 0;

void gpio_init(unsigned int direction, unsigned int output) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[2] = output;
    gpio[1] = direction;
}

void gpio_write(unsigned int value) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[2] = value;
}

void gpio_set(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[3] = mask;
}

void gpio_clear(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[4] = mask;
}

void gpio_toggle(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[5] = mask;
}

unsigned int gpio_read(void) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    return gpio[6];
}

void gpio_irq_config(unsigned int type, unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[8] = 0;
    gpio[7] = type;
    gpio[9] = 0xFFFFFFFF;
    gpio[8] = mask;
}

unsigned int gpio_irq_pending(void) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    return gpio[9];
}

void gpio_irq_clear(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;
    gpio[9] = mask;
}

void __irq_handler(void) {
    unsigned int pending = gpio_irq_pending();
    if (pending != 0) {
        gpio_irq_seen = gpio_irq_seen | pending;
        gpio_irq_count = gpio_irq_count + 1;
        gpio_irq_clear(pending);
    }
}
```

- [ ] **Step 2: Add bounded input and interrupt waits**

```c
int gpio_wait_input(unsigned int expected, int limit) {
    while (gpio_read() != expected) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    return 1;
}

int gpio_wait_irq(int limit) {
    while (gpio_irq_count == 0) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    return 1;
}

int gpio_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;
    *detail = stage;
    *status = 0x0BAD;
    return 1;
}
```

- [ ] **Step 3: Implement the deterministic self-test `main`**

```c
int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;

    gpio_init(0x0000000F, 0);
    gpio_write(5);
    *detail = 0x2001;
    gpio_set(2);
    *detail = 0x2002;
    gpio_clear(1);
    *detail = 0x2003;
    gpio_toggle(0xF);
    *detail = 0x2004;

    *detail = 0x2100;
    if (gpio_wait_input(0xA0, 100000) == 0) {
        return gpio_fail(1);
    }
    *detail = 0x2101;
    if (gpio_wait_input(0, 100000) == 0) {
        return gpio_fail(2);
    }

    gpio_irq_config(2, 0x10);
    __irq_enable();
    *detail = 0x2102;
    if (gpio_wait_irq(100000) == 0) {
        return gpio_fail(3);
    }
    __irq_disable();
    if ((gpio_irq_seen & 0x10) == 0) {
        return gpio_fail(4);
    }
    if (gpio_irq_count != 1) {
        return gpio_fail(5);
    }
    if (gpio_irq_pending() != 0) {
        return gpio_fail(6);
    }

    *detail = 0x2103;
    *status = 0x600D;
    return 0;
}
```

- [ ] **Step 4: Run the GPIO closed loop and observe GREEN**

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: `tinyc_gpio_test RTL execution test passed`, one `TEST PASS`, one
GPIO interrupt rise, correct output sequence, and no failure/timeout marker.

- [ ] **Step 5: Commit the driver implementation**

```powershell
git add -- example/tinyc_gpio_test.c
git diff --cached --check
git commit -m "feat: add Tiny C GPIO driver"
```

### Task 3: Verify GPIO Unit and Suite Regressions

**Files:**
- Test: `rtl/sim/apb_gpio_tb.v`
- Test: `rtl/sim/tinyc_gpio_tb.v`

- [ ] **Step 1: Run the APB GPIO unit test**

```powershell
$gpioVvp = Join-Path $env:TEMP 'apb_gpio_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_gpio_tb -o $gpioVvp `
  rtl/gpio/apb_gpio.v rtl/sim/apb_gpio_tb.v
vvp $gpioVvp
```

Expected: exactly one `TEST PASS` and no `[FAIL]`, `TEST FAIL`, or timeout.

- [ ] **Step 2: Run compiler and complete RTL regressions**

```powershell
Push-Location merc32-vsce
npm test
npm run test:c:rtl
Pop-Location
```

Expected: all compiler and registered RTL cases pass.

- [ ] **Step 3: Check simulator coverage and repository cleanliness**

Run vks lint/compile/simulate for `tinyc_gpio_tb` if available. If not, record
the unavailable workflow and do not claim a vks result.

```powershell
git diff --check
rg --files -g '*.vvp' -g '*.vcd' -g '*.mem'
git status --short
```

Expected: no new generated artifacts or whitespace errors. Preserve all
unrelated user changes.
