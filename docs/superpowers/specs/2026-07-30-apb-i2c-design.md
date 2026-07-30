# APB I2C Peripheral Design

## 1. Goal

Implement a Verilog-2005 `apb_i2c` peripheral for the custom CPU project. The
peripheral provides mutually exclusive I2C master and slave modes through the
same open-drain SCL/SDA pins.

The master supports exactly three software-selected transactions:

1. Continuous write: `START -> address+W -> data -> STOP`.
2. Continuous read: `START -> address+R -> data -> NACK -> STOP`.
3. Write then read: `START -> address+W -> data -> RESTART -> address+R -> data -> NACK -> STOP`.

The slave uses raw byte FIFOs. It does not interpret a register address or any
application protocol. All received bytes enter the RX FIFO, and all bytes read
by an external master come from the TX FIFO. CPU software is responsible for
interpreting and producing the byte streams.

Only 7-bit I2C addresses are supported.

## 2. Existing RTL Assessment

The new APB peripheral must reuse the intent of the existing I2C sources, but
cannot wrap their current interfaces unchanged:

- `rtl/i2c/i2c_master_lite.v` contains a duplicated `rdata` port declaration and
  references an undeclared `addr` port.
- The master encodes compile-time `ADDR_BYTES` and `DATA_BYTES` vectors rather
  than a runtime byte stream.
- The master always sends a write address phase before its optional read phase,
  so it cannot perform a direct read.
- The master advances its timing without waiting for `scl_i`, so it does not
  support an external slave stretching SCL.
- `rtl/i2c/i2c_slave.v` fixes the slave address with the `DEVICE_ID` parameter
  and interprets the first received byte as an internal operation address.
- The slave has no FIFO backpressure, CPU service notification, or bounded
  clock-stretching behavior.

`rtl/misc/sync_fifo.v` is not used by this feature. Its template names
`sync_fifo`, while the implemented module is named `fifo_width_convertor`, and
its registered-read behavior does not match the byte-stream contract required
here. The APB wrapper will contain two focused 8-bit synchronous FIFOs instead
of expanding this task into a shared FIFO refactor.

## 3. Architecture

The implementation is split into three modules:

### 3.1 `apb_i2c`

`rtl/i2c/apb_i2c.v` owns all software-visible state:

- APB bus handshake and register decoding.
- One parameterized 8-bit TX FIFO and one parameterized 8-bit RX FIFO.
- Master command validation and configuration snapshots.
- Runtime slave address configuration.
- Interrupt status, enable, thresholds, and output aggregation.
- Mutually exclusive master/slave selection.
- Open-drain output selection for the active core.

The wrapper connects the FIFOs to each active core with byte-wide valid/ready
handshakes. The inactive core is held reset and always releases SCL and SDA.

### 3.2 `i2c_master_lite`

`rtl/i2c/i2c_master_lite.v` is refactored into a byte-stream command engine. It
accepts a latched operation, target address, TX length, RX length, and timing
configuration. It consumes TX bytes and produces RX bytes through valid/ready
interfaces.

The core reports one-cycle events for completion, address NACK, data NACK,
arbitration loss, timeout, and bus error. It reports the number of acknowledged
TX data bytes and received RX data bytes. Address bytes are excluded from both
counts.

### 3.3 `i2c_slave`

`rtl/i2c/i2c_slave.v` is refactored into a raw byte-stream slave. It accepts a
runtime 7-bit address and provides RX and TX valid/ready interfaces. It detects
START, RESTART, STOP, address direction, master ACK/NACK, FIFO backpressure, and
bounded clock stretching.

The core reports write-transaction completion, read-transaction completion,
RX overflow, TX underflow, stretch timeout, and bus error events. It also
reports the completed RX and TX byte counts.

## 4. Parameters and Ports

`apb_i2c` has these parameters:

| Parameter | Default | Constraint and purpose |
|---|---:|---|
| `SYS_CLK_FREQ` | `50_000_000` | APB/core clock frequency in Hz |
| `FIFO_DEPTH` | `16` | Power of two, from 2 through 128 bytes |

The APB and external ports follow the existing peripheral naming style:

