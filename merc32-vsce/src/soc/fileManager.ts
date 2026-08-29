import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface StagedFile {
    path: string;
    content: Buffer;
    sha256: string;
}

export interface ActivationPlan {
    outputDir: string;
    stagingDir: string;
    replacePaths: readonly ActivationTarget[];
    createOnlyPaths: readonly ActivationTarget[];
    removePaths: readonly ActivationTarget[];
    invariantPaths: readonly ActivationTarget[];
}

export type ExpectedTargetState =
    | { kind: 'missing' }
    | { kind: 'regular-file'; sha256: string; identity: FileIdentity };

export interface FileIdentity {
    dev: bigint;
    ino: bigint;
}

export interface ActivationTarget {
    path: string;
    expected: ExpectedTargetState;
    installedSha256?: string;
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
        if (file.sha256 !== sha256(file.content) || sha256File(target) !== file.sha256) {
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
    const quarantineRoot = path.join(plan.stagingDir, '.activation-quarantine');
    const backups: {
        target: string;
        backup: string;
        identity: FileIdentity;
        sha256?: string;
        regular: boolean;
    }[] = [];
    const installed: {
        target: string;
        sha256: string;
        identity: FileIdentity;
    }[] = [];
    const createdDirectories: string[] = [];
    let quarantineSequence = 0;
    let outputRootIdentity: FileIdentity | undefined;

    const assertOutputRoot = (): void => {
        assertPathHasNoLinks(plan.outputDir);
        const status = fs.lstatSync(plan.outputDir, { bigint: true });
        if (!status.isDirectory() || status.isSymbolicLink()) {
            throw new Error(`Output root is not an ordinary directory: ${plan.outputDir}`);
        }
        const identity = identityOf(status);
        if (outputRootIdentity === undefined) {
            outputRootIdentity = identity;
        } else if (!sameIdentity(identity, outputRootIdentity)) {
            throw new Error(`Output root changed during activation: ${plan.outputDir}`);
        }
    };

    if (fs.existsSync(plan.outputDir)) assertOutputRoot();

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
        assertOutputRoot();
    };

    const assertInvariants = (): void => {
        for (const invariant of plan.invariantPaths) {
            const target = generatedPath(plan.outputDir, invariant.path);
            assertPathHasNoLinks(target);
            if (invariant.expected.kind !== 'regular-file') {
                throw new Error(`Activation invariant must be a regular file: ${invariant.path}`);
            }
            const status = fs.lstatSync(target, { bigint: true });
            if (!status.isFile()
                || !sameIdentity(identityOf(status), invariant.expected.identity)
                || sha256File(target) !== invariant.expected.sha256) {
                throw new Error(`Activation invariant changed: ${invariant.path}`);
            }
        }
    };

    const quarantinePath = (label: string, target: string): string => {
        quarantineSequence += 1;
        const safeLabel = label.replace(/[^A-Za-z0-9_.-]/g, '_');
        const result = path.join(quarantineRoot,
            `${quarantineSequence}-${safeLabel}-${path.basename(target)}`);
        fs.mkdirSync(path.dirname(result), { recursive: true });
        return result;
    };

    const inspectRegularFile = (file: string): {
        identity: FileIdentity;
        sha256: string;
    } => {
        assertPathHasNoLinks(file);
        const status = fs.lstatSync(file, { bigint: true });
        if (!status.isFile() || status.isSymbolicLink()) {
            throw new Error(`Expected an ordinary regular file: ${file}`);
        }
        return { identity: identityOf(status), sha256: sha256File(file) };
    };

    const assertExactFile = (
        file: string,
        expected: { identity: FileIdentity; sha256: string },
        label: string,
    ): void => {
        const actual = inspectRegularFile(file);
        if (!sameIdentity(actual.identity, expected.identity)
            || actual.sha256 !== expected.sha256) {
            throw new Error(`${label} changed: ${file}`);
        }
    };

    const restoreCapturedFile = (
        captured: string,
        originalPath: string,
        actual: { identity: FileIdentity; sha256: string },
    ): void => {
        const canonicalParent = fs.realpathSync.native(path.dirname(originalPath));
        const restoreTarget = path.join(canonicalParent, path.basename(originalPath));
        if (fs.existsSync(restoreTarget)) {
            throw new Error(`Captured target cannot be restored without overwrite: ${restoreTarget}`);
        }
        fs.linkSync(captured, restoreTarget);
        fs.unlinkSync(captured);
        assertExactFile(restoreTarget, actual, 'Restored captured target');
    };

