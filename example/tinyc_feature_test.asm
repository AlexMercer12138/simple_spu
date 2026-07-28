.prog tinyc_feature_test
.entry __start

__start:
mov r13, 0x84
mov r13, r13 << 16
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x3C0
mov r8, 0x80
mov r8, r8 << 16
mov [r8], r7
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x3C4
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 4
mov [r8], r7
mov r7, 0x600D
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 8
mov [r8], r7
mov r7, 0xBAD
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0xC
mov [r8], r7
mov r7, 3
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0x10
mov [r8], r7
mov r7, 0
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0x14
mov [r8], r7
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0x18
mov [r8], r7
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0x1C
mov [r8], r7
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0x20
mov [r8], r7
jmp main, r14
__halt:
jmp __halt

pointer_demo:
mov r13, r13 - 152
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0x28
mov [r12 + 8], r7
mov r7, r12 + 8
mov [r12 + 12], r7
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x200
mov [r12 + 16], r7
mov r8, [r12 + 12]
mov r7, [r8]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 20], r7
mov r8, [r12 + 12]
mov r7, [r12 + 20]
mov [r8], r7
mov r8, [r12 + 12]
mov r7, [r8]
mov [r12 + 20], r7
mov r8, [r12 + 16]
mov r7, [r12 + 20]
mov [r8], r7
mov r8, [r12 + 16]
mov r7, [r8]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 20], r7
mov r7, [r12 + 16]
mov [r12 + 24], r7
mov r8, 1
mov r7, [r12 + 24]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 20]
mov [r8], r7
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r8, r8 << 2
mov r8, r7 + r8
mov r4, [r8]
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
mov [r12 + 24], r7
mov r7, 3
mov [r12 + 28], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
mov [r8], r7
mov r7, 4
mov [r12 + 28], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
mov [r8], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r8]
mov [r12 + 28], r7
mov r7, r12 + 8
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r8, [r8]
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r7, [r12 + 24]
mov [r12 + 32], r7
mov r8, 2
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
mov [r8], r7
mov r7, [r12 + 24]
mov [r12 + 32], r7
mov r8, 2
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r7, [r12 + 24]
mov [r12 + 32], r7
mov r8, 3
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
mov [r8], r7
mov r7, r12 + 8
mov [r12 + 28], r7
mov r8, 3
mov r7, [r12 + 28]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r8]
mov [r12 + 28], r7
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
mov [r8], r7
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 0
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r8]
mov [r12 + 28], r7
mov r8, 1
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r12 + 28]
mov [r8], r7
mov r7, r12 + 8
mov [r12 + 44], r7
mov r8, 0
mov r7, [r12 + 44]
mov r8, r8 << 2
mov r8, r7 + r8
mov r7, [r8]
mov [r12 + 40], r7
mov r7, r12 + 8
mov [r12 + 44], r7
mov r8, 1
mov r7, [r12 + 44]
mov r8, r8 << 2
mov r8, r7 + r8
mov r8, [r8]
mov r7, [r12 + 40]
mov r7, r7 + r8
mov [r12 + 36], r7
mov r7, r12 + 8
mov [r12 + 40], r7
mov r8, 2
mov r7, [r12 + 40]
mov r8, r8 << 2
mov r8, r7 + r8
mov r8, [r8]
mov r7, [r12 + 36]
mov r7, r7 + r8
mov [r12 + 32], r7
mov r7, r12 + 8
mov [r12 + 36], r7
mov r8, 3
mov r7, [r12 + 36]
mov r8, r8 << 2
mov r8, r7 + r8
mov r8, [r8]
mov r7, [r12 + 32]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r7, 0x80
mov r7, r7 << 16
mov r7, r7 + 0x14
mov [r12 + 32], r7
mov r8, 1
mov r7, [r12 + 32]
mov r8, r8 << 2
mov r8, r7 + r8
mov r8, [r8]
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
mov [r12 + 8], r4
mov r7, [r12 + 8]
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
mov [r12 + 8], r4
mov [r12 + 12], r5
mov [r12 + 16], r6
mov [r12 + 20], r7
mov r7, [r12 + 8]
mov [r12 + 32], r7
mov r8, [r12 + 12]
mov r7, [r12 + 32]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r8, [r12 + 16]
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 24], r7
mov r8, [r12 + 20]
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
mov [r12 + 8], r4
mov [r12 + 12], r5
mov [r12 + 16], r6
mov [r12 + 20], r7
mov r7, [r12 + 160]
mov [r12 + 24], r7
mov r7, [r12 + 8]
mov [r12 + 40], r7
mov r8, [r12 + 12]
mov r7, [r12 + 40]
mov r7, r7 + r8
mov [r12 + 36], r7
mov r8, [r12 + 16]
mov r7, [r12 + 36]
mov r7, r7 + r8
mov [r12 + 32], r7
mov r8, [r12 + 20]
mov r7, [r12 + 32]
mov r7, r7 + r8
mov [r12 + 28], r7
mov r8, [r12 + 24]
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
mov [r12 + 8], r4
mov [r12 + 12], r5
mov [r12 + 16], r6
mov [r12 + 20], r7
mov r7, [r12 + 172]
mov [r12 + 24], r7
mov r7, [r12 + 176]
mov [r12 + 28], r7
mov r7, [r12 + 180]
mov [r12 + 32], r7
mov r7, [r12 + 184]
mov [r12 + 36], r7
mov r7, [r12 + 8]
mov [r12 + 64], r7
mov r8, [r12 + 12]
mov r7, [r12 + 64]
mov r7, r7 + r8
mov [r12 + 60], r7
mov r8, [r12 + 16]
mov r7, [r12 + 60]
mov r7, r7 + r8
mov [r12 + 56], r7
mov r8, [r12 + 20]
mov r7, [r12 + 56]
mov r7, r7 + r8
mov [r12 + 52], r7
mov r8, [r12 + 24]
mov r7, [r12 + 52]
mov r7, r7 + r8
mov [r12 + 48], r7
mov r8, [r12 + 28]
mov r7, [r12 + 48]
mov r7, r7 + r8
mov [r12 + 44], r7
mov r8, [r12 + 32]
mov r7, [r12 + 44]
mov r7, r7 + r8
mov [r12 + 40], r7
mov r8, [r12 + 36]
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
mov [r12 + 8], r4
mov r7, 0
mov [r12 + 12], r7
mov r7, 0
mov [r12 + 16], r7
__control_flow_while_0:
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, [r12 + 8]
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brc __control_flow_cmp_true_2, "<"
jmp __control_flow_cmp_end_3
__control_flow_cmp_true_2:
mov r7, 1
__control_flow_cmp_end_3:
cmp r7, 0
brc __control_flow_endwhile_1, "=="
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brc __control_flow_cmp_true_6, "=="
jmp __control_flow_cmp_end_7
__control_flow_cmp_true_6:
mov r7, 1
__control_flow_cmp_end_7:
cmp r7, 0
brc __control_flow_else_4, "=="
jmp __control_flow_while_0
jmp __control_flow_endif_5
__control_flow_else_4:
__control_flow_endif_5:
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 6
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brc __control_flow_cmp_true_10, ">"
jmp __control_flow_cmp_end_11
__control_flow_cmp_true_10:
mov r7, 1
__control_flow_cmp_end_11:
cmp r7, 0
brc __control_flow_else_8, "=="
jmp __control_flow_endwhile_1
jmp __control_flow_endif_9
__control_flow_else_8:
__control_flow_endif_9:
mov r7, [r12 + 12]
mov [r12 + 20], r7
mov r8, [r12 + 16]
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 12], r7
jmp __control_flow_while_0
__control_flow_endwhile_1:
mov r7, 0
mov [r12 + 16], r7
__control_flow_for_12:
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 4
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brc __control_flow_cmp_true_15, "<"
jmp __control_flow_cmp_end_16
__control_flow_cmp_true_15:
mov r7, 1
__control_flow_cmp_end_16:
cmp r7, 0
brc __control_flow_endfor_14, "=="
mov r7, [r12 + 12]
mov [r12 + 20], r7
mov r8, [r12 + 16]
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 12], r7
__control_flow_for_step_13:
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
jmp __control_flow_for_12
__control_flow_endfor_14:
mov r7, [r12 + 12]
mov [r12 + 20], r7
mov r8, 0x19
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brc __control_flow_cmp_true_19, "=="
jmp __control_flow_cmp_end_20
__control_flow_cmp_true_19:
mov r7, 1
__control_flow_cmp_end_20:
cmp r7, 0
brc __control_flow_else_17, "=="
jmp __control_flow_ok
jmp __control_flow_endif_18
__control_flow_else_17:
__control_flow_endif_18:
mov r7, 0
mov [r12 + 12], r7
__control_flow_ok:
mov r4, [r12 + 12]
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
mov [r12 + 8], r4
mov [r12 + 12], r5
mov r7, 0
mov [r12 + 16], r7
mov r7, [r12 + 8]
mov [r12 + 20], r7
mov r8, [r12 + 12]
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brcu __unsigned_check_cmp_true_2, ">"
jmp __unsigned_check_cmp_end_3
__unsigned_check_cmp_true_2:
mov r7, 1
__unsigned_check_cmp_end_3:
cmp r7, 0
brc __unsigned_check_else_0, "=="
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
jmp __unsigned_check_endif_1
__unsigned_check_else_0:
__unsigned_check_endif_1:
mov r7, [r12 + 12]
mov [r12 + 20], r7
mov r8, [r12 + 8]
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brcu __unsigned_check_cmp_true_6, "<="
jmp __unsigned_check_cmp_end_7
__unsigned_check_cmp_true_6:
mov r7, 1
__unsigned_check_cmp_end_7:
cmp r7, 0
brc __unsigned_check_else_4, "=="
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 2
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
jmp __unsigned_check_endif_5
__unsigned_check_else_4:
__unsigned_check_endif_5:
mov r7, [r12 + 8]
mov [r12 + 20], r7
mov r8, [r12 + 12]
mov r7, [r12 + 20]
cmp r7, r8
mov r7, 0
brcu __unsigned_check_cmp_true_10, "!="
jmp __unsigned_check_cmp_end_11
__unsigned_check_cmp_true_10:
mov r7, 1
__unsigned_check_cmp_end_11:
cmp r7, 0
brc __unsigned_check_else_8, "=="
mov r7, [r12 + 16]
mov [r12 + 20], r7
mov r8, 4
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
jmp __unsigned_check_endif_9
__unsigned_check_else_8:
__unsigned_check_endif_9:
mov r4, [r12 + 16]
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
mov [r12 + 8], r4
mov r7, [r12 + 8]
mov [r12 + 16], r7
mov r7, [r12 + 8]
mov [r12 + 24], r7
mov r8, 1
mov r7, [r12 + 24]
mov r7, r7 + r8
mov [r12 + 20], r7
mov r7, [r12 + 8]
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
mov [r12 + 12], r7
mov r4, [r12 + 12]
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
mov [r12 + 8], r4
mov [r12 + 12], r5
mov r7, [r12 + 8]
mov [r12 + 20], r7
mov r8, 1
mov r7, [r12 + 20]
mov r7, r7 + r8
mov [r12 + 16], r7
mov r7, [r12 + 12]
mov [r12 + 20], r7
jmp zero, r14
mov r7, r4
mov [r12 + 24], r7
mov r7, 4
mov [r12 + 28], r7
mov r7, [r12 + 8]
mov [r12 + 36], r7
mov r8, [r12 + 12]
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
mov [r12 + 8], r4
mov r7, [r12 + 8]
mov [r12 + 16], r7
mov r8, 2
mov r7, [r12 + 16]
mov r7, r7 << r8
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 0x55
mov r7, [r12 + 16]
mov r7, r7 ^ r8
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 0x7F
mov r7, [r12 + 16]
mov r7, r7 & r8
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 0x80
mov r7, [r12 + 16]
mov r7, r7 | r8
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov [r12 + 16], r7
mov r8, 1
mov r7, [r12 + 16]
mov r7, r7 >>> r8
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov r8, 0xFFFF
mov r8, r8 << 16
mov r8, r8 + 0xFFFF
mov r7, r7 ^ r8
mov [r12 + 12], r7
mov r7, [r12 + 12]
mov r7, r0 - r7
mov [r12 + 12], r7
mov r4, [r12 + 12]
jmp __bit_ops_return
jmp __bit_ops_return
__bit_ops_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 148
mov r12, r8
jmp r14

