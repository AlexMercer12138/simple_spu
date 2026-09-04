export type SourceFileId = number & { readonly __sourceFileId: unique symbol };
export type TypeId = number & { readonly __typeId: unique symbol };
export type SymbolId = number & { readonly __symbolId: unique symbol };
export type NodeId = number & { readonly __nodeId: unique symbol };

export interface SourcePosition {
    readonly line: number;
    readonly column: number;
    readonly byteOffset: number;
}

export interface SourceRange {
    readonly file: SourceFileId;
    readonly start: SourcePosition;
    readonly end: SourcePosition;
}

export interface SourceFileRecord {
    readonly id: SourceFileId;
    readonly path: string;
    readonly byteLength: number;
    readonly utf8BoundaryBitmap: string;
}

export interface CFrontendDiagnostic {
    readonly severity: 'note' | 'warning' | 'error' | 'fatal';
    readonly code: string;
    readonly message: string;
    readonly range: SourceRange;
    readonly related: readonly Readonly<{ message: string; range: SourceRange }>[];
    readonly notes: readonly string[];
    readonly includeTrace: readonly SourceRange[];
    readonly macroExpansionTrace: readonly SourceRange[];
}

export type IntegerConstant = Readonly<{
    kind: 'integer';
    bits: number;
    signed: boolean;
    value: string;
}>;

export type FloatingConstant = Readonly<{
    kind: 'floating';
    type: TypeId;
    ieeeBits: string;
}>;

export type AddressConstant = Readonly<{
    kind: 'address';
    symbol: SymbolId;
    addend: string;
}>;

export type StringConstant = Readonly<{
    kind: 'string';
    elementType: TypeId;
    bytes: readonly number[];
}>;

export type TypedConstant = IntegerConstant | FloatingConstant | AddressConstant | StringConstant;

export interface TypedInitializerWrite {
    readonly offset: number;
    readonly type: TypeId;
    readonly value: TypedConstant;
}

export interface TypedInitializer {
    readonly size: number;
    readonly zeroFill: true;
    readonly writes: readonly TypedInitializerWrite[];
}

export type TypeQualifier = 'const' | 'volatile' | 'restrict' | 'atomic';

export type BuiltinTypeName =
    | 'void' | '_Bool'
    | 'char' | 'signed char' | 'unsigned char'
    | 'short' | 'unsigned short'
    | 'int' | 'unsigned int'
    | 'long' | 'unsigned long'
    | 'long long' | 'unsigned long long'
    | 'float' | 'double' | 'long double';

interface TypedTypeBase<K extends string> {
    readonly id: TypeId;
    readonly kind: K;
    readonly qualifiers: readonly TypeQualifier[];
    readonly size: number;
    readonly alignment: number;
}

export interface BuiltinTypeRecord extends TypedTypeBase<'builtin'> {
    readonly name: BuiltinTypeName;
}

export interface PointerTypeRecord extends TypedTypeBase<'pointer'> {
    readonly pointee: TypeId;
}

export interface ArrayTypeRecord extends TypedTypeBase<'array'> {
    readonly element: TypeId;
    readonly count: number;
}

export interface FunctionTypeRecord extends TypedTypeBase<'function'> {
    readonly returnType: TypeId;
    readonly parameters: readonly TypeId[];
    readonly variadic: boolean;
}

export interface AggregateMemberRecord {
    readonly name: string;
    readonly type: TypeId;
    readonly offset: number;
    readonly bitOffset?: number;
    readonly bitWidth?: number;
    readonly range: SourceRange;
}

export interface StructTypeRecord extends TypedTypeBase<'struct'> {
    readonly name?: string;
    readonly complete: boolean;
    readonly members: readonly AggregateMemberRecord[];
}

export interface UnionTypeRecord extends TypedTypeBase<'union'> {
    readonly name?: string;
    readonly complete: boolean;
    readonly members: readonly AggregateMemberRecord[];
}

export interface EnumValueRecord {
    readonly name: string;
    readonly value: string;
    readonly range: SourceRange;
}

export interface EnumTypeRecord extends TypedTypeBase<'enum'> {
    readonly name?: string;
    readonly underlyingType: TypeId;
    readonly enumerators: readonly EnumValueRecord[];
}

