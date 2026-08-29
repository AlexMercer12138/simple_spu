import {
    applyEdits,
    modify,
    parseTree,
    ParseError,
} from 'jsonc-parser';

import { JsonValue } from './socWebviewProtocol';

export interface JsonValueUpdate {
    path: readonly (string | number)[];
    value: JsonValue | undefined;
}

export interface TextReplacement {
    offset: number;
    length: number;
    text: string;
}

const dangerousPropertyNames = new Set(['__proto__', 'prototype', 'constructor']);

/** Applies structured JSON updates and returns the single minimal changed span. */
export function buildJsonReplacement(
    source: string,
    updates: readonly JsonValueUpdate[],
): TextReplacement {
    assertValidJson(source);
    const eol = detectEol(source);
    let updated = source;

    for (const update of updates) {
        assertSafePath(update.path);
        const edits = modify(updated, [...update.path], update.value, {
            formattingOptions: { insertSpaces: true, tabSize: 2, eol },
            isArrayInsertion: false,
        });
        updated = applyEdits(updated, edits);
        assertValidJson(updated);
    }

    return minimalReplacement(source, updated);
}

function assertValidJson(source: string): void {
    const errors: ParseError[] = [];
    const root = parseTree(source, errors, {
        allowTrailingComma: false,
        disallowComments: true,
    });
    if (!root || errors.length > 0) {
        throw new Error('Invalid JSON document.');
    }
}

function detectEol(source: string): '\r\n' | '\n' {
    return source.includes('\r\n') ? '\r\n' : '\n';
}

function assertSafePath(path: readonly (string | number)[]): void {
    if (!isPlainArray(path) || !path.every(isSafePathSegment)) {
        throw new Error('Invalid JSON path.');
    }
}

function isPlainArray(value: unknown): value is (string | number)[] {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype
        || Object.getOwnPropertySymbols(value).length > 0) {
        return false;
    }
    const propertyNames = Object.getOwnPropertyNames(value);
    if (propertyNames.length !== value.length + 1 || !propertyNames.includes('length')) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !descriptor.enumerable
            || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
            return false;
        }
    }
    return true;
}

function isSafePathSegment(value: string | number): boolean {
    if (typeof value === 'number') {
        return Number.isSafeInteger(value) && value >= 0;
    }
    return typeof value === 'string' && value.length > 0
        && !dangerousPropertyNames.has(value)
        && !isHostPath(value);
}

function isHostPath(value: string): boolean {
    return value.startsWith('/') || value.startsWith('\\')
        || /^[A-Za-z]:/.test(value) || value.includes('\\') || value.includes('/');
}

function minimalReplacement(original: string, updated: string): TextReplacement {
    let prefixLength = 0;
    const shortestLength = Math.min(original.length, updated.length);
    while (prefixLength < shortestLength
        && original[prefixLength] === updated[prefixLength]) {
        prefixLength += 1;
    }

    let suffixLength = 0;
    const maximumSuffixLength = shortestLength - prefixLength;
    while (suffixLength < maximumSuffixLength
        && original[original.length - suffixLength - 1]
            === updated[updated.length - suffixLength - 1]) {
        suffixLength += 1;
    }

    return {
        offset: prefixLength,
        length: original.length - prefixLength - suffixLength,
        text: updated.slice(prefixLength, updated.length - suffixLength),
    };
}
