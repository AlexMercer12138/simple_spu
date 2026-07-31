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

    wire                                dlb_en;
    wire                                dlb_we;
    wire    [7:0]                       dlb_addr;
    wire    [31:0]                      dlb_wdata;
    wire    [31:0]                      dlb_rdata;

    wire                                ilb_en;
    wire                                ilb_we;
    wire    [7:0]                       ilb_addr;
    wire    [31:0]                      ilb_wdata;
    wire    [31:0]                      ilb_rdata;

    wire                                m_apb_psel;
    wire                                m_apb_penable;
    wire    [31:0]                      m_apb_paddr;
    wire                                m_apb_pwrite;
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
    reg     [511:0]                     register_scan_in;
    reg     [511:0]                     register_scan_out;
    reg     [31:0]                      status_value;
    reg     [31:0]                      response_address;
    reg     [31:0]                      response_data;
    reg     [1:0]                       response_status;
    reg     [31:0]                      pc_before_step;
    reg     [31:0]                      pc_after_step;

    assign  ilb_rdata = instruction_memory[ilb_addr];
    assign  dlb_rdata = data_memory[dlb_addr];

    always #(CLK_HALF_PERIOD) clk = ~clk;
    always #(TCK_HALF_PERIOD) tck = ~tck;

    initial #(CLK_HALF_PERIOD * 7) rst_n = 1'b1;

    always @(posedge clk) begin
        if(ilb_en && ilb_we) begin
            instruction_memory[ilb_addr] <= ilb_wdata;
        end
        if(dlb_en && dlb_we) begin
            data_memory[dlb_addr] <= dlb_wdata;
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

        .dlb_en                         (dlb_en                 ),
        .dlb_we                         (dlb_we                 ),
        .dlb_addr                       (dlb_addr               ),
        .dlb_wdata                      (dlb_wdata              ),
        .dlb_rdata                      (dlb_rdata              ),

        .ilb_en                         (ilb_en                 ),
        .ilb_we                         (ilb_we                 ),
        .ilb_addr                       (ilb_addr               ),
        .ilb_wdata                      (ilb_wdata              ),
        .ilb_rdata                      (ilb_rdata              ),

        .m_apb_psel                     (m_apb_psel             ),
        .m_apb_penable                  (m_apb_penable          ),
        .m_apb_paddr                    (m_apb_paddr            ),
        .m_apb_pwrite                   (m_apb_pwrite           ),
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

    task shift_dr_registers;
        input   [511:0] value;
        output  [511:0] captured;
        reg     [511:0] captured;
        integer bit_index;
        begin
            captured = 512'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(bit_index = 0; bit_index < 512; bit_index = bit_index + 1) begin
                jtag_cycle(bit_index == 511, value[bit_index], sampled_tdo);
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

    task request_snapshot;
        begin
            write_control(4'b1001);
            wait_status(32'h0000_0060, 32'h0000_0040, status_value);
            shift_ir(IR_DBG_REGS, ir_captured);
            register_scan_in = 512'h0;
            shift_dr_registers(register_scan_in, register_scan_out);
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

        request_snapshot;
        check_value("real core snapshot keeps r0 zero", register_scan_out[31:0], 32'h0);
        check_value("core snapshot emits exactly 16 valid words",
                    core_regi_vld_cycles, 32'd16);
        pc_before_step = register_scan_out[511:480];

        write_control(4'b0101);
        wait_status(32'h0000_0080, 32'h0000_0000, status_value);
        check_value("real core single-step completes", {31'h0, status_value[7]}, 32'h0);
        request_snapshot;
        pc_after_step = register_scan_out[511:480];
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

        debug_xfer(32'h0080_0000, 32'h55aa_a55a, XFER_WRITE,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("data write succeeds", {30'h0, response_status},
                    {30'h0, RESP_SUCCESS});
        debug_xfer(32'h0080_0000, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("data read returns write", response_data, 32'h55aa_a55a);

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
