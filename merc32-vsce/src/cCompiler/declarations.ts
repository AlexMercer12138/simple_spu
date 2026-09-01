import { CType } from './types';
import { SourceLocation } from './source';
export interface Declarator { readonly name?: string; readonly type: CType; readonly location?: SourceLocation; }
export interface Declaration { readonly kind: 'declaration' | 'typedef' | 'struct-definition' | 'struct-declaration'; readonly type: CType; readonly declarators: readonly Declarator[]; readonly name?: string; readonly location?: SourceLocation; }
export interface TranslationUnit { readonly kind: 'translation-unit'; readonly declarations: readonly Declaration[]; }
export interface Initializer { readonly kind: 'initializer'; readonly tokens: readonly string[]; readonly designator?: string; }
