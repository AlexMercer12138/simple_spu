'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { analyzeSource } = require('../out/cFrontend/frontend');
const { adaptTypedUnit, lowerProgram, compileCToObject, compileCToObjectDetailed,
    compileCFileToObject, compileCFileDetailed, splitCompileOptions } = require('../out/cCompiler');
const { runCases } = require('./c-execution');
const { instructionEffects } = require('../out/cCompiler/irEffects');
const { optimizeModule } = require('../out/cCompiler/optimize');

for (const [operator, left, right, unsigned, expected] of [
    ['>', 0xffffffff, 1, 1, 1], ['>', 0xffffffff, 1, 0, 0],
    ['/', 0xfffffffd, 2, 1, 2147483646], ['/', -9, 4, 0, -2], ['%', -9, 4, 0, -1],
    ['*', 0xffffffff, 0xffffffff, 1, 1], ['+', 0xffffffff, 1, 1, 0],
    ['>>', 0x80000000, 31, 1, 1], ['>>', 0x80000000, 31, 0, -1],
    ['<<', 1, 31, 1, -2147483648], ['^', 0xffffffff, 0xffff, 1, -65536],
]) {
    const ir = { abi: 'merc32-c-v1', globals: [], functions: [{ name: 'fold', parameters: [], blocks: [{
        label: 'fold.entry', instructions: [
            { op: 'constant', args: [left], dest: 0 }, { op: 'constant', args: [right], dest: 1 },
            { op: 'binary', args: [operator, 0, 1, unsigned], dest: 2 }, { op: 'ret', args: [2] },
        ],
    }] }] };
    const original = JSON.stringify(ir);
    const folded = optimizeModule(ir).functions[0].blocks[0].instructions;
    assert.deepEqual(folded.find(i => i.dest === 2), { op: 'constant', args: [expected], dest: 2 },
        `constant evaluation ${left} ${operator} ${right}, unsigned=${unsigned}`);
    assert.equal(JSON.stringify(ir), original, 'optimization must not mutate its input IR');
}

const effectsSource = `
    volatile unsigned value;
    void external(void);
    unsigned irq_save(void); void irq_restore(unsigned);
    int test(void) { unsigned saved = irq_save(); value++; external(); irq_restore(saved); return value; }
`;
const moduleIR = lowerProgram(adaptTypedUnit(analyzeSource(effectsSource).unit));
const instructions = moduleIR.functions.find(f => f.name === 'test').blocks.flatMap(b => b.instructions);
assert.equal(instructions.filter(i => i.op === 'load-memory' && i.volatile === true).length, 2,
    'volatile reads must retain their access qualifier in IR');
assert(instructions.some(i => i.op === 'store-memory' && i.volatile === true),
    'volatile stores must retain their access qualifier in IR');
assert(instructions.filter(i => i.op === 'call').every(i => instructionEffects(i).barrier), 'calls and IRQ intrinsics are barriers');
assert(instructionEffects({ op: 'future-op', args: [] }).barrier, 'unknown operations are barriers');
const aggregateIR = lowerProgram(adaptTypedUnit(analyzeSource(
    'int test(void) { volatile struct S { int x; int y; } s = {1,2}; s.x++; s.x+=3; s.x=9; return s.x; }').unit));
assert(aggregateIR.functions[0].blocks[0].instructions.filter(i => i.op === 'store-memory' || i.op === 'load-memory')
    .every(i => i.volatile), 'aggregate qualifiers must propagate to explicit member initialization');
const arrayMemberIR = lowerProgram(adaptTypedUnit(analyzeSource(`
    struct S { int a[2]; };
    int test(volatile struct S *p) { p->a[0]++; p->a[1]+=3; return p->a[0]; }
`).unit));
assert.equal(arrayMemberIR.functions[0].blocks[0].instructions.filter(i => i.volatile).length, 5,
    'array decay must retain inherited aggregate volatility on three reads and two writes');

for (const optimization of ['fast', 1, null]) {
    const result = compileCToObjectDetailed('int main(void) { return 0; }', { optimization });
    assert(!result.artifact && result.diagnostics.some(d => d.code === 'MERC32_C_OPTION'), 'invalid optimization mode');
}
const split = splitCompileOptions({ sourceName: 'input.c', optimization: 'basic' });
assert.equal(split.backend.optimization, 'basic');
assert(!('optimization' in split.frontend), 'backend options must not leak into the frontend');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-optimization-api-'));
try {
    const file = path.join(temp, 'input.c');
    const source = 'unsigned char buffer[256]; int main(void) { return buffer[0]; }';
    fs.writeFileSync(file, source);
    assert.deepEqual(compileCFileToObject(file, { optimization: 'basic' }).sections,
        compileCToObject(source, { optimization: 'basic' }).sections, 'file and string APIs must select the same optimizer');
    assert(!compileCFileDetailed(file, { optimization: 'invalid' }).artifact);
    const originalLoad = Module._load;
    let selected;
    try {
        Module._load = function(request, ...args) {
            if (request === 'vscode') return { workspace: { getConfiguration: () => ({
                get: (key, fallback) => key === 'c.optimization' ? selected ?? fallback : fallback,
            }) } };
            return originalLoad.call(this, request, ...args);
        };
        const { getAssemblerSettings } = require('../out/configuration');
        assert.equal(getAssemblerSettings(file).cOptimization, 'basic');
        const { compileCFileToAssemblyDetailed } = require('../out/compilerService');
        const defaultBuild = compileCFileToAssemblyDetailed(file);
        assert(defaultBuild.artifact, JSON.stringify(defaultBuild.diagnostics));
        selected = 'basic';
        assert.equal(getAssemblerSettings(file).cOptimization, 'basic');
        const optimized = compileCFileToAssemblyDetailed(file);
        assert(optimized.artifact, JSON.stringify(optimized.diagnostics));
        assert.equal(defaultBuild.artifact.assembly, optimized.artifact.assembly,
            'unconfigured extension builds must use basic optimization');
        selected = 'none';
        const plain = compileCFileToAssemblyDetailed(file);
        assert(plain.artifact.assembly.length > optimized.artifact.assembly.length * 4, 'extension command must honor optimization setting');
    } finally { Module._load = originalLoad; }
} finally { fs.rmSync(temp, { recursive: true, force: true }); }

