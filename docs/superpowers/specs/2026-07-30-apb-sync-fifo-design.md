# APB I2C and UART Synchronous FIFO Design

## 1. Goal

Replace the private FIFO arrays in `apb_i2c` and `apb_uart` with independent
8-bit `sync_fifo` instances. Both peripherals shall follow the registered-read
timing of the current `sync_fifo` implementation without adding a data prefetch
register.

The I2C feature set, command model, register offsets, and interrupt layout stay
unchanged. The UART register offsets stay unchanged, while UART data transfers
change from grouped 32-bit buffers to one-byte FIFO push and pop operations.

## 2. Shared FIFO Contract

Each APB peripheral contains one TX FIFO and one RX FIFO:

- `DATA_WIDTH` is 8.
- `FIFO_DEPTH` is a power of two from 8 through 128.
- FIFO levels come directly from `sync_fifo.data_cnt`.
- A write is accepted only when `full` is low.
- A read is accepted only when `empty` is low.
- If a FIFO is full at the start of a clock, a simultaneous read and write
  accepts the read and rejects the write, matching the current `sync_fifo`.
- FIFO storage is not reset. Reset and clear operations reset pointers, level,
  and wrapper-side read-valid metadata.

`sync_fifo.dout` changes on the rising clock edge that accepts `rd_en`.
Consumers therefore use the new value on the following cycle. No wrapper data
register mirrors or prefills `dout`.

## 3. APB RX Read Sequence

An APB read of an RX data register returns the current `sync_fifo.dout`. At APB
transfer completion, the peripheral asserts `rd_en` for one clock when the RX
FIFO is nonempty. The newly popped byte becomes visible through `dout` after
that edge and is returned by the next APB read.

Software shall drain an RX FIFO as follows:

1. Read and save the RX level as `N`.
2. Read the RX data register once and discard the result.
3. Read the RX data register `N` more times and consume those results.

The first read initiates the first FIFO pop. The final read returns the last
registered `dout` value without another pop because the FIFO is then empty.
FIFO level and threshold conditions reflect stored entries, not the registered
output value.

The wrappers keep one metadata bit that records whether a successful FIFO read
has occurred since reset or clear. This bit does not store data. It allows a
reset-time empty RX data read to return zero even though `sync_fifo.dout` is not
reset. Once valid, repeated reads of an empty FIFO return the last `dout`; the
driver sequence above does not consume such extra reads.

## 4. I2C Design

### 4.1 APB Wrapper

`apb_i2c` removes both private RAM arrays, their pointers, and their count
registers. It instantiates byte-wide TX and RX `sync_fifo` modules and uses
their `data_cnt`, `empty`, and `full` outputs for:

- `STATUS` and `FIFO_STATUS` reporting.
- Master command length and available-space validation.
- TX write rejection and RX backpressure.
- Slave FIFO threshold interrupt conditions.

The existing APB register offsets and all non-FIFO field definitions remain
unchanged. `RX_DATA` adopts the shared registered-read sequence. `TX_DATA`
continues to push `PWDATA[7:0]` exactly once at APB transfer completion.

`TX_CLR`, `RX_CLR`, soft reset, and an accepted disabled-mode switch generate a
synchronous active-low reset for the relevant FIFO instance. Illegal clears
during an active transaction retain the current `CMD_ERROR` behavior.

### 4.2 Master TX Interface

The I2C master TX streaming interface changes from same-cycle `valid/ready` to
a synchronous FIFO interface:

- Input: `tx_empty` and `tx_data` from the FIFO.
- Output: `tx_rd_en` to the FIFO.

When the master reaches a data-byte load state and `tx_empty` is low, it asserts
`tx_rd_en` for one clock and moves to a latch state. On the following clock it
loads `tx_data` into its existing shift register and starts transmitting. The
accepted command validation guarantees that the requested TX byte count is in
the FIFO before a command starts.

### 4.3 Slave TX Interface

The I2C slave uses the same `tx_empty`, `tx_rd_en`, and `tx_data` interface. A
slave-read byte request holds SCL low while the synchronous FIFO read completes.

- If the FIFO is nonempty, the slave requests a read, loads `dout` on the next
  cycle, and resumes the transaction. This short fetch delay does not set
  `SLAVE_TX_UNDERFLOW` and does not count as an empty-FIFO timeout.
- If the FIFO is empty when a byte is requested, the slave sets
  `SLAVE_TX_UNDERFLOW`, stretches SCL, and applies the existing programmable
  timeout.
- Address-stage timeout still releases the bus and NACKs the address.
- Mid-read timeout still sends `8'hFF` and allows the external master to finish
  the read.

The existing protocol shift register is the only byte storage after a FIFO
read. The wrapper does not prefetch a byte.

### 4.4 RX Interface and Errors

Master and slave RX outputs write directly to the RX `sync_fifo`. RX ready is
low whenever the FIFO is full. A full FIFO does not accept a replacement write
on a simultaneous APB pop.

The existing 14-bit I2C sticky interrupt definitions remain unchanged. A full
TX APB write is ignored and sets `CMD_ERROR`. Slave RX overflow, master errors,
slave underflow, stretch timeout, and threshold behavior retain their existing
meanings, subject to the registered FIFO level timing described above.

