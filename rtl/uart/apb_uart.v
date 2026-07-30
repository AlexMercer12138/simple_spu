`timescale 1ns/1ps
//================================================================================
//  Author      : Mercer
//  Module      : apb_uart
//  Description : APB UART controller with byte-wide TX and RX FIFOs
//================================================================================

module apb_uart #(
    parameter SYS_CLK_FREQ = 50_000_000,
    parameter FIFO_DEPTH   = 8
)(
    input   wire        s_apb_pclk,
    input   wire        s_apb_presetn,

    input   wire        s_apb_psel,
    input   wire        s_apb_penable,
    input   wire        s_apb_pwrite,
    input   wire [31:0] s_apb_paddr,
    input   wire [31:0] s_apb_pwdata,

    output  wire        s_apb_pready,
    output  wire        s_apb_pslverr,
    output  wire [31:0] s_apb_prdata,
    output  reg         interrupt,

    input   wire        uart_rx,
    output  reg         uart_tx
);

    localparam ADDR_WIDTH = $clog2(FIFO_DEPTH);

//================================================================================
//  APB interface
//================================================================================

    reg         apb_pready;
    reg  [31:0] apb_prdata;

    wire [9:0]  opt_addr;
    wire        slv_reg_rden;
    wire        slv_reg_wren;
    wire        apb_read_access;

    assign opt_addr = s_apb_paddr[11:2];
    assign slv_reg_wren = s_apb_psel && s_apb_penable &&
                          s_apb_pwrite && apb_pready;
    assign slv_reg_rden = s_apb_psel && !s_apb_penable &&
                          !s_apb_pwrite;
    assign apb_read_access = s_apb_psel && s_apb_penable &&
                             !s_apb_pwrite && apb_pready;

    assign s_apb_pready = apb_pready;
    assign s_apb_pslverr = 1'b0;
    assign s_apb_prdata = apb_prdata;

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn) begin
            apb_pready <= 1'b0;
        end else if (s_apb_psel && apb_pready) begin
            apb_pready <= 1'b0;
        end else if (s_apb_psel) begin
            apb_pready <= 1'b1;
        end else begin
            apb_pready <= 1'b0;
        end
    end

//================================================================================
//  Register and FIFO control
//================================================================================

    reg  [1:0]  uart_ctrl;
    reg  [31:0] uart_config;
    reg  [31:0] uart_interrupt;
    reg         rx_read_valid;
    reg         tx_load_pending;

    wire        ctrl_write;
    wire        rx_enable;
    wire        tx_enable;
    wire        rx_clear_write;
    wire        tx_clear_write;
    wire        soft_reset_write;
    wire        uart_rst_n;
    wire        rx_core_rst_n;
    wire        rx_fifo_rst_n;
    wire        tx_fifo_rst_n;

    wire [7:0]  rx_fifo_data;
    wire [7:0]  tx_fifo_data;
    wire        rx_fifo_wr_en;
    wire        rx_fifo_rd_en;
    wire        tx_fifo_wr_en;
    wire        tx_fifo_rd_en;
    wire        rx_empty;
    wire        rx_full;
    wire        tx_empty;
    wire        tx_full;
    wire [ADDR_WIDTH:0] rx_fifo_count;
    wire [ADDR_WIDTH:0] tx_fifo_count;
    wire [7:0]  rx_level;
    wire [7:0]  tx_level;
    wire        tx_busy_status;

    reg         uart_rx_valid;
    reg  [7:0]  uart_rx_data;
    reg         rx_busy;
    reg         tx_busy;

    assign ctrl_write = slv_reg_wren && (opt_addr == 10'd0);
    assign rx_enable = uart_ctrl[0];
    assign tx_enable = uart_ctrl[1];
    assign rx_clear_write = ctrl_write && s_apb_pwdata[2];
    assign tx_clear_write = ctrl_write && s_apb_pwdata[3];
    assign soft_reset_write = ctrl_write && s_apb_pwdata[31];

    assign uart_rst_n = s_apb_presetn && !soft_reset_write;
    assign rx_core_rst_n = uart_rst_n && rx_enable;
    assign rx_fifo_rst_n = uart_rst_n && !rx_clear_write;
    assign tx_fifo_rst_n = uart_rst_n && !tx_clear_write;

    assign rx_level = rx_fifo_count;
    assign tx_level = tx_fifo_count;
    assign tx_busy_status = tx_busy || tx_load_pending;

    assign rx_fifo_wr_en = rx_enable && uart_rx_valid && !rx_full;
    assign rx_fifo_rd_en = apb_read_access && (opt_addr == 10'd2) &&
                           !rx_empty;
    assign tx_fifo_wr_en = slv_reg_wren && (opt_addr == 10'd4) &&
                           !tx_full;
    assign tx_fifo_rd_en = tx_enable && !tx_busy && !tx_load_pending &&
                           !tx_empty && !tx_clear_write && !soft_reset_write;

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn || soft_reset_write) begin
            uart_ctrl <= 2'b00;
            uart_config <= 32'd0;
            uart_interrupt <= 32'd0;
        end else if (slv_reg_wren) begin
            case (opt_addr)
                10'd0: uart_ctrl <= s_apb_pwdata[1:0];
                10'd1: uart_config <= s_apb_pwdata;
                10'd6: uart_interrupt <= s_apb_pwdata & 32'hFFFF_FFF7;
                default: begin
                end
            endcase
        end else if (interrupt) begin
            uart_interrupt[4] <= 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn || soft_reset_write) begin
            apb_prdata <= 32'd0;
        end else if (slv_reg_rden) begin
            case (opt_addr)
                10'd0: apb_prdata <= {30'd0, uart_ctrl};
                10'd1: apb_prdata <= uart_config;
                10'd2: apb_prdata <= rx_read_valid ?
                                       {24'd0, rx_fifo_data} : 32'd0;
                10'd3: apb_prdata <= {21'd0, rx_busy, rx_full, rx_empty,
                                      rx_level};
                10'd4: apb_prdata <= 32'd0;
                10'd5: apb_prdata <= {21'd0, tx_busy_status, tx_full,
                                      tx_empty, tx_level};
                10'd6: apb_prdata <= uart_interrupt;
                default: apb_prdata <= apb_prdata;
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!rx_fifo_rst_n)
            rx_read_valid <= 1'b0;
        else if (rx_fifo_rd_en)
            rx_read_valid <= 1'b1;
    end

    always @(posedge s_apb_pclk) begin
        if (!tx_fifo_rst_n)
            tx_load_pending <= 1'b0;
        else
            tx_load_pending <= tx_fifo_rd_en;
    end

    sync_fifo #(
        .DATA_WIDTH (8),
        .FIFO_DEPTH (FIFO_DEPTH)
    ) rx_fifo_inst (
        .clk      (s_apb_pclk),
        .rst_n    (rx_fifo_rst_n),
        .wr_en    (rx_fifo_wr_en),
        .din      (uart_rx_data),
        .rd_en    (rx_fifo_rd_en),
        .dout     (rx_fifo_data),
        .empty    (rx_empty),
        .full     (rx_full),
        .data_cnt (rx_fifo_count)
    );

    sync_fifo #(
        .DATA_WIDTH (8),
        .FIFO_DEPTH (FIFO_DEPTH)
    ) tx_fifo_inst (
        .clk      (s_apb_pclk),
        .rst_n    (tx_fifo_rst_n),
        .wr_en    (tx_fifo_wr_en),
        .din      (s_apb_pwdata[7:0]),
        .rd_en    (tx_fifo_rd_en),
        .dout     (tx_fifo_data),
        .empty    (tx_empty),
        .full     (tx_full),
        .data_cnt (tx_fifo_count)
    );

//================================================================================
//  UART timing configuration
//================================================================================

    wire [23:0] baud_rate;
    wire        stop_bit;
    wire [1:0]  parity_type;

    reg  [31:0] div_dividend;
    reg  [31:0] div_divisor;
    reg  [31:0] div_quotient;
    reg  [5:0]  div_cnt;
    reg         div_busy;
    reg  [32:0] div_remainder;
    reg         parity_en;
    reg  [1:0]  stop_bit_cnt;
    reg  [31:0] baud_cnt;

    assign baud_rate = uart_config[23:0];
    assign stop_bit = uart_config[31];
    assign parity_type = uart_config[30:29];

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            baud_cnt <= 32'd0;
            parity_en <= 1'b0;
            stop_bit_cnt <= 2'd0;
        end else begin
            baud_cnt <= !div_busy ? div_quotient : baud_cnt;
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

    reg         rx_ff0;
    reg         rx_ff1;
    reg         rx_ff2;
    reg         rx_parity;
    reg  [9:0]  rx_baud_cnt;
    reg  [3:0]  rx_bit_cnt;
    reg         rx_pass;

    always @(posedge s_apb_pclk) begin
        if (!rx_core_rst_n) begin
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
        if (!rx_core_rst_n) begin
            rx_busy <= 1'b0;
        end else begin
            rx_busy <=
                rx_ff2 && !rx_ff1 ? 1'b1 :
                (rx_bit_cnt == 8 + parity_en) &&
                (rx_baud_cnt == baud_cnt - 1'b1) ? 1'b0 :
                rx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!rx_core_rst_n) begin
            rx_baud_cnt <= 10'd0;
        end else if (rx_busy) begin
            rx_baud_cnt <=
                rx_baud_cnt == baud_cnt - 1'b1 ? 10'd0 :
                rx_baud_cnt + 1'b1;
        end else begin
            rx_baud_cnt <= 10'd0;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!rx_core_rst_n) begin
            rx_bit_cnt <= 4'd0;
        end else if (rx_busy && (rx_baud_cnt == baud_cnt - 1'b1)) begin
            rx_bit_cnt <=
                rx_bit_cnt == 8 + parity_en ? 4'd0 :
                rx_bit_cnt + 1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!rx_core_rst_n) begin
            uart_rx_data <= 8'd0;
            rx_parity <= 1'b0;
        end else if (rx_busy &&
                     (rx_baud_cnt == (baud_cnt / 2) - 1'b1)) begin
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
                default: begin
                end
            endcase
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!rx_core_rst_n) begin
            rx_pass <= 1'b0;
        end else begin
            rx_pass <=
                parity_type == 1 ? rx_parity == ^~uart_rx_data :
                parity_type == 2 ? rx_parity == ^uart_rx_data :
                1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!rx_core_rst_n) begin
            uart_rx_valid <= 1'b0;
        end else begin
            uart_rx_valid <=
                (rx_bit_cnt == 8 + parity_en) &&
                (rx_baud_cnt == baud_cnt - 1'b1) && rx_pass;
        end
    end

//================================================================================
//  UART transmitter
//================================================================================

    reg  [7:0]  tx_ff;
    reg  [9:0]  tx_baud_cnt;
    reg  [3:0]  tx_bit_cnt;
    reg         tx_parity;

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_busy <= 1'b0;
        end else begin
            tx_busy <=
                tx_load_pending ? 1'b1 :
                tx_busy && (tx_bit_cnt == 8 + parity_en + stop_bit_cnt) &&
                (tx_baud_cnt == baud_cnt - 1'b1) ? 1'b0 :
                tx_busy;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_ff <= 8'd0;
            tx_parity <= 1'b0;
        end else if (tx_load_pending) begin
            tx_ff <= tx_fifo_data;
            tx_parity <=
                parity_type == 1 ? ^~tx_fifo_data :
                parity_type == 2 ? ^tx_fifo_data :
                1'b1;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_baud_cnt <= 10'd0;
        end else if (tx_load_pending) begin
            tx_baud_cnt <= 10'd0;
        end else if (tx_busy) begin
            tx_baud_cnt <=
                tx_baud_cnt == baud_cnt - 1'b1 ? 10'd0 :
                tx_baud_cnt + 1'b1;
        end else begin
            tx_baud_cnt <= 10'd0;
        end
    end

    always @(posedge s_apb_pclk) begin
        if (!uart_rst_n) begin
            tx_bit_cnt <= 4'd0;
        end else if (tx_load_pending) begin
            tx_bit_cnt <= 4'd0;
        end else if (tx_busy && (tx_baud_cnt == baud_cnt - 1'b1)) begin
            tx_bit_cnt <=
                tx_bit_cnt == 8 + parity_en + stop_bit_cnt ? 4'd0 :
                tx_bit_cnt + 1'b1;
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
        end else begin
            uart_tx <= 1'b1;
        end
    end

//================================================================================
//  Interrupt output
//================================================================================

    always @(posedge s_apb_pclk) begin
        if (!s_apb_presetn || soft_reset_write) begin
            interrupt <= 1'b0;
        end else if (uart_interrupt[0]) begin
            case (uart_interrupt[2:1])
                2'd0: interrupt <= !rx_empty;
                2'd1: interrupt <= !tx_full;
                2'd2: interrupt <= rx_level >= uart_interrupt[23:16];
                2'd3: interrupt <= tx_level <= uart_interrupt[31:24];
                default: interrupt <= 1'b0;
            endcase
        end else begin
            interrupt <= 1'b0;
        end
    end

endmodule
