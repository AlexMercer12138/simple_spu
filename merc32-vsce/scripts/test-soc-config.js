const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    parseU32, parseByteSize, formatHex32, rangeEnd, alignUp,
    loadCatalog, parseSocConfig, validateSocConfig, assignMissingAddresses,
    generateSocSchema, planSoc,
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
assert.deepStrictEqual(catalog.protocols.get('drp').ports.map((port) => port.name), [
    'drp_addr', 'drp_en', 'drp_we', 'drp_rdy', 'drp_in', 'drp_out',
]);
assert.deepStrictEqual(catalog.modules.get('apb_qspi').parameters.CS_COUNT, {
    type: 'integer', minimum: 1, maximum: 16, default: 4,
});
assert.strictEqual(Object.isFrozen(catalog.modules), true);
assert.strictEqual(Object.isFrozen(catalog.modules.get('apb_uart')), true);
assert.strictEqual(typeof catalog.modules.set, 'undefined');
catalog.modules.forEach((module, type, callbackMap) => {
    assert.strictEqual(callbackMap, catalog.modules);
    assert.strictEqual(typeof callbackMap.clear, 'undefined');
    assert.strictEqual(typeof callbackMap.set, 'undefined');
    assert.strictEqual(catalog.modules.get(type), module);
});
assert.strictEqual(catalog.modules.size, 8);

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

const protocolsCaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-protocols-case-'));
try {
    fs.cpSync(catalogAssetRoot, protocolsCaseRoot, { recursive: true });
    fs.renameSync(
        path.join(protocolsCaseRoot, 'catalog', 'protocols.json'),
        path.join(protocolsCaseRoot, 'catalog', 'Protocols.json'),
    );
    assert.throws(() => loadCatalog(protocolsCaseRoot), /case.*match/i);
} finally {
    fs.rmSync(protocolsCaseRoot, { recursive: true, force: true });
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

const fixtureDirectory = path.join(__dirname, 'fixtures', 'soc');
const minimalText = fs.readFileSync(path.join(fixtureDirectory, 'minimal.merc32.json'), 'utf8');
const multiText = fs.readFileSync(path.join(fixtureDirectory, 'multi-peripheral.merc32.json'), 'utf8');
const minimal = JSON.parse(minimalText);
const multi = JSON.parse(multiText);

function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

function diagnosticsFor(config) {
    return validateSocConfig(config, catalog);
}

function assertDiagnostic(diagnostics, code, expectedPath, severity = 'error') {
    const diagnostic = diagnostics.find((item) => item.code === code
        && JSON.stringify(item.path) === JSON.stringify(expectedPath));
    assert.ok(diagnostic, `missing ${severity} ${code} at ${JSON.stringify(expectedPath)}:\n${JSON.stringify(diagnostics, null, 2)}`);
    assert.strictEqual(diagnostic.severity, severity);
    return diagnostic;
}

function withoutWarnings(diagnostics) {
    return diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
}

// Removing any generated schema constraint, changing catalog-derived choices, or
// producing nondeterministic key order must break this byte comparison.
const generatedSchemaText = `${JSON.stringify(generateSocSchema(catalog), null, 2)}\n`;
const committedSchemaText = fs.readFileSync(
    path.resolve(__dirname, '..', 'resources', 'schema', 'merc32.schema.json'), 'utf8');
assert.strictEqual(generatedSchemaText, committedSchemaText);
assert.deepStrictEqual(generateSocSchema(catalog), generateSocSchema(catalog));

function assertClosedObjects(value) {
    if (!value || typeof value !== 'object') {
        return;
    }
    if (!Array.isArray(value) && value.type === 'object') {
        assert.strictEqual(value.additionalProperties, false,
            `object schema is not closed: ${JSON.stringify(value)}`);
    }
    for (const child of Array.isArray(value) ? value : Object.values(value)) {
        assertClosedObjects(child);
    }
}
assertClosedObjects(generateSocSchema(catalog));

const parsedMinimal = parseSocConfig(minimalText, 'minimal.merc32.json', catalog);
assert.ok(parsedMinimal.config);
assert.deepStrictEqual(withoutWarnings(parsedMinimal.diagnostics), []);
const minimalNameOffset = minimalText.indexOf('"minimal_soc"');
assert.deepStrictEqual(parsedMinimal.sourceMap.rangeFor(['project', 'name']), {
    offset: minimalNameOffset,
    length: '"minimal_soc"'.length,
});
assert.deepStrictEqual(parsedMinimal.sourceMap.rangeFor(['peripherals']), {
    offset: minimalText.indexOf('[]'), length: 2,
});
assert.strictEqual(parsedMinimal.sourceMap.rangeFor(['missing']), undefined);

const parsedMulti = parseSocConfig(multiText, 'multi-peripheral.merc32.json', catalog);
assert.ok(parsedMulti.config);
assert.deepStrictEqual(withoutWarnings(parsedMulti.diagnostics), []);
const uart1BaseOffset = multiText.indexOf('"0x10001000"');
assert.deepStrictEqual(parsedMulti.sourceMap.rangeFor(['peripherals', 1, 'baseAddress']), {
    offset: uart1BaseOffset,
    length: '"0x10001000"'.length,
});

const commentText = minimalText.replace('  "cpu"', '  // standard JSON only\n  "cpu"');
const commentResult = parseSocConfig(commentText, 'comment.merc32.json', catalog);
assert.strictEqual(commentResult.config, undefined);
const commentDiagnostic = assertDiagnostic(commentResult.diagnostics, 'SOC_JSON_SYNTAX', []);
assert.deepStrictEqual(commentResult.sourceMap.rangeFor(commentDiagnostic.path), {
    offset: 0,
    length: commentText.lastIndexOf('}') + 1,
});

const trailingCommaText = minimalText.replace('    "debug": false', '    "debug": false,');
const trailingCommaResult = parseSocConfig(trailingCommaText, 'trailing.merc32.json', catalog);
assert.strictEqual(trailingCommaResult.config, undefined);
assertDiagnostic(trailingCommaResult.diagnostics, 'SOC_JSON_SYNTAX', ['cpu']);

const duplicateProjectText = minimalText.replace(
    '    "name": "minimal_soc",',
    '    "name": "shadow",\n    "name": "minimal_soc",',
);
const duplicateProjectResult = parseSocConfig(
    duplicateProjectText, 'duplicate-project.merc32.json', catalog);
assert.strictEqual(duplicateProjectResult.config, undefined);
const duplicateProjectDiagnostic = assertDiagnostic(
    duplicateProjectResult.diagnostics, 'SOC_JSON_DUPLICATE_KEY', ['project', 'name']);
const firstProjectNameKey = duplicateProjectText.indexOf('"name"');
const secondProjectNameKey = duplicateProjectText.indexOf('"name"', firstProjectNameKey + 1);
assert.deepStrictEqual(duplicateProjectResult.sourceMap.rangeFor(duplicateProjectDiagnostic.path), {
    offset: secondProjectNameKey,
    length: '"name"'.length,
});

const duplicateArrayText = multiText.replace(
    '      "name": "uart0",',
    '      "name": "shadow",\n      "name": "uart0",',
);
const duplicateArrayResult = parseSocConfig(
    duplicateArrayText, 'duplicate-array.merc32.json', catalog);
assert.strictEqual(duplicateArrayResult.config, undefined);
const duplicateArrayDiagnostic = assertDiagnostic(
    duplicateArrayResult.diagnostics, 'SOC_JSON_DUPLICATE_KEY', ['peripherals', 0, 'name']);
const peripheralsOffset = duplicateArrayText.indexOf('"peripherals"');
const firstPeripheralNameKey = duplicateArrayText.indexOf('"name"', peripheralsOffset);
const secondPeripheralNameKey = duplicateArrayText.indexOf('"name"', firstPeripheralNameKey + 1);
assert.deepStrictEqual(duplicateArrayResult.sourceMap.rangeFor(duplicateArrayDiagnostic.path), {
    offset: secondPeripheralNameKey,
    length: '"name"'.length,
});

const extraFieldText = minimalText.replace('"debug": false', '"debug": false, "extra": true');
const extraFieldResult = parseSocConfig(extraFieldText, 'extra.merc32.json', catalog);
assert.strictEqual(extraFieldResult.config, undefined);
const extraDiagnostic = assertDiagnostic(extraFieldResult.diagnostics, 'SOC_SCHEMA', ['cpu', 'extra']);
assert.deepStrictEqual(extraFieldResult.sourceMap.rangeFor(extraDiagnostic.path), {
    offset: extraFieldText.indexOf('true', extraFieldText.indexOf('"extra"')),
    length: 4,
});

const typedPathText = multiText.replace('"FIFO_DEPTH": 8', '"FIFO_DEPTH": "eight"');
const typedPathResult = parseSocConfig(typedPathText, 'typed-path.merc32.json', catalog);
assert.strictEqual(typedPathResult.config, undefined);
assertDiagnostic(typedPathResult.diagnostics, 'SOC_SCHEMA',
    ['peripherals', 0, 'parameters', 'FIFO_DEPTH']);

const badName = clone(multi);
badName.peripherals[0].name = 'bad-name';
assertDiagnostic(diagnosticsFor(badName), 'SOC_IDENTIFIER', ['peripherals', 0, 'name']);

const badProjectName = clone(minimal);
badProjectName.project.name = '1soc';
assertDiagnostic(diagnosticsFor(badProjectName), 'SOC_IDENTIFIER', ['project', 'name']);

for (const outputDir of [
    '', '.', '..', '../outside', 'generated/../outside',
    'C:escape', 'C:\\escape', '\\\\server\\share\\escape', '\\rooted', '/rooted',
    path.resolve('outside'),
]) {
    const badOutput = clone(minimal);
    badOutput.project.outputDir = outputDir;
    assertDiagnostic(diagnosticsFor(badOutput), 'SOC_PROJECT_OUTPUT', ['project', 'outputDir']);
}
const normalRelativeOutput = clone(minimal);
normalRelativeOutput.project.outputDir = 'build/generated/demo_soc';
assert.strictEqual(diagnosticsFor(normalRelativeOutput)
    .some((diagnostic) => diagnostic.code === 'SOC_PROJECT_OUTPUT'), false);

const duplicateName = clone(multi);
duplicateName.externalInterfaces[0].name = 'uart0';
assertDiagnostic(diagnosticsFor(duplicateName), 'SOC_DUPLICATE_NAME',
    ['externalInterfaces', 0, 'name']);

const macroCollision = clone(multi);
macroCollision.peripherals[1].name = 'UART0';
assertDiagnostic(diagnosticsFor(macroCollision), 'SOC_MACRO_COLLISION',
    ['peripherals', 1, 'name']);

for (const size of [2, 6, '129MiB', 'not-a-size']) {
    const badMemory = clone(minimal);
    badMemory.memory.ilb.size = size;
    assertDiagnostic(diagnosticsFor(badMemory), 'SOC_MEMORY_SIZE', ['memory', 'ilb', 'size']);
}
const maximumMemory = clone(minimal);
maximumMemory.memory.ilb.size = '128MiB';
assert.strictEqual(diagnosticsFor(maximumMemory)
    .some((item) => item.code === 'SOC_MEMORY_SIZE'), false);

const unknownModule = clone(multi);
unknownModule.peripherals[0].type = 'missing_module';
assertDiagnostic(diagnosticsFor(unknownModule), 'SOC_MODULE_TYPE', ['peripherals', 0, 'type']);

const duplicateIntc = clone(multi);
duplicateIntc.peripherals.push({
    type: 'apb_intc', name: 'intc1', baseAddress: '0x10005000',
});
assertDiagnostic(diagnosticsFor(duplicateIntc), 'SOC_MODULE_MULTIPLE',
    ['peripherals', 4, 'type']);
assertDiagnostic(diagnosticsFor(duplicateIntc), 'SOC_INTERRUPT_CONTROLLER_COUNT',
    ['peripherals', 4, 'type']);

for (const parameters of [
    { FIFO_DEPTH: 7 },
    { FIFO_DEPTH: 256 },
    { SYS_CLK_FREQ: 0 },
    { UNKNOWN: 1 },
]) {
    const badParameter = clone(multi);
    badParameter.peripherals[0].parameters = parameters;
    const parameterName = Object.keys(parameters)[0];
    assertDiagnostic(diagnosticsFor(badParameter), 'SOC_PARAMETER',
        ['peripherals', 0, 'parameters', parameterName]);
}
const dynamicPortWidth = clone(multi);
dynamicPortWidth.peripherals.push({
    type: 'apb_qspi', name: 'qspi0', baseAddress: '0x10005000',
    parameters: { CS_COUNT: 16 },
});
assert.strictEqual(diagnosticsFor(dynamicPortWidth)
    .some((item) => item.code === 'SOC_PARAMETER' || item.code === 'SOC_PORT_WIDTH'), false);

const externalParameter = clone(multi);
externalParameter.externalInterfaces[0].parameters = { APB_ADDR_WIDTH: 12 };
assertDiagnostic(diagnosticsFor(externalParameter), 'SOC_PARAMETER',
    ['externalInterfaces', 0, 'parameters', 'APB_ADDR_WIDTH']);

const overlap = clone(multi);
overlap.peripherals[1].baseAddress = '0x10000800';
assertDiagnostic(diagnosticsFor(overlap), 'SOC_ADDRESS_OVERLAP',
    ['peripherals', 1, 'baseAddress']);

const badPeripheralAlignment = clone(multi);
badPeripheralAlignment.peripherals[0].baseAddress = '0x10000004';
assertDiagnostic(diagnosticsFor(badPeripheralAlignment), 'SOC_ADDRESS_ALIGNMENT',
    ['peripherals', 0, 'baseAddress']);

const badHexAddress = clone(multi);
badHexAddress.peripherals[0].baseAddress = '4096';
assertDiagnostic(diagnosticsFor(badHexAddress), 'SOC_ADDRESS',
    ['peripherals', 0, 'baseAddress']);

const outsidePlb = clone(multi);
outsidePlb.peripherals[0].baseAddress = '0x08000000';
assertDiagnostic(diagnosticsFor(outsidePlb), 'SOC_ADDRESS_PLB',
    ['peripherals', 0, 'baseAddress']);

const overflowing = clone(multi);
overflowing.externalInterfaces[1].baseAddress = '0xff000000';
overflowing.externalInterfaces[1].windowSize = '32MiB';
assertDiagnostic(diagnosticsFor(overflowing), 'SOC_ADDRESS_RANGE',
    ['externalInterfaces', 1, 'windowSize']);

const badWidth = clone(multi);
badWidth.externalInterfaces[0].addressWidth = 11;
assertDiagnostic(diagnosticsFor(badWidth), 'SOC_ENDPOINT_WIDTH',
    ['externalInterfaces', 0, 'addressWidth']);

const tooWide = clone(multi);
tooWide.externalInterfaces[0].addressWidth = 33;
assertDiagnostic(diagnosticsFor(tooWide), 'SOC_ENDPOINT_WIDTH',
    ['externalInterfaces', 0, 'addressWidth']);

const narrowMisalignment = clone(multi);
narrowMisalignment.externalInterfaces[0].baseAddress = '0x10005000';
narrowMisalignment.externalInterfaces[0].addressWidth = 13;
assertDiagnostic(diagnosticsFor(narrowMisalignment), 'SOC_ADDRESS_ALIGNMENT',
    ['externalInterfaces', 0, 'baseAddress']);

const badWindow = clone(multi);
badWindow.externalInterfaces[0].windowSize = '8KiB';
assertDiagnostic(diagnosticsFor(badWindow), 'SOC_ENDPOINT_WIDTH',
    ['externalInterfaces', 0, 'addressWidth']);

const holeConfig = clone(minimal);
holeConfig.peripherals.push(
    { type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000' },
    { type: 'apb_gpio', name: 'gpio0', baseAddress: '0x10002000' },
);
assertDiagnostic(diagnosticsFor(holeConfig), 'SOC_ADDRESS_HOLE',
    ['peripherals', 1, 'baseAddress'], 'warning');

const badIrq = clone(multi);
badIrq.interrupt.sources[0].source = 'uart0.missing';
assertDiagnostic(diagnosticsFor(badIrq), 'SOC_IRQ_SOURCE',
    ['interrupt', 'sources', 0, 'source']);

for (const source of ['uart0', 'uart0.interrupt.extra', 'missing.interrupt', 'external.bad-name']) {
    const invalidSource = clone(multi);
    invalidSource.interrupt.sources[0].source = source;
    assertDiagnostic(diagnosticsFor(invalidSource), 'SOC_IRQ_SOURCE',
        ['interrupt', 'sources', 0, 'source']);
}

const duplicateIrqSource = clone(multi);
duplicateIrqSource.interrupt.sources[1].source = 'uart0.interrupt';
assertDiagnostic(diagnosticsFor(duplicateIrqSource), 'SOC_IRQ_SOURCE_DUPLICATE',
    ['interrupt', 'sources', 1, 'source']);

const duplicateId = clone(multi);
duplicateId.interrupt.sources[1].id = 0;
assertDiagnostic(diagnosticsFor(duplicateId), 'SOC_IRQ_ID_DUPLICATE',
    ['interrupt', 'sources', 1, 'id']);

for (const id of [-1, 32, 1.5]) {
    const badId = clone(multi);
    badId.interrupt.sources[0].id = id;
    assertDiagnostic(diagnosticsFor(badId), 'SOC_IRQ_ID', ['interrupt', 'sources', 0, 'id']);
}

const badTrigger = clone(multi);
badTrigger.interrupt.sources[0].trigger = 'edge';
assertDiagnostic(diagnosticsFor(badTrigger), 'SOC_IRQ_TRIGGER',
    ['interrupt', 'sources', 0, 'trigger']);

const missingController = clone(multi);
missingController.interrupt.controller = 'missing';
assertDiagnostic(diagnosticsFor(missingController), 'SOC_IRQ_CONTROLLER',
    ['interrupt', 'controller']);

const wrongController = clone(multi);
wrongController.interrupt.controller = 'uart0';
assertDiagnostic(diagnosticsFor(wrongController), 'SOC_IRQ_CONTROLLER',
    ['interrupt', 'controller']);

const emptyController = clone(multi);
emptyController.interrupt.sources = [];
assertDiagnostic(diagnosticsFor(emptyController), 'SOC_IRQ_COUNT', ['interrupt', 'sources']);

const tooManySources = clone(multi);
tooManySources.interrupt.sources = Array.from({ length: 33 }, (_, index) => ({
    source: `external.irq_${index}`, id: index, trigger: 'high',
}));
assertDiagnostic(diagnosticsFor(tooManySources), 'SOC_IRQ_COUNT', ['interrupt', 'sources']);

const intcFeedback = clone(multi);
intcFeedback.interrupt.sources[0].source = 'intc0.interrupt';
assertDiagnostic(diagnosticsFor(intcFeedback), 'SOC_IRQ_SOURCE',
    ['interrupt', 'sources', 0, 'source']);

const noneWithIntc = clone(multi);
noneWithIntc.interrupt = { mode: 'none' };
assertDiagnostic(diagnosticsFor(noneWithIntc), 'SOC_IRQ_UNCONNECTED',
    ['peripherals', 0, 'name'], 'warning');

const direct = clone(multi);
direct.interrupt = { mode: 'direct', source: 'uart0.interrupt' };
assert.strictEqual(withoutWarnings(diagnosticsFor(direct)).length, 0);
assertDiagnostic(diagnosticsFor(direct), 'SOC_IRQ_UNCONNECTED',
    ['peripherals', 1, 'name'], 'warning');

const unknownMode = clone(minimal);
unknownMode.interrupt = { mode: 'invalid' };
assertDiagnostic(diagnosticsFor(unknownMode), 'SOC_INTERRUPT_MODE', ['interrupt', 'mode']);

const externalPortCollision = clone(minimal);
externalPortCollision.externalInterfaces.push({
    type: 'local_bus', name: 'external', baseAddress: '0x10000000',
    windowSize: '4KiB', addressWidth: 32,
});
externalPortCollision.interrupt = { mode: 'direct', source: 'external.lb_addr' };
assertDiagnostic(diagnosticsFor(externalPortCollision), 'SOC_PORT_COLLISION',
    ['interrupt', 'source']);

const noAddresses = clone(multi);
for (const endpoint of [...noAddresses.peripherals, ...noAddresses.externalInterfaces]) {
    delete endpoint.baseAddress;
}
const noAddressesBefore = JSON.stringify(noAddresses);
const assigned = assignMissingAddresses(noAddresses, catalog);
assert.strictEqual(JSON.stringify(noAddresses), noAddressesBefore, 'assignment mutated its input');
assert.notStrictEqual(assigned.config, noAddresses);
assert.deepStrictEqual(assigned.assignments, [
    { path: ['peripherals', 0, 'baseAddress'], address: '0x10000000' },
    { path: ['peripherals', 1, 'baseAddress'], address: '0x10001000' },
    { path: ['peripherals', 2, 'baseAddress'], address: '0x10002000' },
    { path: ['peripherals', 3, 'baseAddress'], address: '0x10003000' },
    { path: ['externalInterfaces', 0, 'baseAddress'], address: '0x10004000' },
    { path: ['externalInterfaces', 1, 'baseAddress'], address: '0x10005000' },
]);
assert.deepStrictEqual(assigned.assignments.map((item) => item.address), [
    assigned.config.peripherals[0].baseAddress,
    assigned.config.peripherals[1].baseAddress,
    assigned.config.peripherals[2].baseAddress,
    assigned.config.peripherals[3].baseAddress,
    assigned.config.externalInterfaces[0].baseAddress,
    assigned.config.externalInterfaces[1].baseAddress,
]);
assert.deepStrictEqual(withoutWarnings(assigned.diagnostics), []);

const preserveExplicit = clone(minimal);
preserveExplicit.peripherals = [
    { type: 'apb_uart', name: 'uart0' },
    { type: 'apb_gpio', name: 'gpio0', baseAddress: '0x10000000' },
    { type: 'apb_timer', name: 'timer0' },
];
const preserveResult = assignMissingAddresses(preserveExplicit, catalog);
assert.deepStrictEqual(preserveResult.assignments, [
    { path: ['peripherals', 0, 'baseAddress'], address: '0x10001000' },
    { path: ['peripherals', 2, 'baseAddress'], address: '0x10002000' },
]);
assert.strictEqual(preserveResult.config.peripherals[1].baseAddress, '0x10000000');

const narrowAssignment = clone(minimal);
narrowAssignment.externalInterfaces = [{
    type: 'apb', name: 'apb0', windowSize: '2KiB', addressWidth: 13,
}];
assert.deepStrictEqual(assignMissingAddresses(narrowAssignment, catalog).assignments, [{
    path: ['externalInterfaces', 0, 'baseAddress'], address: '0x10000000',
}]);

const unsafeAssignment = clone(multi);
delete unsafeAssignment.peripherals[2].baseAddress;
unsafeAssignment.peripherals[1].baseAddress = '0x10000000';
const unsafeBefore = JSON.stringify(unsafeAssignment);
const unsafeResult = assignMissingAddresses(unsafeAssignment, catalog);
assert.deepStrictEqual(unsafeResult.assignments, []);
assert.strictEqual(JSON.stringify(unsafeResult.config), unsafeBefore);
assertDiagnostic(unsafeResult.diagnostics, 'SOC_ADDRESS_OVERLAP',
    ['peripherals', 1, 'baseAddress']);

const multiFixtureFile = path.join(fixtureDirectory, 'multi-peripheral.merc32.json');
const plannedMultiResult = planSoc(
    parseSocConfig(multiText, multiFixtureFile, catalog).config,
    catalog,
);
assert.ok(plannedMultiResult.plan);
assert.deepStrictEqual(withoutWarnings(plannedMultiResult.diagnostics), []);
const plan = plannedMultiResult.plan;
assert.strictEqual(plan.sourceFile, multiFixtureFile);
assert.strictEqual(plan.projectName, 'demo_soc');
assert.strictEqual(plan.outputDir, path.join(fixtureDirectory, 'generated', 'demo_soc'));
assert.strictEqual(plan.topModule, 'demo_soc');
assert.deepStrictEqual(plan.cpu, { debug: true, jtagIdCode: 0x4d320001n });
assert.deepStrictEqual(plan.memory.ilb, {
    type: 'internal_ram',
    sizeBytes: 32768n,
    wordAddressWidth: 13,
    initFile: {
        source: path.join(fixtureDirectory, 'firmware.mem'),
        outputName: 'firmware.mem',
    },
});
assert.deepStrictEqual(plan.memory.dlb, {
    type: 'external_local_bus', sizeBytes: 65536n, wordAddressWidth: 14,
});
assert.deepStrictEqual(plan.endpoints.map((item) => item.name),
    ['uart0', 'uart1', 'gpio0', 'intc0', 'apb_ext0', 'axi0']);
assert.strictEqual(plan.endpoints[0].baseAddress, 0x10000000n);
assert.strictEqual(plan.externalInterfaces.find((item) => item.name === 'apb_ext0').addressWidth, 12);
assert.deepStrictEqual(plan.externalInterfaces.find((item) => item.name === 'apb_ext0').parameters,
    { APB_ADDR_WIDTH: 12 });
assert.strictEqual(plan.topPorts.find((item) => item.name === 'apb_ext0_m_apb_paddr').width, 12);
assert.strictEqual(plan.topPorts.find((item) => item.name === 'external_wake').direction, 'input');
assert.deepStrictEqual(plan.interrupt.sources.map((item) => [item.id, item.source]), [
    [0, 'uart0.interrupt'], [1, 'uart1.interrupt'], [2, 'gpio0.interrupt'],
    [3, 'external.wake'],
]);
assert.deepStrictEqual(plan.interrupt.sources.map((item) => [item.id, item.trigger]), [
    [0, 'high'], [1, 'low'], [2, 'rising'], [3, 'falling'],
]);
assert.strictEqual(plan.interrupt.irqCount, 4);
assert.strictEqual(plan.interrupt.irqMode & 0xffn, 0xe4n);
assert.deepStrictEqual(plan.peripherals.find((item) => item.name === 'intc0').parameters,
    { IRQ_COUNT: 4, IRQ_MODE: 0xe4n });
assert.ok(plan.rtlFiles.includes('rtl/apb_intc/apb_intc.v'));
assert.ok(plan.rtlFiles.includes('rtl/misc/spram.v'));
assert.ok(plan.rtlFiles.includes('rtl/debug/jtag_debug.v'));
assert.deepStrictEqual(plan.rtlFiles, [...plan.rtlFiles].sort());

function assertDeeplyFrozen(value) {
    if (!value || typeof value !== 'object') {
        return;
    }
    assert.strictEqual(Object.isFrozen(value), true);
    for (const child of Object.values(value)) {
        assertDeeplyFrozen(child);
    }
}
assertDeeplyFrozen(plan);

const plannedMinimal = planSoc(minimal, catalog).plan;
assert.ok(plannedMinimal);
assert.deepStrictEqual(plannedMinimal.cpu, { debug: false, jtagIdCode: 0x4d320001n });
assert.strictEqual(plannedMinimal.topPorts.find((item) => item.name === 'ilb_addr').width, 13);
assert.strictEqual(plannedMinimal.topPorts.find((item) => item.name === 'dlb_addr').width, 14);
assert.strictEqual(plannedMinimal.topPorts.some((item) => item.name === 'tck'), false);
assert.strictEqual(plannedMinimal.rtlFiles.includes('rtl/misc/spram.v'), false);
assert.strictEqual(plannedMinimal.rtlFiles.includes('rtl/debug/jtag_debug.v'), false);

const physicalPorts = clone(minimal);
physicalPorts.peripherals = [
    {
        type: 'apb_qspi', name: 'qspi0', baseAddress: '0x10000000',
        parameters: { CS_COUNT: 16 },
    },
    { type: 'apb_sdio', name: 'sdio0', baseAddress: '0x10001000' },
];
const physicalPlan = planSoc(physicalPorts, catalog).plan;
assert.ok(physicalPlan);
assert.deepStrictEqual(physicalPlan.topPorts.find((item) => item.name === 'qspi0_qspi_cs_n'),
    { name: 'qspi0_qspi_cs_n', direction: 'output', width: 16 });
assert.deepStrictEqual(physicalPlan.topPorts.find((item) => item.name === 'sdio0_sd_dat_i'),
    { name: 'sdio0_sd_dat_i', direction: 'input', width: 8 });
assert.deepStrictEqual(physicalPlan.topPorts.find((item) => item.name === 'sdio0_dma_tx_dout'),
    { name: 'sdio0_dma_tx_dout', direction: 'input', width: 32 });
assert.deepStrictEqual(physicalPlan.topPorts.find((item) => item.name === 'sdio0_dma_rx_din'),
    { name: 'sdio0_dma_rx_din', direction: 'output', width: 32 });

const invalidPlanResult = planSoc(overlap, catalog);
assert.strictEqual(invalidPlanResult.plan, undefined);
assertDiagnostic(invalidPlanResult.diagnostics, 'SOC_ADDRESS_OVERLAP',
    ['peripherals', 1, 'baseAddress']);

const parsedForAssignment = parseSocConfig(multiText, multiFixtureFile, catalog).config;
for (const endpoint of [...parsedForAssignment.peripherals, ...parsedForAssignment.externalInterfaces]) {
    delete endpoint.baseAddress;
}
const assignedWithSource = assignMissingAddresses(parsedForAssignment, catalog);
const assignedPlan = planSoc(assignedWithSource.config, catalog).plan;
assert.ok(assignedPlan);
assert.strictEqual(assignedPlan.sourceFile, multiFixtureFile);
assert.strictEqual(assignedPlan.memory.ilb.initFile.source,
    path.join(fixtureDirectory, 'firmware.mem'));

console.log('MERC32 SoC configuration tests passed.');
