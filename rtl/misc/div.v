`timescale 1ns/1ps

module div (
    input  wire        clk,
    input  wire        rst_n,

    input  wire        start,
    input  wire        signed_mode,
    input  wire [31:0] dividend,
    input  wire [31:0] divisor,

    output reg         done,
    output reg  [31:0] quotient,
    output reg  [31:0] remainder
);

    reg         running;
    reg  [4:0]  iteration;
    reg  [31:0] divisor_reg;
    reg  [31:0] dividend_reg;
    reg  [31:0] quotient_reg;
    reg  [32:0] partial_remainder_reg;
    reg         quotient_negative;
    reg         remainder_negative;

    wire [31:0] dividend_magnitude;
    wire [31:0] divisor_magnitude;
    wire [32:0] shifted_remainder;
    wire [33:0] remainder_difference;
    wire        subtract_divisor;
    wire [32:0] partial_remainder_next;
    wire [31:0] quotient_next;

    assign dividend_magnitude = signed_mode && dividend[31]
                              ? (~dividend + 32'd1) : dividend;
    assign divisor_magnitude = signed_mode && divisor[31]
                             ? (~divisor + 32'd1) : divisor;

    assign shifted_remainder = {partial_remainder_reg[31:0],
                                dividend_reg[31]};
    assign remainder_difference = {1'b0, shifted_remainder}
                                - {2'b0, divisor_reg};
    assign subtract_divisor = ~remainder_difference[33];
    assign partial_remainder_next = subtract_divisor
                                  ? remainder_difference[32:0]
                                  : shifted_remainder;
    assign quotient_next = {quotient_reg[30:0], subtract_divisor};

    // Accept an operation while idle, then resolve one quotient bit per
    // clock. Only control state and visible outputs use the reset network.
    always @(posedge clk) begin
        if (!rst_n) begin
            running   <= 1'b0;
            iteration <= 5'd0;
            done      <= 1'b0;
            quotient  <= 32'd0;
            remainder <= 32'd0;
        end else if (!running) begin
            if (start && divisor == 32'd0) begin
                done      <= 1'b1;
                quotient  <= 32'hffff_ffff;
                remainder <= dividend;
            end else begin
                done <= 1'b0;

                if (start) begin
                    running               <= 1'b1;
                    iteration             <= 5'd0;
                    divisor_reg           <= divisor_magnitude;
                    dividend_reg          <= dividend_magnitude;
                    quotient_reg          <= 32'd0;
                    partial_remainder_reg <= 33'd0;
                    quotient_negative     <= signed_mode
                                           && (dividend[31] ^ divisor[31]);
                    remainder_negative    <= signed_mode && dividend[31];
                end
            end
        end else begin
            running               <= iteration == 5'd31 ? 1'b0 : 1'b1;
            iteration             <= iteration == 5'd31
                                   ? iteration : iteration + 5'd1;
            dividend_reg          <= dividend_reg << 1;
            quotient_reg          <= quotient_next;
            partial_remainder_reg <= partial_remainder_next;
            done                  <= iteration == 5'd31;

            if (iteration == 5'd31) begin
                quotient <= quotient_negative
                          ? (~quotient_next + 32'd1)
                          : quotient_next;
                remainder <= remainder_negative
                           ? (~partial_remainder_next[31:0] + 32'd1)
                           : partial_remainder_next[31:0];
            end
        end
    end

endmodule
