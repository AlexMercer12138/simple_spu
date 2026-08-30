const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { fileURLToPath } = require('url');

const EXTENSION_STATE_ROW_KEY = 'Vikai-mercer.merc32-vsce';
const SOC_ARTIFACT_STATE_KEY = 'merc32.soc.generatedArtifacts';

function assertPersistedArtifactState(userDataDir, workspaceDir, configFile, outputDir) {
    const storageRoot = path.join(userDataDir, 'User', 'workspaceStorage');
    assert.ok(isExactDirectory(storageRoot),
        'installed VSCode host wrote no workspace storage directory');
    const matches = fs.readdirSync(storageRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
        .map((entry) => path.join(storageRoot, entry.name))
        .filter((directory) => workspaceIdentityMatches(
            path.join(directory, 'workspace.json'), workspaceDir));
    assert.strictEqual(matches.length, 1,
        `expected one workspace-storage identity for the installed smoke workspace, found ${matches.length}`);

    const databaseFile = path.join(matches[0], 'state.vscdb');
    assert.ok(isExactFile(databaseFile),
        'installed VSCode host wrote no state database for the installed smoke workspace');
    const state = readExtensionWorkspaceState(databaseFile);
    assert.ok(state && Object.prototype.hasOwnProperty.call(state, SOC_ARTIFACT_STATE_KEY),
        'target workspace database has no exact extension workspaceState artifact key');
    const records = state[SOC_ARTIFACT_STATE_KEY];
    assert.ok(Array.isArray(records),
        'exact extension workspaceState artifact value is not an array');
    const matchingRecord = records.find((record) => record
        && typeof record.configUri === 'string'
        && typeof record.outputUri === 'string'
        && samePath(fileUriPath(record.configUri), configFile)
        && samePath(fileUriPath(record.outputUri), outputDir));
    assert.ok(matchingRecord,
        'target workspace database has no exact extension workspaceState artifact record');
}

function workspaceIdentityMatches(workspaceJson, workspaceDir) {
    if (!isExactFile(workspaceJson)) return false;
    let identity;
    try {
        identity = JSON.parse(fs.readFileSync(workspaceJson, 'utf8'));
    } catch {
        return false;
    }
    if (!identity || typeof identity.folder !== 'string') return false;
    try {
        return samePath(fileUriPath(identity.folder), workspaceDir);
    } catch {
        return false;
    }
}

function readExtensionWorkspaceState(databaseFile) {
    const { DatabaseSync } = require('node:sqlite');
    const database = new DatabaseSync(databaseFile, { readOnly: true });
    try {
        const row = database.prepare('SELECT value FROM ItemTable WHERE key = ?')
            .get(EXTENSION_STATE_ROW_KEY);
        if (!row) return undefined;
        const text = Buffer.isBuffer(row.value) ? row.value.toString('utf8') : String(row.value);
        try {
            const value = JSON.parse(text);
            return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
        } catch {
            return undefined;
        }
    } finally {
        database.close();
    }
}

function fileUriPath(value) {
    const parsed = new URL(value);
    assert.strictEqual(parsed.protocol, 'file:', `artifact URI is not a file URI: ${value}`);
    return fileURLToPath(parsed);
}

function samePath(left, right) {
    const normalize = (value) => {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLocaleLowerCase('en-US') : resolved;
    };
    return normalize(left) === normalize(right);
}

function isExactFile(target) {
    try {
        const status = fs.lstatSync(target);
        return status.isFile() && !status.isSymbolicLink();
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

function isExactDirectory(target) {
    try {
        const status = fs.lstatSync(target);
        return status.isDirectory() && !status.isSymbolicLink();
    } catch (error) {
        if (error.code === 'ENOENT') return false;
        throw error;
    }
}

module.exports = {
    assertPersistedArtifactState,
    EXTENSION_STATE_ROW_KEY,
    SOC_ARTIFACT_STATE_KEY,
};
