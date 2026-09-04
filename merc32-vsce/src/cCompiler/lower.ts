import { AnalyzedProgram, evaluateIntegerConstantExpression } from './sema';
import { Expression, Statement, TranslationUnit } from './declarations';
import { CType, pointerType, structLayout, typeAlignment, typeSize, unionLayout } from './types';
import { IRBlock, IRFunction, IRGlobal, IRInstruction, Merc32Module } from './ir';

export function lowerProgram(program: AnalyzedProgram | TranslationUnit): Merc32Module {
  const unit = 'unit' in program ? program.unit : program;
  const expressionTypes = 'expressionTypes' in program ? program.expressionTypes : new Map<Expression, CType>();
  const occupiedSymbols = new Set<string>();
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (declarator.name) occupiedSymbols.add(declarator.name);
    }
  }
  const occupiedLabels = new Set(occupiedSymbols);
  const globalTypes = new Map<string, CType>();
  const globals: IRGlobal[] = [];
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (declarator.name && declarator.type.kind !== 'function' && declaration.kind !== 'typedef') {
        globalTypes.set(declarator.name, declarator.type);
        const initializer = declarator.initializer && declarator.initializer.kind !== 'initializer'
          ? encodeScalarInitializer(declarator.type, evaluateIntegerConstantExpression(declarator.initializer))
          : undefined;
        globals.push({ name: declarator.name, type: declarator.type, ...(initializer ? { initializer } : {}) });
      }
    }
  }
  const functions: IRFunction[] = [];
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (!declarator.name || declarator.type.kind !== 'function' || !declarator.body) continue;
      const parameters = new Map((declarator.parameters ?? [])
        .filter(parameter => parameter.name)
        .map(parameter => [parameter.name!, parameter.type]));
      const lowerer = new FunctionLowerer(declarator.name, occupiedLabels, expressionTypes, globalTypes, parameters);
      declarator.body.statements.forEach(statement => lowerer.lowerStatement(statement));
      if (lowerer.instructions.length === 0 || lowerer.instructions[lowerer.instructions.length - 1].op !== 'ret') {
        const zero = lowerer.constant(0);
        lowerer.instructions.push({ op: 'ret', args: [zero] });
      }
      const block: IRBlock = { label: `${declarator.name}.entry`, instructions: lowerer.instructions };
      functions.push({
        name: declarator.name,
        returnType: declarator.type.returnType,
        parameters: declarator.type.parameters,
        parameterNames: (declarator.parameters ?? []).map(parameter => parameter.name ?? ''),
        localNames: lowerer.localNames,
        localTypes: lowerer.localTypes,
        returnLabel: lowerer.returnLabel(),
        blocks: [block],
      });
    }
  }
  const initializerName = '__merc32_init_globals';
  if (occupiedSymbols.has(initializerName)) throw new Error(`reserved compiler symbol '${initializerName}' is already defined`);
  functions.push(createGlobalInitializer(initializerName, globals));
  return {
    abi: 'merc32-c-v1',
    functions,
    globals,
  };
}

function encodeScalarInitializer(type: CType, value: number): readonly number[] {
  const size = typeSize(type);
  if (size !== 1 && size !== 2 && size !== 4) {
    throw new Error(`typed global initializer does not support ${size}-byte objects`);
  }
  const bits = value >>> 0;
  return Array.from({ length: size }, (_, index) => (bits >>> (index * 8)) & 0xff);
}

