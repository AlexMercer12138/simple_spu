import { CType } from './types';
import { SourceLocation } from './source';
export type Expression =
    | IntegerLiteralExpression | FloatingLiteralExpression | CharacterLiteralExpression | StringLiteralExpression
    | IdentifierExpression | UnaryExpression | CallExpression | SubscriptExpression | MemberExpression
    | SizeofExpression | AlignofExpression | BinaryExpression | ConditionalExpression | AssignmentExpression;
export interface IntegerLiteralExpression { readonly kind: 'integer-literal'; readonly value: number; readonly location?: SourceLocation; }
export interface FloatingLiteralExpression { readonly kind: 'floating-literal'; readonly value: number; readonly precision: 'float' | 'double'; readonly location?: SourceLocation; }
export interface CharacterLiteralExpression { readonly kind: 'character-literal'; readonly value: number; readonly location?: SourceLocation; }
export interface StringLiteralExpression { readonly kind: 'string-literal'; readonly value: string; readonly location?: SourceLocation; }
export interface IdentifierExpression { readonly kind: 'identifier'; readonly name: string; readonly location?: SourceLocation; }
export interface UnaryExpression { readonly kind: 'unary'; readonly operator: string; readonly operand: Expression; readonly location?: SourceLocation; }
export interface CallExpression { readonly kind: 'call'; readonly callee: Expression; readonly arguments: readonly Expression[]; readonly location?: SourceLocation; }
export interface SubscriptExpression { readonly kind: 'subscript'; readonly object: Expression; readonly index: Expression; readonly location?: SourceLocation; }
export interface MemberExpression { readonly kind: 'member'; readonly object: Expression; readonly member: string; readonly indirect: boolean; readonly location?: SourceLocation; }
export interface SizeofExpression { readonly kind: 'sizeof'; readonly typeOperand?: CType; readonly expressionOperand?: Expression; readonly location?: SourceLocation; }
export interface AlignofExpression { readonly kind: 'alignof'; readonly typeOperand: CType; readonly location?: SourceLocation; }
export interface BinaryExpression { readonly kind: 'binary'; readonly operator: string; readonly left: Expression; readonly right: Expression; readonly location?: SourceLocation; }
export interface ConditionalExpression { readonly kind: 'conditional'; readonly condition: Expression; readonly consequent: Expression; readonly alternate: Expression; readonly location?: SourceLocation; }
export interface AssignmentExpression { readonly kind: 'assignment'; readonly target: Expression; readonly value: Expression; readonly location?: SourceLocation; }
export type Statement = CompoundStatement | ReturnStatement | LocalDeclarationStatement | ExpressionStatement | IfStatement | WhileStatement | DoWhileStatement | SwitchStatement | CaseStatement | ForStatement | BreakStatement | ContinueStatement | GotoStatement | LabelStatement | EmptyStatement;
export interface CompoundStatement { readonly kind: 'compound'; readonly statements: readonly Statement[]; readonly location?: SourceLocation; }
export interface ReturnStatement { readonly kind: 'return'; readonly expression?: Expression; readonly location?: SourceLocation; }
export interface LocalDeclarationStatement { readonly kind: 'local-declaration'; readonly name: string; readonly type: CType; readonly initializer?: CInitializer; readonly location?: SourceLocation; }
export interface ExpressionStatement { readonly kind: 'expression'; readonly expression: Expression; readonly location?: SourceLocation; }
export interface IfStatement { readonly kind: 'if'; readonly test: Expression; readonly thenBranch: Statement; readonly elseBranch?: Statement; readonly location?: SourceLocation; }
export interface WhileStatement { readonly kind: 'while'; readonly test: Expression; readonly body: Statement; readonly location?: SourceLocation; }
export interface DoWhileStatement { readonly kind: 'do-while'; readonly body: Statement; readonly test: Expression; readonly location?: SourceLocation; }
export interface SwitchStatement { readonly kind: 'switch'; readonly test: Expression; readonly body: Statement; readonly location?: SourceLocation; }
export interface CaseStatement { readonly kind: 'case'; readonly value?: Expression; readonly statement: Statement; readonly location?: SourceLocation; }
export interface ForStatement { readonly kind: 'for'; readonly init?: Statement | Expression; readonly test?: Expression; readonly step?: Expression; readonly body: Statement; readonly location?: SourceLocation; }
export interface BreakStatement { readonly kind: 'break'; readonly location?: SourceLocation; }
export interface ContinueStatement { readonly kind: 'continue'; readonly location?: SourceLocation; }
export interface GotoStatement { readonly kind: 'goto'; readonly label: string; readonly location?: SourceLocation; }
export interface LabelStatement { readonly kind: 'label'; readonly label: string; readonly statement: Statement; readonly location?: SourceLocation; }
export interface EmptyStatement { readonly kind: 'empty'; readonly location?: SourceLocation; }
export interface ParameterDeclaration { readonly name?: string; readonly type: CType; readonly location?: SourceLocation; }
export interface Declarator { readonly name?: string; readonly type: CType; readonly parameters?: readonly ParameterDeclaration[]; readonly body?: CompoundStatement; readonly initializer?: CInitializer; readonly location?: SourceLocation; }
export interface Declaration { readonly kind: 'declaration' | 'typedef' | 'struct-definition' | 'struct-declaration'; readonly type: CType; readonly declarators: readonly Declarator[]; readonly name?: string; readonly location?: SourceLocation; }
export interface TranslationUnit { readonly kind: 'translation-unit'; readonly declarations: readonly Declaration[]; }
export type CInitializer = Expression | Initializer;
export type InitializerDesignator = FieldInitializerDesignator | IndexInitializerDesignator;
export interface FieldInitializerDesignator { readonly kind: 'field-designator'; readonly field: string; readonly location?: SourceLocation; }
export interface IndexInitializerDesignator { readonly kind: 'index-designator'; readonly index: Expression; readonly location?: SourceLocation; }
export interface InitializerEntry { readonly designators: readonly InitializerDesignator[]; readonly value: CInitializer; readonly location?: SourceLocation; }
export interface Initializer { readonly kind: 'initializer'; readonly entries: readonly InitializerEntry[]; readonly location?: SourceLocation; }
