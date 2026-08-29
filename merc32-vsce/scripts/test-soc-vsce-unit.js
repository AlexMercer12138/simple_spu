const assert = require('assert');

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

console.log('MERC32 VSCode SoC unit contracts passed.');
