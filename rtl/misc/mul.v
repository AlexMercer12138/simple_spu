`timescale 1ns/1ps

module mul (
    input  wire        clk,
    input  wire        rst_n,

    input  wire        start,
    input  wire        signed_mode,
    input  wire [31:0] operand_a,
    input  wire [31:0] operand_b,

    output reg         done,
    output reg  [63:0] result
);

    reg         running;
    reg  [4:0]  iteration;
    reg  [63:0] accumulator;
    reg  [63:0] shifted_multiplicand;
    reg  [31:0] shifted_multiplier;
    reg         result_negative;

    wire [31:0] operand_a_magnitude;
    wire [31:0] operand_b_magnitude;
    wire [63:0] accumulator_next;

    assign operand_a_magnitude = signed_mode && operand_a[31]
                               ? (~operand_a + 32'd1) : operand_a;
    assign operand_b_magnitude = signed_mode && operand_b[31]
                               ? (~operand_b + 32'd1) : operand_b;
    assign accumulator_next = shifted_multiplier[0]
                            ? accumulator + shifted_multiplicand
                            : accumulator;

    // Accept an operation while idle, then process one multiplier bit per
    // clock. Only control state and visible outputs use the reset network.
    always @(posedge clk) begin
        if (!rst_n) begin
            running   <= 1'b0;
            iteration <= 5'd0;
            done      <= 1'b0;
            result    <= 64'd0;
        end else if (!running) begin
            done <= 1'b0;

            if (start) begin
                running              <= 1'b1;
                iteration            <= 5'd0;
                accumulator          <= 64'd0;
                shifted_multiplicand <= {32'd0, operand_a_magnitude};
                shifted_multiplier   <= operand_b_magnitude;
                result_negative      <= signed_mode
                                      && (operand_a[31] ^ operand_b[31]);
            end
        end else begin
            running               <= iteration == 5'd31 ? 1'b0 : 1'b1;
            iteration             <= iteration == 5'd31
                                   ? iteration : iteration + 5'd1;
            accumulator           <= accumulator_next;
            shifted_multiplicand  <= shifted_multiplicand << 1;
            shifted_multiplier    <= shifted_multiplier >> 1;
            done                  <= iteration == 5'd31;

            if (iteration == 5'd31) begin
                result <= result_negative
                        ? (~accumulator_next + 64'd1)
                        : accumulator_next;
            end
        end
    end

endmodule
