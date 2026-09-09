import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { download, runTests } from '@vscode/test-electron';

const { ensureVSCodeTestCachePath } = require('../../scripts/vscode-test-cache') as {
    ensureVSCodeTestCachePath(environment?: NodeJS.ProcessEnv): string;
};
const { withVSCodeTestCacheLock } = require('../../scripts/vscode-test-cache-lock') as {
    withVSCodeTestCacheLock<T>(
        cachePath: string,
        version: string,
        callback: () => Promise<T>,
    ): Promise<T>;
};

const VSCODE_VERSION = '1.74.3';
const TEMP_PREFIXES = Object.freeze({
    userData: 'merc32-vsce-user-data-',
    extensions: 'merc32-vsce-extensions-',
    workspace: 'merc32-vsce-workspace-',
});

async function main(): Promise<void> {
    const extensionDevelopmentPath = path.resolve(__dirname, '..', '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index');
    const cachePath = ensureVSCodeTestCachePath();
    const vscodeExecutablePath = await withVSCodeTestCacheLock(
        cachePath,
        VSCODE_VERSION,
        () => download({
            version: VSCODE_VERSION,
            cachePath,
            extensionDevelopmentPath,
        }),
    );
    const roots: Array<{ path: string; prefix: string }> = [];

    try {
        const userDataDir = createTempRoot(TEMP_PREFIXES.userData, roots);
        const extensionsDir = createTempRoot(TEMP_PREFIXES.extensions, roots);
        const workspaceDir = createTempRoot(TEMP_PREFIXES.workspace, roots);
        copyDirectory(path.join(extensionDevelopmentPath, 'src', 'test', 'fixtures'), workspaceDir);
        console.log(`MERC32 extension host: VSCode ${VSCODE_VERSION}`);
        console.log(`MERC32 extension host cache: ${cachePath}`);
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspaceDir,
                `--user-data-dir=${userDataDir}`,
                `--extensions-dir=${extensionsDir}`,
                '--disable-gpu',
            ],
            extensionTestsEnv: {
                MERC32_TEST_VSCODE_VERSION: VSCODE_VERSION,
                MERC32_TEST_WORKSPACE: workspaceDir,
                MERC32_CLI_HOME: path.join(workspaceDir, 'cli-home'),
            },
        });
    } finally {
        let cleanupFailure: unknown;
        for (const root of [...roots].reverse()) {
            try {
                removeExactTempRoot(root.path, root.prefix);
            } catch (error) {
                cleanupFailure ??= error;
            }
        }
        if (cleanupFailure) throw cleanupFailure;
    }
}

function createTempRoot(
    prefix: string,
    roots: Array<{ path: string; prefix: string }>,
): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    roots.push({ path: root, prefix });
    return root;
}

function copyDirectory(source: string, destination: string): void {
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name);
        const destinationPath = path.join(destination, entry.name);
        if (entry.isDirectory()) {
            fs.mkdirSync(destinationPath, { recursive: true });
            copyDirectory(sourcePath, destinationPath);
        } else if (entry.isFile()) {
            fs.copyFileSync(sourcePath, destinationPath, fs.constants.COPYFILE_EXCL);
        }
    }
}

function removeExactTempRoot(root: string, prefix: string): void {
    const resolvedRoot = path.resolve(root);
    const resolvedTemp = path.resolve(os.tmpdir());
    if (path.dirname(resolvedRoot) !== resolvedTemp || !path.basename(resolvedRoot).startsWith(prefix)) {
        throw new Error(`Refusing to remove unexpected extension-test root: ${resolvedRoot}`);
    }
    fs.rmSync(resolvedRoot, {
        recursive: true,
        force: true,
        maxRetries: 10,
        retryDelay: 100,
    });
}

main().catch((error: unknown) => {
    console.error('Failed to run MERC32 extension-host tests.');
    console.error(error);
    process.exitCode = 1;
});
