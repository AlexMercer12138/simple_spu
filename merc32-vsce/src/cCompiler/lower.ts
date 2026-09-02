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
      const type = declarator.type;
      const instructions = declarator.body.statements.flatMap(lowerStatement);
      if (instructions.length === 0 || instructions[instructions.length - 1].op !== 'ret') {
        instructions.push({ op: 'constant', args: [0] }, { op: 'ret', args: [] });
      }
      const block: IRBlock = { label: `${declarator.name}.entry`, instructions };
      functions.push({ name: declarator.name, returnType: type.returnType, parameters: type.parameters, blocks: [block] });
    }
  }
  return { abi: 'merc32-c-v1', functions, globals: [] };
}

function lowerStatement(statement: Statement): IRInstruction[] {
  if (statement.kind === 'compound') return statement.statements.flatMap(lowerStatement);
  const instructions = statement.expression ? lowerExpression(statement.expression) : [{ op: 'constant', args: [0] }];
  return [...instructions, { op: 'ret', args: [], location: statement.location }];
}

function lowerExpression(expression: Expression): IRInstruction[] {
  if (expression.kind === 'integer-literal') {
    return [{ op: 'constant', args: [expression.value], location: expression.location }];
  }
  if (expression.kind === 'call') {
    if (expression.arguments.length !== 0) throw new Error('typed lowering currently supports only zero-argument calls');
    return [{ op: 'call', args: [expression.callee.name], location: expression.location }];
  }
  throw new Error(`typed lowering cannot return identifier '${expression.name}' directly`);
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
