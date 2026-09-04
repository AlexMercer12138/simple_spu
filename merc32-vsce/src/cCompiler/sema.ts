import { CompoundStatement, Expression, Statement, TranslationUnit } from './declarations';
import {
  AggregateLayout, CType, FunctionType, StructType, UnionType, arrayType, builtinType,
  isCompleteType, isIntegerType, isScalarType, pointerType, qualifyType, structLayout,
  typeAlignment, typeSize, unionLayout,
} from './types';
import { CFrontendError, SourceLocation } from './source';

export interface SymbolEntry { readonly name: string; readonly type: CType; }

export class Scope {
  private readonly ordinary = new Map<string, SymbolEntry>();
  private readonly typedefs = new Map<string, CType>();
  private readonly tags = new Map<string, CType>();
  constructor(private readonly parent?: Scope) {}
  child(): Scope { return new Scope(this); }
  define(name: string, type: CType): void { this.ordinary.set(name, { name, type }); }
  resolveOwn(name: string): SymbolEntry | undefined { return this.ordinary.get(name); }
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
  readonly expressionTypes: ReadonlyMap<Expression, CType>;
}

export function analyzeTranslationUnit(unit: TranslationUnit): AnalyzedProgram {
  const scope = new Scope();
  const globals = new Map<string, SymbolEntry>();
  const functions: SymbolEntry[] = [];
  const typedefs = new Map<string, CType>();
  const expressionTypes = new Map<Expression, CType>();
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
      if (!declarator.initializer || declarator.initializer.kind === 'initializer') continue;
      const initializerType = decay(analyzeExpression(declarator.initializer, scope, expressionTypes));
      if (!isAssignable(declarator.type, initializerType)) {
        throw frontendError(`initializer for '${declarator.name ?? '<anonymous>'}' has incompatible type`, declarator.location ?? declaration.location);
      }
      evaluateIntegerConstantExpression(declarator.initializer);
    }
  }
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (declarator.type.kind !== 'function' || !declarator.body) continue;
      const functionScope = scope.child();
      for (const parameter of declarator.parameters ?? []) {
        if (!parameter.name) throw frontendError(`function '${declarator.name ?? '<anonymous>'}' has an unnamed parameter`, parameter.location);
        functionScope.define(parameter.name, parameter.type);
      }
      validateFunctionLabels(declarator.body);
      analyzeCompoundStatement(declarator.body, functionScope, { loopDepth: 0, switches: [] }, expressionTypes);
    }
  }
  return { unit, globals, functions, typedefs, constants: new Map(), expressionTypes };
}

interface StatementContext {
  readonly loopDepth: number;
  readonly switches: readonly SwitchContext[];
}

interface SwitchContext { readonly values: Set<number>; hasDefault: boolean; }

function analyzeCompoundStatement(statement: CompoundStatement, scope: Scope, context: StatementContext, expressionTypes: Map<Expression, CType>): void {
  const blockScope = scope.child();
  for (const child of statement.statements) analyzeStatement(child, blockScope, context, expressionTypes);
}

