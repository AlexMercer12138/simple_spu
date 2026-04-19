// helloworld 滑动窗口循环写入程序
// 每间隔1秒，循环写入4字节滑动窗口到0x44000000地址
// 窗口序列: "hell" -> "ello" -> "llow" -> "lowo" -> "owor" -> "worl" -> "orld" -> "rldh" -> "ldhe" -> "dhel" -> "hell"...
// 使用策略：每次左移8位并添加新字符
//
// 寄存器分配：
// R1  = 字符索引 (0-9)
// R2  = 目标地址 (0x44000000)
// R3  = 延时循环计数器
// R4  = 计数器最大值
// R5  = 当前字符
// R6  = 完整字符串
// R7  = 索引最大值
// R8  = 分支条件临时寄存器
// R9  = 待定
// R10 = 待定
// R11 = 待定
// R12 = 待定
// R13 = 待定
// R14 = 待定
// R15 = 待定

start:
    // 寄存器初始化
    MOV R1, #0          // R1 = 字符索引（0-9）
    MOV R2, #0x4400     // R2 = 0x4400（目标地址高16位）
    MOV R4, #255        // R4 = 255 (用于计数)
    MOV R7, #9          // R7 = 9 (索引最大值)
    
    // 大数字二次计算：
    // 目标地址 0x44000000
    MOV R2, R2 << #16   // R2 = 0x4400 << 16 = 0x44000000
    // 计数器计满1秒左右
    MOV R4, R4 << #16   // R4 = 255 << 16 = 16,711,680（指令周期）
    // 单指令周期 = 3，总周期 = 16,711,680 * 3 = 50,135,040（50MHz时钟下约等于1秒）

   main_loop:
    // ============================================================
    // 字符序列: h(0), e(1), l(2), l(3), o(4), w(5), o(6), r(7), l(8), d(9)
    // ============================================================
    
    // ----- 加载当前字符 (索引 = R1) -----
    MOV R8, #0                  // R8 = 0
    BRC char_eq0, R1 == R8      // R1 == 0 -> 'h'(0x68)
    MOV R8, #1                  // R8 = 1
    BRC char_eq1, R1 == R8      // R1 == 1 -> 'e'(0x65)
    MOV R8, #2                  // R8 = 2
    BRC char_eq2, R1 == R8      // R1 == 2 -> 'l'(0x6C)
    MOV R8, #3                  // R8 = 3
    BRC char_eq3, R1 == R8      // R1 == 3 -> 'l'(0x6C)
    MOV R8, #4                  // R8 = 4
    BRC char_eq4, R1 == R8      // R1 == 4 -> 'o'(0x6F)
    MOV R8, #5                  // R8 = 5
    BRC char_eq5, R1 == R8      // R1 == 5 -> 'w'(0x77)
    MOV R8, #6                  // R8 = 6
    BRC char_eq6, R1 == R8      // R1 == 6 -> 'o'(0x6F)
    MOV R8, #7                  // R8 = 7
    BRC char_eq7, R1 == R8      // R1 == 7 -> 'r'(0x72)
    MOV R8, #8                  // R8 = 8
    BRC char_eq8, R1 == R8      // R1 == 8 -> 'l'(0x6C)
    JMP char_eq9, R12           // R1 == 9 -> 'd'(0x64)

char_eq0:
    MOV R5, #0x68       // 'h'
    JMP load_char, R12
char_eq1:
    MOV R5, #0x65       // 'e'
    JMP load_char, R12
char_eq2:
    MOV R5, #0x6C       // 'l'
    JMP load_char, R12
char_eq3:
    MOV R5, #0x6C       // 'l'
    JMP load_char, R12
char_eq4:
    MOV R5, #0x6F       // 'o'
    JMP load_char, R12
char_eq5:
    MOV R5, #0x77       // 'w'
    JMP load_char, R12
char_eq6:
    MOV R5, #0x6F       // 'o'
    JMP load_char, R12
char_eq7:
    MOV R5, #0x72       // 'r'
    JMP load_char, R12
char_eq8:
    MOV R5, #0x6C       // 'l'
    JMP load_char, R12
char_eq9:
    MOV R5, #0x64       // 'd'

load_char:
    // ----- 加载字符到队列并递增 -----
    MOV R6, R6 << #8    // R6 = R6 << 8(队列左移)
    MOV R6, R6 | R5     // R6 = R6 | R5(添加字符到队列)
    MOV R3, #0          // R3 = 0(计数器清零)
    BRC index_clear, R1 == R7    // 如果 R1 为最大值，清零索引
    JMP index_incr, R12 // 否则索引递增

index_clear:
    // 清空字符索引
    MOV R1, #0          // R1 = 0
    JMP store, R12      // 去写入内存

index_incr:
    // 字符索引递增
    MOV R1, R1 + #1     // R1 = R1 + 1
    JMP store, R12      // 去写入内存

store:
    // 保存字符队列到目标地址 0x44000000
    MOV [R2], R6        // MEM[R2] = R6

delay:
    // 循环计数延时
    MOV R3, R3 + #1     // R3 = R3 + 1
    BRC delay, R3 < R4  // 如果计数器值小于最大值，继续递增
    JMP main_loop, R12  // 否则回到主循环
