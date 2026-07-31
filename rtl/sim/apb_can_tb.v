`timescale 1ns / 1ps
//================================================================================
//  Module      : apb_can_tb
//  Description : Integrated testbench for the APB CAN peripheral
//================================================================================

module apb_can_tb;

    localparam CLK_PERIOD        = 10;
    localparam ADDR_CTRL         = 32'h0000_0000;
    localparam ADDR_BIT_TIMING   = 32'h0000_0004;
    localparam ADDR_STATUS       = 32'h0000_0008;
    localparam ADDR_TX_ID        = 32'h0000_000c;
    localparam ADDR_TX_CTRL      = 32'h0000_0010;
    localparam ADDR_TX_DATA0     = 32'h0000_0014;
    localparam ADDR_TX_DATA1     = 32'h0000_0018;
    localparam ADDR_TX_CMD       = 32'h0000_001c;
    localparam ADDR_FIFO_STATUS  = 32'h0000_0034;
    localparam ADDR_IRQ_STATUS   = 32'h0000_0044;
    localparam ADDR_ERROR_STATUS = 32'h0000_0050;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         psel_a;
    reg         penable_a;
    reg         pwrite_a;
    reg  [31:0] paddr_a;
    reg  [31:0] pwdata_a;
    wire        pready_a;
    wire        pslverr_a;
    wire [31:0] prdata_a;
    wire        interrupt_a;
    wire        can_tx_a;

    integer     failures;
    integer     wait_cycles;
    integer     i;
    reg  [31:0] read_data;

    apb_can #(
        .SYS_CLK_FREQ     (50_000_000),
        .DEFAULT_BIT_RATE (500_000   ),
        .TX_FIFO_DEPTH    (8         ),
        .RX_FIFO_DEPTH    (8         )
    ) apb_can_inst_a (
        .s_apb_pclk       (clk        ),
        .s_apb_presetn    (rst_n      ),
        .s_apb_psel       (psel_a     ),
        .s_apb_penable    (penable_a  ),
        .s_apb_pwrite     (pwrite_a   ),
        .s_apb_paddr      (paddr_a    ),
        .s_apb_pwdata     (pwdata_a   ),
        .s_apb_pready     (pready_a   ),
        .s_apb_pslverr    (pslverr_a  ),
        .s_apb_prdata     (prdata_a   ),
        .interrupt        (interrupt_a),
        .can_rx           (can_tx_a   ),
        .can_tx           (can_tx_a   )
    );

    always #(CLK_PERIOD / 2) clk = ~clk;

    initial #(CLK_PERIOD * 10) rst_n = 1'b1;

    task check32;
        input [8*80-1:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] %0s expected=%08x actual=%08x",
                         $time, name, expected, actual);
            end
        end
    endtask

    task check_true;
        input [8*80-1:0] name;
        input condition;
        begin
            if (!condition) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] %0s", $time, name);
            end
        end
    endtask

    task apb_idle_a;
        begin
            psel_a    <= 1'b0;
            penable_a <= 1'b0;
            pwrite_a  <= 1'b0;
            paddr_a   <= 32'd0;
            pwdata_a  <= 32'd0;
        end
    endtask

    task apb_write_a;
        input [31:0] address;
        input [31:0] data;
        begin
            @(negedge clk);
            psel_a    <= 1'b1;
            penable_a <= 1'b0;
            pwrite_a  <= 1'b1;
            paddr_a   <= address;
            pwdata_a  <= data;
            @(negedge clk);
            penable_a <= 1'b1;
            wait_cycles = 0;
            while (!pready_a && (wait_cycles < 16)) begin
                @(negedge clk);
                wait_cycles = wait_cycles + 1;
            end
            if (!pready_a) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] APB write timeout address=%08x",
                         $time, address);
            end
            check_true("APB PSLVERR remains low", !pslverr_a);
            @(negedge clk);
            apb_idle_a;
            @(negedge clk);
            check_true("PREADY drops after transfer", !pready_a);
        end
    endtask

    task apb_read_a;
        input  [31:0] address;
        output [31:0] data;
        begin
            @(negedge clk);
            psel_a    <= 1'b1;
            penable_a <= 1'b0;
            pwrite_a  <= 1'b0;
            paddr_a   <= address;
            pwdata_a  <= 32'd0;
            @(negedge clk);
            penable_a <= 1'b1;
            wait_cycles = 0;
            while (!pready_a && (wait_cycles < 16)) begin
                @(negedge clk);
                wait_cycles = wait_cycles + 1;
            end
            if (!pready_a) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] APB read timeout address=%08x",
                         $time, address);
            end
            data = prdata_a;
            check_true("APB PSLVERR remains low", !pslverr_a);
            @(negedge clk);
            apb_idle_a;
            @(negedge clk);
            check_true("PREADY drops after transfer", !pready_a);
        end
    endtask

    task push_standard_frame_a;
        input [10:0] identifier;
        input [3:0] dlc;
        input [63:0] payload;
        begin
            apb_write_a(ADDR_TX_ID, {21'd0, identifier});
            apb_write_a(ADDR_TX_CTRL, {28'd0, dlc});
            apb_write_a(ADDR_TX_DATA0, payload[31:0]);
            apb_write_a(ADDR_TX_DATA1, payload[63:32]);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
        end
    endtask

    task test_apb_fifo;
        begin
            apb_read_a(ADDR_CTRL, read_data);
            check32("CTRL reset value", read_data, 32'h0000_0008);
            apb_read_a(ADDR_BIT_TIMING, read_data);
            check32("BIT_TIMING reset value", read_data, 32'h0016_0009);
            apb_read_a(ADDR_STATUS, read_data);
            check32("STATUS reset value", read_data, 32'h0000_1000);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("FIFO_STATUS reset empty", read_data, 32'h0005_0000);
            apb_read_a(32'h0000_00fc, read_data);
            check32("undefined read returns zero", read_data, 32'd0);

            apb_write_a(ADDR_TX_ID, 32'h0000_0123);
            apb_write_a(ADDR_TX_CTRL, 32'h0000_0009);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("invalid DLC is rejected", read_data & 32'h0000_00ff,
                    32'd0);

            apb_write_a(ADDR_TX_ID, 32'h0000_0800);
            apb_write_a(ADDR_TX_CTRL, 32'h0000_0001);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("invalid standard ID is rejected",
                    read_data & 32'h0000_00ff, 32'd0);

            for (i = 0; i < 8; i = i + 1)
                push_standard_frame_a(i[10:0], 4'd1,
                                      64'h8877_6655_4433_2200 + i);

            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("TX FIFO reaches depth eight",
                    read_data & 32'h0003_00ff, 32'h0002_0008);

            push_standard_frame_a(11'h055, 4'd1, 64'h55);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("full TX FIFO rejects ninth frame",
                    read_data & 32'h0003_00ff, 32'h0002_0008);
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            check_true("TX overflow interrupt status", read_data[12]);
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check_true("TX overflow error status", read_data[7]);
            check_true("invalid frame config status", read_data[9]);

            apb_write_a(ADDR_CTRL, 32'h0000_0108);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("TX clear empties FIFO", read_data & 32'h0003_00ff,
                    32'h0001_0000);
            $display("[PASS] APB_FIFO");
        end
    endtask

    initial begin
        // $dumpfile("apb_can_tb.vcd");
        // $dumpvars(0, apb_can_tb);
        psel_a     = 1'b0;
        penable_a  = 1'b0;
        pwrite_a   = 1'b0;
        paddr_a    = 32'd0;
        pwdata_a   = 32'd0;
        failures   = 0;
        wait_cycles = 0;
        read_data  = 32'd0;

        @(posedge rst_n);
        repeat (2) @(posedge clk);
        test_apb_fifo;

        if (failures == 0)
            $display("APB CAN TEST PASS");
        else
            $display("APB CAN TEST FAIL: %0d failures", failures);
        $finish;
    end

    initial begin
        #(CLK_PERIOD * 20000);
        failures = failures + 1;
        $display("[FAIL] APB CAN TEST TIMEOUT");
        $finish;
    end

endmodule
