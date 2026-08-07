`timescale 1ns / 1ps

module jtag_debug_tb;

    localparam  CLK_HALF_PERIOD         = 5;
    localparam  TCK_HALF_PERIOD         = 17;
    localparam  IDCODE_VALUE            = 32'h4d32_0001;
    localparam  IR_DBG_CTRL             = 5'b10000;
    localparam  IR_DBG_STATUS           = 5'b10001;
    localparam  IR_DBG_XFER             = 5'b10010;
    localparam  IR_DBG_REGS             = 5'b10011;
    localparam  IR_BYPASS               = 5'b11111;

    localparam  XFER_NOP                = 2'b00;
    localparam  XFER_READ               = 2'b01;
    localparam  XFER_WRITE              = 2'b10;
    localparam  XFER_INVALID            = 2'b11;

    localparam  RESP_SUCCESS            = 2'b00;
    localparam  RESP_FAILED             = 2'b10;
    localparam  RESP_BUSY               = 2'b11;

    reg                                 clk = 1'b0;
    reg                                 rst_n = 1'b0;
    reg                                 tck = 1'b0;
    reg                                 tms = 1'b1;
    reg                                 tdi = 1'b0;
    wire                                tdo;

    wire                                dbg_rst_req;
    wire                                dbg_halt_req;
    wire                                dbg_step_req;
    wire                                dbg_regi_req;
    reg                                 dbg_regi_vld = 1'b0;
    reg     [31:0]                      dbg_regi_data = 32'h0;
    reg                                 dbg_halted = 1'b0;

    wire                                dbg_rden;
    wire                                dbg_wren;
    wire    [31:0]                      dbg_addr;
    wire    [31:0]                      dbg_wdata;
    reg     [31:0]                      dbg_rdata = 32'h0;
    reg                                 dbg_ack = 1'b0;

    integer                             checks = 0;
    integer                             failures = 0;
    integer                             step_pulses = 0;
    integer                             step_pulses_before;
    integer                             memory_delay = 0;
    integer                             memory_count = 0;
    integer                             memory_accesses = 0;
    integer                             memory_accesses_before;
    integer                             dbg_request_pulses = 0;
    integer                             dbg_request_pulses_before;
    integer                             dbg_request_width_failures = 0;
    integer                             snapshot_delay = 0;
    integer                             snapshot_delay_count = 0;
    integer                             snapshot_index = 0;
    integer                             snapshot_requests = 0;
    integer                             snapshot_requests_before;
    reg                                 sampled_tdo;
    reg     [511:0]                     scan_in;
    reg     [511:0]                     scan_out;
    reg     [65:0]                      small_scan_in;
    reg     [65:0]                      small_scan_out;
    reg     [4:0]                       ir_captured;
    reg     [31:0]                      status_value;
    reg                                 model_halt_command = 1'b0;
    reg                                 model_allow_rehalt = 1'b0;
    reg                                 model_rehalt_pending = 1'b0;
    reg                                 tck_enable = 1'b0;
    reg                                 memory_hold_response = 1'b0;
    reg                                 memory_pending = 1'b0;
    reg                                 memory_request_seen = 1'b0;
    reg                                 memory_write_hold = 1'b0;
    reg                                 dbg_request_d = 1'b0;
    reg     [31:0]                      memory_addr_hold = 32'h0;
    reg     [31:0]                      memory_data_hold = 32'h0;
    reg     [31:0]                      debug_memory [0:15];
    reg     [31:0]                      response_address;
    reg     [31:0]                      response_data;
    reg     [1:0]                       response_status;
    reg                                 snapshot_streaming = 1'b0;
    reg                                 snapshot_hold_stream = 1'b0;
    reg     [31:0]                      snapshot_base = 32'h1000_0000;

    always #(CLK_HALF_PERIOD) clk = ~clk;
    always #(TCK_HALF_PERIOD) begin
        if(tck_enable) begin
            tck = ~tck;
        end
    end

    initial #(CLK_HALF_PERIOD * 7) rst_n = 1'b1;

    always @(posedge clk) begin
        if(!rst_n) begin
            dbg_request_d <= 1'b0;
            dbg_request_pulses <= 0;
            dbg_request_width_failures <= 0;
        end else begin
            dbg_request_d <= dbg_rden | dbg_wren;
            if ((dbg_rden | dbg_wren) && !dbg_request_d)
                dbg_request_pulses <= dbg_request_pulses + 1;
            if ((dbg_rden | dbg_wren) && dbg_request_d) begin
                dbg_request_width_failures <= dbg_request_width_failures + 1;
                $display("TEST FAIL: debug request wider than one clk cycle");
            end
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            dbg_halted <= 1'b0;
            step_pulses <= 0;
            model_rehalt_pending <= 1'b0;
        end else if(dbg_step_req) begin
            dbg_halted <= 1'b0;
            step_pulses <= step_pulses + 1;
            model_rehalt_pending <= dbg_halt_req;
        end else if(model_rehalt_pending && model_allow_rehalt) begin
            dbg_halted <= 1'b1;
            model_rehalt_pending <= 1'b0;
        end else if(model_halt_command && !model_rehalt_pending) begin
            dbg_halted <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            dbg_regi_vld <= 1'b0;
            dbg_regi_data <= 32'h0;
            snapshot_streaming <= 1'b0;
            snapshot_delay_count <= 0;
            snapshot_index <= 0;
            snapshot_requests <= 0;
        end else if(dbg_regi_req) begin
            dbg_regi_vld <= 1'b0;
            snapshot_streaming <= 1'b1;
            snapshot_delay_count <= snapshot_delay;
            snapshot_index <= 0;
            snapshot_requests <= snapshot_requests + 1;
        end else if(snapshot_streaming && snapshot_hold_stream) begin
            dbg_regi_vld <= 1'b0;
        end else if(snapshot_streaming && (snapshot_delay_count > 0)) begin
            dbg_regi_vld <= 1'b0;
            snapshot_delay_count <= snapshot_delay_count - 1;
        end else if(snapshot_streaming) begin
            dbg_regi_vld <= 1'b1;
            dbg_regi_data <= snapshot_base + snapshot_index;
            if(snapshot_index == 15) begin
                snapshot_streaming <= 1'b0;
                snapshot_index <= 0;
            end else begin
                snapshot_index <= snapshot_index + 1;
            end
        end else begin
            dbg_regi_vld <= 1'b0;
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            dbg_rdata <= 32'h0;
            dbg_ack <= 1'b0;
            memory_pending <= 1'b0;
            memory_request_seen <= 1'b0;
            memory_write_hold <= 1'b0;
            memory_addr_hold <= 32'h0;
            memory_data_hold <= 32'h0;
            memory_count <= 0;
            memory_accesses <= 0;
        end else begin
            dbg_ack <= 1'b0;
            if(!dbg_rden && !dbg_wren) begin
                memory_request_seen <= 1'b0;
            end

            if(!memory_pending && !memory_request_seen && (dbg_rden || dbg_wren)) begin
                memory_pending <= 1'b1;
                memory_request_seen <= 1'b1;
                memory_write_hold <= dbg_wren;
                memory_addr_hold <= dbg_addr;
                memory_data_hold <= dbg_wdata;
                memory_count <= memory_delay;
            end else if(memory_pending && memory_hold_response) begin
                memory_count <= memory_count;
            end else if(memory_pending && (memory_count > 0)) begin
                memory_count <= memory_count - 1;
            end else if(memory_pending) begin
                memory_pending <= 1'b0;
                memory_accesses <= memory_accesses + 1;
                dbg_ack <= 1'b1;
                if(memory_write_hold) begin
                    debug_memory[memory_addr_hold[9:2]] <= memory_data_hold;
                end else begin
                    dbg_rdata <= debug_memory[memory_addr_hold[9:2]];
                end
            end
        end
    end

    jtag_debug #(
        .IDCODE_VALUE                   (IDCODE_VALUE           ))
    jtag_debug_inst (
        .clk                            (clk                    ),
        .rst_n                          (rst_n                  ),

        .tck                            (tck                    ),
        .tms                            (tms                    ),
        .tdi                            (tdi                    ),
        .tdo                            (tdo                    ),

        .dbg_rst_req                    (dbg_rst_req            ),
        .dbg_halt_req                   (dbg_halt_req           ),
        .dbg_step_req                   (dbg_step_req           ),
        .dbg_regi_req                   (dbg_regi_req           ),
        .dbg_regi_vld                   (dbg_regi_vld           ),
        .dbg_regi_data                  (dbg_regi_data          ),
        .dbg_halted                     (dbg_halted             ),

        .dbg_rden                       (dbg_rden               ),
        .dbg_wren                       (dbg_wren               ),
        .dbg_addr                       (dbg_addr               ),
        .dbg_wdata                      (dbg_wdata              ),
        .dbg_rdata                      (dbg_rdata              ),
        .dbg_ack                        (dbg_ack                ));

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
        integer index;
        begin
            captured = 5'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(index = 0; index < 5; index = index + 1) begin
                jtag_cycle(index == 4, value[index], sampled_tdo);
                captured[index] = sampled_tdo;
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
        integer index;
        begin
            captured = 66'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(index = 0; index < width; index = index + 1) begin
                jtag_cycle(index == width - 1, value[index], sampled_tdo);
                captured[index] = sampled_tdo;
            end
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
        end
    endtask

    task shift_dr_regs;
        input   [511:0] value;
        output  [511:0] captured;
        reg     [511:0] captured;
        integer index;
        begin
            captured = 512'h0;
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
            for(index = 0; index < 512; index = index + 1) begin
                jtag_cycle(index == 511, value[index], sampled_tdo);
                captured[index] = sampled_tdo;
            end
            jtag_cycle(1'b1, 1'b0, sampled_tdo);
            jtag_cycle(1'b0, 1'b0, sampled_tdo);
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
        integer poll_count;
        begin
            captured_status = RESP_BUSY;
            poll_count = 0;
            while((captured_status == RESP_BUSY) && (poll_count < 16)) begin
                small_scan_in = 66'h0;
                shift_dr_small(small_scan_in, 66, small_scan_out);
                captured_address = small_scan_out[65:34];
                captured_data = small_scan_out[33:2];
                captured_status = small_scan_out[1:0];
                poll_count = poll_count + 1;
            end
        end
    endtask

    task read_registers;
        output  [511:0] value;
        reg     [511:0] value;
        begin
            shift_ir(IR_DBG_REGS, ir_captured);
            scan_in = 512'h0;
            shift_dr_regs(scan_in, value);
        end
    endtask

    initial begin
        // $dumpfile("jtag_debug_tb.vcd");
        // $dumpvars(0, jtag_debug_tb);

        @(posedge rst_n);
        repeat(6) @(posedge clk);
        check_value("debug outputs stay inactive without TCK",
                    {26'h0, dbg_regi_req, dbg_step_req, dbg_wren,
                     dbg_rden, dbg_rst_req, dbg_halt_req}, 32'h0);
        tck_enable = 1'b1;
        tap_reset;

        small_scan_in = 66'h0;
        shift_dr_small(small_scan_in, 32, small_scan_out);
        check_value("reset selects IDCODE", small_scan_out[31:0], IDCODE_VALUE);

        shift_ir(IR_BYPASS, ir_captured);
        small_scan_in = 66'h0;
        small_scan_in[1:0] = 2'b01;
        shift_dr_small(small_scan_in, 2, small_scan_out);
        check_value("BYPASS is a one-bit delay", {30'h0, small_scan_out[1:0]}, 32'h2);

        read_status(status_value);
        check_value("TMS reset initializes TCK-domain status",
                    status_value & 32'h0000_00ff, 32'h0);

        write_control(4'b0001);
        repeat(6) @(posedge clk);
        check_value("halt level crosses to CPU", {31'h0, dbg_halt_req}, 32'h1);
        read_status(status_value);
        check_value("status echoes halt level", {31'h0, status_value[1]}, 32'h1);

        write_control(4'b0011);
        repeat(6) @(posedge clk);
        check_value("reset level asserts", {31'h0, dbg_rst_req}, 32'h1);
        check_value("reset preserves halt", {31'h0, dbg_halt_req}, 32'h1);
        write_control(4'b0001);
        repeat(6) @(posedge clk);
        check_value("reset level deasserts", {31'h0, dbg_rst_req}, 32'h0);

        @(negedge clk);
        model_halt_command <= 1'b1;
        model_allow_rehalt <= 1'b0;
        repeat(3) @(posedge clk);
        step_pulses_before = step_pulses;
        write_control(4'b0101);
        repeat(20) @(posedge clk);
        check_value("single-step emits one pulse", step_pulses,
                    step_pulses_before + 1);
        write_control(4'b0101);
        repeat(20) @(posedge clk);
        check_value("busy execute ignores second request", step_pulses,
                    step_pulses_before + 1);
        read_status(status_value);
        check_value("single-step remains busy before rehalt",
                    {31'h0, status_value[7]}, 32'h1);
        @(negedge clk);
        model_allow_rehalt <= 1'b1;
        repeat(4) @(posedge clk);
        read_status(status_value);
        check_value("single-step busy clears after rehalt",
                    {31'h0, status_value[7]}, 32'h0);
        check_value("single-step returns to halt",
                    {31'h0, status_value[0]}, 32'h1);

        @(negedge clk);
        model_halt_command <= 1'b0;
        step_pulses_before = step_pulses;
        write_control(4'b0100);
        repeat(20) @(posedge clk);
        read_status(status_value);
        check_value("resume emits one pulse", step_pulses,
                    step_pulses_before + 1);
        check_value("resume clears execute busy",
                    {31'h0, status_value[7]}, 32'h0);
        check_value("resume leaves CPU running",
                    {31'h0, status_value[0]}, 32'h0);

        write_control(4'b0001);
        @(negedge clk);
        model_halt_command <= 1'b1;
        repeat(4) @(posedge clk);

        debug_memory[1] = 32'h1234_5678;
        memory_delay = 20;
        dbg_request_pulses_before = dbg_request_pulses;
        debug_xfer(32'h0000_0004, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("aligned read succeeds", {30'h0, response_status},
                    {30'h0, RESP_SUCCESS});
        check_value("aligned read returns address", response_address, 32'h0000_0004);
        check_value("aligned read returns data", response_data, 32'h1234_5678);
        check_value("aligned read emits one request pulse", dbg_request_pulses,
                    dbg_request_pulses_before + 1);

        memory_delay = 20;
        dbg_request_pulses_before = dbg_request_pulses;
        debug_xfer(32'h0000_0008, 32'h89ab_cdef, XFER_WRITE,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("aligned write succeeds", {30'h0, response_status},
                    {30'h0, RESP_SUCCESS});
        check_value("aligned write echoes data", response_data, 32'h89ab_cdef);
        check_value("aligned write changes memory", debug_memory[2], 32'h89ab_cdef);
        check_value("aligned write emits one request pulse", dbg_request_pulses,
                    dbg_request_pulses_before + 1);

        debug_memory[3] = 32'h0bad_f00d;
        debug_memory[4] = 32'hfeed_face;
        memory_delay = 0;
        memory_hold_response = 1'b1;
        debug_xfer(32'h0000_000c, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        debug_xfer(32'h0000_0010, 32'h5555_aaaa, XFER_WRITE,
                   response_address, response_data, response_status);
        check_value("outstanding transfer reports busy", {30'h0, response_status},
                    {30'h0, RESP_BUSY});
        check_value("busy response keeps active address", response_address, 32'h0000_000c);
        memory_hold_response = 1'b0;
        repeat(10) @(posedge clk);
        poll_xfer(response_address, response_data, response_status);
        check_value("busy overwrite leaves original read", response_data, 32'h0bad_f00d);
        check_value("busy overwrite does not write", debug_memory[4], 32'hfeed_face);

        @(negedge clk);
        model_halt_command <= 1'b0;
        write_control(4'b0100);
        repeat(20) @(posedge clk);
        memory_accesses_before = memory_accesses;
        debug_xfer(32'h0000_0004, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("running CPU access fails", {30'h0, response_status},
                    {30'h0, RESP_FAILED});
        check_value("running failure has no memory strobe", memory_accesses,
                    memory_accesses_before);

        write_control(4'b0001);
        @(negedge clk);
        model_halt_command <= 1'b1;
        repeat(4) @(posedge clk);
        debug_xfer(32'h0000_0002, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("misaligned access fails", {30'h0, response_status},
                    {30'h0, RESP_FAILED});

        debug_xfer(32'h0000_0004, 32'h0, XFER_INVALID,
                   response_address, response_data, response_status);
        poll_xfer(response_address, response_data, response_status);
        check_value("invalid operation fails", {30'h0, response_status},
                    {30'h0, RESP_FAILED});

        memory_accesses_before = memory_accesses;
        debug_xfer(32'h0000_0004, 32'h0, XFER_NOP,
                   response_address, response_data, response_status);
        repeat(20) @(posedge clk);
        check_value("NOP launches no memory access", memory_accesses,
                    memory_accesses_before);

        debug_memory[5] = 32'ha5a5_5a5a;
        memory_delay = 30;
        debug_xfer(32'h0000_0014, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        @(negedge tck);
        tck_enable = 1'b0;
        repeat(100) @(posedge clk);
        tck_enable = 1'b1;
        poll_xfer(response_address, response_data, response_status);
        check_value("TCK stop preserves read response", response_data, 32'ha5a5_5a5a);
        check_value("TCK stop request succeeds", {30'h0, response_status},
                    {30'h0, RESP_SUCCESS});

        snapshot_delay = 0;
        snapshot_hold_stream = 1'b1;
        snapshot_base = 32'h1000_0000;
        write_control(4'b1001);
        read_status(status_value);
        check_value("snapshot reports busy", {31'h0, status_value[5]}, 32'h1);
        check_value("snapshot valid waits for all registers",
                    {31'h0, status_value[6]}, 32'h0);
        snapshot_hold_stream = 1'b0;
        repeat(20) @(posedge clk);
        read_status(status_value);
        check_value("snapshot busy clears", {31'h0, status_value[5]}, 32'h0);
        check_value("snapshot becomes valid", {31'h0, status_value[6]}, 32'h1);
        read_registers(scan_out);
        check_value("register scan begins with r0", scan_out[31:0], 32'h1000_0000);
        check_value("register scan ends with r15", scan_out[511:480], 32'h1000_000f);

        snapshot_delay = 0;
        snapshot_hold_stream = 1'b1;
        snapshot_requests_before = snapshot_requests;
        write_control(4'b1001);
        write_control(4'b1001);
        snapshot_hold_stream = 1'b0;
        repeat(20) @(posedge clk);
        check_value("busy snapshot ignores second request", snapshot_requests,
                    snapshot_requests_before + 1);

        @(negedge clk);
        model_halt_command <= 1'b0;
        write_control(4'b0100);
        repeat(20) @(posedge clk);
        snapshot_requests_before = snapshot_requests;
        write_control(4'b1000);
        repeat(20) @(posedge clk);
        read_status(status_value);
        check_value("running snapshot has no valid data",
                    {31'h0, status_value[6]}, 32'h0);
        check_value("running snapshot does not request core stream",
                    snapshot_requests, snapshot_requests_before);

        write_control(4'b0001);
        @(negedge clk);
        model_halt_command <= 1'b1;
        repeat(4) @(posedge clk);
        memory_delay = 0;
        memory_hold_response = 1'b1;
        debug_xfer(32'h0000_0018, 32'h0, XFER_READ,
                   response_address, response_data, response_status);
        tap_reset;
        repeat(20) @(posedge clk);
        check_value("TAP reset cancels read strobe", {31'h0, dbg_rden}, 32'h0);
        check_value("TAP reset cancels write strobe", {31'h0, dbg_wren}, 32'h0);
        check_value("TAP reset clears halt level", {31'h0, dbg_halt_req}, 32'h0);
        read_status(status_value);
        check_value("TAP reset clears transfer busy", {31'h0, status_value[3]}, 32'h0);
        check_value("TAP reset clears snapshot busy", {31'h0, status_value[5]}, 32'h0);
        check_value("TAP reset clears execute busy", {31'h0, status_value[7]}, 32'h0);
        memory_hold_response = 1'b0;

        if((failures == 0) && (dbg_request_width_failures == 0)) begin
            $display("TEST PASS: jtag_debug checks=%0d", checks);
        end else begin
            $display("TEST FAIL: jtag_debug failures=%0d pulse_failures=%0d checks=%0d",
                     failures, dbg_request_width_failures, checks);
        end
        $finish;
    end

    initial #(TCK_HALF_PERIOD * 2 * 20000) begin
        $display("TEST TIMEOUT: jtag_debug checks=%0d failures=%0d", checks, failures);
        $finish;
    end

endmodule
