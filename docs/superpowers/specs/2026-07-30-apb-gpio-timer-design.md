# APB GPIO and Dual Timer Design

Date: 2026-07-30

## 1. Goal

Add two standalone APB peripherals:

- `apb_gpio`: 32 direction-configurable GPIO pins with synchronized input,
  atomic output operations, and one globally selected interrupt trigger type.
- `apb_timer`: two 32-bit periodic timer channels with independent PWM outputs,
  sticky interrupts, and registered overflow-based cascading in either
  direction.

The peripherals follow the APB behavior established by `apb_i2c` and
`apb_uart`. This task does not modify the CPU top level, allocate system
addresses, or add an APB decoder.

## 2. Requirement Decomposition

### Communication interface

Both peripherals expose a 32-bit APB slave interface. APB register access,
registered `PREADY`, read-data capture, and software reset belong to the APB
wrappers.

### Data processing

`timer_channel` performs 32-bit binary counting, terminal-count detection,
and PWM comparison. GPIO input synchronization and edge detection are also
clocked data paths.

### Control logic

`apb_gpio` owns direction, output, interrupt configuration, and sticky GPIO
pending bits. `apb_timer` owns channel configuration, cascade selection,
configuration-error detection, and sticky timer pending bits.

No existing GPIO or timer RTL can be reused. The new wrappers reuse the APB
timing and register conventions of the existing peripherals.

## 3. Files and Module Boundaries

The implementation will add:

```text
rtl/gpio/apb_gpio.v
rtl/gpio/apb_gpio_manual.md
rtl/timer/timer_channel.v
rtl/timer/apb_timer.v
rtl/timer/apb_timer_manual.md
rtl/sim/apb_gpio_tb.v
rtl/sim/timer_channel_tb.v
rtl/sim/apb_timer_tb.v
```

### 3.1 `apb_gpio`

`apb_gpio` is one self-contained APB peripheral. It owns the APB interface,
GPIO input synchronizer, direction and output registers, global interrupt type,
per-pin interrupt enable, and per-pin pending status.

External GPIO ports are:

```verilog
input  wire [31:0] gpio_i;
output wire [31:0] gpio_o;
output wire [31:0] gpio_t;
output wire        interrupt;
```

### 3.2 `timer_channel`

`timer_channel` is independent of APB. It owns one 32-bit binary count
register, one registered overflow pulse, and one PWM output. Its functional
inputs are `enable`, `clear`, `count_tick`, `count_max`, `pwm_compare`,
`pwm_mode`, and `pwm_polarity`. Its functional outputs are `count`,
`overflow`, and `pwm`.

### 3.3 `apb_timer`

`apb_timer` owns the APB interface, configuration registers, write protection,
interrupt status and enables, cascade selection, and two `timer_channel`
instances. Only registered overflow outputs cross between channels, so the RTL
contains no combinational cascade loop.

External timer-specific ports are:

```verilog
output wire interrupt;
output wire pwm0;
output wire pwm1;
```

## 4. Common APB Contract

Both APB wrappers use:

```verilog
input  wire        s_apb_pclk;
input  wire        s_apb_presetn;
input  wire        s_apb_psel;
input  wire        s_apb_penable;
input  wire        s_apb_pwrite;
input  wire [31:0] s_apb_paddr;
input  wire [31:0] s_apb_pwdata;
output wire        s_apb_pready;
output wire        s_apb_pslverr;
output wire [31:0] s_apb_prdata;
```

The implementation aliases `s_apb_pclk` and `s_apb_presetn` to internal `clk`
and `rst_n`. All functional sequential logic uses synchronous active-low reset.

Register addresses use `s_apb_paddr[11:2]`. A selected transfer receives a
registered ready response after one wait cycle. Writes take effect on the APB
access-completion cycle. Read data is captured during the APB setup phase and
held through completion. Undefined reads return zero, undefined writes are
ignored, and `s_apb_pslverr` is always zero.

Writing bit 31 of each peripheral's `CTRL` register requests a synchronous
software reset. Software reset has priority over every other write and pulse in
the same transfer. Pulse fields read back as zero.

## 5. APB GPIO

### 5.1 Direction and data

Each `GPIO_DIR` bit uses:

