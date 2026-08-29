# MERC32 Hardware Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock the new MERC32 memory ABI, expose a stable three-Local-Bus CPU wrapper, and add a verified protected single-file APB interrupt controller.

**Architecture:** `merc32_core` keeps fixed ILB/DLB/PLB decoding; `MERC32_top` contains only the core and optional JTAG and exposes ILB, DLB, and PLB Local Bus ports. Protocol bridges move out of the wrapper. `apb_intc` is developed against a public testbench, copied in readable form to the IP maintenance repository, then packaged back into this repository as one flattened protected file.

**Tech Stack:** Verilog-2005, Icarus Verilog (`iverilog`, `vvp`), TypeScript compiler defaults, PowerShell, `rtl lib`.

**Spec:** `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`

## Global Constraints

- Fixed regions: ILB `0x00000000` - `0x07FFFFFF`; DLB `0x08000000` - `0x0FFFFFFF`; PLB `0x10000000` - `0xFFFFFFFF`.
- `ILB_ADDR_WIDTH` and `DLB_ADDR_WIDTH` are word widths in range 1 through 25.
- Preserve the existing registered Local Bus request/acknowledgement behavior.
- `MERC32_top` keeps stable JTAG ports and ties debug inactive when `DEBUG_EN=0`.
- No external protocol selection macros remain in `MERC32_top`.
- Never commit readable `apb_intc` implementation text to this repository.
- Do not create or edit an INTC manual.

---

## File Structure

- Modify `rtl/cpu/core.v`: locked address thresholds and address-width guards.
- Modify `rtl/cpu/MERC32_top.v`: core/debug-only wrapper with `plb_*` Local Bus.
- Modify `rtl/sim/merc32_core_tb.v`: exact boundary checks.
- Modify `rtl/sim/MERC32_top_tb.v`: explicit testbench `lb2apb` bridge.
- Modify `rtl/sim/MERC32_top_nodebug_tb.v`: new PLB tie-offs.
- Modify `rtl/sim/tinyc_uart_tb.v`, `tinyc_gpio_tb.v`, `tinyc_timer_tb.v`, and
  `tinyc_i2c_tb.v`: explicit testbench bridge wiring.
- Create `rtl/sim/apb_intc_tb.v`: public behavioral contract test.
- Create final protected `rtl/apb_intc/apb_intc.v`: packaged distribution file.
- Create readable `D:\Development\Projects\ip-repo\intc\apb_intc.v`: maintenance source.
- Modify address-bearing examples, ABI docs, README, and VSCE compiler defaults.

### Task 1: Lock the Address Decode Boundaries

**Files:**
- Modify: `rtl/sim/merc32_core_tb.v`
- Modify: `rtl/cpu/core.v:81-84,348-361`

**Interfaces:**
- Produces: fixed `decode_bus_target(byte_address)` results and parameter range
  checks consumed by every later hardware and generator task.

- [ ] **Step 1: Add failing boundary assertions**

Add a task beside the existing check helpers in `merc32_core_tb.v`:

```verilog
task check_bus_target;
    input [31:0] address;
    input [1:0] expected;
    begin
        if (merc32_core_inst.decode_bus_target(address) !== expected) begin
            failures = failures + 1;
            $display("TEST FAIL: address %h target=%0d expected=%0d",
                     address,
                     merc32_core_inst.decode_bus_target(address),
                     expected);
        end
    end
endtask
```

Call it from the main test sequence with:

```verilog
check_bus_target(32'h0000_0000, 2'd1);
check_bus_target(32'h07ff_ffff, 2'd1);
check_bus_target(32'h0800_0000, 2'd2);
check_bus_target(32'h0fff_ffff, 2'd2);
check_bus_target(32'h1000_0000, 2'd3);
check_bus_target(32'hffff_ffff, 2'd3);
```

- [ ] **Step 2: Run the test and verify the new DLB boundary fails**

```powershell
iverilog -Wall -g2005 -s merc32_core_tb -o "$env:TEMP\merc32_core_tb.vvp" rtl/misc/mul.v rtl/misc/div.v rtl/cpu/core.v rtl/sim/merc32_core_tb.v
vvp "$env:TEMP\merc32_core_tb.vvp"
```

