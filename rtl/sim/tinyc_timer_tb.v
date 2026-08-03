`timescale 1ns / 1ps
//================================================================================
//  Module      : tinyc_timer_tb
//  Description : Tiny C black-box integration test for MERC32 and APB timer
//================================================================================

module tinyc_timer_tb();

    localparam CLK_PERIOD         = 20;
    localparam RESET_CYCLES       = 20;
    localparam MAX_CYCLES         = 200_000;
    localparam MEMORY_WORDS       = 65_536;
    localparam [15:0] STATUS_ADDR = 16'd240;
    localparam [15:0] DETAIL_ADDR = 16'd241;
    localparam [31:0] PASS_CODE   = 32'h0000_600d;
    localparam [31:0] FAIL_CODE   = 32'h0000_0bad;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;

    wire        ilb_en;
    wire        ilb_we;
    wire [15:0] ilb_addr;
    wire [31:0] ilb_wdata;
    wire [31:0] ilb_rdata;

    wire        dlb_en;
    wire        dlb_we;
    wire [15:0] dlb_addr;
    wire [31:0] dlb_wdata;
    reg  [31:0] dlb_rdata = 32'd0;

    wire        apb_psel;
    wire        apb_penable;
    wire [31:0] apb_paddr;
    wire        apb_pwrite;
    wire [31:0] apb_pwdata;
    wire [31:0] apb_prdata;
    wire        apb_pready;
    wire        apb_pslverr;

    wire        timer_interrupt;
    wire        pwm0;
    wire        pwm1;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;

    integer i;
    integer rom_words = 0;
    integer cycle_count = 0;
    integer pwm_cycle_count = 0;
    integer last_pwm_rise = -1;
    integer pwm_period_checks = 0;
    integer pwm_width_checks = 0;
    integer irq_rise_count = 0;
    integer timer_error_count = 0;
    integer pwm_checks_before_stop = 0;
    reg [31:0] detail_value = 32'd0;
    reg     pwm_measure_enable = 1'b0;
    reg     timer_checks_done = 1'b0;
    reg     firmware_pass_seen = 1'b0;
    reg     done = 1'b0;

    wire firmware_pass_write = dlb_en && dlb_we &&
                               (dlb_addr == STATUS_ADDR) &&
                               (dlb_wdata == PASS_CODE);
    wire firmware_fail_write = dlb_en && dlb_we &&
                               (dlb_addr == STATUS_ADDR) &&
                               (dlb_wdata == FAIL_CODE);

    assign ilb_rdata = program_rom[ilb_addr];

    MERC32_top #(
        .ILB_ADDR_WIDTH (16),
        .DLB_ADDR_WIDTH (16))
    MERC32_top_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        .interrupt      (timer_interrupt),
        .tck            (1'b0),
        .tms            (1'b1),
        .tdi            (1'b0),
        .tdo            (),

        .dlb_en         (dlb_en),
        .dlb_we         (dlb_we),
        .dlb_addr       (dlb_addr),
        .dlb_wdata      (dlb_wdata),
        .dlb_rdata      (dlb_rdata),

        .ilb_en         (ilb_en),
        .ilb_we         (ilb_we),
        .ilb_addr       (ilb_addr),
        .ilb_wdata      (ilb_wdata),
        .ilb_rdata      (ilb_rdata),

        .m_apb_psel     (apb_psel),
        .m_apb_penable  (apb_penable),
        .m_apb_paddr    (apb_paddr),
        .m_apb_pwrite   (apb_pwrite),
        .m_apb_pwdata   (apb_pwdata),
        .m_apb_prdata   (apb_prdata),
        .m_apb_pready   (apb_pready));

    apb_timer apb_timer_inst (
        .s_apb_pclk     (clk),
        .s_apb_presetn  (rst_n),
        .s_apb_psel     (apb_psel),
        .s_apb_penable  (apb_penable),
        .s_apb_pwrite   (apb_pwrite),
        .s_apb_paddr    (apb_paddr),
        .s_apb_pwdata   (apb_pwdata),
        .s_apb_pready   (apb_pready),
        .s_apb_pslverr  (apb_pslverr),
        .s_apb_prdata   (apb_prdata),
        .interrupt      (timer_interrupt),
        .pwm0           (pwm0),
        .pwm1           (pwm1));

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*RESET_CYCLES) rst_n = 1'b1;

    always @(posedge timer_interrupt)
        irq_rise_count = irq_rise_count + 1;

    always @(posedge clk) begin
        if (!rst_n)
            pwm_cycle_count <= 0;
        else
            pwm_cycle_count <= pwm_cycle_count + 1;
    end

    always @(posedge pwm1) begin
        if (pwm_measure_enable) begin
            if (last_pwm_rise >= 0) begin
                if ((pwm_cycle_count - last_pwm_rise) != 32) begin
                    $display("TEST FAIL: PWM period expected=32 actual=%0d",
                             pwm_cycle_count - last_pwm_rise);
                    timer_error_count = timer_error_count + 1;
                end
                pwm_period_checks = pwm_period_checks + 1;
            end
            last_pwm_rise = pwm_cycle_count;
        end
    end

    always @(negedge pwm1) begin
        if (pwm_measure_enable && (last_pwm_rise >= 0)) begin
            if ((pwm_cycle_count - last_pwm_rise) != 8) begin
                $display("TEST FAIL: PWM width expected=8 actual=%0d",
                         pwm_cycle_count - last_pwm_rise);
                timer_error_count = timer_error_count + 1;
            end
            pwm_width_checks = pwm_width_checks + 1;
        end
    end

    initial begin
        for (i = 0; i < MEMORY_WORDS; i = i + 1) begin
            program_rom[i] = 32'd0;
            dlb_ram[i] = 32'd0;
        end

        if (!$value$plusargs("ROM_FILE=%s", rom_file)) begin
            $display("TEST FAIL: missing +ROM_FILE");
            $finish;
        end
        if (!$value$plusargs("ROM_WORDS=%d", rom_words) ||
            (rom_words <= 0) || (rom_words > MEMORY_WORDS)) begin
            $display("TEST FAIL: invalid +ROM_WORDS");
            $finish;
        end

        $readmemh(rom_file, program_rom, 0, rom_words - 1);
    end

    initial begin : timer_monitor
        wait (rst_n);
        wait (detail_value == 32'h0000_3001);
        pwm_measure_enable = 1'b1;

        wait (detail_value == 32'h0000_3002);
        repeat (4) @(posedge clk);
        if (timer_interrupt !== 1'b0) begin
            $display("TEST FAIL: Timer interrupt did not clear");
            timer_error_count = timer_error_count + 1;
        end
        if (irq_rise_count < 3) begin
            $display("TEST FAIL: Timer IRQ rises expected>=3 actual=%0d",
                     irq_rise_count);
            timer_error_count = timer_error_count + 1;
        end
        if (pwm_period_checks < 2) begin
            $display("TEST FAIL: PWM period checks expected>=2 actual=%0d",
                     pwm_period_checks);
            timer_error_count = timer_error_count + 1;
        end
        if (pwm_width_checks < 2) begin
            $display("TEST FAIL: PWM width checks expected>=2 actual=%0d",
                     pwm_width_checks);
            timer_error_count = timer_error_count + 1;
        end

        pwm_checks_before_stop = pwm_period_checks;
        repeat (64) @(posedge clk);
        if (pwm_period_checks <= pwm_checks_before_stop) begin
            $display("TEST FAIL: Timer 1 PWM stopped with Timer 0");
            timer_error_count = timer_error_count + 1;
        end
        timer_checks_done = 1'b1;
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            dlb_rdata <= 32'd0;
            detail_value <= 32'd0;
        end else begin
            if (dlb_en && dlb_we) begin
                dlb_ram[dlb_addr] <= dlb_wdata;
                if (dlb_addr == DETAIL_ADDR)
                    detail_value <= dlb_wdata;
            end
            dlb_rdata <= dlb_en ? dlb_ram[dlb_addr] : dlb_rdata;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            cycle_count <= 0;
            firmware_pass_seen <= 1'b0;
            done <= 1'b0;
        end else if (!done) begin
            cycle_count <= cycle_count + 1;

            if (firmware_pass_write)
                firmware_pass_seen <= 1'b1;

            if (firmware_fail_write) begin
                done <= 1'b1;
                $display("TEST FAIL: firmware status=0x%08h detail=0x%08h",
                         dlb_wdata, detail_value);
                $display("Timer ports: irq=%0d pwm0=%0d pwm1=%0d irq_rises=%0d period_checks=%0d width_checks=%0d",
                         timer_interrupt, pwm0, pwm1, irq_rise_count,
                         pwm_period_checks, pwm_width_checks);
                $finish;
            end else if ((firmware_pass_seen || firmware_pass_write) &&
                         timer_checks_done) begin
                done <= 1'b1;
                if (timer_error_count == 0)
                    $display("TEST PASS");
                else
                    $display("TEST FAIL: Timer errors=%0d",
                             timer_error_count);
                $finish;
            end else if (cycle_count >= MAX_CYCLES) begin
                done <= 1'b1;
                $display("TEST TIMEOUT: pc=%0d status=0x%08h detail=0x%08h",
                         MERC32_top_inst.u_merc32_core.prog_addr,
                         dlb_ram[STATUS_ADDR], detail_value);
                $finish;
            end
        end
    end

    initial #(CLK_PERIOD*(MAX_CYCLES + RESET_CYCLES + 1000)) begin
        if (!done) begin
            $display("TEST TIMEOUT: testbench watchdog");
            $finish;
        end
    end

    // initial begin
    //     $dumpfile("tinyc_timer_tb.vcd");
    //     $dumpvars(0, tinyc_timer_tb);
    // end

endmodule