```verilog
module apb_i2c #(
    parameter SYS_CLK_FREQ = 50_000_000,
    parameter FIFO_DEPTH   = 16
)(
    input  wire        s_apb_pclk,
    input  wire        s_apb_presetn,
    input  wire        s_apb_psel,
    input  wire        s_apb_penable,
    input  wire        s_apb_pwrite,
    input  wire [31:0] s_apb_paddr,
    input  wire [31:0] s_apb_pwdata,
    output wire        s_apb_pready,
    output wire        s_apb_pslverr,
    output wire [31:0] s_apb_prdata,
    output wire        interrupt,
    output wire        scl_o,
    output wire        scl_t,
    input  wire        scl_i,
    output wire        sda_o,
    output wire        sda_t,
    input  wire        sda_i
);
```

`scl_o` and `sda_o` are always zero. A corresponding `*_t` value of zero pulls
the line low, and a value of one releases it. When disabled, both lines are
released.

The implementation aliases `s_apb_pclk` and the effective active-low reset to
internal `clk` and `rst_n` signals. All state updates use synchronous reset.
FIFO storage arrays are not reset; only their pointers and counts are reset.

## 5. APB Behavior

The APB interface matches the existing `apb_uart` timing style:

- Registers are decoded with `s_apb_paddr[11:2]`.
- A selected access receives the normal single registered wait state.
- `s_apb_pslverr` remains zero for compatibility with the current CPU bridge.
- Invalid reads return zero, and invalid writes have no effect.
- Register side effects occur once per completed APB transfer.
- No APB transfer waits for an I2C transaction; I2C activity is asynchronous to
  software register accesses.

## 6. Register Map

| Offset | Name | Access | Reset value |
|---:|---|---|---:|
| `0x00` | `CTRL` | RW | `0x0000_0000` |
| `0x04` | `MASTER_CMD` | RW | `0x0000_0000` |
| `0x08` | `TIMING` | RW | calculated 100 kHz prescale |
| `0x0C` | `STATUS` | RO | live state |
| `0x10` | `TX_DATA` | WO | none |
| `0x14` | `RX_DATA` | RO | `0x0000_0000` when empty |
| `0x18` | `FIFO_STATUS` | RO | both FIFOs empty |
| `0x1C` | `SLAVE_CFG` | RW | `0x0000_0050` |
| `0x20` | `STRETCH_TIMEOUT` | RW | `SYS_CLK_FREQ / 1000` |
| `0x24` | `IRQ_STATUS` | RW1C | `0x0000_0000` |
| `0x28` | `IRQ_ENABLE` | RW | `0x0000_0000` |
| `0x2C` | `IRQ_THRESHOLD` | RW | `0x0000_0001` |

### 6.1 `CTRL` at `0x00`

| Bits | Name | Behavior |
|---|---|---|
| `[0]` | `ENABLE` | Enables the selected core |
| `[1]` | `MASTER_MODE` | `0`: slave, `1`: master |
| `[2]` | `START` | Master command start, write-one pulse |
| `[3]` | `ABORT` | Stop an owned master transaction, write-one pulse |
| `[4]` | `TX_CLR` | Clear TX FIFO pointers/count, write-one pulse |
| `[5]` | `RX_CLR` | Clear RX FIFO pointers/count, write-one pulse |
| `[30:6]` | reserved | Read zero, writes ignored |
| `[31]` | `SOFT_RST` | Synchronous full peripheral reset, write-one pulse |

`START`, `ABORT`, `TX_CLR`, `RX_CLR`, and `SOFT_RST` never remain set in the
readback value. A mode change is accepted only when the current `ENABLE` value
is zero. Software must disable the peripheral in one write before changing
mode. An accepted mode change resets both protocol cores and clears both FIFOs.

Clearing a FIFO during an active master transaction or selected slave
transaction is rejected and raises `CMD_ERROR`. `SOFT_RST` has priority over
all other actions and restores every register, FIFO pointer, counter, and
sticky status to its documented reset state.

### 6.2 `MASTER_CMD` at `0x04`

| Bits | Name | Behavior |
|---|---|---|
| `[1:0]` | `OP` | `00`: write, `01`: read, `10`: write then read, `11`: invalid |
| `[7:2]` | reserved | Read zero |
| `[14:8]` | `TARGET_ADDR` | 7-bit target address; no R/W bit |
| `[15]` | reserved | Read zero |
| `[23:16]` | `TX_LEN` | Number of data bytes to transmit |
| `[31:24]` | `RX_LEN` | Number of data bytes to receive |

An accepted `START` snapshots this register, `TIMING`, and
`STRETCH_TIMEOUT`. Later writes affect only the next command. Commands are not
queued.

Command validation is:

