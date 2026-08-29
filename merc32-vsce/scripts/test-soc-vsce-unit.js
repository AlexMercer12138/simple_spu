const assert = require('assert');
const path = require('path');

const pkg = require('../package.json');

const selector = pkg.contributes.customEditors[0];
assert.strictEqual(selector.viewType, 'merc32.socConfigEditor');
assert.strictEqual(selector.priority, 'default');
assert.deepStrictEqual(selector.selector, [{ filenamePattern: '*.merc32.json' }]);
assert.deepStrictEqual(pkg.contributes.jsonValidation, [{
    fileMatch: '*.merc32.json',
    url: './resources/schema/merc32.schema.json',
}]);
assert.ok(!JSON.stringify(pkg.contributes.customEditors).includes('*.json"'));

assert.ok(pkg.activationEvents.includes('onCustomEditor:merc32.socConfigEditor'));
for (const viewId of [
    'merc32-toolchain.configurations',
    'merc32-toolchain.generate',
    'merc32-toolchain.artifacts',
]) {
    assert.ok(pkg.activationEvents.includes(`onView:${viewId}`));
}
assert.deepStrictEqual(pkg.contributes.views['merc32-toolchain'], [
    { id: 'merc32-toolchain.configurations', name: 'SoC Configurations' },
    { id: 'merc32-toolchain.generate', name: 'Generate' },
    { id: 'merc32-toolchain.build', name: 'Toolchain' },
    { id: 'merc32-toolchain.artifacts', name: 'Artifacts' },
]);

const socCommands = [
    'merc32.soc.createConfig',
    'merc32.soc.openConfig',
    'merc32.soc.autoAssign',
    'merc32.soc.validate',
    'merc32.soc.generate',
    'merc32.soc.forceGenerate',
    'merc32.soc.adoptOutput',
    'merc32.soc.openArtifact',
    'merc32.soc.reopenAsText',
    'merc32.soc.refresh',
];
const registeredCommands = new Set(pkg.contributes.commands.map((item) => item.command));
for (const command of socCommands) {
    assert.ok(registeredCommands.has(command), `missing command contribution: ${command}`);
}

const menus = pkg.contributes.menus;
assert.deepStrictEqual(menus['view/title'].filter((item) => item.command === 'merc32.soc.createConfig'), [{
    command: 'merc32.soc.createConfig',
    when: 'view == merc32-toolchain.configurations',
    group: 'navigation@1',
}]);
assert.deepStrictEqual(menus['view/title'].filter((item) => item.command === 'merc32.soc.refresh'), [
    {
        command: 'merc32.soc.refresh',
        when: 'view == merc32-toolchain.configurations',
        group: 'navigation@2',
    },
    {
        command: 'merc32.soc.refresh',
        when: 'view == merc32-toolchain.artifacts',
        group: 'navigation@1',
    },
]);
for (const command of [
    'merc32.soc.validate',
    'merc32.soc.autoAssign',
    'merc32.soc.generate',
    'merc32.soc.forceGenerate',
]) {
    assert.ok(menus['customEditor/title'].some((item) =>
        item.command === command && item.when === 'activeCustomEditorId == merc32.socConfigEditor'),
    `missing custom-editor title action: ${command}`);
}

const { SOC_COMMANDS, SOC_CONFIG_SUFFIX, SOC_EDITOR_VIEW_TYPE, SOC_VIEW_IDS } = require('../out/constants');
const { parseWebviewMessage } = require('../out/socWebviewProtocol');
const { loadCatalog, parseSocConfig } = require('../out/soc');
const { buildJsonReplacement } = require('../out/socJsonEdits');
const { diagnosticRange } = require('../out/socDiagnostics');

assert.strictEqual(SOC_CONFIG_SUFFIX, '.merc32.json');
assert.strictEqual(SOC_EDITOR_VIEW_TYPE, 'merc32.socConfigEditor');
assert.deepStrictEqual(SOC_VIEW_IDS, {
    configurations: 'merc32-toolchain.configurations',
    generate: 'merc32-toolchain.generate',
    build: 'merc32-toolchain.build',
    artifacts: 'merc32-toolchain.artifacts',
});
assert.deepStrictEqual(SOC_COMMANDS, {
    createConfig: 'merc32.soc.createConfig',
    openConfig: 'merc32.soc.openConfig',
    autoAssign: 'merc32.soc.autoAssign',
    validate: 'merc32.soc.validate',
    generate: 'merc32.soc.generate',
    forceGenerate: 'merc32.soc.forceGenerate',
    adoptOutput: 'merc32.soc.adoptOutput',
    openArtifact: 'merc32.soc.openArtifact',
    reopenAsText: 'merc32.soc.reopenAsText',
    refresh: 'merc32.soc.refresh',
});

