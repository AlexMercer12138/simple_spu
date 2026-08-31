export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
    readonly [key: string]: JsonValue;
}
export type JsonArray = readonly JsonValue[];

export type SocJsonPath = readonly (string | number)[];

export interface SocCatalogItemPresentation {
    type: string;
    label: string;
    description?: string;
    multiple: boolean;
    parameters: readonly SocCatalogParameterPresentation[];
}

export interface SocCatalogParameterPresentation {
    name: string;
    type: 'integer' | 'boolean' | 'string' | 'enum' | 'powerOfTwo';
    default: JsonPrimitive;
    minimum?: number;
    maximum?: number;
    values?: readonly JsonPrimitive[];
}

export interface SocCatalogPresentation {
    modules: readonly SocCatalogItemPresentation[];
    externalInterfaces: readonly SocCatalogItemPresentation[];
}

export interface SocViewDiagnostic {
    severity: 'error' | 'warning';
    code: string;
    message: string;
    path: SocJsonPath;
    line: number;
    column: number;
}

export interface SocAddressRow {
    name: string;
    kind: 'peripheral' | 'external';
    baseAddress?: string;
    endAddress?: string;
    size?: string;
}

export interface SocInterruptRow {
    source: string;
    id?: number;
    trigger?: string;
}

export interface SocPortRow {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number;
}

export interface SocDependencyRow {
    name: string;
    kind: 'module' | 'protocol' | 'rtl';
    detail?: string;
}

export type SocGenerationPhase =
    | 'idle' | 'working' | 'validating' | 'generating' | 'success' | 'generated' | 'error';

export type SocDocumentState = 'saved' | 'dirty' | 'readOnly';
export type SocEditorActionType = 'autoAssign' | 'validate' | 'generate';

export interface SocInterruptOptionsPresentation {
    controllers: readonly string[];
    directSources: readonly string[];
    routedSources: readonly string[];
}

export interface SocGenerationState {
    actionId: number;
    action?: SocEditorActionType;
    phase: SocGenerationPhase;
    message: string;
}

export type SocActionProgress = Pick<SocGenerationState, 'phase' | 'message'>;

/** Serializable editor data; packaged asset locations stay host-only. */
export interface SocEditorViewModel {
    documentVersion: number;
    documentState: SocDocumentState;
    config?: JsonObject;
    readOnly: boolean;
    catalog: SocCatalogPresentation;
    diagnostics: readonly SocViewDiagnostic[];
    selectedPath?: SocJsonPath;
    addressRows: readonly SocAddressRow[];
    interruptRows: readonly SocInterruptRow[];
    portRows: readonly SocPortRow[];
    dependencyRows: readonly SocDependencyRow[];
    interruptOptions: SocInterruptOptionsPresentation;
    generation: SocGenerationState;
}

export type HostToWebviewMessage =
    | { type: 'state'; value: SocEditorViewModel }
    | ({ type: 'generationStatus' } & SocGenerationState);

export type WebviewToHostMessage =
    | { type: 'ready' }
    | { type: 'select'; path: SocJsonPath }
    | { type: 'setValue'; documentVersion: number; path: SocJsonPath; value: JsonValue }
    | { type: 'unsetValue'; documentVersion: number; path: SocJsonPath }
    | {
        type: 'addInstance';
        documentVersion: number;
        collection: 'peripherals' | 'externalInterfaces';
        itemType: string;
    }
    | {
        type: 'removeInstance';
        documentVersion: number;
        collection: 'peripherals' | 'externalInterfaces';
        index: number;
    }
    | { type: 'autoAssign' | 'validate' | 'generate' | 'reopenAsText' };

export const MAX_WEBVIEW_MESSAGE_BYTES = 64 * 1024;

const dangerousPropertyNames = new Set(['__proto__', 'prototype', 'constructor']);

