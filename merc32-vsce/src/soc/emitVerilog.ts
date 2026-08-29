import {
    PlannedExternalInterface,
    PlannedParameterValue,
    PlannedPeripheral,
    PlannedPort,
    SocPlan,
} from './model';

class VerilogWriter {
    private readonly lines: string[] = [];
    private depth = 0;

    line(text = ''): void {
        this.lines.push(`${'    '.repeat(this.depth)}${text}`);
    }

    indent(body: () => void): void {
        this.depth += 1;
        body();
        this.depth -= 1;
    }

    block(header: string, body: () => void, footer = 'end'): void {
        this.line(header);
        this.indent(body);
        this.line(footer);
    }

    toString(): string {
        return `${this.lines.join('\n')}\n`;
    }
}

/** Renders the generated single-master, single-outstanding PLB router. */
export function renderPlbRouter(plan: SocPlan): string {
    const writer = new VerilogWriter();
    const moduleName = `${plan.topModule}_plb_router`;
    const ports = [
        'input wire clk',
        'input wire rst_n',
        'input wire m_rden',
        'input wire m_wren',
        'input wire [31:0] m_addr',
        'input wire [3:0] m_strb',
        'input wire [31:0] m_wdata',
        'output wire [31:0] m_rdata',
        'output wire m_ack',
    ];
    for (const endpoint of plan.endpoints) {
        ports.push(
            `output wire ${endpoint.name}_rden`,
            `output wire ${endpoint.name}_wren`,
            `output wire [31:0] ${endpoint.name}_addr`,
            `output wire [3:0] ${endpoint.name}_strb`,
            `output wire [31:0] ${endpoint.name}_wdata`,
            `input wire [31:0] ${endpoint.name}_rdata`,
            `input wire ${endpoint.name}_ack`,
        );
    }

    emitModuleHeader(writer, moduleName, [], ports);
    const activeWidth = Math.max(1, Math.ceil(Math.log2(plan.endpoints.length + 1)));
    writer.line(`localparam integer ACTIVE_WIDTH = ${activeWidth};`);
    writer.line("localparam [ACTIVE_WIDTH-1:0] ENDPOINT_NONE = {ACTIVE_WIDTH{1'b0}};");
    plan.endpoints.forEach((endpoint, index) => {
        writer.line(`localparam [ACTIVE_WIDTH-1:0] ${endpointConstant(endpoint.name)} = ${activeWidth}'d${index + 1};`);
    });
    writer.line();
    writer.line('reg [ACTIVE_WIDTH-1:0] active_endpoint;');
    writer.line('reg [ACTIVE_WIDTH-1:0] decoded_endpoint;');
    if (plan.endpoints.length > 0) {
        writer.line('reg [31:0] response_rdata;');
        writer.line('reg response_ack;');
    }
    writer.line('wire start_request;');
    writer.line();

    writer.block('always @* begin', () => {
        writer.line('decoded_endpoint = ENDPOINT_NONE;');
        writer.block("if ((active_endpoint == ENDPOINT_NONE) && (m_rden || m_wren)) begin", () => {
            plan.endpoints.forEach((endpoint, index) => {
                const keyword = index === 0 ? 'if' : 'else if';
                writer.line(`${keyword} ((m_addr >= ${hex32(endpoint.baseAddress)}) && (m_addr <= ${hex32(endpoint.endAddress)}))`);
                writer.indent(() => writer.line(`decoded_endpoint = ${endpointConstant(endpoint.name)};`));
            });
        });
    });
    writer.line();
    writer.line('assign start_request = (active_endpoint == ENDPOINT_NONE) &&');
    writer.line('                       (decoded_endpoint != ENDPOINT_NONE) && (m_rden || m_wren);');
    writer.line();

    writer.block('always @(posedge clk) begin', () => {
        writer.block('if (!rst_n) begin', () => {
            writer.line('active_endpoint <= ENDPOINT_NONE;');
        }, 'end else if (active_endpoint == ENDPOINT_NONE) begin');
        writer.indent(() => {
            writer.block('if (start_request) begin', () => {
                writer.line('active_endpoint <= decoded_endpoint;');
            });
        });
        writer.block('end else if (m_ack) begin', () => {
            writer.line('active_endpoint <= ENDPOINT_NONE;');
        });
    });
    writer.line();

    for (const endpoint of plan.endpoints) {
        const constant = endpointConstant(endpoint.name);
        writer.line(`assign ${endpoint.name}_rden = start_request && (decoded_endpoint == ${constant}) && m_rden;`);
        writer.line(`assign ${endpoint.name}_wren = start_request && (decoded_endpoint == ${constant}) && m_wren;`);
        writer.line(`assign ${endpoint.name}_addr = m_addr;`);
        writer.line(`assign ${endpoint.name}_strb = m_strb;`);
        writer.line(`assign ${endpoint.name}_wdata = m_wdata;`);
        writer.line();
    }

    if (plan.endpoints.length === 0) {
        writer.line("assign m_rdata = 32'b0;");
        writer.line("assign m_ack = 1'b0;");
    } else {
        writer.line('assign m_rdata = response_rdata;');
        writer.line('assign m_ack = response_ack;');
        writer.block('always @* begin', () => {
            writer.line("response_rdata = 32'b0;");
            writer.line("response_ack = 1'b0;");
            writer.line('case (active_endpoint)');
            writer.indent(() => {
                for (const endpoint of plan.endpoints) {
                    writer.block(`${endpointConstant(endpoint.name)}: begin`, () => {
                        writer.line(`response_rdata = ${endpoint.name}_rdata;`);
                        writer.line(`response_ack = ${endpoint.name}_ack;`);
                    });
                }
                writer.line('default: begin end');
            });
            writer.line('endcase');
        });
    }
    writer.line('endmodule');
    return writer.toString();
}

