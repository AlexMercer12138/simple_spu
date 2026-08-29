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
    replacePaths: readonly ActivationTarget[];
    createOnlyPaths: readonly ActivationTarget[];
    removePaths: readonly ActivationTarget[];
}

export type ExpectedTargetState =
    | { kind: 'missing' }
    | { kind: 'regular-file'; sha256: string };

export interface ActivationTarget {
    path: string;
    expected: ExpectedTargetState;
}

export class ActivationRecoveryError extends Error {
    readonly activationError: unknown;
    readonly recoveryPath: string;
    readonly failures: readonly Error[];

    constructor(activationError: unknown, failures: readonly Error[], recoveryPath: string) {
        super(`Activation failed and rollback was incomplete. Recovery files retained at ${recoveryPath}.`);
        this.name = 'ActivationRecoveryError';
        this.activationError = activationError;
        this.recoveryPath = recoveryPath;
        this.failures = Object.freeze([...failures]);
        Object.defineProperty(this, 'cause', { value: activationError, enumerable: false });
    }
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
    assertPathHasNoLinks(outputDir);
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
    const installed: { target: string; sha256: string }[] = [];
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

    const assertExpectedState = (operation: ActivationTarget): void => {
        const target = generatedPath(plan.outputDir, operation.path);
        assertPathHasNoLinks(target);
        let actual: ExpectedTargetState;
        try {
            const status = fs.lstatSync(target);
            actual = status.isFile()
                ? { kind: 'regular-file', sha256: sha256File(target) }
                : { kind: 'missing' };
        } catch (error) {
            if (isMissingPathError(error)) {
                actual = { kind: 'missing' };
            } else {
                throw error;
            }
        }
        if (actual.kind !== operation.expected.kind
            || (actual.kind === 'regular-file' && operation.expected.kind === 'regular-file'
                && actual.sha256 !== operation.expected.sha256)) {
            throw new Error(`Generated target changed during staging: ${operation.path}`);
        }
    };

    const backupExisting = (operation: ActivationTarget): void => {
        const relativePath = operation.path;
        const target = generatedPath(plan.outputDir, relativePath);
        assertExpectedState(operation);
        if (operation.expected.kind === 'missing') return;
        const backup = generatedPath(backupRoot, relativePath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        fs.renameSync(target, backup);
        backups.push({ target, backup });
    };

    const install = (operation: ActivationTarget, createOnly: boolean): void => {
        const relativePath = operation.path;
        const target = generatedPath(plan.outputDir, relativePath);
        if (createOnly) assertExpectedState(operation);
        else backupExisting(operation);
        createParents(target);
        assertPathHasNoLinks(target);
        if (fs.existsSync(target)) {
            throw new Error(`Generated target appeared during activation: ${relativePath}`);
        }
        const staged = generatedPath(plan.stagingDir, relativePath);
        assertPathHasNoLinks(staged);
        if (!fs.lstatSync(staged).isFile()) {
            throw new Error(`Staged target is not a regular file: ${relativePath}`);
        }
        const installedHash = sha256File(staged);
        assertPathHasNoLinks(target);
        if (fs.existsSync(target)) {
            throw new Error(`Generated target appeared during activation: ${relativePath}`);
        }
        fs.renameSync(staged, target);
        installed.push({ target, sha256: installedHash });
    };

    try {
        for (const operation of plan.replacePaths) install(operation, false);
        for (const operation of plan.createOnlyPaths) install(operation, true);
        for (const operation of plan.removePaths) backupExisting(operation);
    } catch (error) {
        const recoveryFailures: Error[] = [];
        for (const installedFile of installed.reverse()) {
            try {
                if (!fs.existsSync(installedFile.target)) continue;
                assertPathHasNoLinks(installedFile.target);
                if (!fs.lstatSync(installedFile.target).isFile()
                    || sha256File(installedFile.target) !== installedFile.sha256) {
                    throw new Error(`Installed target changed before rollback: ${installedFile.target}`);
                }
                fs.rmSync(installedFile.target, { force: true });
            } catch (recoveryError) {
                recoveryFailures.push(asError(
                    recoveryError, `Failed to remove installed target ${installedFile.target}`));
            }
        }
        for (const { target, backup } of backups.reverse()) {
            try {
                if (!fs.existsSync(backup)) continue;
                assertPathHasNoLinks(backup);
                if (!fs.lstatSync(backup).isFile()) {
                    throw new Error(`Backup is not a regular file: ${backup}`);
                }
                assertPathHasNoLinks(target);
                if (fs.existsSync(target)) {
                    throw new Error(`Target exists before backup restoration: ${target}`);
                }
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.renameSync(backup, target);
            } catch (recoveryError) {
                recoveryFailures.push(asError(recoveryError, `Failed to restore backup ${backup}`));
            }
        }
        for (const directory of createdDirectories.reverse()) {
            try {
                if (fs.existsSync(directory) && fs.readdirSync(directory).length === 0) {
                    fs.rmdirSync(directory);
                }
            } catch (recoveryError) {
                recoveryFailures.push(asError(recoveryError, `Failed to remove directory ${directory}`));
            }
        }
        if (recoveryFailures.length > 0) {
            throw new ActivationRecoveryError(error, recoveryFailures, plan.stagingDir);
        }
        throw error;
    }
    removeEmptyManagedDirectories(plan.outputDir, plan.removePaths.map((operation) => operation.path));
}

function isMissingPathError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error.code === 'ENOENT' || error.code === 'ENOTDIR');
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
            assertPathHasNoLinks(directory);
            if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory()
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

/** Rejects any existing path component whose real path redirects elsewhere. */
export function assertPathHasNoLinks(value: string): void {
    const resolved = path.resolve(value);
    const parsed = path.parse(resolved);
    let current = parsed.root;
    const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
    for (const component of components) {
        current = path.join(current, component);
        let status: fs.Stats;
        try {
            status = fs.lstatSync(current);
        } catch (error) {
            if (isMissingPathError(error)) return;
            throw error;
        }
        const canonical = fs.realpathSync.native(current);
        if (status.isSymbolicLink() || !sameCanonicalPath(current, canonical)) {
            throw new Error(`Linked or redirected path is not allowed: ${current}`);
        }
    }
}

export function assertPathContained(root: string, target: string, label: string): void {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    if (relative === '' || (!path.isAbsolute(relative)
        && relative !== '..' && !relative.startsWith(`..${path.sep}`))) return;
    throw new Error(`${label} escapes its allowed root: ${target}`);
}

function sameCanonicalPath(left: string, right: string): boolean {
    return process.platform === 'win32'
        ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US')
        : left === right;
}

function asError(error: unknown, fallback: string): Error {
    return error instanceof Error ? error : new Error(`${fallback}: ${String(error)}`);
}
