# FPGA CPU and Peripheral Bring-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build, program, and exercise a 50 MHz MERC32 FPGA image containing local RAM and APB UART, I2C, GPIO, and dual timer peripherals.

**Architecture:** A pure Verilog-2005 `merc32_fpga_top` replaces the legacy Block Design as synthesis top. `merc32_soc` owns CPU/RAM/peripheral integration, while a separately tested combinational `apb4_interconnect` decodes four 64 KiB APB windows and guarantees completion of unmapped accesses.

**Tech Stack:** Verilog-2005, APB3-style bus, MERC32 Tiny C toolchain, Node.js, Vivado 2020.2, PowerShell, Icarus Verilog, ModelSim.

---

## File Structure

- Create `rtl/bridge/apb4_interconnect.v`: four-slave APB decoder and response mux.
- Create `rtl/sim/apb4_interconnect_tb.v`: self-checking interconnect testbench.
- Create `rtl/fpga/merc32_soc.v`: CPU, RAM, four APB peripherals, and interrupt aggregation.
- Create `rtl/fpga/merc32_fpga_top.v`: board pins and polarity/open-drain adaptation.
- Create `merc32-xpr/firmware/peripheral_test.c`: board validation firmware.
- Create `merc32-xpr/firmware/build_firmware.js`: Tiny C to `.asm` and `.mem` builder.
- Create `merc32-xpr/firmware/build_firmware_test.js`: firmware-builder smoke test.
- Modify `merc32-xpr/pin.xdc`: complete clock, reset, serial, I2C, key, LED, and buzzer constraints.
- Create `merc32-xpr/build_fpga.tcl`: reproducible Vivado project and bitstream build.
- Create `merc32-xpr/build_fpga.ps1`: host build entry point.
- Create `merc32-xpr/program_fpga.tcl`: Vivado Hardware Manager programming flow.
- Create `merc32-xpr/program_fpga.ps1`: host programming entry point.
- Create `merc32-xpr/capture_serial.ps1`: bounded serial capture and echo stimulus.
- Create `merc32-xpr/README.md`: build, program, serial, and board acceptance instructions.
- Modify `docs/superpowers/plans/2026-07-31-fpga-peripheral-bringup.md`: mark executed steps.

Generated artifacts are placed under `merc32-xpr/build/`. Do not delete or
rewrite the existing `merc32_sim.xpr`, Block Design, runs, cache, or user files.

## Task 1: Four-Way APB Interconnect

**Files:**
- Create: `rtl/sim/apb4_interconnect_tb.v`
- Create: `rtl/bridge/apb4_interconnect.v`

- [ ] **Step 1: Write the failing interconnect testbench**

Create a Verilog-2005 testbench with initialized master/slave inputs, task-based
stimulus, commented VCD calls, and `initial #(20000)` timeout. Instantiate this
contract:

```verilog
apb4_interconnect apb4_interconnect_inst (
    .m_apb_psel     (m_apb_psel),
    .m_apb_penable  (m_apb_penable),
    .m_apb_pwrite   (m_apb_pwrite),
    .m_apb_paddr    (m_apb_paddr),
    .m_apb_pwdata   (m_apb_pwdata),
    .m_apb_pready   (m_apb_pready),
    .m_apb_prdata   (m_apb_prdata),
    .s0_apb_psel    (s0_apb_psel),
    .s0_apb_pready  (s0_apb_pready),
    .s0_apb_prdata  (s0_apb_prdata),
    .s1_apb_psel    (s1_apb_psel),
    .s1_apb_pready  (s1_apb_pready),
    .s1_apb_prdata  (s1_apb_prdata),
    .s2_apb_psel    (s2_apb_psel),
    .s2_apb_pready  (s2_apb_pready),
    .s2_apb_prdata  (s2_apb_prdata),
    .s3_apb_psel    (s3_apb_psel),
    .s3_apb_pready  (s3_apb_pready),
    .s3_apb_prdata  (s3_apb_prdata),
    .s_apb_penable  (s_apb_penable),
    .s_apb_pwrite   (s_apb_pwrite),
    .s_apb_paddr    (s_apb_paddr),
    .s_apb_pwdata   (s_apb_pwdata)
);
```

Use slave return values `0x11111111`, `0x22222222`, `0x33333333`, and
`0x44444444`. Verify:

