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

const narrowSource = `
char g_char;
unsigned char g_uchar;
short g_short;
unsigned short g_ushort;
int g_int;
char g_char_array[3];
short g_short_array[3];
int g_int_array[3];

int signed_math(int a, int b) {
    return a * b + a / b + a % b;
}

unsigned int unsigned_math(unsigned int a, unsigned int b) {
    return a / b + a % b;
}

int promoted_math(unsigned short a, unsigned short b) {
    return a / b;
}

int read_char(char *p) { return p[1]; }
int read_uchar(unsigned char *p) { return p[1]; }
int read_short(short *p) { return p[1]; }
int read_ushort(unsigned short *p) { return p[1]; }
int read_int(int *p) { return p[1]; }

void write_values(char *pc, unsigned char *puc, short *ps, unsigned short *pus, int *pi) {
    pc[2] = 0x1ff;
    puc[2] = 0x1ff;
    ps[2] = 0x1ffff;
    pus[2] = 0x1ffff;
    pi[2] = 0x12345678;
}

int cast_values(int value) {
    char c = (char)value;
    unsigned char uc = (unsigned char)value;
    short s = (short)value;
    unsigned short us = (unsigned short)value;
    return c + uc + s + us;
}

int layout_test(void) {
    char a = 1;
    short b = 2;
    char c = 3;
    int d = 4;
    return a + b + c + d;
}

int main(void) {
    return 0;
}
`;

const { assembly: narrowAssembly } = compileC(narrowSource, {
    moduleName: 'narrow_type_test',
    dataBase: 0x100,
});

assert.match(narrowAssembly, /\blb r\d+, \[r8\]/);
assert.match(narrowAssembly, /\blbu r\d+, \[r8\]/);
assert.match(narrowAssembly, /\blh r\d+, \[r8\]/);
assert.match(narrowAssembly, /\blhu r\d+, \[r8\]/);
assert.match(narrowAssembly, /\blw r\d+, \[r8\]/);
assert.match(narrowAssembly, /\bsb \[r8\], r\d+/);
assert.match(narrowAssembly, /\bsh \[r8\], r\d+/);
assert.match(narrowAssembly, /\bsw \[r8\], r\d+/);
assert.match(narrowAssembly, /\bmul r\d+, r7, r8/);
assert.match(narrowAssembly, /\bdiv r\d+, r7, r8/);
assert.match(narrowAssembly, /\bdivu r\d+, r7, r8/);
assert.match(narrowAssembly, /\brem r\d+, r7, r8/);
assert.match(narrowAssembly, /\bremu r\d+, r7, r8/);

const promotedBody = narrowAssembly.match(/^promoted_math:\r?\n([\s\S]*?)^__promoted_math_return:/m)?.[1];
assert.ok(promotedBody);
assert.match(promotedBody, /\bdiv r\d+, r7, r8/);
assert.doesNotMatch(promotedBody, /\bdivu\b/);

const charBody = narrowAssembly.match(/^read_char:\r?\n([\s\S]*?)^__read_char_return:/m)?.[1];
const shortBody = narrowAssembly.match(/^read_short:\r?\n([\s\S]*?)^__read_short_return:/m)?.[1];
const intBody = narrowAssembly.match(/^read_int:\r?\n([\s\S]*?)^__read_int_return:/m)?.[1];
assert.ok(charBody && shortBody && intBody);
assert.doesNotMatch(charBody, /mov r8, r8 << [12]/);
assert.match(shortBody, /mov r8, r8 << 1/);
assert.match(intBody, /mov r8, r8 << 2/);

const globalInitExpectations = [
    ['0x100', 'sb'],
    ['0x101', 'sb'],
    ['0x102', 'sh'],
    ['0x104', 'sh'],
    ['0x108', 'sw'],
    ['0x10C', 'sb'],
    ['0x10D', 'sb'],
    ['0x10E', 'sb'],
    ['0x110', 'sh'],
    ['0x112', 'sh'],
    ['0x114', 'sh'],
    ['0x118', 'sw'],
    ['0x11C', 'sw'],
    ['0x120', 'sw'],
];
for (const [address, store] of globalInitExpectations) {
    assert.match(narrowAssembly, new RegExp(`mov r8, ${address}\\r?\\n${store} \\[r8\\], r7`));
}

const layoutBody = narrowAssembly.match(/^layout_test:\r?\n([\s\S]*?)^__layout_test_return:/m)?.[1];
assert.ok(layoutBody);
assert.match(layoutBody, /sb \[r12 \+ 8\], r7/);
assert.match(layoutBody, /sh \[r12 \+ 10\], r7/);
assert.match(layoutBody, /sb \[r12 \+ 12\], r7/);
assert.match(layoutBody, /sw \[r12 \+ 16\], r7/);

const narrowAssembler = new SimpleCPUAssembler();
const narrowResult = narrowAssembler.assemble(narrowAssembly, { sourceFileName: 'narrow_type_test.asm' });
assert.ok(narrowResult.machineCodes.length > 0);

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
