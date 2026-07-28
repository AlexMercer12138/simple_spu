# Tiny C UART RTL Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that Tiny C firmware can access the APB UART through the MERC32 peripheral bus and transmit `MERC32\r\n` in RTL simulation.

**Architecture:** A single-file Tiny C fixture uses volatile pointers at UART base `0x10000000`. The existing Node RTL runner compiles two independent cases, while a new Verilog-2005 top-level testbench connects `MERC32_top`, `lb2apb`, and `apb_uart`, decodes UART TX, and requires both the expected bytes and the firmware pass status.

**Tech Stack:** Tiny C, Node.js, Verilog-2005, Icarus Verilog.

---

### Task 1: Add Polling UART Firmware

**Files:**
- Create: `example/tinyc_uart_test.c`

- [ ] Define volatile register pointers for `CONFIG`, `CTRL`, `TX_BUF`, and `TX_STATUS` at offsets `0x04`, `0x00`, `0x10`, and `0x14` from `0x10000000`.
- [ ] Configure 100000 baud and wait at least 64 generated CPU loop iterations for divider convergence.
- [ ] Send `0x4d455243` and `0x33320d0a` as two four-byte transfers.
- [ ] Write `0x600d` to `0x008003c0` after both writes; retain `0x0bad` at `0x008003c4` for future failure detail.

### Task 2: Extend the RTL Runner and Establish RED

**Files:**
- Modify: `merc32-vsce/scripts/test-c-rtl.js`

- [ ] Refactor the existing single case into a `runFirmwareTest(testCase)` function.
- [ ] Keep `tinyc_feature_test` on `tinyc_cpu_tb` with `core.v`.
- [ ] Add `tinyc_uart_test` on `tinyc_uart_tb` with `core.v`, `lb2apb.v`, `MERC32_top.v`, and `apb_uart.v`.
- [ ] Run `npm run test:c:rtl` before creating `tinyc_uart_tb.v` and verify compilation fails because that top module/file is absent.

### Task 3: Add CPU + UART Integration Testbench

**Files:**
- Create: `rtl/sim/tinyc_uart_tb.v`

- [ ] Load ROM using `+ROM_FILE` and `+ROM_WORDS`.
- [ ] Instantiate `MERC32_top` and connect its APB master directly to `apb_uart` configured for a 1 MHz clock.
- [ ] Model 65536 DLB words and monitor status word 240 for pass/fail.
- [ ] Decode eight UART bytes at a 10-clock baud divisor and compare against `4d 45 52 43 33 32 0d 0a`.
- [ ] Print `TEST PASS` only after both the byte sequence and firmware status pass; print `TEST FAIL` or `TEST TIMEOUT` otherwise.
- [ ] Keep wave dumping commented out by default.

### Task 4: Verify M2 and Regressions

**Files:**
- Test: `example/tinyc_uart_test.c`
- Test: `merc32-vsce/scripts/test-c-rtl.js`
- Test: `rtl/sim/tinyc_uart_tb.v`

- [ ] Run `npm run test:c:rtl` and require both firmware cases to pass.
- [ ] Run `npm test` and require pseudo-instruction and compiler integration tests to pass.
- [ ] Run the standalone APB UART test and require `TEST PASS` with no failure marker.
- [ ] Run `git diff --check` and confirm temporary simulator artifacts are absent from the workspace.

Interrupt-driven C handlers, headers, and multi-file firmware remain out of M2 scope.
