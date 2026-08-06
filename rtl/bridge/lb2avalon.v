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
//  Module      : lb2avalon
//  Description : Local bus to Avalon-MM bridge adapter
//--------------------------------------------------------------------------------
//  Copyright (c) 2026 Mercer. All rights reserved.
//  Licensed under the MIT License.
//--------------------------------------------------------------------------------
//  Version History:
//  v1.0 - Initial release
//================================================================================

//================================================================================
//  Instantiation Template
//================================================================================
/*
lb2avalon #(
    .LB_DATA_WIDTH              (32                 ),
    .LB_ADDR_WIDTH              (32                 ),
    .AV_DATA_WIDTH              (32                 ),
    .AV_ADDR_WIDTH              (8                  ))
u_lb2avalon (
    .clk                        (clk                ),
    .rst_n                      (rst_n              ),

    .lb_rden                    (lb_rden            ),
    .lb_wren                    (lb_wren            ),
    .lb_wdata                   (lb_wdata           ),
    .lb_addr                    (lb_addr            ),
    .lb_rdata                   (lb_rdata           ),
    .lb_valid                   (lb_valid           ),

    .m_av_address               (m_av_address       ),
    .m_av_read                  (m_av_read          ),
    .m_av_write                 (m_av_write         ),
    .m_av_writedata             (m_av_writedata     ),
    .m_av_byteenable            (m_av_byteenable    ),
    .m_av_waitrequest           (m_av_waitrequest   ),
    .m_av_readdata              (m_av_readdata      ),
    .m_av_readdatavalid         (m_av_readdatavalid ));
*/

//================================================================================
//  Module Definition
//================================================================================

module lb2avalon #(
    parameter DATA_WIDTH                = 32,
    parameter LB_ADDR_WIDTH             = 32,
    parameter AV_ADDR_WIDTH             = 8
)(
    input                               clk,
    input                               rst_n,

    input                               lb_rden,
    input                               lb_wren,
    input   [(DATA_WIDTH/8)-1:0]        lb_strb,
    input   [DATA_WIDTH-1:0]            lb_wdata,
    input   [LB_ADDR_WIDTH-1:0]         lb_addr,
    output  reg [DATA_WIDTH-1:0]        lb_rdata,
    output  reg                         lb_valid,
    output  reg                         lb_wrack,

    output  reg [AV_ADDR_WIDTH-1:0]     m_av_address,
    output  reg                         m_av_read,
    output  reg                         m_av_write,
    output  reg [DATA_WIDTH-1:0]        m_av_writedata,
    output  reg [(DATA_WIDTH/8)-1:0]    m_av_byteenable,
    input                               m_av_waitrequest,
    input   [DATA_WIDTH-1:0]            m_av_readdata,
    input                               m_av_readdatavalid
);

    localparam MIN_ADDR_WIDTH = LB_ADDR_WIDTH > AV_ADDR_WIDTH ? AV_ADDR_WIDTH : LB_ADDR_WIDTH;
    localparam ADDR_LSB = (DATA_WIDTH / 32) + 1;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            m_av_read <= 1'b0;
            m_av_write <= 1'b0;
            m_av_address <= {AV_ADDR_WIDTH{1'b0}};
            m_av_writedata <= {DATA_WIDTH{1'b0}};
            m_av_byteenable <= {(DATA_WIDTH/8){1'b0}};
        end else begin
            m_av_read <= lb_rden ? 1'b1 : m_av_read & ~m_av_waitrequest ? 1'b0 : m_av_read;
            m_av_write <= lb_wren ? 1'b1 : m_av_write & ~m_av_waitrequest ? 1'b0 : m_av_write;
            m_av_address <= lb_addr[MIN_ADDR_WIDTH-1:0];
            m_av_writedata <= lb_wdata;
            m_av_byteenable <= lb_strb;
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            lb_rdata <= {DATA_WIDTH{1'b0}};
            lb_valid <= 1'b0;
        end else begin
            lb_rdata <= m_av_readdata;
            lb_valid <= (m_av_write & ~m_av_waitrequest) | m_av_readdatavalid;
        end
    end

endmodule
