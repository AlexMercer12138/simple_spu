import { CType } from './types';
import { SourceLocation } from './source';

export interface CNode { readonly location?: SourceLocation; }
export interface CTranslationUnit extends CNode { readonly kind: 'translation-unit'; readonly declarations: readonly CNode[]; }
export interface CDeclaration extends CNode { readonly kind: 'declaration'; readonly name: string; readonly type: CType; }
export interface Merc32Object { readonly format: 'merc32-object'; readonly assembly: string; readonly symbols?: Readonly<Record<string, number>>; }
