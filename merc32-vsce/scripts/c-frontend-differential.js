'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  adaptTypedUnit, compileCToObject, generateObject, loadRuntimeObjects, lowerProgram,
  structLayout, unionLayout,
} = require('../out/cCompiler');
const { getAroFrontend } = require('../out/cFrontend/frontend');
const legacyFrontend = require('../out/cCompiler/legacyFrontend');
const { SimpleCPUAssembler } = require('../out/assembler');
const { assembleToObject, linkObjects } = require('../out/linker');

const overlapRoot = path.join(__dirname, 'fixtures', 'c-frontend', 'overlap');
const repoRoot = path.resolve(__dirname, '..', '..');
const expectedResults = Object.freeze({
  'aggregates.c': 14,
  'calls.c': 12,
  'control.c': 8,
  'globals.c': 12,
  'scalars.c': 11,
});

function normalizeObject(object) {
  const localNames = object.symbols
    .filter((symbol) => symbol.binding === 'local')
    .map((symbol) => symbol.name);
  const localMap = new Map(localNames.map((name, index) => [name, `$local${index}`]));
  const replacements = [...localMap.entries()].sort((left, right) => right[0].length - left[0].length);
  const replaceLocals = (source) => replacements.reduce(
    (result, [name, replacement]) => result.replaceAll(name, replacement), source,
  );
  const normalizeDebug = (debug) => debug === undefined ? undefined : {
    file: '$source', line: debug.line, column: debug.column,
  };
  return {
    version: object.version,
    target: object.target,
    abi: object.abi,
    sections: object.sections.map((section) => ({
      name: section.name,
      alignment: section.alignment,
      size: section.size,
      ...(section.content === undefined ? {} : {
        content: typeof section.content === 'string'
          ? replaceLocals(section.content.replace(/\r\n/gu, '\n'))
          : [...section.content],
      }),
      ...(section.source === undefined ? {} : { source: replaceLocals(section.source) }),
      ...(section.entryLabel === undefined ? {} : {
        entryLabel: localMap.get(section.entryLabel) ?? section.entryLabel,
      }),
    })),
    symbols: object.symbols.map((symbol) => ({
      ...symbol,
      name: localMap.get(symbol.name) ?? symbol.name,
    })),
    relocations: object.relocations.map((relocation) => ({
      ...relocation,
      symbol: localMap.get(relocation.symbol) ?? relocation.symbol,
      ...(relocation.debug === undefined ? {} : { debug: normalizeDebug(relocation.debug) }),
    })),
    ...(object.debug === undefined ? {} : { debug: object.debug.map(normalizeDebug) }),
  };
}

function stableObjectView(object) {
  const normalized = normalizeObject(object);
  return {
    version: normalized.version,
    target: normalized.target,
    abi: normalized.abi,
    sections: normalized.sections.map((section) => ({
      name: section.name,
      alignment: section.alignment,
      size: section.size,
      ...(section.name === 'text' ? {} : { content: section.content }),
    })),
    symbols: normalized.symbols.filter((symbol) => symbol.binding === 'global'),
    relocations: normalized.relocations,
    ...(normalized.debug === undefined ? {} : { debug: normalized.debug }),
  };
}

function typeView(type, active = new Set()) {
  if (!type) return null;
  if (type.kind === 'typedef') return type.target ? typeView(type.target, active) : { kind: 'unresolved-typedef' };
  if (active.has(type)) return { kind: 'recursive', type: type.kind, name: type.name };
  const nested = new Set(active).add(type);
  const qualifiers = type.qualifiers === undefined ? undefined : { ...type.qualifiers };
  switch (type.kind) {
    case 'builtin': return { kind: type.kind, name: type.name, qualifiers };
    case 'pointer': return { kind: type.kind, pointee: typeView(type.pointee, nested), qualifiers };
    case 'array': return { kind: type.kind, length: type.length, element: typeView(type.element, nested), qualifiers };
    case 'function': return {
      kind: type.kind, returnType: typeView(type.returnType, nested),
      parameters: type.parameters.map((parameter) => typeView(parameter, nested)),
      variadic: type.variadic, qualifiers,
    };
    case 'struct':
    case 'union': {
      const fields = (type.kind === 'struct' ? structLayout(type.fields) : unionLayout(type.fields)).fields;
      return {
        kind: type.kind, name: type.name, qualifiers,
        fields: fields.map((field) => ({
          name: field.name, offset: field.offset, bitOffset: field.bitOffset, bitWidth: field.bitWidth,
          type: typeView(field.type, nested),
        })),
      };
    }
    case 'enum': return {
      kind: type.kind, name: type.name, qualifiers,
      values: Object.entries(type.values).sort(([left], [right]) => left === right ? 0 : left < right ? -1 : 1),
    };
    default: throw new Error(`cannot canonicalize type '${type.kind}'`);
  }
}

