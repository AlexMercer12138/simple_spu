const fs = require('fs');
const os = require('os');
const path = require('path');

const CACHE_ENVIRONMENT_VARIABLE = 'MERC32_VSCODE_TEST_CACHE';

function resolveVSCodeTestCachePath(environment = process.env) {
    const override = environment[CACHE_ENVIRONMENT_VARIABLE];
    if (typeof override === 'string' && override.trim() !== '') {
        return resolveExistingRealPath(path.resolve(override));
    }

    return resolveExistingRealPath(path.join(
        resolveUserCacheRoot(environment),
        'merc32-vsce-test',
        'vscode',
    ));
}

function ensureVSCodeTestCachePath(environment = process.env) {
    const cachePath = resolveVSCodeTestCachePath(environment);
    fs.mkdirSync(cachePath, { recursive: true });
    return fs.realpathSync.native(cachePath);
}

function resolveExistingRealPath(candidate) {
    try {
        return fs.realpathSync.native(candidate);
    } catch (error) {
        if (error && error.code === 'ENOENT') return candidate;
        throw error;
    }
}

function resolveUserCacheRoot(environment) {
    if (process.platform === 'win32') {
        const localAppData = environment.LOCALAPPDATA;
        return typeof localAppData === 'string' && localAppData.trim() !== ''
            ? path.resolve(localAppData)
            : path.join(os.homedir(), 'AppData', 'Local');
    }
    if (process.platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Caches');
    }
    const xdgCacheHome = environment.XDG_CACHE_HOME;
    return typeof xdgCacheHome === 'string' && path.isAbsolute(xdgCacheHome)
        ? path.resolve(xdgCacheHome)
        : path.join(os.homedir(), '.cache');
}

module.exports = {
    CACHE_ENVIRONMENT_VARIABLE,
    ensureVSCodeTestCachePath,
    resolveVSCodeTestCachePath,
};