/** Renders the N-way APB address decoder for built-in peripherals. */
export function renderApbInterconnect(plan: SocPlan): string | undefined {
    if (plan.peripherals.length === 0) {
        return undefined;
    }
    const writer = new VerilogWriter();
    const ports = [
        'input wire m_psel',
        'input wire m_penable',
        'input wire [31:0] m_paddr',
        'output wire [31:0] m_prdata',
        'output wire m_pready',
    ];
    for (const peripheral of plan.peripherals) {
        ports.push(
            `output wire ${peripheral.name}_psel`,
            `input wire [31:0] ${peripheral.name}_prdata`,
            `input wire ${peripheral.name}_pready`,
        );
    }
    emitModuleHeader(writer, `${plan.topModule}_apb_interconnect`, [], ports);
    writer.line('reg [31:0] response_rdata;');
    writer.line('reg response_ready;');
    writer.line();
    for (const peripheral of plan.peripherals) {
        writer.line(`assign ${peripheral.name}_psel = m_psel &&`);
        writer.line(`    (m_paddr >= ${hex32(peripheral.baseAddress)}) && (m_paddr <= ${hex32(peripheral.endAddress)});`);
    }
    writer.line('assign m_prdata = response_rdata;');
    writer.line('assign m_pready = response_ready;');
    writer.line();
    writer.block('always @* begin', () => {
        writer.line("response_rdata = 32'b0;");
        writer.line("response_ready = 1'b0;");
        plan.peripherals.forEach((peripheral, index) => {
            const keyword = index === 0 ? 'if' : 'else if';
            writer.block(`${keyword} (${peripheral.name}_psel) begin`, () => {
                writer.line(`response_rdata = ${peripheral.name}_prdata;`);
                writer.line(`response_ready = ${peripheral.name}_pready;`);
            });
        });
    });
    writer.line('endmodule');
    return writer.toString();
}

