'use strict';

const assert = require('node:assert/strict');
const { optimizeModule } = require('../out/cCompiler/optimize');
const { compileC, compileCToObject, generateObject } = require('../out/cCompiler');
const { simplifyControlFlow } = require('../out/cCompiler/controlFlow');
const { runCases } = require('./c-execution');
const optimize = instructions => optimizeModule({abi:'merc32-c-v1',globals:[],functions:[{
    name:'probe',parameters:[],blocks:[{label:'probe.entry',instructions}],
}]}).functions[0].blocks[0].instructions;

for (const op of ['branch-zero','branch-nonzero']) for (const value of [0,1,-1]) {
    const input = [
        {op:'constant',args:[value],dest:0}, {op,args:[0,'taken']},
        {op:'call',args:['fallthrough'],dest:1}, {op:'ret',args:[1]},
        {op:'label',args:['taken']}, {op:'call',args:['taken_call'],dest:2}, {op:'ret',args:[2]},
    ];
    const snapshot = JSON.stringify(input);
    const result = optimize(input);
    const taken = op === 'branch-zero' ? value === 0 : value !== 0;
    assert.deepEqual(result.filter(i=>i.op==='call').map(i=>i.args[0]), [taken?'taken_call':'fallthrough']);
    assert(!result.some(i=>i.op.startsWith('branch-')));
    assert.equal(JSON.stringify(input),snapshot);
}

const threaded = optimize([
    {op:'jump',args:['first']}, {op:'label',args:['dead']}, {op:'call',args:['unreachable']},
    {op:'label',args:['first']}, {op:'jump',args:['second']},
    {op:'label',args:['second']}, {op:'jump',args:['third']},
    {op:'label',args:['third']}, {op:'constant',args:[7],dest:0}, {op:'ret',args:[0]},
]);
assert.deepEqual(threaded.map(i=>i.op),['constant','ret']);

// Unknown conditions preserve both successors and multi-definition merge values.
const diamond = optimize([
    {op:'load',args:['condition'],dest:0}, {op:'branch-zero',args:[0,'other']},
    {op:'constant',args:[3],dest:1}, {op:'jump',args:['end']},
    {op:'label',args:['other']}, {op:'constant',args:[8],dest:1},
    {op:'label',args:['end']}, {op:'ret',args:[1]},
]);
assert.equal(diamond.filter(i=>i.dest===1).length,2);
assert(diamond.some(i=>i.op==='branch-zero'));
const cycle = optimize([{op:'label',args:['a']},{op:'jump',args:['b']},
    {op:'label',args:['b']},{op:'jump',args:['a']},{op:'call',args:['dead']}]);
assert(cycle.some(i=>i.op==='jump'));
assert(!cycle.some(i=>i.op==='call'));
function reachesReturn(body, condition) {
    const labels=new Map(body.map((i,at)=>[i.op==='label'?i.args[0]:undefined,at]));
    const values=new Map(); let at=0;
    for(let steps=0;steps<100;steps++) {
        const i=body[at]; assert(i,'loop must not fall beyond its function');
        if(i.op==='ret')return true;
        if(i.op==='load')values.set(i.dest,condition);
        if(i.op==='jump'){at=labels.get(i.args[0]);continue;}
        if(i.op==='branch-zero' && values.get(i.args[0])===0){at=labels.get(i.args[1]);continue;}
        at++;
    }
    return false;
}
const selfLoop=optimize([{op:'label',args:['self']},{op:'jump',args:['self']},{op:'ret',args:[]}]);
assert.equal(reachesReturn(selfLoop,0),false);
const conditionalCycle=optimize([{op:'load',args:['condition'],dest:0},{op:'branch-zero',args:[0,'exit']},
    {op:'label',args:['loop_a']},{op:'jump',args:['loop_b']},
    {op:'label',args:['loop_b']},{op:'jump',args:['loop_a']},{op:'label',args:['exit']},{op:'ret',args:[]}]);
assert.equal(reachesReturn(conditionalCycle,1),false);
assert.equal(reachesReturn(conditionalCycle,0),true);
const volatile = optimize([{op:'constant',args:[0x08000000],dest:0},
    {op:'load-memory',args:[0,4,0],dest:1,volatile:true},
    {op:'branch-zero',args:[1,'next']},{op:'label',args:['next']},{op:'ret',args:[]}]);