```text
PSEL=0                         -> all slave selects low, master ready low
0x1000_xxxx                   -> only S0 selected
0x1001_xxxx                   -> only S1 selected
0x1002_xxxx                   -> only S2 selected
0x1003_xxxx                   -> only S3 selected
selected slave PREADY=0       -> master PREADY=0
nonselected slave PREADY=1    -> cannot complete the selected transfer
read response                 -> selected slave PRDATA only
write/setup/access fields     -> forwarded unchanged
0x1004_xxxx or lower address  -> no slave selected, access PREADY=1, PRDATA=0
```

End with exactly one `TEST PASS` or `TEST FAIL`.

- [ ] **Step 2: Verify the expected RED result**

Run:

```powershell
New-Item -ItemType Directory -Force build\fpga_bringup | Out-Null
iverilog -g2005 -Wall -s apb4_interconnect_tb `
  -o build\fpga_bringup\apb4_interconnect_tb.vvp `
  rtl\sim\apb4_interconnect_tb.v
```

Expected: elaboration fails only with `Unknown module type: apb4_interconnect`.

- [ ] **Step 3: Implement the interconnect**

Create a combinational, clock-free module. Default parameters are:

```verilog
parameter [15:0] S0_ADDR = 16'h1000,
parameter [15:0] S1_ADDR = 16'h1001,
parameter [15:0] S2_ADDR = 16'h1002,
parameter [15:0] S3_ADDR = 16'h1003
```

Derive hit signals from `m_apb_paddr[31:16]`, gate each slave select with the
master select, and forward common APB fields with continuous assignments. Use
these response semantics:

```verilog
assign m_apb_prdata = hit0 ? s0_apb_prdata :
                      hit1 ? s1_apb_prdata :
                      hit2 ? s2_apb_prdata :
                      hit3 ? s3_apb_prdata : 32'd0;

assign m_apb_pready = hit0 ? s0_apb_pready :
                      hit1 ? s1_apb_pready :
                      hit2 ? s2_apb_pready :
                      hit3 ? s3_apb_pready :
                      (m_apb_psel && m_apb_penable);
```

Do not add buffering, registered state, an error response, or `always @(*)`.

- [ ] **Step 4: Verify GREEN with Icarus and ModelSim**

Run:

```powershell
iverilog -g2005 -Wall -s apb4_interconnect_tb `
  -o build\fpga_bringup\apb4_interconnect_tb.vvp `
  rtl\bridge\apb4_interconnect.v rtl\sim\apb4_interconnect_tb.v
vvp build\fpga_bringup\apb4_interconnect_tb.vvp

vlib build/fpga_bringup/modelsim_work
vlog -work build/fpga_bringup/modelsim_work `
  rtl/bridge/apb4_interconnect.v rtl/sim/apb4_interconnect_tb.v
vsim -c -lib build/fpga_bringup/modelsim_work apb4_interconnect_tb `
  -do "run -all; quit -f"
```

Expected: one `TEST PASS` per simulator and ModelSim `Errors: 0, Warnings: 0`.
Check vks tool availability first and use the vks lint/compile/simulate sequence
when available; otherwise record that it is unavailable.

- [ ] **Step 5: Commit the interconnect**

```powershell
git add -- rtl/bridge/apb4_interconnect.v rtl/sim/apb4_interconnect_tb.v
git diff --cached --check
git commit -m "feat: add four-way APB interconnect"
```

## Task 2: Board Validation Firmware

**Files:**
- Create: `merc32-xpr/firmware/build_firmware_test.js`
- Create: `merc32-xpr/firmware/peripheral_test.c`
- Create: `merc32-xpr/firmware/build_firmware.js`
- Generate: `merc32-xpr/build/firmware/peripheral_test.asm`
- Generate: `merc32-xpr/build/firmware/peripheral_test.mem`

- [ ] **Step 1: Write the failing firmware-builder smoke test**

Create a Node.js test that makes a temporary output directory, invokes:

```text
node merc32-xpr/firmware/build_firmware.js --output-dir <temp-dir>
```

and requires exit code zero, `peripheral_test.asm`, and
`peripheral_test.mem`. Every nonempty `.mem` line must match
`^[0-9a-f]{8}$`, and the image must contain from 1 through 65,536 words. The
test removes only its own operating-system temporary directory in `finally`.

- [ ] **Step 2: Verify the expected RED result**

Run:

```powershell
node merc32-xpr\firmware\build_firmware_test.js
```

Expected: failure because `build_firmware.js` does not exist. A JavaScript
syntax error in the test is not an acceptable RED result.

