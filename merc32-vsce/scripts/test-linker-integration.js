const assert = require('assert');
const { SimpleCPUAssembler } = require('../out/assembler');
const { generateObject } = require('../out/cCompiler/codegen');
const { assembleToObject, linkObjects } = require('../out/linker');
const image = linkObjects([
  assembleToObject('main:\n  jmp helper, r14\n', { exports: ['main'] }),
  assembleToObject('helper:\n  jmp r14\n', { exports: ['helper'] }),
], { entrySymbol: 'main' });
assert(image.assembly.includes('main:'));
assert.strictEqual(image.symbols.get('helper'), 4);
assert.strictEqual(image.entryAddress, 0);
assert.match(image.assembly, /jmp 0x4, r14/);

const typedObject = name => generateObject({
  abi: 'merc32-c-v1',
  globals: [],
  functions: [{
    name,
    parameters: [],
    returnLabel: '__main_return',
    blocks: [{ label: `${name}.entry`, instructions: [{ op: 'ret', args: [] }] }],
  }],
});
const typedObjects = [typedObject('first'), typedObject('second')];
for (const object of typedObjects) {
  assert(object.symbols.some(symbol =>
    symbol.name === '__main_return' && symbol.binding === 'local' && symbol.defined
  ));
}
const typedImage = linkObjects(typedObjects);
assert.match(typedImage.assembly, /__mobj_0___main_return:/);
assert.match(typedImage.assembly, /__mobj_1___main_return:/);
assert.strictEqual(
  new SimpleCPUAssembler().assemble(typedImage.assembly).machineCodes.length,
  typedObjects.reduce((words, object) => words + object.sections[0].size / 4, 0),
);
console.log('linker integration tests passed');
