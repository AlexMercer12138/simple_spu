`timescale 1ns/1ps

module apb_gpio_tb;

    localparam ADDR_CTRL        = 32'h00;
    localparam ADDR_GPIO_DIR    = 32'h04;
    localparam ADDR_GPIO_OUT    = 32'h08;
    localparam ADDR_GPIO_SET    = 32'h0c;
    localparam ADDR_GPIO_CLEAR  = 32'h10;
    localparam ADDR_GPIO_TOGGLE = 32'h14;
    localparam ADDR_GPIO_IN     = 32'h18;
    localparam ADDR_IRQ_TYPE    = 32'h1c;
    localparam ADDR_IRQ_ENABLE  = 32'h20;
    localparam ADDR_IRQ_STATUS  = 32'h24;

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
    reg  [31:0] gpio_i = 32'd0;
    wire [31:0] gpio_o;
    wire [31:0] gpio_t;
    wire        interrupt;

    integer errors = 0;
    reg [31:0] read_data;

    always #(5) clk = ~clk;

    apb_gpio apb_gpio_inst (
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
        .gpio_i        (gpio_i),
        .gpio_o        (gpio_o),
        .gpio_t        (gpio_t),
        .interrupt     (interrupt)
    );

    task check_equal;
        input [255:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s actual=%h expected=%h", name, actual, expected);
                errors = errors + 1;
            end else begin
                $display("[PASS] %0s value=%h", name, actual);
            end
        end
    endtask

    task apb_write;
        input [31:0] addr;
        input [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b1;
            s_apb_paddr <= addr;
            s_apb_pwdata <= data;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            while (!s_apb_pready)
                @(negedge clk);
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
        end
    endtask

    task apb_read;
        input  [31:0] addr;
        output [31:0] data;
        begin
            @(negedge clk);
            s_apb_psel <= 1'b1;
            s_apb_penable <= 1'b0;
            s_apb_pwrite <= 1'b0;
            s_apb_paddr <= addr;
            @(negedge clk);
            s_apb_penable <= 1'b1;
            while (!s_apb_pready)
                @(negedge clk);
            data = s_apb_prdata;
            @(negedge clk);
            s_apb_psel <= 1'b0;
            s_apb_penable <= 1'b0;
        end
    endtask

    task wait_cycles;
        input [31:0] cycles;
        integer index;
        begin
            for (index = 0; index < cycles; index = index + 1)
                @(negedge clk);
        end
    endtask

    task expect_register;
        input [255:0] name;
        input [31:0] addr;
        input [31:0] expected;
        begin
            apb_read(addr, read_data);
            check_equal(name, read_data, expected);
        end
    endtask

    initial begin
        // $dumpfile("apb_gpio_tb.vcd");
        // $dumpvars(0, apb_gpio_tb);

        gpio_i = 32'h1357_9bdf;
        repeat (2) @(posedge clk);

        // Start the first read with reset release so GPIO_IN is sampled before
        // the two-cycle synchronization-valid pipeline completes.
        @(negedge clk);
        rst_n <= 1'b1;
        s_apb_psel <= 1'b1;
        s_apb_penable <= 1'b0;
        s_apb_pwrite <= 1'b0;
        s_apb_paddr <= ADDR_GPIO_IN;
        #1;
        check_equal("PREADY low in setup", s_apb_pready, 32'd0);
        @(negedge clk);
        s_apb_penable <= 1'b1;
        #1;
        check_equal("PREADY high in access", s_apb_pready, 32'd1);
        check_equal("GPIO_IN invalid reads zero", s_apb_prdata, 32'd0);
        check_equal("PSLVERR low", s_apb_pslverr, 32'd0);
        @(negedge clk);
        s_apb_psel <= 1'b0;
        s_apb_penable <= 1'b0;
        #1;
        check_equal("PREADY low after completion", s_apb_pready, 32'd0);

        expect_register("CTRL reset", ADDR_CTRL, 32'd0);
        expect_register("GPIO_DIR reset", ADDR_GPIO_DIR, 32'd0);
        expect_register("GPIO_OUT reset", ADDR_GPIO_OUT, 32'd0);
        expect_register("IRQ_TYPE reset", ADDR_IRQ_TYPE, 32'd7);
        expect_register("IRQ_ENABLE reset", ADDR_IRQ_ENABLE, 32'd0);
        expect_register("IRQ_STATUS reset", ADDR_IRQ_STATUS, 32'd0);
        check_equal("gpio_t reset", gpio_t, 32'hffff_ffff);
        check_equal("gpio_o reset", gpio_o, 32'd0);
        check_equal("interrupt reset", interrupt, 32'd0);
        expect_register("GPIO_IN synchronized", ADDR_GPIO_IN, 32'h1357_9bdf);

        apb_write(ADDR_GPIO_OUT, 32'h1234_5678);
        expect_register("direct output write", ADDR_GPIO_OUT, 32'h1234_5678);
        apb_write(ADDR_GPIO_SET, 32'h0000_0085);
        expect_register("atomic set", ADDR_GPIO_OUT, 32'h1234_56fd);
        apb_write(ADDR_GPIO_CLEAR, 32'h0000_00c1);
        expect_register("atomic clear", ADDR_GPIO_OUT, 32'h1234_563c);
        apb_write(ADDR_GPIO_TOGGLE, 32'h0000_003f);
        expect_register("atomic toggle", ADDR_GPIO_OUT, 32'h1234_5603);
        expect_register("SET reads zero", ADDR_GPIO_SET, 32'd0);
        expect_register("CLEAR reads zero", ADDR_GPIO_CLEAR, 32'd0);
        expect_register("TOGGLE reads zero", ADDR_GPIO_TOGGLE, 32'd0);

        apb_write(ADDR_GPIO_DIR, 32'h00ff_0f0f);
        check_equal("gpio_t follows direction", gpio_t, 32'hff00_f0f0);
        check_equal("gpio_o keeps output latch", gpio_o, 32'h1234_5603);

        // Isolate pin 0 as the only input for interrupt tests.
        apb_write(ADDR_GPIO_DIR, 32'hffff_fffe);
        gpio_i <= 32'd0;
        wait_cycles(4);

        apb_write(ADDR_IRQ_TYPE, 32'd0);
        expect_register("low-level event", ADDR_IRQ_STATUS, 32'h0000_0001);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);
        expect_register("active low level set wins W1C", ADDR_IRQ_STATUS,
                        32'h0000_0001);
        gpio_i <= 32'h0000_0001;
        wait_cycles(4);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);
        expect_register("inactive low level clears", ADDR_IRQ_STATUS, 32'd0);

        apb_write(ADDR_IRQ_TYPE, 32'd1);
        expect_register("high-level event", ADDR_IRQ_STATUS, 32'h0000_0001);
        check_equal("masked level no interrupt", interrupt, 32'd0);
        apb_write(ADDR_IRQ_ENABLE, 32'h0000_0001);
        check_equal("enabling pending asserts interrupt", interrupt, 32'd1);
        apb_write(ADDR_IRQ_ENABLE, 32'd0);
        gpio_i <= 32'd0;
        wait_cycles(4);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);
        expect_register("inactive high level clears", ADDR_IRQ_STATUS, 32'd0);

        apb_write(ADDR_IRQ_TYPE, 32'd2);
        expect_register("rising type write clears", ADDR_IRQ_STATUS, 32'd0);
        gpio_i <= 32'h0000_0001;
        wait_cycles(4);
        expect_register("rising edge pending while masked", ADDR_IRQ_STATUS,
                        32'h0000_0001);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);
        expect_register("rising W1C clear", ADDR_IRQ_STATUS, 32'd0);

        apb_write(ADDR_IRQ_TYPE, 32'd3);
        gpio_i <= 32'd0;
        wait_cycles(4);
        expect_register("falling edge pending", ADDR_IRQ_STATUS,
                        32'h0000_0001);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);

        apb_write(ADDR_IRQ_TYPE, 32'd4);
        gpio_i <= 32'h0000_0001;
        wait_cycles(4);
        expect_register("both-edge rising pending", ADDR_IRQ_STATUS,
                        32'h0000_0001);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);
        gpio_i <= 32'd0;
        wait_cycles(4);
        expect_register("both-edge falling pending", ADDR_IRQ_STATUS,
                        32'h0000_0001);
        apb_write(ADDR_IRQ_STATUS, 32'h0000_0001);

        // History tracks while a pin is an output, so switching it back to an
        // input at a stable level must not manufacture an edge.
        apb_write(ADDR_GPIO_DIR, 32'hffff_ffff);
        gpio_i <= 32'h0000_0001;
        wait_cycles(4);
        expect_register("output pin creates no event", ADDR_IRQ_STATUS, 32'd0);
        apb_write(ADDR_GPIO_DIR, 32'hffff_fffe);
        wait_cycles(2);
        expect_register("direction change creates no edge", ADDR_IRQ_STATUS,
                        32'd0);

        // Reprogramming the type rebases history and clears pending.
        gpio_i <= 32'd0;
        wait_cycles(4);
        gpio_i <= 32'h0000_0001;
        wait_cycles(4);
        expect_register("pending before type write", ADDR_IRQ_STATUS,
                        32'h0000_0001);
        apb_write(ADDR_IRQ_TYPE, 32'd2);
        expect_register("type write clears pending", ADDR_IRQ_STATUS, 32'd0);
        wait_cycles(2);
        expect_register("type write rebases history", ADDR_IRQ_STATUS, 32'd0);

        apb_write(ADDR_IRQ_TYPE, 32'd5);
        gpio_i <= 32'd0;
        wait_cycles(4);
        expect_register("reserved type 5 no event", ADDR_IRQ_STATUS, 32'd0);
        apb_write(ADDR_IRQ_TYPE, 32'd6);
        gpio_i <= 32'h0000_0001;
        wait_cycles(4);
        expect_register("reserved type 6 no event", ADDR_IRQ_STATUS, 32'd0);
        apb_write(ADDR_IRQ_TYPE, 32'd7);
        gpio_i <= 32'd0;
        wait_cycles(4);
        expect_register("reserved type 7 no event", ADDR_IRQ_STATUS, 32'd0);

        apb_write(32'h0000_0080, 32'hffff_ffff);
        expect_register("undefined read zero", 32'h0000_0080, 32'd0);
        expect_register("undefined write ignored", ADDR_GPIO_OUT,
                        32'h1234_5603);

        apb_write(ADDR_IRQ_ENABLE, 32'hffff_ffff);
        apb_write(ADDR_CTRL, 32'h8000_0000);
        expect_register("soft reset direction", ADDR_GPIO_DIR, 32'd0);
        expect_register("soft reset output", ADDR_GPIO_OUT, 32'd0);
        expect_register("soft reset IRQ type", ADDR_IRQ_TYPE, 32'd7);
        expect_register("soft reset IRQ enable", ADDR_IRQ_ENABLE, 32'd0);
        expect_register("soft reset IRQ status", ADDR_IRQ_STATUS, 32'd0);
        check_equal("soft reset gpio_t", gpio_t, 32'hffff_ffff);
        check_equal("soft reset gpio_o", gpio_o, 32'd0);
        check_equal("soft reset interrupt", interrupt, 32'd0);

        // An already-high input cannot create a false first rising edge after
        // the synchronizer validity pipeline and type-write rebase.
        gpio_i <= 32'hffff_ffff;
        wait_cycles(3);
        apb_write(ADDR_IRQ_TYPE, 32'd2);
        wait_cycles(2);
        expect_register("first synchronized sample creates no edge",
                        ADDR_IRQ_STATUS, 32'd0);

        if (errors == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL errors=%0d", errors);
        $finish;
    end

    initial #(100000) begin
        $display("TEST TIMEOUT");
        $finish;
    end

endmodule
