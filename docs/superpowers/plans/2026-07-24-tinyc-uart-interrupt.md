# Tiny C UART Interrupt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a single non-nested Tiny C interrupt handler that preserves MERC32 comparison state and C ABI registers, then validate it with focused CPU and UART RX interrupt RTL simulations.

**Architecture:** The compiler reserves `void __irq_handler(void)`, emits its wrapper as the first source instruction at machine byte address 4, and exposes explicit rising-edge enable/disable builtins. The CPU stores comparison flags in read-only `r1[7:3]`, gates nested entry with `irq_active`, and restores flags when an active ISR executes the existing `jmp r3` encoding. Existing polling UART and non-IRQ Tiny C programs retain their current behavior.

**Tech Stack:** TypeScript, Node.js assertions, MERC32 assembly, Verilog-2005, Icarus Verilog fallback simulation, CodeGraph, Markdown.

---

## Execution Constraints

- Work in the existing `D:\Software\simple_cpu` tree because this milestone depends on the current uncommitted M1-M3 compiler/UART changes.
- Preserve the user's `apb_uart_new` to `apb_uart` rename and deletion of `rtl/sim/apb_uart_new_tb.v`.
- Do not modify CAN files or production UART RTL.
- Do not stage or commit files unless the user separately requests it.
- Use CodeGraph before structural TypeScript/JavaScript/C lookup. Verilog is not indexed, so inspect only the exact RTL files named below.
- Use Verilog-2005 only. VKS is preferred when its MCP tools are available; otherwise use Icarus and state explicitly that no VKS result or bug observation exists.

## File Map

- `merc32-vsce/src/cCompiler/tinyc.ts`: handler validation, vector/wrapper emission, and IRQ builtins.
- `merc32-vsce/scripts/test-c-compiler.js`: compiler-level positive, negative, layout, and backward-compatibility tests.
- `rtl/cpu/core.v`: `r1` mixed-access state, interrupt-active gate, and flag restoration.
- `example/tinyc_irq_context_test.c`: focused comparison/register preservation firmware.
- `rtl/sim/merc32_core_tb.v`: independent core interrupt testbench.
- `example/tinyc_uart_irq_test.c`: two-byte UART interrupt firmware.
- `rtl/sim/tinyc_uart_irq_tb.v`: CPU, APB bridge, and UART IRQ integration testbench.
- `merc32-vsce/scripts/test-c-rtl.js`: compile/assemble/simulate both new firmware cases and enforce strict markers.
- `ABI.md`: Tiny C interrupt ABI and wrapper contract.
- `ISA.md`: `r1-r3`, `irq_active`, and active `jmp r3` semantics.

### Task 1: Establish Compiler Support as RED

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Test: `merc32-vsce/scripts/test-c-compiler.js`

- [ ] **Step 1: Re-run the current compiler baseline**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm test
```

Expected: `pseudo-instruction tests passed` and `MERC32 VSCE C compiler integration test passed`.

- [ ] **Step 2: Add IRQ compiler assertions before changing the compiler**

Append the following tests before the final success log in `test-c-compiler.js`:

```javascript
function expectCompilerError(testSource, pattern) {
    assert.throws(
        () => compileC(testSource, { moduleName: 'irq_negative_test' }),
        pattern,
    );
}

const irqSource = `
volatile unsigned int irq_count = 0;

void __irq_handler(void) {
    irq_count = irq_count + 1;
}

int main(void) {
    __irq_enable();
    while (irq_count == 0) {
    }
    __irq_disable();
    return 0;
}
`;

const { assembly: irqAssembly } = compileC(irqSource, { moduleName: 'irq_compiler_test' });
assert.match(irqAssembly, /\.entry __start/);
assert.match(irqAssembly, /__irq_vector:\nmov r13, r13 - 28/);
assert.match(irqAssembly, /mov \[r13 \+ 0\], r4/);
assert.match(irqAssembly, /mov \[r13 \+ 24\], r14/);
assert.match(irqAssembly, /jmp __irq_handler, r14/);
assert.match(irqAssembly, /mov r14, \[r13 \+ 24\]/);
assert.match(irqAssembly, /mov r4, \[r13 \+ 0\]/);
assert.match(irqAssembly, /mov r13, r13 \+ 28\n+jmp r3/);
assert.match(irqAssembly, /__start:\nmov r13,/);
assert.match(irqAssembly, /mov r2, 4/);
assert.match(irqAssembly, /mov r1, 1/);
assert.match(irqAssembly, /mov r1, 0/);

const irqImage = new SimpleCPUAssembler().assemble(irqAssembly, {
    sourceFileName: 'irq_compiler_test.asm',
});
assert.match(irqImage.debugSymbols, /__irq_vector\s*=\s*4\s+\(0x0004\)/);
assert.ok(irqImage.machineCodes.length > 0);

assert.doesNotMatch(assembly, /__irq_vector/);
assert.doesNotMatch(assembly, /mov r2, 4/);

expectCompilerError(`
int __irq_handler(void) { return 0; }
int main(void) { return 0; }
`, /__irq_handler must return void/);

expectCompilerError(`
void __irq_handler(int value) { }
int main(void) { return 0; }
`, /__irq_handler must not have parameters/);

expectCompilerError(`
void __irq_handler(void);
int main(void) { return 0; }
`, /__irq_handler must have a definition/);

expectCompilerError(`
int main(void) {
    __irq_enable();
    return 0;
}
`, /__irq_enable requires a defined __irq_handler/);

expectCompilerError(`
int main(void) {
    __irq_disable();
    return 0;
}
`, /__irq_disable requires a defined __irq_handler/);

expectCompilerError(`
void __irq_handler(void) { }
int main(void) {
    __irq_enable(1);
    return 0;
}
`, /__irq_enable expects 0 arguments/);

expectCompilerError(`
void __irq_handler(void) { }
int main(void) {
    __irq_disable(1);
    return 0;
}
`, /__irq_disable expects 0 arguments/);
```

- [ ] **Step 3: Run the compiler test and verify RED**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm run compile
node scripts/test-c-compiler.js
```

