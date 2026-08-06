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
//  Module      : lb2apb
//  Description : Local bus to APB bridge adapter
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
lb2apb #(
    .LB_DATA_WIDTH              (32             ),
    .LB_ADDR_WIDTH              (32             ),
    .APB_DATA_WIDTH             (32             ),
    .APB_ADDR_WIDTH             (8              ))
u_lb2apb (
    .clk                        (clk            ),
    .rst_n                      (rst_n          ),

    .lb_rden                    (lb_rden        ),
    .lb_wren                    (lb_wren        ),
    .lb_wdata                   (lb_wdata       ),
    .lb_addr                    (lb_addr        ),
    .lb_rdata                   (lb_rdata       ),
    .lb_valid                   (lb_valid       ),

    .m_apb_psel                 (m_apb_psel     ),
    .m_apb_penable              (m_apb_penable  ),
    .m_apb_paddr                (m_apb_paddr    ),
    .m_apb_pwrite               (m_apb_pwrite   ),
    .m_apb_pwdata               (m_apb_pwdata   ),
    .m_apb_prdata               (m_apb_prdata   ),
    .m_apb_pready               (m_apb_pready   ));
*/

//================================================================================
//  Module Definition
//================================================================================

module lb2apb #(
    parameter DATA_WIDTH                = 32,
    parameter LB_ADDR_WIDTH             = 32,
    parameter APB_ADDR_WIDTH            = 8
)(
    input                               clk,
    input                               rst_n,

    input                               lb_rden,
    input                               lb_wren,
    input   [(DATA_WIDTH/8)-1:0]        lb_strb,
    input   [DATA_WIDTH-1:0]            lb_wdata,
    input   [LB_ADDR_WIDTH-1:0]         lb_addr,
    output  [DATA_WIDTH-1:0]            lb_rdata,
    output                              lb_valid,

    output                              m_apb_psel,
    output                              m_apb_penable,
    output  [APB_ADDR_WIDTH-1:0]        m_apb_paddr,

    output                              m_apb_pwrite,
    output  [DATA_WIDTH-1:0]            m_apb_pwdata,
    output  [(DATA_WIDTH/8)-1:0]        m_apb_pstrb,

    input   [DATA_WIDTH-1:0]            m_apb_prdata,
    input                               m_apb_pready
);

    localparam MIN_ADDR_WIDTH = LB_ADDR_WIDTH > APB_ADDR_WIDTH ? APB_ADDR_WIDTH : LB_ADDR_WIDTH;

    reg                                 apb_psel;
    reg                                 apb_penable;
    reg     [APB_ADDR_WIDTH-1:0]        apb_paddr;
    reg                                 apb_pwrite;
    reg     [(DATA_WIDTH/8)-1:0]        apb_strb;
    reg     [DATA_WIDTH-1:0]            apb_wdata;

    reg                                 rd_valid;
    reg     [DATA_WIDTH-1:0]            rd_data;

    assign m_apb_psel = apb_psel;
    assign m_apb_penable = apb_penable;
    assign m_apb_paddr = apb_paddr;
    assign m_apb_pwrite = apb_pwrite;
    assign m_apb_pwdata = apb_wdata;
    assign m_apb_pstrb = apb_strb;

    assign lb_rdata = rd_data;
    assign lb_valid = rd_valid;

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            apb_psel <= 1'b0;
            apb_penable <= 1'b0;
            apb_pwrite <= 1'b0;
            apb_paddr <= {APB_ADDR_WIDTH{1'b0}};
            apb_wdata <= {DATA_WIDTH{1'b0}};
            apb_strb <= {(DATA_WIDTH/8){1'b0}};
        end else begin
            apb_psel <= m_apb_psel & m_apb_penable & m_apb_pready ? 1'b0 : lb_rden | lb_wren ? 1'b1 : apb_psel;
            apb_penable <= m_apb_psel & m_apb_penable & m_apb_pready ? 1'b0 : apb_psel ? 1'b1 : apb_penable;
            apb_pwrite <= lb_wren ? 1'b1 : lb_rden ? 1'b0 : apb_pwrite;
            apb_paddr <= lb_addr[MIN_ADDR_WIDTH-1:0];
            apb_wdata <= lb_wdata;
            apb_strb <= lb_strb;
        end
    end

    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            rd_valid <= 1'b0;
            rd_data <= {DATA_WIDTH{1'b0}};
        end else begin
            rd_valid <= m_apb_psel & m_apb_penable & m_apb_pready;
            rd_data <= m_apb_psel & m_apb_penable & m_apb_pready & ~m_apb_pwrite ? m_apb_prdata : rd_data;
        end
    end

endmodule
