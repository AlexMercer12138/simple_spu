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
//  Module      : MERC32_top
//  Description : MERC32 CPU top-level wrapper with selectable bus interface
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
MERC32_top #(
    .ILB_ADDR_WIDTH             (16             ),
    .DLB_ADDR_WIDTH             (16             ),
    .ILB_INIT_FILE              (""             ),
    .DLB_INIT_FILE              (""             ))
u_MERC32_top (
    .clk                        (clk            ),
    .rst_n                      (rst_n          ),
    .interrupt                  (interrupt      ));
*/

//================================================================================
//  Module Definition
//================================================================================

// `define IF_AXI_LITE
`define IF_APB
// `define IF_WBC
// `define IF_AVALON
// `define IF_DRP

module MERC32_top #(
    parameter   ILB_ADDR_WIDTH          = 16,
    parameter   DLB_ADDR_WIDTH          = 16,
    parameter   ILB_INIT_FILE           = "",
    parameter   DLB_INIT_FILE           = ""
) (
    input                               clk,
    input                               rst_n,

    input                               interrupt,

    output                              dlb_en,
    output                              dlb_we,
    output      [DLB_ADDR_WIDTH-1:0]    dlb_addr,
    output      [31:0]                  dlb_wdata,
    input       [31:0]                  dlb_rdata,

    output                              ilb_en,
    output                              ilb_we,
    output      [ILB_ADDR_WIDTH-1:0]    ilb_addr,
    output      [31:0]                  ilb_wdata,
    input       [31:0]                  ilb_rdata

`ifdef IF_AXI_LITE
    ,
    output                              m_axi_awvalid,
    input                               m_axi_awready,
    output  [31:0]                      m_axi_awaddr,
    output                              m_axi_wvalid,
    input                               m_axi_wready,
    output  [31:0]                      m_axi_wdata,
    output  [3:0]                       m_axi_wstrb,
    input                               m_axi_bvalid,
    output                              m_axi_bready,
    input   [1:0]                       m_axi_bresp,
    output                              m_axi_arvalid,
    input                               m_axi_arready,
    output  [31:0]                      m_axi_araddr,
    input                               m_axi_rvalid,
    output                              m_axi_rready,
    input   [31:0]                      m_axi_rdata,
    input   [1:0]                       m_axi_rresp
`elsif IF_APB
    ,
    output                              m_apb_psel,
    output                              m_apb_penable,
    output  [31:0]                      m_apb_paddr,
    output                              m_apb_pwrite,
    output  [31:0]                      m_apb_pwdata,
    input   [31:0]                      m_apb_prdata,
    input                               m_apb_pready
`elsif IF_WBC
    ,
    output                              m_wb_cyc_o,
    output                              m_wb_stb_o,
    output                              m_wb_we_o,
    output  [31:0]                      m_wb_adr_o,
    output  [31:0]                      m_wb_dat_o,
    output  [3:0]                       m_wb_sel_o,
    input                               m_wb_ack_i,
    input   [31:0]                      m_wb_dat_i
`elsif IF_AVALON
    ,
    output  [31:0]                      m_av_address,
    output                              m_av_read,
    output                              m_av_write,
    output  [31:0]                      m_av_writedata,
    output  [3:0]                       m_av_byteenable,
    input                               m_av_waitrequest,
    input   [31:0]                      m_av_readdata,
    input                               m_av_readdatavalid
`elsif IF_DRP
    ,
    output  [31:0]                      drp_addr,
    output                              drp_en,
    output                              drp_we,
    input                               drp_rdy,
    output  [31:0]                      drp_in,
    input   [31:0]                      drp_out
`else
    ,
    output                              lb_rden,
    output                              lb_wren,
    output  [31:0]                      lb_addr,
    output  [31:0]                      lb_wdata,
    input   [31:0]                      lb_rdata,
    input                               lb_valid
`endif
);

    wire                                cpu_plb_rden;
    wire                                cpu_plb_wren;
    wire    [31:0]                      cpu_plb_addr;
    wire    [31:0]                      cpu_plb_wdata;
    wire    [31:0]                      cpu_plb_rdata;
    wire                                cpu_plb_ack;

    //----------------------------------------------------------------------------
    // merc32_core instantiation
    //----------------------------------------------------------------------------
    merc32_core #(
        .ILB_ADDR_WIDTH                 (ILB_ADDR_WIDTH         ),
        .DLB_ADDR_WIDTH                 (DLB_ADDR_WIDTH         ))
    u_merc32_core (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .interrupt                      (interrupt              ),

        .dbg_halt                       (1'b0                   ),
        .dbg_step                       (1'b0                   ),
        .dbg_reset                      (1'b0                   ),
        .dbg_halted                     (                       ),

        .dbg_rden                       (1'b0                   ),
        .dbg_wren                       (1'b0                   ),
        .dbg_addr                       (32'h0                  ),
        .dbg_wdata                      (32'h0                  ),
        .dbg_rdata                      (                       ),
        .dbg_ack                        (                       ),

        .plb_rden                       (cpu_plb_rden           ),
        .plb_wren                       (cpu_plb_wren           ),
        .plb_addr                       (cpu_plb_addr           ),
        .plb_wdata                      (cpu_plb_wdata          ),
        .plb_rdata                      (cpu_plb_rdata          ),
        .plb_ack                        (cpu_plb_ack            ),

        .dlb_en                         (dlb_en                 ),
        .dlb_we                         (dlb_we                 ),
        .dlb_addr                       (dlb_addr               ),
        .dlb_wdata                      (dlb_wdata              ),
        .dlb_rdata                      (dlb_rdata              ),

        .ilb_en                         (ilb_en                 ),
        .ilb_we                         (ilb_we                 ),
        .ilb_addr                       (ilb_addr               ),
        .ilb_wdata                      (ilb_wdata              ),
        .ilb_rdata                      (ilb_rdata              ));

    //----------------------------------------------------------------------------
    // Bus interface selection (mutually exclusive, priority based)
    //----------------------------------------------------------------------------
`ifdef IF_AXI_LITE
    lb2axi_lite #(
        .LB_DATA_WIDTH                  (32                     ),
        .LB_ADDR_WIDTH                  (32                     ),
        .AXI_DATA_WIDTH                 (32                     ),
        .AXI_ADDR_WIDTH                 (32                     ))
    u_lb2axi_lite (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .lb_rden                        (cpu_plb_rden           ),
        .lb_wren                        (cpu_plb_wren           ),
        .lb_wdata                       (cpu_plb_wdata          ),
        .lb_addr                        (cpu_plb_addr           ),
        .lb_rdata                       (cpu_plb_rdata          ),
        .lb_valid                       (cpu_plb_ack            ),

        .m_axi_awvalid                  (m_axi_awvalid          ),
        .m_axi_awready                  (m_axi_awready          ),
        .m_axi_awaddr                   (m_axi_awaddr           ),
        .m_axi_wvalid                   (m_axi_wvalid           ),
        .m_axi_wready                   (m_axi_wready           ),
        .m_axi_wdata                    (m_axi_wdata            ),
        .m_axi_wstrb                    (m_axi_wstrb            ),
        .m_axi_bvalid                   (m_axi_bvalid           ),
        .m_axi_bready                   (m_axi_bready           ),
        .m_axi_bresp                    (m_axi_bresp            ),
        .m_axi_arvalid                  (m_axi_arvalid          ),
        .m_axi_arready                  (m_axi_arready          ),
        .m_axi_araddr                   (m_axi_araddr           ),
        .m_axi_rvalid                   (m_axi_rvalid           ),
        .m_axi_rready                   (m_axi_rready           ),
        .m_axi_rdata                    (m_axi_rdata            ),
        .m_axi_rresp                    (m_axi_rresp            ));
