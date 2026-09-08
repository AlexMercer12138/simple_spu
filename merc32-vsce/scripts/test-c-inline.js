'use strict';

const assert = require('node:assert/strict');
const { analyzeSource } = require('../out/cFrontend/frontend');
const { adaptTypedUnit, lowerProgram, compileC, compileCToObject } = require('../out/cCompiler');
const { optimizeModule } = require('../out/cCompiler/optimize');
const { SimpleCPUAssembler } = require('../out/assembler');
const { runCases } = require('./c-execution');
const lower = source => lowerProgram(adaptTypedUnit(analyzeSource(source).unit), { optimization: 'basic' });
const instructions = (module, name) => module.functions.find(f => f.name === name).blocks.flatMap(b => b.instructions);

const source = 'int add(int a,int b){return a+b;} int main(void){return add(3,4);}';
const original = lower(source);
const snapshot = JSON.stringify(original);
const optimized = optimizeModule(original);
assert(!instructions(optimized, 'main').some(i => i.op === 'call'));
assert(instructions(optimized, 'main').some(i => i.op === 'constant' && i.args[0] === 7));
assert.equal(JSON.stringify(original), snapshot);
assert(compileCToObject(source, { optimization: 'none' }).relocations.some(r => r.kind === 'CALL16' && r.symbol === 'add'));
assert(!compileCToObject(source, { optimization: 'basic' }).relocations.some(r => r.kind === 'CALL16' && r.symbol === 'add'));
assert.doesNotMatch(compileC(source, { optimization: 'basic' }).assembly, /^add:/m);

const cases = [
    { name: 'inline_narrow_args', source: `
        int s(signed char x){return x;} unsigned u(unsigned short x){return x;}
        unsigned char wrap(unsigned char x){return x+1;}
        int six(int a,int b,int c,int d,int e,int f){return a+b+c+d+e+f;}
        int test(void){return s(255)!=-1 || u(-1)!=65535 || wrap(255)!=0 || six(1,2,3,4,5,6)!=21;}
    ` },
    { name: 'inline_once_and_alias', source: `
        int count; int next(void){count++;return count;}
        int twice(int x){return x+x;} int ignore(int x){return 9;}
        int change(int *p,int x){*p=10;return x+*p;}
        int test(void){int x=3; int a=twice(next()); int b=ignore(next());
            if(a!=2 || b!=9 || count!=2) return 1;
            return change(&x,x)!=13 || x!=10;
        }
    ` },
    { name: 'inline_volatile', source: `
        volatile unsigned value;
        unsigned read(volatile unsigned *p){return *p;}
        void write(volatile unsigned *p,unsigned x){*p=x;}
        int test(void){write(&value,19); if(read(&value)!=19) return 1;
            write(&value,read(&value)+7); read(&value); return value!=26;
        }
    ` },
    { name: 'inline_boundaries', source: `
        int rec(int n){if(n) return rec(n-1)+n; return 0;}
        int local(int x){int a=x+1;return a;}
        int mutate(int x){x++;return x;}
        int leaf(int x){return x*3;} int (*callback)(int)=leaf;
        int test(void){return rec(4)!=10 || local(2)!=3 || mutate(4)!=5 || callback(6)!=18 || leaf(7)!=21;}
    ` },
];
for (const test of cases) {
    const ir = optimizeModule(lower(test.source));
    if(test.name === 'inline_volatile') {
        const body = instructions(ir, 'test');
        assert(!body.some(i => i.op === 'call'));
        assert.equal(body.filter(i => i.op === 'load-memory' && i.volatile).length, 4);
        assert.equal(body.filter(i => i.op === 'store-memory' && i.volatile).length, 2);
    }
    if(test.name === 'inline_boundaries') {
        const calls = instructions(ir, 'test').filter(i => i.op === 'call').map(i => i.args[0]);
        for(const name of ['rec','local','mutate']) assert(calls.includes(name));
        assert(instructions(ir, 'test').some(i => i.op === 'call-indirect'));
    }
}
runCases(cases.flatMap(test => ['none','basic'].map(optimization => ({ ...test,
    name: `${test.name}_${optimization}`, options: { optimization } }))));

const budget = optimizeModule(lower(`unsigned read(volatile unsigned *p){return *p;}
    void many(volatile unsigned *p){${'read(p);'.repeat(40)}}`));
assert(instructions(budget, 'many').some(i => i.op === 'call'), 'per-caller budget must limit expansion');
assert(instructions(budget, 'many').some(i => i.op === 'load-memory' && i.volatile), 'budget must allow initial sites');
const guarded = optimizeModule(lower(`
    int parameter_address(int x){return *(&x);}
    int volatile_parameter(volatile int x){return x;}
    unsigned irq_save(void); unsigned irq_wrapper(void){return irq_save();}
    int caller(int x){return volatile_parameter(x)+irq_wrapper();}
`));
assert(instructions(guarded, 'caller').some(i => i.op === 'call' && i.args[0] === 'volatile_parameter'));
assert(instructions(guarded, 'caller').some(i => i.op === 'call' && i.args[0] === 'irq_wrapper'));
for (const kind of ['struct','union']) {
    const aggregate = optimizeModule(lower(`typedef ${kind} S {int x;} S;
        int field(S s){return s.x;} int caller(void){S s={3};return field(s);}`));
    assert(instructions(aggregate, 'caller').some(i => i.op === 'call' && i.args[0] === 'field'),
        `typedef ${kind} parameters must retain the aggregate ABI path`);
}

// Both paths use basic optimization; an external definition isolates the cost of a real call.
const stepObject = compileCToObject('int step(int x){return x+3;}', { optimization: 'basic' });
const body = 'int test(void){int i=0,sum=0;for(i=0;i<100;i++)sum+=step(i);return sum!=5250;}';
const inlineOnly = runCases([
    {name:'inline_baseline',source:'int step(int);'+body,options:{optimization:'basic'},additionalObjects:[stepObject],reportMetrics:true},
    {name:'inline_enabled',source:'int step(int x){return x+3;}'+body,options:{optimization:'basic'},reportMetrics:true},
]);
assert(inlineOnly[1].cycles < inlineOnly[0].cycles);
assert(inlineOnly[1].codeBytes < inlineOnly[0].codeBytes);
console.log(`INLINE ONLY: ${inlineOnly[0].codeBytes} -> ${inlineOnly[1].codeBytes} bytes; ${inlineOnly[0].cycles} -> ${inlineOnly[1].cycles} cycles`);

const loop = `int step(int x){return x+3;} int test(void){int i=0,sum=0;for(i=0;i<100;i++)sum+=step(i);return sum!=5250;}`;
const measured = runCases(['none','basic'].map(optimization => ({ name: `inline_loop_${optimization}`,
    source: loop, options: { optimization }, reportMetrics: true })));
assert(measured[1].cycles < measured[0].cycles);
console.log(`INLINE cycles: ${measured[0].cycles} -> ${measured[1].cycles}`);
