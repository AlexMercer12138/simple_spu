//================================================================================
//
//  ███╗   ███╗███████╗██████╗  ██████╗███████╗██████╗
//  ████╗ ████║██╔════╝██╔══██╗██╔════╝██╔════╝██╔══██╗
//  ██╔████╔██║█████╗  ██████╔╝██║     █████╗  ██████╔╝
//  ██║╚██╔╝██║██╔══╝  ██╔══██╗██║     ██╔══╝  ██╔══██╗
//  ██║ ╚═╝ ██║███████╗██║  ██║╚██████╗███████╗██║  ██║
//  ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝
//
//--------------------------------------------------------------------------------
//  Author      : Mercer
//  Module      : sync_fifo
//  Description : Synchronous FIFO module
//--------------------------------------------------------------------------------
//  Copyright (c) 2026 Mercer. All rights reserved.
//  Licensed under the MIT License.
//--------------------------------------------------------------------------------
//  Version History:
//  v1.0 - Initial release
//================================================================================
//  Instantiation Template
//================================================================================
/*
sync_fifo #(
    .DATA_WIDTH                 (8              ),
    .FIFO_DEPTH                 (8              ))
u_sync_fifo (
    .clk                        (clk            ),
    .rst_n                      (rst_n          ),

    .wr_en                      (wr_en          ),
    .din                        (din            ),
    .rd_en                      (rd_en          ),
    .dout                       (dout           ),

    .empty                      (empty          ),
    .full                       (full           ),

    .data_cnt                   (data_cnt       ));
*/

//================================================================================
//  Module Definition
//================================================================================

module sync_fifo #(
    parameter   DATA_WIDTH              = 8,
    parameter   FIFO_DEPTH              = 8
) (
    input                               clk,
    input                               rst_n,

    input                               wr_en,
    input   [DATA_WIDTH-1:0]            din,
    input                               rd_en,
    output  [DATA_WIDTH-1:0]            dout,

    output                              empty,
    output                              full,

    output  reg [$clog2(FIFO_DEPTH):0]  data_cnt
);

    localparam  ADDR_WIDTH = $clog2(FIFO_DEPTH);

    reg     [DATA_WIDTH-1:0]            ram [(1<<ADDR_WIDTH)-1:0];
    reg     [ADDR_WIDTH-1:0]            wr_ptr;
    reg     [ADDR_WIDTH-1:0]            rd_ptr;
    reg     [DATA_WIDTH-1:0]            rd_data;

    wire                                fifo_wren;
    wire                                fifo_rden;

    assign fifo_wren = wr_en & ~full;
    assign fifo_rden = rd_en & ~empty;
    assign dout = rd_data;
    assign empty = !data_cnt;
    assign full = data_cnt[ADDR_WIDTH];

    always @(posedge clk) begin
        if (!rst_n) begin
            wr_ptr <= 'd0;
        end else if (fifo_wren) begin
            wr_ptr <= wr_ptr + 'd1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            rd_ptr <= 'd0;
        end else if (fifo_rden) begin
            rd_ptr <= rd_ptr + 'd1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            data_cnt <= 0;
        end else begin
            case ({fifo_wren, fifo_rden})
                2'b10:   data_cnt <= data_cnt + 1;
                2'b01:   data_cnt <= data_cnt - 1;
                default: data_cnt <= data_cnt;
            endcase
        end
    end

    always @(posedge clk) begin
        if (fifo_wren)
            ram[wr_ptr] <= din;
    end

    always @(posedge clk) begin
        if (fifo_rden)
            rd_data <= ram[rd_ptr];
    end

    initial begin : initialization
        integer i;
        for (i = 0; i < (1<<ADDR_WIDTH); i = i + 8) begin
            ram[i + 0] = 0;
            ram[i + 1] = 0;
            ram[i + 2] = 0;
            ram[i + 3] = 0;
            ram[i + 4] = 0;
            ram[i + 5] = 0;
            ram[i + 6] = 0;
            ram[i + 7] = 0;
        end
    end

endmodule
