const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseU32, parseByteSize, formatHex32, rangeEnd, alignUp,
    loadCatalog,
} = require('../out/soc');

const catalogResources = path.resolve(__dirname, '..', 'resources', 'catalog');
const catalogAssetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-builtins-'));
for (const logicalPath of [
    'rtl/apb_can/apb_can.v', 'rtl/apb_gpio/apb_gpio.v',
    'rtl/apb_i2c/apb_i2c.v', 'rtl/apb_intc/apb_intc.v',
    'rtl/apb_qspi/apb_qspi.v', 'rtl/apb_sdio/apb_sdio.v',
    'rtl/apb_timer/apb_timer.v', 'rtl/apb_uart/apb_uart.v',
    'rtl/bridge/lb2apb.v', 'rtl/bridge/lb2avalon.v',
    'rtl/bridge/lb2axi_lite.v', 'rtl/bridge/lb2drp.v', 'rtl/bridge/lb2wbc.v',
]) {
    const file = path.join(catalogAssetRoot, ...logicalPath.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, 'opaque test asset\n');
}
fs.cpSync(catalogResources, path.join(catalogAssetRoot, 'catalog'), { recursive: true });
const catalog = loadCatalog(catalogAssetRoot);
const expectedModuleTypes = [
    'apb_can', 'apb_gpio', 'apb_i2c', 'apb_intc',
    'apb_qspi', 'apb_sdio', 'apb_timer', 'apb_uart',
];
assert.deepStrictEqual([...catalog.modules.keys()].sort(), expectedModuleTypes);
assert.deepStrictEqual([...catalog.modules.values()]
    .filter((module) => !module.multiple).map((module) => module.type), ['apb_intc']);
assert.strictEqual(catalog.modules.get('apb_qspi').ports
    .find((port) => port.name === 'qspi_cs_n').width.parameter, 'CS_COUNT');
assert.deepStrictEqual(catalog.modules.get('apb_uart').rtlFiles,
    ['rtl/apb_uart/apb_uart.v']);
assert.deepStrictEqual([...catalog.protocols.keys()].sort(), [
    'apb', 'avalon', 'axi4_lite', 'drp', 'local_bus', 'wishbone',
]);
assert.strictEqual(catalog.protocols.get('axi4_lite').addressWidthParameter,
    'AXI_ADDR_WIDTH');
assert.strictEqual(catalog.protocols.get('apb').ports
    .find((port) => port.name === 'm_apb_paddr').width.parameter, 'APB_ADDR_WIDTH');
assert.strictEqual(Object.isFrozen(catalog.modules), true);
assert.strictEqual(Object.isFrozen(catalog.modules.get('apb_uart')), true);
assert.strictEqual(typeof catalog.modules.set, 'undefined');

function withCatalogAssets(moduleDescriptors, protocols, test) {
    const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-catalog-'));
    try {
        const modulesDirectory = path.join(temporaryRoot, 'catalog', 'modules');
        fs.mkdirSync(modulesDirectory, { recursive: true });
        fs.mkdirSync(path.join(temporaryRoot, 'rtl'), { recursive: true });
        fs.writeFileSync(path.join(temporaryRoot, 'rtl', 'fixture.v'), 'module fixture; endmodule\n');
        for (const [fileName, descriptor] of Object.entries(moduleDescriptors)) {
            fs.writeFileSync(path.join(modulesDirectory, fileName), JSON.stringify(descriptor));
        }
        fs.writeFileSync(path.join(temporaryRoot, 'catalog', 'protocols.json'), JSON.stringify(protocols));
        test(temporaryRoot);
    } finally {
        fs.rmSync(temporaryRoot, { recursive: true, force: true });
    }
}

const validModule = {
    type: 'fixture', module: 'fixture_module', rtlFiles: ['rtl/fixture.v'],
    multiple: true, addressSize: 4096, alignment: 4096,
    parameters: { DEPTH: { type: 'powerOfTwo', minimum: 2, default: 8 } },
    ports: [{ name: 'data', direction: 'output', width: { parameter: 'DEPTH' } }],
    interrupts: [],
};
const validProtocols = [{
    type: 'local_bus', rtlFiles: [], alignment: 4,
    ports: [{ name: 'addr', direction: 'output', width: 32 }],
}];