assert.deepStrictEqual(parseWebviewMessage({
    type: 'setValue', path: ['cpu', 'debug'], value: true,
}), { type: 'setValue', path: ['cpu', 'debug'], value: true });
assert.deepStrictEqual(parseWebviewMessage({
    type: 'setValue', path: ['peripherals', 0, 'name'], value: 'uart0',
}), { type: 'setValue', path: ['peripherals', 0, 'name'], value: 'uart0' });

const inheritedType = Object.create({ type: 'ready' });
const inheritedPath = Object.create({ path: ['cpu', 'debug'] });
inheritedPath.type = 'select';
const invalidMessages = [
    { type: 'unknown' },
    inheritedType,
    inheritedPath,
    { type: 'select', path: 'cpu.debug' },
    { type: 'select', path: ['cpu', {}] },
    { type: 'select', path: ['__proto__'] },
    { type: 'select', path: ['prototype'] },
    { type: 'select', path: ['constructor'] },
    { type: 'select', path: ['C:\\workspace\\outside.json'] },
    { type: 'select', path: ['C:temp'] },
    { type: 'select', path: ['C:'] },
    { type: 'setValue', path: ['cpu', 'c:Temp'], value: true },
    { type: 'setValue', path: ['cpu', 'debug'], value: true, filePath: 'C:\\workspace\\outside.json' },
    { type: 'ready', extra: true },
    { type: 'removeInstance', collection: 'peripherals', index: 0.5 },
    { type: 'addInstance', collection: 'peripherals', itemType: '../outside' },
    { type: 'setValue', path: ['cpu', 'debug'], value: new Date() },
    { type: 'setValue', path: ['cpu', 'debug'], value: Object.create(null) },
    { type: 'setValue', path: ['cpu', 'debug'], value: [true, Object.create({ injected: true })] },
];
for (const value of invalidMessages) {
    assert.strictEqual(parseWebviewMessage(value), undefined, `accepted invalid message: ${JSON.stringify(value)}`);
}

function applyReplacement(source, replacement) {
    return source.slice(0, replacement.offset)
        + replacement.text
        + source.slice(replacement.offset + replacement.length);
}

const standardJsonLf = `{
  "schemaVersion": 1,
  "project": {
    "name": "edit_soc",
    "outputDir": "generated/edit_soc"
  },
  "cpu": {
    "debug": false
  },
  "memory": {
    "ilb": {
      "type": "internal_ram",
      "size": "32KiB",
      "initFile": "firmware.mem"
    },
    "dlb": {
      "type": "external_local_bus",
      "size": "64KiB"
    }
  },
  "peripherals": [
    {
      "type": "apb_uart",
      "name": "uart0"
    }
  ],
  "externalInterfaces": [],
  "interrupt": {
    "mode": "none"
  }
}
`;
const standardJson = standardJsonLf.replace(/\n/g, '\r\n');

const exactEditCases = [
    {
        name: 'add baseAddress',
        updates: [{ path: ['peripherals', 0, 'baseAddress'], value: '0x10000000' }],
        expected: standardJson.replace(
            '      "name": "uart0"\r\n',
            '      "name": "uart0",\r\n      "baseAddress": "0x10000000"\r\n',
        ),
    },
    {
        name: 'change cpu.debug',
        updates: [{ path: ['cpu', 'debug'], value: true }],
        expected: standardJson.replace('    "debug": false', '    "debug": true'),
    },
    {
        name: 'delete initFile',
        updates: [{ path: ['memory', 'ilb', 'initFile'], value: undefined }],
        expected: standardJson.replace(',\r\n      "initFile": "firmware.mem"', ''),
    },
    {
        name: 'add an array item',
        updates: [{
            path: ['peripherals', 1],
            value: { type: 'apb_gpio', name: 'gpio0' },
        }],
        expected: standardJson.replace(
            '      "name": "uart0"\r\n    }\r\n',
            '      "name": "uart0"\r\n    },\r\n    {\r\n      "type": "apb_gpio",\r\n      "name": "gpio0"\r\n    }\r\n',
        ),
    },
    {
        name: 'remove an array item',
        updates: [{ path: ['peripherals', 0], value: undefined }],
        expected: standardJson.replace(
            '"peripherals": [\r\n    {\r\n      "type": "apb_uart",\r\n      "name": "uart0"\r\n    }\r\n  ]',
            '"peripherals": []',
        ),
    },
];

for (const testCase of exactEditCases) {
    const replacement = buildJsonReplacement(standardJson, testCase.updates);
    const result = applyReplacement(standardJson, replacement);
    assert.strictEqual(result, testCase.expected, testCase.name);
    assert.ok(result.endsWith('\r\n'), `${testCase.name} removed the final newline`);
    assert.ok(!/(^|[^\r])\n/.test(result), `${testCase.name} introduced an LF-only line ending`);
}

