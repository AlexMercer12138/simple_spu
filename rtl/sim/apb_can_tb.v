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
    localparam ADDR_FIFO_THRESH  = 32'h0000_0038;
    localparam ADDR_ACCEPT_CODE  = 32'h0000_003c;
    localparam ADDR_ACCEPT_MASK  = 32'h0000_0040;
    localparam ADDR_IRQ_STATUS   = 32'h0000_0044;
    localparam ADDR_IRQ_ENABLE   = 32'h0000_0048;
    localparam ADDR_ERROR_COUNT  = 32'h0000_004c;
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
    wire        controller_bus;
    reg         external_bus_enable;
    reg         external_bus_bit;
    reg         bus_override_enable;
    reg         bus_override_bit;
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
    reg         loopback_parser_seen;
    reg         monitor_error_flag_a;
    reg         monitor_error_flag_b;
    integer     dominant_run_a;
    integer     dominant_run_b;
    integer     maximum_dominant_run_a;
    integer     maximum_dominant_run_b;
    reg  [14:0] external_crc;
    reg         external_stuff_last;
    integer     external_stuff_run;

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

    assign controller_bus = can_tx_a & can_tx_b &
                            (external_bus_enable ? external_bus_bit : 1'b1);
    assign can_bus = bus_override_enable ? bus_override_bit : controller_bus;

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
        if (monitor_loopback &&
            (apb_can_inst_a.can_core_inst.rx_phase != 3'd0))
            loopback_parser_seen <= 1'b1;
    end

    always @(negedge clk) begin
        if (monitor_error_flag_a &&
            apb_can_inst_a.can_core_inst.timing_bit_start) begin
            if (!can_tx_a) begin
                dominant_run_a = dominant_run_a + 1;
                if (dominant_run_a > maximum_dominant_run_a)
                    maximum_dominant_run_a = dominant_run_a;
            end else begin
                dominant_run_a = 0;
            end
        end

        if (monitor_error_flag_b &&
            apb_can_inst_b.can_core_inst.timing_bit_start) begin
            if (!can_tx_b) begin
                dominant_run_b = dominant_run_b + 1;
                if (dominant_run_b > maximum_dominant_run_b)
                    maximum_dominant_run_b = dominant_run_b;
            end else begin
                dominant_run_b = 0;
            end
        end
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

    function [14:0] tb_crc15_next;
        input [14:0] crc_in;
        input bit_in;
        reg feedback;
        begin
            feedback = bit_in ^ crc_in[14];
            tb_crc15_next = {crc_in[13:0], 1'b0};
            if (feedback)
                tb_crc15_next = tb_crc15_next ^ 15'h4599;
        end
    endfunction

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

    task wait_b_next_bit_start;
        begin
            @(negedge clk);
            while (apb_can_inst_b.can_core_inst.timing_bit_start)
                @(negedge clk);
            while (!apb_can_inst_b.can_core_inst.timing_bit_start)
                @(negedge clk);
        end
    endtask

    task external_send_bus_bit;
        input bit_value;
        begin
            external_bus_bit <= bit_value;
            wait_b_next_bit_start;
        end
    endtask

    task external_start_frame;
        begin
            @(negedge clk);
            external_bus_enable <= 1'b1;
            external_bus_bit <= 1'b0;
            while (apb_can_inst_b.can_core_inst.rx_phase == 3'd0)
                @(negedge clk);
            while (!apb_can_inst_b.can_core_inst.timing_bit_start)
                @(negedge clk);
            external_crc = tb_crc15_next(15'd0, 1'b0);
            external_stuff_last = 1'b0;
            external_stuff_run = 1;
        end
    endtask

    task external_send_raw_bit;
        input bit_value;
        input include_in_crc;
        begin
            if (external_stuff_run == 5) begin
                external_send_bus_bit(!external_stuff_last);
                external_stuff_last = !external_stuff_last;
                external_stuff_run = 1;
            end

            external_send_bus_bit(bit_value);
            if (include_in_crc)
                external_crc = tb_crc15_next(external_crc, bit_value);
            if (bit_value == external_stuff_last) begin
                external_stuff_run = external_stuff_run + 1;
            end else begin
                external_stuff_last = bit_value;
                external_stuff_run = 1;
            end
        end
    endtask

    task external_finish_stuffing;
        begin
            if (external_stuff_run == 5) begin
                external_send_bus_bit(!external_stuff_last);
                external_stuff_last = !external_stuff_last;
                external_stuff_run = 1;
            end
        end
    endtask

    task wait_core_b_idle;
        integer timeout_count;
        begin
            timeout_count = 0;
            while (((apb_can_inst_b.can_core_inst.state != 4'd1) ||
                    (apb_can_inst_b.can_core_inst.rx_phase != 3'd0)) &&
                   (timeout_count < 2000)) begin
                @(negedge clk);
                timeout_count = timeout_count + 1;
            end
            check_true("CAN core B returns to idle after error",
                       timeout_count < 2000);
        end
    endtask

    task wait_core_a_idle;
        integer timeout_count;
        begin
            timeout_count = 0;
            while (((apb_can_inst_a.can_core_inst.state != 5'd1) ||
                    (apb_can_inst_a.can_core_inst.rx_phase != 3'd0)) &&
                   (timeout_count < 2000)) begin
                @(negedge clk);
                timeout_count = timeout_count + 1;
            end
            check_true("CAN core A returns to idle after error",
                       timeout_count < 2000);
        end
    endtask

    task send_external_standard_frame;
        input [1:0] error_mode;
        integer bit_index;
        reg transmitted_crc_bit;
        reg [10:0] identifier;
        begin
            identifier = 11'h123;
            external_start_frame;
            for (bit_index = 10; bit_index >= 0;
                 bit_index = bit_index - 1)
                external_send_raw_bit(identifier[bit_index], 1'b1);
            external_send_raw_bit(1'b0, 1'b1);
            external_send_raw_bit(1'b0, 1'b1);
            external_send_raw_bit(1'b0, 1'b1);
            for (bit_index = 3; bit_index >= 0;
                 bit_index = bit_index - 1)
                external_send_raw_bit(1'b0, 1'b1);

            for (bit_index = 14; bit_index >= 0;
                 bit_index = bit_index - 1) begin
                transmitted_crc_bit = external_crc[bit_index];
                if ((error_mode == 2'd1) && (bit_index == 14))
                    transmitted_crc_bit = !transmitted_crc_bit;
                external_send_raw_bit(transmitted_crc_bit, 1'b0);
            end
            external_finish_stuffing;

            external_send_bus_bit(error_mode == 2'd2 ? 1'b0 : 1'b1);
            if (error_mode == 2'd0) begin
                external_send_bus_bit(1'b1);
                external_send_bus_bit(1'b1);
                for (bit_index = 0; bit_index < 7;
                     bit_index = bit_index + 1)
                    external_send_bus_bit(1'b1);
                for (bit_index = 0; bit_index < 3;
                     bit_index = bit_index + 1)
                    external_send_bus_bit(1'b1);
            end

            external_bus_bit <= 1'b1;
            if (error_mode != 2'd0)
                wait_core_b_idle;
            @(negedge clk);
            external_bus_enable <= 1'b0;
        end
    endtask

    task send_external_stuff_error;
        integer zero_index;
        begin
            external_start_frame;
            for (zero_index = 0; zero_index < 5;
                 zero_index = zero_index + 1)
                external_send_bus_bit(1'b0);
            external_bus_bit <= 1'b1;
            wait_core_b_idle;
            @(negedge clk);
            external_bus_enable <= 1'b0;
        end
    endtask

    task reset_node_b_for_external_frame;
        begin
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_CTRL, 32'h0000_0001);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_b(ADDR_ERROR_STATUS, 32'h0000_03ff);
            repeat (4) @(negedge clk);
        end
    endtask

    task check_node_b_error;
        input [2:0] expected_type;
        input [3:0] expected_field;
        input [4:0] expected_sticky_mask;
        begin
            wait_irq_b(16'h0040);
            apb_read_b(ADDR_ERROR_STATUS, read_data);
            check32("receiver error type", {29'd0, read_data[12:10]},
                    {29'd0, expected_type});
            check32("receiver error field", {28'd0, read_data[17:14]},
                    {28'd0, expected_field});
            check_true("receiver sticky error bit",
                       (read_data[4:0] & expected_sticky_mask) != 0);
            apb_read_b(ADDR_FIFO_STATUS, read_data);
            check32("invalid frame does not enter RX FIFO",
                    read_data & 32'h0000_ff00, 32'd0);
        end
    endtask

    task drive_bus_off_recovery_bit;
        input bit_value;
        begin
            @(negedge clk);
            bus_override_enable <= 1'b1;
            bus_override_bit <= bit_value;
            repeat (6) @(negedge clk);
            while (apb_can_inst_a.can_core_inst.timing_sample_point)
                @(negedge clk);
            while (!apb_can_inst_a.can_core_inst.timing_sample_point)
                @(negedge clk);
        end
    endtask

    task wait_running_a;
        input expected_running;
        integer timeout_count;
        begin
            timeout_count = 0;
            apb_read_a(ADDR_STATUS, read_data);
            while ((read_data[1] != expected_running) &&
                   (timeout_count < 5000)) begin
                timeout_count = timeout_count + 1;
                apb_read_a(ADDR_STATUS, read_data);
            end
            check_true("RUNNING reaches requested safe state",
                       read_data[1] == expected_running);
        end
    endtask

    task wait_tx_idle_a;
        integer timeout_count;
        begin
            timeout_count = 0;
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            while (((read_data[7:0] != 8'd0) || read_data[20]) &&
                   (timeout_count < 20000)) begin
                timeout_count = timeout_count + 1;
                apb_read_a(ADDR_FIFO_STATUS, read_data);
            end
            check_true("TX queue drains before timeout",
                       (read_data[7:0] == 8'd0) && !read_data[20]);
        end
    endtask

    task wait_irq_a;
        input [15:0] mask;
        begin
            poll_count = 0;
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            while (((read_data[15:0] & mask) == 0) &&
                   (poll_count < 50000)) begin
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
                   (poll_count < 50000)) begin
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
            loopback_parser_seen = 1'b0;

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
            check_true("loopback frame traverses RX parser",
                       loopback_parser_seen);
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
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check32("arbitration lost position for standard IDs",
                    {26'd0, read_data[23:18]}, 32'd2);
            apb_read_a(ADDR_STATUS, read_data);
            check_true("arbitration loser retains frame for retry",
                       read_data[5] && read_data[3]);
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
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check32("standard frame wins at SRR/RTR position",
                    {26'd0, read_data[23:18]}, 32'd11);
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
            apb_read_a(ADDR_STATUS, read_data);
            check_true("abort remains pending until safe boundary",
                       read_data[13] && read_data[3]);
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

    task test_transmit_protocol_errors;
        begin
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_a(ADDR_CTRL, 32'h0000_0001);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_a(ADDR_ERROR_STATUS, 32'h0000_03ff);
            dominant_run_a = 0;
            maximum_dominant_run_a = 0;
            monitor_error_flag_a = 1'b1;
            push_frame_a(29'h0000_0321, 1'b0, 1'b0, 4'd1, 64'h5a);
            wait_irq_a(16'h0050);
            wait_core_a_idle;
            monitor_error_flag_a = 1'b0;
            apb_read_a(ADDR_ERROR_COUNT, read_data);
            check32("ACK error increments TEC by eight",
                    read_data & 32'h0000_01ff, 32'd8);
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check_true("ACK error sticky status", read_data[3]);
            check32("ACK error type", {29'd0, read_data[12:10]}, 32'd4);
            check32("ACK error field", {28'd0, read_data[17:14]}, 32'd6);
            check_true("ACK error emits six dominant flag bits",
                       maximum_dominant_run_a >= 6);

            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_b(ADDR_CTRL, 32'h0000_0001);
            push_frame_a(29'h0000_0322, 1'b0, 1'b0, 4'd1, 64'ha5);
            wait_irq_a(16'h0002);
            apb_read_a(ADDR_ERROR_COUNT, read_data);
            check32("successful TX decrements TEC",
                    read_data & 32'h0000_01ff, 32'd7);

            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_a(ADDR_CTRL, 32'h0000_0001);
            apb_write_b(ADDR_CTRL, 32'h0000_0001);
            dominant_run_a = 0;
            maximum_dominant_run_a = 0;
            monitor_error_flag_a = 1'b1;
            push_frame_a(29'h0000_0400, 1'b0, 1'b0, 4'd0, 64'd0);
            while (!((apb_can_inst_a.can_core_inst.state == 4'd2) &&
                     (apb_can_inst_a.can_core_inst.raw_index > 8'd20) &&
                     !apb_can_inst_a.can_core_inst.tx_drive_reg))
                @(negedge clk);
            bus_override_bit <= 1'b1;
            bus_override_enable <= 1'b1;
            while (!apb_can_inst_a.can_core_inst.timing_sample_point)
                @(negedge clk);
            @(negedge clk);
            bus_override_enable <= 1'b0;
            wait_irq_a(16'h0050);
            wait_core_a_idle;
            monitor_error_flag_a = 1'b0;
            apb_read_a(ADDR_ERROR_COUNT, read_data);
            check32("Bit Error increments TEC by eight",
                    read_data & 32'h0000_01ff, 32'd8);
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check_true("Bit Error sticky status", read_data[4]);
            check32("Bit Error type", {29'd0, read_data[12:10]}, 32'd5);
            check32("Bit Error field", {28'd0, read_data[17:14]}, 32'd5);
            check_true("Bit Error emits six dominant flag bits",
                       maximum_dominant_run_a >= 6);
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            $display("[PASS] TRANSMIT_ERRORS");
        end
    endtask

    task test_receive_protocol_errors;
        begin
            reset_node_b_for_external_frame;
            dominant_run_b = 0;
            maximum_dominant_run_b = 0;
            monitor_error_flag_b = 1'b1;
            send_external_stuff_error;
            monitor_error_flag_b = 1'b0;
            check_node_b_error(3'd1, 4'd2, 5'b00001);
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("Stuff Error increments REC", read_data[23:16], 32'd1);
            check_true("Stuff Error emits active flag",
                       maximum_dominant_run_b >= 6);

            reset_node_b_for_external_frame;
            dominant_run_b = 0;
            maximum_dominant_run_b = 0;
            monitor_error_flag_b = 1'b1;
            send_external_standard_frame(2'd1);
            monitor_error_flag_b = 1'b0;
            check_node_b_error(3'd3, 4'd5, 5'b00100);
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("CRC Error increments REC", read_data[23:16], 32'd1);
            check_true("CRC Error emits active flag",
                       maximum_dominant_run_b >= 6);

            reset_node_b_for_external_frame;
            dominant_run_b = 0;
            maximum_dominant_run_b = 0;
            monitor_error_flag_b = 1'b1;
            send_external_standard_frame(2'd2);
            monitor_error_flag_b = 1'b0;
            check_node_b_error(3'd2, 4'd5, 5'b00010);
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("Form Error increments REC", read_data[23:16], 32'd1);
            check_true("Form Error emits active flag",
                       maximum_dominant_run_b >= 6);
            $display("[PASS] PROTOCOL_ERRORS");
        end
    endtask

    task test_error_confinement;
        begin
            reset_node_b_for_external_frame;
            for (i = 0; i < 127; i = i + 1)
                send_external_stuff_error;
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("REC reaches 127", read_data[23:16], 32'd127);
            apb_read_b(ADDR_STATUS, read_data);
            check_true("REC 127 remains Error Active", !read_data[8]);

            dominant_run_b = 0;
            maximum_dominant_run_b = 0;
            monitor_error_flag_b = 1'b1;
            send_external_stuff_error;
            monitor_error_flag_b = 1'b0;
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("REC reaches Error Passive threshold",
                    read_data[23:16], 32'd128);
            apb_read_b(ADDR_STATUS, read_data);
            check_true("receiver enters Error Passive", read_data[8]);
            wait_irq_b(16'h0100);
            check_true("Passive Error Flag stays recessive",
                       maximum_dominant_run_b < 6);

            send_external_standard_frame(2'd0);
            wait_irq_b(16'h0001);
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("valid RX normalizes REC from passive",
                    read_data[23:16], 32'd127);
            apb_read_b(ADDR_STATUS, read_data);
            check_true("valid RX leaves Error Passive", !read_data[8]);
            pop_and_check_frame_b(29'h0000_0123, 1'b0, 1'b0, 4'd0,
                                  64'd0);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            $display("[PASS] ERROR_CONFINEMENT");
        end
    endtask

    task test_bus_off_recovery;
        integer group_index;
        integer bit_index;
        begin
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_a(ADDR_CTRL, 32'h0000_0009);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            push_frame_a(29'h0000_0600, 1'b0, 1'b0, 4'd0, 64'd0);
            wait_irq_a(16'h0200);
            bus_override_enable <= 1'b1;
            bus_override_bit <= 1'b0;
            apb_read_a(ADDR_STATUS, read_data);
            check_true("TEC overflow enters Bus-off", read_data[9]);
            check_true("Bus-off keeps CAN TX recessive", can_tx_a);
            apb_read_a(ADDR_ERROR_COUNT, read_data);
            check_true("Bus-off TEC exceeds 255", read_data[8:0] > 9'd255);

            drive_bus_off_recovery_bit(1'b0);
            for (group_index = 0; group_index < 100;
                 group_index = group_index + 1)
                for (bit_index = 0; bit_index < 11;
                     bit_index = bit_index + 1)
                    drive_bus_off_recovery_bit(1'b1);

            for (bit_index = 0; bit_index < 5; bit_index = bit_index + 1)
                drive_bus_off_recovery_bit(1'b1);
            drive_bus_off_recovery_bit(1'b0);

            apb_write_b(ADDR_CTRL, 32'h0000_0001);
            for (group_index = 0; group_index < 27;
                 group_index = group_index + 1)
                for (bit_index = 0; bit_index < 11;
                     bit_index = bit_index + 1)
                    drive_bus_off_recovery_bit(1'b1);
            for (bit_index = 0; bit_index < 10; bit_index = bit_index + 1)
                drive_bus_off_recovery_bit(1'b1);

            check_true("127 groups plus ten bits remain Bus-off",
                       apb_can_inst_a.can_core_inst.bus_off);
            check_true("Bus recovery event waits for final bit",
                       !apb_can_inst_a.irq_status_reg[10]);
            drive_bus_off_recovery_bit(1'b1);
            bus_override_enable <= 1'b0;
            wait_irq_a(16'h0400);
            wait_irq_a(16'h0002);
            apb_read_a(ADDR_STATUS, read_data);
            check_true("Bus-off recovery returns Error Active",
                       !read_data[9] && !read_data[8] && !read_data[7]);
            apb_read_a(ADDR_ERROR_COUNT, read_data);
            check32("Bus-off recovery clears TEC and REC",
                    read_data & 32'h00ff_01ff, 32'd0);
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            $display("[PASS] BUS_OFF_RECOVERY");
        end
    endtask

    task test_modes_safe_stop_interrupts;
        begin
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_CTRL, 32'h0000_0003);
            dominant_run_b = 0;
            maximum_dominant_run_b = 0;
            monitor_error_flag_b = 1'b1;
            send_external_standard_frame(2'd1);
            wait_irq_b(16'h0040);
            apb_read_b(ADDR_ERROR_COUNT, read_data);
            check32("Listen-only error leaves counters unchanged",
                    read_data & 32'h00ff_01ff, 32'd0);
            check_true("Listen-only never drives an error flag",
                       maximum_dominant_run_b == 0);
            apb_write_b(ADDR_IRQ_STATUS, 32'h0000_ffff);
            send_external_standard_frame(2'd0);
            wait_irq_b(16'h0001);
            monitor_error_flag_b = 1'b0;
            pop_and_check_frame_b(29'h0000_0123, 1'b0, 1'b0, 4'd0,
                                  64'd0);

            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_b(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_a(ADDR_CTRL, 32'h0000_0009);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            push_frame_a(29'h0000_0700, 1'b0, 1'b0, 4'd8,
                         64'h7070_7070_7070_7070);
            wait_irq_a(16'h0040);
            apb_write_a(ADDR_BIT_TIMING, 32'h0000_0000);
            apb_write_a(ADDR_ACCEPT_CODE, 32'h1234_5678);
            apb_write_a(ADDR_CTRL, 32'h0000_000b);
            apb_read_a(ADDR_BIT_TIMING, read_data);
            check32("running core locks bit timing", read_data,
                    32'h0016_0001);
            apb_read_a(ADDR_ACCEPT_CODE, read_data);
            check32("running core locks acceptance code", read_data, 32'd0);
            apb_read_a(ADDR_CTRL, read_data);
            check32("running core locks mode bits", read_data,
                    32'h0000_0009);
            apb_read_a(ADDR_ERROR_STATUS, read_data);
            check_true("locked configuration reports error", read_data[9]);
            check_true("masked IRQ output remains low", !interrupt_a);
            apb_write_a(ADDR_IRQ_ENABLE, 32'h0000_4000);
            check_true("enabling pending IRQ asserts output", interrupt_a);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_4000);
            check_true("W1C deasserts enabled IRQ", !interrupt_a);

            apb_write_a(ADDR_CTRL, 32'h0000_0008);
            apb_read_a(ADDR_STATUS, read_data);
            check_true("stop request clears ENABLE before RUNNING",
                       !read_data[0] && read_data[1]);
            check_true("safe stop retains active retry frame", read_data[3]);
            wait_running_a(1'b0);
            apb_read_a(ADDR_STATUS, read_data);
            check_true("stopped core retains frame for re-enable",
                       read_data[3]);
            apb_write_b(ADDR_CTRL, 32'h0000_0001);
            apb_write_a(ADDR_CTRL, 32'h0000_0009);
            wait_irq_a(16'h0002);
            apb_read_a(ADDR_FIFO_STATUS, read_data);
            check_true("retained frame releases after successful retry",
                       !read_data[20]);
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_b(ADDR_CTRL, 32'h8000_0000);
            $display("[PASS] MODES");
            $display("[PASS] INTERRUPTS");
        end
    endtask

    task test_fifo_threshold_interrupts;
        begin
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            apb_write_a(ADDR_BIT_TIMING, 32'h0016_0001);
            apb_write_a(ADDR_FIFO_THRESH, 32'h0000_0202);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            apb_write_a(ADDR_IRQ_ENABLE, 32'h0000_0000);
            apb_write_a(ADDR_CTRL, 32'h0000_000d);

            push_frame_a(29'h0000_0101, 1'b0, 1'b0, 4'd0, 64'd0);
            wait_tx_idle_a;
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            check_true("RX below threshold has no crossing", !read_data[2]);
            push_frame_a(29'h0000_0102, 1'b0, 1'b0, 4'd0, 64'd0);
            wait_tx_idle_a;
            wait_irq_a(16'h0004);
            check_true("masked threshold IRQ leaves output low", !interrupt_a);
            apb_write_a(ADDR_IRQ_ENABLE, 32'h0000_0004);
            check_true("threshold pending obeys IRQ enable", interrupt_a);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0004);
            check_true("threshold W1C clears output", !interrupt_a);

            push_frame_a(29'h0000_0103, 1'b0, 1'b0, 4'd0, 64'd0);
            wait_tx_idle_a;
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            check_true("RX threshold does not retrigger while above",
                       !read_data[2]);
            apb_write_a(ADDR_RX_CMD, 32'h0000_0001);
            apb_write_a(ADDR_RX_CMD, 32'h0000_0001);
            push_frame_a(29'h0000_0104, 1'b0, 1'b0, 4'd0, 64'd0);
            wait_tx_idle_a;
            wait_irq_a(16'h0004);

            apb_write_a(ADDR_CTRL, 32'h0000_000c);
            wait_running_a(1'b0);
            apb_write_a(ADDR_CTRL, 32'h0000_030c);
            apb_write_a(ADDR_FIFO_THRESH, 32'h0000_0200);
            apb_write_a(ADDR_IRQ_ENABLE, 32'h0000_0008);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_ffff);
            push_frame_a(29'h0000_0201, 1'b0, 1'b0, 4'd0, 64'd0);
            push_frame_a(29'h0000_0202, 1'b0, 1'b0, 4'd0, 64'd0);
            push_frame_a(29'h0000_0203, 1'b0, 1'b0, 4'd0, 64'd0);
            push_frame_a(29'h0000_0204, 1'b0, 1'b0, 4'd0, 64'd0);
            apb_write_a(ADDR_CTRL, 32'h0000_000d);
            wait_irq_a(16'h0008);
            check_true("TX threshold crossing asserts IRQ", interrupt_a);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0008);
            wait_tx_idle_a;
            apb_read_a(ADDR_IRQ_STATUS, read_data);
            check_true("TX threshold does not retrigger while below",
                       !read_data[3]);

            apb_write_a(ADDR_CTRL, 32'h0000_000c);
            wait_running_a(1'b0);
            push_frame_a(29'h0000_0301, 1'b0, 1'b0, 4'd0, 64'd0);
            push_frame_a(29'h0000_0302, 1'b0, 1'b0, 4'd0, 64'd0);
            push_frame_a(29'h0000_0303, 1'b0, 1'b0, 4'd0, 64'd0);
            apb_write_a(ADDR_IRQ_STATUS, 32'h0000_0008);
            apb_write_a(ADDR_CTRL, 32'h0000_000d);
            wait_irq_a(16'h0008);
            apb_write_a(ADDR_CTRL, 32'h8000_0000);
            $display("[PASS] FIFO_THRESHOLDS");
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
        external_bus_enable = 1'b0;
        external_bus_bit = 1'b1;
        bus_override_enable = 1'b0;
        bus_override_bit = 1'b1;
        failures   = 0;
        cycle_count = 0;
        poll_count = 0;
        monitor_loopback = 1'b0;
        loopback_dominant_seen = 1'b0;
        loopback_parser_seen = 1'b0;
        monitor_error_flag_a = 1'b0;
        monitor_error_flag_b = 1'b0;
        dominant_run_a = 0;
        dominant_run_b = 0;
        maximum_dominant_run_a = 0;
        maximum_dominant_run_b = 0;
        external_crc = 15'd0;
        external_stuff_last = 1'b1;
        external_stuff_run = 0;
        read_data  = 32'd0;

        @(posedge rst_n);
        repeat (2) @(posedge clk);
        test_crc15;
        test_bit_timing;
        test_apb_fifo;
        test_loopback_frames;
        test_two_node_ack_filter;
        test_arbitration_retry_abort;
        test_transmit_protocol_errors;
        test_receive_protocol_errors;
        test_error_confinement;
        test_bus_off_recovery;
        test_modes_safe_stop_interrupts;
        test_fifo_threshold_interrupts;

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
