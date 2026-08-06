const assert = require('assert');
const { compileC, CompilerError } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

function expectCompilerError(testSource, pattern, expectedLocation, options = {}) {
    assert.throws(
        () => compileC(testSource, { moduleName: 'irq_negative_test', ...options }),
        (error) => {
            assert.ok(
                error instanceof CompilerError,
                `expected CompilerError, got ${error?.constructor?.name || typeof error}`,
            );
            assert.match(error.message, pattern);
            if (expectedLocation) {
                assert.strictEqual(error.line, expectedLocation.line);
                assert.strictEqual(error.column, expectedLocation.column);
            }
            return true;
        },
    );
}

function expectFunctionImmediate(assembly, functionName, value) {
    const functionBody = assembly.match(
        new RegExp(`^${functionName}:\\r?\\n([\\s\\S]*?)^__${functionName}_return:`, 'm'),
    )?.[1];
    assert.ok(functionBody, `missing assembly body for ${functionName}`);
    const immediate = value > 9 ? `0x${value.toString(16).toUpperCase()}` : String(value);
    assert.match(functionBody, new RegExp(`^mov r4, ${immediate}\\r?$`, 'm'));
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

const characterLiteralSource = String.raw`
int literal_ascii(void) { return 'A'; }
int literal_newline(void) { return '\n'; }
int literal_carriage_return(void) { return '\r'; }
int literal_tab(void) { return '\t'; }
int literal_nul(void) { return '\0'; }
int literal_backslash(void) { return '\\'; }
int literal_quote(void) { return '\''; }
int literal_double_quote(void) { return '\"'; }
int literal_alert(void) { return '\a'; }
int literal_backspace(void) { return '\b'; }
int literal_form_feed(void) { return '\f'; }
int literal_vertical_tab(void) { return '\v'; }
int literal_octal(void) { return '\101'; }
int literal_octal_with_leading_zero(void) { return '\012'; }
int literal_hex(void) { return '\xFF'; }
int main(void) { return 0; }
`;

const { assembly: characterLiteralAssembly } = compileC(characterLiteralSource, {
    moduleName: 'character_literal_test',
});
const characterLiteralExpectations = [
    ['literal_ascii', 0x41],
    ['literal_newline', 0x0a],
    ['literal_carriage_return', 0x0d],
    ['literal_tab', 0x09],
    ['literal_nul', 0x00],
    ['literal_backslash', 0x5c],
    ['literal_quote', 0x27],
    ['literal_double_quote', 0x22],
    ['literal_alert', 0x07],
    ['literal_backspace', 0x08],
    ['literal_form_feed', 0x0c],
    ['literal_vertical_tab', 0x0b],
    ['literal_octal', 0x41],
    ['literal_octal_with_leading_zero', 0x0a],
    ['literal_hex', 0xff],
];
for (const [functionName, value] of characterLiteralExpectations) {
    expectFunctionImmediate(characterLiteralAssembly, functionName, value);
}

const characterLiteralAssembler = new SimpleCPUAssembler();
const characterLiteralResult = characterLiteralAssembler.assemble(characterLiteralAssembly, {
    sourceFileName: 'character_literal_test.asm',
});
assert.ok(characterLiteralResult.machineCodes.length > 0);

expectCompilerError(
    "int main(void) { return ''; }",
    /empty character literal/,
    { line: 1, column: 25 },
);
expectCompilerError("int main(void) { return 'ab'; }", /character literal must contain exactly one byte/);
expectCompilerError("int main(void) { return '\u4E2D'; }", /character literal must contain exactly one byte/);
expectCompilerError(String.raw`int main(void) { return '\400'; }`, /escape value \\400 exceeds one byte/);
expectCompilerError(String.raw`int main(void) { return '\x100'; }`, /escape value 0x100 exceeds one byte/);
expectCompilerError(
    String.raw`int main(void) { return '\q'; }`,
    /unknown escape '\\q'/,
    { line: 1, column: 25 },
);
expectCompilerError("int main(void) { return 'A", /unterminated character literal/);
expectCompilerError(`
int main(void) {
    return 'A
}
`, /unterminated character literal/, { line: 3, column: 12 });

const longCharacterLiteralSource = `int main(void) { return '${'A'.repeat(200000)}'; }`;
expectCompilerError(
    longCharacterLiteralSource,
    /character literal must contain exactly one byte/,
    { line: 1, column: 25 },
);

const stringLiteralSource = String.raw`
char *global_text = "same";

int first(char *text) {
    return text[0];
}

int main(void) {
    char *local_text = "same";
    return first("A" "B中\n") + global_text[0] + local_text[0];
}
`;

const { assembly: stringLiteralAssembly } = compileC(stringLiteralSource, {
    moduleName: 'string_literal_test',
    dataBase: 0x200,
});

const globalStringAddressText = stringLiteralAssembly.match(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nmov r8, 0x200\r?\nsw \[r8\], r7$/m,
)?.[1];
assert.ok(globalStringAddressText, 'missing global string pointer initializer');

const mainBody = stringLiteralAssembly.match(
    /^main:\r?\n([\s\S]*?)^__main_return:/m,
)?.[1];
assert.ok(mainBody, 'missing assembly body for main');
const localStringAddressText = mainBody.match(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nsw \[r12 \+ 8\], r7$/m,
)?.[1];
assert.ok(localStringAddressText, 'missing local string pointer initializer');

const parseImmediate = (text) => Number.parseInt(text, text.startsWith('0x') ? 16 : 10);

const initializerSource = `
char greeting[] = "hello";
unsigned char utf8[8] = "中";
short signed_table[] = {1, -2, 3,};
unsigned short short_table[5] = {4, 5};
int word_table[] = {6, 7, 8};
unsigned int unsigned_table[4] = {9};

int seed(void) { return 10; }

int main(void) {
    char local_text[4] = "ok";
    int local_values[] = {seed(), 20, 30};
    unsigned char local_bytes[3] = {0xA5};
    short local_signed[3] = {-4, 5};
    unsigned short local_unsigned_short[3] = {6};
    unsigned int local_unsigned_int[3] = {7, 8};
    return greeting[1] + utf8[0] + signed_table[1] + short_table[4]
        + word_table[2] + unsigned_table[3] + local_text[2] + local_values[0]
        + local_bytes[0] + local_signed[0] + local_unsigned_short[0]
        + local_unsigned_int[0];
}
`;

const { assembly: initializerAssembly } = compileC(initializerSource, {
    moduleName: 'array_initializer_test',
    dataBase: 0x300,
});
const initializerStartBody = initializerAssembly.match(
    /^__start:\r?\n([\s\S]*?)^__halt:/m,
)?.[1];
assert.ok(initializerStartBody, 'missing array initializer startup body');

const initializerGlobalStores = [...initializerStartBody.matchAll(
    /^mov r8, (0x[0-9A-F]+|\d+)\r?\n(sb|sh|sw) \[r8\], r7$/gm,
)].map((match) => [parseImmediate(match[1]), match[2]]);
assert.deepStrictEqual(initializerGlobalStores, [
    [0x300, 'sb'], [0x301, 'sb'], [0x302, 'sb'], [0x303, 'sb'], [0x304, 'sb'], [0x305, 'sb'],
    [0x306, 'sb'], [0x307, 'sb'], [0x308, 'sb'], [0x309, 'sb'],
    [0x30a, 'sb'], [0x30b, 'sb'], [0x30c, 'sb'], [0x30d, 'sb'],
    [0x30e, 'sh'], [0x310, 'sh'], [0x312, 'sh'],
    [0x314, 'sh'], [0x316, 'sh'], [0x318, 'sh'], [0x31a, 'sh'], [0x31c, 'sh'],
    [0x320, 'sw'], [0x324, 'sw'], [0x328, 'sw'],
    [0x32c, 'sw'], [0x330, 'sw'], [0x334, 'sw'], [0x338, 'sw'],
], 'unexpected global array layout or hidden string-pool allocation');

for (const [address, store, value] of [
    [0x300, 'sb', 0x68], [0x301, 'sb', 0x65], [0x302, 'sb', 0x6c],
    [0x303, 'sb', 0x6c], [0x304, 'sb', 0x6f], [0x305, 'sb', 0],
    [0x306, 'sb', 0xe4], [0x307, 'sb', 0xb8], [0x308, 'sb', 0xad],
    [0x309, 'sb', 0], [0x30a, 'sb', 0], [0x30b, 'sb', 0],
    [0x30c, 'sb', 0], [0x30d, 'sb', 0],
    [0x30e, 'sh', 1], [0x312, 'sh', 3],
    [0x314, 'sh', 4], [0x316, 'sh', 5],
    [0x318, 'sh', 0], [0x31a, 'sh', 0], [0x31c, 'sh', 0],
    [0x320, 'sw', 6], [0x324, 'sw', 7], [0x328, 'sw', 8],
    [0x32c, 'sw', 9], [0x330, 'sw', 0], [0x334, 'sw', 0], [0x338, 'sw', 0],
]) {
    const immediate = value > 9 ? `0x${value.toString(16).toUpperCase()}` : String(value);
    assert.match(
        initializerStartBody,
        new RegExp(`^mov r7, ${immediate}\\r?\\nmov r8, 0x${address.toString(16).toUpperCase()}\\r?\\n${store} \\[r8\\], r7$`, 'm'),
    );
}
assert.match(
    initializerStartBody,
    /^mov r7, 0xFFFF\r?\nmov r7, r7 << 16\r?\nmov r7, r7 \+ 0xFFFE\r?\nmov r8, 0x310\r?\nsh \[r8\], r7$/m,
);

const initializerMainBody = initializerAssembly.match(
    /^main:\r?\n([\s\S]*?)^__main_return:/m,
)?.[1];
assert.ok(initializerMainBody, 'missing array initializer main body');
assert.match(initializerMainBody, /^mov r7, 0x6F\r?\nsb \[r12 \+ 8\], r7$/m);
assert.match(initializerMainBody, /^mov r7, 0x6B\r?\nsb \[r12 \+ 9\], r7$/m);
assert.match(initializerMainBody, /^mov r7, 0\r?\nsb \[r12 \+ 10\], r7$/m);
assert.match(initializerMainBody, /^mov r7, 0\r?\nsb \[r12 \+ 11\], r7$/m);
assert.strictEqual(
    [...initializerMainBody.matchAll(/^jmp seed, r14$/gm)].length,
    1,
    'local initializer expression must be evaluated exactly once',
);
assert.match(
    initializerMainBody,
    /^jmp seed, r14\r?\nmov r7, r4\r?\nsw \[r12 \+ 12\], r7\r?\nmov r7, 0x14\r?\nsw \[r12 \+ 16\], r7\r?\nmov r7, 0x1E\r?\nsw \[r12 \+ 20\], r7$/m,
);
assert.match(
    initializerMainBody,
    /^mov r7, 0xA5\r?\nmov r7, r7 & 0xFF\r?\nsb \[r12 \+ 24\], r7\r?\nmov r7, 0\r?\nsb \[r12 \+ 25\], r7\r?\nmov r7, 0\r?\nsb \[r12 \+ 26\], r7$/m,
);
assert.match(
    initializerMainBody,
    /^mov r7, 4\r?\nmov r7, r0 - r7\r?\nmov r7, r7 << 16\r?\nmov r7, r7 >>> 16\r?\nsh \[r12 \+ 28\], r7$/m,
);
assert.match(
    initializerMainBody,
    /^mov r7, 5\r?\nmov r7, r7 << 16\r?\nmov r7, r7 >>> 16\r?\nsh \[r12 \+ 30\], r7\r?\nmov r7, 0\r?\nsh \[r12 \+ 32\], r7$/m,
);
assert.match(
    initializerMainBody,
    /^mov r7, 6\r?\nmov r7, r7 & 0xFFFF\r?\nsh \[r12 \+ 34\], r7\r?\nmov r7, 0\r?\nsh \[r12 \+ 36\], r7\r?\nmov r7, 0\r?\nsh \[r12 \+ 38\], r7$/m,
);
assert.match(
    initializerMainBody,
    /^mov r7, 7\r?\nsw \[r12 \+ 40\], r7\r?\nmov r7, 8\r?\nsw \[r12 \+ 44\], r7\r?\nmov r7, 0\r?\nsw \[r12 \+ 48\], r7$/m,
);

const initializerAssembler = new SimpleCPUAssembler();
const initializerResult = initializerAssembler.assemble(initializerAssembly, {
    sourceFileName: 'array_initializer_test.asm',
});
assert.ok(initializerResult.machineCodes.length > 0);

const { assembly: largeLocalInitializerAssembly } = compileC(`
int main(void) {
    char bytes[4096] = {1};
    short halves[4096] = {2};
    int words[4096] = {3};
    return bytes[0] + bytes[4095] + halves[0] + halves[4095]
        + words[0] + words[4095];
}
`, {
    moduleName: 'large_local_array_initializer_test',
});
const largeLocalInitializerResult = new SimpleCPUAssembler().assemble(
    largeLocalInitializerAssembly,
    { sourceFileName: 'large_local_array_initializer_test.asm' },
);
assert.ok(largeLocalInitializerResult.machineCodes.length > 0);
assert.ok(
    largeLocalInitializerAssembly.split(/\r?\n/).length < 300,
    'large local array initialization must have near-constant assembly size',
);
const largeLocalInitializerMainBody = largeLocalInitializerAssembly.match(
    /^main:\r?\n([\s\S]*?)^__main_return:/m,
)?.[1];
assert.ok(largeLocalInitializerMainBody, 'missing large local array initializer main body');
for (const [offset, store, stride] of [
    ['9', 'sb', 1],
    ['0x100A', 'sh', 2],
    ['0x300C', 'sw', 4],
]) {
    assert.match(
        largeLocalInitializerMainBody,
        new RegExp(
            `^mov r8, ${offset}\\r?\\n` +
            'mov r8, r12 \\+ r8\\r?\\n' +
            'mov r7, 0xFFF\\r?\\n' +
            '(__main_array_zero_\\d+):\\r?\\n' +
            `${store} \\[r8\\], r0\\r?\\n` +
            `mov r8, r8 \\+ ${stride}\\r?\\n` +
            'mov r7, r7 - 1\\r?\\n' +
            'bnz r7, r0 \\+ \\1$',
            'm',
        ),
    );
}

const { assembly: internalLabelAssembly } = compileC(`
int main(void) {
    array_zero_0: ;
    array_zero_0_internal_0: ;
    array_zero_0_internal_1: ;
    char a[5] = {1};
    goto done;
    done: return a[0];
}
`, {
    moduleName: 'internal_label_collision_test',
});
assert.match(internalLabelAssembly, /^jmp __main_done$/m);
assert.match(internalLabelAssembly, /^__main_done:$/m);
const emittedLabelNames = [...internalLabelAssembly.matchAll(/^([A-Za-z_][A-Za-z0-9_]*):$/gm)]
    .map((match) => match[1]);
assert.strictEqual(
    new Set(emittedLabelNames).size,
    emittedLabelNames.length,
    'compiler-internal labels must not collide with user labels',
);
assert.ok(new SimpleCPUAssembler().assemble(internalLabelAssembly, {
    sourceFileName: 'internal_label_collision_test.asm',
}).machineCodes.length > 0);

const collectorInitializerSource = `
int sum5(int a, int b, int c, int d, int e) { return a + b + c + d + e; }
int main(void) {
    int values[] = {sum5(1, 2, 3, 4, 5)};
    return values[0];
}
`;
const { assembly: collectorInitializerAssembly } = compileC(collectorInitializerSource, {
    moduleName: 'array_initializer_collector_test',
});
assert.match(collectorInitializerAssembly, /^jmp sum5, r14$/m);
assert.ok(new SimpleCPUAssembler().assemble(collectorInitializerAssembly, {
    sourceFileName: 'array_initializer_collector_test.asm',
}).machineCodes.length > 0);

const { assembly: initializerStringPoolAssembly } = compileC(`
char copied[] = "same";
char *copied_pointer = "same";
int main(void) { return copied[0] + copied_pointer[0]; }
`, {
    moduleName: 'array_initializer_string_pool_test',
    dataBase: 0x400,
});
assert.match(
    initializerStringPoolAssembly,
    /^mov r7, 0x40C\r?\nmov r8, 0x408\r?\nsw \[r8\], r7$/m,
    'a string expression must still allocate a pooled copy',
);
assert.match(
    initializerStringPoolAssembly,
    /^mov r7, 0x73\r?\nmov r8, 0x40C\r?\nsb \[r8\], r7$/m,
);

for (const [testSource, pattern, expectedLocation, options] of [
    ['int a[]; int main(void) { return 0; }', /incomplete array requires an initializer/, { line: 1, column: 8 }],
    ['int a[] = {}; int main(void) { return 0; }', /cannot infer.*empty initializer/, { line: 1, column: 11 }],
    ['int a[2] = {1, 2, 3}; int main(void) { return 0; }', /too many array initializer elements/, { line: 1, column: 12 }],
    ['int a[2] = "x"; int main(void) { return 0; }', /string initializer requires a character array/, { line: 1, column: 12 }],
    ['char a[2] = "hi"; int main(void) { return 0; }', /string initializer.*does not fit/, { line: 1, column: 13 }],
    ['int a[2] = {{1}, {2}}; int main(void) { return 0; }', /nested initializers are not supported/, { line: 1, column: 13 }],
    ['int scalar = {1}; int main(void) { return scalar; }', /initializer list requires an array/, { line: 1, column: 14 }],
    ['char scalar = "x"; int main(void) { return scalar; }', /string initializer requires an array or pointer/, { line: 1, column: 15 }],
    ['int a[2] = 1; int main(void) { return 0; }', /array initializer must be a list or string literal/, { line: 1, column: 13 }],
    ['int main(void) { int local[]; return 0; }', /incomplete array requires an initializer/, { line: 1, column: 29 }],
    ['int a[] = {"x"}; int main(void) { return 0; }', /array initializer element cannot have pointer type/, { line: 1, column: 11 }],
    ['int main(void) { int a[] = {"x"}; return 0; }', /array initializer element cannot have pointer type/, { line: 1, column: 28 }],
    ['int a[] = {"ABCDE"}; int main(void) { return 0; }', /array initializer element cannot have pointer type/, { line: 1, column: 11 }, { dataBase: 0x200, dlbAddrWidth: 0 }],
    ['int main(void) { int a[] = {"ABCDE"}; return 0; }', /array initializer element cannot have pointer type/, { line: 1, column: 28 }, { dataBase: 0x200, dlbAddrWidth: 0 }],
    ['void noop(void) {}\nint a[] = {noop()};\nint main(void) { return 0; }', /array initializer element cannot have void type/, { line: 2, column: 11 }],
    ['void noop(void) {}\nint main(void) { int a[] = {noop()}; return 0; }', /array initializer element cannot have void type/, { line: 2, column: 28 }],
    ['void __irq_handler(void) {}\nint main(void) { int a[] = {__irq_enable()}; return 0; }', /array initializer element cannot have void type/, { line: 2, column: 28 }],
    ['int a[] = {(int *)0}; int main(void) { return 0; }', /array initializer element cannot have pointer type/, { line: 1, column: 11 }],
    ['int main(void) { int a[] = {(int *)0}; return 0; }', /array initializer element cannot have pointer type/, { line: 1, column: 28 }],
    ['int *a[1] = {0}; int main(void) { return 0; }', /arrays of pointers are not supported/, { line: 1, column: 8 }],
]) {
    expectCompilerError(testSource, pattern, expectedLocation, options);
}

const sameStringAddress = parseImmediate(globalStringAddressText);
assert.strictEqual(
    parseImmediate(localStringAddressText),
    sameStringAddress,
    'identical string literals must share one static address',
);

const stagedArgumentAddresses = [...mainBody.matchAll(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nmov \[r12 \+ \d+\], r7$/gm,
)].map((match) => parseImmediate(match[1]));
assert.strictEqual(stagedArgumentAddresses.length, 1, 'expected one staged string argument');
const concatenatedStringAddress = stagedArgumentAddresses[0];
assert.notStrictEqual(concatenatedStringAddress, sameStringAddress);

const startBody = stringLiteralAssembly.match(
    /^__start:\r?\n([\s\S]*?)^__halt:/m,
)?.[1];
assert.ok(startBody, 'missing startup assembly body');
const staticBytes = new Map();
for (const match of startBody.matchAll(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nmov r8, (0x[0-9A-F]+|\d+)\r?\nsb \[r8\], r7$/gm,
)) {
    staticBytes.set(parseImmediate(match[2]), parseImmediate(match[1]));
}

assert.deepStrictEqual(
    Array.from({ length: 5 }, (_, offset) => staticBytes.get(sameStringAddress + offset)),
    [0x73, 0x61, 0x6d, 0x65, 0x00],
);
assert.deepStrictEqual(
    Array.from({ length: 7 }, (_, offset) => staticBytes.get(concatenatedStringAddress + offset)),
    [0x41, 0x42, 0xe4, 0xb8, 0xad, 0x0a, 0x00],
);

const largeStringByteLength = 150000;
const { assembly: largeStringAssembly } = compileC(`
char *large_text = "${'A'.repeat(largeStringByteLength)}";
int main(void) { return large_text[0]; }
`, {
    moduleName: 'large_string_literal_test',
    dataBase: 0x200,
});
assert.match(
    largeStringAssembly,
    /^mov r7, 0x204\r?\nmov r8, 0x200\r?\nsw \[r8\], r7$/m,
);
assert.match(
    largeStringAssembly,
    /^mov r7, 0x41\r?\nmov r8, 0x204\r?\nsb \[r8\], r7$/m,
);
const largeStringTerminatorAddress = 0x204 + largeStringByteLength;
const largeStringTerminatorHigh = largeStringTerminatorAddress >>> 16;
const largeStringTerminatorLow = largeStringTerminatorAddress & 0xffff;
assert.match(
    largeStringAssembly,
    new RegExp(
        `^mov r7, 0\\r?\\nmov r8, ${largeStringTerminatorHigh}\\r?\\n` +
            `mov r8, r8 << 16\\r?\\nmov r8, r8 \\+ 0x${largeStringTerminatorLow.toString(16).toUpperCase()}\\r?\\n` +
            'sb \\[r8\\], r7$',
        'm',
    ),
);

const stringLiteralAssembler = new SimpleCPUAssembler();
const stringLiteralResult = stringLiteralAssembler.assemble(stringLiteralAssembly, {
    sourceFileName: 'string_literal_test.asm',
});
assert.ok(stringLiteralResult.machineCodes.length > 0);

const pointerConstantSource = `
short *short_base = (short *)"abcd";
short *short_plus = (short *)"abcd" + 1;
short *short_commuted = 2 + (short *)"abcd";
short *short_minus = (short *)"abcd" - 1;
int *int_base = (int *)"wxyz";
int *int_plus = (int *)"wxyz" + 1;
int *int_minus = (int *)"wxyz" - 1;
int int_distance = ((int *)"wxyz" + 3) - ((int *)"wxyz" + 1);
int main(void) { return 0; }
`;
const { assembly: pointerConstantAssembly } = compileC(pointerConstantSource, {
    moduleName: 'pointer_string_constant_test',
    dataBase: 0x200,
});
const pointerConstantInitializers = new Map();
for (const match of pointerConstantAssembly.matchAll(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nmov r8, (0x[0-9A-F]+|\d+)\r?\nsw \[r8\], r7$/gm,
)) {
    pointerConstantInitializers.set(parseImmediate(match[2]), parseImmediate(match[1]));
}
const shortStringBase = pointerConstantInitializers.get(0x200);
const intStringBase = pointerConstantInitializers.get(0x210);
assert.strictEqual(typeof shortStringBase, 'number');
assert.strictEqual(typeof intStringBase, 'number');
assert.strictEqual(pointerConstantInitializers.get(0x204), shortStringBase + 2);
assert.strictEqual(pointerConstantInitializers.get(0x208), shortStringBase + 4);
assert.strictEqual(pointerConstantInitializers.get(0x20c), shortStringBase - 2);
assert.strictEqual(pointerConstantInitializers.get(0x214), intStringBase + 4);
assert.strictEqual(pointerConstantInitializers.get(0x218), intStringBase - 4);
assert.strictEqual(pointerConstantInitializers.get(0x21c), 2);

expectCompilerError(
    'char *bad = "left" + "right"; int main(void) { return 0; }',
    /operator '\+' cannot add two pointers/,
);
expectCompilerError(
    'int bad = (int *)"same" - (short *)"same"; int main(void) { return 0; }',
    /cannot subtract pointers to differently sized types/,
);
for (const [expression, pattern] of [
    ['"value" * 2', /operator '\*' does not accept pointer operands/],
    ['2 / "value"', /operator '\/' does not accept pointer operands/],
    ['"value" % 2', /operator '%' does not accept pointer operands/],
]) {
    expectCompilerError(
        `int bad = ${expression}; int main(void) { return 0; }`,
        pattern,
    );
}

const updateOperatorSource = `
int *identity(int *pointer) {
    return pointer;
}

int single_index_update(int *data) {
    int i = 0;
    int old = data[i++]++;
    return old + i + data[0];
}

int called_address_postfix(int *data) {
    return (*identity(data))++;
}

int called_address_prefix(int *data) {
    return ++*identity(data);
}

int postfix_value(int value) {
    return value++;
}

int prefix_value(int value) {
    return ++value;
}

int update_values(int value) {
    int post_increment = value++;
    int pre_increment = ++value;
    int post_decrement = value--;
    int pre_decrement = --value;
    return post_increment + pre_increment + post_decrement + pre_decrement;
}

int pointer_updates(char *bytes, short *halves, int *words) {
    bytes++;
    bytes -= 1;
    halves += 2;
    --halves;
    words++;
    words -= 1;
    return *bytes + *halves + *words;
}

int main(void) {
    int data[4] = {1, 2, 3, 4};
    int i = 0;
    int old = data[i++]++;
    int now = ++data[i];
    int *pointer = data;
    int dereference_old = (*pointer)++;
    int dereference_new = ++*pointer;
    pointer += 2;
    pointer -= 1;
    pointer++;
    --pointer;

    data[0] += 2;
    data[0] -= 1;
    data[0] *= 3;
    data[0] /= 2;
    data[0] %= 5;
    data[0] &= 7;
    data[0] |= 8;
    data[0] ^= 3;
    data[0] <<= 1;
    data[0] >>= 1;

    char narrow_char = 127;
    unsigned char narrow_uchar = 255;
    short narrow_short = 32767;
    unsigned short narrow_ushort = 65535;
    unsigned int unsigned_value = 0xFFFFFFFF;
    narrow_char += 2;
    narrow_char--;
    ++narrow_uchar;
    narrow_uchar /= 3;
    narrow_short *= 3;
    --narrow_short;
    narrow_ushort <<= 1;
    narrow_ushort |= 1;
    unsigned_value /= 3;
    unsigned_value %= 17;
    unsigned_value >>= 1;

    return old + now + i + dereference_old + dereference_new + *pointer
        + narrow_char + narrow_uchar + narrow_short + narrow_ushort + unsigned_value
        + (data[0] <= data[1] && data[1] >= 0)
        + (data[0] == data[0] || data[0] != 0)
        + ((data[0] << 1) >> 1);
}
`;

const { assembly: updateOperatorAssembly } = compileC(updateOperatorSource, {
    moduleName: 'update_operator_test',
});
for (const instruction of [
    /\bmul r\d+, r7, r8/,
    /\bdiv r\d+, r7, r8/,
    /\bdivu r\d+, r7, r8/,
    /\brem r\d+, r7, r8/,
    /\bremu r\d+, r7, r8/,
    /mov r\d+, r7 & r8/,
    /mov r\d+, r7 \| r8/,
    /mov r\d+, r7 \^ r8/,
    /mov r\d+, r7 << r8/,
    /mov r\d+, r7 >>> r8/,
    /mov r\d+, r7 >> r8/,
]) {
    assert.match(updateOperatorAssembly, instruction);
}

const pointerUpdateBody = updateOperatorAssembly.match(
    /^pointer_updates:\r?\n([\s\S]*?)^__pointer_updates_return:/m,
)?.[1];
assert.ok(pointerUpdateBody, 'missing pointer_updates assembly body');
assert.match(pointerUpdateBody, /mov r8, r8 << 1/);
assert.match(pointerUpdateBody, /mov r8, r8 << 2/);

const updateMainBody = updateOperatorAssembly.match(
    /^main:\r?\n([\s\S]*?)^__main_return:/m,
)?.[1];
assert.ok(updateMainBody, 'missing update-operator main assembly body');
assert.match(updateMainBody, /mov r7, r7 << 24\r?\nmov r7, r7 >>> 24/);
assert.match(updateMainBody, /mov r7, r7 & 0xFF/);
assert.match(updateMainBody, /mov r7, r7 << 16\r?\nmov r7, r7 >>> 16/);
assert.match(updateMainBody, /mov r7, r7 & 0xFFFF/);

const singleIndexBody = updateOperatorAssembly.match(
    /^single_index_update:\r?\n([\s\S]*?)^__single_index_update_return:/m,
)?.[1];
assert.ok(singleIndexBody, 'missing single_index_update assembly body');
assert.strictEqual(
    (singleIndexBody.match(/^sw \[r12 \+ 12\], r\d+$/gm) || []).length,
    1,
    'index variable must be initialized once',
);
assert.strictEqual(
    (singleIndexBody.match(/^mov r8, r12 \+ 12$/gm) || []).length,
    1,
    'index update lvalue address must be evaluated once',
);

for (const functionName of ['called_address_postfix', 'called_address_prefix']) {
    const functionBody = updateOperatorAssembly.match(
        new RegExp(`^${functionName}:\\r?\\n([\\s\\S]*?)^__${functionName}_return:`, 'm'),
    )?.[1];
    assert.ok(functionBody, `missing ${functionName} assembly body`);
    assert.strictEqual(
        (functionBody.match(/^jmp identity, r14$/gm) || []).length,
        1,
        `${functionName} must evaluate its pointer-producing call once`,
    );
}

const postfixValueBody = updateOperatorAssembly.match(
    /^postfix_value:\r?\n([\s\S]*?)^__postfix_value_return:/m,
)?.[1];
const prefixValueBody = updateOperatorAssembly.match(
    /^prefix_value:\r?\n([\s\S]*?)^__prefix_value_return:/m,
)?.[1];
assert.ok(postfixValueBody && prefixValueBody, 'missing prefix/postfix result assembly bodies');
assert.match(postfixValueBody, /sw \[r8\], r7\r?\nmov r4, \[r12 \+ \d+\]/);
assert.match(prefixValueBody, /sw \[r8\], r7\r?\nmov r4, r7/);

const updateAssemblerResult = new SimpleCPUAssembler().assemble(updateOperatorAssembly, {
    sourceFileName: 'update_operator_test.asm',
});
assert.ok(updateAssemblerResult.machineCodes.length > 0);

const conditionalExpressionSource = `
int global_choice = 1 ? 41 : 99;
char *global_text = 0 ? "LEFT" : "RIGHT";
int global_short_circuit = 1 ? 7 : 1 / 0;

void __irq_handler(void) {
}

int pass(int value) {
    return value;
}

int take_five(int a, int b, int c, int d, int e) {
    return a + b + c + d + e;
}

int choose(int condition, int *counter) {
    return condition ? ++*counter : --*counter;
}

int right_associative(void) {
    return 0 ? 1 : 1 ? 2 : 3;
}

int expression_containers(int condition) {
    int values[3] = {condition ? 4 : 5, 0 ? 6 : 7, 1 ? 8 : 9};
    int assigned = 0;
    assigned = condition ? values[0] : values[1];
    return pass(condition ? assigned : values[2]);
}

int calls_in_branches(int condition) {
    return condition
        ? pass(1)
        : take_five(6, 7, 8, 9, 10);
}

unsigned int unsigned_common(
    int condition,
    int signed_value,
    unsigned int unsigned_value
) {
    return (condition ? signed_value : unsigned_value) / 2;
}

int pointer_or_null(int condition, int *pointer) {
    return *(condition ? pointer : (1 - 1));
}

int null_or_pointer(int condition, int *pointer) {
    return *(condition ? 0 : pointer);
}

int unselected_null_error(int condition, int *pointer) {
    return *(condition ? pointer : (0 ? 1 / 0 : 0));
}

char *choose_text(int condition) {
    return condition ? "TRUE" : "FALSE";
}

void choose_void(int condition) {
    condition ? __irq_enable() : __irq_disable();
}

void void_true(void) {
}

void void_false(void) {
}

void choose_user_void(int condition) {
    condition ? void_true() : void_false();
}

int main(void) {
    int counter = 10;
    int a = choose(1, &counter);
    int b = choose(0, &counter);
    choose_void(1);
    choose_user_void(0);
    return a + b + right_associative() + expression_containers(1)
        + calls_in_branches(0) + pointer_or_null(1, &counter)
        + null_or_pointer(0, &counter) + unselected_null_error(1, &counter)
        + choose_text(0)[0] + global_choice + global_text[0]
        + global_short_circuit + counter;
}
`;

const { assembly: conditionalExpressionAssembly } = compileC(conditionalExpressionSource, {
    moduleName: 'conditional_expression_test',
    dataBase: 0x400,
});

const chooseConditionalBody = conditionalExpressionAssembly.match(
    /^choose:\r?\n([\s\S]*?)^__choose_return:/m,
)?.[1];
assert.ok(chooseConditionalBody, 'missing choose conditional assembly body');
const chooseTrueLabel = chooseConditionalBody.match(
    /^(__choose_conditional_true_\d+):$/m,
)?.[1];
const chooseFalseLabel = chooseConditionalBody.match(
    /^(__choose_conditional_false_\d+):$/m,
)?.[1];
const chooseEndLabel = chooseConditionalBody.match(
    /^(__choose_conditional_end_\d+):$/m,
)?.[1];
assert.ok(chooseTrueLabel && chooseFalseLabel && chooseEndLabel, 'conditional must have true/false/end labels');
assert.strictEqual(new Set([chooseTrueLabel, chooseFalseLabel, chooseEndLabel]).size, 3);

const chooseBranchIndex = chooseConditionalBody.indexOf(`bz r7, r0 + ${chooseFalseLabel}`);
const chooseTrueIndex = chooseConditionalBody.indexOf(`${chooseTrueLabel}:`);
const chooseFalseIndex = chooseConditionalBody.indexOf(`${chooseFalseLabel}:`);
const chooseEndIndex = chooseConditionalBody.indexOf(`${chooseEndLabel}:`);
const chooseSideEffectIndexes = [...chooseConditionalBody.matchAll(/^sw \[r8\], r7$/gm)]
    .map((match) => match.index);
assert.strictEqual(chooseSideEffectIndexes.length, 2, 'both conditional branches must contain one update');
assert.ok(chooseBranchIndex >= 0 && chooseBranchIndex < chooseTrueIndex);
assert.ok(chooseTrueIndex < chooseSideEffectIndexes[0]);
assert.ok(chooseSideEffectIndexes[0] < chooseFalseIndex);
assert.ok(chooseFalseIndex < chooseSideEffectIndexes[1]);
assert.ok(chooseSideEffectIndexes[1] < chooseEndIndex);
assert.ok(
    chooseConditionalBody.indexOf(`jmp ${chooseEndLabel}`, chooseSideEffectIndexes[0]) < chooseFalseIndex,
    'true branch must jump over the false branch',
);

const rightAssociativeBody = conditionalExpressionAssembly.match(
    /^right_associative:\r?\n([\s\S]*?)^__right_associative_return:/m,
)?.[1];
assert.ok(rightAssociativeBody, 'missing right-associative conditional assembly body');
const rightAssociativeBranches = [...rightAssociativeBody.matchAll(
    /^bz r7, r0 \+ (__right_associative_conditional_false_(\d+))$/gm,
)];
assert.strictEqual(rightAssociativeBranches.length, 2);
assert.ok(
    Number(rightAssociativeBranches[0][2]) < Number(rightAssociativeBranches[1][2]),
    'false operand must contain the nested conditional for right associativity',
);
assert.ok(
    rightAssociativeBody.indexOf(`${rightAssociativeBranches[0][1]}:`)
        < rightAssociativeBranches[1].index,
    'nested conditional must be emitted inside the outer false branch',
);

const unsignedCommonBody = conditionalExpressionAssembly.match(
    /^unsigned_common:\r?\n([\s\S]*?)^__unsigned_common_return:/m,
)?.[1];
assert.ok(unsignedCommonBody, 'missing unsigned conditional common-type assembly body');
assert.match(unsignedCommonBody, /\bdivu r\d+, r7, r8/);
assert.doesNotMatch(unsignedCommonBody, /\bdiv r\d+, r7, r8/);

const chooseUserVoidBody = conditionalExpressionAssembly.match(
    /^choose_user_void:\r?\n([\s\S]*?)^__choose_user_void_return:/m,
)?.[1];
assert.ok(chooseUserVoidBody, 'missing user void-call conditional assembly body');
assert.match(chooseUserVoidBody, /^jmp void_true, r14$/m);
assert.match(chooseUserVoidBody, /^jmp void_false, r14$/m);
assert.doesNotMatch(chooseUserVoidBody, /^mov r7, r4$/m);

const conditionalStaticBytes = new Map();
for (const match of conditionalExpressionAssembly.matchAll(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nmov r8, (0x[0-9A-F]+|\d+)\r?\nsb \[r8\], r7$/gm,
)) {
    conditionalStaticBytes.set(parseImmediate(match[2]), parseImmediate(match[1]));
}
const hasStaticBytes = (bytes) => [...conditionalStaticBytes.keys()].some(
    (address) => bytes.every((byte, offset) => conditionalStaticBytes.get(address + offset) === byte),
);
assert.ok(hasStaticBytes([0x4c, 0x45, 0x46, 0x54, 0]), 'true global string branch must be pooled');
assert.ok(hasStaticBytes([0x52, 0x49, 0x47, 0x48, 0x54, 0]), 'false global string branch must be pooled');
assert.ok(hasStaticBytes([0x54, 0x52, 0x55, 0x45, 0]), 'true local string branch must be pooled');
assert.ok(hasStaticBytes([0x46, 0x41, 0x4c, 0x53, 0x45, 0]), 'false local string branch must be pooled');

assert.match(conditionalExpressionAssembly, /^mov r7, 0x29\r?\nmov r8, 0x400\r?\nsw \[r8\], r7$/m);
const conditionalAssemblerResult = new SimpleCPUAssembler().assemble(conditionalExpressionAssembly, {
    sourceFileName: 'conditional_expression_test.asm',
});
assert.ok(conditionalAssemblerResult.machineCodes.length > 0);

for (const [testSource, pattern] of [
    [
        'int g = 1 ? 7 : missing(); int main(void) { return g; }',
        /global initializer must be a constant expression/,
    ],
    [
        'int values[1] = {1 ? 7 : missing()}; int main(void) { return values[0]; }',
        /global initializer must be a constant expression/,
    ],
    [
        'int data[1]; int g = 1 ? 7 : data * data; int main(void) { return g; }',
        /operator '\*' does not accept pointer operands/,
    ],
    ['int main(void) { return 1 ? 2; }', /expected ':'/],
    [
        'int main(void) { int ints[1]; short shorts[1]; return 1 ? ints : shorts; }',
        /conditional expression has incompatible pointer branch types/,
    ],
    [
        'int main(void) { int values[1]; int *pointer = values; return 1 ? pointer : 2; }',
        /conditional expression cannot combine a pointer with a nonzero integer/,
    ],
    [
        'int main(void) { int values[1]; int *pointer = values; return 2 ? 3 : pointer; }',
        /conditional expression cannot combine a pointer with a nonzero integer/,
    ],
    [
        'int global_variable; int main(void) { int values[1]; int *pointer = values; return *(1 ? pointer : (1 ? 0 : global_variable)); }',
        /conditional expression cannot combine a pointer with a nonzero integer/,
    ],
    [
        'int main(void) { int values[1]; int *pointer = values; return *(1 ? pointer : ("A" - "A")); }',
        /conditional expression cannot combine a pointer with a nonzero integer/,
    ],
    [
        'int main(void) { int values[1]; int *pointer = values; return *(1 ? pointer : (1 ? 1 / 0 : 0)); }',
        /division by zero/,
    ],
    [
        'void __irq_handler(void) {} int main(void) { return 1 ? __irq_enable() : 2; }',
        /conditional expression branches must both have void type or both produce values/,
    ],
    [
        'void __irq_handler(void) {} int main(void) { return __irq_enable() ? 1 : 2; }',
        /conditional expression condition must have scalar type/,
    ],
    [
        'void __irq_handler(void) {} int main(void) { int condition = 1; int value = condition ? __irq_enable() : __irq_disable(); return value; }',
        /void conditional expression cannot be used where a value is required/,
    ],
    [
        'void __irq_handler(void) {} int main(void) { int condition = 1; return condition ? __irq_enable() : __irq_disable(); }',
        /void conditional expression cannot be used where a value is required/,
    ],
    [
        'void __irq_handler(void) {} int main(void) { int condition = 1; int value = 0; value = condition ? __irq_enable() : __irq_disable(); return value; }',
        /void conditional expression cannot be used where a value is required/,
    ],
    [
        'void __irq_handler(void) {} int take(int value) { return value; } int main(void) { int condition = 1; return take(condition ? __irq_enable() : __irq_disable()); }',
        /void conditional expression cannot be used where a value is required/,
    ],
    [
        'void __irq_handler(void) {} int main(void) { int condition = 1; return (condition ? __irq_enable() : __irq_disable()) + 1; }',
        /void conditional expression cannot be used where a value is required/,
    ],
]) {
    expectCompilerError(testSource, pattern);
}

for (const [testSource, pattern] of [
    ['int main(void) { return 1++; }', /operand of '\+\+' must be a modifiable lvalue/],
    ['int main(void) { int data[2]; data++; return 0; }', /array object cannot be updated/],
    ['int main(void) { int value = 1; (value + 1) += 2; return value; }', /left side of compound assignment must be a modifiable lvalue/],
    ...['*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].map((operator) => [
        `int main(void) { int data[2]; int *pointer = data; pointer ${operator} 2; return 0; }`,
        /is not valid for a pointer target/,
    ]),
    ['int main(void) { int data[2]; int *left = data; int *right = data; left += right; return 0; }', /pointer compound assignment requires an integer right operand/],
    ['int main(void) { int data[2]; int *left = data; short *right = (short *)data; left -= right; return 0; }', /pointer compound assignment requires an integer right operand/],
    ['int seed; int bad = (seed += 1); int main(void) { return 0; }', /global initializer must be a constant expression/],
    ['int seed; int bad = seed++; int main(void) { return 0; }', /global initializer must be a constant expression/],
]) {
    expectCompilerError(testSource, pattern);
}

