// MERC32 comprehensive self-check program.
// Covers the current assembly surface syntax:
//   - mov immediate/register-like copy, ALU, memory load/store
//   - jmp immediate/label/register/base+offset/register+register forms
//   - cmp/cmpu register and immediate conditions
//   - bz/bnz label/register/base+offset/register+register targets
//   - interrupt vector setup/return flow
//   - pseudo directives: .prog, .entry, .equ, .ifdef/.elsif/.else/.endif,
//     .macro/.endm, .rept/.endr, .include

.prog full_test
.entry start

.equ DATA_PAGE 0x0800
.equ DATA_BASE 64
.equ STATUS_ADDR 960
.equ FAIL_ADDR 964
.equ ISR_COUNT_ADDR 968
.equ HEARTBEAT_ADDR 972

.equ READY_CODE 0x1234
.equ PASS_CODE 0x600D
.equ FAIL_CODE 0x0BAD
.equ EXPECTED_INTERRUPTS 3

.equ FEATURE_PSEUDO
.equ PSEUDO_BASE 5
.equ PSEUDO_EXPECT (PSEUDO_BASE + 7)
.equ REPT_COUNT (1 + 3)

.macro assert_eqi(src, expect, code)
mov r13, expect
mov r14, code
cmp r11, src == r13
bz r11, r0 + fail
.endm

.macro assert_eqr(lhs, rhs, code)
mov r14, code
cmp r11, lhs == rhs
bz r11, r0 + fail
.endm

.macro write_mem(addr, value)
data_addr(r10, addr)
mov r4, value
mov [r10], r4
.endm

.macro data_addr(rd, offset)
mov rd, DATA_PAGE
mov rd, rd << 16
mov rd, rd + offset
.endm

.include "full_test_include.asm"

start:
write_mem(STATUS_ADDR, 0)
write_mem(FAIL_ADDR, 0)
write_mem(ISR_COUNT_ADDR, 0)
write_mem(HEARTBEAT_ADDR, 0)

// ---------------------------------------------------------------------------
// Pseudo-directive checks emitted in this main file.
// ---------------------------------------------------------------------------
.ifdef MISSING_SYMBOL
mov r4, 1
.elsif FEATURE_PSEUDO
mov r4, PSEUDO_EXPECT
.else
mov r4, 2
.endif
assert_eqi(r4, PSEUDO_EXPECT, 1)

mov r4, 0
.rept REPT_COUNT
mov r4, r4 + 1
.endr
assert_eqi(r4, REPT_COUNT, 2)

// Call the included pseudo test block. The include is appended by the
// assembler preprocessor, so this also validates cross-file label resolution.
jmp pseudo_include_test, r12
assert_eqi(r4, 3, 3)

// ---------------------------------------------------------------------------
// mov immediate and zero-register behavior.
// ---------------------------------------------------------------------------
mov r0, 99
assert_eqi(r0, 0, 10)

mov r4, 0
assert_eqi(r4, 0, 11)

mov r5, 100
assert_eqi(r5, 100, 12)

mov r6, -1
assert_eqi(r6, 0xFFFF, 13)

mov r7, 0x1234
assert_eqi(r7, 0x1234, 14)

// Current assembler lowers "mov rd, rs" to ADDI rd, rs, 0.
mov r8, r7
assert_eqi(r8, 0x1234, 15)

// ---------------------------------------------------------------------------
// ALU I-type forms.
// ---------------------------------------------------------------------------
mov r8, r5 + 10
assert_eqi(r8, 110, 20)

mov r8, r5 - 50
assert_eqi(r8, 50, 21)

mov r8, r7 & 0x0F0F
assert_eqi(r8, 0x0204, 22)

mov r8, r7 | 0x00C0
assert_eqi(r8, 0x12F4, 23)

mov r8, r7 ^ 0x00FF
assert_eqi(r8, 0x12CB, 24)

mov r8, r5 << 2
assert_eqi(r8, 400, 25)

mov r8, r5 >> 2
assert_eqi(r8, 25, 26)

mov r9, 0
mov r9, r9 - 16
mov r8, r9 >>> 2
mov r13, 0
mov r13, r13 - 4
assert_eqr(r8, r13, 27)

// ---------------------------------------------------------------------------
// ALU R-type forms.
// ---------------------------------------------------------------------------
mov r4, 20
mov r5, 7
mov r6, 2

mov r8, r4 + r5
assert_eqi(r8, 27, 30)

mov r8, r4 - r5
assert_eqi(r8, 13, 31)

mov r8, r4 & r5
assert_eqi(r8, 4, 32)

mov r8, r4 | r5
assert_eqi(r8, 23, 33)

mov r8, r4 ^ r5
assert_eqi(r8, 19, 34)

mov r8, r4 << r6
assert_eqi(r8, 80, 35)

mov r8, r4 >> r6
assert_eqi(r8, 5, 36)

mov r9, 0
mov r9, r9 - 16
mov r8, r9 >>> r6
mov r13, 0
mov r13, r13 - 4
assert_eqr(r8, r13, 37)

// ---------------------------------------------------------------------------
// Local-bus memory forms.
// ---------------------------------------------------------------------------
data_addr(r4, DATA_BASE)
mov r5, 0x1111
mov r6, 0x2222
mov r7, 4
mov r10, 8

mov [r4], r5
mov r8, [r4]
assert_eqi(r8, 0x1111, 40)

mov [r4 + 4], r6
mov r8, [r4 + 4]
assert_eqi(r8, 0x2222, 41)

