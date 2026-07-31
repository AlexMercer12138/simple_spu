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
    output                              dbg_regi_vld,
    output      [31:0]                  dbg_regi_data,
    output                              dbg_halted,

    input                               dbg_rden,
    input                               dbg_wren,
    input       [31:0]                  dbg_addr,
    input       [31:0]                  dbg_wdata,
    output      [31:0]                  dbg_rdata,
    output                              dbg_ack,

    output                              plb_rden,
    output                              plb_wren,
    output      [31:0]                  plb_addr,
    output      [31:0]                  plb_wdata,
    input       [31:0]                  plb_rdata,
    input                               plb_ack,

    output                              dlb_en,
    output                              dlb_we,
    output      [DLB_ADDR_WIDTH-1:0]    dlb_addr,
    output      [31:0]                  dlb_wdata,
    input       [31:0]                  dlb_rdata,

    output                              ilb_en,
    output                              ilb_we,
    output      [ILB_ADDR_WIDTH-1:0]    ilb_addr,
    output      [31:0]                  ilb_wdata,
    input       [31:0]                  ilb_rdata
    );

    localparam  OP_IMM                  = 4'd1;
    localparam  OP_REG                  = 4'd2;
    localparam  OP_ICMP                 = 4'd3;
    localparam  OP_RCMP                 = 4'd4;

    localparam  FUNC_SET                = 4'd0;
    localparam  FUNC_ADD                = 4'd1;
    localparam  FUNC_SUB                = 4'd2;
    localparam  FUNC_AND                = 4'd3;
    localparam  FUNC_OR                 = 4'd4;
    localparam  FUNC_XOR                = 4'd5;
    localparam  FUNC_SLL                = 4'd6;
    localparam  FUNC_SRL                = 4'd7;
    localparam  FUNC_SRA                = 4'd8;
    localparam  FUNC_MWR                = 4'd9;
    localparam  FUNC_MRD                = 4'd10;
    localparam  FUNC_BEZ                = 4'd11;
    localparam  FUNC_BNZ                = 4'd12;
    localparam  FUNC_JAL                = 4'd13;
    localparam  FUNC_MUL                = 4'd14;
    localparam  FUNC_DIV                = 4'd15;

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
    reg     [31:0]                      prog_addr;
    reg     [31:0]                      prog_next;

    reg                                 exec_start;
    reg                                 exec_done;
    reg                                 wback_req;

    reg     [3:0]                       alu_ptr;
    reg     signed  [31:0]              alu_data;

    reg                                 intr_en;
    reg                                 intr_ff0;
    reg                                 intr_ff1;
    reg                                 intr_ff2;
    reg     [1:0]                       intr_mode;
    reg     [31:0]                      intr_addr;
    reg                                 intr_trig;
    reg                                 intr_flag;

    reg     signed  [31:0]              regi_int    [0:15];

    wire    [15:0]                      imm;
    wire    [3:0]                       rs1;
    wire    [3:0]                       rs2;
    wire    [3:0]                       rd;
    wire    [3:0]                       opc;
    wire    [3:0]                       fun;

    reg                                 cpu_rden;
    reg                                 cpu_wren;
    reg     [31:0]                      cpu_addr;
    reg     [31:0]                      cpu_wdata;
    wire    [31:0]                      cpu_rdata;
    wire                                cpu_ack;

    wire                                bus_rden;
    wire                                bus_wren;
    wire    [31:0]                      bus_addr;
    wire    [31:0]                      bus_wdata;
    wire    [31:0]                      bus_rdata;
    wire                                bus_ack;

    wire                                inst_addr_hit;
    wire                                data_addr_hit;
    wire                                peri_addr_hit;

    reg                                 inst_pending;
    reg                                 data_pending;

    reg                                 regi_en;
    reg                                 regi_vld;
    reg     [3:0]                       regi_cnt;
    reg     [31:0]                      regi_data;

    assign  cpu_rst_n = rst_n & (~dbg_rst_req);

    assign  imm = ilb_rdata[31:16];
    assign  rs1 = ilb_rdata[19:16];
    assign  rs2 = ilb_rdata[15:12];
    assign  rd  = ilb_rdata[11:8];
    assign  opc = ilb_rdata[7:4];
    assign  fun = ilb_rdata[3:0];

    assign  bus_rden    = dbg_halted ? dbg_rden : cpu_rden;
    assign  bus_wren    = dbg_halted ? dbg_wren : cpu_wren;
    assign  bus_addr    = dbg_halted ? dbg_addr : cpu_addr;
    assign  bus_wdata   = dbg_halted ? dbg_wdata : cpu_wdata;
    assign  bus_rdata   = inst_addr_hit ? ilb_rdata : data_addr_hit ? dlb_rdata : peri_addr_hit ? plb_rdata : 32'hdece;
    assign  bus_ack     = (inst_addr_hit & inst_pending)|(data_addr_hit & data_pending)|(peri_addr_hit & plb_ack);

    assign  ilb_en      = dbg_halted ? (bus_wren | bus_rden) & inst_addr_hit : cpu_state == ST_LOAD;
    assign  ilb_we      = dbg_halted ? bus_wren & inst_addr_hit : 1'b0;
    assign  ilb_addr    = dbg_halted ? bus_addr[ILB_ADDR_WIDTH+1:2] : prog_addr[ILB_ADDR_WIDTH+1:2];
    assign  ilb_wdata   = dbg_halted ? bus_wdata : 32'h0;

    assign  dlb_en      = (bus_wren | bus_rden) & data_addr_hit;
    assign  dlb_we      = bus_wren & data_addr_hit;
    assign  dlb_addr    = bus_addr[DLB_ADDR_WIDTH+1:2];
    assign  dlb_wdata   = bus_wdata;

    assign  plb_rden    = bus_rden & peri_addr_hit;
    assign  plb_wren    = bus_wren & peri_addr_hit;
    assign  plb_addr    = bus_addr;
    assign  plb_wdata   = bus_wdata;

    assign  cpu_ack     = ~dbg_halted & bus_ack & ~inst_addr_hit;
    assign  cpu_rdata   = bus_rdata;
    assign  dbg_ack     = dbg_halted & bus_ack;
    assign  dbg_rdata   = bus_rdata;

    assign  inst_addr_hit = (bus_addr < 32'h0080_0000);
    assign  data_addr_hit = (bus_addr >= 32'h0080_0000) && (bus_addr < 32'h0100_0000);
    assign  peri_addr_hit = (bus_addr >= 32'h1000_0000);

    assign  dbg_halted    = (cpu_state == ST_HALT);
    assign  dbg_regi_vld  = regi_vld;
    assign  dbg_regi_data = regi_data;

    // Advance the CPU control state, holding ST_EXEC until the current
    // instruction reports completion.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_state <= ST_IDLE;
        end else begin
            case(cpu_state)
                ST_IDLE:cpu_state <= ST_LOAD;
                ST_LOAD:cpu_state <= ST_EXEC;
                ST_EXEC:cpu_state <= exec_done ? ST_WREG : ST_EXEC;
                ST_WREG:cpu_state <= ST_STEP;
                ST_STEP:cpu_state <= dbg_halt_req ? ST_HALT : intr_flag ? ST_INTR : ST_LOAD;
                ST_INTR:cpu_state <= ST_LOAD;
                ST_HALT:cpu_state <= dbg_step_req ? ST_LOAD : ST_HALT;
                default:cpu_state <= ST_IDLE;
            endcase
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
                {OP_IMM, FUNC_BEZ}:prog_next <= regi_int[rd] == 32'd0 ? regi_int[rs2] + imm : prog_addr + 4;
                {OP_IMM, FUNC_BNZ}:prog_next <= regi_int[rd] != 32'd0 ? regi_int[rs2] + imm : prog_addr + 4;
                {OP_IMM, FUNC_JAL}:prog_next <= regi_int[rs2] + imm;
                {OP_REG, FUNC_BEZ}:prog_next <= regi_int[rd] == 32'd0 ? regi_int[rs2] + regi_int[rs1] : prog_addr + 4;
                {OP_REG, FUNC_BNZ}:prog_next <= regi_int[rd] != 32'd0 ? regi_int[rs2] + regi_int[rs1] : prog_addr + 4;
                {OP_REG, FUNC_JAL}:prog_next <= regi_int[rs2] + regi_int[rs1];
                default:prog_next <= prog_addr + 4;
            endcase
        end
    end

    // Delay ST_LOAD by one cycle to generate the execution-start pulse used
    // to launch memory transactions.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            exec_start <= 1'b0;
        end else begin
            exec_start <= cpu_state == ST_LOAD;
        end
    end

    // Register instruction completion; memory operations wait for cpu_ack,
    // while all other currently implemented operations complete immediately.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            exec_done <= 1'b0;
        end else if(cpu_state == ST_EXEC) begin
            case({opc, fun})
                {OP_IMM, FUNC_MRD}:exec_done <= cpu_ack;
                {OP_IMM, FUNC_MWR}:exec_done <= cpu_ack;
                {OP_REG, FUNC_MRD}:exec_done <= cpu_ack;
                {OP_REG, FUNC_MWR}:exec_done <= cpu_ack;
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
                {OP_IMM, FUNC_MWR}:wback_req <= 1'b0;
                {OP_IMM, FUNC_BEZ}:wback_req <= 1'b0;
                {OP_IMM, FUNC_BNZ}:wback_req <= 1'b0;
                {OP_REG, FUNC_MWR}:wback_req <= 1'b0;
                {OP_REG, FUNC_BEZ}:wback_req <= 1'b0;
                {OP_REG, FUNC_BNZ}:wback_req <= 1'b0;
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
                {OP_IMM, FUNC_SET}  : alu_data <= imm;
                {OP_IMM, FUNC_ADD}  : alu_data <= regi_int[rs2] + imm;
                {OP_IMM, FUNC_SUB}  : alu_data <= regi_int[rs2] - imm;
                {OP_IMM, FUNC_AND}  : alu_data <= regi_int[rs2] & imm;
                {OP_IMM, FUNC_OR}   : alu_data <= regi_int[rs2] | imm;
                {OP_IMM, FUNC_XOR}  : alu_data <= regi_int[rs2] ^ imm;
                {OP_IMM, FUNC_SLL}  : alu_data <= regi_int[rs2] << imm;
                {OP_IMM, FUNC_SRL}  : alu_data <= regi_int[rs2] >> imm;
                {OP_IMM, FUNC_SRA}  : alu_data <= regi_int[rs2] >>> imm;
                {OP_IMM, FUNC_MRD}  : alu_data <= cpu_rdata;
                {OP_IMM, FUNC_JAL}  : alu_data <= prog_addr + 4;
                {OP_REG, FUNC_SET}  : alu_data <= regi_int[rs1];
                {OP_REG, FUNC_ADD}  : alu_data <= regi_int[rs2] + regi_int[rs1];
                {OP_REG, FUNC_SUB}  : alu_data <= regi_int[rs2] - regi_int[rs1];
                {OP_REG, FUNC_AND}  : alu_data <= regi_int[rs2] & regi_int[rs1];
                {OP_REG, FUNC_OR}   : alu_data <= regi_int[rs2] | regi_int[rs1];
                {OP_REG, FUNC_XOR}  : alu_data <= regi_int[rs2] ^ regi_int[rs1];
                {OP_REG, FUNC_SLL}  : alu_data <= regi_int[rs2] << regi_int[rs1];
                {OP_REG, FUNC_SRL}  : alu_data <= regi_int[rs2] >> regi_int[rs1];
                {OP_REG, FUNC_SRA}  : alu_data <= regi_int[rs2] >>> regi_int[rs1];
                {OP_REG, FUNC_MRD}  : alu_data <= cpu_rdata;
                {OP_REG, FUNC_JAL}  : alu_data <= prog_addr + 4;
                {OP_ICMP, FCMP_EQ}  : alu_data <= $signed(regi_int[rs2]) == $signed(imm);
                {OP_ICMP, FCMP_NE}  : alu_data <= $signed(regi_int[rs2]) != $signed(imm);
                {OP_ICMP, FCMP_SGE} : alu_data <= $signed(regi_int[rs2]) >= $signed(imm);
                {OP_ICMP, FCMP_SLT} : alu_data <= $signed(regi_int[rs2]) <  $signed(imm);
                {OP_ICMP, FCMP_SGT} : alu_data <= $signed(regi_int[rs2]) >  $signed(imm);
                {OP_ICMP, FCMP_SLE} : alu_data <= $signed(regi_int[rs2]) <= $signed(imm);
                {OP_ICMP, FCMP_UGE} : alu_data <= $unsigned(regi_int[rs2]) >= $unsigned(imm);
                {OP_ICMP, FCMP_ULT} : alu_data <= $unsigned(regi_int[rs2]) <  $unsigned(imm);
                {OP_ICMP, FCMP_UGT} : alu_data <= $unsigned(regi_int[rs2]) >  $unsigned(imm);
                {OP_ICMP, FCMP_ULE} : alu_data <= $unsigned(regi_int[rs2]) <= $unsigned(imm);
                {OP_RCMP, FCMP_EQ}  : alu_data <= $signed(regi_int[rs2]) == $signed(regi_int[rs1]);
                {OP_RCMP, FCMP_NE}  : alu_data <= $signed(regi_int[rs2]) != $signed(regi_int[rs1]);
                {OP_RCMP, FCMP_SGE} : alu_data <= $signed(regi_int[rs2]) >= $signed(regi_int[rs1]);
                {OP_RCMP, FCMP_SLT} : alu_data <= $signed(regi_int[rs2]) <  $signed(regi_int[rs1]);
                {OP_RCMP, FCMP_SGT} : alu_data <= $signed(regi_int[rs2]) >  $signed(regi_int[rs1]);
                {OP_RCMP, FCMP_SLE} : alu_data <= $signed(regi_int[rs2]) <= $signed(regi_int[rs1]);
                {OP_RCMP, FCMP_UGE} : alu_data <= $unsigned(regi_int[rs2]) >= $unsigned(regi_int[rs1]);
                {OP_RCMP, FCMP_ULT} : alu_data <= $unsigned(regi_int[rs2]) <  $unsigned(regi_int[rs1]);
                {OP_RCMP, FCMP_UGT} : alu_data <= $unsigned(regi_int[rs2]) >  $unsigned(regi_int[rs1]);
                {OP_RCMP, FCMP_ULE} : alu_data <= $unsigned(regi_int[rs2]) <= $unsigned(regi_int[rs1]);
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
            intr_en   <= 1'b0;
            intr_ff0  <= 1'b0;
            intr_ff1  <= 1'b0;
            intr_ff2  <= 1'b0;
            intr_mode <= 2'b0;
            intr_addr <= 32'h0;
            intr_trig <= 1'b0;
        end else begin
            intr_en   <= regi_int[1][0];
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
        end else if(intr_en & intr_trig) begin
            intr_flag <= 1'b1;
        end
    end

    // Generate the registered CPU data-bus request pulse and capture its
    // address and write payload from the decoded memory instruction.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            cpu_rden  <= 1'b0;
            cpu_wren  <= 1'b0;
            cpu_addr  <= 32'h0;
            cpu_wdata <= 32'h0;
        end else begin
            cpu_rden  <= ({opc, fun} == {OP_IMM, FUNC_MRD} || {opc, fun} == {OP_REG, FUNC_MRD}) && exec_start;
            cpu_wren  <= ({opc, fun} == {OP_IMM, FUNC_MWR} || {opc, fun} == {OP_REG, FUNC_MWR}) && exec_start;
            cpu_addr  <= regi_int[rs2] + (opc[0] ? imm : regi_int[rs1]);
            cpu_wdata <= regi_int[rd];
        end
    end

    // Delay local instruction/data enables by one cycle to form the synchronous
    // local-memory completion pulses used by the CPU and debugger.
    always @(posedge clk) begin
        if(!cpu_rst_n) begin
            inst_pending <= 1'b0;
            data_pending <= 1'b0;
        end else begin
            inst_pending <= ilb_en;
            data_pending <= dlb_en;
        end
    end

    // Stream r0 through r15 to the debugger, one valid register value per
    // clock after a register-inspection request.
    always @(posedge clk) begin
        if(!rst_n) begin
            regi_en <= 1'b0;
            regi_vld <= 1'b0;
            regi_cnt <= 4'd0;
            regi_data <= 32'h0;
        end else if(dbg_regi_req) begin
            regi_en <= 1'b1;
            regi_vld <= 1'b0;
            regi_cnt <= 4'd0;
            regi_data <= regi_data;
        end else begin
            regi_en <= &regi_cnt ? 1'b0 : regi_en;
            regi_vld <= regi_en;
            regi_cnt <= regi_en ? regi_cnt + 1'b1 : regi_cnt;
            regi_data <= regi_en ? regi_int[regi_cnt] : regi_data;
        end
    end

endmodule
