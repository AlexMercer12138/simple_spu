; SASS Assembly Example Program
; This demonstrates all supported syntax

start:
    ; Load immediate values
    MOV R0, #0          ; R0 = 0
    MOV R1, #10         ; R1 = 10
    MOV R2, #-1         ; R2 = -1 (0xFFFF)
    MOV R3, #0xFF       ; R3 = 255

loop:
    ; ALU operations (I-Type)
    MOV R0, R0 + #1     ; R0 = R0 + 1
    MOV R4, R1 - #5     ; R4 = R1 - 5
    MOV R5, R2 & #0xFF  ; R5 = R2 & 0xFF
    MOV R6, R3 | #0xF0  ; R6 = R3 | 0xF0
    MOV R7, R1 ^ R2     ; R7 = R1 ^ R2
    MOV R8, R1 << #2    ; R8 = R1 << 2
    MOV R9, R2 >> #4    ; R9 = R2 >> 4 (logical)
    MOV R10, R2 >>> #4  ; R10 = R2 >>> 4 (arithmetic)

    ; Memory access
    MOV R11, [R0]           ; Load from [R0]
    MOV R12, [R0 + #4]      ; Load from [R0 + 4]
    MOV [R1], R11           ; Store to [R1]
    MOV [R1 + R0], R12      ; Store to [R1 + R0]

    ; Register operations
    MOV R13, R0         ; R13 = R0

    ; Jump instructions
    JMP R14, #100       ; Jump to address 100
    JMP R14, loop       ; Jump to loop label
    JMP R15, R0         ; Jump to address in R0

    ; Branch instructions
    BRC R0, R1 == R2    ; Branch if R1 == R2
    BRC #50, R3 != R4   ; Branch to 50 if R3 != R4
    BRC end, R5 < R6    ; Branch if R5 < R6 (signed)
    BRC start, R7 >= R8 ; Branch if R7 >= R8 (signed)

end:
    JMP R0, #0          ; Return to start