Expected: failure while compiling `irqSource`, initially reporting `unknown function '__irq_enable'` or a missing `__irq_vector` assertion. The original non-IRQ assertions must run before this failure.

- [ ] **Step 4: Record the RED checkpoint without committing**

Run:

```powershell
cd D:\Software\simple_cpu
git diff --check -- merc32-vsce/scripts/test-c-compiler.js
git status --short
```

Expected: no whitespace errors; only the existing worktree changes plus the compiler test edit are listed.

### Task 2: Implement Tiny C Handler Validation, Vector, Wrapper, and Builtins

**Files:**
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`
- Test: `merc32-vsce/scripts/test-c-compiler.js`

- [ ] **Step 1: Add interrupt constants and handler state**

Add these constants near the existing ABI constants and this field to `CodeGenerator`:

```typescript
const IRQ_HANDLER_NAME = '__irq_handler';
const IRQ_VECTOR_ADDRESS = 4;
const IRQ_WRAPPER_FRAME_SIZE = 28;

class CodeGenerator {
    // Existing fields remain unchanged.
    private interruptHandler?: FunctionDecl;
```

Do not add a new parser keyword; `__irq_handler`, `__irq_enable`, and
`__irq_disable` remain normal identifiers handled by semantic analysis/codegen.

- [ ] **Step 2: Validate the reserved handler during program indexing**

At the end of `indexProgram()`, after verifying `main`, add:

```typescript
const interruptHandler = this.functionMap.get(IRQ_HANDLER_NAME);
if (interruptHandler) {
    if (!isVoidType(interruptHandler.returnType)) {
        throw new CompilerError('__irq_handler must return void');
    }
    if (interruptHandler.params.length !== 0) {
        throw new CompilerError('__irq_handler must not have parameters');
    }
    if (!interruptHandler.body) {
        throw new CompilerError('__irq_handler must have a definition');
    }
    this.interruptHandler = interruptHandler;
}
```

This intentionally treats a prototype-only handler as an error while leaving
ordinary function prototype behavior unchanged.

- [ ] **Step 3: Emit the vector before `__start` and initialize `r2`**

Change `generate()` to preserve the current path when no handler exists and to
place the vector first when one does:

```typescript
generate(): string {
    this.indexProgram();

    this.emit(`.prog ${this.moduleName}`);
    this.emit('.entry __start');
    this.emit('');

    if (this.interruptHandler) {
        this.emitInterruptVector();
        this.emit('');
    }

    this.emit('__start:');
    this.loadImm('r13', this.dataBase + (1 << (this.dlbAddrWidth + 2)));
    this.emitGlobalInitializers();
    if (this.interruptHandler) {
        this.loadImm('r2', IRQ_VECTOR_ADDRESS);
    }
    this.emit('jmp main, r14');
    this.emit('__halt:');
    this.emit('jmp __halt');
    this.emit('');

    for (const fn of this.program.functions) {
        if (fn.body) {
            this.emitFunction(fn);
            this.emit('');
        }
    }

    return this.lines.join('\n') + '\n';
}
```

The assembler's existing `.entry` preprocessing injects `jmp __start` at
machine address 0. Therefore the first instruction emitted by
`emitInterruptVector()` resolves to byte address 4.

- [ ] **Step 4: Emit the exact 28-byte wrapper**

Add this `CodeGenerator` method immediately before `emitFunction()`:

```typescript
private emitInterruptVector(): void {
    this.emit('__irq_vector:');
    this.adjustSp(-IRQ_WRAPPER_FRAME_SIZE);
    this.emit('mov [r13 + 0], r4');
    this.emit('mov [r13 + 4], r5');
    this.emit('mov [r13 + 8], r6');
    this.emit('mov [r13 + 12], r7');
    this.emit('mov [r13 + 16], r8');
    this.emit('mov [r13 + 20], r12');
    this.emit('mov [r13 + 24], r14');
    this.emit(`jmp ${IRQ_HANDLER_NAME}, r14`);
    this.emit('mov r14, [r13 + 24]');
    this.emit('mov r12, [r13 + 20]');
    this.emit('mov r8, [r13 + 16]');
    this.emit('mov r7, [r13 + 12]');
    this.emit('mov r6, [r13 + 8]');
    this.emit('mov r5, [r13 + 4]');
    this.emit('mov r4, [r13 + 0]');
    this.adjustSp(IRQ_WRAPPER_FRAME_SIZE);
    this.emit('jmp r3');
}
```

Do not save `r1-r3`, `r9-r11`, `r13`, or `r15`; their ownership and restoration
are defined by the approved ABI.

- [ ] **Step 5: Add zero-argument IRQ builtins**

Add these cases at the start of `emitCall()`, before ordinary function lookup:

```typescript
if (expr.name === '__irq_enable' || expr.name === '__irq_disable') {
    if (expr.args.length !== 0) {
        throw new CompilerError(`${expr.name} expects 0 arguments`);
    }
    if (!this.interruptHandler) {
        throw new CompilerError(`${expr.name} requires a defined __irq_handler`);
    }
    this.emit(`mov r1, ${expr.name === '__irq_enable' ? 1 : 0}`);
    return voidType();
}
```

Add the helper next to `uintType()`:

```typescript
function voidType(): CType {
    return { base: 'void', pointerDepth: 0, volatile: false };
}
```

- [ ] **Step 6: Run the compiler GREEN test**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm run compile
node scripts/test-c-compiler.js
```

Expected: `MERC32 VSCE C compiler integration test passed` with all new positive
and negative assertions completing.

- [ ] **Step 7: Run the complete existing compiler regression**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm test
```

Expected: both pseudo-instruction and C compiler integration tests pass.

- [ ] **Step 8: Check the compiler diff without committing**

Run:

```powershell
cd D:\Software\simple_cpu
git diff --check -- merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git status --short
```

Expected: no whitespace errors and no unrelated file changes introduced by this task.

### Task 3: Add CPU and UART IRQ Acceptance Tests as RTL RED

**Files:**
- Create: `example/tinyc_irq_context_test.c`
- Create: `rtl/sim/merc32_core_tb.v`
- Create: `example/tinyc_uart_irq_test.c`
- Create: `rtl/sim/tinyc_uart_irq_tb.v`
- Modify: `merc32-vsce/scripts/test-c-rtl.js`
- Test: `npm run test:c:rtl`

- [ ] **Step 1: Create comparison-context firmware**

Create `example/tinyc_irq_context_test.c` with this complete firmware:

```c
volatile unsigned int irq_count = 0;
volatile unsigned int irq_error = 0;

unsigned int status_addr = 0x008003C0;
unsigned int fail_addr = 0x008003C4;
unsigned int ready_code = 0x1234;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;

unsigned int irq_compare_noise(unsigned int value) {
    if (value > 3) {
        return value - 1;
    }
    return value + 1;
}

void __irq_handler(void) {
    irq_count = irq_count + 1;
    if (irq_compare_noise(7) == 0) {
        irq_error = 1;
    }
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;
    unsigned int guard = 0x13579BDF;
    unsigned int iterations = 0;

    __irq_enable();
    *status = ready_code;

    while (irq_count == 0) {
        if (guard == 0x13579BDF) {
            iterations = iterations + 1;
        } else {
            irq_error = 2;
        }
        if (iterations > 100000) {
            irq_error = 3;
            break;
        }
    }

    __irq_disable();
    if (irq_count != 1 || irq_error != 0 || guard != 0x13579BDF || iterations == 0) {
        *fail = irq_error + 10;
        *status = fail_code;
        return 1;
    }

    *status = pass_code;
    return 0;
}
```

The last comparison executed by the handler is false, while the testbench only
interrupts after observing a true foreground equality comparison. Equality has
the distinctive `UGT/UGE/SGT/SGE/EQ = 0/1/0/1/1` pattern, so the test checks all
five saved bits and makes missing or incorrectly ordered restoration observable.

- [ ] **Step 2: Create the independent core testbench**

Create `rtl/sim/merc32_core_tb.v` using the complete port wiring and ROM/DLB
memory model from `rtl/sim/tinyc_cpu_tb.v`, but instantiate `merc32_core`
directly and add the following exact control logic:

```verilog
localparam ST_LOAD = 5'b00001;
localparam ST_EXEC = 5'b00010;
localparam ST_STEP = 5'b00100;
localparam ST_INTR = 5'b01000;
localparam FUNC_CMP = 4'b1011;
localparam FUNC_BRC = 4'b1100;
localparam [15:0] STATUS_ADDR = 16'd240;
localparam [15:0] FAIL_ADDR = 16'd241;
localparam [31:0] READY_CODE = 32'h0000_1234;
localparam [31:0] PASS_CODE = 32'h0000_600d;
localparam [31:0] FAIL_CODE = 32'h0000_0bad;

reg [31:0] saved_r4;
reg [31:0] saved_r5;
reg [31:0] saved_r6;
reg [31:0] saved_r7;
reg [31:0] saved_r8;
reg [31:0] saved_r12;
reg [31:0] saved_r13;
reg [31:0] saved_r14;
reg [31:0] saved_return;
reg interrupt_exercised = 1'b0;
integer error_count = 0;
integer irq_enable_patch_count = 0;

function is_cmp;
    input [31:0] instruction;
    begin
        is_cmp = ((instruction[7:4] == 4'b0001) ||
                  (instruction[7:4] == 4'b0010)) &&
                 (instruction[3:0] == FUNC_CMP);
    end
endfunction

function is_brc;
    input [31:0] instruction;
    begin
        is_brc = ((instruction[7:4] == 4'b0001) ||
                  (instruction[7:4] == 4'b0010)) &&
                 (instruction[3:0] == FUNC_BRC);
    end
endfunction
```

After `$readmemh`, mutate only the compiler-generated `mov r1, 1` instruction
inside this test image. The `0xfff9` immediate sets every encoded bit above bit
2 while keeping `r1[2:0]=3'b001`, so the firmware still requests rising-edge
enable and attempts to write the read-only portion of `r1`:

```verilog
for (i = 0; i < rom_words; i = i + 1) begin
    if (program_rom[i] == 32'h0001_0110) begin
        program_rom[i] = 32'hfff9_0110;
        irq_enable_patch_count = irq_enable_patch_count + 1;
    end
end
if (irq_enable_patch_count != 1) begin
    $display("TEST FAIL: expected one mov r1, 1 instruction, found %0d",
             irq_enable_patch_count);
    $finish;
end
```

Immediately after the firmware `READY_CODE` write, assert that software only
changed the writable control bits:

```verilog
if ((merc32_core_inst.regi_int[1][2:0] !== 3'b001) ||
    (merc32_core_inst.regi_int[1][31:3] !== 29'd0)) begin
    $display("[FAIL] software write changed read-only r1 bits");
    error_count = error_count + 1;
end
```

After reset and the firmware `READY_CODE` write, use this stimulus to take an
interrupt exactly after a true compare, attempt a nested entry, and verify the
resume boundary:

```verilog
initial begin : irq_stimulus
    wait (rst_n);
    wait (dlb_ram[STATUS_ADDR] == READY_CODE);

    while (interrupt_exercised == 1'b0) begin
        @(negedge clk);
        if ((merc32_core_inst.cpu_state == ST_EXEC) && is_cmp(ilb_rdata)) begin
            @(posedge clk);
            #1;
            if ((merc32_core_inst.cpu_state == ST_STEP) &&
                (merc32_core_inst.eq == 1'b1)) begin
                saved_r4 = merc32_core_inst.regi_int[4];
                saved_r5 = merc32_core_inst.regi_int[5];
                saved_r6 = merc32_core_inst.regi_int[6];
                saved_r7 = merc32_core_inst.regi_int[7];
                saved_r8 = merc32_core_inst.regi_int[8];
                saved_r12 = merc32_core_inst.regi_int[12];
                saved_r13 = merc32_core_inst.regi_int[13];
                saved_r14 = merc32_core_inst.regi_int[14];

                force merc32_core_inst.intr_flag = 1'b1;
                @(posedge clk);
                #1;
                release merc32_core_inst.intr_flag;

                saved_return = merc32_core_inst.ret_addr;
                if (merc32_core_inst.cpu_state !== ST_INTR) begin
                    $display("[FAIL] core did not enter interrupt state");
                    error_count = error_count + 1;
                end
                if (!is_brc(program_rom[saved_return[17:2]])) begin
                    $display("[FAIL] resume instruction is not BRC");
                    error_count = error_count + 1;
                end
                if (merc32_core_inst.regi_int[1][7:3] !== 5'b01011) begin
                    $display("[FAIL] saved comparison flags are wrong: %05b",
                             merc32_core_inst.regi_int[1][7:3]);
                    error_count = error_count + 1;
                end

                repeat (8) @(posedge clk);
                wait (merc32_core_inst.cpu_state == ST_STEP);
                force merc32_core_inst.intr_flag = 1'b1;
                @(posedge clk);
                #1;
                release merc32_core_inst.intr_flag;
                if (merc32_core_inst.ret_addr !== saved_return) begin
                    $display("[FAIL] nested interrupt overwrote r3 return state");
                    error_count = error_count + 1;
                end

                wait ((merc32_core_inst.cpu_state == ST_LOAD) &&
                      (merc32_core_inst.prog_addr == saved_return));
                #1;
                if ((merc32_core_inst.regi_int[4] !== saved_r4) ||
                    (merc32_core_inst.regi_int[5] !== saved_r5) ||
                    (merc32_core_inst.regi_int[6] !== saved_r6) ||
                    (merc32_core_inst.regi_int[7] !== saved_r7) ||
                    (merc32_core_inst.regi_int[8] !== saved_r8) ||
                    (merc32_core_inst.regi_int[12] !== saved_r12) ||
                    (merc32_core_inst.regi_int[13] !== saved_r13) ||
                    (merc32_core_inst.regi_int[14] !== saved_r14) ||
                    (merc32_core_inst.ugt !== 1'b0) ||
                    (merc32_core_inst.uge !== 1'b1) ||
                    (merc32_core_inst.sgt !== 1'b0) ||
                    (merc32_core_inst.sge !== 1'b1) ||
                    (merc32_core_inst.eq !== 1'b1) ||
                    (merc32_core_inst.regi_int[1][7:3] !== 5'b01011) ||
                    (merc32_core_inst.regi_int[1][31:8] !== 24'd0)) begin
                    $display("[FAIL] interrupted C context was not restored");
                    error_count = error_count + 1;
                end
                interrupt_exercised = 1'b1;
            end
        end
    end
end
```

Use the same strict completion convention as the existing Tiny C benches:
`TEST PASS` only when the firmware writes `PASS_CODE`, no failure was observed,
and `interrupt_exercised` is set; otherwise print `TEST FAIL` or `TEST TIMEOUT`.
Keep `$dumpfile/$dumpvars` present but commented out. Name the instance
`merc32_core_inst`, initialize `clk` and `rst_n` at declaration, and use
`always #(CLK_PERIOD/2) clk = ~clk` plus a bounded watchdog.

- [ ] **Step 3: Create UART IRQ firmware**

Create `example/tinyc_uart_irq_test.c` with this complete firmware:

```c
volatile unsigned int irq_count = 0;
volatile unsigned int irq_error = 0;
volatile unsigned int irq_bytes[2];

unsigned int status_addr = 0x008003C0;
unsigned int fail_addr = 0x008003C4;
unsigned int irq_count_addr = 0x008003C8;
unsigned int ready_code = 0x1234;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;

int uart_wait_tx(void) {
    volatile unsigned int *tx_status = (volatile unsigned int *)0x10000014;
    int remaining = 100000;
    while ((*tx_status & 0x100) == 0) {
        remaining = remaining - 1;
        if (remaining == 0) return 0;
    }
    return 1;
}

int uart_putc(unsigned int value) {
    volatile unsigned int *ctrl = (volatile unsigned int *)0x10000000;
    volatile unsigned int *tx_buf = (volatile unsigned int *)0x10000010;
    if (uart_wait_tx() == 0) return 0;
    *tx_buf = (value & 0xFF) << 24;
    *ctrl = 0x10;
    return 1;
}

void __irq_handler(void) {
    volatile unsigned int *ctrl = (volatile unsigned int *)0x10000000;
    volatile unsigned int *rx_buf = (volatile unsigned int *)0x10000008;
    volatile unsigned int *rx_status = (volatile unsigned int *)0x1000000C;
    volatile unsigned int *uart_interrupt = (volatile unsigned int *)0x10000018;
    volatile unsigned int *irq_status = (volatile unsigned int *)irq_count_addr;
    unsigned int index = irq_count;
    int remaining = 100000;

    *uart_interrupt = 0;
    *ctrl = 0x1;
    while ((*rx_status & 0x3) == 0 && remaining != 0) {
        remaining = remaining - 1;
    }

    if (remaining == 0 || index >= 2) {
        irq_error = 1;
    } else {
        irq_bytes[index] = (*rx_buf >> 24) & 0xFF;
        irq_count = index + 1;
        *irq_status = irq_count;
    }
    *uart_interrupt = 1;
}

int main(void) {
    volatile unsigned int *config = (volatile unsigned int *)0x10000004;
    volatile unsigned int *uart_interrupt = (volatile unsigned int *)0x10000018;
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;
    unsigned int heartbeat = 0;
    unsigned int guard = 0x2468ACE0;
    unsigned int echo_count = 0;
    int delay = 0;

    *config = 100000;
    while (delay < 64) delay = delay + 1;
    *uart_interrupt = 1;
    __irq_enable();
    *status = ready_code;

    while (echo_count < 2 && irq_error == 0) {
        if (echo_count < irq_count) {
            if (uart_putc(irq_bytes[echo_count]) == 0) {
                irq_error = 3;
                break;
            }
            echo_count = echo_count + 1;
        }
        if (guard == 0x2468ACE0) heartbeat = heartbeat + 1;
        else irq_error = 2;
    }

    __irq_disable();
    *uart_interrupt = 0;
    if (irq_error != 0 || irq_count != 2 || echo_count != 2 || heartbeat == 0 ||
        irq_bytes[0] != 0x21 || irq_bytes[1] != 0x3F) {
        *fail = irq_error + 20;
        *status = fail_code;
        return 1;
    }

    *status = pass_code;
    return 0;
}
```

- [ ] **Step 4: Create the UART IRQ integration testbench**

Copy `rtl/sim/tinyc_uart_tb.v` to `rtl/sim/tinyc_uart_irq_tb.v`, rename the
module to `tinyc_uart_irq_tb`, keep the complete `MERC32_top`, `apb_uart`, ROM,
DLB, APB, UART transmit decoder, and watchdog wiring, then replace its firmware
sequence with these exact constants and stimulus:

```verilog
localparam [15:0] STATUS_ADDR = 16'd240;
localparam [15:0] FAIL_ADDR = 16'd241;
localparam [15:0] IRQ_COUNT_ADDR = 16'd242;
localparam [31:0] READY_CODE = 32'h0000_1234;
localparam [31:0] PASS_CODE = 32'h0000_600d;
localparam [31:0] FAIL_CODE = 32'h0000_0bad;

reg ready_seen = 1'b0;
reg uart_sequence_done = 1'b0;
integer received_count = 0;
integer uart_error_count = 0;

function [7:0] expected_uart_byte;
    input integer index;
    begin
        case (index)
            0: expected_uart_byte = 8'h21;
            1: expected_uart_byte = 8'h3f;
            default: expected_uart_byte = 8'h00;
        endcase
    end
endfunction

always @(posedge clk) begin
    if (!rst_n)
        ready_seen <= 1'b0;
    else if (dlb_en && dlb_we &&
             (dlb_addr == STATUS_ADDR) && (dlb_wdata == READY_CODE))
        ready_seen <= 1'b1;
end

initial begin
    wait (rst_n);
    wait (ready_seen);
    for (received_count = 0; received_count < 2; received_count = received_count + 1) begin
        send_uart_byte(expected_uart_byte(received_count));
        wait (dlb_ram[IRQ_COUNT_ADDR] == received_count + 1);
        receive_uart_byte(received_byte);
        if (received_byte !== expected_uart_byte(received_count)) begin
            $display("[FAIL] UART IRQ echo %0d expected=%02h actual=%02h",
                     received_count, expected_uart_byte(received_count), received_byte);
            uart_error_count = uart_error_count + 1;
        end
    end
    uart_sequence_done = 1'b1;
end
```

Change the completion condition so `TEST PASS` requires all of the following:

```verilog
(firmware_pass_seen || firmware_pass_write) &&
uart_sequence_done &&
(dlb_ram[IRQ_COUNT_ADDR] == 32'd2) &&
(uart_error_count == 0)
```

Treat any `FAIL_CODE` write as `TEST FAIL`, retain a cycle-bounded watchdog, and
leave the renamed `tinyc_uart_irq_tb.vcd` dump block commented out.

- [ ] **Step 5: Register both new firmware cases and tighten pass markers**

Insert these cases after the existing polling UART case in `test-c-rtl.js`:

```javascript
{
    name: 'tinyc_irq_context_test',
    top: 'merc32_core_tb',
    rtlFiles: [
        ['rtl', 'cpu', 'core.v'],
        ['rtl', 'sim', 'merc32_core_tb.v'],
    ],
},
{
    name: 'tinyc_uart_irq_test',
    top: 'tinyc_uart_irq_tb',
    rtlFiles: [
        ['rtl', 'cpu', 'core.v'],
        ['rtl', 'bridge', 'lb2apb.v'],
        ['rtl', 'cpu', 'MERC32_top.v'],
        ['rtl', 'uart', 'apb_uart.v'],
        ['rtl', 'sim', 'tinyc_uart_irq_tb.v'],
    ],
},
```

Replace the current single-marker presence check with an exact count:

```javascript
const passMarkers = output.match(/^TEST PASS$/gm) || [];
if (passMarkers.length !== 1) {
    throw new Error(`RTL simulation reported ${passMarkers.length} TEST PASS markers; expected exactly 1`);
}
```

Keep the existing rejection of `TEST FAIL` and `TEST TIMEOUT` before this count.

- [ ] **Step 6: Run the RTL suite and verify RED against the old core**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm run test:c:rtl
```

Expected: the original feature and polling UART cases pass. The focused IRQ case
then reports at least one of: missing saved `r1[3]`, nested return overwrite,
foreground context mismatch, firmware failure, or timeout. Do not change the
test to accommodate the old core.

- [ ] **Step 7: Check all new test files without committing**

Run:

```powershell
cd D:\Software\simple_cpu
git diff --check -- merc32-vsce/scripts/test-c-rtl.js example/tinyc_irq_context_test.c example/tinyc_uart_irq_test.c rtl/sim/merc32_core_tb.v rtl/sim/tinyc_uart_irq_tb.v
git status --short
```

Expected: no whitespace errors and all five intended test/fixture paths visible.

### Task 4: Implement CPU Comparison Preservation and Non-Nested Return

**Files:**
- Modify: `rtl/cpu/core.v`
- Test: `rtl/sim/merc32_core_tb.v`
- Test: `rtl/sim/tinyc_uart_irq_tb.v`

- [ ] **Step 1: Add interrupt-entry and return decode signals**

Add one register and two wires beside the existing interrupt state:

```verilog
reg                                 irq_active;
wire                                take_interrupt;
wire                                interrupt_return;
```

Decode acceptance and the exact no-link `jmp r3` register-form instruction:

```verilog
assign take_interrupt = prog_step & intr_flag & ~irq_active;
assign interrupt_return = prog_step & irq_active &
                          ({opc, fun} == {OP_REG, FUNC_JAL}) &
                          (rd == 4'd0) & (rs2 == 4'd0) & (rs1 == 4'd3);
```

This matches the existing assembler encoding of `jmp r3`: destination `r0`,
base `r0`, register offset `r3`.

- [ ] **Step 2: Gate PC entry and preserve the return address**

In the state transition and program-address blocks, replace raw `intr_flag`
decisions with `take_interrupt`:

```verilog
ST_STEP: cpu_state <= prog_step ?
         (dbg_halt ? ST_HALT : (take_interrupt ? ST_INTR : ST_LOAD)) :
         ST_STEP;
```

```verilog
always @(posedge clk) begin
    if (!cpu_rst_n) begin
        prog_addr <= 0;
        ret_addr <= 0;
    end else if (prog_step) begin
        prog_addr <= take_interrupt ? intr_addr : prog_next;
        ret_addr <= take_interrupt ? prog_next : ret_addr;
    end
end
```

- [ ] **Step 3: Add the non-nested active-state lifecycle**

Add this sequential block:

```verilog
always @(posedge clk) begin
    if (!cpu_rst_n) begin
        irq_active <= 1'b0;
    end else if (take_interrupt) begin
        irq_active <= 1'b1;
    end else if (interrupt_return) begin
        irq_active <= 1'b0;
    end
end
```

Update `intr_flag` so new events are discarded while active and any completed
instruction step clears the pending latch:

```verilog
intr_flag <= trig_hit & trig_en & ~irq_active ? 1'b1 :
             prog_step ? 1'b0 :
             intr_flag;
```

- [ ] **Step 4: Make `r1[2:0]` writable and `r1[7:3]` hardware-owned**

Refactor the existing `register_files` block so `r0`, `r1`, `r3`, and `r15` each
receive one assignment per active branch. Preserve the current assignments for
ordinary registers, but skip those four indices in the ALU-write case. Compute
the complete `r1` value in one non-blocking assignment:

```verilog
always @(posedge clk) begin : register_files
    integer i;
    if (!cpu_rst_n) begin
        for (i = 0; i < 16; i = i + 1)
            regi_int[i] <= 0;
    end else begin
        regi_int[0] <= 32'h0;
        regi_int[3] <= ret_addr;
        regi_int[15] <= prog_addr;

        if (take_interrupt) begin
            regi_int[1] <= {
                24'd0, ugt, uge, sgt, sge, eq,
                (alu_vld && (alu_ptr == 4'd1)) ? alu_data[2:0] : regi_int[1][2:0]
            };
        end else begin
            regi_int[1] <= {
                24'd0, regi_int[1][7:3],
                (alu_vld && (alu_ptr == 4'd1)) ? alu_data[2:0] : regi_int[1][2:0]
            };
        end

        if (alu_vld) begin
            case (alu_ptr)
                4'd2:  regi_int[2] <= alu_data;
                4'd4:  regi_int[4] <= alu_data;
                4'd5:  regi_int[5] <= alu_data;
                4'd6:  regi_int[6] <= alu_data;
                4'd7:  regi_int[7] <= alu_data;
                4'd8:  regi_int[8] <= alu_data;
                4'd9:  regi_int[9] <= alu_data;
                4'd10: regi_int[10] <= alu_data;
                4'd11: regi_int[11] <= alu_data;
                4'd12: regi_int[12] <= alu_data;
                4'd13: regi_int[13] <= alu_data;
                4'd14: regi_int[14] <= alu_data;
                default: begin end
            endcase
        end
    end
end
```

This mapping implements `r1[3]=EQ`, `[4]=SGE`, `[5]=SGT`, `[6]=UGE`, and
`[7]=UGT`, while forcing `[31:8]` to zero.

- [ ] **Step 5: Restore comparison state on active `jmp r3`**

Give `interrupt_return` priority over normal compare execution in the existing
comparison-register block:

```verilog
always @(posedge clk) begin
    if (!cpu_rst_n) begin
        ugt <= 0;
        uge <= 0;
        sgt <= 0;
        sge <= 0;
        eq <= 0;
    end else if (interrupt_return) begin
        ugt <= regi_int[1][7];
        uge <= regi_int[1][6];
        sgt <= regi_int[1][5];
        sge <= regi_int[1][4];
        eq <= regi_int[1][3];
    end else if (prog_exec) begin
        case ({opc, fun})
            {OP_IMM, FUNC_CMP}: begin
                ugt <= $unsigned(regi_int[rs2]) > $unsigned(imm);
                uge <= $unsigned(regi_int[rs2]) >= $unsigned(imm);
                sgt <= $signed(regi_int[rs2]) > $signed(imm);
                sge <= $signed(regi_int[rs2]) >= $signed(imm);
                eq <= regi_int[rs2] == imm;
            end
            {OP_REG, FUNC_CMP}: begin
                ugt <= $unsigned(regi_int[rs2]) > $unsigned(regi_int[rs1]);
                uge <= $unsigned(regi_int[rs2]) >= $unsigned(regi_int[rs1]);
                sgt <= $signed(regi_int[rs2]) > $signed(regi_int[rs1]);
                sge <= $signed(regi_int[rs2]) >= $signed(regi_int[rs1]);
                eq <= regi_int[rs2] == regi_int[rs1];
            end
        endcase
    end
end
```

- [ ] **Step 6: Run the complete RTL GREEN suite**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm run test:c:rtl
```

Expected: exactly one `TEST PASS` from each of four cases:

```text
tinyc_feature_test RTL execution test passed
tinyc_uart_test RTL execution test passed
tinyc_irq_context_test RTL execution test passed
tinyc_uart_irq_test RTL execution test passed
MERC32 Tiny C RTL suite passed (4 tests)
```

- [ ] **Step 7: Run compiler regressions after the RTL change**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm test
```

Expected: pseudo-instruction and C compiler integration tests pass.

- [ ] **Step 8: Check RTL style and the scoped diff without committing**

Run:

```powershell
cd D:\Software\simple_cpu
git diff --check -- rtl/cpu/core.v rtl/sim/merc32_core_tb.v rtl/sim/tinyc_uart_irq_tb.v
git status --short
```

Confirm manually in the diff that all new sequential assignments use `<=`, no
signal is assigned by multiple `always` blocks, and no SystemVerilog syntax was
introduced.

### Task 5: Update ABI and ISA Documentation

**Files:**
- Modify: `ABI.md`
- Modify: `ISA.md`

- [ ] **Step 1: Replace the obsolete interrupt limitation in `ABI.md`**

Replace the register table in section 2 with this complete table:

```markdown
| 寄存器 | ABI 名称 | 用途 |
|---|---|---|
| `r0` | ZERO | 硬件零寄存器 |
| `r1` | IRQCTL / IRQFLAGS | `[2:0]` 为软件可写中断控制；`[7:3]` 为硬件保存且软件只读的比较状态；`[31:8]` 读零 |
| `r2` | IVEC | 32 位中断入口字节地址；Tiny C 启动代码在存在 handler 时写入 `4` |
| `r3` | IRET | 硬件中断返回字节地址寄存器，软件只读，不作为 C ABI 通用寄存器使用 |
| `r4` | A0 / RET | 第 1 个参数；函数返回值 |
| `r5` | A1 | 第 2 个参数 |
| `r6` | A2 | 第 3 个参数 |
| `r7` | A3 / T0 | 第 4 个参数；函数入口保存参数后可作编译器临时寄存器 |
| `r8` | T1 | 编译器临时寄存器 |
| `r12` | FP | 当前函数栈帧基址 |
| `r13` | SP | 软件栈指针，位于 DLB，向低地址增长 |
| `r14` | LR | 调用返回地址，`jmp func, r14` 写入 |
| `r15` | PC | 硬件 PC 寄存器，不作为普通 C 寄存器使用 |
```

Replace section 11 with the approved contract and exact wrapper layout:

```markdown
## 11. Tiny C 中断 ABI

定义 `void __irq_handler(void)` 后，编译器在机器字节地址 `4` 生成中断
wrapper，并在启动代码中将 `r2` 设置为 `4`。汇编器根据 `.entry __start`
独占生成地址 `0` 的复位跳转。

`__irq_enable()` 以 CPU 上升沿模式使能中断，`__irq_disable()` 关闭中断。
两者都要求程序中存在有效的 `__irq_handler` 定义。

wrapper 保存 `r4-r8`、`r12`、`r14`，并通过同一软件栈调用普通 C handler。
CPU 在 `r1[7:3]` 保存比较状态，在活动 ISR 的 `jmp r3` 上恢复状态。
中断不嵌套也不排队；handler 返回前必须让外设中断源失效。

wrapper 在被中断的 `r13` 下方分配 28 字节：

| 相对新 `r13` 的偏移 | 保存内容 |
|---:|---|
| `0` | `r4` |
| `4` | `r5` |
| `8` | `r6` |
| `12` | `r7` |
| `16` | `r8` |
| `20` | `r12` |
| `24` | `r14` |

handler 返回后，wrapper 逆序恢复寄存器，释放 28 字节栈帧，并执行
`jmp r3`。`r13` 通过栈帧释放恢复，不单独保存。
```

- [ ] **Step 2: Add hardware interrupt semantics to `ISA.md`**

Replace the register-convention table with the following rows, then add the
interrupt subsection immediately after it:

```markdown
| 寄存器 | 说明 |
|------|------|
| `r0` | 零寄存器，读出恒为 0，写入无效 |
| `r1` | 中断控制与已保存比较状态；仅 `[2:0]` 可由软件写入 |
| `r2` | 中断入口的 32 位字节地址 |
| `r3` | 硬件中断返回字节地址，软件写入无效 |
| `r15` | PC 寄存器，读出当前指令字节地址，写入无效 |
```

Add this subsection after the register conventions:

```markdown
### 中断寄存器与返回

- `r1[0]`：中断使能；`r1[2:1]`：触发模式。
- `r1[3]`/`[4]`/`[5]`/`[6]`/`[7]`：硬件保存的
  `EQ`/`SGE`/`SGT`/`UGE`/`UGT`，软件只读。
- `r2`：中断入口的 32 位字节地址。
- `r3`：硬件保存的返回字节地址，软件只读。

CPU 接受中断后进入非嵌套 `irq_active` 状态。此状态下执行无链接
`jmp r3` 会恢复 `r1[7:3]` 对应的比较状态并退出中断；在普通执行状态下，
`jmp r3` 仍是一般寄存器间接跳转。
```

- [ ] **Step 3: Check documentation consistency**

Run:

```powershell
cd D:\Software\simple_cpu
Select-String -LiteralPath ABI.md,ISA.md -Pattern '当前 C 编译器生成的是普通函数调用约定，不适合直接作为硬件 ISR 入口'
git diff --check -- ABI.md ISA.md
```

Expected: no obsolete limitation match and no diff errors. Verify the mapping is
identical everywhere: `r1[3]=EQ`, `[4]=SGE`, `[5]=SGT`, `[6]=UGE`, `[7]=UGT`.

- [ ] **Step 4: Check the documentation diff without committing**

Run:

```powershell
cd D:\Software\simple_cpu
git status --short
```

Expected: only the intended compiler, RTL, firmware, test, plan/spec, and
documentation paths plus preserved pre-existing user changes.

### Task 6: Final Verification, Cleanup, and Review

**Files:**
- Verify all files listed above.
- Do not create persistent simulator outputs.

- [ ] **Step 1: Record the simulator-artifact baseline**

Before running any Task 6 test command, start from the repository root and keep
this PowerShell session open through Step 5:

```powershell
$ErrorActionPreference = 'Stop'
Set-Location D:\Software\simple_cpu
$repoRoot = (Get-Location).Path.TrimEnd('\')
$artifactExtensions = @('.vvp', '.vcd', '.mem', '.out', '.log', '.fst')
$artifactPrefixLength = $repoRoot.Length + 1

function Get-SimulatorArtifactSnapshot {
    @(
        Get-ChildItem -LiteralPath $repoRoot -Recurse -File -Force |
            Where-Object {
                $_.FullName -notmatch '[\\/]\.git[\\/]' -and
                $_.Extension.ToLowerInvariant() -in $artifactExtensions
            } |
            ForEach-Object {
                [pscustomobject]@{
                    Path = $_.FullName.Substring($artifactPrefixLength)
                    Length = $_.Length
                    LastWriteTimeUtcTicks = $_.LastWriteTimeUtc.Ticks
                }
            } |
            Sort-Object Path
    )
}

$artifactBaseline = @(Get-SimulatorArtifactSnapshot)
$artifactBaseline | Format-Table -AutoSize
```

This intentionally includes ignored files. Existing Vivado outputs are allowed
as disclosed baseline entries; later steps must not add or modify any entry.

- [ ] **Step 2: Run a fresh full toolchain regression**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm test
```

Expected: pseudo-instruction and Tiny C compiler integration tests pass.

- [ ] **Step 3: Run a fresh four-case Tiny C RTL suite**

Run:

```powershell
cd D:\Software\simple_cpu\merc32-vsce
npm run test:c:rtl
```

Expected: four firmware cases pass, each with exactly one `TEST PASS`, and the
runner reports `MERC32 Tiny C RTL suite passed (4 tests)`.

- [ ] **Step 4: Re-run the standalone UART regression**

Compile `rtl/uart/apb_uart.v` and `rtl/sim/tb_apb_uart.v` with unique temporary
paths. Check each process exit before inspecting markers, and always clean up:

```powershell
Set-Location $repoRoot
$uartVerifyId = [guid]::NewGuid().ToString('N')
$uartVvp = Join-Path $env:TEMP "merc32_uart_verify_$uartVerifyId.vvp"
$uartLog = Join-Path $env:TEMP "merc32_uart_verify_$uartVerifyId.log"

try {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $iverilogOutput = @(
            & iverilog -Wall -g2005 -s tb_apb_uart -o $uartVvp `
                rtl\uart\apb_uart.v rtl\sim\tb_apb_uart.v 2>&1
        )
        $iverilogExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $iverilogOutput | ForEach-Object { $_.ToString() }
    if ($iverilogExit -ne 0) {
        throw "iverilog failed with exit code $iverilogExit"
    }

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $uartOutput = @(& vvp $uartVvp 2>&1)
        $vvpExit = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    $uartOutput | Tee-Object -FilePath $uartLog
    if ($vvpExit -ne 0) {
        throw "vvp failed with exit code $vvpExit"
    }

    $uartLines = @(Get-Content -LiteralPath $uartLog)
    $passCount = @($uartLines | Where-Object { $_ -ceq 'TEST PASS' }).Count
    $failureLines = @(
        $uartLines | Where-Object {
            $_.Contains('[FAIL]') -or
            $_.Contains('TEST FAIL') -or
            $_.Contains('TEST TIMEOUT')
        }
    )
    if (($passCount -ne 1) -or ($failureLines.Count -ne 0)) {
        throw "UART marker gate failed: TEST PASS=$passCount, failure markers=$($failureLines.Count)"
    }
} finally {
    if (Test-Path -LiteralPath $uartVvp) {
        Remove-Item -LiteralPath $uartVvp
    }
    if (Test-Path -LiteralPath $uartLog) {
        Remove-Item -LiteralPath $uartLog
    }
}

if ((Test-Path -LiteralPath $uartVvp) -or
    (Test-Path -LiteralPath $uartLog)) {
    throw 'UART verification temporary-file cleanup failed'
}
```

The `finally` block deletes only this run's GUID-suffixed paths, including when
compilation, simulation, or marker validation fails.

- [ ] **Step 5: Run patch, whitespace, scope, and artifact checks**

Run:

```powershell
cd D:\Software\simple_cpu
& git diff --check
if ($LASTEXITCODE -ne 0) {
    throw "tracked whitespace check failed with exit code $LASTEXITCODE"
}

$untrackedFiles = @(git ls-files --others --exclude-standard)
foreach ($file in $untrackedFiles) {
    $checkOutput = @(
        & git -c core.autocrlf=false diff --no-index --check -- NUL $file 2>&1
    )
    $checkExit = $LASTEXITCODE
    if (($checkExit -ne 1) -or ($checkOutput.Count -ne 0)) {
        $checkOutput | ForEach-Object { $_.ToString() }
        throw "untracked whitespace check failed for $file (exit $checkExit)"
    }
}

$artifactAfter = @(Get-SimulatorArtifactSnapshot)
$artifactDelta = @(
    Compare-Object -ReferenceObject $artifactBaseline `
        -DifferenceObject $artifactAfter `
        -Property Path, Length, LastWriteTimeUtcTicks
)
if ($artifactDelta.Count -ne 0) {
    $artifactDelta | Format-Table -AutoSize
    throw 'repository simulator artifacts changed during Task 6'
}

git status --short --untracked-files=all
git diff --name-only

$scopePaths = @(
    git status --short --untracked-files=all |
        ForEach-Object { $_.Substring(3) }
)
$canPaths = @($scopePaths | Where-Object { $_ -match '(?i)can' })
if ($canPaths.Count -ne 0) {
    $canPaths | ForEach-Object { Write-Output "unexpected CAN path: $_" }
    throw 'CAN path changed during the UART interrupt milestone'
}
```

Expected: tracked and untracked whitespace checks pass, and `Compare-Object`
reports no new or modified simulator artifact, including ignored outputs. No CAN
path may appear. Production UART scope must be judged against the recorded
pre-task dirty-worktree baseline, not against HEAD: `rtl/uart/apb_uart.v` remains
an expected M1-M3 dirty path, and this milestone must add no change relative to
that baseline. If the pre-task baseline is unavailable, report production UART
scope as unverified rather than claiming the path is clean.

- [ ] **Step 6: Refresh CodeGraph before structural review**

Run:

```powershell
cd D:\Software\simple_cpu
codegraph sync
```

Then call `codegraph_status`. If any CodeGraph response still reports an
uncommitted-change freshness warning, rely on the fresh compiler/test commands
for correctness and state that the local index freshness check was performed.

- [ ] **Step 7: Request focused code review**

Use `superpowers:requesting-code-review` against the working-tree diff. Ask the
reviewer to check:

- `r1` mixed-access assignment priority;
- exact `jmp r3` encoding detection;
- flag restoration timing before the resumed `brc`;
- wrapper register and stack symmetry;
- non-handler backward compatibility;
- strict simulation marker parsing and cleanup;
- absence of CAN and production UART RTL changes.

Fix every Critical or Important finding with a fresh RED/GREEN test, then rerun
Steps 1-6.

- [ ] **Step 8: Produce the completion report**

Report modified/created files, compiler API, CPU semantics, both new RTL test
scenarios, exact test outputs, artifact cleanup, skipped VKS steps, and remaining
limitations: one vector, rising-edge builtin, non-nested and non-queued events,
UART only. State explicitly that no commit was created.
