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
//  Description : Synchronous FIFO with width convertor supporting
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
    .ENDIAN                     (0              ),
    .DIN_WIDTH                  (8              ),
    .DOUT_WIDTH                 (16             ),
    .DIN_DEPTH                  (256            ))
sync_fifo (
    .clk                        (clk            ),
    .rst_n                      (rst_n          ),

    .wr_en                      (wr_en          ),
    .din                        (din            ),
    .rd_en                      (rd_en          ),
    .dout                       (dout           ),

    .empty                      (empty          ),
    .full                       (full           ),

    .wr_data_cnt                (wr_data_cnt    ),
    .rd_data_cnt                (rd_data_cnt    ));
*/

//================================================================================
//  Module Definition
//================================================================================

module fifo_width_convertor#(
    parameter ENDIAN                    = 0,
    parameter DIN_WIDTH                 = 8,
    parameter DOUT_WIDTH                = 16,
    parameter DIN_DEPTH                 = 256,
    parameter DOUT_DEPTH                = (DIN_WIDTH*DIN_DEPTH)/DOUT_WIDTH
)(
    input                               clk,
    input                               rst_n,

    input                               wr_en,
    input   [DIN_WIDTH-1:0]             din,
    input                               rd_en,
    output  [DOUT_WIDTH-1:0]            dout,

    output                              empty,
    output                              full,

    output  reg [$clog2(DIN_DEPTH):0]   wr_data_cnt,
    output  reg [$clog2(DOUT_DEPTH):0]  rd_data_cnt
    );

    localparam  WIDTH_MODE = 
        DOUT_WIDTH > DIN_WIDTH ? "n2w" : 
        DOUT_WIDTH < DIN_WIDTH ? "w2n" : "default";

    wire                                fifo_wren;
    wire                                fifo_rden;

    assign  fifo_wren = wr_en & !full;
    assign  fifo_rden = rd_en & !empty;

