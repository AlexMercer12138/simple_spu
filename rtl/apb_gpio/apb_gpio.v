`timescale 1ns/1ps
module apb_gpio (
    input  wire        s_apb_pclk,
    input  wire        s_apb_presetn,
    input  wire        s_apb_psel,
    input  wire        s_apb_penable,
    input  wire        s_apb_pwrite,
    input  wire [31:0] s_apb_paddr,
    input  wire [31:0] s_apb_pwdata,
    input  wire [3:0]  s_apb_pstrb,
    output wire        s_apb_pready,
    output wire        s_apb_pslverr,
    output wire [31:0] s_apb_prdata,
    input  wire [31:0] gpio_i,
    output wire [31:0] gpio_o,
    output wire [31:0] gpio_t,
    output wire        interrupt
);
wire _1_;wire _2_;wire[9:0]_3_;wire _4_;wire _5_;wire _6_;wire _7_;wire _8_;wire[31:0]_9_;wire _10_;wire _11_;wire[31:0]_12_;wire[31:0]_13_;wire[31:0]_14_;wire _15_;reg _16_;reg[31:0]_17_;reg[31:0]_18_;reg[31:0]_19_;reg[31:0]_20_;reg[31:0]_21_;reg[1:0]_22_;reg[31:0]_23_;reg _24_;reg[2:0]_25_;reg[31:0]_26_;reg[31:0]_27_;assign _1_=s_apb_pclk;assign _2_=s_apb_presetn;assign _3_=s_apb_paddr[11:2];assign _4_=s_apb_psel&&!s_apb_penable;assign _13_={{8{s_apb_pstrb[3]}},{8{s_apb_pstrb[2]}},{8{s_apb_pstrb[1]}},{8{s_apb_pstrb[0]}}};assign _14_=s_apb_pwdata&_13_;assign _15_=|s_apb_pstrb;assign _5_=s_apb_psel&&s_apb_penable&&s_apb_pwrite&&_16_&&_15_;assign _6_=_5_&&(_3_==10'd0)&&s_apb_pstrb[3];assign _7_=_6_&&_14_[31];assign s_apb_pready=_16_;assign s_apb_pslverr=1'b0;assign s_apb_prdata=_17_;assign gpio_o=_19_;assign gpio_t=~_18_;assign _8_=_22_[1];assign _9_=_8_ ? _21_ : 32'd0;assign _10_=_5_&&(_3_==10'd7)&&s_apb_pstrb[0];assign _11_=_5_&&(_3_==10'd9);assign _12_=(_8_&&!_10_) ? (~_18_&_28_(_25_,_21_,_23_,_24_)) : 32'd0;assign interrupt=|(_27_&_26_);function[31:0]_28_;input[2:0]_29_;input[31:0]_30_;input[31:0]_31_;input _32_;begin case(_29_)3'd0: _28_=~_30_;3'd1: _28_=_30_;3'd2: _28_=_32_ ? _30_&~_31_ : 32'd0;3'd3: _28_=_32_ ? ~_30_&_31_ : 32'd0;3'd4: _28_=_32_ ? _30_^_31_ : 32'd0;default: _28_=32'd0;endcase end endfunction always@(posedge _1_)begin if(!_2_)_16_<=1'b0;else if(s_apb_psel&&_16_)_16_<=1'b0;else if(s_apb_psel)_16_<=1'b1;else _16_<=1'b0;end always@(posedge _1_)begin if(!_2_||_7_)begin _17_<=32'd0;end else if(_4_)begin case(_3_)10'd0: _17_<=32'd0;10'd1: _17_<=_18_;10'd2: _17_<=_19_;10'd3: _17_<=32'd0;10'd4: _17_<=32'd0;10'd5: _17_<=32'd0;10'd6: _17_<=_9_;10'd7: _17_<={29'd0,_25_};10'd8: _17_<=_26_;10'd9: _17_<=_27_;default: _17_<=32'd0;endcase end end always@(posedge _1_)begin _20_<=gpio_i;_21_<=_20_;end always@(posedge _1_)begin if(!_2_||_7_)_22_<=2'b00;else _22_<={_22_[0],1'b1};end always@(posedge _1_)begin if(!_2_||_7_)begin _18_<=32'd0;_19_<=32'd0;end else if(_5_)begin case(_3_)10'd1: _18_<=(_18_&~_13_)|_14_;10'd2: _19_<=(_19_&~_13_)|_14_;10'd3: _19_<=_19_|_14_;10'd4: _19_<=_19_&~_14_;10'd5: _19_<=_19_^_14_;default: begin end endcase end end always@(posedge _1_)begin if(!_2_||_7_)begin _25_<=3'd7;_26_<=32'd0;end else if(_5_)begin case(_3_)10'd7: _25_<=(_25_&~_13_[2:0])|_14_[2:0];10'd8: _26_<=(_26_&~_13_)|_14_;default: begin end endcase end end always@(posedge _1_)begin if(!_2_||_7_)begin _23_<=32'd0;_24_<=1'b0;end else if(_8_)begin _23_<=_21_;_24_<=1'b1;end end always@(posedge _1_)begin if(!_2_||_7_)begin _27_<=32'd0;end else if(_10_)begin _27_<=32'd0;end else begin _27_<=(_27_&~(_11_ ? _14_ : 32'd0))|_12_;end end
endmodule