withCatalogAssets({ 'one.json': validModule, 'two.json': validModule }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /duplicate module type/i));
withCatalogAssets({ 'fixture.json': {
    ...validModule,
    ports: [validModule.ports[0], { ...validModule.ports[0] }],
} }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /duplicate .*port/i));
withCatalogAssets({ 'fixture.json': { ...validModule, rtlFiles: ['rtl/missing.v'] } }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /missing RTL file/i));
withCatalogAssets({ 'fixture.json': {
    ...validModule,
    parameters: { DEPTH: { type: 'powerOfTwo', minimum: 2, default: 6 } },
} }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /default.*power of two/i));
withCatalogAssets({ 'fixture.json': {
    ...validModule,
    ports: [{ name: 'data', direction: 'output', width: { parameter: 'UNKNOWN' } }],
} }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /unknown parameter.*UNKNOWN/i));
withCatalogAssets({ 'fixture.json': { ...validModule, unexpected: true } }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /unknown field.*unexpected/i));
withCatalogAssets({ 'fixture.json': validModule }, [{ ...validProtocols[0], unexpected: true }],
    (root) => assert.throws(() => loadCatalog(root), /unknown field.*unexpected/i));
withCatalogAssets({ 'fixture.json': { ...validModule, rtlFiles: ['../fixture.v'] } }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /asset-relative/i));
withCatalogAssets({ 'fixture.json': { ...validModule, rtlFiles: [path.resolve('fixture.v')] } }, validProtocols,
    (root) => assert.throws(() => loadCatalog(root), /asset-relative/i));

const caseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-catalog-case-'));
try {
    fs.mkdirSync(path.join(caseRoot, 'catalog', 'modules'), { recursive: true });
    fs.mkdirSync(path.join(caseRoot, 'rtl'), { recursive: true });
    fs.writeFileSync(path.join(caseRoot, 'rtl', 'Fixture.v'), 'module fixture; endmodule\n');
    fs.writeFileSync(path.join(caseRoot, 'catalog', 'modules', 'fixture.json'),
        JSON.stringify(validModule));
    fs.writeFileSync(path.join(caseRoot, 'catalog', 'protocols.json'), JSON.stringify(validProtocols));
    assert.throws(() => loadCatalog(caseRoot), /case.*match/i);
} finally {
    fs.rmSync(caseRoot, { recursive: true, force: true });
}

assert.strictEqual(parseU32('0xFFFFFFFF'), 0xffffffffn);
assert.strictEqual(parseU32('4294967295'), 0xffffffffn);
assert.strictEqual(parseByteSize('32KiB'), 32768n);
assert.strictEqual(parseByteSize('16MiB'), 16777216n);
assert.strictEqual(parseByteSize(4096), 4096n);
assert.strictEqual(formatHex32(0x10000000n), '0x10000000');
assert.strictEqual(rangeEnd(0x10000000n, 4096n), 0x10000fffn);
assert.strictEqual(alignUp(0x10000001n, 4096n), 0x10001000n);

assert.throws(() => parseU32('0x100000000'), /32-bit unsigned/);
assert.throws(() => parseU32(-1), /32-bit unsigned/);
assert.throws(() => parseU32(1.5), /32-bit unsigned/);
assert.throws(() => parseU32(Number.MAX_SAFE_INTEGER + 1), /32-bit unsigned/);
assert.throws(() => parseByteSize(0), /positive byte size/);
assert.throws(() => parseByteSize(-1), /positive byte size/);
assert.throws(() => parseByteSize(1.5), /positive byte size/);
assert.throws(() => parseByteSize('1KB'), /KiB or MiB/);
for (const invalidByteSize of [
    1n,
    true,
    null,
    {},
    { toString: () => '32KiB' },
]) {
    assert.throws(() => parseByteSize(invalidByteSize), /number or string/);
}
assert.throws(() => formatHex32(-1n), /32-bit unsigned/);
assert.throws(() => rangeEnd(0xfffff000n, 8192n), /overflows/);
assert.throws(() => rangeEnd(0n, 0n), /positive size/);
assert.throws(() => alignUp(0n, 0n), /power of two/);
assert.throws(() => alignUp(0n, 3n), /power of two/);
assert.throws(() => alignUp(0xffffffffn, 2n), /overflows/);

console.log('MERC32 SoC configuration tests passed.');
