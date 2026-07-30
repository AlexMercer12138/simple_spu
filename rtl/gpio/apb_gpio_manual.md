# APB GPIO Programming Manual

## Interface

`apb_gpio` controls 32 independent GPIO pins from one 32-bit APB slave. Each
physical pin is split into an input, output value, and output-disable signal:

```verilog
input  wire [31:0] gpio_i;
output wire [31:0] gpio_o;
output wire [31:0] gpio_t;
```

For each bit, `GPIO_DIR=1` selects output mode and `GPIO_DIR=0` selects input
mode. The external output buffer connections are:

```text
gpio_o = GPIO_OUT
gpio_t = ~GPIO_DIR
```

The output latch remains visible on `gpio_o` while a pin is an input. Software
can therefore prepare an output value before changing the direction.

## APB Behavior

The slave uses byte addresses and returns a registered `PREADY` after one wait
cycle. `PSLVERR` is always zero. Undefined reads return zero and undefined
writes have no effect. Read data is captured during the APB setup phase and
held through transfer completion.

Writing `CTRL.SOFT_RST` performs a synchronous peripheral reset. The reset
pulse has priority over every other operation in that transfer.

## Register Map

| Offset | Register | Access | Reset | Description |
|---:|---|---|---:|---|
| `0x00` | `CTRL` | R/W | `0x00000000` | Bit 31 is the write-only `SOFT_RST` pulse |
| `0x04` | `GPIO_DIR` | R/W | `0x00000000` | Per-pin direction, `1=output` |
| `0x08` | `GPIO_OUT` | R/W | `0x00000000` | Output latch |
| `0x0C` | `GPIO_SET` | W | `0x00000000` | Write-one atomic set; reads zero |
| `0x10` | `GPIO_CLEAR` | W | `0x00000000` | Write-one atomic clear; reads zero |
| `0x14` | `GPIO_TOGGLE` | W | `0x00000000` | Write-one atomic toggle; reads zero |
| `0x18` | `GPIO_IN` | R | `0x00000000` | Synchronized input value |
| `0x1C` | `IRQ_TYPE` | R/W | `0x00000007` | Global trigger type in bits `[2:0]` |
| `0x20` | `IRQ_ENABLE` | R/W | `0x00000000` | Per-pin interrupt enable mask |
| `0x24` | `IRQ_STATUS` | R/W1C | `0x00000000` | Per-pin sticky raw pending bits |

## Input Synchronization

`gpio_i` passes through two clocked synchronization registers. A separate
valid pipeline suppresses `GPIO_IN` and event detection until two complete
`PCLK` sampling edges have occurred after hardware or software reset.
`GPIO_IN` reads zero before that point.

The previous synchronized sample is updated every valid cycle, including for
output-configured pins. Consequently, changing a stable pin from output to
input does not create a false edge event.

## Interrupts

`IRQ_TYPE[2:0]` applies globally to all input-configured pins:

| Value | Trigger |
|---:|---|
| `0` | Low level |
| `1` | High level |
| `2` | Rising edge |
| `3` | Falling edge |
| `4` | Either edge |
| `5`-`7` | Reserved; no event |

Only pins with `GPIO_DIR=0` generate new events. `IRQ_STATUS` records raw
events whether or not the corresponding `IRQ_ENABLE` bit is set. The combined
output is asserted when any enabled pending bit is set:

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

Write ones to `IRQ_STATUS` to clear handled bits. Event set has priority over
W1C, so clearing an active level in the same cycle leaves that bit pending. An
edge pending bit remains clear after W1C until a new matching transition.

Writing `IRQ_TYPE` clears all pending bits, suppresses event detection for that
transfer, and rebases edge history to the current synchronized input. This
prevents a type change from being interpreted as an edge.

## Recommended Programming Order

```text
1. Write GPIO_OUT or an atomic output register.
2. Write GPIO_DIR to enable selected outputs.
3. Write IRQ_TYPE; this clears old pending state.
4. Clear IRQ_STATUS with all ones.
5. Write IRQ_ENABLE.
6. Service IRQ_STATUS and clear handled bits with W1C.
```
