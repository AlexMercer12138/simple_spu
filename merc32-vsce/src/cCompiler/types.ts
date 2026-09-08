export type BuiltinTypeName =
    | 'void' | '_Bool' | 'char' | 'signed char' | 'unsigned char' | 'short' | 'unsigned short'
    | 'int' | 'unsigned int' | 'long' | 'unsigned long'
    | 'long long' | 'unsigned long long' | 'float' | 'double' | 'long double';

export interface BackendCompileOptions {
    readonly dataBase?: number;
    readonly dlbAddrWidth?: number;
    readonly codeBase?: number;
    readonly moduleName?: string;
    readonly tempSlots?: number;
    readonly optimization?: 'none' | 'basic';
}

export interface CompileResult {
    readonly assembly: string;
}

export interface TypeQualifiers {
    readonly const: boolean;
    readonly volatile: boolean;
    readonly restrict: boolean;
    readonly atomic: boolean;
}

export interface TypeBase {
    readonly kind: string;
    readonly qualifiers: TypeQualifiers;
}

export interface BuiltinType extends TypeBase {
    readonly kind: 'builtin';
    readonly name: BuiltinTypeName;
}
export interface PointerType extends TypeBase {
    readonly kind: 'pointer';
    readonly pointee: CType;
}
export interface ArrayType extends TypeBase {
    readonly kind: 'array';
    readonly element: CType;
    readonly length: number | null;
}
export interface FunctionType extends TypeBase {
    readonly kind: 'function';
    readonly returnType: CType;
    readonly parameters: readonly CType[];
    readonly variadic: boolean;
}
export interface StructField { readonly name: string; readonly type: CType; readonly offset?: number; readonly bitOffset?: number; readonly bitWidth?: number; }
export interface StructType extends TypeBase {
    readonly kind: 'struct';
    readonly name?: string;
    readonly fields: readonly StructField[];
    readonly nominalId?: number;
}
export interface UnionType extends TypeBase {
    readonly kind: 'union';
    readonly name?: string;
    readonly fields: readonly StructField[];
    readonly nominalId?: number;
}
export interface EnumType extends TypeBase {
    readonly kind: 'enum';
    readonly name?: string;
    readonly values: Readonly<Record<string, number>>;
    readonly nominalId?: number;
}
export interface TypedefType extends TypeBase {
    readonly kind: 'typedef';
    readonly name: string;
    readonly target?: CType;
}

export type CType = BuiltinType | PointerType | ArrayType | FunctionType | StructType | UnionType | EnumType | TypedefType;

const noQualifiers: TypeQualifiers = Object.freeze({ const: false, volatile: false, restrict: false, atomic: false });
const freeze = <T extends object>(value: T): Readonly<T> => Object.freeze(value);
function qualifiers(value?: Partial<TypeQualifiers>): TypeQualifiers {
    return freeze({
        const: value?.const === true,
        volatile: value?.volatile === true,
        restrict: value?.restrict === true,
        atomic: value?.atomic === true,
    });
}

export function builtinType(name: BuiltinTypeName, typeQualifiers?: Partial<TypeQualifiers>): BuiltinType {
    return freeze({ kind: 'builtin', name, qualifiers: qualifiers(typeQualifiers) }) as BuiltinType;
}
export function pointerType(pointee: CType, typeQualifiers?: Partial<TypeQualifiers>): PointerType {
    return freeze({ kind: 'pointer', pointee, qualifiers: qualifiers(typeQualifiers) }) as PointerType;
}
export function arrayType(element: CType, length: number | null, typeQualifiers?: Partial<TypeQualifiers>): ArrayType {
    if (length !== null && (!Number.isSafeInteger(length) || length < 0)) throw new RangeError('array length must be a non-negative integer');
    return freeze({ kind: 'array', element, length, qualifiers: qualifiers(typeQualifiers) }) as ArrayType;
}
export function functionType(returnType: CType, parameters: readonly CType[] = [], variadic = false, typeQualifiers?: Partial<TypeQualifiers>): FunctionType {
    return freeze({ kind: 'function', returnType, parameters: Object.freeze([...parameters]), variadic, qualifiers: qualifiers(typeQualifiers) }) as FunctionType;
}
export function structType(fields: readonly StructField[] = [], name?: string, typeQualifiers?: Partial<TypeQualifiers>): StructType {
    return freeze({ kind: 'struct', name, fields: Object.freeze(fields.map(field => freeze({ ...field }))), qualifiers: qualifiers(typeQualifiers) }) as StructType;
}
export function unionType(fields: readonly StructField[] = [], name?: string, typeQualifiers?: Partial<TypeQualifiers>): UnionType {
    return freeze({ kind: 'union', name, fields: Object.freeze(fields.map(field => freeze({ ...field }))), qualifiers: qualifiers(typeQualifiers) }) as UnionType;
}
export function enumType(values: Readonly<Record<string, number>> = {}, name?: string, typeQualifiers?: Partial<TypeQualifiers>): EnumType {
    return freeze({ kind: 'enum', name, values: freeze({ ...values }), qualifiers: qualifiers(typeQualifiers) }) as EnumType;
}
export function typedefType(name: string, target?: CType, typeQualifiers?: Partial<TypeQualifiers>): TypedefType {
    return freeze({ kind: 'typedef', name, target, qualifiers: qualifiers(typeQualifiers) }) as TypedefType;
}

