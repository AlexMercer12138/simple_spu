.prog tinyc_feature_test
.entry __start

__start:
mov r13, 0x804
mov r13, r13 << 16
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x3C0
mov r8, 0x800
mov r8, r8 << 16
sw [r8], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x3C4
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 4
sw [r8], r7
mov r7, 0x600D
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 8
sw [r8], r7
mov r7, 0xBAD
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
sw [r8], r7
mov r7, 3
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x10
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x14
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x18
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x1C
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x20
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x24
sw [r8], r7
mov r7, 0x41
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x28
sb [r8], r7
mov r7, 7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x29
sb [r8], r7
mov r7, 8
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x2A
sb [r8], r7
mov r7, 0xC
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x2B
sb [r8], r7
mov r7, 0xA
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x2C
sb [r8], r7
mov r7, 0xD
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x2D
sb [r8], r7
mov r7, 9
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x2E
sb [r8], r7
mov r7, 0xB
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x2F
sb [r8], r7
mov r7, 0x5C
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x30
sb [r8], r7
mov r7, 0x27
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x31
sb [r8], r7
mov r7, 0x22
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x32
sb [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x33
sb [r8], r7
mov r7, 0x41
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x34
sb [r8], r7
mov r7, 0x42
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x35
sb [r8], r7
mov r7, 0xE4
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x36
sb [r8], r7
mov r7, 0xB8
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x37
sb [r8], r7
mov r7, 0xAD
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x38
sb [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x39
sb [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x3A
sb [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x3B
sb [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x3C
sb [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x3D
sb [r8], r7
mov r7, 0xFFFF
mov r7, r7 << 16
mov r7, r7 + 0xFFFE
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x3E
sh [r8], r7
mov r7, 0x12C
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x40
sh [r8], r7
mov r7, 0xFFFF
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x42
sh [r8], r7
mov r7, 9
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x44
sh [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x46
sh [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x48
sh [r8], r7
mov r7, 0x3E8
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x4C
sw [r8], r7
mov r7, 0xFFFF
mov r7, r7 << 16
mov r7, r7 + 0xFFCE
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x50
sw [r8], r7
mov r7, 7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x54
sw [r8], r7
mov r7, 0xFFFF
mov r7, r7 << 16
mov r7, r7 + 0xFFFF
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x58
sw [r8], r7
mov r7, 0xA
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x5C
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x60
sw [r8], r7
mov r7, 0
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x64
sw [r8], r7
jmp main, r14
__halt:
jmp __halt

local_initializer_value:
mov r13, r13 - 140
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x24
mov [r12 + 8], r8
lw r7, [r8]
mov [r12 + 12], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 8]
sw [r8], r7
mov r7, [r12 + 12]
mov r4, 0x4D2
jmp __local_initializer_value_return
jmp __local_initializer_value_return
__local_initializer_value_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 140
mov r12, r8
jmp r14

initializer_syntax_tests:
mov r13, r13 - 192
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 0x41
sb [r12 + 12], r7
mov r7, 0xA
sb [r12 + 13], r7
mov r7, 9
sb [r12 + 14], r7
mov r7, 0x5C
sb [r12 + 15], r7
mov r7, 0x22
sb [r12 + 16], r7
mov r7, 0
sb [r12 + 17], r7
mov r7, 0
sb [r12 + 18], r7
mov r7, 0
sb [r12 + 19], r7
mov r7, 1
mov r7, r7 & 0xFF
sb [r12 + 20], r7
mov r7, 0xFF
mov r7, r7 & 0xFF
sb [r12 + 21], r7
mov r7, 3
mov r7, r7 & 0xFF
sb [r12 + 22], r7
mov r7, 0x12C
mov r7, r0 - r7
mov r7, r7 << 16
mov r7, r7 >>> 16
sh [r12 + 24], r7
mov r7, 0x190
mov r7, r7 << 16
mov r7, r7 >>> 16
sh [r12 + 26], r7
mov r7, 0
sh [r12 + 28], r7
mov r7, 0
sh [r12 + 30], r7
mov r7, 0xEA60
mov r7, r7 & 0xFFFF
sh [r12 + 32], r7
mov r7, 2
mov r7, r7 & 0xFFFF
sh [r12 + 34], r7
jmp local_initializer_value, r14
mov r7, r4
sw [r12 + 36], r7
mov r7, 0x14
sw [r12 + 40], r7
mov r7, 0
sw [r12 + 44], r7
mov r7, 0
sw [r12 + 48], r7
mov r7, 0x8000
mov r7, r7 << 16
sw [r12 + 52], r7
mov r7, 7
sw [r12 + 56], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x41
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_0
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_1
__initializer_syntax_tests_else_0:
__initializer_syntax_tests_endif_1:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 7
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_2
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_3
__initializer_syntax_tests_else_2:
__initializer_syntax_tests_endif_3:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 8
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_4
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_5
__initializer_syntax_tests_else_4:
__initializer_syntax_tests_endif_5:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0xC
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_6
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_7
__initializer_syntax_tests_else_6:
__initializer_syntax_tests_endif_7:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 4
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0xA
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_8
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_9
__initializer_syntax_tests_else_8:
__initializer_syntax_tests_endif_9:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 5
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0xD
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_10
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_11
__initializer_syntax_tests_else_10:
__initializer_syntax_tests_endif_11:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 6
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 9
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_12
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_13
__initializer_syntax_tests_else_12:
__initializer_syntax_tests_endif_13:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 7
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0xB
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_14
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_15
__initializer_syntax_tests_else_14:
__initializer_syntax_tests_endif_15:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 8
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x5C
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_16
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_17
__initializer_syntax_tests_else_16:
__initializer_syntax_tests_endif_17:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 9
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x27
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_18
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_19
__initializer_syntax_tests_else_18:
__initializer_syntax_tests_endif_19:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 0xA
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x22
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_20
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_21
__initializer_syntax_tests_else_20:
__initializer_syntax_tests_endif_21:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 0xB
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_22
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_23
__initializer_syntax_tests_else_22:
__initializer_syntax_tests_endif_23:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 0xC
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x41
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_24
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_25
__initializer_syntax_tests_else_24:
__initializer_syntax_tests_endif_25:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x28
mov [r12 + 64], r7
mov r8, 0xD
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x42
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_26
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_27
__initializer_syntax_tests_else_26:
__initializer_syntax_tests_endif_27:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0xE4
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_28
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_29
__initializer_syntax_tests_else_28:
__initializer_syntax_tests_endif_29:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0xB8
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_30
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_31
__initializer_syntax_tests_else_30:
__initializer_syntax_tests_endif_31:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0xAD
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_32
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_33
__initializer_syntax_tests_else_32:
__initializer_syntax_tests_endif_33:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_34
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_35
__initializer_syntax_tests_else_34:
__initializer_syntax_tests_endif_35:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 4
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_36
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_37
__initializer_syntax_tests_else_36:
__initializer_syntax_tests_endif_37:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 5
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_38
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_39
__initializer_syntax_tests_else_38:
__initializer_syntax_tests_endif_39:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 6
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_40
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_41
__initializer_syntax_tests_else_40:
__initializer_syntax_tests_endif_41:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x36
mov [r12 + 64], r7
mov r8, 7
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_42
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_43
__initializer_syntax_tests_else_42:
__initializer_syntax_tests_endif_43:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x3E
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r8, r0 - r8
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_44
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_45
__initializer_syntax_tests_else_44:
__initializer_syntax_tests_endif_45:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x3E
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 0x12C
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_46
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_47
__initializer_syntax_tests_else_46:
__initializer_syntax_tests_endif_47:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x42
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 0xFFFF
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_48
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_49
__initializer_syntax_tests_else_48:
__initializer_syntax_tests_endif_49:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x42
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 9
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_50
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_51
__initializer_syntax_tests_else_50:
__initializer_syntax_tests_endif_51:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x42
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_52
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_53
__initializer_syntax_tests_else_52:
__initializer_syntax_tests_endif_53:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x42
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_54
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_55
__initializer_syntax_tests_else_54:
__initializer_syntax_tests_endif_55:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x4C
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0x3E8
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_56
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_57
__initializer_syntax_tests_else_56:
__initializer_syntax_tests_endif_57:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x4C
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0x32
mov r8, r0 - r8
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_58
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_59
__initializer_syntax_tests_else_58:
__initializer_syntax_tests_endif_59:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x4C
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 7
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_60
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_61
__initializer_syntax_tests_else_60:
__initializer_syntax_tests_endif_61:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x58
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0xFFFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, [r12 + 60]
cmpu r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_62
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_63
__initializer_syntax_tests_else_62:
__initializer_syntax_tests_endif_63:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x58
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0xA
mov r7, [r12 + 60]
cmpu r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_64
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_65
__initializer_syntax_tests_else_64:
__initializer_syntax_tests_endif_65:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x58
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmpu r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_66
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_67
__initializer_syntax_tests_else_66:
__initializer_syntax_tests_endif_67:
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x58
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmpu r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_68
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_69
__initializer_syntax_tests_else_68:
__initializer_syntax_tests_endif_69:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x41
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_70
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_71
__initializer_syntax_tests_else_70:
__initializer_syntax_tests_endif_71:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0xA
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_72
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_73
__initializer_syntax_tests_else_72:
__initializer_syntax_tests_endif_73:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 9
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_74
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_75
__initializer_syntax_tests_else_74:
__initializer_syntax_tests_endif_75:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x5C
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_76
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_77
__initializer_syntax_tests_else_76:
__initializer_syntax_tests_endif_77:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 4
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0x22
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_78
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_79
__initializer_syntax_tests_else_78:
__initializer_syntax_tests_endif_79:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 5
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_80
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_81
__initializer_syntax_tests_else_80:
__initializer_syntax_tests_endif_81:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 6
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_82
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_83
__initializer_syntax_tests_else_82:
__initializer_syntax_tests_endif_83:
mov r7, r12 + 12
mov [r12 + 64], r7
mov r8, 7
mov r7, [r12 + 64]
mov r8, r7 + r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_84
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_85
__initializer_syntax_tests_else_84:
__initializer_syntax_tests_endif_85:
mov r7, r12 + 20
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_86
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_87
__initializer_syntax_tests_else_86:
__initializer_syntax_tests_endif_87:
mov r7, r12 + 20
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 0xFF
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_88
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_89
__initializer_syntax_tests_else_88:
__initializer_syntax_tests_endif_89:
mov r7, r12 + 20
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r7 + r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 3
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_90
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_91
__initializer_syntax_tests_else_90:
__initializer_syntax_tests_endif_91:
mov r7, r12 + 24
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 0x12C
mov r8, r0 - r8
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_92
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_93
__initializer_syntax_tests_else_92:
__initializer_syntax_tests_endif_93:
mov r7, r12 + 24
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 0x190
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_94
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_95
__initializer_syntax_tests_else_94:
__initializer_syntax_tests_endif_95:
mov r7, r12 + 24
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_96
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_97
__initializer_syntax_tests_else_96:
__initializer_syntax_tests_endif_97:
mov r7, r12 + 24
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_98
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_99
__initializer_syntax_tests_else_98:
__initializer_syntax_tests_endif_99:
mov r7, r12 + 32
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 0xEA60
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_100
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_101
__initializer_syntax_tests_else_100:
__initializer_syntax_tests_endif_101:
mov r7, r12 + 32
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 1
mov r8, r7 + r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_102
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_103
__initializer_syntax_tests_else_102:
__initializer_syntax_tests_endif_103:
mov r7, r12 + 36
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0x4D2
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_104
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_105
__initializer_syntax_tests_else_104:
__initializer_syntax_tests_endif_105:
mov r7, r12 + 36
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0x14
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_106
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_107
__initializer_syntax_tests_else_106:
__initializer_syntax_tests_endif_107:
mov r7, r12 + 36
mov [r12 + 64], r7
mov r8, 2
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_108
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_109
__initializer_syntax_tests_else_108:
__initializer_syntax_tests_endif_109:
mov r7, r12 + 36
mov [r12 + 64], r7
mov r8, 3
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_110
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_111
__initializer_syntax_tests_else_110:
__initializer_syntax_tests_endif_111:
mov r7, r12 + 52
mov [r12 + 64], r7
mov r8, 0
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0x8000
mov r8, r8 << 16
mov r7, [r12 + 60]
cmpu r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_112
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_113
__initializer_syntax_tests_else_112:
__initializer_syntax_tests_endif_113:
mov r7, r12 + 52
mov [r12 + 64], r7
mov r8, 1
mov r7, [r12 + 64]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 7
mov r7, [r12 + 60]
cmpu r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_114
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_115
__initializer_syntax_tests_else_114:
__initializer_syntax_tests_endif_115:
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x24
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
cmp r7, r7 == r8
bz r7, r0 + __initializer_syntax_tests_else_116
lw r7, [r12 + 8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __initializer_syntax_tests_endif_117
__initializer_syntax_tests_else_116:
__initializer_syntax_tests_endif_117:
lw r4, [r12 + 8]
jmp __initializer_syntax_tests_return
jmp __initializer_syntax_tests_return
__initializer_syntax_tests_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 192
mov r12, r8
jmp r14

update_syntax_tests:
mov r13, r13 - 188
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 0xA
sw [r12 + 12], r7
mov r7, 0x8000
mov r7, r7 << 16
sw [r12 + 16], r7
mov r7, 0x7F
sb [r12 + 20], r7
mov r7, 0xFF
sb [r12 + 21], r7
mov r7, 0x7FFF
sh [r12 + 22], r7
mov r7, 0xFFFF
sh [r12 + 24], r7
mov r7, 0xA
sw [r12 + 28], r7
mov r7, 0x14
sw [r12 + 32], r7
mov r7, 0x1E
sw [r12 + 36], r7
mov r7, 0
sw [r12 + 40], r7
mov r7, 0
sw [r12 + 44], r7
mov r7, 0
sw [r12 + 48], r7
mov r7, 0
sw [r12 + 52], r7
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 5
mov r7, [r12 + 60]
mov r7, r7 + r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 0xF
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_0
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_1
__update_syntax_tests_else_0:
__update_syntax_tests_endif_1:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 3
mov r7, [r12 + 60]
mov r7, r7 - r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 0xC
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_2
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_3
__update_syntax_tests_else_2:
__update_syntax_tests_endif_3:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 4
mov r7, [r12 + 60]
mul r7, r7, r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 0x30
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_4
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_5
__update_syntax_tests_else_4:
__update_syntax_tests_endif_5:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 6
mov r7, [r12 + 60]
div r7, r7, r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 8
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_6
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_7
__update_syntax_tests_else_6:
__update_syntax_tests_endif_7:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 5
mov r7, [r12 + 60]
rem r7, r7, r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 3
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_8
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_9
__update_syntax_tests_else_8:
__update_syntax_tests_endif_9:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 6
mov r7, [r12 + 60]
mov r7, r7 & r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 2
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_10
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_11
__update_syntax_tests_else_10:
__update_syntax_tests_endif_11:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 8
mov r7, [r12 + 60]
mov r7, r7 | r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 0xA
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_12
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_13
__update_syntax_tests_else_12:
__update_syntax_tests_endif_13:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 3
mov r7, [r12 + 60]
mov r7, r7 ^ r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 9
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_14
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_15
__update_syntax_tests_else_14:
__update_syntax_tests_endif_15:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r7, [r12 + 60]
mov r7, r7 << r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 0x24
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_16
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_17
__update_syntax_tests_else_16:
__update_syntax_tests_endif_17:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r7, r7 >>> r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 0x12
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_18
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_19
__update_syntax_tests_else_18:
__update_syntax_tests_endif_19:
mov r8, r12 + 16
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 0x1F
mov r7, [r12 + 60]
mov r7, r7 >> r8
mov r8, [r12 + 56]
sw [r8], r7
lw r7, [r12 + 16]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
cmpu r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_20
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_21
__update_syntax_tests_else_20:
__update_syntax_tests_endif_21:
mov r8, r12 + 20
mov [r12 + 56], r8
lb r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r7, [r12 + 60]
mov r7, r7 + r8
mov r7, r7 << 24
mov r7, r7 >>> 24
mov r8, [r12 + 56]
sb [r8], r7
lb r7, [r12 + 20]
mov [r12 + 56], r7
mov r8, 0x7F
mov r8, r0 - r8
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_22
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_23
__update_syntax_tests_else_22:
__update_syntax_tests_endif_23:
mov r8, r12 + 21
mov [r12 + 56], r8
lbu r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r7, [r12 + 60]
mov r7, r7 + r8
mov r7, r7 & 0xFF
mov r8, [r12 + 56]
sb [r8], r7
lbu r7, [r12 + 21]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_24
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_25
__update_syntax_tests_else_24:
__update_syntax_tests_endif_25:
mov r8, r12 + 22
mov [r12 + 56], r8
lh r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r7, [r12 + 60]
mov r7, r7 + r8
mov r7, r7 << 16
mov r7, r7 >>> 16
mov r8, [r12 + 56]
sh [r8], r7
lh r7, [r12 + 22]
mov [r12 + 56], r7
mov r8, 0x7FFF
mov r8, r0 - r8
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_26
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_27
__update_syntax_tests_else_26:
__update_syntax_tests_endif_27:
mov r8, r12 + 24
mov [r12 + 56], r8
lhu r7, [r8]
mov [r12 + 60], r7
mov r8, 2
mov r7, [r12 + 60]
mov r7, r7 + r8
mov r7, r7 & 0xFFFF
mov r8, [r12 + 56]
sh [r8], r7
lhu r7, [r12 + 24]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_28
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_29
__update_syntax_tests_else_28:
__update_syntax_tests_endif_29:
mov r7, r12 + 28
mov [r12 + 60], r7
mov r8, r12 + 40
mov [r12 + 64], r8
lw r7, [r8]
mov [r12 + 68], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 64]
sw [r8], r7
mov r8, [r12 + 68]
mov r7, [r12 + 60]
mov r8, r8 << 2
mov r8, r7 + r8
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 5
mov r7, [r12 + 60]
mov r7, r7 + r8
mov r8, [r12 + 56]
sw [r8], r7
sw [r12 + 44], r7
lw r7, [r12 + 44]
mov [r12 + 56], r7
mov r8, 0xF
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_30
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_31
__update_syntax_tests_else_30:
__update_syntax_tests_endif_31:
lw r7, [r12 + 40]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_32
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_33
__update_syntax_tests_else_32:
__update_syntax_tests_endif_33:
mov r7, r12 + 28
mov [r12 + 60], r7
mov r8, 0
mov r7, [r12 + 60]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 0xF
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_34
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_35
__update_syntax_tests_else_34:
__update_syntax_tests_endif_35:
mov r7, r12 + 28
mov [r12 + 60], r7
mov r8, 1
mov r7, [r12 + 60]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 0x14
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_36
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_37
__update_syntax_tests_else_36:
__update_syntax_tests_endif_37:
mov r7, 5
sw [r12 + 12], r7
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 56]
sw [r8], r7
mov r7, [r12 + 60]
sw [r12 + 48], r7
lw r7, [r12 + 48]
mov [r12 + 56], r7
mov r8, 5
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_38
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_39
__update_syntax_tests_else_38:
__update_syntax_tests_endif_39:
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 6
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_40
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_41
__update_syntax_tests_else_40:
__update_syntax_tests_endif_41:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 56]
sw [r8], r7
sw [r12 + 52], r7
lw r7, [r12 + 52]
mov [r12 + 56], r7
mov r8, 7
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_42
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_43
__update_syntax_tests_else_42:
__update_syntax_tests_endif_43:
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 7
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_44
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_45
__update_syntax_tests_else_44:
__update_syntax_tests_endif_45:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov [r12 + 60], r7
mov r8, 1
mov r7, r7 - r8
mov r8, [r12 + 56]
sw [r8], r7
mov r7, [r12 + 60]
sw [r12 + 48], r7
lw r7, [r12 + 48]
mov [r12 + 56], r7
mov r8, 7
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_46
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_47
__update_syntax_tests_else_46:
__update_syntax_tests_endif_47:
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 6
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_48
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_49
__update_syntax_tests_else_48:
__update_syntax_tests_endif_49:
mov r8, r12 + 12
mov [r12 + 56], r8
lw r7, [r8]
mov r8, 1
mov r7, r7 - r8
mov r8, [r12 + 56]
sw [r8], r7
sw [r12 + 52], r7
lw r7, [r12 + 52]
mov [r12 + 56], r7
mov r8, 5
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_50
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_51
__update_syntax_tests_else_50:
__update_syntax_tests_endif_51:
lw r7, [r12 + 12]
mov [r12 + 56], r7
mov r8, 5
mov r7, [r12 + 56]
cmp r7, r7 == r8
bz r7, r0 + __update_syntax_tests_else_52
lw r7, [r12 + 8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __update_syntax_tests_endif_53
__update_syntax_tests_else_52:
__update_syntax_tests_endif_53:
lw r4, [r12 + 8]
jmp __update_syntax_tests_return
jmp __update_syntax_tests_return
__update_syntax_tests_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 188
mov r12, r8
jmp r14

pointer_update_tests:
mov r13, r13 - 184
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 1
mov r7, r7 << 24
mov r7, r7 >>> 24
sb [r12 + 12], r7
mov r7, 2
mov r7, r7 << 24
mov r7, r7 >>> 24
sb [r12 + 13], r7
mov r7, 3
mov r7, r7 << 24
mov r7, r7 >>> 24
sb [r12 + 14], r7
mov r7, 0xA
mov r7, r7 << 16
mov r7, r7 >>> 16
sh [r12 + 16], r7
mov r7, 0x14
mov r7, r7 << 16
mov r7, r7 >>> 16
sh [r12 + 18], r7
mov r7, 0x1E
mov r7, r7 << 16
mov r7, r7 >>> 16
sh [r12 + 20], r7
mov r7, 0x28
mov r7, r7 << 16
mov r7, r7 >>> 16
sh [r12 + 22], r7
mov r7, 0x64
sw [r12 + 24], r7
mov r7, 0xC8
sw [r12 + 28], r7
mov r7, 0x12C
sw [r12 + 32], r7
mov r7, 0x190
sw [r12 + 36], r7
mov r7, r12 + 12
sw [r12 + 40], r7
mov r7, r12 + 16
sw [r12 + 44], r7
mov r7, r12 + 24
sw [r12 + 48], r7
mov r8, r12 + 40
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 52]
sw [r8], r7
mov r7, [r12 + 56]
lw r8, [r12 + 40]
lb r7, [r8]
mov [r12 + 52], r7
mov r8, 2
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_0
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_1
__pointer_update_tests_else_0:
__pointer_update_tests_endif_1:
mov r8, r12 + 40
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r7, r7 - r8
mov r8, [r12 + 52]
sw [r8], r7
mov r7, [r12 + 56]
lw r8, [r12 + 40]
lb r7, [r8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_2
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_3
__pointer_update_tests_else_2:
__pointer_update_tests_endif_3:
mov r8, r12 + 40
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 2
mov r7, [r12 + 56]
mov r7, r7 + r8
mov r8, [r12 + 52]
sw [r8], r7
lw r8, [r12 + 40]
lb r7, [r8]
mov [r12 + 52], r7
mov r8, 3
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_4
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_5
__pointer_update_tests_else_4:
__pointer_update_tests_endif_5:
mov r8, r12 + 40
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r7, r7 - r8
mov r8, [r12 + 52]
sw [r8], r7
lw r8, [r12 + 40]
lb r7, [r8]
mov [r12 + 52], r7
mov r8, 2
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_6
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_7
__pointer_update_tests_else_6:
__pointer_update_tests_endif_7:
mov r8, r12 + 44
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r8, r8 << 1
mov r7, r7 + r8
mov r8, [r12 + 52]
sw [r8], r7
mov r7, [r12 + 56]
lw r8, [r12 + 44]
lh r7, [r8]
mov [r12 + 52], r7
mov r8, 0x14
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_8
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_9
__pointer_update_tests_else_8:
__pointer_update_tests_endif_9:
mov r8, r12 + 44
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r8, r8 << 1
mov r7, r7 - r8
mov r8, [r12 + 52]
sw [r8], r7
mov r7, [r12 + 56]
lw r8, [r12 + 44]
lh r7, [r8]
mov [r12 + 52], r7
mov r8, 0xA
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_10
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_11
__pointer_update_tests_else_10:
__pointer_update_tests_endif_11:
mov r8, r12 + 44
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 3
mov r7, [r12 + 56]
mov r8, r8 << 1
mov r7, r7 + r8
mov r8, [r12 + 52]
sw [r8], r7
lw r8, [r12 + 44]
lh r7, [r8]
mov [r12 + 52], r7
mov r8, 0x28
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_12
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_13
__pointer_update_tests_else_12:
__pointer_update_tests_endif_13:
mov r8, r12 + 44
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 2
mov r7, [r12 + 56]
mov r8, r8 << 1
mov r7, r7 - r8
mov r8, [r12 + 52]
sw [r8], r7
lw r8, [r12 + 44]
lh r7, [r8]
mov [r12 + 52], r7
mov r8, 0x14
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_14
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_15
__pointer_update_tests_else_14:
__pointer_update_tests_endif_15:
mov r8, r12 + 48
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r8, r8 << 2
mov r7, r7 + r8
mov r8, [r12 + 52]
sw [r8], r7
mov r7, [r12 + 56]
lw r8, [r12 + 48]
lw r7, [r8]
mov [r12 + 52], r7
mov r8, 0xC8
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_16
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_17
__pointer_update_tests_else_16:
__pointer_update_tests_endif_17:
mov r8, r12 + 48
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r8, r8 << 2
mov r7, r7 - r8
mov r8, [r12 + 52]
sw [r8], r7
mov r7, [r12 + 56]
lw r8, [r12 + 48]
lw r7, [r8]
mov [r12 + 52], r7
mov r8, 0x64
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_18
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_19
__pointer_update_tests_else_18:
__pointer_update_tests_endif_19:
mov r8, r12 + 48
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 2
mov r7, [r12 + 56]
mov r8, r8 << 2
mov r7, r7 + r8
mov r8, [r12 + 52]
sw [r8], r7
lw r8, [r12 + 48]
lw r7, [r8]
mov [r12 + 52], r7
mov r8, 0x12C
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_20
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_21
__pointer_update_tests_else_20:
__pointer_update_tests_endif_21:
mov r8, r12 + 48
mov [r12 + 52], r8
lw r7, [r8]
mov [r12 + 56], r7
mov r8, 1
mov r7, [r12 + 56]
mov r8, r8 << 2
mov r7, r7 - r8
mov r8, [r12 + 52]
sw [r8], r7
lw r8, [r12 + 48]
lw r7, [r8]
mov [r12 + 52], r7
mov r8, 0xC8
mov r7, [r12 + 52]
cmp r7, r7 == r8
bz r7, r0 + __pointer_update_tests_else_22
lw r7, [r12 + 8]
mov [r12 + 52], r7
mov r8, 1
mov r7, [r12 + 52]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __pointer_update_tests_endif_23
__pointer_update_tests_else_22:
__pointer_update_tests_endif_23:
lw r4, [r12 + 8]
jmp __pointer_update_tests_return
jmp __pointer_update_tests_return
__pointer_update_tests_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 184
mov r12, r8
jmp r14

conditional_syntax_tests:
mov r13, r13 - 160
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 0
sw [r12 + 12], r7
mov r7, 0xA
sw [r12 + 16], r7
mov r7, 0
sw [r12 + 20], r7
mov r7, 0
sw [r12 + 24], r7
mov r8, r12 + 12
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
mov r7, [r12 + 32]
bz r7, r0 + __conditional_syntax_tests_conditional_false_0
__conditional_syntax_tests_conditional_true_1:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
jmp __conditional_syntax_tests_conditional_end_2
__conditional_syntax_tests_conditional_false_0:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov r8, 1
mov r7, r7 - r8
mov r8, [r12 + 28]
sw [r8], r7
__conditional_syntax_tests_conditional_end_2:
sw [r12 + 20], r7
lw r7, [r12 + 12]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_3
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_4
__conditional_syntax_tests_else_3:
__conditional_syntax_tests_endif_4:
lw r7, [r12 + 16]
mov [r12 + 28], r7
mov r8, 9
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_5
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_6
__conditional_syntax_tests_else_5:
__conditional_syntax_tests_endif_6:
lw r7, [r12 + 20]
mov [r12 + 28], r7
mov r8, 9
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_7
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_8
__conditional_syntax_tests_else_7:
__conditional_syntax_tests_endif_8:
mov r8, r12 + 12
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
mov r7, [r12 + 32]
bz r7, r0 + __conditional_syntax_tests_conditional_false_9
__conditional_syntax_tests_conditional_true_10:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 3
mov r7, [r12 + 32]
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
jmp __conditional_syntax_tests_conditional_end_11
__conditional_syntax_tests_conditional_false_9:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 0x64
mov r7, [r12 + 32]
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
__conditional_syntax_tests_conditional_end_11:
sw [r12 + 20], r7
lw r7, [r12 + 12]
mov [r12 + 28], r7
mov r8, 2
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_12
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_13
__conditional_syntax_tests_else_12:
__conditional_syntax_tests_endif_13:
lw r7, [r12 + 16]
mov [r12 + 28], r7
mov r8, 0xC
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_14
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_15
__conditional_syntax_tests_else_14:
__conditional_syntax_tests_endif_15:
lw r7, [r12 + 20]
mov [r12 + 28], r7
mov r8, 0xC
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_16
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_17
__conditional_syntax_tests_else_16:
__conditional_syntax_tests_endif_17:
mov r7, 0
bz r7, r0 + __conditional_syntax_tests_conditional_false_18
__conditional_syntax_tests_conditional_true_19:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 0x3E8
mov r7, [r12 + 32]
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
jmp __conditional_syntax_tests_conditional_end_20
__conditional_syntax_tests_conditional_false_18:
mov r7, 0
bz r7, r0 + __conditional_syntax_tests_conditional_false_21
__conditional_syntax_tests_conditional_true_22:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 0x7D0
mov r7, [r12 + 32]
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
jmp __conditional_syntax_tests_conditional_end_23
__conditional_syntax_tests_conditional_false_21:
mov r8, r12 + 16
mov [r12 + 28], r8
lw r7, [r8]
mov [r12 + 32], r7
mov r8, 4
mov r7, [r12 + 32]
mov r7, r7 + r8
mov r8, [r12 + 28]
sw [r8], r7
__conditional_syntax_tests_conditional_end_23:
__conditional_syntax_tests_conditional_end_20:
sw [r12 + 24], r7
lw r7, [r12 + 24]
mov [r12 + 28], r7
mov r8, 0x10
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_24
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_25
__conditional_syntax_tests_else_24:
__conditional_syntax_tests_endif_25:
lw r7, [r12 + 16]
mov [r12 + 28], r7
mov r8, 0x10
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_26
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_27
__conditional_syntax_tests_else_26:
__conditional_syntax_tests_endif_27:
mov r7, 1
bz r7, r0 + __conditional_syntax_tests_conditional_false_28
__conditional_syntax_tests_conditional_true_29:
mov r7, 0
bz r7, r0 + __conditional_syntax_tests_conditional_false_31
__conditional_syntax_tests_conditional_true_32:
mov r7, 0x64
jmp __conditional_syntax_tests_conditional_end_33
__conditional_syntax_tests_conditional_false_31:
mov r7, 7
__conditional_syntax_tests_conditional_end_33:
jmp __conditional_syntax_tests_conditional_end_30
__conditional_syntax_tests_conditional_false_28:
mov r7, 0xC8
__conditional_syntax_tests_conditional_end_30:
sw [r12 + 24], r7
lw r7, [r12 + 24]
mov [r12 + 28], r7
mov r8, 7
mov r7, [r12 + 28]
cmp r7, r7 == r8
bz r7, r0 + __conditional_syntax_tests_else_34
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __conditional_syntax_tests_endif_35
__conditional_syntax_tests_else_34:
__conditional_syntax_tests_endif_35:
lw r4, [r12 + 8]
jmp __conditional_syntax_tests_return
jmp __conditional_syntax_tests_return
__conditional_syntax_tests_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 160
mov r12, r8
jmp r14

switch_classify:
mov r13, r13 - 148
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
mov r7, 0
sw [r12 + 12], r7
lw r7, [r12 + 8]
mov [r12 + 16], r7
mov r7, [r12 + 16]
mov r8, 1
cmp r7, r7 == r8
bnz r7, r0 + __switch_classify_switch_case_1
mov r7, [r12 + 16]
mov r8, 2
cmp r7, r7 == r8
bnz r7, r0 + __switch_classify_switch_case_2
mov r7, [r12 + 16]
mov r8, 3
cmp r7, r7 == r8
bnz r7, r0 + __switch_classify_switch_case_3
mov r7, [r12 + 16]
mov r8, 4
cmp r7, r7 == r8
bnz r7, r0 + __switch_classify_switch_case_4
jmp __switch_classify_switch_default_5
__switch_classify_switch_case_1:
mov r8, r12 + 12
mov [r12 + 16], r8
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov r8, [r12 + 16]
sw [r8], r7
__switch_classify_switch_case_2:
mov r8, r12 + 12
mov [r12 + 16], r8
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
mov r7, r7 + r8
mov r8, [r12 + 16]
sw [r8], r7
jmp __switch_classify_switch_end_0
__switch_classify_switch_case_3:
__switch_classify_switch_case_4:
mov r8, r12 + 12
mov [r12 + 16], r8
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 4
mov r7, [r12 + 20]
mov r7, r7 + r8
mov r8, [r12 + 16]
sw [r8], r7
jmp __switch_classify_switch_end_0
__switch_classify_switch_default_5:
mov r8, r12 + 12
mov [r12 + 16], r8
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 8
mov r7, [r12 + 20]
mov r7, r7 + r8
mov r8, [r12 + 16]
sw [r8], r7
__switch_classify_switch_end_0:
lw r4, [r12 + 12]
jmp __switch_classify_return
jmp __switch_classify_return
__switch_classify_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 148
mov r12, r8
jmp r14

switch_without_default:
mov r13, r13 - 148
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
mov r7, 1
sw [r12 + 12], r7
lw r7, [r12 + 8]
mov [r12 + 16], r7
mov r7, [r12 + 16]
mov r8, 7
cmp r7, r7 == r8
bnz r7, r0 + __switch_without_default_switch_case_1
jmp __switch_without_default_switch_end_0
__switch_without_default_switch_case_1:
mov r8, r12 + 12
mov [r12 + 16], r8
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
mov r7, r7 + r8
mov r8, [r12 + 16]
sw [r8], r7
__switch_without_default_switch_end_0:
lw r4, [r12 + 12]
jmp __switch_without_default_return
jmp __switch_without_default_return
__switch_without_default_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 148
mov r12, r8
jmp r14

nested_switch_value:
mov r13, r13 - 152
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
sw [r12 + 12], r5
mov r7, 0
sw [r12 + 16], r7
lw r7, [r12 + 8]
mov [r12 + 20], r7
mov r7, [r12 + 20]
mov r8, 1
cmp r7, r7 == r8
bnz r7, r0 + __nested_switch_value_switch_case_1
jmp __nested_switch_value_switch_default_2
__nested_switch_value_switch_case_1:
lw r7, [r12 + 12]
mov [r12 + 20], r7
mov r7, [r12 + 20]
mov r8, 2
cmp r7, r7 == r8
bnz r7, r0 + __nested_switch_value_switch_case_4
jmp __nested_switch_value_switch_default_5
__nested_switch_value_switch_case_4:
mov r8, r12 + 16
mov [r12 + 20], r8
lw r7, [r8]
mov [r12 + 24], r7
mov r8, 1
mov r7, [r12 + 24]
mov r7, r7 + r8
mov r8, [r12 + 20]
sw [r8], r7
jmp __nested_switch_value_switch_end_3
__nested_switch_value_switch_default_5:
mov r8, r12 + 16
mov [r12 + 20], r8
lw r7, [r8]
mov [r12 + 24], r7
mov r8, 2
mov r7, [r12 + 24]
mov r7, r7 + r8
mov r8, [r12 + 20]
sw [r8], r7
__nested_switch_value_switch_end_3:
mov r8, r12 + 16
mov [r12 + 20], r8
lw r7, [r8]
mov [r12 + 24], r7
mov r8, 4
mov r7, [r12 + 24]
mov r7, r7 + r8
mov r8, [r12 + 20]
sw [r8], r7
jmp __nested_switch_value_switch_end_0
__nested_switch_value_switch_default_2:
mov r8, r12 + 16
mov [r12 + 20], r8
lw r7, [r8]
mov [r12 + 24], r7
mov r8, 8
mov r7, [r12 + 24]
mov r7, r7 + r8
mov r8, [r12 + 20]
sw [r8], r7
__nested_switch_value_switch_end_0:
lw r4, [r12 + 16]
jmp __nested_switch_value_return
jmp __nested_switch_value_return
__nested_switch_value_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 152
mov r12, r8
jmp r14

loop_in_switch_value:
mov r13, r13 - 144
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 1
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov r8, 1
cmp r7, r7 == r8
bnz r7, r0 + __loop_in_switch_value_switch_case_1
jmp __loop_in_switch_value_switch_default_2
__loop_in_switch_value_switch_case_1:
__loop_in_switch_value_while_3:
lw r7, [r12 + 8]
mov [r12 + 12], r7
mov r8, 3
mov r7, [r12 + 12]
cmp r7, r7 < r8
bz r7, r0 + __loop_in_switch_value_endwhile_4
mov r8, r12 + 8
mov [r12 + 12], r8
lw r7, [r8]
mov [r12 + 16], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 12]
sw [r8], r7
mov r7, [r12 + 16]
jmp __loop_in_switch_value_endwhile_4
jmp __loop_in_switch_value_while_3
__loop_in_switch_value_endwhile_4:
mov r8, r12 + 8
mov [r12 + 12], r8
lw r7, [r8]
mov [r12 + 16], r7
mov r8, 4
mov r7, [r12 + 16]
mov r7, r7 + r8
mov r8, [r12 + 12]
sw [r8], r7
jmp __loop_in_switch_value_switch_end_0
__loop_in_switch_value_switch_default_2:
mov r8, r12 + 8
mov [r12 + 12], r8
lw r7, [r8]
mov [r12 + 16], r7
mov r8, 8
mov r7, [r12 + 16]
mov r7, r7 + r8
mov r8, [r12 + 12]
sw [r8], r7
__loop_in_switch_value_switch_end_0:
lw r4, [r12 + 8]
jmp __loop_in_switch_value_return
jmp __loop_in_switch_value_return
__loop_in_switch_value_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 144
mov r12, r8
jmp r14

control_syntax_tests:
mov r13, r13 - 172
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 0
sw [r12 + 12], r7
mov r7, 0
sw [r12 + 16], r7
mov r7, 0
sw [r12 + 20], r7
mov r7, 0
sw [r12 + 24], r7
mov r7, 0
sw [r12 + 28], r7
mov r7, 0
sw [r12 + 32], r7
__control_syntax_tests_do_body_0:
mov r8, r12 + 12
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
mov r7, [r12 + 40]
__control_syntax_tests_do_condition_1:
mov r7, 0
bnz r7, r0 + __control_syntax_tests_do_body_0
__control_syntax_tests_enddo_2:
lw r7, [r12 + 12]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_3
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_4
__control_syntax_tests_else_3:
__control_syntax_tests_endif_4:
mov r7, 0
sw [r12 + 12], r7
__control_syntax_tests_do_body_5:
mov r8, r12 + 12
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
mov r7, [r12 + 40]
lw r7, [r12 + 12]
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
cmp r7, r7 < r8
bz r7, r0 + __control_syntax_tests_else_8
jmp __control_syntax_tests_do_condition_6
jmp __control_syntax_tests_endif_9
__control_syntax_tests_else_8:
__control_syntax_tests_endif_9:
mov r8, r12 + 16
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
lw r8, [r12 + 12]
mov r7, [r12 + 40]
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
__control_syntax_tests_do_condition_6:
lw r7, [r12 + 12]
mov [r12 + 36], r7
mov r8, 4
mov r7, [r12 + 36]
cmp r7, r7 < r8
bnz r7, r0 + __control_syntax_tests_do_body_5
__control_syntax_tests_enddo_7:
lw r7, [r12 + 12]
mov [r12 + 36], r7
mov r8, 4
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_10
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_11
__control_syntax_tests_else_10:
__control_syntax_tests_endif_11:
lw r7, [r12 + 16]
mov [r12 + 36], r7
mov r8, 7
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_12
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_13
__control_syntax_tests_else_12:
__control_syntax_tests_endif_13:
mov r7, 1
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_classify, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_14
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_15
__control_syntax_tests_else_14:
__control_syntax_tests_endif_15:
mov r7, 2
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_classify, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 2
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_16
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_17
__control_syntax_tests_else_16:
__control_syntax_tests_endif_17:
mov r7, 3
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_classify, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 4
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_18
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_19
__control_syntax_tests_else_18:
__control_syntax_tests_endif_19:
mov r7, 4
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_classify, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 4
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_20
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_21
__control_syntax_tests_else_20:
__control_syntax_tests_endif_21:
mov r7, 9
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_classify, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 8
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_22
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_23
__control_syntax_tests_else_22:
__control_syntax_tests_endif_23:
mov r7, 7
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_without_default, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_24
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_25
__control_syntax_tests_else_24:
__control_syntax_tests_endif_25:
mov r7, 0x63
mov [r12 + 40], r7
mov r4, [r12 + 40]
jmp switch_without_default, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_26
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_27
__control_syntax_tests_else_26:
__control_syntax_tests_endif_27:
mov r7, 1
mov [r12 + 40], r7
mov r7, 2
mov [r12 + 44], r7
mov r4, [r12 + 40]
mov r5, [r12 + 44]
jmp nested_switch_value, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 5
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_28
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_29
__control_syntax_tests_else_28:
__control_syntax_tests_endif_29:
mov r7, 1
mov [r12 + 40], r7
mov r7, 9
mov [r12 + 44], r7
mov r4, [r12 + 40]
mov r5, [r12 + 44]
jmp nested_switch_value, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 6
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_30
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_31
__control_syntax_tests_else_30:
__control_syntax_tests_endif_31:
mov r7, 9
mov [r12 + 40], r7
mov r7, 2
mov [r12 + 44], r7
mov r4, [r12 + 40]
mov r5, [r12 + 44]
jmp nested_switch_value, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 8
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_32
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_33
__control_syntax_tests_else_32:
__control_syntax_tests_endif_33:
mov r8, r12 + 20
mov [r12 + 40], r8
lw r7, [r8]
mov [r12 + 44], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 40]
sw [r8], r7
mov r7, [r12 + 44]
mov [r12 + 36], r7
mov r7, [r12 + 36]
mov r8, 0
cmp r7, r7 == r8
bnz r7, r0 + __control_syntax_tests_switch_case_35
jmp __control_syntax_tests_switch_default_36
__control_syntax_tests_switch_case_35:
mov r7, 0xA
sw [r12 + 24], r7
jmp __control_syntax_tests_switch_end_34
__control_syntax_tests_switch_default_36:
mov r7, 0x14
sw [r12 + 24], r7
__control_syntax_tests_switch_end_34:
lw r7, [r12 + 20]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_37
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_38
__control_syntax_tests_else_37:
__control_syntax_tests_endif_38:
lw r7, [r12 + 24]
mov [r12 + 36], r7
mov r8, 0xA
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_39
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_40
__control_syntax_tests_else_39:
__control_syntax_tests_endif_40:
__control_syntax_tests_while_41:
lw r7, [r12 + 28]
mov [r12 + 36], r7
mov r8, 4
mov r7, [r12 + 36]
cmp r7, r7 < r8
bz r7, r0 + __control_syntax_tests_endwhile_42
mov r8, r12 + 28
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
mov r8, 1
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
mov r7, [r12 + 40]
lw r7, [r12 + 28]
mov [r12 + 36], r7
mov r7, [r12 + 36]
mov r8, 1
cmp r7, r7 == r8
bnz r7, r0 + __control_syntax_tests_switch_case_44
mov r7, [r12 + 36]
mov r8, 2
cmp r7, r7 == r8
bnz r7, r0 + __control_syntax_tests_switch_case_45
jmp __control_syntax_tests_switch_default_46
__control_syntax_tests_switch_case_44:
jmp __control_syntax_tests_while_41
__control_syntax_tests_switch_case_45:
mov r8, r12 + 32
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
mov r8, 2
mov r7, [r12 + 40]
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
jmp __control_syntax_tests_switch_end_43
__control_syntax_tests_switch_default_46:
mov r8, r12 + 32
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
mov r8, 1
mov r7, [r12 + 40]
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
__control_syntax_tests_switch_end_43:
mov r8, r12 + 32
mov [r12 + 36], r8
lw r7, [r8]
mov [r12 + 40], r7
mov r8, 0xA
mov r7, [r12 + 40]
mov r7, r7 + r8
mov r8, [r12 + 36]
sw [r8], r7
lw r7, [r12 + 28]
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_47
jmp __control_syntax_tests_endwhile_42
jmp __control_syntax_tests_endif_48
__control_syntax_tests_else_47:
__control_syntax_tests_endif_48:
jmp __control_syntax_tests_while_41
__control_syntax_tests_endwhile_42:
lw r7, [r12 + 28]
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_49
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_50
__control_syntax_tests_else_49:
__control_syntax_tests_endif_50:
lw r7, [r12 + 32]
mov [r12 + 36], r7
mov r8, 0x17
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_51
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_52
__control_syntax_tests_else_51:
__control_syntax_tests_endif_52:
jmp loop_in_switch_value, r14
mov r7, r4
mov [r12 + 36], r7
mov r8, 5
mov r7, [r12 + 36]
cmp r7, r7 == r8
bz r7, r0 + __control_syntax_tests_else_53
lw r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, 1
mov r7, [r12 + 36]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp __control_syntax_tests_endif_54
__control_syntax_tests_else_53:
__control_syntax_tests_endif_54:
lw r4, [r12 + 8]
jmp __control_syntax_tests_return
jmp __control_syntax_tests_return
__control_syntax_tests_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 172
mov r12, r8
jmp r14

pointer_demo:
mov r13, r13 - 152
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0x28
sw [r12 + 8], r7
mov r7, r12 + 8
sw [r12 + 12], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x200
sw [r12 + 16], r7
lw r8, [r12 + 12]
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 20], r7
lw r8, [r12 + 12]
mov r7, [r12 + 20]
sw [r8], r7
lw r8, [r12 + 12]
lw r7, [r8]
mov [r12 + 20], r7
lw r8, [r12 + 16]
mov r7, [r12 + 20]
sw [r8], r7
lw r8, [r12 + 16]
lw r7, [r8]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 20], r7
lw r7, [r12 + 16]
mov [r12 + 24], r7
mov r8, 1
mov r7, [r12 + 24]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 20]
sw [r8], r7
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r8, r8 << 2
mov r8, r7 + r8
lw r4, [r8]
jmp __pointer_demo_return
jmp __pointer_demo_return
__pointer_demo_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 152
mov r12, r8
jmp r14

array_demo:
mov r13, r13 - 160
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, r12 + 8
mov [r12 + 28], r7
mov r8, 0
mov r7, [r12 + 28]
mov r8, r8 << 2
mov r7, r7 + r8
sw [r12 + 24], r7
mov r7, 3
mov [r12 + 28], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
sw [r8], r7
mov r7, 4
mov [r12 + 28], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
sw [r8], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 28], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
lw r8, [r8]
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 28], r7
lw r7, [r12 + 24]
mov [r12 + 32], r7
mov r8, 2
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
sw [r8], r7
lw r7, [r12 + 24]
mov [r12 + 32], r7
mov r8, 2
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 28], r7
lw r7, [r12 + 24]
mov [r12 + 32], r7
mov r8, 3
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
sw [r8], r7
mov r7, r12 + 8
mov [r12 + 28], r7
mov r8, 3
mov r7, [r12 + 28]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 28], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
sw [r8], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
sw [r8], r7
mov r7, r12 + 8
mov [r12 + 44], r7
mov r8, 0
mov r7, [r12 + 44]
mov r8, r8 << 2
mov r8, r7 + r8
lw r7, [r8]
mov [r12 + 40], r7
mov r7, r12 + 8
mov [r12 + 44], r7
mov r8, 1
mov r7, [r12 + 44]
mov r8, r8 << 2
mov r8, r7 + r8
lw r8, [r8]
mov r7, [r12 + 40]
mov r7, r7 + r8
mov [r12 + 36], r7
mov r7, r12 + 8
mov [r12 + 40], r7
mov r8, 2
mov r7, [r12 + 40]
mov r8, r8 << 2
mov r8, r7 + r8
lw r8, [r8]
mov r7, [r12 + 36]
mov r7, r7 + r8
mov [r12 + 32], r7
mov r7, r12 + 8
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
mov r8, r8 << 2
mov r8, r7 + r8
lw r8, [r8]
mov r7, [r12 + 32]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r7, 0x800
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
lw r8, [r8]
mov r7, [r12 + 28]
mov r4, r7 + r8
jmp __array_demo_return
jmp __array_demo_return
__array_demo_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 160
mov r12, r8
jmp r14

