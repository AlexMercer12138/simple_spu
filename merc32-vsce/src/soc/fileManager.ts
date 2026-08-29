import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface StagedFile {
    path: string;
    content: Buffer;
}

export interface ActivationPlan {
    outputDir: string;
    stagingDir: string;
    replacePaths: readonly string[];
    createOnlyPaths: readonly string[];
    removePaths: readonly string[];
}

/** Converts a generator path into its canonical portable relative form. */
export function normalizeGeneratedPath(value: string): string {
    if (value.length === 0 || path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
        throw new Error(`Generated path must be relative: ${value}`);
    }
    const components = value.replace(/\\/g, '/').split('/');
    if (components.some((component) => component.length === 0
        || component === '.' || component === '..')) {
        throw new Error(`Generated path contains an unsafe component: ${value}`);
    }
    return components.join('/');
}

export function assertNoCaseInsensitivePathCollisions(paths: readonly string[]): void {
    const seen = new Map<string, string>();
    for (const candidate of paths) {
        const normalized = normalizeGeneratedPath(candidate);
        const key = normalized.toLocaleLowerCase('en-US');
        const previous = seen.get(key);
        if (previous !== undefined) {
            throw new Error(`Case-insensitive generated path collision: ${previous} and ${normalized}`);
        }
        seen.set(key, normalized);
    }
}

export function sha256(content: Buffer | string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
}

export function sha256File(file: string): string {
    return sha256(fs.readFileSync(file));
}

export function createSiblingStagingDirectory(outputDir: string): string {
    const parent = path.dirname(outputDir);
    fs.mkdirSync(parent, { recursive: true });
    return fs.mkdtempSync(path.join(parent, `.${path.basename(outputDir)}-staging-`));
}

export function writeStagedFiles(stagingDir: string, files: readonly StagedFile[]): void {
    for (const file of files) {
        const normalized = normalizeGeneratedPath(file.path);
        const target = generatedPath(stagingDir, normalized);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, file.content);
        if (sha256File(target) !== sha256(file.content)) {
            throw new Error(`Staged file verification failed: ${normalized}`);
        }
    }
}

/**
 * Activates staged files one path at a time. Existing files are moved into the
 * sibling staging directory first so an exception can restore the old tree.
 */
export function activateStagedFiles(plan: ActivationPlan): void {
    const backupRoot = path.join(plan.stagingDir, '.activation-backup');
    const backups: { target: string; backup: string }[] = [];
    const installed: string[] = [];
    const createdDirectories: string[] = [];

    const createParents = (target: string): void => {
        const missing: string[] = [];
        let current = path.dirname(target);
        while (!fs.existsSync(current)) {
            missing.push(current);
            const parent = path.dirname(current);
            if (parent === current) break;
            current = parent;
        }
        for (const directory of missing.reverse()) {
            fs.mkdirSync(directory);
            createdDirectories.push(directory);
        }
    };

    const backupExisting = (relativePath: string): void => {
        const target = generatedPath(plan.outputDir, relativePath);
        if (!fs.existsSync(target)) return;
        const backup = generatedPath(backupRoot, relativePath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backups.push({ target, backup });
    };

    const install = (relativePath: string, createOnly: boolean): void => {
        const target = generatedPath(plan.outputDir, relativePath);
        if (createOnly && fs.existsSync(target)) {
            throw new Error(`User-owned file appeared during activation: ${relativePath}`);
        }
        if (!createOnly) backupExisting(relativePath);
        createParents(target);
        fs.renameSync(generatedPath(plan.stagingDir, relativePath), target);
        installed.push(target);
    };

    try {
        for (const relativePath of plan.replacePaths) install(relativePath, false);
        for (const relativePath of plan.createOnlyPaths) install(relativePath, true);
        for (const relativePath of plan.removePaths) backupExisting(relativePath);
    } catch (error) {
        for (const target of installed.reverse()) {
            if (fs.existsSync(target)) fs.rmSync(target, { force: true });
        }
        for (const { target, backup } of backups.reverse()) {
            if (!fs.existsSync(backup)) continue;
            fs.mkdirSync(path.dirname(target), { recursive: true });
            fs.renameSync(backup, target);
        }
        for (const directory of createdDirectories.reverse()) {
            try {
                if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
                    fs.rmdirSync(directory);
                }
            } catch {
                // The original error is the actionable failure.
            }
        }
        throw error;
    }
    removeEmptyManagedDirectories(plan.outputDir, plan.removePaths);
}

function removeEmptyManagedDirectories(outputDir: string, removedPaths: readonly string[]): void {
    const candidates = new Set<string>();
    for (const relativePath of removedPaths) {
        const components = normalizeGeneratedPath(relativePath).split('/');
        for (let length = components.length - 1; length > 0; length -= 1) {
            candidates.add(path.join(outputDir, ...components.slice(0, length)));
        }
    }
    for (const directory of [...candidates].sort((left, right) => right.length - left.length)) {
        try {
            if (fs.existsSync(directory) && fs.statSync(directory).isDirectory()
                && fs.readdirSync(directory).length === 0) {
                fs.rmdirSync(directory);
            }
        } catch {
            // Empty-directory cleanup does not affect generated file ownership.
        }
    }
}

export function generatedPath(root: string, relativePath: string): string {
    return path.join(root, ...normalizeGeneratedPath(relativePath).split('/'));
}
