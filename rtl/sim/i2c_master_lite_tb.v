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
    integer     restart_count = 0;
    reg         bus_active = 1'b0;
    integer     error_count = 0;
    integer     wait_count;
    reg         done_seen = 1'b0;
    reg         addr_nack_seen = 1'b0;
    reg         data_nack_seen = 1'b0;
    reg         arbitration_seen = 1'b0;
    reg         timeout_seen = 1'b0;
    reg         bus_error_seen = 1'b0;
    reg  [7:0]  sampled_byte;

    assign scl_line = scl_t ? 1'b1 : scl_o;
    assign sda_line = (sda_t && !slave_sda_low) ? 1'b1 : 1'b0;

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

    task clear_observation;
        begin
            @(posedge clk);
            start_count = 0;
            stop_count = 0;
            restart_count = 0;
            slave_rx_count = 0;
            master_rx_count = 0;
            master_ack_count = 0;
            master_nack_count = 0;
            tx_index = 0;
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
