`timescale 1ns / 1ps

module merc32_top_tb;

    localparam  CLK_HALF_PERIOD         = 5;
    localparam  TCK_HALF_PERIOD         = 13;
    localparam  IDCODE_VALUE            = 32'h4d32_0001;

    localparam  IR_DBG_CTRL             = 5'b10000;
    localparam  IR_DBG_STATUS           = 5'b10001;
    localparam  IR_DBG_XFER             = 5'b10010;
    localparam  IR_DBG_REGS             = 5'b10011;

    localparam  XFER_NOP                = 2'b00;
    localparam  XFER_READ               = 2'b01;
    localparam  XFER_WRITE              = 2'b10;
    localparam  RESP_SUCCESS            = 2'b00;
    localparam  RESP_BUSY               = 2'b11;

    reg                                 clk = 1'b0;
    reg                                 rst_n = 1'b0;
    reg                                 tck = 1'b0;
    reg                                 tms = 1'b1;
    reg                                 tdi = 1'b0;
    wire                                tdo;
    reg                                 interrupt = 1'b0;

    wire                                dlb_rden;
    wire                                dlb_wren;
    wire    [7:0]                       dlb_addr;
    wire    [3:0]                       dlb_strb;
    wire    [31:0]                      dlb_wdata;
    reg     [31:0]                      dlb_rdata = 32'h0;
    reg                                 dlb_ack = 1'b0;

    wire                                ilb_rden;
    wire                                ilb_wren;
    wire    [7:0]                       ilb_addr;
    wire    [3:0]                       ilb_strb;
    wire    [31:0]                      ilb_wdata;
    reg     [31:0]                      ilb_rdata = 32'h0;
    reg                                 ilb_ack = 1'b0;

    wire                                m_apb_psel;
    wire                                m_apb_penable;
    wire    [31:0]                      m_apb_paddr;
    wire                                m_apb_pwrite;
    wire    [3:0]                       m_apb_pstrb;
    wire    [31:0]                      m_apb_pwdata;
    reg     [31:0]                      m_apb_prdata = 32'h0;
    reg                                 m_apb_pready = 1'b1;

    reg     [31:0]                      instruction_memory [0:255];
    reg     [31:0]                      data_memory [0:255];

    integer                             checks = 0;
    integer                             failures = 0;
    integer                             index;
    integer                             core_regi_vld_cycles = 0;
    reg                                 sampled_tdo;
    reg     [4:0]                       ir_captured;
    reg     [65:0]                      small_scan_in;
    reg     [65:0]                      small_scan_out;
    reg     [36:0]                      register_scan_in;
    reg     [36:0]                      register_scan_out;
    reg     [31:0]                      status_value;
    reg     [31:0]                      response_address;
    reg     [31:0]                      response_data;
    reg     [1:0]                       response_status;
    reg     [31:0]                      pc_before_step;
    reg     [31:0]                      pc_after_step;
    reg     [3:0]                       register_response_index;
    integer                             core_regi_vld_cycles_before;
    reg                                 protocol_failed = 1'b0;
    reg                                 ilb_request_last = 1'b0;
    reg                                 dlb_request_last = 1'b0;

    always #(CLK_HALF_PERIOD) clk = ~clk;
    always #(TCK_HALF_PERIOD) tck = ~tck;

    initial #(CLK_HALF_PERIOD * 7) rst_n = 1'b1;

    always @(posedge clk) begin
        if(!rst_n) begin
            ilb_rdata <= 32'h0;
            ilb_ack <= 1'b0;
            dlb_rdata <= 32'h0;
            dlb_ack <= 1'b0;
        end else begin
            ilb_ack <= ilb_rden | ilb_wren;
            if(ilb_wren) begin
                if(ilb_strb[0]) instruction_memory[ilb_addr][7:0] <= ilb_wdata[7:0];
                if(ilb_strb[1]) instruction_memory[ilb_addr][15:8] <= ilb_wdata[15:8];
                if(ilb_strb[2]) instruction_memory[ilb_addr][23:16] <= ilb_wdata[23:16];
                if(ilb_strb[3]) instruction_memory[ilb_addr][31:24] <= ilb_wdata[31:24];
            end
            if(ilb_rden)
                ilb_rdata <= instruction_memory[ilb_addr];
            dlb_ack <= dlb_rden | dlb_wren;
            if(dlb_wren) begin
                if(dlb_strb[0]) data_memory[dlb_addr][7:0] <= dlb_wdata[7:0];
                if(dlb_strb[1]) data_memory[dlb_addr][15:8] <= dlb_wdata[15:8];
                if(dlb_strb[2]) data_memory[dlb_addr][23:16] <= dlb_wdata[23:16];
                if(dlb_strb[3]) data_memory[dlb_addr][31:24] <= dlb_wdata[31:24];
            end
            if(dlb_rden)
                dlb_rdata <= data_memory[dlb_addr];
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            ilb_request_last <= 1'b0;
            dlb_request_last <= 1'b0;
        end else begin
            if(ilb_rden && ilb_wren) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: top-level ILB read and write requests overlap");
            end
            if(dlb_rden && dlb_wren) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: top-level DLB read and write requests overlap");
            end
            if((ilb_rden || ilb_wren) && ilb_request_last) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: top-level ILB request lasted more than one cycle");
            end
            if((dlb_rden || dlb_wren) && dlb_request_last) begin
                protocol_failed <= 1'b1;
                $display("TEST FAIL: top-level DLB request lasted more than one cycle");
            end
            ilb_request_last <= ilb_rden || ilb_wren;
            dlb_request_last <= dlb_rden || dlb_wren;
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            core_regi_vld_cycles <= 0;
        end else if(merc32_top_inst.dbg_regi_vld) begin
            core_regi_vld_cycles <= core_regi_vld_cycles + 1;
        end
    end

    MERC32_top #(
        .ILB_ADDR_WIDTH                 (8                      ),
        .DLB_ADDR_WIDTH                 (8                      ))
    merc32_top_inst (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),
        .interrupt                      (interrupt              ),

        .tck                            (tck                    ),
        .tms                            (tms                    ),
        .tdi                            (tdi                    ),
        .tdo                            (tdo                    ),

        .dlb_rden                       (dlb_rden               ),
        .dlb_wren                       (dlb_wren               ),
        .dlb_addr                       (dlb_addr               ),
        .dlb_strb                       (dlb_strb               ),
        .dlb_wdata                      (dlb_wdata              ),
        .dlb_rdata                      (dlb_rdata              ),
        .dlb_ack                        (dlb_ack                ),

        .ilb_rden                       (ilb_rden               ),
        .ilb_wren                       (ilb_wren               ),
        .ilb_addr                       (ilb_addr               ),
        .ilb_strb                       (ilb_strb               ),
        .ilb_wdata                      (ilb_wdata              ),
        .ilb_rdata                      (ilb_rdata              ),
        .ilb_ack                        (ilb_ack                ),

        .m_apb_psel                     (m_apb_psel             ),
        .m_apb_penable                  (m_apb_penable          ),
        .m_apb_paddr                    (m_apb_paddr            ),
        .m_apb_pwrite                   (m_apb_pwrite           ),
        .m_apb_pstrb                    (m_apb_pstrb            ),
        .m_apb_pwdata                   (m_apb_pwdata           ),
        .m_apb_prdata                   (m_apb_prdata           ),
        .m_apb_pready                   (m_apb_pready           ));

    task jtag_cycle;
        input   next_tms;
        input   next_tdi;
        output  sampled;
        reg     sampled;
        begin
            @(negedge tck);
            tms <= next_tms;
            tdi <= next_tdi;
            @(posedge tck);
            #1 sampled = tdo;
        end
    endtask

    task tap_reset;
        integer cycle_index;
        begin
            for(cycle_index = 0; cycle_index < 6; cycle_index = cycle_index + 1) begin
                jtag_cycle(1'b1, 1'b0, sampled_tdo);
            end
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
        end
    endtask

    task shift_ir;
        input   [4:0] value;
        output  [4:0] captured;
        reg     [4:0] captured;
        integer bit_index;
        begin
            captured = 5'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(bit_index = 0; bit_index < 5; bit_index = bit_index + 1) begin
                jtag_cycle(bit_index == 4, value[bit_index], sampled_tdo);
                captured[bit_index] = sampled_tdo;
            end
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
        end
    endtask

    task shift_dr_small;
        input   [65:0] value;
        input   integer width;
        output  [65:0] captured;
        reg     [65:0] captured;
        integer bit_index;
        begin
            captured = 66'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(bit_index = 0; bit_index < width; bit_index = bit_index + 1) begin
                jtag_cycle(bit_index == width - 1, value[bit_index], sampled_tdo);
                captured[bit_index] = sampled_tdo;
            end
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
        end
    endtask

    task shift_dr_register;
        input   [36:0] value;
        output  [36:0] captured;
        reg     [36:0] captured;
        integer bit_index;
        begin
            captured = 37'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(bit_index = 0; bit_index < 37; bit_index = bit_index + 1) begin
                jtag_cycle(bit_index == 36, value[bit_index], sampled_tdo);
                captured[bit_index] = sampled_tdo;
            end
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
        end
    endtask

    task write_control;
        input   [3:0] value;
        begin
            shift_ir(IR_DBG_CTRL, ir_captured);
            small_scan_in = 66'h0;
            small_scan_in[3:0] = value;
            shift_dr_small(small_scan_in, 4, small_scan_out);
        end
    endtask

    task read_status;
        output  [31:0] value;
        reg     [31:0] value;
        begin
            shift_ir(IR_DBG_STATUS, ir_captured);
            small_scan_in = 66'h0;
            shift_dr_small(small_scan_in, 32, small_scan_out);
            value = small_scan_out[31:0];
        end
    endtask

    task wait_status;
        input   [31:0] mask;
        input   [31:0] expected;
        output  [31:0] value;
        reg     [31:0] value;
        integer attempts;
        begin
            value = 32'hffff_ffff;
            attempts = 0;
            while(((value & mask) != expected) && (attempts < 16)) begin
                read_status(value);
                attempts = attempts + 1;
            end
        end
    endtask

    task debug_xfer;
        input   [31:0] address;
        input   [31:0] data;
        input   [1:0] operation;
        output  [31:0] captured_address;
        output  [31:0] captured_data;
        output  [1:0] captured_status;
        reg     [31:0] captured_address;
        reg     [31:0] captured_data;
        reg     [1:0] captured_status;
        begin
            shift_ir(IR_DBG_XFER, ir_captured);
            small_scan_in = {address, data, operation};
            shift_dr_small(small_scan_in, 66, small_scan_out);
            captured_address = small_scan_out[65:34];
            captured_data = small_scan_out[33:2];
            captured_status = small_scan_out[1:0];
        end
    endtask

    task poll_xfer;
        output  [31:0] captured_address;
        output  [31:0] captured_data;
        output  [1:0] captured_status;
        reg     [31:0] captured_address;
        reg     [31:0] captured_data;
        reg     [1:0] captured_status;
        integer attempts;
        begin
            captured_status = RESP_BUSY;
            attempts = 0;
            while((captured_status == RESP_BUSY) && (attempts < 16)) begin
                small_scan_in = 66'h0;
                shift_dr_small(small_scan_in, 66, small_scan_out);
                captured_address = small_scan_out[65:34];
                captured_data = small_scan_out[33:2];
                captured_status = small_scan_out[1:0];
                attempts = attempts + 1;
            end
        end
    endtask

    task request_register;
        input   [3:0] index;
        output  [3:0] response_index;
        output  [31:0] value;
        reg     [3:0] response_index;
        reg     [31:0] value;
        begin
            shift_ir(IR_DBG_REGS, ir_captured);
            register_scan_in = 37'h0;
            register_scan_in[4:1] = index;
            register_scan_in[0] = 1'b1;
            shift_dr_register(register_scan_in, register_scan_out);
            wait_status(32'h0000_0060, 32'h0000_0040, status_value);
            shift_ir(IR_DBG_REGS, ir_captured);
            register_scan_in = 37'h0;
            shift_dr_register(register_scan_in, register_scan_out);
            response_index = register_scan_out[4:1];
            value = register_scan_out[36:5];
        end
    endtask

    task check_value;
        input   [255:0] name;
        input   [31:0] actual;
        input   [31:0] expected;
        begin
            checks = checks + 1;
            if(actual !== expected) begin
                failures = failures + 1;
                $display("TEST FAIL: %0s expected=0x%08h actual=0x%08h",
                         name, expected, actual);
            end
        end
    endtask

    initial begin
        // $dumpfile("MERC32_top_tb.vcd");
        // $dumpvars(0, merc32_top_tb);

        for(index = 0; index < 256; index = index + 1) begin
            instruction_memory[index] = 32'h0;
            data_memory[index] = 32'h0;
        end

        @(posedge rst_n);
        tap_reset;

        small_scan_in = 66'h0;
        shift_dr_small(small_scan_in, 32, small_scan_out);
        check_value("top exposes IDCODE", small_scan_out[31:0], IDCODE_VALUE);

        write_control(4'b0001);
        wait_status(32'h0000_0001, 32'h0000_0001, status_value);
        check_value("real core halts", {31'h0, status_value[0]}, 32'h1);

        core_regi_vld_cycles_before = core_regi_vld_cycles;
        request_register(4'h0, register_response_index, response_data);
        check_value("real core indexed read keeps r0 zero", response_data, 32'h0);
        check_value("real core indexed read returns r0 index",
                    {28'h0, register_response_index}, 32'h0);
        check_value("one indexed read emits one valid word",
                    core_regi_vld_cycles, core_regi_vld_cycles_before + 1);
        request_register(4'hf, register_response_index, pc_before_step);
        check_value("real core indexed read returns r15 index",
                    {28'h0, register_response_index}, 32'hf);

        write_control(4'b0101);
        wait_status(32'h0000_0080, 32'h0000_0000, status_value);
        check_value("real core single-step completes", {31'h0, status_value[7]}, 32'h0);
        request_register(4'hf, register_response_index, pc_after_step);
        check_value("single-step advances PC by four", pc_after_step,
                    pc_before_step + 4);

        write_control(4'b0100);
        wait_status(32'h0000_0081, 32'h0000_0000, status_value);
        check_value("real core resumes", {31'h0, status_value[0]}, 32'h0);
        repeat(40) @(posedge clk);

        write_control(4'b0001);
        wait_status(32'h0000_0001, 32'h0000_0001, status_value);
        check_value("real core halts again", {31'h0, status_value[0]}, 32'h1);

        debug_xfer(32'h0000_0100, 32'hcafe_1234, XFER_WRITE,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("instruction write succeeds", {30'h0, response_status},
                    {30'h0, RESP_SUCCESS});
        debug_xfer(32'h0000_0100, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("instruction read returns write", response_data, 32'hcafe_1234);

        debug_xfer(32'h0800_0000, 32'h55aa_a55a, XFER_WRITE,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("data write succeeds", {30'h0, response_status},
                    {30'h0, RESP_SUCCESS});
        debug_xfer(32'h0800_0000, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("data read returns write", response_data, 32'h55aa_a55a);
        check_value("local-bus requests are single-cycle and mutually exclusive",
                    {31'h0, protocol_failed}, 32'h0);

        if(failures == 0) begin
            $display("TEST PASS: MERC32_top JTAG checks=%0d", checks);
        end else begin
            $display("TEST FAIL: MERC32_top JTAG failures=%0d checks=%0d",
                     failures, checks);
        end
        $finish;
    end

    initial #(TCK_HALF_PERIOD * 2 * 30000) begin
        $display("TEST TIMEOUT: MERC32_top JTAG checks=%0d failures=%0d",
                 checks, failures);
        $finish;
    end

endmodule
