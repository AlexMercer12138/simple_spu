`timescale 1ns / 1ps
//================================================================================
//  Module      : tinyc_cpu_tb
//  Description : Generic MERC32 Tiny C firmware execution testbench
//================================================================================

module tinyc_cpu_tb();

    localparam CLK_PERIOD        = 20;
    localparam RESET_CYCLES      = 20;
    localparam MAX_CYCLES        = 100_000;
    localparam MEMORY_WORDS      = 65_536;
    localparam [15:0] STATUS_ADDR = 16'd240;
    localparam [15:0] FAIL_ADDR   = 16'd241;
    localparam [31:0] PASS_CODE   = 32'h0000_600d;
    localparam [31:0] FAIL_CODE   = 32'h0000_0bad;

    reg         clk       = 1'b0;
    reg         rst_n     = 1'b0;
    reg         interrupt = 1'b0;

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

    wire        plb_rden;
    wire        plb_wren;
    wire [31:0] plb_addr;
    wire [31:0] plb_wdata;
    reg  [31:0] plb_rdata = 32'd0;
    reg         plb_ack   = 1'b0;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram     [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;

    integer i;
    integer rom_words   = 0;
    integer cycle_count = 0;
    reg     done        = 1'b0;

    assign ilb_rdata = program_rom[ilb_addr];

    merc32_core #(
        .ILB_ADDR_WIDTH (16),
        .DLB_ADDR_WIDTH (16))
    merc32_core_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        .interrupt      (interrupt),

        .dbg_rst_req    (1'b0),
        .dbg_halt_req   (1'b0),
        .dbg_step_req   (1'b0),
        .dbg_regi_req   (1'b0),
        .dbg_regi_vld   (),
        .dbg_regi_data  (),
        .dbg_halted     (),
        .dbg_rden       (1'b0),
        .dbg_wren       (1'b0),
        .dbg_addr       (32'd0),
        .dbg_wdata      (32'd0),
        .dbg_rdata      (),
        .dbg_ack        (),

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

        .plb_rden       (plb_rden),
        .plb_wren       (plb_wren),
        .plb_addr       (plb_addr),
        .plb_wdata      (plb_wdata),
        .plb_rdata      (plb_rdata),
        .plb_ack        (plb_ack));

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*RESET_CYCLES) rst_n = 1'b1;

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

    always @(posedge clk) begin
        if (!rst_n) begin
            dlb_rdata <= 32'd0;
            plb_rdata <= 32'd0;
            plb_ack <= 1'b0;
        end else begin
            if (dlb_en && dlb_we)
                dlb_ram[dlb_addr] <= dlb_wdata;
            dlb_rdata <= dlb_en ? dlb_ram[dlb_addr] : dlb_rdata;
            plb_rdata <= 32'd0;
            plb_ack <= plb_rden | plb_wren;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            cycle_count <= 0;
        end else if (!done) begin
            cycle_count <= cycle_count + 1;

            if (dlb_en && dlb_we && (dlb_addr == STATUS_ADDR)) begin
                if (dlb_wdata == PASS_CODE) begin
                    done <= 1'b1;
                    $display("TEST PASS");
                    $finish;
                end else if (dlb_wdata == FAIL_CODE) begin
                    done <= 1'b1;
                    $display("TEST FAIL: firmware status=0x%08h detail=0x%08h",
                             dlb_wdata, dlb_ram[FAIL_ADDR]);
                    $finish;
                end
            end

            if (cycle_count >= MAX_CYCLES) begin
                done <= 1'b1;
                $display("TEST TIMEOUT: pc=%0d status=0x%08h detail=0x%08h",
                         merc32_core_inst.prog_addr,
                         dlb_ram[STATUS_ADDR],
                         dlb_ram[FAIL_ADDR]);
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
    //     $dumpfile("tinyc_cpu_tb.vcd");
    //     $dumpvars(0, tinyc_cpu_tb);
    // end

endmodule
