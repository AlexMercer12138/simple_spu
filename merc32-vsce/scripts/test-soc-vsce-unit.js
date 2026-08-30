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
const {
    MAX_WEBVIEW_MESSAGE_BYTES,
    isCurrentDocumentMessage,
    parseWebviewMessage,
} = require('../out/socWebviewProtocol');
const { loadCatalog, parseSocConfig } = require('../out/soc');
const { buildJsonReplacement } = require('../out/socJsonEdits');
const { diagnosticRange } = require('../out/socDiagnostics');
const {
    applySocDocumentUpdates,
    buildSocDocumentUpdates,
    buildSocEditorViewModel,
    executeSocEditorCommand,
    isEditableSocPath,
    isUnsettableSocPath,
    renderEditorHtml,
} = require('../out/socEditorProvider');
const {
    buildGenerateSocOptions,
    createConfigText,
    registerSocCommands,
    resolveSocConfigUri,
    runAutoAssign,
    runSocGeneration,
} = require('../out/socCommands');

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
    type: 'setValue', documentVersion: 7, path: ['cpu', 'debug'], value: true,
}), { type: 'setValue', documentVersion: 7, path: ['cpu', 'debug'], value: true });
assert.deepStrictEqual(parseWebviewMessage({
    type: 'setValue', documentVersion: 7, path: ['peripherals', 0, 'name'], value: 'uart0',
}), { type: 'setValue', documentVersion: 7, path: ['peripherals', 0, 'name'], value: 'uart0' });
assert.deepStrictEqual(parseWebviewMessage({
    type: 'select', documentVersion: 7, path: ['peripherals', 0],
}), { type: 'select', documentVersion: 7, path: ['peripherals', 0] });
assert.deepStrictEqual(parseWebviewMessage({
    type: 'unsetValue', documentVersion: 7, path: ['peripherals', 0, 'baseAddress'],
}), { type: 'unsetValue', documentVersion: 7, path: ['peripherals', 0, 'baseAddress'] });

const inheritedType = Object.create({ type: 'ready' });
const inheritedPath = Object.create({ path: ['cpu', 'debug'] });
inheritedPath.type = 'select';
const invalidMessages = [
    { type: 'unknown' },
    inheritedType,
    inheritedPath,
    { type: 'select', path: 'cpu.debug' },
    { type: 'select', path: ['cpu'] },
    { type: 'select', documentVersion: 0, path: ['cpu'] },
    { type: 'select', path: ['cpu', {}] },
    { type: 'select', path: ['__proto__'] },
    { type: 'select', path: ['prototype'] },
    { type: 'select', path: ['constructor'] },
    { type: 'select', path: ['C:\\workspace\\outside.json'] },
    { type: 'select', path: ['C:temp'] },
    { type: 'select', path: ['C:'] },
    { type: 'setValue', path: ['cpu', 'debug'], value: true },
    { type: 'unsetValue', path: ['cpu', 'debug'] },
    { type: 'unsetValue', documentVersion: 1, path: ['cpu', 'debug'], value: false },
    { type: 'setValue', documentVersion: 0, path: ['cpu', 'debug'], value: true },
    { type: 'setValue', documentVersion: 1.5, path: ['cpu', 'debug'], value: true },
    { type: 'setValue', documentVersion: 1, path: ['cpu', 'c:Temp'], value: true },
    { type: 'setValue', documentVersion: 1, path: ['cpu', 'debug'], value: true, filePath: 'C:\\workspace\\outside.json' },
    { type: 'ready', extra: true },
    { type: 'validate', documentVersion: 1 },
    { type: 'removeInstance', documentVersion: 1, collection: 'peripherals', index: 0.5 },
    { type: 'addInstance', documentVersion: 1, collection: 'peripherals', itemType: '../outside' },
    { type: 'setValue', documentVersion: 1, path: ['cpu', 'debug'], value: new Date() },
    { type: 'setValue', documentVersion: 1, path: ['cpu', 'debug'], value: Object.create(null) },
    { type: 'setValue', documentVersion: 1, path: ['cpu', 'debug'], value: [true, Object.create({ injected: true })] },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: 'C:\\outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: 'C:outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: '\\\\server\\share' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: '\\\\?\\C:\\outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: '/outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: '../outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: 'file:///outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'generated/demo_soc' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'generated\\demo_soc' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'name'], value: 'resources/generated' },
];
for (const value of invalidMessages) {
    assert.strictEqual(parseWebviewMessage(value), undefined, `accepted invalid message: ${JSON.stringify(value)}`);
}

for (const [pathValue, relativeValue] of [
    [['project', 'outputDir'], 'generated\\demo_soc'],
    [['project', 'outputDir'], 'resources/generated'],
    [['project', 'outputDir'], 'rtl/cpu/core.v'],
    [['memory', 'ilb', 'initFile'], 'boot\\firmware.mem'],
]) {
    assert.deepStrictEqual(parseWebviewMessage({
        type: 'setValue',
        documentVersion: 4,
        path: pathValue,
        value: relativeValue,
    }), {
        type: 'setValue',
        documentVersion: 4,
        path: pathValue,
        value: relativeValue,
    }, `rejected safe config-relative path: ${relativeValue}`);
}

