# MERC32 Hardware Foundation Final Fix Report

## Status

PASS. The final review fixes are implemented and verified in the isolated
`codex/merc32-soc-generator` worktree and the authorized readable IP repository.

The simple_cpu fix wave started from
`dc2260a00e61e8042096253390cda6734bd5f234`. The IP fix started from
`8b09ac1718beed509c186573e9f4aca0faa46475`. Both repositories were clean at
their respective starting commits. No subagents or external reviewers were
used.

The protected `rtl/apb_intc/apb_intc.v` body was not printed or inspected. It
was handled only by pathname for packaging, compilation, status, size, and
SHA-256 operations.

## Fixes

### Tiny C DLB constraints

The public compiler now enforces all three locked layout rules:

- `dataBase` is in `0x08000000..0x0FFFFFFF`.
- `dlbAddrWidth` is an integer in `1..25`.
- `dataBase + 2 ** (dlbAddrWidth + 2)` is at most the exclusive limit
  `0x10000000`.

Compiler fixtures that previously depended on low or full-address-space
layouts now use valid DLB addresses. Exact-fit and static-overflow coverage was
retained. The package configuration exposes the `1..25` range, and the active
ABI and extension documentation describe the same constraints.

### High-level Tiny C interrupt intrinsic

`__irq_enable_level()` is a no-argument, `void` Tiny C intrinsic that emits
`mov r1, 5`. Existing behavior remains stable:

- `__irq_enable()` emits `mov r1, 1` for rising-edge direct interrupts.
- `__irq_disable()` emits `mov r1, 0`.

Compiler tests cover handler requirements, argument count, void expression
rules, and the exact three emitted control values. The IRQ firmware test holds
a high-level request through two handler entries, lowers it on the second
entry, and verifies two entries, return context, return address, final state,
and `r1 = 5`.

### Checked-in hardware regression gate

`npm run test:hardware` now compiles with
`iverilog -Wall -Wno-timescale -g2005` and runs:

1. `merc32_core_tb`
2. `MERC32_top_tb`
3. `MERC32_top_nodebug_tb`
4. `jtag_debug_tb`
5. `mul_tb`
6. `div_tb`
7. `spram_tb`
8. protected `apb_intc_tb`
9. `merc32_core_tb` with `DLB_ADDR_WIDTH=26`

Success requires process status zero, exactly one expected marker across stdout
and stderr, and no `TEST FAIL`, `TEST TIMEOUT`, or `FAIL:` marker. A unit-level
runner test rejects missing, wrong, duplicate, failure, timeout, and
pass-plus-failure output. The invalid-width invocation uses separate `-P` and
`merc32_core_tb.TEST_DLB_ADDR_WIDTH=26` arguments.

### Interrupt trigger contract

The design and generator-core plan now lock the two-bit encoding as:

| Value | Trigger |
|---:|---|
| `0` | high level |
| `1` | low level |
| `2` | rising edge |
| `3` | falling edge |

The planner task requires known IDs 0 through 3 in that order and explicitly
asserts `plan.interrupt.irqMode & 0xffn === 0xe4n`. The software-emission task
requires `MERC32_IRQ_TRIGGER_HIGH`, `MERC32_IRQ_TRIGGER_LOW`,
`MERC32_IRQ_TRIGGER_RISING`, `MERC32_IRQ_TRIGGER_FALLING`, and per-source
`<PROJECT>_<INSTANCE>_IRQ_TRIGGER` macros. The public INTC bench independently
checks that the `MODE_LO` low byte is `0xE4`.

The commented waveform scopes now use the exact case-sensitive module names
`MERC32_top_tb` and `MERC32_top_nodebug_tb`.

### APB INTC public output and protected release

The readable source in `D:\Development\Projects\ip-repo\intc\apb_intc.v`
declares `s_apb_prdata` as `output wire [31:0]`. Its combinational read mux drives
an internal `reg [31:0] apb_prdata`, which connects to the public net through a
continuous assignment. APB behavior is unchanged.

The library index reports 37 modules from 37 files and status `CURRENT`.
`rtl lib deps apb_intc` reports no dependencies. Packaging reported one module,
zero flattened instances, and 16 renamed symbols.

Protected output metadata after packaging:

```text
Path: D:\Development\Projects\simple_cpu\.worktrees\merc32-soc-generator\rtl\apb_intc\apb_intc.v
Length: 2589 bytes
SHA-256: F21C724649A1227A538607438FBCC8017220B186FB2429EDE8C468A6D34A533A
```

