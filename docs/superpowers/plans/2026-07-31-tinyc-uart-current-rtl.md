# Tiny C UART Current-RTL Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the obsolete Tiny C UART programming sequence with a bounded FIFO-based driver and prove TX, RX timeout, RX data, and echo on the current UART RTL.

**Architecture:** Keep `example/tinyc_uart_test.c` as one independently compilable source containing the driver and test entry point. Update the existing CPU-plus-UART testbench to synchronize external RX stimulus through the DLB detail mailbox and require both firmware success and serialized-line checks.

**Tech Stack:** Tiny C, MERC32 assembler/CPU, Verilog-2005, APB UART, Node.js RTL runner, Icarus Verilog; use vks lint/compile/simulate if those tools become available.

---

## File Map

- Modify `rtl/sim/tinyc_uart_tb.v`: current-UART physical monitor, mailbox handshake, timeout, and final verdict.
- Modify `example/tinyc_uart_test.c`: FIFO-based polling driver and self-test.
- Verify `merc32-vsce/scripts/test-c-rtl.js`: the existing UART entry already contains the current JTAG and `sync_fifo` dependencies; do not rewrite unrelated user changes.

### Task 1: Make the Current UART Contract Fail First

**Files:**
- Modify: `rtl/sim/tinyc_uart_tb.v`
- Test: `example/tinyc_uart_test.c`

- [ ] **Step 1: Add a firmware-to-testbench RX handshake**

Add a DLB detail index and handshake value beside the existing status constants:

```verilog
localparam STATUS_ADDR = 16'd240;
localparam DETAIL_ADDR = 16'd241;
localparam UART_RX_REQUEST = 32'h0000_1001;
```

Replace immediate RX injection after the banner with a bounded mailbox wait:

```verilog
integer handshake_wait = 0;

while ((dlb_ram[DETAIL_ADDR] !== UART_RX_REQUEST) &&
       (handshake_wait < 100000)) begin
    @(posedge clk);
    handshake_wait = handshake_wait + 1;
end
if (dlb_ram[DETAIL_ADDR] !== UART_RX_REQUEST) begin
    $display("TEST FAIL: UART RX handshake missing detail=0x%08h",
             dlb_ram[DETAIL_ADDR]);
    uart_error_count = uart_error_count + 1;
end else begin
    send_uart_byte(8'h21);
    receive_uart_byte(received_byte);
    if (received_byte !== 8'h21) begin
        $display("TEST FAIL: UART echo expected=21 actual=%02h",
                 received_byte);
        uart_error_count = uart_error_count + 1;
    end
end
uart_sequence_done = 1'b1;
```

Keep the expected banner bytes `4d 45 52 43 33 32 0d 0a`, the external UART
decoder, the firmware mailbox monitor, and the testbench-owned timeout.

- [ ] **Step 2: Run the UART closed loop and observe RED**

Run:

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: `tinyc_uart_test` fails or times out because the current source still
uses the old `CTRL`, byte-lane, and RX-status semantics and never produces the
new `0x1001` handshake. Earlier independent Tiny C tests may pass.

- [ ] **Step 3: Commit only the failing test**

```powershell
git add -- rtl/sim/tinyc_uart_tb.v
git diff --cached --check
git commit -m "test: define current Tiny C UART closed loop"
```

### Task 2: Implement the Current FIFO-Based UART Driver

**Files:**
- Modify: `example/tinyc_uart_test.c`
- Test: `rtl/sim/tinyc_uart_tb.v`

- [ ] **Step 1: Replace the old UART helpers with the current register contract**

Use these constants and helpers at the start of the single source file:

