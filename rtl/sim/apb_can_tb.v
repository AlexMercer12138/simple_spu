`timescale 1ns / 1ps
//================================================================================
//  Module      : apb_can_tb
//  Description : Integrated testbench for the APB CAN peripheral
//================================================================================

module apb_can_tb;

    localparam CLK_PERIOD        = 10;
    localparam ADDR_CTRL         = 32'h0000_0000;
    localparam ADDR_BIT_TIMING   = 32'h0000_0004;
    localparam ADDR_STATUS       = 32'h0000_0008;
    localparam ADDR_TX_ID        = 32'h0000_000c;
    localparam ADDR_TX_CTRL      = 32'h0000_0010;
    localparam ADDR_TX_DATA0     = 32'h0000_0014;
    localparam ADDR_TX_DATA1     = 32'h0000_0018;
    localparam ADDR_TX_CMD       = 32'h0000_001c;
    localparam ADDR_RX_ID        = 32'h0000_0020;
    localparam ADDR_RX_CTRL      = 32'h0000_0024;
    localparam ADDR_RX_DATA0     = 32'h0000_0028;
    localparam ADDR_RX_DATA1     = 32'h0000_002c;
    localparam ADDR_RX_CMD       = 32'h0000_0030;
    localparam ADDR_FIFO_STATUS  = 32'h0000_0034;
    localparam ADDR_IRQ_STATUS   = 32'h0000_0044;
    localparam ADDR_ERROR_STATUS = 32'h0000_0050;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         psel_a;
    reg         penable_a;
    reg         pwrite_a;
    reg  [31:0] paddr_a;
    reg  [31:0] pwdata_a;
    wire        pready_a;
    wire        pslverr_a;
    wire [31:0] prdata_a;
    wire        interrupt_a;
    wire        can_tx_a;
    reg         psel_b;
    reg         penable_b;
    reg         pwrite_b;
    reg  [31:0] paddr_b;
    reg  [31:0] pwdata_b;
    wire        pready_b;
    wire        pslverr_b;
    wire [31:0] prdata_b;
    wire        interrupt_b;
    wire        can_tx_b;
    wire        can_bus;
    reg         crc_clear;
    reg         crc_enable;
    reg         crc_data_bit;
    wire [14:0] crc_value;
    wire [14:0] crc_next_value;
    reg         timing_enable;
    reg         timing_hard_sync_enable;
    reg         timing_resync_enable;
    reg         timing_can_rx;
    wire        timing_rx_bit;
    wire        timing_bit_start;
    wire        timing_sample_point;
    wire        timing_bit_end;

    integer     failures;
    integer     i;
    integer     crc_i;
    integer     cycle_count;
    integer     timing_start_cycle;
    integer     timing_sample_cycle;
    integer     timing_next_cycle;
    integer     poll_count;
    reg  [31:0] read_data;
    reg  [18:0] crc_bits;
    reg         monitor_loopback;
    reg         loopback_dominant_seen;

    apb_can #(
        .SYS_CLK_FREQ     (50_000_000),
        .DEFAULT_BIT_RATE (500_000   ),
        .TX_FIFO_DEPTH    (8         ),
        .RX_FIFO_DEPTH    (8         )
    ) apb_can_inst_a (
        .s_apb_pclk       (clk        ),
        .s_apb_presetn    (rst_n      ),
        .s_apb_psel       (psel_a     ),
        .s_apb_penable    (penable_a  ),
        .s_apb_pwrite     (pwrite_a   ),
        .s_apb_paddr      (paddr_a    ),
        .s_apb_pwdata     (pwdata_a   ),
        .s_apb_pready     (pready_a   ),
        .s_apb_pslverr    (pslverr_a  ),
        .s_apb_prdata     (prdata_a   ),
        .interrupt        (interrupt_a),
        .can_rx           (can_bus    ),
        .can_tx           (can_tx_a   )
    );

    apb_can #(
        .SYS_CLK_FREQ     (50_000_000),
        .DEFAULT_BIT_RATE (500_000   ),
        .TX_FIFO_DEPTH    (8         ),
        .RX_FIFO_DEPTH    (8         )
    ) apb_can_inst_b (
        .s_apb_pclk       (clk        ),
        .s_apb_presetn    (rst_n      ),
        .s_apb_psel       (psel_b     ),
        .s_apb_penable    (penable_b  ),
        .s_apb_pwrite     (pwrite_b   ),
        .s_apb_paddr      (paddr_b    ),
        .s_apb_pwdata     (pwdata_b   ),
        .s_apb_pready     (pready_b   ),
        .s_apb_pslverr    (pslverr_b  ),
        .s_apb_prdata     (prdata_b   ),
        .interrupt        (interrupt_b),
        .can_rx           (can_bus    ),
        .can_tx           (can_tx_b   )
    );

    assign can_bus = can_tx_a & can_tx_b;

    can_crc can_crc_inst (
        .clk            (clk           ),
        .rst_n          (rst_n         ),
        .clear          (crc_clear     ),
        .enable         (crc_enable    ),
        .data_bit       (crc_data_bit  ),
        .crc_value      (crc_value     ),
        .crc_next_value (crc_next_value)
    );

    can_bit_timing can_bit_timing_inst (
        .clk              (clk                    ),
        .rst_n            (rst_n                  ),
        .enable           (timing_enable          ),
        .hard_sync_enable (timing_hard_sync_enable),
        .resync_enable    (timing_resync_enable   ),
        .brp              (10'd1                  ),
        .sjw              (2'd1                   ),
        .tseg1            (4'd6                   ),
        .tseg2            (3'd1                   ),
        .can_rx           (timing_can_rx          ),
        .rx_bit           (timing_rx_bit          ),
        .bit_start        (timing_bit_start       ),
        .sample_point     (timing_sample_point    ),
        .bit_end          (timing_bit_end         )
    );

    always #(CLK_PERIOD / 2) clk = ~clk;

    always @(posedge clk) begin
        cycle_count <= cycle_count + 1;
        if (monitor_loopback && !can_tx_a)
            loopback_dominant_seen <= 1'b1;
    end

    initial #(CLK_PERIOD * 10) rst_n = 1'b1;

    task check32;
        input [8*80-1:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] %0s expected=%08x actual=%08x",
                         $time, name, expected, actual);
            end
        end
    endtask

    task check_true;
        input [8*80-1:0] name;
        input condition;
        begin
            if (!condition) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] %0s", $time, name);
            end
        end
    endtask

    task apb_idle_a;
        begin
            psel_a    <= 1'b0;
            penable_a <= 1'b0;
            pwrite_a  <= 1'b0;
            paddr_a   <= 32'd0;
            pwdata_a  <= 32'd0;
        end
    endtask

    task apb_idle_b;
        begin
            psel_b    <= 1'b0;
            penable_b <= 1'b0;
            pwrite_b  <= 1'b0;
            paddr_b   <= 32'd0;
            pwdata_b  <= 32'd0;
        end
    endtask

    task apb_write_a;
        input [31:0] address;
        input [31:0] data;
        integer wait_count;
        begin
            @(negedge clk);
            psel_a    <= 1'b1;
            penable_a <= 1'b0;
            pwrite_a  <= 1'b1;
            paddr_a   <= address;
            pwdata_a  <= data;
            @(negedge clk);
            penable_a <= 1'b1;
            wait_count = 0;
            while (!pready_a && (wait_count < 16)) begin
                @(negedge clk);
                wait_count = wait_count + 1;
            end
            if (!pready_a) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] APB write timeout address=%08x",
                         $time, address);
            end
            check_true("APB PSLVERR remains low", !pslverr_a);
            @(negedge clk);
            apb_idle_a;
            @(negedge clk);
            check_true("PREADY drops after transfer", !pready_a);
        end
    endtask

    task apb_read_a;
        input  [31:0] address;
        output [31:0] data;
        integer wait_count;
        begin
            @(negedge clk);
            psel_a    <= 1'b1;
            penable_a <= 1'b0;
            pwrite_a  <= 1'b0;
            paddr_a   <= address;
            pwdata_a  <= 32'd0;
            @(negedge clk);
            penable_a <= 1'b1;
            wait_count = 0;
            while (!pready_a && (wait_count < 16)) begin
                @(negedge clk);
                wait_count = wait_count + 1;
            end
            if (!pready_a) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] APB read timeout address=%08x",
                         $time, address);
            end
            data = prdata_a;
            check_true("APB PSLVERR remains low", !pslverr_a);
            @(negedge clk);
            apb_idle_a;
            @(negedge clk);
            check_true("PREADY drops after transfer", !pready_a);
        end
    endtask

    task apb_write_b;
        input [31:0] address;
        input [31:0] data;
        integer wait_count;
        begin
            @(negedge clk);
            psel_b    <= 1'b1;
            penable_b <= 1'b0;
            pwrite_b  <= 1'b1;
            paddr_b   <= address;
            pwdata_b  <= data;
            @(negedge clk);
            penable_b <= 1'b1;
            wait_count = 0;
            while (!pready_b && (wait_count < 16)) begin
                @(negedge clk);
                wait_count = wait_count + 1;
            end
            if (!pready_b) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] APB-B write timeout address=%08x",
                         $time, address);
            end
            check_true("APB-B PSLVERR remains low", !pslverr_b);
            @(negedge clk);
            apb_idle_b;
            @(negedge clk);
        end
    endtask

    task apb_read_b;
        input  [31:0] address;
        output [31:0] data;
        integer wait_count;
        begin
            @(negedge clk);
            psel_b    <= 1'b1;
            penable_b <= 1'b0;
            pwrite_b  <= 1'b0;
            paddr_b   <= address;
            pwdata_b  <= 32'd0;
            @(negedge clk);
            penable_b <= 1'b1;
            wait_count = 0;
            while (!pready_b && (wait_count < 16)) begin
                @(negedge clk);
                wait_count = wait_count + 1;
            end
            if (!pready_b) begin
                failures = failures + 1;
                $display("[%0t] [FAIL] APB-B read timeout address=%08x",
                         $time, address);
            end
            data = prdata_b;
            check_true("APB-B PSLVERR remains low", !pslverr_b);
            @(negedge clk);
            apb_idle_b;
            @(negedge clk);
        end
    endtask

    task push_standard_frame_a;
        input [10:0] identifier;
        input [3:0] dlc;
        input [63:0] payload;
        begin
            apb_write_a(ADDR_TX_ID, {21'd0, identifier});
            apb_write_a(ADDR_TX_CTRL, {28'd0, dlc});
            apb_write_a(ADDR_TX_DATA0, payload[31:0]);
            apb_write_a(ADDR_TX_DATA1, payload[63:32]);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
        end
    endtask

    task push_frame_a;
        input [28:0] identifier;
        input ide;
        input rtr;
        input [3:0] dlc;
        input [63:0] payload;
        begin
            apb_write_a(ADDR_TX_ID, {3'd0, identifier});
            apb_write_a(ADDR_TX_CTRL,
                        {26'd0, ide, rtr, dlc});
            apb_write_a(ADDR_TX_DATA0, payload[31:0]);
            apb_write_a(ADDR_TX_DATA1, payload[63:32]);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
        end
    endtask

    task push_frame_b;
        input [28:0] identifier;
        input ide;
        input rtr;
        input [3:0] dlc;
        input [63:0] payload;
        begin
            apb_write_b(ADDR_TX_ID, {3'd0, identifier});
            apb_write_b(ADDR_TX_CTRL,
                        {26'd0, ide, rtr, dlc});
            apb_write_b(ADDR_TX_DATA0, payload[31:0]);
            apb_write_b(ADDR_TX_DATA1, payload[63:32]);
            apb_write_b(ADDR_TX_CMD, 32'h0000_0001);
        end
    endtask

    task wait_irq_a;
        input [15:0] mask;
        begin
            poll_count = 0;
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            while (((read_data[15:0] & mask) == 0) &&
                   (poll_count < 5000)) begin
                poll_count = poll_count + 1;
                apb_read_a(ADDR_IRQ_STATUS, read_data);
            end
            check_true("IRQ arrives before timeout",
                       (read_data[15:0] & mask) != 0);
        end
    endtask

    task wait_irq_b;
        input [15:0] mask;
        begin
            poll_count = 0;
            apb_read_b(ADDR_IRQ_STATUS, read_data);
            while (((read_data[15:0] & mask) == 0) &&
                   (poll_count < 5000)) begin
                poll_count = poll_count + 1;
                apb_read_b(ADDR_IRQ_STATUS, read_data);
            end
            check_true("IRQ-B arrives before timeout",
                       (read_data[15:0] & mask) != 0);
        end
    endtask

    task pop_and_check_frame_a;
        input [28:0] expected_id;
        input expected_ide;
        input expected_rtr;
        input [3:0] expected_dlc;
        input [63:0] expected_payload;
        begin
            apb_write_a(ADDR_RX_CMD, 32'h0000_0001);
            apb_read_a(ADDR_RX_ID, read_data);
            check32("loopback RX ID", read_data, {3'd0, expected_id});
            apb_read_a(ADDR_RX_CTRL, read_data);
            check32("loopback RX control", read_data,
                    {26'd0, expected_ide, expected_rtr, expected_dlc});
            apb_read_a(ADDR_RX_DATA0, read_data);
            check32("loopback RX data bytes 0-3", read_data,
                    expected_payload[31:0]);
            apb_read_a(ADDR_RX_DATA1, read_data);
            check32("loopback RX data bytes 4-7", read_data,
                    expected_payload[63:32]);
        end
    endtask

    task pop_and_check_frame_b;
        input [28:0] expected_id;
        input expected_ide;
        input expected_rtr;
        input [3:0] expected_dlc;
        input [63:0] expected_payload;
        begin
            apb_write_b(ADDR_RX_CMD, 32'h0000_0001);
            apb_read_b(ADDR_RX_ID, read_data);
            check32("node B RX ID", read_data, {3'd0, expected_id});
            apb_read_b(ADDR_RX_CTRL, read_data);
            check32("node B RX control", read_data,
                    {26'd0, expected_ide, expected_rtr, expected_dlc});
            apb_read_b(ADDR_RX_DATA0, read_data);
            check32("node B RX data bytes 0-3", read_data,
                    expected_payload[31:0]);
            apb_read_b(ADDR_RX_DATA1, read_data);
            check32("node B RX data bytes 4-7", read_data,
                    expected_payload[63:32]);
        end
    endtask

    task push_crc_bit;
        input bit_value;
        begin
            @(negedge clk);
            crc_data_bit <= bit_value;
            crc_enable <= 1'b1;
            @(negedge clk);
            crc_enable <= 1'b0;
            crc_data_bit <= 1'b0;
        end
    endtask

    task test_crc15;
        begin
            check32("CRC reset value", {17'd0, crc_value}, 32'd0);
            @(negedge clk);
            crc_clear <= 1'b1;
            crc_enable <= 1'b1;
            crc_data_bit <= 1'b1;
            @(negedge clk);
            crc_clear <= 1'b0;
            crc_enable <= 1'b0;
            crc_data_bit <= 1'b0;
            check32("CRC clear has priority", {17'd0, crc_value}, 32'd0);

            crc_bits = 19'b0_00100100011_0_0_0_0010;
            for (crc_i = 18; crc_i >= 0; crc_i = crc_i - 1)
                push_crc_bit(crc_bits[crc_i]);

            check32("CRC known vector", {17'd0, crc_value}, 32'h0000_26f3);
            repeat (3) @(posedge clk);
            check32("CRC holds while disabled", {17'd0, crc_value},
                    32'h0000_26f3);
            $display("[PASS] CRC15");
        end
    endtask

    task wait_timing_pulse;
        input [1:0] pulse_select;
        integer timeout_count;
        reg pulse_value;
        begin
            timeout_count = 0;
            pulse_value = 1'b0;
            while (!pulse_value && (timeout_count < 80)) begin
                @(negedge clk);
                case (pulse_select)
                    2'd0: pulse_value = timing_bit_start;
                    2'd1: pulse_value = timing_sample_point;
                    default: pulse_value = timing_bit_end;
                endcase
                timeout_count = timeout_count + 1;
            end
            check_true("timing pulse arrives before timeout", pulse_value);
        end
    endtask

    task test_bit_timing;
        begin
            @(negedge clk);
            timing_enable <= 1'b1;
            wait_timing_pulse(2'd0);
            timing_start_cycle = cycle_count;
            wait_timing_pulse(2'd1);
            timing_sample_cycle = cycle_count;
            check32("sample point is eight TQ after bit start",
                    timing_sample_cycle - timing_start_cycle, 32'd16);
            wait_timing_pulse(2'd0);
            timing_next_cycle = cycle_count;
            check32("nominal bit is ten TQ",
                    timing_next_cycle - timing_start_cycle, 32'd20);
            check_true("bit end coincides with next start", timing_bit_end);

            timing_hard_sync_enable <= 1'b1;
            timing_can_rx <= 1'b1;
            repeat (4) @(negedge clk);
            timing_can_rx <= 1'b0;
            wait_timing_pulse(2'd0);
            timing_start_cycle = cycle_count;
            wait_timing_pulse(2'd1);
            timing_sample_cycle = cycle_count;
            check32("hard-sync sample offset",
                    timing_sample_cycle - timing_start_cycle, 32'd16);

            @(negedge clk);
            timing_enable <= 1'b0;
            timing_hard_sync_enable <= 1'b0;
            timing_can_rx <= 1'b1;
            repeat (4) @(negedge clk);

            timing_enable <= 1'b1;
            wait_timing_pulse(2'd0);
            timing_start_cycle = cycle_count;
            repeat (4) @(negedge clk);
            timing_can_rx <= 1'b0;
            wait_timing_pulse(2'd0);
            timing_next_cycle = cycle_count;
            check32("positive resync is limited by SJW",
                    timing_next_cycle - timing_start_cycle, 32'd24);

            timing_can_rx <= 1'b1;
            repeat (4) @(negedge clk);
            wait_timing_pulse(2'd0);
            timing_start_cycle = cycle_count;
            repeat (14) @(negedge clk);
            timing_can_rx <= 1'b0;
            wait_timing_pulse(2'd0);
            timing_next_cycle = cycle_count;
            check32("negative resync shortens TSEG2",
                    timing_next_cycle - timing_start_cycle, 32'd18);

            @(negedge clk);
            timing_enable <= 1'b0;
            timing_can_rx <= 1'b1;
            $display("[PASS] BIT_TIMING");
        end
    endtask

    task test_apb_fifo;
        begin
            apb_read_a(ADDR_CTRL, read_data);
            check32("CTRL reset value", read_data, 32'h0000_0008);
            apb_read_a(ADDR_BIT_TIMING, read_data);
            check32("BIT_TIMING reset value", read_data, 32'h0016_0009);
            apb_read_a(ADDR_STATUS, read_data);
            check32("STATUS reset value", read_data, 32'h0000_1000);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("FIFO_STATUS reset empty", read_data, 32'h0005_0000);
            apb_read_a(32'h0000_00fc, read_data);
            check32("undefined read returns zero", read_data, 32'd0);

            apb_write_a(ADDR_TX_ID, 32'h0000_0123);
            apb_write_a(ADDR_TX_CTRL, 32'h0000_0009);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("invalid DLC is rejected", read_data & 32'h0000_00ff,
                    32'd0);

            apb_write_a(ADDR_TX_ID, 32'h0000_0800);
            apb_write_a(ADDR_TX_CTRL, 32'h0000_0001);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0001);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("invalid standard ID is rejected",
                    read_data & 32'h0000_00ff, 32'd0);

            for (i = 0; i < 8; i = i + 1)
                push_standard_frame_a(i[10:0], 4'd1,
                                      64'h8877_6655_4433_2200 + i);

            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("TX FIFO reaches depth eight",
                    read_data & 32'h0003_00ff, 32'h0002_0008);

            push_standard_frame_a(11'h055, 4'd1, 64'h55);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("full TX FIFO rejects ninth frame",
                    read_data & 32'h0003_00ff, 32'h0002_0008);
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            check_true("TX overflow interrupt status", read_data[12]);
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check_true("TX overflow error status", read_data[7]);
            check_true("invalid frame config status", read_data[9]);

            apb_write_a(ADDR_CTRL, 32'h0000_0108);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check32("TX clear empties FIFO", read_data & 32'h0003_00ff,
                    32'h0001_0000);
            $display("[PASS] APB_FIFO");
        end
    endtask

    task test_loopback_frames;
        begin
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_a(ADDR_ERROR_STATUS, 32'h0000_03ff);
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_a(ADDR_CTRL, 32'h0000_000d);
            monitor_loopback = 1'b1;
            loopback_dominant_seen = 1'b0;

            push_frame_a(29'h0000_0123, 1'b0, 1'b0, 4'd0, 64'd0);
            wait_irq_a(16'h0003);
            pop_and_check_frame_a(29'h0000_0123, 1'b0, 1'b0, 4'd0,
                                  64'd0);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0003);

            push_frame_a(29'h0000_0456, 1'b0, 1'b0, 4'd8,
                         64'h8877_6655_4433_2211);
            wait_irq_a(16'h0003);
            pop_and_check_frame_a(29'h0000_0456, 1'b0, 1'b0, 4'd8,
                                  64'h8877_6655_4433_2211);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0003);

            push_frame_a(29'h01ab_cdef, 1'b1, 1'b0, 4'd8,
                         64'h0123_4567_89ab_cdef);
            wait_irq_a(16'h0003);
            pop_and_check_frame_a(29'h01ab_cdef, 1'b1, 1'b0, 4'd8,
                                  64'h0123_4567_89ab_cdef);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0003);

            push_frame_a(29'h0000_0321, 1'b0, 1'b1, 4'd4,
                         64'hffff_ffff_ffff_ffff);
            wait_irq_a(16'h0003);
            pop_and_check_frame_a(29'h0000_0321, 1'b0, 1'b1, 4'd4,
                                  64'd0);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0003);

            push_frame_a(29'h0123_4567, 1'b1, 1'b1, 4'd8,
                         64'hffff_ffff_ffff_ffff);
            wait_irq_a(16'h0003);
            pop_and_check_frame_a(29'h0123_4567, 1'b1, 1'b1, 4'd8,
                                  64'd0);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0003);

            monitor_loopback = 1'b0;
            check_true("loopback keeps external CAN TX recessive",
                       !loopback_dominant_seen);
            apb_write_a(ADDR_CTRL, 32'h0000_000c);
            $display("[PASS] LOOPBACK_FRAMES");
        end
    endtask

    task test_two_node_ack_filter;
        begin
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(32'h0000_003c, 32'h0000_048c);
            apb_write_b(32'h0000_0040, 32'h0000_1fff);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_a(ADDR_CTRL, 32'h0000_0009);
            apb_write_b(ADDR_CTRL, 32'h0000_0019);
            push_frame_a(29'h0000_0123, 1'b0, 1'b0, 4'd8,
                         64'h0807_0605_0403_0201);
            wait_irq_a(16'h0002);
            wait_irq_b(16'h0001);
            pop_and_check_frame_b(29'h0000_0123, 1'b0, 1'b0, 4'd8,
                                  64'h0807_0605_0403_0201);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0002);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_0001);

            push_frame_a(29'h0000_0124, 1'b0, 1'b0, 4'd1, 64'h5a);
            wait_irq_a(16'h0002);
            apb_read_b(ADDR_FIFO_STATUS, read_data);
            check32("filtered frame does not enter RX FIFO",
                    read_data & 32'h0000_ff00, 32'd0);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0002);

            apb_write_b(ADDR_CTRL, 32'h0000_0018);
            apb_write_b(ADDR_CTRL, 32'h0000_0008);
            apb_write_b(ADDR_CTRL, 32'h0000_0209);

            push_frame_a(29'h01ab_cdef, 1'b1, 1'b0, 4'd2,
                         64'h0000_0000_0000_a55a);
            wait_irq_a(16'h0002);
            wait_irq_b(16'h0001);
            pop_and_check_frame_b(29'h01ab_cdef, 1'b1, 1'b0, 4'd2,
                                  64'h0000_0000_0000_a55a);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0002);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_0001);

            push_frame_a(29'h0000_0321, 1'b0, 1'b1, 4'd4,
                         64'hffff_ffff_ffff_ffff);
            wait_irq_a(16'h0002);
            wait_irq_b(16'h0001);
            pop_and_check_frame_b(29'h0000_0321, 1'b0, 1'b1, 4'd4,
                                  64'd0);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0002);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_0001);

            for (i = 0; i < 8; i = i + 1) begin
                push_frame_a(29'h0000_0200 + i, 1'b0, 1'b0, 4'd1, i);
                wait_irq_a(16'h0002);
                apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0002);
            end
            apb_read_b(ADDR_FIFO_STATUS, read_data);
            check32("node B RX FIFO reaches depth eight",
                    read_data & 32'h000c_ff00, 32'h0008_0800);

            push_frame_a(29'h0000_0300, 1'b0, 1'b0, 4'd1, 64'hff);
            wait_irq_a(16'h0002);
            wait_irq_b(16'h0800);
            apb_read_b(ADDR_FIFO_STATUS, read_data);
            check32("RX overflow keeps existing FIFO contents",
                    read_data & 32'h000c_ff00, 32'h0008_0800);

            apb_write_a(ADDR_CTRL, 32'h0000_0008);
            apb_write_b(ADDR_CTRL, 32'h0000_0008);
            $display("[PASS] TWO_NODE_ACK");
            $display("[PASS] ACCEPT_FILTER");
        end
    endtask

    task prepare_arbitration_nodes;
        input [4:0] ctrl_a_disabled;
        begin
            apb_write_a(ADDR_CTRL, {22'd0, 1'b1, 4'd0,
                                    ctrl_a_disabled});
            apb_write_b(ADDR_CTRL, 32'h0000_0208);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_a(ADDR_ERROR_STATUS, 32'h0000_03ff);
            apb_write_b(ADDR_ERROR_STATUS, 32'h0000_03ff);
        end
    endtask

    task test_arbitration_retry_abort;
        begin
            prepare_arbitration_nodes(5'b01000);
            push_frame_a(29'h0000_0120, 1'b0, 1'b0, 4'd1, 64'ha1);
            push_frame_b(29'h0000_0080, 1'b0, 1'b0, 4'd1, 64'hb2);
            fork
                apb_write_a(ADDR_CTRL, 32'h0000_0009);
                apb_write_b(ADDR_CTRL, 32'h0000_0009);
            join
            wait_irq_a(16'h0020);
            wait_irq_b(16'h0002);
            wait_irq_a(16'h0002);
            wait_irq_a(16'h0001);
            wait_irq_b(16'h0001);
            pop_and_check_frame_a(29'h0000_0080, 1'b0, 1'b0, 4'd1,
                                  64'hb2);
            pop_and_check_frame_b(29'h0000_0120, 1'b0, 1'b0, 4'd1,
                                  64'ha1);
            apb_write_a(ADDR_CTRL, 32'h0000_0008);
            apb_write_b(ADDR_CTRL, 32'h0000_0008);

            prepare_arbitration_nodes(5'b01000);
            push_frame_a(29'h048c_0001, 1'b1, 1'b0, 4'd1, 64'he1);
            push_frame_b(29'h0000_0123, 1'b0, 1'b0, 4'd1, 64'h53);
            fork
                apb_write_a(ADDR_CTRL, 32'h0000_0009);
                apb_write_b(ADDR_CTRL, 32'h0000_0009);
            join
            wait_irq_a(16'h0020);
            wait_irq_b(16'h0002);
            wait_irq_a(16'h0002);
            pop_and_check_frame_a(29'h0000_0123, 1'b0, 1'b0, 4'd1,
                                  64'h53);
            pop_and_check_frame_b(29'h048c_0001, 1'b1, 1'b0, 4'd1,
                                  64'he1);
            apb_write_a(ADDR_CTRL, 32'h0000_0008);
            apb_write_b(ADDR_CTRL, 32'h0000_0008);

            prepare_arbitration_nodes(5'b00000);
            push_frame_a(29'h0000_0550, 1'b0, 1'b0, 4'd1, 64'h55);
            push_frame_b(29'h0000_0010, 1'b0, 1'b0, 4'd1, 64'h10);
            fork
                apb_write_a(ADDR_CTRL, 32'h0000_0001);
                apb_write_b(ADDR_CTRL, 32'h0000_0009);
            join
            wait_irq_a(16'h0020);
            wait_irq_a(16'h0010);
            wait_irq_b(16'h0002);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check_true("one-shot arbitration loser releases active frame",
                       !read_data[20]);
            apb_write_a(ADDR_CTRL, 32'h0000_0000);
            apb_write_b(ADDR_CTRL, 32'h0000_0008);

            prepare_arbitration_nodes(5'b01000);
            push_frame_a(29'h0000_0700, 1'b0, 1'b0, 4'd8,
                         64'h0707_0707_0707_0707);
            push_frame_b(29'h0000_0001, 1'b0, 1'b0, 4'd8,
                         64'h0101_0101_0101_0101);
            fork
                apb_write_a(ADDR_CTRL, 32'h0000_0009);
                apb_write_b(ADDR_CTRL, 32'h0000_0009);
            join
            wait_irq_a(16'h0020);
            apb_write_a(ADDR_TX_CMD, 32'h0000_0002);
            wait_irq_a(16'h8000);
            wait_irq_b(16'h0002);
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            check_true("aborted arbitration loser is not TX done",
                       !read_data[1]);
            apb_write_a(ADDR_CTRL, 32'h0000_0008);
            apb_write_b(ADDR_CTRL, 32'h0000_0008);
            $display("[PASS] ARBITRATION_RETRY");
            $display("[PASS] SAFE_ABORT");
        end
    endtask

    initial begin
        // $dumpfile("apb_can_tb.vcd");
        // $dumpvars(0, apb_can_tb);
        psel_a     = 1'b0;
        penable_a  = 1'b0;
        pwrite_a   = 1'b0;
        paddr_a    = 32'd0;
        pwdata_a   = 32'd0;
        psel_b     = 1'b0;
        penable_b  = 1'b0;
        pwrite_b   = 1'b0;
        paddr_b    = 32'd0;
        pwdata_b   = 32'd0;
        crc_clear  = 1'b0;
        crc_enable = 1'b0;
        crc_data_bit = 1'b0;
        timing_enable = 1'b0;
        timing_hard_sync_enable = 1'b0;
        timing_resync_enable = 1'b1;
        timing_can_rx = 1'b1;
        failures   = 0;
        cycle_count = 0;
        poll_count = 0;
        monitor_loopback = 1'b0;
        loopback_dominant_seen = 1'b0;
        read_data  = 32'd0;

        @(posedge rst_n);
        repeat (2) @(posedge clk);
        test_crc15;
        test_bit_timing;
        test_apb_fifo;
        test_loopback_frames;
        test_two_node_ack_filter;
        test_arbitration_retry_abort;

        if (failures == 0)
            $display("APB CAN TEST PASS");
        else
            $display("APB CAN TEST FAIL: %0d failures", failures);
        $finish;
    end

    initial begin
        #(CLK_PERIOD * 1000000);
        failures = failures + 1;
        $display("[FAIL] APB CAN TEST TIMEOUT");
        $finish;
    end

endmodule
