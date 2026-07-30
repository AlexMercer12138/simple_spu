`timescale 1ns/1ps

module apb_i2c_tb;

    localparam SYS_CLK_FREQ = 1_000_000;
    localparam FIFO_DEPTH   = 8;
    localparam CLK_PERIOD   = 10;

    localparam ADDR_CTRL            = 32'h0000_0000;
    localparam ADDR_MASTER_CMD      = 32'h0000_0004;
    localparam ADDR_TIMING          = 32'h0000_0008;
    localparam ADDR_STATUS          = 32'h0000_000C;
    localparam ADDR_TX_DATA         = 32'h0000_0010;
    localparam ADDR_RX_DATA         = 32'h0000_0014;
    localparam ADDR_FIFO_STATUS     = 32'h0000_0018;
    localparam ADDR_SLAVE_CFG       = 32'h0000_001C;
    localparam ADDR_STRETCH_TIMEOUT = 32'h0000_0020;
    localparam ADDR_IRQ_STATUS      = 32'h0000_0024;
    localparam ADDR_IRQ_ENABLE      = 32'h0000_0028;
    localparam ADDR_IRQ_THRESHOLD   = 32'h0000_002C;
    localparam ADDR_INVALID         = 32'h0000_0030;

    reg         clk = 1'b0;
    reg         rst_n = 1'b0;
    reg         s_apb_psel = 1'b0;
    reg         s_apb_penable = 1'b0;
    reg         s_apb_pwrite = 1'b0;
    reg  [31:0] s_apb_paddr = 32'd0;
    reg  [31:0] s_apb_pwdata = 32'd0;
    wire        s_apb_pready;
    wire        s_apb_pslverr;
    wire [31:0] s_apb_prdata;
    wire        interrupt;
    wire        scl_o;
    wire        scl_t;
    wire        sda_o;
    wire        sda_t;

    reg         master_apb_psel = 1'b0;
    reg         master_apb_penable = 1'b0;
    reg         master_apb_pwrite = 1'b0;
    reg  [31:0] master_apb_paddr = 32'd0;
    reg  [31:0] master_apb_pwdata = 32'd0;
    wire        master_apb_pready;
    wire        master_apb_pslverr;
    wire [31:0] master_apb_prdata;
    wire        master_interrupt;
    wire        master_scl_t;
    wire        master_sda_t;

    reg         slave_apb_psel = 1'b0;
    reg         slave_apb_penable = 1'b0;
    reg         slave_apb_pwrite = 1'b0;
    reg  [31:0] slave_apb_paddr = 32'd0;
    reg  [31:0] slave_apb_pwdata = 32'd0;
    wire        slave_apb_pready;
    wire        slave_apb_pslverr;
    wire [31:0] slave_apb_prdata;
    wire        slave_interrupt;
    wire        slave_scl_t;
    wire        slave_sda_t;
    wire        shared_scl;
    wire        shared_sda;
    reg         external_scl_low = 1'b0;
    reg         external_sda_low = 1'b0;

    reg         shared_scl_previous = 1'b1;
    reg         shared_sda_previous = 1'b1;
    integer     shared_start_count = 0;
    integer     shared_stop_count = 0;
    integer     integration_index = 0;
    reg  [7:0]  integration_value = 8'd0;

    integer     error_count = 0;
    reg  [31:0] read_data = 32'd0;

    apb_i2c #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (FIFO_DEPTH)
    ) apb_i2c_inst (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (s_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s_apb_pready),
        .s_apb_pslverr (s_apb_pslverr),
        .s_apb_prdata  (s_apb_prdata),
        .interrupt     (interrupt),
        .scl_o         (scl_o),
        .scl_t         (scl_t),
        .scl_i         (1'b1),
        .sda_o         (sda_o),
        .sda_t         (sda_t),
        .sda_i         (1'b1)
    );

    assign shared_scl = master_scl_t && slave_scl_t && !external_scl_low;
    assign shared_sda = master_sda_t && slave_sda_t && !external_sda_low;

    apb_i2c #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (16)
    ) dut_master (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (master_apb_psel),
        .s_apb_penable (master_apb_penable),
        .s_apb_pwrite  (master_apb_pwrite),
        .s_apb_paddr   (master_apb_paddr),
        .s_apb_pwdata  (master_apb_pwdata),
        .s_apb_pready  (master_apb_pready),
        .s_apb_pslverr (master_apb_pslverr),
        .s_apb_prdata  (master_apb_prdata),
        .interrupt     (master_interrupt),
        .scl_o         (),
        .scl_t         (master_scl_t),
        .scl_i         (shared_scl),
        .sda_o         (),
        .sda_t         (master_sda_t),
        .sda_i         (shared_sda)
    );

    apb_i2c #(
        .SYS_CLK_FREQ  (SYS_CLK_FREQ),
        .FIFO_DEPTH    (16)
    ) dut_slave (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (slave_apb_psel),
        .s_apb_penable (slave_apb_penable),
        .s_apb_pwrite  (slave_apb_pwrite),
        .s_apb_paddr   (slave_apb_paddr),
        .s_apb_pwdata  (slave_apb_pwdata),
        .s_apb_pready  (slave_apb_pready),
        .s_apb_pslverr (slave_apb_pslverr),
        .s_apb_prdata  (slave_apb_prdata),
        .interrupt     (slave_interrupt),
        .scl_o         (),
        .scl_t         (slave_scl_t),
        .scl_i         (shared_scl),
        .sda_o         (),
        .sda_t         (slave_sda_t),
        .sda_i         (shared_sda)
    );

    always #(CLK_PERIOD/2) clk = ~clk;

    initial #(CLK_PERIOD*5) rst_n = 1'b1;

    always @(posedge clk) begin
        if (!rst_n) begin
            shared_scl_previous <= 1'b1;
            shared_sda_previous <= 1'b1;
        end else begin
            if (shared_sda_previous && !shared_sda && shared_scl)
                shared_start_count <= shared_start_count + 1;
            if (!shared_sda_previous && shared_sda && shared_scl)
                shared_stop_count <= shared_stop_count + 1;
            shared_scl_previous <= shared_scl;
            shared_sda_previous <= shared_sda;
        end
    end

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

    task apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= address;
            s_apb_pwdata <= data;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= 32'd0;
            s_apb_pwdata <= 32'd0;
        end
    endtask

    task apb_read;
        input [31:0] address;
        output [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= address;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            data = s_apb_prdata;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

    task core_push_rx;
        input [7:0] data;
        begin
            @(negedge clk);
            force apb_i2c_inst.rx_core_data = data;
            force apb_i2c_inst.rx_core_push = 1'b1;
            @(posedge clk);
            #1;
            release apb_i2c_inst.rx_core_push;
            release apb_i2c_inst.rx_core_data;
        end
    endtask

    task core_pop_tx;
        begin
            @(negedge clk);
            force apb_i2c_inst.tx_fifo_rd_en = 1'b1;
            @(posedge clk);
            #1;
            release apb_i2c_inst.tx_fifo_rd_en;
        end
    endtask

    task apb_write_with_tx_pop;
        input [7:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= ADDR_TX_DATA;
            s_apb_pwdata <= {24'd0, data};
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            force apb_i2c_inst.tx_fifo_rd_en = 1'b1;
            @(posedge clk);
            #1;
            release apb_i2c_inst.tx_fifo_rd_en;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= 32'd0;
            s_apb_pwdata <= 32'd0;
        end
    endtask

    task apb_read_with_rx_push;
        input [7:0] pushed_data;
        output [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= ADDR_RX_DATA;
            @(posedge clk);
            #1;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            force apb_i2c_inst.rx_core_data = pushed_data;
            force apb_i2c_inst.rx_core_push = 1'b1;
            @(posedge clk);
            #1;
            data = s_apb_prdata;
            release apb_i2c_inst.rx_core_push;
            release apb_i2c_inst.rx_core_data;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

    task check_apb_timing;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= ADDR_INVALID;
            #1;
            check_equal("PREADY before registered response",
                        {31'd0, s_apb_pready}, 0);
            @(posedge clk);
            #1;
            check_equal("PREADY registered response",
                        {31'd0, s_apb_pready}, 1);
            check_equal("invalid read is zero", s_apb_prdata, 0);
            @(negedge clk);
            s_apb_penable <= 1'b1;
            #1;
            check_equal("PREADY held through access",
                        {31'd0, s_apb_pready}, 1);
            @(posedge clk);
            #1;
            check_equal("PREADY drops after access",
                        {31'd0, s_apb_pready}, 0);
            check_equal("PSLVERR remains low",
                        {31'd0, s_apb_pslverr}, 0);
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_paddr <= 32'd0;
        end
    endtask

    task clear_irq_status;
        begin
            apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
        end
    endtask

    task prepare_master;
        begin
            apb_write(ADDR_CTRL, 32'h8000_0000);
            apb_write(ADDR_CTRL, 32'h0000_0002);
            apb_write(ADDR_TIMING, 32'h0000_0000);
            apb_write(ADDR_STRETCH_TIMEOUT, 32'd1000);
            apb_write(ADDR_CTRL, 32'h0000_0003);
        end
    endtask

    task wait_master_done;
        integer attempts;
        begin
            attempts = 0;
            read_data = 32'd0;
            while ((read_data[0] !== 1'b1) && (attempts < 200)) begin
                apb_read(ADDR_IRQ_STATUS, read_data);
                attempts = attempts + 1;
            end
            if (attempts >= 200) begin
                $display("[FAIL] master command did not complete");
                error_count = error_count + 1;
            end else begin
                check_equal("accepted command MASTER_DONE",
                            {31'd0, read_data[0]}, 1);
            end
        end
    endtask

    task run_accepted_command;
        input [1:0] operation;
        input [7:0] tx_length;
        input [7:0] rx_length;
        begin
            prepare_master;
            if (tx_length != 0)
                apb_write(ADDR_TX_DATA, 32'h0000_00A5);
            apb_write(ADDR_MASTER_CMD,
                      {rx_length, tx_length, 1'b0, 7'h52, 6'd0, operation});
            clear_irq_status;
            apb_write(ADDR_CTRL, 32'h0000_0007);
            repeat (2) @(posedge clk);
            apb_read(ADDR_STATUS, read_data);
            check_equal("accepted command busy", {31'd0, read_data[0]}, 1);
            wait_master_done;
            check_equal("accepted command no CMD_ERROR",
                        {31'd0, read_data[5]}, 0);
        end
    endtask

    task check_idle_rejection;
        input [15:0] expected_levels;
        begin
            repeat (2) @(posedge clk);
            apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("rejected command CMD_ERROR",
                        {31'd0, read_data[5]}, 1);
            apb_read(ADDR_STATUS, read_data);
            check_equal("rejected command stays idle",
                        {31'd0, read_data[0]}, 0);
            check_equal("rejected command releases bus",
                        {30'd0, scl_t, sda_t}, 3);
            apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("rejected command preserves FIFO levels",
                        {16'd0, read_data[15:0]}, {16'd0, expected_levels});
        end
    endtask

    task run_rejected_command;
        input [1:0] operation;
        input [7:0] tx_length;
        input [7:0] rx_length;
        input [3:0] preload_tx;
        begin
            prepare_master;
            if (preload_tx > 0)
                apb_write(ADDR_TX_DATA, 32'h0000_0011);
            if (preload_tx > 1)
                apb_write(ADDR_TX_DATA, 32'h0000_0022);
            if (preload_tx > 2)
                apb_write(ADDR_TX_DATA, 32'h0000_0033);
            if (preload_tx > 3)
                apb_write(ADDR_TX_DATA, 32'h0000_0044);
            if (preload_tx > 4)
                apb_write(ADDR_TX_DATA, 32'h0000_0055);
            if (preload_tx > 5)
                apb_write(ADDR_TX_DATA, 32'h0000_0066);
            if (preload_tx > 6)
                apb_write(ADDR_TX_DATA, 32'h0000_0077);
            if (preload_tx > 7)
                apb_write(ADDR_TX_DATA, 32'h0000_0088);
            apb_write(ADDR_MASTER_CMD,
                      {rx_length, tx_length, 1'b0, 7'h52, 6'd0, operation});
            clear_irq_status;
            apb_write(ADDR_CTRL, 32'h0000_0007);
            check_idle_rejection({8'd0, 5'd0, preload_tx});
        end
    endtask

    task master_apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(negedge clk);
            master_apb_psel <= 1'b1;
            master_apb_penable <= 1'b0;
            master_apb_pwrite <= 1'b1;
            master_apb_paddr <= address;
            master_apb_pwdata <= data;
            @(posedge clk);
            #1;
            @(negedge clk);
            master_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            @(negedge clk);
            master_apb_psel <= 1'b0;
            master_apb_penable <= 1'b0;
            master_apb_pwrite <= 1'b0;
            master_apb_paddr <= 32'd0;
            master_apb_pwdata <= 32'd0;
        end
    endtask

    task master_apb_read;
        input [31:0] address;
        output [31:0] data;
        begin
            @(negedge clk);
            master_apb_psel <= 1'b1;
            master_apb_penable <= 1'b0;
            master_apb_pwrite <= 1'b0;
            master_apb_paddr <= address;
            @(posedge clk);
            #1;
            @(negedge clk);
            master_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            data = master_apb_prdata;
            @(negedge clk);
            master_apb_psel <= 1'b0;
            master_apb_penable <= 1'b0;
            master_apb_paddr <= 32'd0;
        end
    endtask

    task slave_apb_write;
        input [31:0] address;
        input [31:0] data;
        begin
            @(negedge clk);
            slave_apb_psel <= 1'b1;
            slave_apb_penable <= 1'b0;
            slave_apb_pwrite <= 1'b1;
            slave_apb_paddr <= address;
            slave_apb_pwdata <= data;
            @(posedge clk);
            #1;
            @(negedge clk);
            slave_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            @(negedge clk);
            slave_apb_psel <= 1'b0;
            slave_apb_penable <= 1'b0;
            slave_apb_pwrite <= 1'b0;
            slave_apb_paddr <= 32'd0;
            slave_apb_pwdata <= 32'd0;
        end
    endtask

    task slave_apb_read;
        input [31:0] address;
        output [31:0] data;
        begin
            @(negedge clk);
            slave_apb_psel <= 1'b1;
            slave_apb_penable <= 1'b0;
            slave_apb_pwrite <= 1'b0;
            slave_apb_paddr <= address;
            @(posedge clk);
            #1;
            @(negedge clk);
            slave_apb_penable <= 1'b1;
            @(posedge clk);
            #1;
            data = slave_apb_prdata;
            @(negedge clk);
            slave_apb_psel <= 1'b0;
            slave_apb_penable <= 1'b0;
            slave_apb_paddr <= 32'd0;
        end
    endtask

    task prepare_integration_pair;
        begin
            master_apb_write(ADDR_CTRL, 32'h8000_0000);
            slave_apb_write(ADDR_CTRL, 32'h8000_0000);

            slave_apb_write(ADDR_SLAVE_CFG, 32'h0000_0052);
            slave_apb_write(ADDR_STRETCH_TIMEOUT, 32'd5000);
            slave_apb_write(ADDR_CTRL, 32'h0000_0001);

            master_apb_write(ADDR_CTRL, 32'h0000_0002);
            master_apb_write(ADDR_TIMING, 32'h0000_0009);
            master_apb_write(ADDR_STRETCH_TIMEOUT, 32'd5000);
            master_apb_write(ADDR_CTRL, 32'h0000_0003);
            repeat (20) @(posedge clk);
        end
    endtask

    task clear_shared_counts;
        begin
            @(negedge clk);
            shared_start_count = 0;
            shared_stop_count = 0;
            shared_scl_previous = shared_scl;
            shared_sda_previous = shared_sda;
        end
    endtask

    task wait_integration_master_done;
        integer attempts;
        begin
            attempts = 0;
            read_data = 32'd0;
            while ((read_data[0] !== 1'b1) && (attempts < 5000)) begin
                master_apb_read(ADDR_IRQ_STATUS, read_data);
                attempts = attempts + 1;
            end
            if (attempts >= 5000) begin
                $display("[FAIL] integration master did not complete");
                error_count = error_count + 1;
            end
        end
    endtask

    task wait_integration_slave_irq;
        input integer bit_index;
        integer attempts;
        begin
            attempts = 0;
            read_data = 32'd0;
            while ((read_data[bit_index] !== 1'b1) && (attempts < 5000)) begin
                slave_apb_read(ADDR_IRQ_STATUS, read_data);
                attempts = attempts + 1;
            end
            if (attempts >= 5000) begin
                $display("[FAIL] integration slave IRQ %0d missing", bit_index);
                error_count = error_count + 1;
            end
        end
    endtask

    task run_integration_write;
        input integer length;
        begin
            prepare_integration_pair;
            for (integration_index = 0; integration_index < length;
                 integration_index = integration_index + 1)
                master_apb_write(ADDR_TX_DATA, 32'h20 + integration_index);
            integration_value = length;
            master_apb_write(ADDR_MASTER_CMD,
                             {8'd0, integration_value, 1'b0,
                              7'h52, 6'd0, 2'b00});
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            clear_shared_counts;
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            wait_integration_slave_irq(8);

            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("integration write master errors",
                        read_data & 32'h0000_003E, 0);
            master_apb_read(ADDR_STATUS, read_data);
            check_equal("integration write master count",
                        {24'd0, read_data[23:16]}, length);
            slave_apb_read(ADDR_STATUS, read_data);
            check_equal("integration write slave count",
                        {24'd0, read_data[31:24]}, length);
            slave_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("integration write RX level",
                        {24'd0, read_data[15:8]}, length);
            slave_apb_read(ADDR_RX_DATA, read_data);
            check_equal("integration write RX prime", read_data, 0);
            for (integration_index = 0; integration_index < length;
                 integration_index = integration_index + 1) begin
                slave_apb_read(ADDR_RX_DATA, read_data);
                check_equal("integration write byte", read_data,
                            32'h20 + integration_index);
            end
            check_equal("integration write START count",
                        shared_start_count, 1);
            check_equal("integration write STOP count",
                        shared_stop_count, 1);
        end
    endtask

    task run_integration_read;
        input integer length;
        begin
            prepare_integration_pair;
            for (integration_index = 0; integration_index < length;
                 integration_index = integration_index + 1)
                slave_apb_write(ADDR_TX_DATA, 32'h80 + integration_index);
            integration_value = length;
            master_apb_write(ADDR_MASTER_CMD,
                             {integration_value, 8'd0, 1'b0,
                              7'h52, 6'd0, 2'b01});
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            clear_shared_counts;
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            wait_integration_slave_irq(9);

            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("integration read master errors",
                        read_data & 32'h0000_003E, 0);
            master_apb_read(ADDR_STATUS, read_data);
            check_equal("integration read master count",
                        {24'd0, read_data[31:24]}, length);
            slave_apb_read(ADDR_STATUS, read_data);
            check_equal("integration read slave count",
                        {24'd0, read_data[23:16]}, length);
            master_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("integration read RX level",
                        {24'd0, read_data[15:8]}, length);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("integration read RX prime", read_data, 0);
            for (integration_index = 0; integration_index < length;
                 integration_index = integration_index + 1) begin
                master_apb_read(ADDR_RX_DATA, read_data);
                check_equal("integration read byte", read_data,
                            32'h80 + integration_index);
            end
            check_equal("integration read START count",
                        shared_start_count, 1);
            check_equal("integration read STOP count",
                        shared_stop_count, 1);
        end
    endtask

    task run_integration_write_read;
        integer attempts;
        begin
            prepare_integration_pair;
            master_apb_write(ADDR_TX_DATA, 32'h0000_000A);
            master_apb_write(ADDR_TX_DATA, 32'h0000_000B);
            master_apb_write(ADDR_MASTER_CMD, 32'h0302_5202);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            clear_shared_counts;
            master_apb_write(ADDR_CTRL, 32'h0000_0007);

            wait_integration_slave_irq(8);
            attempts = 0;
            read_data = 32'd0;
            while ((read_data[4] !== 1'b1) && (attempts < 2000)) begin
                slave_apb_read(ADDR_STATUS, read_data);
                attempts = attempts + 1;
            end
            if (attempts >= 2000) begin
                $display("[FAIL] combined transfer did not stretch");
                error_count = error_count + 1;
            end
            repeat (20) @(posedge clk);
            check_equal("combined stretch holds SCL", {31'd0, shared_scl}, 0);

            slave_apb_write(ADDR_TX_DATA, 32'h0000_00C1);
            slave_apb_write(ADDR_TX_DATA, 32'h0000_00C2);
            slave_apb_write(ADDR_TX_DATA, 32'h0000_00C3);
            wait_integration_master_done;
            wait_integration_slave_irq(9);

            slave_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("combined slave RX level",
                        {24'd0, read_data[15:8]}, 2);
            slave_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined slave RX prime", read_data, 0);
            slave_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined slave RX byte 0", read_data, 8'h0A);
            slave_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined slave RX byte 1", read_data, 8'h0B);
            master_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("combined master RX level",
                        {24'd0, read_data[15:8]}, 3);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined master RX prime", read_data, 0);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined master RX byte 0", read_data, 8'hC1);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined master RX byte 1", read_data, 8'hC2);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("combined master RX byte 2", read_data, 8'hC3);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("combined underflow event", {31'd0, read_data[11]}, 1);
            check_equal("combined no stretch timeout", {31'd0, read_data[12]}, 0);
            check_equal("combined START count", shared_start_count, 2);
            check_equal("combined STOP count", shared_stop_count, 1);
        end
    endtask

    task force_slave_rx_byte;
        input [7:0] data;
        begin
            @(negedge clk);
            force dut_slave.rx_core_data = data;
            force dut_slave.rx_core_push = 1'b1;
            @(posedge clk);
            #1;
            release dut_slave.rx_core_push;
            release dut_slave.rx_core_data;
        end
    endtask

    task pulse_slave_underflow_event;
        begin
            @(negedge clk);
            force dut_slave.slave_tx_underflow_event = 1'b1;
            @(posedge clk);
            #1;
            release dut_slave.slave_tx_underflow_event;
        end
    endtask

    task clear_underflow_with_event;
        begin
            @(negedge clk);
            slave_apb_psel <= 1'b1;
            slave_apb_penable <= 1'b0;
            slave_apb_pwrite <= 1'b1;
            slave_apb_paddr <= ADDR_IRQ_STATUS;
            slave_apb_pwdata <= 32'h0000_0800;
            @(posedge clk);
            #1;
            @(negedge clk);
            slave_apb_penable <= 1'b1;
            force dut_slave.slave_tx_underflow_event = 1'b1;
            @(posedge clk);
            #1;
            release dut_slave.slave_tx_underflow_event;
            @(negedge clk);
            slave_apb_psel <= 1'b0;
            slave_apb_penable <= 1'b0;
            slave_apb_pwrite <= 1'b0;
            slave_apb_paddr <= 32'd0;
            slave_apb_pwdata <= 32'd0;
        end
    endtask

    task prepare_integration_master_only;
        begin
            external_scl_low = 1'b0;
            external_sda_low = 1'b0;
            master_apb_write(ADDR_CTRL, 32'h8000_0000);
            slave_apb_write(ADDR_CTRL, 32'h8000_0000);
            master_apb_write(ADDR_CTRL, 32'h0000_0002);
            master_apb_write(ADDR_TIMING, 32'h0000_0009);
            master_apb_write(ADDR_STRETCH_TIMEOUT, 32'd5000);
            master_apb_write(ADDR_CTRL, 32'h0000_0003);
            repeat (20) @(posedge clk);
        end
    endtask

    task run_wrong_address_case;
        begin
            prepare_integration_pair;
            master_apb_write(ADDR_TX_DATA, 32'h0000_0066);
            master_apb_write(ADDR_MASTER_CMD, 32'h0001_5300);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("wrong address master events",
                        read_data & 32'h0000_0003, 3);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("wrong address no slave done",
                        {31'd0, read_data[8]}, 0);
            slave_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("wrong address no slave data",
                        {24'd0, read_data[15:8]}, 0);
        end
    endtask

    task run_slave_overflow_case;
        begin
            prepare_integration_pair;
            for (integration_index = 0; integration_index < 16;
                 integration_index = integration_index + 1)
                force_slave_rx_byte(integration_index);
            master_apb_write(ADDR_TX_DATA, 32'h0000_0077);
            master_apb_write(ADDR_MASTER_CMD, 32'h0001_5200);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("overflow master DATA_NACK",
                        {31'd0, read_data[2]}, 1);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("overflow slave event",
                        {31'd0, read_data[10]}, 1);
            slave_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("overflow RX remains full",
                        {24'd0, read_data[15:8]}, 16);
        end
    endtask

    task run_address_timeout_case;
        begin
            prepare_integration_pair;
            slave_apb_write(ADDR_STRETCH_TIMEOUT, 32'd40);
            master_apb_write(ADDR_MASTER_CMD, 32'h0100_5201);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("address timeout ADDR_NACK",
                        {31'd0, read_data[1]}, 1);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("address timeout underflow",
                        {31'd0, read_data[11]}, 1);
            check_equal("address timeout event",
                        {31'd0, read_data[12]}, 1);
            check_equal("address timeout no read done",
                        {31'd0, read_data[9]}, 0);
        end
    endtask

    task run_midread_timeout_case;
        begin
            prepare_integration_pair;
            slave_apb_write(ADDR_STRETCH_TIMEOUT, 32'd40);
            slave_apb_write(ADDR_TX_DATA, 32'h0000_00A6);
            master_apb_write(ADDR_MASTER_CMD, 32'h0200_5201);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("mid-read timeout master errors",
                        read_data & 32'h0000_003E, 0);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("mid-read RX prime", read_data, 0);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("mid-read first data", read_data, 8'hA6);
            master_apb_read(ADDR_RX_DATA, read_data);
            check_equal("mid-read fallback data", read_data, 8'hFF);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("mid-read underflow event",
                        {31'd0, read_data[11]}, 1);
            check_equal("mid-read stretch timeout",
                        {31'd0, read_data[12]}, 1);
            check_equal("mid-read read done", {31'd0, read_data[9]}, 1);
        end
    endtask

    task run_master_timeout_case;
        begin
            prepare_integration_master_only;
            master_apb_write(ADDR_STRETCH_TIMEOUT, 32'd20);
            master_apb_write(ADDR_TX_DATA, 32'h0000_0055);
            master_apb_write(ADDR_MASTER_CMD, 32'h0001_5200);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            external_scl_low = 1'b1;
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            external_scl_low = 1'b0;
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("master timeout event", {31'd0, read_data[4]}, 1);
            check_equal("master timeout done", {31'd0, read_data[0]}, 1);
        end
    endtask

    task run_arbitration_case;
        begin
            prepare_integration_master_only;
            master_apb_write(ADDR_TX_DATA, 32'h0000_0055);
            master_apb_write(ADDR_MASTER_CMD, 32'h0001_5200);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            clear_shared_counts;
            fork
                begin
                    master_apb_write(ADDR_CTRL, 32'h0000_0007);
                    wait_integration_master_done;
                end
                begin
                    wait (shared_start_count == 1);
                    wait (!master_scl_t);
                    wait (master_scl_t && master_sda_t);
                    external_sda_low = 1'b1;
                    repeat (15) @(posedge clk);
                    external_sda_low = 1'b0;
                end
            join
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("arbitration lost event", {31'd0, read_data[3]}, 1);
            check_equal("arbitration done event", {31'd0, read_data[0]}, 1);
        end
    endtask

    task run_abort_case;
        begin
            prepare_integration_pair;
            for (integration_index = 0; integration_index < 16;
                 integration_index = integration_index + 1)
                master_apb_write(ADDR_TX_DATA, integration_index);
            master_apb_write(ADDR_MASTER_CMD, 32'h0010_5200);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            repeat (300) @(posedge clk);
            master_apb_write(ADDR_CTRL, 32'h0000_000B);
            wait_integration_master_done;
            master_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("abort MASTER_DONE", {31'd0, read_data[0]}, 1);
            check_equal("abort no CMD_ERROR", {31'd0, read_data[5]}, 0);
            master_apb_read(ADDR_STATUS, read_data);
            if (read_data[23:16] >= 16) begin
                $display("[FAIL] abort did not shorten transfer count=%0d",
                         read_data[23:16]);
                error_count = error_count + 1;
            end else begin
                $display("[PASS] abort shortened transfer count=%0d",
                         read_data[23:16]);
            end
        end
    endtask

    task run_irq_semantics_case;
        begin
            prepare_integration_pair;
            master_apb_write(ADDR_TX_DATA, 32'h0000_0044);
            master_apb_write(ADDR_MASTER_CMD, 32'h0001_5200);
            master_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_3FFF);
            master_apb_write(ADDR_CTRL, 32'h0000_0007);
            wait_integration_master_done;
            wait_integration_slave_irq(8);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("RX threshold status", {31'd0, read_data[6]}, 1);
            check_equal("masked IRQ low", {31'd0, slave_interrupt}, 0);
            slave_apb_write(ADDR_IRQ_ENABLE, 32'h0000_0040);
            check_equal("enabled IRQ high", {31'd0, slave_interrupt}, 1);
            slave_apb_write(ADDR_IRQ_ENABLE, 32'h0000_0000);
            check_equal("disabled IRQ low", {31'd0, slave_interrupt}, 0);

            slave_apb_write(ADDR_IRQ_STATUS, 32'h0000_0040);
            check_equal("threshold clear completion",
                        {31'd0, dut_slave.irq_status_reg[6]}, 0);
            @(posedge clk);
            #1;
            check_equal("threshold reassert next clock",
                        {31'd0, dut_slave.irq_status_reg[6]}, 1);

            pulse_slave_underflow_event;
            clear_underflow_with_event;
            check_equal("event set wins W1C",
                        {31'd0, dut_slave.irq_status_reg[11]}, 1);

            slave_apb_write(ADDR_CTRL, 32'h8000_0000);
            slave_apb_read(ADDR_IRQ_STATUS, read_data);
            check_equal("soft reset clears IRQ status", read_data, 0);
            slave_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("soft reset clears IRQ test FIFO",
                        read_data, 32'h0005_0000);
        end
    endtask

    task run_mode_switch_case;
        begin
            master_apb_write(ADDR_CTRL, 32'h8000_0000);
            master_apb_write(ADDR_CTRL, 32'h0000_0002);
            master_apb_write(ADDR_TX_DATA, 32'h0000_0099);
            master_apb_write(ADDR_CTRL, 32'h0000_0000);
            master_apb_read(ADDR_CTRL, read_data);
            check_equal("mode switch accepted while disabled", read_data, 0);
            master_apb_read(ADDR_FIFO_STATUS, read_data);
            check_equal("mode switch clears FIFOs", read_data, 32'h0005_0000);
            check_equal("mode switch releases lines",
                        {30'd0, master_scl_t, master_sda_t}, 3);
        end
    endtask

    initial begin
        wait (rst_n);
        repeat (4) @(posedge clk);

        $display("========== APB reset values ==========");
        check_equal("PREADY reset", {31'd0, s_apb_pready}, 0);
        check_equal("PSLVERR reset", {31'd0, s_apb_pslverr}, 0);
        check_equal("interrupt reset", {31'd0, interrupt}, 0);
        check_equal("open-drain outputs low", {30'd0, scl_o, sda_o}, 0);
        check_equal("disabled lines released", {30'd0, scl_t, sda_t}, 3);
        apb_read(ADDR_CTRL, read_data);
        check_equal("CTRL reset", read_data, 32'h0000_0000);
        apb_read(ADDR_MASTER_CMD, read_data);
        check_equal("MASTER_CMD reset", read_data, 32'h0000_0000);
        apb_read(ADDR_TIMING, read_data);
        check_equal("TIMING reset", read_data, 32'h0000_0002);
        apb_read(ADDR_STATUS, read_data);
        check_equal("STATUS reset", read_data, 32'h0000_00A0);
        apb_read(ADDR_TX_DATA, read_data);
        check_equal("TX_DATA read", read_data, 32'h0000_0000);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX_DATA empty", read_data, 32'h0000_0000);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("FIFO_STATUS reset", read_data, 32'h0005_0000);
        apb_read(ADDR_SLAVE_CFG, read_data);
        check_equal("SLAVE_CFG reset", read_data, 32'h0000_0050);
        apb_read(ADDR_STRETCH_TIMEOUT, read_data);
        check_equal("timeout reset", read_data, 32'd1000);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("IRQ_STATUS reset", read_data, 32'h0000_0000);
        apb_read(ADDR_IRQ_ENABLE, read_data);
        check_equal("IRQ_ENABLE reset", read_data, 32'h0000_0000);
        apb_read(ADDR_IRQ_THRESHOLD, read_data);
        check_equal("IRQ_THRESHOLD reset", read_data, 32'h0000_0001);

        $display("========== APB timing and masks ==========");
        check_apb_timing;
        apb_write(ADDR_MASTER_CMD, 32'hFFFF_FFFF);
        apb_read(ADDR_MASTER_CMD, read_data);
        check_equal("MASTER_CMD mask", read_data, 32'hFFFF_7F03);
        apb_write(ADDR_TIMING, 32'hFFFF_FFFF);
        apb_read(ADDR_TIMING, read_data);
        check_equal("TIMING mask", read_data, 32'h0000_FFFF);
        apb_write(ADDR_SLAVE_CFG, 32'hFFFF_FFFF);
        apb_read(ADDR_SLAVE_CFG, read_data);
        check_equal("SLAVE_CFG mask", read_data, 32'h0000_007F);
        apb_write(ADDR_STRETCH_TIMEOUT, 32'd123);
        apb_read(ADDR_STRETCH_TIMEOUT, read_data);
        check_equal("timeout readback", read_data, 32'd123);
        apb_write(ADDR_IRQ_ENABLE, 32'hFFFF_FFFF);
        apb_read(ADDR_IRQ_ENABLE, read_data);
        check_equal("IRQ_ENABLE mask", read_data, 32'h0000_3FFF);
        apb_write(ADDR_IRQ_THRESHOLD, 32'hFFFF_FFFF);
        apb_read(ADDR_IRQ_THRESHOLD, read_data);
        check_equal("IRQ_THRESHOLD mask", read_data, 32'h0000_FFFF);

        $display("========== TX FIFO ==========");
        apb_write(ADDR_TX_DATA, 32'h0000_00A1);
        apb_write(ADDR_TX_DATA, 32'h0000_00A2);
        apb_write(ADDR_TX_DATA, 32'h0000_00A3);
        apb_write(ADDR_TX_DATA, 32'h0000_00A4);
        apb_write(ADDR_TX_DATA, 32'h0000_00A5);
        apb_write(ADDR_TX_DATA, 32'h0000_00A6);
        apb_write(ADDR_TX_DATA, 32'h0000_00A7);
        apb_write(ADDR_TX_DATA, 32'h0000_00A8);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("TX FIFO full", read_data, 32'h0006_0008);
        apb_write(ADDR_TX_DATA, 32'h0000_00A9);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("full write ignored", read_data, 32'h0006_0008);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("full write CMD_ERROR", read_data, 32'h0000_0020);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0020);
        apb_write(ADDR_CTRL, 32'h0000_0010);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("TX clear", read_data, 32'h0005_0000);
        apb_read(ADDR_CTRL, read_data);
        check_equal("TX clear is pulse", read_data, 32'h0000_0000);

        $display("========== RX FIFO ==========");
        core_push_rx(8'hE1);
        core_push_rx(8'hE2);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX FIFO level two", read_data, 32'h0001_0200);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX prime read", read_data, 32'h0000_0000);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX pop once", read_data, 32'h0001_0100);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX first byte", read_data, 32'h0000_00E1);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX second byte", read_data, 32'h0000_00E2);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX empty repeats dout", read_data, 32'h0000_00E2);
        apb_write(ADDR_CTRL, 32'h0000_0020);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX clear", read_data, 32'h0005_0000);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX clear invalidates dout", read_data, 32'h0000_0000);

        $display("========== Simultaneous FIFO operations ==========");
        apb_write(ADDR_TX_DATA, 32'h0000_0011);
        apb_write_with_tx_pop(8'h22);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("TX simultaneous level", read_data, 32'h0004_0001);
        check_equal("TX simultaneous popped byte",
                    {24'd0, apb_i2c_inst.tx_fifo_data}, 32'h0000_0011);
        core_pop_tx;
        check_equal("TX simultaneous next byte",
                    {24'd0, apb_i2c_inst.tx_fifo_data}, 32'h0000_0022);
        core_push_rx(8'h31);
        apb_read_with_rx_push(8'h32, read_data);
        check_equal("RX simultaneous prime", read_data, 32'h0000_0000);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("RX simultaneous level", read_data, 32'h0001_0100);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX simultaneous first byte", read_data, 32'h0000_0031);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("RX simultaneous next byte", read_data, 32'h0000_0032);

        $display("========== Full FIFO simultaneous operations ==========");
        apb_write(ADDR_TX_DATA, 32'h0000_00A1);
        apb_write(ADDR_TX_DATA, 32'h0000_00A2);
        apb_write(ADDR_TX_DATA, 32'h0000_00A3);
        apb_write(ADDR_TX_DATA, 32'h0000_00A4);
        apb_write(ADDR_TX_DATA, 32'h0000_00A5);
        apb_write(ADDR_TX_DATA, 32'h0000_00A6);
        apb_write(ADDR_TX_DATA, 32'h0000_00A7);
        apb_write(ADDR_TX_DATA, 32'h0000_00A8);
        clear_irq_status;
        apb_write_with_tx_pop(8'hA9);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("full TX simultaneous level", read_data, 32'h0004_0007);
        check_equal("full TX simultaneous popped",
                    {24'd0, apb_i2c_inst.tx_fifo_data}, 32'h0000_00A1);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("full TX simultaneous error",
                    {31'd0, read_data[5]}, 1);
        apb_write(ADDR_CTRL, 32'h0000_0010);
        apb_write(ADDR_CTRL, 32'h0000_0020);

        core_push_rx(8'hB1);
        core_push_rx(8'hB2);
        core_push_rx(8'hB3);
        core_push_rx(8'hB4);
        core_push_rx(8'hB5);
        core_push_rx(8'hB6);
        core_push_rx(8'hB7);
        core_push_rx(8'hB8);
        apb_read_with_rx_push(8'hB9, read_data);
        check_equal("full RX simultaneous prime", read_data, 32'h0000_0000);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("full RX simultaneous level", read_data, 32'h0001_0700);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 0", read_data, 32'h0000_00B1);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 1", read_data, 32'h0000_00B2);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 2", read_data, 32'h0000_00B3);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 3", read_data, 32'h0000_00B4);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 4", read_data, 32'h0000_00B5);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 5", read_data, 32'h0000_00B6);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 6", read_data, 32'h0000_00B7);
        apb_read(ADDR_RX_DATA, read_data);
        check_equal("full RX simultaneous byte 7", read_data, 32'h0000_00B8);

        $display("========== Soft reset ==========");
        apb_write(ADDR_MASTER_CMD, 32'h1234_5602);
        apb_write(ADDR_TIMING, 32'h0000_0044);
        apb_write(ADDR_TX_DATA, 32'h0000_0055);
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_read(ADDR_MASTER_CMD, read_data);
        check_equal("soft reset MASTER_CMD", read_data, 0);
        apb_read(ADDR_TIMING, read_data);
        check_equal("soft reset TIMING", read_data, 2);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("soft reset FIFOs", read_data, 32'h0005_0000);
        apb_read(ADDR_IRQ_ENABLE, read_data);
        check_equal("soft reset IRQ_ENABLE", read_data, 0);

        $display("========== Accepted master commands ==========");
        $display("---------- Direct write ----------");
        run_accepted_command(2'b00, 8'd1, 8'd0);
        $display("---------- Direct read ----------");
        run_accepted_command(2'b01, 8'd0, 8'd1);
        $display("---------- Write then read ----------");
        run_accepted_command(2'b10, 8'd1, 8'd1);

        $display("========== Rejected command forms ==========");
        $display("---------- START in slave mode ----------");
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_MASTER_CMD, 32'h0100_5201);
        apb_write(ADDR_CTRL, 32'h0000_0001);
        clear_irq_status;
        apb_write(ADDR_CTRL, 32'h0000_0005);
        check_idle_rejection(16'h0000);

        $display("---------- Invalid OP ----------");
        run_rejected_command(2'b11, 8'd0, 8'd0, 3'd0);
        $display("---------- Write zero length ----------");
        run_rejected_command(2'b00, 8'd0, 8'd0, 4'd0);
        $display("---------- Write with RX length ----------");
        run_rejected_command(2'b00, 8'd1, 8'd1, 4'd1);
        $display("---------- Read zero length ----------");
        run_rejected_command(2'b01, 8'd0, 8'd0, 4'd0);
        $display("---------- Read with TX length ----------");
        run_rejected_command(2'b01, 8'd1, 8'd1, 4'd1);
        $display("---------- Combined missing TX ----------");
        run_rejected_command(2'b10, 8'd0, 8'd1, 4'd0);
        $display("---------- Combined missing RX ----------");
        run_rejected_command(2'b10, 8'd1, 8'd0, 4'd1);
        $display("---------- Length above FIFO depth ----------");
        run_rejected_command(2'b00, 8'd9, 8'd0, 4'd8);
        $display("---------- Insufficient TX data ----------");
        run_rejected_command(2'b00, 8'd2, 8'd0, 4'd1);

        $display("---------- Insufficient RX space ----------");
        prepare_master;
        core_push_rx(8'h41);
        core_push_rx(8'h42);
        core_push_rx(8'h43);
        core_push_rx(8'h44);
        core_push_rx(8'h45);
        core_push_rx(8'h46);
        core_push_rx(8'h47);
        apb_write(ADDR_MASTER_CMD, 32'h0200_5201);
        clear_irq_status;
        apb_write(ADDR_CTRL, 32'h0000_0007);
        check_idle_rejection(16'h0700);

        $display("========== Illegal enabled reconfiguration ==========");
        apb_write(ADDR_CTRL, 32'h8000_0000);
        apb_write(ADDR_CTRL, 32'h0000_0001);
        clear_irq_status;
        apb_write(ADDR_SLAVE_CFG, 32'h0000_0033);
        apb_read(ADDR_SLAVE_CFG, read_data);
        check_equal("enabled address unchanged", read_data, 32'h0000_0050);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("enabled address CMD_ERROR", {31'd0, read_data[5]}, 1);
        clear_irq_status;
        apb_write(ADDR_CTRL, 32'h0000_0003);
        apb_read(ADDR_CTRL, read_data);
        check_equal("enabled mode unchanged", read_data, 32'h0000_0001);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("enabled mode CMD_ERROR", {31'd0, read_data[5]}, 1);

        $display("========== Busy command rejection ==========");
        prepare_master;
        apb_write(ADDR_TIMING, 32'h0000_0003);
        apb_write(ADDR_TX_DATA, 32'h0000_005A);
        apb_write(ADDR_MASTER_CMD, 32'h0001_5200);
        clear_irq_status;
        apb_write(ADDR_CTRL, 32'h0000_0007);
        apb_read(ADDR_STATUS, read_data);
        check_equal("first command active", {31'd0, read_data[0]}, 1);
        apb_write(ADDR_CTRL, 32'h0000_0007);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("busy START CMD_ERROR", {31'd0, read_data[5]}, 1);
        clear_irq_status;
        apb_write(ADDR_CTRL, 32'h0000_0013);
        apb_read(ADDR_IRQ_STATUS, read_data);
        check_equal("active TX clear CMD_ERROR", {31'd0, read_data[5]}, 1);
        apb_read(ADDR_FIFO_STATUS, read_data);
        check_equal("active TX clear preserves FIFO",
                    {24'd0, read_data[7:0]}, 1);
        wait_master_done;

        apb_write(ADDR_CTRL, 32'h8000_0000);

        $display("========== Two-controller integration ==========");
        $display("---------- 1-byte write ----------");
        run_integration_write(1);
        $display("---------- 16-byte write ----------");
        run_integration_write(16);
        $display("---------- 1-byte read ----------");
        run_integration_read(1);
        $display("---------- 16-byte read ----------");
        run_integration_read(16);
        $display("---------- Write RESTART read ----------");
        run_integration_write_read;

        $display("========== Error and IRQ integration ==========");
        $display("---------- Wrong address ----------");
        run_wrong_address_case;
        $display("---------- Slave RX overflow ----------");
        run_slave_overflow_case;
        $display("---------- Address-stage timeout ----------");
        run_address_timeout_case;
        $display("---------- Mid-read timeout ----------");
        run_midread_timeout_case;
        $display("---------- Master timeout ----------");
        run_master_timeout_case;
        $display("---------- Arbitration lost ----------");
        run_arbitration_case;
        $display("---------- Abort ----------");
        run_abort_case;
        $display("---------- IRQ semantics ----------");
        run_irq_semantics_case;
        $display("---------- Mode switch ----------");
        run_mode_switch_case;

        if (error_count == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL: %0d errors", error_count);
        $finish;
    end

    initial #(CLK_PERIOD*500000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

    // initial begin
    //     $dumpfile("apb_i2c_tb.vcd");
    //     $dumpvars(0, apb_i2c_tb);
    // end

endmodule