- [ ] **Step 3: Write Tiny C peripheral firmware**

Use only Tiny C features already covered by `tinyc_feature_test.c`: integer
globals, local arrays, pointers, functions, `while`, `if`, and bitwise
operators. Do not use headers, structs, strings, preprocessor macros, or
dynamic allocation.

Implement these exact register bases and behaviors:

```c
unsigned int uart_base = 0x10000000;
unsigned int i2c_base = 0x10010000;
unsigned int gpio_base = 0x10020000;
unsigned int timer_base = 0x10030000;
volatile unsigned int timer_ticks = 0;
```

UART functions:

```text
uart_init: soft reset, CONFIG=115200, wait 64 loops, CTRL=3
uart_putc: wait while TX_STATUS bit 9 is set, bounded by 1,000,000 loops;
           write byte to TX_DATA[7:0]
uart_write: transmit an integer array of byte values
uart_put_hex: emit eight hexadecimal digits
uart_service_rx: snapshot RX_LEVEL from RX_STATUS[7:0], perform one discarded
                 RX_DATA read, then read and echo exactly the saved count
```

GPIO functions:

```text
gpio_init: GPIO_OUT=0, GPIO_DIR=0x0000000f
gpio_led_test: write 1,2,4,8 with bounded visible delays, then zero
gpio_read_keys: return (GPIO_IN >> 4) & 0xf
main loop: write current keys to GPIO_OUT and print only when keys change
```

I2C scan for addresses `0x50` through `0x57`:

```text
soft reset
disable, select master mode, clear both FIFOs
MASTER_CMD = 1 | (address << 8) | (1 << 24)
enable master, then write ENABLE|MASTER_MODE|START
poll IRQ_STATUS.MASTER_DONE with a finite software limit
reject status bits 1-5 or 13
require RX_LEVEL=1
discard one RX_DATA read, read the returned byte, print address and byte
clear IRQ_STATUS before the next attempt
```

Timer initialization and ISR:

```c
void __irq_handler(void) {
    volatile unsigned int *timer_status =
        (volatile unsigned int *)0x10030004;
    if ((*timer_status & 1) != 0) {
        *timer_status = 1;
        timer_ticks = timer_ticks + 1;
    }
}
```

Main timer configuration is `CTRL=0`, `T0_CONFIG=0`, `T0_MAX=49_999_999`,
`T0_COMPARE=0`, `IRQ_STATUS=7`, `IRQ_ENABLE=1`, `CTRL=0x100`, then `CTRL=1`.
Call `__irq_enable()` only after these writes. The ISR must never call UART.

Print ASCII byte arrays for these markers:

```text
MERC32 FPGA\r\n
GPIO OK\r\n
I2C OK 0xAA 0xDD\r\n       (AA=address, DD=data)
I2C FAIL\r\n
KEY 0xK\r\n                  (K=low hex digit)
TIMER tick 0xNNNNNNNN\r\n
```

- [ ] **Step 4: Implement the firmware builder**

Resolve paths from `__dirname`, not the process working directory. Load:

```javascript
const { compileC } = require('../../merc32-vsce/out/cCompiler');
const { SimpleCPUAssembler } = require('../../merc32-vsce/out/assembler');
```

Parse only `--output-dir <path>` and reject missing or unknown arguments.
Compile with:

```javascript
compileC(source, {
    moduleName: 'peripheral_test',
    dataBase: 0x00800000,
    dlbAddrWidth: 16,
});
```

Assemble with `sourceFileName` set to the C path. Write the generated assembly
and one lowercase, eight-digit hexadecimal machine word per `.mem` line. Reject
empty images and images over 65,536 words. Print the output paths and word
count.

- [ ] **Step 5: Verify firmware compilation and builder test**

Run:

```powershell
npm --prefix merc32-vsce run compile
node merc32-xpr\firmware\build_firmware_test.js
node merc32-xpr\firmware\build_firmware.js `
  --output-dir merc32-xpr\build\firmware
```

Expected: TypeScript compile exit zero, smoke test `TEST PASS`, and a nonempty
FPGA `.mem` image no larger than 65,536 words.

- [ ] **Step 6: Commit firmware source and builder**

Do not stage generated files under `merc32-xpr/build/`.

```powershell
git add -- merc32-xpr/firmware/peripheral_test.c `
  merc32-xpr/firmware/build_firmware.js `
  merc32-xpr/firmware/build_firmware_test.js
