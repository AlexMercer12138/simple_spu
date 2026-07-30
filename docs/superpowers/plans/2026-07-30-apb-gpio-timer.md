# APB GPIO and Dual Timer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add standalone 32-bit APB GPIO and dual-channel APB timer peripherals with synchronized GPIO interrupts, binary periodic counters, registered cascade events, PWM outputs, tests, and programming manuals.

**Architecture:** `apb_gpio` is a self-contained APB wrapper. `apb_timer` owns APB, configuration protection, interrupt state, and cascade routing while instantiating two identical APB-independent `timer_channel` modules. All state uses synchronous active-low reset, simple combinational logic uses `assign`, and no module uses `always @(*)`.

**Tech Stack:** Verilog-2005, APB3-style slave timing, vks MCP simulation when available, Icarus Verilog, ModelSim SE 2020.4, Git.

---

## File Structure

- Create `rtl/timer/timer_channel.v`: one binary periodic counter, registered overflow pulse, and edge-aligned PWM generator.
- Create `rtl/sim/timer_channel_tb.v`: independent self-checking timer-channel testbench.
- Create `rtl/gpio/apb_gpio.v`: APB register interface, GPIO synchronization, atomic output control, and interrupt logic.
- Create `rtl/sim/apb_gpio_tb.v`: self-checking APB GPIO unit testbench.
- Create `rtl/gpio/apb_gpio_manual.md`: GPIO register map and programming rules.
- Create `rtl/timer/apb_timer.v`: APB dual-timer wrapper, two channel instances, cascade routing, protected configuration, and interrupts.
- Create `rtl/sim/apb_timer_tb.v`: self-checking APB timer integration testbench.
- Create `rtl/timer/apb_timer_manual.md`: timer register map, PWM, cascade, and interrupt programming rules.
- Modify `docs/superpowers/plans/2026-07-30-apb-gpio-timer.md`: mark completed steps during execution.

Generated simulator files go under `build/apb_gpio_timer/`. Preserve that build cache. Remove only root-level simulator outputs created by the verification commands, such as `transcript`, after verifying their absolute paths are inside the repository.

GPIO and TIMER are independently testable, but they remain in one plan because
the user approved them as one peripheral-development scope. Tasks 1 through 3
still end in separate working commits, so execution can stop or resume at a
component boundary without leaving either peripheral half-implemented.

## Task 1: Binary Timer Channel

**Files:**
- Create: `rtl/sim/timer_channel_tb.v`
- Create: `rtl/timer/timer_channel.v`

- [ ] **Step 1: Write the failing `timer_channel` testbench**

Create a Verilog-2005 self-checking testbench with this DUT contract:

```verilog
reg         clk = 1'b0;
reg         rst_n = 1'b0;
reg         enable = 1'b0;
reg         clear = 1'b0;
reg         count_tick = 1'b0;
reg  [31:0] count_max = 32'hffff_ffff;
reg  [31:0] pwm_compare = 32'd0;
reg  [1:0]  pwm_mode = 2'b00;
reg         pwm_polarity = 1'b0;
wire [31:0] count;
wire        overflow;
wire        pwm;

always #(5) clk = ~clk;
initial #(20) rst_n = 1'b1;

timer_channel timer_channel_inst (
    .clk          (clk),
    .rst_n        (rst_n),
    .enable       (enable),
    .clear        (clear),
    .count_tick   (count_tick),
    .count_max    (count_max),
    .pwm_compare  (pwm_compare),
    .pwm_mode     (pwm_mode),
    .pwm_polarity (pwm_polarity),
    .count        (count),
    .overflow     (overflow),
    .pwm          (pwm)
);
```

Use nonblocking stimulus around clock edges and define exact helpers:

```verilog
task check_equal;
    input [255:0] name;
    input [31:0] actual;
    input [31:0] expected;
    begin
        if (actual !== expected) begin
            $display("[FAIL] %0s actual=%h expected=%h", name, actual, expected);
            errors = errors + 1;
        end else begin
            $display("[PASS] %0s value=%h", name, actual);
        end
    end
endtask

task tick_once;
    begin
        @(negedge clk);
        count_tick <= 1'b1;
        @(negedge clk);
        count_tick <= 1'b0;
    end
endtask
```

