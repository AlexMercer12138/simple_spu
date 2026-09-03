//================================================================================
//
//  ███╗   ███╗███████╗██████╗  ██████╗███████╗██████╗ 
//  ████╗ ████║██╔════╝██╔══██╗██╔════╝██╔════╝██╔══██╗
//  ██╔████╔██║█████╗  ██████╔╝██║     █████╗  ██████╔╝
//  ██║╚██╔╝██║██╔══╝  ██╔══██╗██║     ██╔══╝  ██╔══██╗
//  ██║ ╚═╝ ██║███████╗██║  ██║╚██████╗███████╗██║  ██║
//  ╚═╝     ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝
//
//--------------------------------------------------------------------------------
//  Author      : Mercer
//  Module      : merc32_core
//  Description : Lightweight 32-bit RISC CPU core
//--------------------------------------------------------------------------------
//  Copyright (c) 2026 Mercer. All rights reserved.
//  Licensed under the MIT License.
//--------------------------------------------------------------------------------
//  Version History:
//  v1.0 - Initial release
//================================================================================

//================================================================================
//  Instantiation Template
//================================================================================
/*
merc32_core #(
    .ILB_ADDR_WIDTH                     (16             ),
    .DLB_ADDR_WIDTH                     (16             ))
u_merc32_core (
    .clk                                (clk            ),
    .rst_n                              (rst_n          ),

    .interrupt                          (interrupt      ),

    .dbg_halt_req                       (dbg_halt_req   ),
    .dbg_step_req                       (dbg_step_req   ),
    .dbg_rst_req                        (dbg_rst_req    ),
    .dbg_regi_req                       (dbg_regi_req   ),
    .dbg_regi_addr                      (dbg_regi_addr  ),
    .dbg_regi_vld                       (dbg_regi_vld   ),
    .dbg_regi_data                      (dbg_regi_data  ),
    .dbg_halted                         (dbg_halted     ),

    .dbg_rden                           (dbg_rden       ),
    .dbg_wren                           (dbg_wren       ),
    .dbg_addr                           (dbg_addr       ),
    .dbg_strb                           (dbg_strb       ),
    .dbg_wdata                          (dbg_wdata      ),
    .dbg_rdata                          (dbg_rdata      ),
    .dbg_ack                            (dbg_ack        ),

    .plb_rden                           (plb_rden       ),
    .plb_wren                           (plb_wren       ),
    .plb_addr                           (plb_addr       ),
    .plb_strb                           (plb_strb       ),
    .plb_wdata                          (plb_wdata      ),
    .plb_rdata                          (plb_rdata      ),
    .plb_ack                            (plb_ack        ),

    .dlb_rden                           (dlb_rden       ),
    .dlb_wren                           (dlb_wren       ),
    .dlb_addr                           (dlb_addr       ),
    .dlb_strb                           (dlb_strb       ),
    .dlb_wdata                          (dlb_wdata      ),
    .dlb_rdata                          (dlb_rdata      ),
    .dlb_ack                            (dlb_ack        ),

    .ilb_rden                           (ilb_rden       ),
    .ilb_wren                           (ilb_wren       ),
    .ilb_addr                           (ilb_addr       ),
    .ilb_strb                           (ilb_strb       ),
    .ilb_wdata                          (ilb_wdata      ),
    .ilb_rdata                          (ilb_rdata      ),
    .ilb_ack                            (ilb_ack        ));
*/

//================================================================================
//  Module Definition
//================================================================================