Expected: assertions at `0x07FFFFFF` and `0x08000000` report the old mapping.

- [ ] **Step 3: Change the locked thresholds and constrain widths**

Change `decode_bus_target` to:

```verilog
if (byte_address < 32'h0800_0000)
    decode_bus_target = BUS_ILB;
else if (byte_address < 32'h1000_0000)
    decode_bus_target = BUS_DLB;
else
    decode_bus_target = BUS_PLB;
```

Add elaboration-time simulation guards without adding synthesis logic:

```verilog
initial begin
    if ((ILB_ADDR_WIDTH < 1) || (ILB_ADDR_WIDTH > 25))
        $error("ILB_ADDR_WIDTH must be in range 1..25");
    if ((DLB_ADDR_WIDTH < 1) || (DLB_ADDR_WIDTH > 25))
        $error("DLB_ADDR_WIDTH must be in range 1..25");
end
```

- [ ] **Step 4: Re-run the core test**

Run the Step 2 commands. Expected: exactly one `TEST PASS` marker and no new
Icarus warnings.

- [ ] **Step 5: Commit the locked decode**

```powershell
git add -- rtl/cpu/core.v rtl/sim/merc32_core_tb.v
git commit -m "rtl: lock MERC32 memory address regions"
```

### Task 2: Migrate the Software Address ABI

**Files:**
- Modify: `merc32-vsce/src/configuration.ts`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`
- Modify: `merc32-vsce/package.json`
- Modify: `docs/ABI.md`
- Modify: `README.md`
- Modify: `example/full_test.asm`
- Modify: all `example/tinyc_*_test.c` files containing DLB addresses
- Regenerate: `example/full_test.v`, `example/tinyc_feature_test.v`
- Modify: affected RTL testbench expected addresses

**Interfaces:**
- Consumes: locked DLB base `0x08000000` from Task 1.
- Produces: compiler and repository software whose static data and status words
  live in the new DLB region.

- [ ] **Step 1: Make compiler tests expect the new default**

In `scripts/test-c-compiler.js`, change the default-stack expectation from
`0x84` to `0x804` because the generated sequence loads `0x08040000` for the
default 256 KiB DLB stack. Add:

```javascript
assert.match(assembly, /mov r13, 0x804\r?\nmov r13, r13 << 16/);
assert.doesNotMatch(assembly, /mov r13, 0x84\r?\n/);
```

- [ ] **Step 2: Run the compiler test and verify failure**

```powershell
Set-Location merc32-vsce
npm run test:c
```

Expected: FAIL on the new stack-base expectation.

- [ ] **Step 3: Update active defaults and source addresses**

Use `0x08000000` / `0x0800_0000` for:

```typescript
config.get<string>('c.dataBase', '0x08000000')
options.dataBase ?? 0x0800_0000
```

The public compiler API must reject `dataBase` outside
`0x08000000..0x0FFFFFFF`, reject `dlbAddrWidth` outside `1..25`, and reject an
exclusive computed data limit above `0x10000000`. A limit exactly equal to
`0x10000000` remains valid.

Update the package configuration default, ABI equations, all real DLB pointers
in examples and tests, and `DATA_PAGE` in `full_test.asm`. Do not replace
unrelated numeric result markers such as `0x01000000`.

- [ ] **Step 4: Regenerate committed derived ROM examples**

Use the compiled toolchain's existing compiler and assembler APIs to regenerate
`example/tinyc_feature_test.v` and `example/full_test.v`; do not hand-edit
machine words. Verify the generated modules retain their existing module names.

- [ ] **Step 5: Run compiler and firmware regressions**

```powershell
Set-Location merc32-vsce
npm test
npm run test:c:rtl
Set-Location ..
rg -n "0080_0000|00800000" README.md docs/ABI.md example merc32-vsce/src merc32-vsce/package.json rtl/sim
```

Expected: all tests pass; `rg` finds no active old DLB base.

- [ ] **Step 6: Commit the ABI migration**

```powershell
git add -- README.md docs/ABI.md example merc32-vsce/package.json merc32-vsce/src rtl/sim
git commit -m "software: migrate DLB base to 0x08000000"
```

### Task 3: Stabilize `MERC32_top` as a Local Bus Wrapper

**Files:**
- Modify: `rtl/cpu/MERC32_top.v`
- Modify: `rtl/sim/MERC32_top_tb.v`
- Modify: `rtl/sim/MERC32_top_nodebug_tb.v`
- Modify: `rtl/sim/tinyc_uart_tb.v`
- Modify: `rtl/sim/tinyc_gpio_tb.v`
- Modify: `rtl/sim/tinyc_timer_tb.v`
- Modify: `rtl/sim/tinyc_i2c_tb.v`
- Modify: `README.md`

**Interfaces:**
- Produces: `plb_rden`, `plb_wren`, `plb_addr[31:0]`, `plb_strb[3:0]`,
  `plb_wdata[31:0]`, `plb_rdata[31:0]`, and `plb_ack` on `MERC32_top`.

- [ ] **Step 1: Update `MERC32_top_tb` to expect PLB ports**

Declare CPU-side PLB wires and instantiate `lb2apb` explicitly in the
testbench:

```verilog
wire        plb_rden;
wire        plb_wren;
wire [31:0] plb_addr;
wire [3:0]  plb_strb;
wire [31:0] plb_wdata;
wire [31:0] plb_rdata;
wire        plb_ack;

