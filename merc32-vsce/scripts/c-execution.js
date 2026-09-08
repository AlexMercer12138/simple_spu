'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compileC, compileCToObject } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');
const { linkObjects } = require('../out/linker');
const { createCStartupObject } = require('../out/runtime/startup');

function runCases(cases) {
    assert(cases.length > 0, 'at least one CPU execution case must be selected');
    const metrics = [];
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-c-execution-'));
    try {
        const simulation = path.join(temporary, 'cpu.vvp');
        const root = path.resolve(__dirname, '../..');
        run('iverilog', ['-g2005', '-s', 'tinyc_cpu_tb', '-o', simulation,
            ...['rtl/cpu/core.v', 'rtl/misc/mul.v', 'rtl/misc/div.v', 'rtl/sim/tinyc_cpu_tb.v']
                .map(file => path.join(root, file))]);
        for (const test of cases) {
            const source = `${test.source}\nint main(void) {
                int result = test();
                *(volatile unsigned *)0x080003c4 = result;
                *(volatile unsigned *)0x080003c0 = result ? 0x0bad : 0x600d;
                return result;
            }`;
            let compiled;
            try {
                const options = { sourceName: `${test.name}.c`,
                    optimization: process.argv.includes('--basic') ? 'basic' : undefined, ...test.options };
                if (test.additionalObjects) {
                    const entry = '__test_startup';
                    const startup = createCStartupObject({ stackTop: 0x08040000, vectorAddress: 4, entry, irqHandler: false });
                    const linked = linkObjects([startup, compileCToObject(source, options), ...test.additionalObjects],
                        { textBase: 4, dataBase: 0x08000000, entrySymbol: entry, gcFunctions: options.optimization === 'basic' });
                    compiled = { assembly: `.prog ${test.name}\n.entry ${entry}\n${linked.assembly}` };
                } else compiled = compileC(source, options);
            }
            catch (error) { throw new Error(`${test.name}: ${error.message}`, { cause: error }); }
            const assembled = new SimpleCPUAssembler().assemble(compiled.assembly, { sourceFileName: `${test.name}.asm` });
            const memory = path.join(temporary, `${test.name}.mem`);
            fs.writeFileSync(memory, assembled.machineCodes.map(word => (word >>> 0).toString(16).padStart(8, '0')).join('\n') + '\n');
            const halt = assembled.debugSymbols.match(/^\S+_halt\s*=\s*(\d+)/m);
            assert(halt, `${test.name}: missing startup halt`);
            const output = run('vvp', [simulation, `+ROM_FILE=${memory.replace(/\\/g, '/')}`,
                `+ROM_WORDS=${assembled.machineCodes.length}`, `+HALT_PC=${Number(halt[1])}`,
                '+RETURN_VALUE=0', '+STACK_TOP=134479872', ...(test.reportMetrics ? ['+REPORT_METRICS'] : [])]);
            assert.match(output, /^TEST PASS$/m, `${test.name}: ${output}`);
            assert.doesNotMatch(output, /^TEST (FAIL|TIMEOUT)/m, `${test.name}: ${output}`);
            if (test.reportMetrics) {
                const measured = output.match(/^METRICS cycles=(\d+)/m);
                assert(measured, `${test.name}: missing cycle metrics`);
                metrics.push({ name: test.name, codeBytes: assembled.machineCodes.length * 4, cycles: Number(measured[1]) });
            }
            console.log(`PASS ${test.name}`);
        }
    } finally {
        fs.rmSync(temporary, { recursive: true, force: true });
    }
    return metrics;
}

function run(command, args) {
    const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 120000 });
    const output = `${result.stdout || ''}${result.stderr || ''}`;
    assert.equal(result.status, 0, `${command}: ${result.error || output}`);
    return output;
}

module.exports = { runCases };
