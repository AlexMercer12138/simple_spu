'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const { compileCToObject, loadRuntimeObjects } = require('../out/cCompiler');
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
    let legacyObject;
    let aroObject;
    let legacyFailure;
    let aroFailure;
    try {
      legacyObject = legacyFrontend.compileLegacyCToObject(source);
    } catch (error) {
      legacyFailure = error;
    }
    try {
      aroObject = compileCToObject(source, { sourceName: fixture });
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
    const legacy = normalizeObject(legacyObject);
    const aro = normalizeObject(aroObject);
    try {
      assert.deepStrictEqual(aro, legacy);
      return { fixture, equal: true, legacyInvocations, mode: 'object', details: 'normalized objects match' };
    } catch (error) {
      try {
        assert.deepStrictEqual(stableObjectView(aroObject), stableObjectView(legacyObject));
      } catch (shapeError) {
        return { fixture, equal: false, legacyInvocations, mode: 'object', details: String(shapeError) };
      }
      const expected = expectedResults[fixture];
      if (expected === undefined) {
        return { fixture, equal: false, legacyInvocations, mode: 'rtl', details: 'missing expected result' };
      }
      const legacyWords = linkFixture(legacyObject, expected, `${fixture}-legacy`);
      const aroWords = linkFixture(aroObject, expected, `${fixture}-aro`);
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
    }
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

module.exports = { compareOverlapCorpus, normalizeObject, stableObjectView };
