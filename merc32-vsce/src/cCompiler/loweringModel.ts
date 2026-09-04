import { SourceLocation } from './source';
import { CType } from './types';

export type LoweringAddress = Readonly<{ symbol: string; addend: bigint }>;
export type LoweringString = Readonly<{ bytes: readonly number[] }>;
export type LoweringConstant = bigint | LoweringAddress | LoweringString;

export interface LoweringExpression {
    readonly kind: string;
    readonly type: CType;
    readonly valueCategory: 'lvalue' | 'function' | 'rvalue';
    readonly location: SourceLocation;
    readonly operands: readonly LoweringExpression[];
    readonly symbol?: string;
    readonly binding?: string;
    readonly symbolId?: number;
    readonly operator?: string;
    readonly conversion?: string;
    readonly memberIndex?: number;
    readonly memberOffset?: number;
    readonly targetType?: CType;
    readonly constant?: LoweringConstant;
}

export interface LoweringInitializerWrite {
    readonly offset: number;
    readonly type: CType;
    readonly value: LoweringConstant;
    readonly location: SourceLocation;
}

export interface LoweringInitializer {
    readonly size: number;
    readonly writes: readonly LoweringInitializerWrite[];
}

export interface LoweringGlobal {
    readonly name: string;
    readonly type: CType;
    readonly initializer?: LoweringInitializer;
    readonly location?: SourceLocation;
}

export type LoweringStatement =
    | Readonly<{ kind: 'compound'; statements: readonly LoweringStatement[]; location: SourceLocation }>
    | Readonly<{ kind: 'declaration'; name: string; binding?: string; symbolId?: number; type: CType; initializer?: LoweringExpression | LoweringInitializer; location: SourceLocation }>
    | Readonly<{ kind: 'expression'; expression: LoweringExpression; location: SourceLocation }>
    | Readonly<{ kind: 'return'; expression?: LoweringExpression; location: SourceLocation }>
    | Readonly<{ kind: 'if'; test: LoweringExpression; thenBranch: LoweringStatement; elseBranch?: LoweringStatement; location: SourceLocation }>
    | Readonly<{ kind: 'while'; test: LoweringExpression; body: LoweringStatement; location: SourceLocation }>
    | Readonly<{ kind: 'do-while'; body: LoweringStatement; test: LoweringExpression; location: SourceLocation }>
    | Readonly<{ kind: 'for'; init?: LoweringStatement | LoweringExpression; test?: LoweringExpression; step?: LoweringExpression; body: LoweringStatement; location: SourceLocation }>
    | Readonly<{ kind: 'switch'; test: LoweringExpression; body: LoweringStatement; location: SourceLocation }>
    | Readonly<{ kind: 'case'; value: bigint; statement: LoweringStatement; location: SourceLocation }>
    | Readonly<{ kind: 'default'; statement: LoweringStatement; location: SourceLocation }>
    | Readonly<{ kind: 'break' | 'continue' | 'empty'; location: SourceLocation }>
    | Readonly<{ kind: 'goto' | 'label'; label: string; statement?: LoweringStatement; location: SourceLocation }>;

export interface LoweringFunction {
    readonly name: string;
    readonly returnType: CType;
    readonly parameters: readonly CType[];
    readonly parameterNames: readonly string[];
    readonly localNames: readonly string[];
    readonly localTypes: readonly CType[];
    readonly body: LoweringStatement;
    readonly location?: SourceLocation;
}

export interface LoweringProgram {
    readonly abi: 'merc32-c-v1';
    readonly globals: readonly LoweringGlobal[];
    readonly functions: readonly LoweringFunction[];
}
