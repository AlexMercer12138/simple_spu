`timescale 1ns/1ps

// Four-way APB address decoder and response multiplexer.

module apb4_interconnect #(
    parameter [15:0] S0_ADDR = 16'h1000,
    parameter [15:0] S1_ADDR = 16'h1001,
    parameter [15:0] S2_ADDR = 16'h1002,
    parameter [15:0] S3_ADDR = 16'h1003
)(
    input  wire        m_apb_psel,
    input  wire        m_apb_penable,
    input  wire        m_apb_pwrite,
    input  wire [31:0] m_apb_paddr,
    input  wire [31:0] m_apb_pwdata,
    output wire        m_apb_pready,
    output wire [31:0] m_apb_prdata,

    output wire        s0_apb_psel,
    input  wire        s0_apb_pready,
    input  wire [31:0] s0_apb_prdata,
    output wire        s1_apb_psel,
    input  wire        s1_apb_pready,
    input  wire [31:0] s1_apb_prdata,
    output wire        s2_apb_psel,
    input  wire        s2_apb_pready,
    input  wire [31:0] s2_apb_prdata,
    output wire        s3_apb_psel,
    input  wire        s3_apb_pready,
    input  wire [31:0] s3_apb_prdata,

    output wire        s_apb_penable,
    output wire        s_apb_pwrite,
    output wire [31:0] s_apb_paddr,
    output wire [31:0] s_apb_pwdata
);

    wire hit0;
    wire hit1;
    wire hit2;
    wire hit3;

    assign hit0 = m_apb_psel && (m_apb_paddr[31:16] == S0_ADDR);
    assign hit1 = m_apb_psel && (m_apb_paddr[31:16] == S1_ADDR);
    assign hit2 = m_apb_psel && (m_apb_paddr[31:16] == S2_ADDR);
    assign hit3 = m_apb_psel && (m_apb_paddr[31:16] == S3_ADDR);

    assign s0_apb_psel = hit0;
    assign s1_apb_psel = hit1;
    assign s2_apb_psel = hit2;
    assign s3_apb_psel = hit3;

    assign s_apb_penable = m_apb_penable;
    assign s_apb_pwrite = m_apb_pwrite;
    assign s_apb_paddr = m_apb_paddr;
    assign s_apb_pwdata = m_apb_pwdata;

    assign m_apb_prdata = hit0 ? s0_apb_prdata :
                          hit1 ? s1_apb_prdata :
                          hit2 ? s2_apb_prdata :
                          hit3 ? s3_apb_prdata : 32'd0;

    assign m_apb_pready = hit0 ? s0_apb_pready :
                          hit1 ? s1_apb_pready :
                          hit2 ? s2_apb_pready :
                          hit3 ? s3_apb_pready :
                          (m_apb_psel && m_apb_penable);

endmodule