module merc32_core #(
    parameter   ILB_ADDR_WIDTH          = 16,
    parameter   DLB_ADDR_WIDTH          = 16
) (
    input                               clk,
    input                               rst_n,

    input                               interrupt,

    input                               dbg_rst_req,
    input                               dbg_halt_req,
    input                               dbg_step_req,
    input                               dbg_regi_req,
    input       [3:0]                   dbg_regi_addr,
    output reg                          dbg_regi_vld,
    output reg  [31:0]                  dbg_regi_data,
    output                              dbg_halted,

    input                               dbg_rden,
    input                               dbg_wren,
    input       [31:0]                  dbg_addr,
    input       [3:0]                   dbg_strb,
    input       [31:0]                  dbg_wdata,
    output reg  [31:0]                  dbg_rdata,
    output reg                          dbg_ack,

    output                              plb_rden,
    output                              plb_wren,
    output      [31:0]                  plb_addr,
    output      [3:0]                   plb_strb,
    output      [31:0]                  plb_wdata,
    input       [31:0]                  plb_rdata,
    input                               plb_ack,

    output                              dlb_rden,
    output                              dlb_wren,
    output      [DLB_ADDR_WIDTH-1:0]    dlb_addr,
    output      [3:0]                   dlb_strb,
    output      [31:0]                  dlb_wdata,
    input       [31:0]                  dlb_rdata,
    input                               dlb_ack,

    output                              ilb_rden,
    output                              ilb_wren,
    output      [ILB_ADDR_WIDTH-1:0]    ilb_addr,
    output      [3:0]                   ilb_strb,
    output      [31:0]                  ilb_wdata,
    input       [31:0]                  ilb_rdata,
    input                               ilb_ack
    );

    localparam  OPT_ALU                 = 3'd0;
    localparam  OPT_PCU                 = 3'd1;
    localparam  OPT_MCU                 = 3'd2;

    localparam  FUNC_SET                = 4'd0;
    localparam  FUNC_ADD                = 4'd1;
    localparam  FUNC_SUB                = 4'd2;
    localparam  FUNC_AND                = 4'd3;
    localparam  FUNC_OR                 = 4'd4;
    localparam  FUNC_XOR                = 4'd5;
    localparam  FUNC_SLL                = 4'd6;
    localparam  FUNC_SRL                = 4'd7;
    localparam  FUNC_SRA                = 4'd8;
    localparam  FUNC_MUL                = 4'd9;
    localparam  FUNC_DIV                = 4'd10;
    localparam  FUNC_DIU                = 4'd11;
    localparam  FUNC_REM                = 4'd12;
    localparam  FUNC_REU                = 4'd13;

    localparam  FCMP_EQ                 = 4'd0;
    localparam  FCMP_NE                 = 4'd1;
    localparam  FCMP_SGE                = 4'd2;
    localparam  FCMP_SLT                = 4'd3;
    localparam  FCMP_SGT                = 4'd4;
    localparam  FCMP_SLE                = 4'd5;
    localparam  FCMP_UGE                = 4'd6;
    localparam  FCMP_ULT                = 4'd7;
    localparam  FCMP_UGT                = 4'd8;
    localparam  FCMP_ULE                = 4'd9;
    localparam  FUNC_BEZ                = 4'd10;
    localparam  FUNC_BNZ                = 4'd11;
    localparam  FUNC_JAL                = 4'd12;

    localparam  FUNC_LW                 = 4'd0;
    localparam  FUNC_LH                 = 4'd1;
    localparam  FUNC_LHU                = 4'd2;
    localparam  FUNC_LB                 = 4'd3;
    localparam  FUNC_LBU                = 4'd4;
    localparam  FUNC_SW                 = 4'd5;
    localparam  FUNC_SH                 = 4'd6;
    localparam  FUNC_SB                 = 4'd7;

    localparam  ST_IDLE                 = 7'b0000000;
    localparam  ST_LOAD                 = 7'b0000001;
    localparam  ST_EXEC                 = 7'b0000010;
    localparam  ST_WREG                 = 7'b0000100;
    localparam  ST_STEP                 = 7'b0001000;
    localparam  ST_INTR                 = 7'b0010000;
    localparam  ST_HALT                 = 7'b0100000;
    localparam  ST_DECODE               = 7'b1000000;

    localparam  TRIG_RISE               = 2'b00;
    localparam  TRIG_FALL               = 2'b01;
    localparam  TRIG_HIGH               = 2'b10;
    localparam  TRIG_LOW                = 2'b11;

    localparam  BUS_NONE                = 2'd0;
    localparam  BUS_ILB                 = 2'd1;
    localparam  BUS_DLB                 = 2'd2;
    localparam  BUS_PLB                 = 2'd3;

    initial begin
        if ((ILB_ADDR_WIDTH < 1) || (ILB_ADDR_WIDTH > 25)) begin
            $display("CONFIG ERROR: ILB_ADDR_WIDTH must be in range 1..25");
            $finish;
        end
        if ((DLB_ADDR_WIDTH < 1) || (DLB_ADDR_WIDTH > 25)) begin
            $display("CONFIG ERROR: DLB_ADDR_WIDTH must be in range 1..25");
            $finish;
        end
    end

    wire                                cpu_rst_n;
    reg     [6:0]                       cpu_state;
    reg     [6:0]                       state_last;

    wire                                load_start;
    reg     [31:0]                      prog_addr;
    reg     [31:0]                      prog_next;

    wire                                exec_start;
    reg                                 exec_done;
    reg                                 exec_busrd;
    reg                                 exec_buswr;
    reg     [31:0]                      exec_baddr;

    reg     signed  [31:0]              alu_data;

    reg                                 intr_ff0;
    reg                                 intr_ff1;
    reg                                 intr_ff2;
    reg     [1:0]                       intr_mode;
    reg     [31:0]                      intr_addr;
    reg                                 intr_trig;
    reg                                 intr_flag;

    reg     signed  [31:0]              regi_r1;
    reg     signed  [31:0]              regi_r2;
    reg     signed  [31:0]              regi_r3;
    reg     signed  [31:0]              regi_r15;
    (* ram_style = "distributed" *)
    reg     signed  [31:0]              regi_general [0:10];
    reg                                 regi_clear_active;
    reg     [3:0]                       regi_clear_index;

    reg     [3:0]                       rd;
    reg     [3:0]                       opc;
    reg     [3:0]                       fun;
    reg     [31:0]                      instruction;
    reg     signed  [31:0]              operand_a;
    reg     signed  [31:0]              operand_b;
    reg     signed  [31:0]              operand_d;
    reg                                 shift_out_of_range;

    reg                                 mul_start;
    wire                                mul_done;
    wire    [63:0]                      mul_res;

    reg                                 div_start;
    wire                                div_done;
    wire    [31:0]                      div_quo;
    wire    [31:0]                      div_rem;

    reg                                 cpu_rden;
    reg                                 cpu_wren;
    reg     [31:0]                      cpu_rdata;
    reg                                 cpu_ack;

    reg                                 bus_req_rden;
    reg                                 bus_req_wren;
    reg     [1:0]                       bus_req_target;
    reg                                 bus_req_debug;
    reg     [31:0]                      bus_req_addr;
    reg     [3:0]                       bus_req_strb;
    reg     [31:0]                      bus_req_wdata;
    wire    [31:0]                      bus_rdata;
    wire                                bus_ack;
    wire    signed  [31:0]              add_result;
    wire            [32:0]              subtract_wide;
    wire    signed  [31:0]              subtract_result;
    wire    signed  [31:0]              arithmetic_shift_result;
    wire                                compare_equal;
    wire                                compare_signed_less;
    wire                                compare_unsigned_less;
    wire                                compare_result;
    wire    [31:0]                      load_result;
    wire                                wback_req;

    function [31:0] read_register;
        input   [3:0] address;
        begin
            case(address)
                4'h0:read_register = 32'h0;
                4'h1:read_register = regi_r1;
                4'h2:read_register = regi_r2;
                4'h3:read_register = regi_r3;
                4'hf:read_register = regi_r15;
                default:read_register = regi_general[address - 4'h4];
            endcase
        end
    endfunction

    function [31:0] extend_immediate;
        input   [15:0] value;
        input   [2:0]  operation;
        input   [3:0]  function_code;
        begin
            if(((operation == OPT_ALU) &&
                ((function_code == FUNC_MUL) ||
                 (function_code == FUNC_DIV) ||
                 (function_code == FUNC_REM))) ||
               ((operation == OPT_PCU) &&
                (function_code <= FCMP_SLE))) begin
                extend_immediate = {{16{value[15]}}, value};
            end else begin
                extend_immediate = {16'h0, value};
            end
        end
    endfunction

    function compare_condition;
        input   [3:0] function_code;
        input         equal_flag;
        input         signed_less_flag;
        input         unsigned_less_flag;
        begin
            case(function_code)
                FCMP_EQ :compare_condition = equal_flag;
                FCMP_NE :compare_condition = ~equal_flag;
                FCMP_SGE:compare_condition = ~signed_less_flag;
                FCMP_SLT:compare_condition = signed_less_flag;
                FCMP_SGT:compare_condition = ~signed_less_flag & ~equal_flag;
                FCMP_SLE:compare_condition = signed_less_flag | equal_flag;
                FCMP_UGE:compare_condition = ~unsigned_less_flag;
                FCMP_ULT:compare_condition = unsigned_less_flag;
                FCMP_UGT:compare_condition = ~unsigned_less_flag & ~equal_flag;
                FCMP_ULE:compare_condition = unsigned_less_flag | equal_flag;
                default :compare_condition = 1'b0;
            endcase
        end
    endfunction

    function [31:0] format_load_data;
        input   [3:0]  function_code;
        input   [1:0]  byte_offset;
        input   [31:0] word_data;
        reg     [15:0] half_data;
        reg     [7:0]  byte_data;
        begin
            half_data = byte_offset[1] ? word_data[31:16] : word_data[15:0];
            case(byte_offset)
                2'd0:byte_data = word_data[7:0];
                2'd1:byte_data = word_data[15:8];
                2'd2:byte_data = word_data[23:16];
                default:byte_data = word_data[31:24];
            endcase

            case(function_code)
                FUNC_LW :format_load_data = word_data;
                FUNC_LH :format_load_data = {{16{half_data[15]}}, half_data};
                FUNC_LHU:format_load_data = {16'h0, half_data};
                FUNC_LB :format_load_data = {{24{byte_data[7]}}, byte_data};
                FUNC_LBU:format_load_data = {24'h0, byte_data};
                default :format_load_data = word_data;
            endcase
        end
    endfunction

    function [1:0] decode_bus_target;
        input   [31:0] byte_address;
        begin
            if(byte_address < 32'h0800_0000) begin
                decode_bus_target = BUS_ILB;
            end else if(byte_address < 32'h1000_0000) begin
                decode_bus_target = BUS_DLB;
            end else begin
                decode_bus_target = BUS_PLB;
            end
        end
    endfunction

    function [3:0] store_strobe;
        input   [3:0] function_code;
        input   [1:0] byte_offset;
        begin
            case(function_code)
                FUNC_SH:store_strobe = byte_offset[1] ? 4'b1100 : 4'b0011;
                FUNC_SB:begin
                    case(byte_offset)
                        2'd0:store_strobe = 4'b0001;
                        2'd1:store_strobe = 4'b0010;
                        2'd2:store_strobe = 4'b0100;
                        default:store_strobe = 4'b1000;
                    endcase
                end
                default:store_strobe = 4'b1111;
            endcase
        end
    endfunction

    function [31:0] format_store_data;
        input   [3:0]  function_code;
        input   [1:0]  byte_offset;
        input   [31:0] register_data;
        begin
            case(function_code)
                FUNC_SH:format_store_data = byte_offset[1]
                                           ? register_data << 16
                                           : register_data;
                FUNC_SB:begin
                    case(byte_offset)
                        2'd0:format_store_data = {24'h0, register_data[7:0]};
                        2'd1:format_store_data = register_data << 8;
                        2'd2:format_store_data = register_data << 16;
                        default:format_store_data = register_data << 24;
                    endcase
                end
                default:format_store_data = register_data;
            endcase
        end
    endfunction

`ifndef SYNTHESIS
    wire    signed  [31:0]              regi_int [0:15];

    assign  regi_int[0] = 32'h0;
    assign  regi_int[1] = regi_r1;
    assign  regi_int[2] = regi_r2;
    assign  regi_int[3] = regi_r3;
    assign  regi_int[4] = regi_general[0];
    assign  regi_int[5] = regi_general[1];
    assign  regi_int[6] = regi_general[2];
    assign  regi_int[7] = regi_general[3];
    assign  regi_int[8] = regi_general[4];
    assign  regi_int[9] = regi_general[5];
    assign  regi_int[10] = regi_general[6];
    assign  regi_int[11] = regi_general[7];
    assign  regi_int[12] = regi_general[8];
    assign  regi_int[13] = regi_general[9];
    assign  regi_int[14] = regi_general[10];
    assign  regi_int[15] = regi_r15;
`endif

    assign  cpu_rst_n = rst_n & (~dbg_rst_req);
    assign  load_start = (cpu_state == ST_LOAD) & (state_last != ST_LOAD);
    assign  exec_start = (cpu_state == ST_EXEC) & (state_last != ST_EXEC);
    assign  add_result = operand_a + operand_b;
    assign  subtract_wide = {1'b0, operand_a} - {1'b0, operand_b};
    assign  subtract_result = subtract_wide[31:0];
    assign  arithmetic_shift_result = operand_a >>> operand_b[4:0];
    assign  compare_equal = operand_a == operand_b;
    assign  compare_signed_less = (operand_a[31] != operand_b[31])
                                ? operand_a[31] : subtract_result[31];
    assign  compare_unsigned_less = subtract_wide[32];
    assign  compare_result = compare_condition(fun, compare_equal,
                                                compare_signed_less,
                                                compare_unsigned_less);
    assign  load_result = format_load_data(fun, exec_baddr[1:0], cpu_rdata);
    assign  wback_req = !(((opc[3:1] == OPT_MCU) &&
                           (fun >= FUNC_SW) && (fun <= FUNC_SB)) ||
                          ((opc[3:1] == OPT_PCU) &&
                           ((fun == FUNC_BEZ) || (fun == FUNC_BNZ))));

    assign  ilb_rden = bus_req_rden && (bus_req_target == BUS_ILB);
    assign  ilb_wren = bus_req_wren && (bus_req_target == BUS_ILB);
    assign  ilb_addr = bus_req_addr[ILB_ADDR_WIDTH+1:2];
    assign  ilb_strb = bus_req_strb;
    assign  ilb_wdata = bus_req_wdata;

    assign  dlb_rden = bus_req_rden && (bus_req_target == BUS_DLB);
    assign  dlb_wren = bus_req_wren && (bus_req_target == BUS_DLB);
    assign  dlb_addr = bus_req_addr[DLB_ADDR_WIDTH+1:2];
    assign  dlb_strb = bus_req_strb;
    assign  dlb_wdata = bus_req_wdata;

    assign  plb_rden = bus_req_rden && (bus_req_target == BUS_PLB);
    assign  plb_wren = bus_req_wren && (bus_req_target == BUS_PLB);
    assign  plb_addr = bus_req_addr;
    assign  plb_strb = bus_req_strb;
    assign  plb_wdata = bus_req_wdata;

    assign  bus_rdata = bus_req_target == BUS_ILB ? ilb_rdata :
                        bus_req_target == BUS_DLB ? dlb_rdata :
                        bus_req_target == BUS_PLB ? plb_rdata : 32'hdece;
    assign  bus_ack = bus_req_target == BUS_ILB ? ilb_ack :
                      bus_req_target == BUS_DLB ? dlb_ack :
                      bus_req_target == BUS_PLB ? plb_ack : 1'b0;

    assign  dbg_halted    = (cpu_state == ST_HALT);

    // Advance the CPU control state, holding ST_EXEC until the current
    // instruction reports completion.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_state <= ST_IDLE;
            state_last <= ST_IDLE;
        end else begin
            case(cpu_state)
                ST_IDLE:cpu_state <= regi_clear_active ? ST_IDLE : ST_LOAD;
                ST_LOAD:cpu_state <= ilb_ack ? ST_DECODE : ST_LOAD;
                ST_DECODE:cpu_state <= ST_EXEC;
                ST_EXEC:cpu_state <= exec_done ? ST_WREG : ST_EXEC;
                ST_WREG:cpu_state <= ST_STEP;
                ST_STEP:cpu_state <= dbg_halt_req ? ST_HALT : intr_flag ? ST_INTR : ST_LOAD;
                ST_INTR:cpu_state <= ST_LOAD;
                ST_HALT:cpu_state <= dbg_step_req ? ST_LOAD : ST_HALT;
                default:cpu_state <= ST_IDLE;
            endcase
            state_last <= cpu_state;
        end
    end

    // Register the instruction response before any decode or register-file
    // selection so BRAM clock-to-output delay ends at this pipeline stage.
    always @(posedge clk) begin
        if(ilb_ack) begin
            instruction <= ilb_rdata;
        end
    end

    // Decode the registered instruction and capture all execution operands.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            rd  <= 4'h0;
            opc <= 4'd0;
            fun <= 4'd0;
            operand_a <= 32'h0;
            operand_b <= 32'h0;
            operand_d <= 32'h0;
            shift_out_of_range <= 1'b0;
        end else if(cpu_state == ST_DECODE) begin
            rd  <= instruction[11:8];
            opc <= instruction[7:4];
            fun <= instruction[3:0];
            operand_a <= read_register(instruction[15:12]);
            operand_d <= read_register(instruction[11:8]);
            if(instruction[4]) begin
                operand_b <= read_register(instruction[19:16]);
                shift_out_of_range <=
                    |(read_register(instruction[19:16]) >> 5);
            end else begin
                operand_b <= extend_immediate(instruction[31:16],
                                              instruction[7:5],
                                              instruction[3:0]);
                shift_out_of_range <=
                    |(extend_immediate(instruction[31:16],
                                       instruction[7:5],
                                       instruction[3:0]) >> 5);
            end
        end
    end

    // Commit the resolved next PC in ST_STEP, or load the interrupt vector
    // while entering the interrupt handler.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            prog_addr <= 0;
        end else if(cpu_state == ST_STEP) begin
            prog_addr <= prog_next;
        end else if(cpu_state == ST_INTR) begin
            prog_addr <= intr_addr;
        end
    end

    // Resolve the sequential, branch, or jump target during instruction
    // execution so ST_STEP only has to commit the selected address.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            prog_next <= 0;
        end else if(cpu_state == ST_EXEC) begin
            case({opc[3:1], fun})
                {OPT_PCU, FUNC_BEZ}:prog_next <= operand_d == 32'd0 ? add_result : prog_addr + 4;
                {OPT_PCU, FUNC_BNZ}:prog_next <= operand_d != 32'd0 ? add_result : prog_addr + 4;
                {OPT_PCU, FUNC_JAL}:prog_next <= add_result;
                default:prog_next <= prog_addr + 4;
            endcase
        end
    end

    // Delay ST_LOAD by one cycle to generate the execution-start pulse used
    // to launch memory transactions.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            exec_busrd <= 1'b0;
            exec_buswr <= 1'b0;
            exec_baddr <= 32'h0;
        end else begin
            exec_busrd <= exec_start && (opc[3:1] == OPT_MCU) &&
                          (fun <= FUNC_LBU);
            exec_buswr <= exec_start && (opc[3:1] == OPT_MCU) &&
                          (fun >= FUNC_SW) && (fun <= FUNC_SB);
            exec_baddr <= exec_start ? add_result : exec_baddr;
        end
    end

    // Register instruction completion; memory operations wait for cpu_ack,
    // while all other currently implemented operations complete immediately.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            exec_done <= 1'b0;
        end else if(cpu_state == ST_EXEC) begin
            case({opc[3:1], fun})
                {OPT_ALU, FUNC_MUL} : exec_done <= mul_done;
                {OPT_ALU, FUNC_DIV} : exec_done <= div_done;
                {OPT_ALU, FUNC_DIU} : exec_done <= div_done;
                {OPT_ALU, FUNC_REM} : exec_done <= div_done;
                {OPT_ALU, FUNC_REU} : exec_done <= div_done;
                {OPT_MCU, FUNC_LW}  : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_LH}  : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_LHU} : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_LB}  : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_LBU} : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_SW}  : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_SH}  : exec_done <= cpu_ack;
                {OPT_MCU, FUNC_SB}  : exec_done <= cpu_ack;
                default:exec_done <= 1'b1;
            endcase
        end else begin
            exec_done <= 1'b0;
        end
    end

    // Capture the destination register and execution result while in ST_EXEC;
    // load instructions sample the active bus return data through cpu_rdata.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            alu_data <= 32'h0;
        end else if(cpu_state == ST_EXEC) begin
            if((opc[3:1] == OPT_PCU) && (fun <= FCMP_ULE)) begin
                alu_data <= {31'h0, compare_result};
            end else begin
                case({opc[3:1], fun})
                {OPT_ALU, FUNC_SET} : alu_data <= operand_b;
                {OPT_ALU, FUNC_ADD} : alu_data <= add_result;
                {OPT_ALU, FUNC_SUB} : alu_data <= subtract_result;
                {OPT_ALU, FUNC_AND} : alu_data <= operand_a & operand_b;
                {OPT_ALU, FUNC_OR}  : alu_data <= operand_a | operand_b;
                {OPT_ALU, FUNC_XOR} : alu_data <= operand_a ^ operand_b;
                {OPT_ALU, FUNC_SLL} : alu_data <= shift_out_of_range
                                                 ? 32'h0
                                                 : operand_a << operand_b[4:0];
                {OPT_ALU, FUNC_SRL} : alu_data <= shift_out_of_range
                                                 ? 32'h0
                                                 : operand_a >> operand_b[4:0];
                {OPT_ALU, FUNC_SRA} : alu_data <= shift_out_of_range
                                                 ? {32{operand_a[31]}}
                                                 : arithmetic_shift_result;
                {OPT_ALU, FUNC_MUL} : alu_data <= mul_res[31:0];
                {OPT_ALU, FUNC_DIV} : alu_data <= div_quo;
                {OPT_ALU, FUNC_DIU} : alu_data <= div_quo;
                {OPT_ALU, FUNC_REM} : alu_data <= div_rem;
                {OPT_ALU, FUNC_REU} : alu_data <= div_rem;
                {OPT_PCU, FUNC_JAL} : alu_data <= prog_addr + 4;
                {OPT_MCU, FUNC_LW}  : alu_data <= load_result;
                {OPT_MCU, FUNC_LH}  : alu_data <= load_result;
                {OPT_MCU, FUNC_LHU} : alu_data <= load_result;
                {OPT_MCU, FUNC_LB}  : alu_data <= load_result;
                {OPT_MCU, FUNC_LBU} : alu_data <= load_result;
                default             : alu_data <= alu_data;
                endcase
            end
        end
    end

    // Clear the general-register RAM through its normal write port, then use
    // that same port for ordinary writeback.
    always @(posedge clk) begin
        if(regi_clear_active) begin
            regi_general[regi_clear_index] <= 32'h0;
        end else if(cpu_state == ST_WREG && wback_req &&
                    (rd >= 4'h4) && (rd <= 4'he)) begin
            regi_general[rd - 4'h4] <= alu_data;
        end
    end

    // Sequence the post-reset general-register clear while the CPU stays idle.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            regi_clear_active <= 1'b1;
            regi_clear_index <= 4'h0;
        end else if(regi_clear_active) begin
            if(regi_clear_index == 4'd10) begin
                regi_clear_active <= 1'b0;
            end else begin
                regi_clear_index <= regi_clear_index + 1'b1;
            end
        end
    end

    // Maintain the three dedicated interrupt registers. Interrupt entry has
    // priority over normal software writeback.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            regi_r1 <= 32'h0;
            regi_r2 <= 32'h0;
            regi_r3 <= 32'h0;
        end else if(cpu_state == ST_INTR) begin
            regi_r1 <= regi_r1 & 32'hffff_fffe;
            regi_r3 <= prog_addr;
        end else if(cpu_state == ST_WREG && wback_req) begin
            case(rd)
                4'h1:regi_r1 <= alu_data;
                4'h2:regi_r2 <= alu_data;
                4'h3:regi_r3 <= alu_data;
            endcase
        end
    end

    // Preserve the writable PC-view register and refresh it from the current
    // PC whenever no explicit write or interrupt entry takes priority.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            regi_r15 <= 32'h0;
        end else if(cpu_state == ST_INTR) begin
            regi_r15 <= intr_addr;
        end else if(cpu_state == ST_WREG && wback_req &&
                    (rd == 4'hf)) begin
            regi_r15 <= alu_data;
        end else begin
            regi_r15 <= prog_addr;
        end
    end

    // Synchronize the external interrupt, snapshot its software-controlled
    // configuration, and register the selected trigger condition.
    always @(posedge clk) begin
        if (!cpu_rst_n) begin
            intr_ff0  <= 1'b0;
            intr_ff1  <= 1'b0;
            intr_ff2  <= 1'b0;
            intr_mode <= 2'b0;
            intr_addr <= 32'h0;
            intr_trig <= 1'b0;
        end else begin
            intr_ff0  <= interrupt;
            intr_ff1  <= intr_ff0;
            intr_ff2  <= intr_ff1;
            intr_mode <= regi_r1[2:1];
            intr_addr <= regi_r2;
            case (intr_mode)
                TRIG_RISE : intr_trig <= intr_ff1 & ~intr_ff2;
                TRIG_FALL : intr_trig <= ~intr_ff1 & intr_ff2;
                TRIG_HIGH : intr_trig <= intr_ff2;
                TRIG_LOW  : intr_trig <= ~intr_ff2;
            endcase
        end
    end

    // Latch an interrupt request until the CPU enters ST_INTR and consumes it.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            intr_flag <= 1'b0;
        end else if(cpu_state == ST_INTR) begin
            intr_flag <= 1'b0;
        end else if(regi_r1[0] & intr_trig) begin
            intr_flag <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            mul_start <= 1'b0;
        end else begin
            mul_start <= ({opc[3:1], fun} == {OPT_ALU, FUNC_MUL}) && exec_start;
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            div_start <= 1'b0;
        end else begin
            div_start <= (fun == FUNC_DIV | fun == FUNC_DIU | fun == FUNC_REM | fun == FUNC_REU) && (opc[3:1] == OPT_ALU) && exec_start;
        end
    end

    // Delay the CPU data-access request to preserve the existing execution
    // timing; the shared request record captures its payload on the next clock.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_rden <= 1'b0;
            cpu_wren <= 1'b0;
        end else begin
            cpu_rden <= exec_busrd;
            cpu_wren <= exec_buswr;
        end
    end

    // Register one request payload for instruction fetches, CPU data accesses,
    // and halted debug accesses. Request strobes default low while the target
    // and payload remain stable until a later request replaces them.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            bus_req_rden <= 1'b0;
            bus_req_wren <= 1'b0;
            bus_req_target <= BUS_NONE;
            bus_req_debug <= 1'b0;
        end else begin
            bus_req_rden <= 1'b0;
            bus_req_wren <= 1'b0;

            if(dbg_halted && (dbg_rden || dbg_wren)) begin
                bus_req_target <= decode_bus_target(dbg_addr);
                bus_req_debug <= 1'b1;
                bus_req_addr <= dbg_addr;
                bus_req_strb <= dbg_strb;
                bus_req_wdata <= dbg_wdata;
                if(decode_bus_target(dbg_addr) != BUS_NONE) begin
                    bus_req_rden <= dbg_rden;
                    bus_req_wren <= dbg_wren;
                end
            end else if(!dbg_halted && load_start) begin
                bus_req_rden <= 1'b1;
                bus_req_wren <= 1'b0;
                bus_req_target <= BUS_ILB;
                bus_req_debug <= 1'b0;
                bus_req_addr <= prog_addr;
                bus_req_strb <= 4'b1111;
                bus_req_wdata <= 32'h0;
            end else if(!dbg_halted && (cpu_rden || cpu_wren)) begin
                bus_req_target <= decode_bus_target(exec_baddr);
                bus_req_debug <= 1'b0;
                bus_req_addr <= exec_baddr;
                bus_req_strb <= store_strobe(fun, exec_baddr[1:0]);
                bus_req_wdata <= format_store_data(fun, exec_baddr[1:0],
                                                   operand_d);
                if((decode_bus_target(exec_baddr) == BUS_DLB) ||
                   (decode_bus_target(exec_baddr) == BUS_PLB)) begin
                    bus_req_rden <= cpu_rden;
                    bus_req_wren <= cpu_wren;
                end
            end
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_ack <= 1'b0;
            cpu_rdata <= 32'h0;
            dbg_ack <= 1'b0;
            dbg_rdata <= 32'h0;
        end else begin
            cpu_ack <= !bus_req_debug && bus_ack &&
                       (bus_req_target != BUS_ILB);
            cpu_rdata <= bus_rdata;
            dbg_ack <= bus_req_debug && bus_ack;
            dbg_rdata <= bus_rdata;
        end
    end

    // Return one indexed architectural register for each debug request.
    always @(posedge clk) begin
        if(!rst_n) begin
            dbg_regi_vld <= 1'b0;
            dbg_regi_data <= 32'h0;
        end else begin
            dbg_regi_vld <= dbg_regi_req;
            if(dbg_regi_req) begin
                dbg_regi_data <= read_register(dbg_regi_addr);
            end
        end
    end

    mul mul_inst        (
        .clk            (clk            ),
        .rst_n          (cpu_rst_n      ),

        .start          (mul_start      ),
        .signed_mode    (1'b1           ),
        .operand_a      (operand_a      ),
        .operand_b      (operand_b      ),

        .done           (mul_done       ),
        .result         (mul_res        ));

    div div_inst        (
        .clk            (clk            ),
        .rst_n          (cpu_rst_n      ),

        .start          (div_start      ),
        .signed_mode    ((fun == FUNC_DIV) || (fun == FUNC_REM)),
        .dividend       (operand_a      ),
        .divisor        (operand_b      ),

        .done           (div_done       ),
        .quotient       (div_quo        ),
        .remainder      (div_rem        ));

endmodule
