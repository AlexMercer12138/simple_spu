const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const soc = require('../out/soc');

assert.strictEqual(typeof soc.renderSocTop, 'function',
    'renderSocTop must be exported from the SoC package');
assert.strictEqual(typeof soc.renderPlbRouter, 'function',
    'renderPlbRouter must be exported from the SoC package');
assert.strictEqual(typeof soc.renderApbInterconnect, 'function',
    'renderApbInterconnect must be exported from the SoC package');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const fixtureDirectory = path.join(__dirname, 'fixtures', 'soc');
const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-emitter-assets-'));

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function planFixture(config, fileName) {
    const text = `${JSON.stringify(config, null, 2)}\n`;
    const parsed = soc.parseSocConfig(text, path.join(fixtureDirectory, fileName), catalog);
    assert.ok(parsed.config, JSON.stringify(parsed.diagnostics, null, 2));
    const result = soc.planSoc(parsed.config, catalog);
    assert.ok(result.plan, JSON.stringify(result.diagnostics, null, 2));
    return result.plan;
}

let catalog;
try {
    fs.cpSync(path.join(__dirname, '..', 'resources', 'catalog'),
        path.join(assetRoot, 'catalog'), { recursive: true });
    fs.cpSync(path.join(repositoryRoot, 'rtl'), path.join(assetRoot, 'rtl'),
        { recursive: true });
    catalog = soc.loadCatalog(assetRoot);

    const multi = JSON.parse(fs.readFileSync(
        path.join(fixtureDirectory, 'multi-peripheral.merc32.json'), 'utf8'));
    const controllerPlan = planFixture(multi, 'multi-peripheral.merc32.json');
    const top = soc.renderSocTop(controllerPlan);
    const router = soc.renderPlbRouter(controllerPlan);
    const apb = soc.renderApbInterconnect(controllerPlan);

    // Removing the integration top, bridge parameters, physical ports, stateful
    // router, or shared APB decoder must break these observable RTL contracts.
    assert.match(top, /^module demo_soc\b/m);
    assert.match(top, /MERC32_top #\(/);
    assert.match(top, /apb_uart[^;]*uart0_inst/s);
    assert.match(top, /\.AXI_ADDR_WIDTH\s*\(32\)/);
    assert.match(top, /output wire \[11:0\] apb_ext0_m_apb_paddr/);
    assert.match(top, /\.lb_addr\s*\(apb_ext0_router_addr\[11:0\]\)/);
    assert.match(top, /\.lb_addr\s*\(axi0_router_addr\[31:0\]\)/);
    assert.strictEqual((top.match(/builtin_apb_bridge_inst/g) || []).length, 1);
    assert.match(top, /apb_intc[^;]*intc0_inst/s);
    assert.strictEqual((top.match(/\bapb_intc\b/g) || []).length, 1);
    assert.match(top, /\.IRQ_COUNT\s*\(4\)/);
    assert.match(top, /\.IRQ_MODE\s*\(64'he4\)/);
    assert.match(top, /reg external_wake_meta/);
    assert.match(top, /reg external_wake_sync/);
    assert.match(top, /\.interrupt\s*\(intc0_interrupt\)/);
    assert.match(router, /32'h2000_0000/);
    assert.match(router, /active_endpoint/);
    assert.match(router, /if \(m_ack\)/);
    assert.match(apb, /^module demo_soc_apb_interconnect\b/m);
    assert.match(apb, /output wire uart0_psel/);
    assert.match(apb, /output wire intc0_psel/);
    assert.doesNotMatch(`${top}\n${router}\n${apb}`,
        /\b(?:logic|always_comb|interface|package|struct)\b|`ifdef IF_/);
    assert.strictEqual(soc.renderSocTop(controllerPlan), top);
    assert.strictEqual(soc.renderPlbRouter(controllerPlan), router);
    assert.strictEqual(soc.renderApbInterconnect(controllerPlan), apb);

    const all = JSON.parse(fs.readFileSync(
        path.join(fixtureDirectory, 'all-peripherals.merc32.json'), 'utf8'));
    const allTop = soc.renderSocTop(planFixture(all, 'all-peripherals.merc32.json'));
    assert.match(allTop, /assign av0_router_ack = av0_bridge_valid;/);
    assert.doesNotMatch(allTop, /av0_bridge_valid\s*\|/);

    const minimal = JSON.parse(fs.readFileSync(
        path.join(fixtureDirectory, 'minimal.merc32.json'), 'utf8'));
    const noneTop = soc.renderSocTop(planFixture(minimal, 'minimal.merc32.json'));
    assert.match(noneTop, /\.interrupt\s*\(1'b0\)/);
    assert.strictEqual(soc.renderApbInterconnect(
        planFixture(minimal, 'minimal.merc32.json')), undefined);

    const direct = clone(minimal);
    direct.peripherals = [{
        type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000',
    }];
    direct.interrupt = { mode: 'direct', source: 'uart0.interrupt' };
    const directTop = soc.renderSocTop(planFixture(direct, 'direct.merc32.json'));
    assert.match(directTop, /\.interrupt\s*\(uart0_interrupt\)/);
    assert.doesNotMatch(directTop, /\bapb_intc\b/);

    const directExternal = clone(minimal);
    directExternal.interrupt = { mode: 'direct', source: 'external.wake' };
    const directExternalTop = soc.renderSocTop(
        planFixture(directExternal, 'direct-external.merc32.json'));
    assert.match(directExternalTop, /input wire external_wake/);
    assert.match(directExternalTop, /\.interrupt\s*\(external_wake\)/);
    assert.doesNotMatch(directExternalTop, /external_wake_(?:meta|sync)/);

    const reservedName = clone(minimal);
    reservedName.externalInterfaces = [{
        type: 'local_bus', name: 'none', baseAddress: '0x20000000',
        windowSize: '4KiB', addressWidth: 12,
    }];
    const reservedRouter = soc.renderPlbRouter(
        planFixture(reservedName, 'reserved-name.merc32.json'));
    assert.match(reservedRouter, /ENDPOINT_NONE\b/);
    assert.match(reservedRouter, /ENDPOINT_TARGET_NONE\b/);

    console.log('MERC32 SoC Verilog emitter structural tests passed.');
} finally {
    fs.rmSync(assetRoot, { recursive: true, force: true });
}
