`timescale 1ns / 1ps
//================================================================================
//  Module      : tinyc_gpio_tb
//  Description : Tiny C firmware integration test for MERC32 and APB GPIO
//================================================================================

module tinyc_gpio_tb();

    localparam CLK_PERIOD         = 20;
    localparam RESET_CYCLES       = 20;
    localparam MAX_CYCLES         = 300_000;
    localparam MEMORY_WORDS       = 65_536;
    localparam [15:0] STATUS_ADDR = 16'd240;
    localparam [15:0] DETAIL_ADDR = 16'd241;
    localparam [31:0] PASS_CODE   = 32'h0000_600d;
    localparam [31:0] FAIL_CODE   = 32'h0000_0bad;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg  [31:0] gpio_i = 32'd0;

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

    wire [31:0] gpio_o;
    wire [31:0] gpio_t;
    wire        gpio_interrupt;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;

    integer i;
    integer rom_words = 0;
    integer cycle_count = 0;
    integer gpio_error_count = 0;
    integer irq_rise_count = 0;
    reg [31:0] detail_value = 32'd0;
    reg     gpio_checks_done = 1'b0;
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
        .interrupt      (gpio_interrupt),
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

    apb_gpio apb_gpio_inst (
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
        .gpio_i         (gpio_i),
        .gpio_o         (gpio_o),
        .gpio_t         (gpio_t),
        .interrupt      (gpio_interrupt));

    task check_gpio;
        input [8*40-1:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("TEST FAIL: %0s expected=%08h actual=%08h",
                         name, expected, actual);
                gpio_error_count = gpio_error_count + 1;
            end
        end
    endtask

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*RESET_CYCLES) rst_n = 1'b1;

    always @(posedge gpio_interrupt)
        irq_rise_count = irq_rise_count + 1;

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

    initial begin : gpio_stimulus
        wait (rst_n);

        wait (detail_value == 32'h0000_2001);
        check_gpio("GPIO direction", gpio_t, 32'hffff_fff0);
        check_gpio("GPIO direct write", gpio_o, 32'h0000_0005);

        wait (detail_value == 32'h0000_2002);
        check_gpio("GPIO atomic set", gpio_o, 32'h0000_0007);

        wait (detail_value == 32'h0000_2003);
        check_gpio("GPIO atomic clear", gpio_o, 32'h0000_0006);

        wait (detail_value == 32'h0000_2004);
        check_gpio("GPIO atomic toggle", gpio_o, 32'h0000_0009);

        wait (detail_value == 32'h0000_2100);
        gpio_i <= 32'h0000_00a0;

        wait (detail_value == 32'h0000_2101);
        gpio_i <= 32'd0;

        wait (detail_value == 32'h0000_2102);
        gpio_i <= 32'h0000_0010;

        wait (detail_value == 32'h0000_2103);
        repeat (4) @(posedge clk);
        if (gpio_interrupt !== 1'b0) begin
            $display("TEST FAIL: GPIO interrupt did not clear");
            gpio_error_count = gpio_error_count + 1;
        end
        if (irq_rise_count != 1) begin
            $display("TEST FAIL: GPIO IRQ rises expected=1 actual=%0d",
                     irq_rise_count);
            gpio_error_count = gpio_error_count + 1;
        end
        gpio_checks_done = 1'b1;
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
                $finish;
            end else if ((firmware_pass_seen || firmware_pass_write) &&
                         gpio_checks_done) begin
                done <= 1'b1;
                if (gpio_error_count == 0)
                    $display("TEST PASS");
                else
                    $display("TEST FAIL: GPIO errors=%0d", gpio_error_count);
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
    //     $dumpfile("tinyc_gpio_tb.vcd");
    //     $dumpvars(0, tinyc_gpio_tb);
    // end

endmodule
