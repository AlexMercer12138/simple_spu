`timescale 1ns / 1ps
//================================================================================
//
//--------------------------------------------------------------------------------
//  Author      : Mercer
//  Module      : apb_uart_new
//  Description : Standalone APB UART controller
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

    localparam FIFO_ADDR_WIDTH          = $clog2(FIFO_DEPTH);

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
    wire                                rx_data_available;
    wire                                apb_rx_data_valid;
    wire                                apb_rx_data_ready;
    wire                                apb_rx_transfer;
    wire    [7:0]                       apb_rx_data;
    wire    [FIFO_ADDR_WIDTH:0]         rx_data_count;

    reg                                 tx_en;
    reg     [1:0]                       tx_cnt;
    wire    [1:0]                       tx_ptr;
    wire                                apb_tx_data_valid;
    wire                                apb_tx_data_ready;
    wire                                apb_tx_transfer;
    wire    [7:0]                       apb_tx_data;
    wire    [FIFO_ADDR_WIDTH:0]         tx_data_count;

    assign soft_rst          = uart_ctrl[31];
    assign uart_rst_n        = s_apb_presetn & ~soft_rst;
    assign rx_ptr            = uart_rx_status[1:0];
    assign tx_ptr            = uart_tx_status[1:0];
    assign rx_data_available = |rx_data_count;
    assign apb_rx_data_valid = rx_fifo_output_valid;
    assign apb_rx_data_ready = rx_en & ~slv_reg_rden;
    assign apb_rx_transfer   = apb_rx_data_valid & apb_rx_data_ready;
    assign apb_rx_data       = rx_fifo_rd_data;
    assign apb_tx_data_valid = tx_en & ~slv_reg_wren;
    assign apb_tx_data_ready = tx_data_count < FIFO_DEPTH;
    assign apb_tx_transfer   = apb_tx_data_valid & apb_tx_data_ready;
    assign apb_tx_data       =
        tx_ptr == 2'd0 ? uart_tx_buf[31:24] :
        tx_ptr == 2'd1 ? uart_tx_buf[23:16] :
        tx_ptr == 2'd2 ? uart_tx_buf[15:08] :
        tx_ptr == 2'd3 ? uart_tx_buf[07:00] : 8'hee;

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            rx_en <= 1'b0;
            rx_cnt <= 2'd0;
            tx_en <= 1'b0;
            tx_cnt <= 2'd0;
        end else begin
            rx_en <=
                uart_ctrl[0] ? 1'b1 :
                apb_rx_transfer & (rx_cnt == uart_ctrl[2:1]) ? 1'b0 :
                rx_en;
            rx_cnt <=
                apb_rx_transfer ?
                    (rx_cnt == uart_ctrl[2:1] ? 2'd0 : rx_cnt + 1'b1) :
                rx_cnt;
            tx_en <=
                uart_ctrl[4] ? 1'b1 :
                apb_tx_transfer & (tx_cnt == uart_ctrl[6:5]) ? 1'b0 :
                tx_en;
            tx_cnt <=
                apb_tx_transfer ?
                    (tx_cnt == uart_ctrl[6:5] ? 2'd0 : tx_cnt + 1'b1) :
                tx_cnt;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            interrupt <= 1'b0;
        end else if (uart_interrupt[0]) begin
            case (uart_interrupt[2:1])
                2'd0: interrupt <= rx_data_available;
                2'd1: interrupt <= apb_tx_data_ready;
                2'd2: interrupt <= rx_data_count == uart_interrupt[23:16];
                2'd3: interrupt <= tx_data_count == uart_interrupt[31:24];
            endcase
        end else begin
            interrupt <= 1'b0;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            uart_ctrl <= 32'd0;
            uart_config <= 32'd0;
            uart_tx_buf <= 32'd0;
            uart_tx_status <= 32'd0;
            uart_interrupt <= 32'd0;
        end else if (slv_reg_wren) begin
            case (opt_addr)
                12'd0: uart_ctrl <= s_apb_pwdata;
                12'd1: uart_config <= s_apb_pwdata;
                12'd4: begin
                    uart_tx_buf <= s_apb_pwdata;
                    uart_tx_status <= uart_tx_status & 32'hfffffffc;
                end
                12'd6: uart_interrupt <= s_apb_pwdata & 32'hfffffff7;
            endcase
        end else if (slv_reg_rden) begin
            case (opt_addr)
                12'd6: uart_interrupt <= uart_interrupt & 32'hfffffff7;
            endcase
        end else begin
            uart_ctrl <= uart_ctrl & 32'hffffffee;
            uart_tx_status[9] <= apb_tx_data_valid;
            uart_tx_status[8] <= apb_tx_data_ready;
            uart_tx_status[7:6] <= tx_cnt;
            uart_tx_status[5:2] <= tx_data_count;
            uart_tx_status[1:0] <=
                apb_tx_transfer ? uart_tx_status[1:0] + 1'b1 :
                uart_tx_status[1:0];
            uart_interrupt[4] <= interrupt ? 1'b1 : uart_interrupt[4];
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            apb_prdata <= 32'd0;
            uart_rx_status <= 32'd0;
        end else if (slv_reg_rden) begin
            case (opt_addr)
                12'd0: apb_prdata <= uart_ctrl;
                12'd1: apb_prdata <= uart_config;
                12'd2: begin
                    apb_prdata <= uart_rx_buf;
                    uart_rx_status <= uart_rx_status & 32'hfffffffc;
                end
                12'd3: apb_prdata <= uart_rx_status;
                12'd5: apb_prdata <= uart_tx_status;
                12'd6: apb_prdata <= uart_interrupt;
            endcase
        end else begin
            uart_rx_status[9] <= apb_rx_data_ready;
            uart_rx_status[8] <= rx_data_available;
            uart_rx_status[7:6] <= rx_cnt;
            uart_rx_status[5:2] <= rx_data_count;
            uart_rx_status[1:0] <=
                apb_rx_transfer ? uart_rx_status[1:0] + 1'b1 :
                uart_rx_status[1:0];
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            uart_rx_buf <= 32'd0;
        end else if (apb_rx_transfer) begin
            case (rx_ptr)
                2'd0: uart_rx_buf[31:24] <= apb_rx_data;
                2'd1: uart_rx_buf[23:16] <= apb_rx_data;
                2'd2: uart_rx_buf[15:08] <= apb_rx_data;
                2'd3: uart_rx_buf[07:00] <= apb_rx_data;
            endcase
        end else if (slv_reg_rden && (opt_addr == 12'd2)) begin
            uart_rx_buf <= 32'd0;
        end
    end

//================================================================================
//  Receiver FIFO
//================================================================================

    reg     [FIFO_ADDR_WIDTH-1:0]       rx_fifo_wr_ptr;
    reg     [FIFO_ADDR_WIDTH-1:0]       rx_fifo_rd_ptr;
    reg     [FIFO_ADDR_WIDTH:0]         rx_fifo_count;
    reg     [7:0]                       rx_fifo_mem [0:FIFO_DEPTH-1];
    reg     [7:0]                       rx_fifo_rd_data;
    reg                                 rx_fifo_rd_valid;
    reg                                 rx_fifo_rd_pending;
    reg                                 rx_fifo_output_valid;

    wire                                rx_fifo_wr_en;
    wire                                rx_fifo_rd_en;
    wire                                rx_fifo_wr_accept;
    wire                                rx_fifo_rd_accept;
    wire                                rx_fifo_empty;
    wire                                rx_fifo_full;

    assign rx_fifo_wr_en     = uart_rx_data_valid;
    assign rx_fifo_rd_en     = uart_rst_n & rx_en & ~rx_fifo_empty &
                                ~rx_fifo_rd_pending & ~rx_fifo_output_valid &
                                ~slv_reg_rden;
    assign rx_fifo_empty     = rx_fifo_count == 0;
    assign rx_fifo_full      = rx_fifo_count == FIFO_DEPTH;
    assign rx_fifo_wr_accept = rx_fifo_wr_en & ~rx_fifo_full &
                                (rx_data_count < FIFO_DEPTH);
    assign rx_fifo_rd_accept = rx_fifo_rd_en & ~rx_fifo_empty;
    assign rx_data_count     = rx_fifo_count + rx_fifo_rd_pending +
                                rx_fifo_output_valid;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_fifo_wr_ptr <= {FIFO_ADDR_WIDTH{1'b0}};
            rx_fifo_rd_ptr <= {FIFO_ADDR_WIDTH{1'b0}};
            rx_fifo_count <= {(FIFO_ADDR_WIDTH+1){1'b0}};
        end else begin
            if (rx_fifo_wr_accept)
                rx_fifo_wr_ptr <= rx_fifo_wr_ptr + 1'b1;
            if (rx_fifo_rd_accept)
                rx_fifo_rd_ptr <= rx_fifo_rd_ptr + 1'b1;
            case ({rx_fifo_wr_accept, rx_fifo_rd_accept})
                2'b10: rx_fifo_count <= rx_fifo_count + 1'b1;
                2'b01: rx_fifo_count <= rx_fifo_count - 1'b1;
                default: rx_fifo_count <= rx_fifo_count;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (rx_fifo_wr_accept)
            rx_fifo_mem[rx_fifo_wr_ptr] <= uart_rx_data;
        if (rx_fifo_rd_accept)
            rx_fifo_rd_data <= rx_fifo_mem[rx_fifo_rd_ptr];
        rx_fifo_rd_valid <= rx_fifo_rd_accept;
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            rx_fifo_rd_pending <= 1'b0;
            rx_fifo_output_valid <= 1'b0;
        end else begin
            if (rx_fifo_rd_valid)
                rx_fifo_rd_pending <= 1'b0;
            else if (rx_fifo_rd_accept)
                rx_fifo_rd_pending <= 1'b1;

            if (rx_fifo_rd_valid)
                rx_fifo_output_valid <= 1'b1;
            else if (apb_rx_transfer)
                rx_fifo_output_valid <= 1'b0;
        end
    end

//================================================================================
//  Transmitter FIFO
//================================================================================

    reg     [FIFO_ADDR_WIDTH-1:0]       tx_fifo_wr_ptr;
    reg     [FIFO_ADDR_WIDTH-1:0]       tx_fifo_rd_ptr;
    reg     [FIFO_ADDR_WIDTH:0]         tx_fifo_count;
    reg     [7:0]                       tx_fifo_mem [0:FIFO_DEPTH-1];
    reg     [7:0]                       tx_fifo_rd_data;
    reg                                 tx_fifo_rd_valid;
    reg                                 tx_fifo_rd_pending;

    wire                                tx_fifo_wr_en;
    wire                                tx_fifo_rd_en;
    wire                                tx_fifo_wr_accept;
    wire                                tx_fifo_rd_accept;
    wire                                tx_fifo_empty;
    wire                                tx_fifo_full;

    assign tx_fifo_wr_en     = apb_tx_data_valid;
    assign tx_fifo_rd_en     = uart_rst_n & ~uart_tx_busy & ~tx_fifo_empty &
                                ~tx_fifo_rd_pending;
    assign tx_fifo_empty     = tx_fifo_count == 0;
    assign tx_fifo_full      = tx_fifo_count == FIFO_DEPTH;
    assign tx_fifo_wr_accept = tx_fifo_wr_en & ~tx_fifo_full &
                                (tx_data_count < FIFO_DEPTH);
    assign tx_fifo_rd_accept = tx_fifo_rd_en & ~tx_fifo_empty;
    assign tx_data_count     = tx_fifo_count + tx_fifo_rd_pending;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_fifo_wr_ptr <= {FIFO_ADDR_WIDTH{1'b0}};
            tx_fifo_rd_ptr <= {FIFO_ADDR_WIDTH{1'b0}};
            tx_fifo_count <= {(FIFO_ADDR_WIDTH+1){1'b0}};
        end else begin
            if (tx_fifo_wr_accept)
                tx_fifo_wr_ptr <= tx_fifo_wr_ptr + 1'b1;
            if (tx_fifo_rd_accept)
                tx_fifo_rd_ptr <= tx_fifo_rd_ptr + 1'b1;
            case ({tx_fifo_wr_accept, tx_fifo_rd_accept})
                2'b10: tx_fifo_count <= tx_fifo_count + 1'b1;
                2'b01: tx_fifo_count <= tx_fifo_count - 1'b1;
                default: tx_fifo_count <= tx_fifo_count;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (tx_fifo_wr_accept)
            tx_fifo_mem[tx_fifo_wr_ptr] <= apb_tx_data;
        if (tx_fifo_rd_accept)
            tx_fifo_rd_data <= tx_fifo_mem[tx_fifo_rd_ptr];
        tx_fifo_rd_valid <= tx_fifo_rd_accept;
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_fifo_rd_pending <= 1'b0;
        end else if (tx_fifo_rd_valid) begin
            tx_fifo_rd_pending <= 1'b0;
        end else if (tx_fifo_rd_accept) begin
            tx_fifo_rd_pending <= 1'b1;
        end
    end

//================================================================================
//  Baud-rate divider
//================================================================================

    wire    [23:0]                      baud_rate;
    wire                                stop_bit;
    wire    [1:0]                       parity_type;

    reg     [31:0]                      div_dividend;
    reg     [31:0]                      div_divisor;
    reg     [31:0]                      div_quotient;
    reg     [5:0]                       div_cnt;
    reg                                 div_busy;
    reg     [32:0]                      div_remainder;
    reg                                 parity_en;
    reg     [1:0]                       stop_bit_cnt;
    reg     [31:0]                      baud_cnt;

    assign baud_rate  = uart_config[23:0];
    assign stop_bit   = uart_config[31];
    assign parity_type = uart_config[30:29];

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            baud_cnt <= 32'd0;
            parity_en <= 1'b0;
            stop_bit_cnt <= 2'd0;
        end else begin
            baud_cnt <= ~div_busy ? div_quotient : baud_cnt;
            parity_en <= |parity_type;
            stop_bit_cnt <= stop_bit ? 2'd2 : 2'd1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            div_busy <= 1'b0;
            div_cnt <= 6'd0;
            div_dividend <= 32'd0;
            div_divisor <= 32'd0;
            div_remainder <= 33'd0;
            div_quotient <= 32'd0;
        end else begin
            div_busy <=
                div_divisor != baud_rate ? 1'b1 :
                div_cnt == 31 ? 1'b0 :
                div_busy;
            div_cnt <=
                div_divisor != baud_rate ? 6'd0 :
                div_busy ? (div_cnt == 31 ? 6'd0 : div_cnt + 1'b1) :
                div_cnt;
            div_dividend <=
                div_divisor != baud_rate ? SYS_CLK_FREQ :
                div_busy ? {div_dividend[30:0], 1'b0} :
                SYS_CLK_FREQ;
            div_divisor <= baud_rate;
            div_remainder <=
                div_divisor != baud_rate ? 33'd0 :
                div_busy ?
                    ({div_remainder[31:0], div_dividend[31]} >= div_divisor ?
                        {div_remainder[31:0], div_dividend[31]} - div_divisor :
                        {div_remainder[31:0], div_dividend[31]}) :
                div_remainder;
            div_quotient <=
                div_divisor != baud_rate ? 32'd0 :
                div_busy ?
                    ({div_remainder[31:0], div_dividend[31]} >= div_divisor ?
                        {div_quotient[30:0], 1'b1} :
                        {div_quotient[30:0], 1'b0}) :
                div_quotient;
        end
    end

//================================================================================
//  UART receiver
//================================================================================

    reg                                 uart_rx_ff0;
    reg                                 uart_rx_ff1;
    reg                                 uart_rx_ff2;
    reg                                 uart_rx_parity;
    reg                                 uart_rx_busy;
    reg     [9:0]                       uart_rx_baud_cnt;
    reg     [3:0]                       uart_rx_bit_cnt;
    reg                                 uart_rx_pass;
    reg                                 uart_rx_data_valid;
    reg     [7:0]                       uart_rx_data;
    wire                                uart_rx_data_ready;

    assign uart_rx_data_ready = rx_data_count < FIFO_DEPTH;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_ff0 <= 1'b1;
            uart_rx_ff1 <= 1'b1;
            uart_rx_ff2 <= 1'b1;
        end else begin
            uart_rx_ff0 <= uart_rx;
            uart_rx_ff1 <= uart_rx_ff0;
            uart_rx_ff2 <= uart_rx_ff1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_busy <= 1'b0;
        end else begin
            uart_rx_busy <=
                uart_rx_ff2 & ~uart_rx_ff1 ? 1'b1 :
                (uart_rx_bit_cnt == 8 + parity_en) &&
                (uart_rx_baud_cnt == baud_cnt - 1) ? 1'b0 :
                uart_rx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_baud_cnt <= 10'd0;
        end else if (uart_rx_busy) begin
            uart_rx_baud_cnt <=
                uart_rx_baud_cnt == baud_cnt - 1 ? 10'd0 :
                uart_rx_baud_cnt + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_bit_cnt <= 4'd0;
        end else if (uart_rx_baud_cnt == baud_cnt - 1) begin
            uart_rx_bit_cnt <=
                uart_rx_bit_cnt == 8 + parity_en ? 4'd0 :
                uart_rx_bit_cnt + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_data <= 8'd0;
            uart_rx_parity <= 1'b0;
        end else if (uart_rx_baud_cnt == baud_cnt / 2 - 1) begin
            case (uart_rx_bit_cnt)
                4'd1: uart_rx_data[0] <= uart_rx_ff2;
                4'd2: uart_rx_data[1] <= uart_rx_ff2;
                4'd3: uart_rx_data[2] <= uart_rx_ff2;
                4'd4: uart_rx_data[3] <= uart_rx_ff2;
                4'd5: uart_rx_data[4] <= uart_rx_ff2;
                4'd6: uart_rx_data[5] <= uart_rx_ff2;
                4'd7: uart_rx_data[6] <= uart_rx_ff2;
                4'd8: uart_rx_data[7] <= uart_rx_ff2;
                4'd9: uart_rx_parity <= uart_rx_ff2;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_pass <= 1'b0;
        end else begin
            uart_rx_pass <=
                parity_type == 1 ? uart_rx_parity == ^~uart_rx_data :
                parity_type == 2 ? uart_rx_parity == ^uart_rx_data :
                1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_rx_data_valid <= 1'b0;
        end else begin
            uart_rx_data_valid <=
                uart_rx_data_valid & uart_rx_data_ready ? 1'b0 :
                (uart_rx_bit_cnt == 8 + parity_en) &&
                (uart_rx_baud_cnt == baud_cnt - 1) && uart_rx_pass ? 1'b1 :
                uart_rx_data_valid;
        end
    end

//================================================================================
//  UART transmitter
//================================================================================

    reg     [7:0]                       uart_tx_data;
    reg                                 uart_tx_busy;
    reg     [9:0]                       uart_tx_baud_cnt;
    reg     [3:0]                       uart_tx_bit_cnt;
    reg                                 uart_tx_parity;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx_busy <= 1'b0;
        end else begin
            uart_tx_busy <=
                tx_fifo_rd_valid ? 1'b1 :
                (uart_tx_bit_cnt == 8 + parity_en + stop_bit_cnt) &&
                (uart_tx_baud_cnt == baud_cnt - 1) ? 1'b0 :
                uart_tx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (tx_fifo_rd_valid)
            uart_tx_data <= tx_fifo_rd_data;
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx_baud_cnt <= 10'd0;
        end else if (uart_tx_busy) begin
            uart_tx_baud_cnt <=
                uart_tx_baud_cnt == baud_cnt - 1 ? 10'd0 :
                uart_tx_baud_cnt + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx_bit_cnt <= 4'd0;
        end else if (uart_tx_baud_cnt == baud_cnt - 1) begin
            uart_tx_bit_cnt <=
                uart_tx_bit_cnt == 8 + parity_en + stop_bit_cnt ? 4'd0 :
                uart_tx_bit_cnt + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx_parity <= 1'b0;
        end else if (tx_fifo_rd_valid) begin
            uart_tx_parity <=
                parity_type == 1 ? ^~tx_fifo_rd_data :
                parity_type == 2 ? ^tx_fifo_rd_data :
                1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            uart_tx <= 1'b1;
        end else if (uart_tx_busy) begin
            case (uart_tx_bit_cnt)
                4'd0: uart_tx <= 1'b0;
                4'd1: uart_tx <= uart_tx_data[0];
                4'd2: uart_tx <= uart_tx_data[1];
                4'd3: uart_tx <= uart_tx_data[2];
                4'd4: uart_tx <= uart_tx_data[3];
                4'd5: uart_tx <= uart_tx_data[4];
                4'd6: uart_tx <= uart_tx_data[5];
                4'd7: uart_tx <= uart_tx_data[6];
                4'd8: uart_tx <= uart_tx_data[7];
                4'd9: uart_tx <= uart_tx_parity;
                default: uart_tx <= 1'b1;
            endcase
        end
    end

endmodule
