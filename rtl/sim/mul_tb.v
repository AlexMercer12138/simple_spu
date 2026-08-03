`timescale 1ns/1ps

module mul_tb;

    localparam  HALF_PERIOD = 5;
    localparam  TIMEOUT     = 10000;

    reg         clk         = 1'b0;
    reg         rst_n       = 1'b0;
    reg         start       = 1'b0;
    reg         signed_mode = 1'b0;
    reg  [31:0] operand_a   = 32'd0;
    reg  [31:0] operand_b   = 32'd0;
    wire        done;
    wire [63:0] result;

    integer failures = 0;

    mul mul_inst (
        .clk                        (clk            ),
        .rst_n                      (rst_n          ),
        .start                      (start          ),
        .signed_mode                (signed_mode    ),
        .operand_a                  (operand_a      ),
        .operand_b                  (operand_b      ),
        .done                       (done           ),
        .result                     (result         )
    );

    always #(HALF_PERIOD) clk = ~clk;

    initial #(HALF_PERIOD * 6) rst_n = 1'b1;

    // initial begin
    //     $dumpfile("mul_tb.vcd");
    //     $dumpvars(0, mul_tb);
    // end

    initial #(TIMEOUT) begin
        $display("FAIL: mul_tb timeout");
        $finish_and_return(1);
    end

    task check_mul;
        input        test_signed;
        input [31:0] test_a;
        input [31:0] test_b;
        input [63:0] expected_result;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode <= test_signed;
            operand_a   <= test_a;
            operand_b   <= test_b;
            start       <= 1'b1;

            @(posedge clk);
            #1 start <= 1'b0;

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
            if (result !== expected_result) begin
                $display("FAIL mul result did not remain stable after completion");
                failures = failures + 1;
            end
        end
    endtask

    task check_ignored_start;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode <= 1'b0;
            operand_a   <= 32'd7;
            operand_b   <= 32'd9;
            start       <= 1'b1;
            @(posedge clk);
            #1 start <= 1'b0;

            repeat (5) @(posedge clk);
            @(negedge clk);
            operand_a <= 32'hffff_ffff;
            operand_b <= 32'hffff_ffff;
            start     <= 1'b1;
            @(posedge clk);
            #1 start <= 1'b0;

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
        wait (rst_n);
        #1;

        if (done !== 1'b0 || result !== 64'd0) begin
            $display("FAIL mul reset outputs: done=%b result=%h", done, result);
            failures = failures + 1;
        end

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
