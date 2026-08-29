`timescale 1ns / 1ps
module apb_intc #(
    parameter integer IRQ_COUNT = 1,
    parameter [63:0] IRQ_MODE = 64'd0
)(
    input  wire                 s_apb_pclk,
    input  wire                 s_apb_presetn,
    input  wire                 s_apb_psel,
    input  wire                 s_apb_penable,
    input  wire                 s_apb_pwrite,
    input  wire [31:0]          s_apb_paddr,
    input  wire [31:0]          s_apb_pwdata,
    input  wire [3:0]           s_apb_pstrb,
    output wire                 s_apb_pready,
    output wire                 s_apb_pslverr,
    output reg  [31:0]          s_apb_prdata,
    input  wire [IRQ_COUNT-1:0] irq_sources,
    output wire                 interrupt
);
localparam[31:0]_1_=32'hffff_ffff>>(32-IRQ_COUNT);localparam[63:0]_2_=64'hffff_ffff_ffff_ffff>>(64-(IRQ_COUNT*2));wire[31:0]_3_;wire[31:0]_4_;wire[31:0]_5_;wire[63:0]_6_;wire _7_;reg[31:0]_8_;reg[31:0]_9_;reg[31:0]_10_;reg[31:0]_11_;reg _12_;reg[4:0]_13_;integer _14_;integer _15_;assign _3_=irq_sources;assign _4_={{8{s_apb_pstrb[3]}},{8{s_apb_pstrb[2]}},{8{s_apb_pstrb[1]}},{8{s_apb_pstrb[0]}}};assign _5_=s_apb_pwdata&_4_&_1_;assign _6_=IRQ_MODE&_2_;assign _7_=s_apb_psel&&s_apb_penable&&s_apb_pwrite;assign s_apb_pready=1'b1;assign s_apb_pslverr=1'b0;assign interrupt=|(_10_&_11_);always@(*)begin _9_=32'd0;for(_14_=0;_14_<32;_14_=_14_+1)begin if(_14_<IRQ_COUNT)begin case(IRQ_MODE[_14_*2+: 2])2'b00: _9_[_14_]=_3_[_14_];2'b01: _9_[_14_]=~_3_[_14_];2'b10: _9_[_14_]=_3_[_14_]&~_8_[_14_];2'b11: _9_[_14_]=~_3_[_14_]&_8_[_14_];endcase end end end always@(*)begin _12_=1'b0;_13_=5'd0;for(_15_=0;_15_<32;_15_=_15_+1)begin if(!_12_&&_10_[_15_]&&_11_[_15_])begin _12_=1'b1;_13_=_15_[4:0];end end end always@(*)begin case(s_apb_paddr[7:0])8'h00: s_apb_prdata=_9_&_1_;8'h04: s_apb_prdata=_10_&_1_;8'h08: s_apb_prdata=_11_&_1_;8'h1c: s_apb_prdata={_12_,26'd0,_13_};8'h20: s_apb_prdata=_6_[31:0];8'h24: s_apb_prdata=_6_[63:32];default: s_apb_prdata=32'd0;endcase end always@(posedge s_apb_pclk)begin if(!s_apb_presetn)begin _8_<=32'd0;end else begin _8_<=_3_&_1_;end end always@(posedge s_apb_pclk)begin if(!s_apb_presetn)begin _11_<=32'd0;end else if(_7_)begin case(s_apb_paddr[7:0])8'h08: _11_<=((_11_&~_4_)|(s_apb_pwdata&_4_))&_1_;8'h0c: _11_<=(_11_|_5_)&_1_;8'h10: _11_<=(_11_&~_5_)&_1_;default: _11_<=_11_&_1_;endcase end end always@(posedge s_apb_pclk)begin if(!s_apb_presetn)begin _10_<=32'd0;end else if(_7_&&s_apb_paddr[7:0]==8'h14)begin _10_<=(_10_|_5_|_9_)&_1_;end else if(_7_&&s_apb_paddr[7:0]==8'h18)begin _10_<=((_10_&~_5_)|_9_)&_1_;end else begin _10_<=(_10_|_9_)&_1_;end end
endmodule
