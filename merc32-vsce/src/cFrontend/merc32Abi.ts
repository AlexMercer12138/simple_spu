export interface Merc32Abi {
    readonly target: 'merc32';
    readonly abi: 'merc32-c-v1';
    readonly dataModel: 'merc32-ilp32';
    readonly endian: 'little';
    readonly pointerSize: number;
    readonly pointerAlignment: number;
    readonly maximumNaturalAlignment: number;
    readonly functionAlignment: number;
    readonly builtin: Readonly<{
        bool: readonly [number, number];
        char: readonly [number, number];
        short: readonly [number, number];
        int: readonly [number, number];
        long: readonly [number, number];
        longLong: readonly [number, number];
        float: readonly [number, number];
        double: readonly [number, number];
        longDouble: readonly [number, number];
    }>;
}

const layout = (size: number, alignment: number): readonly [number, number] =>
    Object.freeze([size, alignment] as [number, number]);

export const MERC32_ABI: Merc32Abi = Object.freeze({
    target: 'merc32',
    abi: 'merc32-c-v1',
    dataModel: 'merc32-ilp32',
    endian: 'little',
    pointerSize: 4,
    pointerAlignment: 4,
    maximumNaturalAlignment: 4,
    functionAlignment: 4,
    builtin: Object.freeze({
        bool: layout(1, 1),
        char: layout(1, 1),
        short: layout(2, 2),
        int: layout(4, 4),
        long: layout(4, 4),
        longLong: layout(8, 4),
        float: layout(4, 4),
        double: layout(8, 4),
        longDouble: layout(8, 4),
    }),
});