function hasOwn(value: object, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function hasOnlyOwnDataProperties(value: object, allowedKeys: readonly string[]): boolean {
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
        return false;
    }

    const keys = Object.getOwnPropertyNames(value);
    if (!keys.every((key) => allowedKeys.includes(key))) {
        return false;
    }

    return keys.every((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return descriptor !== undefined && descriptor.enumerable && hasOwn(descriptor, 'value');
    });
}

function isPlainJsonArray(value: unknown): value is unknown[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
        || Object.getOwnPropertySymbols(value).length > 0) {
        return false;
    }

    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length !== value.length + 1 || !propertyNames.includes('length')) {
        return false;
    }

    for (let index = 0; index < value.length; index += 1) {
        if (!hasOwn(value, String(index))) {
            return false;
        }
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (descriptor === undefined || !descriptor.enumerable || !hasOwn(descriptor, 'value')) {
            return false;
        }
    }
    return true;
}

function isHostPath(value: string): boolean {
    return value.startsWith('/') || value.startsWith('\\')
        || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.includes('/');
}

function isSafePathSegment(value: unknown): value is string | number {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0;
    }
    return typeof value === 'string' && value.length > 0
        && !dangerousPropertyNames.has(value) && !isHostPath(value);
}

function isJsonValue(value: unknown, seen: Set<object>): value is JsonValue {
    if (value === null || typeof value === 'boolean' || typeof value === 'string') {
        return true;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value);
    }
    if (typeof value !== 'object') {
        return false;
    }
    if (seen.has(value)) {
        return false;
    }
    seen.add(value);

    if (isPlainJsonArray(value)) {
        return value.every((item) => isJsonValue(item, seen));
    }
    if (Object.getPrototypeOf(value) !== Object.prototype || Object.getOwnPropertySymbols(value).length > 0) {
        return false;
    }

    for (const key of Object.getOwnPropertyNames(value)) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (dangerousPropertyNames.has(key) || descriptor === undefined || !descriptor.enumerable
            || !hasOwn(descriptor, 'value') || !isJsonValue(descriptor.value, seen)) {
            return false;
        }
    }
    return true;
}

function isPath(value: unknown): value is SocJsonPath {
    return isPlainJsonArray(value) && value.every(isSafePathSegment);
}

function isCollection(value: unknown): value is 'peripherals' | 'externalInterfaces' {
    return value === 'peripherals' || value === 'externalInterfaces';
}

