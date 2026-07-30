`timescale 1ns/1ps

module i2c_slave_tb;

    localparam CLK_PERIOD = 10;
    localparam I2C_HALF_PERIOD = 200;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         enable = 1'b0;
    reg  [6:0]  device_addr = 7'h2D;
    reg  [31:0] timeout_cycles = 32'd1000;
    wire [7:0]  rx_data;
    wire        rx_valid;
    reg         rx_ready = 1'b1;
    reg  [7:0]  tx_data = 8'h00;
    reg         tx_valid = 1'b0;
    wire        tx_ready;
    wire        selected;
    wire        read_mode;
    wire        stretch_active;
    wire        bus_busy;
    wire        rx_done;
    wire        read_done;
    wire        rx_overflow;
    wire        tx_underflow;
    wire        stretch_timeout;
    wire        bus_error;
    wire [7:0]  rx_count;
    wire [7:0]  tx_count;
    wire        scl_o;
    wire        scl_t;
    wire        sda_o;
    wire        sda_t;

    reg         master_scl_low = 1'b0;
    reg         master_sda_low = 1'b0;
    wire        scl_line;
    wire        sda_line;

    reg  [7:0]  received [0:15];
    reg  [7:0]  transmitted [0:15];
    reg  [7:0]  tx_memory [0:15];
    integer     received_count = 0;
    integer     tx_index = 0;
    integer     tx_limit = 0;
    integer     error_count = 0;
    reg         rx_done_seen = 1'b0;
    reg         read_done_seen = 1'b0;
    reg         overflow_seen = 1'b0;
    reg         underflow_seen = 1'b0;
    reg         stretch_timeout_seen = 1'b0;
    reg         bus_error_seen = 1'b0;
    reg         selected_seen = 1'b0;
    reg         ack_sample;
    reg         stretch_observed_low = 1'b0;

    assign scl_line = (!master_scl_low && scl_t) ? 1'b1 : 1'b0;
    assign sda_line = (!master_sda_low && sda_t) ? 1'b1 : 1'b0;

    i2c_slave i2c_slave_inst (
        .clk             (clk),
        .rst_n           (rst_n),
        .enable          (enable),
        .device_addr     (device_addr),
        .timeout_cycles  (timeout_cycles),
        .rx_data         (rx_data),
        .rx_valid        (rx_valid),
        .rx_ready        (rx_ready),
        .tx_data         (tx_data),
        .tx_valid        (tx_valid),
        .tx_ready        (tx_ready),
        .selected        (selected),
        .read_mode       (read_mode),
        .stretch_active  (stretch_active),
        .bus_busy        (bus_busy),
        .rx_done         (rx_done),
        .read_done       (read_done),
        .rx_overflow     (rx_overflow),
        .tx_underflow    (tx_underflow),
        .stretch_timeout (stretch_timeout),
        .bus_error       (bus_error),
        .rx_count        (rx_count),
        .tx_count        (tx_count),
        .scl_o           (scl_o),
        .scl_t           (scl_t),
        .scl_i           (scl_line),
        .sda_o           (sda_o),
        .sda_t           (sda_t),
        .sda_i           (sda_line)
    );

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*5) rst_n = 1'b1;

    always @(posedge clk) begin
        if (!rst_n) begin
            received_count <= 0;
            rx_done_seen <= 1'b0;
            read_done_seen <= 1'b0;
            overflow_seen <= 1'b0;
            underflow_seen <= 1'b0;
            stretch_timeout_seen <= 1'b0;
            bus_error_seen <= 1'b0;
            selected_seen <= 1'b0;
        end else begin
            if (rx_valid && rx_ready) begin
                received[received_count] <= rx_data;
                received_count <= received_count + 1;
            end
            if (selected)
                selected_seen <= 1'b1;
            if (rx_done)
                rx_done_seen <= 1'b1;
            if (read_done)
                read_done_seen <= 1'b1;
            if (rx_overflow)
                overflow_seen <= 1'b1;
            if (tx_underflow)
                underflow_seen <= 1'b1;
            if (stretch_timeout)
                stretch_timeout_seen <= 1'b1;
            if (bus_error)
                bus_error_seen <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            tx_data <= 8'h00;
            tx_valid <= 1'b0;
            tx_index <= 0;
        end else begin
            if (tx_index < tx_limit) begin
                tx_data <= tx_memory[tx_index];
                tx_valid <= 1'b1;
            end else begin
                tx_valid <= 1'b0;
            end
            if (tx_ready && tx_valid)
                tx_index <= tx_index + 1;
        end
    end

    task i2c_start;
        begin
            master_sda_low <= 1'b0;
            master_scl_low <= 1'b0;
            #(I2C_HALF_PERIOD);
            master_sda_low <= 1'b1;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b1;
        end
    endtask

    task i2c_restart;
        begin
            master_scl_low <= 1'b1;
            master_sda_low <= 1'b0;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b0;
            wait (scl_line);
            #(I2C_HALF_PERIOD);
            master_sda_low <= 1'b1;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b1;
        end
    endtask

    task i2c_stop;
        begin
            master_sda_low <= 1'b1;
            master_scl_low <= 1'b1;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b0;
            wait (scl_line);
            #(I2C_HALF_PERIOD);
            master_sda_low <= 1'b0;
            #(I2C_HALF_PERIOD);
        end
    endtask

    task i2c_write_bit;
        input bit_value;
        begin
            master_scl_low <= 1'b1;
            master_sda_low <= ~bit_value;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b0;
            wait (scl_line);
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b1;
        end
    endtask

    task i2c_read_ack;
        output ack_value;
        begin
            master_scl_low <= 1'b1;
            master_sda_low <= 1'b0;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b0;
            wait (scl_line);
            #(I2C_HALF_PERIOD/2);
            ack_value = sda_line;
            #(I2C_HALF_PERIOD/2);
            master_scl_low <= 1'b1;
        end
    endtask

    task i2c_write_byte;
        input [7:0] value;
        output ack_value;
        integer bit_index;
        begin
            for (bit_index = 7; bit_index >= 0; bit_index = bit_index - 1)
                i2c_write_bit(value[bit_index]);
            i2c_read_ack(ack_value);
        end
    endtask

    task i2c_read_bit;
        output bit_value;
        begin
            master_scl_low <= 1'b1;
            master_sda_low <= 1'b0;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b0;
            wait (scl_line);
            #(I2C_HALF_PERIOD/2);
            bit_value = sda_line;
            #(I2C_HALF_PERIOD/2);
            master_scl_low <= 1'b1;
        end
    endtask

    task i2c_read_byte;
        input send_ack;
        output [7:0] value;
        integer bit_index;
        reg sampled_bit;
        begin
            for (bit_index = 7; bit_index >= 0; bit_index = bit_index - 1) begin
                i2c_read_bit(sampled_bit);
                value[bit_index] = sampled_bit;
            end
            master_scl_low <= 1'b1;
            master_sda_low <= send_ack;
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b0;
            wait (scl_line);
            #(I2C_HALF_PERIOD);
            master_scl_low <= 1'b1;
            master_sda_low <= 1'b0;
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

    task clear_observation;
        begin
            @(posedge clk);
            received_count = 0;
            rx_done_seen = 1'b0;
            read_done_seen = 1'b0;
            overflow_seen = 1'b0;
            underflow_seen = 1'b0;
            stretch_timeout_seen = 1'b0;
            bus_error_seen = 1'b0;
            selected_seen = 1'b0;
            stretch_observed_low = 1'b0;
            tx_index = 0;
            tx_limit = 0;
        end
    endtask

    task run_master_read_one;
        begin
            i2c_start;
            i2c_write_byte({7'h2D, 1'b1}, ack_sample);
            i2c_read_byte(1'b0, transmitted[0]);
            i2c_stop;
        end
    endtask

    task refill_slave_tx_during_stretch;
        begin
            wait (stretch_active);
            stretch_observed_low = !scl_line;
            repeat (20) @(posedge clk);
            tx_memory[0] = 8'hC7;
            tx_limit = 1;
        end
    endtask

    initial begin
        wait (rst_n);
        repeat (4) @(posedge clk);
        enable <= 1'b1;
        repeat (4) @(posedge clk);

        $display("========== Address mismatch ==========");
        i2c_start;
        i2c_write_byte({7'h2E, 1'b0}, ack_sample);
        check_equal("mismatch address NACK", ack_sample, 1);
        i2c_write_byte(8'h99, ack_sample);
        i2c_stop;
        repeat (8) @(posedge clk);
        check_equal("mismatch no select", selected_seen, 0);
        check_equal("mismatch no data", received_count, 0);

        $display("========== Raw receive and STOP ==========");
        clear_observation;
        i2c_start;
        i2c_write_byte({7'h2D, 1'b0}, ack_sample);
        check_equal("matching address ACK", ack_sample, 0);
        i2c_write_byte(8'h21, ack_sample);
        check_equal("data 0 ACK", ack_sample, 0);
        i2c_write_byte(8'h43, ack_sample);
        check_equal("data 1 ACK", ack_sample, 0);
        i2c_write_byte(8'h65, ack_sample);
        check_equal("data 2 ACK", ack_sample, 0);
        i2c_stop;
        repeat (8) @(posedge clk);

        check_equal("slave selected", selected_seen, 1);
        check_equal("slave rx byte count", received_count, 3);
        check_equal("slave rx byte 0", received[0], 8'h21);
        check_equal("slave rx byte 1", received[1], 8'h43);
        check_equal("slave rx byte 2", received[2], 8'h65);
        check_equal("slave rx count", rx_count, 3);
        check_equal("slave write done", rx_done_seen, 1);
        check_equal("slave no overflow", overflow_seen, 0);
        check_equal("slave bus released", {scl_t, sda_t}, 2'b11);

        $display("========== Raw receive and RESTART ==========");
        clear_observation;
        i2c_start;
        i2c_write_byte({7'h2D, 1'b0}, ack_sample);
        i2c_write_byte(8'hA6, ack_sample);
        i2c_restart;
        repeat (8) @(posedge clk);
        check_equal("restart write done", rx_done_seen, 1);
        check_equal("restart rx count", rx_count, 1);
        check_equal("restart rx data", received[0], 8'hA6);
        i2c_write_byte({7'h2E, 1'b0}, ack_sample);
        i2c_stop;

        $display("========== Receive overflow ==========");
        clear_observation;
        rx_ready <= 1'b1;
        i2c_start;
        i2c_write_byte({7'h2D, 1'b0}, ack_sample);
        check_equal("overflow address ACK", ack_sample, 0);
        rx_ready <= 1'b0;
        i2c_write_byte(8'hF0, ack_sample);
        check_equal("overflow data NACK", ack_sample, 1);
        i2c_stop;
        repeat (8) @(posedge clk);
        check_equal("overflow event", overflow_seen, 1);
        check_equal("overflow no data", received_count, 0);
        rx_ready <= 1'b1;

        $display("========== Preloaded slave read ==========");
        clear_observation;
        tx_memory[0] = 8'hA5;
        tx_memory[1] = 8'h5A;
        tx_limit = 2;
        repeat (4) @(posedge clk);
        i2c_start;
        i2c_write_byte({7'h2D, 1'b1}, ack_sample);
        check_equal("read address ACK", ack_sample, 0);
        i2c_read_byte(1'b1, transmitted[0]);
        i2c_read_byte(1'b0, transmitted[1]);
        i2c_stop;
        repeat (8) @(posedge clk);
        check_equal("preloaded tx byte 0", transmitted[0], 8'hA5);
        check_equal("preloaded tx byte 1", transmitted[1], 8'h5A);
        check_equal("preloaded tx count", tx_count, 2);
        check_equal("preloaded read done", read_done_seen, 1);
        check_equal("preloaded no underflow", underflow_seen, 0);

        $display("========== Address stretch and refill ==========");
        clear_observation;
        timeout_cycles <= 32'd1000;
        fork
            run_master_read_one;
            refill_slave_tx_during_stretch;
        join
        repeat (8) @(posedge clk);
        check_equal("refill address ACK", ack_sample, 0);
        check_equal("refill stretched byte", transmitted[0], 8'hC7);
        check_equal("refill underflow event", underflow_seen, 1);
        check_equal("refill stretch held SCL", stretch_observed_low, 1);
        check_equal("refill no timeout", stretch_timeout_seen, 0);
        check_equal("refill read done", read_done_seen, 1);

        $display("========== Address stretch timeout ==========");
        clear_observation;
        timeout_cycles <= 32'd20;
        i2c_start;
        i2c_write_byte({7'h2D, 1'b1}, ack_sample);
        check_equal("timeout address NACK", ack_sample, 1);
        i2c_stop;
        repeat (8) @(posedge clk);
        check_equal("timeout underflow event", underflow_seen, 1);
        check_equal("timeout stretch event", stretch_timeout_seen, 1);
        check_equal("timeout no read done", read_done_seen, 0);
        check_equal("timeout releases lines", {scl_t, sda_t}, 2'b11);

        $display("========== Mid-read stretch timeout ==========");
        clear_observation;
        timeout_cycles <= 32'd20;
        tx_memory[0] = 8'h3C;
        tx_limit = 1;
        repeat (4) @(posedge clk);
        i2c_start;
        i2c_write_byte({7'h2D, 1'b1}, ack_sample);
        check_equal("mid-read address ACK", ack_sample, 0);
        i2c_read_byte(1'b1, transmitted[0]);
        fork
            begin
                i2c_read_byte(1'b0, transmitted[1]);
                i2c_stop;
            end
            begin
                repeat (100) begin
                    @(posedge clk);
                    if (stretch_active && !scl_line)
                        stretch_observed_low = 1'b1;
                end
            end
        join
        repeat (8) @(posedge clk);
        check_equal("mid-read first byte", transmitted[0], 8'h3C);
        check_equal("mid-read timeout fallback", transmitted[1], 8'hFF);
        check_equal("mid-read tx count", tx_count, 2);
        check_equal("mid-read underflow event", underflow_seen, 1);
        check_equal("mid-read stretch event", stretch_timeout_seen, 1);
        check_equal("mid-read stretch held SCL", stretch_observed_low, 1);
        check_equal("mid-read read done", read_done_seen, 1);
        check_equal("mid-read releases lines", {scl_t, sda_t}, 2'b11);
        timeout_cycles <= 32'd1000;

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial #(CLK_PERIOD*200000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("i2c_slave_tb.vcd");
    //     $dumpvars(0, i2c_slave_tb);
    // end

endmodule
