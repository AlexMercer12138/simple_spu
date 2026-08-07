# Registered Local Bus Design

## Goal

Convert the MERC32 instruction, data, peripheral, and debug access paths to a
registered request/response protocol, retain existing CPU behavior, and verify
that a complete 13-bit-memory configuration can meet a 150 MHz clock on an
XC7A200T while inferring both local memories as block RAM.

## Bus Protocol

Each transaction uses independent one-cycle request and response pulses:

1. The master presents a stable address, write data, and byte strobe while
   asserting exactly one of `rden` or `wren` for one `clk` cycle.
2. The master deasserts both request signals on the next cycle and waits. The
   address and payload may remain registered but are not part of the handshake
   after the request pulse.
3. The selected slave completes the transaction by asserting `ack` for exactly
   one `clk` cycle. Read data is valid in the same cycle as `ack`.
4. A slave may insert any number of wait cycles between request and response.
   The master must not issue another request while a transaction is pending.

Instruction and data RAM return `ack` one cycle after their request. The APB
bridge accepts a one-cycle local-bus request, retains the transaction internally,
and returns its existing `lb_valid` pulse as `ack`.

## RTL Changes

`merc32_core` keeps its registered ILB, DLB, and PLB outputs. CPU-generated
instruction and data requests are already single-cycle events. Debug requests
are accepted only once per JTAG transfer so a held debug command cannot repeat a
RAM or peripheral access. Return data and acknowledgements remain registered
before they are consumed by CPU execution or JTAG.

`MERC32_top` exposes `dlb_rden`, `dlb_wren`, `dlb_ack`, `ilb_rden`, `ilb_wren`,
and `ilb_ack`, and connects those signals directly to `merc32_core`. Existing
peripheral bridge interfaces remain unchanged.

`jtag_debug` emits `dbg_rden` or `dbg_wren` for one `clk` cycle when a validated
transfer starts. Its wait state drives both low until the single-cycle
`dbg_ack`; the response is then captured and returned through the existing CDC
handshake.

`spram` remains a single-clock, single-port 32-bit RAM with byte write enables.
It registers read data and generates a one-cycle `ack` from the one-cycle request.
No reset is added to the memory array or data output, preserving BRAM inference.

## Verification

All core and Tiny C RTL testbenches will model synchronous ILB/DLB responses and
will assert that every request and acknowledgement is a single-cycle pulse.
The JTAG testbench will explicitly delay responses and verify that one debug
command produces exactly one memory request. Existing CPU, interrupt, UART,
GPIO, timer, and I2C firmware results must remain unchanged.

The available environment has no VKS tools, so the repository's Icarus
Verilog-2005 flow is the simulation authority for this work. This limitation
will be stated in the final report.

## Vivado Implementation Check

A temporary, untracked synthesis wrapper will instantiate the complete
`MERC32_top` plus separate instruction and data `spram` instances, both with
`ADDR_WIDTH=13`. APB inputs will be tied to an always-ready benign slave. The
main `clk` receives a 6.666 ns constraint; JTAG `tck` is treated as asynchronous
to `clk` so the report measures the intended main-clock domain.

Vivado 2020.2 will target an installed `xc7a200t` package/speed-grade variant,
run synthesis, optimization, placement, routing, and timing reporting. Success
requires:

- both 8192x32 local memories to use `RAMB18E1` and/or `RAMB36E1` resources;
- routed worst negative slack for the 150 MHz main clock to be non-negative;
- no critical implementation errors or unconstrained main-clock paths.

Vivado reports and generated project data remain in a temporary directory and
are not added to the repository.

## Scope

This change updates the registered local-bus integration, JTAG request pulse,
RAM handshake tests, and synthesis verification only. It does not change the
instruction set, compiler, peripherals, or unrelated `apb_sdio` work.
