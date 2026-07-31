# Tiny C Dual-Timer Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-channel Tiny C timer driver and prove periodic CPU interrupts, W1C service, independent channel control, and PWM timing on the current dual-timer RTL.

**Architecture:** A standalone firmware configures Timer 0 as a slow interrupt source and Timer 1 as a faster normal-mode PWM source. A dedicated CPU-plus-timer testbench measures external PWM and interrupt behavior while the firmware checks driver return values, tick progress, and shutdown.

**Tech Stack:** Tiny C, MERC32 assembler/CPU, Verilog-2005, APB dual timer, `timer_channel`, Node.js RTL runner, Icarus Verilog; use vks lint/compile/simulate if available.

---

## File Map

- Create `example/tinyc_timer_test.c`: channel-aware driver, ISR, and bounded self-test.
- Create `rtl/sim/tinyc_timer_tb.v`: CPU/APB integration, PWM measurement, IRQ monitor, and verdict.
- Modify `merc32-vsce/scripts/test-c-rtl.js`: register the timer test and its RTL dependencies.

### Task 1: Define Timer Behavior as RED

**Files:**
- Create: `example/tinyc_timer_test.c`
- Create: `rtl/sim/tinyc_timer_tb.v`
- Modify: `merc32-vsce/scripts/test-c-rtl.js`

- [ ] **Step 1: Add a mailbox-only compilable firmware scaffold**

```c
int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    *status = 0x600D;
    return 0;
}
```

The physical monitor will reject this premature pass because no PWM period or
timer interrupt is observed.

- [ ] **Step 2: Create the CPU-plus-timer harness**

Create `rtl/sim/tinyc_timer_tb.v` with a 10 ns clock, synchronous active-low
reset release after five clocks, 65536-word ROM/DLB arrays, the standard
`STATUS_ADDR=240` and `DETAIL_ADDR=241`, and `+ROM_FILE`/`+ROM_WORDS` loading.
Instantiate:

```verilog
MERC32_top #(
    .ILB_ADDR_WIDTH (16),
    .DLB_ADDR_WIDTH (16)
) MERC32_top_inst (
    .clk           (clk),
    .rst_n         (rst_n),
    .interrupt     (timer_interrupt),
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

apb_timer apb_timer_inst (
    .s_apb_pclk    (apb_pclk),
    .s_apb_presetn (apb_presetn),
    .s_apb_psel    (apb_psel),
    .s_apb_penable (apb_penable),
    .s_apb_pwrite  (apb_pwrite),
    .s_apb_paddr   (apb_paddr),
    .s_apb_pwdata  (apb_pwdata),
    .s_apb_pready  (apb_pready),
    .s_apb_pslverr (apb_pslverr),
    .s_apb_prdata  (apb_prdata),
    .interrupt     (timer_interrupt),
    .pwm0          (pwm0),
    .pwm1          (pwm1)
);
```

Declare every signal named in the instantiation above. Drive ROM
asynchronously, write ROM/DLB on `posedge clk`, and register DLB reads:

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

- [ ] **Step 3: Add PWM and IRQ measurement**

Track Timer 1 PWM edges only after firmware writes detail `0x3001`:

```verilog
integer pwm_cycle = 0;
integer last_pwm_rise = -1;
integer last_pwm_fall = -1;
integer pwm_period_checks = 0;
integer pwm_width_checks = 0;
integer irq_rise_count = 0;
integer errors = 0;
reg pwm_measure_enable = 1'b0;

always @(posedge clk) begin
    if (!rst_n) begin
        pwm_cycle <= 0;
        last_pwm_rise <= -1;
        last_pwm_fall <= -1;
    end else begin
        pwm_cycle <= pwm_cycle + 1;
        if (dlb_ram[DETAIL_ADDR] == 32'h0000_3001)
            pwm_measure_enable <= 1'b1;
    end
end

always @(posedge pwm1) begin
    if (pwm_measure_enable) begin
        if (last_pwm_rise >= 0) begin
            if ((pwm_cycle - last_pwm_rise) != 32) begin
                $display("TEST FAIL: PWM period expected=32 actual=%0d",
                         pwm_cycle - last_pwm_rise);
                errors = errors + 1;
            end
            pwm_period_checks = pwm_period_checks + 1;
        end
        last_pwm_rise = pwm_cycle;
    end
end

always @(negedge pwm1) begin
    if (pwm_measure_enable && (last_pwm_rise >= 0)) begin
        if ((pwm_cycle - last_pwm_rise) != 8) begin
            $display("TEST FAIL: PWM width expected=8 actual=%0d",
                     pwm_cycle - last_pwm_rise);
            errors = errors + 1;
        end
        last_pwm_fall = pwm_cycle;
        pwm_width_checks = pwm_width_checks + 1;
    end
end

always @(posedge timer_interrupt)
    irq_rise_count = irq_rise_count + 1;
```

