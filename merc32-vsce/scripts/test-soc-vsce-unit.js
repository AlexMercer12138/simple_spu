const assert = require('assert');
const fs = require('fs');
const path = require('path');

function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return { promise, resolve, reject };
}

async function settlesWithin(promise, milliseconds) {
    const timeout = Symbol('timeout');
    const result = await Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(timeout), milliseconds)),
    ]);
    assert.notStrictEqual(result, timeout);
    return result;
}

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

const {
    SOC_COMMANDS,
    SOC_CONFIG_SUFFIX,
    SOC_EDITOR_VIEW_TYPE,
    SOC_HOST_COMMANDS,
    SOC_VIEW_IDS,
} = require('../out/constants');
const {
    MAX_WEBVIEW_MESSAGE_BYTES,
    isCurrentDocumentMessage,
    parseWebviewMessage,
} = require('../out/socWebviewProtocol');
const { loadCatalog, parseSocConfig } = require('../out/soc');
const { buildJsonReplacement } = require('../out/socJsonEdits');
const { SocDiagnostics, diagnosticRange } = require('../out/socDiagnostics');
const {
    applySocDocumentUpdates,
    buildSocDocumentUpdates,
    buildSocEditorViewModel,
    executeSocEditorCommand,
    isEditableSocPath,
    isUnsettableSocPath,
    Merc32SocEditorProvider,
    renderEditorHtml,
} = require('../out/socEditorProvider');
const {
    buildGenerateSocOptions,
    createConfigText,
    registerSocCommands,
    resolveSocConfigUri,
    runAutoAssign,
    runSocGeneration,
    workspaceUriFromFsPath,
} = require('../out/socCommands');
const {
    Merc32ArtifactStore,
    Merc32ArtifactsProvider,
    SOC_ACTION_MODELS,
    SOC_ARTIFACT_STATE_KEY,
    SocConfigurationProvider,
    artifactPathsFromManifest,
    buildConfigurationModels,
} = require('../out/socExplorer');

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
});
assert.deepStrictEqual(SOC_HOST_COMMANDS, { refresh: 'merc32.soc.refresh' });

const configurationModels = buildConfigurationModels([
    { uri: 'two-b', workspaceRelativePath: 'root-two/peripherals/b.merc32.json' },
    { uri: 'one-z', workspaceRelativePath: 'root-one/z.merc32.json' },
    { uri: 'two-a', workspaceRelativePath: 'root-two/peripherals/a.merc32.json' },
    { uri: 'two-c', workspaceRelativePath: 'root-two\\peripherals\\c.merc32.json' },
]);
assert.deepStrictEqual(configurationModels.map((item) => item.workspaceRelativePath), [
    'root-one/z.merc32.json',
    'root-two/peripherals/a.merc32.json',
    'root-two/peripherals/b.merc32.json',
    'root-two/peripherals/c.merc32.json',
], 'configurations were not sorted by workspace-relative path');
assert.deepStrictEqual(configurationModels.slice(1).map((item) => item.uri), ['two-a', 'two-b', 'two-c'],
    'same-directory configurations were collapsed or reordered');

assert.deepStrictEqual(SOC_ACTION_MODELS.map((item) => [item.label, item.command]), [
    ['Validate', 'merc32.soc.validate'],
    ['Auto-assign', 'merc32.soc.autoAssign'],
    ['Generate', 'merc32.soc.generate'],
    ['Force Generate', 'merc32.soc.forceGenerate'],
]);

const manifestHash = '0'.repeat(64);
const artifactManifest = {
    generatorVersion: '2.0.0',
    manifestVersion: 2,
    manifestFile: {
        hashPolicy: 'excluded-self',
        kind: 'control/manifest',
        path: 'manifest.json',
    },
    projectName: 'demo',
    resourceRevision: 'test-resource-revision',
    sourceConfig: 'C:/workspace/configs/demo.merc32.json',
    files: [
        {
            kind: 'generated/documentation',
            logicalSource: 'templates/README.md.tpl',
            path: 'README.md',
            sha256: manifestHash,
        },
        {
            kind: 'generated/rtl-bundle',
            logicalSource: 'generator:renderRtlBundle',
            path: 'hardware/demo.v',
            sha256: manifestHash,
        },
        {
            kind: 'generated/software-header',
            logicalSource: 'generator:renderSocHeader',
            path: 'software/demo.h',
            sha256: manifestHash,
        },
        {
            kind: 'scaffold/user-owned',
            logicalSource: 'templates/main.c.tpl',
            path: 'software/main.c',
        },
        {
            kind: 'source/firmware',
            logicalSource: 'config:memory.ilb.initFile',
            path: 'firmware/ilb_boot.mem',
            sha256: manifestHash,
        },
        {
            kind: 'source/firmware',
            logicalSource: 'config:memory.dlb.initFile',
            path: 'firmware/dlb_data.bin',
            sha256: manifestHash,
        },
    ],
};
assert.deepStrictEqual(artifactPathsFromManifest(artifactManifest), [
    'README.md',
    'hardware/demo.v',
    'software/demo.h',
    'software/main.c',
    'firmware/ilb_boot.mem',
    'firmware/dlb_data.bin',
], 'manifest artifact selection did not return the exact safe compact children');
assert.strictEqual(artifactPathsFromManifest({
    ...artifactManifest,
    manifestVersion: 1,
}), undefined, 'manifest v1 unexpectedly restored legacy artifacts');
for (const [name, manifest] of [
    ['missing files', { ...artifactManifest, files: undefined }],
    ['wrong files shape', { ...artifactManifest, files: {} }],
    ['missing required header', {
        ...artifactManifest,
        files: artifactManifest.files.filter((item) => item.kind !== 'generated/software-header'),
    }],
    ['wrong manifest sentinel', {
        ...artifactManifest,
        manifestFile: { ...artifactManifest.manifestFile, path: '../manifest.json' },
    }],
    ['traversing bundle path', {
        ...artifactManifest,
        files: artifactManifest.files.map((item) => item.logicalSource === 'generator:renderRtlBundle'
            ? { ...item, path: '../demo.v' }
            : item),
    }],
    ['forged bundle kind', {
        ...artifactManifest,
        files: artifactManifest.files.map((item) => item.logicalSource === 'generator:renderRtlBundle'
            ? { ...item, kind: 'generated/rtl' }
            : item),
    }],
    ['unsafe sibling traversal', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'source/firmware', logicalSource: 'config:memory.ilb.initFile', path: '../outside.v', sha256: manifestHash,
        }],
    }],
    ['absolute sibling path', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'source/firmware', logicalSource: 'config:memory.ilb.initFile', path: 'C:/outside.v', sha256: manifestHash,
        }],
    }],
    ['null sibling', { ...artifactManifest, files: [...artifactManifest.files, null] }],
    ['array sibling', { ...artifactManifest, files: [...artifactManifest.files, []] }],
    ['scalar sibling', { ...artifactManifest, files: [...artifactManifest.files, 'rtl/outside.v'] }],
    ['duplicate sibling path', {
        ...artifactManifest,
        files: [...artifactManifest.files, { ...artifactManifest.files[0] }],
    }],
    ['case-insensitive sibling collision', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'source/firmware', logicalSource: 'config:memory.ilb.initFile', path: 'FIRMWARE/ILB_BOOT.MEM', sha256: manifestHash,
        }],
    }],
    ['malformed sibling path', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'source/firmware', logicalSource: 'config:memory.ilb.initFile', path: 'firmware//outside.v', sha256: manifestHash,
        }],
    }],
    ['forged sibling role', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'generated/documentation', logicalSource: 'generator:forged', path: 'README.md', sha256: manifestHash,
        }],
    }],
    ['forged sibling kind', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'generated/rtl-bundle', logicalSource: 'templates/README.md.tpl', path: 'README.md', sha256: manifestHash,
        }],
    }],
    ['invalid managed hash', {
        ...artifactManifest,
        files: artifactManifest.files.map((item) => item.path === 'hardware/demo.v'
            ? { ...item, sha256: 'not-a-sha256' }
            : item),
    }],
    ['malformed user-owned record', {
        ...artifactManifest,
        files: artifactManifest.files.map((item) => item.kind === 'scaffold/user-owned'
            ? { ...item, sha256: manifestHash }
            : item),
    }],
    ['main hash', {
        ...artifactManifest,
        files: artifactManifest.files.map((item) => item.path === 'software/main.c'
            ? { ...item, sha256: manifestHash }
            : item),
    }],
    ['firmware slot mismatch', {
        ...artifactManifest,
        files: artifactManifest.files.map((item) => item.path === 'firmware/ilb_boot.mem'
            ? { ...item, logicalSource: 'config:memory.dlb.initFile' }
            : item),
    }],
    ['duplicate same-slot firmware', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'source/firmware', logicalSource: 'config:memory.ilb.initFile',
            path: 'firmware/ilb_second.mem', sha256: manifestHash,
        }],
    }],
    ['extra unlisted record', {
        ...artifactManifest,
        files: [...artifactManifest.files, {
            kind: 'generated/config', logicalSource: 'generator:renderResolvedConfig',
            path: 'config/demo.resolved.json', sha256: manifestHash,
        }],
    }],
]) {
    assert.strictEqual(artifactPathsFromManifest(manifest), undefined,
        `accepted structurally invalid artifact manifest: ${name}`);
}

const extensionSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');
for (const viewKey of ['configurations', 'generate', 'build', 'artifacts']) {
    assert.match(extensionSource, new RegExp(`registerTreeDataProvider\\(SOC_VIEW_IDS\\.${viewKey}`),
        `activation did not register the ${viewKey} view`);
}
assert.strictEqual((extensionSource.match(/createOutputChannel\(/g) ?? []).length, 1,
    'activation must create exactly one shared output channel');
assert.strictEqual((extensionSource.match(/loadCatalog\(/g) ?? []).length, 1,
    'activation must load exactly one catalog');
assert.match(extensionSource, /new AssemblyRunner\(output\)/,
    'the assembler runner does not use the shared output channel');
assert.match(extensionSource, /new SocDiagnostics\(catalog,/,
    'diagnostics do not receive the shared catalog');
assert.match(extensionSource, /new Merc32SocEditorProvider\(context\.extensionUri, catalog,/,
    'the custom editor does not receive the shared catalog');
assert.match(extensionSource, /registerAssemblerCommands\([\s\S]*artifactStore/,
    'legacy commands do not publish into the shared artifact store');
assert.match(extensionSource, /catch \(error\)[\s\S]*SoC tools were disabled/,
    'activation does not isolate packaged-catalog failure to the SoC side');
assert.doesNotMatch(extensionSource, /await vscode\.window\.showErrorMessage/,
    'catalog failure notification blocks extension activation');
assert.match(extensionSource,
    /registerSocExplorerCommands\([\s\S]*if \(catalogFailureMessage\)[\s\S]*showErrorMessage/,
    'catalog failure is shown before legacy commands and views are registered');

const extensionCommandsSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'extensionCommands.ts'), 'utf8');
assert.match(extensionCommandsSource, /artifactStore\.setCompilerArtifacts\(artifacts\)/,
    'compiler outputs are not published through the shared store');
assert.doesNotMatch(extensionCommandsSource, /state\.artifacts\s*=/,
    'compiler outputs remained in the legacy explorer state');

const toolchainExplorerSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'toolchainExplorer.ts'), 'utf8');
assert.doesNotMatch(toolchainExplorerSource, /artifactsGroup|No artifacts yet/,
    'the Toolchain view still owns an artifact subtree');
assert.match(toolchainExplorerSource, /implements vscode\.TreeDataProvider<[^>]+>, vscode\.Disposable/,
    'the Toolchain provider does not dispose its event emitter');
assert.match(extensionSource, /context\.subscriptions\.push\([\s\S]*toolchainProvider,/,
    'the Toolchain provider is not activation-owned');

assert.deepStrictEqual(parseWebviewMessage({
    type: 'setValue', documentVersion: 7, path: ['cpu', 'debug'], value: true,
}), { type: 'setValue', documentVersion: 7, path: ['cpu', 'debug'], value: true });
assert.deepStrictEqual(parseWebviewMessage({
    type: 'setValue', documentVersion: 7, path: ['peripherals', 0, 'name'], value: 'uart0',
}), { type: 'setValue', documentVersion: 7, path: ['peripherals', 0, 'name'], value: 'uart0' });
assert.deepStrictEqual(parseWebviewMessage({
    type: 'select', path: ['memory', 'ilb'],
}), { type: 'select', path: ['memory', 'ilb'] });
assert.strictEqual(parseWebviewMessage({
    type: 'select', documentVersion: 8, path: ['cpu'],
}), undefined, 'selection still accepts a stale-version field');
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
assert.strictEqual(isCurrentDocumentMessage({ type: 'select', path: ['cpu'] }, 99), true);
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
assert.deepStrictEqual(multiView.externalInterfacePresentation, [
    { index: 0, name: 'apb_ext0', highAddress: '0x10004fff' },
    { index: 1, name: 'axi0', highAddress: '0x20ffffff' },
]);
assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'setValue', documentVersion: 12,
    path: ['externalInterfaces', 0, 'highAddress'], value: '0x10005fff',
}), [{ path: ['externalInterfaces', 0, 'windowSize'], value: 8192 }]);
for (const invalidHighAddress of ['0x10003fff', '0x10004ff', '0x100000000']) {
    assert.strictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
        type: 'setValue', documentVersion: 12,
        path: ['externalInterfaces', 0, 'highAddress'], value: invalidHighAddress,
    }), undefined, `accepted invalid derived high address: ${invalidHighAddress}`);
}
const derivedRangeSource = applyReplacement(multiText, buildJsonReplacement(
    multiText,
    buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
        type: 'setValue', documentVersion: 12,
        path: ['externalInterfaces', 0, 'highAddress'], value: '0x10005fff',
    }),
));
const derivedRangeConfig = JSON.parse(derivedRangeSource);
assert.strictEqual(derivedRangeConfig.externalInterfaces[0].windowSize, 8192);
assert.strictEqual(Object.prototype.hasOwnProperty.call(
    derivedRangeConfig.externalInterfaces[0], 'highAddress'), false);
assert.ok(!multiView.catalog.modules.some((item) => item.type === 'apb_intc'));
assert.deepStrictEqual(multiView.interruptController, {
    peripheralIndex: 3,
    name: 'intc0',
    baseAddress: '0x10003000',
});
assert.deepStrictEqual(buildSocDocumentUpdates(parsedStandard.config, catalog, {
    type: 'setValue', documentVersion: 1,
    path: ['interrupt', 'mode'], value: 'controller',
}), [
    { path: ['peripherals', 1], value: { type: 'apb_intc', name: 'intc0' } },
    { path: ['interrupt'], value: { mode: 'controller', controller: 'intc0', sources: [] } },
]);
const controllerNameCollision = JSON.parse(standardJsonLf);
controllerNameCollision.peripherals[0].name = 'intc0';
assert.deepStrictEqual(buildSocDocumentUpdates(controllerNameCollision, catalog, {
    type: 'setValue', documentVersion: 1,
    path: ['interrupt', 'mode'], value: 'controller',
}), [
    { path: ['peripherals', 1], value: { type: 'apb_intc', name: 'intc1' } },
    { path: ['interrupt'], value: { mode: 'controller', controller: 'intc1', sources: [] } },
]);
assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'setValue', documentVersion: 12,
    path: ['interrupt', 'mode'], value: 'controller',
}), [{
    path: ['interrupt'],
    value: { mode: 'controller', controller: 'intc0', sources: [] },
}]);
assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'setValue', documentVersion: 12,
    path: ['interrupt', 'mode'], value: 'none',
}), [
    { path: ['peripherals', 3], value: undefined },
    { path: ['interrupt'], value: { mode: 'none' } },
]);
assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'setValue', documentVersion: 12,
    path: ['interrupt', 'mode'], value: 'direct',
}), [
    { path: ['peripherals', 3], value: undefined },
    { path: ['interrupt'], value: { mode: 'direct', source: 'external.irq' } },
]);
assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'setValue', documentVersion: 12,
    path: ['interrupt', 'controllerName'], value: 'irq_ctrl',
}), [
    { path: ['peripherals', 3, 'name'], value: 'irq_ctrl' },
    { path: ['interrupt', 'controller'], value: 'irq_ctrl' },
]);
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
assert.strictEqual(multiView.documentState, 'saved');

