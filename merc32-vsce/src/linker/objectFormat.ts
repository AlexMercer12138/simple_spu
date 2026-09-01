import { SourceLocation } from '../cCompiler/source';

export type ObjectSectionName = 'text' | 'rodata' | 'data' | 'bss';
export interface ObjectSection {
    readonly name: ObjectSectionName;
    readonly alignment: number;
    readonly size: number;
    readonly content?: readonly number[] | string;
}
export type SymbolBinding = 'local' | 'global';
export interface ObjectSymbol {
    readonly name: string;
    readonly binding: SymbolBinding;
    readonly section?: ObjectSectionName;
    readonly offset?: number;
    readonly defined: boolean;
}
export type RelocationKind = 'ABS32' | 'IMM16' | 'CALL16' | 'BRANCH16' | 'HI16' | 'LO16';
export interface Relocation {
    readonly section: ObjectSectionName;
    readonly offset: number;
    readonly kind: RelocationKind;
    readonly symbol: string;
    readonly addend: number;
    readonly debug?: DebugLocation;
}
export interface DebugLocation extends SourceLocation {}
export interface Merc32Object {
    readonly version: 1;
    readonly target: 'merc32';
    readonly abi: string;
    readonly sections: readonly ObjectSection[];
    readonly symbols: readonly ObjectSymbol[];
    readonly relocations: readonly Relocation[];
    readonly debug?: readonly DebugLocation[];
}