function createGlobalInitializer(name: string, globals: readonly IRGlobal[]): IRFunction {
  const instructions: IRInstruction[] = [];
  let nextValue = 0;
  for (const global of globals) {
    const base = nextValue++;
    instructions.push({ op: 'address-symbol', args: [global.name], dest: base });
    const bytes = global.initializer ?? Array.from({ length: typeSize(global.type) }, () => 0);
    for (let offset = 0; offset < bytes.length; offset++) {
      let address = base;
      if (offset !== 0) {
        const offsetValue = nextValue++;
        instructions.push({ op: 'constant', args: [offset], dest: offsetValue });
        address = nextValue++;
        instructions.push({ op: 'binary', args: ['+', base, offsetValue], dest: address });
      }
      const value = nextValue++;
      instructions.push({ op: 'constant', args: [bytes[offset]], dest: value });
      instructions.push({ op: 'store-memory', args: [address, value, 1] });
    }
  }
  const zero = nextValue++;
  instructions.push({ op: 'constant', args: [0], dest: zero });
  instructions.push({ op: 'ret', args: [zero] });
  return {
    name,
    parameters: [],
    parameterNames: [],
    localNames: [],
    localTypes: [],
    blocks: [{ label: `${name}.entry`, instructions }],
  };
}

class FunctionLowerer {
  readonly instructions: IRInstruction[] = [];
  readonly localNames: string[] = [];
  readonly localTypes: CType[] = [];
  private nextValue = 0;
  private nextLabel = 0;
  private breakLabels: string[] = [];
  private continueLabels: string[] = [];
  private switchCaseLabels: Map<Extract<Statement, { kind: 'case' }>, string>[] = [];
  private readonly userLabels = new Map<string, string>();
  constructor(
    private readonly functionName: string,
    private readonly occupiedLabels: Set<string>,
    private readonly expressionTypes: ReadonlyMap<Expression, CType>,
    private readonly globalTypes: ReadonlyMap<string, CType>,
    private readonly parameterTypes: ReadonlyMap<string, CType>,
  ) {}

