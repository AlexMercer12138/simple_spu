# FPGA CPU and Peripheral Bring-Up Design

Date: 2026-07-31

## 1. Goal

Build and run a standalone MERC32 FPGA system containing the CPU, local program
and data RAM, APB UART, APB I2C, APB GPIO, and APB dual timer. The validation
firmware must boot directly from initialized program RAM and demonstrate all
four peripherals on the ShengTeng Mini board.

The FPGA configuration JTAG remains the download path. The CPU's custom debug
JTAG transport is not exposed in this bring-up design.

## 2. Existing Project Constraints

The existing `merc32-xpr` project uses a Vivado 2018.3 Block Design containing
the CPU, a clock wizard, and the UART. The available host installation is
Vivado 2020.2. Regenerating or extending the old Block Design would introduce
an avoidable IP upgrade dependency.

The new build therefore uses a pure Verilog-2005 SoC top and a reproducible
Vivado batch script inside `merc32-xpr`. The old Block Design and generated
project cache remain untouched. Generated projects, reports, and bitstreams go
under `merc32-xpr/build/`.

## 3. RTL Architecture

### 3.1 Module boundaries

The integration adds three modules:

- `apb4_interconnect`: four-way APB address decode and response mux.
- `merc32_soc`: CPU, instruction RAM, data RAM, APB interconnect, and four
  peripheral instances.
- `merc32_fpga_top`: board pins, reset/clock wiring, I2C open-drain buffers,
  LED/key polarity adaptation, and one `merc32_soc` instance.

Functional decode logic belongs in `apb4_interconnect`, not in the board top.
The FPGA top contains only board-level signal adaptation and module
instantiation.

### 3.2 Clock and reset

The design runs directly from the 50 MHz board clock on package pin `W19`.
There is no clock wizard. The active-low board reset on `Y19` drives the SoC
reset. New sequential RTL uses synchronous active-low reset.

All UART and I2C frequency parameters are set to `50_000_000`.

### 3.3 CPU and local memory

`MERC32_top` is configured with:

```text
ILB_ADDR_WIDTH = 16
DLB_ADDR_WIDTH = 16
```

This provides 64K 32-bit words for each local memory:

| CPU range | Storage | Initial state |
|---|---|---|
| `0x0000_0000` to `0x0003_FFFF` | Program RAM | Firmware `.mem` image |
| `0x0080_0000` to `0x0083_FFFF` | Data RAM | Zero |

Both memories remain writable through the CPU local-bus ports. The program
counter starts at zero after reset, so execution begins from word zero in the
initialized program RAM.

The CPU custom JTAG inputs are held inactive (`tck=0`, `tms=1`, `tdi=0`) and
its `tdo` output is unused. This does not affect the FPGA's dedicated
configuration JTAG chain.

### 3.4 APB address map

The peripheral map is:

| Address range | Peripheral |
|---|---|
| `0x1000_0000` to `0x1000_FFFF` | APB UART |
| `0x1001_0000` to `0x1001_FFFF` | APB I2C |
| `0x1002_0000` to `0x1002_FFFF` | APB GPIO |
| `0x1003_0000` to `0x1003_FFFF` | APB TIMER |

`apb4_interconnect` gates `PSEL` using `PADDR[31:16]` and forwards the common
address, enable, write, and write-data signals to every slave. `PRDATA` and
`PREADY` return only from the selected slave.

An unmapped APB address returns zero and asserts ready during the access phase.
This prevents a bad software address from permanently stalling the CPU. Slave
`PSLVERR` outputs are not consumed because the CPU APB master interface has no
error response input.

The four peripheral interrupt outputs are ORed into the CPU interrupt input.
The validation firmware enables only timer overflow interrupt generation.

## 4. Board I/O

The design uses the supplied pin map:

| Function | FPGA package pins |
|---|---|
| 50 MHz clock | `W19` |
| Active-low reset | `Y19` |
| UART RX/TX | `W17`, `V17` |
| I2C SCL/SDA | `K19`, `J22` |
| KEY1-4 | `R16`, `P15`, `T20`, `Y18` |
| LED1-4 | `N20`, `M20`, `N22`, `M22` |
| Timer PWM1 / buzzer | `AA18` |

All signals use `LVCMOS33`. I2C SCL and SDA are top-level bidirectional
open-drain signals. A released line is high impedance, a driven line is zero,
and each input samples the resolved pin level. Internal pullups are enabled in
the XDC in addition to the board's external I2C pullups.

The board adapter treats LEDs and keys as active-low at the package pins while
presenting logical active-high values to `apb_gpio`:

```text
GPIO[3:0] = LED1-4, 1 means on
GPIO[7:4] = KEY1-4, 1 means pressed
```

