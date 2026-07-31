`timescale 1ns/1ps

module apb4_interconnect_tb;

    reg         m_apb_psel = 1'b0;
    reg         m_apb_penable = 1'b0;
    reg         m_apb_pwrite = 1'b0;
    reg  [31:0] m_apb_paddr = 32'd0;
    reg  [31:0] m_apb_pwdata = 32'd0;
    wire        m_apb_pready;
    wire [31:0] m_apb_prdata;

    wire        s0_apb_psel;
    reg         s0_apb_pready = 1'b0;
    reg  [31:0] s0_apb_prdata = 32'h1111_1111;
    wire        s1_apb_psel;
    reg         s1_apb_pready = 1'b0;
    reg  [31:0] s1_apb_prdata = 32'h2222_2222;
    wire        s2_apb_psel;
    reg         s2_apb_pready = 1'b0;
    reg  [31:0] s2_apb_prdata = 32'h3333_3333;
    wire        s3_apb_psel;
    reg         s3_apb_pready = 1'b0;
    reg  [31:0] s3_apb_prdata = 32'h4444_4444;

    wire        s_apb_penable;
    wire        s_apb_pwrite;
    wire [31:0] s_apb_paddr;
    wire [31:0] s_apb_pwdata;

    integer errors = 0;

    apb4_interconnect apb4_interconnect_inst (
        .m_apb_psel     (m_apb_psel),
        .m_apb_penable  (m_apb_penable),
        .m_apb_pwrite   (m_apb_pwrite),
        .m_apb_paddr    (m_apb_paddr),
        .m_apb_pwdata   (m_apb_pwdata),
        .m_apb_pready   (m_apb_pready),
        .m_apb_prdata   (m_apb_prdata),
        .s0_apb_psel    (s0_apb_psel),
        .s0_apb_pready  (s0_apb_pready),
        .s0_apb_prdata  (s0_apb_prdata),
        .s1_apb_psel    (s1_apb_psel),
        .s1_apb_pready  (s1_apb_pready),
        .s1_apb_prdata  (s1_apb_prdata),
        .s2_apb_psel    (s2_apb_psel),
        .s2_apb_pready  (s2_apb_pready),
        .s2_apb_prdata  (s2_apb_prdata),
        .s3_apb_psel    (s3_apb_psel),
        .s3_apb_pready  (s3_apb_pready),
        .s3_apb_prdata  (s3_apb_prdata),
        .s_apb_penable  (s_apb_penable),
        .s_apb_pwrite   (s_apb_pwrite),
        .s_apb_paddr    (s_apb_paddr),
        .s_apb_pwdata   (s_apb_pwdata)
    );

    task check_equal;
        input [255:0] name;
        input [31:0] actual;
        input [31:0] expected;
        begin
            if (actual !== expected) begin
                $display("[FAIL] %0s actual=%h expected=%h", name, actual,
                         expected);
                errors = errors + 1;
            end
        end
    endtask

    task drive_master;
        input        psel;
        input        penable;
        input        pwrite;
        input [31:0] paddr;
        input [31:0] pwdata;
        begin
            m_apb_psel = psel;
            m_apb_penable = penable;
            m_apb_pwrite = pwrite;
            m_apb_paddr = paddr;
            m_apb_pwdata = pwdata;
            #1;
        end
    endtask

    task check_selects;
        input [3:0] expected;
        begin
            check_equal("slave selects", {28'd0, s3_apb_psel,
                        s2_apb_psel, s1_apb_psel, s0_apb_psel},
                        {28'd0, expected});
        end
    endtask

    initial begin
        // $dumpfile("apb4_interconnect_tb.vcd");
        // $dumpvars(0, apb4_interconnect_tb);

        s0_apb_pready = 1'b1;
        s1_apb_pready = 1'b1;
        s2_apb_pready = 1'b1;
        s3_apb_pready = 1'b1;

        drive_master(1'b0, 1'b0, 1'b0, 32'h1000_0000, 32'd0);
        check_selects(4'b0000);
        check_equal("idle ready low", m_apb_pready, 32'd0);

        s0_apb_pready = 1'b0;
        drive_master(1'b1, 1'b0, 1'b1, 32'h1000_1234,
                     32'ha5a5_5a5a);
        check_selects(4'b0001);
        check_equal("setup penable forwarded", s_apb_penable, 32'd0);
        check_equal("write forwarded", s_apb_pwrite, 32'd1);
        check_equal("address forwarded", s_apb_paddr, 32'h1000_1234);
        check_equal("write data forwarded", s_apb_pwdata, 32'ha5a5_5a5a);

        drive_master(1'b1, 1'b1, 1'b1, 32'h1000_1234,
                     32'ha5a5_5a5a);
        check_equal("selected slave wait", m_apb_pready, 32'd0);
        s0_apb_pready = 1'b1;
        #1;
        check_equal("selected slave completion", m_apb_pready, 32'd1);
        check_equal("slave zero read response", m_apb_prdata,
                    32'h1111_1111);

        drive_master(1'b1, 1'b1, 1'b0, 32'h1001_abcd, 32'd0);
        check_selects(4'b0010);
        check_equal("slave one read response", m_apb_prdata,
                    32'h2222_2222);

        s2_apb_pready = 1'b0;
        drive_master(1'b1, 1'b1, 1'b0, 32'h1002_ffff, 32'd0);
        check_selects(4'b0100);
        check_equal("nonselected ready ignored", m_apb_pready, 32'd0);
        check_equal("slave two read response", m_apb_prdata,
                    32'h3333_3333);
        s2_apb_pready = 1'b1;

        drive_master(1'b1, 1'b1, 1'b0, 32'h1003_0040, 32'd0);
        check_selects(4'b1000);
        check_equal("slave three read response", m_apb_prdata,
                    32'h4444_4444);

        drive_master(1'b1, 1'b0, 1'b0, 32'h1004_0000, 32'd0);
        check_selects(4'b0000);
        check_equal("unmapped setup waits", m_apb_pready, 32'd0);
        check_equal("unmapped read zero", m_apb_prdata, 32'd0);
        drive_master(1'b1, 1'b1, 1'b0, 32'h1004_0000, 32'd0);
        check_equal("unmapped access completes", m_apb_pready, 32'd1);

        drive_master(1'b1, 1'b1, 1'b0, 32'h0fff_ffff, 32'd0);
        check_selects(4'b0000);
        check_equal("lower unmapped completes", m_apb_pready, 32'd1);
        check_equal("lower unmapped reads zero", m_apb_prdata, 32'd0);

        drive_master(1'b0, 1'b1, 1'b0, 32'h1003_0000, 32'd0);
        check_selects(4'b0000);
        check_equal("deselected ready low", m_apb_pready, 32'd0);

        if (errors == 0)
            $display("TEST PASS");
        else
            $display("TEST FAIL errors=%0d", errors);
        $finish;
    end

    initial #(20000) begin
        $display("TEST FAIL timeout");
        $finish;
    end

endmodule
