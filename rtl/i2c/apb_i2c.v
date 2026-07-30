//================================================================================
//  Author      : Mercer
//  Module      : apb_i2c
//  Description : APB register and FIFO wrapper for the I2C protocol engines
//================================================================================

module apb_i2c #(
    parameter SYS_CLK_FREQ = 50_000_000,
    parameter FIFO_DEPTH   = 16
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
    output  wire        interrupt,
    output  wire        scl_o,
    output  wire        scl_t,
    input   wire        scl_i,
    output  wire        sda_o,
    output  wire        sda_t,
    input   wire        sda_i
);

    function integer clog2;
        input integer value;
        integer shifted;
        begin
            shifted = value - 1;
            for (clog2 = 0; shifted > 0; clog2 = clog2 + 1)
                shifted = shifted >> 1;
        end
    endfunction

    localparam ADDR_WIDTH = clog2(FIFO_DEPTH);
    localparam DEFAULT_PRESCALE =
        (((SYS_CLK_FREQ + 400_000 - 1) / 400_000) > 0) ?
        (((SYS_CLK_FREQ + 400_000 - 1) / 400_000) - 1) : 0;
    localparam DEFAULT_TIMEOUT = SYS_CLK_FREQ / 1000;

    wire        clk;
    wire        rst_n;
    wire [9:0]  word_addr;
    wire        apb_setup;
    wire        apb_write_access;
    wire        apb_read_access;
    reg         apb_pready;
    reg  [31:0] apb_prdata;

    reg         enable_reg;
    reg         master_mode_reg;
    reg  [1:0]  cmd_op_reg;
    reg  [6:0]  target_addr_reg;
    reg  [7:0]  tx_len_reg;
    reg  [7:0]  rx_len_reg;
    reg  [15:0] prescale_reg;
    reg  [6:0]  slave_addr_reg;
    reg  [31:0] timeout_reg;
    reg  [13:0] irq_status_reg;
    reg  [13:0] irq_enable_reg;
    reg  [7:0]  rx_threshold_reg;
    reg  [7:0]  tx_threshold_reg;
    reg  [7:0]  last_tx_count_reg;
    reg  [7:0]  last_rx_count_reg;

    reg  [ADDR_WIDTH-1:0] tx_wr_ptr;
    reg  [ADDR_WIDTH-1:0] tx_rd_ptr;
    reg  [ADDR_WIDTH:0]   tx_fifo_count;
    reg  [7:0]            tx_fifo [0:FIFO_DEPTH-1];
    reg  [ADDR_WIDTH-1:0] rx_wr_ptr;
    reg  [ADDR_WIDTH-1:0] rx_rd_ptr;
    reg  [ADDR_WIDTH:0]   rx_fifo_count;
    reg  [7:0]            rx_fifo [0:FIFO_DEPTH-1];

    wire        tx_empty;
    wire        tx_full;
    wire        rx_empty;
    wire        rx_full;
    wire [7:0]  tx_level;
    wire [7:0]  rx_level;

    wire [7:0]  tx_core_data;
    wire        tx_core_pop;
    wire [7:0]  rx_core_data;
    wire        rx_core_push;
    wire        tx_pop_accepted;
    wire        rx_push_accepted;
    wire        tx_apb_push;
    wire        tx_apb_overflow;
    wire        rx_apb_pop;

    wire        ctrl_write;
    wire        soft_reset_write;
    wire        mode_change_accepted;
    wire        tx_clear_accepted;
    wire        rx_clear_accepted;

    wire        master_busy;
    wire        bus_busy;
    wire        slave_selected;
    wire        slave_read;
    wire        stretch_active;

    assign clk = s_apb_pclk;
    assign rst_n = s_apb_presetn;
    assign word_addr = s_apb_paddr[11:2];
    assign apb_setup = s_apb_psel && !s_apb_penable;
    assign apb_write_access = s_apb_psel && s_apb_penable &&
                              s_apb_pwrite && apb_pready;
    assign apb_read_access = s_apb_psel && s_apb_penable &&
                             !s_apb_pwrite && apb_pready;

    assign s_apb_pready = apb_pready;
    assign s_apb_pslverr = 1'b0;
    assign s_apb_prdata = apb_prdata;

    assign tx_empty = tx_fifo_count == 0;
    assign tx_full = tx_fifo_count == FIFO_DEPTH;
    assign rx_empty = rx_fifo_count == 0;
    assign rx_full = rx_fifo_count == FIFO_DEPTH;
    assign tx_level = tx_fifo_count;
    assign rx_level = rx_fifo_count;

    assign tx_core_data = tx_fifo[tx_rd_ptr];
    assign tx_core_pop = 1'b0;
    assign rx_core_data = 8'd0;
    assign rx_core_push = 1'b0;
    assign tx_pop_accepted = tx_core_pop && !tx_empty;
    assign rx_push_accepted = rx_core_push && !rx_full;
    assign tx_apb_push = apb_write_access && (word_addr == 10'd4) && !tx_full;
    assign tx_apb_overflow = apb_write_access && (word_addr == 10'd4) && tx_full;
    assign rx_apb_pop = apb_read_access && (word_addr == 10'd5) && !rx_empty;

    assign ctrl_write = apb_write_access && (word_addr == 10'd0);
    assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
    assign mode_change_accepted = ctrl_write && !soft_reset_write &&
                                  !enable_reg &&
                                  (s_apb_pwdata[1] != master_mode_reg);
    assign tx_clear_accepted = ctrl_write && !soft_reset_write &&
                               s_apb_pwdata[4];
    assign rx_clear_accepted = ctrl_write && !soft_reset_write &&
                               s_apb_pwdata[5];

    assign master_busy = 1'b0;
    assign bus_busy = 1'b0;
    assign slave_selected = 1'b0;
    assign slave_read = 1'b0;
    assign stretch_active = 1'b0;

    assign interrupt = |(irq_status_reg & irq_enable_reg);
    assign scl_o = 1'b0;
    assign sda_o = 1'b0;
    assign scl_t = 1'b1;
    assign sda_t = 1'b1;

    always @(posedge clk) begin
        if (!rst_n) begin
            apb_pready <= 1'b0;
        end else if (s_apb_psel && apb_pready) begin
            apb_pready <= 1'b0;
        end else if (s_apb_psel) begin
            apb_pready <= 1'b1;
        end else begin
            apb_pready <= 1'b0;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            apb_prdata <= 32'd0;
        end else if (apb_setup && !s_apb_pwrite) begin
            case (word_addr)
                10'd0: apb_prdata <= {30'd0, master_mode_reg, enable_reg};
                10'd1: apb_prdata <= {rx_len_reg, tx_len_reg, 1'b0,
                                      target_addr_reg, 6'd0, cmd_op_reg};
                10'd2: apb_prdata <= {16'd0, prescale_reg};
                10'd3: apb_prdata <= {last_rx_count_reg, last_tx_count_reg,
                                      7'd0, rx_full, rx_empty, tx_full,
                                      tx_empty, stretch_active, slave_read,
                                      slave_selected, bus_busy, master_busy};
                10'd4: apb_prdata <= 32'd0;
                10'd5: apb_prdata <= rx_empty ? 32'd0 :
                                      {24'd0, rx_fifo[rx_rd_ptr]};
                10'd6: apb_prdata <= {12'd0, rx_full, rx_empty, tx_full,
                                      tx_empty, rx_level, tx_level};
                10'd7: apb_prdata <= {25'd0, slave_addr_reg};
                10'd8: apb_prdata <= timeout_reg;
                10'd9: apb_prdata <= {18'd0, irq_status_reg};
                10'd10: apb_prdata <= {18'd0, irq_enable_reg};
                10'd11: apb_prdata <= {16'd0, tx_threshold_reg,
                                       rx_threshold_reg};
                default: apb_prdata <= 32'd0;
            endcase
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            enable_reg <= 1'b0;
            master_mode_reg <= 1'b0;
            cmd_op_reg <= 2'b00;
            target_addr_reg <= 7'd0;
            tx_len_reg <= 8'd0;
            rx_len_reg <= 8'd0;
            prescale_reg <= DEFAULT_PRESCALE;
            slave_addr_reg <= 7'h50;
            timeout_reg <= DEFAULT_TIMEOUT;
            irq_status_reg <= 14'd0;
            irq_enable_reg <= 14'd0;
            rx_threshold_reg <= 8'd1;
            tx_threshold_reg <= 8'd0;
            last_tx_count_reg <= 8'd0;
            last_rx_count_reg <= 8'd0;
        end else begin
            if (apb_write_access) begin
                case (word_addr)
                    10'd0: begin
                        enable_reg <= s_apb_pwdata[0];
                        if (!enable_reg)
                            master_mode_reg <= s_apb_pwdata[1];
                        else if (s_apb_pwdata[1] != master_mode_reg)
                            irq_status_reg[5] <= 1'b1;
                    end
                    10'd1: begin
                        cmd_op_reg <= s_apb_pwdata[1:0];
                        target_addr_reg <= s_apb_pwdata[14:8];
                        tx_len_reg <= s_apb_pwdata[23:16];
                        rx_len_reg <= s_apb_pwdata[31:24];
                    end
                    10'd2: prescale_reg <= s_apb_pwdata[15:0];
                    10'd7: begin
                        if (!enable_reg)
                            slave_addr_reg <= s_apb_pwdata[6:0];
                        else if (s_apb_pwdata[6:0] != slave_addr_reg)
                            irq_status_reg[5] <= 1'b1;
                    end
                    10'd8: timeout_reg <= s_apb_pwdata;
                    10'd9: irq_status_reg <=
                                irq_status_reg & ~s_apb_pwdata[13:0];
                    10'd10: irq_enable_reg <= s_apb_pwdata[13:0];
                    10'd11: begin
                        rx_threshold_reg <= s_apb_pwdata[7:0];
                        tx_threshold_reg <= s_apb_pwdata[15:8];
                    end
                    default: begin
                    end
                endcase
            end

            if (tx_apb_overflow)
                irq_status_reg[5] <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write || mode_change_accepted ||
            tx_clear_accepted) begin
            tx_wr_ptr <= {ADDR_WIDTH{1'b0}};
            tx_rd_ptr <= {ADDR_WIDTH{1'b0}};
            tx_fifo_count <= {(ADDR_WIDTH+1){1'b0}};
        end else begin
            if (tx_apb_push) begin
                tx_fifo[tx_wr_ptr] <= s_apb_pwdata[7:0];
                tx_wr_ptr <= tx_wr_ptr + 1'b1;
            end
            if (tx_pop_accepted)
                tx_rd_ptr <= tx_rd_ptr + 1'b1;

            case ({tx_apb_push, tx_pop_accepted})
                2'b10: tx_fifo_count <= tx_fifo_count + 1'b1;
                2'b01: tx_fifo_count <= tx_fifo_count - 1'b1;
                default: tx_fifo_count <= tx_fifo_count;
            endcase
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write || mode_change_accepted ||
            rx_clear_accepted) begin
            rx_wr_ptr <= {ADDR_WIDTH{1'b0}};
            rx_rd_ptr <= {ADDR_WIDTH{1'b0}};
            rx_fifo_count <= {(ADDR_WIDTH+1){1'b0}};
        end else begin
            if (rx_push_accepted) begin
                rx_fifo[rx_wr_ptr] <= rx_core_data;
                rx_wr_ptr <= rx_wr_ptr + 1'b1;
            end
            if (rx_apb_pop)
                rx_rd_ptr <= rx_rd_ptr + 1'b1;

            case ({rx_push_accepted, rx_apb_pop})
                2'b10: rx_fifo_count <= rx_fifo_count + 1'b1;
                2'b01: rx_fifo_count <= rx_fifo_count - 1'b1;
                default: rx_fifo_count <= rx_fifo_count;
            endcase
        end
    end

endmodule
