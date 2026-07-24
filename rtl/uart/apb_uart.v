`timescale 1ns / 1ps
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
//  Module      : apb_uart
//  Description : APB UART controller
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
apb_uart_new #(
    .SYS_CLK_FREQ               (50_000_000     ),
    .FIFO_DEPTH                 (8              ))
u_apb_uart_new (
    .s_apb_pclk                 (s_apb_pclk     ),
    .s_apb_presetn              (s_apb_presetn  ),

    .s_apb_psel                 (s_apb_psel     ),
    .s_apb_penable              (s_apb_penable  ),
    .s_apb_pwrite               (s_apb_pwrite   ),
    .s_apb_paddr                (s_apb_paddr    ),
    .s_apb_pwdata               (s_apb_pwdata   ),

    .s_apb_pready               (s_apb_pready   ),
    .s_apb_pslverr              (s_apb_pslverr  ),
    .s_apb_prdata               (s_apb_prdata   ),
    .interrupt                  (interrupt      ),

    .uart_rx                    (uart_rx        ),
    .uart_tx                    (uart_tx        ));
*/

//================================================================================
//  Module Definition
//================================================================================

module apb_uart_new #(
    parameter SYS_CLK_FREQ              = 50_000_000,
    parameter FIFO_DEPTH                = 8
)(
    input   wire                        s_apb_pclk,
    input   wire                        s_apb_presetn,

    input   wire                        s_apb_psel,
    input   wire                        s_apb_penable,
    input   wire                        s_apb_pwrite,
    input   wire [31:0]                 s_apb_paddr,
    input   wire [31:0]                 s_apb_pwdata,

    output  wire                        s_apb_pready,
    output  wire                        s_apb_pslverr,
    output  wire [31:0]                 s_apb_prdata,

    output  reg                         interrupt,

    input   wire                        uart_rx,
    output  reg                         uart_tx
);

    localparam ADDR_WIDTH               = $clog2(FIFO_DEPTH);

//================================================================================
//  APB interface
//================================================================================

    reg                                 apb_pready;
    reg                                 apb_pslverr;
    reg     [31:0]                      apb_prdata;

    wire    [11:0]                      opt_addr;
    wire                                slv_reg_rden;
    wire                                slv_reg_wren;

    assign opt_addr     = s_apb_paddr[11:2];
    assign slv_reg_wren = s_apb_psel & s_apb_penable & s_apb_pwrite & s_apb_pready;
    assign slv_reg_rden = s_apb_psel & ~s_apb_penable & ~s_apb_pwrite;

    assign s_apb_pready  = apb_pready;
    assign s_apb_pslverr = apb_pslverr;
    assign s_apb_prdata  = apb_prdata;

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            apb_pready <= 1'b0;
        end else if (s_apb_psel & apb_pready) begin
            apb_pready <= 1'b0;
        end else if (s_apb_psel) begin
            apb_pready <= 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            apb_pslverr <= 1'b0;
        end else begin
            apb_pslverr <= 1'b0;
        end
    end

//================================================================================
//  Register control
//================================================================================

    reg     [31:0]                      uart_ctrl;
    reg     [31:0]                      uart_config;
    reg     [31:0]                      uart_rx_buf;
    reg     [31:0]                      uart_rx_status;
    reg     [31:0]                      uart_tx_buf;
    reg     [31:0]                      uart_tx_status;
    reg     [31:0]                      uart_interrupt;

    wire                                soft_rst;
    wire                                uart_rst_n;
    reg                                 rx_en;
    reg     [1:0]                       rx_cnt;
    wire    [1:0]                       rx_ptr;
    wire                                rx_valid;
    wire                                rx_ready;
    wire    [7:0]                       rx_data;
    reg     [ADDR_WIDTH:0]              rx_data_cnt;
    reg                                 tx_en;
    reg     [1:0]                       tx_cnt;
    wire    [1:0]                       tx_ptr;
    wire                                tx_valid;
    wire                                tx_ready;
    wire    [7:0]                       tx_data;
    reg     [ADDR_WIDTH:0]              tx_data_cnt;

    assign soft_rst   = uart_ctrl[31];
    assign uart_rst_n = s_apb_presetn & ~soft_rst;
    assign rx_ptr     = uart_rx_status[1:0];
    assign tx_ptr     = uart_tx_status[1:0];
    assign rx_ready   = rx_en & ~slv_reg_rden;
    assign tx_valid   = tx_en & ~slv_reg_wren;
    assign tx_data    =
        tx_ptr == 2'd0 ? uart_tx_buf[31:24] :
        tx_ptr == 2'd1 ? uart_tx_buf[23:16] :
        tx_ptr == 2'd2 ? uart_tx_buf[15:08] :
        tx_ptr == 2'd3 ? uart_tx_buf[07:00] : 8'hee;

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            rx_en <= 0;
            rx_cnt <= 0;
            tx_en <= 0;
            tx_cnt <= 0;
        end else begin
            rx_en <= uart_ctrl[0] ? 1 : rx_valid & rx_ready & rx_cnt == uart_ctrl[2:1] ? 0 : rx_en;
            rx_cnt <= rx_valid & rx_ready ? (rx_cnt == uart_ctrl[2:1] ? 0 : rx_cnt + 1) : rx_cnt;
            tx_en <= uart_ctrl[4] ? 1 : tx_valid & tx_ready & tx_cnt == uart_ctrl[6:5] ? 0 : tx_en;
            tx_cnt <= tx_valid & tx_ready ? (tx_cnt == uart_ctrl[6:5] ? 0 : tx_cnt + 1) : tx_cnt;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            interrupt <= 0;
        end else if (uart_interrupt[0]) begin
            case (uart_interrupt[2:1])
                0: interrupt <= rx_valid;
                1: interrupt <= tx_ready;
                2: interrupt <= rx_data_cnt == uart_interrupt[23:16];
                3: interrupt <= tx_data_cnt == uart_interrupt[31:24];
            endcase
        end else begin
            interrupt <= 0;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            uart_ctrl <= 0;
            uart_config <= 0;
            uart_tx_buf <= 0;
            uart_tx_status <= 0;
            uart_interrupt <= 0;
        end else if (slv_reg_wren) begin
            case (opt_addr)
                0: uart_ctrl <= s_apb_pwdata;
                1: uart_config <= s_apb_pwdata;
                4: begin
                    uart_tx_buf <= s_apb_pwdata;
                    uart_tx_status <= uart_tx_status & 32'hfffffffc;
                end
                6: uart_interrupt <= s_apb_pwdata & 32'hfffffff7;
            endcase
        end else if (slv_reg_rden) begin
            case (opt_addr)
                6: uart_interrupt <= uart_interrupt & 32'hfffffff7;
            endcase
        end else begin
            uart_ctrl <= uart_ctrl & 32'hffffffee;
            uart_tx_status[9] <= tx_valid;
            uart_tx_status[8] <= tx_ready;
            uart_tx_status[7:6] <= tx_cnt;
            uart_tx_status[5:2] <= tx_data_cnt;
            uart_tx_status[1:0] <= tx_valid & tx_ready ? uart_tx_status[1:0] + 1 : uart_tx_status[1:0];
            uart_interrupt[4] <= interrupt ? 1 : uart_interrupt[4];
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            apb_prdata <= 0;
            uart_rx_status <= 0;
        end else if (slv_reg_rden) begin
            case (opt_addr)
                0: apb_prdata <= uart_ctrl;
                1: apb_prdata <= uart_config;
                2: begin
                    apb_prdata <= uart_rx_buf;
                    uart_rx_status <= uart_rx_status & 32'hfffffffc;
                end
                3: apb_prdata <= uart_rx_status;
                5: apb_prdata <= uart_tx_status;
                6: apb_prdata <= uart_interrupt;
            endcase
        end else begin
            uart_rx_status[9] <= rx_ready;
            uart_rx_status[8] <= rx_valid;
            uart_rx_status[7:6] <= rx_cnt;
            uart_rx_status[5:2] <= rx_data_cnt;
            uart_rx_status[1:0] <= rx_valid & rx_ready ? uart_rx_status[1:0] + 1 : uart_rx_status[1:0];
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            uart_rx_buf <= 0;
        end else if (rx_valid & rx_ready) begin
            case (rx_ptr)
                2'd0: uart_rx_buf[31:24] <= rx_data;
                2'd1: uart_rx_buf[23:16] <= rx_data;
                2'd2: uart_rx_buf[15:08] <= rx_data;
                2'd3: uart_rx_buf[07:00] <= rx_data;
            endcase
        end else if (slv_reg_rden && opt_addr == 2) begin
            uart_rx_buf <= 32'h0;
        end
    end

//================================================================================
//  UART control
//================================================================================

    wire    [23:0]                      baud_rate;
    wire                                stop_bit;
    wire    [1:0]                       parity_type;

    reg                                 uart_rx_valid;
    wire                                uart_rx_ready;
    reg     [7:0]                       uart_rx_data;
    wire                                uart_tx_valid;
    reg                                 uart_tx_ready;
    wire    [7:0]                       uart_tx_data;

    reg     [31:0]                      i;
    reg     [31:0]                      div_dividend;
    reg     [31:0]                      div_divisor;
    reg     [31:0]                      div_quotient;
    reg     [5:0]                       div_cnt;
    reg                                 div_busy;
    reg     [32:0]                      div_remainder;
    reg                                 parity_en;
    reg     [1:0]                       stop_bit_cnt;
    reg     [31:0]                      baud_cnt;

    assign baud_rate   = uart_config[23:0];
    assign stop_bit    = uart_config[31];
    assign parity_type = uart_config[30:29];

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            baud_cnt <= 0;
            parity_en <= 0;
            stop_bit_cnt <= 0;
        end else begin
            baud_cnt <= ~div_busy ? div_quotient : baud_cnt;
            parity_en <= |parity_type;
            stop_bit_cnt <= stop_bit ? 2 : 1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            div_busy <= 0;
            div_cnt <= 0;
            div_dividend <= 0;
            div_divisor <= 0;
            div_remainder <= 0;
            div_quotient <= 0;
        end else begin
            div_busy <=
                div_divisor != baud_rate ? 1 :
                div_cnt == 31 ? 0 :
                div_busy;
            div_cnt <=
                div_divisor != baud_rate ? 0 :
                div_busy ? (div_cnt == 31 ? 0 : div_cnt + 1) :
                div_cnt;
            div_dividend <=
                div_divisor != baud_rate ? SYS_CLK_FREQ :
                div_busy ? {div_dividend[30:0], 1'b0} :
                SYS_CLK_FREQ;
            div_divisor <= baud_rate;
            div_remainder <=
                div_divisor != baud_rate ? 0 :
                div_busy ?
                    ({div_remainder[31:0], div_dividend[31]} >= div_divisor ?
                        {div_remainder[31:0], div_dividend[31]} - div_divisor :
                        {div_remainder[31:0], div_dividend[31]}) :
                div_remainder;
            div_quotient <=
                div_divisor != baud_rate ? 0 :
                div_busy ?
                    ({div_remainder[31:0], div_dividend[31]} >= div_divisor ?
                        {div_quotient[30:0], 1'b1} :
                        {div_quotient[30:0], 1'b0}) :
                div_quotient;
        end
    end

//================================================================================
//  Receiver buffer
//================================================================================

    reg     [ADDR_WIDTH-1:0]            rx_wr_ptr;
    reg     [ADDR_WIDTH-1:0]            rx_rd_ptr;
    reg     [7:0]                       rx_buffer [0:FIFO_DEPTH-1];

    assign rx_data       = rx_buffer[rx_rd_ptr];
    assign rx_valid      = |rx_data_cnt;
    assign uart_rx_ready = ~rx_data_cnt[ADDR_WIDTH];

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_wr_ptr <= {ADDR_WIDTH{1'b0}};
        end else if (uart_rx_valid & uart_rx_ready) begin
            rx_wr_ptr <= rx_wr_ptr + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_rd_ptr <= {ADDR_WIDTH{1'b0}};
        end else if (rx_valid & rx_ready) begin
            rx_rd_ptr <= rx_rd_ptr + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            for (i = 0; i < FIFO_DEPTH; i = i + 1) begin
                rx_buffer[i] <= 0;
            end
        end else if (uart_rx_valid & uart_rx_ready) begin
            rx_buffer[rx_wr_ptr] <= uart_rx_data;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_data_cnt <= {ADDR_WIDTH+1{1'b0}};
        end else begin
            case ({uart_rx_valid, uart_rx_ready, rx_valid, rx_ready})
                4'b1100, 4'b1110, 4'b1101: rx_data_cnt <= rx_data_cnt + 1'b1;
                4'b0011, 4'b0111, 4'b1011: rx_data_cnt <= rx_data_cnt - 1'b1;
                default: rx_data_cnt <= rx_data_cnt;
            endcase
        end
    end

//================================================================================
//  Transmitter buffer
//================================================================================

    reg     [ADDR_WIDTH-1:0]            tx_wr_ptr;
    reg     [ADDR_WIDTH-1:0]            tx_rd_ptr;
    reg     [7:0]                       tx_buffer [0:FIFO_DEPTH-1];

    assign uart_tx_data  = tx_buffer[tx_rd_ptr];
    assign uart_tx_valid = |tx_data_cnt;
    assign tx_ready      = ~tx_data_cnt[ADDR_WIDTH];

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_wr_ptr <= {ADDR_WIDTH{1'b0}};
        end else if (tx_valid & tx_ready) begin
            tx_wr_ptr <= tx_wr_ptr + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_rd_ptr <= {ADDR_WIDTH{1'b0}};
        end else if (uart_tx_valid & uart_tx_ready) begin
            tx_rd_ptr <= tx_rd_ptr + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            for (i = 0; i < FIFO_DEPTH; i = i + 1) begin
                tx_buffer[i] <= 0;
            end
        end else if (tx_valid & tx_ready) begin
            tx_buffer[tx_wr_ptr] <= tx_data;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_data_cnt <= {ADDR_WIDTH+1{1'b0}};
        end else begin
            case ({tx_valid, tx_ready, uart_tx_valid, uart_tx_ready})
                4'b1100, 4'b1110, 4'b1101: tx_data_cnt <= tx_data_cnt + 1'b1;
                4'b0011, 4'b0111, 4'b1011: tx_data_cnt <= tx_data_cnt - 1'b1;
                default: tx_data_cnt <= tx_data_cnt;
            endcase
        end
    end

//================================================================================
//  UART receiver
//================================================================================

    reg                                 rx_ff0;
    reg                                 rx_ff1;
    reg                                 rx_ff2;
    reg                                 rx_parity;
    reg                                 rx_busy;
    reg     [9:0]                       rx_baud_cnt;
    reg     [3:0]                       rx_bit_cnt;
    reg                                 rx_pass;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_ff0 <= 1'b1;
            rx_ff1 <= 1'b1;
            rx_ff2 <= 1'b1;
        end else begin
            rx_ff0 <= uart_rx;
            rx_ff1 <= rx_ff0;
            rx_ff2 <= rx_ff1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_busy <= 1'b0;
        end else begin
            rx_busy <=
                rx_ff2 & ~rx_ff1 ? 1'b1 :
                (rx_bit_cnt == 8 + parity_en) && (rx_baud_cnt == baud_cnt - 1) ? 1'b0 :
                rx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_baud_cnt <= 10'd0;
        end else if (rx_busy) begin
            rx_baud_cnt <=
                rx_baud_cnt == baud_cnt - 1 ? 10'd0 :
                rx_baud_cnt + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_bit_cnt <= 4'd0;
        end else if (rx_baud_cnt == baud_cnt - 1) begin
            rx_bit_cnt <=
                rx_bit_cnt == 8 + parity_en ? 4'd0 :
                rx_bit_cnt + 1'd1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_data <= 8'd0;
            rx_parity <= 1'b0;
        end else if (rx_baud_cnt == baud_cnt / 2 - 1) begin
            case (rx_bit_cnt)
                4'd1: uart_rx_data[0] <= rx_ff2;
                4'd2: uart_rx_data[1] <= rx_ff2;
                4'd3: uart_rx_data[2] <= rx_ff2;
                4'd4: uart_rx_data[3] <= rx_ff2;
                4'd5: uart_rx_data[4] <= rx_ff2;
                4'd6: uart_rx_data[5] <= rx_ff2;
                4'd7: uart_rx_data[6] <= rx_ff2;
                4'd8: uart_rx_data[7] <= rx_ff2;
                4'd9: rx_parity <= rx_ff2;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_pass <= 1'b0;
        end else begin
            rx_pass <=
                parity_type == 1 ? rx_parity == ^~uart_rx_data :
                parity_type == 2 ? rx_parity == ^uart_rx_data :
                1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_valid <= 1'b0;
        end else begin
            uart_rx_valid <=
                uart_rx_valid & uart_rx_ready ? 1'b0 :
                (rx_bit_cnt == 8 + parity_en) && (rx_baud_cnt == baud_cnt - 1) && rx_pass ? 1'b1 :
                uart_rx_valid;
        end
    end

//================================================================================
//  UART transmitter
//================================================================================

    reg     [7:0]                       tx_ff;
    reg                                 tx_busy;
    reg     [9:0]                       tx_baud_cnt;
    reg     [3:0]                       tx_bit_cnt;
    reg                                 tx_parity;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_busy <= 1'b0;
        end else begin
            tx_busy <=
                uart_tx_valid & uart_tx_ready ? 1'b1 :
                (tx_bit_cnt == 8 + parity_en + stop_bit_cnt) && (tx_baud_cnt == baud_cnt - 1) ? 1'b0 :
                tx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_ff <= 8'd0;
        end else if (uart_tx_valid & uart_tx_ready) begin
            tx_ff <= uart_tx_data;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n)
            tx_baud_cnt <= 10'd0;
        else if (tx_busy) begin
            tx_baud_cnt <=
                tx_baud_cnt == baud_cnt - 1 ? 10'd0 :
                tx_baud_cnt + 1'd1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_bit_cnt <= 4'd0;
        end else if (tx_baud_cnt == baud_cnt - 1) begin
            tx_bit_cnt <=
                tx_bit_cnt == 8 + parity_en + stop_bit_cnt ? 4'd0 :
                tx_bit_cnt + 1'd1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_parity <= 1'b0;
        end else if (~tx_busy) begin
            tx_parity <=
                parity_type == 1 ? ^~tx_ff :
                parity_type == 2 ? ^tx_ff :
                1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx <= 1'b1;
        end else if (tx_busy) begin
            case (tx_bit_cnt)
                4'd0: uart_tx <= 1'b0;
                4'd1: uart_tx <= tx_ff[0];
                4'd2: uart_tx <= tx_ff[1];
                4'd3: uart_tx <= tx_ff[2];
                4'd4: uart_tx <= tx_ff[3];
                4'd5: uart_tx <= tx_ff[4];
                4'd6: uart_tx <= tx_ff[5];
                4'd7: uart_tx <= tx_ff[6];
                4'd8: uart_tx <= tx_ff[7];
                4'd9: uart_tx <= tx_parity;
                default: uart_tx <= 1'b1;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx_ready <= 1'b1;
        end else begin
            uart_tx_ready <=
                uart_tx_valid & uart_tx_ready ? 1'b0 :
                (tx_bit_cnt == 8 + parity_en + stop_bit_cnt) && (tx_baud_cnt == baud_cnt - 1) ? 1'b1 :
                uart_tx_ready;
        end
    end

endmodule
