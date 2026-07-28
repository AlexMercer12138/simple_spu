# Tiny C RTL Closed Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one command that compiles the Tiny C feature program, assembles it, executes the resulting machine code on `merc32_core`, and fails unless the firmware writes the expected pass status.

**Architecture:** A Node.js runner reuses the compiled `compileC` and `SimpleCPUAssembler` APIs, writes machine words to an operating-system temporary `.mem` file, and invokes a generic Verilog-2005 CPU testbench. The testbench owns only ROM/RAM models and the firmware status protocol; generated ROM, assembly, simulator binaries, and waveforms never enter the repository.

**Tech Stack:** TypeScript build output, Node.js, Verilog-2005, Icarus Verilog, PowerShell verification.

---

### Task 1: Align the UART Manual With RTL

**Files:**
- Modify: `rtl/uart/apb_uart_manual.md`

- [ ] **Step 1: Correct the interrupt register bit table**

Document bits `[15:5]` and `[3]` as reserved. Document `INT_FLAG[4]` as a sticky flag that hardware sets and software clears by writing bit 4 as zero; reads preserve it.

- [ ] **Step 2: Verify the obsolete read-clear wording is gone**

Run: `rg -n "INT_FLAG|读写清除|读后清除" rtl/uart/apb_uart_manual.md`

Expected: `INT_FLAG` describes write-zero clearing and no result says that reading clears it.

### Task 2: Establish the Missing RTL Test as RED

**Files:**
- Modify: `merc32-vsce/package.json`

- [ ] **Step 1: Add the command before its runner exists**

Add:

```json
"test:c:rtl": "npm run compile && node scripts/test-c-rtl.js"
```

- [ ] **Step 2: Run the command and verify the expected failure**

Run: `npm run test:c:rtl`

Expected: FAIL because `scripts/test-c-rtl.js` does not exist yet.

### Task 3: Add the Generic CPU Firmware Testbench

**Files:**
- Create: `rtl/sim/tinyc_cpu_tb.v`

- [ ] **Step 1: Add a Verilog-2005 integration testbench**

The testbench must:

- accept `+ROM_FILE=<absolute path>` via `$value$plusargs`;
- initialize a 65536-word ROM and DLB RAM;
- instantiate `merc32_core` with debug and PLB inputs tied inactive;
- serve ROM asynchronously and DLB RAM synchronously like `core_full_tb.v`;
- report `TEST PASS` on a write of `0x0000600d` to DLB word 240;
- report `TEST FAIL` on `0x00000bad` or after 100000 cycles;
- keep `$dumpfile` and `$dumpvars` commented out by default.

- [ ] **Step 2: Compile the testbench directly**

Run:

```powershell
iverilog -Wall -g2005 -s tinyc_cpu_tb -o $env:TEMP\tinyc_cpu_tb.vvp rtl/cpu/core.v rtl/sim/tinyc_cpu_tb.v
```

Expected: exit code 0 with no compile errors.

### Task 4: Add the Node.js Toolchain-to-RTL Runner

**Files:**
- Create: `merc32-vsce/scripts/test-c-rtl.js`

- [ ] **Step 1: Compile and assemble the feature program**

Use these existing APIs:

```javascript
const { compileC } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

const { assembly } = compileC(source, { moduleName: 'tinyc_feature_test' });
const result = new SimpleCPUAssembler().assemble(assembly, {
    sourceFileName: sourcePath,
});
```

- [ ] **Step 2: Write a temporary readmemh image**

Convert each word with:

```javascript
const memoryImage = result.machineCodes
    .map((word) => (word >>> 0).toString(16).padStart(8, '0'))
    .join('\n');
```

- [ ] **Step 3: Compile and run RTL**

Invoke `iverilog` and `vvp` with argument arrays, capture simulator output, and fail when compilation fails, simulation exits nonzero, `TEST PASS` is absent, or `TEST FAIL`/`TEST TIMEOUT` is present.

- [ ] **Step 4: Clean temporary files**

Create the working directory with `fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-tinyc-rtl-'))` and remove it in `finally` with `fs.rmSync(tempDir, { recursive: true, force: true })`.

### Task 5: Verify the Milestone

**Files:**
- Test: `merc32-vsce/scripts/test-c-rtl.js`
- Test: `rtl/sim/tinyc_cpu_tb.v`

- [ ] **Step 1: Run the new end-to-end test**

Run: `npm run test:c:rtl`

Expected: compiler and assembler complete, RTL prints `TEST PASS`, command exits 0.

- [ ] **Step 2: Run existing toolchain regressions**

Run: `npm test`

Expected: pseudo-instruction and Tiny C compiler integration tests pass.

- [ ] **Step 3: Run standalone UART regression**

Compile `rtl/uart/apb_uart.v` with `rtl/sim/tb_apb_uart.v`, run it, and require exactly one `TEST PASS` with no `[FAIL]`, `TEST FAIL`, or `TEST TIMEOUT` marker.

- [ ] **Step 4: Inspect the final patch**

Run: `git diff --check` and `git status --short`.

Expected: no whitespace errors; the user's existing UART edits and deletion remain intact.

This plan intentionally stops at M1. CPU + APB UART firmware integration is M2 and should reuse the runner only after this milestone passes.