const dirtyView = buildSocEditorViewModel(
    multiText, multiFixture, 12, catalog, ['interrupt'],
    { actionId: 0, phase: 'idle', message: 'Idle.' },
    true,
);
assert.strictEqual(dirtyView.documentState, 'dirty');
assert.deepStrictEqual(dirtyView.interruptOptions.directSources, [
    { value: 'uart0.interrupt', label: 'uart0.interrupt', kind: 'peripheral' },
    { value: 'uart1.interrupt', label: 'uart1.interrupt', kind: 'peripheral' },
    { value: 'gpio0.interrupt', label: 'gpio0.interrupt', kind: 'peripheral' },
    { value: 'external', label: 'External interrupt', kind: 'external' },
]);
assert.deepStrictEqual(dirtyView.interruptOptions.routedSources,
    dirtyView.interruptOptions.directSources);

const brokenView = buildSocEditorViewModel(
    '{"cpu":', 'broken.merc32.json', 3, catalog, ['cpu'], undefined, false,
);
assert.strictEqual(brokenView.documentState, 'readOnly');

const activeGeneration = {
    actionId: 3,
    action: 'generate',
    phase: 'generating',
    message: 'Running generator...',
};
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
assert.ok(!html.includes('class="product-mark"'), 'HTML retains the redundant product mark');
assert.ok(!/>\s*(?:A\+|OK|&gt;|\{ \})\s*</.test(html),
    'HTML retains a toolbar pseudo-icon');
assert.ok(html.includes('id="generation-title">Status</h2>'),
    'non-generation failures are still labeled as Generation');
const resourceUris = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
assert.deepStrictEqual(resourceUris.sort(), [
    'vscode-webview-resource:/extension/resources/webview/socEditor.css',
    'vscode-webview-resource:/extension/resources/webview/socEditor.js',
]);

const webviewCss = require('fs').readFileSync(
    path.join(__dirname, '..', 'resources', 'webview', 'socEditor.css'), 'utf8');
const webviewScriptPath = path.join(__dirname, '..', 'resources', 'webview', 'socEditor.js');
const webviewJs = require('fs').readFileSync(webviewScriptPath, 'utf8');
const webviewController = require(webviewScriptPath);
assert.ok(webviewCss.includes('box-sizing: border-box'));
assert.ok(!/border-radius:\s*(?:9|[1-9]\d+)px/.test(webviewCss));
assert.ok(!webviewJs.includes('innerHTML'));
assert.ok(!/\.on(?:click|change|input|submit)\s*=/.test(webviewJs));
assert.strictEqual(typeof webviewController.createSocEditorApp, 'function');
assert.strictEqual(typeof webviewController.selectionForDiagnosticPath, 'function');
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

const publishedDiagnosticEntries = new Map([
    ['file:///untouched.merc32.json', [{ code: 'UNTOUCHED' }]],
]);
class FakeDiagnostic {
    constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
    }
}
const diagnosticDisposables = [];
let diagnosticChangeListener;
let diagnosticCloseListener;
const diagnosticVscode = {
    Diagnostic: FakeDiagnostic,
    DiagnosticSeverity: { Error: 0, Warning: 1 },
    Range: FakeRange,
    languages: {
        createDiagnosticCollection() {
            return {
                set(uriValue, diagnostics) {
                    publishedDiagnosticEntries.set(uriValue.toString(), diagnostics);
                },
                delete(uriValue) { publishedDiagnosticEntries.delete(uriValue.toString()); },
                clear() { publishedDiagnosticEntries.clear(); },
                dispose() {},
            };
        },
    },
    workspace: {
        textDocuments: [],
        onDidOpenTextDocument() {
            const disposable = { dispose() {} };
            diagnosticDisposables.push(disposable);
            return disposable;
        },
        onDidChangeTextDocument(listener) {
            diagnosticChangeListener = listener;
            const disposable = { dispose() {} };
            diagnosticDisposables.push(disposable);
            return disposable;
        },
        onDidCloseTextDocument(listener) {
            diagnosticCloseListener = listener;
            const disposable = { dispose() {} };
            diagnosticDisposables.push(disposable);
            return disposable;
        },
    },
};
const diagnosticDocumentUri = { toString: () => 'file:///standard.merc32.json' };
const diagnosticDocument = {
    ...fakeDocument,
    uri: diagnosticDocumentUri,
    fileName: 'C:\\workspace\\standard.merc32.json',
};
const diagnosticsService = new SocDiagnostics(
    path.join(__dirname, '..', 'resources'),
    diagnosticVscode,
);
const refreshedDiagnostics = diagnosticsService.refresh(diagnosticDocument);
assert.ok(refreshedDiagnostics.some((item) =>
    item.code === 'SOC_ADDRESS_REQUIRED'
    && JSON.stringify(item.path) === JSON.stringify(['peripherals', 0, 'baseAddress'])),
    'planner-only missing-address diagnostic was not refreshed');
const publishedMissingAddress = publishedDiagnosticEntries.get(diagnosticDocumentUri.toString())
    .find((item) => item.code === 'SOC_ADDRESS_REQUIRED');
assert.ok(publishedMissingAddress);
assert.match(
    standardJsonLf.slice(
        publishedMissingAddress.range.start.offset,
        publishedMissingAddress.range.end.offset,
    ),
    /"name": "uart0"/,
    'missing-property diagnostic did not map to its closest source object',
);

const generationDiagnostic = {
    severity: 'error',
    code: 'SOC_GENERATION_TEST',
    path: ['cpu', 'debug'],
    message: 'Injected generation diagnostic.',
};
const duplicateMissingAddress = refreshedDiagnostics.find((item) =>
    item.code === 'SOC_ADDRESS_REQUIRED');
diagnosticsService.refresh(diagnosticDocument, [generationDiagnostic, duplicateMissingAddress]);
const generationPublished = publishedDiagnosticEntries.get(diagnosticDocumentUri.toString());
assert.strictEqual(generationPublished.filter((item) => item.code === 'SOC_ADDRESS_REQUIRED').length, 1,
    'merged diagnostics published a duplicate planner error');
assert.strictEqual(generationPublished.filter((item) => item.code === 'SOC_GENERATION_TEST').length, 1,
    'generation diagnostic was not published');
const publishedGenerationDiagnostic = generationPublished.find((item) =>
    item.code === 'SOC_GENERATION_TEST');
assert.strictEqual(
    standardJsonLf.slice(
        publishedGenerationDiagnostic.range.start.offset,
        publishedGenerationDiagnostic.range.end.offset,
    ),
    'false',
    'generation diagnostic did not use the parser-backed source range',
);
assert.strictEqual(publishedDiagnosticEntries.get('file:///untouched.merc32.json')[0].code, 'UNTOUCHED',
    'refresh replaced diagnostics belonging to another document');
diagnosticsService.dispose();