const threeAddressUpdates = [
    { path: ['peripherals', 0, 'baseAddress'], value: '0x10000000' },
    { path: ['peripherals', 1, 'baseAddress'], value: '0x10001000' },
    { path: ['peripherals', 2, 'baseAddress'], value: '0x10002000' },
];
const addressBatchSource = standardJsonLf.replace(
    '      "name": "uart0"\n    }',
    '      "name": "uart0"\n    },\n    {\n      "type": "apb_uart",\n      "name": "uart1"\n    },\n    {\n      "type": "apb_gpio",\n      "name": "gpio0"\n    }',
);
const addressReplacement = buildJsonReplacement(addressBatchSource, threeAddressUpdates);
const addressResult = applyReplacement(addressBatchSource, addressReplacement);
const addressObject = JSON.parse(addressResult);
assert.deepStrictEqual(addressObject.peripherals.map((item) => item.baseAddress), [
    '0x10000000', '0x10001000', '0x10002000',
]);
assert.ok(addressResult.includes('"outputDir": "generated/edit_soc"'));
assert.ok(!addressReplacement.text.includes('generated/edit_soc'), 'batch replacement touched unrelated text');
assert.ok(addressReplacement.offset > addressBatchSource.indexOf('"peripherals"'));
assert.ok(addressReplacement.offset + addressReplacement.length
    < addressBatchSource.indexOf('"externalInterfaces"'));

assert.throws(
    () => buildJsonReplacement('{"cpu":', [{ path: ['cpu', 'debug'], value: true }]),
    /invalid json/i,
);
for (const dangerousPath of [
    ['__proto__'], ['prototype'], ['constructor'], ['C:\\outside.json'], ['C:outside'], ['/outside'],
]) {
    assert.throws(
        () => buildJsonReplacement(standardJson, [{ path: dangerousPath, value: true }]),
        /invalid json path/i,
        `accepted dangerous edit path: ${JSON.stringify(dangerousPath)}`,
    );
}

const catalog = loadCatalog(path.join(__dirname, '..', 'resources'));
const overlapSource = standardJsonLf.replace(
    '      "name": "uart0"\n    }',
    '      "name": "uart0",\n      "baseAddress": "0x10000000"\n    },\n    {\n      "type": "apb_gpio",\n      "name": "gpio0",\n      "baseAddress": "0x10000000"\n    }',
);
const overlapParsed = parseSocConfig(overlapSource, 'overlap.merc32.json', catalog);
const overlapDiagnostic = overlapParsed.diagnostics.find((item) =>
    item.code === 'SOC_ADDRESS_OVERLAP' && item.path[1] === 1);
assert.ok(overlapDiagnostic, 'expected overlap diagnostic for the second endpoint');
const overlapRange = diagnosticRange(overlapSource, overlapParsed.sourceMap, overlapDiagnostic);
assert.strictEqual(overlapSource.slice(overlapRange.offset, overlapRange.offset + overlapRange.length),
    '"0x10000000"');
assert.strictEqual(overlapRange.offset, overlapSource.lastIndexOf('"0x10000000"'));

const unknownSource = standardJsonLf.replace(
    '    "debug": false',
    '    "debug": false,\n    "unexpected": true',
);
const unknownParsed = parseSocConfig(unknownSource, 'unknown.merc32.json', catalog);
const unknownDiagnostic = unknownParsed.diagnostics.find((item) =>
    item.code === 'SOC_SCHEMA' && item.path.at(-1) === 'unexpected');
assert.ok(unknownDiagnostic, 'expected unknown-property diagnostic');
const unknownRange = diagnosticRange(unknownSource, unknownParsed.sourceMap, unknownDiagnostic);
assert.strictEqual(unknownSource.slice(unknownRange.offset, unknownRange.offset + unknownRange.length), 'true');

const missingSource = standardJsonLf.replace('    "name": "edit_soc",\n', '');
const missingParsed = parseSocConfig(missingSource, 'missing.merc32.json', catalog);
const missingDiagnostic = missingParsed.diagnostics.find((item) =>
    item.code === 'SOC_SCHEMA' && item.path.at(-1) === 'name');
assert.ok(missingDiagnostic, 'expected missing-property diagnostic');
const missingRange = diagnosticRange(missingSource, missingParsed.sourceMap, missingDiagnostic);
const projectObject = missingSource.slice(missingRange.offset, missingRange.offset + missingRange.length);
assert.ok(projectObject.startsWith('{') && projectObject.endsWith('}'));
assert.ok(projectObject.includes('"outputDir": "generated/edit_soc"'));
assert.ok(missingRange.offset > 0 && missingRange.length < missingSource.length,
    'missing property fell back to the entire document');

console.log('MERC32 VSCode SoC unit contracts passed.');