zero:
mov r13, r13 - 140
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r4, 7
jmp __zero_return
jmp __zero_return
__zero_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 140
mov r12, r8
jmp r14

one:
mov r13, r13 - 144
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
lw r7, [r12 + 8]
mov [r12 + 12], r7
mov r8, 1
mov r7, [r12 + 12]
mov r4, r7 + r8
jmp __one_return
jmp __one_return
__one_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 144
mov r12, r8
jmp r14

four:
mov r13, r13 - 156
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
sw [r12 + 12], r5
sw [r12 + 16], r6
sw [r12 + 20], r7
lw r7, [r12 + 8]
mov [r12 + 32], r7
lw r8, [r12 + 12]
mov r7, [r12 + 32]
mov r7, r7 + r8
mov [r12 + 28], r7
lw r8, [r12 + 16]
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 24], r7
lw r8, [r12 + 20]
mov r7, [r12 + 24]
mov r4, r7 + r8
jmp __four_return
jmp __four_return
__four_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 156
mov r12, r8
jmp r14

five:
mov r13, r13 - 160
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
sw [r12 + 12], r5
sw [r12 + 16], r6
sw [r12 + 20], r7
mov r7, [r12 + 160]
sw [r12 + 24], r7
lw r7, [r12 + 8]
mov [r12 + 40], r7
lw r8, [r12 + 12]
mov r7, [r12 + 40]
mov r7, r7 + r8
mov [r12 + 36], r7
lw r8, [r12 + 16]
mov r7, [r12 + 36]
mov r7, r7 + r8
mov [r12 + 32], r7
lw r8, [r12 + 20]
mov r7, [r12 + 32]
mov r7, r7 + r8
mov [r12 + 28], r7
lw r8, [r12 + 24]
mov r7, [r12 + 28]
mov r4, r7 + r8
jmp __five_return
jmp __five_return
__five_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 160
mov r12, r8
jmp r14

