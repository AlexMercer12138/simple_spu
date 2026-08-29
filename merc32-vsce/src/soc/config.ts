import Ajv, { ErrorObject, ValidateFunction } from 'ajv';
import {
    findNodeAtLocation,
    getLocation,
    getNodeValue,
    Node as JsonNode,
    parseTree,
    ParseError,
    printParseErrorCode,
} from 'jsonc-parser';

import {
    ModuleCatalog,
    SocDiagnostic,
    SocJsonRange,
    SocSourceConfig,
    SocSourceMap,
} from './model';
import { generateSocSchema } from './schema';
import { validateSocConfig } from './validate';

export interface ParseSocResult {
    config?: SocSourceConfig;
    sourceMap: SocSourceMap;
    diagnostics: readonly SocDiagnostic[];
}

const validators = new WeakMap<ModuleCatalog, ValidateFunction>();

class JsonSourceMap implements SocSourceMap {
    constructor(
        private readonly root: JsonNode | undefined,
        private readonly overrides: ReadonlyMap<string, SocJsonRange> = new Map(),
    ) {}

    rangeFor(path: readonly (string | number)[]): SocJsonRange | undefined {
        const override = this.overrides.get(JSON.stringify(path));
        if (override) {
            return { ...override };
        }
        if (!this.root) {
            return undefined;
        }
        const node = findNodeAtLocation(this.root, [...path]);
        return node ? { offset: node.offset, length: node.length } : undefined;
    }
}

/** Parses strict JSON, validates its catalog-aware schema, and runs semantic checks. */
export function parseSocConfig(
    text: string,
    file: string,
    catalog: ModuleCatalog,
): ParseSocResult {
    const parseErrors: ParseError[] = [];
    const root = parseTree(text, parseErrors, {
        allowTrailingComma: false,
        disallowComments: true,
    });
    const duplicateKeys = root && parseErrors.length === 0 ? findDuplicateKeys(root) : [];
    const sourceMap = new JsonSourceMap(root, new Map(duplicateKeys.map((duplicate) => [
        JSON.stringify(duplicate.path), duplicate.range,
    ])));

    if (parseErrors.length > 0 || !root) {
        const diagnostics = parseErrors.length > 0
            ? parseErrors.map((error): SocDiagnostic => ({
                severity: 'error',
                code: 'SOC_JSON_SYNTAX',
                path: syntaxPath(text, error),
                message: `${file}: ${printParseErrorCode(error.error)}`,
            }))
            : [{
                severity: 'error' as const,
                code: 'SOC_JSON_SYNTAX',
                path: [],
                message: `${file}: expected a JSON value`,
            }];
        return { sourceMap, diagnostics };
    }
    if (duplicateKeys.length > 0) {
        return {
            sourceMap,
            diagnostics: duplicateKeys.map((duplicate): SocDiagnostic => ({
                severity: 'error',
                code: 'SOC_JSON_DUPLICATE_KEY',
                path: duplicate.path,
                message: `${file}: duplicate object key ${JSON.stringify(duplicate.key)}`,
            })),
        };
    }

    const value = getNodeValue(root) as unknown;
    const validate = validatorFor(catalog);
    if (!validate(value)) {
        const diagnostics = deduplicateDiagnostics((validate.errors ?? [])
            .map((error) => schemaDiagnostic(error, value, file)));
        return { sourceMap, diagnostics };
    }

    const config = value as SocSourceConfig;
    return {
        config,
        sourceMap,
        diagnostics: validateSocConfig(config, catalog),
    };
}

function validatorFor(catalog: ModuleCatalog): ValidateFunction {
    const cached = validators.get(catalog);
    if (cached) {
        return cached;
    }
    const validator = new Ajv({ allErrors: true, strict: true })
        .compile(generateSocSchema(catalog));
    validators.set(catalog, validator);
    return validator;
}

function syntaxPath(text: string, error: ParseError): readonly (string | number)[] {
    return getLocation(text, error.offset).path
        .filter((segment) => segment !== '') as (string | number)[];
}

function schemaDiagnostic(error: ErrorObject, data: unknown, file: string): SocDiagnostic {
    const path = instancePathToPath(error.instancePath, data);
    if (error.keyword === 'additionalProperties') {
        path.push(String(error.params.additionalProperty));
    } else if (error.keyword === 'required') {
        path.push(String(error.params.missingProperty));
    }
    return {
        severity: 'error',
        code: 'SOC_SCHEMA',
        path,
        message: `${file}: ${error.message ?? 'configuration does not match the schema'}`,
    };
}

function instancePathToPath(instancePath: string, data: unknown): (string | number)[] {
    if (instancePath.length === 0) {
        return [];
    }
    const result: (string | number)[] = [];
    let current = data;
    for (const encoded of instancePath.slice(1).split('/')) {
        const segment = encoded.replace(/~1/g, '/').replace(/~0/g, '~');
        const component: string | number = Array.isArray(current) && /^\d+$/.test(segment)
            ? Number(segment)
            : segment;
        result.push(component);
        current = current !== null && typeof current === 'object'
            ? (current as Record<string | number, unknown>)[component]
            : undefined;
    }
    return result;
}

function deduplicateDiagnostics(diagnostics: readonly SocDiagnostic[]): readonly SocDiagnostic[] {
    const seen = new Set<string>();
    return diagnostics.filter((diagnostic) => {
        const key = `${diagnostic.code}\0${JSON.stringify(diagnostic.path)}\0${diagnostic.message}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
}

interface DuplicateKey {
    key: string;
    path: readonly (string | number)[];
    range: SocJsonRange;
}

function findDuplicateKeys(root: JsonNode): DuplicateKey[] {
    const duplicates: DuplicateKey[] = [];
    const duplicatePaths = new Set<string>();

    const visit = (node: JsonNode, path: readonly (string | number)[]): void => {
        if (node.type === 'object') {
            const seen = new Set<string>();
            for (const property of node.children ?? []) {
                const keyNode = property.children?.[0];
                const valueNode = property.children?.[1];
                if (!keyNode || typeof keyNode.value !== 'string' || !valueNode) {
                    continue;
                }
                const childPath = [...path, keyNode.value];
                const encodedPath = JSON.stringify(childPath);
                if (seen.has(keyNode.value) && !duplicatePaths.has(encodedPath)) {
                    duplicates.push({
                        key: keyNode.value,
                        path: childPath,
                        range: { offset: keyNode.offset, length: keyNode.length },
                    });
                    duplicatePaths.add(encodedPath);
                }
                seen.add(keyNode.value);
                visit(valueNode, childPath);
            }
            return;
        }
        if (node.type === 'array') {
            (node.children ?? []).forEach((child, index) => visit(child, [...path, index]));
        }
    };

    visit(root, []);
    return duplicates;
}