lb2apb #(
    .DATA_WIDTH(32),
    .LB_ADDR_WIDTH(32),
    .APB_ADDR_WIDTH(32)
) test_lb2apb (
    .clk(clk), .rst_n(rst_n),
    .lb_rden(plb_rden), .lb_wren(plb_wren),
    .lb_strb(plb_strb), .lb_wdata(plb_wdata), .lb_addr(plb_addr),
    .lb_rdata(plb_rdata), .lb_valid(plb_ack),
    .m_apb_psel(m_apb_psel), .m_apb_penable(m_apb_penable),
    .m_apb_paddr(m_apb_paddr), .m_apb_pwrite(m_apb_pwrite),
    .m_apb_pstrb(m_apb_pstrb), .m_apb_pwdata(m_apb_pwdata),
    .m_apb_prdata(m_apb_prdata), .m_apb_pready(m_apb_pready)
);
```

Connect these wires to the expected new `MERC32_top` ports. Apply the same
testbench-only bridge pattern to UART, GPIO, Timer, and I2C firmware tests.

- [ ] **Step 2: Compile and verify expected port failures**

```powershell
iverilog -Wall -g2005 -s MERC32_top_tb -o "$env:TEMP\MERC32_top_tb.vvp" rtl/misc/mul.v rtl/misc/div.v rtl/debug/jtag_debug.v rtl/bridge/lb2apb.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/MERC32_top_tb.v
```

Expected: FAIL because `MERC32_top` does not yet expose `plb_*`.

- [ ] **Step 3: Remove protocol macros and expose core PLB directly**

Delete every `IF_*` define, conditional port block, and `lb2*` instance from
`MERC32_top.v`. Connect core PLB directly:

```verilog
.plb_rden  (plb_rden),
.plb_wren  (plb_wren),
.plb_addr  (plb_addr),
.plb_strb  (plb_strb),
.plb_wdata (plb_wdata),
.plb_rdata (plb_rdata),
.plb_ack   (plb_ack)
```

Keep the existing JTAG generate block and ILB/DLB ports unchanged.

- [ ] **Step 4: Adapt no-debug and firmware testbenches**

Tie unused PLB responses to zero in `MERC32_top_nodebug_tb`. For peripheral
testbenches, instantiate one testbench `lb2apb` exactly as in Step 1. Do not
reintroduce protocol selection in production RTL.

- [ ] **Step 5: Run wrapper and firmware regressions**

```powershell
iverilog -Wall -g2005 -s MERC32_top_tb -o "$env:TEMP\MERC32_top_tb.vvp" rtl/misc/mul.v rtl/misc/div.v rtl/debug/jtag_debug.v rtl/bridge/lb2apb.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/MERC32_top_tb.v
vvp "$env:TEMP\MERC32_top_tb.vvp"
iverilog -Wall -g2005 -s MERC32_top_nodebug_tb -o "$env:TEMP\MERC32_top_nodebug_tb.vvp" rtl/misc/mul.v rtl/misc/div.v rtl/debug/jtag_debug.v rtl/cpu/core.v rtl/cpu/MERC32_top.v rtl/sim/MERC32_top_nodebug_tb.v
vvp "$env:TEMP\MERC32_top_nodebug_tb.vvp"
Set-Location merc32-vsce
npm run test:c:rtl
Set-Location ..
```

Expected: one pass marker per simulation and the full firmware suite passes.

- [ ] **Step 6: Update the public wrapper documentation and commit**

Replace the protocol macro table in `README.md` with ILB, DLB, and PLB Local Bus
tables and state that protocol bridges are instantiated by generated SoCs.

```powershell
git add -- README.md rtl/cpu/MERC32_top.v rtl/sim merc32-vsce/scripts/test-c-rtl.js
git commit -m "rtl: stabilize MERC32 Local Bus wrapper"
```

### Task 4: Implement and Publish the APB Interrupt Controller

**Files:**
- Create temporarily, never commit readable here: `rtl/apb_intc/apb_intc.v`
- Create: `rtl/sim/apb_intc_tb.v`
- Create in IP repository: `D:\Development\Projects\ip-repo\intc\apb_intc.v`
- Final protected output: `rtl/apb_intc/apb_intc.v`

**Interfaces:**
- Produces: module `apb_intc #(IRQ_COUNT, IRQ_MODE)` with APB4 slave ports,
  `irq_sources[IRQ_COUNT-1:0]`, and high-active `interrupt`.

