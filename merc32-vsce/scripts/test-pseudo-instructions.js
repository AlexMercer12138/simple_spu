const fs = require('fs')
const os = require('os')
const path = require('path')
const assert = require('assert')
const { SimpleCPUAssembler } = require('../out/assembler')
const { assembleFile } = require('../out/assemblyService')

function assemble(source, fileName = 'main.asm') {
    return new SimpleCPUAssembler().assemble(source, { sourceFileName: fileName })
}

function hex(codes) {
    return codes.map((code) => `0x${(code >>> 0).toString(16).padStart(8, '0')}`)
}

function mustThrow(label, fn, pattern) {
    try {
        fn()
    } catch (error) {
        const message = String(error && error.message ? error.message : error)
        if (pattern && !pattern.test(message)) {
            throw new Error(`${label}: unexpected error: ${message}`)
        }
        return
    }

    throw new Error(`${label}: expected an error`)
}

let result = assemble(`
.equ base 0b1000
.equ plus base + 2
.equ alias plus * 3
.equ reg r2
mov r1, alias
mov r3, reg
`)
assert.deepStrictEqual(hex(result.machineCodes), ['0x001e0110', '0x00002311'])
assert.match(result.preprocessedCode, /mov r1, 30/)
assert.match(result.preprocessedCode, /mov r3, r2/)

result = assemble(`
mov r1, "A"
mov r2, "AB"
mov r3, ","
mov r4, "\\n"
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0x00410110',
    '0x41420210',
    '0x002c0310',
    '0x000a0410',
])

result = assemble(`
.equ defined_only
.ifdef missing
mov r1, 1
.elsif defined_only
mov r1, 2
.else
mov r1, 3
.endif
`)
assert.deepStrictEqual(hex(result.machineCodes), ['0x00020110'])

result = assemble(`
.macro load(rd, v)
mov rd, v
.endm
.macro wrapper(dst, value)
load(dst, value)
.endm
.ifdef wrapper
wrapper(r4, 6)
.else
mov r4, 0
.endif
`)
assert.deepStrictEqual(hex(result.machineCodes), ['0x00060410'])
assert.match(result.preprocessedCode, /mov r4, 6/)

result = assemble(`
.macro load(rd, v)
mov rd, v
.endm
load(r1, 1)
load(r2, 2)
`)
assert.deepStrictEqual(hex(result.machineCodes), ['0x00010110', '0x00020210'])

result = assemble(`
.equ count 1 + 2
.macro emit(x)
mov r5, x
.endm
.rept count
emit(9)
.endr
`)
assert.deepStrictEqual(hex(result.machineCodes), ['0x00090510', '0x00090510', '0x00090510'])

result = assemble(`
.equ flag
.macro pair(v)
.rept 2
.ifdef flag
mov r6, v
.endif
.endr
.endm
pair(4)
`)
assert.deepStrictEqual(hex(result.machineCodes), ['0x00040610', '0x00040610'])

result = assemble(`
.entry main
dead:
mov r1, 9
main:
mov r1, 4
`)
assert.strictEqual(result.entryLabel, 'main')
assert.deepStrictEqual(hex(result.machineCodes), ['0x0008001d', '0x00090110', '0x00040110'])
assert.match(result.preprocessedCode, /^jmp main\b/)

result = assemble(`
target:
jmp 12, r5
jmp r4, r6
jmp r2 + 7, r8
jmp r2 - 3, r9
jmp r1 + r3, r10
jmp 15
jmp r7
jmp r14 + 2
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0x000c051d',
    '0x0004062d',
    '0x0007281d',
    '0xfffd291d',
    '0x00031a2d',
    '0x000f001d',
    '0x0007002d',
    '0x0002e01d',
])

result = assemble(`
cmp  r1, r2 == r3
cmp  r1, r2 != r3
cmp  r1, r2 >= r3
cmp  r1, r2 <  r3
cmp  r1, r2 >  r3
cmp  r1, r2 <= r3
cmpu r1, r2 >= r3
cmpu r1, r2 <  r3
cmpu r1, r2 >  r3
cmpu r1, r2 <= r3
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0x00032140',
    '0x00032141',
    '0x00032142',
    '0x00032143',
    '0x00032144',
    '0x00032145',
    '0x00032146',
    '0x00032147',
    '0x00032148',
    '0x00032149',
])

result = assemble(`
cmp  r4, r5 > -1
cmpu r4, r5 < -1
cmpu r1, r2 == r3
bz   r1, r2 + 0x8000
bnz  r3, r4 + 0xffff
bz   r1, r2 + r3
bnz  r4, r5 + r6
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0xffff5434',
    '0xffff5437',
    '0x00032140',
    '0x8000211b',
    '0xffff431c',
    '0x0003212b',
    '0x0006542c',
])