At firmware detail `0x3002`, require `timer_interrupt==0`, at least three IRQ
rises, at least two correct PWM periods, and at least two correct active-width
checks. Sample another 64 clocks and require PWM edges to continue after Timer
0 stops.

- [ ] **Step 4: Add final mailbox and timeout behavior**

The sequential verdict monitor must reject `0x0BAD`, remember `0x600D`, and
print exactly one `TEST PASS` only after firmware pass and the Timer 0-stopped
physical checks both complete. Add:

```verilog
initial #(CLK_PERIOD*500000) begin
    $display("TEST TIMEOUT: detail=0x%08h status=0x%08h irq_rises=%0d",
             dlb_ram[DETAIL_ADDR], dlb_ram[STATUS_ADDR], irq_rise_count);
    $finish;
end

// initial begin
//     $dumpfile("tinyc_timer_tb.vcd");
//     $dumpvars(0, tinyc_timer_tb);
// end
```

- [ ] **Step 5: Register the timer test in the Node runner**

Append to `firmwareTests`:

```javascript
{
    name: 'tinyc_timer_test',
    top: 'tinyc_timer_tb',
    rtlFiles: [
        ['rtl', 'debug', 'jtag_debug.v'],
        ['rtl', 'cpu', 'core.v'],
        ['rtl', 'bridge', 'lb2apb.v'],
        ['rtl', 'cpu', 'MERC32_top.v'],
        ['rtl', 'timer', 'timer_channel.v'],
        ['rtl', 'timer', 'apb_timer.v'],
        ['rtl', 'sim', 'tinyc_timer_tb.v'],
    ],
},
```

- [ ] **Step 6: Run and observe RED**

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: prior cases pass; `tinyc_timer_test` fails or times out because the
scaffold produces neither detail `0x3001`, PWM, nor timer interrupts.

- [ ] **Step 7: Commit the failing timer test**

```powershell
git add -- example/tinyc_timer_test.c rtl/sim/tinyc_timer_tb.v `
  merc32-vsce/scripts/test-c-rtl.js
git diff --cached --check
git commit -m "test: add Tiny C dual-timer closed loop"
```

### Task 2: Implement the Channel-Aware Timer Driver

**Files:**
- Modify: `example/tinyc_timer_test.c`
- Test: `rtl/sim/tinyc_timer_tb.v`

- [ ] **Step 1: Add common register and channel operations**

```c
unsigned int timer_base = 0x10030000;
volatile unsigned int timer_ticks = 0;

void timer_disable(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    unsigned int control = timer[0] & 3;
    if (channel == 0) {
        control = control & 2;
    } else if (channel == 1) {
        control = control & 1;
    }
    timer[0] = control;
}

void timer_enable(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    unsigned int control = timer[0] & 3;
    if (channel == 0) {
        control = control | 1;
    } else if (channel == 1) {
        control = control | 2;
    }
    timer[0] = control;
}

void timer_clear(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    unsigned int control = timer[0] & 3;
    if (channel == 0) {
        timer[0] = control | 0x100;
    } else if (channel == 1) {
        timer[0] = control | 0x200;
    }
}