export interface TypedefTypeRecord extends TypedTypeBase<'typedef'> {
    readonly name: string;
    readonly target: TypeId;
}

export type TypedTypeRecord =
    | BuiltinTypeRecord | PointerTypeRecord | ArrayTypeRecord | FunctionTypeRecord
    | StructTypeRecord | UnionTypeRecord | EnumTypeRecord | TypedefTypeRecord;

export type TypedSymbolKind =
    | 'variable' | 'function' | 'parameter' | 'typedef'
    | 'record' | 'enum' | 'enumerator' | 'label';

interface TypedSymbolBase<K extends TypedSymbolKind> {
    readonly id: SymbolId;
    readonly kind: K;
    readonly name: string;
    readonly range: SourceRange;
}

export interface VariableSymbolRecord extends TypedSymbolBase<'variable'> {
    readonly type: TypeId;
    readonly linkage: 'none' | 'internal' | 'external';
    readonly storage: 'automatic' | 'static' | 'extern' | 'register' | 'thread';
    readonly definition: boolean;
    readonly initializer?: TypedInitializer;
}

export interface FunctionSymbolRecord extends TypedSymbolBase<'function'> {
    readonly type: TypeId;
    readonly linkage: 'internal' | 'external';
    readonly definition: boolean;
}

export interface ParameterSymbolRecord extends TypedSymbolBase<'parameter'> {
    readonly type: TypeId;
    readonly owner: SymbolId;
}

export interface TypedefSymbolRecord extends TypedSymbolBase<'typedef'> {
    readonly type: TypeId;
}

export interface RecordSymbolRecord extends TypedSymbolBase<'record'> {
    readonly type: TypeId;
}

export interface EnumSymbolRecord extends TypedSymbolBase<'enum'> {
    readonly type: TypeId;
}

export interface EnumeratorSymbolRecord extends TypedSymbolBase<'enumerator'> {
    readonly type: TypeId;
    readonly owner: SymbolId;
    readonly value: IntegerConstant;
}

export interface LabelSymbolRecord extends TypedSymbolBase<'label'> {
    readonly owner: SymbolId;
}

export type TypedSymbolRecord =
    | VariableSymbolRecord | FunctionSymbolRecord | ParameterSymbolRecord
    | TypedefSymbolRecord | RecordSymbolRecord | EnumSymbolRecord
    | EnumeratorSymbolRecord | LabelSymbolRecord;

export type TypedNodeKind =
    | 'variable-declaration' | 'function-declaration' | 'function-definition'
    | 'parameter-declaration' | 'typedef-declaration' | 'record-declaration'
    | 'enum-declaration' | 'static-assert'
    | 'compound' | 'declaration-statement' | 'expression-statement' | 'return'
    | 'if' | 'while' | 'do-while' | 'for' | 'switch' | 'case' | 'default'
    | 'break' | 'continue' | 'goto' | 'label' | 'empty'
    | 'integer-literal' | 'floating-literal' | 'character-literal' | 'string-literal'
    | 'declaration-reference' | 'unary' | 'binary' | 'conditional' | 'assignment'
    | 'call' | 'subscript' | 'member' | 'sizeof' | 'alignof' | 'conversion'
    | 'compound-literal' | 'generic-selection';

export type ValueCategory = 'lvalue' | 'function' | 'rvalue';
export type ConversionKind =
    | 'lvalue-to-rvalue' | 'array-to-pointer' | 'function-to-pointer'
    | 'integer-promotion' | 'usual-arithmetic' | 'assignment'
    | 'argument' | 'return' | 'no-op' | 'bitcast'
    | 'pointer-to-bool' | 'pointer-to-int' | 'bool-to-int'
    | 'bool-to-float' | 'bool-to-pointer' | 'int-to-bool'
    | 'int-to-float' | 'complex-int-to-complex-float'
    | 'int-to-pointer' | 'float-to-bool' | 'float-to-int'
    | 'complex-float-to-complex-int' | 'int-cast' | 'complex-int-cast'
    | 'complex-int-to-real' | 'real-to-complex-int' | 'float-cast'
    | 'complex-float-cast' | 'complex-float-to-real'
    | 'real-to-complex-float' | 'to-void' | 'null-to-pointer'
    | 'union-cast' | 'vector-splat' | 'atomic-to-non-atomic'
    | 'non-atomic-to-atomic';