Timer PWM1 is routed to the passive buzzer pin but remains disabled in the
validation firmware.

## 5. Validation Firmware

The source is a Tiny C program compiled by the repository's MERC32 toolchain.
A Node.js build script compiles C to assembly, assembles machine words, and
writes the program-memory `.mem` image consumed by Vivado.

### 5.1 UART

The firmware configures 115200 baud, 8 data bits, no parity, and one stop bit.
TX and RX are enabled. Startup and peripheral results are printed to TX. RX is
polled and received bytes are echoed, using the UART FIFO's required dummy read
before consuming registered RX data.

UART FIFO-full waits use a finite software loop. A timeout abandons that output
operation rather than blocking all later peripheral checks.

### 5.2 GPIO

GPIO bits 0 through 3 are outputs and bits 4 through 7 are inputs. Startup runs
a short four-step LED pattern. The main loop mirrors pressed keys to the four
LEDs and prints a message only when the key state changes.

GPIO interrupt generation remains disabled. Polling is sufficient for this
board test and keeps the CPU interrupt source unambiguous.

### 5.3 I2C EEPROM

The firmware selects I2C master mode and non-destructively scans 7-bit
addresses `0x50` through `0x57`. Each attempt performs a direct one-byte read;
the firmware does not write EEPROM contents or change a memory address.

A successful attempt requires `MASTER_DONE`, no address/data/arbitration/
timeout/bus error status, and one byte in the RX FIFO. The firmware performs
the required dummy `RX_DATA` read and then reads the returned byte. It prints
the detected address and data value.

Both the I2C hardware timeout and a finite software polling limit are active.
If no address responds, the firmware prints an error and continues to GPIO and
timer validation.

### 5.4 Timer interrupt

Timer 0 uses PCLK as its source with `MAX=49_999_999`, giving a one-second
period at 50 MHz. The firmware clears the counter, enables timer 0 overflow
pending and interrupt generation, then enables the timer.

`__irq_handler` clears timer 0 pending through W1C and increments a volatile
tick counter. It does not print from interrupt context. The main loop notices
tick-count changes and prints `TIMER tick N`, keeping UART waits out of the ISR.

The firmware disables all UART, I2C, and GPIO interrupt enables, so every CPU
interrupt during this test is a timer interrupt.

## 6. Verification

The only new standalone functional RTL is the APB interconnect. Development
uses a RED/GREEN self-checking `apb4_interconnect_tb.v` covering:

- Correct `PSEL` for all four address windows.
- Setup and access phase forwarding.
- Read data and ready response from only the addressed slave.
- A selected slave holding `PREADY` low without other slaves affecting it.
- Unmapped accesses returning zero and completing instead of hanging.
- No slave selected while the master `PSEL` is low.

The existing CPU and peripheral modules have already been unit simulated. Per
the approved bring-up scope, no new full-SoC integration simulation is added.
End-to-end validation is performed on the board.

The host flow checks vks simulation tools first. If they are unavailable,
Icarus Verilog is used for the interconnect test and ModelSim is used as a
cross-check. The build then runs Vivado 2020.2 synthesis, implementation,
timing summary, DRC, and bitstream generation.

## 7. Vivado Build and Programming

`merc32-xpr/build_fpga.tcl` creates a clean generated project beneath
`merc32-xpr/build/`, adds only the required repository RTL, firmware memory
image, and `pin.xdc`, then selects `merc32_fpga_top` as top.

The script fails if synthesis, implementation, DRC, timing, or bitstream
generation fails. The final bitstream and reports remain under the build
directory.

After a successful build, `program_fpga.tcl` connects to the Vivado hardware
server, selects the first detected `xc7a200t` device, assigns the generated
bitstream, and programs it. If no hardware target is detected, the build still
completes and the exact manual programming command and bitstream path are
reported.

## 8. Board Acceptance Criteria

The board test passes when:

1. UART prints the startup banner at 115200 baud and echoes received bytes.
2. The I2C scan reports an EEPROM response in `0x50` through `0x57` and prints
   one returned byte, or reports a bounded I2C failure without hanging.
3. The startup LED pattern is visible, and pressing KEY1-4 changes the matching
   LED and produces a UART key-state message.
4. UART prints monotonically increasing timer tick messages once per second,
   demonstrating CPU interrupt entry, timer W1C service, and return to main.

## 9. Non-Goals

- No CPU custom JTAG pins or CPU debug-session validation.
- No modification of EEPROM contents.
- No GPIO interrupt validation in the first board image.
- No I2C slave-mode board validation.
- No timer cascade or PWM waveform validation on the board.
- No new full-SoC integration simulation.
- No regeneration or upgrade of the legacy Vivado Block Design.
