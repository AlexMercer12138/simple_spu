`timescale 1ns/1ps

module divider (
    input  wire        clk,
    input  wire        rst_n,
    input  wire        start,
    input  wire [31:0] dividend,
    input  wire [31:0] divisor,
    output reg         busy,
    output reg         done,
    output reg  [31:0] quotient,
    output reg  [31:0] remainder,
    output reg         divide_by_zero
);

    reg [64:0] partial_reg;
    reg [31:0] divisor_reg;
    reg [4:0]  iteration_reg;

    wire [64:0] step_once;
    wire [64:0] step_twice;

    function [64:0] restoring_step;
        input [64:0] partial_value;
        input [31:0] divisor_value;
        reg   [64:0] shifted_value;
        begin
            shifted_value = partial_value << 1;
            if (shifted_value[64:32] >= {1'b0, divisor_value}) begin
                shifted_value[64:32] = shifted_value[64:32]
                                             - {1'b0, divisor_value};
                shifted_value[0] = 1'b1;
            end else begin
                shifted_value[0] = 1'b0;
            end
            restoring_step = shifted_value;
        end
    endfunction

    assign step_once  = restoring_step(partial_reg, divisor_reg);
    assign step_twice = restoring_step(step_once, divisor_reg);

    always @(posedge clk) begin
        if (!rst_n) begin
            busy           <= 1'b0;
            done           <= 1'b0;
            divide_by_zero <= 1'b0;
            iteration_reg  <= 5'd0;
        end else begin
            done           <= 1'b0;
            divide_by_zero <= 1'b0;

            if (!busy) begin
                if (start) begin
                    if (divisor == 0) begin
                        quotient       <= 32'hffff_ffff;
                        remainder      <= dividend;
                        divide_by_zero <= 1'b1;
                        done           <= 1'b1;
                    end else begin
                        partial_reg  <= {33'd0, dividend};
                        divisor_reg  <= divisor;
                        iteration_reg <= 5'd0;
                        busy          <= 1'b1;
                    end
                end
            end else begin
                partial_reg <= step_twice;
                if (iteration_reg == 5'd15) begin
                    quotient      <= step_twice[31:0];
                    remainder     <= step_twice[63:32];
                    busy          <= 1'b0;
                    done          <= 1'b1;
                end else begin
                    iteration_reg <= iteration_reg + 1'b1;
                end
            end
        end
    end

endmodule