const probes = [
    ['global_zero', 'unsigned char buffer[256]; int main(void) { return buffer[0]; }'],
    ['local_zero', 'int main(void) { unsigned char buffer[256] = {0}; return buffer[255]; }'],
    ['local_arithmetic', 'int add(int a, int b) { return (a + b) * 4 + 1; }'],
];
for (const [name, source] of probes) {
    const plain = compileCToObject(source, { optimization: 'none' });
    const basic = compileCToObject(source, { optimization: 'basic' });
    const before = plain.sections.find(s => s.name === 'text');
    const after = basic.sections.find(s => s.name === 'text');
    assert(after.size < before.size * (name.includes('zero') ? 0.3 : 0.9), `${name}: code size ${before.size} -> ${after.size}`);
    const frames = text => [...text.matchAll(/mov r13, r13 - (\d+)/g)].map(m => Number(m[1]));
    assert(Math.max(...frames(after.content)) < Math.max(...frames(before.content)), `${name}: stack frame must shrink`);
    console.log(`SIZE ${name}: ${before.size} -> ${after.size} bytes; max frame ${Math.max(...frames(before.content))} -> ${Math.max(...frames(after.content))}`);
}

const cases = [
    { name: 'initialization_bounds', source: `
        unsigned char before = 77, zero[256], after = 88;
        unsigned char sparse[80] = {[1]=3, [79]=9};
        int target = 123; struct R { unsigned char bytes[32]; int *p; int tail; } record = {.p=&target, .tail=7};
        int test(void) {
            unsigned char local[96] = {[95]=11}; char text[80] = "abc";
            for (int i=0;i<256;i++) if(zero[i]) return 1;
            for (int i=0;i<95;i++) if(local[i]) return 2;
            if(before!=77 || after!=88 || local[95]!=11 || text[3] || text[79]) return 3;
            if(sparse[0] || sparse[1]!=3 || sparse[78] || sparse[79]!=9) return 4;
            if(*record.p!=123 || record.tail!=7 || record.bytes[31]) return 5;
            return 0;
        }` },
    { name: 'volatile_alias_calls', source: `
        volatile unsigned value; int normal;
        void change(int *p) { *p=17; value=9; }
        int test(void) {
            value=2; unsigned a=value; unsigned b=value++; unsigned c=++value;
            if(a!=2 || b!=2 || c!=4 || value!=4) return 1;
            normal=3; int *alias=&normal; change(alias);
            if(normal!=17 || value!=9) return 2;
            volatile unsigned char bytes[19] = {[18]=5};
            if(bytes[0] || bytes[18]!=5) return 3;
            return 0;
        }` },
    { name: 'cfg_loops_and_goto', source: `
        int sum(int n) { if(n==0) return 0; return n+sum(n-1); }
        int test(void) {
            int a=0, b=0, n=7;
            while(n--) { if(n&1) a+=n; else b+=n; }
            if(a!=9 || b!=12 || sum(6)!=21) return 1;
            int i=0, x=0;
            again: x += i ? i*3 : 7; if(++i<5) goto again;
            if(x!=37) return 2;
            switch(x) {case 37: x=1; break; default: x=9;}
            if(x!=1) return 3;
            return 0;
        }` },
    { name: 'integer_edge_values', source: `
        unsigned u = 0xf1234567u; int s = -9;
        int test(void) {
            if((u & 0xffffu)!=0x4567u || (u | 0x8000u)!=0xf123c567u) return 1;
            if((s>>2)!=-3 || s/4!=-2 || s%4!=-1) return 2;
            if((unsigned char)(u+1)!=104 || (short)0xff80!=-128) return 3;
            if(u*4u!=0xc48d159cu || (u>>31)!=1) return 4;
            return 0;
        }` },
    { name: 'immediates_and_narrow_locals', source: `
        typedef signed char Small;
        int addNegative(int x) { return x + -32768; }
        int subNegative(int x) { return x - -32768; }
        int subtractOne(int x) { return x + -1; }
        int addWide(int x) { return x + 65535; }
        int narrow(int n) { Small s=n; short t=n; return s+t; }
        int test(void) {
            if(addNegative(7)!=-32761 || subNegative(7)!=32775 || subtractOne(7)!=6 || addWide(7)!=65542) return 1;
            if(narrow(65408)!=-256) return 4;
            unsigned mask=0x76543210u;
            if((mask ^ 65535u)!=0x7654cdefu || (mask & 32768u)!=0) return 2;
            if((mask|32768u)!=0x7654b210u) return 3;
            return 0;
        }` },
];
const metrics = runCases(cases.flatMap(test => ['none', 'basic'].map(optimization => ({
    ...test, name: `${test.name}_${optimization}`, options: { optimization }, reportMetrics: true,
}))));
for (let index = 0; index < metrics.length; index += 2) {
    const before = metrics[index], after = metrics[index + 1];
    assert(after.cycles < before.cycles, `${after.name}: expected fewer cycles (${before.cycles} -> ${after.cycles})`);
    console.log(`CYCLES ${cases[index / 2].name}: ${before.cycles} -> ${after.cycles}`);
}