git diff --cached --check
git commit -m "feat: add FPGA peripheral validation firmware"
```

## Task 3: MERC32 SoC Integration

**Files:**
- Create: `rtl/fpga/merc32_soc.v`
- Reuse: CPU, local RAM, APB bridge, interconnect, and peripheral RTL

- [ ] **Step 1: Implement `merc32_soc`**

Use this board-independent interface:

```verilog
module merc32_soc #(
    parameter PROGRAM_INIT_FILE = "peripheral_test.mem"
) (
    input  wire       clk,
    input  wire       rst_n,
    input  wire       uart_rx,
    output wire       uart_tx,
    output wire       i2c_scl_t,
    input  wire       i2c_scl_i,
    output wire       i2c_sda_t,
    input  wire       i2c_sda_i,
    input  wire [3:0] key,
    output wire [3:0] led,
    output wire       buzzer
);
```

Instantiate `MERC32_top` with both address widths 16. Tie the custom debug
inputs to `tck=0`, `tms=1`, and `tdi=0`; leave `tdo` on an internal wire.

Instantiate two `spram` blocks:

```text
instruction RAM: ADDR_WIDTH=16, INIT_FILE=PROGRAM_INIT_FILE, ILB signals
data RAM:        ADDR_WIDTH=16, INIT_FILE="", DLB signals
```

Connect the CPU APB master to `apb4_interconnect`, then instantiate:

```text
S0: apb_uart, SYS_CLK_FREQ=50_000_000, FIFO_DEPTH=8
S1: apb_i2c,  SYS_CLK_FREQ=50_000_000, FIFO_DEPTH=16
S2: apb_gpio
S3: apb_timer
```

Pass the full APB address to every peripheral. Ignore all slave error outputs.
OR all four interrupts into the CPU interrupt input.

Map GPIO with continuous assignments:

```verilog
assign gpio_i = {24'd0, key, 4'd0};
assign led = gpio_o[3:0];
```

Leave `gpio_t` internal. Route timer `pwm1` to `buzzer`; keep `pwm0` internal.
The I2C cores' constant-low `scl_o` and `sda_o` outputs remain internal; export
only `scl_t/sda_t` and sampled inputs.

- [ ] **Step 2: Run static Verilog elaboration**

Per the approved scope, do not add a SoC integration testbench. Run compile-only
elaboration to catch missing ports/modules and Verilog errors:

```powershell
iverilog -g2005 -Wall -s merc32_soc -tnull `
  rtl/debug/jtag_debug.v rtl/cpu/divider.v rtl/cpu/core.v `
  rtl/bridge/lb2apb.v rtl/cpu/MERC32_top.v rtl/misc/spram.v `
  rtl/misc/sync_fifo.v rtl/bridge/apb4_interconnect.v `
  rtl/uart/apb_uart.v rtl/i2c/i2c_master_lite.v rtl/i2c/i2c_slave.v `
  rtl/i2c/apb_i2c.v rtl/gpio/apb_gpio.v rtl/timer/timer_channel.v `
  rtl/timer/apb_timer.v rtl/fpga/merc32_soc.v
