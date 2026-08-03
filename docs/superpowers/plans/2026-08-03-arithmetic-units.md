# Iterative Arithmetic Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable 32-bit signed/unsigned iterative multiplier and divider modules with self-checking Verilog simulations.

**Architecture:** Each module accepts a one-cycle `start` pulse while internally idle, converts signed operands to unsigned magnitudes when requested, and runs one shift/add or shift/subtract step per clock. The internal running flag is intentionally private; completion is reported by a one-cycle `done` pulse after 32 normal iterations.

**Tech Stack:** Verilog-2005 RTL, Icarus Verilog (`iverilog` and `vvp`), PowerShell commands.

---

## File Structure

- Create `rtl/misc/mul.v`: one-bit-per-cycle 32x32 multiplier with a 64-bit result.
- Create `rtl/sim/mul_tb.v`: self-checking multiplier interface, arithmetic, latency, and ignored-start tests.
- Create `rtl/misc/div.v`: restoring one-bit-per-cycle divider with quotient and remainder outputs.
- Create `rtl/sim/div_tb.v`: self-checking divider interface, arithmetic, boundary, divide-by-zero, latency, and ignored-start tests.

The CPU core, ISA document, assembler, compiler, and existing `rtl/cpu/divider.v` are outside this implementation. The old divider has a different module name and interface and is not referenced by these standalone tests.

### Task 1: Iterative Multiplier

**Files:**
- Create: `rtl/sim/mul_tb.v`
- Create: `rtl/misc/mul.v`

- [ ] **Step 1: Write the failing multiplier test**

Create `rtl/sim/mul_tb.v` with the following complete self-checking testbench:

```verilog
`timescale 1ns/1ps

