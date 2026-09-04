const assert = require('assert');
const { VirtualRegisterAllocator } = require('../out/cCompiler/registers');
const { lowerProgram } = require('../out/cCompiler/lower');
const { generateAssembly, generateObject } = require('../out/cCompiler/codegen');

const allocator = new VirtualRegisterAllocator();
assert(!allocator.isReserved('r4'));
assert(allocator.isReserved('r0'));
assert(allocator.isReserved('r12'));
const irModule = lowerProgram({ kind: 'translation-unit', declarations: [] });
assert.deepStrictEqual(irModule.functions.map((func) => func.name), ['__merc32_init_globals']);
assert.match(generateAssembly(irModule), /^__merc32_init_globals:/);
const object = generateObject(irModule);
assert.strictEqual(object.target, 'merc32');
assert(object.symbols.some((symbol) =>
    symbol.name === '__merc32_init_globals' && symbol.binding === 'global' && symbol.defined
));
assert(!object.sections.some((section) => section.name === 'data' || section.name === 'bss'));
console.log('c backend tests passed');