assert.strictEqual(MAX_WEBVIEW_MESSAGE_BYTES, 64 * 1024);
const boundaryEnvelope = {
    type: 'setValue',
    documentVersion: 1,
    path: ['project', 'name'],
    value: '',
};
const boundaryOverhead = Buffer.byteLength(JSON.stringify(boundaryEnvelope), 'utf8');
boundaryEnvelope.value = 'x'.repeat(MAX_WEBVIEW_MESSAGE_BYTES - boundaryOverhead);
assert.strictEqual(Buffer.byteLength(JSON.stringify(boundaryEnvelope), 'utf8'), MAX_WEBVIEW_MESSAGE_BYTES);
assert.ok(parseWebviewMessage(boundaryEnvelope), 'a message exactly at the 64 KiB boundary was rejected');
boundaryEnvelope.value += 'x';
assert.strictEqual(parseWebviewMessage(boundaryEnvelope), undefined,
    'a message one byte above the 64 KiB boundary was accepted');
assert.ok(parseWebviewMessage({
    type: 'setValue',
    documentVersion: 1,
    path: ['project', 'name'],
    value: 'x'.repeat(65_000),
}), 'a message below the 64 KiB encoded boundary was rejected');
assert.strictEqual(parseWebviewMessage({
    type: 'setValue',
    documentVersion: 1,
    path: ['project', 'name'],
    value: '\u4e2d'.repeat(22_000),
}), undefined, 'an encoded message above 64 KiB was accepted');

const currentSetValue = parseWebviewMessage({
    type: 'setValue', documentVersion: 8, path: ['cpu', 'debug'], value: true,
});
assert.ok(currentSetValue);
assert.strictEqual(isCurrentDocumentMessage(currentSetValue, 8), true);
assert.strictEqual(isCurrentDocumentMessage(currentSetValue, 9), false);
assert.strictEqual(isCurrentDocumentMessage({ type: 'validate' }, 9), true);

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
const parsedStandard = parseSocConfig(standardJsonLf, 'standard.merc32.json', catalog);
assert.ok(parsedStandard.config);
for (const editablePath of [
    ['project', 'name'],
    ['cpu', 'debug'],
    ['memory', 'ilb', 'size'],
    ['peripherals', 0, 'type'],
    ['peripherals', 0, 'parameters', 'SYS_CLK_FREQ'],
    ['interrupt', 'mode'],
]) {
    assert.strictEqual(isEditableSocPath(parsedStandard.config, catalog, editablePath), true,
        `rejected editable path: ${JSON.stringify(editablePath)}`);
}
for (const unsupportedPath of [
    [],
    ['schemaVersion'],
    ['project', 'unexpected'],
    ['cpu', 'constructor'],
    ['memory', 'ilb', 'baseAddress'],
    ['peripherals', 0, 'module'],
    ['peripherals', 0, 'parameters', 'UNKNOWN'],
    ['peripherals', 1, 'name'],
    ['externalInterfaces', 0, 'name'],
]) {
    assert.strictEqual(isEditableSocPath(parsedStandard.config, catalog, unsupportedPath), false,
        `accepted unsupported path: ${JSON.stringify(unsupportedPath)}`);
}

const multiFixture = path.join(__dirname, 'fixtures', 'soc', 'multi-peripheral.merc32.json');
const multiText = require('fs').readFileSync(multiFixture, 'utf8');
const multiView = buildSocEditorViewModel(
    multiText,
    multiFixture,
    12,
    catalog,
    ['peripherals', 0],
);
assert.strictEqual(multiView.documentVersion, 12);
assert.ok(multiView.config);
const parsedMultiForEditing = parseSocConfig(multiText, multiFixture, catalog);
assert.ok(parsedMultiForEditing.config);
assert.strictEqual(isEditableSocPath(
    parsedMultiForEditing.config,
    catalog,
    ['interrupt', 'sources'],
), true, 'controller interrupt routes cannot be added or removed');

for (const optionalPath of [
    ['cpu', 'debug'],
    ['cpu', 'jtagIdCode'],
    ['memory', 'ilb', 'initFile'],
    ['peripherals', 0, 'baseAddress'],
    ['peripherals', 0, 'parameters', 'SYS_CLK_FREQ'],
    ['externalInterfaces', 0, 'baseAddress'],
]) {
    assert.strictEqual(isUnsettableSocPath(parsedMultiForEditing.config, catalog, optionalPath), true,
        `rejected optional field deletion: ${JSON.stringify(optionalPath)}`);
    assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
        type: 'unsetValue', documentVersion: 12, path: optionalPath,
    }), [{ path: optionalPath, value: undefined }]);
}
for (const requiredPath of [
    ['project', 'name'],
    ['project', 'outputDir'],
    ['memory', 'ilb', 'type'],
    ['memory', 'ilb', 'size'],
    ['peripherals', 0, 'type'],
    ['peripherals', 0, 'name'],
    ['externalInterfaces', 0, 'windowSize'],
    ['externalInterfaces', 0, 'addressWidth'],
    ['interrupt', 'mode'],
]) {
    assert.strictEqual(isUnsettableSocPath(parsedMultiForEditing.config, catalog, requiredPath), false,
        `allowed required field deletion: ${JSON.stringify(requiredPath)}`);
    assert.strictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
        type: 'unsetValue', documentVersion: 12, path: requiredPath,
    }), undefined);
}