## RED/GREEN Evidence

### DLB validation

RED:

```powershell
Set-Location merc32-vsce
npm run test:c
```

Exit `1`. The new boundary assertion expected the DLB-specific diagnostic, but
the old compiler returned the generic
`dataBase must be between 0 and 0xFFFFFFFF`; it also had no `1..25` upper-width
contract or DLB-exclusive-limit check.

GREEN:

```powershell
npm run test:c
```

Exit `0`: `MERC32 VSCE C compiler integration test passed`.

### High-level interrupt intrinsic

RED:

```powershell
npm run test:c
npm run test:c:rtl
```

Both exited `1` because the compiler reported
`unknown function '__irq_enable_level'`; the RTL firmware path therefore could
not build the new high-level test program.

GREEN:

```powershell
npm run test:c
npm run test:c:rtl
```

Both exited `0`. The compiler integration suite passed and all six firmware RTL
programs passed. The IRQ scenario completed at 123 words and observed exactly
two high-level handler entries.

### Hardware runner marker contract

RED:

```powershell
node scripts/test-hardware-runner.js
```

Exit `1` with `Error: Cannot find module './test-hardware'`, proving the test
was exercising the absent production runner.

GREEN:

```powershell
node scripts/test-hardware-runner.js
npm run test:hardware
```

Both exited `0`. The unit test printed
`MERC32 hardware runner marker tests passed`; the integration command completed
all nine cases and printed `MERC32 hardware suite passed (9 tests)`.

The output-net correction and contract/documentation fixes do not introduce new
runtime behavior, so no artificial RED was manufactured for them. The readable
and protected controller forms were instead compiled and run through the same
public behavior test after the changes.

## Final Verification

All commands below were rerun from the final committed implementation tree on
2026-08-29.

### Software and firmware

```powershell
Set-Location merc32-vsce
npm test
npm run test:c:rtl
```

Both exited `0`.

`npm test` results:

```text
pseudo-instruction tests passed
MERC32 VSCE C compiler integration test passed
```

`npm run test:c:rtl` results:

```text
tinyc_feature_test RTL execution test passed (4489 words)
tinyc_uart_test RTL execution test passed (575 words)
tinyc_gpio_test RTL execution test passed (667 words)
tinyc_timer_test RTL execution test passed (806 words)
tinyc_i2c_test RTL execution test passed (1130 words)
tinyc_irq_test RTL execution test passed (123 words)
MERC32 Tiny C RTL suite passed (6 tests)
```

Every firmware bench emitted exactly one `TEST PASS` marker.

### Hardware gate

```powershell
npm run test:hardware
```

Exit `0`. Required markers:

```text
TEST PASS: merc32_core checks=358
TEST PASS: MERC32_top JTAG checks=15
TEST PASS: MERC32_top DEBUG_EN=0 fetches=11
TEST PASS: jtag_debug checks=99
PASS: mul_tb
PASS: div_tb
TEST PASS: spram checks=23
TEST PASS: apb_intc
CONFIG ERROR: DLB_ADDR_WIDTH must be in range 1..25
```

The command concluded with `MERC32 hardware suite passed (9 tests)`.

### Readable and protected APB INTC

Each form was compiled separately against
`rtl/sim/apb_intc_tb.v` with:

```text
iverilog -Wall -Wno-timescale -g2005 -s apb_intc_tb
```

Both compilations exited `0`. Both `vvp` simulations exited `0` and emitted
exactly:

```text
TEST PASS: apb_intc
```

### Library and packaging

```powershell
rtl lib index
rtl lib status
rtl lib deps apb_intc
rtl lib pack --flat --encrypt apb_intc D:\Development\Projects\simple_cpu\.worktrees\merc32-soc-generator\rtl\apb_intc\apb_intc.v --force
```

All exited `0`. Results were 37 indexed modules, a current index, no INTC
dependencies, and one protected packed module.

### Residue and ownership audits

The following searches exited `1` with no matches, as expected:

- Legacy DLB spelling `0080_0000|00800000` across active docs, examples,
  compiler, package configuration, CPU RTL, and simulation RTL.
- `IF_AXI_LITE|IF_APB|IF_WBC|IF_AVALON|IF_DRP|IF_` in
  `rtl/cpu/MERC32_top.v`.
- Lowercase `dumpvars(0, merc32_top` scopes in the two wrapper benches.

`rtl/apb_intc` contains only `apb_intc.v`; the only public RTL companion is
`rtl/sim/apb_intc_tb.v`. No second readable Verilog implementation or INTC
manual exists in simple_cpu. The historical hardware plan contains only the
public module-interface example.

