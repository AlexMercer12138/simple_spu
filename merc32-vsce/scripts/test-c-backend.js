const assert = require('assert');
const { VirtualRegisterAllocator } = require('../out/cCompiler/registers');
const { lowerProgram } = require('../out/cCompiler/lower');
const { generateAssembly, generateObject } = require('../out/cCompiler/codegen');

const allocator = new VirtualRegisterAllocator();
assert(!allocator.isReserved('r4'));
assert(allocator.isReserved('r0'));
assert(allocator.isReserved('r12'));
const irModule = lowerProgram({ kind: 'translation-unit', declarations: [] });
assert.strictEqual(irModule.functions.length, 0);
assert.strictEqual(generateAssembly(irModule), '');
assert.strictEqual(generateObject(irModule).target, 'merc32');
console.log('c backend tests passed');
