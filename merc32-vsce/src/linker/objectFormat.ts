import { SourceLocation } from '../cCompiler/source';

export type ObjectSectionName = 'text' | 'rodata' | 'data' | 'bss';
export interface ObjectSection {
    readonly name: ObjectSectionName;
    readonly alignment: number;
    readonly size: number;
    readonly content?: readonly number[] | string;
    readonly source?: string;
    readonly entryLabel?: string;
}

/** Normalize a section's canonical numeric payload; text entries are words. */
export function normalizeSectionContent(section: ObjectSection): readonly number[] {
    if (section.name === 'bss') {
        if (section.content !== undefined) throw new Error('bss section must not have content');
        return [];
    }
    if (section.content === undefined) {
        throw new Error(`section '${section.name}' requires content`);
    }
    if (typeof section.content === 'string') {
        if (section.name !== 'text') throw new Error(`section '${section.name}' content must be bytes`);
        const words = section.content.split(/\r?\n/).filter(line => {
            let stripped = line.replace(/\/\/.*$/, '').trim();
            stripped = stripped.replace(/^[A-Za-z_][A-Za-z0-9_]*\s*:\s*/, '').trim();
            return stripped !== '' && !stripped.startsWith('.');
        });
        return words.map(() => 0);
    }
    if (!Array.isArray(section.content) || section.content.some(value => !Number.isInteger(value))) {
        throw new Error(`section '${section.name}' content must be integers`);
    }
    const max = section.name === 'text' ? 0xffffffff : 0xff;
    if (section.content.some(value => value < 0 || value > max)) {
        throw new Error(`section '${section.name}' content value out of range`);
    }
    return section.content;
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
    /** Scratch register explicitly available at this control-flow site (r4-r11). */
    readonly relaxationRegister?: number;
    readonly debug?: DebugLocation;
}
export interface DebugLocation extends SourceLocation {}
/** Complete, ordered text partition; each function terminates without falling into its successor.
 * All symbolic references from these functions must have relocations. */
export interface ObjectFunction {
    readonly name: string;
    readonly offset: number;
    readonly size: number;
}
export interface Merc32Object {
    readonly version: 1;
    readonly target: 'merc32';
    readonly abi: string;
    readonly sections: readonly ObjectSection[];
    readonly symbols: readonly ObjectSymbol[];
    readonly relocations: readonly Relocation[];
    readonly functions?: readonly ObjectFunction[];
    readonly debug?: readonly DebugLocation[];
}
