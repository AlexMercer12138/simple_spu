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
      const lowerer = new FunctionLowerer();
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
