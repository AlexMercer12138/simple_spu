const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const soc = require('../out/soc');
const { compileCFile } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

assert.strictEqual(typeof soc.renderSocTop, 'function',
    'renderSocTop must be exported from the SoC package');
assert.strictEqual(typeof soc.renderPlbRouter, 'function',
    'renderPlbRouter must be exported from the SoC package');
assert.strictEqual(typeof soc.renderApbInterconnect, 'function',
    'renderApbInterconnect must be exported from the SoC package');
assert.strictEqual(typeof soc.renderResolvedConfig, 'function',
    'renderResolvedConfig must be exported from the SoC package');
assert.strictEqual(typeof soc.renderAddressMap, 'function',
    'renderAddressMap must be exported from the SoC package');
assert.strictEqual(typeof soc.renderSocHeader, 'function',
    'renderSocHeader must be exported from the SoC package');
assert.strictEqual(typeof soc.renderGeneratedReadme, 'function',
    'renderGeneratedReadme must be exported from the SoC package');
assert.strictEqual(typeof soc.renderStarterMain, 'function',
    'renderStarterMain must be exported from the SoC package');

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

function assertSortedObjectKeys(value) {
    if (Array.isArray(value)) {
        value.forEach(assertSortedObjectKeys);
        return;
    }
    if (value === null || typeof value !== 'object') return;
    const keys = Object.keys(value);
    assert.deepStrictEqual(keys, [...keys].sort(), `generated object keys must be sorted: ${keys}`);
    Object.values(value).forEach(assertSortedObjectKeys);
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
    const resolvedConfig = soc.renderResolvedConfig(controllerPlan);
    const addressMap = soc.renderAddressMap(controllerPlan);
    const header = soc.renderSocHeader(controllerPlan);
    const readme = soc.renderGeneratedReadme(controllerPlan);
    const starterMain = soc.renderStarterMain(controllerPlan);

    assert.strictEqual(resolvedConfig, soc.renderResolvedConfig(controllerPlan));
    const resolved = JSON.parse(resolvedConfig);
    assert.strictEqual(`${JSON.stringify(resolved, null, 2)}\n`, resolvedConfig);
    assertSortedObjectKeys(resolved);
    assert.deepStrictEqual(resolved.cpu, { debug: true, jtagIdCode: '0x4d320001' });
    assert.deepStrictEqual(resolved.memory, {
        dlb: {
            baseAddress: '0x08000000', endAddress: '0x0800ffff',
            sizeBytes: 65536, type: 'external_local_bus', wordAddressWidth: 14,
        },
        ilb: {
            baseAddress: '0x00000000', endAddress: '0x00007fff', initFile: 'firmware.mem',
            sizeBytes: 32768, type: 'internal_ram', wordAddressWidth: 13,
        },
    });
    assert.deepStrictEqual(resolved.interrupt, {
        controller: 'intc0', irqCount: 4, irqMode: '0x00000000000000e4', mode: 'controller',
        sources: [
            { id: 0, source: 'uart0.interrupt', trigger: 'high' },
            { id: 1, source: 'uart1.interrupt', trigger: 'low' },
            { id: 2, source: 'gpio0.interrupt', trigger: 'rising' },
            { id: 3, source: 'external.wake', topPort: 'external_wake', trigger: 'falling' },
        ],
    });
    assert.deepStrictEqual(resolved.peripherals.map((item) => ({
        baseAddress: item.baseAddress, endAddress: item.endAddress, interrupts: item.interrupts,
        module: item.module, name: item.name, sizeBytes: item.sizeBytes, type: item.type,
    })), [
        { baseAddress: '0x10000000', endAddress: '0x10000fff', interrupts: ['interrupt'], module: 'apb_uart', name: 'uart0', sizeBytes: 4096, type: 'apb_uart' },
        { baseAddress: '0x10001000', endAddress: '0x10001fff', interrupts: ['interrupt'], module: 'apb_uart', name: 'uart1', sizeBytes: 4096, type: 'apb_uart' },
        { baseAddress: '0x10002000', endAddress: '0x10002fff', interrupts: ['interrupt'], module: 'apb_gpio', name: 'gpio0', sizeBytes: 4096, type: 'apb_gpio' },
        { baseAddress: '0x10003000', endAddress: '0x10003fff', interrupts: ['interrupt'], module: 'apb_intc', name: 'intc0', sizeBytes: 4096, type: 'apb_intc' },
    ]);
    assert.deepStrictEqual(resolved.externalInterfaces.map((item) => ({
        addressWidth: item.addressWidth, baseAddress: item.baseAddress, endAddress: item.endAddress,
        name: item.name, sizeBytes: item.sizeBytes, type: item.type,
    })), [
        { addressWidth: 12, baseAddress: '0x10004000', endAddress: '0x10004fff', name: 'apb_ext0', sizeBytes: 4096, type: 'apb' },
        { addressWidth: 32, baseAddress: '0x20000000', endAddress: '0x20ffffff', name: 'axi0', sizeBytes: 16777216, type: 'axi4_lite' },
    ]);
    assert.deepStrictEqual(resolved.rtlFiles, controllerPlan.rtlFiles);
    assert.deepStrictEqual(resolved.topPorts, controllerPlan.topPorts);

    assert.strictEqual(addressMap, soc.renderAddressMap(controllerPlan));
    assert.strictEqual(addressMap, [
        '{', '  "endpoints": [',
        '    {', '      "baseAddress": "0x10000000",', '      "endAddress": "0x10000fff",', '      "kind": "peripheral",', '      "name": "uart0",', '      "sizeBytes": 4096,', '      "type": "apb_uart"', '    },',
        '    {', '      "baseAddress": "0x10001000",', '      "endAddress": "0x10001fff",', '      "kind": "peripheral",', '      "name": "uart1",', '      "sizeBytes": 4096,', '      "type": "apb_uart"', '    },',
        '    {', '      "baseAddress": "0x10002000",', '      "endAddress": "0x10002fff",', '      "kind": "peripheral",', '      "name": "gpio0",', '      "sizeBytes": 4096,', '      "type": "apb_gpio"', '    },',
        '    {', '      "baseAddress": "0x10003000",', '      "endAddress": "0x10003fff",', '      "kind": "peripheral",', '      "name": "intc0",', '      "sizeBytes": 4096,', '      "type": "apb_intc"', '    },',
        '    {', '      "baseAddress": "0x10004000",', '      "endAddress": "0x10004fff",', '      "kind": "external",', '      "name": "apb_ext0",', '      "sizeBytes": 4096,', '      "type": "apb"', '    },',
        '    {', '      "baseAddress": "0x20000000",', '      "endAddress": "0x20ffffff",', '      "kind": "external",', '      "name": "axi0",', '      "sizeBytes": 16777216,', '      "type": "axi4_lite"', '    }', '  ],', '  "memory": {',
        '    "dlb": {', '      "baseAddress": "0x08000000",', '      "endAddress": "0x0800ffff",', '      "name": "dlb",', '      "sizeBytes": 65536', '    },',
        '    "ilb": {', '      "baseAddress": "0x00000000",', '      "endAddress": "0x00007fff",', '      "name": "ilb",', '      "sizeBytes": 32768', '    }', '  },', '  "project": "demo_soc"', '}', '',
    ].join('\n'));

    assert.strictEqual(header, [
        '#ifndef DEMO_SOC_H', '#define DEMO_SOC_H', '#define DEMO_SOC_ILB_BASE 0x00000000', '#define DEMO_SOC_ILB_SIZE 32768', '#define DEMO_SOC_ILB_END 0x00007fff', '#define DEMO_SOC_FEATURE_ILB_INTERNAL_RAM 1', '#define DEMO_SOC_DLB_BASE 0x08000000', '#define DEMO_SOC_DLB_SIZE 65536', '#define DEMO_SOC_DLB_END 0x0800ffff', '#define DEMO_SOC_FEATURE_DLB_EXTERNAL_LOCAL_BUS 1', '#define DEMO_SOC_FEATURE_DEBUG 1', '#define DEMO_SOC_UART0_BASE 0x10000000', '#define DEMO_SOC_UART0_SIZE 4096', '#define DEMO_SOC_UART0_END 0x10000fff', '#define DEMO_SOC_FEATURE_UART0 1', '#define DEMO_SOC_UART1_BASE 0x10001000', '#define DEMO_SOC_UART1_SIZE 4096', '#define DEMO_SOC_UART1_END 0x10001fff', '#define DEMO_SOC_FEATURE_UART1 1', '#define DEMO_SOC_GPIO0_BASE 0x10002000', '#define DEMO_SOC_GPIO0_SIZE 4096', '#define DEMO_SOC_GPIO0_END 0x10002fff', '#define DEMO_SOC_FEATURE_GPIO0 1', '#define DEMO_SOC_INTC0_BASE 0x10003000', '#define DEMO_SOC_INTC0_SIZE 4096', '#define DEMO_SOC_INTC0_END 0x10003fff', '#define DEMO_SOC_FEATURE_INTC0 1', '#define DEMO_SOC_APB_EXT0_BASE 0x10004000', '#define DEMO_SOC_APB_EXT0_SIZE 4096', '#define DEMO_SOC_APB_EXT0_END 0x10004fff', '#define DEMO_SOC_FEATURE_APB_EXT0 1', '#define DEMO_SOC_AXI0_BASE 0x20000000', '#define DEMO_SOC_AXI0_SIZE 16777216', '#define DEMO_SOC_AXI0_END 0x20ffffff', '#define DEMO_SOC_FEATURE_AXI0 1', '#define MERC32_IRQ_TRIGGER_HIGH 0', '#define MERC32_IRQ_TRIGGER_LOW 1', '#define MERC32_IRQ_TRIGGER_RISING 2', '#define MERC32_IRQ_TRIGGER_FALLING 3', '#define DEMO_SOC_UART0_IRQ 0', '#define DEMO_SOC_UART0_IRQ_TRIGGER MERC32_IRQ_TRIGGER_HIGH', '#define DEMO_SOC_UART1_IRQ 1', '#define DEMO_SOC_UART1_IRQ_TRIGGER MERC32_IRQ_TRIGGER_LOW', '#define DEMO_SOC_GPIO0_IRQ 2', '#define DEMO_SOC_GPIO0_IRQ_TRIGGER MERC32_IRQ_TRIGGER_RISING', '#define DEMO_SOC_EXTERNAL_WAKE_IRQ 3', '#define DEMO_SOC_EXTERNAL_WAKE_IRQ_TRIGGER MERC32_IRQ_TRIGGER_FALLING', '#endif', '',
    ].join('\n'));
    assert.doesNotMatch(header, /#define\s+\w+\s*\(/);

    const expectedFiles = [
        'rtl/demo_soc.v', 'rtl/generated/demo_soc_plb_router.v',
        'rtl/generated/demo_soc_apb_interconnect.v',
        'rtl/apb_gpio/apb_gpio.v', 'rtl/apb_intc/apb_intc.v', 'rtl/apb_uart/apb_uart.v',
        'rtl/bridge/lb2apb.v', 'rtl/bridge/lb2axi_lite.v', 'rtl/cpu/MERC32_top.v',
        'rtl/cpu/core.v', 'rtl/debug/jtag_debug.v', 'rtl/misc/div.v', 'rtl/misc/mul.v',
        'rtl/misc/spram.v', 'rtl/files.f', 'memory/firmware.mem',
        'software/include/demo_soc.h', 'software/src/main.c',
        'config/demo_soc.resolved.json', 'address-map.json', 'manifest.json', 'README.md', 'LICENSE',
    ];
    assert.deepStrictEqual(soc.expectedGeneratedFiles(controllerPlan), expectedFiles);
    const readmeFiles = readme.slice(
        readme.indexOf('## Generated files\n\n') + '## Generated files\n\n'.length,
        readme.indexOf('\n## Generation identity'),
    );
    assert.strictEqual(readmeFiles, `${expectedFiles.map((file) => `- \`${file}\``).join('\n')}\n`);
    assert.match(readme, /^# demo_soc\n\nTop module: `demo_soc`\n/m);
    assert.doesNotMatch(readme, /successfully generated/i);

    assert.strictEqual(starterMain, [
        '#include "../include/demo_soc.h"',
        '',
        'int main(void) {',
        '    while (1) {',
        '    }',
        '    return 0;',
        '}',
        '',
    ].join('\n'));
    const softwareRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-software-emitter-'));
    try {
        const headerFile = path.join(softwareRoot, 'include', 'demo_soc.h');
        const mainFile = path.join(softwareRoot, 'src', 'main.c');
        fs.mkdirSync(path.dirname(headerFile), { recursive: true });
        fs.mkdirSync(path.dirname(mainFile), { recursive: true });
        fs.writeFileSync(headerFile, header);
        fs.writeFileSync(mainFile, starterMain);
        const result = compileCFile(mainFile, { moduleName: 'generated_main' });
        assert.ok(new SimpleCPUAssembler().assemble(result.assembly, {
            sourceFileName: 'generated_main.asm',
        }).machineCodes.length > 0);
    } finally {
        fs.rmSync(softwareRoot, { recursive: true, force: true });
    }
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
    assert.match(top, /reg \[1:0\] external_wake_history_valid/);
    assert.match(top, /reg external_wake_conditioned/);
    assert.match(top, /reg external_wake_armed/);
    assert.match(top, /intc0_irq_sources\[3\] = external_wake_conditioned/);
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
    const minimalPlan = planFixture(minimal, 'minimal.merc32.json');
    assert.deepStrictEqual(soc.expectedGeneratedFiles(minimalPlan), [
        'rtl/minimal_soc.v', 'rtl/generated/minimal_soc_plb_router.v',
        'rtl/cpu/MERC32_top.v', 'rtl/cpu/core.v', 'rtl/misc/div.v', 'rtl/misc/mul.v',
        'rtl/files.f', 'software/include/minimal_soc.h', 'software/src/main.c',
        'config/minimal_soc.resolved.json', 'address-map.json', 'manifest.json', 'README.md', 'LICENSE',
    ]);
    const inactiveFeatureCollision = clone(minimal);
    inactiveFeatureCollision.memory.ilb.type = 'internal_ram';
    inactiveFeatureCollision.externalInterfaces = [{
        type: 'local_bus', name: 'ilb_external_local_bus', baseAddress: '0x20000000',
        windowSize: '4KiB', addressWidth: 12,
    }];
    assert.ok(soc.planSoc(inactiveFeatureCollision, catalog).plan,
        'an endpoint may use an inactive ILB feature macro namespace');
    const activeFeatureCollision = clone(inactiveFeatureCollision);
    activeFeatureCollision.memory.ilb.type = 'external_local_bus';
    const activeCollision = soc.planSoc(activeFeatureCollision, catalog);
    assert.strictEqual(activeCollision.plan, undefined);
    assert.match(JSON.stringify(activeCollision.diagnostics), /SOC_MACRO_COLLISION/);
    const inactiveDlbFeatureCollision = clone(minimal);
    inactiveDlbFeatureCollision.memory.dlb.type = 'external_local_bus';
    inactiveDlbFeatureCollision.externalInterfaces = [{
        type: 'local_bus', name: 'dlb_internal_ram', baseAddress: '0x20000000',
        windowSize: '4KiB', addressWidth: 12,
    }];
    assert.ok(soc.planSoc(inactiveDlbFeatureCollision, catalog).plan,
        'an endpoint may use an inactive DLB feature macro namespace');
    const activeDlbFeatureCollision = clone(inactiveDlbFeatureCollision);
    activeDlbFeatureCollision.memory.dlb.type = 'internal_ram';
    const activeDlbCollision = soc.planSoc(activeDlbFeatureCollision, catalog);
    assert.strictEqual(activeDlbCollision.plan, undefined);
    assert.match(JSON.stringify(activeDlbCollision.diagnostics), /SOC_MACRO_COLLISION/);
    const noneTop = soc.renderSocTop(minimalPlan);
    assert.match(noneTop, /\.interrupt\s*\(1'b0\)/);
    assert.strictEqual(soc.renderApbInterconnect(
        minimalPlan), undefined);

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
