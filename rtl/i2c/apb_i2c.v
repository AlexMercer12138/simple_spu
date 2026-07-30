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
    reg         command_active;
    reg         master_cmd_start;
    reg         master_abort;
    reg  [1:0]  active_cmd_op;
    reg  [6:0]  active_cmd_addr;
    reg  [7:0]  active_cmd_tx_len;
    reg  [7:0]  active_cmd_rx_len;
    reg  [15:0] active_prescale;
    reg  [31:0] active_timeout;

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
    wire        start_request;
    wire        abort_request;
    wire        command_shape_valid;
    wire        command_fifo_valid;
    wire        command_start_valid;
    wire        accepted_start;
    wire        rejected_start;
    wire        rx_threshold_clear;
    wire        tx_threshold_clear;
    wire        mode_change_accepted;
    wire        peripheral_active;
    wire        illegal_clear_request;
    wire        tx_clear_accepted;
    wire        rx_clear_accepted;

    wire        master_busy;
    wire        bus_busy;
    wire        slave_selected;
    wire        slave_read;
    wire        stretch_active;

    wire        master_core_rst_n;
    wire        slave_core_rst_n;
    wire        master_busy_core;
    wire        master_done_event;
    wire        master_addr_nack_event;
    wire        master_data_nack_event;
    wire        master_arbitration_event;
    wire        master_timeout_event;
    wire        master_bus_error_event;
    wire [7:0]  master_tx_count;
    wire [7:0]  master_rx_count;
    wire        master_tx_ready;
    wire [7:0]  master_rx_data;
    wire        master_rx_valid;
    wire        master_scl_t;
    wire        master_sda_t;

    wire        slave_selected_core;
    wire        slave_read_core;
    wire        slave_stretch_core;
    wire        slave_bus_busy_core;
    wire        slave_rx_done_event;
    wire        slave_read_done_event;
    wire        slave_rx_overflow_event;
    wire        slave_tx_underflow_event;
    wire        slave_stretch_timeout_event;
    wire        slave_bus_error_event;
    wire [7:0]  slave_rx_count;
    wire [7:0]  slave_tx_count;
    wire [7:0]  slave_rx_data;
    wire        slave_rx_valid;
    wire        slave_tx_ready;
    wire        slave_scl_t;
    wire        slave_sda_t;

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
    assign tx_core_pop = enable_reg &&
                         (master_mode_reg ? master_tx_ready : slave_tx_ready);
    assign rx_core_data = master_mode_reg ? master_rx_data : slave_rx_data;
    assign rx_core_push = enable_reg &&
                          (master_mode_reg ? master_rx_valid : slave_rx_valid);
    assign tx_pop_accepted = tx_core_pop && !tx_empty;
    assign rx_apb_pop = apb_read_access && (word_addr == 10'd5) && !rx_empty;
    assign rx_push_accepted = rx_core_push && (!rx_full || rx_apb_pop);
    assign tx_apb_push = apb_write_access && (word_addr == 10'd4) &&
                         (!tx_full || tx_pop_accepted);
    assign tx_apb_overflow = apb_write_access && (word_addr == 10'd4) &&
                             tx_full && !tx_pop_accepted;

    assign ctrl_write = apb_write_access && (word_addr == 10'd0);
    assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
    assign start_request = ctrl_write && !soft_reset_write &&
                           s_apb_pwdata[2];
    assign abort_request = ctrl_write && !soft_reset_write &&
                           s_apb_pwdata[3];
    assign command_shape_valid =
        ((cmd_op_reg == 2'b00) && (tx_len_reg >= 1) &&
         (tx_len_reg <= FIFO_DEPTH) && (rx_len_reg == 0)) ||
        ((cmd_op_reg == 2'b01) && (tx_len_reg == 0) &&
         (rx_len_reg >= 1) && (rx_len_reg <= FIFO_DEPTH)) ||
        ((cmd_op_reg == 2'b10) && (tx_len_reg >= 1) &&
         (tx_len_reg <= FIFO_DEPTH) && (rx_len_reg >= 1) &&
         (rx_len_reg <= FIFO_DEPTH));
    assign command_fifo_valid = (tx_fifo_count >= tx_len_reg) &&
                                ((FIFO_DEPTH - rx_fifo_count) >= rx_len_reg);
    assign command_start_valid = enable_reg && master_mode_reg &&
                                 !command_active && command_shape_valid &&
                                 command_fifo_valid;
    assign accepted_start = start_request && command_start_valid;
    assign rejected_start = start_request && !command_start_valid;
    assign rx_threshold_clear = apb_write_access &&
                                (word_addr == 10'd9) && s_apb_pwdata[6];
    assign tx_threshold_clear = apb_write_access &&
                                (word_addr == 10'd9) && s_apb_pwdata[7];
    assign mode_change_accepted = ctrl_write && !soft_reset_write &&
                                  !enable_reg &&
                                  (s_apb_pwdata[1] != master_mode_reg);
    assign peripheral_active = command_active || slave_selected_core;
    assign illegal_clear_request = ctrl_write && !soft_reset_write &&
                                   (s_apb_pwdata[4] || s_apb_pwdata[5]) &&
                                   peripheral_active;
    assign tx_clear_accepted = ctrl_write && !soft_reset_write &&
                               s_apb_pwdata[4] && !peripheral_active;
    assign rx_clear_accepted = ctrl_write && !soft_reset_write &&
                               s_apb_pwdata[5] && !peripheral_active;

    assign master_busy = command_active;
    assign bus_busy = master_mode_reg ? master_busy_core : slave_bus_busy_core;
    assign slave_selected = !master_mode_reg && slave_selected_core;
    assign slave_read = !master_mode_reg && slave_read_core;
    assign stretch_active = !master_mode_reg && slave_stretch_core;

    assign master_core_rst_n = rst_n && !soft_reset_write &&
                               enable_reg && master_mode_reg;
    assign slave_core_rst_n = rst_n && !soft_reset_write &&
                              enable_reg && !master_mode_reg;

    assign interrupt = |(irq_status_reg & irq_enable_reg);
    assign scl_o = 1'b0;
    assign sda_o = 1'b0;
    assign scl_t = !enable_reg ? 1'b1 :
                   (master_mode_reg ? master_scl_t : slave_scl_t);
    assign sda_t = !enable_reg ? 1'b1 :
                   (master_mode_reg ? master_sda_t : slave_sda_t);

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
            if (rejected_start || illegal_clear_request)
                irq_status_reg[5] <= 1'b1;

            if (accepted_start) begin
                last_tx_count_reg <= 8'd0;
                last_rx_count_reg <= 8'd0;
            end
            if (master_done_event) begin
                irq_status_reg[0] <= 1'b1;
                last_tx_count_reg <= master_tx_count;
                last_rx_count_reg <= master_rx_count;
            end
            if (master_addr_nack_event)
                irq_status_reg[1] <= 1'b1;
            if (master_data_nack_event)
                irq_status_reg[2] <= 1'b1;
            if (master_arbitration_event)
                irq_status_reg[3] <= 1'b1;
            if (master_timeout_event)
                irq_status_reg[4] <= 1'b1;

            if (slave_rx_done_event) begin
                irq_status_reg[8] <= 1'b1;
                last_rx_count_reg <= slave_rx_count;
            end
            if (slave_read_done_event) begin
                irq_status_reg[9] <= 1'b1;
                last_tx_count_reg <= slave_tx_count;
            end
            if (slave_rx_overflow_event)
                irq_status_reg[10] <= 1'b1;
            if (slave_tx_underflow_event)
                irq_status_reg[11] <= 1'b1;
            if (slave_stretch_timeout_event)
                irq_status_reg[12] <= 1'b1;
            if (master_bus_error_event || slave_bus_error_event)
                irq_status_reg[13] <= 1'b1;

            if (enable_reg && !master_mode_reg &&
                (rx_level >= rx_threshold_reg) && !rx_threshold_clear)
                irq_status_reg[6] <= 1'b1;
            if (enable_reg && !master_mode_reg &&
                (tx_level <= tx_threshold_reg) && !tx_threshold_clear)
                irq_status_reg[7] <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            command_active <= 1'b0;
            master_cmd_start <= 1'b0;
            master_abort <= 1'b0;
            active_cmd_op <= 2'b00;
            active_cmd_addr <= 7'd0;
            active_cmd_tx_len <= 8'd0;
            active_cmd_rx_len <= 8'd0;
            active_prescale <= 16'd0;
            active_timeout <= 32'd0;
        end else begin
            master_cmd_start <= 1'b0;
            master_abort <= 1'b0;

            if (accepted_start) begin
                command_active <= 1'b1;
                master_cmd_start <= 1'b1;
                active_cmd_op <= cmd_op_reg;
                active_cmd_addr <= target_addr_reg;
                active_cmd_tx_len <= tx_len_reg;
                active_cmd_rx_len <= rx_len_reg;
                active_prescale <= prescale_reg;
                active_timeout <= timeout_reg;
            end else if (master_done_event || !enable_reg ||
                         !master_mode_reg) begin
                command_active <= 1'b0;
            end

            if (abort_request && command_active && master_mode_reg)
                master_abort <= 1'b1;
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

    i2c_master_lite i2c_master_lite_inst (
        .clk              (clk),
        .rst_n            (master_core_rst_n),
        .enable           (enable_reg && master_mode_reg),
        .cmd_start        (master_cmd_start),
        .cmd_op           (active_cmd_op),
        .cmd_addr         (active_cmd_addr),
        .cmd_tx_len       (active_cmd_tx_len),
        .cmd_rx_len       (active_cmd_rx_len),
        .scl_prescale     (active_prescale),
        .timeout_cycles   (active_timeout),
        .tx_data          (tx_core_data),
        .tx_valid         (!tx_empty),
        .tx_ready         (master_tx_ready),
        .rx_data          (master_rx_data),
        .rx_valid         (master_rx_valid),
        .rx_ready         (!rx_full || rx_apb_pop),
        .busy             (master_busy_core),
        .done             (master_done_event),
        .addr_nack        (master_addr_nack_event),
        .data_nack        (master_data_nack_event),
        .arbitration_lost (master_arbitration_event),
        .timeout          (master_timeout_event),
        .bus_error        (master_bus_error_event),
        .tx_count         (master_tx_count),
        .rx_count         (master_rx_count),
        .abort            (master_abort),
        .scl_o            (),
        .scl_t            (master_scl_t),
        .scl_i            (scl_i),
        .sda_o            (),
        .sda_t            (master_sda_t),
        .sda_i            (sda_i)
    );

    i2c_slave i2c_slave_inst (
        .clk             (clk),
        .rst_n           (slave_core_rst_n),
        .enable          (enable_reg && !master_mode_reg),
        .device_addr     (slave_addr_reg),
        .timeout_cycles  (timeout_reg),
        .rx_data         (slave_rx_data),
        .rx_valid        (slave_rx_valid),
        .rx_ready        (!rx_full || rx_apb_pop),
        .tx_data         (tx_core_data),
        .tx_valid        (!tx_empty),
        .tx_ready        (slave_tx_ready),
        .selected        (slave_selected_core),
        .read_mode       (slave_read_core),
        .stretch_active  (slave_stretch_core),
        .bus_busy        (slave_bus_busy_core),
        .rx_done         (slave_rx_done_event),
        .read_done       (slave_read_done_event),
        .rx_overflow     (slave_rx_overflow_event),
        .tx_underflow    (slave_tx_underflow_event),
        .stretch_timeout (slave_stretch_timeout_event),
        .bus_error       (slave_bus_error_event),
        .rx_count        (slave_rx_count),
        .tx_count        (slave_tx_count),
        .scl_o           (),
        .scl_t           (slave_scl_t),
        .scl_i           (scl_i),
        .sda_o           (),
        .sda_t           (slave_sda_t),
        .sda_i           (sda_i)
    );

endmodule
