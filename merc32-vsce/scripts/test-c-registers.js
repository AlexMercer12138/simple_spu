'use strict';

const assert = require('node:assert/strict');
const { compileCToObject, generateObject, builtinType } = require('../out/cCompiler');
const { allocateLocalRegisters } = require('../out/cCompiler/localRegisters');
const { runCases } = require('./c-execution');

const allocation = instructions => allocateLocalRegisters({name:'probe',parameters:[],blocks:[{label:'probe.entry',instructions}]});
for(const boundary of [
    {op:'call',args:['external'],dest:2}, {op:'call-indirect',args:[1],dest:2},
    {op:'runtime-call',args:['helper'],dest:2},
    {op:'load-memory',args:[1,4,0],dest:2,volatile:true},
    {op:'fill-memory',args:[1,0,8,0]}, {op:'label',args:['next']},
    {op:'branch-zero',args:[1,'next']}, {op:'jump',args:['next']},
]) {
    const assigned = allocation([{op:'constant',args:[7],dest:0}, boundary, {op:'ret',args:[0]}]);
    assert(!assigned.has(0), `${boundary.op}: live-through values require stack storage`);
}
assert(!allocation([{op:'constant',args:[1],dest:0},{op:'constant',args:[2],dest:0},{op:'ret',args:[0]}]).has(0),
    'multiple definitions require stack storage');
assert(!allocation([{op:'store',args:['x',0]},{op:'constant',args:[1],dest:0}]).has(0),
    'a use before its definition must not receive a local register');

const source = 'int add(int a,int b){return (a+b)*4+1;}';
const object = compileCToObject(source, { optimization: 'basic' });
const text = object.sections.find(s => s.name === 'text');
assert(text.size < 172, `register allocation must improve the previous basic baseline of 172 bytes, got ${text.size}`);
console.log(`REGISTER SIZE arithmetic: 172 -> ${text.size} bytes`);
assert.doesNotMatch(text.content, /(?:sw|mov) \[r13 \+ 0\], r14/, 'leaf functions must not save an unmodified return address');

const names = Array.from({length:8},(_,i)=>`p${i}`);
const pressure = { name:'pressure', parameters:names.map(()=>builtinType('int')), parameterNames:names,
    blocks:[{label:'pressure.entry',instructions:[
        ...names.map((name,dest)=>({op:'load',args:[name],dest})),
        {op:'binary',args:['+',0,1],dest:8},
        ...Array.from({length:6},(_,i)=>({op:'binary',args:['+',8+i,2+i],dest:9+i})),
        {op:'ret',args:[14]},
    ]}] };
const allocated = allocateLocalRegisters(pressure);
assert(names.some((_,i)=>!allocated.has(i)), 'fixture must exceed available registers');
assert(names.some((_,i)=>allocated.has(i)), 'fixture must exercise register and stack operands together');
const pressureObject = generateObject({abi:'merc32-c-v1',globals:[],functions:[pressure]}, {optimization:'basic'});
runCases([{name:'register_forced_spills',options:{optimization:'basic'},additionalObjects:[pressureObject],source:`
    int pressure(int,int,int,int,int,int,int,int);
    int test(void) { return pressure(3,5,7,11,13,17,19,23)!=98; }
`}]);

const cases = [
    { name: 'register_pressure', source: `
        volatile int input[10] = {1,2,3,4,5,6,7,8,9,10};
        int sum(int a,int b,int c,int d,int e,int f,int g,int h,int i,int j) {
            return a+b+c+d+e+f+g+h+i+j;
        }
        int test(void) {
            int a[10]; for(int i=0;i<10;i++) a[i]=input[i];
            if(sum(a[0]+10,a[1]+20,a[2]+30,a[3]+40,a[4]+50,
                   a[5]+60,a[6]+70,a[7]+80,a[8]+90,a[9]+100)!=605) return 1;
            return ((a[0]+a[1])*(a[2]+a[3])+(a[4]+a[5])*(a[6]+a[7])) != 186;
        }` },
    { name: 'register_calls_recursion', source: `
        int step(int x) { return x*3+1; }
        int recurse(int x) { return x ? (x*2+1)+recurse(x-1) : 7; }
        int (*callback)(int)=step;
        int test(void) {
            int x=5;
            if((x*7+3)+callback(4)+(x*11+9)!=115) return 1;
            if(recurse(6)!=55) return 2;
            return 0;
        }` },
    { name: 'register_cfg', source: `
        int test(void) {
            int sum=0;
            for(int i=0;i<8;i++) sum += (i&1) ? i*3 : i+2;
            if(sum!=68) return 1;
            int i=0,x=3;
            loop: x=(x*3+1)%97; if(++i<4) goto loop;
            if(x!=89) return 2;
            if(!(sum==68 && x==89) || (sum==0 || x==0)) return 3;
            return 0;
        }` },
    { name: 'register_memory_and_fill', source: `
        struct S { int x; int y; unsigned char bytes[24]; };
        int test(void) {
            struct S s={3,4,{1}}; struct S t=s;
            int a[6]={1,2,3,4,5,6}; int *p=a+2;
            *p=(*p+7)*2; p[1]+=*p;
            if(a[2]!=20 || a[3]!=24 || t.x+t.y!=7 || t.bytes[23]) return 1;
            return 0;
        }` },
];
const metrics = runCases(cases.flatMap(test => ['none','basic'].map(optimization => ({
    ...test, name: `${test.name}_${optimization}`, options: { optimization }, reportMetrics: true,
}))));
for(let i=0;i<metrics.length;i+=2) {
    assert(metrics[i+1].cycles < metrics[i].cycles);
    console.log(`REGISTER CYCLES ${cases[i/2].name}: ${metrics[i].cycles} -> ${metrics[i+1].cycles}`);
}