- Peripheral enabled in master mode.
- No master command is active.
- `OP=write`: `1 <= TX_LEN <= FIFO_DEPTH` and `RX_LEN=0`.
- `OP=read`: `TX_LEN=0` and `1 <= RX_LEN <= FIFO_DEPTH`.
- `OP=write-then-read`: both lengths are from 1 through `FIFO_DEPTH`.
- TX FIFO contains at least `TX_LEN` bytes.
- RX FIFO has room for at least `RX_LEN` bytes.

An invalid `START` does not alter either FIFO, does not touch the bus, and sets
`IRQ_STATUS.CMD_ERROR`.

### 6.3 `TIMING` at `0x08`

`TIMING[15:0]` is `SCL_PRESCALE`; remaining bits read zero. One I2C quarter
cycle lasts `SCL_PRESCALE + 1` APB clock cycles:

```text
SCL_FREQ = SYS_CLK_FREQ / (4 * (SCL_PRESCALE + 1))
```

The reset value is calculated as
`((SYS_CLK_FREQ + 399_999) / 400_000) - 1`, clamped to zero. The ceiling
division keeps the reset SCL frequency at or below nominal 100 kHz. Software
may program other standard-mode or fast-mode rates that meet the
clock-to-I2C timing relationship.

### 6.4 `STATUS` at `0x0C`

| Bits | Name | Meaning |
|---|---|---|
| `[0]` | `MASTER_BUSY` | An accepted master command is active |
| `[1]` | `BUS_BUSY` | A START has been observed without a following STOP |
| `[2]` | `SLAVE_SELECTED` | This slave address is active |
| `[3]` | `SLAVE_READ` | Active slave transaction direction is read |
| `[4]` | `STRETCH_ACTIVE` | Active core is holding SCL low for stretching |
| `[5]` | `TX_EMPTY` | TX FIFO is empty |
| `[6]` | `TX_FULL` | TX FIFO is full |
| `[7]` | `RX_EMPTY` | RX FIFO is empty |
| `[8]` | `RX_FULL` | RX FIFO is full |
| `[15:9]` | reserved | Read zero |
| `[23:16]` | `LAST_TX_COUNT` | Data bytes acknowledged/sent in the last transaction |
| `[31:24]` | `LAST_RX_COUNT` | Data bytes received in the last transaction |

For a master command, the counts exclude address bytes and are cleared when a
command is accepted. For a slave write followed by RESTART and read,
`LAST_RX_COUNT` is latched at RESTART and `LAST_TX_COUNT` is latched when the
read ends.

### 6.5 `TX_DATA`, `RX_DATA`, and `FIFO_STATUS`

Writing `TX_DATA[7:0]` pushes one byte. Other write bits are ignored. A write
while full is ignored and raises `CMD_ERROR`.

Reading `RX_DATA` returns the next byte in `[7:0]` and pops it exactly once.
Reading while empty returns zero, does not move the pointer, and has no error
side effect.

`FIFO_STATUS` is:

| Bits | Name |
|---|---|
| `[7:0]` | `TX_LEVEL` |
| `[15:8]` | `RX_LEVEL` |
| `[16]` | `TX_EMPTY` |
| `[17]` | `TX_FULL` |
| `[18]` | `RX_EMPTY` |
| `[19]` | `RX_FULL` |
| `[31:20]` | reserved, read zero |

The FIFOs correctly handle an APB operation and a core operation in the same
clock cycle. A simultaneous push and pop leaves the corresponding level
unchanged.

### 6.6 `SLAVE_CFG` and `STRETCH_TIMEOUT`

`SLAVE_CFG[6:0]` is the runtime slave address. General call and 10-bit addresses
are not supported. Address changes are accepted only while `ENABLE=0`; an
attempt to change the address while enabled is ignored and raises `CMD_ERROR`.

`STRETCH_TIMEOUT` is a 32-bit APB-clock cycle count used for:

- A master waiting for released SCL to become high.
- A master waiting for an initially busy bus to become free.
- A slave waiting for CPU software to provide a requested TX byte.

A value of zero causes an immediate timeout; there is no infinite-wait setting.
If TX data becomes available on the same cycle the slave timeout would expire,
the data takes priority and the transfer continues.

### 6.7 Interrupt Registers

`IRQ_STATUS` is sticky and write-one-to-clear. `IRQ_ENABLE` uses the same bit
layout. The output is:

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

