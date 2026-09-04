const assert = require('assert');

const { adaptTypedUnit, CBackendCapabilityError } = require('../out/cCompiler/backendAdapter');
const { lowerProgram } = require('../out/cCompiler/lower');
const { generateObject } = require('../out/cCompiler/codegen');

const position = (offset) => ({ line: 1, column: offset + 1, byteOffset: offset });
const range = (file = 1, start = 0, end = start + 1) => ({ file, start: position(start), end: position(end) });
const int = (id, name = 'int', size = 4, alignment = 4) => ({
  id, kind: 'builtin', name, qualifiers: [], size, alignment,
});

const unit = {
  schema: 'merc32.typed-c-unit', schemaVersion: 1, target: 'merc32',
  abi: 'merc32-c-v1', dataModel: 'merc32-ilp32', language: 'c17-freestanding',
  sourceFiles: [{ id: 1, path: 'main.c', byteLength: 128, utf8BoundaryBitmap: 'ff' }],
  types: [int(1), int(2, 'unsigned int'), {
    id: 3, kind: 'pointer', pointee: 1, qualifiers: [], size: 4, alignment: 4,
  }, {
    id: 4, kind: 'struct', name: 'Pair', complete: true, qualifiers: [], size: 8, alignment: 4,
    members: [
      { name: 'first', type: 1, offset: 0, range: range() },
      { name: 'second', type: 1, offset: 4, range: range() },
    ],
  }, {
    id: 5, kind: 'array', element: 1, count: 4, qualifiers: [], size: 16, alignment: 4,
  }, {
    id: 6, kind: 'function', returnType: 1, parameters: [1], variadic: false,
    qualifiers: [], size: 0, alignment: 4,
  }],
  symbols: [
    { id: 1, kind: 'variable', name: 'global', type: 1, linkage: 'external', storage: 'static', definition: true,
      range: range(), initializer: { size: 4, zeroFill: true, writes: [{ offset: 0, type: 1,
        value: { kind: 'integer', bits: 32, signed: true, value: '7' } }] } },
    { id: 2, kind: 'variable', name: 'target', type: 3, linkage: 'internal', storage: 'static', definition: true,
      range: range(), initializer: { size: 4, zeroFill: true, writes: [{ offset: 0, type: 3,
        value: { kind: 'address', symbol: 1, addend: '4' } }] } },
    { id: 3, kind: 'function', name: 'add', type: 6, linkage: 'external', definition: true, range: range() },
    { id: 4, kind: 'parameter', name: 'value', type: 1, owner: 3, range: range() },
  ],
  nodes: [
    { id: 1, category: 'declaration', kind: 'function-definition', type: 6, symbol: 3,
      range: range(1, 0, 20), children: [2] },
    { id: 2, category: 'statement', kind: 'compound', range: range(), children: [3] },
    { id: 3, category: 'statement', kind: 'return', range: range(), children: [4] },
    { id: 4, category: 'expression', kind: 'binary', type: 1, valueCategory: 'rvalue', operator: '+',
      range: range(), children: [5, 6] },
    { id: 5, category: 'expression', kind: 'declaration-reference', type: 1, valueCategory: 'lvalue',
      symbol: 4, range: range(), children: [] },
    { id: 6, category: 'expression', kind: 'integer-literal', type: 1, valueCategory: 'rvalue',
      constant: { kind: 'integer', bits: 32, signed: true, value: '1' }, range: range(), children: [] },
  ],
  declarations: [1],
};

const program = adaptTypedUnit(unit);
assert.strictEqual(program.abi, 'merc32-c-v1');
assert.deepStrictEqual(program.globals.map((global) => global.name), ['global', 'target']);
assert.strictEqual(program.globals[0].initializer.writes[0].value, 7n);
assert.deepStrictEqual(program.globals[1].initializer.writes[0].value, { symbol: 'global', addend: 4n });
assert.strictEqual(program.functions[0].name, 'add');
assert.strictEqual(program.functions[0].body.kind, 'compound');
assert.strictEqual(program.functions[0].body.statements[0].expression.operands[0].symbol, 'value');
assert.strictEqual(program.functions[0].body.statements[0].expression.location.file, 'main.c');

const object = generateObject(lowerProgram(program));
assert.strictEqual(object.target, 'merc32');
assert(object.relocations.some((relocation) => relocation.kind === 'ABS32'
  && relocation.symbol === 'global' && relocation.addend === 4));