export function qualifyType(type: CType, typeQualifiers: Partial<TypeQualifiers>): CType {
    const merged = { ...type.qualifiers, ...typeQualifiers };
    switch (type.kind) {
        case 'builtin': return builtinType(type.name, merged);
        case 'pointer': return pointerType(type.pointee, merged);
        case 'array': return arrayType(type.element, type.length, merged);
        case 'function': return functionType(type.returnType, type.parameters, type.variadic, merged);
        case 'struct': return structType(type.fields, type.name, merged);
        case 'union': return unionType(type.fields, type.name, merged);
        case 'enum': return enumType(type.values, type.name, merged);
        case 'typedef': return typedefType(type.name, type.target, merged);
    }
}

export function enumUnderlyingType(_type: EnumType): BuiltinType { return builtinType('int'); }

export function typeSize(type: CType): number {
    switch (type.kind) {
        case 'builtin': return ({ void: 0, _Bool: 1, char: 1, 'signed char': 1, 'unsigned char': 1, short: 2, 'unsigned short': 2, int: 4, 'unsigned int': 4, long: 4, 'unsigned long': 4, 'long long': 8, 'unsigned long long': 8, float: 4, double: 8, 'long double': 8 } as Record<BuiltinTypeName, number>)[type.name];
        case 'pointer': return 4;
        case 'function': throw new Error('function type has no object size');
        case 'array':
            if (type.length === null) throw new Error('incomplete array type has no size');
            return type.length * typeSize(type.element);
        case 'struct': return structLayout(type.fields).size;
        case 'union': return unionLayout(type.fields).size;
        case 'enum': return 4;
        case 'typedef':
            if (!type.target) throw new Error(`unresolved typedef '${type.name}' has no size`);
            return typeSize(type.target);
    }
}
export function typeAlignment(type: CType): number {
    if (type.kind === 'array') return typeAlignment(type.element);
    if (type.kind === 'struct') return structLayout(type.fields).alignment;
    if (type.kind === 'union') return unionLayout(type.fields).alignment;
    if (type.kind === 'typedef') return type.target ? typeAlignment(type.target) : 1;
    if (type.kind === 'builtin' && (type.name === '_Bool' || type.name === 'char' || type.name === 'signed char' || type.name === 'unsigned char')) return 1;
    if (type.kind === 'builtin' && (type.name === 'short' || type.name === 'unsigned short')) return 2;
    return Math.max(1, Math.min(4, typeSize(type)));
}
export function isIntegerType(type: CType): boolean {
    return type.kind === 'builtin' && ['_Bool', 'char', 'signed char', 'unsigned char', 'short', 'unsigned short', 'int', 'unsigned int', 'long', 'unsigned long', 'long long', 'unsigned long long'].includes(type.name)
        || type.kind === 'enum' || type.kind === 'typedef' && !!type.target && isIntegerType(type.target);
}
export function isScalarType(type: CType): boolean {
    return isIntegerType(type) || type.kind === 'pointer' || type.kind === 'enum'
        || type.kind === 'builtin' && ['float', 'double', 'long double'].includes(type.name);
}
export function isCompleteType(type: CType): boolean {
    if (type.kind === 'array') return type.length !== null && isCompleteType(type.element);
    if (type.kind === 'function') return false;
    if (type.kind === 'typedef') return !!type.target && isCompleteType(type.target);
    if (type.kind === 'builtin') return type.name !== 'void';
    return true;
}

export interface FieldLayout extends StructField { readonly offset: number; }
export interface AggregateLayout { readonly size: number; readonly alignment: number; readonly fields: readonly FieldLayout[]; }
const alignUp = (value: number, alignment: number): number => Math.ceil(value / alignment) * alignment;
export function structLayout(fields: readonly StructField[]): AggregateLayout {
    if (fields.length > 0 && fields.every(field => field.offset !== undefined)) {
        const alignment = Math.min(4, Math.max(1, ...fields.map(field => typeAlignment(field.type))));
        const laidOut = fields.map(field => freeze({ ...field, offset: field.offset! }));
        const size = alignUp(Math.max(...laidOut.map(field => field.offset + typeSize(field.type))), alignment);
        return freeze({ size, alignment, fields: Object.freeze(laidOut) });
    }
    let offset = 0;
    const laidOut: FieldLayout[] = fields.map(field => { const alignment = Math.min(4, typeAlignment(field.type)); offset = alignUp(offset, alignment); const result = { ...field, offset }; offset += typeSize(field.type); return freeze(result); });
    const alignment = Math.min(4, Math.max(1, ...fields.map(field => typeAlignment(field.type))));
    return freeze({ size: alignUp(offset, alignment), alignment, fields: Object.freeze(laidOut) });
}
export function unionLayout(fields: readonly StructField[]): AggregateLayout {
    const alignment = Math.min(4, Math.max(1, ...fields.map(field => typeAlignment(field.type))));
    return freeze({ size: alignUp(Math.max(0, ...fields.map(field => typeSize(field.type))), alignment), alignment, fields: Object.freeze(fields.map(field => freeze({ ...field, offset: 0 }))) });
}

export { noQualifiers };
