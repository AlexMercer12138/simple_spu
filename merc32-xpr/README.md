# MERC32 FPGA Peripheral Bring-Up

This flow builds a pure RTL MERC32 system for the ShengTeng Mini board. The
CPU boots directly from initialized block RAM; FPGA configuration JTAG is used
only to load the bitstream, and the CPU custom JTAG inputs are held inactive.

## Address Map

| Region | Base address | Size |
| --- | ---: | ---: |
| Program RAM | `0x00000000` | 256 KiB |
| Data RAM | `0x00800000` | 256 KiB |
| APB UART | `0x10000000` | 64 KiB |
| APB I2C | `0x10010000` | 64 KiB |
| APB GPIO | `0x10020000` | 64 KiB |
| APB TIMER | `0x10030000` | 64 KiB |

## Pin Map

| Signal | FPGA pin |
| --- | --- |
| 50 MHz clock | W19 |
| Reset, active low | Y19 |
| UART RX / TX | W17 / V17 |
| I2C SCL / SDA | K19 / J22 |
| KEY1..KEY4 | R16, P15, T20, Y18 |
| LED1..LED4 | N20, M20, N22, M22 |
| Buzzer PWM | AA18 |

Keys and LEDs are active low at the board pins. I2C uses open-drain outputs and
pull-ups. The four CPU-visible key bits are GPIO `[7:4]`; the four LED bits are
GPIO `[3:0]`.

## Build

Run from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File merc32-xpr\build_fpga.ps1
```

The script rebuilds the Tiny C toolchain, creates the firmware image, then runs
Vivado synthesis and implementation. The resulting image is:

```text
merc32-xpr/build/merc32_fpga_top.bit
```

Timing, utilization, and DRC reports are written below
`merc32-xpr/build/reports/`.

## Program

Connect the FPGA JTAG cable and run:

```powershell
powershell -ExecutionPolicy Bypass -File merc32-xpr\program_fpga.ps1
```

A successful download prints `PROGRAM PASS`.

## Serial Test

List available serial ports:

```powershell
[System.IO.Ports.SerialPort]::GetPortNames()
```

Capture one port for 12 seconds:

```powershell
powershell -ExecutionPolicy Bypass -File merc32-xpr\capture_serial.ps1 `
  -Port COM3 -Seconds 12
```

The capture sends one `U` byte for the UART echo test. Expected output includes:

```text
MERC32 FPGA
GPIO OK
I2C OK 0x50 0xDD
KEY 0x0
TIMER tick 0x00000001
TIMER tick 0x00000002
U
```

The exact EEPROM address is scanned from `0x50` through `0x57`, and the data
byte depends on its current internal address. If no EEPROM responds, firmware
prints `I2C FAIL` and continues. The test performs direct reads only and never
writes EEPROM contents.

At startup the four LEDs light in sequence. In the main loop, each pressed key
is mirrored to its corresponding LED and key changes are printed. Timer 0
generates a one-second interrupt; the ISR only clears its W1C status and updates
a counter, while the main loop prints the counter.

## Validated Board Result

The flow was validated on 2026-07-31 with the board UART on `COM14`. A clean
build produced a 2,021-word firmware image, completed implementation with
`WNS = +4.357 ns`, and reported zero DRC errors. Hardware Manager selected the
connected `xc7a200t` and printed `PROGRAM PASS`.

The final programmed image produced:

```text
MERC32 FPGA
GPIO OK
I2C OK 0x53 0xFF
KEY 0x0
TIMER tick 0x00000001
TIMER tick 0x00000002
TIMER tick 0x00000003
```

The serial stimulus was echoed as `U`, and timer ticks continued increasing.
The host capture confirms the idle key value and the GPIO software path. The
startup LED sequence and nonzero key values still require a person at the board
to observe the LEDs and press each key.