const unsupported = JSON.parse(JSON.stringify(unit));
unsupported.types[0] = { id: 1, kind: 'builtin', name: 'long long', qualifiers: [], size: 8, alignment: 4 };
unsupported.symbols[0].type = 1;
unsupported.symbols[0].initializer.writes[0].type = 1;
assert.throws(() => adaptTypedUnit(unsupported), (error) => {
  assert(error instanceof CBackendCapabilityError);
  assert(error.diagnostics.length > 0);
  return error.diagnostics[0].code === 'C_BACKEND_CAPABILITY';
});

const compoundAssignment = JSON.parse(JSON.stringify(unit));
compoundAssignment.nodes.find((node) => node.id === 4).kind = 'assignment';
compoundAssignment.nodes.find((node) => node.id === 4).operator = '+=';
assert.throws(() => adaptTypedUnit(compoundAssignment), (error) => {
  assert(error instanceof CBackendCapabilityError);
  return error.diagnostics[0].message.includes("operator '+='");
});

const switchUnit = JSON.parse(JSON.stringify(unit));
switchUnit.nodes.find((node) => node.id === 2).children = [7];
switchUnit.nodes.push(
  { id: 7, category: 'statement', kind: 'switch', range: range(), children: [6, 8] },
  { id: 8, category: 'statement', kind: 'compound', range: range(), children: [9] },
  { id: 9, category: 'statement', kind: 'case', range: range(), caseValue: { kind: 'integer', bits: 32, signed: true, value: '1' }, children: [6, 10] },
  { id: 10, category: 'statement', kind: 'empty', range: range(), children: [] },
);
const switchProgram = adaptTypedUnit(switchUnit);
assert.doesNotThrow(() => generateObject(lowerProgram(switchProgram)));

const typedefPointerMember = JSON.parse(JSON.stringify(unit));
typedefPointerMember.types.push(
  { id: 7, kind: 'typedef', name: 'PairAlias', target: 4, qualifiers: [], size: 8, alignment: 4 },
  { id: 8, kind: 'pointer', pointee: 7, qualifiers: [], size: 4, alignment: 4 },
);
typedefPointerMember.types.find((type) => type.id === 6).parameters = [8];
typedefPointerMember.symbols.find((symbol) => symbol.id === 4).type = 8;
const memberReference = typedefPointerMember.nodes.find((node) => node.id === 5);
memberReference.type = 8;
const member = typedefPointerMember.nodes.find((node) => node.id === 4);
member.kind = 'member';
member.type = 1;
member.valueCategory = 'lvalue';
member.memberIndex = 1;
delete member.operator;
member.children = [5];
assert.doesNotThrow(() => generateObject(lowerProgram(adaptTypedUnit(typedefPointerMember))),
  'member access through a pointer to a typedef-wrapped aggregate must lower');

const externTls = JSON.parse(JSON.stringify(unit));
const tlsSymbol = externTls.symbols.find((symbol) => symbol.id === 2);
tlsSymbol.storage = 'thread';
tlsSymbol.definition = false;
assert.throws(() => adaptTypedUnit(externTls), (error) => {
  assert(error instanceof CBackendCapabilityError);
  return error.diagnostics[0].message.includes('thread-local');
});

const loc = { file: 'main.c', line: 1, column: 1 };
const scalarType = program.functions[0].returnType;
const literal = (value) => ({ kind: 'integer-literal', type: scalarType, valueCategory: 'rvalue', location: loc, operands: [], constant: BigInt(value) });
const empty = { kind: 'empty', location: loc };
const nestedSwitch = { kind: 'switch', test: literal(0), body: { kind: 'compound', statements: [
  { kind: 'case', value: 2n, statement: empty, location: loc },
], location: loc }, location: loc };
const labeledCase = { kind: 'label', label: 'outer', statement: { kind: 'case', value: 1n, statement: empty, location: loc }, location: loc };
const controlProgram = {
  abi: 'merc32-c-v1',
  globals: [{ name: '__flow_user_outer', type: scalarType }],
  functions: [{ name: 'flow', returnType: scalarType, parameters: [], parameterNames: [], localNames: [], localTypes: [],
    body: { kind: 'switch', test: literal(0), body: { kind: 'compound', statements: [labeledCase, nestedSwitch], location: loc }, location: loc } }],
};
const flowModule = lowerProgram(controlProgram);
const flowFunction = flowModule.functions.find((func) => func.name === 'flow');
assert.strictEqual(flowFunction.blocks[0].instructions.filter((instruction) => instruction.op === 'branch-nonzero').length, 2,
  'outer switch must ignore nested switch cases while still collecting label-wrapped cases');
const flowLabels = flowFunction.blocks[0].instructions.filter((instruction) => instruction.op === 'label').map((instruction) => instruction.args[0]);
assert(!flowLabels.includes('__flow_user_outer'), 'generated labels must avoid program-level symbol names');

console.log('C frontend backend adapter tests passed');