function analyzeStatement(statement: Statement, scope: Scope, context: StatementContext, expressionTypes: Map<Expression, CType>): void {
  switch (statement.kind) {
    case 'compound':
      analyzeCompoundStatement(statement, scope, context, expressionTypes);
      return;
    case 'local-declaration':
      if (scope.resolveOwn(statement.name)) throw frontendError(`duplicate local '${statement.name}'`, statement.location);
      if (statement.initializer) {
        const initializerType = analyzeExpression(statement.initializer, scope, expressionTypes);
        if (!isAssignable(statement.type, decay(initializerType))) {
          throw frontendError(`initializer for '${statement.name}' has incompatible type`, statement.location);
        }
      }
      scope.define(statement.name, statement.type);
      return;
    case 'expression':
      analyzeExpression(statement.expression, scope, expressionTypes);
      return;
    case 'return':
      if (statement.expression) analyzeExpression(statement.expression, scope, expressionTypes);
      return;
    case 'if':
      requireScalar(analyzeExpression(statement.test, scope, expressionTypes), statement.test); analyzeStatement(statement.thenBranch, scope, context, expressionTypes); if (statement.elseBranch) analyzeStatement(statement.elseBranch, scope, context, expressionTypes); return;
    case 'while':
      requireScalar(analyzeExpression(statement.test, scope, expressionTypes), statement.test); analyzeStatement(statement.body, scope, { ...context, loopDepth: context.loopDepth + 1 }, expressionTypes); return;
    case 'do-while':
      analyzeStatement(statement.body, scope, { ...context, loopDepth: context.loopDepth + 1 }, expressionTypes); requireScalar(analyzeExpression(statement.test, scope, expressionTypes), statement.test); return;
    case 'switch':
      {
        if (!isIntegerType(analyzeExpression(statement.test, scope, expressionTypes))) throw frontendError('switch expression must have integer type', statement.test.location);
        const switchContext: SwitchContext = { values: new Set(), hasDefault: false };
        analyzeStatement(statement.body, scope, { ...context, switches: [...context.switches, switchContext] }, expressionTypes);
        return;
      }
    case 'case': {
      const switchContext = context.switches[context.switches.length - 1];
      if (!switchContext) throw frontendError(`${statement.value ? 'case' : 'default'} label used outside switch`, statement.location);
      if (statement.value) {
        const value = evaluateIntegerConstantExpression(statement.value);
        if (switchContext.values.has(value)) throw frontendError('duplicate case value in one switch', statement.location);
        switchContext.values.add(value);
      } else {
        if (switchContext.hasDefault) throw frontendError('multiple default labels in one switch', statement.location);
        switchContext.hasDefault = true;
      }
      analyzeStatement(statement.statement, scope, context, expressionTypes);
      return;
    }
    case 'label':
      analyzeStatement(statement.statement, scope, context, expressionTypes);
      return;
    case 'goto':
    case 'empty':
      return;
    case 'for':
      {
        const loopScope = scope.child();
        if (statement.init) {
          if ((statement.init as Statement).kind === 'local-declaration') analyzeStatement(statement.init as Statement, loopScope, context, expressionTypes);
          else analyzeExpression(statement.init as Expression, loopScope, expressionTypes);
        }
        if (statement.test) requireScalar(analyzeExpression(statement.test, loopScope, expressionTypes), statement.test);
        if (statement.step) analyzeExpression(statement.step, loopScope, expressionTypes);
        analyzeStatement(statement.body, loopScope, { ...context, loopDepth: context.loopDepth + 1 }, expressionTypes);
        return;
      }
    case 'break':
      if (context.loopDepth === 0 && context.switches.length === 0) throw frontendError('break used outside loop or switch', statement.location);
      return;
    case 'continue':
      if (context.loopDepth === 0) throw frontendError('continue used outside loop', statement.location);
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
        if (labels.has(current.label)) throw frontendError(`duplicate label '${current.label}'`, current.location);
        labels.add(current.label); collect(current.statement); return;
      case 'goto': gotos.push(current); return;
      case 'local-declaration': case 'expression': case 'return': case 'break': case 'continue': case 'empty': return;
    }
  };
  collect(statement);
  for (const jump of gotos) {
    if (!labels.has(jump.label)) throw frontendError(`undefined label '${jump.label}'`, jump.location);
  }
}

export function evaluateIntegerConstantExpression(expression: Expression): number {
  if (expression.kind === 'integer-literal' || expression.kind === 'character-literal') return expression.value;
  if (expression.kind === 'sizeof') {
    if (!expression.typeOperand) throw frontendError('sizeof expression is not an integer constant expression yet', expression.location);
    return typeSize(expression.typeOperand);
  }
  if (expression.kind === 'alignof') return typeAlignment(expression.typeOperand);
  if (expression.kind === 'unary') {
    const operand = evaluateIntegerConstantExpression(expression.operand);
    if (expression.operator === '+') return operand;
    if (expression.operator === '-') return -operand;
    if (expression.operator === '!') return operand === 0 ? 1 : 0;
    if (expression.operator === '~') return ~operand;
    throw frontendError('case value must be an integer constant expression', expression.location);
  }
  if (expression.kind === 'conditional') {
    return evaluateIntegerConstantExpression(expression.condition) !== 0
      ? evaluateIntegerConstantExpression(expression.consequent)
      : evaluateIntegerConstantExpression(expression.alternate);
  }
  if (expression.kind !== 'binary') throw frontendError('case value must be an integer constant expression', expression.location);
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
    default: throw frontendError('case value must be an integer constant expression', expression.location);
  }
}