```c
unsigned int status_addr = 0x008003C0;
unsigned int detail_addr = 0x008003C4;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;
unsigned int uart_base = 0x10000000;

void uart_delay(int count) {
    int index = 0;
    while (index < count) {
        index = index + 1;
    }
}

void uart_init(unsigned int baud_rate) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;

    uart[0] = 0x80000000;
    uart[1] = baud_rate;
    uart_delay(64);
    uart[0] = 0x0000000C;
    uart[0] = 0x00000003;
}

int uart_wait_tx(int limit) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;

    while ((uart[5] & 0x200) != 0) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    return 1;
}

int uart_putc(unsigned int value) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;

    if (uart_wait_tx(100000) == 0) {
        return 0;
    }
    uart[4] = value & 0xFF;
    return 1;
}

int uart_write(unsigned int *data, int length) {
    int index = 0;
    while (index < length) {
        if (uart_putc(data[index]) == 0) {
            return 0;
        }
        index = index + 1;
    }
    return 1;
}

int uart_getc_with_limit(unsigned int *value, int limit) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;
    unsigned int discarded = 0;

    while ((uart[3] & 0xFF) == 0) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    discarded = uart[2];
    *value = uart[2] & 0xFF;
    return 1;
}

int uart_getc(unsigned int *value) {
    return uart_getc_with_limit(value, 100000);
}
```

The discarded RX read is intentional: `sync_fifo.dout` updates after the APB
read that pops the requested byte.

- [ ] **Step 2: Replace `main` with the bounded self-test**

Use one failure helper and explicit stage codes:

```c
int uart_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)status_addr;
    volatile unsigned int *detail =
        (volatile unsigned int *)detail_addr;

    *detail = stage;
    *status = fail_code;
    return 1;
}

int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)status_addr;
    volatile unsigned int *detail =
        (volatile unsigned int *)detail_addr;
    unsigned int message[8];
    unsigned int received = 0;

    message[0] = 0x4D;
    message[1] = 0x45;
    message[2] = 0x52;
    message[3] = 0x43;
    message[4] = 0x33;
    message[5] = 0x32;
    message[6] = 0x0D;
    message[7] = 0x0A;

    uart_init(100000);
    if (uart_write(message, 8) == 0) {
        return uart_fail(1);
    }
    if (uart_getc_with_limit(&received, 128) != 0) {
        return uart_fail(2);
    }
    *detail = 0x1001;
    if (uart_getc(&received) == 0) {
        return uart_fail(3);
    }
    if (received != 0x21) {
        return uart_fail(4);
    }
    if (uart_putc(received) == 0) {
        return uart_fail(5);
    }

    *status = pass_code;
    return 0;
}
```

- [ ] **Step 3: Run the focused closed loop and observe GREEN**

Run:

```powershell
Push-Location merc32-vsce
npm run test:c:rtl
Pop-Location
```

Expected: `tinyc_uart_test RTL execution test passed`; its testbench prints
exactly one `TEST PASS`, with no `TEST FAIL` or `TEST TIMEOUT` marker.

- [ ] **Step 4: Commit the UART driver**

```powershell
git add -- example/tinyc_uart_test.c
git diff --cached --check
git commit -m "feat: update Tiny C UART driver for FIFO RTL"
```

### Task 3: Run UART and Toolchain Regressions

**Files:**
- Test: `example/tinyc_uart_test.c`
- Test: `rtl/sim/tinyc_uart_tb.v`
- Test: `rtl/sim/apb_uart_tb.v`

- [ ] **Step 1: Run the complete Tiny C compiler regression**

```powershell
Push-Location merc32-vsce
npm test
Pop-Location
```

Expected: pseudo-instruction and Tiny C compiler suites pass.

- [ ] **Step 2: Run the APB UART unit test outside the repository directory**

```powershell
$uartVvp = Join-Path $env:TEMP 'apb_uart_tb.vvp'
iverilog -Wall -Wno-timescale -g2005 -s apb_uart_tb -o $uartVvp `
  rtl/misc/sync_fifo.v rtl/uart/apb_uart.v rtl/sim/apb_uart_tb.v
Push-Location $env:TEMP
vvp $uartVvp
Pop-Location
```

Expected: exactly one final `TEST PASS` and no `[FAIL]`, `TEST FAIL`, or
`TEST TIMEOUT` marker. Running from `%TEMP%` contains the currently enabled VCD
output outside the worktree.

- [ ] **Step 3: Record simulator availability and inspect artifacts**

Use vks lint/compile/simulate for `tinyc_uart_tb` if the vks tools are exposed.
If they are not exposed, record that fact in the final report and use the
repository Icarus run above as the verified simulator result.

```powershell
git diff --check
rg --files -g '*.vvp' -g '*.vcd' -g '*.mem'
git status --short
```

Expected: no whitespace errors and no new generated simulator artifact in the
repository. Do not stage or alter unrelated existing worktree changes.
