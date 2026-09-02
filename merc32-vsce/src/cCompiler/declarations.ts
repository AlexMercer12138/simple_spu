import { CType } from './types';
import { SourceLocation } from './source';
export type Expression = IntegerLiteralExpression | IdentifierExpression | CallExpression;
export interface IntegerLiteralExpression { readonly kind: 'integer-literal'; readonly value: number; readonly location?: SourceLocation; }
export interface IdentifierExpression { readonly kind: 'identifier'; readonly name: string; readonly location?: SourceLocation; }
export interface CallExpression { readonly kind: 'call'; readonly callee: IdentifierExpression; readonly arguments: readonly Expression[]; readonly location?: SourceLocation; }
export type Statement = CompoundStatement | ReturnStatement;
export interface CompoundStatement { readonly kind: 'compound'; readonly statements: readonly Statement[]; readonly location?: SourceLocation; }
export interface ReturnStatement { readonly kind: 'return'; readonly expression?: Expression; readonly location?: SourceLocation; }
export interface Declarator { readonly name?: string; readonly type: CType; readonly body?: CompoundStatement; readonly location?: SourceLocation; }
export interface Declaration { readonly kind: 'declaration' | 'typedef' | 'struct-definition' | 'struct-declaration'; readonly type: CType; readonly declarators: readonly Declarator[]; readonly name?: string; readonly location?: SourceLocation; }
export interface TranslationUnit { readonly kind: 'translation-unit'; readonly declarations: readonly Declaration[]; }
export interface Initializer { readonly kind: 'initializer'; readonly tokens: readonly string[]; readonly designator?: string; }
