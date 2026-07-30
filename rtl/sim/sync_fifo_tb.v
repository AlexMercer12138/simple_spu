`timescale 1ns/1ps

module sync_fifo_tb;

    localparam CLK_PERIOD = 10;
    localparam FIFO_DEPTH = 8;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         wr_en = 1'b0;
    reg  [7:0]  din = 8'd0;
    reg         rd_en = 1'b0;
    wire [7:0]  dout;
    wire        empty;
    wire        full;
    wire [3:0]  data_cnt;

    integer     error_count = 0;
    integer     index;

    sync_fifo #(
        .DATA_WIDTH (8),
        .FIFO_DEPTH (FIFO_DEPTH)
    ) sync_fifo_inst (
        .clk      (clk),
        .rst_n    (rst_n),
        .wr_en    (wr_en),
        .din      (din),
        .rd_en    (rd_en),
        .dout     (dout),
        .empty    (empty),
        .full     (full),
        .data_cnt (data_cnt)
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

    task fifo_write;
        input [7:0] value;
        begin
            @(negedge clk);
            din <= value;
            wr_en <= 1'b1;
            @(posedge clk);
            #1;
            @(negedge clk);
            wr_en <= 1'b0;
            din <= 8'd0;
        end
    endtask

    task fifo_read;
        input [7:0] expected;
        begin
            @(negedge clk);
            rd_en <= 1'b1;
            @(posedge clk);
            #1;
            rd_en <= 1'b0;
            check_equal("registered FIFO read", {24'd0, dout},
                        {24'd0, expected});
            @(negedge clk);
        end
    endtask

    initial begin
        wait (rst_n);
        repeat (2) @(posedge clk);

        check_equal("reset empty", {31'd0, empty}, 1);
        check_equal("reset not full", {31'd0, full}, 0);
        check_equal("reset count", {28'd0, data_cnt}, 0);

        fifo_write(8'hA1);
        fifo_write(8'hB2);
        check_equal("two writes count", {28'd0, data_cnt}, 2);
        fifo_read(8'hA1);
        check_equal("one entry remains", {28'd0, data_cnt}, 1);
        fifo_read(8'hB2);
        check_equal("drain sets empty", {31'd0, empty}, 1);

        @(negedge clk);
        rd_en <= 1'b1;
        @(posedge clk);
        #1;
        rd_en <= 1'b0;
        check_equal("empty read keeps count", {28'd0, data_cnt}, 0);
        check_equal("empty read keeps dout", {24'd0, dout}, 8'hB2);

        for (index = 0; index < FIFO_DEPTH; index = index + 1)
            fifo_write(8'hC0 + index);
        check_equal("full count", {28'd0, data_cnt}, FIFO_DEPTH);
        check_equal("full flag", {31'd0, full}, 1);

        @(negedge clk);
        din <= 8'hEE;
        wr_en <= 1'b1;
        rd_en <= 1'b1;
        @(posedge clk);
        #1;
        wr_en <= 1'b0;
        rd_en <= 1'b0;
        din <= 8'd0;
        check_equal("full simultaneous read data", {24'd0, dout}, 8'hC0);
        check_equal("full simultaneous level", {28'd0, data_cnt}, 7);
        check_equal("full clears after read", {31'd0, full}, 0);

        for (index = 1; index < FIFO_DEPTH; index = index + 1)
            fifo_read(8'hC0 + index);
        check_equal("replacement write rejected", {24'd0, dout}, 8'hC7);
        check_equal("final empty", {31'd0, empty}, 1);

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial begin
        #(CLK_PERIOD*1000)
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("sync_fifo_tb.vcd");
    //     $dumpvars(0, sync_fifo_tb);
    // end

endmodule