  lowerStatement(statement: Statement): void {
    switch (statement.kind) {
      case 'compound':
        statement.statements.forEach(child => this.lowerStatement(child));
        return;
      case 'local-declaration': {
        this.localNames.push(statement.name);
        this.localTypes.push(statement.type);
        if (statement.initializer) {
          this.instructions.push({ op: 'store', args: [statement.name, this.lowerExpression(statement.initializer)], location: statement.location });
        }
        return;
      }
      case 'expression':
        this.lowerExpression(statement.expression);
        return;
      case 'return':
        this.instructions.push({ op: 'ret', args: [statement.expression ? this.lowerExpression(statement.expression) : this.constant(0)], location: statement.location });
        return;
      case 'if': {
        const elseLabel = this.label('else'); const endLabel = this.label('endif');
        const test = this.lowerExpression(statement.test); this.instructions.push({ op:'branch-zero', args:[test, elseLabel], location:statement.location });
        this.lowerStatement(statement.thenBranch); this.instructions.push({ op:'jump', args:[endLabel] }); this.instructions.push({ op:'label', args:[elseLabel] });
        if (statement.elseBranch) this.lowerStatement(statement.elseBranch); this.instructions.push({ op:'label', args:[endLabel] }); return;
      }
      case 'while': {
        const start = this.label('while'); const end = this.label('endwhile');
        this.instructions.push({ op:'label', args:[start] }); const test = this.lowerExpression(statement.test); this.instructions.push({ op:'branch-zero', args:[test, end] });
        this.breakLabels.push(end); this.continueLabels.push(start); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop();
        this.instructions.push({ op:'jump', args:[start] }, { op:'label', args:[end] }); return;
      }
      case 'do-while': {
        const body = this.label('do_body'); const condition = this.label('do_condition'); const end = this.label('enddo');
        this.instructions.push({ op:'label', args:[body] });
        this.breakLabels.push(end); this.continueLabels.push(condition); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop();
        this.instructions.push({ op:'label', args:[condition] }); const test = this.lowerExpression(statement.test); this.instructions.push({ op:'branch-nonzero', args:[test, body] }, { op:'label', args:[end] }); return;
      }
      case 'switch': {
        const end = this.label('switch_end');
        const entries = this.collectSwitchCases(statement.body);
        const labels = new Map(entries.map(entry => [entry.statement, entry.label]));
        const defaultEntry = entries.find(entry => entry.statement.value === undefined);
        const test = this.lowerExpression(statement.test);
        for (const entry of entries) {
          if (entry.statement.value === undefined) continue;
          const value = this.constant(evaluateIntegerConstantExpression(entry.statement.value), entry.statement.location);
          const matches = this.allocateValue();
          this.instructions.push({ op:'binary', args:['==', test, value], dest:matches, location:entry.statement.location });
          this.instructions.push({ op:'branch-nonzero', args:[matches, entry.label], location:entry.statement.location });
        }
        this.instructions.push({ op:'jump', args:[defaultEntry?.label ?? end] });
        this.breakLabels.push(end); this.switchCaseLabels.push(labels); this.lowerStatement(statement.body); this.switchCaseLabels.pop(); this.breakLabels.pop();
        this.instructions.push({ op:'label', args:[end] }); return;
      }
      case 'case': {
        const label = this.switchCaseLabels[this.switchCaseLabels.length - 1]?.get(statement);
        if (!label) throw new Error(`${statement.value ? 'case' : 'default'} label used outside switch`);
        this.instructions.push({ op:'label', args:[label] }); this.lowerStatement(statement.statement); return;
      }
      case 'goto':
        this.instructions.push({ op:'jump', args:[this.userLabel(statement.label)], location:statement.location }); return;
      case 'label':
        this.instructions.push({ op:'label', args:[this.userLabel(statement.label)], location:statement.location }); this.lowerStatement(statement.statement); return;
      case 'empty':
        return;
      case 'for': {
        if (statement.init) (statement.init as Statement).kind === 'local-declaration' ? this.lowerStatement(statement.init as Statement) : this.lowerExpression(statement.init as Expression);
        const start = this.label('for'); const step = this.label('for_step'); const end = this.label('endfor'); this.instructions.push({ op:'label', args:[start] });
        if (statement.test) { const test = this.lowerExpression(statement.test); this.instructions.push({ op:'branch-zero', args:[test, end] }); }
        this.breakLabels.push(end); this.continueLabels.push(step); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop();
        this.instructions.push({ op:'label', args:[step] }); if (statement.step) this.lowerExpression(statement.step); this.instructions.push({ op:'jump', args:[start] }, { op:'label', args:[end] }); return;
      }
      case 'break': {
        const label = this.breakLabels[this.breakLabels.length - 1];
        if (!label) throw new Error('break used outside loop or switch');
        this.instructions.push({ op:'jump', args:[label] }); return;
      }
      case 'continue': {
        const label = this.continueLabels[this.continueLabels.length - 1];
        if (!label) throw new Error('continue used outside loop');
        this.instructions.push({ op:'jump', args:[label] }); return;
      }
    }
  }

  private collectSwitchCases(statement: Statement): { statement: Extract<Statement, { kind: 'case' }>; label: string }[] {
    const entries: { statement: Extract<Statement, { kind: 'case' }>; label: string }[] = [];
    const collect = (current: Statement): void => {
      switch (current.kind) {
        case 'compound': current.statements.forEach(collect); return;
        case 'if': collect(current.thenBranch); if (current.elseBranch) collect(current.elseBranch); return;
        case 'while': case 'do-while': case 'for': collect(current.body); return;
        case 'switch': return;
        case 'label': collect(current.statement); return;
        case 'case':
          entries.push({ statement: current, label: this.label(current.value ? 'switch_case' : 'switch_default') });
          collect(current.statement);
          return;
        case 'local-declaration': case 'expression': case 'return': case 'break': case 'continue': case 'goto': case 'empty': return;
      }
    };
    collect(statement);
    return entries;
  }