The stimulus must prove:

```verilog
// Disabled hold.
count_max <= 32'd3;
tick_once;
check_equal("disabled hold", count, 32'd0);

// Inclusive 0,1,2,3 period and one-cycle overflow.
enable <= 1'b1;
tick_once; check_equal("count 1", count, 32'd1);
tick_once; check_equal("count 2", count, 32'd2);
tick_once; check_equal("count 3", count, 32'd3);
tick_once; check_equal("reload", count, 32'd0);
check_equal("overflow asserted", overflow, 32'd1);
@(negedge clk);
check_equal("overflow clears", overflow, 32'd0);

// MAX=0 overflows on every eligible tick.
enable <= 1'b0;
count_max <= 32'd0;
clear <= 1'b1;
@(negedge clk);
clear <= 1'b0;
enable <= 1'b1;
tick_once;
check_equal("max zero count", count, 32'd0);
check_equal("max zero overflow", overflow, 32'd1);

// PWM: mode 01 normal, 10 forced inactive, 11 forced active.
pwm_mode <= 2'b01;
pwm_compare <= 32'd2;
count_max <= 32'd3;
// After clear, expect active at counts 0 and 1 and inactive at 2 and 3.
```

Also cover clear priority, `COUNT>MAX` recovery after changing `count_max` while disabled, zero duty, `pwm_compare>count_max` full duty, forced modes, active-low polarity, and inactive output while disabled. End with exactly one `TEST PASS` or `TEST FAIL`, include commented `$dumpfile/$dumpvars`, and add `initial #(20000) begin $display("TEST TIMEOUT"); $finish; end`.

- [ ] **Step 2: Run the timer-channel test and verify RED**

Run:

```powershell
New-Item -ItemType Directory -Force build\apb_gpio_timer
iverilog -g2005 -Wall -s timer_channel_tb -o build\apb_gpio_timer\timer_channel_tb.vvp rtl\sim\timer_channel_tb.v
```

Expected: elaboration fails with `Unknown module type: timer_channel`. A syntax error in the testbench is not an acceptable RED result.

- [ ] **Step 3: Implement `timer_channel`**

Create `rtl/timer/timer_channel.v` with this complete functional structure:

```verilog
`timescale 1ns/1ps