eight:
mov r13, r13 - 172
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
sw [r12 + 12], r5
sw [r12 + 16], r6
sw [r12 + 20], r7
mov r7, [r12 + 172]
sw [r12 + 24], r7
mov r7, [r12 + 176]
sw [r12 + 28], r7
mov r7, [r12 + 180]
sw [r12 + 32], r7
mov r7, [r12 + 184]
sw [r12 + 36], r7
lw r7, [r12 + 8]
mov [r12 + 64], r7
lw r8, [r12 + 12]
mov r7, [r12 + 64]
mov r7, r7 + r8
mov [r12 + 60], r7
lw r8, [r12 + 16]
mov r7, [r12 + 60]
mov r7, r7 + r8
mov [r12 + 56], r7
lw r8, [r12 + 20]
mov r7, [r12 + 56]
mov r7, r7 + r8
mov [r12 + 52], r7
lw r8, [r12 + 24]
mov r7, [r12 + 52]
mov r7, r7 + r8
mov [r12 + 48], r7
lw r8, [r12 + 28]
mov r7, [r12 + 48]
mov r7, r7 + r8
mov [r12 + 44], r7
lw r8, [r12 + 32]
mov r7, [r12 + 44]
mov r7, r7 + r8
mov [r12 + 40], r7
lw r8, [r12 + 36]
mov r7, [r12 + 40]
mov r4, r7 + r8
jmp __eight_return
jmp __eight_return
__eight_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 172
mov r12, r8
jmp r14

