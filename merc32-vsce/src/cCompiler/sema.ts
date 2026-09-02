import { CompoundStatement, Expression, Statement, TranslationUnit } from './declarations';
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
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (declarator.type.kind !== 'function' || !declarator.body) continue;
      const functionScope = scope.child();
      for (const parameter of declarator.parameters ?? []) {
        if (!parameter.name) throw new Error(`function '${declarator.name ?? '<anonymous>'}' has an unnamed parameter`);
        functionScope.define(parameter.name, parameter.type);
      }
      validateFunctionLabels(declarator.body);
      analyzeCompoundStatement(declarator.body, functionScope, { loopDepth: 0, switches: [] });
    }
  }
  return { unit, globals, functions, typedefs, constants: new Map() };
}

interface StatementContext {
  readonly loopDepth: number;
  readonly switches: readonly SwitchContext[];
}

interface SwitchContext { readonly values: Set<number>; hasDefault: boolean; }

function analyzeCompoundStatement(statement: CompoundStatement, scope: Scope, context: StatementContext): void {
  const blockScope = scope.child();
  for (const child of statement.statements) analyzeStatement(child, blockScope, context);
}

function analyzeStatement(statement: Statement, scope: Scope, context: StatementContext): void {
  switch (statement.kind) {
    case 'compound':
      analyzeCompoundStatement(statement, scope, context);
      return;
    case 'local-declaration':
      if (scope.resolve(statement.name)) throw new Error(`duplicate local '${statement.name}'`);
      if (statement.initializer) analyzeExpression(statement.initializer, scope);
      scope.define(statement.name, statement.type);
      return;
    case 'expression':
      analyzeExpression(statement.expression, scope);
      return;
    case 'return':
      if (statement.expression) analyzeExpression(statement.expression, scope);
      return;
    case 'if':
      analyzeExpression(statement.test, scope); analyzeStatement(statement.thenBranch, scope, context); if (statement.elseBranch) analyzeStatement(statement.elseBranch, scope, context); return;
    case 'while':
      analyzeExpression(statement.test, scope); analyzeStatement(statement.body, scope, { ...context, loopDepth: context.loopDepth + 1 }); return;
    case 'do-while':
      analyzeStatement(statement.body, scope, { ...context, loopDepth: context.loopDepth + 1 }); analyzeExpression(statement.test, scope); return;
    case 'switch':
      {
        analyzeExpression(statement.test, scope);
        const switchContext: SwitchContext = { values: new Set(), hasDefault: false };
        analyzeStatement(statement.body, scope, { ...context, switches: [...context.switches, switchContext] });
        return;
      }
    case 'case': {
      const switchContext = context.switches[context.switches.length - 1];
      if (!switchContext) throw new Error(`${statement.value ? 'case' : 'default'} label used outside switch`);
      if (statement.value) {
        const value = evaluateIntegerConstantExpression(statement.value);
        if (switchContext.values.has(value)) throw new Error('duplicate case value in one switch');
        switchContext.values.add(value);
      } else {
        if (switchContext.hasDefault) throw new Error('multiple default labels in one switch');
        switchContext.hasDefault = true;
      }
      analyzeStatement(statement.statement, scope, context);
      return;
    }
    case 'label':
      analyzeStatement(statement.statement, scope, context);
      return;
    case 'goto':
    case 'empty':
      return;
    case 'for':
      {
        const loopScope = scope.child();
        if (statement.init) {
          if ((statement.init as Statement).kind === 'local-declaration') analyzeStatement(statement.init as Statement, loopScope, context);
          else analyzeExpression(statement.init as Expression, loopScope);
        }
        if (statement.test) analyzeExpression(statement.test, loopScope);
        if (statement.step) analyzeExpression(statement.step, loopScope);
        analyzeStatement(statement.body, loopScope, { ...context, loopDepth: context.loopDepth + 1 });
        return;
      }
    case 'break':
      if (context.loopDepth === 0 && context.switches.length === 0) throw new Error('break used outside loop or switch');
      return;
    case 'continue':
      if (context.loopDepth === 0) throw new Error('continue used outside loop');
      return;
  }
}

function validateFunctionLabels(statement: Statement): void {
  const labels = new Set<string>();
  const gotos: Extract<Statement, { kind: 'goto' }>[] = [];
  const collect = (current: Statement): void => {
    switch (current.kind) {
      case 'compound': current.statements.forEach(collect); return;
      case 'if': collect(current.thenBranch); if (current.elseBranch) collect(current.elseBranch); return;
      case 'while': case 'do-while': case 'switch': case 'for': collect(current.body); return;
      case 'case': collect(current.statement); return;
      case 'label':
        if (labels.has(current.label)) throw new Error(`duplicate label '${current.label}'`);
        labels.add(current.label); collect(current.statement); return;
      case 'goto': gotos.push(current); return;
      case 'local-declaration': case 'expression': case 'return': case 'break': case 'continue': case 'empty': return;
    }
  };
  collect(statement);
  for (const jump of gotos) {
    if (!labels.has(jump.label)) throw new Error(`undefined label '${jump.label}'`);
  }
}

export function evaluateIntegerConstantExpression(expression: Expression): number {
  if (expression.kind === 'integer-literal') return expression.value;
  if (expression.kind !== 'binary') throw new Error('case value must be an integer constant expression');
  const left = evaluateIntegerConstantExpression(expression.left);
  if (expression.operator === '&&' && left === 0) return 0;
  if (expression.operator === '||' && left !== 0) return 1;
  const right = evaluateIntegerConstantExpression(expression.right);
  switch (expression.operator) {
    case '+': return left + right;
    case '-': return left - right;
    case '*': return Math.imul(left, right);
    case '/': return Math.trunc(left / right);
    case '%': return left % right;
    case '&': return left & right;
    case '|': return left | right;
    case '^': return left ^ right;
    case '<<': return left << right;
    case '>>': return left >> right;
    case '==': return left === right ? 1 : 0;
    case '!=': return left !== right ? 1 : 0;
    case '<': return left < right ? 1 : 0;
    case '<=': return left <= right ? 1 : 0;
    case '>': return left > right ? 1 : 0;
    case '>=': return left >= right ? 1 : 0;
    case '&&': return right !== 0 ? 1 : 0;
    case '||': return right !== 0 ? 1 : 0;
    default: throw new Error('case value must be an integer constant expression');
  }
}

function analyzeExpression(expression: Expression, scope: Scope): void {
  switch (expression.kind) {
    case 'integer-literal':
      return;
    case 'identifier':
      if (!scope.resolve(expression.name)) throw new Error(`unknown identifier '${expression.name}'`);
      return;
    case 'call':
      if (!scope.resolve(expression.callee.name)) throw new Error(`unknown function '${expression.callee.name}'`);
      expression.arguments.forEach(argument => analyzeExpression(argument, scope));
      return;
    case 'binary':
      analyzeExpression(expression.left, scope);
      analyzeExpression(expression.right, scope);
      return;
    case 'assignment':
      if (!scope.resolve(expression.target.name)) throw new Error(`unknown identifier '${expression.target.name}'`);
      analyzeExpression(expression.value, scope);
      return;
  }
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
