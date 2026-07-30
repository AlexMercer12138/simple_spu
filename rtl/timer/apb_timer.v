`timescale 1ns/1ps

module apb_timer (
    input  wire        s_apb_pclk,
    input  wire        s_apb_presetn,
    input  wire        s_apb_psel,
    input  wire        s_apb_penable,
    input  wire        s_apb_pwrite,
    input  wire [31:0] s_apb_paddr,
    input  wire [31:0] s_apb_pwdata,
    output wire        s_apb_pready,
    output wire        s_apb_pslverr,
    output wire [31:0] s_apb_prdata,
    output wire        interrupt,
    output wire        pwm0,
    output wire        pwm1
);

    wire        clk;
    wire        rst_n;
    wire [9:0]  word_addr;
    wire        apb_setup;
    wire        apb_write_access;
    wire        ctrl_write;
    wire        soft_reset_write;
    wire        timer_core_rst_n;
    wire        timer0_clear;
    wire        timer1_clear;
    wire        timer0_config_write;
    wire        timer0_max_write;
    wire        timer0_compare_write;
    wire        timer1_config_write;
    wire        timer1_max_write;
    wire        timer1_compare_write;
    wire        timer0_running_reject;
    wire        timer1_running_reject;
    wire        timer0_cycle_reject;
    wire        timer1_cycle_reject;
    wire        config_error_event;
    wire        timer0_tick;
    wire        timer1_tick;
    wire [31:0] timer0_count;
    wire [31:0] timer1_count;
    wire        timer0_overflow;
    wire        timer1_overflow;
    wire        irq_status_write;
    wire [2:0]  irq_events;

    reg         apb_pready;
    reg  [31:0] apb_prdata;
    reg  [1:0]  timer_enable_reg;
    reg  [3:0]  timer0_config_reg;
    reg  [3:0]  timer1_config_reg;
    reg  [31:0] timer0_max_reg;
    reg  [31:0] timer1_max_reg;
    reg  [31:0] timer0_compare_reg;
    reg  [31:0] timer1_compare_reg;
    reg  [2:0]  irq_status_reg;
    reg  [2:0]  irq_enable_reg;

    assign clk = s_apb_pclk;
    assign rst_n = s_apb_presetn;
    assign word_addr = s_apb_paddr[11:2];
    assign apb_setup = s_apb_psel && !s_apb_penable;
    assign apb_write_access = s_apb_psel && s_apb_penable &&
                              s_apb_pwrite && apb_pready;
    assign ctrl_write = apb_write_access && (word_addr == 10'd0);
    assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
    assign timer0_clear = ctrl_write && !soft_reset_write &&
                          s_apb_pwdata[8];
    assign timer1_clear = ctrl_write && !soft_reset_write &&
                          s_apb_pwdata[9];
    assign timer_core_rst_n = rst_n && !soft_reset_write;

    assign s_apb_pready = apb_pready;
    assign s_apb_pslverr = 1'b0;
    assign s_apb_prdata = apb_prdata;

    assign timer0_config_write = apb_write_access && (word_addr == 10'd3);
    assign timer0_max_write = apb_write_access && (word_addr == 10'd5);
    assign timer0_compare_write = apb_write_access && (word_addr == 10'd6);
    assign timer1_config_write = apb_write_access && (word_addr == 10'd7);
    assign timer1_max_write = apb_write_access && (word_addr == 10'd9);
    assign timer1_compare_write = apb_write_access && (word_addr == 10'd10);

    assign timer0_running_reject = timer_enable_reg[0] &&
        (timer0_config_write || timer0_max_write || timer0_compare_write);
    assign timer1_running_reject = timer_enable_reg[1] &&
        (timer1_config_write || timer1_max_write || timer1_compare_write);
    assign timer0_cycle_reject = timer0_config_write &&
        !timer_enable_reg[0] && s_apb_pwdata[0] && timer1_config_reg[0];
    assign timer1_cycle_reject = timer1_config_write &&
        !timer_enable_reg[1] && s_apb_pwdata[0] && timer0_config_reg[0];
    assign config_error_event = timer0_running_reject ||
                                timer1_running_reject ||
                                timer0_cycle_reject ||
                                timer1_cycle_reject;

    assign timer0_tick = timer0_config_reg[0] ? timer1_overflow : 1'b1;
    assign timer1_tick = timer1_config_reg[0] ? timer0_overflow : 1'b1;

    assign irq_status_write = apb_write_access && (word_addr == 10'd1);
    assign irq_events = {config_error_event, timer1_overflow,
                         timer0_overflow};
    assign interrupt = |(irq_status_reg & irq_enable_reg);

    timer_channel timer_channel0_inst (
        .clk          (clk),
        .rst_n        (timer_core_rst_n),
        .enable       (timer_enable_reg[0]),
        .clear        (timer0_clear),
        .count_tick   (timer0_tick),
        .count_max    (timer0_max_reg),
        .pwm_compare  (timer0_compare_reg),
        .pwm_mode     (timer0_config_reg[2:1]),
        .pwm_polarity (timer0_config_reg[3]),
        .count        (timer0_count),
        .overflow     (timer0_overflow),
        .pwm          (pwm0)
    );

    timer_channel timer_channel1_inst (
        .clk          (clk),
        .rst_n        (timer_core_rst_n),
        .enable       (timer_enable_reg[1]),
        .clear        (timer1_clear),
        .count_tick   (timer1_tick),
        .count_max    (timer1_max_reg),
        .pwm_compare  (timer1_compare_reg),
        .pwm_mode     (timer1_config_reg[2:1]),
        .pwm_polarity (timer1_config_reg[3]),
        .count        (timer1_count),
        .overflow     (timer1_overflow),
        .pwm          (pwm1)
    );

    always @(posedge clk) begin
        if (!rst_n)
            apb_pready <= 1'b0;
        else if (s_apb_psel && apb_pready)
            apb_pready <= 1'b0;
        else if (s_apb_psel)
            apb_pready <= 1'b1;
        else
            apb_pready <= 1'b0;
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            apb_prdata <= 32'd0;
        end else if (apb_setup) begin
            case (word_addr)
                10'd0: apb_prdata <= {30'd0, timer_enable_reg};
                10'd1: apb_prdata <= {29'd0, irq_status_reg};
                10'd2: apb_prdata <= {29'd0, irq_enable_reg};
                10'd3: apb_prdata <= {28'd0, timer0_config_reg};
                10'd4: apb_prdata <= timer0_count;
                10'd5: apb_prdata <= timer0_max_reg;
                10'd6: apb_prdata <= timer0_compare_reg;
                10'd7: apb_prdata <= {28'd0, timer1_config_reg};
                10'd8: apb_prdata <= timer1_count;
                10'd9: apb_prdata <= timer1_max_reg;
                10'd10: apb_prdata <= timer1_compare_reg;
                default: apb_prdata <= 32'd0;
            endcase
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            timer_enable_reg <= 2'b00;
        end else if (ctrl_write) begin
            timer_enable_reg <= s_apb_pwdata[1:0];
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            timer0_config_reg <= 4'd0;
            timer1_config_reg <= 4'd0;
            timer0_max_reg <= 32'hffff_ffff;
            timer1_max_reg <= 32'hffff_ffff;
            timer0_compare_reg <= 32'd0;
            timer1_compare_reg <= 32'd0;
        end else begin
            if (timer0_config_write && !timer0_running_reject &&
                !timer0_cycle_reject)
                timer0_config_reg <= s_apb_pwdata[3:0];
            if (timer0_max_write && !timer0_running_reject)
                timer0_max_reg <= s_apb_pwdata;
            if (timer0_compare_write && !timer0_running_reject)
                timer0_compare_reg <= s_apb_pwdata;
            if (timer1_config_write && !timer1_running_reject &&
                !timer1_cycle_reject)
                timer1_config_reg <= s_apb_pwdata[3:0];
            if (timer1_max_write && !timer1_running_reject)
                timer1_max_reg <= s_apb_pwdata;
            if (timer1_compare_write && !timer1_running_reject)
                timer1_compare_reg <= s_apb_pwdata;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            irq_enable_reg <= 3'b000;
        end else if (apb_write_access && (word_addr == 10'd2)) begin
            irq_enable_reg <= s_apb_pwdata[2:0];
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            irq_status_reg <= 3'b000;
        end else begin
            irq_status_reg <=
                (irq_status_reg &
                 ~(irq_status_write ? s_apb_pwdata[2:0] : 3'b000)) |
                irq_events;
        end
    end

endmodule
