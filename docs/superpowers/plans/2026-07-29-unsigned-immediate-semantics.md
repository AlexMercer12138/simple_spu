# Unsigned Comparison Immediate Semantics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Align comparison documentation and tests with the approved mixed immediate-extension rule.

**Architecture:** The instruction encoding remains unchanged. EQ/NE and signed relational conditions sign-extend `imm16`; unsigned relational conditions zero-extend `imm16`. Assembler literals continue to emit the same 16-bit field, so `-1` and `0xffff` both encode `16'hffff` and are interpreted as 65535 by unsigned relational conditions.

**Tech Stack:** Markdown specifications, Verilog-2005 testbench, TypeScript assembler/compiler test suites, Icarus Verilog integration tests.

---

### Task 1: Update The Architectural Contract

**Files:**
- Modify: `docs/superpowers/specs/2026-07-29-compare-branch-isa-design.md`
- Modify: `TODO.md`
- Modify: `.worktrees/compare-branch-software/ISA.md`
- Modify: `.worktrees/compare-branch-software/merc32-vsce/README.md`

- [x] **Step 1: Replace the universal sign-extension rule**

Document this exact rule:

```text
EQ/NE, SGE/SLT/SGT/SLE: sign_extend(imm16)
UGE/ULT/UGT/ULE:        zero_extend(imm16)
```

State that `cmpu ==/!=` are encoding aliases of `cmp ==/!=` and therefore use the EQ/NE sign-extension rule.

- [x] **Step 2: Update validation language**

Replace the old expectation that unsigned `16'hffff` becomes `32'hffffffff` with the required value `32'h0000ffff`.

### Task 2: Correct The RTL Test Expectation

**Files:**
- Modify: `rtl/sim/merc32_core_tb.v`

- [x] **Step 1: Keep negative EQ coverage**

Retain the checks that `-32768` and `-1` compare equal after EQ/NE sign extension.

- [x] **Step 2: Change the unsigned boundary assertion**

For `R[4] = 32'h00010000` and `imm16 = 16'hffff`, require ULT to write zero:

```verilog
check_value("unsigned compare zero-extends 16'hffff",
            merc32_core_inst.regi_int[5], 32'd0);
```

### Task 3: Run Regression Tests

**Files:**
- Test: `rtl/sim/merc32_core_tb.v`
- Test: `merc32-vsce/scripts/test-c-rtl.js`
- Test: `.worktrees/compare-branch-software/merc32-vsce/scripts/test-pseudo-instructions.js`
- Test: `.worktrees/compare-branch-software/merc32-vsce/scripts/test-c-compiler.js`

- [x] **Step 1: Run the core directed suite**

```powershell
iverilog -Wall -Wno-timescale -g2005 -s merc32_core_tb -o rtl/sim/merc32_core_tb.vvp rtl/cpu/core.v rtl/sim/merc32_core_tb.v
vvp rtl/sim/merc32_core_tb.vvp
```

Expected: no sign-extension failures; report any independent `r15` or interrupt failure without changing RTL.

- [x] **Step 2: Run assembler and compiler tests**

```powershell
Set-Location .worktrees/compare-branch-software/merc32-vsce
npm test
```

Expected: pseudo-instruction and Tiny C integration tests pass.

- [x] **Step 3: Run CPU, UART, and minimal IRQ integration**

```powershell
$env:MERC32_TOOLCHAIN_ROOT='D:\Software\simple_cpu\.worktrees\compare-branch-software\merc32-vsce'
Set-Location merc32-vsce
node scripts/test-c-rtl.js
```

Expected: exactly three `TEST PASS` markers and a final three-test suite pass message.

- [x] **Step 4: Remove generated simulator output**

Delete only `rtl/sim/merc32_core_tb.vvp` after the run and confirm it no longer exists.