mov [r4 + r10], r5
mov r8, [r4 + r10]
assert_eqi(r8, 0x1111, 42)

mov r9, [r4 + r7]
assert_eqi(r9, 0x2222, 43)

// ---------------------------------------------------------------------------
// cmp/cmpu immediate forms with bz/bnz label targets.
// ---------------------------------------------------------------------------
mov r4, 5
mov r5, 5
mov r6, 9

mov r14, 50
cmp r11, r4 == 5
bnz r11, r0 + br_beq_i_ok
jmp fail
br_beq_i_ok:

mov r14, 51
cmp r11, r4 == 9
bnz r11, r0 + fail

mov r14, 52
cmp r11, r4 != 9
bnz r11, r0 + br_bne_i_ok
jmp fail
br_bne_i_ok:

mov r14, 53
cmp r11, r4 != 5
bnz r11, r0 + fail

mov r4, 0
mov r4, r4 - 1
mov r5, 1
mov r14, 54
cmp r11, r4 < 1
bnz r11, r0 + br_blt_i_ok
jmp fail
br_blt_i_ok:

mov r14, 55
cmp r11, r5 < -1
bnz r11, r0 + fail

mov r14, 56
cmp r11, r5 >= -1
bnz r11, r0 + br_bge_i_ok
jmp fail
br_bge_i_ok:

mov r14, 57
cmp r11, r4 >= 1
bnz r11, r0 + fail

mov r14, 58
cmp r11, r5 > -1
bnz r11, r0 + br_gt_i_ok
jmp fail
br_gt_i_ok:

mov r14, 59
cmp r11, r4 <= 1
bnz r11, r0 + br_le_i_ok
jmp fail
br_le_i_ok:

mov r14, 60
cmpu r11, r4 > -1
bnz r11, r0 + br_ugt_i_ok
jmp fail
br_ugt_i_ok:

mov r14, 61
cmpu r11, r5 <= -1
bnz r11, r0 + br_ule_i_ok
jmp fail
br_ule_i_ok:

// ---------------------------------------------------------------------------
// Register comparisons with all bz/bnz target forms.
// ---------------------------------------------------------------------------
mov r4, 6
mov r5, 6
mov r6, 8

mov r8, br_beq_r_ok
mov r14, 62
cmp r11, r4 == r5
bnz r11, r0 + r8
jmp fail
br_beq_r_ok:

mov r8, br_bne_r_ok
mov r14, 63
cmp r11, r4 != r6
bnz r11, r8 + 0
jmp fail
br_bne_r_ok:

mov r8, br_blt_r_ok
mov r9, 0
mov r14, 64
cmp r11, r4 < r6
bnz r11, r8 + r9
jmp fail
br_blt_r_ok:

mov r8, br_bge_r_ok
mov r14, 65
cmp r11, r6 >= r4
bnz r11, r0 + r8
jmp fail
br_bge_r_ok:

// ---------------------------------------------------------------------------
// Jump forms and link register behavior.
// ---------------------------------------------------------------------------
mov r6, 0
jmp jmp_label_target, r7
jmp_label_return:
assert_eqi(r6, 1, 70)
assert_eqi(r7, jmp_label_return, 71)

mov r8, jmp_reg_target
jmp r8, r9
jmp_reg_return:
assert_eqi(r6, 2, 72)
assert_eqi(r9, jmp_reg_return, 73)

mov r8, jmp_base_imm_target
jmp r8 + 0, r9
jmp_base_imm_return:
assert_eqi(r6, 3, 74)
assert_eqi(r9, jmp_base_imm_return, 75)

mov r8, jmp_reg_reg_target
mov r10, 0
jmp r8 + r10, r9
jmp_reg_reg_return:
assert_eqi(r6, 4, 76)
assert_eqi(r9, jmp_reg_reg_return, 77)

jmp interrupt_setup

jmp_label_target:
mov r6, 1
jmp r7

jmp_reg_target:
mov r6, 2
jmp r9

jmp_base_imm_target:
mov r6, 3
jmp r9

jmp_reg_reg_target:
mov r6, 4
jmp r9

// ---------------------------------------------------------------------------
// Interrupt setup. r1 is interrupt control, r2 is vector, r3 is return.
// The wait loop only uses r8-r11 because the ISR uses r4-r7 as scratch and
// reads r3 as the hardware interrupt return address.
// ---------------------------------------------------------------------------
interrupt_setup:
data_addr(r8, STATUS_ADDR)
data_addr(r9, HEARTBEAT_ADDR)
mov r10, READY_CODE
mov r11, 0
mov r4, isr_entry
mov r2, r4
mov r1, 1

interrupt_wait:
mov [r8], r10
mov r11, r11 + 1
mov [r9], r11
jmp interrupt_wait

isr_entry:
mov r1, r1 & 0xFFFE
data_addr(r4, ISR_COUNT_ADDR)
mov r5, [r4]
mov r5, r5 + 1
mov [r4], r5

cmp r6, r5 >= EXPECTED_INTERRUPTS
bnz r6, r0 + isr_done

mov r1, r1 | 0x0001
jmp r3

isr_done:
write_mem(STATUS_ADDR, PASS_CODE)
pass_loop:
jmp pass_loop

fail:
data_addr(r4, FAIL_ADDR)
mov [r4], r14
write_mem(STATUS_ADDR, FAIL_CODE)
fail_loop:
jmp fail_loop