| Bit | Name | Set condition |
|---:|---|---|
| 0 | `MASTER_DONE` | Any accepted master command ends, including error/abort |
| 1 | `ADDR_NACK` | Target NACKs either master address phase |
| 2 | `DATA_NACK` | Target NACKs a master write data byte |
| 3 | `ARBITRATION_LOST` | Master releases SDA high but samples it low while SCL is high |
| 4 | `MASTER_TIMEOUT` | Bus-free or SCL-high wait expires |
| 5 | `CMD_ERROR` | Invalid command or illegal APB control/FIFO operation |
| 6 | `SLAVE_RX_THRESHOLD` | Slave mode RX level is at least its threshold |
| 7 | `SLAVE_TX_THRESHOLD` | Slave mode TX level is at most its threshold |
| 8 | `SLAVE_RX_DONE` | Matched slave write ends at STOP or RESTART |
| 9 | `SLAVE_READ_DONE` | Matched slave read ends after master NACK or STOP |
| 10 | `SLAVE_RX_OVERFLOW` | A received byte cannot enter the full RX FIFO |
| 11 | `SLAVE_TX_UNDERFLOW` | External master requests a byte while TX FIFO is empty |
| 12 | `SLAVE_STRETCH_TIMEOUT` | CPU does not provide a requested TX byte before timeout |
| 13 | `BUS_ERROR` | Active core observes an illegal START/STOP or inconsistent bus phase |
| `[31:14]` | reserved | Read zero |

Event setting wins over a simultaneous software clear. Threshold bits are live
conditions reflected through sticky status: clearing one while its condition
remains true causes it to be set again on the following clock.

`IRQ_THRESHOLD[7:0]` is the RX threshold and `[15:8]` is the TX threshold. The
reset values are RX=1 and TX=0. Threshold conditions are active only while the
peripheral is enabled in slave mode.

## 7. Master Protocol Behavior

The master uses four timed phases per I2C bit. It changes SDA only while SCL is
low and samples SDA while SCL is high.

The transaction paths are:

```text
write:           IDLE -> BUS_CHECK -> START -> ADDR_W -> TX -> STOP -> DONE
read:            IDLE -> BUS_CHECK -> START -> ADDR_R -> RX -> STOP -> DONE
write-then-read: IDLE -> BUS_CHECK -> START -> ADDR_W -> TX -> RESTART
                      -> ADDR_R -> RX -> STOP -> DONE
```

For every high SCL phase, the core first releases SCL and waits until `scl_i`
is high. The timeout counter runs only while the core expects SCL high and sees
it low. A timeout causes an owned transaction to attempt STOP, set
`MASTER_TIMEOUT`, and complete. If the bus was never acquired, it simply
releases both lines and completes.

The core generates the R/W bit from the command and does not store it in
`TARGET_ADDR`. A write FIFO byte is consumed when loaded into the shifter, but
`LAST_TX_COUNT` advances only after its ACK. An address NACK or data NACK causes
STOP and completion. Unsent FIFO bytes remain available; a transmitted but
NACKed byte is not restored.

During reads, each completed byte is pushed to RX FIFO. The master drives ACK
after every byte except the requested final byte, after which it drives NACK
and then STOP.

When transmitting a logical one, sampling SDA low during SCL high means another
master won arbitration. The core sets `ARBITRATION_LOST`, releases both lines
without generating STOP, and completes. Multi-master clock synchronization and
automatic retry are outside this design.

`ABORT` requests STOP at the next safe low-SCL boundary if this core owns the
bus. It then sets `MASTER_DONE` without adding an error flag. `ABORT` after
arbitration loss only releases the lines.

## 8. Slave Protocol Behavior

The slave synchronizes and filters SCL/SDA before detecting START, RESTART,
STOP, and clock edges. It never interprets received data as an internal address.

### 8.1 External-master write

After a matching write address, the slave ACKs the address if RX FIFO has room.
Each complete data byte is pushed to RX FIFO and ACKed. If a byte cannot be
stored because the FIFO is full, it is discarded, the slave NACKs that byte,
and `SLAVE_RX_OVERFLOW` is set.

STOP or RESTART latches the received-byte count and sets `SLAVE_RX_DONE`. A
matched address followed immediately by STOP or RESTART is a valid zero-byte
write event.

### 8.2 External-master read

After a matching read address, the slave needs one TX FIFO byte before
completing the address ACK. If the FIFO is empty, it sets
`SLAVE_TX_UNDERFLOW`, pulls SCL low, and starts `STRETCH_TIMEOUT`.

