// This file is intentionally pulled in by full_test.asm with .include.
// The preprocessor appends include contents after the main file, so the main
// program calls pseudo_include_test as a normal subroutine.

.equ INCLUDED_FLAG

.macro inc_once(reg)
mov reg, reg + 1
.endm

pseudo_include_test:
mov r4, 0
.ifdef INCLUDED_FLAG
.rept 3
inc_once(r4)
.endr
.else
mov r4, 99
.endif

assert_eqi(r4, 3, 80)

mov r4, 8
mov r14, 81
cmp r11, r4 > r0
bnz r11, r0 + pseudo_include_gt_ok
jmp fail

pseudo_include_gt_ok:
mov r14, 82
cmp r11, r0 <= r4
bnz r11, r0 + pseudo_include_le_ok
jmp fail

pseudo_include_le_ok:
mov r4, 3
jmp r12
