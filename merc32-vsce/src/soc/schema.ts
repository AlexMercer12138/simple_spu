import { CatalogParameter, ModuleCatalog, ModuleDescriptor, ProtocolDescriptor } from './model';

type JsonSchema = Record<string, unknown>;

const byteSizeSchema: JsonSchema = {
    oneOf: [
        { minimum: 1, type: 'integer' },
        { pattern: '^[0-9]+(?:[Kk][Ii][Bb]|[Mm][Ii][Bb])?$', type: 'string' },
    ],
};

const addressSchema: JsonSchema = {
    pattern: '^0[xX][0-9a-fA-F]{1,8}$',
    type: 'string',
};

function closedObject(
    properties: Record<string, JsonSchema>,
    required: readonly string[] = [],
): JsonSchema {
    return {
        additionalProperties: false,
        properties,
        ...(required.length > 0 ? { required: [...required] } : {}),
        type: 'object',
    };
}

function parameterSchema(parameter: CatalogParameter): JsonSchema {
    if (parameter.type === 'boolean') {
        return { type: 'boolean' };
    }
    if (parameter.type === 'string') {
        return { type: 'string' };
    }
    if (parameter.type === 'enum') {
        return { enum: [...(parameter.values ?? [])] };
    }

    return {
        ...(parameter.maximum === undefined ? {} : { maximum: parameter.maximum }),
        ...(parameter.minimum === undefined ? {} : { minimum: parameter.minimum }),
        type: 'integer',
    };
}

function peripheralSchema(descriptor: ModuleDescriptor): JsonSchema {
    const parameterProperties: Record<string, JsonSchema> = {};
    for (const name of Object.keys(descriptor.parameters).sort()) {
        parameterProperties[name] = parameterSchema(descriptor.parameters[name]);
    }

    return closedObject({
        baseAddress: addressSchema,
        name: { type: 'string' },
        parameters: closedObject(parameterProperties),
        type: { const: descriptor.type },
    }, ['type', 'name']);
}

function externalInterfaceSchema(descriptor: ProtocolDescriptor): JsonSchema {
    return closedObject({
        addressWidth: { type: 'integer' },
        baseAddress: addressSchema,
        name: { type: 'string' },
        parameters: closedObject({}),
        type: { const: descriptor.type },
        windowSize: byteSizeSchema,
    }, ['type', 'name', 'windowSize', 'addressWidth']);
}

function memorySchema(type: 'internal_ram' | 'external_local_bus'): JsonSchema {
    return closedObject({
        ...(type === 'internal_ram' ? { initFile: { minLength: 1, type: 'string' } } : {}),
        size: byteSizeSchema,
        type: { const: type },
    }, ['type', 'size']);
}

/** Generates the catalog-aware schema registered for `*.merc32.json` files. */
export function generateSocSchema(catalog: ModuleCatalog): object {
    const peripherals = [...catalog.modules.values()]
        .sort((left, right) => left.type.localeCompare(right.type))
        .map(peripheralSchema);
    const externalInterfaces = [...catalog.protocols.values()]
        .sort((left, right) => left.type.localeCompare(right.type))
        .map(externalInterfaceSchema);
    const interruptSource = closedObject({
        id: { type: 'integer' },
        source: { type: 'string' },
        trigger: { type: 'string' },
    }, ['source', 'id', 'trigger']);

    const schema: JsonSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        additionalProperties: false,
        properties: {
            cpu: closedObject({
                debug: { type: 'boolean' },
                jtagIdCode: addressSchema,
            }),
            externalInterfaces: {
                items: { oneOf: externalInterfaces },
                type: 'array',
            },
            interrupt: {
                oneOf: [
                    closedObject({ mode: { const: 'none' } }, ['mode']),
                    closedObject({
                        mode: { const: 'direct' },
                        source: { type: 'string' },
                    }, ['mode', 'source']),
                    closedObject({
                        controller: { type: 'string' },
                        mode: { const: 'controller' },
                        sources: { items: interruptSource, type: 'array' },
                    }, ['mode', 'controller', 'sources']),
                ],
            },
            memory: closedObject({
                dlb: { oneOf: [memorySchema('internal_ram'), memorySchema('external_local_bus')] },
                ilb: { oneOf: [memorySchema('internal_ram'), memorySchema('external_local_bus')] },
            }, ['ilb', 'dlb']),
            peripherals: {
                items: { oneOf: peripherals },
                type: 'array',
            },
            project: closedObject({
                name: { type: 'string' },
                outputDir: { type: 'string' },
            }, ['name', 'outputDir']),
            schemaVersion: { const: 1 },
        },
        required: [
            'schemaVersion', 'project', 'cpu', 'memory',
            'peripherals', 'externalInterfaces', 'interrupt',
        ],
        title: 'MERC32 SoC configuration',
        type: 'object',
    };

    return sortObjectKeys(schema) as object;
}

function sortObjectKeys(value: unknown): unknown {
    if (Array.isArray(value)) {
        return value.map(sortObjectKeys);
    }
    if (value === null || typeof value !== 'object') {
        return value;
    }

    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
}
