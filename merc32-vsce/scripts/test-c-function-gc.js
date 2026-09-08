'use strict';

const assert = require('node:assert/strict');
const { compileC, compileCToObject } = require('../out/cCompiler');
const { assembleToObject } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');
const { runCases } = require('./c-execution');

const source = `
    int dead_b(int);
    int dead_a(int n) { return n ? dead_b(n-1) : 50; }
    int dead_b(int n) { return dead_a(n); }
    int initial = 23;
    int recursive(int n) { return n ? recursive(n-1)+n : 0; }
    int table_target(int n) { return n+initial; }
    int (*table[2])(int) = {table_target, recursive};
    int local_target(int n) { return n*7; }
    int test(void) {
        int (*local)(int) = local_target;
        if(table[0](4)!=27 || table[1](5)!=15 || local(6)!=42) return 1;
        return 0;
    }
`;
const plainObject = compileCToObject(source + '\nint main(void){return test();}', { optimization: 'basic' });
const full = compileC(source + '\nint main(void){return test();}', { optimization: 'basic' });
assert(plainObject.symbols.some(s => s.name === 'dead_a' && s.defined));
assert.doesNotMatch(full.assembly, /^dead_[ab]:/m);
for (const name of ['recursive', 'table_target', 'local_target']) assert.match(full.assembly, new RegExp(`^${name}:`, 'm'));

// memmove has a real edge to memcpy; unrelated memory functions can be removed.
const memorySource = `
    void *memmove(void *, const void *, unsigned);
    int test(void) { unsigned char a[8]={1,2,3,4,5,6,7,8};
        memmove(a+1,a,6); if(a[1]!=1 || a[6]!=6) return 1;
        memmove(a,a+1,6); return a[0]!=1 || a[5]!=6;
    }
`;
const memory = compileC(memorySource+'\nint main(void){return test();}', { optimization: 'basic' });
assert.match(memory.assembly, /^memmove:/m);
assert.match(memory.assembly, /^memcpy:/m);
assert.doesNotMatch(memory.assembly, /^(?:memset|memcmp|strlen|strcmp):/m);
const unusedRuntime = compileC('void *memset(void *, int, unsigned); void unused(void){char a[8]; memset(a,0,8);} int main(void){return 0;}',
    { optimization: 'basic' });
assert.doesNotMatch(unusedRuntime.assembly, /^(?:unused|memcpy|memmove|memset|memcmp|strlen|strcmp):/m);

const external = compileCToObject(`
    static int helper(int x) { return x+2; }
    int foreign(int x) { return helper(x); }
    int discarded(void) { return 99; }
`, { optimization: 'none' });
const asm = assembleToObject('asm_callback:\njmp foreign', { exports: ['asm_callback'] });
runCases([
    { name: 'gc_callbacks_none', source, options: { optimization: 'none' } },
    { name: 'gc_callbacks_basic', source, options: { optimization: 'basic' } },
    { name: 'gc_runtime_dependency', source: memorySource, options: { optimization: 'basic' } },
    { name: 'gc_mixed_objects', options: { optimization: 'basic' }, additionalObjects: [external, asm], source: `
        static int helper(int x) { return x*3; }
        int asm_callback(int);
        int test(void) { return helper(4)!=12 || asm_callback(5)!=7; }
    ` },
]);
const deadFunctions = Array.from({length: 20}, (_, i) => `int unused_${i}(int x){return x+${i};}`).join('\n');
const lean = compileC('int main(void){return 0;}', { optimization: 'basic' });
const extra = compileC(deadFunctions+'\nint main(void){return 0;}', { optimization: 'basic' });
assert.deepEqual(new SimpleCPUAssembler().assemble(extra.assembly).machineCodes,
    new SimpleCPUAssembler().assemble(lean.assembly).machineCodes);
console.log('C function GC execution tests passed');