/** Renders the generated SoC integration top from an immutable plan. */
export function renderSocTop(plan: SocPlan): string {
    const writer = new VerilogWriter();
    const parameters: string[] = [];
    for (const prefix of ['ilb', 'dlb'] as const) {
        const memory = plan.memory[prefix];
        if (memory.type === 'internal_ram') {
            const defaultPath = memory.initFile === undefined
                ? ''
                : `../memory/${memory.initFile.outputName}`;
            parameters.push(`parameter ${prefix.toUpperCase()}_INIT_FILE = ${quoteVerilog(defaultPath)}`);
        }
    }
    emitModuleHeader(writer, plan.topModule, parameters, plan.topPorts.map(formatTopPort));
    emitTopWires(writer, plan);
    emitExternalInterruptSynchronizers(writer, plan);
    emitCpuInstance(writer, plan);
    emitMemoryInstances(writer, plan);
    emitRouterInstance(writer, plan);
    emitBuiltinApbSubsystem(writer, plan);
    for (const endpoint of plan.externalInterfaces) {
        emitExternalEndpoint(writer, endpoint);
    }
    writer.line('endmodule');
    return writer.toString();
}

function emitTopWires(writer: VerilogWriter, plan: SocPlan): void {
    const cpuWires: Array<[string, number]> = [
        ['cpu_ilb_rden', 1], ['cpu_ilb_wren', 1],
        ['cpu_ilb_addr', plan.memory.ilb.wordAddressWidth], ['cpu_ilb_strb', 4],
        ['cpu_ilb_wdata', 32], ['cpu_ilb_rdata', 32], ['cpu_ilb_ack', 1],
        ['cpu_dlb_rden', 1], ['cpu_dlb_wren', 1],
        ['cpu_dlb_addr', plan.memory.dlb.wordAddressWidth], ['cpu_dlb_strb', 4],
        ['cpu_dlb_wdata', 32], ['cpu_dlb_rdata', 32], ['cpu_dlb_ack', 1],
        ['cpu_plb_rden', 1], ['cpu_plb_wren', 1], ['cpu_plb_addr', 32],
        ['cpu_plb_strb', 4], ['cpu_plb_wdata', 32], ['cpu_plb_rdata', 32],
        ['cpu_plb_ack', 1],
    ];
    if (!plan.cpu.debug) {
        cpuWires.push(['cpu_tdo_unused', 1]);
    }
    for (const [name, width] of cpuWires) {
        writer.line(wireDeclaration(name, width));
    }
    for (const endpoint of plan.endpoints) {
        writer.line(wireDeclaration(`${endpoint.name}_router_rden`, 1));
        writer.line(wireDeclaration(`${endpoint.name}_router_wren`, 1));
        writer.line(wireDeclaration(`${endpoint.name}_router_addr`, 32));
        writer.line(wireDeclaration(`${endpoint.name}_router_strb`, 4));
        writer.line(wireDeclaration(`${endpoint.name}_router_wdata`, 32));
        writer.line(wireDeclaration(`${endpoint.name}_router_rdata`, 32));
        writer.line(wireDeclaration(`${endpoint.name}_router_ack`, 1));
    }
    for (const peripheral of plan.peripherals) {
        writer.line(wireDeclaration(`${peripheral.name}_psel`, 1));
        writer.line(wireDeclaration(`${peripheral.name}_pready`, 1));
        writer.line(wireDeclaration(`${peripheral.name}_pslverr`, 1));
        writer.line(wireDeclaration(`${peripheral.name}_prdata`, 32));
        writer.line(wireDeclaration(`${peripheral.name}_interrupt`, 1));
    }
    writer.line();
}

