import { CType } from './types';
import { SourceLocation } from './source';
import { Merc32Object } from '../linker/objectFormat';

export interface CNode { readonly location?: SourceLocation; }
export interface CTranslationUnit extends CNode { readonly kind: 'translation-unit'; readonly declarations: readonly CNode[]; }
export interface CDeclaration extends CNode { readonly kind: 'declaration'; readonly name: string; readonly type: CType; }
export type { Merc32Object } from '../linker/objectFormat';
