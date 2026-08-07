`timescale 1ns / 1ps

//================================================================================
//  Module      : jtag_debug
//  Description : IEEE 1149.1 TAP transport for the MERC32 debug interface
//================================================================================

module jtag_debug #(
    parameter   IDCODE_VALUE            = 32'h4d32_0001
) (
    input                               clk,
    input                               rst_n,

    input                               tck,
    input                               tms,
    input                               tdi,
    output reg                          tdo,

    output                              dbg_rst_req,
    output                              dbg_halt_req,
    output                              dbg_step_req,
    output                              dbg_regi_req,
    input                               dbg_regi_vld,
    input       [31:0]                  dbg_regi_data,
    input                               dbg_halted,

    output                              dbg_rden,
    output                              dbg_wren,
    output      [31:0]                  dbg_addr,
    output      [31:0]                  dbg_wdata,
    input       [31:0]                  dbg_rdata,
    input                               dbg_ack
    );

    localparam  TAP_TEST_LOGIC_RESET    = 4'd0;
    localparam  TAP_RUN_TEST_IDLE       = 4'd1;
    localparam  TAP_SELECT_DR_SCAN      = 4'd2;
    localparam  TAP_CAPTURE_DR          = 4'd3;
    localparam  TAP_SHIFT_DR            = 4'd4;
    localparam  TAP_EXIT1_DR            = 4'd5;
    localparam  TAP_PAUSE_DR            = 4'd6;
    localparam  TAP_EXIT2_DR            = 4'd7;
    localparam  TAP_UPDATE_DR           = 4'd8;
    localparam  TAP_SELECT_IR_SCAN      = 4'd9;
    localparam  TAP_CAPTURE_IR          = 4'd10;
    localparam  TAP_SHIFT_IR            = 4'd11;
    localparam  TAP_EXIT1_IR            = 4'd12;
    localparam  TAP_PAUSE_IR            = 4'd13;
    localparam  TAP_EXIT2_IR            = 4'd14;
    localparam  TAP_UPDATE_IR           = 4'd15;

    localparam  IR_IDCODE               = 5'b00001;
    localparam  IR_DBG_CTRL             = 5'b10000;
    localparam  IR_DBG_STATUS           = 5'b10001;
    localparam  IR_DBG_XFER             = 5'b10010;
    localparam  IR_DBG_REGS             = 5'b10011;
    localparam  IR_BYPASS               = 5'b11111;

    localparam  EXEC_IDLE               = 3'd0;
    localparam  EXEC_SETTLE             = 3'd1;
    localparam  EXEC_PULSE              = 3'd2;
    localparam  EXEC_WAIT_LOW           = 3'd3;
    localparam  EXEC_WAIT_HIGH          = 3'd4;

    localparam  XFER_NOP                = 2'b00;
    localparam  XFER_READ               = 2'b01;
    localparam  XFER_WRITE              = 2'b10;

    localparam  RESP_SUCCESS            = 2'b00;
    localparam  RESP_FAILED             = 2'b10;
    localparam  RESP_BUSY               = 2'b11;

    localparam  XFER_IDLE               = 3'd0;
    localparam  XFER_SETTLE             = 3'd1;
    localparam  XFER_VALIDATE           = 3'd2;
    localparam  XFER_WAIT_ACK           = 3'd3;
    localparam  XFER_RESPOND            = 3'd4;

    localparam  SNAP_IDLE               = 2'd0;
    localparam  SNAP_SETTLE             = 2'd1;
    localparam  SNAP_COLLECT            = 2'd2;
    localparam  SNAP_RESPOND            = 2'd3;

    reg     [3:0]                       tap_state;
    reg     [4:0]                       ir_shift;
    reg     [4:0]                       current_ir;
    reg     [511:0]                     dr_shift;
    reg                                 bypass_shift;

    reg                                 ctrl_halt_tck;
    reg                                 ctrl_rst_tck;
    reg                                 execute_req_tck;
    reg                                 execute_halt_tck;
    reg                                 execute_ack_sync0_tck;
    reg                                 execute_ack_sync1_tck;
    reg                                 dbg_halted_sync0_tck;
    reg                                 dbg_halted_sync1_tck;

    reg                                 ctrl_halt_sync0_clk;
    reg                                 ctrl_halt_sync1_clk;
    reg                                 ctrl_rst_sync0_clk;
    reg                                 ctrl_rst_sync1_clk;
    reg                                 execute_req_sync0_clk;
    reg                                 execute_req_sync1_clk;
    reg                                 execute_halt_sync0_clk;
    reg                                 execute_halt_sync1_clk;
    reg                                 execute_ack_clk;
    reg     [2:0]                       execute_state_clk;
    reg                                 execute_mode_clk;
    reg                                 dbg_step_req_clk;

    reg                                 xfer_req_tck;
    reg     [31:0]                      xfer_addr_tck;
    reg     [31:0]                      xfer_data_tck;
    reg     [1:0]                       xfer_op_tck;
    reg                                 xfer_ack_sync0_tck;
    reg                                 xfer_ack_sync1_tck;
    reg                                 xfer_ack_seen_tck;
    reg     [31:0]                      xfer_response_addr_tck;
    reg     [31:0]                      xfer_response_data_tck;
    reg     [1:0]                       xfer_response_status_tck;
    reg                                 xfer_error_tck;

    reg                                 xfer_req_sync0_clk;
    reg                                 xfer_req_sync1_clk;
    reg                                 xfer_ack_clk;
    reg     [2:0]                       xfer_state_clk;
    reg     [31:0]                      xfer_addr_clk;
    reg     [31:0]                      xfer_data_clk;
    reg     [1:0]                       xfer_op_clk;
    reg     [31:0]                      xfer_response_addr_clk;
    reg     [31:0]                      xfer_response_data_clk;
    reg     [1:0]                       xfer_response_status_clk;
    reg                                 dbg_rden_clk;
    reg                                 dbg_wren_clk;
    reg     [31:0]                      dbg_addr_clk;
    reg     [31:0]                      dbg_wdata_clk;

    reg                                 snapshot_req_tck;
    reg                                 snapshot_ack_sync0_tck;
    reg                                 snapshot_ack_sync1_tck;
    reg                                 snapshot_ack_seen_tck;
    reg                                 snapshot_valid_tck;
    reg     [511:0]                     snapshot_hold_tck;

    reg                                 snapshot_req_sync0_clk;
    reg                                 snapshot_req_sync1_clk;
    reg                                 snapshot_ack_clk;
    reg     [1:0]                       snapshot_state_clk;
    reg     [3:0]                       snapshot_index_clk;
    reg                                 snapshot_valid_clk;
    reg     [511:0]                     snapshot_hold_clk;
    reg                                 dbg_regi_req_clk;

    reg                                 tap_reset_req_tck;
    reg                                 tap_reset_ack_sync0_tck;
    reg                                 tap_reset_ack_sync1_tck;
    reg                                 tap_reset_req_sync0_clk;
    reg                                 tap_reset_req_sync1_clk;
    reg                                 tap_reset_ack_clk;
    reg                                 tap_reset_seen_clk;
    reg                                 tap_ready_clk;

    wire                                execute_busy_tck;
    wire                                xfer_busy_tck;
    wire                                snapshot_busy_tck;
    wire    [31:0]                      status_value_tck;

    assign  execute_busy_tck = execute_req_tck != execute_ack_sync1_tck;
    assign  xfer_busy_tck = xfer_req_tck != xfer_ack_seen_tck;
    assign  snapshot_busy_tck = snapshot_req_tck != snapshot_ack_seen_tck;
    assign  status_value_tck = {
        16'h0000,
        8'h01,
        execute_busy_tck,
        snapshot_valid_tck,
        snapshot_busy_tck,
        xfer_error_tck,
        xfer_busy_tck,
        ctrl_rst_tck,
        ctrl_halt_tck,
        dbg_halted_sync1_tck
    };

    assign  dbg_rst_req = tap_ready_clk ? ctrl_rst_sync1_clk : 1'b0;
    assign  dbg_halt_req = tap_ready_clk ? ctrl_halt_sync1_clk : 1'b0;
    assign  dbg_step_req = tap_ready_clk ? dbg_step_req_clk : 1'b0;
    assign  dbg_regi_req = tap_ready_clk ? dbg_regi_req_clk : 1'b0;
    assign  dbg_rden = tap_ready_clk ? dbg_rden_clk : 1'b0;
    assign  dbg_wren = tap_ready_clk ? dbg_wren_clk : 1'b0;
    assign  dbg_addr = dbg_addr_clk;
    assign  dbg_wdata = dbg_wdata_clk;

    function [3:0] tap_next_state;
        input   [3:0] state;
        input         select;
        begin
            case(state)
                TAP_TEST_LOGIC_RESET: tap_next_state = select ? TAP_TEST_LOGIC_RESET : TAP_RUN_TEST_IDLE;
                TAP_RUN_TEST_IDLE:    tap_next_state = select ? TAP_SELECT_DR_SCAN : TAP_RUN_TEST_IDLE;
                TAP_SELECT_DR_SCAN:   tap_next_state = select ? TAP_SELECT_IR_SCAN : TAP_CAPTURE_DR;
                TAP_CAPTURE_DR:       tap_next_state = select ? TAP_EXIT1_DR : TAP_SHIFT_DR;
                TAP_SHIFT_DR:         tap_next_state = select ? TAP_EXIT1_DR : TAP_SHIFT_DR;
                TAP_EXIT1_DR:         tap_next_state = select ? TAP_UPDATE_DR : TAP_PAUSE_DR;
                TAP_PAUSE_DR:         tap_next_state = select ? TAP_EXIT2_DR : TAP_PAUSE_DR;
                TAP_EXIT2_DR:         tap_next_state = select ? TAP_UPDATE_DR : TAP_SHIFT_DR;
                TAP_UPDATE_DR:        tap_next_state = select ? TAP_SELECT_DR_SCAN : TAP_RUN_TEST_IDLE;
                TAP_SELECT_IR_SCAN:   tap_next_state = select ? TAP_TEST_LOGIC_RESET : TAP_CAPTURE_IR;
                TAP_CAPTURE_IR:       tap_next_state = select ? TAP_EXIT1_IR : TAP_SHIFT_IR;
                TAP_SHIFT_IR:         tap_next_state = select ? TAP_EXIT1_IR : TAP_SHIFT_IR;
                TAP_EXIT1_IR:         tap_next_state = select ? TAP_UPDATE_IR : TAP_PAUSE_IR;
                TAP_PAUSE_IR:         tap_next_state = select ? TAP_EXIT2_IR : TAP_PAUSE_IR;
                TAP_EXIT2_IR:         tap_next_state = select ? TAP_UPDATE_IR : TAP_SHIFT_IR;
                TAP_UPDATE_IR:        tap_next_state = select ? TAP_SELECT_DR_SCAN : TAP_RUN_TEST_IDLE;
                default:              tap_next_state = TAP_TEST_LOGIC_RESET;
            endcase
        end
    endfunction

    always @(posedge tck) begin
        if(!rst_n) begin
            tap_state <= TAP_TEST_LOGIC_RESET;
            ir_shift <= IR_IDCODE;
            current_ir <= IR_IDCODE;
            dr_shift <= 512'h0;
            bypass_shift <= 1'b0;
            ctrl_halt_tck <= 1'b0;
            ctrl_rst_tck <= 1'b0;
            execute_req_tck <= 1'b0;
            execute_halt_tck <= 1'b0;
            execute_ack_sync0_tck <= 1'b0;
            execute_ack_sync1_tck <= 1'b0;
            dbg_halted_sync0_tck <= 1'b0;
            dbg_halted_sync1_tck <= 1'b0;
        end else begin
            tap_state <= tap_next_state(tap_state, tms);
            execute_ack_sync0_tck <= execute_ack_clk;
            execute_ack_sync1_tck <= execute_ack_sync0_tck;
            dbg_halted_sync0_tck <= dbg_halted;
            dbg_halted_sync1_tck <= dbg_halted_sync0_tck;
            case(tap_state)
                TAP_TEST_LOGIC_RESET: begin
                    current_ir <= IR_IDCODE;
                    ctrl_halt_tck <= 1'b0;
                    ctrl_rst_tck <= 1'b0;
                    execute_req_tck <= 1'b0;
                    execute_halt_tck <= 1'b0;
                end
                TAP_CAPTURE_IR: begin
                    ir_shift <= IR_IDCODE;
                end
                TAP_SHIFT_IR: begin
                    ir_shift <= {tdi, ir_shift[4:1]};
                end
                TAP_UPDATE_IR: begin
                    current_ir <= ir_shift;
                end
                TAP_CAPTURE_DR: begin
                    if(current_ir == IR_IDCODE) begin
                        dr_shift[31:0] <= IDCODE_VALUE;
                    end else if(current_ir == IR_DBG_CTRL) begin
                        dr_shift[3:0] <= {2'b00, ctrl_rst_tck, ctrl_halt_tck};
                    end else if(current_ir == IR_DBG_STATUS) begin
                        dr_shift[31:0] <= status_value_tck;
                    end else if(current_ir == IR_DBG_XFER) begin
                        if(xfer_busy_tck) begin
                            dr_shift[65:0] <= {xfer_addr_tck, 32'h0, RESP_BUSY};
                        end else begin
                            dr_shift[65:0] <= {
                                xfer_response_addr_tck,
                                xfer_response_data_tck,
                                xfer_response_status_tck
                            };
                        end
                    end else if(current_ir == IR_DBG_REGS) begin
                        dr_shift <= snapshot_hold_tck;
                    end else begin
                        bypass_shift <= 1'b0;
                    end
                end
                TAP_SHIFT_DR: begin
                    if(current_ir == IR_IDCODE) begin
                        dr_shift[31:0] <= {tdi, dr_shift[31:1]};
                    end else if(current_ir == IR_DBG_CTRL) begin
                        dr_shift[3:0] <= {tdi, dr_shift[3:1]};
                    end else if(current_ir == IR_DBG_STATUS) begin
                        dr_shift[31:0] <= {tdi, dr_shift[31:1]};
                    end else if(current_ir == IR_DBG_XFER) begin
                        dr_shift[65:0] <= {tdi, dr_shift[65:1]};
                    end else if(current_ir == IR_DBG_REGS) begin
                        dr_shift <= {tdi, dr_shift[511:1]};
                    end else begin
                        bypass_shift <= tdi;
                    end
                end
                TAP_UPDATE_DR: begin
                    if(current_ir == IR_DBG_CTRL) begin
                        ctrl_halt_tck <= dr_shift[0];
                        ctrl_rst_tck <= dr_shift[1];
                        if(dr_shift[2] && !execute_busy_tck) begin
                            execute_halt_tck <= dr_shift[0];
                            execute_req_tck <= ~execute_req_tck;
                        end
                    end
                end
                default: begin
                    dr_shift <= dr_shift;
                end
            endcase
        end
    end

    always @(posedge tck) begin
        if(!rst_n) begin
            tap_reset_req_tck <= 1'b0;
            tap_reset_ack_sync0_tck <= 1'b0;
            tap_reset_ack_sync1_tck <= 1'b0;
        end else begin
            tap_reset_ack_sync0_tck <= tap_reset_ack_clk;
            tap_reset_ack_sync1_tck <= tap_reset_ack_sync0_tck;
            if(tap_state == TAP_TEST_LOGIC_RESET) begin
                tap_reset_req_tck <= 1'b1;
            end else if(tap_reset_ack_sync1_tck) begin
                tap_reset_req_tck <= 1'b0;
            end
        end
    end

    always @(negedge tck) begin
        if(!rst_n) begin
            tdo <= 1'b0;
        end else if(tap_state == TAP_SHIFT_IR) begin
            tdo <= ir_shift[0];
        end else if(tap_state == TAP_SHIFT_DR) begin
            if((current_ir == IR_IDCODE) ||
               (current_ir == IR_DBG_CTRL) ||
               (current_ir == IR_DBG_STATUS) ||
               (current_ir == IR_DBG_XFER) ||
               (current_ir == IR_DBG_REGS)) begin
                tdo <= dr_shift[0];
            end else begin
                tdo <= bypass_shift;
            end
        end else begin
            tdo <= 1'b0;
        end
    end

    always @(posedge tck) begin
        if(!rst_n) begin
            xfer_req_tck <= 1'b0;
            xfer_addr_tck <= 32'h0;
            xfer_data_tck <= 32'h0;
            xfer_op_tck <= XFER_NOP;
            xfer_ack_sync0_tck <= 1'b0;
            xfer_ack_sync1_tck <= 1'b0;
            xfer_ack_seen_tck <= 1'b0;
            xfer_response_addr_tck <= 32'h0;
            xfer_response_data_tck <= 32'h0;
            xfer_response_status_tck <= RESP_SUCCESS;
            xfer_error_tck <= 1'b0;
        end else begin
            xfer_ack_sync0_tck <= xfer_ack_clk;
            xfer_ack_sync1_tck <= xfer_ack_sync0_tck;

            if(tap_state == TAP_TEST_LOGIC_RESET) begin
                xfer_req_tck <= 1'b0;
                xfer_addr_tck <= 32'h0;
                xfer_data_tck <= 32'h0;
                xfer_op_tck <= XFER_NOP;
                xfer_ack_seen_tck <= 1'b0;
                xfer_response_addr_tck <= 32'h0;
                xfer_response_data_tck <= 32'h0;
                xfer_response_status_tck <= RESP_SUCCESS;
                xfer_error_tck <= 1'b0;
            end else if(xfer_ack_sync1_tck != xfer_ack_seen_tck) begin
                xfer_ack_seen_tck <= xfer_ack_sync1_tck;
                xfer_response_addr_tck <= xfer_response_addr_clk;
                xfer_response_data_tck <= xfer_response_data_clk;
                xfer_response_status_tck <= xfer_response_status_clk;
                xfer_error_tck <= xfer_response_status_clk == RESP_FAILED;
            end else if((tap_state == TAP_UPDATE_DR) &&
                        (current_ir == IR_DBG_XFER) &&
                        !xfer_busy_tck &&
                        (dr_shift[1:0] != XFER_NOP)) begin
                xfer_addr_tck <= dr_shift[65:34];
                xfer_data_tck <= dr_shift[33:2];
                xfer_op_tck <= dr_shift[1:0];
                xfer_req_tck <= ~xfer_req_tck;
                xfer_error_tck <= 1'b0;
            end
        end
    end

    always @(posedge tck) begin
        if(!rst_n) begin
            snapshot_req_tck <= 1'b0;
            snapshot_ack_sync0_tck <= 1'b0;
            snapshot_ack_sync1_tck <= 1'b0;
            snapshot_ack_seen_tck <= 1'b0;
            snapshot_valid_tck <= 1'b0;
            snapshot_hold_tck <= 512'h0;
        end else begin
            snapshot_ack_sync0_tck <= snapshot_ack_clk;
            snapshot_ack_sync1_tck <= snapshot_ack_sync0_tck;

            if(tap_state == TAP_TEST_LOGIC_RESET) begin
                snapshot_req_tck <= 1'b0;
                snapshot_ack_seen_tck <= 1'b0;
                snapshot_valid_tck <= 1'b0;
                snapshot_hold_tck <= 512'h0;
            end else if(snapshot_ack_sync1_tck != snapshot_ack_seen_tck) begin
                snapshot_ack_seen_tck <= snapshot_ack_sync1_tck;
                snapshot_valid_tck <= snapshot_valid_clk;
                if(snapshot_valid_clk) begin
                    snapshot_hold_tck <= snapshot_hold_clk;
                end
            end else if((tap_state == TAP_UPDATE_DR) &&
                        (current_ir == IR_DBG_CTRL) &&
                        dr_shift[3] &&
                        !snapshot_busy_tck) begin
                snapshot_req_tck <= ~snapshot_req_tck;
                snapshot_valid_tck <= 1'b0;
            end
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            ctrl_halt_sync0_clk <= 1'b0;
            ctrl_halt_sync1_clk <= 1'b0;
            ctrl_rst_sync0_clk <= 1'b0;
            ctrl_rst_sync1_clk <= 1'b0;
            execute_req_sync0_clk <= 1'b0;
            execute_req_sync1_clk <= 1'b0;
            execute_halt_sync0_clk <= 1'b0;
            execute_halt_sync1_clk <= 1'b0;
            xfer_req_sync0_clk <= 1'b0;
            xfer_req_sync1_clk <= 1'b0;
            snapshot_req_sync0_clk <= 1'b0;
            snapshot_req_sync1_clk <= 1'b0;
            tap_reset_req_sync0_clk <= 1'b0;
            tap_reset_req_sync1_clk <= 1'b0;
            tap_reset_ack_clk <= 1'b0;
            tap_reset_seen_clk <= 1'b0;
            tap_ready_clk <= 1'b0;
        end else begin
            ctrl_halt_sync0_clk <= ctrl_halt_tck;
            ctrl_halt_sync1_clk <= ctrl_halt_sync0_clk;
            ctrl_rst_sync0_clk <= ctrl_rst_tck;
            ctrl_rst_sync1_clk <= ctrl_rst_sync0_clk;
            execute_req_sync0_clk <= execute_req_tck;
            execute_req_sync1_clk <= execute_req_sync0_clk;
            execute_halt_sync0_clk <= execute_halt_tck;
            execute_halt_sync1_clk <= execute_halt_sync0_clk;
            xfer_req_sync0_clk <= xfer_req_tck;
            xfer_req_sync1_clk <= xfer_req_sync0_clk;
            snapshot_req_sync0_clk <= snapshot_req_tck;
            snapshot_req_sync1_clk <= snapshot_req_sync0_clk;
            tap_reset_req_sync0_clk <= tap_reset_req_tck;
            tap_reset_req_sync1_clk <= tap_reset_req_sync0_clk;
            tap_reset_ack_clk <= tap_reset_req_sync1_clk;
            if(!tap_ready_clk) begin
                if(tap_reset_req_sync1_clk) begin
                    tap_reset_seen_clk <= 1'b1;
                end else if(tap_reset_seen_clk) begin
                    tap_ready_clk <= 1'b1;
                end
            end
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            execute_ack_clk <= 1'b0;
            execute_state_clk <= EXEC_IDLE;
            execute_mode_clk <= 1'b0;
            dbg_step_req_clk <= 1'b0;
        end else if(!tap_ready_clk || tap_reset_req_sync1_clk) begin
            execute_ack_clk <= execute_req_sync1_clk;
            execute_state_clk <= EXEC_IDLE;
            execute_mode_clk <= 1'b0;
            dbg_step_req_clk <= 1'b0;
        end else begin
            case(execute_state_clk)
                EXEC_IDLE: begin
                    dbg_step_req_clk <= 1'b0;
                    if(execute_req_sync1_clk != execute_ack_clk) begin
                        execute_state_clk <= EXEC_SETTLE;
                    end
                end
                EXEC_SETTLE: begin
                    dbg_step_req_clk <= 1'b0;
                    execute_mode_clk <= execute_halt_sync1_clk;
                    execute_state_clk <= EXEC_PULSE;
                end
                EXEC_PULSE: begin
                    dbg_step_req_clk <= 1'b1;
                    execute_state_clk <= EXEC_WAIT_LOW;
                end
                EXEC_WAIT_LOW: begin
                    dbg_step_req_clk <= 1'b0;
                    if(!dbg_halted) begin
                        if(execute_mode_clk) begin
                            execute_state_clk <= EXEC_WAIT_HIGH;
                        end else begin
                            execute_ack_clk <= execute_req_sync1_clk;
                            execute_state_clk <= EXEC_IDLE;
                        end
                    end
                end
                EXEC_WAIT_HIGH: begin
                    dbg_step_req_clk <= 1'b0;
                    if(dbg_halted) begin
                        execute_ack_clk <= execute_req_sync1_clk;
                        execute_state_clk <= EXEC_IDLE;
                    end
                end
                default: begin
                    dbg_step_req_clk <= 1'b0;
                    execute_state_clk <= EXEC_IDLE;
                end
            endcase
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            xfer_ack_clk <= 1'b0;
            xfer_state_clk <= XFER_IDLE;
            xfer_addr_clk <= 32'h0;
            xfer_data_clk <= 32'h0;
            xfer_op_clk <= XFER_NOP;
            xfer_response_addr_clk <= 32'h0;
            xfer_response_data_clk <= 32'h0;
            xfer_response_status_clk <= RESP_SUCCESS;
            dbg_rden_clk <= 1'b0;
            dbg_wren_clk <= 1'b0;
            dbg_addr_clk <= 32'h0;
            dbg_wdata_clk <= 32'h0;
        end else if(!tap_ready_clk || tap_reset_req_sync1_clk) begin
            xfer_ack_clk <= xfer_req_sync1_clk;
            xfer_state_clk <= XFER_IDLE;
            xfer_response_status_clk <= RESP_SUCCESS;
            dbg_rden_clk <= 1'b0;
            dbg_wren_clk <= 1'b0;
        end else begin
            case(xfer_state_clk)
                XFER_IDLE: begin
                    dbg_rden_clk <= 1'b0;
                    dbg_wren_clk <= 1'b0;
                    if(xfer_req_sync1_clk != xfer_ack_clk) begin
                        xfer_state_clk <= XFER_SETTLE;
                    end
                end
                XFER_SETTLE: begin
                    dbg_rden_clk <= 1'b0;
                    dbg_wren_clk <= 1'b0;
                    xfer_addr_clk <= xfer_addr_tck;
                    xfer_data_clk <= xfer_data_tck;
                    xfer_op_clk <= xfer_op_tck;
                    xfer_state_clk <= XFER_VALIDATE;
                end
                XFER_VALIDATE: begin
                    dbg_rden_clk <= 1'b0;
                    dbg_wren_clk <= 1'b0;
                    xfer_response_addr_clk <= xfer_addr_clk;
                    if(!dbg_halted ||
                       (xfer_addr_clk[1:0] != 2'b00) ||
                       ((xfer_op_clk != XFER_READ) &&
                        (xfer_op_clk != XFER_WRITE))) begin
                        xfer_response_data_clk <= xfer_data_clk;
                        xfer_response_status_clk <= RESP_FAILED;
                        xfer_state_clk <= XFER_RESPOND;
                    end else begin
                        dbg_rden_clk <= xfer_op_clk == XFER_READ;
                        dbg_wren_clk <= xfer_op_clk == XFER_WRITE;
                        dbg_addr_clk <= xfer_addr_clk;
                        dbg_wdata_clk <= xfer_data_clk;
                        xfer_state_clk <= XFER_WAIT_ACK;
                    end
                end
                XFER_WAIT_ACK: begin
                    dbg_rden_clk <= 1'b0;
                    dbg_wren_clk <= 1'b0;
                    if(dbg_ack) begin
                        xfer_response_data_clk <= xfer_op_clk == XFER_READ ?
                                                  dbg_rdata : xfer_data_clk;
                        xfer_response_status_clk <= RESP_SUCCESS;
                        xfer_state_clk <= XFER_RESPOND;
                    end
                end
                XFER_RESPOND: begin
                    dbg_rden_clk <= 1'b0;
                    dbg_wren_clk <= 1'b0;
                    xfer_ack_clk <= xfer_req_sync1_clk;
                    xfer_state_clk <= XFER_IDLE;
                end
                default: begin
                    dbg_rden_clk <= 1'b0;
                    dbg_wren_clk <= 1'b0;
                    xfer_state_clk <= XFER_IDLE;
                end
            endcase
        end
    end

    always @(posedge clk) begin
        if(!rst_n) begin
            snapshot_ack_clk <= 1'b0;
            snapshot_state_clk <= SNAP_IDLE;
            snapshot_index_clk <= 4'h0;
            snapshot_valid_clk <= 1'b0;
            snapshot_hold_clk <= 512'h0;
            dbg_regi_req_clk <= 1'b0;
        end else if(!tap_ready_clk || tap_reset_req_sync1_clk) begin
            snapshot_ack_clk <= snapshot_req_sync1_clk;
            snapshot_state_clk <= SNAP_IDLE;
            snapshot_index_clk <= 4'h0;
            snapshot_valid_clk <= 1'b0;
            dbg_regi_req_clk <= 1'b0;
        end else begin
            case(snapshot_state_clk)
                SNAP_IDLE: begin
                    dbg_regi_req_clk <= 1'b0;
                    if(snapshot_req_sync1_clk != snapshot_ack_clk) begin
                        snapshot_state_clk <= SNAP_SETTLE;
                    end
                end
                SNAP_SETTLE: begin
                    snapshot_index_clk <= 4'h0;
                    snapshot_valid_clk <= 1'b0;
                    if(dbg_halted) begin
                        dbg_regi_req_clk <= 1'b1;
                        snapshot_state_clk <= SNAP_COLLECT;
                    end else begin
                        dbg_regi_req_clk <= 1'b0;
                        snapshot_state_clk <= SNAP_RESPOND;
                    end
                end
                SNAP_COLLECT: begin
                    dbg_regi_req_clk <= 1'b0;
                    if(dbg_regi_vld) begin
                        snapshot_hold_clk[snapshot_index_clk*32 +: 32] <= dbg_regi_data;
                        if(snapshot_index_clk == 4'd15) begin
                            snapshot_valid_clk <= 1'b1;
                            snapshot_state_clk <= SNAP_RESPOND;
                        end else begin
                            snapshot_index_clk <= snapshot_index_clk + 1'b1;
                        end
                    end
                end
                SNAP_RESPOND: begin
                    dbg_regi_req_clk <= 1'b0;
                    snapshot_ack_clk <= snapshot_req_sync1_clk;
                    snapshot_state_clk <= SNAP_IDLE;
                end
                default: begin
                    dbg_regi_req_clk <= 1'b0;
                    snapshot_state_clk <= SNAP_IDLE;
                end
            endcase
        end
    end

endmodule
