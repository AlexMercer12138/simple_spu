//================================================================================
//  Author      : Mercer
//  Module      : can_bit_timing
//  Description : Classic CAN nominal bit timing and resynchronization
//================================================================================

module can_bit_timing (
    input   wire        clk,
    input   wire        rst_n,
    input   wire        enable,
    input   wire        hard_sync_enable,
    input   wire        resync_enable,
    input   wire [9:0]  brp,
    input   wire [1:0]  sjw,
    input   wire [3:0]  tseg1,
    input   wire [2:0]  tseg2,
    input   wire        can_rx,
    output  wire        rx_bit,
    output  reg         bit_start,
    output  reg         sample_point,
    output  reg         bit_end
);

    reg         rx_meta;
    reg         rx_sync;
    reg         rx_previous;
    reg         enable_previous;
    reg  [9:0]  brp_count;
    reg  [5:0]  tq_count;
    reg  [5:0]  sample_limit;
    reg  [5:0]  bit_limit;
    reg         resync_used;

    wire        dominant_edge;
    wire [5:0]  tseg1_actual;
    wire [5:0]  tseg2_actual;
    wire [2:0]  sjw_actual;
    wire [5:0]  nominal_sample_limit;
    wire [5:0]  nominal_bit_limit;
    wire        tq_complete;
    wire [5:0]  positive_phase_error;
    wire [5:0]  negative_phase_error;
    wire [5:0]  positive_adjustment;
    wire [5:0]  negative_adjustment;

    assign rx_bit = rx_sync;
    assign dominant_edge = rx_previous && !rx_sync;
    assign tseg1_actual = {2'd0, tseg1} + 6'd1;
    assign tseg2_actual = {3'd0, tseg2} + 6'd1;
    assign sjw_actual = {1'b0, sjw} + 3'd1;
    assign nominal_sample_limit = 6'd1 + tseg1_actual - 6'd1;
    assign nominal_bit_limit = 6'd1 + tseg1_actual +
                               tseg2_actual - 6'd1;
    assign tq_complete = brp_count == brp;
    assign positive_phase_error = tq_count;
    assign negative_phase_error = bit_limit - tq_count;
    assign positive_adjustment =
        (positive_phase_error > {3'd0, sjw_actual}) ?
        {3'd0, sjw_actual} : positive_phase_error;
    assign negative_adjustment =
        (negative_phase_error > {3'd0, sjw_actual}) ?
        {3'd0, sjw_actual} : negative_phase_error;

    always @(posedge clk) begin
        if (!rst_n) begin
            rx_meta <= 1'b1;
            rx_sync <= 1'b1;
            rx_previous <= 1'b1;
        end else begin
            rx_meta <= can_rx;
            rx_sync <= rx_meta;
            rx_previous <= rx_sync;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            enable_previous <= 1'b0;
        end else begin
            enable_previous <= enable;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            brp_count <= 10'd0;
            tq_count <= 6'd0;
            sample_limit <= 6'd0;
            bit_limit <= 6'd0;
            resync_used <= 1'b0;
            bit_start <= 1'b0;
            sample_point <= 1'b0;
            bit_end <= 1'b0;
        end else if (!enable) begin
            brp_count <= 10'd0;
            tq_count <= 6'd0;
            sample_limit <= nominal_sample_limit;
            bit_limit <= nominal_bit_limit;
            resync_used <= 1'b0;
            bit_start <= 1'b0;
            sample_point <= 1'b0;
            bit_end <= 1'b0;
        end else begin
            bit_start <= 1'b0;
            sample_point <= 1'b0;
            bit_end <= 1'b0;

            if (!enable_previous) begin
                brp_count <= 10'd0;
                tq_count <= 6'd0;
                sample_limit <= nominal_sample_limit;
                bit_limit <= nominal_bit_limit;
                resync_used <= 1'b0;
                bit_start <= 1'b1;
            end else if (hard_sync_enable && dominant_edge) begin
                brp_count <= 10'd0;
                tq_count <= 6'd0;
                sample_limit <= nominal_sample_limit;
                bit_limit <= nominal_bit_limit;
                resync_used <= 1'b0;
                bit_start <= 1'b1;
            end else begin
                if (resync_enable && dominant_edge && !resync_used &&
                    (tq_count != 6'd0)) begin
                    resync_used <= 1'b1;
                    if (tq_count <= sample_limit) begin
                        sample_limit <= sample_limit + positive_adjustment;
                        bit_limit <= bit_limit + positive_adjustment;
                    end else begin
                        bit_limit <= bit_limit - negative_adjustment;
                    end
                end

                if (tq_complete) begin
                    brp_count <= 10'd0;
                    if (tq_count == sample_limit)
                        sample_point <= 1'b1;

                    if (tq_count == bit_limit) begin
                        tq_count <= 6'd0;
                        sample_limit <= nominal_sample_limit;
                        bit_limit <= nominal_bit_limit;
                        resync_used <= 1'b0;
                        bit_end <= 1'b1;
                        bit_start <= 1'b1;
                    end else begin
                        tq_count <= tq_count + 6'd1;
                    end
                end else begin
                    brp_count <= brp_count + 10'd1;
                end
            end
        end
    end

endmodule