`elsif IF_APB
    lb2apb #(
        .LB_DATA_WIDTH                  (32                     ),
        .LB_ADDR_WIDTH                  (32                     ),
        .APB_DATA_WIDTH                 (32                     ),
        .APB_ADDR_WIDTH                 (32                     ))
    u_lb2apb (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .lb_rden                        (cpu_plb_rden           ),
        .lb_wren                        (cpu_plb_wren           ),
        .lb_wdata                       (cpu_plb_wdata          ),
        .lb_addr                        (cpu_plb_addr           ),
        .lb_rdata                       (cpu_plb_rdata          ),
        .lb_valid                       (cpu_plb_ack            ),

        .m_apb_psel                     (m_apb_psel             ),
        .m_apb_penable                  (m_apb_penable          ),
        .m_apb_paddr                    (m_apb_paddr            ),
        .m_apb_pwrite                   (m_apb_pwrite           ),
        .m_apb_pwdata                   (m_apb_pwdata           ),
        .m_apb_prdata                   (m_apb_prdata           ),
        .m_apb_pready                   (m_apb_pready           ));
`elsif IF_WBC
    lb2wbc #(
        .LB_DATA_WIDTH                  (32                     ),
        .LB_ADDR_WIDTH                  (32                     ),
        .WB_DATA_WIDTH                  (32                     ),
        .WB_ADDR_WIDTH                  (32                     ))
    u_lb2wbc (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .lb_rden                        (cpu_plb_rden           ),
        .lb_wren                        (cpu_plb_wren           ),
        .lb_wdata                       (cpu_plb_wdata          ),
        .lb_addr                        (cpu_plb_addr           ),
        .lb_rdata                       (cpu_plb_rdata          ),
        .lb_valid                       (cpu_plb_ack            ),

        .m_wb_cyc_o                     (m_wb_cyc_o             ),
        .m_wb_stb_o                     (m_wb_stb_o             ),
        .m_wb_we_o                      (m_wb_we_o              ),
        .m_wb_adr_o                     (m_wb_adr_o             ),
        .m_wb_dat_o                     (m_wb_dat_o             ),
        .m_wb_sel_o                     (m_wb_sel_o             ),
        .m_wb_ack_i                     (m_wb_ack_i             ),
        .m_wb_dat_i                     (m_wb_dat_i             ));
