`timescale 1ns / 1ps

module merc32_full_tb();

    localparam [15:0] STATUS_ADDR      = 16'd240;
    localparam [15:0] FAIL_ADDR        = 16'd241;
    localparam [15:0] ISR_COUNT_ADDR   = 16'd242;
    localparam [15:0] HEARTBEAT_ADDR   = 16'd243;

    localparam [31:0] READY_CODE       = 32'h0000_1234;
    localparam [31:0] PASS_CODE        = 32'h0000_600D;
    localparam [31:0] FAIL_CODE        = 32'h0000_0BAD;
    localparam [31:0] EXPECTED_INTR    = 32'd3;

    localparam integer CLK_HALF_NS     = 10;
    localparam integer RESET_NS        = 2000;
    localparam integer FIRST_INTR_WAIT = 40;
    localparam integer INTR_HIGH_CYC   = 12;
    localparam integer INTR_LOW_CYC    = 150;
    localparam integer MAX_CYCLES      = 50000;

    reg clk = 1'b0;
    reg rst_n = 1'b0;
    reg interrupt = 1'b0;

    wire        ilb_en;
    wire        ilb_we;
    wire [15:0] ilb_addr;
    wire [31:0] ilb_wdata;
    wire [31:0] ilb_rdata;

    wire        dlb_en;
    wire        dlb_we;
    wire [15:0] dlb_addr;
    wire [31:0] dlb_wdata;
    reg  [31:0] dlb_rdata = 32'h0;

    wire        plb_rden;
    wire        plb_wren;
    wire [31:0] plb_addr;
    wire [31:0] plb_wdata;
    reg [31:0]  plb_rdata = 32'h0;
    reg         plb_ack = 1'b0;

    reg [31:0]  dlb_ram [0:255];

    integer i;
    integer cycle_count = 0;
    integer intr_wait_count = 0;
    integer intr_high_count = 0;
    integer intr_low_count = 0;
    integer intr_fired = 0;

    reg ready_seen = 1'b0;
    reg intr_active = 1'b0;
    reg done = 1'b0;

    wire [7:0] dlb_index = dlb_addr[7:0];

    initial begin
        forever #CLK_HALF_NS clk = ~clk;
    end

    initial begin
        for (i = 0; i < 256; i = i + 1) begin
            dlb_ram[i] = 32'h0;
        end

        #RESET_NS rst_n = 1'b1;
    end

    merc32_core cpu_inst (
        .clk            (clk),
        .rst_n          (rst_n),
        .interrupt      (interrupt),

        .dbg_halt       (1'b0),
        .dbg_step       (1'b0),
        .dbg_reset      (1'b0),
        .dbg_halted     (),

        .dbg_rden       (1'b0),
        .dbg_wren       (1'b0),
        .dbg_addr       (32'h0),
        .dbg_wdata      (32'h0),
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
        .plb_ack        (plb_ack)
    );

    full_test rom_inst (
        .prog_addr      (ilb_addr),
        .prog_data      (ilb_rdata)
    );

    always @(posedge clk) begin
        if (!rst_n) begin
            dlb_rdata <= 32'h0;
            plb_ack <= 1'b0;
            plb_rdata <= 32'h0;
        end else begin
            if (dlb_en && dlb_we) begin
                dlb_ram[dlb_index] <= dlb_wdata;
                $display("[DLB-WR] addr=%0d data=0x%08h time=%0t", dlb_addr, dlb_wdata, $time);
            end

            dlb_rdata <= dlb_en ? dlb_ram[dlb_index] : dlb_rdata;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            ready_seen <= 1'b0;
        end else if (dlb_en && dlb_we && dlb_index == STATUS_ADDR[7:0] && dlb_wdata == READY_CODE) begin
            if (!ready_seen) begin
                $display("Full test reached interrupt phase at time %0t", $time);
            end
            ready_seen <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            interrupt <= 1'b0;
            intr_active <= 1'b0;
            intr_wait_count <= 0;
            intr_high_count <= 0;
            intr_low_count <= 0;
            intr_fired <= 0;
        end else if (!done && ready_seen && ((intr_fired < EXPECTED_INTR) || intr_active)) begin
            if (!intr_active && intr_low_count == 0) begin
                if (intr_wait_count >= FIRST_INTR_WAIT) begin
                    interrupt <= 1'b1;
                    intr_active <= 1'b1;
                    intr_high_count <= 1;
                    intr_fired <= intr_fired + 1;
                    $display("--- interrupt pulse %0d asserted at time %0t ---", intr_fired + 1, $time);
                end else begin
                    intr_wait_count <= intr_wait_count + 1;
                end
            end else if (intr_active) begin
                if (intr_high_count >= INTR_HIGH_CYC) begin
                    interrupt <= 1'b0;
                    intr_active <= 1'b0;
                    intr_high_count <= 0;
                    intr_low_count <= 1;
                    intr_wait_count <= FIRST_INTR_WAIT;
                    $display("--- interrupt pulse %0d released at time %0t ---", intr_fired, $time);
                end else begin
                    intr_high_count <= intr_high_count + 1;
                end
            end else if (intr_low_count < INTR_LOW_CYC) begin
                intr_low_count <= intr_low_count + 1;
            end else begin
                intr_low_count <= 0;
            end
        end else begin
            interrupt <= 1'b0;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || done) begin
            cycle_count <= 0;
        end else begin
            cycle_count <= cycle_count + 1;

            if (dlb_en && dlb_we && dlb_index == STATUS_ADDR[7:0]) begin
                if (dlb_wdata == FAIL_CODE) begin
                    $display("");
                    $display("========== MERC32 Full Test Summary ==========");
                    $display("  Result           : FAIL");
                    $display("  Fail code        : %0d", dlb_ram[FAIL_ADDR[7:0]]);
                    $display("  PC address       : %0d", cpu_inst.prog_addr);
                    $display("  ROM address      : %0d", ilb_addr);
                    $display("==============================================");
                    done <= 1'b1;
                    $finish;
                end else if (dlb_wdata == PASS_CODE) begin
                    if (dlb_ram[ISR_COUNT_ADDR[7:0]] == EXPECTED_INTR && intr_fired == EXPECTED_INTR) begin
                        $display("");
                        $display("========== MERC32 Full Test Summary ==========");
                        $display("  Result           : PASS");
                        $display("  Interrupts fired : %0d", intr_fired);
                        $display("  ISR count        : %0d", dlb_ram[ISR_COUNT_ADDR[7:0]]);
                        $display("  Heartbeat count  : %0d", dlb_ram[HEARTBEAT_ADDR[7:0]]);
                        $display("==============================================");
                        done <= 1'b1;
                        $finish;
                    end else begin
                        $display("");
                        $display("========== MERC32 Full Test Summary ==========");
                        $display("  Result           : FAIL");
                        $display("  Reason           : interrupt count mismatch");
                        $display("  Interrupts fired : %0d", intr_fired);
                        $display("  ISR count        : %0d", dlb_ram[ISR_COUNT_ADDR[7:0]]);
                        $display("==============================================");
                        done <= 1'b1;
                        $finish;
                    end
                end
            end

            if (cycle_count >= MAX_CYCLES) begin
                $display("");
                $display("========== MERC32 Full Test Summary ==========");
                $display("  Result           : FAIL");
                $display("  Reason           : timeout");
                $display("  PC address       : %0d", cpu_inst.prog_addr);
                $display("  ROM address      : %0d", ilb_addr);
                $display("  Status word      : 0x%08h", dlb_ram[STATUS_ADDR[7:0]]);
                $display("  Fail code        : %0d", dlb_ram[FAIL_ADDR[7:0]]);
                $display("  Interrupts fired : %0d", intr_fired);
                $display("  ISR count        : %0d", dlb_ram[ISR_COUNT_ADDR[7:0]]);
                $display("==============================================");
                done <= 1'b1;
                $finish;
            end
        end
    end

    initial begin
        $dumpfile("merc32_full_tb.vcd");
        $dumpvars(0, merc32_full_tb);
    end

    task finish_fail;
        begin
            if (!done) begin
                done = 1'b1;
                $finish;
            end
        end
    endtask

endmodule