interface TypedNodeBase<K extends TypedNodeKind, C extends 'expression' | 'statement' | 'declaration'> {
    readonly id: NodeId;
    readonly category: C;
    readonly kind: K;
    readonly range: SourceRange;
    readonly spellingRange?: SourceRange;
    readonly children: readonly NodeId[];
}

type DeclarationWithSymbol<K extends TypedNodeKind> = TypedNodeBase<K, 'declaration'> & Readonly<{
    type: TypeId;
    symbol: SymbolId;
}>;

type PlainStatement<K extends TypedNodeKind> = TypedNodeBase<K, 'statement'>;

type ExpressionBase<K extends TypedNodeKind> = TypedNodeBase<K, 'expression'> & Readonly<{
    type: TypeId;
    valueCategory: ValueCategory;
    constant?: TypedConstant;
}>;

export type TypedNodeRecord =
    | DeclarationWithSymbol<
        | 'variable-declaration' | 'function-declaration' | 'function-definition'
        | 'parameter-declaration' | 'typedef-declaration' | 'record-declaration'
        | 'enum-declaration'>
    | TypedNodeBase<'static-assert', 'declaration'>
    | PlainStatement<
        | 'compound' | 'declaration-statement' | 'expression-statement' | 'return'
        | 'if' | 'while' | 'do-while' | 'for' | 'switch' | 'default'
        | 'break' | 'continue' | 'empty'>
    | (PlainStatement<'case'> & Readonly<{ caseValue: IntegerConstant }>)
    | (PlainStatement<'goto' | 'label'> & Readonly<{ label: string }>)
    | (ExpressionBase<'integer-literal' | 'character-literal'> & Readonly<{ constant: IntegerConstant }>)
    | (ExpressionBase<'floating-literal'> & Readonly<{ constant: FloatingConstant }>)
    | (ExpressionBase<'string-literal'> & Readonly<{ constant: StringConstant }>)
    | (ExpressionBase<'declaration-reference'> & Readonly<{ symbol: SymbolId }>)
    | (ExpressionBase<'unary' | 'binary' | 'conditional' | 'assignment'> & Readonly<{ operator: string }>)
    | ExpressionBase<'call' | 'subscript'>
    | (ExpressionBase<'member'> & Readonly<{ memberIndex: number }>)
    | (ExpressionBase<'sizeof' | 'alignof'> & Readonly<{ targetType: TypeId; constant: IntegerConstant }>)
    | (ExpressionBase<'conversion'> & Readonly<{ conversion: ConversionKind; targetType: TypeId }>)
    | (ExpressionBase<'compound-literal'> & Readonly<{ targetType: TypeId }>)
    | (ExpressionBase<'generic-selection'> & Readonly<{ memberIndex: number }>);

export interface TypedCUnitV1 {
    readonly schema: 'merc32.typed-c-unit';
    readonly schemaVersion: 1;
    readonly target: 'merc32';
    readonly abi: 'merc32-c-v1';
    readonly dataModel: 'merc32-ilp32';
    readonly language: 'c17-freestanding';
    readonly sourceFiles: readonly SourceFileRecord[];
    readonly types: readonly TypedTypeRecord[];
    readonly symbols: readonly TypedSymbolRecord[];
    readonly nodes: readonly TypedNodeRecord[];
    readonly declarations: readonly NodeId[];
}

export interface TypedCEnvelopeV1 {
    readonly protocolVersion: 1;
    readonly bridgeBuildId: string;
    readonly status: 'ok' | 'diagnostics' | 'internal-error';
    readonly diagnostics: readonly CFrontendDiagnostic[];
    readonly sourceFiles?: readonly SourceFileRecord[];
    readonly unit?: TypedCUnitV1;
}

export interface CCompileDetailedResult<T> {
    readonly artifact?: T;
    readonly diagnostics: readonly CFrontendDiagnostic[];
}
