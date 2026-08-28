`timescale 1ns / 1ps

module merc32_core_tb();

    localparam integer CLK_HALF_NS       = 5;
    localparam integer MAX_WAIT_CYCLES   = 160;
    localparam integer WATCHDOG_CYCLES   = 30000;
    localparam integer MEMORY_WORDS      = 65536;

    localparam [3:0] OP_IALU             = 4'h0;
    localparam [3:0] OP_RALU             = 4'h1;
    localparam [3:0] OP_IPCU             = 4'h2;
    localparam [3:0] OP_RPCU             = 4'h3;
    localparam [3:0] OP_IMCU             = 4'h4;
    localparam [3:0] OP_RMCU             = 4'h5;

    localparam [3:0] FUNC_SET            = 4'h0;
    localparam [3:0] FUNC_SUB            = 4'h2;
    localparam [3:0] FUNC_SLL            = 4'h6;
    localparam [3:0] FUNC_SRL            = 4'h7;
    localparam [3:0] FUNC_SRA            = 4'h8;
    localparam [3:0] FUNC_BEZ            = 4'ha;
    localparam [3:0] FUNC_BNZ            = 4'hb;
    localparam [3:0] FUNC_JAL            = 4'hc;
    localparam [3:0] FUNC_SW             = 4'h5;

    localparam [3:0] CMP_EQ              = 4'd0;
    localparam [3:0] CMP_NE              = 4'd1;
    localparam [3:0] CMP_SGE             = 4'd2;
    localparam [3:0] CMP_SLT             = 4'd3;
    localparam [3:0] CMP_SGT             = 4'd4;
    localparam [3:0] CMP_SLE             = 4'd5;
    localparam [3:0] CMP_UGE             = 4'd6;
    localparam [3:0] CMP_ULT             = 4'd7;
    localparam [3:0] CMP_UGT             = 4'd8;
    localparam [3:0] CMP_ULE             = 4'd9;

    localparam [5:0] ST_LOAD             = 6'b000001;
    localparam [6:0] ST_DECODE           = 7'b1000000;
    localparam [5:0] ST_EXEC             = 6'b000010;
    localparam [5:0] ST_STEP             = 6'b001000;
    localparam [5:0] ST_INTR             = 6'b010000;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         interrupt = 1'b0;

    wire        ilb_rden;
    wire        ilb_wren;
    wire [15:0] ilb_addr;
    wire [3:0]  ilb_strb;
    wire [31:0] ilb_wdata;
    reg  [31:0] ilb_rdata = 32'd0;
    reg         ilb_ack = 1'b0;

    wire        dlb_rden;
    wire        dlb_wren;
    wire [15:0] dlb_addr;
    wire [3:0]  dlb_strb;
    wire [31:0] dlb_wdata;
    reg  [31:0] dlb_rdata = 32'd0;
    reg         dlb_ack = 1'b0;

    wire        plb_rden;
    wire        plb_wren;
    wire [31:0] plb_addr;
    wire [3:0]  plb_strb;
    wire [31:0] plb_wdata;
    reg  [31:0] plb_rdata = 32'd0;
    reg         plb_ack = 1'b0;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram [0:255];

    integer checks = 0;
    integer failures = 0;
    integer condition;
    integer relation;
    integer i;
    reg     done = 1'b0;
    reg     decode_smoke_passed = 1'b0;
    reg     protocol_failed = 1'b0;
    reg     ilb_request_last = 1'b0;
    reg     dlb_request_last = 1'b0;
    reg     plb_request_last = 1'b0;

    merc32_core #(
        .ILB_ADDR_WIDTH (16),
        .DLB_ADDR_WIDTH (16))
    merc32_core_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        .interrupt      (interrupt),

        .dbg_rst_req    (1'b0),
        .dbg_halt_req   (1'b0),
        .dbg_step_req   (1'b0),
        .dbg_regi_req   (1'b0),
        .dbg_regi_addr  (4'h0),
        .dbg_regi_vld   (),
        .dbg_regi_data  (),
        .dbg_halted     (),
        .dbg_rden       (1'b0),
        .dbg_wren       (1'b0),
        .dbg_addr       (32'd0),
        .dbg_strb       (4'b1111),
        .dbg_wdata      (32'd0),
        .dbg_rdata      (),
        .dbg_ack        (),

        .dlb_rden       (dlb_rden),
        .dlb_wren       (dlb_wren),
        .dlb_addr       (dlb_addr),
        .dlb_strb       (dlb_strb),
        .dlb_wdata      (dlb_wdata),
        .dlb_rdata      (dlb_rdata),
        .dlb_ack        (dlb_ack),

        .ilb_rden       (ilb_rden),
        .ilb_wren       (ilb_wren),
        .ilb_addr       (ilb_addr),
        .ilb_strb       (ilb_strb),
        .ilb_wdata      (ilb_wdata),
        .ilb_rdata      (ilb_rdata),
        .ilb_ack        (ilb_ack),

        .plb_rden       (plb_rden),
        .plb_wren       (plb_wren),
        .plb_addr       (plb_addr),
        .plb_strb       (plb_strb),
        .plb_wdata      (plb_wdata),
        .plb_rdata      (plb_rdata),
        .plb_ack        (plb_ack));

    always #(CLK_HALF_NS) clk = ~clk;

    always @(posedge clk) begin
        if (!rst_n) begin
            ilb_rdata <= 32'd0;
            ilb_ack <= 1'b0;
            dlb_rdata <= 32'd0;
            dlb_ack <= 1'b0;
            plb_rdata <= 32'd0;
            plb_ack <= 1'b0;
        end else begin
            ilb_ack <= ilb_rden | ilb_wren;
            if (ilb_rden)
                ilb_rdata <= program_rom[ilb_addr];
            dlb_ack <= dlb_rden | dlb_wren;
            if (dlb_wren) begin
                if (dlb_strb[0]) dlb_ram[dlb_addr[7:0]][7:0] <= dlb_wdata[7:0];
                if (dlb_strb[1]) dlb_ram[dlb_addr[7:0]][15:8] <= dlb_wdata[15:8];
                if (dlb_strb[2]) dlb_ram[dlb_addr[7:0]][23:16] <= dlb_wdata[23:16];
                if (dlb_strb[3]) dlb_ram[dlb_addr[7:0]][31:24] <= dlb_wdata[31:24];
            end
            if (dlb_rden)
                dlb_rdata <= dlb_ram[dlb_addr[7:0]];
            plb_rdata <= 32'd0;
            plb_ack <= plb_rden | plb_wren;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            ilb_request_last <= 1'b0;
            dlb_request_last <= 1'b0;
            plb_request_last <= 1'b0;
        end else begin
            if (ilb_rden && ilb_wren) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: ILB read and write requests overlap");
            end
            if (dlb_rden && dlb_wren) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: DLB read and write requests overlap");
            end
            if (plb_rden && plb_wren) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: PLB read and write requests overlap");
            end
            if ((ilb_rden || ilb_wren) && ilb_request_last) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: ILB request lasted more than one cycle");
            end
            if ((dlb_rden || dlb_wren) && dlb_request_last) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: DLB request lasted more than one cycle");
            end
            if ((plb_rden || plb_wren) && plb_request_last) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: PLB request lasted more than one cycle");
            end
            ilb_request_last <= ilb_rden || ilb_wren;
            dlb_request_last <= dlb_rden || dlb_wren;
            plb_request_last <= plb_rden || plb_wren;
        end
    end

    function [31:0] enc_imm;
        input [3:0] opcode;
        input [3:0] funct;
        input [3:0] dest;
        input [3:0] source;
        input [15:0] immediate;
        begin
            enc_imm = {immediate, source, dest, opcode, funct};
        end
    endfunction

    function [31:0] enc_reg;
        input [3:0] opcode;
        input [3:0] funct;
        input [3:0] dest;
        input [3:0] source2;
        input [3:0] source1;
        begin
            enc_reg = {12'd0, source1, source2, dest, opcode, funct};
        end
    endfunction

    function [31:0] compare_expected;
        input [3:0] compare_function;
        input [31:0] left_value;
        input [31:0] right_value;
        begin
            case (compare_function)
                CMP_EQ:  compare_expected = left_value == right_value;
                CMP_NE:  compare_expected = left_value != right_value;
                CMP_SGE: compare_expected = $signed(left_value) >= $signed(right_value);
                CMP_SLT: compare_expected = $signed(left_value) <  $signed(right_value);
                CMP_SGT: compare_expected = $signed(left_value) >  $signed(right_value);
                CMP_SLE: compare_expected = $signed(left_value) <= $signed(right_value);
                CMP_UGE: compare_expected = left_value >= right_value;
                CMP_ULT: compare_expected = left_value <  right_value;
                CMP_UGT: compare_expected = left_value >  right_value;
                CMP_ULE: compare_expected = left_value <= right_value;
                default: compare_expected = 32'hxxxx_xxxx;
            endcase
        end
    endfunction

    task prepare_case;
        integer index;
        begin
            rst_n <= 1'b0;
            interrupt <= 1'b0;
            for (index = 0; index < 256; index = index + 1) begin
                program_rom[index] = enc_imm(OP_IALU, FUNC_SET, 4'd0, 4'd0, 16'd0);
                dlb_ram[index] = 32'd0;
            end
            repeat (4) @(posedge clk);
            #1 rst_n <= 1'b1;
        end
    endtask

    task wait_for_pc;
        input [31:0] expected_pc;
        output reached;
        reg reached;
        integer cycles;
        begin
            reached = 1'b0;
            cycles = 0;
            while ((cycles < MAX_WAIT_CYCLES) && !reached) begin
                @(posedge clk);
                #1;
                if ((merc32_core_inst.cpu_state === ST_LOAD) &&
                    (merc32_core_inst.prog_addr === expected_pc))
                    reached = 1'b1;
                cycles = cycles + 1;
            end
        end
    endtask

    task capture_next_pc;
        input [31:0] instruction_pc;
        output reached;
        output [31:0] next_pc;
        reg reached;
        reg [31:0] next_pc;
        integer cycles;
        begin
            reached = 1'b0;
            next_pc = 32'hxxxx_xxxx;
            cycles = 0;
            while ((cycles < MAX_WAIT_CYCLES) && !reached) begin
                @(posedge clk);
                #1;
                if ((merc32_core_inst.cpu_state === ST_STEP) &&
                    (merc32_core_inst.prog_addr === instruction_pc))
                    reached = 1'b1;
                cycles = cycles + 1;
            end
            if (reached) begin
                @(posedge clk);
                #1 next_pc = merc32_core_inst.prog_addr;
            end
        end
    endtask

    task check_value;
        input [8*80-1:0] check_name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            checks = checks + 1;
            if (actual !== expected) begin
                failures = failures + 1;
                $display("TEST FAIL: %0s expected=0x%08h actual=0x%08h",
                         check_name, expected, actual);
            end
        end
    endtask

    task check_reached;
        input [8*80-1:0] check_name;
        input reached;
        begin
            checks = checks + 1;
            if (!reached) begin
                failures = failures + 1;
                $display("TEST FAIL: %0s timed out pc=0x%08h state=0x%02h",
                         check_name,
                         merc32_core_inst.prog_addr,
                         merc32_core_inst.cpu_state);
            end
        end
    endtask

    task run_immediate_compare_case;
        input [3:0] compare_function;
        input [15:0] left_immediate;
        input [15:0] right_immediate;
        reg reached;
        reg [31:0] expected;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, left_immediate);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'h5a5a);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd6, 4'd0, 16'h1234);
            program_rom[3] = enc_imm(OP_IPCU, compare_function, 4'd5, 4'd4,
                                     right_immediate);
            expected = compare_expected(compare_function,
                                        {16'd0, left_immediate},
                                        {{16{right_immediate[15]}}, right_immediate});
            wait_for_pc(32'd16, reached);
            check_reached("immediate compare retires", reached);
            if (reached) begin
                checks = checks + 1;
                if (merc32_core_inst.regi_int[5] !== expected) begin
                    failures = failures + 1;
                    $display("TEST FAIL: immediate compare cond=%0d left=0x%08h right=0x%08h expected=%0d actual=0x%08h",
                             compare_function,
                             {16'd0, left_immediate},
                             {{16{right_immediate[15]}}, right_immediate},
                             expected,
                             merc32_core_inst.regi_int[5]);
                end
                check_value("immediate compare preserves source", merc32_core_inst.regi_int[4],
                            {16'd0, left_immediate});
                check_value("immediate compare preserves unrelated register",
                            merc32_core_inst.regi_int[6], 32'h0000_1234);
            end
        end
    endtask

    task test_decode_smoke;
        output passed;
        reg passed;
        reg reached;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd5);
            program_rom[1] = enc_reg(OP_RALU, FUNC_SET, 4'd5, 4'd0, 4'd4);
            wait_for_pc(32'd8, reached);
            check_reached("opcode smoke test retires", reached);
            if (reached) begin
                check_value("opcode 0x0 decodes immediate ALU instruction",
                            merc32_core_inst.regi_int[4], 32'd5);
                check_value("opcode 0x1 decodes register ALU instruction",
                            merc32_core_inst.regi_int[5], 32'd5);
            end
            passed = reached &&
                     (merc32_core_inst.regi_int[4] === 32'd5) &&
                     (merc32_core_inst.regi_int[5] === 32'd5);
        end
    endtask

    task test_registered_instruction_decode;
        reg reached;
        integer cycles;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0,
                                     16'h1234);
            reached = 1'b0;
            cycles = 0;
            while ((cycles < MAX_WAIT_CYCLES) && !reached) begin
                @(posedge clk);
                #1;
                if (merc32_core_inst.cpu_state === ST_DECODE)
                    reached = 1'b1;
                cycles = cycles + 1;
            end
            check_reached("instruction response enters registered decode stage",
                          reached);
            if (reached) begin
                @(posedge clk);
                #1;
                check_value("decode stage advances to execute",
                            merc32_core_inst.cpu_state, ST_EXEC);
                check_value("decode stage captures source operand",
                            merc32_core_inst.operand_a, 32'd0);
                check_value("decode stage captures immediate operand",
                            merc32_core_inst.operand_b, 32'h0000_1234);
            end
        end
    endtask

    task run_register_compare_case;
        input [3:0] compare_function;
        input [15:0] left_immediate;
        input [15:0] right_immediate;
        reg reached;
        reg [31:0] expected;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, left_immediate);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, right_immediate);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd6, 4'd0, 16'h5a5a);
            program_rom[3] = enc_reg(OP_RPCU, compare_function, 4'd6, 4'd4, 4'd5);
            expected = compare_expected(compare_function,
                                        {16'd0, left_immediate},
                                        {16'd0, right_immediate});
            wait_for_pc(32'd16, reached);
            check_reached("register compare retires", reached);
            if (reached) begin
                checks = checks + 1;
                if (merc32_core_inst.regi_int[6] !== expected) begin
                    failures = failures + 1;
                    $display("TEST FAIL: register compare cond=%0d left=0x%08h right=0x%08h expected=%0d actual=0x%08h",
                             compare_function,
                             {16'd0, left_immediate},
                             {16'd0, right_immediate},
                             expected,
                             merc32_core_inst.regi_int[6]);
                end
                check_value("register compare preserves left source",
                            merc32_core_inst.regi_int[4], {16'd0, left_immediate});
                check_value("register compare preserves right source",
                            merc32_core_inst.regi_int[5], {16'd0, right_immediate});
            end
        end
    endtask

    task test_compare_matrix;
        reg [15:0] left_value;
        begin
            for (condition = 0; condition < 10; condition = condition + 1) begin
                for (relation = 0; relation < 3; relation = relation + 1) begin
                    case (relation)
                        0: left_value = 16'd5;
                        1: left_value = 16'd4;
                        default: left_value = 16'd6;
                    endcase
                    run_immediate_compare_case(condition[3:0], left_value, 16'd5);
                    run_register_compare_case(condition[3:0], left_value, 16'd5);
                end
            end
        end
    endtask

    task test_compare_boundaries;
        reg reached;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd0);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SUB, 4'd4, 4'd4, 16'h8000);
            program_rom[2] = enc_imm(OP_IPCU, CMP_EQ, 4'd5, 4'd4, 16'h8000);
            program_rom[3] = enc_imm(OP_IPCU, CMP_SGE, 4'd6, 4'd4, 16'h8000);
            wait_for_pc(32'd16, reached);
            check_reached("-32768 immediate compare retires", reached);
            if (reached) begin
                check_value("-32768 setup", merc32_core_inst.regi_int[4], 32'hffff_8000);
                check_value("-32768 immediate sign extension", merc32_core_inst.regi_int[5], 32'd1);
                check_value("$signed extends -32768 for signed relation",
                            merc32_core_inst.regi_int[6], 32'd1);
            end

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'h7fff);
            program_rom[1] = enc_imm(OP_IPCU, CMP_EQ, 4'd5, 4'd4, 16'h7fff);
            wait_for_pc(32'd8, reached);
            check_reached("32767 immediate compare retires", reached);
            if (reached)
                check_value("32767 immediate boundary", merc32_core_inst.regi_int[5], 32'd1);

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd0);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SUB, 4'd4, 4'd4, 16'd1);
            program_rom[2] = enc_imm(OP_IPCU, CMP_EQ, 4'd5, 4'd4, 16'hffff);
            program_rom[3] = enc_imm(OP_IPCU, CMP_SGE, 4'd6, 4'd4, 16'hffff);
            wait_for_pc(32'd16, reached);
            check_reached("-1 immediate compare retires", reached);
            if (reached) begin
                check_value("-1 setup", merc32_core_inst.regi_int[4], 32'hffff_ffff);
                check_value("-1 immediate sign extension", merc32_core_inst.regi_int[5], 32'd1);
                check_value("$signed extends -1 for signed relation",
                            merc32_core_inst.regi_int[6], 32'd1);
            end

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd1);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SLL, 4'd4, 4'd4, 16'd16);
            program_rom[2] = enc_imm(OP_IPCU, CMP_ULT, 4'd5, 4'd4, 16'hffff);
            wait_for_pc(32'd12, reached);
            check_reached("unsigned ffff immediate compare retires", reached);
            if (reached) begin
                check_value("unsigned comparison source", merc32_core_inst.regi_int[4],
                            32'h0001_0000);
                check_value("unsigned compare zero-extends 16'hffff",
                            merc32_core_inst.regi_int[5], 32'd0);
            end

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd0);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SUB, 4'd4, 4'd4, 16'd1);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'd1);
            program_rom[3] = enc_reg(OP_RPCU, CMP_SLT, 4'd6, 4'd4, 4'd5);
            program_rom[4] = enc_reg(OP_RPCU, CMP_UGT, 4'd7, 4'd4, 4'd5);
            wait_for_pc(32'd20, reached);
            check_reached("signed and unsigned register compares retire", reached);
            if (reached) begin
                check_value("signed -1 is less than 1", merc32_core_inst.regi_int[6], 32'd1);
                check_value("unsigned ffffffff is greater than 1",
                            merc32_core_inst.regi_int[7], 32'd1);
            end
        end
    endtask

    task test_compare_side_effects;
        reg reached;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd1, 4'd0, 16'h002a);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd2, 4'd0, 16'h1234);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd3, 4'd0, 16'h5678);
            program_rom[3] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'd9);
            program_rom[4] = enc_imm(OP_IPCU, CMP_EQ, 4'd8, 4'd7, 16'd9);
            wait_for_pc(32'd20, reached);
            check_reached("compare side-effect test retires", reached);
            if (reached) begin
                check_value("compare writes exactly one", merc32_core_inst.regi_int[8], 32'd1);
                check_value("compare preserves r1", merc32_core_inst.regi_int[1], 32'h0000_002a);
                check_value("compare preserves r2", merc32_core_inst.regi_int[2], 32'h0000_1234);
                check_value("compare preserves r3", merc32_core_inst.regi_int[3], 32'h0000_5678);
            end
        end
    endtask

    task run_immediate_branch_case;
        input [3:0] branch_function;
        input [15:0] condition_value;
        input [15:0] target_immediate;
        input [31:0] expected_next_pc;
        reg reached;
        reg [31:0] next_pc;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, condition_value);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'h7777);
            program_rom[2] = enc_imm(OP_IPCU, branch_function, 4'd4, 4'd0,
                                     target_immediate);
            capture_next_pc(32'd8, reached, next_pc);
            check_reached("immediate branch executes", reached);
            if (reached) begin
                check_value("immediate branch next PC", next_pc, expected_next_pc);
                check_value("immediate branch preserves condition register",
                            merc32_core_inst.regi_int[4], {16'd0, condition_value});
            end
        end
    endtask

    task test_immediate_branches;
        reg reached;
        reg [31:0] next_pc;
        begin
            run_immediate_branch_case(FUNC_BEZ, 16'd0, 16'h0040, 32'h0000_0040);
            run_immediate_branch_case(FUNC_BEZ, 16'd1, 16'h0040, 32'h0000_000c);
            run_immediate_branch_case(FUNC_BNZ, 16'd1, 16'h0040, 32'h0000_0040);
            run_immediate_branch_case(FUNC_BNZ, 16'd0, 16'h0040, 32'h0000_000c);
            run_immediate_branch_case(FUNC_BEZ, 16'd0, 16'h8000, 32'h0000_8000);
            run_immediate_branch_case(FUNC_BEZ, 16'd0, 16'hffff, 32'h0000_ffff);

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd0);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'h0020);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'h7777);
            program_rom[3] = enc_imm(OP_IPCU, FUNC_BEZ, 4'd4, 4'd5, 16'h0030);
            capture_next_pc(32'd12, reached, next_pc);
            check_reached("nonzero-base immediate branch executes", reached);
            if (reached)
                check_value("immediate branch uses base plus zero-extended target",
                            next_pc, 32'h0000_0050);
        end
    endtask

    task run_register_branch_case;
        input [3:0] branch_function;
        input [15:0] condition_value;
        input [15:0] base_value;
        input [15:0] offset_value;
        input [31:0] expected_next_pc;
        reg reached;
        reg [31:0] next_pc;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, condition_value);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, base_value);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd6, 4'd0, offset_value);
            program_rom[3] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'h7777);
            program_rom[4] = enc_reg(OP_RPCU, branch_function, 4'd4, 4'd5, 4'd6);
            capture_next_pc(32'd16, reached, next_pc);
            check_reached("register branch executes", reached);
            if (reached) begin
                check_value("register branch next PC", next_pc, expected_next_pc);
                check_value("register branch preserves condition register",
                            merc32_core_inst.regi_int[4], {16'd0, condition_value});
            end
        end
    endtask

    task test_register_branches;
        reg reached;
        reg [31:0] next_pc;
        begin
            run_register_branch_case(FUNC_BEZ, 16'd0, 16'h0018, 16'h0028,
                                     32'h0000_0040);
            run_register_branch_case(FUNC_BEZ, 16'd1, 16'h0018, 16'h0028,
                                     32'h0000_0014);
            run_register_branch_case(FUNC_BNZ, 16'd1, 16'h0018, 16'h0028,
                                     32'h0000_0040);
            run_register_branch_case(FUNC_BNZ, 16'd0, 16'h0018, 16'h0028,
                                     32'h0000_0014);

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd0);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'h0030);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'h7777);
            program_rom[3] = enc_reg(OP_RPCU, FUNC_BEZ, 4'd4, 4'd0, 4'd5);
            capture_next_pc(32'd12, reached, next_pc);
            check_reached("r0-based register branch executes", reached);
            if (reached)
                check_value("r0 forms direct register target", next_pc, 32'h0000_0030);
        end
    endtask

    task test_register_writes;
        reg reached;
        reg [31:0] next_pc;
        begin
            prepare_case;
            for (i = 0; i < 15; i = i + 1)
                program_rom[i] = enc_imm(OP_IALU, FUNC_SET, i[3:0], 4'd0,
                                         16'h0200 + (i * 2));
            wait_for_pc(32'd60, reached);
            check_reached("r0-r14 write test retires", reached);
            if (reached) begin
                check_value("r0 remains hardwired to zero", merc32_core_inst.regi_int[0], 32'd0);
                for (i = 1; i < 15; i = i + 1) begin
                    checks = checks + 1;
                    if (merc32_core_inst.regi_int[i] !== (32'h0000_0200 + (i * 2))) begin
                        failures = failures + 1;
                        $display("TEST FAIL: r%0d writable expected=0x%08h actual=0x%08h",
                                 i, 32'h0000_0200 + (i * 2),
                                 merc32_core_inst.regi_int[i]);
                    end
                end
            end

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd15, 4'd0, 16'h0040);
            program_rom[1] = enc_reg(OP_RALU, FUNC_SET, 4'd4, 4'd0, 4'd15);
            wait_for_step_pc(32'd0, reached);
            check_reached("write to r15 executes", reached);
            if (reached) begin
                check_value("r15 accepts software write before PC refresh",
                            merc32_core_inst.regi_int[15], 32'h0000_0040);
                @(posedge clk);
                #1 next_pc = merc32_core_inst.prog_addr;
                check_value("write to r15 does not change control flow",
                            next_pc, 32'h0000_0004);
            end
            capture_next_pc(32'h0000_0004, reached, next_pc);
            check_reached("read from r15 executes sequentially", reached);
            if (reached) begin
                check_value("read from r15 observes current PC",
                            merc32_core_inst.regi_int[4], 32'h0000_0004);
                check_value("r15 tracks current instruction PC",
                            merc32_core_inst.regi_int[15], 32'h0000_0004);
            end
        end
    endtask

    task test_shift_boundaries;
        reg reached;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd1);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SLL, 4'd6, 4'd4, 16'd32);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'd32);
            program_rom[3] = enc_reg(OP_RALU, FUNC_SLL, 4'd7, 4'd4, 4'd5);
            program_rom[4] = enc_imm(OP_IALU, FUNC_SLL, 4'd8, 4'd4, 16'd31);
            program_rom[5] = enc_reg(OP_RALU, FUNC_SRL, 4'd9, 4'd8, 4'd5);
            program_rom[6] = enc_reg(OP_RALU, FUNC_SRA, 4'd10, 4'd8, 4'd5);
            wait_for_pc(32'd28, reached);
            check_reached("large shift cases retire", reached);
            if (reached) begin
                check_value("immediate left shift by 32 returns zero",
                            merc32_core_inst.regi_int[6], 32'd0);
                check_value("register left shift by 32 returns zero",
                            merc32_core_inst.regi_int[7], 32'd0);
                check_value("register logical right shift by 32 returns zero",
                            merc32_core_inst.regi_int[9], 32'd0);
                check_value("register arithmetic right shift by 32 sign fills",
                            merc32_core_inst.regi_int[10], 32'hffff_ffff);
            end
        end
    endtask

    task test_memory_addressing;
        reg reached;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'h0080);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SLL, 4'd4, 4'd4, 16'd16);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'h1234);
            program_rom[3] = enc_imm(OP_IMCU, FUNC_SW, 4'd5, 4'd4, 16'd4);
            wait_for_pc(32'd16, reached);
            check_reached("immediate store retires", reached);
            if (reached)
                check_value("immediate store uses base plus immediate",
                            dlb_ram[1], 32'h0000_1234);

            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'h0080);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SLL, 4'd4, 4'd4, 16'd16);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'h5678);
            program_rom[3] = enc_imm(OP_IALU, FUNC_SET, 4'd6, 4'd0, 16'd4);
            program_rom[4] = enc_reg(OP_RMCU, FUNC_SW, 4'd5, 4'd4, 4'd6);
            wait_for_pc(32'd20, reached);
            check_reached("register store retires", reached);
            if (reached)
                check_value("register store uses base plus register",
                            dlb_ram[1], 32'h0000_5678);
        end
    endtask

    task test_jmp_r3;
        reg reached;
        reg [31:0] next_pc;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd1, 4'd0, 16'h002a);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd3, 4'd0, 16'h0020);
            program_rom[2] = enc_reg(OP_RPCU, FUNC_JAL, 4'd0, 4'd0, 4'd3);
            capture_next_pc(32'd8, reached, next_pc);
            check_reached("jmp r3 executes", reached);
            if (reached) begin
                check_value("jmp r3 target", next_pc, 32'h0000_0020);
                check_value("jmp r3 preserves r1", merc32_core_inst.regi_int[1], 32'h0000_002a);
                check_value("jmp r3 preserves r3", merc32_core_inst.regi_int[3], 32'h0000_0020);
            end
        end
    endtask

    task wait_for_step_pc;
        input [31:0] expected_pc;
        output reached;
        reg reached;
        integer cycles;
        begin
            reached = 1'b0;
            cycles = 0;
            while ((cycles < MAX_WAIT_CYCLES) && !reached) begin
                @(posedge clk);
                #1;
                if ((merc32_core_inst.cpu_state === ST_STEP) &&
                    (merc32_core_inst.prog_addr === expected_pc))
                    reached = 1'b1;
                cycles = cycles + 1;
            end
        end
    endtask

    task test_interrupt_after_branch;
        reg reached;
        reg [31:0] r1_before;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd1, 4'd0, 16'ha5a1);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd2, 4'd0, 16'h0040);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd4, 4'd0, 16'd0);
            program_rom[3] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'h7777);
            program_rom[4] = enc_imm(OP_IPCU, FUNC_BEZ, 4'd4, 4'd0, 16'h0020);

            wait_for_step_pc(32'd12, reached);
            check_reached("interrupt setup reaches instruction before branch", reached);
            if (reached) begin
                r1_before = merc32_core_inst.regi_int[1];
                @(negedge clk);
                interrupt <= 1'b1;
                repeat (3) @(posedge clk);
                #1 interrupt <= 1'b0;
                wait_for_pc(32'h0000_0040, reached);
                check_reached("interrupt vectors after taken branch", reached);
                if (reached) begin
                    check_value("interrupt saves resolved branch target in r3",
                                merc32_core_inst.regi_int[3], 32'h0000_0020);
                    check_value("interrupt clears only r1 enable bit",
                                merc32_core_inst.regi_int[1],
                                r1_before & 32'hffff_fffe);
                    check_value("interrupt sets PC-visible r15 to vector",
                                merc32_core_inst.regi_int[15], 32'h0000_0040);
                end
            end
        end
    endtask

    task test_interrupt_after_jump;
        reg reached;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd1, 4'd0, 16'h0001);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd2, 4'd0, 16'h0040);
            program_rom[2] = enc_imm(OP_IALU, FUNC_SET, 4'd5, 4'd0, 16'h0024);
            program_rom[3] = enc_imm(OP_IALU, FUNC_SET, 4'd7, 4'd0, 16'h7777);
            program_rom[4] = enc_reg(OP_RPCU, FUNC_JAL, 4'd6, 4'd0, 4'd5);

            wait_for_step_pc(32'd12, reached);
            check_reached("interrupt setup reaches instruction before jump", reached);
            if (reached) begin
                @(negedge clk);
                interrupt <= 1'b1;
                repeat (3) @(posedge clk);
                #1 interrupt <= 1'b0;
                wait_for_pc(32'h0000_0040, reached);
                check_reached("interrupt vectors after jump", reached);
                if (reached) begin
                    check_value("interrupt saves resolved jump target in r3",
                                merc32_core_inst.regi_int[3], 32'h0000_0024);
                    check_value("jump writes its normal link register",
                                merc32_core_inst.regi_int[6], 32'h0000_0014);
                    check_value("interrupt disables further interrupts",
                                merc32_core_inst.regi_int[1], 32'h0000_0000);
                end
            end
        end
    endtask

    task test_level_interrupt_stays_disabled;
        reg reached;
        reg nested_interrupt_seen;
        integer cycles;
        begin
            prepare_case;
            program_rom[0] = enc_imm(OP_IALU, FUNC_SET, 4'd1, 4'd0, 16'h0005);
            program_rom[1] = enc_imm(OP_IALU, FUNC_SET, 4'd2, 4'd0, 16'h0040);

            wait_for_step_pc(32'd4, reached);
            check_reached("level interrupt setup writes vector", reached);
            if (reached) begin
                @(negedge clk);
                interrupt <= 1'b1;
                wait_for_pc(32'h0000_0040, reached);
                check_reached("high-level interrupt vectors", reached);
                if (reached) begin
                    check_value("high-level interrupt clears enable only",
                                merc32_core_inst.regi_int[1], 32'h0000_0004);
                    nested_interrupt_seen = 1'b0;
                    for (cycles = 0; cycles < 12; cycles = cycles + 1) begin
                        @(posedge clk);
                        #1;
                        if (merc32_core_inst.cpu_state === ST_INTR)
                            nested_interrupt_seen = 1'b1;
                    end
                    checks = checks + 1;
                    if (nested_interrupt_seen) begin
                        failures = failures + 1;
                        $display("TEST FAIL: level interrupt retriggered while r1[0] was clear");
                    end
                end
                interrupt <= 1'b0;
            end
        end
    endtask

    initial begin
        for (i = 0; i < MEMORY_WORDS; i = i + 1)
            program_rom[i] = enc_imm(OP_IALU, FUNC_SET, 4'd0, 4'd0, 16'd0);
        for (i = 0; i < 256; i = i + 1)
            dlb_ram[i] = 32'd0;

        test_registered_instruction_decode;
        test_decode_smoke(decode_smoke_passed);
        if (decode_smoke_passed) begin
            test_compare_matrix;
            test_compare_boundaries;
            test_compare_side_effects;
            test_immediate_branches;
            test_register_branches;
            test_register_writes;
            test_shift_boundaries;
            test_memory_addressing;
            test_jmp_r3;
            test_interrupt_after_branch;
            test_interrupt_after_jump;
            test_level_interrupt_stays_disabled;
        end else begin
            $display("TEST NOTE: remaining checks skipped after opcode smoke failure");
        end

        checks = checks + 1;
        if (protocol_failed) begin
            failures = failures + 1;
            $display("TEST FAIL: local-bus request protocol checks failed");
        end

        done = 1'b1;
        if (failures == 0)
            $display("TEST PASS: merc32_core checks=%0d", checks);
        else
            $display("TEST FAIL: merc32_core failures=%0d checks=%0d", failures, checks);
        $finish;
    end

    initial #(CLK_HALF_NS * 2 * WATCHDOG_CYCLES) begin
        if (!done) begin
            $display("TEST TIMEOUT: merc32_core testbench watchdog");
            $finish;
        end
    end

    // initial begin
    //     $dumpfile("merc32_core_tb.vcd");
    //     $dumpvars(0, merc32_core_tb);
    // end

endmodule
