'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { compileC, compileCFile, compileCToObject, compileCToObjectDetailed } = require('../out/cCompiler');
const { analyzeSource, analyzeFile } = require('../out/cFrontend/frontend');
const { adaptTypedUnit } = require('../out/cCompiler/backendAdapter');
const { normalizeDiagnostics, validateEnvelope } = require('../out/cFrontend/validate');
const { assembleToObject, linkObjects } = require('../out/linker');
const { SimpleCPUAssembler } = require('../out/assembler');
const { withHostCompilerBlocked } = require('./smoke-extension/suite/process-launch-guard');

const repo = path.resolve(__dirname, '../..');
const selected = process.argv[2];
const cases = [];
const test = (name, action) => cases.push({ name, action });
const temporary = (action) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-final-review-'));
    try { return action(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
};
const analyze = (source, options) => {
    const result = analyzeSource(source, options);
    assert.equal(result.status, 'ok', JSON.stringify(result.diagnostics));
    return result.unit;
};

function runRtl(assembly, publicReturn) {
    const assembled = new SimpleCPUAssembler().assemble(assembly);
    temporary((root) => {
        const memory = path.join(root, 'program.mem');
        const simulation = path.join(root, 'program.vvp');
        fs.writeFileSync(memory, assembled.machineCodes.map((word) => (word >>> 0).toString(16).padStart(8, '0')).join('\n'));
        const compile = spawnSync('iverilog', ['-g2005', '-s', 'tinyc_cpu_tb', '-o', simulation,
            ...['rtl/cpu/core.v', 'rtl/misc/mul.v', 'rtl/misc/div.v', 'rtl/sim/tinyc_cpu_tb.v'].map((file) => path.join(repo, file))],
        { encoding: 'utf8', windowsHide: true, timeout: 120000 });
        assert.equal(compile.status, 0, compile.stderr);
        const returnChecks = [];
        if (publicReturn) {
            const halt = assembled.debugSymbols.match(/^\S+_halt\s*=\s*(\d+)/m);
            assert(halt, 'public assembly must define a return-to-halt path');
            returnChecks.push(`+HALT_PC=${halt[1]}`, '+RETURN_VALUE=0', `+STACK_TOP=${publicReturn.stackTop ?? 0x08040000}`);
            if (publicReturn.irq) returnChecks.push(`+VECTOR_ADDRESS=${(publicReturn.codeBase ?? 0) + 4}`);
        }
        const run = spawnSync('vvp', [simulation, `+ROM_FILE=${memory.replace(/\\/g, '/')}`, `+ROM_WORDS=${assembled.machineCodes.length}`, ...returnChecks],
            { encoding: 'utf8', windowsHide: true, timeout: 120000 });
        assert.equal(run.status, 0, run.stdout + run.stderr);
        assert.match(run.stdout, /^TEST PASS$/m, run.stdout + run.stderr);
        assert.doesNotMatch(run.stdout, /^TEST (FAIL|TIMEOUT)/m);
    });
}

function executeObjects(objects, expected) {
    const unsigned = expected >>> 0;
    const wrapper = assembleToObject(`
review_start:
  mov r13, 0x804
  mov r13, r13 << 16
  jmp __merc32_init_globals, r14
  jmp main, r14
  mov r8, 0x${(unsigned >>> 16).toString(16)}
  mov r8, r8 << 16
  mov r9, 0x${(unsigned & 65535).toString(16)}
  mov r9, r9 << 16
  mov r9, r9 >> 16
  mov r8, r8 | r9
  cmp r7, r4 == r8
  bz r7, r0 + review_fail
  mov r7, 0x600D
  jmp review_report
review_fail:
  mov r7, 0xBAD
review_report:
  mov r8, 0x800
  mov r8, r8 << 16
  mov r8, r8 + 0x3C0
  sw [r8 + 4], r4
  sw [r8], r7
review_halt:
  jmp review_halt
`, { exports: ['review_start'] });
    runRtl(linkObjects([wrapper, ...objects], { entrySymbol: 'review_start', dataBase: 0x08000000 }).assembly);
}
const execute = (source, expected) => executeObjects([compileCToObject(source)], expected);

test('I1-public-startup', () => {
    const source = `int seed = 7; int zero;
int helper(int value) { int local = value + seed + zero; return local; }
int main(void) {
    unsigned int address = 0x800; address = address << 16; address = address + 0x3C0;
    volatile int *status = (volatile int *)address;
    *status = helper(2) == 9 ? 0x600D : 0xBAD;
    return 0;
}`;
    runRtl(compileC(source).assembly, {});
    runRtl(compileC(`void __irq_handler(void) {}\n${source}`, { dlbAddrWidth: 14 }).assembly,
        { irq: true, stackTop: 0x08010000 });
    temporary((root) => { const file = path.join(root, 'main.c'); fs.writeFileSync(file, source); runRtl(compileCFile(file).assembly, {}); });
});
test('I2-empty-compatibility-containment', () => temporary((root) => {
    const allowed = path.join(root, 'allowed'); fs.mkdirSync(allowed);
    const main = path.join(allowed, 'main.c');
    fs.writeFileSync(main, '#include "secret.h"\nint main(void) { return SECRET; }');
    fs.writeFileSync(path.join(root, 'secret.h'), '#define SECRET 99\n');
    const old = process.cwd();
    try {
        process.chdir(root);
        assert.equal(analyzeFile(main, {}, {}).status, 'diagnostics', 'empty compatibility options must not read cwd headers');
    } finally { process.chdir(old); }
}));
test('I3-include-candidate-precedence', () => temporary((root) => {
    fs.mkdirSync(path.join(root, 'dir')); fs.mkdirSync(path.join(root, 'inc/dir'), { recursive: true });
    fs.writeFileSync(path.join(root, 'main.c'), '#include "dir/a.h"\nint main(void) { return VALUE; }');
    fs.writeFileSync(path.join(root, 'dir/a.h'), '#include "x.h"\n');
    fs.writeFileSync(path.join(root, 'inc/x.h'), '#define VALUE 11\n');
    fs.writeFileSync(path.join(root, 'inc/dir/x.h'), '#define VALUE 99\n');
    const result = analyzeFile(path.join(root, 'main.c'), { includePaths: [path.join(root, 'inc')] });
    assert.equal(result.status, 'ok');
    assert(result.unit.nodes.some((node) => node.constant?.value === '11'), 'Aro candidate must be resolved exactly once');
}));
test('I4-omitted-for-clauses', () => {
    for (const header of [';;', 'int i = 0;;', ';n < 2;', ';;n = n + 1', 'int i = 0;n < 2;', 'int i = 0;;n = n + 1', ';n < 2;n = n + 1', 'int i = 0;n < 2;n = n + 1']) {
        const step = header.endsWith('n = n + 1') ? '' : 'n = n + 1;';
        execute(`int main(void) { int n = 0; for (${header}) { if (n == 2) break; ${step} } return n; }`, 2);
    }
});
test('I5-definition-parameters', () => execute('int add(int prototype); int add(int value) { return value + 3; } int main(void) { return add(4); }', 7));
test('I4-init-only-side-effect', () => execute('int main(void) { int n = 0; for (n = 5;;) break; return n; }', 5));
test('I6-narrow-conversions', () => {
    execute('unsigned char narrow(int value) { return value; } int main(void) { int x = 257; return narrow(x); }', 1);
    execute('int main(void) { unsigned char x; int y = 257; return (x = y); }', 1);
    execute('signed char narrow(int value) { return value; } int main(void) { int x = 255; return narrow(x); }', -1);
});
test('I7-unsigned-operations', () => execute(`int main(void) {
    unsigned int high = 1; high = high << 31;
    unsigned int divisor = 3;
    return (high > 1) + 2 * (high / 2 >> 30 == 1) + 4 * (high % divisor == 2) + 8 * (high >> 31 == 1);
}`, 15));
test('I8-full-width-constants', () => {
    for (const [value, expected] of [['65536', 65536], ['2147483647', 2147483647], ['2147483648u', -2147483648], ['4294967295u', -1]]) execute(`unsigned int main(void) { return ${value}; }`, expected);
});
test('I9-multiple-translation-units', () => executeObjects([
    compileCToObject('static int value = 3; static int helper(void) { return value; } int left(void) { return helper(); }'),
    compileCToObject('static int value = 5; static int helper(void) { return value; } int left(void); int main(void) { return left() + helper(); }'),
], 8));
test('I9-initializer-ownership', () => executeObjects([
    compileCToObject('int left_value = 3; int left(void) { return left_value; }'),
    compileCToObject('int right_value = 5; int left(void); int main(void) { return left() + right_value; }'),
], 8));
test('I9-address-initializer-ownership', () => executeObjects([
    compileCToObject('static int values[2] = { 3, 7 }; static int *pointer = &values[1]; int left(void) { return *pointer; }'),
    compileCToObject('static int value = 5; static int *pointer = &value; int left(void); int main(void) { return left() + *pointer; }'),
], 12));
test('I10-enum-model', () => {
    const unit = analyze('enum E { ZERO, ONE }; enum E value;');
    const enumeration = unit.types.find((type) => type.kind === 'enum');
    assert.equal(unit.types.find((type) => type.id === enumeration.underlyingType).name, 'int');
});
test('I10-enum-contract-model', () => {
    const envelope = JSON.parse(JSON.stringify(analyzeSource('enum E { ZERO, ONE }; enum E value;')));
    const enumeration = envelope.unit.types.find((type) => type.kind === 'enum');
    envelope.unit.types.find((type) => type.id === enumeration.underlyingType).name = 'unsigned int';
    assert.throws(() => validateEnvelope(envelope, envelope.bridgeBuildId), /enum.*int/i);
});
test('I11-typedef-use-qualifiers', () => {
    const unit = analyze('typedef int Number; const Number a = 1; volatile Number b; typedef int *Pointer; Pointer restrict p;');
    for (const [name, qualifier] of [['a', 'const'], ['b', 'volatile'], ['p', 'restrict']]) {
        const symbol = unit.symbols.find((symbol) => symbol.name === name);
        const type = unit.types.find((type) => type.id === symbol.type);
        assert(type.qualifiers.includes(qualifier), `${name} must retain ${qualifier}`);
    }
});
for (const [kind, source] of [
    ['bitfields', 'struct Bits { unsigned int : 0; unsigned int x : 1; }; struct Bits value;'],
    ['trailing-zero-bitfield', 'struct Bits { char c; unsigned int : 0; }; struct Bits value;'],
    ['unnamed-bitfield', 'struct Bits { unsigned int : 2; unsigned int x : 1; }; struct Bits value;'],
    ['packed', 'struct __attribute__((packed)) Packed { char a; int b; }; struct Packed value;'],
]) {
    test(`I12-${kind}-diagnostics`, () => {
        const result = compileCToObjectDetailed(source);
        assert.equal(result.artifact, undefined);
        assert(result.diagnostics.some((item) => item.code === 'C_BACKEND_CAPABILITY' && item.range.start.byteOffset > 0), JSON.stringify(result.diagnostics));
    });
}
test('I13-utf8-macro-ranges', () => {
    const unit = analyze('#define \u03c0 1\nint main(void) { return \u03c0; }');
    const node = unit.nodes.find((node) => node.constant?.value === '1' && node.range.start.line === 2);
    assert(node);
    assert.equal(node.range.end.byteOffset - node.range.start.byteOffset, 2);
});
test('M1-diagnostic-normalization', () => {
    const range = { file: 1, start: { line: 1, column: 1, byteOffset: 0 }, end: { line: 1, column: 1, byteOffset: 0 } };
    const diagnostic = { severity: 'warning', code: 'z', message: 'message', range, related: [], notes: [], includeTrace: [], macroExpansionTrace: [] };
    const reversed = Object.fromEntries(Object.entries(diagnostic).reverse());
    assert.equal(normalizeDiagnostics([diagnostic, reversed]).length, 1);
    assert.deepEqual(normalizeDiagnostics([diagnostic, { ...diagnostic, code: 'Z' }]).map((item) => item.code), ['Z', 'z']);
});
test('M2-deep-lowering-immutability', () => {
    const program = adaptTypedUnit(analyze('int main(void) { int value = 3; return value; }'));
    assert.throws(() => { program.functions[0].body.statements[0].name = 'corrupt'; }, TypeError);
    assert.throws(() => { program.functions[0].parameterNames.push('corrupt'); }, TypeError);
});
test('M3-execSync-guard', async () => {
    await withHostCompilerBlocked(() => assert.throws(() => require('node:child_process').execSync('echo guard-probe'),
        (error) => error.code === 'MERC32_PROCESS_LAUNCH_DENIED'));
});

(async () => {
    let failures = 0;
    for (const { name, action } of cases.filter((item) => !selected || item.name.startsWith(selected))) {
        try { await action(); console.log(`PASS ${name}`); }
        catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
    }
    if (failures) process.exitCode = 1;
})();
