`timescale 1ns/1ps

module div_tb;

    localparam  HALF_PERIOD = 5;
    localparam  TIMEOUT     = 12000;

    reg         clk         = 1'b0;
    reg         rst_n       = 1'b0;
    reg         start       = 1'b0;
    reg         signed_mode = 1'b0;
    reg  [31:0] dividend    = 32'd0;
    reg  [31:0] divisor     = 32'd0;
    wire        done;
    wire [31:0] quotient;
    wire [31:0] remainder;

    integer failures = 0;

    div div_inst (
        .clk                        (clk            ),
        .rst_n                      (rst_n          ),
        .start                      (start          ),
        .signed_mode                (signed_mode    ),
        .dividend                   (dividend       ),
        .divisor                    (divisor        ),
        .done                       (done           ),
        .quotient                   (quotient       ),
        .remainder                  (remainder      )
    );

    always #(HALF_PERIOD) clk = ~clk;

    initial #(HALF_PERIOD * 6) rst_n = 1'b1;

    // initial begin
    //     $dumpfile("div_tb.vcd");
    //     $dumpvars(0, div_tb);
    // end

    initial #(TIMEOUT) begin
        $display("FAIL: div_tb timeout");
        $finish_and_return(1);
    end

    task check_div;
        input        test_signed;
        input [31:0] test_dividend;
        input [31:0] test_divisor;
        input [31:0] expected_quotient;
        input [31:0] expected_remainder;
        integer cycles;
        reg signed [63:0] wide_dividend;
        reg signed [63:0] wide_divisor;
        reg signed [63:0] wide_quotient;
        reg signed [63:0] wide_remainder;
        begin
            @(negedge clk);
            signed_mode <= test_signed;
            dividend    <= test_dividend;
            divisor     <= test_divisor;
            start       <= 1'b1;

            @(posedge clk);
            #1 start <= 1'b0;

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

                if (test_divisor != 32'd0
                    && !(test_signed
                         && test_dividend == 32'h8000_0000
                         && test_divisor == 32'hffff_ffff)) begin
                    wide_dividend  = test_signed
                                   ? {{32{test_dividend[31]}}, test_dividend}
                                   : {32'd0, test_dividend};
                    wide_divisor   = test_signed
                                   ? {{32{test_divisor[31]}}, test_divisor}
                                   : {32'd0, test_divisor};
                    wide_quotient  = test_signed
                                   ? {{32{quotient[31]}}, quotient}
                                   : {32'd0, quotient};
                    wide_remainder = test_signed
                                   ? {{32{remainder[31]}}, remainder}
                                   : {32'd0, remainder};

                    if (wide_dividend
                        != wide_quotient * wide_divisor + wide_remainder) begin
                        $display("FAIL div identity: signed=%0d dividend=%h divisor=%h q=%h r=%h",
                                 test_signed, test_dividend, test_divisor,
                                 quotient, remainder);
                        failures = failures + 1;
                    end
                end
            end

            @(posedge clk);
            #1;
            if (done) begin
                $display("FAIL div done remained high for more than one cycle");
                failures = failures + 1;
            end
            if (quotient !== expected_quotient
                || remainder !== expected_remainder) begin
                $display("FAIL div outputs did not remain stable after completion");
                failures = failures + 1;
            end
        end
    endtask

    task check_ignored_start;
        integer cycles;
        begin
            @(negedge clk);
            signed_mode <= 1'b0;
            dividend    <= 32'd1000;
            divisor     <= 32'd7;
            start       <= 1'b1;
            @(posedge clk);
            #1 start <= 1'b0;

            repeat (5) @(posedge clk);
            @(negedge clk);
            dividend <= 32'd9;
            divisor  <= 32'd2;
            start    <= 1'b1;
            @(posedge clk);
            #1 start <= 1'b0;

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
        wait (rst_n);
        #1;

        if (done !== 1'b0 || quotient !== 32'd0 || remainder !== 32'd0) begin
            $display("FAIL div reset outputs: done=%b q=%h r=%h",
                     done, quotient, remainder);
            failures = failures + 1;
        end

        check_div(1'b0, 32'd0,         32'd1,         32'd0,         32'd0);
        check_div(1'b0, 32'd3,         32'd7,         32'd0,         32'd3);
        check_div(1'b0, 32'd100,       32'd7,         32'd14,        32'd2);
        check_div(1'b0, 32'h1234_5678, 32'h0000_1234, 32'h0001_0004, 32'h0000_0da8);
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
