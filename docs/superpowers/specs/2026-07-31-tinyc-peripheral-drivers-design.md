# Tiny C Peripheral Drivers and RTL Simulation Design

Date: 2026-07-31

## 1. Goal

Provide four independently compilable Tiny C firmware examples for the current
APB UART, I2C, GPIO, and dual-timer peripherals. Each source file contains a
small reusable driver API followed by a self-checking test `main`. Four
Verilog-2005 testbenches execute the compiled firmware on `MERC32_top` and
verify the real peripheral pins, FIFOs, interrupts, and APB transactions.

The work updates the obsolete Tiny C UART closed loop and adds equivalent I2C,
GPIO, and timer closed loops. It does not add C preprocessing, C header support,
multi-file linking, or new peripheral features.

## 2. Current Constraints

### 2.1 Tiny C

The compiler already supports all required language features:

- `volatile` 32-bit pointers and pointer indexing;
- local and global arrays;
- signed and unsigned integer comparisons;
- functions, loops, conditionals, and bounded polling;
- the `__irq_handler` convention and `__irq_enable`/`__irq_disable` builtins.

The C build path accepts one source string and does not support C `#include`
or multi-file linking. Each firmware therefore remains a standalone `.c` file.
Driver functions occupy the first section and the test entry point follows in
the same file.

### 2.2 CPU and Address Map

Every integration test uses the current `MERC32_top`, including its JTAG debug
ports. Testbenches hold `tck=0`, `tms=1`, and `tdi=0`.

The software-visible peripheral windows are:

| Address range | Peripheral |
|---|---|
| `0x1000_0000` to `0x1000_FFFF` | UART |
| `0x1001_0000` to `0x1001_FFFF` | I2C |
| `0x1002_0000` to `0x1002_FFFF` | GPIO |
| `0x1003_0000` to `0x1003_FFFF` | Timer |

Program execution starts at address zero. Data RAM starts at `0x0080_0000`.
The standard result mailbox is:

| Address | Meaning |
|---|---|
| `0x0080_03C0` | `0x600D` pass or `0x0BAD` fail |
| `0x0080_03C4` | failure stage or testbench handshake value |

### 2.3 Source of Truth

The current peripheral RTL and its APB unit test are authoritative. In
particular, the current UART is FIFO based and differs from the older Tiny C
UART example and programming manual:

- `CTRL[0]` and `CTRL[1]` continuously enable RX and TX;
- `CTRL[2]` and `CTRL[3]` are RX/TX FIFO clear pulses;
- TX and RX bytes use register bits `[7:0]`;
- status exposes FIFO level, empty, full, and busy fields;
- RX uses synchronous FIFO reads and needs one discarded read before consuming
  the requested data.

The new UART driver and testbench target these current semantics.

## 3. Architecture

Use four independent CPU-plus-peripheral simulations rather than one complete
SoC simulation. Each test has one firmware image, one CPU instance, RAM models,
and only the peripheral dependencies needed by that test. This keeps failures
isolated and allows every case to run from the existing Tiny C RTL runner.

The planned integration units are:

| Firmware | Testbench | Real RTL under test |
|---|---|---|
| `example/tinyc_uart_test.c` | `rtl/sim/tinyc_uart_tb.v` | `apb_uart` |
| `example/tinyc_i2c_test.c` | `rtl/sim/tinyc_i2c_tb.v` | two `apb_i2c` instances |
| `example/tinyc_gpio_test.c` | `rtl/sim/tinyc_gpio_tb.v` | `apb_gpio` |
| `example/tinyc_timer_test.c` | `rtl/sim/tinyc_timer_tb.v` | `apb_timer`, `timer_channel` |

`merc32-vsce/scripts/test-c-rtl.js` remains the compiler-to-RTL orchestration
point. It compiles each C file, assembles it, writes a temporary ROM image,
compiles the selected Verilog top, runs it, and requires exactly one
`TEST PASS` marker with no failure or timeout marker.

## 4. Requirement Classification and Boundaries

The four peripherals are communication and control blocks. No new data-path
processing module is required.

- Communication interfaces: UART serialized TX/RX and I2C master bus traffic.
- Control logic: GPIO direction/output/interrupt handling and timer
  configuration/PWM/interrupt handling.
- Testbench responsibility: external serial or pin stimulus, physical protocol
  observation, peer-device setup, timeout enforcement, and final verdict.