function emitExternalInterruptSynchronizers(writer: VerilogWriter, plan: SocPlan): void {
    if (plan.interrupt.mode !== 'controller') {
        return;
    }
    const externalSources = plan.interrupt.sources
        .filter((source): source is typeof source & { topPort: string } => source.topPort !== undefined)
        .sort((left, right) => left.topPort.localeCompare(right.topPort));
    for (const source of externalSources) {
        const port = source.topPort;
        const inactive = source.trigger === 'low' || source.trigger === 'falling'
            ? "1'b1"
            : "1'b0";
        writer.line(`reg ${port}_meta;`);
        writer.line(`reg ${port}_sync;`);
        writer.line(`reg [1:0] ${port}_history_valid;`);
        writer.block('always @(posedge clk) begin', () => {
            writer.block('if (!rst_n) begin', () => {
                writer.line(`${port}_meta <= 1'b0;`);
                writer.line(`${port}_sync <= 1'b0;`);
                writer.line(`${port}_history_valid <= 2'b00;`);
            }, 'end else begin');
            writer.indent(() => {
                writer.line(`${port}_meta <= ${port};`);
                writer.line(`${port}_sync <= ${port}_meta;`);
                writer.line(`${port}_history_valid <= {${port}_history_valid[0], 1'b1};`);
            });
            writer.line('end');
        });
        if (source.trigger === 'rising' || source.trigger === 'falling') {
            writer.line(`reg ${port}_conditioned;`);
            writer.line(`reg ${port}_armed;`);
            writer.block('always @(posedge clk) begin', () => {
                writer.block('if (!rst_n) begin', () => {
                    writer.line(`${port}_conditioned <= ${inactive};`);
                    writer.line(`${port}_armed <= 1'b0;`);
                }, `end else if (!${port}_history_valid[1]) begin`);
                writer.indent(() => {
                    writer.line(`${port}_conditioned <= ${inactive};`);
                    writer.line(`${port}_armed <= 1'b0;`);
                });
                writer.block(`end else if (!${port}_armed) begin`, () => {
                    writer.line(`${port}_conditioned <= ${inactive};`);
                    writer.block(`if (${port}_sync == ${inactive}) begin`, () => {
                        writer.line(`${port}_armed <= 1'b1;`);
                    });
                }, 'end else begin');
                writer.indent(() => {
                    writer.line(`${port}_conditioned <= ${port}_sync;`);
                });
                writer.line('end');
            });
        } else {
            writer.line(`wire ${port}_conditioned;`);
            writer.line(`assign ${port}_conditioned = ${port}_history_valid[1] ? ${port}_sync : ${inactive};`);
        }
        writer.line();
    }
}

function emitCpuInstance(writer: VerilogWriter, plan: SocPlan): void {
    const interrupt = cpuInterruptSignal(plan);
    const connections: Array<[string, string]> = [
        ['clk', 'clk'], ['rst_n', 'rst_n'], ['interrupt', interrupt],
        ['tck', plan.cpu.debug ? 'tck' : "1'b0"],
        ['tms', plan.cpu.debug ? 'tms' : "1'b0"],
        ['tdi', plan.cpu.debug ? 'tdi' : "1'b0"],
        ['tdo', plan.cpu.debug ? 'tdo' : 'cpu_tdo_unused'],
        ['dlb_rden', 'cpu_dlb_rden'], ['dlb_wren', 'cpu_dlb_wren'],
        ['dlb_addr', 'cpu_dlb_addr'], ['dlb_strb', 'cpu_dlb_strb'],
        ['dlb_wdata', 'cpu_dlb_wdata'], ['dlb_rdata', 'cpu_dlb_rdata'],
        ['dlb_ack', 'cpu_dlb_ack'],
        ['ilb_rden', 'cpu_ilb_rden'], ['ilb_wren', 'cpu_ilb_wren'],
        ['ilb_addr', 'cpu_ilb_addr'], ['ilb_strb', 'cpu_ilb_strb'],
        ['ilb_wdata', 'cpu_ilb_wdata'], ['ilb_rdata', 'cpu_ilb_rdata'],
        ['ilb_ack', 'cpu_ilb_ack'],
        ['plb_rden', 'cpu_plb_rden'], ['plb_wren', 'cpu_plb_wren'],
        ['plb_addr', 'cpu_plb_addr'], ['plb_strb', 'cpu_plb_strb'],
        ['plb_wdata', 'cpu_plb_wdata'], ['plb_rdata', 'cpu_plb_rdata'],
        ['plb_ack', 'cpu_plb_ack'],
    ];
    emitInstance(writer, 'MERC32_top', 'cpu_inst', [
        ['ILB_ADDR_WIDTH', `${plan.memory.ilb.wordAddressWidth}`],
        ['DLB_ADDR_WIDTH', `${plan.memory.dlb.wordAddressWidth}`],
        ['JTAG_IDCODE_VALUE', hex32(plan.cpu.jtagIdCode)],
        ['DEBUG_EN', plan.cpu.debug ? '1' : '0'],
    ], connections);
}