The contract-anchor scan found the high-level intrinsic in compiler tests,
implementation, firmware, ABI, and extension documentation; the exact trigger
macros and `0xE4` assertion in the design/plan/testbench; and the invalid-width
diagnostic in the core and checked-in hardware runner.

### Repository state and diff hygiene

At the final implementation audit, `git status --short --branch` reported only
the simple_cpu branch header `codex/merc32-soc-generator` and the IP branch
header `main...origin/main [ahead 2]`; neither repository had an unstaged,
staged, or untracked implementation path. The IP repository is ahead by its
existing readable-controller commit and this fix-wave commit.

```powershell
git diff --check -- . ':(exclude)rtl/apb_intc/apb_intc.v'
```

Exit `0` with no output. The requested report lives under the intentionally
ignored `.superpowers/sdd` directory and is force-staged by its exact path for a
separate report-only commit.

## Commits and Files

### simple_cpu logical commits

`b67ba3673c4bdf633d53cab4cd8ca1ae5b0fbc2d fix: constrain Tiny C layouts to DLB`

- `docs/ABI.md`
- `docs/superpowers/plans/2026-08-06-tinyc-basic-syntax.md`
- `docs/superpowers/plans/2026-08-29-merc32-hardware-foundation.md`
- `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`
- `merc32-vsce/README.md`
- `merc32-vsce/package.json`
- `merc32-vsce/scripts/test-c-compiler.js`
- `merc32-vsce/src/cCompiler/tinyc.ts`

`c12efceb954a284bddca0a3551e7fde3cef5421e feat: enable high-level Tiny C interrupts`

- `docs/ABI.md`
- `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`
- `example/tinyc_irq_test.c`
- `merc32-vsce/README.md`
- `merc32-vsce/scripts/test-c-compiler.js`
- `merc32-vsce/src/cCompiler/tinyc.ts`
- `rtl/sim/tinyc_irq_tb.v`

`2ad7567c285a190a7511579f5f2d1fd5cadf819b test: automate hardware regressions`

- `merc32-vsce/package.json`
- `merc32-vsce/scripts/test-hardware-runner.js`
- `merc32-vsce/scripts/test-hardware.js`

`f7b610e947e71bf498da0630815bb7a033187e1b docs: lock interrupt trigger encoding`

- `docs/superpowers/plans/2026-08-29-merc32-soc-generator-core.md`
- `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`
- `rtl/sim/MERC32_top_nodebug_tb.v`
- `rtl/sim/MERC32_top_tb.v`
- `rtl/sim/apb_intc_tb.v`

`48fc52f0e86fddbf8315efde371560f791b2a4f4 build: refresh protected APB INTC`

- `rtl/apb_intc/apb_intc.v`

The report itself is committed separately so it does not need to self-reference
an unstable commit hash.

### ip-repo commit

`93407a65b76f339823b7a5dfbcb8ab41cf1765c5 fix: expose APB INTC read data as a net`

- `intc/apb_intc.v`

## Self-Review

- The compiler bounds use safe integers and an exclusive limit, accept the
  exact full-DLB layout, and reject bases below/above DLB and widths outside
  `1..25`.
- The legacy edge-enable intrinsic was not silently changed; the controller
  path has its own explicit intrinsic and documentation.
- The held-high IRQ test accepts the architecturally valid second entry at the
  first handler return before resumed load execution, then proves final context
  and entry count.
- Hardware automation checks both exit status and semantic output. A zero-status
  `$finish` cannot turn a failing bench into a passing gate.
- The trigger mapping is consistent in the design, future planner assertions,
  generated-header requirements, and existing controller behavior.
- The readable IP change preserves the combinational APB read mux while making
  the public output explicitly net-typed.
- The protected file was regenerated from the committed readable source after
  the library index was refreshed and was validated only through its public
  interface.
- Exact paths were staged for every commit. No unrelated repository changes
  were included.

## Residual Concerns

- Existing Verilog benches use `$finish`, which can return process status zero
  after a testbench-reported failure. The checked-in hardware runner closes this
  gap by requiring one exact pass/configuration marker and rejecting explicit
  failure or timeout markers.
- The protected release is intentionally opaque. Equivalence confidence comes
  from the common public INTC testbench, library packaging metadata, and the
  full hardware gate rather than source inspection.
- The SoC generator-core plan is prospective. This fix locks the encoding and
  header tests that its later implementation must satisfy; it does not execute
  generator code that has not yet been built.
