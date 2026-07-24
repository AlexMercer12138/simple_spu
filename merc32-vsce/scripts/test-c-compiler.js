const assert = require('assert');
const { compileC } = require('../out/cCompiler');
const { SimpleCPUAssembler } = require('../out/assembler');

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

const assembler = new SimpleCPUAssembler();
const result = assembler.assemble(assembly, { sourceFileName: 'vsce_c_test.asm' });
assert.ok(result.machineCodes.length > 0);

console.log('MERC32 VSCE C compiler integration test passed');
