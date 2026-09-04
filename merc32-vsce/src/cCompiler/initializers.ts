import { CFrontendError } from './source';
import { CInitializer, Expression, Initializer, InitializerDesignator } from './declarations';
import { CType, structLayout, typeSize, unionLayout } from './types';

export interface NormalizedInitializer {
  readonly size: number;
  readonly bytes: Uint8Array;
  readonly entries: ReadonlyMap<string, number>;
  readonly writes: readonly NormalizedInitializerWrite[];
}

export interface NormalizedInitializerWrite {
  readonly offset: number;
  readonly type: CType;
  readonly value: Expression;
}

type ConstantEvaluator = (expression: Expression) => number;

export function lowerInitializer(
  type: CType,
  initializer: CInitializer,
  evaluateConstant: ConstantEvaluator = defaultConstantEvaluator,
): NormalizedInitializer {
  const size = typeSize(type);
  const bytes = new Uint8Array(size);
  const entries = new Map<string, number>();
  const writes: NormalizedInitializerWrite[] = [];
  normalizeInto(type, initializer, 0, writes, entries, evaluateConstant);
  return { size, bytes, entries, writes };
}

function normalizeInto(
  originalType: CType,
  initializer: CInitializer,
  baseOffset: number,
  writes: NormalizedInitializerWrite[],
  entries: Map<string, number>,
  evaluateConstant: ConstantEvaluator,
): void {
  const type = unwrapType(originalType);
  if (initializer.kind !== 'initializer') {
    if (type.kind === 'array' && isCharacterType(type.element) && initializer.kind === 'string-literal') {
      normalizeString(type, initializer, baseOffset, writes);
      return;
    }
    if (type.kind === 'array') throw initializerError('array initializer must be a brace list or string literal', initializer);
    writes.push({ offset: baseOffset, type: originalType, value: initializer });
    return;
  }

  if (!isAggregate(type)) {
    if (initializer.entries.length !== 1 || initializer.entries[0].designators.length > 0) {
      throw initializerError('scalar brace initializer must contain one undesignated value', initializer);
    }
    normalizeInto(originalType, initializer.entries[0].value, baseOffset, writes, entries, evaluateConstant);
    return;
  }

  normalizeAggregate(type, initializer, baseOffset, writes, entries, evaluateConstant);
}

function normalizeAggregate(
  type: Extract<CType, { kind: 'array' | 'struct' | 'union' }>,
  initializer: Initializer,
  baseOffset: number,
  writes: NormalizedInitializerWrite[],
  entries: Map<string, number>,
  evaluateConstant: ConstantEvaluator,
): void {
  const leaves = scalarLeaves(type, baseOffset);
  let directCursor = 0;
  let leafCursor = 0;
  for (const entry of initializer.entries) {
    let targetType: CType;
    let targetOffset: number;
    let remainingDesignators: readonly InitializerDesignator[] = [];
    if (entry.designators.length > 0) {
      const selection = selectDirectSubobject(type, entry.designators[0], baseOffset, evaluateConstant);
      targetType = selection.type;
      targetOffset = selection.offset;
      directCursor = selection.nextCursor;
      remainingDesignators = entry.designators.slice(1);
      if (entry.designators[0].kind === 'field-designator') {
        const scalarValue = literalValue(entry.value);
        if (scalarValue !== undefined) entries.set(entry.designators[0].field, scalarValue);
      }
    } else if (entry.value.kind === 'initializer' || entry.value.kind === 'string-literal') {
      const selection = selectPositionalSubobject(type, directCursor, baseOffset, entry.value);
      targetType = selection.type;
      targetOffset = selection.offset;
      directCursor = selection.nextCursor;
    } else {
      if (leafCursor >= leaves.length) throw initializerError('too many aggregate initializer elements', entry);
      targetType = leaves[leafCursor].type;
      targetOffset = leaves[leafCursor].offset;
      leafCursor++;
    }
    if (remainingDesignators.length > 0) {
      const selection = selectDesignatorPath(targetType, remainingDesignators, targetOffset, evaluateConstant);
      targetType = selection.type;
      targetOffset = selection.offset;
    }
    normalizeInto(targetType, entry.value, targetOffset, writes, entries, evaluateConstant);
    const targetLeaves = scalarLeaves(targetType, targetOffset);
    if (targetLeaves.length > 0) {
      const nextLeaf = leaves.findIndex(leaf => leaf.offset >= targetLeaves[targetLeaves.length - 1].offset + typeSize(targetLeaves[targetLeaves.length - 1].type));
      if (nextLeaf >= 0) leafCursor = nextLeaf;
      else leafCursor = leaves.length;
    }
  }
}

interface ScalarLeaf { readonly type: CType; readonly offset: number; }