- Firmware responsibility: legal programming sequences, bounded waits, data
  checking, ISR service, and mailbox reporting.
- Existing RTL responsibility: APB register behavior, FIFO operation, protocol
  engines, interrupt generation, and PWM timing.

No peripheral RTL change is planned. If a closed-loop test exposes an RTL
defect, development pauses at a minimal failing reproduction and handles that
defect separately before continuing.

## 5. UART Driver and Simulation

### 5.1 Driver API

```c
void uart_init(unsigned int baud_rate);
int uart_putc(unsigned int value);
int uart_getc(unsigned int *value);
int uart_write(unsigned int *data, int length);
```

`uart_init` performs a software reset, writes the baud-rate configuration,
waits a bounded settling interval, clears both FIFOs, and enables RX and TX.
`uart_putc` waits for `TX_FULL=0` and writes the low byte to `TX_DATA`.
`uart_getc` waits for a nonzero RX level, reads `RX_DATA` once to advance the
synchronous FIFO, and returns the low byte from the following read. All waits
have finite limits and return failure on expiration.

### 5.2 Closed-Loop Test

The firmware sends `MERC32\r\n`. The testbench decodes the actual UART TX line
and checks all eight bytes. The firmware first observes one bounded receive
timeout. The testbench then injects `0x21` on UART RX, and the firmware receives
and echoes it. The test passes only after the firmware mailbox reports success
and the testbench has observed the complete serialized sequence including the
echo.

## 6. I2C Master Driver and Simulation

### 6.1 Driver API

```c
void i2c_master_init(unsigned int prescale, unsigned int timeout);
int i2c_master_write(unsigned int address, unsigned int *data, int length);
int i2c_master_read(unsigned int address, unsigned int *data, int length);
int i2c_master_write_read(
    unsigned int address,
    unsigned int *tx_data, int tx_length,
    unsigned int *rx_data, int rx_length);
unsigned int i2c_get_last_status(void);
```

The driver supports lengths from 1 through the configured 16-byte FIFO depth.
Each command disables the engine, selects master mode, clears the required
FIFOs and sticky IRQ state, programs lengths and address, loads TX data,
enables the engine, and emits `START`. Completion polling is bounded. Successful
reads save the RX level, perform the required discarded `RX_DATA` read, and
then consume the saved number of bytes. A software timeout emits `ABORT`,
disables the engine, and clears FIFO state. The raw completion/error bits are
retained in `i2c_last_status`.

### 6.2 Closed-Loop Test

The CPU-controlled instance is the master. A second real `apb_i2c`, configured
by testbench APB tasks as slave address `0x52`, shares resolved open-drain SCL
and SDA lines with it.

The firmware performs:

1. A two-byte write.
2. A two-byte read and data comparison.
3. A one-byte write followed by RESTART and a two-byte read.
4. A transaction to an absent address that must fail with `ADDR_NACK` without
   exceeding the polling bound.

The slave TX FIFO is preloaded with the expected read streams. At completion,
the testbench drains and verifies the slave RX stream. A bus monitor checks
START, repeated START, STOP, and successful response activity. Firmware data
checks and testbench physical-bus checks must both pass.

## 7. GPIO Driver and Simulation

### 7.1 Driver API

```c
void gpio_init(unsigned int direction, unsigned int output);
void gpio_write(unsigned int value);
void gpio_set(unsigned int mask);
void gpio_clear(unsigned int mask);
void gpio_toggle(unsigned int mask);
unsigned int gpio_read(void);
void gpio_irq_config(unsigned int type, unsigned int mask);
unsigned int gpio_irq_pending(void);
void gpio_irq_clear(unsigned int mask);
```

Initialization writes the output latch before enabling output directions. IRQ
configuration disables IRQ delivery, writes the global trigger type, clears
old raw pending bits, and then enables the selected pins. The handler reads raw
pending state, records it, and clears handled bits through W1C.

### 7.2 Closed-Loop Test

GPIO bits 0 through 3 are outputs and bit 4 is the interrupt-driven input. The
firmware exercises direct write, atomic set, atomic clear, and atomic toggle;
the testbench checks both `gpio_o` values and `gpio_t` direction values.

After a mailbox handshake, the testbench changes GPIO inputs. The firmware
checks the synchronized `GPIO_IN` value. Bit 4 is then configured for a rising
edge, and a second testbench transition must enter `__irq_handler`. The test
requires the correct pending bit, one serviced event, W1C clearing, and final
interrupt deassertion.