    const moveLiveNameToQuarantine = (
        target: string,
        expected: { identity: FileIdentity; sha256: string },
        label: string,
    ): string => {
        const namespace = captureAbsoluteDirectoryChain(path.dirname(target));
        const quarantine = quarantinePath(label, target);
        fs.renameSync(target, quarantine);
        const actual = inspectRegularFile(quarantine);
        try {
            assertDirectoryChain(namespace);
            if (!sameIdentity(actual.identity, expected.identity)
                || actual.sha256 !== expected.sha256) {
                throw new Error(`${label} captured a different live object: ${target}`);
            }
        } catch (error) {
            restoreCapturedFile(quarantine, target, actual);
            throw error;
        }
        return quarantine;
    };

    const removeExactLiveName = (
        target: string,
        expected: { identity: FileIdentity; sha256: string },
        label: string,
    ): void => {
        const namespace = captureAbsoluteDirectoryChain(path.dirname(target));
        const anchor = quarantinePath(`${label}-anchor`, target);
        fs.linkSync(target, anchor);
        let anchored: { identity: FileIdentity; sha256: string };
        try {
            assertDirectoryChain(namespace);
            anchored = inspectRegularFile(anchor);
            if (!sameIdentity(anchored.identity, expected.identity)) {
                throw new Error(`${label} anchor has a different identity: ${target}`);
            }
        } catch (error) {
            fs.rmSync(anchor, { force: true });
            throw error;
        }
        const captured = moveLiveNameToQuarantine(target, anchored, `${label}-capture`);
        if (anchored.sha256 !== expected.sha256) {
            throw new Error(`${label} captured the expected object with changed bytes: ${captured}`);
        }
        fs.rmSync(captured, { force: true });
        fs.rmSync(anchor, { force: true });
    };

    const backupExisting = (operation: ActivationTarget): void => {
        const relativePath = operation.path;
        const target = generatedPath(plan.outputDir, relativePath);
        if (operation.expected.kind === 'missing') {
            if (fs.existsSync(target)) {
                throw new Error(`Generated target appeared during staging: ${relativePath}`);
            }
            return;
        }
        const backup = generatedPath(backupRoot, relativePath);
        fs.mkdirSync(path.dirname(backup), { recursive: true });
        const namespace = captureDirectoryChain(plan.outputDir, path.dirname(target));
        fs.linkSync(target, backup);
        const backupRecord = {
            target,
            backup,
            identity: operation.expected.identity,
            sha256: operation.expected.sha256 as string | undefined,
            regular: true,
        };
        backups.push(backupRecord);
        const captured = fs.lstatSync(backup, { bigint: true });
        const capturedRegular = captured.isFile() && !captured.isSymbolicLink();
        const capturedHash = capturedRegular ? sha256File(backup) : undefined;
        backupRecord.identity = identityOf(captured);
        backupRecord.sha256 = capturedHash;
        backupRecord.regular = capturedRegular;
        assertPathHasNoLinks(backup);
        assertDirectoryChain(namespace);
        assertOutputRoot();
        if (!capturedRegular
            || !sameIdentity(identityOf(captured), operation.expected.identity)
            || capturedHash !== operation.expected.sha256) {
            throw new Error(`Generated target changed during capture: ${relativePath}`);
        }
        const removedName = moveLiveNameToQuarantine(target, {
            identity: operation.expected.identity,
            sha256: operation.expected.sha256,
        }, 'captured-existing');
        fs.rmSync(removedName, { force: true });
        assertInvariants();
    };

    const install = (operation: ActivationTarget): void => {
        const relativePath = operation.path;
        const target = generatedPath(plan.outputDir, relativePath);
        backupExisting(operation);
        createParents(target);
        assertPathHasNoLinks(target);
        if (fs.existsSync(target)) {
            throw new Error(`Generated target appeared during activation: ${relativePath}`);
        }
        const namespace = captureDirectoryChain(plan.outputDir, path.dirname(target));
        const staged = generatedPath(plan.stagingDir, relativePath);
        assertPathHasNoLinks(staged);
        const stagedStatus = fs.lstatSync(staged, { bigint: true });
        if (!stagedStatus.isFile() || stagedStatus.isSymbolicLink()) {
            throw new Error(`Staged target is not a regular file: ${relativePath}`);
        }
        if (operation.installedSha256 === undefined) {
            throw new Error(`Activation target has no intended digest: ${relativePath}`);
        }
        const installedHash = sha256File(staged);
        if (installedHash !== operation.installedSha256) {
            throw new Error(`Staged target changed after write: ${relativePath}`);
        }
        assertPathHasNoLinks(target);
        if (fs.existsSync(target)) {
            throw new Error(`Generated target appeared during activation: ${relativePath}`);
        }
        fs.linkSync(staged, target);
        const installedRecord = {
            target,
            sha256: operation.installedSha256,
            identity: identityOf(stagedStatus),
        };
        installed.push(installedRecord);
        const canonicalTarget = fs.realpathSync.native(target);
        installedRecord.target = canonicalTarget;
        fs.unlinkSync(staged);
        assertDirectoryChain(namespace);
        assertOutputRoot();
        assertPathHasNoLinks(target);
        const installedStatus = fs.lstatSync(target, { bigint: true });
        if (!installedStatus.isFile()
            || !sameIdentity(identityOf(installedStatus), identityOf(stagedStatus))
            || sha256File(target) !== operation.installedSha256) {
            throw new Error(`Installed target verification failed: ${relativePath}`);
        }
        assertInvariants();
    };

