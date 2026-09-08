'use strict';

const assert = require('node:assert/strict');
const { compileCToObjectDetailed } = require('../out/cCompiler');
const { analyzeSource } = require('../out/cFrontend/frontend');
const { validateEnvelope } = require('../out/cFrontend/validate');
const Ajv = require('ajv/dist/2020');
const schema = require('../resources/c-frontend/typed-c-unit-v1.schema.json');

for (const source of [
    'int irq_save(void); int f(void){return irq_save();}',
    'void irq_restore(int); void f(void){irq_restore(1);}',
    'unsigned irq_save(void){return 0;}',
    'unsigned irq_save(void); unsigned (*p)(void)=irq_save;',
    'unsigned irq_save(void); void f(void){unsigned (*p)(void)=irq_save;}',
]) {
    const result = compileCToObjectDetailed(source);
    assert.equal(result.artifact, undefined, source);
    assert(result.diagnostics.some(d => d.code === 'C_BACKEND_CAPABILITY'), source);
}
const envelope = analyzeSource('struct S{int a[3];}; int f(unsigned char c){struct S s={.a={[2]=9}}; c/=256; return s.a[2]+c;}');
assert.equal(envelope.status, 'ok');
const validate = new Ajv({ strict: true }).compile(schema);
assert(validate(envelope.unit), JSON.stringify(validate.errors));
const badType = structuredClone(envelope);
badType.unit.nodes.find(node => node.kind === 'assignment').computationType = 999999;
assert.throws(() => validateEnvelope(badType, envelope.bridgeBuildId), /type|reference/i);
const badIndices = structuredClone(envelope);
const literal = badIndices.unit.nodes.find(node => node.kind === 'compound-literal' && node.initializerIndices?.length);
literal.initializerIndices[0] = 999999;
assert.throws(() => validateEnvelope(badIndices, envelope.bridgeBuildId), /initializer indices/i);
console.log('embedded intrinsic contracts passed');
