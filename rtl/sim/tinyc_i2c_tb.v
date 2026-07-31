`timescale 1ns / 1ps
//================================================================================
//  Module      : tinyc_i2c_tb
//  Description : Tiny C firmware integration test for MERC32 and APB I2C
//================================================================================

module tinyc_i2c_tb();

    localparam CLK_PERIOD              = 20;
    localparam RESET_CYCLES            = 20;
    localparam MAX_CYCLES              = 300_000;
    localparam MEMORY_WORDS            = 65_536;
    localparam I2C_SYS_CLK_FREQ        = 1_000_000;
    localparam I2C_FIFO_DEPTH          = 16;
    localparam [15:0] STATUS_ADDR      = 16'd240;
    localparam [15:0] DETAIL_ADDR      = 16'd241;
    localparam [15:0] PEER_READY_ADDR  = 16'd242;
    localparam [31:0] PASS_CODE        = 32'h0000_600d;
    localparam [31:0] FAIL_CODE        = 32'h0000_0bad;

    localparam [31:0] ADDR_CTRL            = 32'h0000_0000;
    localparam [31:0] ADDR_TX_DATA         = 32'h0000_0010;
    localparam [31:0] ADDR_RX_DATA         = 32'h0000_0014;
    localparam [31:0] ADDR_FIFO_STATUS     = 32'h0000_0018;
    localparam [31:0] ADDR_SLAVE_CFG       = 32'h0000_001c;
    localparam [31:0] ADDR_STRETCH_TIMEOUT = 32'h0000_0020;
    localparam [31:0] ADDR_IRQ_STATUS      = 32'h0000_0024;

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

    wire        cpu_psel;
    wire        cpu_penable;
    wire [31:0] cpu_paddr;
    wire        cpu_pwrite;
    wire [31:0] cpu_pwdata;
    wire [31:0] cpu_prdata;
    wire        cpu_pready;
    wire        cpu_pslverr;

    reg         peer_psel = 1'b0;
    reg         peer_penable = 1'b0;
    reg         peer_pwrite = 1'b0;
    reg  [31:0] peer_paddr = 32'd0;
    reg  [31:0] peer_pwdata = 32'd0;
    wire [31:0] peer_prdata;
    wire        peer_pready;
    wire        peer_pslverr;

    wire        master_interrupt;
    wire        peer_interrupt;
    wire        master_scl_t;
    wire        master_sda_t;
    wire        peer_scl_t;
    wire        peer_sda_t;
    wire        shared_scl;
    wire        shared_sda;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;
    reg         previous_scl = 1'b1;
    reg         previous_sda = 1'b1;
    reg  [31:0] detail_value = 32'd0;

    integer i;
    integer rom_words = 0;
    integer cycle_count = 0;
    integer start_count = 0;
    integer stop_count = 0;
    integer i2c_error_count = 0;
    reg     bus_checks_done = 1'b0;
    reg     firmware_pass_seen = 1'b0;
    reg     done = 1'b0;
    reg  [31:0] peer_read_data = 32'd0;

    wire firmware_pass_write = dlb_en && dlb_we &&
                               (dlb_addr == STATUS_ADDR) &&
                               (dlb_wdata == PASS_CODE);
    wire firmware_fail_write = dlb_en && dlb_we &&
                               (dlb_addr == STATUS_ADDR) &&
                               (dlb_wdata == FAIL_CODE);

    assign ilb_rdata = program_rom[ilb_addr];
    assign shared_scl = master_scl_t && peer_scl_t;
    assign shared_sda = master_sda_t && peer_sda_t;

    MERC32_top #(
        .ILB_ADDR_WIDTH (16),
        .DLB_ADDR_WIDTH (16))
    MERC32_top_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        .interrupt      (master_interrupt),
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

        .m_apb_psel     (cpu_psel),
        .m_apb_penable  (cpu_penable),
        .m_apb_paddr    (cpu_paddr),
        .m_apb_pwrite   (cpu_pwrite),
        .m_apb_pwdata   (cpu_pwdata),
        .m_apb_prdata   (cpu_prdata),
        .m_apb_pready   (cpu_pready));

    apb_i2c #(
        .SYS_CLK_FREQ   (I2C_SYS_CLK_FREQ),
        .FIFO_DEPTH     (I2C_FIFO_DEPTH))
    master_i2c_inst (
        .s_apb_pclk     (clk),
        .s_apb_presetn  (rst_n),
        .s_apb_psel     (cpu_psel),
        .s_apb_penable  (cpu_penable),
        .s_apb_pwrite   (cpu_pwrite),
        .s_apb_paddr    (cpu_paddr),
        .s_apb_pwdata   (cpu_pwdata),
        .s_apb_pready   (cpu_pready),
        .s_apb_pslverr  (cpu_pslverr),
        .s_apb_prdata   (cpu_prdata),
        .interrupt      (master_interrupt),
        .scl_o          (),
        .scl_t          (master_scl_t),
        .scl_i          (shared_scl),
        .sda_o          (),
        .sda_t          (master_sda_t),
        .sda_i          (shared_sda));

    apb_i2c #(
        .SYS_CLK_FREQ   (I2C_SYS_CLK_FREQ),
        .FIFO_DEPTH     (I2C_FIFO_DEPTH))
    peer_i2c_inst (
        .s_apb_pclk     (clk),
        .s_apb_presetn  (rst_n),
        .s_apb_psel     (peer_psel),
        .s_apb_penable  (peer_penable),
        .s_apb_pwrite   (peer_pwrite),
        .s_apb_paddr    (peer_paddr),
        .s_apb_pwdata   (peer_pwdata),
        .s_apb_pready   (peer_pready),
        .s_apb_pslverr  (peer_pslverr),
        .s_apb_prdata   (peer_prdata),
        .interrupt      (peer_interrupt),
        .scl_o          (),
        .scl_t          (peer_scl_t),
        .scl_i          (shared_scl),
        .sda_o          (),
        .sda_t          (peer_sda_t),
        .sda_i          (shared_sda));

    task peer_apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(negedge clk);
            peer_psel <= 1'b1;
            peer_penable <= 1'b0;
            peer_pwrite <= 1'b1;
            peer_paddr <= address;
            peer_pwdata <= data;
            @(posedge clk);
            #1;
            @(negedge clk);
            peer_penable <= 1'b1;
            @(posedge clk);
            #1;
            @(negedge clk);
            peer_psel <= 1'b0;
            peer_penable <= 1'b0;
            peer_pwrite <= 1'b0;
            peer_paddr <= 32'd0;
            peer_pwdata <= 32'd0;
        end
    endtask

    task peer_apb_read;
        input [31:0] address;
        output [31:0] data;
        begin
            @(negedge clk);
            peer_psel <= 1'b1;
            peer_penable <= 1'b0;
            peer_pwrite <= 1'b0;
            peer_paddr <= address;
            @(posedge clk);
            #1;
            @(negedge clk);
            peer_penable <= 1'b1;
            @(posedge clk);
            #1;
            data = peer_prdata;
            @(negedge clk);
            peer_psel <= 1'b0;
            peer_penable <= 1'b0;
            peer_paddr <= 32'd0;
        end
    endtask

    task check_value;
        input [8*40-1:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("TEST FAIL: %0s expected=%08h actual=%08h",
                         name, expected, actual);
                i2c_error_count = i2c_error_count + 1;
            end
        end
    endtask

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*RESET_CYCLES) rst_n = 1'b1;

    always @(posedge clk) begin
        if (!rst_n) begin
            previous_scl <= 1'b1;
            previous_sda <= 1'b1;
        end else begin
            if (previous_sda && !shared_sda && shared_scl)
                start_count <= start_count + 1;
            if (!previous_sda && shared_sda && shared_scl)
                stop_count <= stop_count + 1;
            previous_scl <= shared_scl;
            previous_sda <= shared_sda;
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

    initial begin : peer_setup
        wait (rst_n);
        peer_apb_write(ADDR_CTRL, 32'h8000_0000);
        peer_apb_write(ADDR_CTRL, 32'h0000_0000);
        peer_apb_write(ADDR_SLAVE_CFG, 32'h0000_0052);
        peer_apb_write(ADDR_STRETCH_TIMEOUT, 32'd5000);
        peer_apb_write(ADDR_IRQ_STATUS, 32'h0000_3fff);
        peer_apb_write(ADDR_TX_DATA, 32'h0000_003c);
        peer_apb_write(ADDR_TX_DATA, 32'h0000_00c3);
        peer_apb_write(ADDR_TX_DATA, 32'h0000_00de);
        peer_apb_write(ADDR_TX_DATA, 32'h0000_00ad);
        peer_apb_write(ADDR_CTRL, 32'h0000_0001);
        dlb_ram[PEER_READY_ADDR] = 32'h0000_0001;
    end

    initial begin : bus_verification
        wait (detail_value == 32'h0000_4001);

        peer_apb_read(ADDR_FIFO_STATUS, peer_read_data);
        check_value("peer RX level", {24'd0, peer_read_data[15:8]},
                    32'd3);
        peer_apb_read(ADDR_RX_DATA, peer_read_data);
        peer_apb_read(ADDR_RX_DATA, peer_read_data);
        check_value("peer RX byte 0", {24'd0, peer_read_data[7:0]},
                    32'h0000_00a5);
        peer_apb_read(ADDR_RX_DATA, peer_read_data);
        check_value("peer RX byte 1", {24'd0, peer_read_data[7:0]},
                    32'h0000_005a);
        peer_apb_read(ADDR_RX_DATA, peer_read_data);
        check_value("peer RX byte 2", {24'd0, peer_read_data[7:0]},
                    32'h0000_0010);

        peer_apb_read(ADDR_IRQ_STATUS, peer_read_data);
        check_value("peer error status", peer_read_data & 32'h0000_3c20,
                    32'd0);
        check_value("I2C START count", start_count, 32'd5);
        check_value("I2C STOP count", stop_count, 32'd4);
        check_value("I2C lines released", {30'd0, shared_scl, shared_sda},
                    32'd3);
        bus_checks_done = 1'b1;
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
                $display("TEST FAIL: firmware status=0x%08h detail=0x%08h i2c_status=0x%08h",
                         dlb_wdata, detail_value,
                         master_i2c_inst.irq_status_reg);
                $display("I2C DEBUG: peer_enable=%0d peer_addr=0x%02h peer_state=%0d peer_bits=%0d filtered_scl=%0d filtered_sda=%0d starts=%0d stops=%0d",
                         peer_i2c_inst.enable_reg,
                         peer_i2c_inst.slave_addr_reg,
                         peer_i2c_inst.i2c_slave_inst.state,
                         peer_i2c_inst.i2c_slave_inst.bit_count,
                         peer_i2c_inst.i2c_slave_inst.scl_filtered,
                         peer_i2c_inst.i2c_slave_inst.sda_filtered,
                         start_count, stop_count);
                $finish;
            end else if ((firmware_pass_seen || firmware_pass_write) &&
                         bus_checks_done) begin
                done <= 1'b1;
                if (i2c_error_count == 0)
                    $display("TEST PASS");
                else
                    $display("TEST FAIL: I2C errors=%0d", i2c_error_count);
                $finish;
            end else if (cycle_count >= MAX_CYCLES) begin
                done <= 1'b1;
                $display("TEST TIMEOUT: pc=%0d status=0x%08h detail=0x%08h starts=%0d stops=%0d",
                         MERC32_top_inst.u_merc32_core.prog_addr,
                         dlb_ram[STATUS_ADDR], detail_value,
                         start_count, stop_count);
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
    //     $dumpfile("tinyc_i2c_tb.vcd");
    //     $dumpvars(0, tinyc_i2c_tb);
    // end

endmodule
