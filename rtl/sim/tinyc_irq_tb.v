`timescale 1ns / 1ps

module tinyc_irq_tb();

    localparam integer CLK_HALF_NS       = 10;
    localparam integer RESET_CYCLES      = 20;
    localparam integer MAX_CYCLES        = 100000;
    localparam integer MEMORY_WORDS      = 65536;
    localparam [5:0] ST_LOAD             = 6'b000001;
    localparam [5:0] ST_STEP             = 6'b001000;
    localparam [5:0] ST_INTR             = 6'b010000;
    localparam [15:0] STATUS_ADDR        = 16'd240;
    localparam [31:0] READY_CODE         = 32'h0000_1234;
    localparam [31:0] PASS_CODE_1        = 32'h0000_600e;
    localparam [31:0] PASS_CODE_2        = 32'h0000_600f;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         interrupt = 1'b0;

    wire        ilb_rden;
    wire        ilb_wren;
    wire [15:0] ilb_addr;
    wire [31:0] ilb_wdata;
    reg  [31:0] ilb_rdata = 32'd0;
    reg         ilb_ack = 1'b0;

    wire        dlb_rden;
    wire        dlb_wren;
    wire [15:0] dlb_addr;
    wire [31:0] dlb_wdata;
    reg  [31:0] dlb_rdata = 32'd0;
    reg         dlb_ack = 1'b0;

    wire        plb_rden;
    wire        plb_wren;
    wire [31:0] plb_addr;
    wire [31:0] plb_wdata;
    reg  [31:0] plb_rdata = 32'd0;
    reg         plb_ack = 1'b0;

    reg  [31:0] program_rom [0:MEMORY_WORDS-1];
    reg  [31:0] dlb_ram [0:MEMORY_WORDS-1];
    reg  [8*1024-1:0] rom_file;

    integer i;
    integer rom_words = 0;
    integer cycle_count = 0;
    integer interrupt_count = 0;
    integer handler_pass_count = 0;
    integer error_count = 0;
    integer reg_index = 0;
    reg [31:0] saved_return = 32'd0;
    reg [31:0] second_return = 32'd0;
    reg [31:0] saved_regs [0:15];
    reg ready_seen = 1'b0;
    reg first_service_seen = 1'b0;
    reg second_return_seen = 1'b0;
    reg done = 1'b0;

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
        .dlb_wdata      (dlb_wdata),
        .dlb_rdata      (dlb_rdata),
        .dlb_ack        (dlb_ack),

        .ilb_rden       (ilb_rden),
        .ilb_wren       (ilb_wren),
        .ilb_addr       (ilb_addr),
        .ilb_wdata      (ilb_wdata),
        .ilb_rdata      (ilb_rdata),
        .ilb_ack        (ilb_ack),

        .plb_rden       (plb_rden),
        .plb_wren       (plb_wren),
        .plb_addr       (plb_addr),
        .plb_wdata      (plb_wdata),
        .plb_rdata      (plb_rdata),
        .plb_ack        (plb_ack));

    always #(CLK_HALF_NS) clk = ~clk;

    initial #(CLK_HALF_NS * 2 * RESET_CYCLES) rst_n = 1'b1;

    task record_error;
        input [8*80-1:0] check_name;
        input [31:0] expected;
        input [31:0] actual;
        begin
            error_count = error_count + 1;
            $display("TEST FAIL: %0s expected=0x%08h actual=0x%08h",
                     check_name, expected, actual);
        end
    endtask

    task assert_interrupt_level;
        begin
            while (merc32_core_inst.cpu_state != ST_STEP)
                @(negedge clk);
            interrupt <= 1'b1;
        end
    endtask

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
    end

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
            if (dlb_wren)
                dlb_ram[dlb_addr] <= dlb_wdata;
            if (dlb_rden)
                dlb_rdata <= dlb_ram[dlb_addr];
            plb_rdata <= 32'd0;
            plb_ack <= plb_rden | plb_wren;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            ready_seen <= 1'b0;
            handler_pass_count <= 0;
            interrupt_count <= 0;
        end else begin
            if (dlb_wren && (dlb_addr == STATUS_ADDR)) begin
                if (dlb_wdata == READY_CODE)
                    ready_seen <= 1'b1;
                else if ((dlb_wdata == PASS_CODE_1) ||
                         (dlb_wdata == PASS_CODE_2))
                    handler_pass_count <= handler_pass_count + 1;
            end
            if (merc32_core_inst.cpu_state == ST_INTR)
                interrupt_count <= interrupt_count + 1;
        end
    end

    initial begin
        wait (ready_seen);

        if (merc32_core_inst.regi_int[2] !== 32'd4)
            record_error("startup IRQ vector", 32'd4,
                         merc32_core_inst.regi_int[2]);

        assert_interrupt_level();

        while (merc32_core_inst.cpu_state != ST_INTR)
            @(negedge clk);
        saved_return = merc32_core_inst.prog_addr;
        for (reg_index = 4; reg_index <= 14; reg_index = reg_index + 1)
            saved_regs[reg_index] = merc32_core_inst.regi_int[reg_index];

        @(posedge clk);
        #1;
        if (merc32_core_inst.prog_addr !== 32'd4)
            record_error("IRQ enters vector address", 32'd4,
                         merc32_core_inst.prog_addr);
        if (merc32_core_inst.regi_int[3] !== saved_return)
            record_error("IRQ saves resolved return in r3", saved_return,
                         merc32_core_inst.regi_int[3]);
        if (merc32_core_inst.regi_int[1][0] !== 1'b0)
            record_error("IRQ clears enable bit", 32'd0,
                         {31'd0, merc32_core_inst.regi_int[1][0]});
        if (merc32_core_inst.regi_int[1][2:1] !== 2'b10)
            record_error("IRQ preserves high-level mode", 32'd2,
                         {30'd0, merc32_core_inst.regi_int[1][2:1]});

        wait (handler_pass_count == 1);
        first_service_seen = 1'b1;

        while (merc32_core_inst.cpu_state != ST_INTR)
            @(negedge clk);
        second_return = merc32_core_inst.prog_addr;
        if (second_return !== saved_return)
            record_error("held-high IRQ preserves return address", saved_return,
                         second_return);
        interrupt <= 1'b0;

        wait (handler_pass_count == 2);
        while (!((merc32_core_inst.cpu_state == ST_LOAD) &&
                 (merc32_core_inst.prog_addr == second_return))) begin
            @(negedge clk);
        end
        second_return_seen = 1'b1;

        for (reg_index = 4; reg_index <= 14; reg_index = reg_index + 1) begin
            if (merc32_core_inst.regi_int[reg_index] !== saved_regs[reg_index]) begin
                error_count = error_count + 1;
                $display("TEST FAIL: IRQ context r%0d expected=0x%08h actual=0x%08h",
                         reg_index, saved_regs[reg_index],
                         merc32_core_inst.regi_int[reg_index]);
            end
        end
        if (merc32_core_inst.regi_int[1][2:0] !== 3'b101)
            record_error("IRQ return restores enabled high-level mode", 32'd5,
                         {29'd0, merc32_core_inst.regi_int[1][2:0]});

        repeat (8) @(posedge clk);
        if (interrupt_count != 2)
            record_error("held-high IRQ enters twice", 32'd2,
                         interrupt_count);

        done = 1'b1;
        if ((error_count == 0) && first_service_seen && second_return_seen)
            $display("TEST PASS");
        else
            $display("TEST FAIL: IRQ errors=%0d first_service_seen=%0d second_return_seen=%0d",
                     error_count, first_service_seen, second_return_seen);
        $finish;
    end

    always @(posedge clk) begin
        if (!rst_n)
            cycle_count <= 0;
        else if (!done) begin
            cycle_count <= cycle_count + 1;
            if (cycle_count >= MAX_CYCLES) begin
                done <= 1'b1;
                $display("TEST TIMEOUT: minimal IRQ pc=0x%08h state=0x%02h status=0x%08h interrupts=%0d",
                         merc32_core_inst.prog_addr,
                         merc32_core_inst.cpu_state,
                         dlb_ram[STATUS_ADDR],
                         interrupt_count);
                $finish;
            end
        end
    end

    initial #(CLK_HALF_NS * 2 * (MAX_CYCLES + RESET_CYCLES + 1000)) begin
        if (!done) begin
            $display("TEST TIMEOUT: minimal IRQ testbench watchdog");
            $finish;
        end
    end

    // initial begin
    //     $dumpfile("tinyc_irq_tb.vcd");
    //     $dumpvars(0, tinyc_irq_tb);
    // end

endmodule