const optionalRemovalUpdates = [
    ['cpu', 'debug'],
    ['cpu', 'jtagIdCode'],
    ['memory', 'ilb', 'initFile'],
    ['peripherals', 0, 'baseAddress'],
    ['peripherals', 0, 'parameters', 'SYS_CLK_FREQ'],
    ['externalInterfaces', 0, 'baseAddress'],
].flatMap((pathValue) => buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'unsetValue', documentVersion: 12, path: pathValue,
}));
const optionalRemovalResult = JSON.parse(applyReplacement(
    multiText,
    buildJsonReplacement(multiText, optionalRemovalUpdates),
));
assert.strictEqual(Object.prototype.hasOwnProperty.call(optionalRemovalResult.cpu, 'debug'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(optionalRemovalResult.cpu, 'jtagIdCode'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(optionalRemovalResult.memory.ilb, 'initFile'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(optionalRemovalResult.peripherals[0], 'baseAddress'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(
    optionalRemovalResult.peripherals[0].parameters, 'SYS_CLK_FREQ'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(
    optionalRemovalResult.externalInterfaces[0], 'baseAddress'), false);
assert.strictEqual(optionalRemovalResult.project.name, 'demo_soc');
assert.deepStrictEqual(multiView.selectedPath, ['peripherals', 0]);
assert.ok(multiView.catalog.modules.find((item) => item.type === 'apb_uart')
    .parameters.some((parameter) => parameter.name === 'FIFO_DEPTH'
        && parameter.type === 'powerOfTwo' && parameter.default === 8));
assert.ok(multiView.addressRows.some((row) => row.name === 'uart0'
    && row.baseAddress === '0x10000000' && row.endAddress === '0x10000fff'));
assert.ok(multiView.interruptRows.some((row) => row.source === 'uart0.interrupt'
    && row.id === 0 && row.trigger === 'high'));
assert.ok(multiView.portRows.some((row) => row.name === 'uart0_uart_rx'
    && row.direction === 'input' && row.width === 1));
assert.ok(multiView.dependencyRows.some((row) => row.kind === 'module'
    && row.name === 'apb_uart'));
assert.ok(multiView.dependencyRows.some((row) => row.kind === 'rtl'
    && /packaged files$/.test(row.detail)));

const activeGeneration = { phase: 'generating', message: 'Generating SoC...' };
const activeGenerationView = buildSocEditorViewModel(
    multiText,
    multiFixture,
    12,
    catalog,
    ['peripherals', 0],
    activeGeneration,
);
assert.deepStrictEqual(activeGenerationView.generation, activeGeneration,
    'document snapshot reset the panel action status');
const serializedMultiView = JSON.stringify(multiView);
assert.ok(!serializedMultiView.includes(path.dirname(multiFixture)), 'view model leaked a host path');
assert.ok(!serializedMultiView.includes('rtl/'), 'view model leaked a packaged asset path');

const hostPathConfig = JSON.parse(standardJsonLf);
hostPathConfig.project.outputDir = 'C:\\secret\\generated';
hostPathConfig.memory.ilb.initFile = 'C:\\secret\\firmware.mem';
const hostPathView = buildSocEditorViewModel(
    `${JSON.stringify(hostPathConfig, null, 2)}\n`,
    'host-path.merc32.json',
    13,
    catalog,
    ['project'],
);
assert.ok(hostPathView.config, 'semantic path diagnostics should preserve editable config state');
assert.ok(!path.win32.isAbsolute(hostPathView.config.project.outputDir),
    'view model leaked an absolute project output path');
assert.ok(!path.win32.isAbsolute(hostPathView.config.memory.ilb.initFile),
    'view model leaked an absolute memory initialization path');

const relativePathConfig = JSON.parse(standardJsonLf);
relativePathConfig.project.outputDir = 'resources/generated';
relativePathConfig.memory.ilb.initFile = 'boot\\firmware.mem';
const relativePathView = buildSocEditorViewModel(
    `${JSON.stringify(relativePathConfig, null, 2)}\n`,
    'relative-path.merc32.json',
    14,
    catalog,
    ['project'],
);
assert.strictEqual(relativePathView.config.project.outputDir, 'resources/generated');
assert.strictEqual(relativePathView.config.memory.ilb.initFile, 'boot\\firmware.mem');

const packagedPathConfig = JSON.parse(standardJsonLf);
packagedPathConfig.project.outputDir = path.resolve(__dirname, '..', 'resources', 'generated');
const packagedPathView = buildSocEditorViewModel(
    `${JSON.stringify(packagedPathConfig, null, 2)}\n`,
    'packaged-path.merc32.json',
    15,
    catalog,
    ['project'],
);
assert.strictEqual(packagedPathView.config.project.outputDir, '',
    'view model leaked an absolute packaged asset path');

const invalidView = buildSocEditorViewModel('{"cpu":', 'broken.merc32.json', 3, catalog, ['cpu']);
assert.strictEqual(invalidView.config, undefined);
assert.deepStrictEqual(invalidView.addressRows, []);
assert.deepStrictEqual(invalidView.interruptRows, []);
assert.deepStrictEqual(invalidView.portRows, []);
assert.deepStrictEqual(invalidView.dependencyRows, []);
assert.strictEqual(invalidView.readOnly, true);
assert.ok(invalidView.diagnostics.some((item) => item.code === 'SOC_JSON_SYNTAX'
    && item.line >= 1 && item.column >= 1));

const html = renderEditorHtml({
    cspSource: 'vscode-webview-resource:',
    asWebviewUri(uri) {
        return { toString: () => `vscode-webview-resource:${uri.path}` };
    },
}, {
    path: '/extension',
    with(change) {
        return { ...this, ...change };
    },
}, 'NONCE');
assert.ok(html.includes("default-src 'none'; img-src vscode-webview-resource:; "
    + "style-src vscode-webview-resource:; font-src vscode-webview-resource:; "
    + "script-src 'nonce-NONCE';"));
assert.strictEqual((html.match(/<script\b/g) || []).length, 1);
assert.strictEqual((html.match(/<script\b[^>]*\bnonce="NONCE"/g) || []).length, 1);
assert.ok(!/\son[a-z]+\s*=/i.test(html), 'HTML contains an inline event handler');
assert.ok(!/https?:\/\//i.test(html), 'HTML contains a remote URL');
assert.ok(html.includes('id="generation-title">Status</h2>'),
    'non-generation failures are still labeled as Generation');
const resourceUris = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
assert.deepStrictEqual(resourceUris.sort(), [
    'vscode-webview-resource:/extension/resources/webview/socEditor.css',
    'vscode-webview-resource:/extension/resources/webview/socEditor.js',
]);

const webviewCss = require('fs').readFileSync(
    path.join(__dirname, '..', 'resources', 'webview', 'socEditor.css'), 'utf8');
const webviewJs = require('fs').readFileSync(
    path.join(__dirname, '..', 'resources', 'webview', 'socEditor.js'), 'utf8');
assert.ok(webviewCss.includes('box-sizing: border-box'));
assert.ok(webviewCss.includes('minmax(210px, 0.8fr) minmax(320px, 1.4fr) minmax(260px, 1fr)'));
const workbenchCss = /\.workbench\s*\{([^}]*)\}/s.exec(webviewCss)[1];
const minimumTrackWidth = [...workbenchCss.matchAll(/minmax\((\d+)px,/g)]
    .reduce((total, match) => total + Number(match[1]), 0);
const singleColumnBreakpoint = Number(
    /@media\s*\(max-width:\s*(\d+)px\)[\s\S]*?\.workbench\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0,\s*1fr\)/
        .exec(webviewCss)[1],
);
assert.ok(singleColumnBreakpoint >= minimumTrackWidth,
    `single-column breakpoint ${singleColumnBreakpoint}px is below ${minimumTrackWidth}px minimum tracks`);
assert.ok(!/border-radius:\s*(?:9|[1-9]\d+)px/.test(webviewCss));
assert.ok(!webviewJs.includes('innerHTML'));
assert.ok(!/\.on(?:click|change|input|submit)\s*=/.test(webviewJs));
assert.ok(webviewJs.includes("postMessage({ type: 'ready' })"));

const workspaceCalls = [];
class FakeWorkspaceEdit {
    constructor() {
        this.replacements = [];
        workspaceCalls.push(this);
    }
    replace(...args) {
        this.replacements.push(args);
    }
}
class FakeRange {
    constructor(start, end) {
        this.start = start;
        this.end = end;
    }
}
let appliedEdit;
const fakeVscode = {
    Range: FakeRange,
    WorkspaceEdit: FakeWorkspaceEdit,
    workspace: {
        async applyEdit(edit) {
            appliedEdit = edit;
            return true;
        },
    },
};
const fakeDocument = {
    uri: { toString: () => 'file:///standard.merc32.json' },
    getText: () => standardJsonLf,
    positionAt: (offset) => ({ offset }),
    save: () => { throw new Error('applySocDocumentUpdates must not auto-save'); },
};

(async () => {
    const applied = await applySocDocumentUpdates(fakeDocument, [
        { path: ['cpu', 'debug'], value: true },
    ], fakeVscode);
    assert.strictEqual(applied, true);
    assert.strictEqual(workspaceCalls.length, 1);
    assert.strictEqual(appliedEdit.replacements.length, 1);
    assert.strictEqual(appliedEdit.replacements[0][0], fakeDocument.uri);
    assert.strictEqual(appliedEdit.replacements[0][1].start.offset,
        standardJsonLf.indexOf('false'));
    const appliedRange = appliedEdit.replacements[0][1];
    const appliedText = standardJsonLf.slice(0, appliedRange.start.offset)
        + appliedEdit.replacements[0][2]
        + standardJsonLf.slice(appliedRange.end.offset);
    assert.ok(appliedText.includes('"debug": true'));

    const starterText = createConfigText('control_board');
    const starter = JSON.parse(starterText);
    assert.deepStrictEqual(starter, {
        schemaVersion: 1,
        project: {
            name: 'control_board',
            outputDir: 'generated/control_board',
        },
        cpu: { debug: false },
        memory: {
            ilb: { type: 'internal_ram', size: '32KiB' },
            dlb: { type: 'internal_ram', size: '32KiB' },
        },
        peripherals: [],
        externalInterfaces: [],
        interrupt: { mode: 'none' },
    }, 'starter configuration drifted from the schema-version-1 contract');
    assert.ok(starterText.endsWith('\n'));
    assert.ok(parseSocConfig(starterText, 'control_board.merc32.json', catalog).config,
        'starter configuration is not accepted by the real parser');

    const uri = (name) => ({
        scheme: 'file',
        path: `/workspace/${name}`,
        fsPath: `C:\\workspace\\${name}`,
        with(change) {
            const nextPath = change.path === undefined ? this.path : change.path;
            return {
                ...this,
                ...change,
                path: nextPath,
                fsPath: nextPath.replace('/workspace/', 'C:\\workspace\\').replace(/\//g, '\\'),
            };
        },
        toString() { return `file://${this.path}`; },
    });
    const explicitUri = uri('explicit.merc32.json');
    const activeUri = uri('active.merc32.json');
    const workspaceUri = uri('workspace.merc32.json');
    const otherWorkspaceUri = uri('other.merc32.json');
    const resolverCalls = [];
    const resolverVscode = {
        Uri: {
            isUri(value) {
                return Boolean(value && value.scheme === 'file' && typeof value.path === 'string');
            },
        },
        window: {
            tabGroups: {
                activeTabGroup: {
                    activeTab: {
                        input: { viewType: SOC_EDITOR_VIEW_TYPE, uri: activeUri },
                    },
                },
            },
            async showQuickPick(items) {
                resolverCalls.push(['quickPick', items]);
                return items.find((item) => item.uri === otherWorkspaceUri);
            },
        },
        workspace: {
            async findFiles(include, exclude) {
                resolverCalls.push(['findFiles', include, exclude]);
                return [workspaceUri];
            },
            asRelativePath(value) { return value.path.slice('/workspace/'.length); },
        },
    };
    assert.strictEqual(await resolveSocConfigUri(explicitUri, resolverVscode), explicitUri,
        'explicit configuration URI did not win target resolution');
    assert.strictEqual(resolverCalls.length, 0, 'explicit resolution consulted lower-priority state');
    assert.strictEqual(await resolveSocConfigUri(uri('ordinary.json'), resolverVscode), undefined,
        'an explicit ordinary JSON URI fell through to another configuration');
    assert.strictEqual(resolverCalls.length, 0, 'an explicit ordinary JSON URI triggered discovery');
    assert.strictEqual(await resolveSocConfigUri(undefined, resolverVscode), activeUri,
        'active custom-editor URI did not win target resolution');
    assert.strictEqual(resolverCalls.length, 0, 'active custom editor triggered a workspace scan');

    resolverVscode.window.tabGroups.activeTabGroup.activeTab = undefined;
    assert.strictEqual(await resolveSocConfigUri(undefined, resolverVscode), workspaceUri,
        'the only workspace configuration was not selected');
    assert.deepStrictEqual(resolverCalls.shift(), [
        'findFiles', '**/*.merc32.json', '**/{.git,node_modules}/**',
    ]);

    resolverVscode.workspace.findFiles = async (include, exclude) => {
        resolverCalls.push(['findFiles', include, exclude]);
        return [workspaceUri, otherWorkspaceUri];
    };
    assert.strictEqual(await resolveSocConfigUri(undefined, resolverVscode), otherWorkspaceUri,
        'multiple workspace configurations did not require the explicit Quick Pick choice');
    assert.strictEqual(resolverCalls.filter(([kind]) => kind === 'quickPick').length, 1);

    const assignmentDocument = {
        ...fakeDocument,
        uri: explicitUri,
        fileName: explicitUri.fsPath,
        isDirty: false,
        save: () => { throw new Error('Auto-assign must not save the document'); },
    };
    const assignmentCalls = [];
    const assignmentVscode = {
        Uri: resolverVscode.Uri,
        window: {
            tabGroups: { activeTabGroup: { activeTab: undefined } },
            async showWarningMessage(message, options, ...actions) {
                assignmentCalls.push(['preview', message, options, actions]);
                return 'Assign';
            },
            async showErrorMessage(message) { assignmentCalls.push(['error', message]); },
        },
        workspace: {
            async findFiles() { throw new Error('explicit auto-assign target must not scan'); },
            async openTextDocument(value) {
                assert.strictEqual(value, explicitUri);
                return assignmentDocument;
            },
        },
    };
    let assignmentUpdates;
    const assignmentOutcome = await runAutoAssign(explicitUri, {
        catalog,
        diagnostics: { refresh: () => [] },
        output: { appendLine() {}, show() {} },
        vscodeApi: assignmentVscode,
        applyUpdates: async (document, updates) => {
            assert.strictEqual(document, assignmentDocument);
            assignmentUpdates = updates;
            return true;
        },
    });
    assert.strictEqual(assignmentOutcome, true);
    assert.deepStrictEqual(assignmentUpdates, [{
        path: ['peripherals', 0, 'baseAddress'], value: '0x10000000',
    }]);
    assert.strictEqual(assignmentCalls[0][2].modal, true);
    assert.strictEqual(assignmentCalls[0][2].detail,
        'peripherals.0.baseAddress -> 0x10000000');
    assert.deepStrictEqual(assignmentCalls[0][3], ['Assign']);

    assignmentVscode.window.showWarningMessage = async () => undefined;
    assignmentUpdates = undefined;
    assert.strictEqual(await runAutoAssign(explicitUri, {
        catalog,
        diagnostics: { refresh: () => [] },
        output: { appendLine() {}, show() {} },
        vscodeApi: assignmentVscode,
        applyUpdates: async (_document, updates) => {
            assignmentUpdates = updates;
            return true;
        },
    }), false, 'cancelled assignment did not return the failure/cancellation outcome');
    assert.strictEqual(assignmentUpdates, undefined, 'cancelled assignment edited the document');

    const assetRoot = 'C:\\extension\\resources';
    assert.deepStrictEqual(buildGenerateSocOptions(explicitUri.fsPath, assetRoot, 'normal'), {
        configFile: explicitUri.fsPath,
        assetRoot,
    });
    assert.deepStrictEqual(buildGenerateSocOptions(explicitUri.fsPath, assetRoot, 'force'), {
        configFile: explicitUri.fsPath,
        assetRoot,
        force: true,
    });
    assert.deepStrictEqual(buildGenerateSocOptions(explicitUri.fsPath, assetRoot, 'adopt'), {
        configFile: explicitUri.fsPath,
        assetRoot,
        adoptOutput: true,
    });

    const generationCalls = [];
    const dirtyGenerationDocument = {
        ...assignmentDocument,
        isDirty: true,
        async save() {
            generationCalls.push(['save']);
            return false;
        },
    };
    const extensionUri = {
        scheme: 'file',
        path: '/extension',
        fsPath: 'C:\\extension',
        toString() { return 'file:///extension'; },
    };
    const generationVscode = {
        Uri: {
            ...resolverVscode.Uri,
            joinPath(base, segment) {
                return {
                    scheme: base.scheme,
                    path: `${base.path}/${segment}`,
                    fsPath: `${base.fsPath}\\${segment}`,
                    toString() { return `file://${this.path}`; },
                };
            },
            file(value) { return uri(value.replace(/^.*[\\/]/, '')); },
        },
        ProgressLocation: { Notification: 15 },
        window: {
            tabGroups: { activeTabGroup: { activeTab: undefined } },
            async withProgress(_options, task) {
                return task({ report(value) { generationCalls.push(['progress', value.message]); } });
            },
            async showErrorMessage(message) { generationCalls.push(['error', message]); },
        },
        workspace: {
            async findFiles() { throw new Error('explicit generation target must not scan'); },
            async openTextDocument() { return dirtyGenerationDocument; },
        },
        commands: {
            async executeCommand(...args) { generationCalls.push(['command', ...args]); },
        },
    };
    const generationServices = {
        extensionUri,
        catalog,
        diagnostics: { refresh: () => [] },
        output: { appendLine(value) { generationCalls.push(['output', value]); }, show() {} },
        vscodeApi: generationVscode,
        generate: (options) => {
            generationCalls.push(['generate', options]);
            return {
                outputDir: 'C:\\workspace\\generated\\edit_soc',
                manifestFile: 'C:\\workspace\\generated\\edit_soc\\manifest.json',
                files: [], warnings: [], skippedUserFiles: [],
            };
        },
    };
    assert.strictEqual(await runSocGeneration(explicitUri, 'normal', generationServices), false,
        'save cancellation did not stop generation');
    assert.deepStrictEqual(generationCalls, [['save']]);

    dirtyGenerationDocument.save = async () => {
        generationCalls.push(['save']);
        throw new Error('disk full');
    };
    generationCalls.length = 0;
    assert.strictEqual(await runSocGeneration(explicitUri, 'normal', generationServices), false,
        'save failure did not return the handled failure outcome');
    assert.deepStrictEqual(generationCalls.map(([kind]) => kind), ['save', 'error']);

    dirtyGenerationDocument.save = async () => {
        generationCalls.push(['save']);
        return true;
    };
    generationCalls.length = 0;
    let generatedRecord;
    const statusMessages = [];
    const successfulServices = {
        ...generationServices,
        artifacts: {
            async recordGeneratedSoc(record) { generatedRecord = record; },
        },
    };
    assert.strictEqual(await runSocGeneration(
        explicitUri,
        'force',
        successfulServices,
        async (status) => { statusMessages.push(status.message); },
    ), true);
    const generateCall = generationCalls.find(([kind]) => kind === 'generate');
    assert.deepStrictEqual(generateCall[1], {
        configFile: explicitUri.fsPath,
        assetRoot: 'C:\\extension\\resources',
        force: true,
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(generateCall[1], 'adoptOutput'),
        'force generation also enabled adoption');
    assert.ok(statusMessages.some((message) => /planning/i.test(message)));
    assert.ok(statusMessages.some((message) => /staging/i.test(message) && /activation/i.test(message)));
    assert.strictEqual(generatedRecord.configUri, explicitUri);
    assert.ok(generationCalls.some(([kind, command]) =>
        kind === 'command' && command === 'revealFileInOS'));

    generationCalls.length = 0;
    successfulServices.generate = () => {
        throw new (require('../out/soc').SocGenerationError)(
            'Generated files conflict with the existing output.',
            [],
            [{ path: 'rtl/edit_soc.v', reason: 'modified-managed' }],
        );
    };
    assert.strictEqual(await runSocGeneration(explicitUri, 'normal', successfulServices), false,
        'handled generator conflict did not return false');
    assert.ok(generationCalls.some(([kind, value]) =>
        kind === 'output' && /rtl\/edit_soc\.v.*modified-managed/.test(value)));
    assert.strictEqual(generationCalls.filter(([kind]) => kind === 'error').length, 1);

    const commandHandlers = new Map();
    const registeredCalls = [];
    const createdUri = uri('Control Board.merc32.json');
    let saveDialogUri = createdUri;
    let confirmAction;
    let registeredDocumentText = starterText;
    const registeredVscode = {
        ...generationVscode,
        Uri: {
            ...generationVscode.Uri,
            file(value) {
                const normalized = value.replace(/\\/g, '/');
                return {
                    scheme: 'file',
                    path: normalized.startsWith('/') ? normalized : `/${normalized}`,
                    fsPath: value,
                    toString() { return `file://${this.path}`; },
                };
            },
        },
        commands: {
            registerCommand(command, handler) {
                commandHandlers.set(command, handler);
                return { dispose() {} };
            },
            async executeCommand(...args) {
                registeredCalls.push(['executeCommand', ...args]);
            },
        },
        window: {
            ...generationVscode.window,
            async showSaveDialog(options) {
                registeredCalls.push(['saveDialog', options]);
                return saveDialogUri;
            },
            async showWarningMessage(message, options, ...actions) {
                registeredCalls.push(['confirm', message, options, actions]);
                return confirmAction;
            },
            async showErrorMessage(message) {
                registeredCalls.push(['error', message]);
            },
        },
        workspace: {
            ...generationVscode.workspace,
            workspaceFolders: [{ uri: uri('') }],
            fs: {
                async stat(value) {
                    registeredCalls.push(['stat', value]);
                    throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
                },
                async writeFile(value, bytes) {
                    registeredCalls.push(['writeFile', value, Buffer.from(bytes).toString('utf8')]);
                },
                async rename(source, target, options) {
                    registeredCalls.push(['rename', source, target, options]);
                },
                async delete(value, options) {
                    registeredCalls.push(['delete', value, options]);
                    throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
                },
            },
            async openTextDocument(value) {
                registeredCalls.push(['openTextDocument', value]);
                return {
                    ...assignmentDocument,
                    uri: value,
                    fileName: value.fsPath,
                    getText: () => registeredDocumentText,
                    isDirty: false,
                };
            },
        },
    };
    const registeredOutput = [];
    const registeredGeneratedOptions = [];
    const registeredServices = {
        catalog,
        diagnostics: { refresh: (document) => {
            registeredCalls.push(['diagnostics', document.uri]);
            return [];
        } },
        output: {
            appendLine(value) { registeredOutput.push(value); },
            show(value) { registeredCalls.push(['outputShow', value]); },
        },
        vscodeApi: registeredVscode,
        generate(options) {
            registeredGeneratedOptions.push(options);
            return {
                outputDir: 'C:\\workspace\\generated\\control_board',
                manifestFile: 'C:\\workspace\\generated\\control_board\\manifest.json',
                files: ['rtl/control_board.v'], warnings: [], skippedUserFiles: [],
            };
        },
    };
    const disposables = registerSocCommands({ extensionUri }, registeredServices);
    assert.strictEqual(disposables.length, 8);

    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.createConfig)(), true);
    const saveDialog = registeredCalls.find(([kind]) => kind === 'saveDialog');
    assert.ok(saveDialog[1].defaultUri.path.endsWith('/soc.merc32.json'));
    assert.ok(registeredCalls.findIndex(([kind]) => kind === 'stat')
        < registeredCalls.findIndex(([kind]) => kind === 'writeFile'));
    const writeCall = registeredCalls.find(([kind]) => kind === 'writeFile');
    assert.notStrictEqual(writeCall[1], createdUri,
        'Create passed the selected URI to overwrite-capable writeFile');
    const createdText = writeCall[2];
    assert.strictEqual(JSON.parse(createdText).project.name, 'Control_Board');
    assert.strictEqual(JSON.parse(createdText).project.outputDir, 'generated/Control_Board');
    const renameCall = registeredCalls.find(([kind]) => kind === 'rename');
    assert.strictEqual(renameCall[1], writeCall[1]);
    assert.strictEqual(renameCall[2], createdUri);
    assert.deepStrictEqual(renameCall[3], { overwrite: false });
    assert.ok(registeredCalls.some(([kind, command, value, viewType]) =>
        kind === 'executeCommand' && command === 'vscode.openWith'
        && value === createdUri && viewType === SOC_EDITOR_VIEW_TYPE));

    registeredCalls.length = 0;
    registeredVscode.workspace.fs.stat = async (value) => {
        registeredCalls.push(['stat', value]);
        return { type: 1, ctime: 0, mtime: 0, size: 1 };
    };
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.createConfig)(), false);
    assert.ok(!registeredCalls.some(([kind]) => kind === 'writeFile'),
        'Create overwrote an existing configuration');

    registeredCalls.length = 0;
    registeredVscode.workspace.fs.stat = async (value) => {
        registeredCalls.push(['stat', value]);
        throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
    };
    registeredVscode.workspace.fs.rename = async (source, target, options) => {
        registeredCalls.push(['rename', source, target, options]);
        throw Object.assign(new Error('raced'), { code: 'FileExists' });
    };
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.createConfig)(), false);
    assert.ok(registeredCalls.some(([kind]) => kind === 'delete'),
        'raced temporary configuration was not cleaned up');
    assert.ok(!registeredCalls.some(([kind, command]) =>
        kind === 'executeCommand' && command === 'vscode.openWith'));

    registeredCalls.length = 0;
    saveDialogUri = uri('ordinary.json');
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.createConfig)(), false);
    assert.ok(!registeredCalls.some(([kind]) => kind === 'stat' || kind === 'writeFile'),
        'invalid compound suffix reached filesystem mutation');
    saveDialogUri = createdUri;

    registeredCalls.length = 0;
    registeredOutput.length = 0;
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.validate)(explicitUri), true);
    assert.ok(registeredOutput.includes('Warnings: none'));
    assert.ok(registeredOutput.includes('Address table:'));
    assert.ok(registeredOutput.includes('(no PLB endpoints)'));

    registeredOutput.length = 0;
    registeredDocumentText = standardJsonLf.replace(
        '      "name": "uart0"\n',
        '      "name": "uart0",\n      "baseAddress": "0x10000000"\n',
    );
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.validate)(explicitUri), true);
    assert.ok(registeredOutput.includes('uart0: 0x10000000 - 0x10000fff'));
    assert.ok(registeredOutput.some((line) => /WARNING SOC_IRQ_UNCONNECTED/.test(line)));
    registeredDocumentText = starterText;

    registeredCalls.length = 0;
    registeredGeneratedOptions.length = 0;
    confirmAction = undefined;
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.forceGenerate)(explicitUri), false);
    assert.strictEqual(registeredGeneratedOptions.length, 0);
    const forceConfirmation = registeredCalls.find(([kind]) => kind === 'confirm');
    assert.strictEqual(forceConfirmation[2].modal, true);
    assert.match(forceConfirmation[2].detail, /replace modified managed files/i);
    assert.match(forceConfirmation[2].detail, /will not replace main\.c/i);

    confirmAction = 'Force Generate';
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.forceGenerate)(explicitUri), true);
    assert.deepStrictEqual(registeredGeneratedOptions.pop(), {
        configFile: explicitUri.fsPath,
        assetRoot: 'C:\\extension\\resources',
        force: true,
    });

    registeredCalls.length = 0;
    confirmAction = 'Adopt Output';
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.adoptOutput)(explicitUri), true);
    const adoptConfirmation = registeredCalls.find(([kind]) => kind === 'confirm');
    assert.match(adoptConfirmation[1], /explicit\.merc32\.json/);
    assert.match(adoptConfirmation[2].detail, /Configuration:/);
    assert.match(adoptConfirmation[2].detail, /Output directory:.*generated[\\/]control_board/);
    assert.deepStrictEqual(registeredGeneratedOptions.pop(), {
        configFile: explicitUri.fsPath,
        assetRoot: 'C:\\extension\\resources',
        adoptOutput: true,
    });

    for (const [type, expectedCommand, outcome, commandStatus, expectedPhases] of [
        ['autoAssign', 'merc32.soc.autoAssign', true, undefined, ['working', 'success']],
        ['validate', 'merc32.soc.validate', undefined, undefined, ['validating', 'success']],
        ['generate', 'merc32.soc.generate', true,
            { phase: 'generating', message: 'Staging and activation...' },
            ['generating', 'generating', 'generated']],
    ]) {
        const calls = [];
        const statuses = [];
        await executeSocEditorCommand(
            type,
            fakeDocument.uri,
            async (...args) => {
                calls.push(args);
                if (commandStatus) await args[2](commandStatus);
                return outcome;
            },
            async (status) => { statuses.push(status); },
        );
        assert.strictEqual(calls.length, 1);
        assert.strictEqual(calls[0][0], expectedCommand);
        assert.strictEqual(calls[0][1], fakeDocument.uri);
        assert.strictEqual(typeof calls[0][2], 'function');
        assert.deepStrictEqual(statuses.map((status) => status.phase), expectedPhases,
            `${type} posted dishonest status transitions`);
    }

    for (const [type, expectedPhases] of [
        ['autoAssign', ['working', 'error']],
        ['validate', ['validating', 'error']],
        ['generate', ['generating', 'error']],
    ]) {
        const statuses = [];
        await executeSocEditorCommand(
            type,
            fakeDocument.uri,
            async () => false,
            async (status) => { statuses.push(status); },
        );
        assert.deepStrictEqual(statuses.map((status) => status.phase), expectedPhases,
            `${type} reported success after an explicit false outcome`);
    }

    const failedStatuses = [];
    await executeSocEditorCommand(
        'generate',
        fakeDocument.uri,
        async () => { throw new Error('generation failed'); },
        async (status) => { failedStatuses.push(status); },
    );
    assert.deepStrictEqual(failedStatuses.map((status) => status.phase), ['generating', 'error']);
    assert.match(failedStatuses[1].message, /generation failed/i);

    console.log('MERC32 VSCode SoC unit contracts passed.');
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
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