- `0`: input, external output buffer disabled.
- `1`: output, external output buffer drives the `GPIO_OUT` value.

The physical split signals are:

```verilog
assign gpio_o = gpio_out_reg;
assign gpio_t = ~gpio_dir_reg;
```

`gpio_o` always reflects the output latch, including while a pin is configured
as input. Software may therefore program the output value before switching the
direction to output.

### 5.2 Register map

| Byte offset | Register | Access | Definition |
|---:|---|---|---|
| `0x00` | `CTRL` | R/W | `[31] SOFT_RST` write pulse |
| `0x04` | `GPIO_DIR` | R/W | `1=output`, `0=input` |
| `0x08` | `GPIO_OUT` | R/W | Output latch |
| `0x0C` | `GPIO_SET` | W | Write-one atomic set |
| `0x10` | `GPIO_CLEAR` | W | Write-one atomic clear |
| `0x14` | `GPIO_TOGGLE` | W | Write-one atomic toggle |
| `0x18` | `GPIO_IN` | R | Synchronized input value |
| `0x1C` | `IRQ_TYPE` | R/W | Global trigger type in `[2:0]` |
| `0x20` | `IRQ_ENABLE` | R/W | Per-pin interrupt enable |
| `0x24` | `IRQ_STATUS` | R/W1C | Per-pin pending status |

`GPIO_SET`, `GPIO_CLEAR`, and `GPIO_TOGGLE` read as zero. Only one APB address
can complete per cycle, so their updates do not require a multi-operation
precedence rule.

### 5.3 Input synchronization

All 32 `gpio_i` bits pass through a two-register synchronizer before they feed
`GPIO_IN` or interrupt detection. The synchronizer data registers are not reset.
A separately reset validity shift register suppresses input reads and event
detection until two complete `clk` edges have sampled the external inputs.
Before synchronization is valid, `GPIO_IN` reads zero.

On the first valid sample, the previous-sample register is initialized from the
current synchronized input without generating an edge. Thereafter the previous
sample tracks every synchronized input cycle, even for pins configured as
outputs. Changing a pin from output to input therefore does not itself create a
false edge.

### 5.4 Interrupt behavior

The global `IRQ_TYPE` encoding is:

| Value | Trigger |
|---:|---|
| `0` | Low level |
| `1` | High level |
| `2` | Rising edge |
| `3` | Falling edge |
| `4` | Either edge |
| `5-7` | Reserved, no event |

Only pins with `GPIO_DIR=0` may generate events. `IRQ_STATUS` records raw events
independently of `IRQ_ENABLE`. A pending bit remains set until software clears
it through W1C. In level modes, an active level sets the bit again on the cycle
after a successful clear. Event set has priority over W1C when both affect the
same bit in one cycle.

The output is combinational from the registered state:

```verilog
assign interrupt = |(irq_status_reg & irq_enable_reg);
```

Writing `IRQ_TYPE` suppresses event detection for that transfer cycle, clears
all pending bits, and loads the current synchronized input into the edge-history
register. This type-write clear is distinct from W1C; the general event-set
priority applies to `IRQ_STATUS` W1C accesses. Pending bits from pins later
changed to outputs remain pending until W1C, but output pins cannot create new
events.

### 5.5 GPIO reset values

| State | Reset value |
|---|---:|
| Direction | `32'h0000_0000` (all inputs) |
| Output latch | `32'h0000_0000` |
| IRQ type | `3'd7` (reserved/no event) |
| IRQ enable | `32'h0000_0000` |
| IRQ status | `32'h0000_0000` |

Using a disabled interrupt type at reset prevents low input levels from
immediately repopulating pending status before software chooses a trigger type.

## 6. APB Dual Timer

### 6.1 Register map

