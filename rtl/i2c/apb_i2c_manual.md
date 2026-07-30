# APB I2C Programming Guide

## 1. Overview

`apb_i2c` is a 32-bit APB peripheral with mutually exclusive I2C master and
slave modes. It contains independent byte-wide TX and RX FIFOs and exposes raw
byte streams to software.

Master mode supports:

- Direct continuous write.
- Direct continuous read.
- Continuous write followed by RESTART and continuous read.

Slave mode supports a runtime-configurable 7-bit address. Received bytes enter
the RX FIFO without register-address interpretation. Bytes written by software
to the TX FIFO are sent in FIFO order.

## 2. Parameters

| Parameter | Default | Requirement |
|---|---:|---|
| `SYS_CLK_FREQ` | `50_000_000` | APB/core clock frequency in Hz |
| `FIFO_DEPTH` | `16` | Power of two from 8 through 128 bytes |

FIFO storage arrays are not reset. Reset, FIFO clear, and mode change reset the
FIFO pointers and levels only.

## 3. Ports

| Port | Direction | Description |
|---|---|---|
| `s_apb_pclk` | input | APB and protocol-engine clock |
| `s_apb_presetn` | input | Synchronous active-low reset |
| `s_apb_psel` | input | APB peripheral select |
| `s_apb_penable` | input | APB access phase |
| `s_apb_pwrite` | input | APB write enable |
| `s_apb_paddr[31:0]` | input | APB byte address |
| `s_apb_pwdata[31:0]` | input | APB write data |
| `s_apb_pready` | output | Registered APB ready response |
| `s_apb_pslverr` | output | Always zero |
| `s_apb_prdata[31:0]` | output | APB read data |
| `interrupt` | output | OR of enabled sticky interrupt status bits |
| `scl_o`, `sda_o` | output | Always zero for open-drain integration |
| `scl_t`, `sda_t` | output | `0` pulls the corresponding line low; `1` releases it |
| `scl_i`, `sda_i` | input | Resolved external I2C line levels |

The board-level integration must provide pullups and resolve all open-drain
drivers. Both lines are released while the peripheral is disabled.

## 4. APB Behavior

Registers are selected by `s_apb_paddr[11:2]`. A selected transfer uses the
same registered ready behavior as `apb_uart`. Register and FIFO side effects
occur once at APB transfer completion. I2C activity never stalls an APB
transfer. Invalid reads return zero, invalid writes have no effect, and
`s_apb_pslverr` remains zero.

## 5. Register Map

| Offset | Register | Access | Reset value |
|---:|---|---|---:|
| `0x00` | `CTRL` | RW/W1P | `0x0000_0000` |
| `0x04` | `MASTER_CMD` | RW | `0x0000_0000` |
| `0x08` | `TIMING` | RW | calculated |
| `0x0C` | `STATUS` | RO | live state |
| `0x10` | `TX_DATA` | WO | none |
| `0x14` | `RX_DATA` | RO/pop | `0x0000_0000` when empty |
| `0x18` | `FIFO_STATUS` | RO | both FIFOs empty |
| `0x1C` | `SLAVE_CFG` | RW | `0x0000_0050` |
| `0x20` | `STRETCH_TIMEOUT` | RW | `SYS_CLK_FREQ / 1000` |
| `0x24` | `IRQ_STATUS` | RW1C | `0x0000_0000` |
| `0x28` | `IRQ_ENABLE` | RW | `0x0000_0000` |
| `0x2C` | `IRQ_THRESHOLD` | RW | `0x0000_0001` |

Reserved bits read as zero and ignore writes.

### 5.1 CTRL, offset 0x00

| Bits | Name | Description |
|---:|---|---|
| 0 | `ENABLE` | Enable the selected protocol core |
| 1 | `MASTER_MODE` | `0`: slave mode, `1`: master mode |
| 2 | `START` | W1P: validate and start one master command |
| 3 | `ABORT` | W1P: stop an active owned master transaction |
| 4 | `TX_CLR` | W1P: clear TX FIFO pointers and level |
| 5 | `RX_CLR` | W1P: clear RX FIFO pointers and level |
| 31 | `SOFT_RST` | W1P: full synchronous peripheral reset |

Bits 2 through 5 and bit 31 always read zero. `SOFT_RST` has priority over all
other operations in the same write.

A mode change is accepted only when the current `ENABLE` value is zero. An
accepted mode change resets both protocol engines and clears both FIFOs.
Changing mode while enabled sets `CMD_ERROR` and preserves the old mode.
Clearing either FIFO while a master command or selected slave transaction is
active is rejected and sets `CMD_ERROR`.

