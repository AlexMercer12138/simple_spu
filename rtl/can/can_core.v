//================================================================================
//  Author      : Mercer
//  Module      : can_core
//  Description : Unified Classic CAN protocol engine
//================================================================================

module can_core (
    input   wire        clk,
    input   wire        rst_n,
    input   wire        enable_req,
    input   wire        listen_only,
    input   wire        loopback,
    input   wire        auto_retry,
    input   wire [9:0]  brp,
    input   wire [1:0]  sjw,
    input   wire [3:0]  tseg1,
    input   wire [2:0]  tseg2,
    input   wire        filter_enable,
    input   wire [30:0] accept_code,
    input   wire [30:0] accept_mask,
    output  reg         tx_frame_request,
    input   wire        tx_frame_valid,
    input   wire [98:0] tx_frame,
    input   wire        tx_abort,
    output  reg         rx_frame_valid,
    output  reg  [98:0] rx_frame,
    output  reg         tx_done_event,
    output  reg         tx_failed_event,
    output  reg         tx_aborted_event,
    output  reg         arbitration_lost_event,
    output  reg         protocol_error_event,
    output  reg         warning_enter_event,
    output  reg         passive_enter_event,
    output  reg         bus_off_enter_event,
    output  reg         bus_recovered_event,
    output  reg  [2:0]  last_error_type,
    output  reg  [3:0]  last_error_field,
    output  reg  [5:0]  arbitration_lost_pos,
    output  wire        running,
    output  wire        bus_idle,
    output  wire        tx_active,
    output  wire        rx_active,
    output  wire        retry_pending,
    output  wire        tx_abort_pending,
    output  wire        error_warning,
    output  wire        error_passive,
    output  wire        bus_off,
    output  wire [8:0]  tec,
    output  wire [7:0]  rec,
    input   wire        can_rx,
    output  wire        can_tx
);

    localparam ST_STOP         = 4'd0;
    localparam ST_IDLE         = 4'd1;
    localparam ST_FRAME        = 4'd2;
    localparam ST_CRC_DELIM    = 4'd3;
    localparam ST_ACK_SLOT     = 4'd4;
    localparam ST_ACK_DELIM    = 4'd5;
    localparam ST_EOF          = 4'd6;
    localparam ST_INTERMISSION = 4'd7;

    function frame_raw_bit;
        input [98:0] frame_value;
        input [7:0]  raw_index_value;
        input [7:0]  crc_start_value;
        input [14:0] crc_value;
        integer data_offset;
        integer data_bit_index;
        begin
            frame_raw_bit = 1'b1;
            if (!frame_value[69]) begin
                if (raw_index_value == 8'd0)
                    frame_raw_bit = 1'b0;
                else if (raw_index_value <= 8'd11)
                    frame_raw_bit =
                        frame_value[70 + (11 - raw_index_value)];
                else if (raw_index_value == 8'd12)
                    frame_raw_bit = frame_value[68];
                else if (raw_index_value == 8'd13)
                    frame_raw_bit = 1'b0;
                else if (raw_index_value == 8'd14)
                    frame_raw_bit = 1'b0;
                else if (raw_index_value <= 8'd18)
                    frame_raw_bit =
                        frame_value[64 + (18 - raw_index_value)];
                else if (raw_index_value < crc_start_value) begin
                    data_offset = raw_index_value - 19;
                    data_bit_index = ((data_offset / 8) * 8) +
                                     (7 - (data_offset % 8));
                    frame_raw_bit = frame_value[data_bit_index];
                end else begin
                    frame_raw_bit =
                        crc_value[14 - (raw_index_value - crc_start_value)];
                end
            end else begin
                if (raw_index_value == 8'd0)
                    frame_raw_bit = 1'b0;
                else if (raw_index_value <= 8'd11)
                    frame_raw_bit =
                        frame_value[99 - raw_index_value];
                else if (raw_index_value == 8'd12)
                    frame_raw_bit = 1'b1;
                else if (raw_index_value == 8'd13)
                    frame_raw_bit = 1'b1;
                else if (raw_index_value <= 8'd31)
                    frame_raw_bit =
                        frame_value[101 - raw_index_value];
                else if (raw_index_value == 8'd32)
                    frame_raw_bit = frame_value[68];
                else if ((raw_index_value == 8'd33) ||
                         (raw_index_value == 8'd34))
                    frame_raw_bit = 1'b0;
                else if (raw_index_value <= 8'd38)
                    frame_raw_bit =
                        frame_value[64 + (38 - raw_index_value)];
                else if (raw_index_value < crc_start_value) begin
                    data_offset = raw_index_value - 39;
                    data_bit_index = ((data_offset / 8) * 8) +
                                     (7 - (data_offset % 8));
                    frame_raw_bit = frame_value[data_bit_index];
                end else begin
                    frame_raw_bit =
                        crc_value[14 - (raw_index_value - crc_start_value)];
                end
            end
        end
    endfunction

    reg  [3:0]  state;
    reg  [98:0] active_frame;
    reg         active_frame_valid;
    reg         request_cooldown;
    reg         tx_drive_reg;
    reg  [7:0]  raw_index;
    reg  [7:0]  crc_start_index;
    reg  [7:0]  raw_last_index;
    reg         raw_complete;
    reg         stuff_pending;
    reg         stuff_last_bit;
    reg  [2:0]  stuff_run_count;
    reg  [3:0]  tail_count;
    reg         ack_seen;
    reg         tx_crc_clear;
    reg         tx_crc_enable;
    reg         tx_crc_data_bit;

    wire        timing_rx_input;
    wire        timing_rx_bit;
    wire        timing_bit_start;
    wire        timing_sample_point;
    wire        timing_bit_end;
    wire [14:0] tx_crc_value;
    wire [14:0] tx_crc_next_value;
    wire        next_raw_bit;
    wire        raw_bit_repeats;
    wire        raw_bit_needs_stuff;
    wire [30:0] active_filter_key;
    wire        active_filter_match;
    wire [98:0] loopback_frame;
    wire [7:0]  payload_bit_count;
    wire [7:0]  frame_crc_start;

    assign running = enable_req;
    assign bus_idle = enable_req && (state == ST_IDLE);
    assign tx_active = active_frame_valid;
    assign rx_active = 1'b0;
    assign retry_pending = 1'b0;
    assign tx_abort_pending = 1'b0;
    assign error_warning = 1'b0;
    assign error_passive = 1'b0;
    assign bus_off = 1'b0;
    assign tec = 9'd0;
    assign rec = 8'd0;
    assign can_tx = (!running || listen_only || loopback) ? 1'b1 :
                    tx_drive_reg;
    assign timing_rx_input = loopback ?
                             ((state == ST_ACK_SLOT) ? 1'b0 : tx_drive_reg) :
                             can_rx;
    assign next_raw_bit = frame_raw_bit(active_frame, raw_index,
                                        crc_start_index, tx_crc_value);
    assign raw_bit_repeats = next_raw_bit == stuff_last_bit;
    assign raw_bit_needs_stuff = raw_bit_repeats &&
                                 (stuff_run_count == 3'd4);
    assign active_filter_key = {active_frame[98:70], active_frame[69],
                                active_frame[68]};
    assign active_filter_match = !filter_enable ||
        (((active_filter_key ^ accept_code) & accept_mask) == 31'd0);
    assign loopback_frame = active_frame[68] ?
                            {active_frame[98:64], 64'd0} : active_frame;
    assign payload_bit_count = active_frame[68] ? 8'd0 :
                               {active_frame[67:64], 3'b000};
    assign frame_crc_start = (active_frame[69] ? 8'd39 : 8'd19) +
                             payload_bit_count;

    can_bit_timing can_bit_timing_inst (
        .clk              (clk                              ),
        .rst_n            (rst_n                            ),
        .enable           (enable_req                       ),
        .hard_sync_enable (!loopback && (state == ST_IDLE)  ),
        .resync_enable    (state != ST_IDLE                 ),
        .brp              (brp                              ),
        .sjw              (sjw                              ),
        .tseg1            (tseg1                            ),
        .tseg2            (tseg2                            ),
        .can_rx           (timing_rx_input                  ),
        .rx_bit           (timing_rx_bit                    ),
        .bit_start        (timing_bit_start                 ),
        .sample_point     (timing_sample_point              ),
        .bit_end          (timing_bit_end                   )
    );

    can_crc tx_can_crc_inst (
        .clk            (clk              ),
        .rst_n          (rst_n            ),
        .clear          (tx_crc_clear     ),
        .enable         (tx_crc_enable    ),
        .data_bit       (tx_crc_data_bit  ),
        .crc_value      (tx_crc_value     ),
        .crc_next_value (tx_crc_next_value)
    );

    always @(posedge clk) begin
        if (!rst_n) begin
            state <= ST_STOP;
            active_frame <= 99'd0;
            active_frame_valid <= 1'b0;
            request_cooldown <= 1'b0;
            tx_drive_reg <= 1'b1;
            raw_index <= 8'd0;
            crc_start_index <= 8'd0;
            raw_last_index <= 8'd0;
            raw_complete <= 1'b0;
            stuff_pending <= 1'b0;
            stuff_last_bit <= 1'b1;
            stuff_run_count <= 3'd0;
            tail_count <= 4'd0;
            ack_seen <= 1'b0;
            tx_crc_clear <= 1'b0;
            tx_crc_enable <= 1'b0;
            tx_crc_data_bit <= 1'b0;
            tx_frame_request <= 1'b0;
            rx_frame_valid <= 1'b0;
            rx_frame <= 99'd0;
            tx_done_event <= 1'b0;
            tx_failed_event <= 1'b0;
            tx_aborted_event <= 1'b0;
            arbitration_lost_event <= 1'b0;
            protocol_error_event <= 1'b0;
            warning_enter_event <= 1'b0;
            passive_enter_event <= 1'b0;
            bus_off_enter_event <= 1'b0;
            bus_recovered_event <= 1'b0;
            last_error_type <= 3'd0;
            last_error_field <= 4'd0;
            arbitration_lost_pos <= 6'd0;
        end else begin
            tx_frame_request <= 1'b0;
            rx_frame_valid <= 1'b0;
            tx_done_event <= 1'b0;
            tx_failed_event <= 1'b0;
            tx_aborted_event <= 1'b0;
            arbitration_lost_event <= 1'b0;
            protocol_error_event <= 1'b0;
            warning_enter_event <= 1'b0;
            passive_enter_event <= 1'b0;
            bus_off_enter_event <= 1'b0;
            bus_recovered_event <= 1'b0;
            tx_crc_clear <= 1'b0;
            tx_crc_enable <= 1'b0;

            if (!enable_req) begin
                state <= ST_STOP;
                tx_drive_reg <= 1'b1;
                request_cooldown <= 1'b0;
            end else begin
                if (state == ST_STOP)
                    state <= ST_IDLE;

                if ((state == ST_IDLE) && !active_frame_valid) begin
                    if (!request_cooldown) begin
                        tx_frame_request <= 1'b1;
                        request_cooldown <= 1'b1;
                    end else begin
                        request_cooldown <= 1'b0;
                    end
                end else begin
                    request_cooldown <= 1'b0;
                end

                if (tx_frame_valid) begin
                    active_frame <= tx_frame;
                    active_frame_valid <= 1'b1;
                    crc_start_index <=
                        (tx_frame[69] ? 8'd39 : 8'd19) +
                        (tx_frame[68] ? 8'd0 :
                         {tx_frame[67:64], 3'b000});
                    raw_last_index <=
                        (tx_frame[69] ? 8'd39 : 8'd19) +
                        (tx_frame[68] ? 8'd0 :
                         {tx_frame[67:64], 3'b000}) + 8'd14;
                    tx_crc_clear <= 1'b1;
                end

                if (timing_sample_point && (state == ST_ACK_SLOT))
                    ack_seen <= !timing_rx_bit;

                if (timing_bit_start) begin
                    case (state)
                        ST_IDLE: begin
                            tx_drive_reg <= 1'b1;
                            if (active_frame_valid && !listen_only) begin
                                state <= ST_FRAME;
                                tx_drive_reg <= 1'b0;
                                raw_index <= 8'd1;
                                raw_complete <= 1'b0;
                                stuff_pending <= 1'b0;
                                stuff_last_bit <= 1'b0;
                                stuff_run_count <= 3'd1;
                                ack_seen <= 1'b0;
                                tx_crc_enable <= 1'b1;
                                tx_crc_data_bit <= 1'b0;
                            end
                        end

                        ST_FRAME: begin
                            if (raw_complete) begin
                                if (stuff_pending) begin
                                    tx_drive_reg <= !stuff_last_bit;
                                    stuff_last_bit <= !stuff_last_bit;
                                    stuff_run_count <= 3'd1;
                                    stuff_pending <= 1'b0;
                                end else begin
                                    state <= ST_CRC_DELIM;
                                    tx_drive_reg <= 1'b1;
                                end
                            end else if (stuff_pending) begin
                                tx_drive_reg <= !stuff_last_bit;
                                stuff_last_bit <= !stuff_last_bit;
                                stuff_run_count <= 3'd1;
                                stuff_pending <= 1'b0;
                            end else begin
                                tx_drive_reg <= next_raw_bit;
                                if (raw_index < crc_start_index) begin
                                    tx_crc_enable <= 1'b1;
                                    tx_crc_data_bit <= next_raw_bit;
                                end
                                if (raw_bit_repeats) begin
                                    stuff_run_count <=
                                        stuff_run_count + 3'd1;
                                    if (raw_bit_needs_stuff)
                                        stuff_pending <= 1'b1;
                                end else begin
                                    stuff_last_bit <= next_raw_bit;
                                    stuff_run_count <= 3'd1;
                                end
                                if (raw_index == raw_last_index)
                                    raw_complete <= 1'b1;
                                else
                                    raw_index <= raw_index + 8'd1;
                            end
                        end

                        ST_CRC_DELIM: begin
                            state <= ST_ACK_SLOT;
                            tx_drive_reg <= 1'b1;
                        end

                        ST_ACK_SLOT: begin
                            state <= ST_ACK_DELIM;
                            tx_drive_reg <= 1'b1;
                        end

                        ST_ACK_DELIM: begin
                            state <= ST_EOF;
                            tail_count <= 4'd1;
                            tx_drive_reg <= 1'b1;
                        end

                        ST_EOF: begin
                            tx_drive_reg <= 1'b1;
                            if (tail_count == 4'd7) begin
                                state <= ST_INTERMISSION;
                                tail_count <= 4'd1;
                            end else begin
                                tail_count <= tail_count + 4'd1;
                            end
                        end

                        ST_INTERMISSION: begin
                            tx_drive_reg <= 1'b1;
                            if (tail_count == 4'd3) begin
                                state <= ST_IDLE;
                                active_frame_valid <= 1'b0;
                                tx_done_event <= 1'b1;
                                if (loopback && active_filter_match) begin
                                    rx_frame <= loopback_frame;
                                    rx_frame_valid <= 1'b1;
                                end
                                tail_count <= 4'd0;
                            end else begin
                                tail_count <= tail_count + 4'd1;
                            end
                        end

                        default: begin
                            state <= ST_IDLE;
                            tx_drive_reg <= 1'b1;
                        end
                    endcase
                end
            end
        end
    end

endmodule
