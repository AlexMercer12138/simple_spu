`timescale 1ns / 1ps
//================================================================================
//  Module      : merc32_core_tb
//  Description : MERC32 interrupt context and acceptance testbench
//================================================================================

module merc32_core_tb();

    localparam CLK_PERIOD          = 20;
    localparam RESET_CYCLES        = 20;
    localparam MAX_CYCLES          = 250_000;
    localparam MEMORY_WORDS        = 65_536;
    localparam [3:0] OP_IMM        = 4'b0001;
    localparam [3:0] OP_REG        = 4'b0010;
    localparam [4:0] ST_LOAD       = 5'b00001;
    localparam [4:0] ST_EXEC       = 5'b00010;
    localparam [4:0] ST_STEP       = 5'b00100;
    localparam [4:0] ST_INTR       = 5'b01000;
    localparam [3:0] FUNC_CMP      = 4'b1011;
    localparam [3:0] FUNC_BRC      = 4'b1100;
    localparam [15:0] STATUS_ADDR  = 16'd240;
    localparam [15:0] FAIL_ADDR    = 16'd241;
    localparam [31:0] READY_CODE   = 32'h0000_1234;
    localparam [31:0] PASS_CODE    = 32'h0000_600d;
    localparam [31:0] FAIL_CODE    = 32'h0000_0bad;
    localparam [31:0] IRQ_RETURN_INSTRUCTION = 32'h0003_002d;

    reg         clk       = 1'b0;
    reg         rst_n     = 1'b0;
    reg         interrupt = 1'b0;

    wire        ilb_en;
    wire        ilb_we;
    wire [15:0] ilb_addr;
    wire [31:0] ilb_wdata;
    wire [31:0] ilb_rdata;

    wire        dlb_en;
    wire        dlb_we;
    wire [15:0] dlb_addr;
    wire [31:0] dlb_wdata;
    reg  [31:0] dlb_rdata = 32'd0;

    wire        plb_rden;
    wire        plb_wren;
    wire [31:0] plb_addr;
    wire [31:0] plb_wdata;
    reg  [31:0] plb_rdata = 32'd0;
    reg         plb_ack   = 1'b0;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram     [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;

    reg  [31:0] saved_r4     = 32'd0;
    reg  [31:0] saved_r5     = 32'd0;
    reg  [31:0] saved_r6     = 32'd0;
    reg  [31:0] saved_r7     = 32'd0;
    reg  [31:0] saved_r8     = 32'd0;
    reg  [31:0] saved_r12    = 32'd0;
    reg  [31:0] saved_r13    = 32'd0;
    reg  [31:0] saved_r14    = 32'd0;
    reg  [31:0] saved_return = 32'd0;

    integer i;
    integer patch_index           = 0;
    integer rom_words             = 0;
    integer cycle_count           = 0;
    integer error_count           = 0;
    integer foreground_cmp_found  = 0;
    integer irq_enable_patch_count = 0;
    integer handler_entry_count   = 0;
    integer late_check_cycle      = 0;
    reg     rom_ready             = 1'b0;
    reg     interrupt_exercised   = 1'b0;
    reg     firmware_pass_seen    = 1'b0;
    reg     late_event_checked    = 1'b0;
    reg     late_reentry_seen     = 1'b0;
    reg     late_return_overwrite_seen = 1'b0;
    reg     done                  = 1'b0;

    assign ilb_rdata = program_rom[ilb_addr];

    merc32_core #(
        .ILB_ADDR_WIDTH (16),
        .DLB_ADDR_WIDTH (16))
    merc32_core_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        .interrupt      (interrupt),

        .dbg_halt       (1'b0),
        .dbg_step       (1'b0),
        .dbg_reset      (1'b0),
        .dbg_halted     (),
        .dbg_rden       (1'b0),
        .dbg_wren       (1'b0),
        .dbg_addr       (32'd0),
        .dbg_wdata      (32'd0),
        .dbg_rdata      (),
        .dbg_ack        (),

        .dlb_en         (dlb_en),
        .dlb_we         (dlb_we),
        .dlb_addr       (dlb_addr),
        .dlb_wdata      (dlb_wdata),
        .dlb_rdata      (dlb_rdata),

        .ilb_en         (ilb_en),
        .ilb_we         (ilb_we),
        .ilb_addr       (ilb_addr),
        .ilb_wdata      (ilb_wdata),
        .ilb_rdata      (ilb_rdata),

        .plb_rden       (plb_rden),
        .plb_wren       (plb_wren),
        .plb_addr       (plb_addr),
        .plb_wdata      (plb_wdata),
        .plb_rdata      (plb_rdata),
        .plb_ack        (plb_ack));

    function is_cmp;
        input [31:0] instruction;
        begin
            is_cmp = ((instruction[7:4] == OP_IMM) ||
                      (instruction[7:4] == OP_REG)) &&
                     (instruction[3:0] == FUNC_CMP);
        end
    endfunction

    function is_brc;
        input [31:0] instruction;
        begin
            is_brc = ((instruction[7:4] == OP_IMM) ||
                      (instruction[7:4] == OP_REG)) &&
                     (instruction[3:0] == FUNC_BRC);
        end
    endfunction

    task add_error;
        input [31:0] check_id;
        input [31:0] expected;
        input [31:0] actual;
        begin
            error_count = error_count + 1;
            $display("[FAIL] check=%0d expected=0x%08h actual=0x%08h",
                     check_id, expected, actual);
        end
    endtask

    task pulse_interrupt_on_return_exec;
        begin
            @(negedge clk);
            while (!((merc32_core_inst.cpu_state == ST_EXEC) &&
                     (ilb_rdata == IRQ_RETURN_INSTRUCTION) &&
                     merc32_core_inst.irq_active)) begin
                @(negedge clk);
            end

            interrupt <= 1'b1;
            @(posedge clk);
            @(negedge clk);
            interrupt <= 1'b0;

            if (!merc32_core_inst.interrupt_return)
                add_error(24, 32'd1,
                          {31'd0, merc32_core_inst.interrupt_return});
        end
    endtask

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*RESET_CYCLES) rst_n = 1'b1;

    always @(posedge clk) begin
        if (!rst_n)
            handler_entry_count <= 0;
        else if (merc32_core_inst.take_interrupt)
            handler_entry_count <= handler_entry_count + 1;
    end

    initial begin
        for (i = 0; i < MEMORY_WORDS; i = i + 1) begin
            program_rom[i] = 32'd0;
            dlb_ram[i] = 32'd0;
        end

        if (!$value$plusargs("ROM_FILE=%s", rom_file)) begin
            done = 1'b1;
            $display("TEST FAIL: missing +ROM_FILE");
            $finish;
        end
        if (!$value$plusargs("ROM_WORDS=%d", rom_words) ||
            (rom_words <= 0) || (rom_words > MEMORY_WORDS)) begin
            done = 1'b1;
            $display("TEST FAIL: invalid +ROM_WORDS");
            $finish;
        end

        $readmemh(rom_file, program_rom, 0, rom_words - 1);
        for (i = 0; i < rom_words; i = i + 1) begin
            if (program_rom[i] == 32'h0001_0110) begin
                irq_enable_patch_count = irq_enable_patch_count + 1;
                patch_index = i;
            end
        end
        if (irq_enable_patch_count != 1) begin
            done = 1'b1;
            $display("TEST FAIL: IRQ enable patch matches=%0d expected=1",
                     irq_enable_patch_count);
            $finish;
        end
        program_rom[patch_index] = 32'hfff9_0110;
        rom_ready = 1'b1;
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            dlb_rdata <= 32'd0;
            plb_rdata <= 32'd0;
            plb_ack <= 1'b0;
        end else begin
            if (dlb_en && dlb_we)
                dlb_ram[dlb_addr] <= dlb_wdata;
            dlb_rdata <= dlb_en ? dlb_ram[dlb_addr] : dlb_rdata;
            plb_rdata <= 32'd0;
            plb_ack <= plb_rden | plb_wren;
        end
    end

    initial begin
        wait (rom_ready && rst_n);
        while (dlb_ram[STATUS_ADDR] != READY_CODE)
            @(posedge clk);

        if (merc32_core_inst.regi_int[1][2:0] !== 3'b001)
            add_error(1, 32'h0000_0001,
                      {29'd0, merc32_core_inst.regi_int[1][2:0]});
        if (merc32_core_inst.regi_int[1][31:3] !== 29'd0)
            add_error(2, 32'd0,
                      {3'd0, merc32_core_inst.regi_int[1][31:3]});

        while (!foreground_cmp_found) begin
            @(negedge clk);
            if ((merc32_core_inst.cpu_state == ST_EXEC) &&
                is_cmp(ilb_rdata) &&
                is_brc(program_rom[merc32_core_inst.prog_addr[17:2] + 1])) begin
                @(posedge clk);
                #1;
                if ((merc32_core_inst.cpu_state == ST_STEP) &&
                    (merc32_core_inst.eq == 1'b1)) begin
                    foreground_cmp_found = 1;
                end
            end
        end

        if (merc32_core_inst.cpu_state !== ST_STEP)
            add_error(3, {27'd0, ST_STEP},
                      {27'd0, merc32_core_inst.cpu_state});
        if (merc32_core_inst.eq !== 1'b1)
            add_error(4, 32'd1, {31'd0, merc32_core_inst.eq});

        saved_r4 = merc32_core_inst.regi_int[4];
        saved_r5 = merc32_core_inst.regi_int[5];
        saved_r6 = merc32_core_inst.regi_int[6];
        saved_r7 = merc32_core_inst.regi_int[7];
        saved_r8 = merc32_core_inst.regi_int[8];
        saved_r12 = merc32_core_inst.regi_int[12];
        saved_r13 = merc32_core_inst.regi_int[13];
        saved_r14 = merc32_core_inst.regi_int[14];

        force merc32_core_inst.intr_flag = 1'b1;
        @(posedge clk);
        #1;
        release merc32_core_inst.intr_flag;

        saved_return = merc32_core_inst.ret_addr;
        if (merc32_core_inst.cpu_state !== ST_INTR)
            add_error(5, {27'd0, ST_INTR},
                      {27'd0, merc32_core_inst.cpu_state});
        if (!is_brc(program_rom[saved_return[17:2]]))
            add_error(6, 32'd1, 32'd0);
        if (merc32_core_inst.regi_int[1][7:3] !== 5'b01011)
            add_error(7, 32'h0000_000b,
                      {27'd0, merc32_core_inst.regi_int[1][7:3]});

        repeat (8) @(posedge clk);
        @(negedge clk);
        while (merc32_core_inst.cpu_state != ST_STEP) begin
            @(negedge clk);
        end

        force merc32_core_inst.intr_flag = 1'b1;
        @(posedge clk);
        #1;
        release merc32_core_inst.intr_flag;
        if (merc32_core_inst.ret_addr !== saved_return)
            add_error(8, saved_return, merc32_core_inst.ret_addr);

        pulse_interrupt_on_return_exec;

        @(negedge clk);
        while (!((merc32_core_inst.cpu_state == ST_LOAD) &&
                 (merc32_core_inst.prog_addr == saved_return))) begin
            @(negedge clk);
        end

        if (merc32_core_inst.regi_int[4] !== saved_r4)
            add_error(9, saved_r4, merc32_core_inst.regi_int[4]);
        if (merc32_core_inst.regi_int[5] !== saved_r5)
            add_error(10, saved_r5, merc32_core_inst.regi_int[5]);
        if (merc32_core_inst.regi_int[6] !== saved_r6)
            add_error(11, saved_r6, merc32_core_inst.regi_int[6]);
        if (merc32_core_inst.regi_int[7] !== saved_r7)
            add_error(12, saved_r7, merc32_core_inst.regi_int[7]);
        if (merc32_core_inst.regi_int[8] !== saved_r8)
            add_error(13, saved_r8, merc32_core_inst.regi_int[8]);
        if (merc32_core_inst.regi_int[12] !== saved_r12)
            add_error(14, saved_r12, merc32_core_inst.regi_int[12]);
        if (merc32_core_inst.regi_int[13] !== saved_r13)
            add_error(15, saved_r13, merc32_core_inst.regi_int[13]);
        if (merc32_core_inst.regi_int[14] !== saved_r14)
            add_error(16, saved_r14, merc32_core_inst.regi_int[14]);
        if (merc32_core_inst.ugt !== 1'b0)
            add_error(17, 32'd0, {31'd0, merc32_core_inst.ugt});
        if (merc32_core_inst.uge !== 1'b1)
            add_error(18, 32'd1, {31'd0, merc32_core_inst.uge});
        if (merc32_core_inst.sgt !== 1'b0)
            add_error(19, 32'd0, {31'd0, merc32_core_inst.sgt});
        if (merc32_core_inst.sge !== 1'b1)
            add_error(20, 32'd1, {31'd0, merc32_core_inst.sge});
        if (merc32_core_inst.eq !== 1'b1)
            add_error(21, 32'd1, {31'd0, merc32_core_inst.eq});
        if (merc32_core_inst.regi_int[1][7:3] !== 5'b01011)
            add_error(22, 32'h0000_000b,
                      {27'd0, merc32_core_inst.regi_int[1][7:3]});
        if (merc32_core_inst.regi_int[1][31:8] !== 24'd0)
            add_error(23, 32'd0,
                      {8'd0, merc32_core_inst.regi_int[1][31:8]});

        for (late_check_cycle = 0; late_check_cycle < 12;
             late_check_cycle = late_check_cycle + 1) begin
            @(posedge clk);
            #1;
            if (merc32_core_inst.cpu_state == ST_INTR)
                late_reentry_seen = 1'b1;
            if (merc32_core_inst.ret_addr !== saved_return)
                late_return_overwrite_seen = 1'b1;
        end

        if (merc32_core_inst.intr_flag !== 1'b0)
            add_error(25, 32'd0,
                      {31'd0, merc32_core_inst.intr_flag});
        if (merc32_core_inst.irq_active !== 1'b0)
            add_error(26, 32'd0,
                      {31'd0, merc32_core_inst.irq_active});
        if (late_reentry_seen)
            add_error(27, 32'd0, 32'd1);
        if (late_return_overwrite_seen)
            add_error(28, saved_return, merc32_core_inst.ret_addr);
        if (handler_entry_count != 1)
            add_error(29, 32'd1, handler_entry_count);

        interrupt_exercised = 1'b1;
        late_event_checked = 1'b1;
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            cycle_count <= 0;
            firmware_pass_seen <= 1'b0;
        end else if (!done) begin
            cycle_count <= cycle_count + 1;

            if (dlb_en && dlb_we && (dlb_addr == STATUS_ADDR)) begin
                if (dlb_wdata == PASS_CODE)
                    firmware_pass_seen <= 1'b1;
                else if (dlb_wdata == FAIL_CODE) begin
                    done <= 1'b1;
                    $display("TEST FAIL: firmware status=0x%08h detail=0x%08h errors=%0d interrupt_exercised=%0d",
                             dlb_wdata, dlb_ram[FAIL_ADDR], error_count,
                             interrupt_exercised);
                    $finish;
                end
            end

            if ((firmware_pass_seen ||
                 (dlb_en && dlb_we && (dlb_addr == STATUS_ADDR) &&
                  (dlb_wdata == PASS_CODE))) && late_event_checked) begin
                done <= 1'b1;
                if ((error_count == 0) && interrupt_exercised)
                    $display("TEST PASS");
                else
                    $display("TEST FAIL: errors=%0d interrupt_exercised=%0d late_event_checked=%0d detail=0x%08h",
                             error_count, interrupt_exercised,
                             late_event_checked, dlb_ram[FAIL_ADDR]);
                $finish;
            end

            if (cycle_count >= MAX_CYCLES) begin
                done <= 1'b1;
                $display("TEST TIMEOUT: pc=%0d state=0x%02h status=0x%08h detail=0x%08h errors=%0d interrupt_exercised=%0d ret=0x%08h expected_ret=0x%08h",
                         merc32_core_inst.prog_addr,
                         merc32_core_inst.cpu_state,
                         dlb_ram[STATUS_ADDR],
                         dlb_ram[FAIL_ADDR],
                         error_count,
                         interrupt_exercised,
                         merc32_core_inst.ret_addr,
                         saved_return);
                $finish;
            end
        end
    end

    initial #(CLK_PERIOD*(MAX_CYCLES + RESET_CYCLES + 1000)) begin
        if (!done) begin
            $display("TEST TIMEOUT: testbench watchdog errors=%0d interrupt_exercised=%0d",
                     error_count, interrupt_exercised);
            $finish;
        end
    end

    // initial begin
    //     $dumpfile("merc32_core_tb.vcd");
    //     $dumpvars(0, merc32_core_tb);
    // end

endmodule