function functionSemanticView(func) {
  const variables = new Map();
  (func.parameterNames ?? []).forEach((name, index) => variables.set(name, `$parameter${index}`));
  (func.localNames ?? []).forEach((name, index) => variables.set(name, `$local${index}`));
  const values = new Map();
  const labels = new Map();
  const value = (id) => {
    if (!values.has(id)) values.set(id, `$value${values.size}`);
    return values.get(id);
  };
  const label = (name) => {
    if (!labels.has(name)) labels.set(name, `$label${labels.size}`);
    return labels.get(name);
  };
  const variable = (name) => variables.get(name) ?? name;
  if (func.returnLabel !== undefined) label(func.returnLabel);
  func.blocks.forEach((block) => label(block.label));
  const instruction = (item) => {
    const dest = item.dest === undefined ? undefined : value(item.dest);
    let args;
    switch (item.op) {
      case 'label': args = [label(String(item.args[0]))]; break;
      case 'jump': args = [label(String(item.args[0]))]; break;
      case 'branch-zero':
      case 'branch-nonzero': args = [value(Number(item.args[0])), label(String(item.args[1]))]; break;
      case 'constant': args = [item.args[0]]; break;
      case 'load':
      case 'address-local': args = [variable(String(item.args[0]))]; break;
      case 'store': args = [variable(String(item.args[0])), value(Number(item.args[1]))]; break;
      case 'address-symbol': args = [item.args[0]]; break;
      case 'load-memory': args = [
        value(Number(item.args[0])), item.args[1], Number(item.args[1]) === 4 ? 0 : item.args[2],
      ]; break;
      case 'store-memory': args = [
        value(Number(item.args[0])), value(Number(item.args[1])), item.args[2],
      ]; break;
      case 'move-value': args = [value(Number(item.args[0]))]; break;
      case 'binary': args = [
        item.args[0], value(Number(item.args[1])), value(Number(item.args[2])),
      ]; break;
      case 'call':
      case 'runtime-call': args = [item.args[0], ...item.args.slice(1).map((argument) => value(Number(argument)))]; break;
      case 'call-indirect': args = item.args.map((argument) => value(Number(argument))); break;
      case 'ret': args = item.args.map((argument) => value(Number(argument))); break;
      default: throw new Error(`cannot canonicalize IR operation '${item.op}'`);
    }
    return { op: item.op, args, ...(dest === undefined ? {} : { dest }) };
  };
  return {
    name: func.name,
    returnType: typeView(func.returnType),
    parameters: func.parameters.map((parameter) => typeView(parameter)),
    localTypes: (func.localTypes ?? []).map((type) => typeView(type)),
    returnLabel: func.returnLabel === undefined ? undefined : label(func.returnLabel),
    blocks: func.blocks.map((block) => ({
      label: label(block.label), instructions: block.instructions.map(instruction),
    })),
  };
}

function moduleSemanticView(module) {
  return {
    abi: module.abi,
    functions: module.functions.map(functionSemanticView),
    globals: module.globals.map((global) => ({ name: global.name, type: typeView(global.type) })),
  };
}

function classifyObjectDifference(legacyCompilation, aroCompilation) {
  const legacy = normalizeObject(legacyCompilation.object);
  const aro = normalizeObject(aroCompilation.object);
  try {
    assert.deepStrictEqual(aro, legacy);
    return { equal: true, requiresExecution: false, mode: 'object', details: 'normalized objects match' };
  } catch {}
  try {
    assert.deepStrictEqual(legacyCompilation.object, generateObject(legacyCompilation.module));
    assert.deepStrictEqual(aroCompilation.object, generateObject(aroCompilation.module));
    assert.deepStrictEqual(stableObjectView(aroCompilation.object), stableObjectView(legacyCompilation.object));
    assert.deepStrictEqual(moduleSemanticView(aroCompilation.module), moduleSemanticView(legacyCompilation.module));
    return {
      equal: true, requiresExecution: true, mode: 'allocation-only',
      details: 'text differs only after canonical IR value, local binding, and label allocation',
    };
  } catch (error) {
    return { equal: false, requiresExecution: false, mode: 'object', details: String(error) };
  }
}

function compileAroForDifferential(source, sourceName) {
  const object = compileCToObject(source, { sourceName });
  const envelope = getAroFrontend().analyzeSource(source, { sourceName });
  if (!envelope.unit) {
    throw new Error(`Aro witness compilation failed: ${envelope.diagnostics.map((item) => item.message).join('\n')}`);
  }
  return { object, module: lowerProgram(adaptTypedUnit(envelope.unit)) };
}

