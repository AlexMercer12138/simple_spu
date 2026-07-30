//================================================================================
//  Author      : Mercer
//  Module      : i2c_master_lite
//  Description : Streaming I2C master protocol engine
//================================================================================

module i2c_master_lite (
    input   wire        clk,
    input   wire        rst_n,
    input   wire        enable,

    input   wire        cmd_start,
    input   wire [1:0]  cmd_op,
    input   wire [6:0]  cmd_addr,
    input   wire [7:0]  cmd_tx_len,
    input   wire [7:0]  cmd_rx_len,
    input   wire [15:0] scl_prescale,
    input   wire [31:0] timeout_cycles,

    input   wire [7:0]  tx_data,
    input   wire        tx_empty,
    output  wire        tx_rd_en,
    output  reg  [7:0]  rx_data,
    output  reg         rx_valid,
    input   wire        rx_ready,

    output  reg         busy,
    output  reg         done,
    output  reg         addr_nack,
    output  reg         data_nack,
    output  reg         arbitration_lost,
    output  reg         timeout,
    output  reg         bus_error,
    output  reg  [7:0]  tx_count,
    output  reg  [7:0]  rx_count,
    input   wire        abort,

    output  wire        scl_o,
    output  reg         scl_t,
    input   wire        scl_i,
    output  wire        sda_o,
    output  reg         sda_t,
    input   wire        sda_i
);

    localparam ST_IDLE       = 5'd0;
    localparam ST_BUS_CHECK  = 5'd1;
    localparam ST_START      = 5'd2;
    localparam ST_LOAD_ADDR  = 5'd3;
    localparam ST_SEND_BIT   = 5'd4;
    localparam ST_RECV_ACK   = 5'd5;
    localparam ST_LOAD_TX    = 5'd6;
    localparam ST_STOP       = 5'd7;
    localparam ST_DONE       = 5'd8;
    localparam ST_RESTART    = 5'd9;
    localparam ST_RECV_BIT   = 5'd10;
    localparam ST_SEND_ACK   = 5'd11;
    localparam ST_WAIT_RX    = 5'd12;
    localparam ST_ARB_LOST   = 5'd13;
    localparam ST_LATCH_TX   = 5'd14;

    reg     [4:0]   state;
    reg     [1:0]   phase;
    reg     [2:0]   bit_index;
    reg     [7:0]   shift_reg;
    reg             address_byte;
    reg             address_read;
    reg     [1:0]   op_reg;
    reg     [6:0]   addr_reg;
    reg     [7:0]   tx_len_reg;
    reg     [7:0]   rx_len_reg;
    reg     [15:0]  prescale_reg;
    reg     [31:0]  timeout_reg;
    reg     [15:0]  prescale_count;
    reg     [31:0]  timeout_count;
    reg             abort_pending;
    reg             ack_received;

    wire            phase_tick;
    wire            scl_waiting;
    wire            timeout_waiting;
    wire            timeout_expired;

    assign scl_o = 1'b0;
    assign sda_o = 1'b0;
    assign phase_tick = prescale_count >= prescale_reg;
    assign scl_waiting = (phase == 2'd2) &&
                         ((state == ST_SEND_BIT) ||
                          (state == ST_RECV_ACK) ||
                          (state == ST_RECV_BIT) ||
                          (state == ST_SEND_ACK) ||
                          (state == ST_RESTART) ||
                          (state == ST_STOP));
    assign timeout_waiting = ((state == ST_BUS_CHECK) && !(scl_i && sda_i)) ||
                             (scl_waiting && !scl_i);
    assign timeout_expired = (timeout_reg == 0) ||
                             (timeout_count + 1'b1 >= timeout_reg);
    assign tx_rd_en = enable && (state == ST_LOAD_TX) && !tx_empty;

    always @(posedge clk) begin
        if (!rst_n) begin
            prescale_count <= 16'd0;
        end else if (!busy) begin
            prescale_count <= 16'd0;
        end else if (phase_tick) begin
            prescale_count <= 16'd0;
        end else begin
            prescale_count <= prescale_count + 1'b1;
        end
    end

    always @(posedge clk) begin
        if (!rst_n) begin
            state <= ST_IDLE;
            phase <= 2'd0;
            bit_index <= 3'd0;
            address_byte <= 1'b0;
            address_read <= 1'b0;
            op_reg <= 2'b00;
            addr_reg <= 7'd0;
            tx_len_reg <= 8'd0;
            rx_len_reg <= 8'd0;
            prescale_reg <= 16'd0;
            timeout_reg <= 32'd0;
            timeout_count <= 32'd0;
            abort_pending <= 1'b0;
            ack_received <= 1'b0;
            rx_valid <= 1'b0;
            busy <= 1'b0;
            done <= 1'b0;
            addr_nack <= 1'b0;
            data_nack <= 1'b0;
            arbitration_lost <= 1'b0;
            timeout <= 1'b0;
            bus_error <= 1'b0;
            tx_count <= 8'd0;
            rx_count <= 8'd0;
            scl_t <= 1'b1;
            sda_t <= 1'b1;
        end else begin
            done <= 1'b0;
            addr_nack <= 1'b0;
            data_nack <= 1'b0;
            arbitration_lost <= 1'b0;
            timeout <= 1'b0;
            bus_error <= 1'b0;

            if (!enable) begin
                state <= ST_IDLE;
                phase <= 2'd0;
                timeout_count <= 32'd0;
                abort_pending <= 1'b0;
                rx_valid <= 1'b0;
                busy <= 1'b0;
                tx_count <= 8'd0;
                rx_count <= 8'd0;
                scl_t <= 1'b1;
                sda_t <= 1'b1;
            end else begin
                if (timeout_waiting && !timeout_expired)
                    timeout_count <= timeout_count + 1'b1;
                else
                    timeout_count <= 32'd0;

                if (abort && busy)
                    abort_pending <= 1'b1;

                if (scl_waiting && !scl_i && timeout_expired) begin
                    timeout <= 1'b1;
                    phase <= 2'd0;
                    if (state == ST_STOP) begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        state <= ST_DONE;
                    end else begin
                        state <= ST_STOP;
                    end
                end else case (state)
                    ST_IDLE: begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        abort_pending <= 1'b0;
                        if (cmd_start) begin
                            op_reg <= cmd_op;
                            addr_reg <= cmd_addr;
                            tx_len_reg <= cmd_tx_len;
                            rx_len_reg <= cmd_rx_len;
                            prescale_reg <= scl_prescale;
                            timeout_reg <= timeout_cycles;
                            tx_count <= 8'd0;
                            rx_count <= 8'd0;
                            busy <= 1'b1;
                            state <= ST_BUS_CHECK;
                        end
                    end

                    ST_BUS_CHECK: begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        if (scl_i && sda_i) begin
                            phase <= 2'd0;
                            state <= ST_START;
                        end else if (timeout_expired) begin
                            timeout <= 1'b1;
                            state <= ST_DONE;
                        end
                    end

                    ST_START: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b1;
                                    sda_t <= 1'b1;
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    sda_t <= 1'b0;
                                    phase <= 2'd2;
                                end
                                default: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b0;
                                    phase <= 2'd0;
                                    state <= ST_LOAD_ADDR;
                                end
                            endcase
                        end
                    end

                    ST_LOAD_ADDR: begin
                        shift_reg <= {addr_reg, op_reg == 2'b01};
                        bit_index <= 3'd7;
                        address_byte <= 1'b1;
                        address_read <= op_reg == 2'b01;
                        phase <= 2'd0;
                        state <= ST_SEND_BIT;
                    end

                    ST_SEND_BIT: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b0;
                                    sda_t <= shift_reg[bit_index];
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    phase <= 2'd2;
                                end
                                2'd2: begin
                                    if (scl_i) begin
                                        if (shift_reg[bit_index] && !sda_i) begin
                                            scl_t <= 1'b1;
                                            sda_t <= 1'b1;
                                            arbitration_lost <= 1'b1;
                                            phase <= 2'd0;
                                            state <= ST_ARB_LOST;
                                        end else begin
                                            phase <= 2'd3;
                                        end
                                    end
                                end
                                default: begin
                                    scl_t <= 1'b0;
                                    if (bit_index == 0) begin
                                        phase <= 2'd0;
                                        state <= ST_RECV_ACK;
                                    end else begin
                                        bit_index <= bit_index - 1'b1;
                                        phase <= 2'd0;
                                    end
                                end
                            endcase
                        end
                    end

                    ST_RECV_ACK: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b1;
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    phase <= 2'd2;
                                end
                                2'd2: begin
                                    if (scl_i) begin
                                        ack_received <= ~sda_i;
                                        if (sda_i) begin
                                            if (address_byte)
                                                addr_nack <= 1'b1;
                                            else
                                                data_nack <= 1'b1;
                                        end
                                        phase <= 2'd3;
                                    end
                                end
                                default: begin
                                    scl_t <= 1'b0;
                                    phase <= 2'd0;
                                    if (!ack_received) begin
                                        state <= ST_STOP;
                                    end else if (address_byte) begin
                                        if (address_read) begin
                                            bit_index <= 3'd7;
                                            state <= ST_RECV_BIT;
                                        end else begin
                                            state <= ST_LOAD_TX;
                                        end
                                    end else begin
                                        tx_count <= tx_count + 1'b1;
                                        if (abort_pending) begin
                                            state <= ST_STOP;
                                        end else if (tx_count + 1'b1 >= tx_len_reg) begin
                                            if (op_reg == 2'b10)
                                                state <= ST_RESTART;
                                            else
                                                state <= ST_STOP;
                                        end else begin
                                            state <= ST_LOAD_TX;
                                        end
                                    end
                                end
                            endcase
                        end
                    end

                    ST_LOAD_TX: begin
                        scl_t <= 1'b0;
                        if (abort_pending) begin
                            phase <= 2'd0;
                            state <= ST_STOP;
                        end else if (!tx_empty) begin
                            state <= ST_LATCH_TX;
                        end
                    end

                    ST_LATCH_TX: begin
                        shift_reg <= tx_data;
                        bit_index <= 3'd7;
                        address_byte <= 1'b0;
                        phase <= 2'd0;
                        state <= ST_SEND_BIT;
                    end

                    ST_RECV_BIT: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b1;
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    phase <= 2'd2;
                                end
                                2'd2: begin
                                    if (scl_i) begin
                                        shift_reg[bit_index] <= sda_i;
                                        phase <= 2'd3;
                                    end
                                end
                                default: begin
                                    scl_t <= 1'b0;
                                    phase <= 2'd0;
                                    if (bit_index == 0) begin
                                        rx_data <= shift_reg;
                                        rx_valid <= 1'b1;
                                        state <= ST_WAIT_RX;
                                    end else begin
                                        bit_index <= bit_index - 1'b1;
                                    end
                                end
                            endcase
                        end
                    end

                    ST_WAIT_RX: begin
                        scl_t <= 1'b0;
                        sda_t <= 1'b1;
                        if (rx_valid && rx_ready) begin
                            rx_valid <= 1'b0;
                            rx_count <= rx_count + 1'b1;
                            phase <= 2'd0;
                            state <= ST_SEND_ACK;
                        end
                    end

                    ST_SEND_ACK: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b0;
                                    sda_t <= rx_count < rx_len_reg ? 1'b0 : 1'b1;
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    phase <= 2'd2;
                                end
                                2'd2: begin
                                    if (scl_i) begin
                                        phase <= 2'd3;
                                    end
                                end
                                default: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b1;
                                    phase <= 2'd0;
                                    if ((rx_count >= rx_len_reg) || abort_pending) begin
                                        state <= ST_STOP;
                                    end else begin
                                        bit_index <= 3'd7;
                                        state <= ST_RECV_BIT;
                                    end
                                end
                            endcase
                        end
                    end

                    ST_RESTART: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b1;
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    sda_t <= 1'b1;
                                    phase <= 2'd2;
                                end
                                2'd2: begin
                                    if (scl_i) begin
                                        sda_t <= 1'b0;
                                        phase <= 2'd3;
                                    end
                                end
                                default: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b0;
                                    shift_reg <= {addr_reg, 1'b1};
                                    bit_index <= 3'd7;
                                    address_byte <= 1'b1;
                                    address_read <= 1'b1;
                                    phase <= 2'd0;
                                    state <= ST_SEND_BIT;
                                end
                            endcase
                        end
                    end

                    ST_ARB_LOST: begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        phase <= 2'd0;
                        state <= ST_DONE;
                    end

                    ST_STOP: begin
                        if (phase_tick) begin
                            case (phase)
                                2'd0: begin
                                    scl_t <= 1'b0;
                                    sda_t <= 1'b0;
                                    phase <= 2'd1;
                                end
                                2'd1: begin
                                    scl_t <= 1'b1;
                                    phase <= 2'd2;
                                end
                                2'd2: begin
                                    if (scl_i) begin
                                        sda_t <= 1'b1;
                                        phase <= 2'd3;
                                    end
                                end
                                default: begin
                                    scl_t <= 1'b1;
                                    sda_t <= 1'b1;
                                    phase <= 2'd0;
                                    state <= ST_DONE;
                                end
                            endcase
                        end
                    end

                    ST_DONE: begin
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                        busy <= 1'b0;
                        done <= 1'b1;
                        abort_pending <= 1'b0;
                        state <= ST_IDLE;
                    end

                    default: begin
                        state <= ST_IDLE;
                        phase <= 2'd0;
                        busy <= 1'b0;
                        scl_t <= 1'b1;
                        sda_t <= 1'b1;
                    end
                endcase
            end
        end
    end

endmodule