module mul_tb;

    reg         clk;
    reg         rst_n;
    reg         start;
    reg         signed_mode;
    reg  [31:0] operand_a;
    reg  [31:0] operand_b;
    wire        done;
    wire [63:0] result;

    integer failures;

    mul dut (
        .clk         (clk),
        .rst_n       (rst_n),
        .start       (start),
        .signed_mode (signed_mode),
        .operand_a   (operand_a),
        .operand_b   (operand_b),
        .done        (done),
        .result      (result)
    );

    always #5 clk = ~clk;

    task check_mul;
        input        test_signed;
        input [31:0] test_a;
        input [31:0] test_b;
        input [63:0] expected_result;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode = test_signed;
            operand_a   = test_a;
            operand_b   = test_b;
            start       = 1'b1;

            @(posedge clk);
            #1 start = 1'b0;

            if (done) begin
                $display("FAIL mul completed before its first iteration");
                failures = failures + 1;
            end

            cycles = 0;
            while (!done && cycles < 40) begin
                @(posedge clk);
                #1 cycles = cycles + 1;
            end

            if (!done) begin
                $display("FAIL mul timeout: signed=%0d a=%h b=%h",
                         test_signed, test_a, test_b);
                failures = failures + 1;
            end else begin
                if (cycles != 32) begin
                    $display("FAIL mul latency: got=%0d expected=32", cycles);
                    failures = failures + 1;
                end
                if (result !== expected_result) begin
                    $display("FAIL mul result: signed=%0d a=%h b=%h got=%h expected=%h",
                             test_signed, test_a, test_b, result, expected_result);
                    failures = failures + 1;
                end
            end

            @(posedge clk);
            #1;
            if (done) begin
                $display("FAIL mul done remained high for more than one cycle");
                failures = failures + 1;
            end
        end
    endtask

    task check_ignored_start;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode = 1'b0;
            operand_a   = 32'd7;
            operand_b   = 32'd9;
            start       = 1'b1;
            @(posedge clk);
            #1 start = 1'b0;

            repeat (5) @(posedge clk);
            @(negedge clk);
            operand_a = 32'hffff_ffff;
            operand_b = 32'hffff_ffff;
            start     = 1'b1;
            @(posedge clk);
            #1 start = 1'b0;

            cycles = 0;
            while (!done && cycles < 40) begin
                @(posedge clk);
                #1 cycles = cycles + 1;
            end

            if (!done) begin
                $display("FAIL mul ignored-start test timed out");
                failures = failures + 1;
            end else if (result !== 64'd63) begin
                $display("FAIL mul accepted start while running: got=%h", result);
                failures = failures + 1;
            end

            @(posedge clk);
            #1;
        end
    endtask

    initial begin
        clk         = 1'b0;
        rst_n       = 1'b0;
        start       = 1'b0;
        signed_mode = 1'b0;
        operand_a   = 32'd0;
        operand_b   = 32'd0;
        failures    = 0;

        repeat (3) @(posedge clk);
        #1;
        if (done !== 1'b0 || result !== 64'd0) begin
            $display("FAIL mul reset outputs: done=%b result=%h", done, result);
            failures = failures + 1;
        end
        @(negedge clk);
        rst_n = 1'b1;

        check_mul(1'b0, 32'd0,         32'hffff_ffff, 64'h0000_0000_0000_0000);
        check_mul(1'b0, 32'd1,         32'hffff_ffff, 64'h0000_0000_ffff_ffff);
        check_mul(1'b0, 32'hffff_ffff, 32'hffff_ffff, 64'hffff_fffe_0000_0001);
        check_mul(1'b0, 32'h1234_5678, 32'h9abc_def0, 64'h0b00_ea4e_242d_2080);
        check_mul(1'b1, 32'hffff_ffff, 32'd7,         64'hffff_ffff_ffff_fff9);
        check_mul(1'b1, 32'hffff_fffe, 32'hffff_fffd, 64'h0000_0000_0000_0006);
        check_mul(1'b1, 32'h8000_0000, 32'd1,         64'hffff_ffff_8000_0000);
        check_mul(1'b1, 32'h8000_0000, 32'hffff_ffff, 64'h0000_0000_8000_0000);
        check_ignored_start;

        if (failures == 0) begin
            $display("PASS: mul_tb");
            $finish;
        end else begin
            $display("FAIL: mul_tb failures=%0d", failures);
            $finish_and_return(1);
        end
    end

endmodule
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
iverilog -g2005 -Wall -s mul_tb -o "$env:TEMP\mul_tb.vvp" rtl/misc/mul.v rtl/sim/mul_tb.v
```

Expected: compilation fails because `rtl/misc/mul.v` does not exist or module `mul` is undefined.

- [ ] **Step 3: Implement the iterative multiplier**

Create `rtl/misc/mul.v`:

```verilog
module mul (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        start,
    input  wire        signed_mode,
    input  wire [31:0] operand_a,
    input  wire [31:0] operand_b,
    output reg         done,
    output reg  [63:0] result
);

    reg         running;
    reg  [4:0]  iteration;
    reg  [63:0] accumulator;
    reg  [63:0] shifted_multiplicand;
    reg  [31:0] shifted_multiplier;
    reg         result_negative;

    wire [31:0] operand_a_magnitude;
    wire [31:0] operand_b_magnitude;
    wire [63:0] accumulator_next;

    assign operand_a_magnitude = signed_mode && operand_a[31]
                               ? (~operand_a + 32'd1) : operand_a;
    assign operand_b_magnitude = signed_mode && operand_b[31]
                               ? (~operand_b + 32'd1) : operand_b;
    assign accumulator_next = shifted_multiplier[0]
                            ? accumulator + shifted_multiplicand
                            : accumulator;

    always @(posedge clk) begin
        if (!rst_n) begin
            running               <= 1'b0;
            iteration             <= 5'd0;
            accumulator           <= 64'd0;
            shifted_multiplicand  <= 64'd0;
            shifted_multiplier    <= 32'd0;
            result_negative       <= 1'b0;
            done                  <= 1'b0;
            result                <= 64'd0;
        end else begin
            done <= 1'b0;

            if (!running) begin
                if (start) begin
                    running              <= 1'b1;
                    iteration            <= 5'd0;
                    accumulator          <= 64'd0;
                    shifted_multiplicand <= {32'd0, operand_a_magnitude};
                    shifted_multiplier   <= operand_b_magnitude;
                    result_negative      <= signed_mode
                                          && (operand_a[31] ^ operand_b[31]);
                end
            end else begin
                accumulator          <= accumulator_next;
                shifted_multiplicand <= shifted_multiplicand << 1;
                shifted_multiplier   <= shifted_multiplier >> 1;

                if (iteration == 5'd31) begin
                    running <= 1'b0;
                    done    <= 1'b1;
                    result  <= result_negative
                             ? (~accumulator_next + 64'd1)
                             : accumulator_next;
                end else begin
                    iteration <= iteration + 5'd1;
                end
            end
        end
    end

endmodule
```

- [ ] **Step 4: Run the multiplier test to verify it passes**

Run:

```powershell
iverilog -g2005 -Wall -s mul_tb -o "$env:TEMP\mul_tb.vvp" rtl/misc/mul.v rtl/sim/mul_tb.v
vvp "$env:TEMP\mul_tb.vvp"
```

Expected output contains exactly one final success marker:

```text
PASS: mul_tb
```

- [ ] **Step 5: Commit the multiplier and its test**

```powershell
git add -- rtl/misc/mul.v rtl/sim/mul_tb.v
git commit -m "feat: add iterative multiplier"
```

### Task 2: Iterative Divider

**Files:**
- Create: `rtl/sim/div_tb.v`
- Create: `rtl/misc/div.v`

- [ ] **Step 1: Write the failing divider test**

Create `rtl/sim/div_tb.v` with the following complete self-checking testbench:

```verilog
`timescale 1ns/1ps

module div_tb;

    reg         clk;
    reg         rst_n;
    reg         start;
    reg         signed_mode;
    reg  [31:0] dividend;
    reg  [31:0] divisor;
    wire        done;
    wire [31:0] quotient;
    wire [31:0] remainder;

    integer failures;

    div dut (
        .clk         (clk),
        .rst_n       (rst_n),
        .start       (start),
        .signed_mode (signed_mode),
        .dividend    (dividend),
        .divisor     (divisor),
        .done        (done),
        .quotient    (quotient),
        .remainder   (remainder)
    );

    always #5 clk = ~clk;

    task check_div;
        input        test_signed;
        input [31:0] test_dividend;
        input [31:0] test_divisor;
        input [31:0] expected_quotient;
        input [31:0] expected_remainder;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode = test_signed;
            dividend    = test_dividend;
            divisor     = test_divisor;
            start       = 1'b1;

            @(posedge clk);
            #1 start = 1'b0;

            if (test_divisor == 32'd0) begin
                if (!done) begin
                    $display("FAIL div zero did not complete when start was accepted");
                    failures = failures + 1;
                end
            end else begin
                if (done) begin
                    $display("FAIL div completed before its first iteration");
                    failures = failures + 1;
                end

                cycles = 0;
                while (!done && cycles < 40) begin
                    @(posedge clk);
                    #1 cycles = cycles + 1;
                end

                if (!done) begin
                    $display("FAIL div timeout: signed=%0d dividend=%h divisor=%h",
                             test_signed, test_dividend, test_divisor);
                    failures = failures + 1;
                end else if (cycles != 32) begin
                    $display("FAIL div latency: got=%0d expected=32", cycles);
                    failures = failures + 1;
                end
            end

            if (done) begin
                if (quotient !== expected_quotient
                    || remainder !== expected_remainder) begin
                    $display("FAIL div result: signed=%0d dividend=%h divisor=%h",
                             test_signed, test_dividend, test_divisor);
                    $display("  got q=%h r=%h expected q=%h r=%h",
                             quotient, remainder,
                             expected_quotient, expected_remainder);
                    failures = failures + 1;
                end
            end

            @(posedge clk);
            #1;
            if (done) begin
                $display("FAIL div done remained high for more than one cycle");
                failures = failures + 1;
            end
        end
    endtask

    task check_ignored_start;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode = 1'b0;
            dividend    = 32'd1000;
            divisor     = 32'd7;
            start       = 1'b1;
            @(posedge clk);
            #1 start = 1'b0;

            repeat (5) @(posedge clk);
            @(negedge clk);
            dividend = 32'd9;
            divisor  = 32'd2;
            start    = 1'b1;
            @(posedge clk);
            #1 start = 1'b0;

            cycles = 0;
            while (!done && cycles < 40) begin
                @(posedge clk);
                #1 cycles = cycles + 1;
            end

            if (!done) begin
                $display("FAIL div ignored-start test timed out");
                failures = failures + 1;
            end else if (quotient !== 32'd142 || remainder !== 32'd6) begin
                $display("FAIL div accepted start while running: q=%h r=%h",
                         quotient, remainder);
                failures = failures + 1;
            end

            @(posedge clk);
            #1;
        end
    endtask

    initial begin
        clk         = 1'b0;
        rst_n       = 1'b0;
        start       = 1'b0;
        signed_mode = 1'b0;
        dividend    = 32'd0;
        divisor     = 32'd0;
        failures    = 0;

        repeat (3) @(posedge clk);
        #1;
        if (done !== 1'b0 || quotient !== 32'd0 || remainder !== 32'd0) begin
            $display("FAIL div reset outputs: done=%b q=%h r=%h",
                     done, quotient, remainder);
            failures = failures + 1;
        end
        @(negedge clk);
        rst_n = 1'b1;

        check_div(1'b0, 32'd0,         32'd1,         32'd0,         32'd0);
        check_div(1'b0, 32'd100,       32'd7,         32'd14,        32'd2);
        check_div(1'b0, 32'hffff_ffff, 32'd16,        32'h0fff_ffff, 32'd15);
        check_div(1'b0, 32'hffff_ffff, 32'hffff_ffff, 32'd1,         32'd0);
        check_div(1'b0, 32'h8000_0000, 32'd2,         32'h4000_0000, 32'd0);
        check_div(1'b1, 32'hffff_fff9, 32'd3,         32'hffff_fffe, 32'hffff_ffff);
        check_div(1'b1, 32'd7,         32'hffff_fffd, 32'hffff_fffe, 32'd1);
        check_div(1'b1, 32'hffff_fff9, 32'hffff_fffd, 32'd2,         32'hffff_ffff);
        check_div(1'b1, 32'h8000_0000, 32'hffff_ffff, 32'h8000_0000, 32'd0);
        check_div(1'b1, 32'h8000_0000, 32'd3,         32'hd555_5556, 32'hffff_fffe);
        check_div(1'b0, 32'h1234_5678, 32'd0,         32'hffff_ffff, 32'h1234_5678);
        check_div(1'b1, 32'hffff_fff9, 32'd0,         32'hffff_ffff, 32'hffff_fff9);
        check_ignored_start;

        if (failures == 0) begin
            $display("PASS: div_tb");
            $finish;
        end else begin
            $display("FAIL: div_tb failures=%0d", failures);
            $finish_and_return(1);
        end
    end

endmodule
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```powershell
iverilog -g2005 -Wall -s div_tb -o "$env:TEMP\div_tb.vvp" rtl/misc/div.v rtl/sim/div_tb.v
```

Expected: compilation fails because `rtl/misc/div.v` does not exist or module `div` is undefined.

- [ ] **Step 3: Implement the restoring divider**

Create `rtl/misc/div.v`:

```verilog
module div (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        start,
    input  wire        signed_mode,
    input  wire [31:0] dividend,
    input  wire [31:0] divisor,
    output reg         done,
    output reg  [31:0] quotient,
    output reg  [31:0] remainder
);

    reg         running;
    reg  [4:0]  iteration;
    reg  [31:0] divisor_reg;
    reg  [31:0] dividend_reg;
    reg  [31:0] quotient_reg;
    reg  [32:0] partial_remainder_reg;
    reg         quotient_negative;
    reg         remainder_negative;

    wire [31:0] dividend_magnitude;
    wire [31:0] divisor_magnitude;
    wire [32:0] shifted_remainder;
    wire        subtract_divisor;
    wire [32:0] partial_remainder_next;
    wire [31:0] quotient_next;

    assign dividend_magnitude = signed_mode && dividend[31]
                              ? (~dividend + 32'd1) : dividend;
    assign divisor_magnitude = signed_mode && divisor[31]
                             ? (~divisor + 32'd1) : divisor;

    assign shifted_remainder = {partial_remainder_reg[31:0],
                                dividend_reg[31]};
    assign subtract_divisor = shifted_remainder >= {1'b0, divisor_reg};
    assign partial_remainder_next = subtract_divisor
                                  ? shifted_remainder - {1'b0, divisor_reg}
                                  : shifted_remainder;
    assign quotient_next = {quotient_reg[30:0], subtract_divisor};

    always @(posedge clk) begin
        if (!rst_n) begin
            running               <= 1'b0;
            iteration             <= 5'd0;
            divisor_reg           <= 32'd0;
            dividend_reg          <= 32'd0;
            quotient_reg          <= 32'd0;
            partial_remainder_reg <= 33'd0;
            quotient_negative     <= 1'b0;
            remainder_negative    <= 1'b0;
            done                  <= 1'b0;
            quotient              <= 32'd0;
            remainder             <= 32'd0;
        end else begin
            done <= 1'b0;

            if (!running) begin
                if (start) begin
                    if (divisor == 32'd0) begin
                        quotient  <= 32'hffff_ffff;
                        remainder <= dividend;
                        done      <= 1'b1;
                    end else begin
                        running               <= 1'b1;
                        iteration             <= 5'd0;
                        divisor_reg           <= divisor_magnitude;
                        dividend_reg          <= dividend_magnitude;
                        quotient_reg          <= 32'd0;
                        partial_remainder_reg <= 33'd0;
                        quotient_negative     <= signed_mode
                                               && (dividend[31] ^ divisor[31]);
                        remainder_negative    <= signed_mode && dividend[31];
                    end
                end
            end else begin
                dividend_reg          <= dividend_reg << 1;
                quotient_reg          <= quotient_next;
                partial_remainder_reg <= partial_remainder_next;

                if (iteration == 5'd31) begin
                    running   <= 1'b0;
                    done      <= 1'b1;
                    quotient  <= quotient_negative
                               ? (~quotient_next + 32'd1)
                               : quotient_next;
                    remainder <= remainder_negative
                               ? (~partial_remainder_next[31:0] + 32'd1)
                               : partial_remainder_next[31:0];
                end else begin
                    iteration <= iteration + 5'd1;
                end
            end
        end
    end

endmodule
```

- [ ] **Step 4: Run the divider test to verify it passes**

Run:

```powershell
iverilog -g2005 -Wall -s div_tb -o "$env:TEMP\div_tb.vvp" rtl/misc/div.v rtl/sim/div_tb.v
vvp "$env:TEMP\div_tb.vvp"
```

Expected output contains exactly one final success marker:

```text
PASS: div_tb
```

- [ ] **Step 5: Commit the divider and its test**

```powershell
git add -- rtl/misc/div.v rtl/sim/div_tb.v
git commit -m "feat: add iterative divider"
```

### Task 3: Combined Verification and Scope Check

**Files:**
- Verify: `rtl/misc/mul.v`
- Verify: `rtl/misc/div.v`
- Verify: `rtl/sim/mul_tb.v`
- Verify: `rtl/sim/div_tb.v`

- [ ] **Step 1: Compile both modules in strict Verilog-2005 mode**

Run:

```powershell
iverilog -g2005 -Wall -s mul_tb -o "$env:TEMP\mul_tb.vvp" rtl/misc/mul.v rtl/sim/mul_tb.v
iverilog -g2005 -Wall -s div_tb -o "$env:TEMP\div_tb.vvp" rtl/misc/div.v rtl/sim/div_tb.v
```

Expected: both commands exit successfully without warnings.

- [ ] **Step 2: Run both self-checking simulations**

Run:

```powershell
vvp "$env:TEMP\mul_tb.vvp"
vvp "$env:TEMP\div_tb.vvp"
```

Expected:

```text
PASS: mul_tb
PASS: div_tb
```

- [ ] **Step 3: Check formatting and confirm only scoped files changed**

Run:

```powershell
git diff --check -- rtl/misc/mul.v rtl/misc/div.v rtl/sim/mul_tb.v rtl/sim/div_tb.v
git status --short
```

Expected: `git diff --check` prints nothing. `git status` may still show pre-existing user changes, but this implementation contributes only the four listed RTL/test files; simulation executables remain under `$env:TEMP` and do not pollute the repository.

## Completion Criteria

- Both modules compile as Verilog-2005 without inferred `*`, `/`, or `%` datapaths.
- All normal operations assert `done` after exactly 32 iteration clocks.
- Signed and unsigned boundary results match the approved design.
- Divide by zero completes immediately with quotient all ones and the original dividend as remainder.
- A `start` pulse received during an active operation does not alter the active result.
- `done` is a one-cycle pulse and outputs remain stable after completion.
