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
    buildSocEditorViewModel,
    isEditableSocPath,
    renderEditorHtml,
} = require('../out/socEditorProvider');

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
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: '/outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: '../outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: 'file:///outside' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: 'rtl/cpu/core.v' },
    { type: 'setValue', documentVersion: 1, path: ['project', 'outputDir'], value: 'resources/webview/socEditor.js' },
];
for (const value of invalidMessages) {
    assert.strictEqual(parseWebviewMessage(value), undefined, `accepted invalid message: ${JSON.stringify(value)}`);
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
assert.ok(/@media\s*\(max-width:\s*760px\)/.test(webviewCss));
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