## 5. UART Design

### 5.1 Register Map

The UART offsets remain stable:

| Offset | Register | New behavior |
|---:|---|---|
| `0x00` | `CTRL` | Separate RX/TX enables and FIFO clear pulses |
| `0x04` | `CONFIG` | Unchanged baud, parity, and stop-bit fields |
| `0x08` | `RX_DATA` | Registered FIFO read/pop |
| `0x0C` | `RX_STATUS` | RX FIFO level and live state |
| `0x10` | `TX_DATA` | Push `PWDATA[7:0]` |
| `0x14` | `TX_STATUS` | TX FIFO level and live state |
| `0x18` | `INTERRUPT` | Existing encoding with FIFO-based sources |

`CTRL` fields are:

| Bit | Name | Behavior |
|---:|---|---|
| 0 | `RX_EN` | Level enable for the receiver |
| 1 | `TX_EN` | Level enable for the transmitter |
| 2 | `RX_CLR` | Write-one pulse that clears the RX FIFO |
| 3 | `TX_CLR` | Write-one pulse that clears the TX FIFO |
| 31 | `SOFT_RST` | Write-one pulse that resets the UART peripheral |

Pulse fields read as zero. Disabling RX or TX does not clear its FIFO.

`RX_STATUS` fields are `[7:0] RX_LEVEL`, `[8] RX_EMPTY`, `[9] RX_FULL`, and
`[10] RX_BUSY`. `TX_STATUS` fields are `[7:0] TX_LEVEL`, `[8] TX_EMPTY`,
`[9] TX_FULL`, and `[10] TX_BUSY`. All other bits read as zero.

### 5.2 TX Data Flow

An APB write to `TX_DATA` pushes one byte when the FIFO is not full. A full write
is ignored and does not assert `PSLVERR`.

When `TX_EN` is high, the transmitter is idle, and the TX FIFO is nonempty, the
UART asserts FIFO `rd_en`. On the following clock it loads `dout` into the
existing transmit shift register and starts the frame. Disabling TX prevents
new reads but lets an already loaded frame finish. `TX_CLR` cancels a FIFO read
that has not yet loaded the shift register, but it does not interrupt an
already loaded frame.

### 5.3 RX Data Flow

When `RX_EN` is high, the UART continuously detects and receives frames. A
completed valid byte writes directly to the RX FIFO. If the FIFO is full, the
new byte is dropped. This change does not add an overflow status or interrupt.

Disabling RX abandons an in-progress frame and leaves completed FIFO data
unchanged. `RX_CLR` clears completed FIFO data and the wrapper read-valid bit.

### 5.4 Interrupt Compatibility

The `INTERRUPT` register encoding remains unchanged. Its four selectable source
conditions become:

- RX FIFO nonempty.
- TX FIFO not full.
- RX level greater than or equal to the programmed RX threshold.
- TX level less than or equal to the programmed TX threshold.

The existing enable, source select, threshold fields, and sticky observed flag
retain their current read and write behavior.

## 6. Reset and Priority

All reset behavior is synchronous and active-low. Soft reset has highest
priority. It clears peripheral control and status registers, FIFO pointers and
levels, FIFO read-valid metadata, protocol state, and the UART transmit output
to idle.

FIFO clear pulses have priority over APB and protocol FIFO accesses in the same
clock. I2C mode-switch clears affect both FIFOs. UART RX and TX clears affect
only their respective FIFO and pending registered-read metadata.

## 7. Verification Strategy

Development follows test-driven steps. Each changed behavior is first expressed
as a failing self-checking Verilog-2005 test, then implemented minimally.

1. Update the independent I2C master test for `rd_en` followed by next-cycle
   `dout` consumption and correct first-byte transmission.
2. Update the independent I2C slave test for synchronous fetch stretching,
   empty-only underflow, address timeout, and mid-read fallback data.
3. Update `apb_i2c_tb.v` for real `sync_fifo` instances, the dummy-first RX read
   sequence, current full-FIFO simultaneous access behavior, command checks,
   interrupts, and all existing two-controller integration scenarios.
4. Replace the grouped UART test protocol with an `apb_uart_tb.v` test for
   separate RX/TX enables, one-byte TX pushes, dummy-first RX reads, clear
   pulses, level/full/empty reporting, loopback framing modes, and all four
   interrupt selections.
5. Compile every test with `sync_fifo.v` in its dependency list and run the
   complete affected regression.

The preferred verification flow is vks lint, compile, and simulate. If vks is
not available in the environment, that limitation is recorded and the project
simulations are run with the available Icarus and ModelSim flows. A completion
claim requires passing independent core tests and top-level APB integration
tests with no simulator errors or warnings attributable to these changes.

## 8. Out of Scope

- Changing I2C command operations, address support, timeout programming, or
  interrupt bit assignments.
- Adding UART framing-error, parity-error, or FIFO-overflow reporting.
- Adding a wrapper prefetch register or changing `sync_fifo` into a
  first-word-fall-through FIFO.
- Preserving the old UART grouped 1-to-4-byte transfer protocol.