function createRtlRunner() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-c-differential-'));
  const simulationPath = path.join(root, 'tinyc_cpu_tb.vvp');
  const rtlFiles = [
    ['rtl', 'cpu', 'core.v'],
    ['rtl', 'misc', 'mul.v'],
    ['rtl', 'misc', 'div.v'],
    ['rtl', 'sim', 'tinyc_cpu_tb.v'],
  ].map((segments) => path.join(repoRoot, ...segments));
  const compile = spawnSync('iverilog', [
    '-Wall', '-Wno-timescale', '-g2005', '-s', 'tinyc_cpu_tb', '-o', simulationPath, ...rtlFiles,
  ], { encoding: 'utf8', windowsHide: true });
  if (compile.status !== 0) {
    fs.rmSync(root, { recursive: true, force: true });
    throw new Error(`${compile.stdout || ''}${compile.stderr || ''}`);
  }
  return {
    run(machineCodes, name) {
      const memoryPath = path.join(root, `${name}.mem`);
      fs.writeFileSync(memoryPath,
        `${machineCodes.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('\n')}\n`, 'ascii');
      const simulation = spawnSync('vvp', [
        simulationPath,
        `+ROM_FILE=${memoryPath.replace(/\\/gu, '/')}`,
        `+ROM_WORDS=${machineCodes.length}`,
      ], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
      const output = `${simulation.stdout || ''}${simulation.stderr || ''}`;
      return { passed: simulation.status === 0 && /^TEST PASS$/mu.test(output), output };
    },
    close() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function linkFixture(object, expected, fixture) {
  const observer = assembleToObject(`
test_pass:
  mov r7, r4
  mov r9, ${expected}
  cmp r10, r7 == r9
  bz r10, r0 + differential_fail
  mov r8, 0x0800
  mov r8, r8 << 16
  mov r8, r8 + 0x03C0
  mov r7, 0x600D
  sw [r8], r7
  jmp differential_halt
differential_fail:
  mov r6, 0x0800
  mov r6, r6 << 16
  mov r6, r6 + 0x03C4
  sw [r6], r7
  mov r8, 0x0800
  mov r8, r8 << 16
  mov r8, r8 + 0x03C0
  mov r7, 0x0BAD
  sw [r8], r7
differential_halt:
  jmp differential_halt
`, { exports: ['test_pass'] });
  const startup = loadRuntimeObjects().find((candidate) =>
    candidate.symbols.some((symbol) => symbol.name === 'startup' && symbol.defined));
  if (!startup) throw new Error('runtime catalog does not contain startup');
  const linked = linkObjects([startup, observer, object], {
    entrySymbol: 'startup', dataBase: 0x08000000,
  });
  return new SimpleCPUAssembler().assemble(linked.assembly, {
    sourceFileName: `${fixture}.asm`,
  }).machineCodes;
}

function compareOverlapCorpus() {
  const fixtures = fs.readdirSync(overlapRoot)
    .filter((file) => file.endsWith('.c'))
    .sort();
  let runner;
  try {
    return fixtures.map((fixture) => {
    const source = fs.readFileSync(path.join(overlapRoot, fixture), 'utf8');
    legacyFrontend.resetLegacyFrontendInvocationCount();
    let legacyCompilation;
    let aroCompilation;
    let legacyFailure;
    let aroFailure;
    try {
      legacyCompilation = legacyFrontend.compileLegacyCForDifferential(source);
    } catch (error) {
      legacyFailure = error;
    }
    try {
      aroCompilation = compileAroForDifferential(source, fixture);
    } catch (error) {
      aroFailure = error;
    }
    const legacyInvocations = legacyFrontend.getLegacyFrontendInvocationCount();
    if (legacyFailure || aroFailure) {
      return {
        fixture, equal: false, legacyInvocations,
        details: `legacy: ${legacyFailure?.stack ?? 'ok'}\nAro: ${aroFailure?.stack ?? 'ok'}`,
      };
    }
    const classification = classifyObjectDifference(legacyCompilation, aroCompilation);
    if (!classification.equal) {
      return { fixture, legacyInvocations, ...classification };
    }
    if (!classification.requiresExecution) {
      return { fixture, legacyInvocations, ...classification };
    }
      const expected = expectedResults[fixture];
      if (expected === undefined) {
        return { fixture, equal: false, legacyInvocations, mode: 'rtl', details: 'missing expected result' };
      }
      const legacyWords = linkFixture(legacyCompilation.object, expected, `${fixture}-legacy`);
      const aroWords = linkFixture(aroCompilation.object, expected, `${fixture}-aro`);
      if (JSON.stringify(legacyWords) === JSON.stringify(aroWords)) {
        return { fixture, equal: true, legacyInvocations, mode: 'machine-words', details: 'linked machine words match' };
      }
      runner ??= createRtlRunner();
      const legacyRun = runner.run(legacyWords, `${fixture}-legacy`);
      const aroRun = runner.run(aroWords, `${fixture}-aro`);
      return {
        fixture,
        equal: legacyRun.passed && aroRun.passed,
        legacyInvocations,
        mode: 'rtl',
        details: legacyRun.passed && aroRun.passed
          ? `text differs; both frontends produced RTL result ${expected}`
          : `legacy: ${legacyRun.output}\nAro: ${aroRun.output}`,
      };
    });
  } finally {
    runner?.close();
  }
}

if (require.main === module) {
  const results = compareOverlapCorpus();
  for (const result of results) {
    if (!result.equal) {
      console.error(`${result.fixture}: ${result.details}`);
    }
  }
  if (results.some((result) => !result.equal)) process.exitCode = 1;
  else console.log(`${results.length} overlap fixtures matched (${results.map((result) => result.mode).join(', ')})`);
}

module.exports = {
  classifyObjectDifference, compareOverlapCorpus, moduleSemanticView, normalizeObject, stableObjectView,
};