int timer_configure(unsigned int channel, unsigned int config,
                    unsigned int count_max,
                    unsigned int pwm_compare) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    if (channel == 0) {
        timer_disable(0);
        timer[3] = config;
        timer[5] = count_max;
        timer[6] = pwm_compare;
        timer_clear(0);
        return 1;
    }
    if (channel == 1) {
        timer_disable(1);
        timer[7] = config;
        timer[9] = count_max;
        timer[10] = pwm_compare;
        timer_clear(1);
        return 1;
    }
    return 0;
}

unsigned int timer_count(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    if (channel == 0) {
        return timer[4];
    }
    if (channel == 1) {
        return timer[8];
    }
    return 0;
}
```

- [ ] **Step 2: Add IRQ operations and the minimal ISR**

```c
void timer_irq_enable(unsigned int mask) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    timer[2] = mask & 7;
}

unsigned int timer_irq_pending(void) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    return timer[1] & 7;
}

void timer_irq_clear(unsigned int mask) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    timer[1] = mask & 7;
}

void __irq_handler(void) {
    unsigned int pending = timer_irq_pending();
    if ((pending & 1) != 0) {
        timer_irq_clear(1);
        timer_ticks = timer_ticks + 1;
    }
    if ((pending & 6) != 0) {
        timer_irq_clear(pending & 6);
    }
}
```

- [ ] **Step 3: Add the bounded timer self-test**

```c
int timer_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;
    *detail = stage;
    *status = 0x0BAD;
    return 1;
}

int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;
    unsigned int stopped_ticks = 0;
    int remaining = 400000;
    int settle = 256;

    if (timer_configure(2, 0, 1, 0) != 0) {
        return timer_fail(1);
    }
    if (timer_configure(0, 0, 4095, 0) == 0) {
        return timer_fail(2);
    }
    if (timer_configure(1, 2, 31, 8) == 0) {
        return timer_fail(3);
    }

    timer_irq_clear(7);
    timer_irq_enable(1);
    timer_enable(1);
    timer_enable(0);
    __irq_enable();
    *detail = 0x3001;

    while ((timer_ticks < 3) && (remaining > 0)) {
        remaining = remaining - 1;
    }
    if (remaining == 0) {
        return timer_fail(4);
    }

    timer_disable(0);
    __irq_disable();
    timer_irq_enable(0);
    timer_irq_clear(7);
    stopped_ticks = timer_ticks;
    while (settle > 0) {
        settle = settle - 1;
    }
    if (timer_ticks != stopped_ticks) {
        return timer_fail(5);
    }
    if (timer_irq_pending() != 0) {
        return timer_fail(6);
    }

    *detail = 0x3002;
    *status = 0x600D;
    return 0;
}
```

- [ ] **Step 4: Run and observe GREEN**

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: `tinyc_timer_test RTL execution test passed`, at least three separate
IRQ rises, correct 32-clock PWM periods and 8-clock active widths, continued
PWM after Timer 0 shutdown, and no failure/timeout marker.

- [ ] **Step 5: Commit the driver**

```powershell
git add -- example/tinyc_timer_test.c
git diff --cached --check
git commit -m "feat: add Tiny C dual-timer driver"
```

### Task 3: Run Timer and Full Regressions

**Files:**
- Test: `rtl/sim/apb_timer_tb.v`
- Test: `rtl/sim/tinyc_timer_tb.v`

- [ ] **Step 1: Run the APB timer unit test**

```powershell
$timerVvp = Join-Path $env:TEMP 'apb_timer_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_timer_tb -o $timerVvp `
  rtl/timer/timer_channel.v rtl/timer/apb_timer.v rtl/sim/apb_timer_tb.v
vvp $timerVvp
```

Expected: exactly one `TEST PASS` and no failure/timeout marker.

- [ ] **Step 2: Run compiler and registered RTL suites**

```powershell
Push-Location merc32-vsce
npm test
npm run test:c:rtl
Pop-Location
```

Expected: all cases pass.

- [ ] **Step 3: Check vks availability and artifacts**

Run vks lint/compile/simulate for `tinyc_timer_tb` if available; otherwise
record that the workflow is unavailable. Then run:

```powershell
git diff --check
rg --files -g '*.vvp' -g '*.vcd' -g '*.mem'
git status --short
```

Expected: no new simulator artifacts or whitespace errors, and unrelated user
changes remain untouched.