control_flow:
mov r13, r13 - 152
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
mov r7, 0
sw [r12 + 12], r7
mov r7, 0
sw [r12 + 16], r7
__control_flow_while_0:
lw r7, [r12 + 16]
mov [r12 + 20], r7
lw r8, [r12 + 8]
mov r7, [r12 + 20]
cmp r7, r7 < r8
bz r7, r0 + __control_flow_endwhile_1
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 16], r7
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
cmp r7, r7 == r8
bz r7, r0 + __control_flow_else_2
jmp __control_flow_while_0
jmp __control_flow_endif_3
__control_flow_else_2:
__control_flow_endif_3:
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 6
mov r7, [r12 + 20]
cmp r7, r7 > r8
bz r7, r0 + __control_flow_else_4
jmp __control_flow_endwhile_1
jmp __control_flow_endif_5
__control_flow_else_4:
__control_flow_endif_5:
lw r7, [r12 + 12]
mov [r12 + 20], r7
lw r8, [r12 + 16]
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 12], r7
jmp __control_flow_while_0
__control_flow_endwhile_1:
mov r7, 0
sw [r12 + 16], r7
__control_flow_for_6:
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 4
mov r7, [r12 + 20]
cmp r7, r7 < r8
bz r7, r0 + __control_flow_endfor_8
lw r7, [r12 + 12]
mov [r12 + 20], r7
lw r8, [r12 + 16]
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 12], r7
__control_flow_for_step_7:
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 16], r7
jmp __control_flow_for_6
__control_flow_endfor_8:
lw r7, [r12 + 12]
mov [r12 + 20], r7
mov r8, 0x19
mov r7, [r12 + 20]
cmp r7, r7 == r8
bz r7, r0 + __control_flow_else_9
jmp __control_flow_ok
jmp __control_flow_endif_10
__control_flow_else_9:
__control_flow_endif_10:
mov r7, 0
sw [r12 + 12], r7
__control_flow_ok:
lw r4, [r12 + 12]
jmp __control_flow_return
jmp __control_flow_return
__control_flow_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 152
mov r12, r8
jmp r14