function emitMemoryInstances(writer: VerilogWriter, plan: SocPlan): void {
    for (const prefix of ['ilb', 'dlb'] as const) {
        const memory = plan.memory[prefix];
        if (memory.type === 'external_local_bus') {
            for (const suffix of ['rden', 'wren', 'addr', 'strb', 'wdata'] as const) {
                writer.line(`assign ${prefix}_${suffix} = cpu_${prefix}_${suffix};`);
            }
            writer.line(`assign cpu_${prefix}_rdata = ${prefix}_rdata;`);
            writer.line(`assign cpu_${prefix}_ack = ${prefix}_ack;`);
            writer.line();
            continue;
        }
        emitInstance(writer, 'spram', `${prefix}_ram_inst`, [
            ['ADDR_WIDTH', `${memory.wordAddressWidth}`],
            ['INIT_FILE', `${prefix.toUpperCase()}_INIT_FILE`],
        ], [
            ['clk', 'clk'], ['wr', `cpu_${prefix}_wren`], ['rd', `cpu_${prefix}_rden`],
            ['be', `cpu_${prefix}_strb`], ['din', `cpu_${prefix}_wdata`],
            ['dout', `cpu_${prefix}_rdata`], ['addr', `cpu_${prefix}_addr`],
            ['ack', `cpu_${prefix}_ack`],
        ]);
    }
}

function emitRouterInstance(writer: VerilogWriter, plan: SocPlan): void {
    const connections: Array<[string, string]> = [
        ['clk', 'clk'], ['rst_n', 'rst_n'],
        ['m_rden', 'cpu_plb_rden'], ['m_wren', 'cpu_plb_wren'],
        ['m_addr', 'cpu_plb_addr'], ['m_strb', 'cpu_plb_strb'],
        ['m_wdata', 'cpu_plb_wdata'], ['m_rdata', 'cpu_plb_rdata'],
        ['m_ack', 'cpu_plb_ack'],
    ];
    for (const endpoint of plan.endpoints) {
        for (const suffix of ['rden', 'wren', 'addr', 'strb', 'wdata', 'rdata', 'ack']) {
            connections.push([
                `${endpoint.name}_${suffix}`,
                `${endpoint.name}_router_${suffix}`,
            ]);
        }
    }
    emitInstance(writer, `${plan.topModule}_plb_router`, 'plb_router_inst', [], connections);
}