function isItemType(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveSafeInteger(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function isMessage(value: unknown, allowedKeys: readonly string[]): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        && hasOnlyOwnDataProperties(value, allowedKeys) && hasOwn(value, 'type')
        && typeof (value as Record<string, unknown>).type === 'string';
}

export function parseWebviewMessage(value: unknown): WebviewToHostMessage | undefined {
    if (encodedMessageSize(value) > MAX_WEBVIEW_MESSAGE_BYTES) {
        return undefined;
    }
    if (!isMessage(value, [
        'type', 'documentVersion', 'path', 'value', 'collection', 'itemType', 'index',
    ])) {
        return undefined;
    }

    switch (value.type) {
        case 'ready':
        case 'autoAssign':
        case 'validate':
        case 'generate':
        case 'reopenAsText':
            return hasOnlyOwnDataProperties(value, ['type']) ? { type: value.type } : undefined;
        case 'select':
            return hasOnlyOwnDataProperties(value, ['type', 'path'])
                && hasOwn(value, 'path') && isPath(value.path)
                ? { type: 'select', path: value.path }
                : undefined;
        case 'unsetValue':
            return hasOnlyOwnDataProperties(value, ['type', 'documentVersion', 'path'])
                && hasOwn(value, 'documentVersion') && isPositiveSafeInteger(value.documentVersion)
                && hasOwn(value, 'path') && isPath(value.path)
                ? { type: 'unsetValue', documentVersion: value.documentVersion, path: value.path }
                : undefined;
        case 'setValue':
            return hasOnlyOwnDataProperties(value, ['type', 'documentVersion', 'path', 'value'])
                && hasOwn(value, 'documentVersion') && isPositiveSafeInteger(value.documentVersion)
                && hasOwn(value, 'path') && hasOwn(value, 'value') && isPath(value.path)
                && isJsonValue(value.value, new Set<object>())
                && isSafeValueForPath(value.path, value.value)
                ? {
                    type: 'setValue',
                    documentVersion: value.documentVersion,
                    path: value.path,
                    value: value.value,
                }
                : undefined;
        case 'addInstance':
            return hasOnlyOwnDataProperties(value, [
                'type', 'documentVersion', 'collection', 'itemType',
            ])
                && hasOwn(value, 'documentVersion') && isPositiveSafeInteger(value.documentVersion)
                && hasOwn(value, 'collection') && hasOwn(value, 'itemType')
                && isCollection(value.collection) && isItemType(value.itemType)
                ? {
                    type: 'addInstance',
                    documentVersion: value.documentVersion,
                    collection: value.collection,
                    itemType: value.itemType,
                }
                : undefined;
        case 'removeInstance':
            return hasOnlyOwnDataProperties(value, [
                'type', 'documentVersion', 'collection', 'index',
            ])
                && hasOwn(value, 'documentVersion') && isPositiveSafeInteger(value.documentVersion)
                && hasOwn(value, 'collection') && hasOwn(value, 'index')
                && isCollection(value.collection) && isNonNegativeSafeInteger(value.index)
                ? {
                    type: 'removeInstance',
                    documentVersion: value.documentVersion,
                    collection: value.collection,
                    index: value.index,
                }
                : undefined;
        default:
            return undefined;
    }
}

/** Only these schema-owned fields may carry source-relative path syntax. */
export function isConfigRelativePathField(pathValue: SocJsonPath): boolean {
    return pathValue.length === 2
            && pathValue[0] === 'project' && pathValue[1] === 'outputDir'
        || pathValue.length === 3
            && pathValue[0] === 'memory'
            && (pathValue[1] === 'ilb' || pathValue[1] === 'dlb')
            && pathValue[2] === 'initFile';
}

/** Mirrors the core source-relative path rules without resolving anything on the host. */
export function isSafeConfigRelativePath(value: unknown): value is string {
    if (typeof value !== 'string' || value.startsWith('/') || value.startsWith('\\')
        || /^[A-Za-z]:/.test(value) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)) {
        return false;
    }
    return value.split(/[\\/]+/).every((segment) => segment !== '.' && segment !== '..');
}

/** Non-path schema values may not smuggle host or packaged-resource references. */
export function isSafeNonPathString(value: string): boolean {
    return !value.includes('/') && !value.includes('\\')
        && !/^[A-Za-z]:/.test(value)
        && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function isSafeValueForPath(pathValue: SocJsonPath, value: JsonValue): boolean {
    if (isConfigRelativePathField(pathValue)) {
        return isSafeConfigRelativePath(value);
    }
    return everyString(value, isSafeNonPathString);
}

function everyString(value: JsonValue, predicate: (value: string) => boolean): boolean {
    if (typeof value === 'string') return predicate(value);
    if (value === null || typeof value !== 'object') return true;
    if (Array.isArray(value)) return value.every((item) => everyString(item, predicate));
    return Object.values(value).every((item) => everyString(item, predicate));
}

/** Command messages are version-independent; document-derived messages must match exactly. */
export function isCurrentDocumentMessage(
    message: WebviewToHostMessage,
    documentVersion: number,
): boolean {
    return 'documentVersion' in message ? message.documentVersion === documentVersion : true;
}

function encodedMessageSize(value: unknown): number {
    try {
        const encoded = JSON.stringify(value);
        return encoded === undefined ? Number.POSITIVE_INFINITY : Buffer.byteLength(encoded, 'utf8');
    } catch {
        return Number.POSITIVE_INFINITY;
    }
}