function analyzeExpression(expression: Expression, scope: Scope, expressionTypes: Map<Expression, CType>): CType {
  const record = (type: CType): CType => {
    expressionTypes.set(expression, type);
    return type;
  };
  switch (expression.kind) {
    case 'integer-literal':
    case 'character-literal':
      return record(builtinType('int'));
    case 'floating-literal':
      return record(builtinType(expression.precision));
    case 'string-literal':
      return record(arrayType(builtinType('char', { const: true }), [...expression.value].length + 1));
    case 'identifier': {
      const symbol = scope.resolve(expression.name);
      if (!symbol) throw frontendError(`unknown identifier '${expression.name}'`, expression.location);
      return record(symbol.type);
    }
    case 'unary': {
      const operandType = analyzeExpression(expression.operand, scope, expressionTypes);
      if (expression.operator === '&') {
        if (!isLValue(expression.operand) && unwrapType(operandType).kind !== 'function') throw frontendError('address-of requires an lvalue or function', expression.location);
        return record(pointerType(operandType));
      }
      if (expression.operator === '*') {
        const pointer = unwrapType(decay(operandType));
        if (pointer.kind !== 'pointer') throw frontendError('dereference requires a pointer', expression.location);
        return record(pointer.pointee);
      }
      if (expression.operator === '!') {
        requireScalar(decay(operandType), expression);
        return record(builtinType('int'));
      }
      if (!isArithmeticType(operandType)) throw frontendError(`unary '${expression.operator}' requires arithmetic type`, expression.location);
      return record(integerPromote(operandType));
    }
    case 'call': {
      const calleeType = unwrapType(decay(analyzeExpression(expression.callee, scope, expressionTypes)));
      const functionType = calleeType.kind === 'function'
        ? calleeType
        : calleeType.kind === 'pointer' && unwrapType(calleeType.pointee).kind === 'function'
          ? unwrapType(calleeType.pointee) as FunctionType
          : undefined;
      if (!functionType) throw frontendError('called object is not a function or function pointer', expression.location);
      if (expression.arguments.length < functionType.parameters.length
        || !functionType.variadic && expression.arguments.length !== functionType.parameters.length) {
        throw frontendError(`function expects ${functionType.parameters.length} argument(s), got ${expression.arguments.length}`, expression.location);
      }
      expression.arguments.forEach((argument, index) => {
        const argumentType = decay(analyzeExpression(argument, scope, expressionTypes));
        const parameterType = functionType.parameters[index];
        if (parameterType && !isAssignable(parameterType, argumentType)) {
          throw frontendError(`argument ${index + 1} has incompatible type`, argument.location);
        }
      });
      return record(functionType.returnType);
    }
    case 'subscript': {
      const objectType = unwrapType(decay(analyzeExpression(expression.object, scope, expressionTypes)));
      const indexType = analyzeExpression(expression.index, scope, expressionTypes);
      if (!isIntegerType(indexType)) throw frontendError('array subscript must have integer type', expression.index.location);
      if (objectType.kind !== 'pointer') throw frontendError('subscripted object is not an array or pointer', expression.location);
      return record(objectType.pointee);
    }
    case 'member': {
      let objectType = unwrapType(analyzeExpression(expression.object, scope, expressionTypes));
      if (expression.indirect) {
        objectType = unwrapType(decay(objectType));
        if (objectType.kind !== 'pointer') throw frontendError("operator '->' requires a pointer", expression.location);
        objectType = unwrapType(objectType.pointee);
      }
      if (objectType.kind !== 'struct' && objectType.kind !== 'union') throw frontendError('member access requires a struct or union', expression.location);
      const field = objectType.fields.find(candidate => candidate.name === expression.member);
      if (!field) throw frontendError(`${objectType.kind} '${objectType.name ?? '<anonymous>'}' has no member '${expression.member}'`, expression.location);
      return record(objectType.qualifiers.const ? qualifyType(field.type, { const: true }) : field.type);
    }
    case 'sizeof': {
      const operandType = expression.typeOperand ?? analyzeExpression(expression.expressionOperand!, scope, expressionTypes);
      if (!isCompleteType(operandType)) throw frontendError('sizeof requires a complete object type', expression.location);
      typeSize(operandType);
      return record(builtinType('unsigned int'));
    }
    case 'alignof':
      if (!isCompleteType(expression.typeOperand)) throw frontendError('_Alignof requires a complete object type', expression.location);
      typeAlignment(expression.typeOperand);
      return record(builtinType('unsigned int'));
    case 'binary': {
      const left = decay(analyzeExpression(expression.left, scope, expressionTypes));
      const right = decay(analyzeExpression(expression.right, scope, expressionTypes));
      if (['&&','||'].includes(expression.operator)) {
        requireScalar(left, expression.left); requireScalar(right, expression.right);
        return record(builtinType('int'));
      }
      if (['==','!=','<','<=','>','>='].includes(expression.operator)) {
        requireScalar(left, expression.left); requireScalar(right, expression.right);
        return record(builtinType('int'));
      }
      if ((expression.operator === '+' || expression.operator === '-') && unwrapType(left).kind === 'pointer' && isIntegerType(right)) return record(left);
      if (expression.operator === '+' && isIntegerType(left) && unwrapType(right).kind === 'pointer') return record(right);
      if (expression.operator === '-' && unwrapType(left).kind === 'pointer' && unwrapType(right).kind === 'pointer') return record(builtinType('int'));
      if (['%','&','|','^','<<','>>'].includes(expression.operator)) {
        if (!isIntegerType(left) || !isIntegerType(right)) throw frontendError(`operator '${expression.operator}' requires integer operands`, expression.location);
        return record(commonArithmeticType(left, right));
      }
      if (!isArithmeticType(left) || !isArithmeticType(right)) throw frontendError(`operator '${expression.operator}' requires arithmetic operands`, expression.location);
      return record(commonArithmeticType(left, right));
    }
    case 'conditional': {
      requireScalar(decay(analyzeExpression(expression.condition, scope, expressionTypes)), expression.condition);
      const consequent = decay(analyzeExpression(expression.consequent, scope, expressionTypes));
      const alternate = decay(analyzeExpression(expression.alternate, scope, expressionTypes));
      if (isArithmeticType(consequent) && isArithmeticType(alternate)) return record(commonArithmeticType(consequent, alternate));
      if (isAssignable(consequent, alternate)) return record(consequent);
      if (isAssignable(alternate, consequent)) return record(alternate);
      throw frontendError('conditional operands have incompatible types', expression.location);
    }
    case 'assignment': {
      if (!isLValue(expression.target)) throw frontendError('assignment target is not a modifiable lvalue', expression.location);
      const targetType = analyzeExpression(expression.target, scope, expressionTypes);
      if (targetType.qualifiers.const) throw frontendError('assignment to const-qualified object', expression.location);
      const valueType = decay(analyzeExpression(expression.value, scope, expressionTypes));
      if (!isAssignable(targetType, valueType)) throw frontendError('assignment has incompatible type', expression.location);
      return record(targetType);
    }
  }
}

