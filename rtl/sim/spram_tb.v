`timescale 1ns / 1ps

module spram_tb;

    localparam ADDR_WIDTH = 4;

    reg                         clk = 1'b0;
    reg                         wr = 1'b0;
    reg                         rd = 1'b0;
    reg     [3:0]               be = 4'b0000;
    reg     [31:0]              din = 32'h0000_0000;
    reg     [ADDR_WIDTH-1:0]    addr = {ADDR_WIDTH{1'b0}};
    wire    [31:0]              dout;
    wire                        ack;

    integer checks = 0;
    integer failures = 0;

    spram #(
        .ADDR_WIDTH (ADDR_WIDTH),
        .INIT_FILE (""))
    spram_inst (
        .clk        (clk),
        .wr         (wr),
        .rd         (rd),
        .be         (be),
        .din        (din),
        .dout       (dout),
        .addr       (addr),
        .ack        (ack));

    always #5 clk = ~clk;

    task check_value;
        input [8*48-1:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            checks = checks + 1;
            if (actual !== expected) begin
                failures = failures + 1;
                $display("TEST FAIL: %0s expected=%08x actual=%08x",
                         name, expected, actual);
            end
        end
    endtask

    task write_word;
        input [ADDR_WIDTH-1:0] address;
        input [3:0] byte_enable;
        input [31:0] data;
        begin
            @(negedge clk);
            addr <= address;
            be <= byte_enable;
            din <= data;
            wr <= 1'b1;
            rd <= 1'b0;
            @(negedge clk);
            wr <= 1'b0;
            be <= 4'b0000;
            check_value("write ack asserted", {31'd0, ack}, 32'd1);
            @(negedge clk);
            check_value("write ack is one cycle", {31'd0, ack}, 32'd0);
        end
    endtask

    task read_word;
        input [ADDR_WIDTH-1:0] address;
        input [31:0] expected;
        begin
            @(negedge clk);
            addr <= address;
            rd <= 1'b1;
            wr <= 1'b0;
            @(negedge clk);
            rd <= 1'b0;
            check_value("read ack asserted", {31'd0, ack}, 32'd1);
            check_value("read data", dout, expected);
            @(negedge clk);
            check_value("read ack is one cycle", {31'd0, ack}, 32'd0);
        end
    endtask

    initial begin
        repeat (2) @(negedge clk);
        check_value("idle ack low", {31'd0, ack}, 32'd0);

        write_word(4'h2, 4'b1111, 32'h1122_3344);
        read_word(4'h2, 32'h1122_3344);

        write_word(4'h2, 4'b0001, 32'h0000_00aa);
        write_word(4'h2, 4'b0010, 32'h0000_bb00);
        write_word(4'h2, 4'b0100, 32'h00cc_0000);
        write_word(4'h2, 4'b1000, 32'hdd00_0000);
        read_word(4'h2, 32'hddcc_bbaa);

        @(negedge clk);
        addr <= 4'h2;
        be <= 4'b1111;
        din <= 32'ha5a5_5a5a;
        wr <= 1'b1;
        rd <= 1'b1;
        @(negedge clk);
        wr <= 1'b0;
        rd <= 1'b0;
        be <= 4'b0000;
        check_value("read-write ack asserted", {31'd0, ack}, 32'd1);
        check_value("same-cycle read is read-first", dout, 32'hddcc_bbaa);
        @(negedge clk);
        check_value("read-write ack is one cycle", {31'd0, ack}, 32'd0);
        read_word(4'h2, 32'ha5a5_5a5a);

        if (failures == 0)
            $display("TEST PASS: spram checks=%0d", checks);
        else
            $display("TEST FAIL: spram failures=%0d checks=%0d", failures, checks);
        $finish;
    end

    initial #5000 begin
        $display("TEST TIMEOUT: spram checks=%0d failures=%0d", checks, failures);
        $finish;
    end

    // initial begin
    //     $dumpfile("spram_tb.vcd");
    //     $dumpvars(0, spram_tb);
    // end

endmodule
