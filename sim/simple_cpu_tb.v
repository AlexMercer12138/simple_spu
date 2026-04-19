`timescale 1ns / 1ps
//////////////////////////////////////////////////////////////////////////////////
// Company: 
// Engineer: 
// 
// Create Date: 2026/04/18 18:30:12
// Design Name: 
// Module Name: simple_cpu_tb
// Project Name: 
// Target Devices: 
// Tool Versions: 
// Description: Simple CPU Testbench with instruction trace
// 
// Dependencies: 
// 
// Revision:
// Revision 0.01 - File Created
// Additional Comments:
// 
//////////////////////////////////////////////////////////////////////////////////


module simple_cpu_tb();

    localparam  OP_IMMEDIATE            = 4'b0001;
    localparam  OP_REGISTER             = 4'b0010;

    localparam  FUNC_SET                = 4'b0000;
    localparam  FUNC_ADD                = 4'b0001;
    localparam  FUNC_SUB                = 4'b0010;
    localparam  FUNC_AND                = 4'b0011;
    localparam  FUNC_OR                 = 4'b0100;
    localparam  FUNC_XOR                = 4'b0101;
    localparam  FUNC_SLL                = 4'b0110;
    localparam  FUNC_SRL                = 4'b0111;
    localparam  FUNC_SRA                = 4'b1000;
    localparam  FUNC_MWR                = 4'b1001;
    localparam  FUNC_MRD                = 4'b1010;
    localparam  FUNC_JAL                = 4'b1011;
    localparam  FUNC_BEQ                = 4'b1100;
    localparam  FUNC_BNE                = 4'b1101;
    localparam  FUNC_BLT                = 4'b1110;
    localparam  FUNC_BGE                = 4'b1111;

    reg clk = 0, rst_n = 0;

    // Clock generation: 50MHz (period = 20ns)
    initial begin
        forever begin
            #10 clk = ~clk;
        end
    end

    // Reset generation
    initial begin
        #2000 rst_n = 1;
    end

    // Signals for CPU connection
    wire [7:0]  prog_addr;
    wire [31:0] prog_data;

    // Monitor data at address 0x00
    wire [31:0] monitor;
    
    // AXI4-Lite interface signals (CPU master -> Slave)
    wire        m_axi_awvalid;
    wire        m_axi_awready;
    wire [31:0] m_axi_awaddr;
    wire        m_axi_wvalid;
    wire        m_axi_wready;
    wire [31:0] m_axi_wdata;
    wire [3:0]  m_axi_wstrb;
    wire        m_axi_bvalid;
    wire        m_axi_bready;
    wire [1:0]  m_axi_bresp;
    wire        m_axi_arvalid;
    wire        m_axi_arready;
    wire [31:0] m_axi_araddr;
    wire        m_axi_rvalid;
    wire        m_axi_rready;
    wire [1:0]  m_axi_rresp;
    wire [31:0] m_axi_rdata;

    // Funct to ASCII string function (returns mnemonic with suffix)
    function [47:0] Opcode_ascii(
        input [3:0] opcode,
        input [3:0] funct
    );
        case (funct)
            FUNC_SET: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "SETI" : "SETR";
            FUNC_ADD: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "ADDI" : "ADDR";
            FUNC_SUB: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "SUBI" : "SUBR";
            FUNC_AND: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "ANDI" : "ANDR";
            FUNC_OR:  Opcode_ascii = (opcode == OP_IMMEDIATE) ? "ORI " : "ORR ";
            FUNC_XOR: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "XORI" : "XORR";
            FUNC_SLL: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "SLLI" : "SLLR";
            FUNC_SRL: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "SRLI" : "SRLR";
            FUNC_SRA: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "SRAI" : "SRAR";
            FUNC_MWR: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "MWRI" : "MWRR";
            FUNC_MRD: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "MRDI" : "MRDR";
            FUNC_JAL: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "JALI" : "JALR";
            FUNC_BEQ: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "BEQI" : "BEQR";
            FUNC_BNE: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "BNEI" : "BNER";
            FUNC_BLT: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "BLTI" : "BLTR";
            FUNC_BGE: Opcode_ascii = (opcode == OP_IMMEDIATE) ? "BGEI" : "BGER";
            default:  Opcode_ascii = "????";
        endcase
    endfunction

    // Instruction trace: print formatted instruction when prog_step is enabled
    // New instruction format:
    // [31:16] immediate/src_1, [15:12] src_2, [11:8] dest, [7:4] opcode, [3:0] funct
    always @(posedge clk) begin
        if (cpu_inst.prog_step) begin
            case (prog_data[7:4])  // Check opcode
                OP_IMMEDIATE: begin  // I-Type: uses immediate [31:16]
                    case (prog_data[3:0])  // Check funct
                        // Data Transfer: SETI - R[dest] = immediate
                        FUNC_SET: begin
                            $display("[%0d] : %s R%0d, #%0d", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[11:8], $signed(prog_data[31:16]));
                        end
                        
                        // Arithmetic & Logic: ADDI, SUBI, ANDI, ORI, XORI
                        // R[dest] = R[src_2] op immediate
                        FUNC_ADD, FUNC_SUB, FUNC_AND, FUNC_OR, FUNC_XOR: begin
                            $display("[%0d] : %s R%0d, R%0d, #%0d", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[15:12], $signed(prog_data[31:16]));
                        end
                        
                        // Shift: SLLI, SRLI, SRAI
                        // R[dest] = R[src_2] op immediate
                        FUNC_SLL, FUNC_SRL, FUNC_SRA: begin
                            $display("[%0d] : %s R%0d, R%0d, #%0d", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[15:12], prog_data[31:16]);
                        end
                        
                        // Memory Write: MWRI - Mem[R[src_2] + immediate] = R[dest]
                        FUNC_MWR: begin
                            $display("[%0d] : %s [R%0d + #%0d], R%0d", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[15:12], $signed(prog_data[31:16]), prog_data[11:8]);
                        end
                        
                        // Memory Read: MRDI - R[dest] = Mem[R[src_2] + immediate]
                        FUNC_MRD: begin
                            $display("[%0d] : %s R%0d, [R%0d + #%0d]", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[15:12], $signed(prog_data[31:16]));
                        end
                        
                        // Jump: JALI - R[dest] = PC + 1; PC = immediate
                        FUNC_JAL: begin
                            $display("[%0d] : %s #%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[31:16], prog_data[11:8]);
                        end
                        
                        // Branch: BEQI, BNEI, BLTI, BGEI
                        // PC = (R[src_2] op R[dest]) ? immediate : PC + 1
                        FUNC_BEQ, FUNC_BNE, FUNC_BLT, FUNC_BGE: begin
                            $display("[%0d] : %s #%0d, R%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_IMMEDIATE, prog_data[3:0]), 
                                     prog_data[31:16], prog_data[15:12], prog_data[11:8]);
                        end
                        
                        default: begin
                            $display("[%0d] : UNKNOWN FUNCT (0x%08X)", prog_addr, prog_data);
                        end
                    endcase
                end
                
                OP_REGISTER: begin  // R-Type: uses src_1 [19:16]
                    case (prog_data[3:0])  // Check funct
                        // Data Transfer: SETR - R[dest] = R[src_1]
                        FUNC_SET: begin
                            $display("[%0d] : %s R%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[19:16]);
                        end
                        
                        // Arithmetic & Logic: ADDR, SUBR, ANDR, ORR, XORR
                        // R[dest] = R[src_2] op R[src_1]
                        FUNC_ADD, FUNC_SUB, FUNC_AND, FUNC_OR, FUNC_XOR: begin
                            $display("[%0d] : %s R%0d, R%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[15:12], prog_data[19:16]);
                        end
                        
                        // Shift: SLLR, SRLR, SRAR
                        // R[dest] = R[src_2] op R[src_1]
                        FUNC_SLL, FUNC_SRL, FUNC_SRA: begin
                            $display("[%0d] : %s R%0d, R%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[15:12], prog_data[19:16]);
                        end
                        
                        // Memory Write: MWRR - Mem[R[src_2] + R[src_1]] = R[dest]
                        FUNC_MWR: begin
                            $display("[%0d] : %s [R%0d + R%0d], R%0d", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[15:12], prog_data[19:16], prog_data[11:8]);
                        end
                        
                        // Memory Read: MRDR - R[dest] = Mem[R[src_2] + R[src_1]]
                        FUNC_MRD: begin
                            $display("[%0d] : %s R%0d, [R%0d + R%0d]", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[11:8], prog_data[15:12], prog_data[19:16]);
                        end
                        
                        // Jump: JALR - R[dest] = PC + 1; PC = R[src_1]
                        FUNC_JAL: begin
                            $display("[%0d] : %s R%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[19:16], prog_data[11:8]);
                        end
                        
                        // Branch: BEQR, BNER, BLTR, BGER
                        // PC = (R[src_2] op R[dest]) ? R[src_1] : PC + 1
                        FUNC_BEQ, FUNC_BNE, FUNC_BLT, FUNC_BGE: begin
                            $display("[%0d] : %s R%0d, R%0d, R%0d", 
                                     prog_addr, Opcode_ascii(OP_REGISTER, prog_data[3:0]), 
                                     prog_data[19:16], prog_data[15:12], prog_data[11:8]);
                        end
                        
                        default: begin
                            $display("[%0d] : UNKNOWN FUNCT (0x%08X)", prog_addr, prog_data);
                        end
                    endcase
                end
                
                default: begin
                    $display("[%0d] : UNKNOWN OPCODE (0x%08X)", prog_addr, prog_data);
                end
            endcase
        end
    end

    // Instantiate Simple CPU
    simple_cpu cpu_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        
        // Program memory interface
        .prog_addr      (prog_addr),
        .prog_data      (prog_data),
        
        // AXI4-Lite Master Interface (Write Address)
        .m_axi_awvalid  (m_axi_awvalid),
        .m_axi_awready  (m_axi_awready),
        .m_axi_awaddr   (m_axi_awaddr),
        
        // AXI4-Lite Master Interface (Write Data)
        .m_axi_wvalid   (m_axi_wvalid),
        .m_axi_wready   (m_axi_wready),
        .m_axi_wdata    (m_axi_wdata),
        .m_axi_wstrb    (m_axi_wstrb),
        
        // AXI4-Lite Master Interface (Write Response)
        .m_axi_bvalid   (m_axi_bvalid),
        .m_axi_bready   (m_axi_bready),
        .m_axi_bresp    (m_axi_bresp),
        
        // AXI4-Lite Master Interface (Read Address)
        .m_axi_arvalid  (m_axi_arvalid),
        .m_axi_arready  (m_axi_arready),
        .m_axi_araddr   (m_axi_araddr),
        
        // AXI4-Lite Master Interface (Read Data)
        .m_axi_rvalid   (m_axi_rvalid),
        .m_axi_rready   (m_axi_rready),
        .m_axi_rresp    (m_axi_rresp),
        .m_axi_rdata    (m_axi_rdata)
    );

    // Instantiate Program Memory (ROM)
    hello_world rom_inst (
        .prog_addr      (prog_addr),
        .prog_data      (prog_data)
    );

    // Instantiate AXI4-Lite Slave (for data memory)
    s_axi_lite #(
        .AXI_DATA_WIDTH (32),
        .AXI_ADDR_WIDTH (6)
    ) s_axi_inst (
        .S_AXI_ACLK     (clk),
        .S_AXI_ARESETN  (rst_n),

        .monitor        (monitor),
        
        // Write Address Channel
        .S_AXI_AWADDR   (m_axi_awaddr[5:0]),
        .S_AXI_AWPROT   (3'b000),
        .S_AXI_AWVALID  (m_axi_awvalid),
        .S_AXI_AWREADY  (m_axi_awready),
        
        // Write Data Channel
        .S_AXI_WDATA    (m_axi_wdata),
        .S_AXI_WSTRB    (m_axi_wstrb),
        .S_AXI_WVALID   (m_axi_wvalid),
        .S_AXI_WREADY   (m_axi_wready),
        
        // Write Response Channel
        .S_AXI_BRESP    (m_axi_bresp),
        .S_AXI_BVALID   (m_axi_bvalid),
        .S_AXI_BREADY   (m_axi_bready),
        
        // Read Address Channel
        .S_AXI_ARADDR   (m_axi_araddr[5:0]),
        .S_AXI_ARPROT   (3'b000),
        .S_AXI_ARVALID  (m_axi_arvalid),
        .S_AXI_ARREADY  (m_axi_arready),
        
        // Read Data Channel
        .S_AXI_RDATA    (m_axi_rdata),
        .S_AXI_RRESP    (m_axi_rresp),
        .S_AXI_RVALID   (m_axi_rvalid),
        .S_AXI_RREADY   (m_axi_rready)
    );

endmodule
