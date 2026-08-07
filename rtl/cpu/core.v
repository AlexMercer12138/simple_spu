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
    .dbg_regi_vld                       (dbg_regi_vld   ),
    .dbg_regi_data                      (dbg_regi_data  ),
    .dbg_halted                         (dbg_halted     ),

    .dbg_rden                           (dbg_rden       ),
    .dbg_wren                           (dbg_wren       ),
    .dbg_addr                           (dbg_addr       ),
    .dbg_wdata                          (dbg_wdata      ),
    .dbg_rdata                          (dbg_rdata      ),
    .dbg_ack                            (dbg_ack        ),

    .plb_rden                           (plb_rden       ),
    .plb_wren                           (plb_wren       ),
    .plb_addr                           (plb_addr       ),
    .plb_wdata                          (plb_wdata      ),
    .plb_rdata                          (plb_rdata      ),
    .plb_ack                            (plb_ack        ),

    .dlb_en                             (dlb_en         ),
    .dlb_we                             (dlb_we         ),
    .dlb_addr                           (dlb_addr       ),
    .dlb_wdata                          (dlb_wdata      ),
    .dlb_rdata                          (dlb_rdata      ),

    .ilb_en                             (ilb_en         ),
    .ilb_we                             (ilb_we         ),
    .ilb_addr                           (ilb_addr       ),
    .ilb_wdata                          (ilb_wdata      ),
    .ilb_rdata                          (ilb_rdata      ));
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

    output reg                          plb_rden,
    output reg                          plb_wren,
    output reg  [31:0]                  plb_addr,
    output reg  [3:0]                   plb_strb,
    output reg  [31:0]                  plb_wdata,
    input       [31:0]                  plb_rdata,
    input                               plb_ack,

    output reg                          dlb_rden,
    output reg                          dlb_wren,
    output reg  [DLB_ADDR_WIDTH-1:0]    dlb_addr,
    output reg  [3:0]                   dlb_strb,
    output reg  [31:0]                  dlb_wdata,
    input       [31:0]                  dlb_rdata,
    input                               dlb_ack,

    output reg                          ilb_rden,
    output reg                          ilb_wren,
    output reg  [ILB_ADDR_WIDTH-1:0]    ilb_addr,
    output reg  [3:0]                   ilb_strb,
    output reg  [31:0]                  ilb_wdata,
    input       [31:0]                  ilb_rdata,
    input                               ilb_ack
    );

    localparam  OPT_ALU                 = 3'd0;
    localparam  OPT_PCU                 = 3'd1;
    localparam  OPT_MCU                 = 3'd2;

    localparam  OP_IALU                 = 4'd0;
    localparam  OP_RALU                 = 4'd1;
    localparam  OP_IPCU                 = 4'd2;
    localparam  OP_RPCU                 = 4'd3;
    localparam  OP_IMCU                 = 4'd4;
    localparam  OP_RMCU                 = 4'd5;

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

    localparam  ST_IDLE                 = 6'b000000;
    localparam  ST_LOAD                 = 6'b000001;
    localparam  ST_EXEC                 = 6'b000010;
    localparam  ST_WREG                 = 6'b000100;
    localparam  ST_STEP                 = 6'b001000;
    localparam  ST_INTR                 = 6'b010000;
    localparam  ST_HALT                 = 6'b100000;

    localparam  TRIG_RISE               = 2'b00;
    localparam  TRIG_FALL               = 2'b01;
    localparam  TRIG_HIGH               = 2'b10;
    localparam  TRIG_LOW                = 2'b11;

    wire                                cpu_rst_n;
    reg     [5:0]                       cpu_state;
    reg     [5:0]                       state_last;

    wire                                load_start;
    reg     [31:0]                      prog_addr;
    reg     [31:0]                      prog_next;

    wire                                exec_start;
    reg                                 exec_done;
    reg                                 exec_busrd;
    reg                                 exec_buswr;
    reg     [31:0]                      exec_baddr;
    reg                                 wback_req;

    reg     [3:0]                       alu_ptr;
    reg     signed  [31:0]              alu_data;

    reg                                 intr_ff0;
    reg                                 intr_ff1;
    reg                                 intr_ff2;
    reg     [1:0]                       intr_mode;
    reg     [31:0]                      intr_addr;
    reg                                 intr_trig;
    reg                                 intr_flag;

    reg     signed  [31:0]              regi_int    [0:15];

    reg     [15:0]                      imm;
    reg     [3:0]                       rs1;
    reg     [3:0]                       rs2;
    reg     [3:0]                       rd;
    reg     [2:0]                       opt;
    reg     [3:0]                       opc;
    reg     [3:0]                       fun;

    reg                                 mul_start;
    reg                                 mul_mode;
    reg     [31:0]                      mul_opa;
    reg     [31:0]                      mul_opb;
    wire                                mul_done;
    wire    [63:0]                      mul_res;

    reg                                 div_start;
    reg                                 div_mode;
    reg     [31:0]                      dividend;
    reg     [31:0]                      divisor;
    wire                                div_done;
    wire    [31:0]                      div_quo;
    wire    [31:0]                      div_rem;

    reg                                 cpu_rden;
    reg                                 cpu_wren;
    reg     [31:0]                      cpu_addr;
    reg     [3:0]                       cpu_strb;
    reg     [31:0]                      cpu_wdata;
    reg     [31:0]                      cpu_rdata;
    reg                                 cpu_ack;

    wire                                bus_rden;
    wire                                bus_wren;
    wire    [31:0]                      bus_addr;
    wire    [3:0]                       bus_strb;
    wire    [31:0]                      bus_wdata;
    wire    [31:0]                      bus_rdata;
    wire                                bus_ack;

    wire                                inst_addr_hit;
    wire                                data_addr_hit;
    wire                                peri_addr_hit;

    reg                                 dbg_regi_en;
    reg     [3:0]                       dbg_regi_cnt;

    assign  cpu_rst_n = rst_n & (~dbg_rst_req);
    assign  load_start = (cpu_state == ST_LOAD) & (state_last != ST_LOAD);
    assign  exec_start = (cpu_state == ST_EXEC) & (state_last != ST_EXEC);

    assign  bus_rden    = dbg_halted ? dbg_rden : cpu_rden;
    assign  bus_wren    = dbg_halted ? dbg_wren : cpu_wren;
    assign  bus_strb    = dbg_halted ? dbg_strb : cpu_strb;
    assign  bus_addr    = dbg_halted ? dbg_addr : cpu_addr;
    assign  bus_wdata   = dbg_halted ? dbg_wdata : cpu_wdata;
    assign  bus_rdata   = inst_addr_hit ? ilb_rdata : data_addr_hit ? dlb_rdata : peri_addr_hit ? plb_rdata : 32'hdece;
    assign  bus_ack     = (inst_addr_hit & ilb_ack)|(data_addr_hit & dlb_ack)|(peri_addr_hit & plb_ack);

    assign  inst_addr_hit = (bus_addr < 32'h0080_0000);
    assign  data_addr_hit = (bus_addr >= 32'h0080_0000) && (bus_addr < 32'h0100_0000);
    assign  peri_addr_hit = (bus_addr >= 32'h1000_0000);

    assign  dbg_halted    = (cpu_state == ST_HALT);

    // Advance the CPU control state, holding ST_EXEC until the current
    // instruction reports completion.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_state <= ST_IDLE;
            state_last <= ST_IDLE;
        end else begin
            case(cpu_state)
                ST_IDLE:cpu_state <= ST_LOAD;
                ST_LOAD:cpu_state <= ilb_ack ? ST_EXEC : ST_LOAD;
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

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            imm <= 16'h0;
            rs1 <= 4'h0;
            rs2 <= 4'h0;
            rd  <= 4'h0;
            opt <= 3'd0;
            opc <= 4'd0;
            fun <= 4'd0;
        end else if(ilb_ack) begin
            imm <= ilb_rdata[31:16];
            rs1 <= ilb_rdata[19:16];
            rs2 <= ilb_rdata[15:12];
            rd  <= ilb_rdata[11:8];
            opt <= ilb_rdata[7:5];
            opc <= ilb_rdata[7:4];
            fun <= ilb_rdata[3:0];
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
            case({opc, fun})
                {OP_IPCU, FUNC_BEZ}:prog_next <= regi_int[rd] == 32'd0 ? regi_int[rs2] + imm : prog_addr + 4;
                {OP_IPCU, FUNC_BNZ}:prog_next <= regi_int[rd] != 32'd0 ? regi_int[rs2] + imm : prog_addr + 4;
                {OP_IPCU, FUNC_JAL}:prog_next <= regi_int[rs2] + imm;
                {OP_RPCU, FUNC_BEZ}:prog_next <= regi_int[rd] == 32'd0 ? regi_int[rs2] + regi_int[rs1] : prog_addr + 4;
                {OP_RPCU, FUNC_BNZ}:prog_next <= regi_int[rd] != 32'd0 ? regi_int[rs2] + regi_int[rs1] : prog_addr + 4;
                {OP_RPCU, FUNC_JAL}:prog_next <= regi_int[rs2] + regi_int[rs1];
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
            exec_busrd <= exec_start && (opt == OPT_MCU) && (fun == 0 | fun == 1 | fun == 2 | fun == 3 | fun == 4);
            exec_buswr <= exec_start && (opt == OPT_MCU) && (fun == 5 | fun == 6 | fun == 7);
            exec_baddr <= exec_start ? regi_int[rs2] + (opc[0] ? regi_int[rs1] : imm) : exec_baddr;
        end
    end

    // Register instruction completion; memory operations wait for cpu_ack,
    // while all other currently implemented operations complete immediately.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            exec_done <= 1'b0;
        end else if(cpu_state == ST_EXEC) begin
            case({opc, fun})
                {OP_IALU, FUNC_MUL} : exec_done <= mul_done;
                {OP_IALU, FUNC_DIV} : exec_done <= div_done;
                {OP_IALU, FUNC_DIU} : exec_done <= div_done;
                {OP_IALU, FUNC_REM} : exec_done <= div_done;
                {OP_IALU, FUNC_REU} : exec_done <= div_done;
                {OP_RALU, FUNC_MUL} : exec_done <= mul_done;
                {OP_RALU, FUNC_DIV} : exec_done <= div_done;
                {OP_RALU, FUNC_DIU} : exec_done <= div_done;
                {OP_RALU, FUNC_REM} : exec_done <= div_done;
                {OP_RALU, FUNC_REU} : exec_done <= div_done;
                {OP_IMCU, FUNC_LW}  : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_LH}  : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_LHU} : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_LB}  : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_LBU} : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_SW}  : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_SH}  : exec_done <= cpu_ack;
                {OP_IMCU, FUNC_SB}  : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_LW}  : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_LH}  : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_LHU} : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_LB}  : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_LBU} : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_SW}  : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_SH}  : exec_done <= cpu_ack;
                {OP_RMCU, FUNC_SB}  : exec_done <= cpu_ack;
                default:exec_done <= 1'b1;
            endcase
        end else begin
            exec_done <= 1'b0;
        end
    end

    // Record whether the executing instruction requires a destination-register
    // write when it reaches ST_WREG.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            wback_req <= 1'b0;
        end else if(cpu_state == ST_EXEC) begin
            case({opc, fun})
                {OP_IMCU, FUNC_SW}  : wback_req <= 1'b0;
                {OP_IMCU, FUNC_SH}  : wback_req <= 1'b0;
                {OP_IMCU, FUNC_SB}  : wback_req <= 1'b0;
                {OP_IPCU, FUNC_BEZ} : wback_req <= 1'b0;
                {OP_IPCU, FUNC_BNZ} : wback_req <= 1'b0;
                {OP_RMCU, FUNC_SW}  : wback_req <= 1'b0;
                {OP_RMCU, FUNC_SH}  : wback_req <= 1'b0;
                {OP_RMCU, FUNC_SB}  : wback_req <= 1'b0;
                {OP_RPCU, FUNC_BEZ} : wback_req <= 1'b0;
                {OP_RPCU, FUNC_BNZ} : wback_req <= 1'b0;
                default:wback_req <= 1'b1;
            endcase
        end else begin
            wback_req <= 1'b0;
        end
    end

    // Capture the destination register and execution result while in ST_EXEC;
    // load instructions sample the active bus return data through cpu_rdata.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            alu_ptr  <= 4'd0;
            alu_data <= 32'h0;
        end else if(cpu_state == ST_EXEC) begin
            alu_ptr  <= rd;
            case({opc, fun})
                {OP_IALU, FUNC_SET} : alu_data <= imm;
                {OP_IALU, FUNC_ADD} : alu_data <= regi_int[rs2] + imm;
                {OP_IALU, FUNC_SUB} : alu_data <= regi_int[rs2] - imm;
                {OP_IALU, FUNC_AND} : alu_data <= regi_int[rs2] & imm;
                {OP_IALU, FUNC_OR}  : alu_data <= regi_int[rs2] | imm;
                {OP_IALU, FUNC_XOR} : alu_data <= regi_int[rs2] ^ imm;
                {OP_IALU, FUNC_SLL} : alu_data <= regi_int[rs2] << imm;
                {OP_IALU, FUNC_SRL} : alu_data <= regi_int[rs2] >> imm;
                {OP_IALU, FUNC_SRA} : alu_data <= regi_int[rs2] >>> imm;
                {OP_IALU, FUNC_MUL} : alu_data <= mul_res[31:0];
                {OP_IALU, FUNC_DIV} : alu_data <= div_quo;
                {OP_IALU, FUNC_DIU} : alu_data <= div_quo;
                {OP_IALU, FUNC_REM} : alu_data <= div_rem;
                {OP_IALU, FUNC_REU} : alu_data <= div_rem;
                {OP_RALU, FUNC_SET} : alu_data <= regi_int[rs1];
                {OP_RALU, FUNC_ADD} : alu_data <= regi_int[rs2] + regi_int[rs1];
                {OP_RALU, FUNC_SUB} : alu_data <= regi_int[rs2] - regi_int[rs1];
                {OP_RALU, FUNC_AND} : alu_data <= regi_int[rs2] & regi_int[rs1];
                {OP_RALU, FUNC_OR}  : alu_data <= regi_int[rs2] | regi_int[rs1];
                {OP_RALU, FUNC_XOR} : alu_data <= regi_int[rs2] ^ regi_int[rs1];
                {OP_RALU, FUNC_SLL} : alu_data <= regi_int[rs2] << regi_int[rs1];
                {OP_RALU, FUNC_SRL} : alu_data <= regi_int[rs2] >> regi_int[rs1];
                {OP_RALU, FUNC_SRA} : alu_data <= regi_int[rs2] >>> regi_int[rs1];
                {OP_RALU, FUNC_MUL} : alu_data <= mul_res[31:0];
                {OP_RALU, FUNC_DIV} : alu_data <= div_quo;
                {OP_RALU, FUNC_DIU} : alu_data <= div_quo;
                {OP_RALU, FUNC_REM} : alu_data <= div_rem;
                {OP_RALU, FUNC_REU} : alu_data <= div_rem;
                {OP_IPCU, FCMP_EQ}  : alu_data <= $signed(regi_int[rs2]) == $signed(imm);
                {OP_IPCU, FCMP_NE}  : alu_data <= $signed(regi_int[rs2]) != $signed(imm);
                {OP_IPCU, FCMP_SGE} : alu_data <= $signed(regi_int[rs2]) >= $signed(imm);
                {OP_IPCU, FCMP_SLT} : alu_data <= $signed(regi_int[rs2]) <  $signed(imm);
                {OP_IPCU, FCMP_SGT} : alu_data <= $signed(regi_int[rs2]) >  $signed(imm);
                {OP_IPCU, FCMP_SLE} : alu_data <= $signed(regi_int[rs2]) <= $signed(imm);
                {OP_IPCU, FCMP_UGE} : alu_data <= $unsigned(regi_int[rs2]) >= $unsigned(imm);
                {OP_IPCU, FCMP_ULT} : alu_data <= $unsigned(regi_int[rs2]) <  $unsigned(imm);
                {OP_IPCU, FCMP_UGT} : alu_data <= $unsigned(regi_int[rs2]) >  $unsigned(imm);
                {OP_IPCU, FCMP_ULE} : alu_data <= $unsigned(regi_int[rs2]) <= $unsigned(imm);
                {OP_IPCU, FUNC_JAL} : alu_data <= prog_addr + 4;
                {OP_RPCU, FCMP_EQ}  : alu_data <= $signed(regi_int[rs2]) == $signed(regi_int[rs1]);
                {OP_RPCU, FCMP_NE}  : alu_data <= $signed(regi_int[rs2]) != $signed(regi_int[rs1]);
                {OP_RPCU, FCMP_SGE} : alu_data <= $signed(regi_int[rs2]) >= $signed(regi_int[rs1]);
                {OP_RPCU, FCMP_SLT} : alu_data <= $signed(regi_int[rs2]) <  $signed(regi_int[rs1]);
                {OP_RPCU, FCMP_SGT} : alu_data <= $signed(regi_int[rs2]) >  $signed(regi_int[rs1]);
                {OP_RPCU, FCMP_SLE} : alu_data <= $signed(regi_int[rs2]) <= $signed(regi_int[rs1]);
                {OP_RPCU, FCMP_UGE} : alu_data <= $unsigned(regi_int[rs2]) >= $unsigned(regi_int[rs1]);
                {OP_RPCU, FCMP_ULT} : alu_data <= $unsigned(regi_int[rs2]) <  $unsigned(regi_int[rs1]);
                {OP_RPCU, FCMP_UGT} : alu_data <= $unsigned(regi_int[rs2]) >  $unsigned(regi_int[rs1]);
                {OP_RPCU, FCMP_ULE} : alu_data <= $unsigned(regi_int[rs2]) <= $unsigned(regi_int[rs1]);
                {OP_RPCU, FUNC_JAL} : alu_data <= prog_addr + 4;
                {OP_IMCU, FUNC_LW}  : alu_data <= cpu_rdata;
                {OP_IMCU, FUNC_LH}  : alu_data <= exec_baddr[1] ? $signed(cpu_rdata[31:16]) : $signed(cpu_rdata[15:0]);
                {OP_IMCU, FUNC_LHU} : alu_data <= exec_baddr[1] ? $unsigned(cpu_rdata[31:16]) : $unsigned(cpu_rdata[15:0]);
                {OP_IMCU, FUNC_LB}  : alu_data <= exec_baddr[1:0] == 3 ? $signed(cpu_rdata[31:24]) : exec_baddr[1:0] == 2 ? $signed(cpu_rdata[23:16]) : exec_baddr[1:0] == 1 ? $signed(cpu_rdata[15:8]) : $signed(cpu_rdata[7:0]);
                {OP_IMCU, FUNC_LBU} : alu_data <= exec_baddr[1:0] == 3 ? $unsigned(cpu_rdata[31:24]) : exec_baddr[1:0] == 2 ? $unsigned(cpu_rdata[23:16]) : exec_baddr[1:0] == 1 ? $unsigned(cpu_rdata[15:8]) : $unsigned(cpu_rdata[7:0]);
                {OP_RMCU, FUNC_LW}  : alu_data <= cpu_rdata;
                {OP_RMCU, FUNC_LH}  : alu_data <= exec_baddr[1] ? $signed(cpu_rdata[31:16]) : $signed(cpu_rdata[15:0]);
                {OP_RMCU, FUNC_LHU} : alu_data <= exec_baddr[1] ? $unsigned(cpu_rdata[31:16]) : $unsigned(cpu_rdata[15:0]);
                {OP_RMCU, FUNC_LB}  : alu_data <= exec_baddr[1:0] == 3 ? $signed(cpu_rdata[31:24]) : exec_baddr[1:0] == 2 ? $signed(cpu_rdata[23:16]) : exec_baddr[1:0] == 1 ? $signed(cpu_rdata[15:8]) : $signed(cpu_rdata[7:0]);
                {OP_RMCU, FUNC_LBU} : alu_data <= exec_baddr[1:0] == 3 ? $unsigned(cpu_rdata[31:24]) : exec_baddr[1:0] == 2 ? $unsigned(cpu_rdata[23:16]) : exec_baddr[1:0] == 1 ? $unsigned(cpu_rdata[15:8]) : $unsigned(cpu_rdata[7:0]);
                default             : alu_data <= alu_data;
            endcase
        end
    end

    // Maintain the architectural register file, with interrupt entry taking
    // priority over normal writeback and idle updates to r0 and PC-visible r15.
    always @(posedge clk) begin:register_files
        integer i;
        if(!cpu_rst_n) begin
            for (i = 0;i < 16;i = i + 1) begin
                regi_int[i] <= 0;
            end
        end else if(cpu_state == ST_INTR) begin
            regi_int[01] <= regi_int[01] & 32'hffff_fffe;
            regi_int[03] <= prog_addr;
            regi_int[15] <= intr_addr;
        end else if(cpu_state == ST_WREG && wback_req) begin
            case (alu_ptr)
                4'h0:regi_int[00] <= regi_int[00];
                4'h1:regi_int[01] <= alu_data;
                4'h2:regi_int[02] <= alu_data;
                4'h3:regi_int[03] <= alu_data;
                4'h4:regi_int[04] <= alu_data;
                4'h5:regi_int[05] <= alu_data;
                4'h6:regi_int[06] <= alu_data;
                4'h7:regi_int[07] <= alu_data;
                4'h8:regi_int[08] <= alu_data;
                4'h9:regi_int[09] <= alu_data;
                4'ha:regi_int[10] <= alu_data;
                4'hb:regi_int[11] <= alu_data;
                4'hc:regi_int[12] <= alu_data;
                4'hd:regi_int[13] <= alu_data;
                4'he:regi_int[14] <= alu_data;
                4'hf:regi_int[15] <= alu_data;
            endcase
        end else begin
            regi_int[00] <= 32'h0;
            regi_int[15] <= prog_addr;
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
            intr_mode <= regi_int[1][2:1];
            intr_addr <= regi_int[2];
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
        end else if(regi_int[1][0] & intr_trig) begin
            intr_flag <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            mul_start <= 1'b0;
            mul_mode <= 1'b0;
            mul_opa <= 32'h0;
            mul_opb <= 32'h0;
        end else begin
            mul_start <= ({opt, fun} == {OPT_ALU, FUNC_MUL}) && exec_start;
            mul_mode <= 1'b1;
            mul_opa <= regi_int[rs2];
            mul_opb <= opc[0] ? regi_int[rs1] : $signed(imm);
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            div_start <= 1'b0;
            div_mode <= 1'b0;
            dividend <= 32'h0;
            divisor <= 32'h0;
        end else begin
            div_start <= (fun == FUNC_DIV | fun == FUNC_DIU | fun == FUNC_REM | fun == FUNC_REU) && (opt == OPT_ALU) && exec_start;
            div_mode <= (fun == FUNC_DIV | fun == FUNC_REM);
            dividend <= regi_int[rs2];
            divisor <= (fun == FUNC_DIV | fun == FUNC_REM) ? (opc[0] ? regi_int[rs1] : $signed(imm)) : (opc[0] ? regi_int[rs1] : $unsigned(imm));
        end
    end

    // Generate the registered CPU data-bus request pulse and capture its
    // address and write payload from the decoded memory instruction.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_rden  <= 1'b0;
            cpu_wren  <= 1'b0;
            cpu_strb  <= 4'b0;
            cpu_addr  <= 32'h0;
            cpu_wdata <= 32'h0;
        end else begin
            cpu_rden  <= exec_busrd;
            cpu_wren  <= exec_buswr;
            cpu_addr  <= exec_baddr;
            case(fun)
                FUNC_SW:begin
                    cpu_strb  <= 4'b1111;
                    cpu_wdata <= regi_int[rd];
                end
                FUNC_SH:begin
                    cpu_strb  <= exec_baddr[1] ? 4'b1100 : 4'b0011;
                    cpu_wdata <= exec_baddr[1] ? regi_int[rd] << 16 : regi_int[rd];
                end
                FUNC_SB:begin
                    cpu_strb  <= exec_baddr[1:0] == 3 ? 4'b1000 : exec_baddr[1:0] == 2 ? 4'b0100 : exec_baddr[1:0] == 1 ? 4'b0010 : 4'b0001;
                    cpu_wdata <= exec_baddr[1:0] == 3 ? regi_int[rd] << 24 : exec_baddr[1:0] == 2 ? regi_int[rd] << 16 : exec_baddr[1:0] == 1 ? regi_int[rd] << 8 : regi_int[rd][7:0];
                end
            endcase
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            ilb_rden  <= 1'b0;
            ilb_wren  <= 1'b0;
            ilb_strb  <= 4'b0;
            ilb_addr  <= 32'h0;
            ilb_wdata <= 32'h0;
        end else if(dbg_halted) begin
            ilb_rden  <= bus_rden & inst_addr_hit;
            ilb_wren  <= bus_wren & inst_addr_hit;
            ilb_strb  <= bus_strb;
            ilb_addr  <= bus_addr[ILB_ADDR_WIDTH+1:2];
            ilb_wdata <= bus_wdata;
        end else begin
            ilb_rden  <= load_start;
            ilb_wren  <= 1'b0;
            ilb_strb  <= 4'b1111;
            ilb_addr  <= prog_addr[ILB_ADDR_WIDTH+1:2];
            ilb_wdata <= 32'h0;
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            dlb_rden  <= 1'b0;
            dlb_wren  <= 1'b0;
            dlb_strb  <= 4'b0;
            dlb_addr  <= 32'h0;
            dlb_wdata <= 32'h0;
        end else begin
            dlb_rden  <= bus_rden & data_addr_hit;
            dlb_wren  <= bus_wren & data_addr_hit;
            dlb_strb  <= bus_strb;
            dlb_addr  <= bus_addr[DLB_ADDR_WIDTH+1:2];
            dlb_wdata <= bus_wdata;
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            plb_rden  <= 1'b0;
            plb_wren  <= 1'b0;
            plb_strb  <= 4'b0;
            plb_addr  <= 32'h0;
            plb_wdata <= 32'h0;
        end else begin
            plb_rden  <= bus_rden & peri_addr_hit;
            plb_wren  <= bus_wren & peri_addr_hit;
            plb_strb  <= bus_strb;
            plb_addr  <= bus_addr;
            plb_wdata <= bus_wdata;
        end
    end

    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_ack <= 1'b0;
            cpu_rdata <= 32'h0;
            dbg_ack <= 1'b0;
            dbg_rdata <= 32'h0;
        end else begin
            cpu_ack <= ~dbg_halted & bus_ack & ~inst_addr_hit;
            cpu_rdata <= bus_rdata;
            dbg_ack <= dbg_halted & bus_ack;
            dbg_rdata <= bus_rdata;
        end
    end

    // Stream r0 through r15 to the debugger, one valid register value per
    // clock after a register-inspection request.
    always @(posedge clk) begin
        if(!rst_n) begin
            dbg_regi_en <= 1'b0;
            dbg_regi_vld <= 1'b0;
            dbg_regi_cnt <= 4'd0;
            dbg_regi_data <= 32'h0;
        end else if(dbg_regi_req) begin
            dbg_regi_en <= 1'b1;
            dbg_regi_vld <= 1'b0;
            dbg_regi_cnt <= 4'd0;
            dbg_regi_data <= dbg_regi_data;
        end else begin
            dbg_regi_en <= &dbg_regi_cnt ? 1'b0 : dbg_regi_en;
            dbg_regi_vld <= dbg_regi_en;
            dbg_regi_cnt <= dbg_regi_en ? dbg_regi_cnt + 1'b1 : dbg_regi_cnt;
            dbg_regi_data <= dbg_regi_en ? regi_int[dbg_regi_cnt] : dbg_regi_data;
        end
    end

    mul mul_inst        (
        .clk            (clk            ),
        .rst_n          (cpu_rst_n      ),

        .start          (mul_start      ),
        .signed_mode    (mul_mode       ),
        .operand_a      (mul_opa        ),
        .operand_b      (mul_opb        ),

        .done           (mul_done       ),
        .result         (mul_res        ));

    div div_inst        (
        .clk            (clk            ),
        .rst_n          (cpu_rst_n      ),

        .start          (div_start      ),
        .signed_mode    (div_mode       ),
        .dividend       (dividend       ),
        .divisor        (divisor        ),

        .done           (div_done       ),
        .quotient       (div_quo        ),
        .remainder      (div_rem        ));

endmodule