unsigned_check:
mov r13, r13 - 152
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
sw [r12 + 12], r5
mov r7, 0
sw [r12 + 16], r7
lw r7, [r12 + 8]
mov [r12 + 20], r7
lw r8, [r12 + 12]
mov r7, [r12 + 20]
cmpu r7, r7 > r8
bz r7, r0 + __unsigned_check_else_0
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 16], r7
jmp __unsigned_check_endif_1
__unsigned_check_else_0:
__unsigned_check_endif_1:
lw r7, [r12 + 12]
mov [r12 + 20], r7
lw r8, [r12 + 8]
mov r7, [r12 + 20]
cmpu r7, r7 <= r8
bz r7, r0 + __unsigned_check_else_2
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 16], r7
jmp __unsigned_check_endif_3
__unsigned_check_else_2:
__unsigned_check_endif_3:
lw r7, [r12 + 8]
mov [r12 + 20], r7
lw r8, [r12 + 12]
mov r7, [r12 + 20]
cmpu r7, r7 != r8
bz r7, r0 + __unsigned_check_else_4
lw r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 4
mov r7, [r12 + 20]
mov r7, r7 + r8
sw [r12 + 16], r7
jmp __unsigned_check_endif_5
__unsigned_check_else_4:
__unsigned_check_endif_5:
lw r4, [r12 + 16]
jmp __unsigned_check_return
jmp __unsigned_check_return
__unsigned_check_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 152
mov r12, r8
jmp r14

