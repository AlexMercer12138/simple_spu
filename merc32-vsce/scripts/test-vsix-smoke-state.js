const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { DatabaseSync } = require('node:sqlite');

const {
    assertPersistedArtifactState,
    EXTENSION_STATE_ROW_KEY,
    SOC_ARTIFACT_STATE_KEY,
} = require('./vsix-smoke-state');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-vsix-state-unit-'));
try {
    const userDataDir = path.join(root, 'user-data');
    const workspaceDir = path.join(root, 'workspace');
    const configFile = path.join(workspaceDir, 'soc.merc32.json');
    const outputDir = path.join(workspaceDir, 'generated', 'soc');
    fs.mkdirSync(workspaceDir, { recursive: true });

    const expectedRecord = {
        configUri: pathToFileURL(configFile).toString(),
        outputUri: pathToFileURL(outputDir).toString(),
    };
    const matchingState = { [SOC_ARTIFACT_STATE_KEY]: [expectedRecord] };
    const targetStorage = createWorkspaceStorage(userDataDir, 'target', workspaceDir);
    const unrelatedStorage = createWorkspaceStorage(userDataDir, 'unrelated', path.join(root, 'other-workspace'));

    writeStateDatabase(path.join(userDataDir, 'User', 'globalStorage', 'state.vscdb'), [
        [EXTENSION_STATE_ROW_KEY, matchingState],
    ]);
    writeStateDatabase(path.join(unrelatedStorage, 'state.vscdb'), [
        [EXTENSION_STATE_ROW_KEY, matchingState],
    ]);
    writeStateDatabase(path.join(targetStorage, 'state.vscdb'), [
        ['globalState', matchingState],
        [EXTENSION_STATE_ROW_KEY, { nested: matchingState }],
    ]);

    assert.throws(
        () => assertPersistedArtifactState(userDataDir, workspaceDir, configFile, outputDir),
        /exact extension workspaceState artifact (?:key|record)/u,
        'matching globalState, nested state, or unrelated workspace database satisfied attribution',
    );

    writeStateDatabase(path.join(targetStorage, 'state.vscdb'), [
        [EXTENSION_STATE_ROW_KEY, matchingState],
    ]);
    assert.doesNotThrow(
        () => assertPersistedArtifactState(userDataDir, workspaceDir, configFile, outputDir),
        'exact target workspace extension state was not accepted',
    );
    console.log('Installed smoke workspace-state attribution contracts passed.');
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}

function createWorkspaceStorage(userDataDir, name, workspaceDir) {
    const storage = path.join(userDataDir, 'User', 'workspaceStorage', name);
    fs.mkdirSync(storage, { recursive: true });
    fs.writeFileSync(path.join(storage, 'workspace.json'), `${JSON.stringify({
        folder: pathToFileURL(workspaceDir).toString(),
    })}\n`);
    return storage;
}

function writeStateDatabase(databaseFile, rows) {
    fs.mkdirSync(path.dirname(databaseFile), { recursive: true });
    fs.rmSync(databaseFile, { force: true });
    const database = new DatabaseSync(databaseFile);
    try {
        database.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)');
        const insert = database.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)');
        for (const [key, value] of rows) insert.run(key, JSON.stringify(value));
    } finally {
        database.close();
    }
}