```

Expected: exit zero. Existing warnings must be reviewed; no undefined module or
port-width warning is accepted.

- [ ] **Step 3: Commit the SoC integration**

```powershell
git add -- rtl/fpga/merc32_soc.v
git diff --cached --check
git commit -m "feat: integrate MERC32 FPGA SoC"
```

## Task 4: Board Top and Constraints

**Files:**
- Create: `rtl/fpga/merc32_fpga_top.v`
- Modify: `merc32-xpr/pin.xdc`

- [ ] **Step 1: Implement the board top**

Use this exact top-level port set:

```verilog
module merc32_fpga_top #(
    parameter PROGRAM_INIT_FILE = "peripheral_test.mem"
) (
    input  wire       sys_clk,
    input  wire       sys_rst_n,
    input  wire       uart_rx,
    output wire       uart_tx,
    inout  wire       i2c_scl,
    inout  wire       i2c_sda,
    input  wire [3:0] key_n,
    output wire [3:0] led_n,
    output wire       beep
);
```

Instantiate one `merc32_soc`. Board-level connections are:

```verilog
assign i2c_scl = i2c_scl_t ? 1'bz : 1'b0;
assign i2c_sda = i2c_sda_t ? 1'bz : 1'b0;
assign i2c_scl_i = i2c_scl;
assign i2c_sda_i = i2c_sda;
assign key = ~key_n;
assign led_n = ~led;
assign beep = buzzer;
```

Do not add clock generation, reset delays, debounce logic, or CPU custom JTAG
ports.

- [ ] **Step 2: Complete board constraints**

Replace the commented clock line with an active 20 ns clock and preserve the
existing clock/reset/UART pins. Add:

```text
i2c_scl K19, i2c_sda J22, LVCMOS33, PULLUP TRUE
key_n[0..3] R16 P15 T20 Y18, LVCMOS33, PULLUP TRUE
led_n[0..3] N20 M20 N22 M22, LVCMOS33
beep AA18, LVCMOS33
```

Use one `set_property -dict` statement per port. Do not constrain FPGA
configuration JTAG pins.

- [ ] **Step 3: Run compile-only top elaboration**

Run the Task 3 source list plus `rtl/fpga/merc32_fpga_top.v` with:

```powershell
iverilog -g2005 -Wall -s merc32_fpga_top -tnull <source-list>
```

Expected: exit zero and no missing/width errors. This is static elaboration,
not the declined SoC integration simulation.

- [ ] **Step 4: Commit board integration**

`merc32-xpr` is currently untracked; stage only the constraint file and the new
top, not caches, runs, the legacy XPR, or generated Block Design files.

```powershell
git add -- rtl/fpga/merc32_fpga_top.v merc32-xpr/pin.xdc
git diff --cached --check
git commit -m "feat: add ShengTeng Mini FPGA top"
```

## Task 5: Reproducible Vivado Build

**Files:**
- Create: `merc32-xpr/build_fpga.tcl`
- Create: `merc32-xpr/build_fpga.ps1`

- [ ] **Step 1: Write the Vivado build Tcl script**

Resolve repository and output paths relative to `[info script]`. Create a fresh
project at `merc32-xpr/build/vivado/merc32_fpga.xpr` for part
`xc7a200tfbg484-2`. Add the exact RTL source list from Task 3, both FPGA modules,
the generated `.mem`, and `pin.xdc`. Set:

```tcl
set_property target_language Verilog [current_project]
set_property top merc32_fpga_top [current_fileset]
update_compile_order -fileset sources_1
```

Run `synth_1`, then `impl_1` through `write_bitstream`, each with four jobs and
`wait_on_run`. Treat any run status not containing `Complete` as an error.

After opening `impl_1`, write these reports:

```text
merc32-xpr/build/reports/timing_summary.rpt
merc32-xpr/build/reports/utilization.rpt
merc32-xpr/build/reports/drc.rpt
```

Fail when setup WNS is negative or any DRC violation has severity `Error`.
Copy the generated bitstream to:

```text
merc32-xpr/build/merc32_fpga_top.bit
```

- [ ] **Step 2: Write the PowerShell build entry point**

Resolve the repository root from `$PSScriptRoot`. Run, in order:

```powershell
npm --prefix <repo>/merc32-vsce run compile
node <repo>/merc32-xpr/firmware/build_firmware.js `
  --output-dir <repo>/merc32-xpr/build/firmware
vivado -mode batch -nolog -nojournal -source <build_fpga.tcl>
```

Use `$ErrorActionPreference = 'Stop'` and check `$LASTEXITCODE` after every
external command. Do not delete anything outside `merc32-xpr/build/`.