nested_args:
mov r13, r13 - 176
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
lw r7, [r12 + 8]
mov [r12 + 16], r7
lw r7, [r12 + 8]
mov [r12 + 24], r7
mov r8, 1
mov r7, [r12 + 24]
mov r7, r7 + r8
mov [r12 + 20], r7
lw r7, [r12 + 8]
mov [r12 + 28], r7
mov r4, [r12 + 28]
jmp one, r14
mov r7, r4
mov [r12 + 24], r7
mov r7, 1
mov [r12 + 32], r7
mov r7, 2
mov [r12 + 36], r7
mov r7, 3
mov [r12 + 40], r7
mov r7, 4
mov [r12 + 44], r7
mov r4, [r12 + 32]
mov r5, [r12 + 36]
mov r6, [r12 + 40]
mov r7, [r12 + 44]
jmp four, r14
mov r7, r4
mov [r12 + 28], r7
mov r7, 1
mov [r12 + 36], r7
mov r7, 2
mov [r12 + 40], r7
mov r7, 3
mov [r12 + 44], r7
mov r7, 4
mov [r12 + 48], r7
mov r7, 5
mov [r12 + 52], r7
mov r7, 6
mov [r12 + 56], r7
mov r7, 7
mov [r12 + 60], r7
mov r7, 8
mov [r12 + 64], r7
mov r13, r13 - 16
mov r7, [r12 + 52]
mov [r13 + 0], r7
mov r7, [r12 + 56]
mov [r13 + 4], r7
mov r7, [r12 + 60]
mov [r13 + 8], r7
mov r7, [r12 + 64]
mov [r13 + 12], r7
mov r4, [r12 + 36]
mov r5, [r12 + 40]
mov r6, [r12 + 44]
mov r7, [r12 + 48]
jmp eight, r14
mov r13, r13 + 16
mov r7, r4
mov [r12 + 32], r7
mov r13, r13 - 4
mov r7, [r12 + 32]
mov [r13 + 0], r7
mov r4, [r12 + 16]
mov r5, [r12 + 20]
mov r6, [r12 + 24]
mov r7, [r12 + 28]
jmp five, r14
mov r13, r13 + 4
mov r7, r4
sw [r12 + 12], r7
lw r4, [r12 + 12]
jmp __nested_args_return
jmp __nested_args_return
__nested_args_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 176
mov r12, r8
jmp r14