    try {
        assertInvariants();
        for (const operation of plan.replacePaths) install(operation);
        for (const operation of plan.createOnlyPaths) install(operation);
        for (const operation of plan.removePaths) backupExisting(operation);
        removeEmptyManagedDirectories(
            plan.outputDir, plan.removePaths.map((operation) => operation.path));
        assertOutputRoot();
        assertInvariants();
    } catch (error) {
        const recoveryFailures: Error[] = [];
        for (const installedFile of installed.reverse()) {
            try {
                if (!fs.existsSync(installedFile.target)) continue;
                removeExactLiveName(installedFile.target, installedFile,
                    'rollback-installed');
            } catch (recoveryError) {
                recoveryFailures.push(asError(
                    recoveryError, `Failed to remove installed target ${installedFile.target}`));
            }
        }
        for (const captured of backups.reverse()) {
            try {
                const { target, backup } = captured;
                if (!fs.existsSync(backup)) continue;
                assertPathHasNoLinks(backup);
                const backupStatus = fs.lstatSync(backup, { bigint: true });
                if (!captured.regular || !backupStatus.isFile()
                    || !sameIdentity(identityOf(backupStatus), captured.identity)
                    || sha256File(backup) !== captured.sha256) {
                    throw new Error(`Backup changed before restoration: ${backup}`);
                }
                assertPathHasNoLinks(target);
                if (fs.existsSync(target)) {
                    throw new Error(`Target exists before backup restoration: ${target}`);
                }
                fs.mkdirSync(path.dirname(target), { recursive: true });
                const namespace = captureDirectoryChain(plan.outputDir, path.dirname(target));
                const restoreAnchor = quarantinePath('restore-anchor', target);
                fs.linkSync(backup, restoreAnchor);
                assertExactFile(restoreAnchor, {
                    identity: captured.identity,
                    sha256: captured.sha256,
                }, 'Backup restore anchor');
                fs.linkSync(backup, target);
                const canonicalTarget = fs.realpathSync.native(target);
                fs.unlinkSync(backup);
                fs.unlinkSync(restoreAnchor);
                try {
                    assertDirectoryChain(namespace);
                    assertExactFile(canonicalTarget, {
                        identity: captured.identity,
                        sha256: captured.sha256,
                    }, 'Restored target');
                } catch (restoreError) {
                    removeExactLiveName(canonicalTarget, {
                        identity: captured.identity,
                        sha256: captured.sha256,
                    }, 'failed-restoration');
                    throw restoreError;
                }
            } catch (recoveryError) {
                recoveryFailures.push(asError(
                    recoveryError, `Failed to restore backup ${captured.backup}`));
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
}

export function identityOf(status: fs.BigIntStats): FileIdentity {
    return { dev: status.dev, ino: status.ino };
}

export function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
    return left.dev === right.dev && left.ino === right.ino;
}

interface DirectoryIdentity {
    path: string;
    identity: FileIdentity;
}

function captureDirectoryChain(root: string, directory: string): DirectoryIdentity[] {
    assertPathContained(root, directory, 'Activation directory');
    return captureAbsoluteDirectoryChain(directory);
}

function captureAbsoluteDirectoryChain(directory: string): DirectoryIdentity[] {
    const resolved = path.resolve(directory);
    const parsed = path.parse(resolved);
    const components = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
    const result: DirectoryIdentity[] = [];
    let current = parsed.root;
    for (const component of components) {
        current = path.join(current, component);
        assertPathHasNoLinks(current);
        const status = fs.lstatSync(current, { bigint: true });
        if (!status.isDirectory() || status.isSymbolicLink()) {
            throw new Error(`Activation directory is not an ordinary directory: ${current}`);
        }
        result.push({ path: current, identity: identityOf(status) });
    }
    return result;
}

function assertDirectoryChain(chain: readonly DirectoryIdentity[]): void {
    for (const expected of chain) {
        const status = fs.lstatSync(expected.path, { bigint: true });
        if (!status.isDirectory() || status.isSymbolicLink()
            || !sameIdentity(identityOf(status), expected.identity)) {
            throw new Error(`Activation directory changed: ${expected.path}`);
        }
    }
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
