`timescale 1ns/1ps

module apb_timer_tb;

    localparam ADDR_CTRL       = 32'h00;
    localparam ADDR_IRQ_STATUS = 32'h04;
    localparam ADDR_IRQ_ENABLE = 32'h08;
    localparam ADDR_T0_CONFIG  = 32'h0c;
    localparam ADDR_T0_COUNT   = 32'h10;
    localparam ADDR_T0_MAX     = 32'h14;
    localparam ADDR_T0_COMPARE = 32'h18;
    localparam ADDR_T1_CONFIG  = 32'h1c;
    localparam ADDR_T1_COUNT   = 32'h20;
    localparam ADDR_T1_MAX     = 32'h24;
    localparam ADDR_T1_COMPARE = 32'h28;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         s_apb_psel = 1'b0;
    reg         s_apb_penable = 1'b0;
    reg         s_apb_pwrite = 1'b0;
    reg  [31:0] s_apb_paddr = 32'd0;
    reg  [31:0] s_apb_pwdata = 32'd0;
    wire        s_apb_pready;
    wire        s_apb_pslverr;
    wire [31:0] s_apb_prdata;
    wire        interrupt;
    wire        pwm0;
    wire        pwm1;

    integer errors = 0;
    integer interval_cycles;
    reg [31:0] read_data;
    reg [31:0] held_count;

    always #(5) clk = ~clk;

    apb_timer apb_timer_inst (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (s_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s_apb_pready),
        .s_apb_pslverr (s_apb_pslverr),
        .s_apb_prdata  (s_apb_prdata),
        .interrupt     (interrupt),
        .pwm0          (pwm0),
        .pwm1          (pwm1)
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

    task check_nonzero;
        input [255:0] name;
        input [31:0] actual;
        begin
            if ((actual === 32'd0) || (^actual === 1'bx)) begin
                $display("[FAIL] %0s actual=%h expected nonzero", name, actual);
                errors = errors + 1;
            end else begin
                $display("[PASS] %0s value=%h", name, actual);
            end
        end
    endtask

    task apb_write;
        input [31:0] addr;
        input [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= addr;
            s_apb_pwdata <= data;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            while (!s_apb_pready)
                @(negedge clk);
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
        end
    endtask

    task apb_read;
        input  [31:0] addr;
        output [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= addr;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            while (!s_apb_pready)
                @(negedge clk);
            data = s_apb_prdata;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
        end
    endtask

    task expect_register;
        input [255:0] name;
        input [31:0] addr;
        input [31:0] expected;
        begin
            apb_read(addr, read_data);
            check_equal(name, read_data, expected);
        end
    endtask

    task wait_cycles;
        input [31:0] cycles;
        integer index;
        begin
            for (index = 0; index < cycles; index = index + 1)
                @(negedge clk);
        end
    endtask

    task measure_timer1_overflow_interval;
        integer search_cycles;
        begin
            search_cycles = 0;
            while ((apb_timer_inst.timer1_overflow !== 1'b1) &&
                   (search_cycles < 32)) begin
                @(posedge clk);
                #1;
                search_cycles = search_cycles + 1;
            end
            interval_cycles = 0;
            begin : wait_second_timer1_overflow
                while (interval_cycles < 32) begin
                    @(posedge clk);
                    #1;
                    interval_cycles = interval_cycles + 1;
                    if (apb_timer_inst.timer1_overflow === 1'b1)
                        disable wait_second_timer1_overflow;
                end
            end
            check_equal("cascade overflow interval", interval_cycles, 32'd8);
        end
    endtask

    initial begin
        // $dumpfile("apb_timer_tb.vcd");
        // $dumpvars(0, apb_timer_tb);

        repeat (2) @(posedge clk);
        @(negedge clk);
        rst_n <= 1'b1;
        s_apb_psel <= 1'b1;
        s_apb_penable <= 1'b0;
        s_apb_pwrite <= 1'b0;
        s_apb_paddr <= ADDR_CTRL;
        #1;
        check_equal("PREADY low in setup", s_apb_pready, 32'd0);
        @(negedge clk);
        s_apb_penable <= 1'b1;
        #1;
        check_equal("PREADY high in access", s_apb_pready, 32'd1);
        check_equal("CTRL reset first read", s_apb_prdata, 32'd0);
        check_equal("PSLVERR low", s_apb_pslverr, 32'd0);
        @(negedge clk);
        s_apb_psel <= 1'b0;
        s_apb_penable <= 1'b0;
        #1;
        check_equal("PREADY low after completion", s_apb_pready, 32'd0);

        expect_register("CTRL reset", ADDR_CTRL, 32'd0);
        expect_register("IRQ_STATUS reset", ADDR_IRQ_STATUS, 32'd0);
        expect_register("IRQ_ENABLE reset", ADDR_IRQ_ENABLE, 32'd0);
        expect_register("T0_CONFIG reset", ADDR_T0_CONFIG, 32'd0);
        expect_register("T0_COUNT reset", ADDR_T0_COUNT, 32'd0);
        expect_register("T0_MAX reset", ADDR_T0_MAX, 32'hffff_ffff);
        expect_register("T0_COMPARE reset", ADDR_T0_COMPARE, 32'd0);
        expect_register("T1_CONFIG reset", ADDR_T1_CONFIG, 32'd0);
        expect_register("T1_COUNT reset", ADDR_T1_COUNT, 32'd0);
        expect_register("T1_MAX reset", ADDR_T1_MAX, 32'hffff_ffff);
        expect_register("T1_COMPARE reset", ADDR_T1_COMPARE, 32'd0);
        check_equal("PWM0 reset", pwm0, 32'd0);
        check_equal("PWM1 reset", pwm1, 32'd0);
        check_equal("interrupt reset", interrupt, 32'd0);

        apb_write(ADDR_T0_CONFIG, 32'hffff_fffe);
        expect_register("T0_CONFIG write mask", ADDR_T0_CONFIG, 32'h0000_000e);
        apb_write(ADDR_T0_CONFIG, 32'd0);
        apb_write(ADDR_IRQ_ENABLE, 32'hffff_ffff);
        expect_register("IRQ_ENABLE write mask", ADDR_IRQ_ENABLE, 32'h0000_0007);
        apb_write(ADDR_IRQ_ENABLE, 32'd0);
        apb_write(ADDR_CTRL, 32'h0000_7f03);
        expect_register("CTRL stored mask", ADDR_CTRL, 32'h0000_0003);
        apb_write(ADDR_CTRL, 32'd0);
        expect_register("undefined read zero", 32'h0000_0080, 32'd0);

        // Timer 0 counts while timer 1 remains stopped.
        apb_write(ADDR_CTRL, 32'h0000_0300);
        apb_write(ADDR_CTRL, 32'h0000_0001);
        wait_cycles(4);
        apb_write(ADDR_CTRL, 32'd0);
        apb_read(ADDR_T0_COUNT, read_data);
        check_nonzero("timer 0 independent count", read_data);
        held_count = read_data;
        expect_register("timer 1 stopped", ADDR_T1_COUNT, 32'd0);
        wait_cycles(4);
        expect_register("disabled timer 0 holds", ADDR_T0_COUNT, held_count);

        // Clear both, then run only timer 1.
        apb_write(ADDR_CTRL, 32'h0000_0300);
        apb_write(ADDR_CTRL, 32'h0000_0002);
        wait_cycles(4);
        apb_write(ADDR_CTRL, 32'd0);
        expect_register("timer 0 remains cleared", ADDR_T0_COUNT, 32'd0);
        apb_read(ADDR_T1_COUNT, read_data);
        check_nonzero("timer 1 independent count", read_data);

        // Timer 0 cascaded from timer 1 is a legal direction.
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_T0_CONFIG, 32'h0000_0001);
        apb_write(ADDR_T0_MAX, 32'd0);
        apb_write(ADDR_T1_MAX, 32'd1);
        apb_write(ADDR_CTRL, 32'h0000_0300);
        apb_write(ADDR_CTRL, 32'h0000_0003);
        wait_cycles(8);
        apb_write(ADDR_CTRL, 32'd0);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("timer 0 cascade from timer 1", read_data & 32'h1,
                    32'h1);

        // Timer 1 cascaded from timer 0: MAX=3 followed by MAX=1 gives one
        // timer 1 overflow every eight PCLK cycles in steady state.
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_T1_CONFIG, 32'h0000_0001);
        apb_write(ADDR_T0_MAX, 32'd3);
        apb_write(ADDR_T1_MAX, 32'd1);
        apb_write(ADDR_CTRL, 32'h0000_0300);
        apb_write(ADDR_CTRL, 32'h0000_0003);
        measure_timer1_overflow_interval;
        apb_write(ADDR_CTRL, 32'd0);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("timer 1 cascade pending", read_data & 32'h2, 32'h2);

        // A mutual cascade request is rejected and reports a config error.
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_T0_CONFIG, 32'h0000_0001);
        apb_write(ADDR_T1_CONFIG, 32'h0000_0001);
        expect_register("accepted first cascade source", ADDR_T0_CONFIG,
                        32'h0000_0001);
        expect_register("rejected mutual cascade", ADDR_T1_CONFIG, 32'd0);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("mutual cascade error pending", read_data & 32'h4,
                    32'h4);
        apb_write(ADDR_IRQ_STATUS, 32'h4);
        apb_write(ADDR_T0_CONFIG, 32'd0);
        apb_write(ADDR_T1_CONFIG, 32'h1);
        expect_register("opposite cascade accepted", ADDR_T1_CONFIG,
                        32'h1);

        // Protected registers retain their values while a channel runs.
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_T0_CONFIG, 32'h2);
        apb_write(ADDR_T0_MAX, 32'd10);
        apb_write(ADDR_T0_COMPARE, 32'd3);
        apb_write(ADDR_T1_MAX, 32'd20);
        apb_write(ADDR_CTRL, 32'h0000_0003);
        apb_write(ADDR_T0_CONFIG, 32'h6);
        apb_write(ADDR_T0_MAX, 32'd99);
        apb_write(ADDR_T0_COMPARE, 32'd88);
        apb_write(ADDR_T1_MAX, 32'd77);
        apb_write(ADDR_CTRL, 32'd0);
        expect_register("running T0 CONFIG rejected", ADDR_T0_CONFIG, 32'h2);
        expect_register("running T0 MAX rejected", ADDR_T0_MAX, 32'd10);
        expect_register("running T0 COMPARE rejected", ADDR_T0_COMPARE,
                        32'd3);
        expect_register("running T1 MAX rejected", ADDR_T1_MAX, 32'd20);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("running write error pending", read_data & 32'h4,
                    32'h4);

        // MAX=0 generates pending while masked. Repeated overflow wins over a
        // simultaneous W1C, and clear wins over the eligible count tick.
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_T0_MAX, 32'd0);
        apb_write(ADDR_CTRL, 32'h0000_0100);
        apb_write(ADDR_CTRL, 32'h0000_0001);
        wait_cycles(3);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("masked overflow pending", read_data & 32'h1, 32'h1);
        check_equal("masked overflow no interrupt", interrupt, 32'd0);
        apb_write(ADDR_IRQ_ENABLE, 32'h1);
        check_equal("enable pending overflow IRQ", interrupt, 32'd1);
        apb_write(ADDR_IRQ_STATUS, 32'h1);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("overflow set wins W1C", read_data & 32'h1, 32'h1);
        apb_write(ADDR_CTRL, 32'h0000_0100);
        expect_register("clear wins count tick", ADDR_T0_COUNT, 32'd0);
        apb_write(ADDR_IRQ_STATUS, 32'h1);
        expect_register("stopped overflow W1C clears", ADDR_IRQ_STATUS,
                        32'd0);

        // Timer 0 normal PWM and polarity behavior.
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_T0_CONFIG, 32'h2);
        apb_write(ADDR_T0_MAX, 32'd3);
        apb_write(ADDR_T0_COMPARE, 32'd2);
        apb_write(ADDR_CTRL, 32'h0000_0100);
        check_equal("PWM0 disabled inactive", pwm0, 32'd0);
        apb_write(ADDR_CTRL, 32'h1);
        #1;
        check_equal("PWM0 normal active at zero", pwm0, 32'd1);
        wait_cycles(2);
        check_equal("PWM0 normal inactive at compare", pwm0, 32'd0);
        apb_write(ADDR_CTRL, 32'h0000_0100);
        check_equal("PWM0 disabled after clear", pwm0, 32'd0);
        apb_write(ADDR_T0_CONFIG, 32'ha);
        check_equal("PWM0 active-low disabled level", pwm0, 32'd1);
        apb_write(ADDR_CTRL, 32'h1);
        #1;
        check_equal("PWM0 active-low active level", pwm0, 32'd0);
        apb_write(ADDR_CTRL, 32'd0);
        check_equal("PWM0 active-low stopped level", pwm0, 32'd1);

        // Timer 1 forced PWM modes and disabled behavior.
        apb_write(ADDR_T1_CONFIG, 32'h4);
        apb_write(ADDR_CTRL, 32'h2);
        check_equal("PWM1 forced inactive", pwm1, 32'd0);
        apb_write(ADDR_CTRL, 32'd0);
        apb_write(ADDR_T1_CONFIG, 32'h6);
        apb_write(ADDR_CTRL, 32'h2);
        check_equal("PWM1 forced active", pwm1, 32'd1);
        apb_write(ADDR_CTRL, 32'd0);
        check_equal("PWM1 disabled inactive", pwm1, 32'd0);

        apb_write(32'h0000_0080, 32'hffff_ffff);
        expect_register("undefined write ignored", ADDR_T1_CONFIG, 32'h6);

        apb_write(ADDR_IRQ_ENABLE, 32'h7);
        apb_write(ADDR_CTRL, 32'h8000_0000);
        expect_register("soft reset CTRL", ADDR_CTRL, 32'd0);
        expect_register("soft reset IRQ status", ADDR_IRQ_STATUS, 32'd0);
        expect_register("soft reset IRQ enable", ADDR_IRQ_ENABLE, 32'd0);
        expect_register("soft reset T0 config", ADDR_T0_CONFIG, 32'd0);
        expect_register("soft reset T0 count", ADDR_T0_COUNT, 32'd0);
        expect_register("soft reset T0 max", ADDR_T0_MAX, 32'hffff_ffff);
        expect_register("soft reset T0 compare", ADDR_T0_COMPARE, 32'd0);
        expect_register("soft reset T1 config", ADDR_T1_CONFIG, 32'd0);
        expect_register("soft reset T1 count", ADDR_T1_COUNT, 32'd0);
        expect_register("soft reset T1 max", ADDR_T1_MAX, 32'hffff_ffff);
        expect_register("soft reset T1 compare", ADDR_T1_COMPARE, 32'd0);
        check_equal("soft reset PWM0", pwm0, 32'd0);
        check_equal("soft reset PWM1", pwm1, 32'd0);
        check_equal("soft reset interrupt", interrupt, 32'd0);

        if (errors == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL errors=%0d", errors);
        $finish;
    end

    initial #(200000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

endmodule
