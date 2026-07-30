`timescale 1ns/1ps

module apb_uart_tb;

    localparam SYS_CLK_FREQ = 1_000_000;
    localparam FIFO_DEPTH   = 8;
    localparam BAUD_RATE    = 100_000;
    localparam CLK_PERIOD   = 1_000;
    localparam WAIT_CYCLES  = 3_000;

    localparam ADDR_CTRL      = 32'h0000_0000;
    localparam ADDR_CONFIG    = 32'h0000_0004;
    localparam ADDR_RX_DATA   = 32'h0000_0008;
    localparam ADDR_RX_STATUS = 32'h0000_000C;
    localparam ADDR_TX_DATA   = 32'h0000_0010;
    localparam ADDR_TX_STATUS = 32'h0000_0014;
    localparam ADDR_INTERRUPT = 32'h0000_0018;
    localparam ADDR_INVALID   = 32'h0000_001C;

    localparam CTRL_RX_EN     = 32'h0000_0001;
    localparam CTRL_TX_EN     = 32'h0000_0002;
    localparam CTRL_RX_CLR    = 32'h0000_0004;
    localparam CTRL_TX_CLR    = 32'h0000_0008;
    localparam CTRL_SOFT_RST  = 32'h8000_0000;

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
    wire        serial_line;

    integer     error_count = 0;
    integer     index;
    reg  [31:0] read_data = 32'd0;
    reg  [31:0] saved_data = 32'd0;

    apb_uart #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (FIFO_DEPTH)
    ) apb_uart_inst (
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
        .uart_tx       (serial_line)
    );

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*20) rst_n = 1'b1;

    task apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(posedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= address;
            s_apb_pwdata <= data;
            @(posedge clk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge clk);
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
            @(posedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= address;
            @(posedge clk);
            s_apb_penable <= 1'b1;
            wait (s_apb_pready);
            @(posedge clk);
            data = s_apb_prdata;
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

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

    task check_masked;
        input [8*48-1:0] test_name;
        input [31:0] actual;
        input [31:0] expected;
        input [31:0] mask;
        begin
            check_equal(test_name, actual & mask, expected & mask);
        end
    endtask

    task wait_for_rx_level;
        input [7:0] expected_level;
        integer attempts;
        begin
            attempts = 0;
            read_data = 32'd0;
            while ((read_data[7:0] != expected_level) &&
                   (attempts < WAIT_CYCLES)) begin
                apb_read(ADDR_RX_STATUS, read_data);
                attempts = attempts + 1;
            end
            if (attempts >= WAIT_CYCLES) begin
                $display("[FAIL] RX level expected=%0d actual=%0d",
                         expected_level, read_data[7:0]);
                error_count = error_count + 1;
            end
        end
    endtask

    task wait_for_tx_idle;
        integer attempts;
        begin
            attempts = 0;
            read_data = 32'hFFFF_FFFF;
            while (((read_data[7:0] != 0) || read_data[10]) &&
                   (attempts < WAIT_CYCLES)) begin
                apb_read(ADDR_TX_STATUS, read_data);
                attempts = attempts + 1;
            end
            if (attempts >= WAIT_CYCLES) begin
                $display("[FAIL] TX did not become idle status=%08h", read_data);
                error_count = error_count + 1;
            end
        end
    endtask

    task run_loopback_byte;
        input [31:0] config_value;
        input [7:0] value;
        begin
            apb_write(ADDR_CONFIG, config_value);
            repeat (40) @(posedge clk);
            apb_write(ADDR_CTRL,
                      CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
            apb_write(ADDR_TX_DATA, {24'd0, value});
            wait_for_rx_level(1);
            apb_read(ADDR_RX_DATA, read_data);
            check_equal("loopback RX prime", read_data, 0);
            apb_read(ADDR_RX_DATA, read_data);
            check_equal("loopback byte", read_data, {24'd0, value});
            wait_for_tx_idle;
        end
    endtask

    initial begin
        wait (rst_n);
        repeat (4) @(posedge clk);

        $display("========== UART reset and registers ==========");
        apb_read(ADDR_CTRL, read_data);
        check_equal("CTRL reset", read_data, 0);
        apb_read(ADDR_CONFIG, read_data);
        check_equal("CONFIG reset", read_data, 0);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX_DATA reset", read_data, 0);
        apb_read(ADDR_RX_STATUS, read_data);
        check_equal("RX_STATUS reset", read_data, 32'h0000_0100);
        apb_read(ADDR_TX_STATUS, read_data);
        check_equal("TX_STATUS reset", read_data, 32'h0000_0100);
        apb_read(ADDR_INTERRUPT, read_data);
        check_equal("INTERRUPT reset", read_data, 0);
        check_equal("PSLVERR reset", {31'd0, s_apb_pslverr}, 0);

        apb_write(ADDR_CONFIG, BAUD_RATE);
        apb_read(ADDR_CONFIG, read_data);
        check_equal("CONFIG readback", read_data, BAUD_RATE);
        saved_data = read_data;
        apb_read(ADDR_INVALID, read_data);
        check_equal("invalid read preserves data", read_data, saved_data);
        repeat (40) @(posedge clk);

        $display("========== Separate TX and RX enables ==========");
        apb_write(ADDR_CTRL, 0);
        apb_write(ADDR_TX_DATA, 32'hABCD_0011);
        apb_write(ADDR_TX_DATA, 32'h1234_0022);
        repeat (50) @(posedge clk);
        apb_read(ADDR_TX_STATUS, read_data);
        check_masked("TX disabled keeps queued bytes", read_data,
                     32'h0000_0002, 32'h0000_03FF);

        apb_write(ADDR_CTRL, CTRL_TX_EN);
        wait_for_tx_idle;
        apb_read(ADDR_RX_STATUS, read_data);
        check_masked("RX disabled drops loopback", read_data,
                     32'h0000_0100, 32'h0000_03FF);
        check_equal("TX line returns idle", {31'd0, serial_line}, 1);

        apb_write(ADDR_CTRL,
                  CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
        apb_read(ADDR_CTRL, read_data);
        check_equal("CTRL pulse bits read zero", read_data, 3);
        apb_write(ADDR_TX_DATA, 32'hFFFF_0031);
        apb_write(ADDR_TX_DATA, 32'hAAAA_0032);
        wait_for_rx_level(2);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX sequence prime", read_data, 0);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX sequence byte 0", read_data, 8'h31);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX sequence byte 1", read_data, 8'h32);
        apb_read(ADDR_RX_STATUS, read_data);
        check_masked("RX sequence drained", read_data,
                     32'h0000_0100, 32'h0000_03FF);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX empty repeats dout", read_data, 8'h32);

        $display("========== FIFO clear and full behavior ==========");
        apb_write(ADDR_CTRL,
                  CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
        apb_write(ADDR_TX_DATA, 8'hA1);
        wait_for_rx_level(1);
        apb_write(ADDR_CTRL, CTRL_RX_EN | CTRL_RX_CLR);
        apb_read(ADDR_CTRL, read_data);
        check_equal("RX clear preserves RX enable", read_data, CTRL_RX_EN);
        apb_read(ADDR_RX_STATUS, read_data);
        check_equal("RX clear empties FIFO", read_data, 32'h0000_0100);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX clear invalidates dout", read_data, 0);

        apb_write(ADDR_TX_DATA, 8'hB1);
        apb_write(ADDR_TX_DATA, 8'hB2);
        apb_write(ADDR_CTRL, CTRL_RX_EN | CTRL_TX_CLR);
        apb_read(ADDR_TX_STATUS, read_data);
        check_equal("TX clear empties FIFO", read_data, 32'h0000_0100);

        for (index = 0; index < FIFO_DEPTH; index = index + 1)
            apb_write(ADDR_TX_DATA, 8'hC0 + index);
        apb_write(ADDR_TX_DATA, 8'hCF);
        apb_read(ADDR_TX_STATUS, read_data);
        check_masked("TX full drops ninth byte", read_data,
                     32'h0000_0208, 32'h0000_03FF);
        apb_write(ADDR_CTRL, CTRL_RX_EN | CTRL_TX_CLR);

        apb_write(ADDR_CTRL,
                  CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
        for (index = 0; index < FIFO_DEPTH; index = index + 1)
            apb_write(ADDR_TX_DATA, 8'hD0 + index);
        wait_for_rx_level(FIFO_DEPTH);
        apb_read(ADDR_RX_STATUS, read_data);
        check_masked("RX full status", read_data,
                     32'h0000_0208, 32'h0000_03FF);
        apb_write(ADDR_CTRL,
                  CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
        wait_for_tx_idle;

        $display("========== UART framing modes ==========");
        run_loopback_byte(BAUD_RATE, 8'h96);
        run_loopback_byte(32'h2000_0000 | BAUD_RATE, 8'h69);
        run_loopback_byte(32'h4000_0000 | BAUD_RATE, 8'hA5);
        run_loopback_byte(32'h8000_0000 | BAUD_RATE, 8'h5A);

        $display("========== Interrupt selections ==========");
        apb_write(ADDR_CONFIG, BAUD_RATE);
        repeat (40) @(posedge clk);
        apb_write(ADDR_CTRL,
                  CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
        apb_write(ADDR_INTERRUPT, 32'h0000_0001);
        apb_write(ADDR_TX_DATA, 8'hE1);
        wait_for_rx_level(1);
        repeat (3) @(posedge clk);
        check_equal("RX nonempty interrupt", {31'd0, interrupt}, 1);
        apb_read(ADDR_INTERRUPT, read_data);
        check_equal("interrupt sticky observed", {31'd0, read_data[4]}, 1);
        apb_write(ADDR_INTERRUPT, 0);
        repeat (3) @(posedge clk);
        check_equal("interrupt disable", {31'd0, interrupt}, 0);

        apb_write(ADDR_INTERRUPT, 32'h0000_0003);
        repeat (3) @(posedge clk);
        check_equal("TX not full interrupt", {31'd0, interrupt}, 1);
        apb_write(ADDR_INTERRUPT, 0);

        apb_write(ADDR_INTERRUPT, 32'h0001_0005);
        repeat (3) @(posedge clk);
        check_equal("RX threshold interrupt", {31'd0, interrupt}, 1);
        apb_write(ADDR_INTERRUPT, 0);

        apb_write(ADDR_CTRL,
                  CTRL_RX_EN | CTRL_TX_EN | CTRL_RX_CLR | CTRL_TX_CLR);
        wait_for_tx_idle;
        apb_write(ADDR_INTERRUPT, 32'h0000_0007);
        repeat (3) @(posedge clk);
        check_equal("TX threshold interrupt", {31'd0, interrupt}, 1);
        apb_write(ADDR_INTERRUPT, 0);

        $display("========== Soft reset ==========");
        apb_write(ADDR_CTRL, CTRL_RX_EN | CTRL_TX_CLR);
        apb_write(ADDR_TX_DATA, 8'h55);
        apb_read(ADDR_TX_STATUS, read_data);
        check_equal("TX queued before reset", read_data[7:0], 1);
        apb_write(ADDR_CTRL, CTRL_SOFT_RST);
        repeat (3) @(posedge clk);
        apb_read(ADDR_CTRL, read_data);
        check_equal("soft reset CTRL", read_data, 0);
        apb_read(ADDR_CONFIG, read_data);
        check_equal("soft reset CONFIG", read_data, 0);
        apb_read(ADDR_RX_STATUS, read_data);
        check_equal("soft reset RX FIFO", read_data, 32'h0000_0100);
        apb_read(ADDR_TX_STATUS, read_data);
        check_equal("soft reset TX FIFO", read_data, 32'h0000_0100);
        check_equal("soft reset TX idle", {31'd0, serial_line}, 1);

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial begin
        #(CLK_PERIOD*100_000)
        $display("TEST TIMEOUT");
        $finish;
    end

    initial begin
        $dumpfile("apb_uart_tb.vcd");
        $dumpvars(0, apb_uart_tb);
    end

endmodule
