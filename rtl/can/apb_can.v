//================================================================================
//  Author      : Mercer
//  Module      : apb_can
//  Description : APB register and FIFO wrapper for the Classic CAN core
//================================================================================

module apb_can #(
    parameter SYS_CLK_FREQ     = 50_000_000,
    parameter DEFAULT_BIT_RATE = 500_000,
    parameter TX_FIFO_DEPTH    = 8,
    parameter RX_FIFO_DEPTH    = 8
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
    input   wire        can_rx,
    output  wire        can_tx
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

    function [4:0] error_type_mask;
        input [2:0] error_type;
        begin
            case (error_type)
                3'd1: error_type_mask = 5'b00001;
                3'd2: error_type_mask = 5'b00010;
                3'd3: error_type_mask = 5'b00100;
                3'd4: error_type_mask = 5'b01000;
                3'd5: error_type_mask = 5'b10000;
                default: error_type_mask = 5'b00000;
            endcase
        end
    endfunction

    localparam FRAME_WIDTH = 99;
    localparam TX_ADDR_WIDTH = clog2(TX_FIFO_DEPTH);
    localparam RX_ADDR_WIDTH = clog2(RX_FIFO_DEPTH);
    localparam [9:0] DEFAULT_BRP =
        (SYS_CLK_FREQ / (DEFAULT_BIT_RATE * 10)) - 1;
    localparam [31:0] DEFAULT_BIT_TIMING =
        {9'd0, 3'd1, 4'd6, 2'd0, 2'd0, 2'd0, DEFAULT_BRP};

    wire        clk;
    wire        rst_n;
    wire [9:0]  word_addr;
    wire        apb_setup;
    wire        apb_write_access;
    reg         apb_pready;
    reg  [31:0] apb_prdata;

    reg         enable_reg;
    reg         listen_only_reg;
    reg         loopback_reg;
    reg         auto_retry_reg;
    reg         filter_enable_reg;
    reg  [31:0] bit_timing_reg;
    reg  [28:0] tx_id_reg;
    reg  [5:0]  tx_ctrl_reg;
    reg  [31:0] tx_data0_reg;
    reg  [31:0] tx_data1_reg;
    reg  [15:0] fifo_threshold_reg;
    reg  [30:0] accept_code_reg;
    reg  [30:0] accept_mask_reg;
    reg  [15:0] irq_status_reg;
    reg  [15:0] irq_enable_reg;
    reg  [9:0]  error_status_reg;
    reg  [2:0]  last_error_type_reg;
    reg  [3:0]  last_error_field_reg;
    reg  [5:0]  arbitration_lost_pos_reg;
    reg         rx_data_valid_reg;
    reg         can_rx_ff0;
    reg         can_rx_ff1;

    wire                    tx_fifo_rst_n;
    wire                    rx_fifo_rst_n;
    wire [FRAME_WIDTH-1:0]  tx_fifo_din;
    wire [FRAME_WIDTH-1:0]  tx_fifo_dout;
    wire [FRAME_WIDTH-1:0]  rx_fifo_dout;
    wire [TX_ADDR_WIDTH:0]  tx_fifo_count;
    wire [RX_ADDR_WIDTH:0]  rx_fifo_count;
    wire                    tx_fifo_empty;
    wire                    tx_fifo_full;
    wire                    rx_fifo_empty;
    wire                    rx_fifo_full;
    wire                    tx_fifo_wr_en;
    wire                    tx_fifo_rd_en;
    wire                    rx_fifo_wr_en;
    wire                    rx_fifo_rd_en;
    wire [7:0]              tx_level;
    wire [7:0]              rx_level;

    wire        ctrl_write;
    wire        fifo_threshold_write;
    wire        soft_reset_write;
    wire        tx_clear_write;
    wire        rx_clear_write;
    wire        tx_push_request;
    wire        tx_abort_request;
    wire        rx_pop_request;
    wire        tx_shape_valid;
    wire        tx_push_valid;
    wire        tx_overflow_event;
    wire        rx_overflow_event;
    wire        rx_underflow_event;
    wire        invalid_tx_event;
    wire        invalid_ctrl_event;
    wire        invalid_timing_event;
    wire        locked_config_event;
    wire        invalid_abort_event;
    wire        config_error_event;
    wire [15:0] irq_clear_mask;
    wire [15:0] irq_set_mask;
    wire [9:0]  error_clear_mask;
    wire [9:0]  error_set_mask;

    reg         tx_load_pending;
    reg         tx_frame_valid_reg;
    reg         rx_threshold_above_reg;
    reg         tx_threshold_above_reg;
    reg         rx_threshold_event_reg;
    reg         tx_threshold_event_reg;
    wire        core_tx_frame_request;
    wire        core_rx_frame_valid;
    wire [98:0] core_rx_frame;
    wire        core_tx_done_event;
    wire        core_tx_failed_event;
    wire        core_tx_aborted_event;
    wire        core_arbitration_lost_event;
    wire        core_protocol_error_event;
    wire        core_warning_enter_event;
    wire        core_passive_enter_event;
    wire        core_bus_off_enter_event;
    wire        core_bus_recovered_event;
    wire [2:0]  core_last_error_type;
    wire [3:0]  core_last_error_field;
    wire [5:0]  core_arbitration_lost_pos;
    wire        core_running;
    wire        core_bus_idle;
    wire        core_tx_active;
    wire        core_rx_active;
    wire        core_retry_pending;
    wire        core_tx_abort_pending;
    wire        core_error_warning;
    wire        core_error_passive;
    wire        core_bus_off;
    wire [8:0]  core_tec;
    wire [7:0]  core_rec;

    assign clk = s_apb_pclk;
    assign rst_n = s_apb_presetn;
    assign word_addr = s_apb_paddr[11:2];
    assign apb_setup = s_apb_psel && !s_apb_penable;
    assign apb_write_access = s_apb_psel && s_apb_penable &&
                              s_apb_pwrite && apb_pready;

    assign s_apb_pready = apb_pready;
    assign s_apb_pslverr = 1'b0;
    assign s_apb_prdata = apb_prdata;
    assign interrupt = |(irq_status_reg & irq_enable_reg);

    assign ctrl_write = apb_write_access && (word_addr == 10'd0);
    assign fifo_threshold_write = apb_write_access &&
                                  (word_addr == 10'd14);
    assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
    assign tx_clear_write = ctrl_write && !soft_reset_write &&
                            s_apb_pwdata[8];
    assign rx_clear_write = ctrl_write && !soft_reset_write &&
                            s_apb_pwdata[9];
    assign tx_push_request = apb_write_access && (word_addr == 10'd7) &&
                             s_apb_pwdata[0];
    assign tx_abort_request = apb_write_access && (word_addr == 10'd7) &&
                              s_apb_pwdata[1];
    assign rx_pop_request = apb_write_access && (word_addr == 10'd12) &&
                            s_apb_pwdata[0];

    assign tx_shape_valid = (tx_ctrl_reg[3:0] <= 4'd8) &&
                            (tx_ctrl_reg[5] || (tx_id_reg[28:11] == 18'd0));
    assign tx_push_valid = tx_push_request && tx_shape_valid &&
                           !tx_fifo_full;
    assign tx_overflow_event = tx_push_request && tx_shape_valid &&
                               tx_fifo_full;
    assign invalid_tx_event = tx_push_request && !tx_shape_valid;
    assign invalid_ctrl_event = ctrl_write && !soft_reset_write &&
                                ((s_apb_pwdata[1] && s_apb_pwdata[2]) ||
                                 (core_running &&
                                  (s_apb_pwdata[4:1] !=
                                   {filter_enable_reg, auto_retry_reg,
                                    loopback_reg, listen_only_reg})));
    assign invalid_timing_event = apb_write_access &&
                                  (word_addr == 10'd1) && !core_running &&
                                  ((s_apb_pwdata[19:16] == 4'd0) ||
                                   ({1'b0, s_apb_pwdata[13:12]} >
                                    s_apb_pwdata[22:20]));
    assign locked_config_event = apb_write_access && core_running &&
                                 ((word_addr == 10'd1) ||
                                  (word_addr == 10'd15) ||
                                  (word_addr == 10'd16));
    assign invalid_abort_event = tx_abort_request && !core_tx_active;
    assign config_error_event = invalid_tx_event || invalid_ctrl_event ||
                                invalid_timing_event || locked_config_event ||
                                invalid_abort_event;

    assign tx_fifo_din = {tx_id_reg, tx_ctrl_reg[5], tx_ctrl_reg[4],
                          tx_ctrl_reg[3:0], tx_data1_reg, tx_data0_reg};
    assign tx_fifo_wr_en = tx_push_valid;
    assign tx_fifo_rd_en = core_tx_frame_request && !tx_fifo_empty &&
                           !tx_load_pending;
    assign rx_fifo_wr_en = core_rx_frame_valid && !rx_fifo_full;
    assign rx_fifo_rd_en = rx_pop_request && !rx_fifo_empty;
    assign tx_fifo_rst_n = rst_n && !soft_reset_write && !tx_clear_write;
    assign rx_fifo_rst_n = rst_n && !soft_reset_write && !rx_clear_write;
    assign tx_level = tx_fifo_count;
    assign rx_level = rx_fifo_count;
    assign rx_overflow_event = core_rx_frame_valid && rx_fifo_full;
    assign rx_underflow_event = rx_pop_request && rx_fifo_empty;

    assign irq_clear_mask = (apb_write_access && (word_addr == 10'd17)) ?
                            s_apb_pwdata[15:0] : 16'd0;
    assign irq_set_mask =
        ({15'd0, (core_rx_frame_valid && !rx_fifo_full)} << 0) |
        ({15'd0, core_tx_done_event} << 1) |
        ({15'd0, rx_threshold_event_reg} << 2) |
        ({15'd0, tx_threshold_event_reg} << 3) |
        ({15'd0, core_tx_failed_event} << 4) |
        ({15'd0, core_arbitration_lost_event} << 5) |
        ({15'd0, core_protocol_error_event} << 6) |
        ({15'd0, core_warning_enter_event} << 7) |
        ({15'd0, core_passive_enter_event} << 8) |
        ({15'd0, core_bus_off_enter_event} << 9) |
        ({15'd0, core_bus_recovered_event} << 10) |
        ({15'd0, rx_overflow_event} << 11) |
        ({15'd0, tx_overflow_event} << 12) |
        ({15'd0, rx_underflow_event} << 13) |
        ({15'd0, config_error_event} << 14) |
        ({15'd0, core_tx_aborted_event} << 15);

    assign error_clear_mask =
        (apb_write_access && (word_addr == 10'd20)) ?
        s_apb_pwdata[9:0] : 10'd0;
    assign error_set_mask =
        (core_protocol_error_event ?
         {5'd0, error_type_mask(core_last_error_type)} : 10'd0) |
        ({9'd0, core_arbitration_lost_event} << 5) |
        ({9'd0, rx_overflow_event} << 6) |
        ({9'd0, tx_overflow_event} << 7) |
        ({9'd0, rx_underflow_event} << 8) |
        ({9'd0, config_error_event} << 9);

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
                10'd0: apb_prdata <= {27'd0, filter_enable_reg,
                                      auto_retry_reg, loopback_reg,
                                      listen_only_reg, enable_reg};
                10'd1: apb_prdata <= bit_timing_reg;
                10'd2: apb_prdata <= {18'd0, core_tx_abort_pending,
                                      can_rx_ff1, loopback_reg,
                                      listen_only_reg, core_bus_off,
                                      core_error_passive,
                                      core_error_warning,
                                      rx_data_valid_reg,
                                      core_retry_pending,
                                      core_rx_active, core_tx_active,
                                      core_bus_idle, core_running,
                                      enable_reg};
                10'd3: apb_prdata <= {3'd0, tx_id_reg};
                10'd4: apb_prdata <= {26'd0, tx_ctrl_reg};
                10'd5: apb_prdata <= tx_data0_reg;
                10'd6: apb_prdata <= tx_data1_reg;
                10'd7: apb_prdata <= 32'd0;
                10'd8: apb_prdata <= {3'd0, rx_fifo_dout[98:70]};
                10'd9: apb_prdata <= {26'd0, rx_fifo_dout[69],
                                      rx_fifo_dout[68],
                                      rx_fifo_dout[67:64]};
                10'd10: apb_prdata <= rx_fifo_dout[31:0];
                10'd11: apb_prdata <= rx_fifo_dout[63:32];
                10'd12: apb_prdata <= 32'd0;
                10'd13: apb_prdata <= {10'd0, rx_data_valid_reg,
                                       core_tx_active, rx_fifo_full,
                                       rx_fifo_empty, tx_fifo_full,
                                       tx_fifo_empty, rx_level, tx_level};
                10'd14: apb_prdata <= {16'd0, fifo_threshold_reg};
                10'd15: apb_prdata <= {1'b0, accept_code_reg};
                10'd16: apb_prdata <= {1'b0, accept_mask_reg};
                10'd17: apb_prdata <= {16'd0, irq_status_reg};
                10'd18: apb_prdata <= {16'd0, irq_enable_reg};
                10'd19: apb_prdata <= {8'd0, core_rec, 7'd0, core_tec};
                10'd20: apb_prdata <= {8'd0,
                                       arbitration_lost_pos_reg,
                                       last_error_field_reg,
                                       1'b0, last_error_type_reg,
                                       error_status_reg};
                default: apb_prdata <= 32'd0;
            endcase
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            enable_reg <= 1'b0;
            listen_only_reg <= 1'b0;
            loopback_reg <= 1'b0;
            auto_retry_reg <= 1'b1;
            filter_enable_reg <= 1'b0;
            bit_timing_reg <= DEFAULT_BIT_TIMING;
            tx_id_reg <= 29'd0;
            tx_ctrl_reg <= 6'd0;
            tx_data0_reg <= 32'd0;
            tx_data1_reg <= 32'd0;
            fifo_threshold_reg <= 16'd0;
            accept_code_reg <= 31'd0;
            accept_mask_reg <= 31'd0;
            irq_enable_reg <= 16'd0;
        end else begin
            if (ctrl_write && !invalid_ctrl_event) begin
                if (!core_running) begin
                    enable_reg <= s_apb_pwdata[0];
                    listen_only_reg <= s_apb_pwdata[1];
                    loopback_reg <= s_apb_pwdata[2];
                    auto_retry_reg <= s_apb_pwdata[3];
                    filter_enable_reg <= s_apb_pwdata[4];
                end else begin
                    enable_reg <= s_apb_pwdata[0];
                end
            end
            if (apb_write_access) begin
                case (word_addr)
                    10'd1: begin
                        if (!core_running && !invalid_timing_event)
                            bit_timing_reg <= s_apb_pwdata & 32'h007f_33ff;
                    end
                    10'd3: tx_id_reg <= s_apb_pwdata[28:0];
                    10'd4: tx_ctrl_reg <= s_apb_pwdata[5:0];
                    10'd5: tx_data0_reg <= s_apb_pwdata;
                    10'd6: tx_data1_reg <= s_apb_pwdata;
                    10'd14: fifo_threshold_reg <= s_apb_pwdata[15:0];
                    10'd15: begin
                        if (!core_running)
                            accept_code_reg <= s_apb_pwdata[30:0];
                    end
                    10'd16: begin
                        if (!core_running)
                            accept_mask_reg <= s_apb_pwdata[30:0];
                    end
                    10'd18: irq_enable_reg <= s_apb_pwdata[15:0];
                    default: begin
                    end
                endcase
            end
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            irq_status_reg <= 16'd0;
            error_status_reg <= 10'd0;
        end else begin
            irq_status_reg <= (irq_status_reg & ~irq_clear_mask) |
                              irq_set_mask;
            error_status_reg <= (error_status_reg & ~error_clear_mask) |
                                error_set_mask;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            last_error_type_reg <= 3'd0;
            last_error_field_reg <= 4'd0;
            arbitration_lost_pos_reg <= 6'd0;
        end else begin
            if (core_protocol_error_event) begin
                last_error_type_reg <= core_last_error_type;
                last_error_field_reg <= core_last_error_field;
            end
            if (core_arbitration_lost_event)
                arbitration_lost_pos_reg <= core_arbitration_lost_pos;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write || rx_clear_write) begin
            rx_data_valid_reg <= 1'b0;
        end else if (rx_pop_request) begin
            rx_data_valid_reg <= !rx_fifo_empty;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write || tx_clear_write) begin
            tx_load_pending <= 1'b0;
            tx_frame_valid_reg <= 1'b0;
        end else begin
            tx_frame_valid_reg <= tx_load_pending;
            if (tx_load_pending)
                tx_load_pending <= 1'b0;
            else if (tx_fifo_rd_en)
                tx_load_pending <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            rx_threshold_above_reg <= 1'b0;
            tx_threshold_above_reg <= 1'b0;
            rx_threshold_event_reg <= 1'b0;
            tx_threshold_event_reg <= 1'b0;
        end else begin
            rx_threshold_event_reg <= 1'b0;
            tx_threshold_event_reg <= 1'b0;

            if (rx_clear_write) begin
                rx_threshold_above_reg <= 1'b0;
            end else if (fifo_threshold_write) begin
                rx_threshold_above_reg <=
                    (s_apb_pwdata[7:0] != 8'd0) &&
                    (rx_level >= s_apb_pwdata[7:0]);
            end else if (fifo_threshold_reg[7:0] == 8'd0) begin
                rx_threshold_above_reg <= 1'b0;
            end else if (!rx_threshold_above_reg &&
                         (rx_level >= fifo_threshold_reg[7:0])) begin
                rx_threshold_above_reg <= 1'b1;
                rx_threshold_event_reg <= 1'b1;
            end else if (rx_level < fifo_threshold_reg[7:0]) begin
                rx_threshold_above_reg <= 1'b0;
            end

            if (tx_clear_write) begin
                tx_threshold_above_reg <= 1'b0;
            end else if (fifo_threshold_write) begin
                tx_threshold_above_reg <=
                    tx_level > s_apb_pwdata[15:8];
            end else if (!tx_threshold_above_reg &&
                         (tx_level > fifo_threshold_reg[15:8])) begin
                tx_threshold_above_reg <= 1'b1;
            end else if (tx_threshold_above_reg &&
                         (tx_level <= fifo_threshold_reg[15:8])) begin
                tx_threshold_above_reg <= 1'b0;
                tx_threshold_event_reg <= 1'b1;
            end
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            can_rx_ff0 <= 1'b1;
            can_rx_ff1 <= 1'b1;
        end else begin
            can_rx_ff0 <= can_rx;
            can_rx_ff1 <= can_rx_ff0;
        end
    end

    sync_fifo #(
        .DATA_WIDTH (FRAME_WIDTH  ),
        .FIFO_DEPTH (TX_FIFO_DEPTH)
    ) tx_sync_fifo_inst (
        .clk        (clk          ),
        .rst_n      (tx_fifo_rst_n),
        .wr_en      (tx_fifo_wr_en),
        .din        (tx_fifo_din  ),
        .rd_en      (tx_fifo_rd_en),
        .dout       (tx_fifo_dout ),
        .empty      (tx_fifo_empty),
        .full       (tx_fifo_full ),
        .data_cnt   (tx_fifo_count)
    );

    sync_fifo #(
        .DATA_WIDTH (FRAME_WIDTH  ),
        .FIFO_DEPTH (RX_FIFO_DEPTH)
    ) rx_sync_fifo_inst (
        .clk        (clk          ),
        .rst_n      (rx_fifo_rst_n),
        .wr_en      (rx_fifo_wr_en),
        .din        (core_rx_frame),
        .rd_en      (rx_fifo_rd_en),
        .dout       (rx_fifo_dout ),
        .empty      (rx_fifo_empty),
        .full       (rx_fifo_full ),
        .data_cnt   (rx_fifo_count)
    );

    can_core can_core_inst (
        .clk                    (clk                         ),
        .rst_n                  (rst_n && !soft_reset_write  ),
        .enable_req             (enable_reg                  ),
        .listen_only            (listen_only_reg             ),
        .loopback               (loopback_reg                ),
        .auto_retry             (auto_retry_reg              ),
        .brp                    (bit_timing_reg[9:0]         ),
        .sjw                    (bit_timing_reg[13:12]       ),
        .tseg1                  (bit_timing_reg[19:16]       ),
        .tseg2                  (bit_timing_reg[22:20]       ),
        .filter_enable          (filter_enable_reg           ),
        .accept_code            (accept_code_reg             ),
        .accept_mask            (accept_mask_reg             ),
        .tx_frame_request       (core_tx_frame_request       ),
        .tx_frame_valid         (tx_frame_valid_reg          ),
        .tx_frame               (tx_fifo_dout                ),
        .tx_abort               (tx_abort_request            ),
        .rx_frame_valid         (core_rx_frame_valid         ),
        .rx_frame               (core_rx_frame               ),
        .tx_done_event          (core_tx_done_event          ),
        .tx_failed_event        (core_tx_failed_event        ),
        .tx_aborted_event       (core_tx_aborted_event       ),
        .arbitration_lost_event (core_arbitration_lost_event ),
        .protocol_error_event   (core_protocol_error_event   ),
        .warning_enter_event    (core_warning_enter_event    ),
        .passive_enter_event    (core_passive_enter_event    ),
        .bus_off_enter_event    (core_bus_off_enter_event    ),
        .bus_recovered_event    (core_bus_recovered_event    ),
        .last_error_type        (core_last_error_type        ),
        .last_error_field       (core_last_error_field       ),
        .arbitration_lost_pos   (core_arbitration_lost_pos   ),
        .running                (core_running                ),
        .bus_idle               (core_bus_idle               ),
        .tx_active              (core_tx_active              ),
        .rx_active              (core_rx_active              ),
        .retry_pending          (core_retry_pending          ),
        .tx_abort_pending       (core_tx_abort_pending       ),
        .error_warning          (core_error_warning          ),
        .error_passive          (core_error_passive          ),
        .bus_off                (core_bus_off                ),
        .tec                    (core_tec                    ),
        .rec                    (core_rec                    ),
        .can_rx                 (can_rx                      ),
        .can_tx                 (can_tx                      )
    );

endmodule