function emitBuiltinApbSubsystem(writer: VerilogWriter, plan: SocPlan): void {
    if (plan.peripherals.length === 0) {
        return;
    }
    for (const [name, width] of [
        ['builtin_apb_lb_rden', 1], ['builtin_apb_lb_wren', 1],
        ['builtin_apb_lb_rdata', 32], ['builtin_apb_lb_valid', 1],
        ['builtin_apb_psel', 1], ['builtin_apb_penable', 1],
        ['builtin_apb_paddr', 32], ['builtin_apb_pwrite', 1],
        ['builtin_apb_pwdata', 32], ['builtin_apb_pstrb', 4],
        ['builtin_apb_prdata', 32], ['builtin_apb_pready', 1],
    ] as Array<[string, number]>) {
        writer.line(wireDeclaration(name, width));
    }
    writer.line(`assign builtin_apb_lb_rden = ${joinOr(plan.peripherals.map((item) => `${item.name}_router_rden`))};`);
    writer.line(`assign builtin_apb_lb_wren = ${joinOr(plan.peripherals.map((item) => `${item.name}_router_wren`))};`);
    for (const peripheral of plan.peripherals) {
        writer.line(`assign ${peripheral.name}_router_rdata = builtin_apb_lb_rdata;`);
        writer.line(`assign ${peripheral.name}_router_ack = builtin_apb_lb_valid;`);
    }
    writer.line();
    emitInstance(writer, 'lb2apb', 'builtin_apb_bridge_inst', [
        ['DATA_WIDTH', '32'], ['LB_ADDR_WIDTH', '32'], ['APB_ADDR_WIDTH', '32'],
    ], [
        ['clk', 'clk'], ['rst_n', 'rst_n'],
        ['lb_rden', 'builtin_apb_lb_rden'], ['lb_wren', 'builtin_apb_lb_wren'],
        ['lb_strb', 'cpu_plb_strb'], ['lb_wdata', 'cpu_plb_wdata'],
        ['lb_addr', 'cpu_plb_addr'], ['lb_rdata', 'builtin_apb_lb_rdata'],
        ['lb_valid', 'builtin_apb_lb_valid'],
        ['m_apb_psel', 'builtin_apb_psel'], ['m_apb_penable', 'builtin_apb_penable'],
        ['m_apb_paddr', 'builtin_apb_paddr'], ['m_apb_pwrite', 'builtin_apb_pwrite'],
        ['m_apb_pwdata', 'builtin_apb_pwdata'], ['m_apb_pstrb', 'builtin_apb_pstrb'],
        ['m_apb_prdata', 'builtin_apb_prdata'], ['m_apb_pready', 'builtin_apb_pready'],
    ]);
    const interconnectConnections: Array<[string, string]> = [
        ['m_psel', 'builtin_apb_psel'], ['m_penable', 'builtin_apb_penable'],
        ['m_paddr', 'builtin_apb_paddr'], ['m_prdata', 'builtin_apb_prdata'],
        ['m_pready', 'builtin_apb_pready'],
    ];
    for (const peripheral of plan.peripherals) {
        interconnectConnections.push(
            [`${peripheral.name}_psel`, `${peripheral.name}_psel`],
            [`${peripheral.name}_prdata`, `${peripheral.name}_prdata`],
            [`${peripheral.name}_pready`, `${peripheral.name}_pready`],
        );
    }
    emitInstance(writer, `${plan.topModule}_apb_interconnect`,
        'apb_interconnect_inst', [], interconnectConnections);
    for (const peripheral of plan.peripherals) {
        emitPeripheral(writer, plan, peripheral);
    }
}

function emitPeripheral(writer: VerilogWriter, plan: SocPlan, peripheral: PlannedPeripheral): void {
    const connections: Array<[string, string]> = [
        ['s_apb_pclk', 'clk'], ['s_apb_presetn', 'rst_n'],
        ['s_apb_psel', `${peripheral.name}_psel`],
        ['s_apb_penable', 'builtin_apb_penable'],
        ['s_apb_pwrite', 'builtin_apb_pwrite'],
        ['s_apb_paddr', 'builtin_apb_paddr'],
        ['s_apb_pwdata', 'builtin_apb_pwdata'],
        ['s_apb_pstrb', 'builtin_apb_pstrb'],
        ['s_apb_pready', `${peripheral.name}_pready`],
        ['s_apb_pslverr', `${peripheral.name}_pslverr`],
        ['s_apb_prdata', `${peripheral.name}_prdata`],
    ];
    if (peripheral.type === 'apb_intc') {
        connections.push(['irq_sources', `${peripheral.name}_irq_sources`]);
    }
    if (peripheral.interrupts.includes('interrupt')) {
        connections.push(['interrupt', `${peripheral.name}_interrupt`]);
    }
    for (const port of peripheral.ports) {
        connections.push([catalogPortSuffix(peripheral.name, port.name), port.name]);
    }
    if (peripheral.type === 'apb_intc') {
        const count = parameterNumber(peripheral.parameters.IRQ_COUNT);
        writer.line(`wire [${count - 1}:0] ${peripheral.name}_irq_sources;`);
        for (let id = 0; id < count; id += 1) {
            const source = plan.interrupt.mode === 'controller'
                ? plan.interrupt.sources.find((item) => item.id === id)
                : undefined;
            writer.line(`assign ${peripheral.name}_irq_sources[${id}] = ${source === undefined ? "1'b0" : interruptSourceSignal(source.source, source.topPort, true)};`);
        }
    }
    emitInstance(writer, peripheral.module, `${peripheral.name}_inst`,
        Object.entries(peripheral.parameters).map(([name, value]) => [
            name, formatParameter(value, name === 'IRQ_MODE' ? 64 : undefined),
        ]), connections);
}

