`timescale 1ns / 1ps
//================================================================================
//  Module      : apb_uart_new_tb
//  Description : Testbench for standalone APB UART with synchronous FIFOs
//  Author      : Mercer
//================================================================================

module apb_uart_new_tb();

    localparam SYS_CLK_FREQ = 1_000_000;
    parameter  FIFO_DEPTH   = 8;
    localparam BAUD_RATE    = 100_000;
    localparam CLK_PERIOD   = 1_000;

    localparam ADDR_CTRL      = 32'h0000_0000;
    localparam ADDR_CONFIG    = 32'h0000_0004;
    localparam ADDR_RX_BUF    = 32'h0000_0008;
    localparam ADDR_RX_STATUS = 32'h0000_000c;
    localparam ADDR_TX_BUF    = 32'h0000_0010;
    localparam ADDR_TX_STATUS = 32'h0000_0014;
    localparam ADDR_INTERRUPT = 32'h0000_0018;

    reg         s_apb_pclk    = 1'b0;
    reg         s_apb_presetn = 1'b0;
    reg         s_apb_psel    = 1'b0;
    reg         s_apb_penable = 1'b0;
    reg         s_apb_pwrite  = 1'b0;
    reg  [31:0] s_apb_paddr   = 32'd0;
    reg  [31:0] s_apb_pwdata  = 32'd0;

    wire        s_apb_pready;
    wire        s_apb_pslverr;
    wire [31:0] s_apb_prdata;
    wire        interrupt;
    wire        serial_line;

    integer     error_count = 0;
    reg  [31:0] read_data;

    apb_uart_new #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (FIFO_DEPTH))
    apb_uart_new_inst (
        .s_apb_pclk    (s_apb_pclk),
        .s_apb_presetn (s_apb_presetn),
        .s_apb_psel    (s_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s_apb_pready),
        .s_apb_pslverr (s_apb_pslverr),
        .s_apb_prdata  (s_apb_prdata),
        .interrupt     (interrupt),
        .uart_rx       (serial_line),
        .uart_tx       (serial_line));

    always #(CLK_PERIOD/2) s_apb_pclk = ~s_apb_pclk;

    task apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(posedge s_apb_pclk);
            s_apb_psel    <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b1;
            s_apb_paddr   <= address;
            s_apb_pwdata  <= data;
            @(posedge s_apb_pclk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge s_apb_pclk);
            s_apb_psel    <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b0;
            s_apb_paddr   <= 32'd0;
            s_apb_pwdata  <= 32'd0;
        end
    endtask

    task apb_read;
        input  [31:0] address;
        output [31:0] data;
        begin
            @(posedge s_apb_pclk);
            s_apb_psel    <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b0;
            s_apb_paddr   <= address;
            @(posedge s_apb_pclk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge s_apb_pclk);
            data = s_apb_prdata;
            s_apb_psel    <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr   <= 32'd0;
        end
    endtask

    task check_value;
        input [255:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s expected=%08h actual=%08h", name, expected, actual);
                error_count = error_count + 1;
            end else begin
                $display("[PASS] %0s value=%08h", name, actual);
            end
        end
    endtask

    task transfer_and_check;
        input [1:0]  last_byte;
        input [31:0] tx_word;
        input [31:0] compare_mask;
        reg   [31:0] ctrl_value;
        begin
            ctrl_value = {25'd0, last_byte, 1'b1, 1'b0, last_byte, 1'b1};
            apb_write(ADDR_TX_BUF, tx_word);
            apb_write(ADDR_CTRL, ctrl_value);
            wait (apb_uart_new_inst.rx_en == 1'b1);
            wait (apb_uart_new_inst.rx_en == 1'b0);
            apb_read(ADDR_RX_BUF, read_data);
            check_value("UART loopback", read_data & compare_mask,
                        tx_word & compare_mask);
            apb_read(ADDR_RX_STATUS, read_data);
            check_value("RX FIFO empty", {28'd0, read_data[5:2]}, 32'd0);
            check_value("RX pointer cleared", {30'd0, read_data[1:0]}, 32'd0);
            apb_read(ADDR_TX_STATUS, read_data);
            check_value("TX FIFO empty", {28'd0, read_data[5:2]}, 32'd0);
        end
    endtask

    always @(posedge s_apb_pclk) begin
        if (s_apb_presetn) begin
            if (apb_uart_new_inst.tx_data_cnt > FIFO_DEPTH) begin
                $display("[FAIL] TX FIFO count overflow");
                error_count = error_count + 1;
            end
            if (apb_uart_new_inst.rx_data_cnt > FIFO_DEPTH) begin
                $display("[FAIL] RX FIFO count overflow");
                error_count = error_count + 1;
            end
        end
    end

    initial begin
        #(CLK_PERIOD*20) s_apb_presetn = 1'b1;
    end

    initial begin
        wait (s_apb_presetn);
        repeat (4) @(posedge s_apb_pclk);

        apb_read(ADDR_CTRL, read_data);
        check_value("CTRL reset", read_data, 32'd0);
        apb_read(ADDR_CONFIG, read_data);
        check_value("CONFIG reset", read_data, 32'd0);
        if (s_apb_pslverr !== 1'b0) begin
            $display("[FAIL] PSLVERR must remain low");
            error_count = error_count + 1;
        end

        apb_write(ADDR_CONFIG, BAUD_RATE);
        repeat (40) @(posedge s_apb_pclk);

        transfer_and_check(2'd0, 32'hf0_00_00_00, 32'hff00_0000);
        transfer_and_check(2'd1, 32'hde_ad_00_00, 32'hffff_0000);
        transfer_and_check(2'd2, 32'haa_55_a5_00, 32'hffff_ff00);
        transfer_and_check(2'd3, 32'h12_34_56_78, 32'hffff_ffff);

        apb_write(ADDR_CONFIG, 32'h2000_0000 | BAUD_RATE);
        repeat (40) @(posedge s_apb_pclk);
        transfer_and_check(2'd0, 32'h96_00_00_00, 32'hff00_0000);

        apb_write(ADDR_CONFIG, 32'h4000_0000 | BAUD_RATE);
        repeat (40) @(posedge s_apb_pclk);
        transfer_and_check(2'd0, 32'h69_00_00_00, 32'hff00_0000);

        apb_write(ADDR_CONFIG, 32'h8000_0000 | BAUD_RATE);
        repeat (40) @(posedge s_apb_pclk);
        transfer_and_check(2'd0, 32'ha5_00_00_00, 32'hff00_0000);

        apb_write(ADDR_CONFIG, BAUD_RATE);
        repeat (40) @(posedge s_apb_pclk);

        apb_write(ADDR_INTERRUPT, 32'h0000_0003);
        repeat (2) @(posedge s_apb_pclk);
        check_value("TX-ready interrupt", {31'd0, interrupt}, 32'd1);
        apb_write(ADDR_INTERRUPT, 32'd0);

        apb_write(ADDR_CTRL, 32'h8000_0000);
        repeat (2) @(posedge s_apb_pclk);
        apb_read(ADDR_TX_STATUS, read_data);
        check_value("TX FIFO soft reset", {28'd0, read_data[5:2]}, 32'd0);
        apb_read(ADDR_RX_STATUS, read_data);
        check_value("RX FIFO soft reset", {28'd0, read_data[5:2]}, 32'd0);
        apb_write(ADDR_CTRL, 32'd0);

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial #(CLK_PERIOD*500_000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("apb_uart_new_tb.vcd");
    //     $dumpvars(0, apb_uart_new_tb);
    // end

endmodule