  private lowerExpression(expression: Expression): number {
    switch (expression.kind) {
      case 'integer-literal':
      case 'character-literal':
        return this.constant(expression.value, expression.location);
      case 'identifier': {
        const type = this.typeOf(expression);
        if (this.unwrapped(type).kind === 'array' || this.unwrapped(type).kind === 'function') {
          return this.lowerLValueAddress(expression);
        }
        return this.loadLValue(expression, type);
      }
      case 'assignment': {
        const value = this.lowerExpression(expression.value);
        const targetType = this.typeOf(expression.target);
        if (expression.target.kind === 'identifier' && !this.globalTypes.has(expression.target.name)) {
          this.instructions.push({ op: 'store', args: [expression.target.name, value], location: expression.location });
        } else {
          const address = this.lowerLValueAddress(expression.target);
          this.instructions.push({ op: 'store-memory', args: [address, value, typeSize(targetType)], location: expression.location });
        }
        return value;
      }
      case 'binary': {
        if (expression.operator === '&&' || expression.operator === '||') return this.lowerLogical(expression);
        let left = this.lowerExpression(expression.left);
        let right = this.lowerExpression(expression.right);
        const leftType = this.decayedType(this.typeOf(expression.left));
        const rightType = this.decayedType(this.typeOf(expression.right));
        if (expression.operator === '-' && leftType.kind === 'pointer' && rightType.kind === 'pointer') {
          const byteDifference = this.allocateValue();
          this.instructions.push({ op: 'binary', args: ['-', left, right], dest: byteDifference, location: expression.location });
          const elementSize = typeSize(leftType.pointee);
          if (elementSize === 1) return byteDifference;
          const scale = this.constant(elementSize, expression.location);
          const elementDifference = this.allocateValue();
          this.instructions.push({ op: 'binary', args: ['/', byteDifference, scale], dest: elementDifference, location: expression.location });
          return elementDifference;
        }
        if ((expression.operator === '+' || expression.operator === '-') && leftType.kind === 'pointer') {
          right = this.scalePointerOffset(right, typeSize(leftType.pointee), expression.location);
        } else if (expression.operator === '+' && rightType.kind === 'pointer') {
          left = this.scalePointerOffset(left, typeSize(rightType.pointee), expression.location);
        }
        const dest = this.allocateValue();
        this.instructions.push({ op: 'binary', args: [expression.operator, left, right], dest, location: expression.location });
        return dest;
      }
      case 'call': {
        const args = expression.arguments.map(argument => this.lowerExpression(argument));
        const dest = this.allocateValue();
        const calleeType = this.unwrapped(this.typeOf(expression.callee));
        if (expression.callee.kind === 'identifier' && calleeType.kind === 'function') {
          this.instructions.push({ op: 'call', args: [expression.callee.name, ...args], dest, location: expression.location });
        } else {
          const callee = this.lowerExpression(expression.callee);
          this.instructions.push({ op: 'call-indirect', args: [callee, ...args], dest, location: expression.location });
        }
        return dest;
      }
      case 'unary': {
        if (expression.operator === '&') return this.lowerLValueAddress(expression.operand);
        if (expression.operator === '*') return this.loadLValue(expression, this.typeOf(expression));
        const operand = this.lowerExpression(expression.operand);
        if (expression.operator === '+') return operand;
        const right = expression.operator === '~' ? this.constant(-1, expression.location) : operand;
        const left = expression.operator === '-' ? this.constant(0, expression.location) : operand;
        const operator = expression.operator === '-' ? '-'
          : expression.operator === '!' ? '=='
            : expression.operator === '~' ? '^' : undefined;
        if (!operator) throw new Error(`typed code generation does not yet support unary '${expression.operator}'`);
        const comparisonRight = expression.operator === '!' ? this.constant(0, expression.location) : right;
        const dest = this.allocateValue();
        this.instructions.push({ op: 'binary', args: [operator, left, comparisonRight], dest, location: expression.location });
        return dest;
      }
      case 'sizeof': {
        if (!expression.typeOperand) throw new Error('typed code generation does not yet support sizeof expressions');
        return this.constant(typeSize(expression.typeOperand), expression.location);
      }
      case 'alignof':
        return this.constant(typeAlignment(expression.typeOperand), expression.location);
      case 'subscript':
      case 'member':
        return this.loadLValue(expression, this.typeOf(expression));
      case 'conditional': {
        const result = this.allocateValue();
        const alternateLabel = this.label('conditional_alternate');
        const endLabel = this.label('conditional_end');
        const condition = this.lowerExpression(expression.condition);
        this.instructions.push({ op: 'branch-zero', args: [condition, alternateLabel], location: expression.location });
        const consequent = this.lowerExpression(expression.consequent);
        this.instructions.push({ op: 'move-value', args: [consequent], dest: result, location: expression.consequent.location });
        this.instructions.push({ op: 'jump', args: [endLabel] });
        this.instructions.push({ op: 'label', args: [alternateLabel] });
        const alternate = this.lowerExpression(expression.alternate);
        this.instructions.push({ op: 'move-value', args: [alternate], dest: result, location: expression.alternate.location });
        this.instructions.push({ op: 'label', args: [endLabel] });
        return result;
      }
      case 'floating-literal':
      case 'string-literal':
        throw new Error(`typed code generation does not yet support '${expression.kind}' expressions`);
    }
  }

