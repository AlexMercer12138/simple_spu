`timescale 1ns / 1ps
//================================================================================
//  Module      : tinyc_uart_tb
//  Description : Tiny C black-box integration test for MERC32 and APB UART
//================================================================================

module tinyc_uart_tb();

    localparam CLK_PERIOD         = 20;
    localparam RESET_CYCLES       = 20;
    localparam MAX_CYCLES         = 200_000;
    localparam MEMORY_WORDS       = 65_536;
    localparam UART_SYS_CLK_FREQ  = 1_000_000;
    localparam UART_BAUD_RATE     = 100_000;
    localparam UART_BAUD_DIV      = UART_SYS_CLK_FREQ / UART_BAUD_RATE;
    localparam [15:0] STATUS_ADDR = 16'd240;
    localparam [15:0] FAIL_ADDR   = 16'd241;
    localparam [31:0] PASS_CODE   = 32'h0000_600d;
    localparam [31:0] FAIL_CODE   = 32'h0000_0bad;
    localparam [31:0] UART_RX_REQUEST = 32'h0000_1001;

    reg         clk   = 1'b0;
    reg         rst_n = 1'b0;
    reg         uart_rx = 1'b1;

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

    wire        uart_interrupt;
    wire        uart_tx;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram     [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;
    reg  [7:0]  received_byte = 8'd0;

    integer i;
    integer rom_words       = 0;
    integer cycle_count     = 0;
    integer received_count  = 0;
    integer uart_error_count = 0;
    integer handshake_wait = 0;
    reg     uart_sequence_done = 1'b0;
    reg     firmware_pass_seen = 1'b0;
    reg     done               = 1'b0;

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
        .interrupt      (uart_interrupt),
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

    apb_uart #(
        .SYS_CLK_FREQ   (UART_SYS_CLK_FREQ),
        .FIFO_DEPTH     (8))
    apb_uart_inst (
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
        .interrupt      (uart_interrupt),
        .uart_rx        (uart_rx),
        .uart_tx        (uart_tx));

    function [7:0] expected_uart_byte;
        input integer index;
        begin
            case (index)
                0: expected_uart_byte = 8'h4d;
                1: expected_uart_byte = 8'h45;
                2: expected_uart_byte = 8'h52;
                3: expected_uart_byte = 8'h43;
                4: expected_uart_byte = 8'h33;
                5: expected_uart_byte = 8'h32;
                6: expected_uart_byte = 8'h0d;
                7: expected_uart_byte = 8'h0a;
                8: expected_uart_byte = 8'h21;
                default: expected_uart_byte = 8'h00;
            endcase
        end
    endfunction

    task receive_uart_byte;
        output [7:0] value;
        integer bit_index;
        begin
            @(negedge uart_tx);
            repeat (UART_BAUD_DIV + UART_BAUD_DIV/2) @(posedge clk);
            for (bit_index = 0; bit_index < 8; bit_index = bit_index + 1) begin
                value[bit_index] = uart_tx;
                repeat (UART_BAUD_DIV) @(posedge clk);
            end
            if (uart_tx !== 1'b1) begin
                $display("[FAIL] UART stop bit is not high for byte %0d", received_count);
                uart_error_count = uart_error_count + 1;
            end
        end
    endtask

    task send_uart_byte;
        input [7:0] value;
        integer bit_index;
        begin
            @(negedge clk);
            uart_rx = 1'b0;
            repeat (UART_BAUD_DIV) @(posedge clk);
            for (bit_index = 0; bit_index < 8; bit_index = bit_index + 1) begin
                uart_rx = value[bit_index];
                repeat (UART_BAUD_DIV) @(posedge clk);
            end
            uart_rx = 1'b1;
            repeat (UART_BAUD_DIV) @(posedge clk);
        end
    endtask

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

    initial begin
        wait (rst_n);
        for (received_count = 0; received_count < 8; received_count = received_count + 1) begin
            receive_uart_byte(received_byte);
            if (received_byte !== expected_uart_byte(received_count)) begin
                $display("[FAIL] UART byte %0d expected=%02h actual=%02h",
                         received_count,
                         expected_uart_byte(received_count),
                         received_byte);
                uart_error_count = uart_error_count + 1;
            end
        end
        while ((dlb_ram[FAIL_ADDR] !== UART_RX_REQUEST) &&
               (handshake_wait < 100000)) begin
            @(posedge clk);
            handshake_wait = handshake_wait + 1;
        end
        if (dlb_ram[FAIL_ADDR] !== UART_RX_REQUEST) begin
            $display("TEST FAIL: UART RX handshake missing detail=0x%08h",
                     dlb_ram[FAIL_ADDR]);
            $finish;
        end else begin
            send_uart_byte(8'h21);
            receive_uart_byte(received_byte);
            if (received_byte !== expected_uart_byte(received_count)) begin
                $display("[FAIL] UART byte %0d expected=%02h actual=%02h",
                         received_count,
                         expected_uart_byte(received_count),
                         received_byte);
                uart_error_count = uart_error_count + 1;
            end
            received_count = received_count + 1;
        end
        uart_sequence_done = 1'b1;
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            dlb_rdata <= 32'd0;
        end else begin
            if (dlb_en && dlb_we)
                dlb_ram[dlb_addr] <= dlb_wdata;
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
                         dlb_wdata, dlb_ram[FAIL_ADDR]);
                $finish;
            end else if ((firmware_pass_seen || firmware_pass_write) && uart_sequence_done) begin
                done <= 1'b1;
                if (uart_error_count == 0)
                    $display("TEST PASS");
                else
                    $display("TEST FAIL: UART errors=%0d", uart_error_count);
                $finish;
            end else if (cycle_count >= MAX_CYCLES) begin
                done <= 1'b1;
                $display("TEST TIMEOUT: pc=%0d status=0x%08h uart_bytes=%0d",
                         MERC32_top_inst.u_merc32_core.prog_addr,
                         dlb_ram[STATUS_ADDR],
                         received_count);
                $display("UART ports: irq=%0d tx=%0d rx=%0d APB=%0d/%0d/%0d",
                         uart_interrupt, uart_tx, uart_rx,
                         apb_psel, apb_penable, apb_pready);
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
    //     $dumpfile("tinyc_uart_tb.vcd");
    //     $dumpvars(0, tinyc_uart_tb);
    // end

endmodule
