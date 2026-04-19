// Simple CPU Program Memory Initialization
module hello_world(
    input wire [7:0] prog_addr,
    output reg [31:0] prog_data
);
always @(*) begin
    case (prog_addr)
        0 : prog_data = 32'h00000110;
        1 : prog_data = 32'h44000210;
        2 : prog_data = 32'h00FF0410; // time = 255
        // 2 : prog_data = 32'h00010410; // time = 1, for sim
        3 : prog_data = 32'h00090710;
        4 : prog_data = 32'h00102216;
        5 : prog_data = 32'h00104416; // one_second = timex65536
        // 5 : prog_data = 32'h00044416; // one_second = timex16, for sim
        6 : prog_data = 32'h00000810;
        7 : prog_data = 32'h0019181C;
        8 : prog_data = 32'h00010810;
        9 : prog_data = 32'h001B181C;
        10 : prog_data = 32'h00020810;
        11 : prog_data = 32'h001D181C;
        12 : prog_data = 32'h00030810;
        13 : prog_data = 32'h001F181C;
        14 : prog_data = 32'h00040810;
        15 : prog_data = 32'h0021181C;
        16 : prog_data = 32'h00050810;
        17 : prog_data = 32'h0023181C;
        18 : prog_data = 32'h00060810;
        19 : prog_data = 32'h0025181C;
        20 : prog_data = 32'h00070810;
        21 : prog_data = 32'h0027181C;
        22 : prog_data = 32'h00080810;
        23 : prog_data = 32'h0029181C;
        24 : prog_data = 32'h002B0C1B;
        25 : prog_data = 32'h00680510;
        26 : prog_data = 32'h002C0C1B;
        27 : prog_data = 32'h00650510;
        28 : prog_data = 32'h002C0C1B;
        29 : prog_data = 32'h006C0510;
        30 : prog_data = 32'h002C0C1B;
        31 : prog_data = 32'h006C0510;
        32 : prog_data = 32'h002C0C1B;
        33 : prog_data = 32'h006F0510;
        34 : prog_data = 32'h002C0C1B;
        35 : prog_data = 32'h00770510;
        36 : prog_data = 32'h002C0C1B;
        37 : prog_data = 32'h006F0510;
        38 : prog_data = 32'h002C0C1B;
        39 : prog_data = 32'h00720510;
        40 : prog_data = 32'h002C0C1B;
        41 : prog_data = 32'h006C0510;
        42 : prog_data = 32'h002C0C1B;
        43 : prog_data = 32'h00640510;
        44 : prog_data = 32'h00086616;
        45 : prog_data = 32'h00056624;
        46 : prog_data = 32'h00000310;
        47 : prog_data = 32'h0031171C;
        48 : prog_data = 32'h00330C1B;
        49 : prog_data = 32'h00000110;
        50 : prog_data = 32'h00350C1B;
        51 : prog_data = 32'h00011111;
        52 : prog_data = 32'h00350C1B;
        53 : prog_data = 32'h00002629;
        54 : prog_data = 32'h00013311;
        55 : prog_data = 32'h0036341E;
        56 : prog_data = 32'h00060C1B;
        default: prog_data = 0;
    endcase
end
endmodule