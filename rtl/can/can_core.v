//================================================================================
//  Author      : Mercer
//  Module      : can_core
//  Description : Classic CAN protocol engine
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

    assign running = enable_req;
    assign bus_idle = enable_req;
    assign tx_active = 1'b0;
    assign rx_active = 1'b0;
    assign retry_pending = 1'b0;
    assign tx_abort_pending = 1'b0;
    assign error_warning = 1'b0;
    assign error_passive = 1'b0;
    assign bus_off = 1'b0;
    assign tec = 9'd0;
    assign rec = 8'd0;
    assign can_tx = 1'b1;

    always @(posedge clk) begin
        if (!rst_n) begin
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
        end
    end

endmodule
