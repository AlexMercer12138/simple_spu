`timescale 1ns/1ps

module timer_channel (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        enable,
    input  wire        clear,
    input  wire        count_tick,
    input  wire [31:0] count_max,
    input  wire [31:0] pwm_compare,
    input  wire [1:0]  pwm_mode,
    input  wire        pwm_polarity,
    output wire [31:0] count,
    output wire        overflow,
    output wire        pwm
);

    reg  [31:0] count_reg;
    reg         overflow_reg;
    wire        normal_active;
    wire        pwm_active;

    assign count = count_reg;
    assign overflow = overflow_reg;
    assign normal_active = count_reg < pwm_compare;
    assign pwm_active = enable &&
                        (((pwm_mode == 2'b01) && normal_active) ||
                         (pwm_mode == 2'b11));
    assign pwm = pwm_polarity ? ~pwm_active : pwm_active;

    always @(posedge clk) begin
        if (!rst_n) begin
            count_reg <= 32'd0;
            overflow_reg <= 1'b0;
        end else begin
            overflow_reg <= 1'b0;
            if (clear) begin
                count_reg <= 32'd0;
            end else if (enable && count_tick) begin
                if (count_reg >= count_max) begin
                    count_reg <= 32'd0;
                    overflow_reg <= 1'b1;
                end else begin
                    count_reg <= count_reg + 1'b1;
                end
            end
        end
    end

endmodule
