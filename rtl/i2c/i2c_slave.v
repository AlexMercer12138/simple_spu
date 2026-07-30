//================================================================================
//  Author      : Mercer
//  Module      : i2c_slave
//  Description : Runtime-addressed streaming I2C slave protocol engine
//================================================================================

module i2c_slave (
    input   wire        clk,
    input   wire        rst_n,
    input   wire        enable,
    input   wire [6:0]  device_addr,
    input   wire [31:0] timeout_cycles,

    output  reg  [7:0]  rx_data,
    output  reg         rx_valid,
    input   wire        rx_ready,
    input   wire [7:0]  tx_data,
    input   wire        tx_valid,
    output  reg         tx_ready,

    output  reg         selected,
    output  reg         read_mode,
    output  reg         stretch_active,
    output  reg         bus_busy,
    output  reg         rx_done,
    output  reg         read_done,
    output  reg         rx_overflow,
    output  reg         tx_underflow,
    output  reg         stretch_timeout,
    output  reg         bus_error,
    output  reg  [7:0]  rx_count,
    output  reg  [7:0]  tx_count,

    output  wire        scl_o,
    output  reg         scl_t,
    input   wire        scl_i,
    output  wire        sda_o,
    output  reg         sda_t,
    input   wire        sda_i
);

    localparam ST_IDLE       = 4'd0;
    localparam ST_ADDRESS    = 4'd1;
    localparam ST_ADDR_ACK   = 4'd2;
    localparam ST_RX_BYTE    = 4'd3;
    localparam ST_RX_ACK     = 4'd4;
    localparam ST_TX_WAIT    = 4'd5;
    localparam ST_TX_BYTE    = 4'd6;
    localparam ST_TX_ACK     = 4'd7;
    localparam ST_ADDR_RELEASE = 4'd8;

    reg     [3:0]   state;
    reg     [2:0]   scl_sync;
    reg     [2:0]   sda_sync;
    reg             scl_filtered;
    reg             sda_filtered;
    reg             scl_previous;
    reg             sda_previous;
    reg     [3:0]   bit_count;
    reg     [7:0]   shift_reg;
    reg             address_match;
    reg             address_read;
    reg             ack_phase;
    reg             rx_accept;
    reg             tx_loaded;
    reg             master_ack;
    reg             wait_address_ack;
    reg     [31:0]  stretch_count;

    wire            scl_rise;
    wire            scl_fall;
    wire            sda_rise;
    wire            sda_fall;
    wire            start_event;
    wire            stop_event;

    assign scl_o = 1'b0;
    assign sda_o = 1'b0;
    assign scl_rise = scl_filtered && !scl_previous;
    assign scl_fall = !scl_filtered && scl_previous;
    assign sda_rise = sda_filtered && !sda_previous;
    assign sda_fall = !sda_filtered && sda_previous;
    assign start_event = sda_fall && scl_filtered;
    assign stop_event = sda_rise && scl_filtered;

    always @(posedge clk) begin
        scl_sync <= {scl_sync[1:0], scl_i};
        sda_sync <= {sda_sync[1:0], sda_i};
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            scl_filtered <= 1'b1;
            sda_filtered <= 1'b1;
            scl_previous <= 1'b1;
            sda_previous <= 1'b1;
        end else begin
            if (&scl_sync)
                scl_filtered <= 1'b1;
            else if (~|scl_sync)
                scl_filtered <= 1'b0;

            if (&sda_sync)
                sda_filtered <= 1'b1;
            else if (~|sda_sync)
                sda_filtered <= 1'b0;

            scl_previous <= scl_filtered;
            sda_previous <= sda_filtered;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            state <= ST_IDLE;
            bit_count <= 4'd0;
            address_match <= 1'b0;
            address_read <= 1'b0;
            ack_phase <= 1'b0;
            rx_accept <= 1'b0;
            tx_loaded <= 1'b0;
            master_ack <= 1'b0;
            wait_address_ack <= 1'b0;
            stretch_count <= 32'd0;
            rx_valid <= 1'b0;
            tx_ready <= 1'b0;
            selected <= 1'b0;
            read_mode <= 1'b0;
            stretch_active <= 1'b0;
            bus_busy <= 1'b0;
            rx_done <= 1'b0;
            read_done <= 1'b0;
            rx_overflow <= 1'b0;
            tx_underflow <= 1'b0;
            stretch_timeout <= 1'b0;
            bus_error <= 1'b0;
            rx_count <= 8'd0;
            tx_count <= 8'd0;
            scl_t <= 1'b1;
            sda_t <= 1'b1;
        end else begin
            rx_done <= 1'b0;
            read_done <= 1'b0;
            rx_overflow <= 1'b0;
            tx_underflow <= 1'b0;
            stretch_timeout <= 1'b0;
            bus_error <= 1'b0;
            tx_ready <= 1'b0;

            if (!enable) begin
                state <= ST_IDLE;
                bit_count <= 4'd0;
                address_match <= 1'b0;
                address_read <= 1'b0;
                ack_phase <= 1'b0;
                rx_accept <= 1'b0;
                tx_loaded <= 1'b0;
                master_ack <= 1'b0;
                wait_address_ack <= 1'b0;
                stretch_count <= 32'd0;
                rx_valid <= 1'b0;
                selected <= 1'b0;
                read_mode <= 1'b0;
                stretch_active <= 1'b0;
                bus_busy <= 1'b0;
                rx_count <= 8'd0;
                tx_count <= 8'd0;
                scl_t <= 1'b1;
                sda_t <= 1'b1;
            end else if (start_event) begin
                if (selected) begin
                    if (read_mode)
                        read_done <= 1'b1;
                    else
                        rx_done <= 1'b1;
                end
                state <= ST_ADDRESS;
                bit_count <= 4'd0;
                address_match <= 1'b0;
                address_read <= 1'b0;
                ack_phase <= 1'b0;
                tx_loaded <= 1'b0;
                wait_address_ack <= 1'b0;
                rx_valid <= 1'b0;
                selected <= 1'b0;
                read_mode <= 1'b0;
                stretch_active <= 1'b0;
                bus_busy <= 1'b1;
                scl_t <= 1'b1;
                sda_t <= 1'b1;
            end else if (stop_event) begin
                if (selected) begin
                    if (read_mode)
                        read_done <= 1'b1;
                    else
                        rx_done <= 1'b1;
                end
                state <= ST_IDLE;
                bit_count <= 4'd0;
                ack_phase <= 1'b0;
                tx_loaded <= 1'b0;
                wait_address_ack <= 1'b0;
                rx_valid <= 1'b0;
                selected <= 1'b0;
                read_mode <= 1'b0;
                stretch_active <= 1'b0;
                bus_busy <= 1'b0;
                scl_t <= 1'b1;
                sda_t <= 1'b1;
            end else begin
                case (state)
                    ST_IDLE: begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        rx_valid <= 1'b0;
                    end

                    ST_ADDRESS: begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        if (scl_rise) begin
                            shift_reg <= {shift_reg[6:0], sda_filtered};
                            if (bit_count == 7) begin
                                address_match <= shift_reg[6:0] == device_addr;
                                address_read <= sda_filtered;
                                bit_count <= 4'd0;
                                ack_phase <= 1'b0;
                                state <= ST_ADDR_ACK;
                            end else begin
                                bit_count <= bit_count + 1'b1;
                            end
                        end
                    end

                    ST_ADDR_ACK: begin
                        if (scl_fall) begin
                            if (!ack_phase) begin
                                if (address_match && address_read && tx_valid) begin
                                    shift_reg <= tx_data;
                                    tx_ready <= 1'b1;
                                    tx_loaded <= 1'b1;
                                    sda_t <= 1'b0;
                                    ack_phase <= 1'b1;
                                end else if (address_match && address_read) begin
                                    selected <= 1'b1;
                                    read_mode <= 1'b1;
                                    stretch_active <= 1'b1;
                                    tx_underflow <= 1'b1;
                                    wait_address_ack <= 1'b1;
                                    stretch_count <= 32'd0;
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b1;
                                    state <= ST_TX_WAIT;
                                end else begin
                                    sda_t <= address_match ? 1'b0 : 1'b1;
                                    ack_phase <= 1'b1;
                                end
                            end else begin
                                ack_phase <= 1'b0;
                                if (address_match) begin
                                    selected <= 1'b1;
                                    read_mode <= address_read;
                                    bit_count <= 4'd0;
                                    if (address_read) begin
                                        tx_count <= 8'd0;
                                        bit_count <= 4'd7;
                                        if (tx_loaded) begin
                                            sda_t <= shift_reg[7];
                                            state <= ST_TX_BYTE;
                                        end else begin
                                            sda_t <= 1'b1;
                                            wait_address_ack <= 1'b0;
                                            state <= ST_TX_WAIT;
                                        end
                                    end else begin
                                        sda_t <= 1'b1;
                                        rx_count <= 8'd0;
                                        state <= ST_RX_BYTE;
                                    end
                                end else begin
                                    sda_t <= 1'b1;
                                    selected <= 1'b0;
                                    read_mode <= 1'b0;
                                    state <= ST_IDLE;
                                end
                            end
                        end
                    end

                    ST_RX_BYTE: begin
                        sda_t <= 1'b1;
                        if (scl_rise) begin
                            shift_reg <= {shift_reg[6:0], sda_filtered};
                            if (bit_count == 7) begin
                                rx_data <= {shift_reg[6:0], sda_filtered};
                                rx_accept <= rx_ready;
                                rx_valid <= rx_ready;
                                if (rx_ready)
                                    rx_count <= rx_count + 1'b1;
                                else
                                    rx_overflow <= 1'b1;
                                bit_count <= 4'd0;
                                ack_phase <= 1'b0;
                                state <= ST_RX_ACK;
                            end else begin
                                bit_count <= bit_count + 1'b1;
                            end
                        end
                    end

                    ST_RX_ACK: begin
                        rx_valid <= 1'b0;
                        if (scl_fall) begin
                            if (!ack_phase) begin
                                sda_t <= rx_accept ? 1'b0 : 1'b1;
                                ack_phase <= 1'b1;
                            end else begin
                                sda_t <= 1'b1;
                                ack_phase <= 1'b0;
                                state <= ST_RX_BYTE;
                            end
                        end
                    end

                    ST_TX_WAIT: begin
                        sda_t <= 1'b1;
                        if (tx_valid) begin
                            shift_reg <= tx_data;
                            tx_ready <= 1'b1;
                            tx_loaded <= 1'b1;
                            bit_count <= 4'd7;
                            stretch_count <= 32'd0;
                            if (wait_address_ack) begin
                                sda_t <= 1'b0;
                                scl_t <= 1'b0;
                                state <= ST_ADDR_RELEASE;
                            end else begin
                                stretch_active <= 1'b0;
                                scl_t <= 1'b1;
                                sda_t <= tx_data[7];
                                state <= ST_TX_BYTE;
                            end
                        end else if (stretch_active &&
                                     ((timeout_cycles == 0) ||
                                      (stretch_count >= timeout_cycles - 1'b1))) begin
                            scl_t <= 1'b1;
                            sda_t <= 1'b1;
                            stretch_active <= 1'b0;
                            stretch_timeout <= 1'b1;
                            stretch_count <= 32'd0;
                            if (wait_address_ack) begin
                                selected <= 1'b0;
                                read_mode <= 1'b0;
                                address_match <= 1'b0;
                                ack_phase <= 1'b0;
                                tx_loaded <= 1'b0;
                                wait_address_ack <= 1'b0;
                                state <= ST_IDLE;
                            end else begin
                                shift_reg <= 8'hFF;
                                bit_count <= 4'd7;
                                tx_loaded <= 1'b1;
                                state <= ST_TX_BYTE;
                            end
                        end else if (stretch_active) begin
                            stretch_count <= stretch_count + 1'b1;
                        end
                    end

                    ST_ADDR_RELEASE: begin
                        scl_t <= 1'b0;
                        sda_t <= 1'b0;
                        if (stretch_count >= 5) begin
                            scl_t <= 1'b1;
                            stretch_active <= 1'b0;
                            stretch_count <= 32'd0;
                            ack_phase <= 1'b1;
                            wait_address_ack <= 1'b0;
                            state <= ST_ADDR_ACK;
                        end else begin
                            stretch_count <= stretch_count + 1'b1;
                        end
                    end

                    ST_TX_BYTE: begin
                        if (scl_fall) begin
                            if (bit_count == 0) begin
                                sda_t <= 1'b1;
                                tx_count <= tx_count + 1'b1;
                                master_ack <= 1'b0;
                                state <= ST_TX_ACK;
                            end else begin
                                bit_count <= bit_count - 1'b1;
                                sda_t <= shift_reg[bit_count - 1'b1];
                            end
                        end
                    end

                    ST_TX_ACK: begin
                        sda_t <= 1'b1;
                        if (scl_rise) begin
                            master_ack <= !sda_filtered;
                        end else if (scl_fall) begin
                            if (master_ack) begin
                                if (tx_valid) begin
                                    shift_reg <= tx_data;
                                    tx_ready <= 1'b1;
                                    tx_loaded <= 1'b1;
                                    bit_count <= 4'd7;
                                    sda_t <= tx_data[7];
                                    state <= ST_TX_BYTE;
                                end else begin
                                    tx_loaded <= 1'b0;
                                    wait_address_ack <= 1'b0;
                                    stretch_active <= 1'b1;
                                    tx_underflow <= 1'b1;
                                    stretch_count <= 32'd0;
                                    scl_t <= 1'b0;
                                    state <= ST_TX_WAIT;
                                end
                            end else begin
                                read_done <= 1'b1;
                                selected <= 1'b0;
                                read_mode <= 1'b0;
                                tx_loaded <= 1'b0;
                                state <= ST_IDLE;
                            end
                        end
                    end

                    default: begin
                        state <= ST_IDLE;
                        selected <= 1'b0;
                        read_mode <= 1'b0;
                        stretch_active <= 1'b0;
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                    end
                endcase
            end
        end
    end

endmodule
