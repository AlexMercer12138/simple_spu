# Tiny C UART Interrupt Design

## 1. Goal

Add one non-nested interrupt entry to MERC32 Tiny C and use it to handle UART
receive interrupts through a C function. The implementation must preserve the
interrupted C program's register state and comparison result, return through the
hardware interrupt return address, and pass both focused CPU simulation and a
full Tiny C-to-UART RTL integration test.

## 2. Scope

This milestone includes:

- one reserved Tiny C interrupt handler named `void __irq_handler(void)`;
- a compiler-generated vector and assembly wrapper;
- explicit Tiny C interrupt enable and disable builtins;
- CPU support for preserving comparison state across an interrupt;
- non-nested interrupt execution;
- a UART RX-valid interrupt firmware test with two received and echoed bytes;
- compiler, CPU RTL, and CPU-plus-UART RTL regression tests;
- ABI and ISA documentation updates.

This milestone does not include multiple vectors, interrupt priorities, nested
interrupts, queued interrupt events, CAN, an RTOS, or a general-purpose register
allocator.

## 3. CPU Interrupt State

### 3.1 `r1` layout

`r1` becomes a mixed software-control and hardware-status register:

| Bits | Access | Meaning |
|---|---|---|
| `[0]` | RW | Interrupt enable |
| `[2:1]` | RW | Trigger mode: rise, fall, high, or low |
| `[3]` | RO | Saved `EQ` comparison result |
| `[4]` | RO | Saved signed-greater-or-equal (`SGE`) result |
| `[5]` | RO | Saved signed-greater-than (`SGT`) result |
| `[6]` | RO | Saved unsigned-greater-or-equal (`UGE`) result |
| `[7]` | RO | Saved unsigned-greater-than (`UGT`) result |
| `[31:8]` | RO | Reserved, reads as zero |

Normal instruction writes to `r1` update only `[2:0]`. Reset clears the whole
register. Hardware writes `[7:3]` only when accepting an interrupt, so C code and
the ISR cannot overwrite the saved comparison state.

### 3.2 Entry and return

The CPU accepts an interrupt only when the configured trigger hits, interrupts
are enabled, and `irq_active` is clear. At the instruction boundary where the
interrupt is accepted, hardware:

1. stores the normal resume address in read-only `r3`;
2. copies `EQ/SGE/SGT/UGE/UGT` into `r1[7:3]`;
3. sets internal `irq_active`;
4. redirects execution to the byte address held in `r2`.

While `irq_active` is set, additional interrupt events are discarded rather
than nested or queued. The CPU recognizes the existing no-link `jmp r3`
encoding as an interrupt return only while `irq_active` is set. At that
instruction boundary it restores all five comparison results from `r1[7:3]`,
clears `irq_active`, and resumes at the address in `r3`.

The saved comparison bits remain readable until the next accepted interrupt.
Executing `jmp r3` outside an active interrupt keeps its existing ordinary jump
behavior.

## 4. Tiny C Interface

### 4.1 Reserved handler

The compiler recognizes one reserved function:

```c
void __irq_handler(void) {
    /* application handler */
}
```

The handler must:

- return `void`;
- have no parameters;
- have a function body;
- be defined at most once under the compiler's existing duplicate-name rules.

A declaration without a definition is rejected. Because it is called through a
compiler-generated wrapper, the handler may use ordinary Tiny C control flow,
local variables, function calls, comparisons, loops, and MMIO accesses.

### 4.2 Interrupt control builtins

Tiny C adds two zero-argument builtins:

```c
void __irq_enable(void);
void __irq_disable(void);
```

`__irq_enable()` writes `3'b001` to `r1[2:0]`, enabling rising-edge triggering.
`__irq_disable()` writes zero to `r1[2:0]`. The high saved-status bits are
unaffected because they are read-only to normal instructions.

Using either builtin without a valid `__irq_handler` definition is a compiler
error. The first milestone intentionally exposes only rising-edge enable because
that is the safe mode for the UART source and avoids an unused configuration API.

## 5. Generated Program Layout

Programs without `__irq_handler` keep the current assembly layout and startup
behavior unchanged. Programs with a handler use this fixed prefix:

```asm
.entry __start

// The assembler injects `jmp __start` at machine byte address 0.
__irq_vector:             // first source instruction; machine byte address 4
    // compiler-generated wrapper

__start:
    // initialize SP and globals
    mov r2, 4
    jmp main, r14
```

The compiler does not emit another reset jump. The existing assembler `.entry`
preprocessing remains the sole owner of the machine instruction at byte address
0. Placing `__irq_vector` before the source-level `__start` label makes the
fixed vector address independent of the wrapper length.

The CPU interrupt remains disabled after reset. Firmware configures the UART and
its interrupt source first, then calls `__irq_enable()`.

## 6. Compiler-Generated Wrapper

The wrapper allocates 28 bytes below the interrupted software stack pointer and
saves every register currently used or clobbered by the Tiny C ABI:

| Offset | Saved register |
|---|---|
| `0` | `r4` |
| `4` | `r5` |
| `8` | `r6` |
| `12` | `r7` |
| `16` | `r8` |
| `20` | `r12` |
| `24` | `r14` |

It then calls `__irq_handler` using the normal ABI. On return it restores the
registers in reverse order, restores `r13` by releasing the 28-byte wrapper
frame, and executes `jmp r3`.

`r1`, `r2`, `r3`, and `r15` are dedicated hardware/control registers and are
not part of the saved C register set. `r9-r11` are not used by the current Tiny C
backend. `r13` is restored structurally rather than stored as a separate word.

An interrupt may occur during an ordinary function prologue, epilogue, call, or
memory access. The wrapper uses the current valid `r13` value and restores it
exactly, while the hardware waits for the current instruction boundary before
entering the vector.

## 7. UART Interrupt Flow

The integration firmware configures the UART RX-valid interrupt source, then
calls `__irq_enable()`. The testbench injects two bytes after firmware reports
that initialization is complete.

For each byte, `__irq_handler`:

1. disables and clears the UART interrupt register so the external source falls;
2. starts a one-byte receive operation;
3. waits for persistent `RX_STATUS.RX_PTR != 0`;
4. reads the byte from `RX_BUF`;
5. stores the byte and increments a volatile global IRQ count;
6. re-enables the UART RX-valid interrupt source;
7. returns through the generated wrapper.

The main program performs ordinary comparison-heavy work while waiting for the
volatile IRQ count. After each return it echoes the received byte. It writes the
firmware pass code only after both bytes were received by the handler, echoed in
order, and the foreground sentinel state remained intact.

The handler must make the UART source inactive before returning. Because events
that arrive while `irq_active` is set are not queued, the UART FIFO and source
clearing sequence are part of the documented first-milestone contract.

## 8. Validation

### 8.1 Compiler tests

Tests first establish failures for missing functionality, then verify:

- exact handler signature acceptance;
- rejection of a non-void handler;
- rejection of handler parameters;
- rejection of a declaration without a body;
- rejection of interrupt builtins without a handler;
- fixed vector placement at byte address 4;
- wrapper save/call/restore/return assembly;
- `r2` initialization and explicit `r1` builtin writes;
- unchanged assembly for programs without a handler.

### 8.2 Focused CPU RTL test

A new self-checking `merc32_core_tb.v` loads a compiler-generated Tiny C ROM and
drives the core directly. It triggers one accepted interrupt while foreground
code executes an equality comparison, then injects another event while the ISR
is active to verify that it is discarded. The accepted interrupt must resume at
the branch following the compare. The ISR deliberately performs comparisons and
an ordinary C call.

The test passes only when:

- the foreground branch result remains correct after return;
- `r4-r8`, `r12-r14`, and `r13` are restored;
- the expected ISR count is reached without nested entry;
- the fixed vector and `jmp r3` return path are exercised;
- exactly one `TEST PASS` marker appears and no failure or timeout marker appears.

### 8.3 UART RTL integration test

A new Tiny C UART IRQ firmware and top-level testbench instantiate the existing
`MERC32_top`, `lb2apb`, and `apb_uart` modules. The testbench injects two UART
bytes, checks both echoed bytes, checks the firmware status and IRQ count, and
uses a bounded watchdog. Waveform dumping remains present but commented out.

The existing polling UART firmware test remains in the suite as a regression.
The JavaScript RTL runner continues to use temporary directories and deletes all
generated memory images and simulator outputs in `finally` cleanup.

### 8.4 Verification tools

Verilog remains Verilog-2005. The preferred flow is VKS lint, compile, and
simulation when the VKS MCP tools are available. If they remain unavailable in
the active environment, Icarus Verilog is the explicit fallback and the final
report must state that no VKS result or VKS bug observation was possible.

## 9. Documentation

`ABI.md` will document the reserved handler, builtins, wrapper frame, `r1`
mixed-access layout, non-nested behavior, and UART source-clearing requirement.
`ISA.md` will document the interrupt interpretation of `r1-r3` and the
`irq_active`-qualified `jmp r3` return behavior.

## 10. Expected File Changes

- Modify `rtl/cpu/core.v` for `r1` saved flags, `irq_active`, and interrupt return.
- Modify `merc32-vsce/src/cCompiler/tinyc.ts` for handler validation, builtins,
  fixed vector emission, and wrapper generation.
- Modify `merc32-vsce/scripts/test-c-compiler.js` for compiler RED/GREEN tests.
- Modify `merc32-vsce/scripts/test-c-rtl.js` to run the focused IRQ and UART IRQ
  firmware cases.
- Create `rtl/sim/merc32_core_tb.v` as the independent CPU interrupt testbench.
- Create `rtl/sim/tinyc_uart_irq_tb.v` as the CPU-plus-UART integration testbench.
- Create focused Tiny C IRQ and UART IRQ firmware fixtures under `example/`.
- Update `ABI.md` and `ISA.md`.

Production UART RTL and CAN files are not changed by this milestone.
