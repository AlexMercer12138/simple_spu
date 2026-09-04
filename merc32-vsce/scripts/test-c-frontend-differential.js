'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const extensionRoot = path.resolve(__dirname, '..');
const differential = require('./c-frontend-differential');
const { generateObject } = require('../out/cCompiler');

const intType = Object.freeze({
  kind: 'builtin', name: 'int',
  qualifiers: Object.freeze({ const: false, volatile: false, restrict: false, atomic: false }),
});
const witness = Object.freeze({
  abi: 'merc32-c-v1', globals: Object.freeze([]),
  functions: Object.freeze([Object.freeze({
    name: 'tamper_probe', returnType: intType, parameters: Object.freeze([]),
    parameterNames: Object.freeze([]), localNames: Object.freeze([]), localTypes: Object.freeze([]),
    blocks: Object.freeze([Object.freeze({
      label: 'tamper_probe.entry', instructions: Object.freeze([
        Object.freeze({ op: 'constant', args: Object.freeze([3]), dest: 0 }),
        Object.freeze({ op: 'ret', args: Object.freeze([0]) }),
      ]),
    })]),
  })]),
});
const untampered = generateObject(witness);
const tampered = JSON.parse(JSON.stringify(untampered));
const textSection = tampered.sections.find((section) => section.name === 'text');
textSection.content = textSection.content.replace('mov r4, 3', 'mov r4, 4');
assert.notStrictEqual(textSection.content,
  untampered.sections.find((section) => section.name === 'text').content,
  'the corruption probe must alter one non-label instruction');
const corruption = differential.classifyObjectDifference(
  { object: untampered, module: witness },
  { object: tampered, module: witness },
);
assert.strictEqual(corruption.equal, false,
  'non-label instruction drift must not reach result-only RTL comparison');
assert.strictEqual(corruption.requiresExecution, false,
  'a corrupted object must be rejected before either RTL execution');

const results = differential.compareOverlapCorpus();
assert.deepStrictEqual(results.map((result) => result.fixture), [
  'aggregates.c', 'calls.c', 'control.c', 'globals.c', 'scalars.c',
]);
for (const result of results) {
  assert.strictEqual(result.equal, true, `${result.fixture}: ${result.details}`);
  assert.strictEqual(result.legacyInvocations, 1,
    `${result.fixture}: the explicit harness must invoke the legacy object frontend once`);
}

const run = spawnSync(process.execPath, [path.join(__dirname, 'c-frontend-differential.js')], {
  cwd: extensionRoot,
  encoding: 'utf8',
});
assert.strictEqual(run.status, 0, `${run.stdout}${run.stderr}`);
assert.match(run.stdout, /5 overlap fixtures matched/u);

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-no-fallback-'));
try {
  const sourceFile = path.join(tempRoot, 'main.c');
  fs.writeFileSync(sourceFile, 'int main(void) { return 0; }\n', 'utf8');
  const probe = spawnSync(process.execPath, ['-e', String.raw`
    const assert = require('assert');
    const frontendModule = require('./out/cFrontend/frontend');
    const legacy = require('./out/cCompiler/legacyFrontend');
    const validate = require('./out/cFrontend/validate');
    const sourceFile = process.argv[1];
    const position = { line: 1, column: 1, byteOffset: 0 };
    const diagnostic = Object.freeze({
      severity: 'error', code: 'probe', message: 'probe failure',
      range: { file: 1, start: position, end: position },
      related: [], notes: [], includeTrace: [], macroExpansionTrace: [],
    });
    const cases = [
      { name: 'diagnostic', invoke: () => ({ protocolVersion: 1, bridgeBuildId: 'probe', status: 'diagnostics', diagnostics: [diagnostic] }) },
      { name: 'resource', invoke: () => ({ protocolVersion: 1, bridgeBuildId: 'probe', status: 'diagnostics', diagnostics: [{ ...diagnostic, code: 'memory-bytes' }] }) },
      { name: 'protocol', invoke: () => { throw new validate.CFrontendInternalError('protocol mismatch'); } },
      { name: 'trap', invoke: () => { throw new WebAssembly.RuntimeError('probe trap'); } },
    ];
    for (const testCase of cases) {
      frontendModule.getAroFrontend = () => ({ analyzeSource: testCase.invoke, analyzeFile: testCase.invoke });
      delete require.cache[require.resolve('./out/cCompiler/index')];
      const compiler = require('./out/cCompiler/index');
      legacy.resetLegacyFrontendInvocationCount();
      for (const call of [
        () => compiler.compileCToObject('int main(void) { return 0; }'),
        () => compiler.compileCFileToObject(sourceFile),
      ]) {
        assert.throws(call, testCase.name === 'diagnostic' || testCase.name === 'resource'
          ? (error) => error && error.name === 'CFrontendError' && error.diagnostics.length === 1
          : undefined, testCase.name);
      }
      assert.strictEqual(legacy.getLegacyFrontendInvocationCount(), 0,
        testCase.name + ' must not invoke the legacy frontend');
    }
  `, sourceFile], { cwd: extensionRoot, encoding: 'utf8' });
  assert.strictEqual(probe.status, 0, `${probe.stdout}${probe.stderr}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

console.log('C frontend differential and no-fallback tests passed');