- If CPU software writes TX data before timeout, the slave ACKs the address and
  sends the byte.
- If the address-phase wait expires, the slave releases SCL, NACKs the read
  address, sets `SLAVE_STRETCH_TIMEOUT`, and returns to address/idle tracking.

After each transmitted byte, a master ACK requests another byte. If TX FIFO is
empty, the slave again sets `SLAVE_TX_UNDERFLOW` and stretches SCL. If this
mid-transaction wait expires, the slave loads `8'hFF`, sets
`SLAVE_STRETCH_TIMEOUT`, releases SCL, and completes that byte. Each later
missing byte starts a new bounded wait.

A master NACK or STOP ends the read, latches the number of bytes placed on the
bus, and sets `SLAVE_READ_DONE`. Timeout-generated `8'hFF` bytes are included
in the transmitted-byte count.

## 9. Mode and Open-Drain Control

Master and slave operation are mutually exclusive. `CTRL.MASTER_MODE` selects
which core can drive the external pins. The wrapper combines no active drive
from the inactive core; it explicitly forces that core's `scl_t` and `sda_t`
contribution to release.

The legal software mode-change sequence is:

1. Write `ENABLE=0`.
2. Wait until `MASTER_BUSY=0` and `SLAVE_SELECTED=0`.
3. Write the new mode. The accepted change clears both FIFOs and protocol state.
4. Configure master command/timing or slave address/thresholds.
5. Write `ENABLE=1`.

## 10. Verification Strategy

All RTL and testbenches use Verilog-2005 `.v` files. Development follows a
red-green-refactor sequence: each behavior is first represented by a failing
test, the failure is observed, and only then is the minimum RTL added.

Three testbenches provide layered coverage:

### 10.1 `rtl/sim/i2c_master_lite_tb.v`

A behavioral slave verifies:

- Direct write, direct read, and write-then-RESTART-read.
- 1-byte and 16-byte boundaries.
- Correct ACK on intermediate read bytes and NACK on the final byte.
- Address NACK and data NACK handling.
- External clock stretching and timeout.
- Bus-busy timeout.
- Arbitration loss and immediate line release.
- Software abort and programmable SCL period.

### 10.2 `rtl/sim/i2c_slave_tb.v`

A behavioral master verifies:

- Runtime address match and mismatch.
- Raw RX byte delivery with STOP and RESTART boundaries.
- Raw TX byte consumption and master ACK/NACK handling.
- RX-full byte NACK and overflow event.
- Address-phase TX-empty stretching, CPU refill, and recovery.
- Address-phase timeout and address NACK.
- Mid-read timeout and `8'hFF` fallback.
- Completed RX/TX byte counts and all slave events.

### 10.3 `rtl/sim/apb_i2c_tb.v`

Two `apb_i2c` instances share resolved open-drain SCL/SDA lines. One is
configured as master and the other as slave. This test verifies the complete
software-facing flow:

- APB reset values, one-wait-state handshake, read/write behavior, and invalid
  address behavior.
- FIFO push/pop, full/empty/level, simultaneous core/APB access, and clear.
- End-to-end 1-byte and 16-byte continuous writes and reads.
- End-to-end write-then-read with a real RESTART and no intervening STOP.
- CPU-like slave response after `SLAVE_RX_DONE`, including successful SCL
  stretching while the response is filled.
- Both stretch timeout paths and final bus release.
- Illegal command, busy START, insufficient TX data, insufficient RX space,
  wrong target address, data NACK, and FIFO overflow.
- IRQ enable, threshold conditions, sticky W1C behavior, and set-over-clear
  priority.
- Soft reset, abort, and legal/illegal mode switching.

Verification uses the required MCP simulator workflow:

1. `vks_lint` for static checks.
2. `vks_compile` to build each `.vks` simulation image.
3. `vks_simulate` to run each testbench.

If a vks result is questionable, simulator availability is checked and an
available independent simulator is used for cross-checking. Every simulation
report explicitly states whether a new vks issue was observed.

## 11. Out of Scope

This design intentionally excludes:

- 10-bit addressing and general-call handling.
- DMA and command queues.
- Transactions longer than `FIFO_DEPTH` in one command.
- SMBus PEC, high-speed mode, and target-specific register semantics.
- Automatic bus-clear clock pulses or automatic command retry.
- Full multi-master clock synchronization; arbitration-loss detection is
  included only to release the bus safely.
