`timescale 1ns / 1ps

module apb_intc_tb;

    localparam integer MAIN_IRQ_COUNT = 20;
    localparam [63:0] IRQ_MODES = 64'he4e4_e4e4_e4e4_e4e4;

    reg clk = 1'b0;
    reg resetn = 1'b0;
    reg psel = 1'b0;
    reg penable = 1'b0;
    reg pwrite = 1'b0;
    reg [31:0] paddr = 32'd0;
    reg [31:0] pwdata = 32'd0;
    reg [3:0] pstrb = 4'd0;

    wire pready;
    wire pslverr;
    wire [31:0] prdata;
    reg [MAIN_IRQ_COUNT-1:0] irq_sources = 20'haaaaa;
    wire interrupt;

    wire pready_one;
    wire pslverr_one;
    wire [31:0] prdata_one;
    reg irq_source_one = 1'b1;
    wire interrupt_one;

    wire pready_full;
    wire pslverr_full;
    wire [31:0] prdata_full;
    reg [31:0] irq_sources_full = 32'haaaa_aaaa;
    wire interrupt_full;

    integer failures = 0;
    reg [31:0] read_main;
    reg [31:0] read_one;
    reg [31:0] read_full;

    always #5 clk = ~clk;

    apb_intc #(
        .IRQ_COUNT (MAIN_IRQ_COUNT),
        .IRQ_MODE  (IRQ_MODES)
    ) dut (
        .s_apb_pclk    (clk),
        .s_apb_presetn (resetn),
        .s_apb_psel    (psel),
        .s_apb_penable (penable),
        .s_apb_pwrite  (pwrite),
        .s_apb_paddr   (paddr),
        .s_apb_pwdata  (pwdata),
        .s_apb_pstrb   (pstrb),
        .s_apb_pready  (pready),
        .s_apb_pslverr (pslverr),
        .s_apb_prdata  (prdata),
        .irq_sources   (irq_sources),
        .interrupt     (interrupt)
    );

    apb_intc #(
        .IRQ_COUNT (1),
        .IRQ_MODE  (64'hffff_ffff_ffff_ffff)
    ) dut_one (
        .s_apb_pclk    (clk),
        .s_apb_presetn (resetn),
        .s_apb_psel    (psel),
        .s_apb_penable (penable),
        .s_apb_pwrite  (pwrite),
        .s_apb_paddr   (paddr),
        .s_apb_pwdata  (pwdata),
        .s_apb_pstrb   (pstrb),
        .s_apb_pready  (pready_one),
        .s_apb_pslverr (pslverr_one),
        .s_apb_prdata  (prdata_one),
        .irq_sources   (irq_source_one),
        .interrupt     (interrupt_one)
    );

    apb_intc #(
        .IRQ_COUNT (32),
        .IRQ_MODE  (IRQ_MODES)
    ) dut_full (
        .s_apb_pclk    (clk),
        .s_apb_presetn (resetn),
        .s_apb_psel    (psel),
        .s_apb_penable (penable),
        .s_apb_pwrite  (pwrite),
        .s_apb_paddr   (paddr),
        .s_apb_pwdata  (pwdata),
        .s_apb_pstrb   (pstrb),
        .s_apb_pready  (pready_full),
        .s_apb_pslverr (pslverr_full),
        .s_apb_prdata  (prdata_full),
        .irq_sources   (irq_sources_full),
        .interrupt     (interrupt_full)
    );

    task check_value;
        input [31:0] actual;
        input [31:0] expected;
        input [8*80-1:0] label;
        begin
            if(actual !== expected) begin
                failures = failures + 1;
                $display("TEST FAIL: %0s expected=%08x actual=%08x", label, expected, actual);
            end
        end
    endtask

    task check_bit;
        input actual;
        input expected;
        input [8*80-1:0] label;
        begin
            if(actual !== expected) begin
                failures = failures + 1;
                $display("TEST FAIL: %0s expected=%b actual=%b", label, expected, actual);
            end
        end
    endtask

    task apb_write;
        input [7:0] offset;
        input [31:0] data;
        input [3:0] strb;
        begin
            @(negedge clk);
            psel <= 1'b1;
            penable <= 1'b0;
            pwrite <= 1'b1;
            paddr <= {24'd0, offset};
            pwdata <= data;
            pstrb <= strb;
            @(negedge clk);
            penable <= 1'b1;
            while(!pready) @(negedge clk);
            if(pslverr || pslverr_one || pslverr_full) begin
                failures = failures + 1;
                $display("TEST FAIL: APB write at %02x asserted PSLVERR", offset);
            end
            @(negedge clk);
            psel <= 1'b0;
            penable <= 1'b0;
            pwrite <= 1'b0;
            paddr <= 32'd0;
            pwdata <= 32'd0;
            pstrb <= 4'd0;
        end
    endtask

    task apb_read;
        input [7:0] offset;
        output [31:0] data_main;
        output [31:0] data_one;
        output [31:0] data_full;
        begin
            @(negedge clk);
            psel <= 1'b1;
            penable <= 1'b0;
            pwrite <= 1'b0;
            paddr <= {24'd0, offset};
            pwdata <= 32'd0;
            pstrb <= 4'd0;
            @(negedge clk);
            penable <= 1'b1;
            while(!pready) @(negedge clk);
            #1;
            data_main = prdata;
            data_one = prdata_one;
            data_full = prdata_full;
            if(pslverr || pslverr_one || pslverr_full) begin
                failures = failures + 1;
                $display("TEST FAIL: APB read at %02x asserted PSLVERR", offset);
            end
            @(negedge clk);
            psel <= 1'b0;
            penable <= 1'b0;
            paddr <= 32'd0;
        end
    endtask

    task reset_duts;
        begin
            @(negedge clk);
            resetn <= 1'b0;
            psel <= 1'b0;
            penable <= 1'b0;
            pwrite <= 1'b0;
            paddr <= 32'd0;
            pwdata <= 32'd0;
            pstrb <= 4'd0;
            irq_sources <= 20'haaaaa;
            irq_source_one <= 1'b1;
            irq_sources_full <= 32'haaaa_aaaa;
            repeat(2) @(posedge clk);
            @(negedge clk);
            resetn <= 1'b1;
            repeat(2) @(posedge clk);
            #1;
        end
    endtask

    initial begin
        repeat(2) @(posedge clk);
        check_bit(interrupt, 1'b0, "reset clears main interrupt");
        check_bit(interrupt_one, 1'b0, "reset clears IRQ_COUNT=1 interrupt");
        check_bit(interrupt_full, 1'b0, "reset clears IRQ_COUNT=32 interrupt");
        reset_duts;

        apb_read(8'h00, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "RAW reports inactive normalized sources");
        check_value(read_one, 32'h0000_0000, "IRQ_COUNT=1 RAW masks unused bits");
        check_value(read_full, 32'h0000_0000, "IRQ_COUNT=32 RAW reports inactive sources");
        apb_read(8'h04, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "PENDING resets to zero");
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "ENABLE resets to zero");
        apb_read(8'h1c, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "ACTIVE is invalid after reset");
        apb_read(8'h20, read_main, read_one, read_full);
        check_value(read_main, 32'he4e4_e4e4, "MODE_LO exposes sources 0 through 15");
        check_value(read_one, 32'h0000_0003, "IRQ_COUNT=1 masks unused MODE_LO fields");
        check_value(read_full, 32'he4e4_e4e4, "IRQ_COUNT=32 exposes complete MODE_LO");
        apb_read(8'h24, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_00e4, "MODE_HI masks modes above IRQ_COUNT");
        check_value(read_one, 32'h0000_0000, "IRQ_COUNT=1 MODE_HI is zero");
        check_value(read_full, 32'he4e4_e4e4, "IRQ_COUNT=32 exposes complete MODE_HI");
        apb_read(8'h0c, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "write-only registers read as zero");
        apb_read(8'h28, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "unmapped offsets read as zero");

        apb_write(8'h08, 32'hffff_ffff, 4'b1111);
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h000f_ffff, "ENABLE ignores bits above IRQ_COUNT=20");
        check_value(read_one, 32'h0000_0001, "ENABLE ignores bits above IRQ_COUNT=1");
        check_value(read_full, 32'hffff_ffff, "IRQ_COUNT=32 accepts all ENABLE bits");

        reset_duts;
        apb_write(8'h08, 32'hdead_beef, 4'b0101);
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h000d_00ef, "ENABLE RW honors byte strobes 0 and 2");
        check_value(read_full, 32'h00ad_00ef, "ENABLE RW preserves unstrobed full-width bytes");
        apb_write(8'h08, 32'h1234_5678, 4'b1010);
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h000d_56ef, "ENABLE RW merges later byte strobes");
        check_value(read_full, 32'h12ad_56ef, "ENABLE RW merges all four bytes");
        apb_write(8'h08, 32'hffff_ffff, 4'b0000);
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h000d_56ef, "zero byte strobe leaves ENABLE unchanged");

        reset_duts;
        apb_write(8'h0c, 32'h000a_0505, 4'b1111);
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h000a_0505, "ENABLE_SET sets selected bits");
        apb_write(8'h10, 32'h0002_0501, 4'b0101);
        apb_read(8'h08, read_main, read_one, read_full);
        check_value(read_main, 32'h0008_0504, "ENABLE_CLEAR honors data and byte strobes");

        reset_duts;
        apb_write(8'h14, 32'h0008_0004, 4'b1111);
        apb_read(8'h04, read_main, read_one, read_full);
        check_value(read_main, 32'h0008_0004, "PENDING_SET creates software pending bits");
        check_bit(interrupt, 1'b0, "disabled pending sources stay masked");
        apb_write(8'h0c, 32'h0008_0005, 4'b1111);
        check_bit(interrupt, 1'b1, "enabling pending sources raises interrupt");
        apb_read(8'h1c, read_main, read_one, read_full);
        check_value(read_main, 32'h8000_0002, "ACTIVE selects lowest enabled pending source");
        apb_write(8'h14, 32'h0000_0001, 4'b0001);
        apb_read(8'h1c, read_main, read_one, read_full);
        check_value(read_main, 32'h8000_0000, "source zero has highest fixed priority");
        apb_write(8'h18, 32'h0000_0005, 4'b0001);
        apb_read(8'h1c, read_main, read_one, read_full);
        check_value(read_main, 32'h8000_0013, "ACTIVE advances to the next pending source");
        apb_write(8'h18, 32'h0008_0000, 4'b0001);
        check_bit(interrupt, 1'b1, "unstrobed PENDING_CLEAR byte is ignored");
        apb_write(8'h18, 32'h0008_0000, 4'b0100);
        check_bit(interrupt, 1'b0, "W1C removes the final enabled pending source");
        apb_read(8'h04, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "PENDING_CLEAR clears only written bits");

        reset_duts;
        apb_write(8'h0c, 32'h0000_000f, 4'b0001);
        @(negedge clk);
        irq_sources[0] <= 1'b1;
        #1;
        check_bit(interrupt, 1'b0, "high-level source does not bypass pending register");
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b1, "high-level source raises interrupt after one clock");
        apb_read(8'h00, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0001, "RAW normalizes an active high-level source");
        irq_sources[0] <= 1'b0;
        apb_write(8'h18, 32'h0000_0001, 4'b0001);
        check_bit(interrupt, 1'b0, "clearing inactive high-level pending lowers interrupt");

        @(negedge clk);
        irq_sources[1] <= 1'b0;
        #1;
        apb_read(8'h00, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0002, "RAW normalizes an active low-level source");
        apb_read(8'h04, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0002, "low-level source becomes pending");
        irq_sources[1] <= 1'b1;
        apb_write(8'h18, 32'h0000_0002, 4'b0001);

        @(negedge clk);
        irq_sources[2] <= 1'b1;
        #1;
        check_bit(interrupt, 1'b0, "rising edge waits for the sampling clock");
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b1, "one-cycle rising event is captured");
        @(negedge clk);
        irq_sources[2] <= 1'b0;
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b1, "rising pending remains sticky after a short pulse");
        apb_write(8'h18, 32'h0000_0004, 4'b0001);
        check_bit(interrupt, 1'b0, "rising-edge W1C clears sticky pending");

        @(negedge clk);
        irq_sources[3] <= 1'b0;
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b1, "one-cycle falling event is captured");
        @(negedge clk);
        irq_sources[3] <= 1'b1;
        apb_write(8'h18, 32'h0000_0008, 4'b0001);
        check_bit(interrupt, 1'b0, "falling-edge W1C clears sticky pending");

        @(negedge clk);
        irq_sources[0] <= 1'b1;
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b1, "persistent level becomes pending");
        apb_write(8'h18, 32'h0000_0001, 4'b0001);
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b1, "persistent level re-pends after W1C");
        apb_write(8'h10, 32'h0000_0001, 4'b0001);
        check_bit(interrupt, 1'b0, "ENABLE_CLEAR masks a persistent pending source");
        apb_read(8'h04, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0001, "masking does not discard pending state");
        irq_sources[0] <= 1'b0;
        apb_write(8'h18, 32'h0000_0001, 4'b0001);

        reset_duts;
        apb_write(8'h14, 32'h8000_0000, 4'b1000);
        apb_write(8'h0c, 32'h8000_0000, 4'b1000);
        check_bit(interrupt, 1'b0, "IRQ_COUNT=20 ignores source 31 state");
        check_bit(interrupt_one, 1'b0, "IRQ_COUNT=1 ignores source 31 state");
        check_bit(interrupt_full, 1'b1, "IRQ_COUNT=32 accepts source 31 state");
        apb_read(8'h04, read_main, read_one, read_full);
        check_value(read_main, 32'h0000_0000, "main PENDING masks upper unused bits");
        check_value(read_one, 32'h0000_0000, "single-source PENDING masks upper unused bits");
        check_value(read_full, 32'h8000_0000, "full-width PENDING retains source 31");
        apb_read(8'h1c, read_main, read_one, read_full);
        check_value(read_full, 32'h8000_001f, "IRQ_COUNT=32 ACTIVE reports source 31");

        apb_write(8'h14, 32'h0000_0001, 4'b0001);
        apb_write(8'h0c, 32'h0000_0001, 4'b0001);
        check_bit(interrupt_one, 1'b1, "IRQ_COUNT=1 accepts source zero state");
        apb_read(8'h1c, read_main, read_one, read_full);
        check_value(read_one, 32'h8000_0000, "IRQ_COUNT=1 ACTIVE reports source zero");

        reset_duts;
        apb_write(8'h14, 32'h0000_0001, 4'b0001);
        apb_write(8'h0c, 32'h0000_0001, 4'b0001);
        check_bit(interrupt, 1'b1, "pre-reset state is active");
        @(negedge clk);
        resetn <= 1'b0;
        @(posedge clk);
        #1;
        check_bit(interrupt, 1'b0, "reset clears enables and pending in one clock");
        resetn <= 1'b1;

        if(failures == 0)
            $display("TEST PASS: apb_intc");
        else
            $display("TEST FAIL: apb_intc failures=%0d", failures);
        $finish(0);
    end

endmodule