expectCompilerError(
    'int main(void) { return "unterminated; }',
    /unterminated string literal/,
    { line: 1, column: 25 },
);

compileC('char *text = "ABC"; int main(void) { return text[0]; }', {
    moduleName: 'dlb_exact_fit_string_test',
    dataBase: 0x200,
    dlbAddrWidth: 1,
});
assert.throws(
    () => compileC('char *text = "ABCD"; int main(void) { return text[0]; }', {
        moduleName: 'dlb_overflow_string_test',
        dataBase: 0x200,
        dlbAddrWidth: 1,
    }),
    (error) => {
        assert.ok(error instanceof CompilerError);
        assert.match(error.message, /static data exceeds DLB address space/);
        return true;
    },
);

const compilerOptionErrorCases = [
    [{ dataBase: -1 }, /dataBase must be between 0 and 0xFFFFFFFF/],
    [{ dataBase: Number.NaN }, /dataBase must be a finite safe integer/],
    [{ dataBase: 1.5 }, /dataBase must be a finite safe integer/],
    [{ dataBase: 0x1_0000_0000 }, /dataBase must be between 0 and 0xFFFFFFFF/],
    [{ dlbAddrWidth: -1 }, /dlbAddrWidth must be a non-negative safe integer/],
    [{ dlbAddrWidth: Number.NaN }, /dlbAddrWidth must be a non-negative safe integer/],
    [{ dlbAddrWidth: 1.5 }, /dlbAddrWidth must be a non-negative safe integer/],
];
for (const [options, pattern] of compilerOptionErrorCases) {
    assert.throws(
        () => compileC('int main(void) { return 0; }', options),
        (error) => {
            assert.ok(error instanceof CompilerError);
            assert.match(error.message, pattern);
            return true;
        },
    );
}

