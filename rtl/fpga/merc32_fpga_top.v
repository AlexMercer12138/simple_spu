`timescale 1ns/1ps

module merc32_fpga_top #(
    parameter PROGRAM_INIT_FILE = "peripheral_test.mem"
)(
    input  wire       sys_clk,
    input  wire       sys_rst_n,
    input  wire       uart_rx,
    output wire       uart_tx,
    inout  wire       i2c_scl,
    inout  wire       i2c_sda,
    input  wire [3:0] key_n,
    output wire [3:0] led_n,
    output wire       beep
);

    wire       i2c_scl_t;
    wire       i2c_scl_i;
    wire       i2c_sda_t;
    wire       i2c_sda_i;
    wire [3:0] key;
    wire [3:0] led;
    wire       buzzer;

    assign i2c_scl = i2c_scl_t ? 1'bz : 1'b0;
    assign i2c_sda = i2c_sda_t ? 1'bz : 1'b0;
    assign i2c_scl_i = i2c_scl;
    assign i2c_sda_i = i2c_sda;
    assign key = ~key_n;
    assign led_n = ~led;
    assign beep = buzzer;

    merc32_soc #(
        .PROGRAM_INIT_FILE (PROGRAM_INIT_FILE)
    ) merc32_soc_inst (
        .clk       (sys_clk),
        .rst_n     (sys_rst_n),
        .uart_rx   (uart_rx),
        .uart_tx   (uart_tx),
        .i2c_scl_t (i2c_scl_t),
        .i2c_scl_i (i2c_scl_i),
        .i2c_sda_t (i2c_sda_t),
        .i2c_sda_i (i2c_sda_i),
        .key       (key),
        .led       (led),
        .buzzer    (buzzer)
    );

endmodule
