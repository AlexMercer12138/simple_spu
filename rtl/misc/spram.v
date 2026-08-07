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
//  Module      : spram
//  Description : Single-port RAM module
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
spram #(
    .ADDR_WIDTH                     (32             ),
    .INIT_FILE                      (""             ))
u_spram (
    .clka                           (clka           ),
    .wren                           (wren           ),
    .din                            (din            ),
    .addra                          (addra          ),
    .clkb                           (clkb           ),
    .rden                           (rden           ),
    .dout                           (dout           ),
    .addrb                          (addrb          ),
    .ack                            (ack            ));
*/

//================================================================================
//  Module Definition
//================================================================================

module spram #(
    parameter   ADDR_WIDTH          = 32,
    parameter   INIT_FILE           = ""
) (
    input                           clk,
    input                           wr,
    input                           rd,
    input   [3:0]                   be,
    input   [31:0]                  din,
    output  reg [31:0]              dout,
    input   [ADDR_WIDTH-1:0]        addr,
    output  reg                     ack
);

    reg     [31:0]                  ram [0:(1<<ADDR_WIDTH)-1];

    always @(posedge clk) begin
        ack <= wr | rd;
        if (wr & be[3])
            ram[addr][31:24] <= din[31:24];
        if (wr & be[2])
            ram[addr][23:16] <= din[23:16];
        if (wr & be[1])
            ram[addr][15:08] <= din[15:08];
        if (wr & be[0])
            ram[addr][07:00] <= din[07:00];
        if (rd)
            dout <= ram[addr];
    end

    initial begin : initialization
        integer i;
        if (INIT_FILE != "") begin
            $readmemh(INIT_FILE, ram, 0, (1<<ADDR_WIDTH)-1);
        end else begin
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

endmodule