main:
mov r13, r13 - 188
mov [r13 + 0], r14
mov [r13 + 4], r12
mov r12, r13
mov r7, 0
mov [r12 + 8], r7
mov r7, 0x18B
mov [r12 + 12], r7
mov r7, 0
mov [r12 + 16], r7
mov r8, 0x80
mov r8, r8 << 16
mov r7, [r8]
mov [r12 + 20], r7
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 4
mov r7, [r8]
mov [r12 + 24], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
jmp zero, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r7, 4
mov [r12 + 32], r7
mov r4, [r12 + 32]
jmp one, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
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
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r7, 1
mov [r12 + 32], r7
mov r7, 2
mov [r12 + 36], r7
mov r7, 3
mov [r12 + 40], r7
mov r7, 4
mov [r12 + 44], r7
mov r7, 5
mov [r12 + 48], r7
mov r13, r13 - 4
mov r7, [r12 + 48]
mov [r13 + 0], r7
mov r4, [r12 + 32]
mov r5, [r12 + 36]
mov r6, [r12 + 40]
mov r7, [r12 + 44]
jmp five, r14
mov r13, r13 + 4
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r7, 1
mov [r12 + 32], r7
mov r7, 2
mov [r12 + 36], r7
mov r7, 3
mov [r12 + 40], r7
mov r7, 4
mov [r12 + 44], r7
mov r7, 5
mov [r12 + 48], r7
mov r7, 6
mov [r12 + 52], r7
mov r7, 7
mov [r12 + 56], r7
mov r7, 8
mov [r12 + 60], r7
mov r13, r13 - 16
mov r7, [r12 + 48]
mov [r13 + 0], r7
mov r7, [r12 + 52]
mov [r13 + 4], r7
mov r7, [r12 + 56]
mov [r13 + 8], r7
mov r7, [r12 + 60]
mov [r13 + 12], r7
mov r4, [r12 + 32]
mov r5, [r12 + 36]
mov r6, [r12 + 40]
mov r7, [r12 + 44]
jmp eight, r14
mov r13, r13 + 16
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r7, 8
mov [r12 + 32], r7
mov r4, [r12 + 32]
jmp control_flow, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0x10
mov r7, [r8]
mov [r12 + 32], r7
mov r4, [r12 + 32]
jmp nested_args, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r7, 6
mov [r12 + 32], r7
mov r7, 7
mov [r12 + 36], r7
mov r4, [r12 + 32]
mov r5, [r12 + 36]
jmp expression_args, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r7, 9
mov [r12 + 32], r7
mov r4, [r12 + 32]
jmp bit_ops, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
jmp pointer_demo, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
jmp array_demo, r14
mov r8, r4
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, 0xFFFF
mov [r12 + 28], r7
mov r7, 1
mov [r12 + 32], r7
mov r4, [r12 + 28]
mov r5, [r12 + 32]
jmp unsigned_check, r14
mov r7, r4
mov [r12 + 16], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, [r12 + 16]
mov r7, [r12 + 28]
mov r7, r7 + r8
mov [r12 + 8], r7
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, [r12 + 12]
mov r7, [r12 + 28]
cmp r7, r8
mov r7, 0
brc __main_cmp_true_2, "=="
jmp __main_cmp_end_3
__main_cmp_true_2:
mov r7, 1
__main_cmp_end_3:
cmp r7, 0
brc __main_else_0, "=="
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 8
mov r7, [r8]
mov [r12 + 28], r7
mov r8, [r12 + 20]
mov r7, [r12 + 28]
mov [r8], r7
jmp __main_endif_1
__main_else_0:
mov r7, [r12 + 8]
mov [r12 + 28], r7
mov r8, [r12 + 24]
mov r7, [r12 + 28]
mov [r8], r7
mov r8, 0x80
mov r8, r8 << 16
mov r8, r8 + 0xC
mov r7, [r8]
mov [r12 + 28], r7
mov r8, [r12 + 20]
mov r7, [r12 + 28]
mov [r8], r7
__main_endif_1:
mov r4, [r12 + 8]
jmp __main_return
jmp __main_return
__main_return:
mov r14, [r12 + 0]
mov r8, [r12 + 4]
mov r13, r12 + 188
mov r12, r8
jmp r14