- [ ] **Step 3: Run the full FPGA build**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File merc32-xpr\build_fpga.ps1
```

Expected:

```text
firmware build succeeds
synth_1 Complete
impl_1 Complete
WNS >= 0
DRC error count = 0
merc32-xpr/build/merc32_fpga_top.bit exists and is nonempty
```

If the build fails, use systematic debugging and add a failing regression test
for any RTL behavior change. Build/configuration fixes remain scoped to the
new FPGA integration.

- [ ] **Step 4: Commit reproducible build scripts**

```powershell
git add -- merc32-xpr/build_fpga.tcl merc32-xpr/build_fpga.ps1
git diff --cached --check
git commit -m "build: add reproducible FPGA bitstream flow"
```

## Task 6: FPGA Programming and Serial Capture

**Files:**
- Create: `merc32-xpr/program_fpga.tcl`
- Create: `merc32-xpr/program_fpga.ps1`
- Create: `merc32-xpr/capture_serial.ps1`
- Create: `merc32-xpr/README.md`

- [ ] **Step 1: Write the hardware programming scripts**

The Tcl script accepts the bitstream path as its sole Tcl argument. It must:

```text
verify the bitstream exists
open_hw_manager
connect_hw_server
open_hw_target
select the first device whose PART begins with xc7a200t
set PROGRAM.FILE
program_hw_devices
refresh_hw_device
print PROGRAM PASS
close_hw_manager
```

If no matching device exists, raise a Tcl error with the detected device list.

The PowerShell wrapper verifies
`merc32-xpr/build/merc32_fpga_top.bit`, invokes Vivado batch mode with
`-tclargs`, checks the exit code, and prints the programmed bitstream path.

- [ ] **Step 2: Write bounded serial capture**

Accept parameters:

```powershell
-Port <COM name> (required)
-Seconds 12 (default)
```

Open `System.IO.Ports.SerialPort` at 115200, 8 data bits, no parity, one stop
bit, no handshake. Set finite read/write timeouts, discard stale input, write
one `U` byte to exercise UART RX echo, and print received text until the
deadline. Always close and dispose the port in `finally`.

- [ ] **Step 3: Write the FPGA bring-up README**

Document:

```text
address map
pin map
build command and output bitstream
program command
PowerShell command to list serial COM ports
serial capture command
expected UART markers
LED/key behavior
I2C scan behavior and non-destructive guarantee
one-second timer interrupt behavior
CPU custom JTAG intentionally disabled
```

- [ ] **Step 4: Program the connected FPGA**

Run:

```powershell
powershell -ExecutionPolicy Bypass -File merc32-xpr\program_fpga.ps1
```

Expected: `PROGRAM PASS`. If hardware is absent, retain the bitstream and report
the exact Hardware Manager error; do not claim programming succeeded.

- [ ] **Step 5: Capture serial output and exercise the board**

List ports with:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

When exactly one new USB serial port is available, run the capture script for
at least 12 seconds. Otherwise ask the user which COM port belongs to the board.

Required observed automatic markers are the startup banner, either I2C success
or bounded failure, echoed `U`, and at least two increasing timer ticks. LED/key
acceptance requires pressing the four board keys while capture runs; record any
part that cannot be physically observed from the host.

- [ ] **Step 6: Commit programming and operator documentation**

```powershell
git add -- merc32-xpr/program_fpga.tcl merc32-xpr/program_fpga.ps1 `
  merc32-xpr/capture_serial.ps1 merc32-xpr/README.md
git diff --cached --check
git commit -m "docs: add FPGA programming and board test flow"
```

## Task 7: Final Verification and Completion Record

**Files:**
- Verify: all files created or modified above
- Modify: `docs/superpowers/plans/2026-07-31-fpga-peripheral-bringup.md`

- [ ] **Step 1: Run fresh interconnect verification**

Recompile from source and rerun Icarus and ModelSim. Require one `TEST PASS`,
no failure/timeout marker, and zero ModelSim errors/warnings. Record vks
availability and any vks issue observed; never report a vks pass when tools are
absent.

- [ ] **Step 2: Rebuild firmware and bitstream from clean generated output**

Remove only `merc32-xpr/build/` after resolving and verifying that exact path is
inside the workspace, then rerun `build_fpga.ps1`. Require firmware, synth,
implementation, timing, DRC, and bitstream checks to pass.

- [ ] **Step 3: Audit style and change scope**

Run:

```powershell
Select-String -Path rtl\bridge\apb4_interconnect.v,rtl\fpga\*.v `
  -Pattern 'always\s*@\(\*\)|\balways_ff\b|\blogic\b|\btypedef\b'
git diff --check
git status --short
```

Expected: no prohibited Verilog matches and no whitespace errors. Confirm that
no legacy BD/cache/run file, existing CPU/peripheral source, or unrelated user
change was staged by this task.

- [ ] **Step 4: Mark the implementation checklist complete**

Change executed task checkboxes to `[x]`. A hardware/serial observation that is
impossible because the device or COM port is unavailable remains explicitly
unchecked and is reported as a hardware blocker; do not mark it complete.

- [ ] **Step 5: Commit the completion record**

```powershell
git add -- docs/superpowers/plans/2026-07-31-fpga-peripheral-bringup.md
git diff --cached --check
git commit -m "docs: record FPGA peripheral bring-up results"
```

- [ ] **Step 6: Prepare the final report**

Report exact commits, source files, address/pin maps, firmware word count,
interconnect simulation results, Vivado synthesis/implementation/timing/DRC
results, bitstream path, hardware programming result, serial output observed,
manual key/LED status, vks availability, retained build artifacts, and
confirmation that unrelated worktree changes remain untouched.
