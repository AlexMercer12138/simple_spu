//================================================================================
//  Author      : Mercer
//  Module      : can_crc
//  Description : Serial Classic CAN CRC-15 accumulator
//================================================================================

module can_crc (
    input   wire        clk,
    input   wire        rst_n,
    input   wire        clear,
    input   wire        enable,
    input   wire        data_bit,
    output  reg  [14:0] crc_value,
    output  wire [14:0] crc_next_value
);

    function [14:0] crc15_next;
        input [14:0] crc_in;
        input        bit_in;
        reg          feedback;
        begin
            feedback = bit_in ^ crc_in[14];
            crc15_next = {crc_in[13:0], 1'b0};
            if (feedback)
                crc15_next = crc15_next ^ 15'h4599;
        end
    endfunction

    assign crc_next_value = crc15_next(crc_value, data_bit);

    always @(posedge clk) begin
        if (!rst_n) begin
            crc_value <= 15'd0;
        end else if (clear) begin
            crc_value <= 15'd0;
        end else if (enable) begin
            crc_value <= crc_next_value;
        end
    end

endmodule
