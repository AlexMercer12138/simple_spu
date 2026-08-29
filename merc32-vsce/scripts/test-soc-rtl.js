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

    const matrix = [
        ['minimal_external_memory_no_irq', withProject(clone(minimal), 'minimal_external_memory_no_irq')],
        ['internal_memories', internal],
        ['multiple_apb_instances', repeated],
        ['controller_mode', withProject(clone(multi), 'controller_mode')],
        ['simultaneous_protocols', protocols],
        ['downstream_address_widths', widths],
        ['debug_disabled', debugOff],
        ['all_bundled_peripherals', all],
    ];
    console.log('MERC32 generated RTL matrix:');
    for (const [name, config] of matrix) {
        assembleAndElaborate(name, config, catalog);
    }
    simulateStatefulRouter();
    console.log('MERC32 generated RTL matrix passed.');
} finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
