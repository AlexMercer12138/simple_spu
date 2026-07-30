`timescale 1ns/1ps

module apb_i2c_tb;

    localparam SYS_CLK_FREQ = 1_000_000;
    localparam FIFO_DEPTH   = 4;
    localparam CLK_PERIOD   = 10;

    localparam ADDR_CTRL            = 32'h0000_0000;
    localparam ADDR_MASTER_CMD      = 32'h0000_0004;
    localparam ADDR_TIMING          = 32'h0000_0008;
    localparam ADDR_STATUS          = 32'h0000_000C;
    localparam ADDR_TX_DATA         = 32'h0000_0010;
    localparam ADDR_RX_DATA         = 32'h0000_0014;
    localparam ADDR_FIFO_STATUS     = 32'h0000_0018;
    localparam ADDR_SLAVE_CFG       = 32'h0000_001C;
    localparam ADDR_STRETCH_TIMEOUT = 32'h0000_0020;
    localparam ADDR_IRQ_STATUS      = 32'h0000_0024;
    localparam ADDR_IRQ_ENABLE      = 32'h0000_0028;
    localparam ADDR_IRQ_THRESHOLD   = 32'h0000_002C;
    localparam ADDR_INVALID         = 32'h0000_0030;

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
    wire        scl_o;
    wire        scl_t;
    wire        sda_o;
    wire        sda_t;

    integer     error_count = 0;
    reg  [31:0] read_data = 32'd0;

    apb_i2c #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (FIFO_DEPTH)
    ) apb_i2c_inst (
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
        .scl_o         (scl_o),
        .scl_t         (scl_t),
        .scl_i         (1'b1),
        .sda_o         (sda_o),
        .sda_t         (sda_t),
        .sda_i         (1'b1)
    );

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*5) rst_n = 1'b1;

    task check_equal;
        input [8*48-1:0] test_name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s expected=%08h actual=%08h",
                         test_name, expected, actual);
                error_count = error_count + 1;
            end else begin
                $display("[PASS] %0s value=%08h", test_name, actual);
            end
        end
    endtask

    task apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= address;
            s_apb_pwdata <= data;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= 32'd0;
            s_apb_pwdata <= 32'd0;
        end
    endtask

    task apb_read;
        input [31:0] address;
        output [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= address;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            data = s_apb_prdata;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

    task core_push_rx;
        input [7:0] data;
        begin
            @(negedge clk);
            force apb_i2c_inst.rx_core_data = data;
            force apb_i2c_inst.rx_core_push = 1'b1;
            @(posedge clk);
            #1;
            release apb_i2c_inst.rx_core_push;
            release apb_i2c_inst.rx_core_data;
        end
    endtask

    task core_pop_tx;
        begin
            @(negedge clk);
            force apb_i2c_inst.tx_core_pop = 1'b1;
            @(posedge clk);
            #1;
            release apb_i2c_inst.tx_core_pop;
        end
    endtask

    task apb_write_with_tx_pop;
        input [7:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= ADDR_TX_DATA;
            s_apb_pwdata <= {24'd0, data};
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            force apb_i2c_inst.tx_core_pop = 1'b1;
            @(posedge clk);
            #1;
            release apb_i2c_inst.tx_core_pop;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= 32'd0;
            s_apb_pwdata <= 32'd0;
        end
    endtask

    task apb_read_with_rx_push;
        input [7:0] pushed_data;
        output [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= ADDR_RX_DATA;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            force apb_i2c_inst.rx_core_data = pushed_data;
            force apb_i2c_inst.rx_core_push = 1'b1;
            @(posedge clk);
            #1;
            data = s_apb_prdata;
            release apb_i2c_inst.rx_core_push;
            release apb_i2c_inst.rx_core_data;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

    task check_apb_timing;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= ADDR_INVALID;
            #1;
            check_equal("PREADY before registered response",
                        {31'd0, s_apb_pready}, 0);
            @(posedge clk);
            #1;
            check_equal("PREADY registered response",
                        {31'd0, s_apb_pready}, 1);
            check_equal("invalid read is zero", s_apb_prdata, 0);
            @(negedge clk);
            s_apb_penable <= 1'b1;
            #1;
            check_equal("PREADY held through access",
                        {31'd0, s_apb_pready}, 1);
            @(posedge clk);
            #1;
            check_equal("PREADY drops after access",
                        {31'd0, s_apb_pready}, 0);
            check_equal("PSLVERR remains low",
                        {31'd0, s_apb_pslverr}, 0);
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

    initial begin
        wait (rst_n);
        repeat (4) @(posedge clk);

        $display("========== APB reset values ==========");
        check_equal("PREADY reset", {31'd0, s_apb_pready}, 0);
        check_equal("PSLVERR reset", {31'd0, s_apb_pslverr}, 0);
        check_equal("interrupt reset", {31'd0, interrupt}, 0);
        check_equal("open-drain outputs low", {30'd0, scl_o, sda_o}, 0);
        check_equal("disabled lines released", {30'd0, scl_t, sda_t}, 3);
        apb_read(ADDR_CTRL, read_data);
        check_equal("CTRL reset", read_data, 32'h0000_0000);
        apb_read(ADDR_MASTER_CMD, read_data);
        check_equal("MASTER_CMD reset", read_data, 32'h0000_0000);
        apb_read(ADDR_TIMING, read_data);
        check_equal("TIMING reset", read_data, 32'h0000_0002);
        apb_read(ADDR_STATUS, read_data);
        check_equal("STATUS reset", read_data, 32'h0000_00A0);
        apb_read(ADDR_TX_DATA, read_data);
        check_equal("TX_DATA read", read_data, 32'h0000_0000);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX_DATA empty", read_data, 32'h0000_0000);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("FIFO_STATUS reset", read_data, 32'h0005_0000);
        apb_read(ADDR_SLAVE_CFG, read_data);
        check_equal("SLAVE_CFG reset", read_data, 32'h0000_0050);
        apb_read(ADDR_STRETCH_TIMEOUT, read_data);
        check_equal("timeout reset", read_data, 32'd1000);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("IRQ_STATUS reset", read_data, 32'h0000_0000);
        apb_read(ADDR_IRQ_ENABLE, read_data);
        check_equal("IRQ_ENABLE reset", read_data, 32'h0000_0000);
        apb_read(ADDR_IRQ_THRESHOLD, read_data);
        check_equal("IRQ_THRESHOLD reset", read_data, 32'h0000_0001);

        $display("========== APB timing and masks ==========");
        check_apb_timing;
        apb_write(ADDR_MASTER_CMD, 32'hFFFF_FFFF);
        apb_read(ADDR_MASTER_CMD, read_data);
        check_equal("MASTER_CMD mask", read_data, 32'hFFFF_7F03);
        apb_write(ADDR_TIMING, 32'hFFFF_FFFF);
        apb_read(ADDR_TIMING, read_data);
        check_equal("TIMING mask", read_data, 32'h0000_FFFF);
        apb_write(ADDR_SLAVE_CFG, 32'hFFFF_FFFF);
        apb_read(ADDR_SLAVE_CFG, read_data);
        check_equal("SLAVE_CFG mask", read_data, 32'h0000_007F);
        apb_write(ADDR_STRETCH_TIMEOUT, 32'd123);
        apb_read(ADDR_STRETCH_TIMEOUT, read_data);
        check_equal("timeout readback", read_data, 32'd123);
        apb_write(ADDR_IRQ_ENABLE, 32'hFFFF_FFFF);
        apb_read(ADDR_IRQ_ENABLE, read_data);
        check_equal("IRQ_ENABLE mask", read_data, 32'h0000_3FFF);
        apb_write(ADDR_IRQ_THRESHOLD, 32'hFFFF_FFFF);
        apb_read(ADDR_IRQ_THRESHOLD, read_data);
        check_equal("IRQ_THRESHOLD mask", read_data, 32'h0000_FFFF);

        $display("========== TX FIFO ==========");
        apb_write(ADDR_TX_DATA, 32'h0000_00A1);
        apb_write(ADDR_TX_DATA, 32'h0000_00B2);
        apb_write(ADDR_TX_DATA, 32'h0000_00C3);
        apb_write(ADDR_TX_DATA, 32'h0000_00D4);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("TX FIFO full", read_data, 32'h0006_0004);
        apb_write(ADDR_TX_DATA, 32'h0000_00E5);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("full write ignored", read_data, 32'h0006_0004);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("full write CMD_ERROR", read_data, 32'h0000_0020);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0020);
        apb_write(ADDR_CTRL, 32'h0000_0010);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("TX clear", read_data, 32'h0005_0000);
        apb_read(ADDR_CTRL, read_data);
        check_equal("TX clear is pulse", read_data, 32'h0000_0000);

        $display("========== RX FIFO ==========");
        core_push_rx(8'hE1);
        core_push_rx(8'hE2);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX FIFO level two", read_data, 32'h0001_0200);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX first byte", read_data, 32'h0000_00E1);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX pop once", read_data, 32'h0001_0100);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX second byte", read_data, 32'h0000_00E2);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX empty read", read_data, 32'h0000_0000);
        apb_write(ADDR_CTRL, 32'h0000_0020);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX clear", read_data, 32'h0005_0000);

        $display("========== Simultaneous FIFO operations ==========");
        apb_write(ADDR_TX_DATA, 32'h0000_0011);
        check_equal("TX core sees oldest byte",
                    {24'd0, apb_i2c_inst.tx_core_data}, 32'h0000_0011);
        apb_write_with_tx_pop(8'h22);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("TX simultaneous level", read_data, 32'h0004_0001);
        check_equal("TX simultaneous next byte",
                    {24'd0, apb_i2c_inst.tx_core_data}, 32'h0000_0022);
        core_pop_tx;
        core_push_rx(8'h31);
        apb_read_with_rx_push(8'h32, read_data);
        check_equal("RX simultaneous read", read_data, 32'h0000_0031);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX simultaneous level", read_data, 32'h0001_0100);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX simultaneous next byte", read_data, 32'h0000_0032);

        $display("========== Soft reset ==========");
        apb_write(ADDR_MASTER_CMD, 32'h1234_5602);
        apb_write(ADDR_TIMING, 32'h0000_0044);
        apb_write(ADDR_TX_DATA, 32'h0000_0055);
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_read(ADDR_MASTER_CMD, read_data);
        check_equal("soft reset MASTER_CMD", read_data, 0);
        apb_read(ADDR_TIMING, read_data);
        check_equal("soft reset TIMING", read_data, 2);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("soft reset FIFOs", read_data, 32'h0005_0000);
        apb_read(ADDR_IRQ_ENABLE, read_data);
        check_equal("soft reset IRQ_ENABLE", read_data, 0);

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial #(CLK_PERIOD*10000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("apb_i2c_tb.vcd");
    //     $dumpvars(0, apb_i2c_tb);
    // end

endmodule
