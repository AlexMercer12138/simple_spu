const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DEFAULT_OPTIONS = Object.freeze({
    pollIntervalMs: 250,
    staleAfterMs: 120_000,
    timeoutMs: 30 * 60_000,
});

async function withVSCodeTestCacheLock(cachePath, version, callback, options = {}) {
    if (typeof callback !== 'function') {
        throw new TypeError('VSCode cache lock callback must be a function');
    }
    const release = await acquireVSCodeTestCacheLock(cachePath, version, options);
    try {
        return await callback();
    } finally {
        release();
    }
}

async function acquireVSCodeTestCacheLock(cachePath, version, options) {
    if (typeof version !== 'string' || !/^[0-9A-Za-z._-]+$/u.test(version)) {
        throw new Error(`Invalid VSCode cache lock version: ${version}`);
    }
    const settings = normalizeOptions(options);
    const lockParent = path.join(path.resolve(cachePath), '.locks');
    const lockPath = path.join(lockParent, `vscode-${version}.lock`);
    fs.mkdirSync(lockParent, { recursive: true });
    const deadline = Date.now() + settings.timeoutMs;

    for (;;) {
        const token = crypto.randomBytes(16).toString('hex');
        let created = false;
        try {
            fs.mkdirSync(lockPath);
            created = true;
            fs.writeFileSync(path.join(lockPath, 'owner.json'), JSON.stringify({
                createdAt: new Date().toISOString(),
                pid: process.pid,
                token,
            }), { encoding: 'utf8', flag: 'wx' });
            return createRelease(lockPath, token, settings.staleAfterMs);
        } catch (error) {
            if (created) {
                fs.rmSync(lockPath, { recursive: true, force: true });
                throw error;
            }
            if (!error || error.code !== 'EEXIST') {
                throw error;
            }
        }

        recoverStaleLock(lockPath, settings.staleAfterMs);
        if (Date.now() >= deadline) {
            throw new Error(`Timed out waiting for shared VSCode test cache lock: ${lockPath}`);
        }
        await delay(settings.pollIntervalMs);
    }
}

function createRelease(lockPath, token, staleAfterMs) {
    const heartbeatMs = Math.max(1_000, Math.min(10_000, Math.floor(staleAfterMs / 3)));
    const heartbeat = setInterval(() => {
        if (!lockTokenMatches(lockPath, token)) {
            clearInterval(heartbeat);
            return;
        }
        try {
            const now = new Date();
            fs.utimesSync(lockPath, now, now);
        } catch {
            clearInterval(heartbeat);
        }
    }, heartbeatMs);
    heartbeat.unref();

    let released = false;
    return () => {
        if (released) return;
        released = true;
        clearInterval(heartbeat);
        if (lockTokenMatches(lockPath, token)) {
            fs.rmSync(lockPath, { recursive: true, force: true });
        }
    };
}

function recoverStaleLock(lockPath, staleAfterMs) {
    let status;
    try {
        status = fs.lstatSync(lockPath);
    } catch (error) {
        if (error && error.code === 'ENOENT') return;
        throw error;
    }
    if (!status.isDirectory() || status.isSymbolicLink()) {
        throw new Error(`Refusing unexpected VSCode cache lock path: ${lockPath}`);
    }
    if (Date.now() - status.mtimeMs <= staleAfterMs) return;

    const quarantine = `${lockPath}.stale-${process.pid}-${crypto.randomBytes(8).toString('hex')}`;
    try {
        fs.renameSync(lockPath, quarantine);
    } catch (error) {
        if (error && (error.code === 'ENOENT' || error.code === 'EEXIST')) return;
        throw error;
    }
    fs.rmSync(quarantine, { recursive: true, force: true });
}

function lockTokenMatches(lockPath, token) {
    try {
        const owner = JSON.parse(fs.readFileSync(path.join(lockPath, 'owner.json'), 'utf8'));
        return owner.token === token;
    } catch (error) {
        if (error && (error.code === 'ENOENT' || error instanceof SyntaxError)) return false;
        throw error;
    }
}

function normalizeOptions(options) {
    const settings = { ...DEFAULT_OPTIONS, ...options };
    for (const key of ['pollIntervalMs', 'staleAfterMs', 'timeoutMs']) {
        if (!Number.isInteger(settings[key]) || settings[key] <= 0) {
            throw new Error(`Invalid VSCode cache lock option ${key}: ${settings[key]}`);
        }
    }
    if (settings.timeoutMs <= settings.pollIntervalMs) {
        throw new Error('VSCode cache lock timeout must exceed its polling interval');
    }
    return settings;
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = { withVSCodeTestCacheLock };
