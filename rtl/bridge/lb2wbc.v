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
//  Module      : lb2wbc
//  Description : Local bus to Wishbone B4 classic bridge adapter
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
lb2wbc #(
    .LB_DATA_WIDTH              (32             ),
    .LB_ADDR_WIDTH              (32             ),
    .WB_DATA_WIDTH              (32             ),
    .WB_ADDR_WIDTH              (8              ))
u_lb2wbc (
    .clk                        (clk            ),
    .rst_n                      (rst_n          ),

    .lb_rden                    (lb_rden        ),
    .lb_wren                    (lb_wren        ),
    .lb_wdata                   (lb_wdata       ),
    .lb_addr                    (lb_addr        ),
    .lb_rdata                   (lb_rdata       ),
    .lb_valid                   (lb_valid       ),

    .m_wb_cyc_o                 (m_wb_cyc_o     ),
    .m_wb_stb_o                 (m_wb_stb_o     ),
    .m_wb_we_o                  (m_wb_we_o      ),
    .m_wb_adr_o                 (m_wb_adr_o     ),
    .m_wb_dat_o                 (m_wb_dat_o     ),
    .m_wb_sel_o                 (m_wb_sel_o     ),
    .m_wb_ack_i                 (m_wb_ack_i     ),
    .m_wb_dat_i                 (m_wb_dat_i     ));
*/

//================================================================================
//  Module Definition
//================================================================================

module lb2wbc #(
    parameter DATA_WIDTH                = 32,
    parameter LB_ADDR_WIDTH             = 32,
    parameter WB_ADDR_WIDTH             = 8
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

    output  reg                         m_wb_cyc_o,
    output  reg                         m_wb_stb_o,
    output  reg                         m_wb_we_o,
    output  reg [WB_ADDR_WIDTH-1:0]     m_wb_adr_o,
    output  reg [DATA_WIDTH-1:0]        m_wb_dat_o,
    output  reg [(DATA_WIDTH/8)-1:0]    m_wb_sel_o,
    input                               m_wb_ack_i,
    input   [DATA_WIDTH-1:0]            m_wb_dat_i
);

    localparam MIN_ADDR_WIDTH = LB_ADDR_WIDTH > WB_ADDR_WIDTH ? WB_ADDR_WIDTH : LB_ADDR_WIDTH;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            m_wb_cyc_o <= 1'b0;
            m_wb_stb_o <= 1'b0;
            m_wb_we_o <= 1'b0;
            m_wb_adr_o <= {WB_ADDR_WIDTH{1'b0}};
            m_wb_dat_o <= {DATA_WIDTH{1'b0}};
            m_wb_sel_o <= {(DATA_WIDTH/8){1'b0}};
        end else begin
            m_wb_cyc_o <= lb_rden | lb_wren ? 1'b1 : m_wb_cyc_o & m_wb_stb_o & m_wb_ack_i ? 1'b0 : m_wb_cyc_o;
            m_wb_stb_o <= lb_rden | lb_wren ? 1'b1 : m_wb_cyc_o & m_wb_stb_o & m_wb_ack_i ? 1'b0 : m_wb_stb_o;
            m_wb_we_o <= lb_wren ? 1'b1 : lb_rden ? 1'b0 : m_wb_we_o;
            m_wb_adr_o <= lb_addr[MIN_ADDR_WIDTH-1:0];
            m_wb_dat_o <= lb_wdata;
            m_wb_sel_o <= lb_strb;
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            lb_rdata <= {DATA_WIDTH{1'b0}};
            lb_valid <= 1'b0;
        end else begin
            lb_rdata <= m_wb_dat_i;
            lb_valid <= m_wb_cyc_o & m_wb_stb_o & m_wb_ack_i;
        end
    end

endmodule