function emitExternalEndpoint(writer: VerilogWriter, endpoint: PlannedExternalInterface): void {
    if (endpoint.type === 'local_bus') {
        writer.line(`assign ${endpoint.name}_lb_rden = ${endpoint.name}_router_rden;`);
        writer.line(`assign ${endpoint.name}_lb_wren = ${endpoint.name}_router_wren;`);
        writer.line(`assign ${endpoint.name}_lb_strb = ${endpoint.name}_router_strb;`);
        writer.line(`assign ${endpoint.name}_lb_wdata = ${endpoint.name}_router_wdata;`);
        writer.line(`assign ${endpoint.name}_lb_addr = ${endpoint.name}_router_addr[${endpoint.addressWidth - 1}:0];`);
        writer.line(`assign ${endpoint.name}_router_rdata = ${endpoint.name}_lb_rdata;`);
        writer.line(`assign ${endpoint.name}_router_ack = ${endpoint.name}_lb_valid;`);
        writer.line();
        return;
    }
    const bridge = protocolBridge(endpoint.type);
    const responseData = `${endpoint.name}_bridge_rdata`;
    const responseValid = `${endpoint.name}_bridge_valid`;
    writer.line(wireDeclaration(responseData, 32));
    writer.line(wireDeclaration(responseValid, 1));
    const connections: Array<[string, string]> = [
        ['clk', 'clk'], ['rst_n', 'rst_n'],
        ['lb_rden', `${endpoint.name}_router_rden`],
        ['lb_wren', `${endpoint.name}_router_wren`],
        ['lb_wdata', `${endpoint.name}_router_wdata`],
        ['lb_addr', `${endpoint.name}_router_addr[${endpoint.addressWidth - 1}:0]`],
        ['lb_rdata', responseData], ['lb_valid', responseValid],
    ];
    if (endpoint.type !== 'drp') {
        connections.splice(4, 0, ['lb_strb', `${endpoint.name}_router_strb`]);
    }
    for (const port of endpoint.ports) {
        connections.push([catalogPortSuffix(endpoint.name, port.name), port.name]);
    }
    writer.line(`assign ${endpoint.name}_router_rdata = ${responseData};`);
    writer.line(`assign ${endpoint.name}_router_ack = ${responseValid};`);
    emitInstance(writer, bridge.module, `${endpoint.name}_inst`, [
        ['DATA_WIDTH', '32'], ['LB_ADDR_WIDTH', `${endpoint.addressWidth}`],
        [bridge.addressParameter, `${endpoint.addressWidth}`],
    ], connections);
}

function cpuInterruptSignal(plan: SocPlan): string {
    if (plan.interrupt.mode === 'none') {
        return "1'b0";
    }
    if (plan.interrupt.mode === 'direct') {
        const source = plan.interrupt.sources[0];
        return interruptSourceSignal(source.source, source.topPort, false);
    }
    return `${plan.interrupt.controller}_interrupt`;
}