function scalarLeaves(originalType: CType, baseOffset: number): readonly ScalarLeaf[] {
  const type = unwrapType(originalType);
  if (!isAggregate(type)) return [{ type: originalType, offset: baseOffset }];
  if (type.kind === 'array') {
    if (type.length === null) throw new Error('incomplete array type has no scalar leaves');
    return Array.from({ length: type.length }, (_, index) => scalarLeaves(type.element, baseOffset + index * typeSize(type.element))).flat();
  }
  const layout = type.kind === 'struct' ? structLayout(type.fields) : unionLayout(type.fields);
  const fields = type.kind === 'union' ? layout.fields.slice(0, 1) : layout.fields;
  return fields.flatMap(field => scalarLeaves(field.type, baseOffset + field.offset));
}

function selectPositionalSubobject(
  type: Extract<CType, { kind: 'array' | 'struct' | 'union' }>,
  cursor: number,
  baseOffset: number,
  initializer: CInitializer,
): { readonly type: CType; readonly offset: number; readonly nextCursor: number } {
  if (type.kind === 'array') {
    if (type.length === null || cursor >= type.length) throw initializerError('too many array initializer elements', initializer);
    return { type: type.element, offset: baseOffset + cursor * typeSize(type.element), nextCursor: cursor + 1 };
  }
  const layout = type.kind === 'struct' ? structLayout(type.fields) : unionLayout(type.fields);
  if (cursor >= layout.fields.length || type.kind === 'union' && cursor > 0) {
    throw initializerError(`too many ${type.kind} initializer elements`, initializer);
  }
  const field = layout.fields[cursor];
  return { type: field.type, offset: baseOffset + field.offset, nextCursor: cursor + 1 };
}

function selectDirectSubobject(
  type: Extract<CType, { kind: 'array' | 'struct' | 'union' }>,
  designator: InitializerDesignator,
  baseOffset: number,
  evaluateConstant: ConstantEvaluator,
): { readonly type: CType; readonly offset: number; readonly nextCursor: number } {
  if (designator.kind === 'index-designator') {
    if (type.kind !== 'array') throw initializerError('array designator requires an array initializer', designator);
    const index = evaluateConstant(designator.index);
    if (!Number.isSafeInteger(index) || index < 0 || type.length === null || index >= type.length) {
      throw initializerError(`array designator index ${index} is out of bounds`, designator);
    }
    return { type: type.element, offset: baseOffset + index * typeSize(type.element), nextCursor: index + 1 };
  }
  if (type.kind !== 'struct' && type.kind !== 'union') {
    throw initializerError('field designator requires a struct or union initializer', designator);
  }
  const layout = type.kind === 'struct' ? structLayout(type.fields) : unionLayout(type.fields);
  const index = layout.fields.findIndex(field => field.name === designator.field);
  if (index < 0) throw initializerError(`${type.kind} has no member '${designator.field}'`, designator);
  const field = layout.fields[index];
  return { type: field.type, offset: baseOffset + field.offset, nextCursor: index + 1 };
}

function selectDesignatorPath(
  originalType: CType,
  designators: readonly InitializerDesignator[],
  baseOffset: number,
  evaluateConstant: ConstantEvaluator,
): { readonly type: CType; readonly offset: number } {
  let type = originalType;
  let offset = baseOffset;
  for (const designator of designators) {
    const aggregate = unwrapType(type);
    if (!isAggregate(aggregate)) throw initializerError('initializer designator does not name an aggregate subobject', designator);
    const selection = selectDirectSubobject(aggregate, designator, offset, evaluateConstant);
    type = selection.type;
    offset = selection.offset;
  }
  return { type, offset };
}

function normalizeString(
  type: Extract<CType, { kind: 'array' }>,
  initializer: Extract<Expression, { kind: 'string-literal' }>,
  baseOffset: number,
  writes: NormalizedInitializerWrite[],
): void {
  if (type.length === null) throw initializerError('incomplete character array must be completed before normalization', initializer);
  const values = Array.from(initializer.value, character => character.charCodeAt(0) & 0xff);
  if (values.length > type.length) throw initializerError('string initializer does not fit in character array', initializer);
  if (values.length < type.length) values.push(0);
  values.forEach((value, index) => writes.push({
    offset: baseOffset + index,
    type: type.element,
    value: { kind: 'integer-literal', value, location: initializer.location },
  }));
}

function defaultConstantEvaluator(expression: Expression): number {
  if (expression.kind === 'integer-literal' || expression.kind === 'character-literal') return expression.value;
  throw initializerError('array designator must be an integer constant expression', expression);
}

function literalValue(initializer: CInitializer): number | undefined {
  return initializer.kind === 'integer-literal' || initializer.kind === 'character-literal' ? initializer.value : undefined;
}

function isAggregate(type: CType): type is Extract<CType, { kind: 'array' | 'struct' | 'union' }> {
  return type.kind === 'array' || type.kind === 'struct' || type.kind === 'union';
}

function isCharacterType(type: CType): boolean {
  const unwrapped = unwrapType(type);
  return unwrapped.kind === 'builtin' && (unwrapped.name === 'char' || unwrapped.name === 'unsigned char');
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

function initializerError(message: string, value: { readonly location?: import('./source').SourceLocation }): CFrontendError {
  return new CFrontendError(message, value.location ?? { file: '', line: 1, column: 1 });
}
