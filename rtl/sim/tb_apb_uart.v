`timescale 1ns / 1ps
//================================================================================
//  Module      : tb_apb_uart
//  Description : Self-checking testbench for the standalone APB UART
//  Author      : Mercer
//================================================================================

module tb_apb_uart();

    localparam SYS_CLK_FREQ = 1_000_000;
    localparam FIFO_DEPTH   = 8;
    localparam BAUD_RATE    = 100_000;
    localparam CLK_PERIOD   = 1_000;
    localparam WAIT_CYCLES  = 2_000;

    localparam ADDR_CTRL      = 32'h0000_0000;
    localparam ADDR_CONFIG    = 32'h0000_0004;
    localparam ADDR_RX_BUF    = 32'h0000_0008;
    localparam ADDR_RX_STATUS = 32'h0000_000c;
    localparam ADDR_TX_BUF    = 32'h0000_0010;
    localparam ADDR_TX_STATUS = 32'h0000_0014;
    localparam ADDR_INTERRUPT = 32'h0000_0018;
    localparam ADDR_INVALID   = 32'h0000_001c;

    reg         clk           = 1'b0;
    reg         rst_n         = 1'b0;
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
    reg  [31:0] read_data   = 32'd0;
    reg  [31:0] saved_data  = 32'd0;

    apb_uart #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (FIFO_DEPTH))
    apb_uart_inst (
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
        .uart_rx       (serial_line),
        .uart_tx       (serial_line));

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*20) rst_n = 1'b1;

    task apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(posedge clk);
            s_apb_psel    <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b1;
            s_apb_paddr   <= address;
            s_apb_pwdata  <= data;
            @(posedge clk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge clk);
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
            @(posedge clk);
            s_apb_psel    <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite  <= 1'b0;
            s_apb_paddr   <= address;
            @(posedge clk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge clk);
            data = s_apb_prdata;
            s_apb_psel    <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr   <= 32'd0;
        end
    endtask

    task check_equal;
        input [8*40-1:0] test_name;
        input [31:0]     actual;
        input [31:0]     expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s expected=%08h actual=%08h", test_name, expected, actual);
                error_count = error_count + 1;
            end else begin
                $display("[PASS] %0s value=%08h", test_name, actual);
            end
        end
    endtask

    task check_masked;
        input [8*40-1:0] test_name;
        input [31:0]     actual;
        input [31:0]     expected;
        input [31:0]     mask;
        begin
            check_equal(test_name, actual & mask, expected & mask);
        end
    endtask

    task wait_for_loopback;
        integer cycle_count;
        begin
            cycle_count = 0;
            while ((apb_uart_inst.rx_en !== 1'b1) && (cycle_count < WAIT_CYCLES)) begin
                @(posedge clk);
                cycle_count = cycle_count + 1;
            end
            if (cycle_count >= WAIT_CYCLES) begin
                $display("[FAIL] RX did not start");
                error_count = error_count + 1;
            end

            cycle_count = 0;
            while ((apb_uart_inst.rx_en !== 1'b0) && (cycle_count < WAIT_CYCLES)) begin
                @(posedge clk);
                cycle_count = cycle_count + 1;
            end
            if (cycle_count >= WAIT_CYCLES) begin
                $display("[FAIL] RX loopback did not complete");
                error_count = error_count + 1;
            end
        end
    endtask

    task wait_for_rx_fifo_data;
        integer cycle_count;
        begin
            cycle_count = 0;
            while ((apb_uart_inst.rx_data_cnt == 0) && (cycle_count < WAIT_CYCLES)) begin
                @(posedge clk);
                cycle_count = cycle_count + 1;
            end
            if (cycle_count >= WAIT_CYCLES) begin
                $display("[FAIL] RX FIFO did not receive serial data");
                error_count = error_count + 1;
            end
        end
    endtask

    task wait_for_rx_drain;
        integer cycle_count;
        begin
            cycle_count = 0;
            while (((apb_uart_inst.rx_en !== 1'b0) || (apb_uart_inst.rx_data_cnt != 0)) &&
                   (cycle_count < WAIT_CYCLES)) begin
                @(posedge clk);
                cycle_count = cycle_count + 1;
            end
            if (cycle_count >= WAIT_CYCLES) begin
                $display("[FAIL] RX FIFO did not drain");
                error_count = error_count + 1;
            end
        end
    endtask

    task transfer_and_check;
        input [1:0]  last_byte;
        input [31:0] tx_word;
        input [31:0] compare_mask;
        reg   [31:0] ctrl_value;
        reg   [1:0]  expected_rx_ptr;
        begin
            ctrl_value = {25'd0, last_byte, 1'b1, 1'b0, last_byte, 1'b1};
            expected_rx_ptr = last_byte + 1'b1;

            apb_write(ADDR_TX_BUF, tx_word);
            apb_read(ADDR_TX_STATUS, read_data);
            check_masked("TX_BUF write clears TX pointer", read_data, 32'd0, 32'h0000_0003);

            apb_write(ADDR_CTRL, ctrl_value);
            wait_for_loopback;

            apb_read(ADDR_RX_STATUS, read_data);
            check_masked("RX pointer first status read",
                         read_data, {30'd0, expected_rx_ptr}, 32'h0000_0003);
            apb_read(ADDR_RX_STATUS, read_data);
            check_masked("RX pointer survives status polling",
                         read_data, {30'd0, expected_rx_ptr}, 32'h0000_0003);

            apb_read(ADDR_RX_BUF, read_data);
            check_masked("UART loopback data", read_data, tx_word, compare_mask);
            apb_read(ADDR_RX_BUF, read_data);
            check_equal("RX_BUF read clears data", read_data, 32'd0);

            apb_read(ADDR_RX_STATUS, read_data);
            check_masked("RX FIFO and pointer empty", read_data, 32'd0, 32'h0000_003f);
            apb_read(ADDR_TX_STATUS, read_data);
            check_masked("TX FIFO empty", read_data, 32'd0, 32'h0000_003c);
        end
    endtask

    initial begin
        wait (rst_n);
        repeat (4) @(posedge clk);

        $display("========== APB reset and register behavior ==========");
        apb_read(ADDR_CTRL, read_data);
        check_equal("CTRL reset", read_data, 32'd0);
        apb_read(ADDR_CONFIG, read_data);
        check_equal("CONFIG reset", read_data, 32'd0);
        apb_read(ADDR_RX_BUF, read_data);
        check_equal("RX_BUF reset", read_data, 32'd0);
        apb_read(ADDR_RX_STATUS, read_data);
        check_equal("RX_STATUS reset", read_data, 32'd0);
        apb_read(ADDR_TX_STATUS, read_data);
        check_masked("TX_STATUS FIFO reset", read_data, 32'd0, 32'h0000_00ff);
        check_masked("TX ready after reset", read_data, 32'h0000_0100, 32'h0000_0100);
        apb_read(ADDR_INTERRUPT, read_data);
        check_equal("INTERRUPT reset", read_data, 32'd0);
        check_equal("PSLVERR remains low", {31'd0, s_apb_pslverr}, 32'd0);

        apb_write(ADDR_CONFIG, BAUD_RATE);
        apb_read(ADDR_CONFIG, read_data);
        check_equal("CONFIG readback", read_data, BAUD_RATE);
        saved_data = read_data;
        apb_read(ADDR_INVALID, read_data);
        check_equal("invalid read preserves data", read_data, saved_data);
        check_equal("invalid read keeps PSLVERR low", {31'd0, s_apb_pslverr}, 32'd0);
        repeat (40) @(posedge clk);

        $display("========== Loopback lengths ==========");
        transfer_and_check(2'd0, 32'hf0_00_00_00, 32'hff00_0000);
        transfer_and_check(2'd1, 32'hde_ad_00_00, 32'hffff_0000);
        transfer_and_check(2'd2, 32'haa_55_a5_00, 32'hffff_ff00);
        transfer_and_check(2'd3, 32'h12_34_56_78, 32'hffff_ffff);

        $display("========== UART framing modes ==========");
        apb_write(ADDR_CONFIG, 32'h2000_0000 | BAUD_RATE);
        repeat (40) @(posedge clk);
        transfer_and_check(2'd0, 32'h96_00_00_00, 32'hff00_0000);

        apb_write(ADDR_CONFIG, 32'h4000_0000 | BAUD_RATE);
        repeat (40) @(posedge clk);
        transfer_and_check(2'd0, 32'h69_00_00_00, 32'hff00_0000);

        apb_write(ADDR_CONFIG, 32'h8000_0000 | BAUD_RATE);
        repeat (40) @(posedge clk);
        transfer_and_check(2'd0, 32'ha5_00_00_00, 32'hff00_0000);

        apb_write(ADDR_CONFIG, BAUD_RATE);
        repeat (40) @(posedge clk);

        $display("========== Interrupt sources ==========");
        apb_write(ADDR_INTERRUPT, 32'h0000_0003);
        repeat (3) @(posedge clk);
        check_equal("TX-ready interrupt asserted", {31'd0, interrupt}, 32'd1);

        apb_read(ADDR_INTERRUPT, read_data);
        check_masked("INT_FLAG set by hardware", read_data, 32'h0000_0010, 32'h0000_0010);
        apb_read(ADDR_INTERRUPT, read_data);
        check_masked("INT_FLAG survives register reads", read_data, 32'h0000_0010, 32'h0000_0010);

        apb_write(ADDR_INTERRUPT, 32'h0000_0018);
        repeat (3) @(posedge clk);
        check_equal("interrupt disable", {31'd0, interrupt}, 32'd0);
        apb_read(ADDR_INTERRUPT, read_data);
        check_equal("reserved bit forced low", read_data, 32'h0000_0010);

        apb_write(ADDR_INTERRUPT, 32'd0);
        apb_read(ADDR_INTERRUPT, read_data);
        check_equal("INT_FLAG write-zero clear", read_data, 32'd0);

        apb_write(ADDR_INTERRUPT, 32'h0000_0007);
        repeat (3) @(posedge clk);
        check_equal("TX threshold interrupt asserted", {31'd0, interrupt}, 32'd1);
        apb_write(ADDR_INTERRUPT, 32'd0);

        apb_write(ADDR_TX_BUF, 32'he1_00_00_00);
        apb_write(ADDR_CTRL, 32'h0000_0010);
        wait_for_rx_fifo_data;

        apb_write(ADDR_INTERRUPT, 32'h0000_0001);
        repeat (3) @(posedge clk);
        check_equal("RX-valid interrupt asserted", {31'd0, interrupt}, 32'd1);
        apb_write(ADDR_INTERRUPT, 32'd0);

        apb_write(ADDR_INTERRUPT, 32'h0001_0005);
        repeat (3) @(posedge clk);
        check_equal("RX threshold interrupt asserted", {31'd0, interrupt}, 32'd1);
        apb_write(ADDR_INTERRUPT, 32'd0);

        apb_write(ADDR_CTRL, 32'h0000_0001);
        wait_for_rx_drain;
        apb_read(ADDR_RX_BUF, read_data);
        check_masked("RX interrupt test data", read_data, 32'he1_00_00_00, 32'hff00_0000);

        $display("========== Soft reset ==========");
        apb_write(ADDR_TX_BUF, 32'h55aa_33cc);
        apb_write(ADDR_CTRL, 32'h0000_0070);
        repeat (3) @(posedge clk);
        check_equal("TX FIFO populated before reset",
                    {31'd0, |apb_uart_inst.tx_data_cnt}, 32'd1);
        apb_write(ADDR_CTRL, 32'h8000_0000);
        repeat (3) @(posedge clk);
        apb_read(ADDR_TX_STATUS, read_data);
        check_masked("soft reset clears TX FIFO", read_data, 32'd0, 32'h0000_003c);
        apb_read(ADDR_RX_STATUS, read_data);
        check_masked("soft reset clears RX FIFO", read_data, 32'd0, 32'h0000_003c);
        check_equal("soft reset drives TX idle", {31'd0, serial_line}, 32'd1);
        apb_write(ADDR_CTRL, 32'd0);

        $display("==================================================");
        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $display("==================================================");
        $finish;
    end

    initial #(CLK_PERIOD*100_000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("tb_apb_uart.vcd");
    //     $dumpvars(0, tb_apb_uart);
    // end

endmodule
