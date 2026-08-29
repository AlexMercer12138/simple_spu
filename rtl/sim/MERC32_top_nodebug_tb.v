`timescale 1ns / 1ps

module MERC32_top_nodebug_tb;

    localparam  CLK_HALF_PERIOD         = 5;
    localparam  TCK_HALF_PERIOD         = 17;

    reg                                 clk = 1'b0;
    reg                                 rst_n = 1'b0;
    reg                                 interrupt = 1'b0;
    reg                                 tck = 1'b0;
    reg                                 tms = 1'b0;
    reg                                 tdi = 1'b0;
    wire                                tdo;

    wire                                dlb_rden;
    wire                                dlb_wren;
    wire    [7:0]                       dlb_addr;
    wire    [3:0]                       dlb_strb;
    wire    [31:0]                      dlb_wdata;
    reg     [31:0]                      dlb_rdata = 32'h0;
    reg                                 dlb_ack = 1'b0;

    wire                                ilb_rden;
    wire                                ilb_wren;
    wire    [7:0]                       ilb_addr;
    wire    [3:0]                       ilb_strb;
    wire    [31:0]                      ilb_wdata;
    reg     [31:0]                      ilb_rdata = 32'h0;
    reg                                 ilb_ack = 1'b0;

    wire                                plb_rden;
    wire                                plb_wren;
    wire    [31:0]                      plb_addr;
    wire    [3:0]                       plb_strb;
    wire    [31:0]                      plb_wdata;

    reg     [31:0]                      instruction_memory [0:255];
    integer                             fetches = 0;
    integer                             failures = 0;
    integer                             index;

    always #(CLK_HALF_PERIOD) clk = ~clk;
    always #(TCK_HALF_PERIOD) tck = ~tck;

    initial #(CLK_HALF_PERIOD * 7) rst_n = 1'b1;

    always @(posedge clk) begin
        if(!rst_n) begin
            ilb_ack <= 1'b0;
            ilb_rdata <= 32'h0;
            dlb_ack <= 1'b0;
            dlb_rdata <= 32'h0;
        end else begin
            ilb_ack <= ilb_rden | ilb_wren;
            if(ilb_rden) begin
                ilb_rdata <= instruction_memory[ilb_addr];
                fetches <= fetches + 1;
            end
            dlb_ack <= dlb_rden | dlb_wren;
        end
    end

    always @(posedge tck) begin
        if(rst_n && (tdo !== 1'b0)) begin
            failures = failures + 1;
            $display("TEST FAIL: disabled debug must hold tdo low");
        end
    end

    MERC32_top #(
        .ILB_ADDR_WIDTH                 (8                      ),
        .DLB_ADDR_WIDTH                 (8                      ),
        .DEBUG_EN                       (0                      ))
    merc32_top_inst (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),
        .interrupt                      (interrupt              ),
        .tck                            (tck                    ),
        .tms                            (tms                    ),
        .tdi                            (tdi                    ),
        .tdo                            (tdo                    ),
        .dlb_rden                       (dlb_rden               ),
        .dlb_wren                       (dlb_wren               ),
        .dlb_addr                       (dlb_addr               ),
        .dlb_strb                       (dlb_strb               ),
        .dlb_wdata                      (dlb_wdata              ),
        .dlb_rdata                      (dlb_rdata              ),
        .dlb_ack                        (dlb_ack                ),
        .ilb_rden                       (ilb_rden               ),
        .ilb_wren                       (ilb_wren               ),
        .ilb_addr                       (ilb_addr               ),
        .ilb_strb                       (ilb_strb               ),
        .ilb_wdata                      (ilb_wdata              ),
        .ilb_rdata                      (ilb_rdata              ),
        .ilb_ack                        (ilb_ack                ),
        .plb_rden                       (plb_rden               ),
        .plb_wren                       (plb_wren               ),
        .plb_addr                       (plb_addr               ),
        .plb_strb                       (plb_strb               ),
        .plb_wdata                      (plb_wdata              ),
        .plb_rdata                      (32'h0                  ),
        .plb_ack                        (1'b0                   ));

    initial begin
        // $dumpfile("MERC32_top_nodebug_tb.vcd");
        // $dumpvars(0, MERC32_top_nodebug_tb);

        for(index = 0; index < 256; index = index + 1)
            instruction_memory[index] = 32'h0;

        @(posedge rst_n);
        repeat(100) @(posedge clk);

        if(fetches < 3) begin
            failures = failures + 1;
            $display("TEST FAIL: disabled debug build did not continue fetching");
        end
        if(tdo !== 1'b0) begin
            failures = failures + 1;
            $display("TEST FAIL: disabled debug final tdo value is not zero");
        end

        if(failures == 0)
            $display("TEST PASS: MERC32_top DEBUG_EN=0 fetches=%0d", fetches);
        else
            $display("TEST FAIL: MERC32_top DEBUG_EN=0 failures=%0d", failures);
        $finish;
    end

    initial #(CLK_HALF_PERIOD * 2000) begin
        $display("TEST TIMEOUT: MERC32_top DEBUG_EN=0");
        $finish;
    end

endmodule