expression_args:
mov r13, r13 - 164
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
sw [r12 + 12], r5
lw r7, [r12 + 8]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
lw r7, [r12 + 12]
mov [r12 + 20], r7
jmp zero, r14
mov r7, r4
mov [r12 + 24], r7
mov r7, 4
mov [r12 + 28], r7
lw r7, [r12 + 8]
mov [r12 + 36], r7
lw r8, [r12 + 12]
mov r7, [r12 + 36]
mov r7, r7 + r8
mov [r12 + 32], r7
mov r13, r13 - 4
mov r7, [r12 + 32]
mov [r13 + 0], r7
mov r4, [r12 + 16]
mov r5, [r12 + 20]
mov r6, [r12 + 24]
mov r7, [r12 + 28]
jmp five, r14
mov r13, r13 + 4
jmp __expression_args_return
jmp __expression_args_return
__expression_args_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 164
mov r12, r8
jmp r14

bit_ops:
mov r13, r13 - 148
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
sw [r12 + 8], r4
lw r7, [r12 + 8]
mov [r12 + 16], r7
mov r8, 2
mov r7, [r12 + 16]
mov r7, r7 << r8
sw [r12 + 12], r7
lw r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 0x55
mov r7, [r12 + 16]
mov r7, r7 ^ r8
sw [r12 + 12], r7
lw r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 0x7F
mov r7, [r12 + 16]
mov r7, r7 & r8
sw [r12 + 12], r7
lw r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 0x80
mov r7, [r12 + 16]
mov r7, r7 | r8
sw [r12 + 12], r7
lw r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 1
mov r7, [r12 + 16]
mov r7, r7 >>> r8
sw [r12 + 12], r7
lw r7, [r12 + 12]
mov r8, 0xFFFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, r7 ^ r8
sw [r12 + 12], r7
lw r7, [r12 + 12]
mov r7, r0 - r7
sw [r12 + 12], r7
lw r4, [r12 + 12]
jmp __bit_ops_return
jmp __bit_ops_return
__bit_ops_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 148
mov r12, r8
jmp r14