function interruptSourceSignal(source: string, topPort: string | undefined, synchronized: boolean): string {
    if (topPort !== undefined) {
        return synchronized ? `${topPort}_conditioned` : topPort;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\.interrupt$/.exec(source);
    if (match === null) {
        throw new Error(`Unsupported planned interrupt source: ${source}`);
    }
    return `${match[1]}_interrupt`;
}

function protocolBridge(type: PlannedExternalInterface['type']): {
    module: string;
    addressParameter: string;
} {
    switch (type) {
        case 'apb': return { module: 'lb2apb', addressParameter: 'APB_ADDR_WIDTH' };
        case 'axi4_lite': return { module: 'lb2axi_lite', addressParameter: 'AXI_ADDR_WIDTH' };
        case 'wishbone': return { module: 'lb2wbc', addressParameter: 'WB_ADDR_WIDTH' };
        case 'avalon': return { module: 'lb2avalon', addressParameter: 'AV_ADDR_WIDTH' };
        case 'drp': return { module: 'lb2drp', addressParameter: 'DRP_ADDR_WIDTH' };
        default: throw new Error(`Unsupported planned external protocol: ${type}`);
    }
}

function emitModuleHeader(
    writer: VerilogWriter,
    moduleName: string,
    parameters: readonly string[],
    ports: readonly string[],
): void {
    if (parameters.length > 0) {
        writer.line(`module ${moduleName} #(`);
        writer.indent(() => emitCommaLines(writer, parameters));
        writer.line(') (');
    } else {
        writer.line(`module ${moduleName} (`);
    }
    writer.indent(() => emitCommaLines(writer, ports));
    writer.line(');');
    writer.line();
}

function emitInstance(
    writer: VerilogWriter,
    moduleName: string,
    instanceName: string,
    parameters: ReadonlyArray<readonly [string, string]>,
    connections: ReadonlyArray<readonly [string, string]>,
): void {
    if (parameters.length > 0) {
        writer.line(`${moduleName} #(`);
        writer.indent(() => emitCommaLines(writer,
            parameters.map(([name, value]) => `.${name} (${value})`)));
        writer.line(`) ${instanceName} (`);
    } else {
        writer.line(`${moduleName} ${instanceName} (`);
    }
    writer.indent(() => emitCommaLines(writer,
        connections.map(([name, value]) => `.${name} (${value})`)));
    writer.line(');');
    writer.line();
}

function emitCommaLines(writer: VerilogWriter, lines: readonly string[]): void {
    lines.forEach((line, index) => writer.line(`${line}${index + 1 === lines.length ? '' : ','}`));
}

function formatTopPort(port: PlannedPort): string {
    const width = port.width === 1 ? '' : ` [${port.width - 1}:0]`;
    return `${port.direction} wire${width} ${port.name}`;
}

function wireDeclaration(name: string, width: number): string {
    return width === 1 ? `wire ${name};` : `wire [${width - 1}:0] ${name};`;
}

function formatParameter(value: PlannedParameterValue, width?: number): string {
    if (typeof value === 'bigint') {
        return width === undefined ? value.toString() : `${width}'h${value.toString(16)}`;
    }
    if (typeof value === 'boolean') {
        return value ? '1' : '0';
    }
    if (typeof value === 'string') {
        return quoteVerilog(value);
    }
    return `${value}`;
}

function parameterNumber(value: PlannedParameterValue | undefined): number {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        throw new Error(`Expected planned integer parameter, received ${String(value)}`);
    }
    return value;
}

function catalogPortSuffix(instanceName: string, plannedName: string): string {
    const prefix = `${instanceName}_`;
    if (!plannedName.startsWith(prefix)) {
        throw new Error(`Planned port ${plannedName} does not belong to ${instanceName}`);
    }
    return plannedName.slice(prefix.length);
}

function joinOr(signals: readonly string[]): string {
    return signals.length === 0 ? "1'b0" : signals.join(' | ');
}

function constantName(name: string): string {
    return name.toUpperCase();
}

function endpointConstant(name: string): string {
    return `ENDPOINT_TARGET_${constantName(name)}`;
}

function hex32(value: bigint): string {
    const text = BigInt.asUintN(32, value).toString(16).padStart(8, '0');
    return `32'h${text.slice(0, 4)}_${text.slice(4)}`;
}

function quoteVerilog(value: string): string {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