assert(volatile.some(i=>i.op==='load-memory' && i.volatile));
assert(!volatile.some(i=>i.op==='branch-zero'));
assert.throws(()=>optimize([{op:'jump',args:['missing']}]),/label/);
assert.throws(()=>optimize([{op:'label',args:['same']},{op:'label',args:['same']}]),/duplicate/);
const barrier = optimize([{op:'constant',args:[0],dest:0},{op:'call',args:['side_effect']},
    {op:'branch-zero',args:[0,'taken']},{op:'ret',args:[]},{op:'label',args:['taken']},
    {op:'call',args:['other']},{op:'ret',args:[]}]);
assert(barrier.some(i=>i.op==='branch-zero'),'constant knowledge must not cross calls');
const afterInline = compileC('int zero(void){return 0;} int missing(void); int main(void){if(zero())return missing();return 0;}',
    {optimization:'basic'});
assert(!afterInline.assembly.includes('missing'));

const deadSource = 'int missing(void); int main(void){if(0) return missing(); return 0;}';
assert.doesNotThrow(()=>compileC(deadSource,{optimization:'basic'}));
assert.throws(()=>compileC(deadSource,{optimization:'none'}),/missing/);
const cases = [
    {name:'cfg_short_circuit',source:`
        volatile int hits; int hit(void){hits++;return hits;}
        int test(void){int x=0; if(0 && hit()) return 1; if(1 || hit()) x++;
            x += 0 ? hit() : 7; x += 1 ? 9 : hit();
            if((hit(),0)) return 2; if((hit(),1)) x++;
            return hits!=2 || x!=18;}
    `},
    {name:'cfg_loops_goto',source:`
        int test(void){int i=0,sum=0; while(0){sum=99;} do{sum++;}while(0);
            for(i=0;i<8;i++){if(i==2)continue;if(i==6)break;sum+=i;}
            goto inside; while(0){inside: sum+=10;break;}
            if(sum!=24)return 1; i=0; again: i++; if(i<3)goto again;
            for(;;){sum++;break;} return i!=3 || sum!=25;}
    `},
    {name:'cfg_switch_merge',source:`
        int choose(int x){switch(x){case 0:return 4;case 1:x+=2;break;default:x+=7;}return x;}
        int test(void){int i,sum=0;for(i=0;i<4;i++){sum+=i&1?choose(1):choose(0);}
            switch(2){case 1:return 1;case 2:sum+=3;case 3:sum+=5;break;default:return 2;}
            return sum!=22 || choose(5)!=12;}
    `},
    {name:'cfg_unreachable_after_return',source:`
        volatile int writes; int early(int x){if(x)return 3;return 4;writes=99;}
        int test(void){return early(1)!=3 || early(0)!=4 || writes!=0;}
    `},
];
runCases(cases.flatMap(test=>['none','basic'].map(optimization=>({...test,
    name:test.name+'_'+optimization,options:{optimization}}))));
const source = 'int test(void){if(0)return 7;else return 0;}';
const before = compileCToObject(source,{optimization:'none'}).sections[0].size;
const after = compileCToObject(source,{optimization:'basic'}).sections[0].size;
assert(after<before);
console.log(`CONTROL FLOW size: ${before} -> ${after} bytes`);

// Identical code generation isolates jump-threading savings from all other optimizations.
const chain = [{op:'jump',args:['first']}];
for(let i=0;i<12;i++) chain.push({op:'label',args:[i===0?'first':`hop${i}`]},
    {op:'jump',args:[i===11?'done':`hop${i+1}`]});
chain.push({op:'label',args:['done']},{op:'constant',args:[0],dest:0},{op:'ret',args:[0]});
const objectFor = instructions=>generateObject({abi:'merc32-c-v1',globals:[],functions:[{
    name:'cfg_probe',parameters:[],blocks:[{label:'cfg_probe.entry',instructions}],
}]},{optimization:'none'});
const metrics=runCases([chain,simplifyControlFlow(chain)].map((instructions,index)=>({
    name:index?'cfg_chain_after':'cfg_chain_before',source:'int cfg_probe(void);int test(void){return cfg_probe();}',
    options:{optimization:'none'},additionalObjects:[objectFor(instructions)],reportMetrics:true,
})));
assert(metrics[1].cycles<metrics[0].cycles);
assert(metrics[1].codeBytes<metrics[0].codeBytes);
console.log(`CONTROL FLOW ONLY: ${metrics[0].codeBytes} -> ${metrics[1].codeBytes} bytes; ${metrics[0].cycles} -> ${metrics[1].cycles} cycles`);