`elsif IF_AVALON
    lb2avalon #(
        .LB_DATA_WIDTH                  (32                     ),
        .LB_ADDR_WIDTH                  (32                     ),
        .AV_DATA_WIDTH                  (32                     ),
        .AV_ADDR_WIDTH                  (32                     ))
    u_lb2avalon (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .lb_rden                        (cpu_plb_rden           ),
        .lb_wren                        (cpu_plb_wren           ),
        .lb_wdata                       (cpu_plb_wdata          ),
        .lb_addr                        (cpu_plb_addr           ),
        .lb_rdata                       (cpu_plb_rdata          ),
        .lb_valid                       (cpu_plb_ack            ),

        .m_av_address                   (m_av_address           ),
        .m_av_read                      (m_av_read              ),
        .m_av_write                     (m_av_write             ),
        .m_av_writedata                 (m_av_writedata         ),
        .m_av_byteenable                (m_av_byteenable        ),
        .m_av_waitrequest               (m_av_waitrequest       ),
        .m_av_readdata                  (m_av_readdata          ),
        .m_av_readdatavalid             (m_av_readdatavalid     ));
`elsif IF_DRP
    lb2drp #(
        .LB_DATA_WIDTH                  (32                     ),
        .LB_ADDR_WIDTH                  (32                     ),
        .DRP_DATA_WIDTH                 (32                     ),
        .DRP_ADDR_WIDTH                 (32                     ))
    u_lb2drp (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .lb_rden                        (cpu_plb_rden           ),
        .lb_wren                        (cpu_plb_wren           ),
        .lb_wdata                       (cpu_plb_wdata          ),
        .lb_addr                        (cpu_plb_addr           ),
        .lb_rdata                       (cpu_plb_rdata          ),
        .lb_valid                       (cpu_plb_ack            ),

        .drp_addr                       (drp_addr               ),
        .drp_en                         (drp_en                 ),
        .drp_we                         (drp_we                 ),
        .drp_rdy                        (drp_rdy                ),
        .drp_in                         (drp_in                 ),
        .drp_out                        (drp_out                ));
`else
    assign lb_rden       = cpu_plb_rden;
    assign lb_wren       = cpu_plb_wren;
    assign lb_addr       = cpu_plb_addr;
    assign lb_wdata      = cpu_plb_wdata;
    assign cpu_plb_rdata = lb_rdata;
    assign cpu_plb_ack   = lb_valid;
`endif

endmodule
