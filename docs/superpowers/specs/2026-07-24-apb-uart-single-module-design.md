# APB UART Single-Module Design

## Goal

Create `rtl/uart/apb_uart_new.v` containing one self-contained
`apb_uart_new` module. The module combines the current APB register block,
interrupt logic, UART FIFOs, baud-rate divider, receiver, and transmitter.
The existing `apb_uart.v` and `uart_top.v` files remain unchanged.

## External Interface

`apb_uart_new` keeps the current `apb_uart` parameters and ports:

- Parameters: `SYS_CLK_FREQ`, `FIFO_DEPTH`
- APB inputs: `s_apb_pclk`, `s_apb_presetn`, `s_apb_psel`,
  `s_apb_penable`, `s_apb_pwrite`, `s_apb_paddr`, `s_apb_pwdata`
- APB outputs: `s_apb_pready`, `s_apb_pslverr`, `s_apb_prdata`
- Peripheral signals: `interrupt`, `uart_rx`, `uart_tx`

The module does not expose or instantiate the AXI-Stream-style interface used
between the old `apb_uart` and `uart_top` modules.

## Register Compatibility

The seven current registers keep their addresses, bit definitions, reset
values, and access side effects:

| Offset | Register | Behavior |
| --- | --- | --- |
| `0x00` | `CTRL` | RX/TX start, transfer length, UART soft reset |
| `0x04` | `CONFIG` | Baud rate, parity, and stop-bit configuration |
| `0x08` | `RX_BUF` | Received bytes; read clears the buffer and pointer |
| `0x0c` | `RX_STATUS` | RX handshake, transfer count, FIFO count, pointer |
| `0x10` | `TX_BUF` | Bytes to transmit; write clears the pointer |
| `0x14` | `TX_STATUS` | TX handshake, transfer count, FIFO count, pointer |
| `0x18` | `INTERRUPT` | Interrupt enable, source, flag, and thresholds |

APB timing and `PSLVERR` behavior remain unchanged.

## Internal Architecture

The APB register and interrupt logic is retained in its current order and
style. The body of the current, locally modified `uart_top.v` is moved into
the new module and connected directly to the APB control signals. Clock and
reset references use `s_apb_pclk`; UART-only state uses a local reset derived
from `s_apb_presetn & ~soft_rst`.

The merge removes only the module boundary. Necessary internal flow-control
signals remain, with names that distinguish APB transfer control, FIFO
operations, and UART PHY state.

## Standard Synchronous FIFOs

TX and RX each use an inline 8-bit synchronous FIFO. Each FIFO contains a RAM,
write pointer, read pointer, occupancy counter, registered read data, and a
one-cycle read-valid pipeline. `FIFO_DEPTH` retains its existing power-of-two
constraint.

A write occurs only when `wr_en && !full`. A read request occurs only when
`rd_en && !empty`. The accepted read advances the read pointer and decrements
the occupancy count at that edge. The RAM data becomes available through the
registered output after the edge, and a corresponding `rd_valid` is observed
by the consumer on the following cycle. Concurrent accepted read and write
operations leave the occupancy count unchanged.

The old `first_wren`, `true_rden`, and implicit-prefetch logic is not used.

## RX Timing

The UART receiver writes a completed byte to the RX FIFO when the FIFO is not
full. The APB receive controller issues one FIFO read request only when RX is
enabled, the FIFO is non-empty, and no read is pending. A pending flag prevents
duplicate requests during the read-latency cycle.

Only `rx_fifo_rd_valid`, not the read request, commits the byte to
`uart_rx_buf`, advances the buffer pointer, increments the transfer count, and
ends the requested transfer. This prevents stale FIFO output from entering the
APB-visible buffer.

## TX Timing

The APB transmit controller writes selected bytes from `uart_tx_buf` into the
TX FIFO using the existing length and pointer rules. The UART transmitter
issues a FIFO read only while idle, the FIFO is non-empty, and no read is
pending.

On `tx_fifo_rd_valid`, the transmitter captures the registered FIFO output into
its shift register and starts the UART frame. It never starts on the read
request itself, so the first and subsequent bytes cannot use the previous
FIFO output.

## Verification

Add `rtl/sim/apb_uart_new_tb.v` and compile it with only
`rtl/uart/apb_uart_new.v`. This proves that the new module has no custom RTL
dependencies. The testbench covers:

- APB reset values and the current seven-register address map
- One-, two-, three-, and four-byte UART loopback transfers
- First-byte correctness after an empty-to-non-empty FIFO transition
- Back-to-back FIFO traffic and one-cycle read latency
- RX/TX status counts and buffer-pointer side effects
- UART soft reset and interrupt behavior

The testbench uses a self-checking error count and a finite timeout. Lint,
compile, and simulation must all pass before the new module is reported ready.

## Out of Scope

- Modifying or deleting `rtl/uart/apb_uart.v`
- Modifying or deleting `rtl/uart/uart_top.v`
- Changing the APB register map or software-visible behavior
- Adding a dependency on `rtl/misc/sync_fifo.v`
- Refactoring unrelated CPU, bridge, CAN, or SPI RTL
