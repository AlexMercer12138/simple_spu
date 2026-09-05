'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const cCompiler = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

assert.equal(typeof cCompiler.compileC, 'function');
assert.equal(typeof cCompiler.compileCDetailed, 'function');
assert.equal(typeof cCompiler.compileCToObject, 'function');
assert.equal(typeof cCompiler.compileCToObjectDetailed, 'function');
assert.equal(cCompiler.compileLegacyC, undefined,
    'the handwritten compiler must not remain part of the production API');

const source = `
int scale(int left, int right) {
    int local = left;
    local = local + right * 2;
    return local;
}
int main(void) { return scale(3, 4); }
`;
const result = cCompiler.compileC(source, { moduleName: 'aro_compiler' });
assert.equal(typeof result.assembly, 'string');
assert.match(result.assembly, /^\.prog aro_compiler$/m);
assert.ok(new SimpleCPUAssembler().assemble(result.assembly, {
    sourceFileName: 'aro_compiler.asm',
}).machineCodes.length > 0);

const object = cCompiler.compileCToObject(source, { sourceName: 'aro_compiler.c' });
assert.equal(object.version, 1);
assert.equal(object.target, 'merc32');
assert.equal(object.abi, 'merc32-c-v1');
assert.ok(object.symbols.some((symbol) => symbol.name === 'main' && symbol.defined));
assert.ok(object.relocations.some((relocation) => relocation.kind === 'CALL16'
    && relocation.symbol === 'scale'));

// Keep the former differential overlap corpus as permanent Aro backend input.
for (const fixture of ['aggregates', 'calls', 'control', 'globals', 'scalars']) {
    const source = fs.readFileSync(path.join(__dirname, 'fixtures', 'c-frontend', 'overlap', `${fixture}.c`), 'utf8');
    const fixtureResult = cCompiler.compileCToObjectDetailed(source, {
        sourceName: `overlap/${fixture}.c`,
    });
    assert.ok(fixtureResult.artifact, `${fixture} overlap fixture must compile through Aro`);
    assert.deepEqual(fixtureResult.diagnostics.filter((diagnostic) => diagnostic.severity === 'error'), []);
}

const warning = cCompiler.compileCDetailed('#warning aro-warning\nint main(void) { return 0; }', {
    moduleName: 'aro_warning',
});
assert.ok(warning.artifact);
assert.ok(warning.diagnostics.some((diagnostic) => diagnostic.severity === 'warning'
    && diagnostic.message === 'aro-warning'));

for (const [options, pattern] of [
    [{ standard: 'c11' }, /unsupported C standard.*c11/i],
    [{ dlbAddrWidth: 0 }, /dlbAddrWidth.*1\.\.25/],
    [{ dlbAddrWidth: 26 }, /dlbAddrWidth.*1\.\.25/],
    [{ tempSlots: 8 }, /tempSlots.*not supported.*Aro/i],
]) {
    const detailed = cCompiler.compileCDetailed('int main(void) { return 0; }', options);
    assert.equal(detailed.artifact, undefined);
    assert.ok(detailed.diagnostics.some((diagnostic) => diagnostic.severity === 'error'
        && pattern.test(diagnostic.message)));
}

const backendFailure = cCompiler.compileCDetailed(
    'float add(float left, float right) { return left + right; }',
    { sourceName: 'unsupported-float.c' },
);
assert.equal(backendFailure.artifact, undefined);
assert.ok(backendFailure.diagnostics.some((diagnostic) => diagnostic.code === 'C_BACKEND_CAPABILITY'));

const malformed = cCompiler.compileCToObjectDetailed('int main( { return 0; }', {
    sourceName: 'malformed.c',
});
assert.equal(malformed.artifact, undefined);
assert.ok(malformed.diagnostics.length > 0);
assert.throws(
    () => cCompiler.compileC('int main( { return 0; }'),
    (error) => error instanceof cCompiler.CFrontendError
        && error.diagnostics.length > 0,
);

console.log('Aro C compiler integration tests passed');
