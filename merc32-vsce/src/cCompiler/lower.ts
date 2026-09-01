import { AnalyzedProgram } from './sema';
import { TranslationUnit } from './declarations';
import { CType } from './types';
import { IRBlock, IRFunction, Merc32Module } from './ir';

export function lowerProgram(program: AnalyzedProgram | TranslationUnit): Merc32Module {
  const unit = 'unit' in program ? program.unit : program;
  const functions: IRFunction[] = [];
  for (const declaration of unit.declarations) {
    for (const declarator of declaration.declarators) {
      if (!declarator.name || declarator.type.kind !== 'function') continue;
      const type = declarator.type;
      const block: IRBlock = { label: `${declarator.name}.entry`, instructions: [{ op: 'ret', args: [] }] };
      functions.push({ name: declarator.name, returnType: type.returnType, parameters: type.parameters, blocks: [block] });
    }
  }
  return { abi: 'merc32-c-v1', functions, globals: [] };
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