const { assembly: finalAddressAssembly } = compileC(
    'int main(void) { return "ABC"[0]; }',
    {
        moduleName: 'final_dlb_addresses_test',
        dataBase: 0xffff_fffc,
        dlbAddrWidth: 0,
    },
);
assert.match(finalAddressAssembly, /^__start:\r?\nmov r13, 0\r?\nmov r7, 0x41$/m);
const finalAddressBytes = new Map();
for (const match of finalAddressAssembly.matchAll(
    /^mov r7, (0x[0-9A-F]+|\d+)\r?\nmov r8, (0x[0-9A-F]+|\d+)\r?\nmov r8, r8 << 16\r?\nmov r8, r8 \+ (0x[0-9A-F]+|\d+)\r?\nsb \[r8\], r7$/gm,
)) {
    const address = parseImmediate(match[2]) * 0x1_0000 + parseImmediate(match[3]);
    finalAddressBytes.set(address, parseImmediate(match[1]));
}
assert.strictEqual(finalAddressBytes.size, 4);
assert.deepStrictEqual(
    [0xffff_fffc, 0xffff_fffd, 0xffff_fffe, 0xffff_ffff]
        .map((address) => finalAddressBytes.get(address)),
    [0x41, 0x42, 0x43, 0x00],
);

assert.throws(
    () => compileC('int main(void) { return "ABCD"[0]; }', {
        moduleName: 'past_final_dlb_address_test',
        dataBase: 0xffff_fffc,
        dlbAddrWidth: 0,
    }),
    (error) => {
        assert.ok(error instanceof CompilerError);
        assert.match(error.message, /static data exceeds DLB address space/);
        return true;
    },
);

const { assembly: fullAddressSpaceAssembly } = compileC('int main(void) { return 0; }', {
    moduleName: 'full_address_space_test',
    dataBase: 0,
    dlbAddrWidth: 30,
});
assert.match(fullAddressSpaceAssembly, /^__start:\r?\nmov r13, 0\r?\njmp main, r14$/m);

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