main:
mov r13, r13 - 208
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
sw [r12 + 8], r7
mov r7, 0x208
sw [r12 + 12], r7
mov r7, 0
sw [r12 + 16], r7
mov r7, 0
sw [r12 + 20], r7
mov r7, 0
sw [r12 + 24], r7
mov r7, 0
sw [r12 + 28], r7
mov r7, 0
sw [r12 + 32], r7
mov r7, 0
sw [r12 + 36], r7
mov r8, 0x800
mov r8, r8 << 16
lw r7, [r8]
sw [r12 + 40], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 4
lw r7, [r8]
sw [r12 + 44], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
jmp zero, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 4
mov [r12 + 52], r7
mov r4, [r12 + 52]
jmp one, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 1
mov [r12 + 52], r7
mov r7, 2
mov [r12 + 56], r7
mov r7, 3
mov [r12 + 60], r7
mov r7, 4
mov [r12 + 64], r7
mov r4, [r12 + 52]
mov r5, [r12 + 56]
mov r6, [r12 + 60]
mov r7, [r12 + 64]
jmp four, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 1
mov [r12 + 52], r7
mov r7, 2
mov [r12 + 56], r7
mov r7, 3
mov [r12 + 60], r7
mov r7, 4
mov [r12 + 64], r7
mov r7, 5
mov [r12 + 68], r7
mov r13, r13 - 4
mov r7, [r12 + 68]
mov [r13 + 0], r7
mov r4, [r12 + 52]
mov r5, [r12 + 56]
mov r6, [r12 + 60]
mov r7, [r12 + 64]
jmp five, r14
mov r13, r13 + 4
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 1
mov [r12 + 52], r7
mov r7, 2
mov [r12 + 56], r7
mov r7, 3
mov [r12 + 60], r7
mov r7, 4
mov [r12 + 64], r7
mov r7, 5
mov [r12 + 68], r7
mov r7, 6
mov [r12 + 72], r7
mov r7, 7
mov [r12 + 76], r7
mov r7, 8
mov [r12 + 80], r7
mov r13, r13 - 16
mov r7, [r12 + 68]
mov [r13 + 0], r7
mov r7, [r12 + 72]
mov [r13 + 4], r7
mov r7, [r12 + 76]
mov [r13 + 8], r7
mov r7, [r12 + 80]
mov [r13 + 12], r7
mov r4, [r12 + 52]
mov r5, [r12 + 56]
mov r6, [r12 + 60]
mov r7, [r12 + 64]
jmp eight, r14
mov r13, r13 + 16
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 8
mov [r12 + 52], r7
mov r4, [r12 + 52]
jmp control_flow, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0x10
lw r7, [r8]
mov [r12 + 52], r7
mov r4, [r12 + 52]
jmp nested_args, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 6
mov [r12 + 52], r7
mov r7, 7
mov [r12 + 56], r7
mov r4, [r12 + 52]
mov r5, [r12 + 56]
jmp expression_args, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
mov r7, 9
mov [r12 + 52], r7
mov r4, [r12 + 52]
jmp bit_ops, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
jmp pointer_demo, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
jmp array_demo, r14
mov r8, r4
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
jmp initializer_syntax_tests, r14
mov r7, r4
sw [r12 + 16], r7
lw r7, [r12 + 16]
mov [r12 + 48], r7
mov r8, 0x3B
mov r7, [r12 + 48]
cmp r7, r7 != r8
bz r7, r0 + __main_else_0
mov r7, 0x100
mov r7, r7 << 16
mov [r12 + 48], r7
lw r7, [r12 + 16]
mov [r12 + 52], r7
mov r8, 0xFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, [r12 + 52]
mov r8, r7 & r8
mov r7, [r12 + 48]
mov r7, r7 | r8
mov [r12 + 48], r7
lw r8, [r12 + 44]
mov r7, [r12 + 48]
sw [r8], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
lw r4, [r12 + 16]
jmp __main_return
jmp __main_endif_1
__main_else_0:
__main_endif_1:
jmp update_syntax_tests, r14
mov r7, r4
sw [r12 + 20], r7
lw r7, [r12 + 20]
mov [r12 + 48], r7
mov r8, 0x1B
mov r7, [r12 + 48]
cmp r7, r7 != r8
bz r7, r0 + __main_else_2
mov r7, 0x200
mov r7, r7 << 16
mov [r12 + 48], r7
lw r7, [r12 + 20]
mov [r12 + 52], r7
mov r8, 0xFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, [r12 + 52]
mov r8, r7 & r8
mov r7, [r12 + 48]
mov r7, r7 | r8
mov [r12 + 48], r7
lw r8, [r12 + 44]
mov r7, [r12 + 48]
sw [r8], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
lw r4, [r12 + 20]
jmp __main_return
jmp __main_endif_3
__main_else_2:
__main_endif_3:
jmp pointer_update_tests, r14
mov r7, r4
sw [r12 + 24], r7
lw r7, [r12 + 24]
mov [r12 + 48], r7
mov r8, 0xC
mov r7, [r12 + 48]
cmp r7, r7 != r8
bz r7, r0 + __main_else_4
mov r7, 0x300
mov r7, r7 << 16
mov [r12 + 48], r7
lw r7, [r12 + 24]
mov [r12 + 52], r7
mov r8, 0xFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, [r12 + 52]
mov r8, r7 & r8
mov r7, [r12 + 48]
mov r7, r7 | r8
mov [r12 + 48], r7
lw r8, [r12 + 44]
mov r7, [r12 + 48]
sw [r8], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
lw r4, [r12 + 24]
jmp __main_return
jmp __main_endif_5
__main_else_4:
__main_endif_5:
jmp conditional_syntax_tests, r14
mov r7, r4
sw [r12 + 28], r7
lw r7, [r12 + 28]
mov [r12 + 48], r7
mov r8, 9
mov r7, [r12 + 48]
cmp r7, r7 != r8
bz r7, r0 + __main_else_6
mov r7, 0x400
mov r7, r7 << 16
mov [r12 + 48], r7
lw r7, [r12 + 28]
mov [r12 + 52], r7
mov r8, 0xFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, [r12 + 52]
mov r8, r7 & r8
mov r7, [r12 + 48]
mov r7, r7 | r8
mov [r12 + 48], r7
lw r8, [r12 + 44]
mov r7, [r12 + 48]
sw [r8], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
lw r4, [r12 + 28]
jmp __main_return
jmp __main_endif_7
__main_else_6:
__main_endif_7:
jmp control_syntax_tests, r14
mov r7, r4
sw [r12 + 32], r7
lw r7, [r12 + 32]
mov [r12 + 48], r7
mov r8, 0x12
mov r7, [r12 + 48]
cmp r7, r7 != r8
bz r7, r0 + __main_else_8
mov r7, 0x500
mov r7, r7 << 16
mov [r12 + 48], r7
lw r7, [r12 + 32]
mov [r12 + 52], r7
mov r8, 0xFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, [r12 + 52]
mov r8, r7 & r8
mov r7, [r12 + 48]
mov r7, r7 | r8
mov [r12 + 48], r7
lw r8, [r12 + 44]
mov r7, [r12 + 48]
sw [r8], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
lw r4, [r12 + 32]
jmp __main_return
jmp __main_endif_9
__main_else_8:
__main_endif_9:
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 16]
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 20]
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 24]
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 28]
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 32]
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
mov r7, 0xFFFF
mov [r12 + 48], r7
mov r7, 1
mov [r12 + 52], r7
mov r4, [r12 + 48]
mov r5, [r12 + 52]
jmp unsigned_check, r14
mov r7, r4
sw [r12 + 36], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 36]
mov r7, [r12 + 48]
mov r7, r7 + r8
sw [r12 + 8], r7
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 12]
mov r7, [r12 + 48]
cmp r7, r7 == r8
bz r7, r0 + __main_else_10
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 8
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
jmp __main_endif_11
__main_else_10:
lw r7, [r12 + 8]
mov [r12 + 48], r7
lw r8, [r12 + 44]
mov r7, [r12 + 48]
sw [r8], r7
mov r8, 0x800
mov r8, r8 << 16
mov r8, r8 + 0xC
lw r7, [r8]
mov [r12 + 48], r7
lw r8, [r12 + 40]
mov r7, [r12 + 48]
sw [r8], r7
__main_endif_11:
lw r4, [r12 + 8]
jmp __main_return
jmp __main_return
__main_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 208
mov r12, r8
jmp r14

