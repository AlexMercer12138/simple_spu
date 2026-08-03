`timescale 1ns/1ps
module apb_gpio (
    input  wire        s_apb_pclk,
    input  wire        s_apb_presetn,
    input  wire        s_apb_psel,
    input  wire        s_apb_penable,
    input  wire        s_apb_pwrite,
    input  wire [31:0] s_apb_paddr,
    input  wire [31:0] s_apb_pwdata,
    output wire        s_apb_pready,
    output wire        s_apb_pslverr,
    output wire [31:0] s_apb_prdata,
    input  wire [31:0] gpio_i,
    output wire [31:0] gpio_o,
    output wire [31:0] gpio_t,
    output wire        interrupt
);
wire _1_;wire _2_;wire[9:0]_3_;wire _4_;wire _5_;wire _6_;wire _7_;wire _8_;wire[31:0]_9_;wire _10_;wire _11_;wire[31:0]_12_;reg _13_;reg[31:0]_14_;reg[31:0]_15_;reg[31:0]_16_;reg[31:0]_17_;reg[31:0]_18_;reg[1:0]_19_;reg[31:0]_20_;reg _21_;reg[2:0]_22_;reg[31:0]_23_;reg[31:0]_24_;assign _1_=s_apb_pclk;assign _2_=s_apb_presetn;assign _3_=s_apb_paddr[11:2];assign _4_=s_apb_psel&&!s_apb_penable;assign _5_=s_apb_psel&&s_apb_penable&&s_apb_pwrite&&_13_;assign _6_=_5_&&(_3_==10'd0);assign _7_=_6_&&s_apb_pwdata[31];assign s_apb_pready=_13_;assign s_apb_pslverr=1'b0;assign s_apb_prdata=_14_;assign gpio_o=_16_;assign gpio_t=~_15_;assign _8_=_19_[1];assign _9_=_8_ ? _18_ : 32'd0;assign _10_=_5_&&(_3_==10'd7);assign _11_=_5_&&(_3_==10'd9);assign _12_=(_8_&&!_10_) ? (~_15_&_25_(_22_,_18_,_20_,_21_)) : 32'd0;assign interrupt=|(_24_&_23_);function[31:0]_25_;input[2:0]_26_;input[31:0]_27_;input[31:0]_28_;input _29_;begin case(_26_)3'd0: _25_=~_27_;3'd1: _25_=_27_;3'd2: _25_=_29_ ? _27_&~_28_ : 32'd0;3'd3: _25_=_29_ ? ~_27_&_28_ : 32'd0;3'd4: _25_=_29_ ? _27_^_28_ : 32'd0;default: _25_=32'd0;endcase end endfunction always@(posedge _1_)begin if(!_2_)_13_<=1'b0;else if(s_apb_psel&&_13_)_13_<=1'b0;else if(s_apb_psel)_13_<=1'b1;else _13_<=1'b0;end always@(posedge _1_)begin if(!_2_||_7_)begin _14_<=32'd0;end else if(_4_)begin case(_3_)10'd0: _14_<=32'd0;10'd1: _14_<=_15_;10'd2: _14_<=_16_;10'd3: _14_<=32'd0;10'd4: _14_<=32'd0;10'd5: _14_<=32'd0;10'd6: _14_<=_9_;10'd7: _14_<={29'd0,_22_};10'd8: _14_<=_23_;10'd9: _14_<=_24_;default: _14_<=32'd0;endcase end end always@(posedge _1_)begin _17_<=gpio_i;_18_<=_17_;end always@(posedge _1_)begin if(!_2_||_7_)_19_<=2'b00;else _19_<={_19_[0],1'b1};end always@(posedge _1_)begin if(!_2_||_7_)begin _15_<=32'd0;_16_<=32'd0;end else if(_5_)begin case(_3_)10'd1: _15_<=s_apb_pwdata;10'd2: _16_<=s_apb_pwdata;10'd3: _16_<=_16_|s_apb_pwdata;10'd4: _16_<=_16_&~s_apb_pwdata;10'd5: _16_<=_16_^s_apb_pwdata;default: begin end endcase end end always@(posedge _1_)begin if(!_2_||_7_)begin _22_<=3'd7;_23_<=32'd0;end else if(_5_)begin case(_3_)10'd7: _22_<=s_apb_pwdata[2:0];10'd8: _23_<=s_apb_pwdata;default: begin end endcase end end always@(posedge _1_)begin if(!_2_||_7_)begin _20_<=32'd0;_21_<=1'b0;end else if(_8_)begin _20_<=_18_;_21_<=1'b1;end end always@(posedge _1_)begin if(!_2_||_7_)begin _24_<=32'd0;end else if(_10_)begin _24_<=32'd0;end else begin _24_<=(_24_&~(_11_ ? s_apb_pwdata : 32'd0))|_12_;end end
endmodule