- [ ] **Step 1: Write the public failing testbench**

Create a self-checking APB testbench with reusable tasks:

```verilog
task apb_write;
    input [7:0] offset;
    input [31:0] data;
    input [3:0] strb;
    begin
        @(negedge clk);
        psel <= 1'b1; penable <= 1'b0; pwrite <= 1'b1;
        paddr <= offset; pwdata <= data; pstrb <= strb;
        @(negedge clk); penable <= 1'b1;
        while (!pready) @(negedge clk);
        @(negedge clk); psel <= 1'b0; penable <= 1'b0;
    end
endtask
```

Add matching `apb_read` and assertions for reset, byte strobes, enable RW/set/
clear, software pending, W1C, all four modes, persistent levels, fixed priority,
`ACTIVE`, unused bits, and `IRQ_COUNT=1` plus `IRQ_COUNT=32` elaboration.

- [ ] **Step 2: Verify the test fails because the module is missing**

```powershell
iverilog -Wall -g2005 -s apb_intc_tb -o "$env:TEMP\apb_intc_tb.vvp" rtl/apb_intc/apb_intc.v rtl/sim/apb_intc_tb.v
```

Expected: FAIL because `apb_intc.v` does not exist.

- [ ] **Step 3: Implement the clear single-module source**

Use these public declarations:

```verilog
module apb_intc #(
    parameter integer IRQ_COUNT = 1,
    parameter [63:0] IRQ_MODE = 64'd0
)(
    input  wire                 s_apb_pclk,
    input  wire                 s_apb_presetn,
    input  wire                 s_apb_psel,
    input  wire                 s_apb_penable,
    input  wire                 s_apb_pwrite,
    input  wire [31:0]          s_apb_paddr,
    input  wire [31:0]          s_apb_pwdata,
    input  wire [3:0]           s_apb_pstrb,
    output wire                 s_apb_pready,
    output wire                 s_apb_pslverr,
    output wire [31:0]          s_apb_prdata,
    input  wire [IRQ_COUNT-1:0] irq_sources,
    output wire                 interrupt
);
```

