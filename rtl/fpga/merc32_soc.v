`timescale 1ns/1ps

module merc32_soc #(
    parameter PROGRAM_INIT_FILE = "peripheral_test.mem"
)(
    input  wire       clk,
    input  wire       rst_n,
    input  wire       uart_rx,
    output wire       uart_tx,
    output wire       i2c_scl_t,
    input  wire       i2c_scl_i,
    output wire       i2c_sda_t,
    input  wire       i2c_sda_i,
    input  wire [3:0] key,
    output wire [3:0] led,
    output wire       buzzer
);

    wire        cpu_tdo;
    wire        cpu_interrupt;

    wire        dlb_en;
    wire        dlb_we;
    wire [15:0] dlb_addr;
    wire [31:0] dlb_wdata;
    wire [31:0] dlb_rdata;
    wire        ilb_en;
    wire        ilb_we;
    wire [15:0] ilb_addr;
    wire [31:0] ilb_wdata;
    wire [31:0] ilb_rdata;

    wire        m_apb_psel;
    wire        m_apb_penable;
    wire        m_apb_pwrite;
    wire [31:0] m_apb_paddr;
    wire [31:0] m_apb_pwdata;
    wire        m_apb_pready;
    wire [31:0] m_apb_prdata;

    wire        s0_apb_psel;
    wire        s0_apb_pready;
    wire [31:0] s0_apb_prdata;
    wire        s1_apb_psel;
    wire        s1_apb_pready;
    wire [31:0] s1_apb_prdata;
    wire        s2_apb_psel;
    wire        s2_apb_pready;
    wire [31:0] s2_apb_prdata;
    wire        s3_apb_psel;
    wire        s3_apb_pready;
    wire [31:0] s3_apb_prdata;
    wire        s_apb_penable;
    wire        s_apb_pwrite;
    wire [31:0] s_apb_paddr;
    wire [31:0] s_apb_pwdata;

    wire uart_interrupt;
    wire i2c_interrupt;
    wire gpio_interrupt;
    wire timer_interrupt;
    wire uart_pslverr;
    wire i2c_pslverr;
    wire gpio_pslverr;
    wire timer_pslverr;

    wire        i2c_scl_o;
    wire        i2c_sda_o;
    wire [31:0] gpio_i;
    wire [31:0] gpio_o;
    wire [31:0] gpio_t;
    wire        timer_pwm0;
    wire        timer_pwm1;

    assign cpu_interrupt = uart_interrupt | i2c_interrupt |
                           gpio_interrupt | timer_interrupt;
    assign gpio_i = {24'd0, key, 4'd0};
    assign led = gpio_o[3:0];
    assign buzzer = timer_pwm1;

    MERC32_top #(
        .ILB_ADDR_WIDTH (16),
        .DLB_ADDR_WIDTH (16)
    ) cpu_inst (
        .clk           (clk),
        .rst_n         (rst_n),
        .interrupt     (cpu_interrupt),
        .tck           (1'b0),
        .tms           (1'b1),
        .tdi           (1'b0),
        .tdo           (cpu_tdo),
        .dlb_en        (dlb_en),
        .dlb_we        (dlb_we),
        .dlb_addr      (dlb_addr),
        .dlb_wdata     (dlb_wdata),
        .dlb_rdata     (dlb_rdata),
        .ilb_en        (ilb_en),
        .ilb_we        (ilb_we),
        .ilb_addr      (ilb_addr),
        .ilb_wdata     (ilb_wdata),
        .ilb_rdata     (ilb_rdata),
        .m_apb_psel    (m_apb_psel),
        .m_apb_penable (m_apb_penable),
        .m_apb_paddr   (m_apb_paddr),
        .m_apb_pwrite  (m_apb_pwrite),
        .m_apb_pwdata  (m_apb_pwdata),
        .m_apb_prdata  (m_apb_prdata),
        .m_apb_pready  (m_apb_pready)
    );

    spram #(
        .DATA_WIDTH (32),
        .ADDR_WIDTH (16),
        .INIT_FILE  (PROGRAM_INIT_FILE)
    ) instruction_ram_inst (
        .clk  (clk),
        .en   (ilb_en),
        .we   (ilb_we),
        .din  (ilb_wdata),
        .dout (ilb_rdata),
        .addr (ilb_addr)
    );

    spram #(
        .DATA_WIDTH (32),
        .ADDR_WIDTH (16),
        .INIT_FILE  ("")
    ) data_ram_inst (
        .clk  (clk),
        .en   (dlb_en),
        .we   (dlb_we),
        .din  (dlb_wdata),
        .dout (dlb_rdata),
        .addr (dlb_addr)
    );

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

    apb_uart #(
        .SYS_CLK_FREQ (50_000_000),
        .FIFO_DEPTH   (8)
    ) uart_inst (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (s0_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s0_apb_pready),
        .s_apb_pslverr (uart_pslverr),
        .s_apb_prdata  (s0_apb_prdata),
        .interrupt     (uart_interrupt),
        .uart_rx       (uart_rx),
        .uart_tx       (uart_tx)
    );

    apb_i2c #(
        .SYS_CLK_FREQ (50_000_000),
        .FIFO_DEPTH   (16)
    ) i2c_inst (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (s1_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s1_apb_pready),
        .s_apb_pslverr (i2c_pslverr),
        .s_apb_prdata  (s1_apb_prdata),
        .interrupt     (i2c_interrupt),
        .scl_o         (i2c_scl_o),
        .scl_t         (i2c_scl_t),
        .scl_i         (i2c_scl_i),
        .sda_o         (i2c_sda_o),
        .sda_t         (i2c_sda_t),
        .sda_i         (i2c_sda_i)
    );

    apb_gpio gpio_inst (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (s2_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s2_apb_pready),
        .s_apb_pslverr (gpio_pslverr),
        .s_apb_prdata  (s2_apb_prdata),
        .gpio_i        (gpio_i),
        .gpio_o        (gpio_o),
        .gpio_t        (gpio_t),
        .interrupt     (gpio_interrupt)
    );

    apb_timer timer_inst (
        .s_apb_pclk    (clk),
        .s_apb_presetn (rst_n),
        .s_apb_psel    (s3_apb_psel),
        .s_apb_penable (s_apb_penable),
        .s_apb_pwrite  (s_apb_pwrite),
        .s_apb_paddr   (s_apb_paddr),
        .s_apb_pwdata  (s_apb_pwdata),
        .s_apb_pready  (s3_apb_pready),
        .s_apb_pslverr (timer_pslverr),
        .s_apb_prdata  (s3_apb_prdata),
        .interrupt     (timer_interrupt),
        .pwm0          (timer_pwm0),
        .pwm1          (timer_pwm1)
    );

endmodule