| Byte offset | Register | Access | Definition |
|---:|---|---|---|
| `0x00` | `CTRL` | R/W | Timer enables, clear pulses, software reset |
| `0x04` | `IRQ_STATUS` | R/W1C | Timer and configuration pending bits |
| `0x08` | `IRQ_ENABLE` | R/W | Timer and configuration interrupt enables |
| `0x0C` | `T0_CONFIG` | R/W | Timer 0 count source and PWM control |
| `0x10` | `T0_COUNT` | R | Timer 0 current count |
| `0x14` | `T0_MAX` | R/W | Timer 0 terminal count |
| `0x18` | `T0_PWM_COMPARE` | R/W | Timer 0 PWM compare value |
| `0x1C` | `T1_CONFIG` | R/W | Timer 1 count source and PWM control |
| `0x20` | `T1_COUNT` | R | Timer 1 current count |
| `0x24` | `T1_MAX` | R/W | Timer 1 terminal count |
| `0x28` | `T1_PWM_COMPARE` | R/W | Timer 1 PWM compare value |

`CTRL` fields are:

| Bits | Name | Behavior |
|---:|---|---|
| `[0]` | `T0_EN` | Stored timer 0 enable |
| `[1]` | `T1_EN` | Stored timer 1 enable |
| `[8]` | `T0_CLEAR` | Write pulse, reads zero |
| `[9]` | `T1_CLEAR` | Write pulse, reads zero |
| `[31]` | `SOFT_RST` | Write pulse, reads zero |

Each `Tx_CONFIG` uses:

| Bits | Name | Encoding |
|---:|---|---|
| `[0]` | `COUNT_SOURCE` | `0=PCLK`, `1=other channel overflow` |
| `[2:1]` | `PWM_MODE` | `00=off`, `01=normal`, `10=forced inactive`, `11=forced active` |
| `[3]` | `PWM_POLARITY` | `0=active high`, `1=active low` |

Reserved register bits are masked on writes and read as zero.

`IRQ_STATUS` and `IRQ_ENABLE` use:

| Bit | Source |
|---:|---|
| `0` | Timer 0 overflow |
| `1` | Timer 1 overflow |
| `2` | Configuration error |

The interrupt output is:

```verilog
assign interrupt = |(irq_status_reg & irq_enable_reg);
```

All pending bits are sticky W1C, and event set has priority over W1C.

### 6.2 Configuration protection

`Tx_CONFIG`, `Tx_MAX`, and `Tx_PWM_COMPARE` may be changed only while channel x
is disabled. A write to one of these registers while its channel is enabled is
ignored and sets configuration-error pending.

The wrapper also rejects a `Tx_CONFIG.COUNT_SOURCE=1` write if the other
channel is already configured with `COUNT_SOURCE=1`. This prevents a mutual
wait configuration and ensures that only one direction of cascade is active at
a time. The rejected configuration register keeps its previous value and
configuration-error pending is set.

Software should configure a channel in this order:

1. Clear its enable bit.
2. Program source, maximum, PWM compare, and PWM mode.
3. Pulse the channel clear bit.
4. Set its enable bit.

The clear pulse is legal while enabled or disabled. It resets only the current
count, has priority over an eligible count tick, and does not clear interrupt
pending. If clear and a cascade pulse coincide, clear wins and that cascade
pulse is not queued.

### 6.3 Counter timing

Each `timer_channel` uses a 32-bit binary up-counter. When disabled, the count
holds and overflow is low. When enabled, `count_tick` is always true for the
PCLK source or equals the other channel's registered overflow pulse for the
cascade source.

On an eligible tick:

```text
count < count_max  -> count + 1
count >= count_max -> count = 0 and overflow = 1 for one cycle
```

`count_max` is an inclusive terminal value, so a PCLK-sourced channel has a
period of `count_max + 1` clocks. `count_max=0` produces an overflow on every
eligible tick. The `>=` comparison safely recovers on the first tick if
software lowers the maximum while the channel is disabled but forgets to clear
an already larger count.

Overflow is registered inside `timer_channel`. A cascaded channel consumes the
pulse at the following clock edge. The fixed one-clock phase delay does not
change the steady-state divide ratio. For example, timer 0 with `MAX=3` and
timer 1 with `MAX=1` sourced from timer 0 makes timer 1 overflow once per eight
PCLK cycles after startup.

The APB wrapper observes the registered channel overflow and sets the matching
pending bit on the next clock edge. This gives a deterministic one-cycle status
latency after the counter reload.

### 6.4 PWM behavior

PWM is edge aligned. A disabled timer always drives the inactive level. For an
enabled timer:

- Off mode drives inactive.
- Normal mode is active while `count < pwm_compare`.
- Forced-inactive mode drives inactive.
- Forced-active mode drives active.

`PWM_POLARITY=0` maps active to physical high and inactive to low.
`PWM_POLARITY=1` maps active to physical low and inactive to high.

In normal mode, `pwm_compare=0` gives zero percent duty. A compare value greater
than `count_max` gives 100 percent duty. Forced-active mode supplies exact 100
percent duty when `count_max=32'hFFFF_FFFF`, where no greater 32-bit compare
value exists. Configuration protection prevents mid-period PWM changes and
therefore prevents software-induced partial-cycle glitches.

### 6.5 Timer reset values

| State | Reset value |
|---|---:|
| Timer enables | `2'b00` |
| Current counts | `32'h0000_0000` each |
| Maximum values | `32'hFFFF_FFFF` each |
| PWM compare values | `32'h0000_0000` each |
| Count sources | PCLK |
| PWM modes | Off |
| PWM polarities | Active high |
| IRQ status | `3'b000` |
| IRQ enable | `3'b000` |

## 7. Gray-Code Evaluation

The timer counters remain binary.

A direct Gray-code counter is not suitable because an arbitrary programmable
terminal-to-zero transition does not generally preserve the one-bit Gray-code
property. Terminal comparison, `COUNT` reads, `count < pwm_compare`, and
`count >= count_max` all require binary ordering. Converting a direct Gray value
back to binary would add a 32-bit prefix-XOR path to the existing compare logic.

Keeping a binary counter and exporting an additional Gray shadow value would
only help if the count crossed into another asynchronous clock domain. These
peripherals keep APB, both counters, PWM, interrupts, and cascade pulses in one
clock domain. A 32-bit binary increment and comparison map naturally onto FPGA
carry chains and are the lower-area and lower-risk choice for this design.

If a future integration needs asynchronous observation, it should retain the
local binary counter and add a Gray-coded observation path specifically at the
clock-domain boundary.

## 8. Error Handling

- Undefined APB reads return zero.
- Undefined APB writes are ignored.
- APB slave error remains low.
- GPIO trigger values 5 through 7 produce no event.
- Timer protected writes and cyclic cascade requests are ignored and set
  configuration-error pending.
- Software reset clears all stored configuration, count, and pending state.

## 9. Verification Strategy

Development follows test-driven order: write each self-checking test first,
observe the expected missing-interface or behavior failure, then implement the
minimum RTL needed to pass it.

### 9.1 `apb_gpio_tb`

The test covers APB setup/access timing, reset values, direction and tri-state
mapping, direct output writes, atomic set/clear/toggle, synchronization latency,
all five valid trigger types, reserved trigger behavior, input-only event
eligibility, pending independent of mask, W1C, event-set priority, type-change
clearing, and software reset.

### 9.2 `timer_channel_tb`

The test covers disabled hold, PCLK-equivalent ticks, clear priority,
inclusive maximum timing, `MAX=0`, one-cycle overflow, recovery from
`COUNT>MAX`, normal PWM duty, zero and full duty, forced modes, polarity, and
inactive output while disabled.

### 9.3 `apb_timer_tb`

The test covers APB timing, register masks and reset values, two independent
channels, both legal cascade directions, expected cascade divide ratios,
protected-write rejection, cyclic-cascade rejection, configuration-error
status, overflow pending, interrupt enables, W1C set priority, clear pulse
behavior, PWM outputs, and software reset.

All RTL and testbenches use Verilog-2005 `.v` files. Testbenches use initialized
clock/reset declarations, task-based stimulus, a default-commented VCD block,
and an explicit simulation timeout.

The primary verification flow is `vks_lint`, `vks_compile`, and `vks_simulate`
when those tools are available. If the environment still lacks vks tools, the
implementation report records that limitation and uses fresh Icarus and
ModelSim compilation and simulation as cross-checks. Lack of vks does not count
as a vks pass.

## 10. Non-Goals

- No CPU top-level modification.
- No APB decoder or address allocation.
- No external timer event or gate input.
- No one-shot timer mode.
- No phase-correct PWM.
- No per-pin GPIO interrupt type.
- No counter clock-domain crossing or Gray-code output.
