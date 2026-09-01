import {
    assertNoCaseInsensitivePathCollisions,
    normalizeGeneratedPath,
} from './fileManager';

export const V2_MAIN_PATH = 'software/main.c' as const;

export interface ManifestManagedRecord {
    kind: string;
    logicalSource: string;
    path: string;
    sha256: string;
}

export interface ManifestUserRecord {
    kind: 'scaffold/user-owned';
    logicalSource: 'templates/main.c.tpl';
    path: typeof V2_MAIN_PATH;
}

export type ManifestFileRecord = ManifestManagedRecord | ManifestUserRecord;

export interface SocManifest {
    manifestVersion: 2;
    files: readonly ManifestFileRecord[];
    generatorVersion: string;
    manifestFile: {
        hashPolicy: 'excluded-self';
        kind: 'control/manifest';
        path: 'manifest.json';
    };
    projectName: string;
    resourceRevision: string;
    sourceConfig: string;
}

/** Parses the sole supported generated-output ownership manifest. */
export function parseSocManifest(value: unknown): SocManifest {
    if (!isObject(value)) throw new Error('SoC manifest must be a JSON object.');
    if (value.manifestVersion !== 2) {
        throw new Error(
            `Unsupported SoC manifest version ${String(value.manifestVersion)}; `
            + 'remove the generated output and regenerate it.',
        );
    }
    if (typeof value.projectName !== 'string' || !isIdentifier(value.projectName)
        || typeof value.sourceConfig !== 'string'
        || typeof value.generatorVersion !== 'string'
        || typeof value.resourceRevision !== 'string'
        || !isObject(value.manifestFile)
        || value.manifestFile.hashPolicy !== 'excluded-self'
        || value.manifestFile.kind !== 'control/manifest'
        || value.manifestFile.path !== 'manifest.json'
        || !Array.isArray(value.files)) {
        throw new Error('SoC manifest v2 has an unsupported shape.');
    }

    const exact = new Map<string, readonly [string, string]>([
        [`hardware/${value.projectName}.v`,
            ['generated/rtl-bundle', 'generator:renderRtlBundle']],
        [`software/${value.projectName}.h`,
            ['generated/software-header', 'generator:renderSocHeader']],
        ['README.md', ['generated/documentation', 'templates/README.md.tpl']],
    ]);
    const records = value.files.map((record): ManifestFileRecord => {
        if (!isObject(record) || typeof record.path !== 'string'
            || typeof record.kind !== 'string' || typeof record.logicalSource !== 'string') {
            throw new Error('SoC manifest v2 contains an invalid file record.');
        }
        const recordPath = normalizeGeneratedPath(record.path);
        if (recordPath !== record.path) {
            throw new Error(`SoC manifest v2 path is not canonical: ${record.path}`);
        }
        if (record.kind === 'scaffold/user-owned') {
            if (recordPath !== V2_MAIN_PATH || record.sha256 !== undefined
                || record.logicalSource !== 'templates/main.c.tpl') {
                throw new Error('SoC manifest v2 user-owned scaffold record is invalid.');
            }
            return {
                kind: 'scaffold/user-owned',
                logicalSource: 'templates/main.c.tpl',
                path: V2_MAIN_PATH,
            };
        }
        if (recordPath === V2_MAIN_PATH || recordPath === 'manifest.json'
            || !isSha256(record.sha256)
            || !isAllowedManagedRecord(
                record.kind, record.logicalSource, recordPath, exact)) {
            throw new Error('SoC manifest v2 managed file record is invalid.');
        }
        return {
            kind: record.kind,
            logicalSource: record.logicalSource,
            path: recordPath,
            sha256: record.sha256,
        };
    });
    assertNoCaseInsensitivePathCollisions(records.map((record) => record.path));
    if (records.filter((record) => record.kind === 'scaffold/user-owned').length !== 1) {
        throw new Error('SoC manifest v2 must contain exactly one user-owned main.c record.');
    }
    for (const mandatoryPath of exact.keys()) {
        if (records.filter((record) => record.path === mandatoryPath).length !== 1) {
            throw new Error(`SoC manifest v2 must contain exactly one ${mandatoryPath} record.`);
        }
    }
    for (const slot of ['ilb', 'dlb'] as const) {
        const prefix = `firmware/${slot}_`;
        if (records.filter((record) => record.kind === 'source/firmware'
            && record.path.startsWith(prefix)).length > 1) {
            throw new Error(`SoC manifest v2 contains multiple ${slot.toUpperCase()} firmware records.`);
        }
    }
    return {
        files: records,
        generatorVersion: value.generatorVersion,
        manifestFile: {
            hashPolicy: 'excluded-self',
            kind: 'control/manifest',
            path: 'manifest.json',
        },
        manifestVersion: 2,
        projectName: value.projectName,
        resourceRevision: value.resourceRevision,
        sourceConfig: value.sourceConfig,
    };
}

function isAllowedManagedRecord(
    kind: string,
    logicalSource: string,
    recordPath: string,
    exact: ReadonlyMap<string, readonly [string, string]>,
): boolean {
    const expected = exact.get(recordPath);
    if (expected !== undefined) {
        return kind === expected[0] && logicalSource === expected[1];
    }
    const firmware = /^firmware\/(ilb|dlb)_([^/]+)$/.exec(recordPath);
    return firmware !== null
        && kind === 'source/firmware'
        && logicalSource === `config:memory.${firmware[1]}.initFile`;
}

function isSha256(value: unknown): value is string {
    return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function isIdentifier(value: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
