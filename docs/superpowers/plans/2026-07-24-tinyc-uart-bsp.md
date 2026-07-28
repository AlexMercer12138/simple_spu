# Tiny C Polling UART BSP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide and execute a minimal single-file polling UART BSP in the Tiny C subset.

**Architecture:** The firmware exposes `uart_init`, bounded TX/RX wait helpers, `uart_putc`, `uart_write`, and `uart_getc` using only `unsigned int`, pointers, arrays, and control flow already supported by Tiny C. The RTL testbench sends one `!` byte after receiving `MERC32\r\n` and requires the firmware to echo it before PASS.

**Tech Stack:** Tiny C, Verilog-2005, existing Node RTL runner.

---

### Task 1: Establish Echo as RED

**Files:**
- Modify: `rtl/sim/tinyc_uart_tb.v`

- [ ] Drive `uart_rx` from a testbench register.
- [ ] Add a UART transmit stimulus task for `0x21` (`!`).
- [ ] Require a ninth transmitted byte equal to `0x21` before setting `uart_sequence_done`.
- [ ] Run `npm run test:c:rtl` and verify the UART case times out because the current firmware never reads or echoes RX data.

### Task 2: Implement the Single-File Polling BSP

**Files:**
- Modify: `example/tinyc_uart_test.c`

- [ ] Add `uart_init(baud_rate)` with the existing 64-iteration divider wait.
- [ ] Add bounded TX and RX polling helpers that return zero on timeout.
- [ ] Add `uart_putc`, `uart_write(unsigned int *data, int length)`, and `uart_getc(unsigned int *value)`.
- [ ] Build `MERC32\r\n` in a local eight-word array, send it through `uart_write`, receive one byte, and echo it through `uart_putc`.
- [ ] On any timeout, write a distinct detail code to `0x008003c4` and `0x0bad` to `0x008003c0`.

### Task 3: Verify BSP and Regressions

**Files:**
- Test: `example/tinyc_uart_test.c`
- Test: `rtl/sim/tinyc_uart_tb.v`

- [ ] Run `npm run test:c:rtl` and require both the feature and UART cases to pass.
- [ ] Run `npm test` and the standalone UART simulation.
- [ ] Run `git diff --check` and confirm no `.vvp`, `.mem`, or `.vcd` files were added.

Interrupt-driven handlers remain the next independent milestone.
