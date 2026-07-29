const assert = require('assert');
const { compileC } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

function expectCompilerError(testSource, pattern) {
    assert.throws(
        () => compileC(testSource, { moduleName: 'irq_negative_test' }),
        pattern,
    );
}

const source = `
int data[4];

int sum(int *p, int n) {
    int i = 0;
    int total = 0;
    while (i < n) {
        total = total + p[i];
        i = i + 1;
    }
    return total;
}

int signed_compare(int a, int b) {
    return a < b;
}

unsigned int unsigned_compare(unsigned int a, unsigned int b) {
    return a >= b;
}

int logical_compare(int a, int b) {
    return !a || (a < b && b != 0);
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)0x008003C0;
    data[0] = 1;
    data[1] = 2;
    data[2] = 3;
    data[3] = 4;
    if (sum(data, 4) == 10) {
        *status = 0x600D;
    } else {
        *status = 0x0BAD;
    }
    return 10;
}
`;

const { assembly } = compileC(source, { moduleName: 'vsce_c_test' });
assert.match(assembly, /\.entry __start/);
assert.match(assembly, /jmp sum, r14/);
assert.match(assembly, /mov r8, r8 << 2/);
assert.doesNotMatch(assembly, /\br3\b/);
assert.match(assembly, /mov r13, 0x84/);
assert.match(assembly, /cmp r\d+, r7 < r8/);
assert.match(assembly, /cmpu r\d+, r7 >= r8/);
assert.match(assembly, /cmp r\d+, r\d+ == 0/);
assert.match(assembly, /\bbz r7, r0 \+ /);
assert.match(assembly, /\bbnz r7, r0 \+ /);
assert.doesNotMatch(assembly, /\bbrcu?\b/);
assert.doesNotMatch(assembly, /cmp_true|cmp_end/);

const assembler = new SimpleCPUAssembler();
const result = assembler.assemble(assembly, { sourceFileName: 'vsce_c_test.asm' });
assert.ok(result.machineCodes.length > 0);

const irqSource = `
volatile unsigned int irq_count = 0;

void __irq_handler(void) {
    irq_count = irq_count + 1;
}

int main(void) {
    __irq_enable();
    while (irq_count == 0) {
    }
    __irq_disable();
    return 0;
}
`;

const { assembly: irqAssembly } = compileC(irqSource, { moduleName: 'irq_compiler_test' });
assert.match(irqAssembly, /\.entry __start/);
const irqVectorMatch = irqAssembly.match(
    /^__irq_vector:[ \t]*\r?\n([\s\S]*?)^__start:[ \t]*\r?$/m,
);
assert.ok(irqVectorMatch);
const irqVectorInstructions = irqVectorMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
assert.deepStrictEqual(irqVectorInstructions, [
    'jmp __irq_handler',
]);
assert.doesNotMatch(irqAssembly, /mov r13, r13 - 28/);

const irqHandlerMatch = irqAssembly.match(
    /^__irq_handler:[ \t]*\r?\n([\s\S]*?)^main:[ \t]*\r?$/m,
);
assert.ok(irqHandlerMatch);
assert.match(irqHandlerMatch[1], /^mov \[r13 \+ 0\], r14$/m);
assert.doesNotMatch(irqHandlerMatch[1], /^mov r1, 1$/m);

const irqHandlerReturnMatch = irqAssembly.match(
    /^____irq_handler_return:[ \t]*\r?\n([\s\S]*?)^main:[ \t]*\r?$/m,
);
assert.ok(irqHandlerReturnMatch);
const irqHandlerReturnInstructions = irqHandlerReturnMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
assert.strictEqual(irqHandlerReturnInstructions.at(-1), 'jmp r3');

const irqStartMatch = irqAssembly.match(
    /^__start:[ \t]*\r?\n([\s\S]*?)^__halt:[ \t]*\r?$/m,
);
assert.ok(irqStartMatch);
const irqStartInstructions = irqStartMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
assert.ok(irqStartInstructions.length >= 2);
assert.match(irqStartInstructions[0], /^mov r13, /);
assert.deepStrictEqual(irqStartInstructions.slice(-2), [
    'mov r2, 4',
    'jmp main, r14',
]);

const irqMainMatch = irqAssembly.match(
    /^main:[ \t]*\r?\n([\s\S]*?)^__main_return:[ \t]*\r?$/m,
);
assert.ok(irqMainMatch);
const irqMainInstructions = irqMainMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
const irqEnableIndex = irqMainInstructions.indexOf('mov r1, 1');
const irqDisableIndex = irqMainInstructions.indexOf('mov r1, 0');
assert.notStrictEqual(irqEnableIndex, -1);
assert.notStrictEqual(irqDisableIndex, -1);
assert.ok(irqEnableIndex < irqDisableIndex);
assert.strictEqual(irqMainInstructions.filter((line) => line === 'mov r1, 1').length, 1);
assert.strictEqual(irqMainInstructions.filter((line) => line === 'mov r1, 0').length, 1);

const irqAssembler = new SimpleCPUAssembler();
const irqResult = irqAssembler.assemble(irqAssembly, { sourceFileName: 'irq_compiler_test.asm' });
assert.ok(irqResult.machineCodes.length > 0);
assert.match(irqResult.debugSymbols, /^__irq_vector[ \t]+=[ \t]+4 \(0x0004\)$/m);

assert.doesNotMatch(assembly, /__irq_vector/);
assert.doesNotMatch(assembly, /^[ \t]*mov r2, 4[ \t]*$/m);

expectCompilerError(`
int __irq_handler(void) {
    return 0;
}

int main(void) {
    return 0;
}
`, /__irq_handler must return void/);

expectCompilerError(`
void __irq_handler(int value) {
}

int main(void) {
    return 0;
}
`, /__irq_handler must not have parameters/);

expectCompilerError(`
void __irq_handler(void);

int main(void) {
    return 0;
}
`, /__irq_handler must have a definition/);

expectCompilerError(`
int main(void) {
    __irq_enable();
    return 0;
}
`, /__irq_enable requires a defined __irq_handler/);

expectCompilerError(`
int main(void) {
    __irq_disable();
    return 0;
}
`, /__irq_disable requires a defined __irq_handler/);

expectCompilerError(`
void __irq_handler(void) {
}

int main(void) {
    __irq_enable(1);
    return 0;
}
`, /__irq_enable expects 0 arguments/);

expectCompilerError(`
void __irq_handler(void) {
}

int main(void) {
    __irq_disable(1);
    return 0;
}
`, /__irq_disable expects 0 arguments/);

console.log('MERC32 VSCE C compiler integration test passed');