### 5.2 MASTER_CMD, offset 0x04

| Bits | Name | Description |
|---:|---|---|
| `[1:0]` | `OP` | `0`: write, `1`: read, `2`: write then read, `3`: invalid |
| `[14:8]` | `TARGET_ADDR` | 7-bit target address without an R/W bit |
| `[23:16]` | `TX_LEN` | Number of data bytes to transmit |
| `[31:24]` | `RX_LEN` | Number of data bytes to receive |

An accepted `START` snapshots this register, `TIMING`, and `STRETCH_TIMEOUT`.
Later register writes apply only to the next command. Commands are not queued.

Validation rules are:

- The peripheral is enabled in master mode and no command is active.
- Write: `1 <= TX_LEN <= FIFO_DEPTH` and `RX_LEN == 0`.
- Read: `TX_LEN == 0` and `1 <= RX_LEN <= FIFO_DEPTH`.
- Write then read: both lengths are from 1 through `FIFO_DEPTH`.
- The TX FIFO contains at least `TX_LEN` bytes.
- The RX FIFO has room for at least `RX_LEN` bytes.

A rejected command does not alter either FIFO or the I2C bus and sets
`CMD_ERROR`.

### 5.3 TIMING, offset 0x08

`TIMING[15:0]` is `SCL_PRESCALE`. One I2C quarter-cycle is
`SCL_PRESCALE + 1` APB clock cycles:

```text
SCL_FREQ = SYS_CLK_FREQ / (4 * (SCL_PRESCALE + 1))
```

The reset value is:

```text
ceil(SYS_CLK_FREQ / 400000) - 1
```

The value is clamped to zero. The ceiling division keeps the reset frequency
at or below nominal 100 kHz.

### 5.4 STATUS, offset 0x0C

| Bits | Name | Description |
|---:|---|---|
| 0 | `MASTER_BUSY` | An accepted master command is active |
| 1 | `BUS_BUSY` | Active bus transaction state |
| 2 | `SLAVE_SELECTED` | This slave address is selected |
| 3 | `SLAVE_READ` | The active slave transaction reads from this device |
| 4 | `STRETCH_ACTIVE` | The slave is holding SCL low for TX refill |
| 5 | `TX_EMPTY` | TX FIFO is empty |
| 6 | `TX_FULL` | TX FIFO is full |
| 7 | `RX_EMPTY` | RX FIFO is empty |
| 8 | `RX_FULL` | RX FIFO is full |
| `[23:16]` | `LAST_TX_COUNT` | Last acknowledged/sent data-byte count |
| `[31:24]` | `LAST_RX_COUNT` | Last received data-byte count |

Master counts exclude address bytes and are cleared when a command is
accepted. For a slave write followed by RESTART and read, the RX count is
latched at RESTART and the TX count is latched when the read ends.

### 5.5 TX_DATA, RX_DATA, and FIFO_STATUS

Writing `TX_DATA[7:0]` pushes one byte. A full write is ignored and sets
`CMD_ERROR`. The RX FIFO uses synchronous registered reads. Software must first
save `RX_LEVEL=N`, read `RX_DATA` once and discard that value, then read
`RX_DATA` another `N` times to consume the saved number of bytes. Each nonempty
read request pops exactly once, and the next APB read returns the updated FIFO
`dout`. A reset-time empty read returns zero. Additional empty reads after a
completed drain return the last registered `dout` without changing pointers.

`FIFO_STATUS` fields are:

| Bits | Name |
|---:|---|
| `[7:0]` | `TX_LEVEL` |
| `[15:8]` | `RX_LEVEL` |
| 16 | `TX_EMPTY` |
| 17 | `TX_FULL` |
| 18 | `RX_EMPTY` |
| 19 | `RX_FULL` |

APB and protocol-core FIFO operations may occur in the same clock. When the
FIFO is not full, a simultaneous accepted push and pop keeps its level
unchanged. When the FIFO is full at the start of the clock, the read is accepted
and the write is rejected, so the level decreases by one. A rejected full TX
write sets `CMD_ERROR`.

### 5.6 SLAVE_CFG and STRETCH_TIMEOUT

`SLAVE_CFG[6:0]` is the 7-bit slave address. Address changes while enabled are
ignored and set `CMD_ERROR`. General call and 10-bit addresses are not
supported.

`STRETCH_TIMEOUT` is a raw APB-clock cycle count used by:

- A master waiting for an initially busy bus to become free.
- A master waiting for externally stretched SCL to become high.
- A slave waiting for software to provide a requested TX byte.

Zero means immediate timeout. There is no infinite-wait value. Slave TX data
availability wins if it occurs on the same clock as timeout expiration.

When a slave read address arrives with an empty TX FIFO, the slave stretches
SCL and waits for software. Timeout releases the bus, NACKs the address, and
does not report `SLAVE_READ_DONE`. If TX becomes empty in the middle of a read,
timeout sends `0xFF`, counts that byte, and allows the external master to end
the read normally.

### 5.7 Interrupt Registers

`IRQ_STATUS` is sticky and write-one-to-clear. `IRQ_ENABLE` uses the same bit
layout. The output is combinational:

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

| Bit | Name | Set condition |
|---:|---|---|
| 0 | `MASTER_DONE` | Any accepted master command ends, including error or abort |
| 1 | `ADDR_NACK` | Target NACKs either master address phase |
| 2 | `DATA_NACK` | Target NACKs a master write data byte |
| 3 | `ARBITRATION_LOST` | Master transmits high but samples SDA low while SCL is high |
| 4 | `MASTER_TIMEOUT` | Bus-free or SCL-high wait expires |
| 5 | `CMD_ERROR` | Invalid command or illegal control/FIFO operation |
| 6 | `SLAVE_RX_THRESHOLD` | Enabled slave RX level is at least the RX threshold |
| 7 | `SLAVE_TX_THRESHOLD` | Enabled slave TX level is at most the TX threshold |
| 8 | `SLAVE_RX_DONE` | Matched slave write ends at STOP or RESTART |
| 9 | `SLAVE_READ_DONE` | Matched slave read ends after NACK or STOP |
| 10 | `SLAVE_RX_OVERFLOW` | A received byte cannot enter the RX FIFO |
| 11 | `SLAVE_TX_UNDERFLOW` | External master requests a byte while TX is empty |
| 12 | `SLAVE_STRETCH_TIMEOUT` | Software does not refill TX before timeout |
| 13 | `BUS_ERROR` | Active protocol core detects an illegal bus phase |

A hardware event wins over a simultaneous W1C clear. Threshold bits reassert
one clock after a clear if their enabled slave-mode condition remains true.

`IRQ_THRESHOLD[7:0]` is the RX threshold and `[15:8]` is the TX threshold. The
reset values are RX=1 and TX=0. Threshold conditions are inactive outside
enabled slave mode.

## 6. Driver Sequences

### 6.1 Master Write

1. Disable the peripheral and select master mode.
2. Clear TX/RX FIFOs if required.
3. Program `TIMING`, `STRETCH_TIMEOUT`, and `MASTER_CMD` with write OP.
4. Fill TX with exactly `TX_LEN` or more available bytes.
5. Enable master mode.
6. Write `CTRL.START=1` while preserving `ENABLE` and `MASTER_MODE`.
7. Wait for `MASTER_DONE`, then inspect all relevant `IRQ_STATUS` error bits.

### 6.2 Master Read

1. Disable/configure master mode and clear RX.
2. Program timing, timeout, target address, read OP, and `RX_LEN`.
3. Enable and write `START`.
4. Wait for `MASTER_DONE` and inspect `IRQ_STATUS`.
5. Save `RX_LEVEL=N`, discard one `RX_DATA` read, then consume the next `N`
   `RX_DATA` reads.

### 6.3 Master Write Then Read

1. Disable/configure master mode and clear both FIFOs.
2. Fill TX and program both nonzero lengths with OP=2.
3. Enable and write `START`.
4. The hardware sends the write bytes, generates RESTART without STOP, then
   reads `RX_LEN` bytes.
5. Wait for `MASTER_DONE`, inspect errors, and drain RX.

### 6.4 Slave Service

1. Disable the peripheral and select slave mode.
2. Program `SLAVE_CFG`, timeout, IRQ thresholds, and IRQ enables.
3. Preload TX when response data is already available.
4. Enable slave mode.
5. Service `SLAVE_RX_DONE` and RX threshold events by saving `RX_LEVEL`, doing
   one discarded `RX_DATA` read, and then consuming the saved number of raw RX
   bytes.
6. Service TX threshold/underflow events by writing raw response bytes to TX.
7. Treat stretch timeout as a completed error condition; an address timeout
   produces NACK, while a mid-read timeout transmits `0xFF`.

The legal mode-change sequence is disable, wait for idle, change mode,
configure the new mode, and enable. Use `ABORT` to end an owned active master
transaction before disabling or switching modes.