result = assemble(`
bz r1, r0 + done
bnz r2, r0 + done
done:
mov r1, 1
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0x0008011b',
    '0x0008021c',
    '0x00010110',
])

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-pre-'))
const main = path.join(tmp, 'source.asm')
fs.writeFileSync(main, '.prog demo_prog\nmov r1, 1\n', 'utf8')
const serviceResult = assembleFile(fs.readFileSync(main, 'utf8'), main, 'verilog', 'file')
assert.strictEqual(path.basename(serviceResult.outputFile), 'demo_prog.v')
assert.match(fs.readFileSync(serviceResult.outputFile, 'utf8'), /module demo_prog\(/)

fs.writeFileSync(main, '.prog byte_addr_prog\n.entry main\ndead:\nmov r1, 9\nmain:\nmov r1, 4\n', 'utf8')
const byteAddrResult = assembleFile(fs.readFileSync(main, 'utf8'), main, 'verilog', 'file')
const byteAddrVerilog = fs.readFileSync(byteAddrResult.outputFile, 'utf8')
assert.match(byteAddrVerilog, /0 : prog_data = 32'h0008001D;/)
assert.match(byteAddrVerilog, /1 : prog_data = 32'h00090110;/)
assert.match(byteAddrVerilog, /2 : prog_data = 32'h00040110;/)
assert.doesNotMatch(byteAddrVerilog, /8 : prog_data = 32'h0008001D;/)

const memResult = assembleFile(fs.readFileSync(main, 'utf8'), main, 'mem', 'file')
assert.strictEqual(path.basename(memResult.outputFile), 'byte_addr_prog.mem')
assert.strictEqual(fs.readFileSync(memResult.outputFile, 'utf8'), ['0008001D', '00090110', '00040110'].join('\n'))

const inc1 = path.join(tmp, 'inc1.asm')
const inc2 = path.join(tmp, 'inc2.asm')
const inactive = path.join(tmp, 'inactive.asm')
fs.writeFileSync(inc1, 'inc1:\nmov r2, 2\n', 'utf8')
fs.writeFileSync(inc2, 'inc2:\nmov r3, 3\n', 'utf8')
fs.writeFileSync(inactive, 'inactive:\nmov r9, 9\n', 'utf8')
fs.writeFileSync(
    main,
    [
        '.ifdef never',
        '.include "inactive.asm"',
        '.endif',
        '.include "inc1.asm"',
        'main:',
        'mov r1, inc1',
        '.include "inc2.asm"',
        'mov r4, inc2',
        '',
    ].join('\n'),
    'utf8',
)

result = assemble(fs.readFileSync(main, 'utf8'), main)
assert.deepStrictEqual(hex(result.machineCodes), ['0x00080110', '0x000c0410', '0x00020210', '0x00030310'])
assert.ok(!result.debugSymbols.includes('inactive'))
assert.ok(result.debugSymbols.indexOf('main') < result.debugSymbols.indexOf('inc1'))
assert.ok(result.debugSymbols.indexOf('inc1') < result.debugSymbols.indexOf('inc2'))

mustThrow('register in equ expression', () => assemble('.equ bad r1 + 1\nmov r1, bad\n'), /register|equ|rept/i)
mustThrow('register in rept expression', () => assemble('.equ reg r1\n.rept reg\nmov r1, 1\n.endr\n'), /register|equ|rept/i)
mustThrow('macro recursion', () => assemble('.macro again()\nagain()\n.endm\nagain()\n'), /macro|recursive/i)
mustThrow('macro arg count', () => assemble('.macro one(a)\nmov r1, a\n.endm\none(1, 2)\n'), /macro|argument/i)
mustThrow('unclosed conditional', () => assemble('.ifdef x\nmov r1, 1\n'), /endif|conditional/i)
mustThrow('one instruction per line', () => assemble('mov r1, 1 mov r2, 2\n'), /mov|格式|format/i)
mustThrow('too many character bytes', () => assemble('mov r1, "ABC"\n'), /mov|立即数|immediate/i)
mustThrow('uppercase instruction still invalid', () => assemble('MOV r1, 1\n'), /MOV|mov/i)
mustThrow('missing entry target', () => assemble('.entry missing\nmov r1, 1\n'), /entry|missing/i)
mustThrow('duplicate entry', () => assemble('.entry start\n.entry other\nstart:\nmov r1, 1\n'), /entry|already/i)
mustThrow('entry cannot be register', () => assemble('.entry r1\nr1_label:\nmov r1, 1\n'), /entry|register/i)
mustThrow('cmp destination must be a register', () => assemble('cmp 1, r2 == r3\n'), /cmp|目标|寄存器/i)
mustThrow('cmp lhs must be a register', () => assemble('cmp r1, 2 == r3\n'), /cmp|左|寄存器/i)
mustThrow('cmp rhs must be a register or immediate', () => assemble('cmp r1, r2 == value\n'), /cmp|右|寄存器|立即数/i)
mustThrow('cmp operator must be supported', () => assemble('cmp r1, r2 & r3\n'), /cmp|比较|运算符/i)
mustThrow('cmp decimal immediate must fit signed 16 bits', () => assemble('cmp r1, r2 < 32768\n'), /cmp|立即数|越界/i)
mustThrow('branch destination must be a register', () => assemble('bz 1, r0 + 4\n'), /bz|判断|寄存器/i)
mustThrow('branch base must be present', () => assemble('bz r1, done\ndone:\nmov r1, 1\n'), /bz|目标|格式/i)
mustThrow('branch immediate cannot be negative', () => assemble('bz r1, r0 + -4\n'), /bz|立即数|0.*65535/i)
mustThrow('branch immediate must fit unsigned 16 bits', () => assemble('bz r1, r2 + 65536\n'), /bz|立即数|0.*65535/i)
mustThrow('direct branch target must be aligned', () => assemble('bz r1, r0 + 3\n'), /bz|对齐/i)
mustThrow('old brc syntax removed', () => assemble('brc done, "eq"\ndone:\nmov r1, 1\n'), /brc|未知|unknown/i)
mustThrow('old brcu syntax removed', () => assemble('brcu done, "eq"\ndone:\nmov r1, 1\n'), /brcu|未知|unknown/i)
mustThrow('if pseudo removed', () => assemble('if r1 < r2 goto done\ndone:\nmov r1, 1\n'), /if|未知|unknown/i)

console.log('pseudo-instruction tests passed')
