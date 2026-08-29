const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
    loadCatalog, parseSocConfig, planSoc,
    renderSocTop, renderPlbRouter, renderApbInterconnect,
} = require('../out/soc');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const fixtureDirectory = path.join(__dirname, 'fixtures', 'soc');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-soc-rtl-'));
const catalogRoot = path.join(temporaryRoot, 'catalog-assets');

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function readFixture(name) {
    return JSON.parse(fs.readFileSync(path.join(fixtureDirectory, name), 'utf8'));
}

function withProject(config, name) {
    return {
        ...config,
        project: { name: `${name}_soc`, outputDir: `generated/${name}_soc` },
    };
}

function listVerilogFiles(root, relative = '') {
    const directory = path.join(root, relative);
    const result = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) {
            result.push(...listVerilogFiles(root, child));
        } else if (entry.name.endsWith('.v')) {
            result.push(child.replace(/\\/g, '/'));
        }
    }
    return result.sort();
}

function assembleAndElaborate(name, config, catalog) {
    const sourceFile = path.join(fixtureDirectory, `${name}.merc32.json`);
    const parsed = parseSocConfig(`${JSON.stringify(config, null, 2)}\n`, sourceFile, catalog);
    assert.ok(parsed.config, `${name} parse failed:\n${JSON.stringify(parsed.diagnostics, null, 2)}`);
    const planned = planSoc(parsed.config, catalog);
    assert.ok(planned.plan, `${name} planning failed:\n${JSON.stringify(planned.diagnostics, null, 2)}`);
    const plan = planned.plan;

    const rtlDirectory = path.join(temporaryRoot, name, 'rtl');
    fs.mkdirSync(path.join(rtlDirectory, 'generated'), { recursive: true });
    const fileList = [];
    for (const logicalPath of plan.rtlFiles) {
        assert.match(logicalPath, /^rtl\//);
        const relativePath = logicalPath.slice('rtl/'.length);
        const destination = path.join(rtlDirectory, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(path.join(repositoryRoot, ...logicalPath.split('/')), destination);
        fileList.push(relativePath);
    }

    const routerPath = `generated/${plan.topModule}_plb_router.v`;
    fs.writeFileSync(path.join(rtlDirectory, ...routerPath.split('/')),
        renderPlbRouter(plan));
    fileList.push(routerPath);
    const apb = renderApbInterconnect(plan);
    if (apb !== undefined) {
        const apbPath = `generated/${plan.topModule}_apb_interconnect.v`;
        fs.writeFileSync(path.join(rtlDirectory, ...apbPath.split('/')), apb);
        fileList.push(apbPath);
    }
    const topPath = `${plan.topModule}.v`;
    fs.writeFileSync(path.join(rtlDirectory, topPath), renderSocTop(plan));
    fileList.push(topPath);

    const normalizedList = [...fileList].sort();
    fs.writeFileSync(path.join(rtlDirectory, 'files.f'), `${normalizedList.join('\n')}\n`);
    assert.deepStrictEqual(listVerilogFiles(rtlDirectory), normalizedList,
        `${name}: files.f must name every and only assembled Verilog file`);

    const outputFile = path.join(temporaryRoot, name, 'soc.vvp');
    const args = [
        '-Wall', '-Wno-timescale', '-g2005',
        '-s', plan.topModule,
        '-o', outputFile,
        '-f', 'files.f',
    ];
    assert.deepStrictEqual(args.filter((argument) => argument.endsWith('.v')), [],
        `${name}: elaboration source files must come only from files.f`);
    const result = spawnSync('iverilog', args, { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(result.status, 0,
        `${name}: iverilog failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.strictEqual(result.stderr, '', `${name}: iverilog warnings:\n${result.stderr}`);
    assert.ok(fs.existsSync(outputFile), `${name}: iverilog produced no output`);
    console.log(`  ${name}: ${normalizedList.length} files via rtl/files.f`);
    return { plan, rtlDirectory };
}

function assertRejectedBeforeEmission(name, config, catalog, code, expectedPath) {
    const sourceFile = path.join(fixtureDirectory, `${name}.merc32.json`);
    const parsed = parseSocConfig(`${JSON.stringify(config, null, 2)}\n`, sourceFile, catalog);
    assert.ok(parsed.config, `${name} parse failed:\n${JSON.stringify(parsed.diagnostics, null, 2)}`);
    const planned = planSoc(parsed.config, catalog);
    assert.strictEqual(planned.plan, undefined, `${name} unexpectedly produced an RTL plan`);
    assert.ok(planned.diagnostics.some((diagnostic) => diagnostic.code === code
        && JSON.stringify(diagnostic.path) === JSON.stringify(expectedPath)),
        `${name} missing ${code} at ${JSON.stringify(expectedPath)}:\n${JSON.stringify(planned.diagnostics, null, 2)}`);
    assert.strictEqual(fs.existsSync(path.join(temporaryRoot, name)), false,
        `${name} created RTL output before validation completed`);
}

function simulateStatefulRouter() {
    const directory = path.join(temporaryRoot, 'router_behavior');
    fs.mkdirSync(directory, { recursive: true });
    const plan = {
        topModule: 'router_behavior',
        endpoints: [
            { name: 'target_a', baseAddress: 0x10000000n, endAddress: 0x10000fffn },
            { name: 'target_b', baseAddress: 0x20000000n, endAddress: 0x20000fffn },
        ],
    };
    fs.writeFileSync(path.join(directory, 'router.v'), renderPlbRouter(plan));
    fs.writeFileSync(path.join(directory, 'router_tb.v'), `
module router_behavior_tb;
reg clk;
reg rst_n;
reg m_rden;
reg m_wren;
reg [31:0] m_addr;
reg [3:0] m_strb;
reg [31:0] m_wdata;
wire [31:0] m_rdata;
wire m_ack;
wire target_a_rden;
wire target_a_wren;
wire [31:0] target_a_addr;
wire [3:0] target_a_strb;
wire [31:0] target_a_wdata;
reg [31:0] target_a_rdata;
reg target_a_ack;
wire target_b_rden;
wire target_b_wren;
wire [31:0] target_b_addr;
wire [3:0] target_b_strb;
wire [31:0] target_b_wdata;
reg [31:0] target_b_rdata;
reg target_b_ack;

router_behavior_plb_router dut (
    .clk(clk), .rst_n(rst_n),
    .m_rden(m_rden), .m_wren(m_wren), .m_addr(m_addr),
    .m_strb(m_strb), .m_wdata(m_wdata), .m_rdata(m_rdata), .m_ack(m_ack),
    .target_a_rden(target_a_rden), .target_a_wren(target_a_wren),
    .target_a_addr(target_a_addr), .target_a_strb(target_a_strb),
    .target_a_wdata(target_a_wdata), .target_a_rdata(target_a_rdata),
    .target_a_ack(target_a_ack),
    .target_b_rden(target_b_rden), .target_b_wren(target_b_wren),
    .target_b_addr(target_b_addr), .target_b_strb(target_b_strb),
    .target_b_wdata(target_b_wdata), .target_b_rdata(target_b_rdata),
    .target_b_ack(target_b_ack)
);

always #5 clk = ~clk;

initial begin
    clk = 1'b0;
    rst_n = 1'b0;
    m_rden = 1'b0;
    m_wren = 1'b0;
    m_addr = 32'b0;
    m_strb = 4'hf;
    m_wdata = 32'h1234_5678;
    target_a_rdata = 32'haaaa_5555;
    target_a_ack = 1'b0;
    target_b_rdata = 32'hbbbb_6666;
    target_b_ack = 1'b0;

    repeat (2) @(posedge clk);
    rst_n = 1'b1;
    @(negedge clk);
    m_addr = 32'h1000_0040;
    m_rden = 1'b1;
    #1;
    if (!target_a_rden || target_b_rden || m_ack) $fatal(1, "target A request decode failed");
    @(posedge clk);
    #1;
    m_rden = 1'b0;
    m_addr = 32'h2000_0040;
    #1;
    if (target_a_rden || target_b_rden || m_ack) $fatal(1, "request was forwarded more than once");

    repeat (2) @(posedge clk);
    @(negedge clk);
    target_a_ack = 1'b1;
    #1;
    if (!m_ack || m_rdata !== 32'haaaa_5555) $fatal(1, "active target A response was not held");
    if (target_b_ack && m_rdata === 32'hbbbb_6666) $fatal(1, "target B stole the active response");
    @(posedge clk);
    #1;
    target_a_ack = 1'b0;

    @(negedge clk);
    m_addr = 32'h2000_0004;
    m_wren = 1'b1;
    #1;
    if (!target_b_wren || target_a_wren) $fatal(1, "target B write decode failed");
    @(posedge clk);
    #1;
    m_wren = 1'b0;
    @(negedge clk);
    target_b_ack = 1'b1;
    #1;
    if (!m_ack || m_rdata !== 32'hbbbb_6666) $fatal(1, "target B response failed");
    @(posedge clk);
    #1;
    target_b_ack = 1'b0;

    @(negedge clk);
    m_addr = 32'h3000_0000;
    m_rden = 1'b1;
    #1;
    if (target_a_rden || target_b_rden || m_ack) $fatal(1, "unmapped request was acknowledged");
    m_rden = 1'b0;
    $display("router_stateful_behavior: PASS");
    $finish;
end
endmodule
`);
    const compile = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005', '-s', 'router_behavior_tb',
        '-o', 'router.vvp', 'router.v', 'router_tb.v',
    ], { cwd: directory, encoding: 'utf8' });
    assert.strictEqual(compile.status, 0,
        `router behavior compile failed:\n${compile.stdout}\n${compile.stderr}`);
    assert.strictEqual(compile.stderr, '', `router behavior warnings:\n${compile.stderr}`);
    const simulation = spawnSync('vvp', ['router.vvp'], { cwd: directory, encoding: 'utf8' });
    assert.strictEqual(simulation.status, 0,
        `router behavior simulation failed:\n${simulation.stdout}\n${simulation.stderr}`);
    assert.match(simulation.stdout, /router_stateful_behavior: PASS/);
    console.log('  router_stateful_behavior: simulated');
}

function simulateExternalIrqReset(catalog) {
    const config = {
        schemaVersion: 1,
        project: { name: 'irq_reset_soc', outputDir: 'generated/irq_reset_soc' },
        cpu: { debug: false },
        memory: {
            ilb: { type: 'external_local_bus', size: '32KiB' },
            dlb: { type: 'external_local_bus', size: '64KiB' },
        },
        peripherals: [{
            type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000',
        }],
        externalInterfaces: [],
        interrupt: {
            mode: 'controller', controller: 'intc0', sources: [
                { source: 'external.active_low', id: 0, trigger: 'low' },
                { source: 'external.rise', id: 1, trigger: 'rising' },
                { source: 'external.fall', id: 2, trigger: 'falling' },
                { source: 'external.high', id: 3, trigger: 'high' },
            ],
        },
    };
    const { rtlDirectory } = assembleAndElaborate('external_irq_reset', config, catalog);
    fs.writeFileSync(path.join(rtlDirectory, 'irq_reset_tb.v'), `
module irq_reset_tb;
reg clk;
reg rst_n;
wire ilb_rden;
wire ilb_wren;
wire [12:0] ilb_addr;
wire [3:0] ilb_strb;
wire [31:0] ilb_wdata;
reg [31:0] ilb_rdata;
reg ilb_ack;
wire dlb_rden;
wire dlb_wren;
wire [13:0] dlb_addr;
wire [3:0] dlb_strb;
wire [31:0] dlb_wdata;
reg [31:0] dlb_rdata;
reg dlb_ack;
reg external_active_low;
reg external_rise;
reg external_fall;
reg external_high;

irq_reset_soc dut (
    .clk(clk), .rst_n(rst_n),
    .ilb_rden(ilb_rden), .ilb_wren(ilb_wren), .ilb_addr(ilb_addr),
    .ilb_strb(ilb_strb), .ilb_wdata(ilb_wdata),
    .ilb_rdata(ilb_rdata), .ilb_ack(ilb_ack),
    .dlb_rden(dlb_rden), .dlb_wren(dlb_wren), .dlb_addr(dlb_addr),
    .dlb_strb(dlb_strb), .dlb_wdata(dlb_wdata),
    .dlb_rdata(dlb_rdata), .dlb_ack(dlb_ack),
    .external_active_low(external_active_low),
    .external_rise(external_rise),
    .external_fall(external_fall),
    .external_high(external_high)
);

always #5 clk = ~clk;

task expect_sources;
    input [3:0] expected;
    begin
        if (dut.intc0_irq_sources !== expected) begin
            $display("IRQ SOURCE FAIL expected=%b actual=%b", expected, dut.intc0_irq_sources);
            $finish(1);
        end
    end
endtask

initial begin
    clk = 1'b0;
    rst_n = 1'b0;
    ilb_rdata = 32'b0;
    ilb_ack = 1'b0;
    dlb_rdata = 32'b0;
    dlb_ack = 1'b0;
    external_active_low = 1'b1;
    external_rise = 1'b1;
    external_fall = 1'b0;
    external_high = 1'b0;

    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);
    @(negedge clk);
    rst_n = 1'b1;
    repeat (4) begin
        @(posedge clk);
        #1 expect_sources(4'b0101);
    end

    @(negedge clk);
    external_active_low = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0100);
    @(negedge clk);
    external_active_low = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);

    @(negedge clk);
    external_rise = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);
    @(negedge clk);
    external_rise = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0111);
    @(negedge clk);
    external_rise = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);

    @(negedge clk);
    external_fall = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0101);
    @(negedge clk);
    external_fall = 1'b0;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b0001);

    @(negedge clk);
    external_high = 1'b1;
    repeat (3) @(posedge clk);
    #1 expect_sources(4'b1001);

    $display("external_irq_reset_behavior: PASS");
    $finish;
end
endmodule
`);
    const compile = spawnSync('iverilog', [
        '-Wall', '-Wno-timescale', '-g2005', '-s', 'irq_reset_tb',
        '-o', 'irq_reset.vvp', '-f', 'files.f', 'irq_reset_tb.v',
    ], { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(compile.status, 0,
        `external IRQ reset compile failed:\n${compile.stdout}\n${compile.stderr}`);
    assert.strictEqual(compile.stderr, '', `external IRQ reset warnings:\n${compile.stderr}`);
    const simulation = spawnSync('vvp', ['irq_reset.vvp'],
        { cwd: rtlDirectory, encoding: 'utf8' });
    assert.strictEqual(simulation.status, 0,
        `external IRQ reset simulation failed:\n${simulation.stdout}\n${simulation.stderr}`);
    assert.match(simulation.stdout, /external_irq_reset_behavior: PASS/);
    console.log('  external_irq_reset_behavior: simulated');
}

try {
    fs.cpSync(path.join(__dirname, '..', 'resources', 'catalog'),
        path.join(catalogRoot, 'catalog'), { recursive: true });
    fs.cpSync(path.join(repositoryRoot, 'rtl'), path.join(catalogRoot, 'rtl'),
        { recursive: true });
    const catalog = loadCatalog(catalogRoot);
    const minimal = readFixture('minimal.merc32.json');
    const multi = readFixture('multi-peripheral.merc32.json');
    const all = readFixture('all-peripherals.merc32.json');

    const internal = withProject(clone(minimal), 'internal_memories');
    internal.memory.ilb = { type: 'internal_ram', size: '32KiB' };
    internal.memory.dlb = { type: 'internal_ram', size: '64KiB' };

    const repeated = withProject(clone(minimal), 'multiple_apb_instances');
    repeated.peripherals = [
        { type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000' },
        { type: 'apb_uart', name: 'uart1', baseAddress: '0x10001000' },
    ];
    repeated.interrupt = { mode: 'direct', source: 'uart1.interrupt' };

    const protocols = withProject(clone(minimal), 'simultaneous_protocols');
    protocols.externalInterfaces = all.externalInterfaces;

    const widths = withProject(clone(minimal), 'downstream_address_widths');
    widths.externalInterfaces = [
        {
            type: 'apb', name: 'apb12', baseAddress: '0x20000000',
            windowSize: '4KiB', addressWidth: 12,
        },
        {
            type: 'axi4_lite', name: 'axi32', baseAddress: '0x21000000',
            windowSize: '16MiB', addressWidth: 32,
        },
    ];

    const debugOff = withProject(clone(multi), 'debug_disabled');
    debugOff.cpu.debug = false;

    const nearCollisions = clone(minimal);
    nearCollisions.project = { name: 'module_soc', outputDir: 'generated/module_soc' };
    nearCollisions.peripherals = [{
        type: 'apb_intc', name: 'cpu0', baseAddress: '0x10000000',
    }];
    nearCollisions.externalInterfaces = [{
        type: 'local_bus', name: 'm0', baseAddress: '0x10001000',
        windowSize: '4KiB', addressWidth: 32,
    }];
    nearCollisions.interrupt = {
        mode: 'controller', controller: 'cpu0', sources: [
            { source: 'external.foo', id: 0, trigger: 'high' },
            { source: 'external.foo_sync0', id: 1, trigger: 'low' },
        ],
    };

    const reservedProject = clone(minimal);
    reservedProject.project.name = 'module';
    assertRejectedBeforeEmission('reserved_project_name', reservedProject, catalog,
        'SOC_VERILOG_RESERVED', ['project', 'name']);

    const packagedModuleProject = clone(minimal);
    packagedModuleProject.project.name = 'MERC32_top';
    assertRejectedBeforeEmission('packaged_module_project_name', packagedModuleProject, catalog,
        'SOC_VERILOG_MODULE_COLLISION', ['project', 'name']);

    const routerMasterCollision = clone(minimal);
    routerMasterCollision.externalInterfaces = [{
        type: 'local_bus', name: 'm', baseAddress: '0x10000000',
        windowSize: '4KiB', addressWidth: 32,
    }];
    assertRejectedBeforeEmission('router_master_symbol_collision', routerMasterCollision, catalog,
        'SOC_VERILOG_SYMBOL_COLLISION', ['externalInterfaces', 0, 'name']);

    const cpuInstanceCollision = clone(minimal);
    cpuInstanceCollision.peripherals = [{
        type: 'apb_uart', name: 'cpu', baseAddress: '0x10000000',
    }];
    assertRejectedBeforeEmission('cpu_instance_symbol_collision', cpuInstanceCollision, catalog,
        'SOC_VERILOG_SYMBOL_COLLISION', ['peripherals', 0, 'name']);

    const synchronizerCollision = clone(minimal);
    synchronizerCollision.peripherals = [{
        type: 'apb_intc', name: 'intc0', baseAddress: '0x10000000',
    }];
    synchronizerCollision.interrupt = {
        mode: 'controller', controller: 'intc0', sources: [
            { source: 'external.foo', id: 0, trigger: 'high' },
            { source: 'external.foo_sync', id: 1, trigger: 'low' },
        ],
    };
    assertRejectedBeforeEmission('synchronizer_symbol_collision', synchronizerCollision, catalog,
        'SOC_VERILOG_SYMBOL_COLLISION', ['interrupt', 'sources', 1, 'source']);

    const generatedModuleDescriptors = new Map(catalog.modules);
    generatedModuleDescriptors.set('collision_fixture', {
        ...catalog.modules.get('apb_uart'),
        type: 'collision_fixture',
        module: 'minimal_soc_plb_router',
    });
    generatedModuleDescriptors.set('apb_collision_fixture', {
        ...catalog.modules.get('apb_uart'),
        type: 'apb_collision_fixture',
        module: 'generated_apb_soc_apb_interconnect',
    });
    const generatedModuleCatalog = {
        modules: generatedModuleDescriptors,
        protocols: catalog.protocols,
    };
    assertRejectedBeforeEmission('generated_module_name_collision', minimal,
        generatedModuleCatalog, 'SOC_VERILOG_MODULE_COLLISION', ['project', 'name']);

    const generatedApbNameCollision = clone(minimal);
    generatedApbNameCollision.project.name = 'generated_apb_soc';
    generatedApbNameCollision.peripherals = [{
        type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000',
    }];
    assertRejectedBeforeEmission('generated_apb_module_name_collision',
        generatedApbNameCollision, generatedModuleCatalog,
        'SOC_VERILOG_MODULE_COLLISION', ['project', 'name']);

    const matrix = [
        ['minimal_external_memory_no_irq', withProject(clone(minimal), 'minimal_external_memory_no_irq')],
        ['internal_memories', internal],
        ['multiple_apb_instances', repeated],
        ['controller_mode', withProject(clone(multi), 'controller_mode')],
        ['simultaneous_protocols', protocols],
        ['downstream_address_widths', widths],
        ['debug_disabled', debugOff],
        ['all_bundled_peripherals', all],
        ['collision_adjacent_names', nearCollisions],
    ];
    console.log('MERC32 generated RTL matrix:');
    for (const [name, config] of matrix) {
        assembleAndElaborate(name, config, catalog);
    }
    simulateStatefulRouter();
    simulateExternalIrqReset(catalog);
    console.log('MERC32 generated RTL matrix passed.');
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