  private typeOf(expression: Expression): CType {
    const type = this.expressionTypes.get(expression);
    if (type) return type;
    if (expression.kind === 'identifier') {
      const known = this.parameterTypes.get(expression.name) ?? this.globalTypes.get(expression.name);
      if (known) return known;
    }
    throw new Error(`typed lowering is missing the type of '${expression.kind}' expression`);
  }

  private unwrapped(type: CType): CType {
    let current = type;
    const seen = new Set<CType>();
    while (current.kind === 'typedef' && current.target && !seen.has(current)) {
      seen.add(current);
      current = current.target;
    }
    return current;
  }

  private decayedType(type: CType): CType {
    const unwrapped = this.unwrapped(type);
    if (unwrapped.kind === 'array') return pointerType(unwrapped.element);
    if (unwrapped.kind === 'function') return pointerType(unwrapped);
    return unwrapped;
  }

  private loadLValue(expression: Expression, type: CType): number {
    const unwrapped = this.unwrapped(type);
    if (unwrapped.kind === 'array' || unwrapped.kind === 'function') return this.lowerLValueAddress(expression);
    const size = typeSize(unwrapped);
    if (size > 4) throw new Error('typed code generation does not yet support aggregate values');
    const address = this.lowerLValueAddress(expression);
    const dest = this.allocateValue();
    const signed = unwrapped.kind === 'builtin' && (unwrapped.name === 'char' || unwrapped.name === 'short');
    this.instructions.push({ op: 'load-memory', args: [address, size, signed ? 1 : 0], dest, location: expression.location });
    return dest;
  }

  private lowerLValueAddress(expression: Expression): number {
    switch (expression.kind) {
      case 'identifier': {
        const dest = this.allocateValue();
        if (this.globalTypes.has(expression.name) || this.unwrapped(this.typeOf(expression)).kind === 'function') {
          this.instructions.push({ op: 'address-symbol', args: [expression.name], dest, location: expression.location });
        } else {
          this.instructions.push({ op: 'address-local', args: [expression.name], dest, location: expression.location });
        }
        return dest;
      }
      case 'unary':
        if (expression.operator === '*') return this.lowerExpression(expression.operand);
        break;
      case 'subscript': {
        const object = this.lowerExpression(expression.object);
        const index = this.lowerExpression(expression.index);
        const offset = this.scalePointerOffset(index, typeSize(this.typeOf(expression)), expression.location);
        return this.addAddressOffset(object, offset, expression.location);
      }
      case 'member': {
        let base = expression.indirect ? this.lowerExpression(expression.object) : this.lowerLValueAddress(expression.object);
        const objectType = this.unwrapped(this.typeOf(expression.object));
        const aggregate = expression.indirect && objectType.kind === 'pointer' ? this.unwrapped(objectType.pointee) : objectType;
        if (aggregate.kind !== 'struct' && aggregate.kind !== 'union') throw new Error('member address requires an aggregate type');
        const layout = aggregate.kind === 'struct' ? structLayout(aggregate.fields) : unionLayout(aggregate.fields);
        const field = layout.fields.find(candidate => candidate.name === expression.member);
        if (!field) throw new Error(`aggregate has no member '${expression.member}'`);
        if (field.offset !== 0) base = this.addAddressOffset(base, this.constant(field.offset, expression.location), expression.location);
        return base;
      }
    }
    throw new Error(`typed code generation cannot take the address of '${expression.kind}'`);
  }

