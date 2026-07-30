`timescale 1ns/1ps

module timer_channel_tb;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         enable = 1'b0;
    reg         clear = 1'b0;
    reg         count_tick = 1'b0;
    reg  [31:0] count_max = 32'hffff_ffff;
    reg  [31:0] pwm_compare = 32'd0;
    reg  [1:0]  pwm_mode = 2'b00;
    reg         pwm_polarity = 1'b0;
    wire [31:0] count;
    wire        overflow;
    wire        pwm;

    integer errors = 0;

    always #(5) clk = ~clk;

    initial begin
        #(20);
        rst_n = 1'b1;
    end

    timer_channel timer_channel_inst (
        .clk          (clk),
        .rst_n        (rst_n),
        .enable       (enable),
        .clear        (clear),
        .count_tick   (count_tick),
        .count_max    (count_max),
        .pwm_compare  (pwm_compare),
        .pwm_mode     (pwm_mode),
        .pwm_polarity (pwm_polarity),
        .count        (count),
        .overflow     (overflow),
        .pwm          (pwm)
    );

    task check_equal;
        input [255:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s actual=%h expected=%h", name, actual, expected);
                errors = errors + 1;
            end else begin
                $display("[PASS] %0s value=%h", name, actual);
            end
        end
    endtask

    task tick_once;
        begin
            @(negedge clk);
            count_tick <= 1'b1;
            @(negedge clk);
            count_tick <= 1'b0;
        end
    endtask

    task clear_count;
        begin
            @(negedge clk);
            clear <= 1'b1;
            @(negedge clk);
            clear <= 1'b0;
        end
    endtask

    initial begin
        // $dumpfile("timer_channel_tb.vcd");
        // $dumpvars(0, timer_channel_tb);

        @(negedge rst_n);
    end

    initial begin
        wait (rst_n == 1'b1);
        @(negedge clk);

        count_max <= 32'd3;
        tick_once;
        check_equal("disabled hold", count, 32'd0);

        enable <= 1'b1;
        tick_once;
        check_equal("count 1", count, 32'd1);
        check_equal("overflow low at count 1", overflow, 32'd0);
        tick_once;
        check_equal("count 2", count, 32'd2);
        tick_once;
        check_equal("count 3", count, 32'd3);
        tick_once;
        check_equal("reload", count, 32'd0);
        check_equal("overflow asserted", overflow, 32'd1);
        @(negedge clk);
        check_equal("overflow clears", overflow, 32'd0);

        enable <= 1'b0;
        count_max <= 32'd0;
        clear_count;
        enable <= 1'b1;
        tick_once;
        check_equal("max zero count", count, 32'd0);
        check_equal("max zero overflow", overflow, 32'd1);

        count_max <= 32'd10;
        clear_count;
        tick_once;
        tick_once;
        check_equal("count before clear", count, 32'd2);
        @(negedge clk);
        count_tick <= 1'b1;
        clear <= 1'b1;
        @(negedge clk);
        count_tick <= 1'b0;
        clear <= 1'b0;
        check_equal("clear priority count", count, 32'd0);
        check_equal("clear priority overflow", overflow, 32'd0);

        count_max <= 32'd7;
        tick_once;
        tick_once;
        tick_once;
        check_equal("count before max shrink", count, 32'd3);
        enable <= 1'b0;
        count_max <= 32'd1;
        tick_once;
        check_equal("disabled over max hold", count, 32'd3);
        enable <= 1'b1;
        tick_once;
        check_equal("over max recovery count", count, 32'd0);
        check_equal("over max recovery overflow", overflow, 32'd1);

        enable <= 1'b0;
        pwm_mode <= 2'b01;
        pwm_polarity <= 1'b0;
        pwm_compare <= 32'd2;
        count_max <= 32'd3;
        clear_count;
        check_equal("normal PWM disabled", pwm, 32'd0);
        enable <= 1'b1;
        #1;
        check_equal("PWM active at count 0", pwm, 32'd1);
        tick_once;
        check_equal("PWM active at count 1", pwm, 32'd1);
        tick_once;
        check_equal("PWM inactive at count 2", pwm, 32'd0);
        tick_once;
        check_equal("PWM inactive at count 3", pwm, 32'd0);
        tick_once;
        check_equal("PWM active after reload", pwm, 32'd1);

        pwm_compare <= 32'd0;
        #1;
        check_equal("PWM zero duty", pwm, 32'd0);
        pwm_compare <= 32'd5;
        #1;
        check_equal("PWM compare above max", pwm, 32'd1);

        pwm_mode <= 2'b10;
        #1;
        check_equal("PWM forced inactive", pwm, 32'd0);
        pwm_mode <= 2'b11;
        #1;
        check_equal("PWM forced active", pwm, 32'd1);
        pwm_polarity <= 1'b1;
        #1;
        check_equal("PWM forced active low", pwm, 32'd0);
        pwm_mode <= 2'b10;
        #1;
        check_equal("PWM forced inactive high", pwm, 32'd1);
        enable <= 1'b0;
        pwm_mode <= 2'b11;
        #1;
        check_equal("PWM disabled active-low idle", pwm, 32'd1);

        if (errors == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL errors=%0d", errors);
        $finish;
    end

    initial #(20000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

endmodule
