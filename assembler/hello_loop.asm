; helloworld 循环写入程序
; 每隔约0.5秒往0x10地址写入一个字符
; 字符串: "helloworld"
; 使用标签跳转（新版汇编器支持）

start:
    MOV R8, #0x10       ; R8 = 目标地址 0x10（R0固定为0，不可写入）
    MOV R1, #0          ; R1 = 字符索引（0-9）
    MOV R7, #1          ; R7 = 常数1
    MOV R13, #0         ; R13 = 常数0

main_loop:
    ; 根据索引选择字符
    MOV R2, R1
    
    ; 索引0: 'h'
    MOV R3, #0
    BRC write_h, R1 == R3
    
    ; 索引1: 'e'
    MOV R3, #1
    BRC write_e, R1 == R3
    
    ; 索引2: 'l'
    MOV R3, #2
    BRC write_l1, R1 == R3
    
    ; 索引3: 'l'
    MOV R3, #3
    BRC write_l2, R1 == R3
    
    ; 索引4: 'o'
    MOV R3, #4
    BRC write_o1, R1 == R3
    
    ; 索引5: 'w'
    MOV R3, #5
    BRC write_w, R1 == R3
    
    ; 索引6: 'o'
    MOV R3, #6
    BRC write_o2, R1 == R3
    
    ; 索引7: 'r'
    MOV R3, #7
    BRC write_r, R1 == R3
    
    ; 索引8: 'l'
    MOV R3, #8
    BRC write_l3, R1 == R3
    
    ; 索引9: 'd'
    JMP R14, write_d

write_h:
    MOV R4, #0x68       ; 'h'
    JMP R14, do_write

write_e:
    MOV R4, #0x65       ; 'e'
    JMP R14, do_write

write_l1:
    MOV R4, #0x6C       ; 'l'
    JMP R14, do_write

write_l2:
    MOV R4, #0x6C       ; 'l'
    JMP R14, do_write

write_o1:
    MOV R4, #0x6F       ; 'o'
    JMP R14, do_write

write_w:
    MOV R4, #0x77       ; 'w'
    JMP R14, do_write

write_o2:
    MOV R4, #0x6F       ; 'o'
    JMP R14, do_write

write_r:
    MOV R4, #0x72       ; 'r'
    JMP R14, do_write

write_l3:
    MOV R4, #0x6C       ; 'l'
    JMP R14, do_write

write_d:
    MOV R4, #0x64       ; 'd'

do_write:
    ; 写入字符到地址0x10
    MOV [R8], R4
    
    ; 延时约0.5秒
    MOV R10, #100       ; 外层循环

delay_outer:
    MOV R11, #100       ; 中层循环
    
delay_mid:
    MOV R12, #50        ; 内层循环
    
delay_inner:
    MOV R12, R12 - R7   ; R12--
    MOV R14, R12
    MOV R14, R14 - R13  ; R14 = R12 - 0
    BRC R13, R14 == R13 ; 如果R12==0，跳过JMP
    JMP R15, delay_inner
    
    ; 内层结束，中层循环控制
    MOV R11, R11 - R7   ; R11--
    MOV R14, R11
    MOV R14, R14 - R13
    BRC R13, R14 == R13 ; 如果R11==0，跳过JMP
    JMP R15, delay_mid
    
    ; 中层结束，外层循环控制
    MOV R10, R10 - R7   ; R10--
    MOV R14, R10
    MOV R14, R14 - R13
    BRC R13, R14 == R13 ; 如果R10==0，延时结束
    JMP R15, delay_outer
    
    ; 延时结束，更新索引
    MOV R1, R1 + R7     ; R1++
    
    ; 检查是否超过9
    MOV R2, #10
    BRC reset_index, R1 >= R2
    
    ; 继续下一个字符
    JMP R14, main_loop

reset_index:
    MOV R1, #0          ; 索引归零
    JMP R14, main_loop