## 8. Timer Driver and Simulation

### 8.1 Driver API

```c
int timer_configure(
    unsigned int channel,
    unsigned int config,
    unsigned int count_max,
    unsigned int pwm_compare);
void timer_enable(unsigned int channel);
void timer_disable(unsigned int channel);
void timer_clear(unsigned int channel);
unsigned int timer_count(unsigned int channel);
void timer_irq_enable(unsigned int mask);
unsigned int timer_irq_pending(void);
void timer_irq_clear(unsigned int mask);
```

Channel arguments 0 and 1 select the two register banks; other values are
rejected. Configuration disables only the selected channel, writes CONFIG,
MAX, and PWM_COMPARE, and pulses its clear bit. Enable and disable operations
preserve the other channel. The ISR clears handled W1C bits and increments a
volatile tick counter without performing UART output or another long wait.

### 8.2 Closed-Loop Test

Timer 0 runs from PCLK with a period long enough for the CPU to enter the ISR,
clear pending, return, and observe three separate interrupts. Timer 1 runs
independently in normal PWM mode. The testbench measures its steady-state PWM
period, active width, and polarity.

The firmware also checks rejection of an invalid software channel, preserves
one timer while changing the other, and stops Timer 0 after the required tick
count. The final verdict requires Timer 0 interrupt deassertion while Timer 1
continues producing the expected PWM.

## 9. Error Handling and Coordination

Every driver loop has a finite counter. No absent UART byte, I2C target, GPIO
event, timer interrupt, or stuck APB-side condition may leave the simulation
running indefinitely. Each firmware writes a unique detail value before
writing `0x0BAD` to the status mailbox.

The detail mailbox also carries explicit testbench handshake values when
external stimulus must follow firmware setup. Handshake values and failure
codes occupy separate documented ranges so a failure cannot be mistaken for a
stimulus request.

Each testbench tracks two completion dimensions:

- firmware completion from the DLB status mailbox;
- protocol or pin completion from its external monitors.

It prints the sole `TEST PASS` marker only when both are satisfied. Firmware
failure, monitor mismatch, or the testbench cycle timeout prints `TEST FAIL` or
`TEST TIMEOUT` and ends the simulation.

## 10. Verification

Development follows test-first RED/GREEN steps per peripheral. Each testbench
first expresses a behavior that the missing or obsolete firmware cannot pass,
then the minimum driver behavior is implemented.

Verification includes:

1. Tiny C compiler and assembler regressions.
2. The complete `npm run test:c:rtl` compiler-to-CPU suite.
3. Independent APB UART, I2C, GPIO, and timer unit testbenches.
4. Verilog-2005 lint/compile/simulate through the available vks workflow.
5. Icarus Verilog execution through the repository runner as an end-to-end
   cross-check.
6. `git diff --check` and a generated-artifact scan for `.vvp`, `.vcd`, and
   temporary ROM files.

Each Verilog testbench is named after its top module, initializes `clk` and
`rst_n` at declaration, uses `always #(CLK_PERIOD/2) clk = ~clk`, releases
reset from an `initial` delay, contains a testbench-owned timeout, and keeps
waveform dumping commented out by default.

## 11. Acceptance Criteria

The work is accepted when:

1. All four standalone Tiny C files compile and assemble without compiler
   changes.
2. UART serialized TX, timeout, RX, and echo checks pass against current RTL.
3. I2C write, read, repeated-start read, and missing-address error checks pass
   over a resolved two-controller bus.
4. GPIO direct/atomic output, synchronized input, edge interrupt, and W1C
   checks pass.
5. Timer periodic IRQ, independent-channel operation, PWM timing, invalid
   channel rejection, and IRQ shutdown checks pass.
6. Every firmware and external monitor uses bounded completion rules.
7. The complete Tiny C RTL suite and all four peripheral APB regressions pass.
8. No generated simulation artifact is left in the repository.

## 12. Non-Goals

- No Tiny C preprocessor, header, linker, or multi-source support.
- No I2C slave-mode Tiny C driver.
- No UART interrupt-driven buffering API.
- No timer cascade driver demonstration.
- No complete four-peripheral SoC simulation.
- No board programming or physical-device validation in this milestone.
- No unrelated CPU, compiler, peripheral, or documentation refactor.
