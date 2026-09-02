import { AnalyzedProgram } from './sema';
import { Expression, Statement, TranslationUnit } from './declarations';
import { CType } from './types';
import { IRBlock, IRFunction, IRInstruction, Merc32Module } from './ir';

export function lowerProgram(program: AnalyzedProgram | TranslationUnit): Merc32Module {
  const unit = 'unit' in program ? program.unit : program;
  const functions: IRFunction[] = [];
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (!declarator.name || declarator.type.kind !== 'function' || !declarator.body) continue;
      const lowerer = new FunctionLowerer(declarator.name);
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
        blocks: [block],
      });
    }
  }
  return { abi: 'merc32-c-v1', functions, globals: [] };
}

class FunctionLowerer {
  readonly instructions: IRInstruction[] = [];
  readonly localNames: string[] = [];
  private nextValue = 0;
  private nextLabel = 0;
  private breakLabels: string[] = [];
  private continueLabels: string[] = [];
  constructor(private readonly functionName: string) {}

  lowerStatement(statement: Statement): void {
    switch (statement.kind) {
      case 'compound':
        statement.statements.forEach(child => this.lowerStatement(child));
        return;
      case 'local-declaration': {
        this.localNames.push(statement.name);
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
      case 'for': {
        if (statement.init) (statement.init as Statement).kind === 'local-declaration' ? this.lowerStatement(statement.init as Statement) : this.lowerExpression(statement.init as Expression);
        const start = this.label('for'); const step = this.label('for_step'); const end = this.label('endfor'); this.instructions.push({ op:'label', args:[start] });
        if (statement.test) { const test = this.lowerExpression(statement.test); this.instructions.push({ op:'branch-zero', args:[test, end] }); }
        this.breakLabels.push(end); this.continueLabels.push(step); this.lowerStatement(statement.body); this.continueLabels.pop(); this.breakLabels.pop();
        this.instructions.push({ op:'label', args:[step] }); if (statement.step) this.lowerExpression(statement.step); this.instructions.push({ op:'jump', args:[start] }, { op:'label', args:[end] }); return;
      }
      case 'break': { const label = this.breakLabels[this.breakLabels.length - 1]; if (label) this.instructions.push({ op:'jump', args:[label] }); return; }
      case 'continue': { const label = this.continueLabels[this.continueLabels.length - 1]; if (label) this.instructions.push({ op:'jump', args:[label] }); return; }
    }
  }

  private lowerExpression(expression: Expression): number {
    switch (expression.kind) {
      case 'integer-literal':
        return this.constant(expression.value, expression.location);
      case 'identifier': {
        const dest = this.allocateValue();
        this.instructions.push({ op: 'load', args: [expression.name], dest, location: expression.location });
        return dest;
      }
      case 'assignment': {
        const value = this.lowerExpression(expression.value);
        this.instructions.push({ op: 'store', args: [expression.target.name, value], location: expression.location });
        return value;
      }
      case 'binary': {
        if (expression.operator === '&&' || expression.operator === '||') return this.lowerLogical(expression);
        const left = this.lowerExpression(expression.left);
        const right = this.lowerExpression(expression.right);
        const dest = this.allocateValue();
        this.instructions.push({ op: 'binary', args: [expression.operator, left, right], dest, location: expression.location });
        return dest;
      }
      case 'call': {
        const args = expression.arguments.map(argument => this.lowerExpression(argument));
        const dest = this.allocateValue();
        this.instructions.push({ op: 'call', args: [expression.callee.name, ...args], dest, location: expression.location });
        return dest;
      }
    }
  }

  private lowerLogical(expression: Extract<Expression, { kind:'binary' }>): number {
    const result = this.allocateValue(); const trueLabel = this.label('logic_true'); const falseLabel = this.label('logic_false'); const endLabel = this.label('logic_end');
    const left = this.lowerExpression(expression.left);
    if (expression.operator === '&&') { this.instructions.push({ op:'branch-zero', args:[left, falseLabel] }); const right = this.lowerExpression(expression.right); this.instructions.push({ op:'branch-zero', args:[right, falseLabel] }, { op:'jump', args:[trueLabel] }); }
    else { this.instructions.push({ op:'branch-nonzero', args:[left, trueLabel] }); const right = this.lowerExpression(expression.right); this.instructions.push({ op:'branch-nonzero', args:[right, trueLabel] }, { op:'jump', args:[falseLabel] }); }
    this.instructions.push({ op:'label', args:[trueLabel] }, { op:'constant', args:[1], dest:result }, { op:'jump', args:[endLabel] }, { op:'label', args:[falseLabel] }, { op:'constant', args:[0], dest:result }, { op:'label', args:[endLabel] });
    return result;
  }

  private label(prefix: string): string { return `__${this.functionName}_${prefix}_${this.nextLabel++}`; }

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
