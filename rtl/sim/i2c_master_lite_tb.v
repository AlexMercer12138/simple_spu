`timescale 1ns/1ps

module i2c_master_lite_tb;

    localparam CLK_PERIOD = 10;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         enable = 1'b0;
    reg         cmd_start = 1'b0;
    reg  [1:0]  cmd_op = 2'b00;
    reg  [6:0]  cmd_addr = 7'h00;
    reg  [7:0]  cmd_tx_len = 8'd0;
    reg  [7:0]  cmd_rx_len = 8'd0;
    reg  [15:0] scl_prescale = 16'd1;
    reg  [31:0] timeout_cycles = 32'd1000;
    reg  [7:0]  tx_data = 8'h00;
    reg         tx_valid = 1'b0;
    wire        tx_ready;
    wire [7:0]  rx_data;
    wire        rx_valid;
    reg         rx_ready = 1'b1;
    wire        busy;
    wire        done;
    wire        addr_nack;
    wire        data_nack;
    wire        arbitration_lost;
    wire        timeout;
    wire        bus_error;
    wire [7:0]  tx_count;
    wire [7:0]  rx_count;
    reg         abort = 1'b0;
    wire        scl_o;
    wire        scl_t;
    wire        sda_o;
    wire        sda_t;

    reg         slave_sda_low = 1'b0;
    reg         force_sda_low = 1'b0;
    reg         force_scl_low = 1'b0;
    wire        scl_line;
    wire        sda_line;

    reg  [7:0]  tx_memory [0:2];
    integer     tx_index = 0;
    reg  [7:0]  slave_rx [0:15];
    reg  [7:0]  master_rx [0:15];
    integer     slave_rx_count = 0;
    integer     master_rx_count = 0;
    integer     master_ack_count = 0;
    integer     master_nack_count = 0;
    integer     start_count = 0;
    integer     stop_count = 0;
    integer     dut_stop_count = 0;
    integer     restart_count = 0;
    reg         bus_active = 1'b0;
    integer     error_count = 0;
    integer     wait_count;
    integer     clock_count = 0;
    integer     stretch_start_clock = 0;
    integer     stretch_wait_clocks = 0;
    integer     measured_scl_period = 0;
    integer     first_scl_clock = 0;
    reg         done_seen = 1'b0;
    reg         addr_nack_seen = 1'b0;
    reg         data_nack_seen = 1'b0;
    reg         arbitration_seen = 1'b0;
    reg         timeout_seen = 1'b0;
    reg         bus_error_seen = 1'b0;
    reg  [7:0]  sampled_byte;

    assign scl_line = (scl_t && !force_scl_low) ? 1'b1 : scl_o;
    assign sda_line = (sda_t && !slave_sda_low && !force_sda_low) ? 1'b1 : 1'b0;

    i2c_master_lite i2c_master_lite_inst (
        .clk              (clk),
        .rst_n            (rst_n),
        .enable           (enable),
        .cmd_start        (cmd_start),
        .cmd_op           (cmd_op),
        .cmd_addr         (cmd_addr),
        .cmd_tx_len       (cmd_tx_len),
        .cmd_rx_len       (cmd_rx_len),
        .scl_prescale     (scl_prescale),
        .timeout_cycles   (timeout_cycles),
        .tx_data          (tx_data),
        .tx_valid         (tx_valid),
        .tx_ready         (tx_ready),
        .rx_data          (rx_data),
        .rx_valid         (rx_valid),
        .rx_ready         (rx_ready),
        .busy             (busy),
        .done             (done),
        .addr_nack        (addr_nack),
        .data_nack        (data_nack),
        .arbitration_lost (arbitration_lost),
        .timeout          (timeout),
        .bus_error        (bus_error),
        .tx_count         (tx_count),
        .rx_count         (rx_count),
        .abort            (abort),
        .scl_o            (scl_o),
        .scl_t            (scl_t),
        .scl_i            (scl_line),
        .sda_o            (sda_o),
        .sda_t            (sda_t),
        .sda_i            (sda_line)
    );

    always #(CLK_PERIOD/2) clk = ~clk;

    always @(posedge clk)
        clock_count <= clock_count + 1;

    initial #(CLK_PERIOD*5) rst_n = 1'b1;

    always @(posedge clk) begin
        if (!rst_n) begin
            tx_index <= 0;
            tx_data <= 8'h00;
            tx_valid <= 1'b0;
        end else begin
            if (enable && (tx_index < 3)) begin
                tx_data <= tx_memory[tx_index];
                tx_valid <= 1'b1;
            end else begin
                tx_valid <= 1'b0;
            end
            if (tx_ready && tx_valid)
                tx_index <= tx_index + 1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            master_rx_count <= 0;
        end else if (rx_valid && rx_ready) begin
            master_rx[master_rx_count] <= rx_data;
            master_rx_count <= master_rx_count + 1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            done_seen <= 1'b0;
            addr_nack_seen <= 1'b0;
            data_nack_seen <= 1'b0;
            arbitration_seen <= 1'b0;
            timeout_seen <= 1'b0;
            bus_error_seen <= 1'b0;
        end else begin
            if (done)
                done_seen <= 1'b1;
            if (addr_nack)
                addr_nack_seen <= 1'b1;
            if (data_nack)
                data_nack_seen <= 1'b1;
            if (arbitration_lost)
                arbitration_seen <= 1'b1;
            if (timeout)
                timeout_seen <= 1'b1;
            if (bus_error)
                bus_error_seen <= 1'b1;
        end
    end

    always @(negedge sda_line) begin
        if (scl_line) begin
            start_count <= start_count + 1;
            if (bus_active)
                restart_count <= restart_count + 1;
            bus_active <= 1'b1;
        end
    end

    always @(posedge sda_line) begin
        if (scl_line && bus_active) begin
            stop_count <= stop_count + 1;
            bus_active <= 1'b0;
        end
    end

    always @(posedge sda_t) begin
        if (scl_line)
            dut_stop_count <= dut_stop_count + 1;
    end

    task sample_i2c_byte;
        output [7:0] value;
        integer bit_index;
        begin
            for (bit_index = 7; bit_index >= 0; bit_index = bit_index - 1) begin
                @(posedge scl_line);
                value[bit_index] = sda_line;
            end
        end
    endtask

    task drive_ack;
        begin
            @(negedge scl_line);
            slave_sda_low <= 1'b1;
            @(negedge scl_line);
            slave_sda_low <= 1'b0;
        end
    endtask

    task drive_i2c_byte;
        input [7:0] value;
        integer bit_index;
        begin
            for (bit_index = 7; bit_index >= 0; bit_index = bit_index - 1) begin
                slave_sda_low <= ~value[bit_index];
                @(negedge scl_line);
            end
            slave_sda_low <= 1'b0;
        end
    endtask

    task sample_master_ack;
        begin
            @(posedge scl_line);
            if (sda_line)
                master_nack_count = master_nack_count + 1;
            else
                master_ack_count = master_ack_count + 1;
            @(negedge scl_line);
        end
    endtask

    task run_behavioral_slave_write;
        integer byte_index;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            if (sampled_byte !== {7'h52, 1'b0}) begin
                $display("[FAIL] address byte expected=%02h actual=%02h",
                         {7'h52, 1'b0}, sampled_byte);
                error_count = error_count + 1;
            end
            drive_ack;
            for (byte_index = 0; byte_index < 3; byte_index = byte_index + 1) begin
                sample_i2c_byte(sampled_byte);
                slave_rx[byte_index] = sampled_byte;
                slave_rx_count = slave_rx_count + 1;
                drive_ack;
            end
        end
    endtask

    task run_behavioral_slave_read;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            if (sampled_byte !== {7'h52, 1'b1}) begin
                $display("[FAIL] read address expected=%02h actual=%02h",
                         {7'h52, 1'b1}, sampled_byte);
                error_count = error_count + 1;
            end
            drive_ack;
            drive_i2c_byte(8'hA1);
            sample_master_ack;
            drive_i2c_byte(8'hB2);
            sample_master_ack;
            drive_i2c_byte(8'hC3);
            sample_master_ack;
        end
    endtask

    task run_behavioral_slave_write_read;
        integer byte_index;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            if (sampled_byte !== {7'h52, 1'b0}) begin
                $display("[FAIL] combined write address expected=%02h actual=%02h",
                         {7'h52, 1'b0}, sampled_byte);
                error_count = error_count + 1;
            end
            drive_ack;
            for (byte_index = 0; byte_index < 2; byte_index = byte_index + 1) begin
                sample_i2c_byte(sampled_byte);
                slave_rx[byte_index] = sampled_byte;
                slave_rx_count = slave_rx_count + 1;
                drive_ack;
            end

            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            if (sampled_byte !== {7'h52, 1'b1}) begin
                $display("[FAIL] combined read address expected=%02h actual=%02h",
                         {7'h52, 1'b1}, sampled_byte);
                error_count = error_count + 1;
            end
            drive_ack;
            drive_i2c_byte(8'h91);
            sample_master_ack;
            drive_i2c_byte(8'h92);
            sample_master_ack;
            drive_i2c_byte(8'h93);
            sample_master_ack;
        end
    endtask

    task run_behavioral_address_nack;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            wait (done);
        end
    endtask

    task run_behavioral_second_data_nack;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            drive_ack;
            sample_i2c_byte(sampled_byte);
            slave_rx[0] = sampled_byte;
            drive_ack;
            sample_i2c_byte(sampled_byte);
            slave_rx[1] = sampled_byte;
            wait (done);
        end
    endtask

    task run_behavioral_single_write;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            drive_ack;
            sample_i2c_byte(sampled_byte);
            slave_rx[0] = sampled_byte;
            drive_ack;
        end
    endtask

    task run_behavioral_abort_write;
        begin
            @(negedge sda_line);
            sample_i2c_byte(sampled_byte);
            drive_ack;
            sample_i2c_byte(sampled_byte);
            slave_rx[0] = sampled_byte;
            drive_ack;
            wait (done);
        end
    endtask

    task check_equal;
        input [8*48-1:0] test_name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s expected=%08h actual=%08h",
                         test_name, expected, actual);
                error_count = error_count + 1;
            end else begin
                $display("[PASS] %0s value=%08h", test_name, actual);
            end
        end
    endtask

    task start_write_command;
        begin
            @(posedge clk);
            enable <= 1'b1;
            cmd_op <= 2'b00;
            cmd_addr <= 7'h52;
            cmd_tx_len <= 8'd3;
            cmd_rx_len <= 8'd0;
            @(posedge clk);
            cmd_start <= 1'b1;
            @(posedge clk);
            cmd_start <= 1'b0;
        end
    endtask

    task start_read_command;
        begin
            @(posedge clk);
            cmd_op <= 2'b01;
            cmd_addr <= 7'h52;
            cmd_tx_len <= 8'd0;
            cmd_rx_len <= 8'd3;
            @(posedge clk);
            cmd_start <= 1'b1;
            @(posedge clk);
            cmd_start <= 1'b0;
        end
    endtask

    task start_write_read_command;
        begin
            @(posedge clk);
            cmd_op <= 2'b10;
            cmd_addr <= 7'h52;
            cmd_tx_len <= 8'd2;
            cmd_rx_len <= 8'd3;
            @(posedge clk);
            cmd_start <= 1'b1;
            @(posedge clk);
            cmd_start <= 1'b0;
        end
    endtask

    task start_single_write_command;
        begin
            @(posedge clk);
            cmd_op <= 2'b00;
            cmd_addr <= 7'h52;
            cmd_tx_len <= 8'd1;
            cmd_rx_len <= 8'd0;
            @(posedge clk);
            cmd_start <= 1'b1;
            @(posedge clk);
            cmd_start <= 1'b0;
        end
    endtask

    task start_two_byte_write_command;
        begin
            @(posedge clk);
            cmd_op <= 2'b00;
            cmd_addr <= 7'h52;
            cmd_tx_len <= 8'd2;
            cmd_rx_len <= 8'd0;
            @(posedge clk);
            cmd_start <= 1'b1;
            @(posedge clk);
            cmd_start <= 1'b0;
        end
    endtask

    task start_three_byte_write_command;
        begin
            @(posedge clk);
            cmd_op <= 2'b00;
            cmd_addr <= 7'h52;
            cmd_tx_len <= 8'd3;
            cmd_rx_len <= 8'd0;
            @(posedge clk);
            cmd_start <= 1'b1;
            @(posedge clk);
            cmd_start <= 1'b0;
        end
    endtask

    task inject_arbitration_loss;
        begin
            wait ((i2c_master_lite_inst.state == 5'd4) &&
                  (i2c_master_lite_inst.phase == 2'd1) && sda_t);
            force_sda_low <= 1'b1;
            repeat (6) @(posedge clk);
            force_sda_low <= 1'b0;
        end
    endtask

    task stretch_master_until_timeout;
        begin
            wait ((i2c_master_lite_inst.state == 5'd4) &&
                  (i2c_master_lite_inst.phase == 2'd1) && !scl_t);
            force_scl_low <= 1'b1;
            wait ((i2c_master_lite_inst.state == 5'd4) &&
                  (i2c_master_lite_inst.phase == 2'd2) && scl_t);
            stretch_start_clock = clock_count;
            wait (timeout);
            stretch_wait_clocks = clock_count - stretch_start_clock;
            force_scl_low <= 1'b0;
        end
    endtask

    task stretch_master_briefly;
        begin
            wait ((i2c_master_lite_inst.state == 5'd4) &&
                  (i2c_master_lite_inst.phase == 2'd1) && !scl_t);
            force_scl_low <= 1'b1;
            repeat (8) @(posedge clk);
            force_scl_low <= 1'b0;
        end
    endtask

    task hold_bus_busy_until_timeout;
        begin
            force_sda_low <= 1'b1;
            wait (timeout);
            force_sda_low <= 1'b0;
        end
    endtask

    task request_abort_during_data_ack;
        begin
            wait ((i2c_master_lite_inst.state == 5'd5) &&
                  !i2c_master_lite_inst.address_byte &&
                  (i2c_master_lite_inst.phase == 2'd1));
            abort <= 1'b1;
            repeat (4) @(posedge clk);
            abort <= 1'b0;
        end
    endtask

    task measure_data_scl_period;
        begin
            wait (i2c_master_lite_inst.state == 5'd4);
            @(posedge scl_line);
            first_scl_clock = clock_count;
            @(posedge scl_line);
            measured_scl_period = clock_count - first_scl_clock;
        end
    endtask

    task clear_observation;
        begin
            @(posedge clk);
            start_count = 0;
            stop_count = 0;
            dut_stop_count = 0;
            restart_count = 0;
            slave_rx_count = 0;
            master_rx_count = 0;
            master_ack_count = 0;
            master_nack_count = 0;
            tx_index = 0;
            force_sda_low = 1'b0;
            force_scl_low = 1'b0;
            done_seen = 1'b0;
            addr_nack_seen = 1'b0;
            data_nack_seen = 1'b0;
            arbitration_seen = 1'b0;
            timeout_seen = 1'b0;
            bus_error_seen = 1'b0;
        end
    endtask

    initial begin
        tx_memory[0] = 8'h12;
        tx_memory[1] = 8'h34;
        tx_memory[2] = 8'h56;

        wait (rst_n);
        repeat (3) @(posedge clk);

        fork
            run_behavioral_slave_write;
            start_write_command;
        join

        wait_count = 0;
        while (!done_seen && (wait_count < 5000)) begin
            @(posedge clk);
            wait_count = wait_count + 1;
        end

        if (!done_seen) begin
            $display("[FAIL] direct write timed out");
            error_count = error_count + 1;
        end

        repeat (4) @(posedge clk);
        check_equal("write byte count", slave_rx_count, 3);
        check_equal("write byte 0", slave_rx[0], 8'h12);
        check_equal("write byte 1", slave_rx[1], 8'h34);
        check_equal("write byte 2", slave_rx[2], 8'h56);
        check_equal("write count", tx_count, 8'd3);
        check_equal("write starts", start_count, 1);
        check_equal("write stops", stop_count, 1);
        check_equal("write restarts", restart_count, 0);
        check_equal("write errors",
                    {26'd0, bus_error_seen, timeout_seen, arbitration_seen,
                     data_nack_seen, addr_nack_seen}, 0);

        $display("========== Direct read ==========");
        clear_observation;
        fork
            run_behavioral_slave_read;
            start_read_command;
        join

        wait_count = 0;
        while (!done_seen && (wait_count < 5000)) begin
            @(posedge clk);
            wait_count = wait_count + 1;
        end

        if (!done_seen) begin
            $display("[FAIL] direct read timed out");
            error_count = error_count + 1;
        end

        repeat (4) @(posedge clk);
        check_equal("read byte count", master_rx_count, 3);
        check_equal("read byte 0", master_rx[0], 8'hA1);
        check_equal("read byte 1", master_rx[1], 8'hB2);
        check_equal("read byte 2", master_rx[2], 8'hC3);
        check_equal("read count", rx_count, 8'd3);
        check_equal("read master ACK count", master_ack_count, 2);
        check_equal("read final NACK count", master_nack_count, 1);
        check_equal("read starts", start_count, 1);
        check_equal("read stops", stop_count, 1);
        check_equal("read errors",
                    {26'd0, bus_error_seen, timeout_seen, arbitration_seen,
                     data_nack_seen, addr_nack_seen}, 0);

        $display("========== Write then read ==========");
        tx_memory[0] = 8'h0A;
        tx_memory[1] = 8'h0B;
        clear_observation;
        fork
            run_behavioral_slave_write_read;
            start_write_read_command;
        join

        wait_count = 0;
        while (!done_seen && (wait_count < 5000)) begin
            @(posedge clk);
            wait_count = wait_count + 1;
        end

        if (!done_seen) begin
            $display("[FAIL] write then read timed out");
            error_count = error_count + 1;
        end

        repeat (4) @(posedge clk);
        check_equal("combined write byte count", slave_rx_count, 2);
        check_equal("combined write byte 0", slave_rx[0], 8'h0A);
        check_equal("combined write byte 1", slave_rx[1], 8'h0B);
        check_equal("combined read byte count", master_rx_count, 3);
        check_equal("combined read byte 0", master_rx[0], 8'h91);
        check_equal("combined read byte 1", master_rx[1], 8'h92);
        check_equal("combined read byte 2", master_rx[2], 8'h93);
        check_equal("combined write count", tx_count, 8'd2);
        check_equal("combined read count", rx_count, 8'd3);
        check_equal("combined master ACK count", master_ack_count, 2);
        check_equal("combined final NACK count", master_nack_count, 1);
        check_equal("combined starts", start_count, 2);
        check_equal("combined stops", stop_count, 1);
        check_equal("combined restarts", restart_count, 1);
        check_equal("combined errors",
                    {26'd0, bus_error_seen, timeout_seen, arbitration_seen,
                     data_nack_seen, addr_nack_seen}, 0);

        $display("========== Arbitration loss ==========");
        tx_memory[0] = 8'h55;
        clear_observation;
        fork
            inject_arbitration_loss;
            start_single_write_command;
        join

        wait_count = 0;
        while (!done_seen && (wait_count < 5000)) begin
            @(posedge clk);
            wait_count = wait_count + 1;
        end
        if (!done_seen) begin
            $display("[FAIL] arbitration command timed out");
            error_count = error_count + 1;
        end

        repeat (4) @(posedge clk);
        check_equal("arbitration event", arbitration_seen, 1);
        check_equal("arbitration no address nack", addr_nack_seen, 0);
        check_equal("arbitration no data nack", data_nack_seen, 0);
        check_equal("arbitration no DUT stop", dut_stop_count, 0);
        check_equal("arbitration releases lines", {scl_t, sda_t}, 2'b11);

        $display("========== SCL stretch timeout ==========");
        clear_observation;
        scl_prescale <= 16'd3;
        timeout_cycles <= 32'd5;
        fork
            stretch_master_until_timeout;
            start_single_write_command;
        join

        wait_count = 0;
        while (!done_seen && (wait_count < 5000)) begin
            @(posedge clk);
            wait_count = wait_count + 1;
        end
        if (!done_seen) begin
            $display("[FAIL] stretch timeout command did not complete");
            error_count = error_count + 1;
        end

        repeat (4) @(posedge clk);
        check_equal("stretch timeout event", timeout_seen, 1);
        if ((stretch_wait_clocks < 5) || (stretch_wait_clocks > 6)) begin
            $display("[FAIL] stretch timeout clocks expected=5..6 actual=%0d",
                     stretch_wait_clocks);
            error_count = error_count + 1;
        end else begin
            $display("[PASS] stretch timeout clocks value=%0d", stretch_wait_clocks);
        end
        check_equal("stretch timeout releases lines", {scl_t, sda_t}, 2'b11);
        scl_prescale <= 16'd1;
        timeout_cycles <= 32'd1000;

        $display("========== Address NACK ==========");
        clear_observation;
        fork
            run_behavioral_address_nack;
            start_single_write_command;
        join
        repeat (4) @(posedge clk);
        check_equal("address nack event", addr_nack_seen, 1);
        check_equal("address nack done", done_seen, 1);
        check_equal("address nack no data nack", data_nack_seen, 0);

        $display("========== Data NACK ==========");
        tx_memory[0] = 8'h11;
        tx_memory[1] = 8'h22;
        clear_observation;
        fork
            run_behavioral_second_data_nack;
            start_two_byte_write_command;
        join
        repeat (4) @(posedge clk);
        check_equal("data nack event", data_nack_seen, 1);
        check_equal("data nack count", tx_count, 1);
        check_equal("data nack no address nack", addr_nack_seen, 0);

        $display("========== Short SCL stretch ==========");
        tx_memory[0] = 8'h7E;
        clear_observation;
        fork
            run_behavioral_single_write;
            stretch_master_briefly;
            start_single_write_command;
        join
        wait (done_seen);
        repeat (4) @(posedge clk);
        check_equal("short stretch done", done_seen, 1);
        check_equal("short stretch no timeout", timeout_seen, 0);
        check_equal("short stretch tx count", tx_count, 1);

        $display("========== Bus busy timeout ==========");
        clear_observation;
        timeout_cycles <= 32'd5;
        fork
            hold_bus_busy_until_timeout;
            start_single_write_command;
        join
        wait (done_seen);
        repeat (4) @(posedge clk);
        check_equal("bus busy timeout event", timeout_seen, 1);
        check_equal("bus busy releases lines", {scl_t, sda_t}, 2'b11);
        timeout_cycles <= 32'd1000;

        $display("========== Software abort ==========");
        tx_memory[0] = 8'h31;
        tx_memory[1] = 8'h32;
        tx_memory[2] = 8'h33;
        clear_observation;
        fork
            run_behavioral_abort_write;
            request_abort_during_data_ack;
            start_three_byte_write_command;
        join
        repeat (4) @(posedge clk);
        check_equal("abort completes", done_seen, 1);
        check_equal("abort no nack", {addr_nack_seen, data_nack_seen}, 0);
        check_equal("abort releases lines", {scl_t, sda_t}, 2'b11);

        $display("========== SCL timing ==========");
        tx_memory[0] = 8'h42;
        clear_observation;
        scl_prescale <= 16'd2;
        fork
            run_behavioral_single_write;
            measure_data_scl_period;
            start_single_write_command;
        join
        wait (done_seen);
        repeat (4) @(posedge clk);
        check_equal("SCL period clocks", measured_scl_period, 12);
        scl_prescale <= 16'd1;

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial #(CLK_PERIOD*10000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("i2c_master_lite_tb.vcd");
    //     $dumpvars(0, i2c_master_lite_tb);
    // end

endmodule