module timer_channel (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        enable,
    input  wire        clear,
    input  wire        count_tick,
    input  wire [31:0] count_max,
    input  wire [31:0] pwm_compare,
    input  wire [1:0]  pwm_mode,
    input  wire        pwm_polarity,
    output wire [31:0] count,
    output wire        overflow,
    output wire        pwm
);

    reg  [31:0] count_reg;
    reg         overflow_reg;
    wire        normal_active;
    wire        pwm_active;

    assign count = count_reg;
    assign overflow = overflow_reg;
    assign normal_active = count_reg < pwm_compare;
    assign pwm_active = enable &&
                        (((pwm_mode == 2'b01) && normal_active) ||
                         (pwm_mode == 2'b11));
    assign pwm = pwm_polarity ? ~pwm_active : pwm_active;

    always @(posedge clk) begin
        if (!rst_n) begin
            count_reg <= 32'd0;
            overflow_reg <= 1'b0;
        end else begin
            overflow_reg <= 1'b0;
            if (clear) begin
                count_reg <= 32'd0;
            end else if (enable && count_tick) begin
                if (count_reg >= count_max) begin
                    count_reg <= 32'd0;
                    overflow_reg <= 1'b1;
                end else begin
                    count_reg <= count_reg + 1'b1;
                end
            end
        end
    end

endmodule
```

Do not add prescalers, one-shot mode, Gray-code state, or an APB dependency.

- [ ] **Step 4: Run the timer-channel test and verify GREEN**

Run:

```powershell
iverilog -g2005 -Wall -s timer_channel_tb -o build\apb_gpio_timer\timer_channel_tb.vvp rtl\timer\timer_channel.v rtl\sim\timer_channel_tb.v
vvp build\apb_gpio_timer\timer_channel_tb.vvp
```

Expected: one `TEST PASS`, no `TEST FAIL`, no `TEST TIMEOUT`, and zero compile errors.

- [ ] **Step 5: Commit the timer channel**

```powershell
git add -- rtl/timer/timer_channel.v rtl/sim/timer_channel_tb.v
git diff --cached --check
git commit -m "feat: add binary timer channel"
```

## Task 2: APB GPIO Peripheral

**Files:**
- Create: `rtl/sim/apb_gpio_tb.v`
- Create: `rtl/gpio/apb_gpio.v`
- Create: `rtl/gpio/apb_gpio_manual.md`

- [ ] **Step 1: Write the failing APB GPIO testbench**

Instantiate `apb_gpio` with all APB and GPIO ports. Use a 10 ns clock,
synchronous reset release, APB read/write tasks, a self-checking `check_equal`
task, commented VCD calls, and an explicit 100 us timeout.

Use these APB helpers exactly as the timing baseline:

```verilog
task apb_write;
    input [31:0] addr;
    input [31:0] data;
    begin
        @(negedge clk);
        s_apb_psel <= 1'b1;
        s_apb_penable <= 1'b0;
        s_apb_pwrite <= 1'b1;
        s_apb_paddr <= addr;
        s_apb_pwdata <= data;
        @(negedge clk);
        s_apb_penable <= 1'b1;
        while (!s_apb_pready)
            @(negedge clk);
        @(negedge clk);
        s_apb_psel <= 1'b0;
        s_apb_penable <= 1'b0;
        s_apb_pwrite <= 1'b0;
    end
endtask

task apb_read;
    input  [31:0] addr;
    output [31:0] data;
    begin
        @(negedge clk);
        s_apb_psel <= 1'b1;
        s_apb_penable <= 1'b0;
        s_apb_pwrite <= 1'b0;
        s_apb_paddr <= addr;
        @(negedge clk);
        s_apb_penable <= 1'b1;
        while (!s_apb_pready)
            @(negedge clk);
        data = s_apb_prdata;
        @(negedge clk);
        s_apb_psel <= 1'b0;
        s_apb_penable <= 1'b0;
    end
endtask
```

Required checks and exact register addresses are:

```verilog
localparam ADDR_CTRL       = 32'h00;
localparam ADDR_GPIO_DIR   = 32'h04;
localparam ADDR_GPIO_OUT   = 32'h08;
localparam ADDR_GPIO_SET   = 32'h0c;
localparam ADDR_GPIO_CLEAR = 32'h10;
localparam ADDR_GPIO_TOGGLE= 32'h14;
localparam ADDR_GPIO_IN    = 32'h18;
localparam ADDR_IRQ_TYPE   = 32'h1c;
localparam ADDR_IRQ_ENABLE = 32'h20;
localparam ADDR_IRQ_STATUS = 32'h24;
```

The test must verify:

- Reset: `GPIO_DIR=0`, `GPIO_OUT=0`, `IRQ_TYPE=7`, enables/status zero,
  `gpio_t=32'hffff_ffff`, `gpio_o=0`, `interrupt=0`, and `PSLVERR=0`.
- Registered `PREADY`: low in setup, high in access, then low after completion.
- Direct output write followed by exact SET, CLEAR, and TOGGLE bit masks.
- `gpio_o` keeps the output latch while `gpio_t=~GPIO_DIR`.
- `GPIO_IN` remains zero before synchronization is valid, then equals `gpio_i`.
- Low, high, rising, falling, and both-edge types on selected input pins.
- No false edge on the first synchronized sample or when direction changes.
- Output-configured pins cannot create new events.
- Pending records while masked; enabling a pending bit asserts `interrupt`.
- W1C clears an edge event; level events reassert while the level persists.
- An active level wins over a same-cycle W1C clear.
- Writing `IRQ_TYPE` clears pending and rebases edge history.
- Types 5 through 7 produce no event.
- Software reset restores all reset values.
- Undefined reads return zero and undefined writes do nothing.

- [ ] **Step 2: Run the APB GPIO test and verify RED**

```powershell
iverilog -g2005 -Wall -s apb_gpio_tb -o build\apb_gpio_timer\apb_gpio_tb.vvp rtl\sim\apb_gpio_tb.v
```

Expected: elaboration fails only because `apb_gpio` is missing.

- [ ] **Step 3: Implement APB timing, GPIO data, and synchronization**

Create `rtl/gpio/apb_gpio.v` with the approved APB ports and register addresses.
Use these exact core assignments and synchronous `PREADY` behavior:

```verilog
wire        clk;
wire        rst_n;
wire [9:0]  word_addr;
wire        apb_setup;
wire        apb_write_access;
wire        ctrl_write;
wire        soft_reset_write;

assign clk = s_apb_pclk;
assign rst_n = s_apb_presetn;
assign word_addr = s_apb_paddr[11:2];
assign apb_setup = s_apb_psel && !s_apb_penable;
assign apb_write_access = s_apb_psel && s_apb_penable &&
                          s_apb_pwrite && apb_pready;
assign ctrl_write = apb_write_access && (word_addr == 10'd0);
assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
assign s_apb_pready = apb_pready;
assign s_apb_pslverr = 1'b0;
assign s_apb_prdata = apb_prdata;

always @(posedge clk) begin
    if (!rst_n)
        apb_pready <= 1'b0;
    else if (s_apb_psel && apb_pready)
        apb_pready <= 1'b0;
    else if (s_apb_psel)
        apb_pready <= 1'b1;
    else
        apb_pready <= 1'b0;
end
```

Implement the data path without resetting the two synchronizer data registers:

```verilog
assign gpio_o = gpio_out_reg;
assign gpio_t = ~gpio_dir_reg;
assign gpio_in_value = sync_valid ? gpio_sync_ff1 : 32'd0;

always @(posedge clk) begin
    gpio_sync_ff0 <= gpio_i;
    gpio_sync_ff1 <= gpio_sync_ff0;
end

always @(posedge clk) begin
    if (!rst_n || soft_reset_write)
        sync_valid_pipe <= 2'b00;
    else
        sync_valid_pipe <= {sync_valid_pipe[0], 1'b1};
end
```

Store `GPIO_DIR`, `GPIO_OUT`, and atomic updates in one sequential block. Reset
direction/output to zero. On writes, use:

```verilog
case (word_addr)
    10'd1: gpio_dir_reg <= s_apb_pwdata;
    10'd2: gpio_out_reg <= s_apb_pwdata;
    10'd3: gpio_out_reg <= gpio_out_reg | s_apb_pwdata;
    10'd4: gpio_out_reg <= gpio_out_reg & ~s_apb_pwdata;
    10'd5: gpio_out_reg <= gpio_out_reg ^ s_apb_pwdata;
    default: begin
    end
endcase
```

- [ ] **Step 4: Implement GPIO interrupt detection and APB reads**

Use a combinational function, not `always @(*)`, for trigger decoding:

```verilog
function [31:0] irq_event_value;
    input [2:0]  trigger_type;
    input [31:0] current_value;
    input [31:0] previous_value;
    input        edge_history_valid;
    begin
        case (trigger_type)
            3'd0: irq_event_value = ~current_value;
            3'd1: irq_event_value = current_value;
            3'd2: irq_event_value = edge_history_valid ?
                                      current_value & ~previous_value : 32'd0;
            3'd3: irq_event_value = edge_history_valid ?
                                      ~current_value & previous_value : 32'd0;
            3'd4: irq_event_value = edge_history_valid ?
                                      current_value ^ previous_value : 32'd0;
            default: irq_event_value = 32'd0;
        endcase
    end
endfunction
```

Derive the event and interrupt as:

```verilog
assign irq_type_write = apb_write_access && (word_addr == 10'd7);
assign irq_status_write = apb_write_access && (word_addr == 10'd9);
assign irq_event = (sync_valid && !irq_type_write) ?
                   (~gpio_dir_reg & irq_event_value(
                       irq_type_reg, gpio_sync_ff1, gpio_previous_reg,
                       irq_history_valid)) : 32'd0;
assign interrupt = |(irq_status_reg & irq_enable_reg);
```

Track `gpio_previous_reg` on every valid synchronized cycle. On the first valid
cycle or an `IRQ_TYPE` write, load the current synchronized value without
creating an edge. Reset `irq_history_valid` to zero.

Update pending with the required priority:

```verilog
if (!rst_n || soft_reset_write) begin
    irq_status_reg <= 32'd0;
end else if (irq_type_write) begin
    irq_status_reg <= 32'd0;
end else begin
    irq_status_reg <=
        (irq_status_reg & ~(irq_status_write ? s_apb_pwdata : 32'd0)) |
        irq_event;
end
```

Reset `irq_type_reg` to `3'd7` and `irq_enable_reg` to zero. Read data during APB
setup with exact word addresses 0 through 9. `CTRL`, SET, CLEAR, and TOGGLE read
zero; undefined addresses read zero.

- [ ] **Step 5: Run the APB GPIO test and verify GREEN**

```powershell
iverilog -g2005 -Wall -s apb_gpio_tb -o build\apb_gpio_timer\apb_gpio_tb.vvp rtl\gpio\apb_gpio.v rtl\sim\apb_gpio_tb.v
vvp build\apb_gpio_timer\apb_gpio_tb.vvp
```

Expected: one `TEST PASS`, no failure/timeout markers, and zero compile errors.

- [ ] **Step 6: Write the GPIO programming manual**

Create `rtl/gpio/apb_gpio_manual.md`. Include the byte-offset register table,
reset values, `gpio_t=~GPIO_DIR`, two-cycle synchronizer latency, type codes
0 through 4, reserved types 5 through 7, raw pending independent of the enable
mask, W1C set priority, type-write clearing, and this programming order:

```text
1. Write GPIO_OUT or an atomic output register.
2. Write GPIO_DIR to enable selected outputs.
3. Write IRQ_TYPE; this clears old pending state.
4. Clear IRQ_STATUS with all ones.
5. Write IRQ_ENABLE.
6. Service IRQ_STATUS and clear handled bits with W1C.
```

- [ ] **Step 7: Commit the APB GPIO peripheral**

```powershell
git add -- rtl/gpio/apb_gpio.v rtl/gpio/apb_gpio_manual.md rtl/sim/apb_gpio_tb.v
git diff --cached --check
git commit -m "feat: add APB GPIO peripheral"
```

## Task 3: APB Dual Timer Peripheral

**Files:**
- Create: `rtl/sim/apb_timer_tb.v`
- Create: `rtl/timer/apb_timer.v`
- Create: `rtl/timer/apb_timer_manual.md`
- Reuse: `rtl/timer/timer_channel.v`

- [ ] **Step 1: Write the failing APB timer testbench**

Instantiate `apb_timer`, use the same APB helper timing as Task 2, and define:

```verilog
localparam ADDR_CTRL       = 32'h00;
localparam ADDR_IRQ_STATUS = 32'h04;
localparam ADDR_IRQ_ENABLE = 32'h08;
localparam ADDR_T0_CONFIG  = 32'h0c;
localparam ADDR_T0_COUNT   = 32'h10;
localparam ADDR_T0_MAX     = 32'h14;
localparam ADDR_T0_COMPARE = 32'h18;
localparam ADDR_T1_CONFIG  = 32'h1c;
localparam ADDR_T1_COUNT   = 32'h20;
localparam ADDR_T1_MAX     = 32'h24;
localparam ADDR_T1_COMPARE = 32'h28;
```

Required checks:

- Reset values and register masks exactly match the design spec.
- `PREADY` is registered, `PSLVERR=0`, and undefined reads return zero.
- Timer 0 and timer 1 count independently from PCLK.
- Disable holds count; clear resets count and wins over a count tick.
- `MAX=0` creates repeated overflow pending.
- Timer 0 sourced from timer 1 and timer 1 sourced from timer 0 each work in
  separate configurations.
- With source `MAX=3` and cascaded channel `MAX=1`, the cascaded channel
  overflow rate is one event per eight PCLK cycles after startup.
- Attempting to configure both channels from each other leaves the rejected
  register unchanged and sets configuration-error pending.
- Writes to CONFIG, MAX, or COMPARE while that channel is enabled are rejected.
- Pending records while masked; enabling it asserts the combined interrupt.
- W1C clears pending, while an overflow on the same cycle wins. Use `MAX=0`
  while enabled to make the set-wins case deterministic.
- PWM0 and PWM1 reflect normal, forced, polarity, and disabled behavior.
- Software reset restores both channels and all interrupt state.

End with one `TEST PASS` or `TEST FAIL`, commented VCD calls, and an explicit
200 us timeout.

- [ ] **Step 2: Run the APB timer test and verify RED**

```powershell
iverilog -g2005 -Wall -s apb_timer_tb -o build\apb_gpio_timer\apb_timer_tb.vvp rtl\timer\timer_channel.v rtl\sim\apb_timer_tb.v
```

Expected: elaboration fails only because `apb_timer` is missing.

- [ ] **Step 3: Implement APB registers and configuration protection**

Create `rtl/timer/apb_timer.v` with the common APB contract and exact word
addresses 0 through 10. Store:

```verilog
reg  [1:0]  timer_enable_reg;
reg  [3:0]  timer0_config_reg;
reg  [3:0]  timer1_config_reg;
reg  [31:0] timer0_max_reg;
reg  [31:0] timer1_max_reg;
reg  [31:0] timer0_compare_reg;
reg  [31:0] timer1_compare_reg;
reg  [2:0]  irq_status_reg;
reg  [2:0]  irq_enable_reg;
```

Decode protected writes explicitly:

```verilog
assign timer0_config_write = apb_write_access && (word_addr == 10'd3);
assign timer0_max_write = apb_write_access && (word_addr == 10'd5);
assign timer0_compare_write = apb_write_access && (word_addr == 10'd6);
assign timer1_config_write = apb_write_access && (word_addr == 10'd7);
assign timer1_max_write = apb_write_access && (word_addr == 10'd9);
assign timer1_compare_write = apb_write_access && (word_addr == 10'd10);

assign timer0_running_reject = timer_enable_reg[0] &&
    (timer0_config_write || timer0_max_write || timer0_compare_write);
assign timer1_running_reject = timer_enable_reg[1] &&
    (timer1_config_write || timer1_max_write || timer1_compare_write);
assign timer0_cycle_reject = timer0_config_write &&
    !timer_enable_reg[0] && s_apb_pwdata[0] && timer1_config_reg[0];
assign timer1_cycle_reject = timer1_config_write &&
    !timer_enable_reg[1] && s_apb_pwdata[0] && timer0_config_reg[0];
assign config_error_event = timer0_running_reject ||
                            timer1_running_reject ||
                            timer0_cycle_reject || timer1_cycle_reject;
```

Accept each protected write only when its running and cycle-reject conditions
are false. Mask CONFIG to `PWDATA[3:0]`, IRQ registers to `[2:0]`, and CTRL
stored enables to `[1:0]`. Reset MAX values to `32'hffff_ffff`; reset every
other stored field to zero.

Derive pulse semantics:

```verilog
assign ctrl_write = apb_write_access && (word_addr == 10'd0);
assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
assign timer0_clear = ctrl_write && !soft_reset_write && s_apb_pwdata[8];
assign timer1_clear = ctrl_write && !soft_reset_write && s_apb_pwdata[9];
assign timer_core_rst_n = rst_n && !soft_reset_write;
```

- [ ] **Step 4: Instantiate channels, route cascade, and implement interrupts**

Route only registered channel events:

```verilog
assign timer0_tick = timer0_config_reg[0] ? timer1_overflow : 1'b1;
assign timer1_tick = timer1_config_reg[0] ? timer0_overflow : 1'b1;

timer_channel timer_channel0_inst (
    .clk          (clk),
    .rst_n        (timer_core_rst_n),
    .enable       (timer_enable_reg[0]),
    .clear        (timer0_clear),
    .count_tick   (timer0_tick),
    .count_max    (timer0_max_reg),
    .pwm_compare  (timer0_compare_reg),
    .pwm_mode     (timer0_config_reg[2:1]),
    .pwm_polarity (timer0_config_reg[3]),
    .count        (timer0_count),
    .overflow     (timer0_overflow),
    .pwm          (pwm0)
);
```

Instantiate channel 1 with the corresponding timer 1 signals and `pwm1`.

Set pending from registered overflow and configuration errors:

```verilog
assign irq_status_write = apb_write_access && (word_addr == 10'd1);
assign irq_events = {config_error_event, timer1_overflow, timer0_overflow};
assign interrupt = |(irq_status_reg & irq_enable_reg);

always @(posedge clk) begin
    if (!rst_n || soft_reset_write) begin
        irq_status_reg <= 3'b000;
    end else begin
        irq_status_reg <=
            (irq_status_reg & ~(irq_status_write ?
                                s_apb_pwdata[2:0] : 3'b000)) |
            irq_events;
    end
end
```

Implement setup-phase read data for CTRL, IRQ, both CONFIG/COUNT/MAX/COMPARE
groups, and zero for undefined addresses. CTRL reads only stored enable bits.

- [ ] **Step 5: Run the APB timer test and verify GREEN**

```powershell
iverilog -g2005 -Wall -s apb_timer_tb -o build\apb_gpio_timer\apb_timer_tb.vvp rtl\timer\timer_channel.v rtl\timer\apb_timer.v rtl\sim\apb_timer_tb.v
vvp build\apb_gpio_timer\apb_timer_tb.vvp
```

Expected: one `TEST PASS`, no failure/timeout markers, and zero compile errors.

- [ ] **Step 6: Write the timer programming manual**

Create `rtl/timer/apb_timer_manual.md` with the exact register map, bit fields,
reset values, protected-write rules, W1C behavior, inclusive `MAX+1` period,
one-cycle registered cascade event, one-cycle wrapper pending latency, PWM modes,
and the Gray-code rejection rationale. Include these sequences:

```text
Independent periodic timer:
disable -> write CONFIG/MAX/COMPARE -> pulse CLEAR -> enable -> service W1C IRQ

Cascaded timer:
disable both -> configure source channel for PCLK -> configure destination
for other-overflow -> write both MAX values -> clear both -> enable both

PWM:
disable channel -> write MAX and COMPARE -> choose normal/force mode and
polarity -> clear -> enable
```

- [ ] **Step 7: Commit the APB timer peripheral**

```powershell
git add -- rtl/timer/apb_timer.v rtl/timer/apb_timer_manual.md rtl/sim/apb_timer_tb.v
git diff --cached --check
git commit -m "feat: add APB dual timer peripheral"
```

## Task 4: Complete Verification and Repository Audit

**Files:**
- Verify: all files created in Tasks 1 through 3
- Modify: `docs/superpowers/plans/2026-07-30-apb-gpio-timer.md`

- [ ] **Step 1: Check vks availability and run the primary flow when present**

Inspect the active tool inventory for `vks_lint`, `vks_compile`, and
`vks_simulate`.

When available, run each top independently:

```text
timer_channel_tb: rtl/timer/timer_channel.v rtl/sim/timer_channel_tb.v
apb_gpio_tb:      rtl/gpio/apb_gpio.v rtl/sim/apb_gpio_tb.v
apb_timer_tb:     rtl/timer/timer_channel.v rtl/timer/apb_timer.v rtl/sim/apb_timer_tb.v
```

For each top, call `vks_lint`, call `vks_compile` to create the `.vks` artifact,
then call `vks_simulate` without a time-limit argument. Expected: lint and
compile succeed, simulation prints exactly one `TEST PASS`, and no fail/timeout
marker appears.

If the tools remain unavailable, record that fact in the final report. Do not
claim a vks pass and do not invent a vks bug result.

- [ ] **Step 2: Run fresh Icarus compilation and simulation**

Compile from current source rather than reusing an old image:

```powershell
iverilog -g2005 -Wall -s timer_channel_tb -o build\apb_gpio_timer\timer_channel_tb.vvp rtl\timer\timer_channel.v rtl\sim\timer_channel_tb.v
iverilog -g2005 -Wall -s apb_gpio_tb -o build\apb_gpio_timer\apb_gpio_tb.vvp rtl\gpio\apb_gpio.v rtl\sim\apb_gpio_tb.v
iverilog -g2005 -Wall -s apb_timer_tb -o build\apb_gpio_timer\apb_timer_tb.vvp rtl\timer\timer_channel.v rtl\timer\apb_timer.v rtl\sim\apb_timer_tb.v
vvp build\apb_gpio_timer\timer_channel_tb.vvp
vvp build\apb_gpio_timer\apb_gpio_tb.vvp
vvp build\apb_gpio_timer\apb_timer_tb.vvp
```

Expected for all three: compile exit 0, exactly one `TEST PASS`, no `TEST FAIL`,
and no `TEST TIMEOUT`.

- [ ] **Step 3: Cross-check all tests with ModelSim**

Use forward slashes in the ModelSim library path:

```powershell
vlib build/apb_gpio_timer/modelsim_work
vlog -work build/apb_gpio_timer/modelsim_work rtl/timer/timer_channel.v rtl/gpio/apb_gpio.v rtl/timer/apb_timer.v rtl/sim/timer_channel_tb.v rtl/sim/apb_gpio_tb.v rtl/sim/apb_timer_tb.v
vsim -c -lib build/apb_gpio_timer/modelsim_work timer_channel_tb -do "run -all; quit -f"
vsim -c -lib build/apb_gpio_timer/modelsim_work apb_gpio_tb -do "run -all; quit -f"
vsim -c -lib build/apb_gpio_timer/modelsim_work apb_timer_tb -do "run -all; quit -f"
```

Run the three `vsim` commands serially because they share the library and
transcript. Expected: every test reports `TEST PASS` and `Errors: 0, Warnings: 0`.

- [ ] **Step 4: Check RTL style and design scope**

Run literal style scans and Git checks:

```powershell
Select-String -Path rtl\gpio\*.v,rtl\timer\*.v -Pattern 'always\s*@\(\*\)'
Select-String -Path rtl\gpio\*.v,rtl\timer\*.v,rtl\sim\apb_gpio_tb.v,rtl\sim\timer_channel_tb.v,rtl\sim\apb_timer_tb.v -Pattern '\balways_ff\b|\blogic\b|\btypedef\b'
git diff --check
git status --short
```

Expected: both style scans return no matches; `git diff --check` has no errors.
Confirm no CPU top-level, address decoder, existing peripheral, or unrelated
dirty file was staged or modified by this task.

- [ ] **Step 5: Clean only generated root-level simulator outputs**

Check `apb_gpio_tb.vcd`, `timer_channel_tb.vcd`, `apb_timer_tb.vcd`, and
`transcript`. For each existing file, resolve its absolute path and verify that
it is directly under `D:\Software\simple_cpu` before removing it. Keep
`build/apb_gpio_timer/` because it is build cache, and do not recursively remove
any broader directory.

- [ ] **Step 6: Mark the execution checklist and commit the completion record**

Change each completed checkbox in this plan from `[ ]` to `[x]`. If vks is
unavailable, Step 1 is still complete because availability was checked and the
limitation recorded.

```powershell
git add -- docs/superpowers/plans/2026-07-30-apb-gpio-timer.md
git diff --cached --check
git commit -m "docs: record APB GPIO and timer completion"
```

- [ ] **Step 7: Prepare the final report**

Report:

- Created RTL, testbench, and manual files.
- GPIO direction, atomic output, synchronization, and interrupt semantics.
- Timer binary count, inclusive maximum, cascade delay, PWM, protected writes,
  and interrupt semantics.
- The reason Gray code was rejected.
- Exact vks availability and bug observations.
- Fresh Icarus and ModelSim results for all three tests.
- Any skipped step and its reason.
- The retained build-cache location.
- Final task commits and confirmation that unrelated worktree changes remain.