  private scalePointerOffset(value: number, size: number, location?: IRInstruction['location']): number {
    if (size === 1) return value;
    const scale = this.constant(size, location);
    const dest = this.allocateValue();
    this.instructions.push({ op: 'binary', args: ['*', value, scale], dest, location });
    return dest;
  }

  private addAddressOffset(base: number, offset: number, location?: IRInstruction['location']): number {
    const dest = this.allocateValue();
    this.instructions.push({ op: 'binary', args: ['+', base, offset], dest, location });
    return dest;
  }

  private lowerLogical(expression: Extract<Expression, { kind:'binary' }>): number {
    const result = this.allocateValue(); const trueLabel = this.label('logic_true'); const falseLabel = this.label('logic_false'); const endLabel = this.label('logic_end');
    const left = this.lowerExpression(expression.left);
    if (expression.operator === '&&') { this.instructions.push({ op:'branch-zero', args:[left, falseLabel] }); const right = this.lowerExpression(expression.right); this.instructions.push({ op:'branch-zero', args:[right, falseLabel] }, { op:'jump', args:[trueLabel] }); }
    else { this.instructions.push({ op:'branch-nonzero', args:[left, trueLabel] }); const right = this.lowerExpression(expression.right); this.instructions.push({ op:'branch-nonzero', args:[right, trueLabel] }, { op:'jump', args:[falseLabel] }); }
    this.instructions.push({ op:'label', args:[trueLabel] }, { op:'constant', args:[1], dest:result }, { op:'jump', args:[endLabel] }, { op:'label', args:[falseLabel] }, { op:'constant', args:[0], dest:result }, { op:'label', args:[endLabel] });
    return result;
  }

  returnLabel(): string { return this.generatedLabel('return'); }

  private label(prefix: string): string { return this.generatedLabel(`${prefix}_${this.nextLabel++}`); }

  private userLabel(label: string): string {
    const existing = this.userLabels.get(label);
    if (existing) return existing;
    const generated = this.allocateLabel(`__${this.functionName.length}_${this.functionName}_user_${label.length}_${label}`);
    this.userLabels.set(label, generated);
    return generated;
  }

  private generatedLabel(suffix: string): string {
    return this.allocateLabel(`__${this.functionName}_${suffix}`);
  }

  private allocateLabel(base: string): string {
    let candidate = base;
    let serial = 0;
    while (this.occupiedLabels.has(candidate)) {
      candidate = `${base}_generated_${serial++}`;
    }
    this.occupiedLabels.add(candidate);
    return candidate;
  }

  constant(value: number, location?: IRInstruction['location']): number {
    const dest = this.allocateValue();
    this.instructions.push({ op: 'constant', args: [value], dest, location });
    return dest;
  }

  private allocateValue(): number {
    return this.nextValue++;
  }
}

export function lowerAggregateArgument(type: CType, source: string, destination: string) {
  return { op: 'copy', args: [source, destination, type.kind] as const };
}

const FLOAT_SUFFIX: Record<'float' | 'double', string> = { float: 'sf3', double: 'df3' };
const FLOAT_OPS: Record<string, string> = { add: 'add', sub: 'sub', mul: 'mul', div: 'div', compare: 'cmp' };

export function lowerFloatOperation(operation: keyof typeof FLOAT_OPS, precision: 'float' | 'double' = 'float') {
  const op = FLOAT_OPS[operation];
  if (!op) throw new Error(`unsupported floating operation '${String(operation)}'`);
  return { op: 'runtime-call', args: [`__${op}${FLOAT_SUFFIX[precision]}`] as const };
}

export function lowerAggregateReturn(type: CType) {
  return { op: 'sret-return', type, hiddenParameter: 'sret' as const };
}