const originalSetTimeout = global.setTimeout;
const originalClearTimeout = global.clearTimeout;
let controlledTimer;
global.setTimeout = (callback) => {
    controlledTimer = { callback, canceled: false };
    return controlledTimer;
};
global.clearTimeout = (timer) => { timer.canceled = true; };
try {
    const controlledDiagnostics = new SocDiagnostics(
        path.join(__dirname, '..', 'resources'),
        diagnosticVscode,
    );
    diagnosticChangeListener({ document: diagnosticDocument });
    assert.ok(controlledTimer, 'document edit did not schedule diagnostic refresh');
    controlledDiagnostics.refresh(diagnosticDocument, [generationDiagnostic]);
    assert.strictEqual(controlledTimer.canceled, true,
        'manual diagnostic publication did not cancel its pending debounce');
    controlledTimer.callback();
    const diagnosticsAfterStaleCallback = publishedDiagnosticEntries
        .get(diagnosticDocumentUri.toString());
    assert.strictEqual(diagnosticsAfterStaleCallback
        .filter((item) => item.code === 'SOC_GENERATION_TEST').length, 1,
        'stale debounce callback clobbered manually published generation diagnostics');

    diagnosticChangeListener({ document: diagnosticDocument });
    const closeTimer = controlledTimer;
    diagnosticCloseListener(diagnosticDocument);
    assert.strictEqual(closeTimer.canceled, true,
        'closing the document did not cancel its pending diagnostic refresh');
    assert.strictEqual(publishedDiagnosticEntries.has(diagnosticDocumentUri.toString()), false,
        'closing the document retained its published diagnostics');

    diagnosticChangeListener({ document: diagnosticDocument });
    const disposeTimer = controlledTimer;
    controlledDiagnostics.dispose();
    assert.strictEqual(disposeTimer.canceled, true,
        'disposing diagnostics did not cancel its pending refresh');
} finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
}

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

    const editorDocumentUri = {
        path: '/workspace/control_board.merc32.json',
        fsPath: 'C:\\workspace\\control_board.merc32.json',
        toString: () => 'file:///workspace/control_board.merc32.json',
    };
    const editorDocument = {
        uri: editorDocumentUri,
        fileName: editorDocumentUri.fsPath,
        version: 7,
        isDirty: true,
        getText: () => starterText,
        positionAt: (offset) => ({ offset }),
    };
    const editorMessages = [];
    const editorSubscriptions = [];
    let editorChangeListener;
    let editorSaveListener;
    let editorMessageListener;
    let editorDisposeListener;
    const disposable = (kind) => {
        const value = {
            kind,
            disposed: false,
            dispose() { this.disposed = true; },
        };
        editorSubscriptions.push(value);
        return value;
    };
    const editorVscode = {
        Uri: {
            joinPath(base, ...segments) {
                const joined = path.posix.join(base.path, ...segments);
                return {
                    path: joined,
                    fsPath: joined,
                    with(change) { return { ...this, ...change }; },
                    toString() { return this.path; },
                };
            },
        },
        workspace: {
            onDidChangeTextDocument(listener) {
                editorChangeListener = listener;
                return disposable('change');
            },
            onDidSaveTextDocument(listener) {
                editorSaveListener = listener;
                return disposable('save');
            },
        },
        commands: { executeCommand: async () => true },
    };
    const editorPanel = {
        webview: {
            cspSource: 'vscode-webview-resource:',
            asWebviewUri(value) { return value; },
            postMessage: async (message) => { editorMessages.push(message); return true; },
            onDidReceiveMessage(listener) {
                editorMessageListener = listener;
                return disposable('message');
            },
        },
        onDidDispose(listener) {
            editorDisposeListener = listener;
            return disposable('panel');
        },
    };
    const editorExtensionUri = {
        path: '/extension',
        fsPath: '/extension',
        with(change) { return { ...this, ...change }; },
    };
    const editorProvider = new Merc32SocEditorProvider(editorExtensionUri, catalog, editorVscode);
    await editorProvider.resolveCustomTextEditor(editorDocument, editorPanel);
    editorMessageListener({ type: 'ready' });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(editorMessages.at(-1).value.documentState, 'dirty');
    assert.strictEqual(typeof editorSaveListener, 'function',
        'custom editor did not subscribe to document saves');

    const stateCountBeforeOtherSave = editorMessages.length;
    editorSaveListener({ uri: { toString: () => 'file:///workspace/other.merc32.json' } });
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(editorMessages.length, stateCountBeforeOtherSave,
        'another document save refreshed this panel');

    editorDocument.isDirty = false;
    editorSaveListener(editorDocument);
    await new Promise((resolve) => setImmediate(resolve));
    assert.strictEqual(editorMessages.at(-1).value.documentState, 'saved',
        'same-version save did not deliver the Saved presentation state');
    assert.strictEqual(editorMessages.at(-1).value.documentVersion, 7);

    editorDisposeListener();
    assert.strictEqual(editorSubscriptions.find((item) => item.kind === 'save').disposed, true,
        'panel disposal retained its document-save listener');

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

    const compilerArtifactUri = uri('build/existing.hex');
    const missingCompilerArtifactUri = uri('build/missing.asm');
    const liveConfigUri = uri('configs/live.merc32.json');
    const liveOutputUri = uri('generated/live');
    const deadConfigUri = uri('configs/dead.merc32.json');
    const deadOutputUri = uri('generated/dead');
    const invalidManifestKinds = [
        'invalid-json',
        'read-failure',
        'legacy-v1',
        'missing-shape',
        'wrong-shape',
        'path-traversal',
        'unsafe-sibling',
        'source-mismatch',
    ];
    const invalidManifestUris = invalidManifestKinds.map((name) => ({
        name,
        configUri: uri(`configs/${name}.merc32.json`),
        outputUri: uri(`generated/${name}`),
    }));
    const linkedRecoveryUris = [
        ['linked-output', 'linked_output'],
        ['linked-manifest', 'linked_manifest'],
        ['linked-child', 'linked_child'],
        ['linked-child-ancestor', 'linked_child_ancestor'],
    ].map(([name, projectName]) => ({
        name,
        projectName,
        configUri: uri(`configs/${name}.merc32.json`),
        outputUri: uri(`generated/${name}`),
    }));
    const parseTestUri = (value) => {
        const parsed = new URL(value);
        return uri(decodeURIComponent(parsed.pathname).replace(/^\/workspace\//, ''));
    };
    const joinTestUri = (base, ...segments) => base.with({
        path: path.posix.join(base.path, ...segments),
    });
    const artifactWorkspaceUpdates = [];
    const persistedArtifacts = [
        { configUri: liveConfigUri.toString(), outputUri: liveOutputUri.toString() },
        { configUri: deadConfigUri.toString(), outputUri: deadOutputUri.toString() },
        { configUri: 'not a URI', outputUri: 'also not a URI' },
        ...invalidManifestUris.map(({ configUri, outputUri }) => ({
            configUri: configUri.toString(),
            outputUri: outputUri.toString(),
        })),
        ...linkedRecoveryUris.map(({ configUri, outputUri }) => ({
            configUri: configUri.toString(),
            outputUri: outputUri.toString(),
        })),
    ];
    const validLiveManifest = {
        files: [
            {
                kind: 'generated/documentation',
                logicalSource: 'templates/README.md.tpl',
                path: 'README.md',
                sha256: '1'.repeat(64),
            },
            {
                kind: 'generated/rtl-bundle',
                logicalSource: 'generator:renderRtlBundle',
                path: 'hardware/live.v',
                sha256: '2'.repeat(64),
            },
            {
                kind: 'generated/software-header',
                logicalSource: 'generator:renderSocHeader',
                path: 'software/live.h',
                sha256: '3'.repeat(64),
            },
            {
                kind: 'scaffold/user-owned',
                logicalSource: 'templates/main.c.tpl',
                path: 'software/main.c',
            },
            {
                kind: 'source/firmware',
                logicalSource: 'config:memory.ilb.initFile',
                path: 'firmware/ilb_boot.mem',
                sha256: '4'.repeat(64),
            },
            {
                kind: 'source/firmware',
                logicalSource: 'config:memory.dlb.initFile',
                path: 'firmware/dlb_data.bin',
                sha256: '5'.repeat(64),
            },
        ],
        generatorVersion: '2.0.0',
        manifestFile: {
            hashPolicy: 'excluded-self',
            kind: 'control/manifest',
            path: 'manifest.json',
        },
        manifestVersion: 2,
        projectName: 'live',
        resourceRevision: 'test-resource-revision',
        sourceConfig: 'C:/workspace/configs/live.merc32.json',
    };
    const manifestPayloads = new Map([
        [joinTestUri(liveOutputUri, 'manifest.json').toString(),
            Buffer.from(JSON.stringify(validLiveManifest))],
    ]);
    for (const { name, configUri, outputUri } of invalidManifestUris) {
        const manifestUri = joinTestUri(outputUri, 'manifest.json').toString();
        const sourceConfig = configUri.fsPath.replace(/\\/g, '/');
        if (name === 'invalid-json') {
            manifestPayloads.set(manifestUri, Buffer.from('{'));
        } else if (name === 'read-failure') {
            manifestPayloads.set(manifestUri, new Error('manifest read failed'));
        } else if (name === 'legacy-v1') {
            manifestPayloads.set(manifestUri, Buffer.from(JSON.stringify({
                ...validLiveManifest,
                manifestVersion: 1,
                sourceConfig,
            })));
        } else if (name === 'missing-shape') {
            const { files: _files, ...withoutFiles } = validLiveManifest;
            manifestPayloads.set(manifestUri, Buffer.from(JSON.stringify({
                ...withoutFiles,
                sourceConfig,
            })));
        } else if (name === 'wrong-shape') {
            manifestPayloads.set(manifestUri, Buffer.from(JSON.stringify({
                ...validLiveManifest,
                files: {},
                sourceConfig,
            })));
        } else if (name === 'path-traversal') {
            manifestPayloads.set(manifestUri, Buffer.from(JSON.stringify({
                ...validLiveManifest,
                files: validLiveManifest.files.map((item) => item.logicalSource === 'generator:renderRtlBundle'
                    ? { ...item, path: '../live.v' }
                    : item),
                sourceConfig,
            })));
        } else if (name === 'unsafe-sibling') {
            manifestPayloads.set(manifestUri, Buffer.from(JSON.stringify({
                ...validLiveManifest,
                files: [...validLiveManifest.files, {
                    kind: 'source/firmware',
                    logicalSource: 'config:memory.ilb.initFile',
                    path: '../outside.v',
                    sha256: '4'.repeat(64),
                }],
                sourceConfig,
            })));
        } else {
            manifestPayloads.set(manifestUri, Buffer.from(JSON.stringify({
                ...validLiveManifest,
                sourceConfig: 'C:/workspace/configs/someone-else.merc32.json',
            })));
        }
    }
    for (const { projectName, configUri, outputUri } of linkedRecoveryUris) {
        manifestPayloads.set(joinTestUri(outputUri, 'manifest.json').toString(),
            Buffer.from(JSON.stringify({
                ...validLiveManifest,
                projectName,
                sourceConfig: configUri.fsPath.replace(/\\/g, '/'),
                files: validLiveManifest.files.map((item) => ({
                    ...item,
                    path: item.path
                        .replace('hardware/live.v', `hardware/${projectName}.v`)
                        .replace('software/live.h', `software/${projectName}.h`),
                })),
            })));
    }
    const fileTypes = new Map([
        [compilerArtifactUri.toString(), 1],
        [liveOutputUri.toString(), 2],
        [joinTestUri(liveOutputUri, 'manifest.json').toString(), 1],
        [joinTestUri(liveOutputUri, 'README.md').toString(), 1],
        [joinTestUri(liveOutputUri, 'hardware/live.v').toString(), 1],
        [joinTestUri(liveOutputUri, 'software/live.h').toString(), 1],
        [joinTestUri(liveOutputUri, 'software/main.c').toString(), 1],
        [joinTestUri(liveOutputUri, 'firmware/ilb_boot.mem').toString(), 1],
        [joinTestUri(liveOutputUri, 'hardware').toString(), 2],
        [joinTestUri(liveOutputUri, 'software').toString(), 2],
        [joinTestUri(liveOutputUri, 'firmware').toString(), 2],
    ]);
    for (const { outputUri } of invalidManifestUris) {
        fileTypes.set(outputUri.toString(), 2);
        fileTypes.set(joinTestUri(outputUri, 'manifest.json').toString(), 1);
    }
    for (const { name, projectName, outputUri } of linkedRecoveryUris) {
        fileTypes.set(outputUri.toString(), name === 'linked-output' ? 66 : 2);
        fileTypes.set(joinTestUri(outputUri, 'manifest.json').toString(),
            name === 'linked-manifest' ? 65 : 1);
        fileTypes.set(joinTestUri(outputUri, 'README.md').toString(), 1);
        fileTypes.set(joinTestUri(outputUri, 'hardware').toString(),
            name === 'linked-child-ancestor' ? 66 : 2);
        fileTypes.set(joinTestUri(outputUri, `hardware/${projectName}.v`).toString(),
            name === 'linked-child' ? 65 : 1);
        fileTypes.set(joinTestUri(outputUri, 'software').toString(), 2);
        fileTypes.set(joinTestUri(outputUri, `software/${projectName}.h`).toString(), 1);
        fileTypes.set(joinTestUri(outputUri, 'software/main.c').toString(), 1);
        fileTypes.set(joinTestUri(outputUri, 'firmware').toString(), 2);
    }
    const artifactVscode = {
        FileType: { File: 1, Directory: 2, SymbolicLink: 64 },
        Uri: {
            parse: parseTestUri,
            file(value) { return uri(value.replace(/^C:\\workspace\\/, '').replace(/\\/g, '/')); },
            joinPath: joinTestUri,
            isUri(value) { return Boolean(value && typeof value.toString === 'function'); },
        },
        workspace: {
            fs: {
                async stat(value) {
                    const type = fileTypes.get(value.toString());
                    if (type === undefined) throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
                    return { type, ctime: 0, mtime: 0, size: 1 };
                },
                async readFile(value) {
                    const payload = manifestPayloads.get(value.toString());
                    assert.notStrictEqual(payload, undefined, `unexpected manifest read: ${value.toString()}`);
                    if (payload instanceof Error) throw payload;
                    return payload;
                },
            },
            asRelativePath(value) { return value.path.slice('/workspace/'.length); },
            async openTextDocument(value) {
                artifactOpenCalls.push(['openTextDocument', value]);
                return { uri: value };
            },
        },
        window: {
            async showTextDocument(document, options) {
                artifactOpenCalls.push(['showTextDocument', document, options]);
            },
        },
        commands: {
            async executeCommand(...args) { artifactOpenCalls.push(['executeCommand', ...args]); },
        },
        EventEmitter: class {
            constructor() {
                this.listeners = [];
                this.event = (listener) => {
                    this.listeners.push(listener);
                    return { dispose: () => { this.listeners = this.listeners.filter((item) => item !== listener); } };
                };
            }
            fire(value) { for (const listener of this.listeners) listener(value); }
            dispose() { this.listeners = []; }
        },
        TreeItem: class {
            constructor(label, collapsibleState) {
                this.label = label;
                this.collapsibleState = collapsibleState;
            }
        },
        TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
        ThemeIcon: class { constructor(id) { this.id = id; } },
    };
    const artifactWorkspaceState = {
        get(key, fallback) {
            assert.strictEqual(key, SOC_ARTIFACT_STATE_KEY);
            return persistedArtifacts ?? fallback;
        },
        async update(key, value) {
            artifactWorkspaceUpdates.push([key, value]);
        },
    };
    const artifactErrors = [];
    const artifactStore = new Merc32ArtifactStore(
        artifactWorkspaceState,
        artifactVscode,
        (error) => artifactErrors.push(error),
    );
    artifactStore.setCompilerArtifacts([
        { label: 'existing.hex', file: compilerArtifactUri.fsPath, description: 'Assembler output' },
        { label: 'missing.asm', file: missingCompilerArtifactUri.fsPath, description: 'Tiny C output' },
    ]);
    await artifactStore.refresh();
    const artifactSnapshot = artifactStore.getSnapshot();
    assert.deepStrictEqual(artifactSnapshot.compiler.map((item) => item.label), ['existing.hex'],
        'refresh retained a missing compiler artifact');
    const linkedChildRecovery = artifactSnapshot.generatedSocs.find((item) =>
        item.outputUri.toString() === linkedRecoveryUris[2].outputUri.toString());
    const linkedAncestorRecovery = artifactSnapshot.generatedSocs.find((item) =>
        item.outputUri.toString() === linkedRecoveryUris[3].outputUri.toString());
    assert.deepStrictEqual({
        linkedOutputRecovered: artifactSnapshot.generatedSocs.some((item) =>
            item.outputUri.toString() === linkedRecoveryUris[0].outputUri.toString()),
        linkedManifestRecovered: artifactSnapshot.generatedSocs.some((item) =>
            item.outputUri.toString() === linkedRecoveryUris[1].outputUri.toString()),
        linkedManagedChildExposed: linkedChildRecovery?.artifacts.some((item) =>
            item.relativePath === 'hardware/linked_child.v') ?? null,
        linkedAncestorChildExposed: linkedAncestorRecovery?.artifacts.some((item) =>
            item.relativePath === 'hardware/linked_child_ancestor.v') ?? null,
    }, {
        linkedOutputRecovered: false,
        linkedManifestRecovered: false,
        linkedManagedChildExposed: false,
        linkedAncestorChildExposed: false,
    }, 'artifact recovery accepted FileType 65/66 or a linked managed-child ancestor');
    assert.strictEqual(artifactSnapshot.generatedSocs.length, 3,
        'refresh retained a generated SoC with a missing output/manifest');
    assert.strictEqual(artifactSnapshot.generatedSocs[0].configUri.toString(), liveConfigUri.toString());
    assert.ok(artifactErrors.some((error) => String(error).includes('legacy-v1')),
        'persisted v1 manifest bypassed the existing invalid-manifest error callback');
    assert.deepStrictEqual(artifactSnapshot.generatedSocs[0].artifacts.map((item) => item.relativePath), [
        undefined,
        'manifest.json',
        'README.md',
        'hardware/live.v',
        'software/live.h',
        'software/main.c',
        'firmware/ilb_boot.mem',
    ], 'refresh retained a missing generated child or lost a required artifact');
    assert.deepStrictEqual(artifactWorkspaceUpdates.at(-1), [SOC_ARTIFACT_STATE_KEY, [{
        configUri: liveConfigUri.toString(),
        outputUri: liveOutputUri.toString(),
    }, ...linkedRecoveryUris.slice(2).map(({ configUri, outputUri }) => ({
        configUri: configUri.toString(),
        outputUri: outputUri.toString(),
    }))]], 'dead or linked-root persisted generated output was not removed from workspace state');

    const recordedConfigUri = uri('configs/recorded.merc32.json');
    const recordedOutputUri = uri('generated/recorded');
    const recordedManifestUri = joinTestUri(recordedOutputUri, 'manifest.json');
    fileTypes.set(recordedOutputUri.toString(), 2);
    fileTypes.set(recordedManifestUri.toString(), 1);
    manifestPayloads.set(recordedManifestUri.toString(), Buffer.from(JSON.stringify({
        ...validLiveManifest,
        projectName: 'recorded',
        sourceConfig: recordedConfigUri.fsPath.replace(/\\/g, '/'),
        files: validLiveManifest.files.map((item) => ({
            ...item,
            path: item.path
                .replace('hardware/live.v', 'hardware/recorded.v')
                .replace('software/live.h', 'software/recorded.h'),
        })),
    })));
    artifactWorkspaceUpdates.length = 0;
    await artifactStore.recordGeneratedSoc({
        configUri: recordedConfigUri,
        outputUri: recordedOutputUri,
        manifestUri: recordedManifestUri,
    });
    assert.deepStrictEqual(artifactWorkspaceUpdates.at(-1), [SOC_ARTIFACT_STATE_KEY, [
        { configUri: liveConfigUri.toString(), outputUri: liveOutputUri.toString() },
        ...linkedRecoveryUris.slice(2).map(({ configUri, outputUri }) => ({
            configUri: configUri.toString(),
            outputUri: outputUri.toString(),
        })),
        { configUri: recordedConfigUri.toString(), outputUri: recordedOutputUri.toString() },
    ]], 'validated generated SoC record was not persisted');

    artifactWorkspaceUpdates.length = 0;
    const invalidRecorded = invalidManifestUris.find((item) => item.name === 'invalid-json');
    await artifactStore.recordGeneratedSoc({
        configUri: invalidRecorded.configUri,
        outputUri: invalidRecorded.outputUri,
        manifestUri: joinTestUri(invalidRecorded.outputUri, 'manifest.json'),
    });
    assert.ok(artifactWorkspaceUpdates.length > 0, 'invalid record pruning was not persisted');
    assert.ok(artifactWorkspaceUpdates.every(([, records]) => records.every((item) =>
        item.outputUri !== invalidRecorded.outputUri.toString())),
    'invalid generated SoC record was persisted before validation');

    const artifactOpenCalls = [];
    const artifactProvider = new Merc32ArtifactsProvider(artifactStore, artifactVscode);
    const artifactRoots = artifactProvider.getChildren();
    const compilerNode = artifactRoots.find((item) => item.label === 'existing.hex');
    assert.ok(compilerNode, 'shared compiler artifact was absent from the Artifacts view');
    assert.strictEqual(await artifactProvider.openArtifact({ kind: 'file', uri: compilerArtifactUri }), false,
        'raw artifact-shaped input was accepted');
    assert.strictEqual(await artifactProvider.openArtifact(compilerNode), true);
    assert.deepStrictEqual(artifactOpenCalls.map((call) => call[0]), [
        'openTextDocument',
        'showTextDocument',
    ], 'file artifact did not use openTextDocument plus showTextDocument');
    assert.strictEqual(artifactOpenCalls[0][1].toString(), compilerArtifactUri.toString());
    assert.strictEqual(artifactOpenCalls[1][1].uri, artifactOpenCalls[0][1]);
    assert.deepStrictEqual(artifactOpenCalls[1][2], { preview: false });
    artifactOpenCalls.length = 0;
    const socGroup = artifactRoots.find((item) => item.kind === 'group');
    const outputDirectoryNode = artifactProvider.getChildren(socGroup)
        .find((item) => item.kind === 'directory');
    assert.strictEqual(await artifactProvider.openArtifact(outputDirectoryNode), true);
    assert.strictEqual(artifactOpenCalls.length, 1);
    assert.deepStrictEqual(artifactOpenCalls[0].slice(0, 2), ['executeCommand', 'revealFileInOS'],
        'directory artifact did not use revealFileInOS');
    assert.strictEqual(artifactOpenCalls[0][2].toString(), liveOutputUri.toString());
    artifactProvider.dispose();

    const oldRaceArtifactUri = uri('build/race-old.hex');
    const newRaceArtifactUri = uri('build/race-new.hex');
    let releaseOldStat;
    let markOldStatStarted;
    const oldStatStarted = new Promise((resolve) => { markOldStatStarted = resolve; });
    const oldStatResult = new Promise((resolve) => { releaseOldStat = resolve; });
    const raceVscode = {
        ...artifactVscode,
        workspace: {
            ...artifactVscode.workspace,
            fs: {
                ...artifactVscode.workspace.fs,
                async stat(value) {
                    if (value.toString() === oldRaceArtifactUri.toString()) {
                        markOldStatStarted();
                        return oldStatResult;
                    }
                    if (value.toString() === newRaceArtifactUri.toString()) {
                        return { type: 1, ctime: 0, mtime: 0, size: 1 };
                    }
                    throw Object.assign(new Error('missing'), { code: 'FileNotFound' });
                },
            },
        },
    };
    const raceStore = new Merc32ArtifactStore({
        get: (_key, fallback) => fallback,
        update: async () => {},
    }, raceVscode);
    const compilerPublications = [];
    raceStore.subscribe(() => {
        compilerPublications.push(raceStore.getCompilerArtifacts().map((item) => item.label));
    });
    raceStore.setCompilerArtifacts([{ label: 'race-old.hex', file: oldRaceArtifactUri.fsPath }]);
    const racingRefresh = raceStore.refresh();
    await oldStatStarted;
    raceStore.setCompilerArtifacts([{ label: 'race-new.hex', file: newRaceArtifactUri.fsPath }]);
    assert.deepStrictEqual(raceStore.getCompilerArtifacts().map((item) => item.label), ['race-new.hex'],
        'compiler setter was blocked behind an in-flight refresh');
    releaseOldStat({ type: 1, ctime: 0, mtime: 0, size: 1 });
    await racingRefresh;
    assert.deepStrictEqual(raceStore.getCompilerArtifacts().map((item) => item.label), ['race-new.hex'],
        'refresh overwrote the newer compiler artifact publication');
    assert.deepStrictEqual(compilerPublications.at(-1), ['race-new.hex'],
        'refresh fired a stale compiler artifact event');
    raceStore.dispose();

    const watcherDisposals = [];
    const watchers = [];
    let workspaceFolderListener;
    class FakeRelativePattern {
        constructor(base, patternValue) {
            this.base = base;
            this.pattern = patternValue;
        }
    }
    const workspaceFolders = [
        { name: 'root-one', uri: uri('root-one') },
        { name: 'root-two', uri: uri('root-two') },
    ];
    const discoveredByRoot = new Map([
        ['root-one', [uri('root-one/z.merc32.json')]],
        ['root-two', [uri('root-two/peripherals/b.merc32.json'), uri('root-two/peripherals/a.merc32.json')]],
    ]);
    const configurationVscode = {
        ...artifactVscode,
        RelativePattern: FakeRelativePattern,
        workspace: {
            workspaceFolders,
            async findFiles(patternValue) {
                assert.ok(patternValue instanceof FakeRelativePattern);
                assert.strictEqual(patternValue.pattern, '**/*.merc32.json');
                return discoveredByRoot.get(patternValue.base.name) ?? [];
            },
            asRelativePath(value, includeWorkspaceFolder) {
                assert.strictEqual(includeWorkspaceFolder, true);
                return value.path.slice('/workspace/'.length);
            },
            createFileSystemWatcher(patternValue) {
                assert.ok(patternValue instanceof FakeRelativePattern);
                const listeners = { create: [], change: [], delete: [] };
                const watcher = {
                    patternValue,
                    listeners,
                    onDidCreate(listener) { listeners.create.push(listener); return trackedDisposable('create'); },
                    onDidChange(listener) { listeners.change.push(listener); return trackedDisposable('change'); },
                    onDidDelete(listener) { listeners.delete.push(listener); return trackedDisposable('delete'); },
                    dispose() { watcherDisposals.push('watcher'); },
                };
                watchers.push(watcher);
                return watcher;
            },
            onDidChangeWorkspaceFolders(listener) {
                workspaceFolderListener = listener;
                return trackedDisposable('workspace-folders');
            },
        },
    };
    function trackedDisposable(kind) {
        return { dispose() { watcherDisposals.push(kind); } };
    }
    const configurationProvider = await SocConfigurationProvider.create(configurationVscode);
    assert.strictEqual(watchers.length, 2, 'did not create one watcher per workspace folder');
    assert.deepStrictEqual(configurationProvider.getChildren()
        .map((item) => item.workspaceRelativePath), [
        'root-one/z.merc32.json',
        'root-two/peripherals/a.merc32.json',
        'root-two/peripherals/b.merc32.json',
    ]);
    watchers[0].listeners.change[0](uri('root-one/new.merc32.json'));
    await configurationProvider.refresh();
    workspaceFolderListener({ added: [], removed: [] });
    await configurationProvider.refresh();
    assert.strictEqual(watchers.length, 4,
        'workspace-folder changes did not rebuild one watcher per current folder');
    configurationProvider.dispose();
    assert.strictEqual(watcherDisposals.filter((kind) => kind === 'watcher').length, 4);
    assert.strictEqual(watcherDisposals.filter((kind) => kind === 'create').length, 4);
    assert.strictEqual(watcherDisposals.filter((kind) => kind === 'change').length, 4);
    assert.strictEqual(watcherDisposals.filter((kind) => kind === 'delete').length, 4);
    assert.strictEqual(watcherDisposals.filter((kind) => kind === 'workspace-folders').length, 1);

    const explicitUri = uri('explicit.merc32.json');
    const activeUri = uri('active.merc32.json');
    const workspaceUri = uri('workspace.merc32.json');
    const otherWorkspaceUri = uri('other.merc32.json');
    const resolverCalls = [];
    const resolverVscode = {
        Uri: {
            isUri(value) {
                return Boolean(value && typeof value.scheme === 'string'
                    && typeof value.path === 'string' && typeof value.fsPath === 'string');
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
        version: 7,
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

    assignmentVscode.window.showWarningMessage = async () => {
        assignmentDocument.version += 1;
        return 'Assign';
    };
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
    }), false, 'assignment used a preview from an older document version');
    assert.strictEqual(assignmentUpdates, undefined,
        'assignment changed the edited document using stale JSON paths');

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
            file(value) {
                let uriPath = value.replace(/\\/g, '/');
                if (/^[A-Za-z]:\//.test(uriPath)) uriPath = `/${uriPath}`;
                if (!uriPath.startsWith('/')) uriPath = `/${uriPath}`;
                return {
                    scheme: 'file',
                    authority: '',
                    path: uriPath,
                    fsPath: value,
                    with(change) { return { ...this, ...change }; },
                    toString() { return `file://${this.path}`; },
                };
            },
        },
        ProgressLocation: { Notification: 15 },
        window: {
            tabGroups: { activeTabGroup: { activeTab: undefined } },
            async withProgress(_options, task) {
                return task({ report(value) { generationCalls.push(['progress', value.message]); } });
            },
            async showErrorMessage(message) { generationCalls.push(['error', message]); },
            async showWarningMessage(message) { generationCalls.push(['warning', message]); },
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
            const result = {
                outputDir: 'C:\\workspace\\generated\\edit_soc',
                manifestFile: 'C:\\workspace\\generated\\edit_soc\\manifest.json',
                files: [], warnings: [], skippedUserFiles: [],
            };
            generationCalls.push(['generateReturn']);
            return result;
        },
    };
    assert.strictEqual(typeof workspaceUriFromFsPath, 'function',
        'workspace-provider URI conversion helper is missing');
    const localGeneratedUri = workspaceUriFromFsPath(
        explicitUri,
        'C:\\workspace\\generated\\edit_soc',
        generationVscode,
    );
    assert.deepStrictEqual({
        scheme: localGeneratedUri.scheme,
        authority: localGeneratedUri.authority,
        path: localGeneratedUri.path,
    }, {
        scheme: 'file',
        authority: '',
        path: '/C:/workspace/generated/edit_soc',
    });

    const remoteConfigUri = {
        scheme: 'vscode-remote',
        authority: 'ssh-remote+unit-host',
        path: '/workspace/remote.merc32.json',
        fsPath: '/workspace/remote.merc32.json',
        with(change) { return { ...this, ...change }; },
        toString() { return `${this.scheme}://${this.authority}${this.path}`; },
    };
    const remoteGeneratedUri = workspaceUriFromFsPath(
        remoteConfigUri,
        '/workspace/generated/remote_soc',
        generationVscode,
    );
    assert.deepStrictEqual({
        scheme: remoteGeneratedUri.scheme,
        authority: remoteGeneratedUri.authority,
        path: remoteGeneratedUri.path,
    }, {
        scheme: 'vscode-remote',
        authority: 'ssh-remote+unit-host',
        path: '/workspace/generated/remote_soc',
    });
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
        async (status) => {
            statusMessages.push(status.message);
            generationCalls.push(['status', status.message]);
        },
    ), true);
    const generateCall = generationCalls.find(([kind]) => kind === 'generate');
    assert.deepStrictEqual(generateCall[1], {
        configFile: explicitUri.fsPath,
        assetRoot: 'C:\\extension\\resources',
        force: true,
    });
    assert.ok(!Object.prototype.hasOwnProperty.call(generateCall[1], 'adoptOutput'),
        'force generation also enabled adoption');
    assert.ok(statusMessages.some((message) => /running generator/i.test(message)));
    const generatorEventIndex = generationCalls.findIndex(([kind]) => kind === 'generate');
    const generatorReturnIndex = generationCalls.findIndex(([kind]) => kind === 'generateReturn');
    const neutralStatusIndex = generationCalls.findIndex(([kind, message]) =>
        kind === 'status' && /generating soc|running generator/i.test(message));
    const activatedStatusIndex = generationCalls.findIndex(([kind, message]) =>
        kind === 'status' && /activated|activat.*complet|complet.*activation/i.test(message));
    assert.ok(neutralStatusIndex >= 0 && neutralStatusIndex < generatorEventIndex,
        'neutral generation status was not published before generator invocation');
    const statusBeforeGeneratorReturn = generationCalls
        .slice(0, generatorReturnIndex)
        .filter(([kind]) => kind === 'status')
        .map(([, message]) => message);
    assert.ok(statusBeforeGeneratorReturn.every((message) =>
        !/planning|staging|activation|activated|completed/i.test(message)),
        `pre-return status claimed internal generator phases: ${statusBeforeGeneratorReturn.join(' | ')}`);
    assert.ok(activatedStatusIndex > generatorReturnIndex,
        'activation completion was published before the synchronous generator returned');
    assert.strictEqual(generatedRecord.configUri, explicitUri);
    assert.deepStrictEqual({
        scheme: generatedRecord.outputUri.scheme,
        authority: generatedRecord.outputUri.authority,
        path: generatedRecord.outputUri.path,
    }, {
        scheme: 'file', authority: '', path: '/C:/workspace/generated/edit_soc',
    });
    assert.ok(generationCalls.some(([kind, command]) =>
        kind === 'command' && command === 'revealFileInOS'));

    const reveal = createDeferred();
    const originalExecuteCommand = generationVscode.commands.executeCommand;
    const revealVscode = {
        ...generationVscode,
        commands: {
            async executeCommand(command, ...args) {
                if (command === 'revealFileInOS') return reveal.promise;
                return originalExecuteCommand(command, ...args);
            },
        },
    };
    const nonBlockingServices = {
        ...successfulServices,
        vscodeApi: revealVscode,
    };
    const generation = runSocGeneration(explicitUri, 'normal', nonBlockingServices);
    assert.strictEqual(await settlesWithin(generation, 250), true,
        'successful generation waited for revealFileInOS');
    reveal.resolve(undefined);

    generationCalls.length = 0;
    const rejectedReveal = createDeferred();
    const rejectedRevealVscode = {
        ...generationVscode,
        commands: {
            async executeCommand(command, ...args) {
                if (command === 'revealFileInOS') return rejectedReveal.promise;
                return originalExecuteCommand(command, ...args);
            },
        },
    };
    const rejectedRevealServices = {
        ...successfulServices,
        vscodeApi: rejectedRevealVscode,
    };
    const rejectedGeneration = runSocGeneration(explicitUri, 'normal', rejectedRevealServices);
    rejectedReveal.reject(new Error('shell integration unavailable'));
    assert.strictEqual(await rejectedGeneration, true,
        'rejected reveal changed the successful generation outcome');
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok(generationCalls.some(([kind, message]) =>
        kind === 'warning' && /generated/i.test(message) && /shell integration unavailable/i.test(message)),
    'rejected reveal was not reported as a generation warning');

    for (const ancillaryFailure of ['artifact recording', 'output reveal']) {
        generationCalls.length = 0;
        const ancillaryStatuses = [];
        let ancillaryRecord;
        const ancillaryServices = {
            ...generationServices,
            artifacts: {
                async recordGeneratedSoc(record) {
                    ancillaryRecord = record;
                    if (ancillaryFailure === 'artifact recording') throw new Error('artifact store unavailable');
                },
            },
        };
        generationVscode.commands.executeCommand = async (...args) => {
            generationCalls.push(['command', ...args]);
            if (ancillaryFailure === 'output reveal') throw new Error('shell integration unavailable');
        };
        await executeSocEditorCommand(
            'generate',
            explicitUri,
            async (_command, commandUri, reportStatus) =>
                runSocGeneration(commandUri, 'normal', ancillaryServices, reportStatus),
            async (status) => { ancillaryStatuses.push(status); },
        );
        assert.strictEqual(ancillaryStatuses.at(-1).phase, 'generated',
            `${ancillaryFailure} failure falsely reported successful generation as failed`);
        assert.ok(generationCalls.some(([kind, message]) =>
            kind === 'warning' && /generated/i.test(message) && /warning/i.test(message)),
        `${ancillaryFailure} failure was not reported as a generation warning`);
        assert.strictEqual(ancillaryRecord.configUri, explicitUri,
            `${ancillaryFailure} discarded the generated artifact record`);
        if (ancillaryFailure === 'artifact recording') {
            assert.ok(generationCalls.some(([kind, command]) =>
                kind === 'command' && command === 'revealFileInOS'),
            'artifact recording failure prevented the generated output reveal attempt');
        }
    }
    generationVscode.commands.executeCommand = async (...args) => {
        generationCalls.push(['command', ...args]);
    };

    generationCalls.length = 0;
    let remoteGeneratedRecord;
    const remoteServices = {
        ...successfulServices,
        artifacts: {
            async recordGeneratedSoc(record) { remoteGeneratedRecord = record; },
        },
        generate: () => ({
            outputDir: '/workspace/generated/remote_soc',
            manifestFile: '/workspace/generated/remote_soc/manifest.json',
            files: [], warnings: [], skippedUserFiles: [],
        }),
    };
    assert.strictEqual(await runSocGeneration(remoteConfigUri, 'normal', remoteServices), true);
    assert.strictEqual(remoteGeneratedRecord.configUri, remoteConfigUri);
    assert.deepStrictEqual({
        scheme: remoteGeneratedRecord.outputUri.scheme,
        authority: remoteGeneratedRecord.outputUri.authority,
        path: remoteGeneratedRecord.outputUri.path,
    }, {
        scheme: 'vscode-remote',
        authority: 'ssh-remote+unit-host',
        path: '/workspace/generated/remote_soc',
    });
    assert.deepStrictEqual({
        scheme: remoteGeneratedRecord.manifestUri.scheme,
        authority: remoteGeneratedRecord.manifestUri.authority,
        path: remoteGeneratedRecord.manifestUri.path,
    }, {
        scheme: 'vscode-remote',
        authority: 'ssh-remote+unit-host',
        path: '/workspace/generated/remote_soc/manifest.json',
    });
    const remoteReveal = generationCalls.find(([kind, command]) =>
        kind === 'command' && command === 'revealFileInOS');
    assert.strictEqual(remoteReveal[2], remoteGeneratedRecord.outputUri);

    generationCalls.length = 0;
    const failedGenerationStatuses = [];
    let generationRefreshExtras;
    successfulServices.diagnostics = {
        refresh(_document, additionalDiagnostics) {
            generationRefreshExtras = additionalDiagnostics;
            return [];
        },
    };
    successfulServices.generate = () => {
        throw new (require('../out/soc').SocGenerationError)(
            'Generated files conflict with the existing output.',
            [generationDiagnostic],
            [{ path: 'rtl/edit_soc.v', reason: 'modified-managed' }],
        );
    };
    assert.strictEqual(await runSocGeneration(
        explicitUri,
        'normal',
        successfulServices,
        async (status) => { failedGenerationStatuses.push(status.message); },
    ), false,
        'handled generator conflict did not return false');
    assert.ok(generationCalls.some(([kind, value]) =>
        kind === 'output' && /rtl\/edit_soc\.v.*modified-managed/.test(value)));
    assert.strictEqual(generationCalls.filter(([kind]) => kind === 'error').length, 1);
    assert.deepStrictEqual(generationRefreshExtras, [generationDiagnostic],
        'generation diagnostics were not forwarded to the publisher');
    assert.ok(!failedGenerationStatuses.some((message) =>
        /planning|staging|activation|activated|completed/i.test(message)),
        'failed generation received an unobservable internal-phase status');

    const commandHandlers = new Map();
    const registeredCalls = [];
    const createdUri = uri('Control Board.merc32.json');
    let saveDialogUri = createdUri;
    let confirmAction;
    let registeredDocumentText = starterText;
    let registeredDocumentVersion = 11;
    let registeredDocumentDirty = false;
    let registeredSaveCalls = 0;
    let mutateDuringConfirmation;
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
                mutateDuringConfirmation?.();
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
                    get version() { return registeredDocumentVersion; },
                    get isDirty() { return registeredDocumentDirty; },
                    async save() {
                        registeredSaveCalls += 1;
                        registeredDocumentDirty = false;
                        return true;
                    },
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
    mutateDuringConfirmation = () => {
        registeredDocumentText = starterText.replace(
            'generated/control_board', 'generated/changed_during_force');
        registeredDocumentVersion += 1;
        registeredDocumentDirty = true;
    };
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.forceGenerate)(explicitUri), false,
        'force generation used confirmation from an older configuration snapshot');
    assert.strictEqual(registeredGeneratedOptions.length, 0,
        'force generation ran after the confirmed output binding changed');
    assert.strictEqual(registeredSaveCalls, 0,
        'stale force confirmation saved a document version that was never confirmed');
    mutateDuringConfirmation = undefined;
    registeredDocumentText = starterText;
    registeredDocumentDirty = false;
    registeredDocumentVersion += 1;
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.forceGenerate)(explicitUri), true);
    assert.deepStrictEqual(registeredGeneratedOptions.pop(), {
        configFile: explicitUri.fsPath,
        assetRoot: 'C:\\extension\\resources',
        force: true,
    });

    registeredCalls.length = 0;
    confirmAction = 'Adopt Output';
    mutateDuringConfirmation = () => {
        registeredDocumentText = starterText.replace(
            'generated/control_board', 'generated/changed_during_adopt');
        registeredDocumentVersion += 1;
        registeredDocumentDirty = true;
    };
    assert.strictEqual(await commandHandlers.get(SOC_COMMANDS.adoptOutput)(explicitUri), false,
        'output adoption used confirmation from an older configuration snapshot');
    assert.strictEqual(registeredGeneratedOptions.length, 0,
        'output adoption ran after the confirmed output directory changed');
    assert.strictEqual(registeredSaveCalls, 0,
        'stale adoption confirmation saved a document version that was never confirmed');
    mutateDuringConfirmation = undefined;
    registeredDocumentText = starterText;
    registeredDocumentDirty = false;
    registeredDocumentVersion += 1;
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
