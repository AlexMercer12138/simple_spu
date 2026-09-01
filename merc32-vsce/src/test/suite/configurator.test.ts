import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import * as vscode from 'vscode';

import { SOC_COMMANDS, SOC_EDITOR_VIEW_TYPE } from '../../constants';
import { runAutoAssign, runSocGeneration } from '../../socCommands';
import { applySocDocumentUpdates } from '../../socEditorProvider';
import {
    Merc32ArtifactStore,
    SOC_ARTIFACT_STATE_KEY,
} from '../../socExplorer';
import { loadCatalog } from '../../soc';

const EXTENSION_ID = 'Vikai-mercer.merc32-vsce';
const POLL_INTERVAL_MS = 25;
const DEFAULT_DEADLINE_MS = 15_000;

suite('MERC32 SoC configurator extension host', () => {
    const workspacePath = requiredEnvironment('MERC32_TEST_WORKSPACE');
    const fixturePath = path.join(workspacePath, 'minimal.merc32.json');

    teardown(async () => {
        await closeAllEditors();
    });

    test('activates the extension and associates only compound SoC JSON with the custom editor', async () => {
        assert.strictEqual(vscode.version, requiredEnvironment('MERC32_TEST_VSCODE_VERSION'));
        const configUri = vscode.Uri.file(fixturePath);
        await vscode.commands.executeCommand('vscode.open', configUri);
        const customInput = await waitFor('compound SoC JSON to open as a custom editor', () => {
            const input = activeInputFor(configUri);
            return input instanceof vscode.TabInputCustom ? input : undefined;
        });
        assert.strictEqual(customInput.viewType, SOC_EDITOR_VIEW_TYPE);

        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} was not installed in the development host`);
        await waitFor('extension activation after resolving the custom editor', () => extension.isActive);

        const settingsUri = vscode.Uri.file(path.join(workspacePath, 'settings.json'));
        fs.writeFileSync(settingsUri.fsPath, '{\n  "editor.wordWrap": "off"\n}\n', 'utf8');
        await vscode.commands.executeCommand('vscode.open', settingsUri);
        const textInput = await waitFor('ordinary settings.json to open as text', () => {
            const input = activeInputFor(settingsUri);
            return input instanceof vscode.TabInputText ? input : undefined;
        });
        assert.ok(textInput instanceof vscode.TabInputText);
        assert.ok(!(textInput instanceof vscode.TabInputCustom));
    });

    test('publishes the exact second overlap range and clears it after Undo', async () => {
        const config = fixtureConfig('overlap_host', 'generated/overlap_host');
        config.peripherals = [
            { type: 'apb_uart', name: 'uart0', baseAddress: '0x10000000' },
            { type: 'apb_gpio', name: 'gpio0', baseAddress: '0x10001000' },
        ];
        const uri = writeConfig('overlap.merc32.json', config);
        await openCustomEditor(uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const original = document.getText();
        const secondAddressOffset = original.lastIndexOf('0x10001000');
        assert.ok(secondAddressOffset > 0, 'second endpoint address is missing from the fixture');
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, new vscode.Range(
            document.positionAt(secondAddressOffset),
            document.positionAt(secondAddressOffset + '0x10001000'.length),
        ), '0x10000000');
        assert.strictEqual(await vscode.workspace.applyEdit(edit), true);

        const diagnostic = await waitFor('the semantic overlap diagnostic', () =>
            socDiagnostics(uri).find((item) => diagnosticCode(item) === 'SOC_ADDRESS_OVERLAP'));
        const updated = document.getText();
        const expectedOffset = updated.lastIndexOf('"0x10000000"');
        assert.strictEqual(document.offsetAt(diagnostic.range.start), expectedOffset);
        assert.strictEqual(
            document.offsetAt(diagnostic.range.end),
            expectedOffset + '"0x10000000"'.length,
        );

        await vscode.commands.executeCommand('undo');
        await waitFor('Undo to restore the second endpoint address', () =>
            document.getText().includes('"baseAddress": "0x10001000"'));
        await waitFor('the overlap diagnostic to clear after Undo', () =>
            socDiagnostics(uri).every((item) => diagnosticCode(item) !== 'SOC_ADDRESS_OVERLAP'));
    });

    test('keeps helper edits dirty and synchronized through save, Undo, and Redo', async () => {
        const uri = writeConfig('document-state.merc32.json',
            fixtureConfig('document_state_host', 'generated/document_state_host'));
        await openCustomEditor(uri);
        const document = await vscode.workspace.openTextDocument(uri);

        assert.strictEqual(await applySocDocumentUpdates(document, [
            { path: ['cpu', 'debug'], value: true },
        ]), true);
        await waitFor('the real document to become dirty with cpu.debug enabled', () =>
            document.isDirty && parsedConfig(document).cpu.debug === true);
        assert.strictEqual(await document.save(), true);
        await waitFor('the saved document to become clean', () => !document.isDirty);

        await vscode.commands.executeCommand('undo');
        await waitFor('Undo to restore cpu.debug=false in the backing document', () =>
            document.isDirty && parsedConfig(document).cpu.debug === false);
        await vscode.commands.executeCommand('redo');
        await waitFor('Redo to restore the saved cpu.debug=true state', () =>
            !document.isDirty && parsedConfig(document).cpu.debug === true);
    });

    test('preserves invalid JSON bytes during Validate and reopens it as text', async () => {
        const uri = writeConfig('invalid.merc32.json',
            fixtureConfig('invalid_host', 'generated/invalid_host'));
        await openCustomEditor(uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const invalidText = '{\n  "schemaVersion": 1,\n';
        const edit = new vscode.WorkspaceEdit();
        edit.replace(uri, fullDocumentRange(document), invalidText);
        assert.strictEqual(await vscode.workspace.applyEdit(edit), true);
        assert.strictEqual(await document.save(), true);
        const before = fs.readFileSync(uri.fsPath);

        const validation = vscode.commands.executeCommand<boolean>(SOC_COMMANDS.validate, uri);
        await waitFor('an invalid-JSON syntax diagnostic', () =>
            socDiagnostics(uri).find((item) => diagnosticCode(item) === 'SOC_JSON_SYNTAX'));
        assert.deepStrictEqual(fs.readFileSync(uri.fsPath), before);
        assert.strictEqual(document.getText(), invalidText);
        await vscode.commands.executeCommand('notifications.clearAll');
        assert.strictEqual(await validation, false);

        assert.strictEqual(
            await vscode.commands.executeCommand<boolean>(SOC_COMMANDS.reopenAsText, uri),
            true,
        );
        const input = await waitFor('invalid JSON to reopen in the text editor', () => {
            const current = activeInputFor(uri);
            return current instanceof vscode.TabInputText ? current : undefined;
        });
        assert.ok(!(input instanceof vscode.TabInputCustom));
    });

    test('auto-assignment changes only missing addresses in one real document edit', async () => {
        const config = fixtureConfig('assign_host', 'generated/assign_host');
        config.peripherals = [
            { type: 'apb_gpio', name: 'gpio_missing' },
            { type: 'apb_uart', name: 'uart_fixed', baseAddress: '0x10000000' },
        ];
        const uri = writeConfig('assign.merc32.json', config);
        await openCustomEditor(uri);
        const document = await vscode.workspace.openTextDocument(uri);
        const before = JSON.parse(JSON.stringify(config)) as MutableSocConfig;
        const services = commandServices(confirmationVscode());

        assert.strictEqual(await runAutoAssign(uri, services), true);
        const after = await waitFor('the missing address to be assigned', () => {
            const value = parsedConfig(document);
            return value.peripherals[0].baseAddress ? value : undefined;
        });
        assert.strictEqual(after.peripherals[1].baseAddress, '0x10000000');
        delete after.peripherals[0].baseAddress;
        assert.deepStrictEqual(after, before);
        assert.strictEqual(await document.save(), true);
    });

    test('generates distinct artifact groups and enforces conflict, force, main, and ownership rules',
        async function () {
            this.timeout(120_000);
            const extension = vscode.extensions.getExtension(EXTENSION_ID);
            assert.ok(extension?.isActive, 'the real MERC32 extension is not active');
            const configA = fixtureConfig('host_a', 'generated/host-a');
            const configB = fixtureConfig('host_b', 'generated/host-b');
            const uriA = writeConfig('host-a.merc32.json', configA);
            const uriB = writeConfig('host-b.merc32.json', configB);
            const memento = new MemoryMemento();
            const store = new Merc32ArtifactStore(memento, vscode);
            const services = commandServices(generationVscode(), store, extension.extensionUri);

            assert.strictEqual(await runSocGeneration(uriA, 'normal', services), true);
            assert.strictEqual(await runSocGeneration(uriB, 'normal', services), true);
            const outputA = path.join(workspacePath, 'generated', 'host-a');
            const outputB = path.join(workspacePath, 'generated', 'host-b');
            assert.ok(fs.existsSync(path.join(outputA, 'manifest.json')));
            assert.ok(fs.existsSync(path.join(outputB, 'manifest.json')));
            assert.notStrictEqual(path.resolve(outputA), path.resolve(outputB));

            const initialGroups = store.getSnapshot().generatedSocs;
            assert.strictEqual(initialGroups.length, 2);
            assert.deepStrictEqual(
                initialGroups.map((group) => comparablePath(group.outputUri.fsPath)).sort(),
                [comparablePath(outputA), comparablePath(outputB)].sort(),
            );
            for (const group of initialGroups) {
                assert.deepStrictEqual(group.artifacts.map((item) => item.relativePath), [
                    undefined,
                    'manifest.json',
                    'README.md',
                    `hardware/${path.basename(group.outputUri.fsPath) === 'host-a' ? 'host_a' : 'host_b'}.v`,
                    `software/${path.basename(group.outputUri.fsPath) === 'host-a' ? 'host_a' : 'host_b'}.h`,
                    'software/main.c',
                ]);
            }
            const persisted = memento.get<unknown[]>(SOC_ARTIFACT_STATE_KEY, []);
            assert.strictEqual(persisted.length, 2);

            const mainFile = path.join(outputA, 'software', 'main.c');
            const managedTop = path.join(outputA, 'hardware', 'host_a.v');
            const originalTop = fs.readFileSync(managedTop);
            const userMain = Buffer.from('/* exact user program */\nint main(void) { return 7; }\n', 'utf8');
            fs.writeFileSync(mainFile, userMain);
            const fixedTimestamp = new Date(Date.now() - 120_000);
            fs.utimesSync(mainFile, fixedTimestamp, fixedTimestamp);
            const mainMtime = fs.statSync(mainFile).mtimeMs;

            assert.strictEqual(await runSocGeneration(uriA, 'normal', services), true);
            assert.deepStrictEqual(fs.readFileSync(mainFile), userMain);
            assert.strictEqual(fs.statSync(mainFile).mtimeMs, mainMtime);

            fs.appendFileSync(managedTop, '\n// modified by extension-host test\n', 'utf8');
            const modifiedTop = fs.readFileSync(managedTop);
            const registeredConflict = vscode.commands.executeCommand<boolean>(
                SOC_COMMANDS.generate,
                uriA,
            );
            assert.strictEqual(
                await settleCommandAfterClearingNotifications(
                    'registered Generate command to report the managed-file conflict',
                    registeredConflict,
                ),
                false,
            );
            assert.deepStrictEqual(fs.readFileSync(managedTop), modifiedTop);
            assert.strictEqual(await runSocGeneration(uriA, 'force', services), true);
            assert.deepStrictEqual(fs.readFileSync(managedTop), originalTop);
            assert.deepStrictEqual(fs.readFileSync(mainFile), userMain);
            assert.strictEqual(fs.statSync(mainFile).mtimeMs, mainMtime);

            const uriC = writeConfig('host-a-adopter.merc32.json', configA);
            const manifestFile = path.join(outputA, 'manifest.json');
            const beforeOwnershipAttempt = fs.readFileSync(manifestFile);
            assert.strictEqual(await runSocGeneration(uriC, 'force', services), false);
            assert.deepStrictEqual(fs.readFileSync(manifestFile), beforeOwnershipAttempt);
            assert.strictEqual(
                comparablePath(manifestSource(manifestFile)),
                comparablePath(portablePath(uriA.fsPath)),
            );
            assert.strictEqual(await runSocGeneration(uriC, 'adopt', services), true);
            assert.strictEqual(
                comparablePath(manifestSource(manifestFile)),
                comparablePath(portablePath(uriC.fsPath)),
            );
            assert.strictEqual(store.getSnapshot().generatedSocs.length, 2);
            store.dispose();
        });
});

interface MutableSocConfig {
    schemaVersion: number;
    project: { name: string; outputDir: string };
    cpu: { debug: boolean };
    memory: Record<string, unknown>;
    peripherals: Array<Record<string, unknown> & { baseAddress?: string }>;
    externalInterfaces: Array<Record<string, unknown>>;
    interrupt: Record<string, unknown>;
}

class MemoryMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this.values.keys()];
    }

    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }

    update(key: string, value: unknown): Thenable<void> {
        if (value === undefined) this.values.delete(key);
        else this.values.set(key, JSON.parse(JSON.stringify(value)) as unknown);
        return Promise.resolve();
    }
}

function requiredEnvironment(name: string): string {
    const value = process.env[name];
    if (!value) throw new Error(`Missing required extension-test environment variable ${name}.`);
    return value;
}

function fixtureConfig(projectName: string, outputDir: string): MutableSocConfig {
    const value = JSON.parse(fs.readFileSync(fixturePathForHelpers(), 'utf8')) as MutableSocConfig;
    value.project = { name: projectName, outputDir };
    return value;
}

function fixturePathForHelpers(): string {
    return path.join(requiredEnvironment('MERC32_TEST_WORKSPACE'), 'minimal.merc32.json');
}

function writeConfig(name: string, config: MutableSocConfig): vscode.Uri {
    const file = path.join(requiredEnvironment('MERC32_TEST_WORKSPACE'), name);
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return vscode.Uri.file(file);
}

async function openCustomEditor(uri: vscode.Uri): Promise<vscode.TabInputCustom> {
    await vscode.commands.executeCommand('vscode.open', uri);
    return waitFor(`custom editor for ${path.basename(uri.fsPath)}`, () => {
        const input = activeInputFor(uri);
        return input instanceof vscode.TabInputCustom ? input : undefined;
    });
}

function activeInputFor(uri: vscode.Uri): unknown {
    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    if (input instanceof vscode.TabInputCustom || input instanceof vscode.TabInputText) {
        return input.uri.toString() === uri.toString() ? input : undefined;
    }
    return undefined;
}

function fullDocumentRange(document: vscode.TextDocument): vscode.Range {
    return new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length));
}

function parsedConfig(document: vscode.TextDocument): MutableSocConfig {
    return JSON.parse(document.getText()) as MutableSocConfig;
}

function socDiagnostics(uri: vscode.Uri): readonly vscode.Diagnostic[] {
    return vscode.languages.getDiagnostics(uri).filter((item) => item.source === 'MERC32 SoC');
}

function diagnosticCode(diagnostic: vscode.Diagnostic): string {
    return typeof diagnostic.code === 'object' && diagnostic.code !== null
        ? String(diagnostic.code.value)
        : String(diagnostic.code);
}

async function closeAllEditors(): Promise<void> {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await waitFor('all editor tabs to close', () =>
        vscode.window.tabGroups.all.every((group) => group.tabs.length === 0));
}

async function waitFor<T>(
    description: string,
    probe: () => T | undefined | false | Promise<T | undefined | false>,
    deadlineMs = DEFAULT_DEADLINE_MS,
): Promise<T> {
    const deadline = Date.now() + deadlineMs;
    let lastObservation = 'condition returned no value';
    while (Date.now() <= deadline) {
        try {
            const value = await probe();
            if (value) return value;
            lastObservation = describeHostState();
        } catch (error) {
            lastObservation = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        }
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
    throw new Error(`Timed out waiting for ${description}. Last observation: ${lastObservation}`);
}

async function settleCommandAfterClearingNotifications<T>(
    description: string,
    command: Thenable<T>,
    deadlineMs = DEFAULT_DEADLINE_MS,
): Promise<T> {
    const state: {
        settlement?: { status: 'fulfilled'; value: T } | { status: 'rejected'; reason: unknown };
    } = {};
    void Promise.resolve(command).then(
        (value) => { state.settlement = { status: 'fulfilled', value }; },
        (reason: unknown) => { state.settlement = { status: 'rejected', reason }; },
    );
    const settlement = await waitFor(description, async () => {
        await vscode.commands.executeCommand('notifications.clearAll');
        return state.settlement;
    }, deadlineMs);
    if (settlement.status === 'rejected') throw settlement.reason;
    return settlement.value;
}

function describeHostState(): string {
    const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
    const input = tab?.input;
    const inputDescription = input instanceof vscode.TabInputCustom
        ? `custom:${input.viewType}:${input.uri.toString()}`
        : input instanceof vscode.TabInputText
            ? `text:${input.uri.toString()}`
            : input?.constructor?.name ?? 'none';
    return `active=${inputDescription}; openDocuments=${vscode.workspace.textDocuments.length}`;
}

function commandServices(
    vscodeApi: typeof vscode,
    artifacts?: Merc32ArtifactStore,
    extensionUri?: vscode.Uri,
) {
    const activeExtension = vscode.extensions.getExtension(EXTENSION_ID);
    const root = extensionUri ?? activeExtension?.extensionUri;
    if (!root) throw new Error('MERC32 extension URI is unavailable.');
    return {
        catalog: loadCatalog(vscode.Uri.joinPath(root, 'resources').fsPath),
        diagnostics: { refresh: () => [] },
        output: { appendLine: () => {}, show: () => {} },
        artifacts,
        extensionUri: root,
        vscodeApi,
    };
}

function confirmationVscode(): typeof vscode {
    return vscodeWithUiOverrides({
        showWarningMessage: async () => 'Assign',
    });
}

function generationVscode(): typeof vscode {
    const withProgress = async <R>(
        _options: vscode.ProgressOptions,
        task: (
            progress: vscode.Progress<{ message?: string; increment?: number }>,
            token: vscode.CancellationToken,
        ) => Thenable<R>,
    ): Promise<R> => {
        const source = new vscode.CancellationTokenSource();
        try {
            return await task({ report: () => {} }, source.token);
        } finally {
            source.dispose();
        }
    };
    return vscodeWithUiOverrides({
        showErrorMessage: async () => undefined,
        withProgress,
    }, async (command, ...args) => {
        if (command === 'revealFileInOS') return undefined;
        return vscode.commands.executeCommand(command, ...args);
    });
}

function vscodeWithUiOverrides(
    windowOverrides: Record<string, unknown>,
    executeCommand?: (command: string, ...args: unknown[]) => Thenable<unknown>,
): typeof vscode {
    const windowApi = new Proxy(vscode.window, {
        get(target, property, receiver) {
            if (Object.prototype.hasOwnProperty.call(windowOverrides, property)) {
                return windowOverrides[String(property)];
            }
            return Reflect.get(target, property, receiver);
        },
    });
    const commandsApi = executeCommand
        ? new Proxy(vscode.commands, {
            get(target, property, receiver) {
                return property === 'executeCommand'
                    ? executeCommand
                    : Reflect.get(target, property, receiver);
            },
        })
        : vscode.commands;
    return new Proxy(vscode, {
        get(target, property, receiver) {
            if (property === 'window') return windowApi;
            if (property === 'commands') return commandsApi;
            return Reflect.get(target, property, receiver);
        },
    }) as typeof vscode;
}

function manifestSource(manifestFile: string): string {
    return (JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { sourceConfig: string }).sourceConfig;
}

function portablePath(value: string): string {
    return value.replace(/\\/g, '/');
}

function comparablePath(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
}
