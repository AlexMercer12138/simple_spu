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
//  Description : MERC32 CPU top-level Local Bus wrapper
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
    .JTAG_IDCODE_VALUE          (32'h4d32_0001  ),
    .DEBUG_EN                   (1              ))
u_MERC32_top (
    .clk                        (clk            ),
    .rst_n                      (rst_n          ),
    .interrupt                  (interrupt      ),
    .tck                        (tck            ),
    .tms                        (tms            ),
    .tdi                        (tdi            ),
    .tdo                        (tdo            ));
*/

//================================================================================
//  Module Definition
//================================================================================

module MERC32_top #(
    parameter   ILB_ADDR_WIDTH          = 16,
    parameter   DLB_ADDR_WIDTH          = 16,
    parameter   JTAG_IDCODE_VALUE       = 32'h4d32_0001,
    parameter   DEBUG_EN                = 1
) (
    input                               clk,
    input                               rst_n,

    input                               interrupt,

    input                               tck,
    input                               tms,
    input                               tdi,
    output                              tdo,

    output                              dlb_rden,
    output                              dlb_wren,
    output      [DLB_ADDR_WIDTH-1:0]    dlb_addr,
    output      [3:0]                   dlb_strb,
    output      [31:0]                  dlb_wdata,
    input       [31:0]                  dlb_rdata,
    input                               dlb_ack,

    output                              ilb_rden,
    output                              ilb_wren,
    output      [ILB_ADDR_WIDTH-1:0]    ilb_addr,
    output      [3:0]                   ilb_strb,
    output      [31:0]                  ilb_wdata,
    input       [31:0]                  ilb_rdata,
    input                               ilb_ack,

    output                              plb_rden,
    output                              plb_wren,
    output      [31:0]                  plb_addr,
    output      [3:0]                   plb_strb,
    output      [31:0]                  plb_wdata,
    input       [31:0]                  plb_rdata,
    input                               plb_ack
);

    wire                                dbg_rst_req;
    wire                                dbg_halt_req;
    wire                                dbg_step_req;
    wire                                dbg_regi_req;
    wire    [3:0]                       dbg_regi_addr;
    wire                                dbg_regi_vld;
    wire    [31:0]                      dbg_regi_data;
    wire                                dbg_halted;
    wire                                dbg_rden;
    wire                                dbg_wren;
    wire    [31:0]                      dbg_addr;
    wire    [31:0]                      dbg_wdata;
    wire    [31:0]                      dbg_rdata;
    wire                                dbg_ack;

    //----------------------------------------------------------------------------
    // JTAG debug transport
    //----------------------------------------------------------------------------
    generate
        if(DEBUG_EN != 0) begin:gen_debug
            jtag_debug #(
                .IDCODE_VALUE                   (JTAG_IDCODE_VALUE      ))
            jtag_debug_inst (
                .clk                            (clk                    ),
                .rst_n                          (rst_n                  ),

                .tck                            (tck                    ),
                .tms                            (tms                    ),
                .tdi                            (tdi                    ),
                .tdo                            (tdo                    ),

                .dbg_rst_req                    (dbg_rst_req            ),
                .dbg_halt_req                   (dbg_halt_req           ),
                .dbg_step_req                   (dbg_step_req           ),
                .dbg_regi_req                   (dbg_regi_req           ),
                .dbg_regi_addr                  (dbg_regi_addr          ),
                .dbg_regi_vld                   (dbg_regi_vld           ),
                .dbg_regi_data                  (dbg_regi_data          ),
                .dbg_halted                     (dbg_halted             ),

                .dbg_rden                       (dbg_rden               ),
                .dbg_wren                       (dbg_wren               ),
                .dbg_addr                       (dbg_addr               ),
                .dbg_wdata                      (dbg_wdata              ),
                .dbg_rdata                      (dbg_rdata              ),
                .dbg_ack                        (dbg_ack                ));
        end else begin:gen_no_debug
            assign  tdo = 1'b0;
            assign  dbg_rst_req = 1'b0;
            assign  dbg_halt_req = 1'b0;
            assign  dbg_step_req = 1'b0;
            assign  dbg_regi_req = 1'b0;
            assign  dbg_regi_addr = 4'h0;
            assign  dbg_rden = 1'b0;
            assign  dbg_wren = 1'b0;
            assign  dbg_addr = 32'h0;
            assign  dbg_wdata = 32'h0;
        end
    endgenerate

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

        .dbg_rst_req                    (dbg_rst_req            ),
        .dbg_halt_req                   (dbg_halt_req           ),
        .dbg_step_req                   (dbg_step_req           ),
        .dbg_regi_req                   (dbg_regi_req           ),
        .dbg_regi_addr                  (dbg_regi_addr          ),
        .dbg_regi_vld                   (dbg_regi_vld           ),
        .dbg_regi_data                  (dbg_regi_data          ),
        .dbg_halted                     (dbg_halted             ),

        .dbg_rden                       (dbg_rden               ),
        .dbg_wren                       (dbg_wren               ),
        .dbg_addr                       (dbg_addr               ),
        .dbg_strb                       (4'b1111                ),
        .dbg_wdata                      (dbg_wdata              ),
        .dbg_rdata                      (dbg_rdata              ),
        .dbg_ack                        (dbg_ack                ),

        .plb_rden                       (plb_rden               ),
        .plb_wren                       (plb_wren               ),
        .plb_addr                       (plb_addr               ),
        .plb_strb                       (plb_strb               ),
        .plb_wdata                      (plb_wdata              ),
        .plb_rdata                      (plb_rdata              ),
        .plb_ack                        (plb_ack                ),

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
        .ilb_ack                        (ilb_ack                ));

endmodule
