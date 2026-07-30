`timescale 1ns/1ps

module apb_gpio (
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
    input  wire [31:0] gpio_i,
    output wire [31:0] gpio_o,
    output wire [31:0] gpio_t,
    output wire        interrupt
);

    wire        clk;
    wire        rst_n;
    wire [9:0]  word_addr;
    wire        apb_setup;
    wire        apb_write_access;
    wire        ctrl_write;
    wire        soft_reset_write;
    wire        sync_valid;
    wire [31:0] gpio_in_value;
    wire        irq_type_write;
    wire        irq_status_write;
    wire [31:0] irq_event;

    reg         apb_pready;
    reg  [31:0] apb_prdata;
    reg  [31:0] gpio_dir_reg;
    reg  [31:0] gpio_out_reg;
    reg  [31:0] gpio_sync_ff0;
    reg  [31:0] gpio_sync_ff1;
    reg  [1:0]  sync_valid_pipe;
    reg  [31:0] gpio_previous_reg;
    reg         irq_history_valid;
    reg  [2:0]  irq_type_reg;
    reg  [31:0] irq_enable_reg;
    reg  [31:0] irq_status_reg;

    assign clk = s_apb_pclk;
    assign rst_n = s_apb_presetn;
    assign word_addr = s_apb_paddr[11:2];
    assign apb_setup = s_apb_psel && !s_apb_penable;
    assign apb_write_access = s_apb_psel && s_apb_penable &&
                              s_apb_pwrite && apb_pready;
    assign ctrl_write = apb_write_access && (word_addr == 10'd0);
    assign soft_reset_write = ctrl_write && s_apb_pwdata[31];
    assign s_apb_pready = apb_pready;
    assign s_apb_pslverr = 1'b0;
    assign s_apb_prdata = apb_prdata;

    assign gpio_o = gpio_out_reg;
    assign gpio_t = ~gpio_dir_reg;
    assign sync_valid = sync_valid_pipe[1];
    assign gpio_in_value = sync_valid ? gpio_sync_ff1 : 32'd0;

    assign irq_type_write = apb_write_access && (word_addr == 10'd7);
    assign irq_status_write = apb_write_access && (word_addr == 10'd9);
    assign irq_event = (sync_valid && !irq_type_write) ?
                       (~gpio_dir_reg & irq_event_value(
                           irq_type_reg, gpio_sync_ff1, gpio_previous_reg,
                           irq_history_valid)) : 32'd0;
    assign interrupt = |(irq_status_reg & irq_enable_reg);

    function [31:0] irq_event_value;
        input [2:0]  trigger_type;
        input [31:0] current_value;
        input [31:0] previous_value;
        input        edge_history_valid;
        begin
            case (trigger_type)
                3'd0: irq_event_value = ~current_value;
                3'd1: irq_event_value = current_value;
                3'd2: irq_event_value = edge_history_valid ?
                                          current_value & ~previous_value :
                                          32'd0;
                3'd3: irq_event_value = edge_history_valid ?
                                          ~current_value & previous_value :
                                          32'd0;
                3'd4: irq_event_value = edge_history_valid ?
                                          current_value ^ previous_value :
                                          32'd0;
                default: irq_event_value = 32'd0;
            endcase
        end
    endfunction

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
                10'd0: apb_prdata <= 32'd0;
                10'd1: apb_prdata <= gpio_dir_reg;
                10'd2: apb_prdata <= gpio_out_reg;
                10'd3: apb_prdata <= 32'd0;
                10'd4: apb_prdata <= 32'd0;
                10'd5: apb_prdata <= 32'd0;
                10'd6: apb_prdata <= gpio_in_value;
                10'd7: apb_prdata <= {29'd0, irq_type_reg};
                10'd8: apb_prdata <= irq_enable_reg;
                10'd9: apb_prdata <= irq_status_reg;
                default: apb_prdata <= 32'd0;
            endcase
        end
    end

    always @(posedge clk) begin
        gpio_sync_ff0 <= gpio_i;
        gpio_sync_ff1 <= gpio_sync_ff0;
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write)
            sync_valid_pipe <= 2'b00;
        else
            sync_valid_pipe <= {sync_valid_pipe[0], 1'b1};
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            gpio_dir_reg <= 32'd0;
            gpio_out_reg <= 32'd0;
        end else if (apb_write_access) begin
            case (word_addr)
                10'd1: gpio_dir_reg <= s_apb_pwdata;
                10'd2: gpio_out_reg <= s_apb_pwdata;
                10'd3: gpio_out_reg <= gpio_out_reg | s_apb_pwdata;
                10'd4: gpio_out_reg <= gpio_out_reg & ~s_apb_pwdata;
                10'd5: gpio_out_reg <= gpio_out_reg ^ s_apb_pwdata;
                default: begin
                end
            endcase
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            irq_type_reg <= 3'd7;
            irq_enable_reg <= 32'd0;
        end else if (apb_write_access) begin
            case (word_addr)
                10'd7: irq_type_reg <= s_apb_pwdata[2:0];
                10'd8: irq_enable_reg <= s_apb_pwdata;
                default: begin
                end
            endcase
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            gpio_previous_reg <= 32'd0;
            irq_history_valid <= 1'b0;
        end else if (sync_valid) begin
            gpio_previous_reg <= gpio_sync_ff1;
            irq_history_valid <= 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n || soft_reset_write) begin
            irq_status_reg <= 32'd0;
        end else if (irq_type_write) begin
            irq_status_reg <= 32'd0;
        end else begin
            irq_status_reg <=
                (irq_status_reg &
                 ~(irq_status_write ? s_apb_pwdata : 32'd0)) |
                irq_event;
        end
    end

endmodule
