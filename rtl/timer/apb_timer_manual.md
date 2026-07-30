# APB Dual Timer Programming Manual

## Overview

`apb_timer` contains two independent 32-bit periodic timer channels. Each
channel can count PCLK cycles or registered overflow events from the other
channel, and each channel has its own edge-aligned PWM output. One combined
interrupt reports both overflow sources and configuration errors.

The slave returns a registered `PREADY` after one wait cycle. `PSLVERR` is
always zero. Undefined reads return zero and undefined writes have no effect.
Read data is captured in the APB setup phase and held through completion.

## Register Map

| Offset | Register | Access | Reset | Description |
|---:|---|---|---:|---|
| `0x00` | `CTRL` | R/W | `0x00000000` | Enables and write-only command pulses |
| `0x04` | `IRQ_STATUS` | R/W1C | `0x00000000` | Sticky pending bits `[2:0]` |
| `0x08` | `IRQ_ENABLE` | R/W | `0x00000000` | Interrupt enables `[2:0]` |
| `0x0C` | `T0_CONFIG` | R/W | `0x00000000` | Timer 0 source and PWM control |
| `0x10` | `T0_COUNT` | R | `0x00000000` | Timer 0 current count |
| `0x14` | `T0_MAX` | R/W | `0xFFFFFFFF` | Timer 0 inclusive terminal count |
| `0x18` | `T0_PWM_COMPARE` | R/W | `0x00000000` | Timer 0 PWM compare |
| `0x1C` | `T1_CONFIG` | R/W | `0x00000000` | Timer 1 source and PWM control |
| `0x20` | `T1_COUNT` | R | `0x00000000` | Timer 1 current count |
| `0x24` | `T1_MAX` | R/W | `0xFFFFFFFF` | Timer 1 inclusive terminal count |
| `0x28` | `T1_PWM_COMPARE` | R/W | `0x00000000` | Timer 1 PWM compare |

`CTRL` fields are:

| Bit | Name | Behavior |
|---:|---|---|
| `0` | `T0_EN` | Stored timer 0 enable |
| `1` | `T1_EN` | Stored timer 1 enable |
| `8` | `T0_CLEAR` | Write pulse; clears timer 0 count |
| `9` | `T1_CLEAR` | Write pulse; clears timer 1 count |
| `31` | `SOFT_RST` | Write pulse; resets the complete peripheral |

Clear and software-reset bits read as zero. A clear pulse is valid whether the
channel is enabled or disabled and wins over a count event on the same clock.
It does not clear interrupt pending. `SOFT_RST` has priority over all other
fields in the same write.

Each `Tx_CONFIG` register uses:

| Bits | Name | Encoding |
|---:|---|---|
| `[0]` | `COUNT_SOURCE` | `0=PCLK`, `1=other timer overflow` |
| `[2:1]` | `PWM_MODE` | `00=off`, `01=normal`, `10=force inactive`, `11=force active` |
| `[3]` | `PWM_POLARITY` | `0=active high`, `1=active low` |

Reserved bits are masked on write and read as zero.

## Counter Operation

On each eligible count event, a channel performs:

```text
COUNT < MAX  -> COUNT = COUNT + 1
COUNT >= MAX -> COUNT = 0 and overflow = 1
```

`MAX` is inclusive, so a PCLK-sourced channel has a period of `MAX+1` PCLK
cycles. `MAX=0` overflows on every eligible count event. The `>=` comparison
also recovers safely if software lowers `MAX` below a held count while the
channel is disabled.

Overflow is a registered channel event. A cascaded channel consumes that event
on the following PCLK edge. This adds a fixed one-clock phase delay but does
not change the steady-state division ratio. For example, a PCLK source with
`MAX=3` feeding a cascaded channel with `MAX=1` produces one destination
overflow every eight PCLK cycles after startup.

The APB wrapper records a channel's registered overflow on the following
clock. Software therefore observes a deterministic one-cycle pending latency
after the counter reload.

## Configuration Protection

`Tx_CONFIG`, `Tx_MAX`, and `Tx_PWM_COMPARE` can be changed only while channel x
is disabled. A protected write attempted while the channel is enabled is
ignored and sets `IRQ_STATUS.CONFIG_ERROR`.

The wrapper also rejects a `COUNT_SOURCE=1` write when the other channel is
already configured with `COUNT_SOURCE=1`. The rejected register remains
unchanged and the configuration-error pending bit is set. This prevents a
mutual cascade in which neither channel has a PCLK source.

## PWM

PWM is edge aligned. A disabled timer always drives the inactive physical
level. While enabled:

| Mode | Output behavior |
|---|---|
| Off | Inactive |
| Normal | Active while `COUNT < PWM_COMPARE` |
| Force inactive | Inactive |
| Force active | Active |

Active-high polarity maps active to 1 and inactive to 0. Active-low polarity
maps active to 0 and inactive to 1. In normal mode, `PWM_COMPARE=0` gives zero
percent duty and `PWM_COMPARE>MAX` gives 100 percent duty. Force-active mode is
the exact 100 percent option when `MAX=0xFFFFFFFF`.

## Interrupts

`IRQ_STATUS` and `IRQ_ENABLE` use:

| Bit | Source |
|---:|---|
| `0` | Timer 0 overflow |
| `1` | Timer 1 overflow |
| `2` | Configuration error |

Pending bits record events even while masked. Write ones to `IRQ_STATUS` to
clear handled bits. Event set has priority over W1C; for example, a running
timer with `MAX=0` keeps its overflow pending set during a simultaneous clear.
The combined output is:

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

## Programming Sequences

Independent periodic timer:

```text
disable -> write CONFIG/MAX/COMPARE -> pulse CLEAR -> enable -> service W1C IRQ
```

Cascaded timer:

```text
disable both -> configure source channel for PCLK -> configure destination
for other-overflow -> write both MAX values -> clear both -> enable both
```

PWM:

```text
disable channel -> write MAX and COMPARE -> choose normal/force mode and
polarity -> clear -> enable
```

## Why the Counter Is Binary

A programmable terminal-to-zero transition does not generally retain the
one-bit-change property of a direct Gray-code counter. APB count reads,
`COUNT >= MAX`, and `COUNT < PWM_COMPARE` all require binary ordering, so a
Gray counter would need an additional 32-bit Gray-to-binary prefix-XOR path
before the existing comparisons.

All counter, APB, PWM, interrupt, and cascade logic is in the same clock
domain. A binary increment and comparison maps efficiently to FPGA carry
chains and has lower area and timing risk here. If a future integration needs
asynchronous observation, keep the local binary counter and add a Gray-coded
observation value specifically at that clock-domain boundary.
