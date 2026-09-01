import { Declaration, TranslationUnit } from './declarations';
import { AggregateLayout, CType, StructType, UnionType, isCompleteType, structLayout, unionLayout } from './types';

export interface SymbolEntry { readonly name: string; readonly type: CType; }

export class Scope {
  private readonly ordinary = new Map<string, SymbolEntry>();
  private readonly typedefs = new Map<string, CType>();
  private readonly tags = new Map<string, CType>();
  constructor(private readonly parent?: Scope) {}
  child(): Scope { return new Scope(this); }
  define(name: string, type: CType): void { this.ordinary.set(name, { name, type }); }
  resolve(name: string): SymbolEntry | undefined { return this.ordinary.get(name) ?? this.parent?.resolve(name); }
  defineTypedef(name: string, type: CType): void { this.typedefs.set(name, type); }
  resolveTypedef(name: string): CType | undefined { return this.typedefs.get(name) ?? this.parent?.resolveTypedef(name); }
  defineTag(name: string, type: CType): void { this.tags.set(name, type); }
  resolveTag(name: string): CType | undefined { return this.tags.get(name) ?? this.parent?.resolveTag(name); }
}

export interface AnalyzedProgram {
  readonly unit: TranslationUnit;
  readonly globals: ReadonlyMap<string, SymbolEntry>;
  readonly functions: readonly SymbolEntry[];
  readonly typedefs: ReadonlyMap<string, CType>;
  readonly constants: ReadonlyMap<string, number>;
}

export function analyzeTranslationUnit(unit: TranslationUnit): AnalyzedProgram {
  const scope = new Scope();
  const globals = new Map<string, SymbolEntry>();
  const functions: SymbolEntry[] = [];
  const typedefs = new Map<string, CType>();
  for (const declaration of unit.declarations) {
    if (declaration.kind === 'typedef') {
      for (const declarator of declaration.declarators) {
        if (declarator.name) {
          const target = declarator.type.kind === 'typedef' && declarator.type.target
            ? declarator.type.target
            : declarator.type;
          scope.defineTypedef(declarator.name, target);
          typedefs.set(declarator.name, target);
        }
      }
      continue;
    }
    if (declaration.name && (declaration.type.kind === 'struct' || declaration.type.kind === 'union')) {
      scope.defineTag(declaration.name, declaration.type);
    }
    for (const declarator of declaration.declarators) {
      if (!declarator.name) continue;
      const symbol = { name: declarator.name, type: declarator.type };
      scope.define(declarator.name, declarator.type);
      globals.set(declarator.name, symbol);
      if (declarator.type.kind === 'function') functions.push(symbol);
    }
  }
  return { unit, globals, functions, typedefs, constants: new Map() };
}

export function layoutAggregate(type: StructType | UnionType): AggregateLayout {
  if (!isCompleteType(type)) throw new Error('incomplete aggregate type');
  return type.kind === 'struct' ? structLayout(type.fields) : unionLayout(type.fields);
}

export function isAssignable(target: CType, source: CType): boolean {
  if (target.kind === 'pointer' && source.kind === 'pointer') {
    return target.pointee.kind === 'builtin' && target.pointee.name === 'void'
      || source.pointee.kind === 'builtin' && source.pointee.name === 'void'
      || target.pointee.kind === source.pointee.kind;
  }
  return target.kind === source.kind && (target.kind !== 'builtin' || source.kind !== 'builtin' || target.name === source.name)
    || target.kind === 'builtin' && source.kind === 'builtin';
}