generate
    if(WIDTH_MODE == "n2w") begin : narrow_to_wide
        localparam  WIDTH_RATIO = DOUT_WIDTH / DIN_WIDTH;
        localparam  ADDR_WIDTH = $clog2(DOUT_DEPTH);

        reg     [DOUT_WIDTH-1:0]            ram [(1<<ADDR_WIDTH)-1:0];
        reg     [7:0]                       wr_cnt;
        reg     [DOUT_WIDTH-1:0]            wr_data;
        reg                                 wr_valid;
        reg     [ADDR_WIDTH:0]              wr_ptr;
        reg     [ADDR_WIDTH:0]              rd_ptr;
        reg     [DOUT_WIDTH-1:0]            rd_data;

        assign  dout = rd_data;
        assign  full = (wr_ptr[ADDR_WIDTH] != rd_ptr[ADDR_WIDTH]) && (wr_ptr[ADDR_WIDTH-1:0] == rd_ptr[ADDR_WIDTH-1:0]);
        assign  empty = (wr_ptr[ADDR_WIDTH] == rd_ptr[ADDR_WIDTH]) && (wr_ptr[ADDR_WIDTH-1:0] == rd_ptr[ADDR_WIDTH-1:0]);

        always @(posedge clk) begin
            if(!rst_n) begin
                wr_cnt <= 0;
            end else if(fifo_wren) begin
                wr_cnt <= wr_cnt == WIDTH_RATIO - 1 ? 0 : wr_cnt + 1;
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                wr_data <= 0;
            end else if(ENDIAN) begin
                if(fifo_wren) 
                    wr_data[DOUT_WIDTH-(DIN_WIDTH*wr_cnt)-1 -: DIN_WIDTH] <= din;
            end else begin
                if(fifo_wren)
                    wr_data[DIN_WIDTH*wr_cnt +: DIN_WIDTH] <= din;
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                wr_valid <= 0;
            end else begin
                wr_valid <= fifo_wren & (wr_cnt == WIDTH_RATIO - 1);
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                wr_ptr <= 0;
            end else if(wr_valid) begin
                wr_ptr <= wr_ptr + 1;
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                rd_ptr <= 0;
            end else if(rd_en) begin
                rd_ptr <= rd_ptr + 1;
            end
        end

        always @(posedge clk) begin
            if (!rst_n) begin
                wr_data_cnt <= 0;
            end else begin
                case ({fifo_wren, fifo_rden})
                    2'b10:   wr_data_cnt <= wr_data_cnt + 1;
                    2'b01:   wr_data_cnt <= wr_data_cnt - WIDTH_RATIO;
                    2'b11:   wr_data_cnt <= wr_data_cnt - (WIDTH_RATIO - 1);
                    default: wr_data_cnt <= wr_data_cnt;
                endcase
            end
        end

        always @(posedge clk) begin
            if (!rst_n) begin
                rd_data_cnt <= 0;
            end else begin
                case ({wr_valid, fifo_rden})
                    2'b10:   rd_data_cnt <= rd_data_cnt + 1;
                    2'b01:   rd_data_cnt <= rd_data_cnt - 1;
                    default: rd_data_cnt <= rd_data_cnt;
                endcase
            end
        end

        always @(posedge clk) begin
            if (wr_valid & !full)
                ram[wr_ptr] <= wr_data;
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

    end else if(WIDTH_MODE == "w2n") begin : wide_to_narrow
        localparam  WIDTH_RATIO = DIN_WIDTH / DOUT_WIDTH;
        localparam  ADDR_WIDTH = $clog2(DIN_DEPTH);

        reg     [DIN_WIDTH-1:0]             ram [(1<<ADDR_WIDTH)-1:0];
        reg     [7:0]                       rd_cnt;
        reg     [DOUT_WIDTH-1:0]            rd_data;
        reg                                 rd_valid;
        reg     [DIN_WIDTH-1:0]             rd_data_full;
        reg     [ADDR_WIDTH:0]              wr_ptr;
        reg     [ADDR_WIDTH:0]              rd_ptr;

        assign  dout = rd_data;
        assign  full =  (wr_ptr[ADDR_WIDTH] != rd_ptr[ADDR_WIDTH]) && (wr_ptr[ADDR_WIDTH-1:0] == rd_ptr[ADDR_WIDTH-1:0]);
        assign  empty = (wr_ptr[ADDR_WIDTH] == rd_ptr[ADDR_WIDTH]) && (wr_ptr[ADDR_WIDTH-1:0] == rd_ptr[ADDR_WIDTH-1:0]);

        always @(posedge clk) begin
            if(!rst_n) begin
                rd_cnt <= 0;
            end else if(fifo_rden) begin
                rd_cnt <= rd_cnt == WIDTH_RATIO - 1 ? 0 : rd_cnt + 1;
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                rd_data <= 0;
            end else if(ENDIAN) begin
                if(fifo_rden)
                    rd_data <= rd_data_full[DIN_WIDTH-(8*rd_cnt)-1 -: DOUT_WIDTH];
            end else begin
                if(fifo_rden)
                    rd_data <= rd_data_full[DOUT_WIDTH*rd_cnt +: DOUT_WIDTH];
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                rd_valid <= 0;
            end else begin
                rd_valid <= fifo_rden & (rd_cnt == WIDTH_RATIO - 1);
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                wr_ptr <= 0;
            end else if(fifo_wren) begin
                wr_ptr <= wr_ptr + 1;
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                rd_ptr <= 0;
            end else if(rd_valid & !empty) begin
                rd_ptr <= rd_ptr + 1;
            end
        end

        always @(posedge clk) begin
            if (!rst_n) begin
                wr_data_cnt <= 0;
            end else begin
                case ({fifo_wren, rd_valid & !empty})
                    2'b10:   wr_data_cnt <= wr_data_cnt + 1;
                    2'b01:   wr_data_cnt <= wr_data_cnt - 1;
                    default: wr_data_cnt <= wr_data_cnt;
                endcase
            end
        end

        always @(posedge clk) begin
            if (!rst_n) begin
                rd_data_cnt <= 0;
            end else begin
                case ({fifo_wren, fifo_rden})
                    2'b10:   rd_data_cnt <= rd_data_cnt + WIDTH_RATIO;
                    2'b01:   rd_data_cnt <= rd_data_cnt - 1;
                    2'b11:   rd_data_cnt <= rd_data_cnt + (WIDTH_RATIO - 1);
                    default: rd_data_cnt <= rd_data_cnt;
                endcase
            end
        end

        always @(posedge clk) begin
            if (fifo_wren)
                ram[wr_ptr] <= din;
        end

        always @(posedge clk) begin
            if (rd_valid & !empty)
                rd_data_full <= ram[rd_ptr];
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

    end else begin : default_fifo
        localparam  ADDR_WIDTH = $clog2(DOUT_DEPTH);

        reg     [DOUT_WIDTH-1:0]            ram [(1<<ADDR_WIDTH)-1:0];
        reg     [ADDR_WIDTH:0]              wr_ptr;
        reg     [ADDR_WIDTH:0]              rd_ptr;
        reg     [DOUT_WIDTH-1:0]            rd_data;

        assign  dout = rd_data;
        assign  full =  (wr_ptr[ADDR_WIDTH] != rd_ptr[ADDR_WIDTH]) && (wr_ptr[ADDR_WIDTH-1:0] == rd_ptr[ADDR_WIDTH-1:0]);
        assign  empty = (wr_ptr[ADDR_WIDTH] == rd_ptr[ADDR_WIDTH]) && (wr_ptr[ADDR_WIDTH-1:0] == rd_ptr[ADDR_WIDTH-1:0]);

        always @(posedge clk) begin
            if(!rst_n) begin
                wr_ptr <= 0;
            end else if(fifo_wren) begin
                wr_ptr <= wr_ptr + 1;
            end
        end

        always @(posedge clk) begin
            if(!rst_n) begin
                rd_ptr <= 0;
            end else if(fifo_rden) begin
                rd_ptr <= rd_ptr + 1;
            end
        end

        always @(posedge clk) begin
            if (!rst_n) begin
                wr_data_cnt <= 0;
            end else begin
                case ({fifo_wren, fifo_rden})
                    2'b10:   wr_data_cnt <= wr_data_cnt + 1;
                    2'b01:   wr_data_cnt <= wr_data_cnt - 1;
                    default: wr_data_cnt <= wr_data_cnt;
                endcase
            end
        end

        always @(posedge clk) begin
            if (!rst_n) begin
                rd_data_cnt <= 0;
            end else begin
                case ({fifo_wren, fifo_rden})
                    2'b10:   rd_data_cnt <= rd_data_cnt + 1;
                    2'b01:   rd_data_cnt <= rd_data_cnt - 1;
                    default: rd_data_cnt <= rd_data_cnt;
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

    end
endgenerate

endmodule
