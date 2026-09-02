import { CType } from './types';
import { SourceLocation } from './source';
export type Expression = IntegerLiteralExpression | IdentifierExpression | CallExpression | BinaryExpression | AssignmentExpression;
export interface IntegerLiteralExpression { readonly kind: 'integer-literal'; readonly value: number; readonly location?: SourceLocation; }
export interface IdentifierExpression { readonly kind: 'identifier'; readonly name: string; readonly location?: SourceLocation; }
export interface CallExpression { readonly kind: 'call'; readonly callee: IdentifierExpression; readonly arguments: readonly Expression[]; readonly location?: SourceLocation; }
export interface BinaryExpression { readonly kind: 'binary'; readonly operator: string; readonly left: Expression; readonly right: Expression; readonly location?: SourceLocation; }
export interface AssignmentExpression { readonly kind: 'assignment'; readonly target: IdentifierExpression; readonly value: Expression; readonly location?: SourceLocation; }
export type Statement = CompoundStatement | ReturnStatement | LocalDeclarationStatement | ExpressionStatement | IfStatement | WhileStatement | ForStatement | BreakStatement | ContinueStatement;
export interface CompoundStatement { readonly kind: 'compound'; readonly statements: readonly Statement[]; readonly location?: SourceLocation; }
export interface ReturnStatement { readonly kind: 'return'; readonly expression?: Expression; readonly location?: SourceLocation; }
export interface LocalDeclarationStatement { readonly kind: 'local-declaration'; readonly name: string; readonly type: CType; readonly initializer?: Expression; readonly location?: SourceLocation; }
export interface ExpressionStatement { readonly kind: 'expression'; readonly expression: Expression; readonly location?: SourceLocation; }
export interface IfStatement { readonly kind: 'if'; readonly test: Expression; readonly thenBranch: Statement; readonly elseBranch?: Statement; readonly location?: SourceLocation; }
export interface WhileStatement { readonly kind: 'while'; readonly test: Expression; readonly body: Statement; readonly location?: SourceLocation; }
export interface ForStatement { readonly kind: 'for'; readonly init?: Statement | Expression; readonly test?: Expression; readonly step?: Expression; readonly body: Statement; readonly location?: SourceLocation; }
export interface BreakStatement { readonly kind: 'break'; readonly location?: SourceLocation; }
export interface ContinueStatement { readonly kind: 'continue'; readonly location?: SourceLocation; }
export interface ParameterDeclaration { readonly name?: string; readonly type: CType; readonly location?: SourceLocation; }
export interface Declarator { readonly name?: string; readonly type: CType; readonly parameters?: readonly ParameterDeclaration[]; readonly body?: CompoundStatement; readonly location?: SourceLocation; }
export interface Declaration { readonly kind: 'declaration' | 'typedef' | 'struct-definition' | 'struct-declaration'; readonly type: CType; readonly declarators: readonly Declarator[]; readonly name?: string; readonly location?: SourceLocation; }
export interface TranslationUnit { readonly kind: 'translation-unit'; readonly declarations: readonly Declaration[]; }
export interface Initializer { readonly kind: 'initializer'; readonly tokens: readonly string[]; readonly designator?: string; }