Implement offsets `0x00` through `0x24` exactly as specified. Mask all vectors
with `IRQ_COUNT`, use a registered previous sample for edge modes, and implement
priority with a Verilog integer loop that accepts the first enabled pending bit.
Keep all helper functions inside this file.

- [ ] **Step 4: Run the clear-source test to green**

Run the Step 2 compile followed by:

```powershell
vvp "$env:TEMP\apb_intc_tb.vvp"
```

Expected: exactly `TEST PASS: apb_intc` and no warnings.

- [ ] **Step 5: Move readable ownership to the IP repository**

Verify the IP repository state, then create `intc/` and copy the verified file:

```powershell
git -C D:\Development\Projects\ip-repo status --short
New-Item -ItemType Directory -Force D:\Development\Projects\ip-repo\intc | Out-Null
Copy-Item -LiteralPath rtl\apb_intc\apb_intc.v -Destination D:\Development\Projects\ip-repo\intc\apb_intc.v
git -C D:\Development\Projects\ip-repo add -- intc/apb_intc.v
git -C D:\Development\Projects\ip-repo commit -m "feat: add APB interrupt controller"
```

Stage only `intc/apb_intc.v`; preserve unrelated IP-repository changes.

- [ ] **Step 6: Index and package the protected distribution file**

```powershell
Push-Location D:\Development\Projects\ip-repo
rtl lib index
rtl lib status
rtl lib deps apb_intc
rtl lib pack --flat --encrypt apb_intc D:\Development\Projects\simple_cpu\rtl\apb_intc\apb_intc.v --force
Pop-Location
```

Expected: dependency closure contains only the top file unless the final clear
implementation intentionally added a cataloged helper.

- [ ] **Step 7: Verify the protected artifact without printing its body**

```powershell
$intcPath = Resolve-Path rtl\apb_intc\apb_intc.v
$intcInfo = Get-Item -LiteralPath $intcPath
$intcHash = Get-FileHash -Algorithm SHA256 -LiteralPath $intcPath
$intcInfo | Select-Object FullName,Length
$intcHash | Select-Object Algorithm,Hash
iverilog -Wall -g2005 -s apb_intc_tb -o "$env:TEMP\apb_intc_tb.vvp" rtl/apb_intc/apb_intc.v rtl/sim/apb_intc_tb.v
vvp "$env:TEMP\apb_intc_tb.vvp"
```

Expected: nonzero length, SHA-256 reported, and the same pass marker. Do not
use `Get-Content` or print protected module bodies.

- [ ] **Step 8: Commit only the protected artifact and public test here**

```powershell
git add -- rtl/apb_intc/apb_intc.v rtl/sim/apb_intc_tb.v
git commit -m "rtl: add protected APB interrupt controller"
```

### Task 5: Run the Hardware Foundation Regression

**Files:**
- Verify only; modify a failing owning module or test if required.

**Interfaces:**
- Produces: the stable hardware baseline required by the generator plan.

- [ ] **Step 1: Run standalone RTL suites**

Run the core, top, no-debug, JTAG, divider, SPRAM, and INTC commands from the
preceding tasks. Expected: one pass marker from every testbench.

- [ ] **Step 2: Run software and firmware suites**

```powershell
Set-Location merc32-vsce
npm test
npm run test:c:rtl
Set-Location ..
```

Expected: all compiler, assembler, and six RTL firmware scenarios pass.

- [ ] **Step 3: Check public-interface and address residue**

```powershell
rg -n "IF_AXI_LITE|IF_APB|IF_WBC|IF_AVALON|IF_DRP" rtl/cpu/MERC32_top.v
rg -n "0080_0000|00800000" README.md docs/ABI.md example merc32-vsce/src merc32-vsce/package.json rtl/cpu rtl/sim
git status --short
git -C D:\Development\Projects\ip-repo status --short
```

Expected: no protocol macros in the wrapper, no active old DLB base, and only
known user-owned changes in either repository.

- [ ] **Step 4: Commit regression-only fixes if any**

If no fixes were needed, do not create an empty commit. Otherwise stage only
the owning files and commit:

```powershell
git commit -m "test: complete MERC32 hardware foundation regression"
```
