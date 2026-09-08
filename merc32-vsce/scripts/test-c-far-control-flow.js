'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { compileC, compileCToObject, loadMemoryRuntimeObject } = require('../out/cCompiler');
const { assembleToObject } = require('../out/linker/assembleObject');
const { SimpleCPUAssembler } = require('../out/assembler');
const { runCases } = require('./c-execution');
const { linkObjects } = require('../out/linker');
const { createCStartupObject } = require('../out/runtime/startup');
const includeRoot = path.resolve(__dirname, '../resources/c-frontend/include');
const headers = { includePaths: ['include'], virtualFiles: fs.readdirSync(includeRoot)
    .map(name => ({ path: `include/${name}`, source: fs.readFileSync(path.join(includeRoot, name), 'utf8') })) };

// Cross the old 32 KiB image limit through the public compile API.
for (const optimization of ['none', 'basic']) {
    const edge = compileC('void __irq_handler(void) {} int main(void) { return 0; }',
        { codeBase: 0x7ffc, optimization });
    new SimpleCPUAssembler().assemble(edge.assembly);
    const compiled = compileC('int main(void) { int i=0; while(i<12) i++; return i; }',
        { codeBase: 0x7ff0, optimization });
    const assembled = new SimpleCPUAssembler().assemble(compiled.assembly);
    assert(assembled.machineCodes.length * 4 + 0x7ff0 > 0x8000);
}

const padding = assembleToObject('mov r0, 0\n'.repeat(17000));
const cases = ['none', 'basic'].map(optimization => {
    const far = compileCToObject(`
        #include <string.h>
        extern int near_value(int);
        int recursive(int n) { if (!n) return 3; return recursive(n-1)+n; }
        int far_value(int mode) {
            unsigned char bytes[48] = {1};
            int i, sum=0;
            for(i=0; i<48; i++) sum += bytes[i];
            if(sum!=1) return 101;
            memset(bytes, 65, 40);
            memmove(bytes+1, bytes, 39);
            bytes[40]=0;
            if(strlen((char *)bytes)!=40 || memcmp(bytes, bytes+1, 39)) return 102;
            if(mode) { if(recursive(5)!=18) return 103; }
            else { if(near_value(4)!=11) return 104; }
            for(i=0; i<5; i++) { if(i==2) continue; sum+=i; }
            return sum==9 ? 0 : 105;
        }
    `, { ...headers, optimization, sourceName: `far-${optimization}.c` });
    return { name: `far_control_flow_${optimization}`, options: { optimization },
        additionalObjects: [padding, far, loadMemoryRuntimeObject()], reportMetrics: true,
        source: `
            int far_value(int);
            int (*callback)(int) = far_value;
            int near_value(int x) { return x+7; }
            int test(void) { int a=far_value(0); if(a) return a; return callback(1); }
        ` };
});
cases.unshift({ name: 'far_public_compile', options: { optimization: 'none' }, reportMetrics: true,
    source: 'int test(void) { unsigned char buffer[2000] = {0}; return buffer[0] | buffer[1999]; }' });
for (const result of runCases(cases)) {
    assert(result.codeBytes > 0x10000, `${result.name}: expected far image, got ${result.codeBytes} bytes`);
    console.log(`${result.name}: ${result.codeBytes} bytes, ${result.cycles} cycles`);
}

// The vector remains near; its call reaches a far C handler after saving all scratch registers.
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-far-irq-'));
function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.equal(result.status, 0, `${command}: ${result.error || output}`);
    return output;
}
try {
    const simulation = path.join(temporary, 'irq.vvp');
    run('iverilog', ['-g2005', '-s', 'tinyc_irq_tb', '-o', simulation,
        ...['rtl/cpu/core.v', 'rtl/misc/mul.v', 'rtl/misc/div.v', 'rtl/sim/tinyc_irq_tb.v']
            .map(file => path.resolve(__dirname, '../..', file))]);
    for (const optimization of ['none', 'basic']) {
        const object = compileCToObject(`
            #include <merc32_irq.h>
            int unused_irq_neighbor(void) { return 123; }
            void __irq_handler(void) { *(volatile unsigned *)0x080003c0 = 0x600e; }
            int main(void) {
                __irq_enable_level();
                *(volatile unsigned *)0x080003c0 = 0x1234;
                while(1) {}
            }
        `, { ...headers, optimization });
        const entry = '__far_irq_startup';
        const startup = createCStartupObject({ stackTop: 0x08040000, vectorAddress: 4, entry, irqHandler: true });
        const linked = linkObjects([startup, padding, object], { textBase: 4, dataBase: 0x08000000,
            entrySymbol: entry, gcFunctions: optimization === 'basic' });
        assert.equal(linked.symbols.has('unused_irq_neighbor'), optimization !== 'basic');
        assert(linked.symbols.get('__irq_handler') > 0xffff);
        const assembled = new SimpleCPUAssembler().assemble(`.entry ${entry}\n${linked.assembly}`);
        const memory = path.join(temporary, `${optimization}.mem`);
        fs.writeFileSync(memory, assembled.machineCodes.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('\n'));
        const output = run('vvp', [simulation, `+ROM_FILE=${memory.replace(/\\/g, '/')}`,
            `+ROM_WORDS=${assembled.machineCodes.length}`]);
        assert.match(output, /^TEST PASS$/m, output);
        assert.doesNotMatch(output, /^TEST (FAIL|TIMEOUT)/m, output);
        console.log(`PASS far_irq_${optimization}`);
    }
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
