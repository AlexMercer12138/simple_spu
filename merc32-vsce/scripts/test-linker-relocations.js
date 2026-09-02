const assert = require('assert');
const { relaxControlFlow } = require('../out/linker');
const records = relaxControlFlow([{ opcode: 'jmp', target: 'far', address: 0 }], new Map([['far', 0x100000]]));
assert.strictEqual(records[0].opcode, 'long-jmp');
console.log('linker relocation tests passed');