export function layoutAggregate(type: StructType | UnionType): AggregateLayout {
  if (!isCompleteType(type)) throw new Error('incomplete aggregate type');
  return type.kind === 'struct' ? structLayout(type.fields) : unionLayout(type.fields);
}

function frontendError(message: string, location?: SourceLocation): Error {
  return location ? new CFrontendError(message, location) : new Error(message);
}

export function isAssignable(target: CType, source: CType): boolean {
  target = unwrapType(target);
  source = unwrapType(source);
  if (target.kind === 'pointer' && source.kind === 'pointer') {
    return target.pointee.kind === 'builtin' && target.pointee.name === 'void'
      || source.pointee.kind === 'builtin' && source.pointee.name === 'void'
      || target.pointee.kind === source.pointee.kind;
  }
  return target.kind === source.kind && (target.kind !== 'builtin' || source.kind !== 'builtin' || target.name === source.name)
    || target.kind === 'builtin' && source.kind === 'builtin';
}

function unwrapType(type: CType): CType {
  let current = type;
  const seen = new Set<CType>();
  while (current.kind === 'typedef' && current.target && !seen.has(current)) {
    seen.add(current);
    current = current.target;
  }
  return current;
}

function decay(type: CType): CType {
  const unwrapped = unwrapType(type);
  if (unwrapped.kind === 'array') return pointerType(unwrapped.element);
  if (unwrapped.kind === 'function') return pointerType(unwrapped);
  return type;
}

function isLValue(expression: Expression): boolean {
  return expression.kind === 'identifier' || expression.kind === 'subscript' || expression.kind === 'member'
    || expression.kind === 'unary' && expression.operator === '*';
}

function isArithmeticType(type: CType): boolean {
  const unwrapped = unwrapType(type);
  return isIntegerType(unwrapped)
    || unwrapped.kind === 'builtin' && ['float','double','long double'].includes(unwrapped.name);
}

function requireScalar(type: CType, expression: Expression): void {
  if (!isScalarType(unwrapType(type))) throw frontendError('expression must have scalar type', expression.location);
}

function integerPromote(type: CType): CType {
  const unwrapped = unwrapType(type);
  if (unwrapped.kind === 'enum') return builtinType('int');
  if (unwrapped.kind !== 'builtin') return type;
  if (['char','unsigned char','short','unsigned short'].includes(unwrapped.name)) return builtinType('int');
  return unwrapped;
}

function commonArithmeticType(left: CType, right: CType): CType {
  const promotedLeft = integerPromote(left);
  const promotedRight = integerPromote(right);
  const ranking = ['int','unsigned int','long','unsigned long','long long','unsigned long long','float','double','long double'];
  const leftName = unwrapType(promotedLeft).kind === 'builtin' ? (unwrapType(promotedLeft) as Extract<CType, { kind: 'builtin' }>).name : 'int';
  const rightName = unwrapType(promotedRight).kind === 'builtin' ? (unwrapType(promotedRight) as Extract<CType, { kind: 'builtin' }>).name : 'int';
  return builtinType((ranking.indexOf(leftName) >= ranking.indexOf(rightName) ? leftName : rightName) as Parameters<typeof builtinType>[0]);
}
