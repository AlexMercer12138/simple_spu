// ============================================================================
// 串口测试程序 - 周期打印 "hello world!" 并通过中断回显输入数据
// ----------------------------------------------------------------------------
// 外设地址映射 (APB UART base = 0x10000000):
//  0   uart_ctrl       [0]=rx_en [2:1]=rx_cnt_max [4]=tx_en [6:5]=tx_cnt_max [31]=soft_rst
//  4   uart_config     [23:0]=baud_div [30:29]=parity [31]=stop_bit
//  8   uart_rx_buf     RX 4字节缓存（读后自动清 ptr）
//  12  uart_rx_status  [8]=rx_ready [8]=rx_valid [5:2]=fifo_cnt [1:0]=ptr
//  16  uart_tx_buf     TX 4字节缓存（写入后自动清 ptr）
//  20  uart_tx_status  [9]=tx_valid [8]=tx_ready [7:6]=tx_cnt [5:2]=fifo_cnt [1:0]=ptr
//  24  uart_interrupt  [0]=int_en [2:1]=int_type (0:rx_valid 1:tx_ready 2:rx_cnt 3:tx_cnt)
//
// 波特率: 115200
//
// 寄存器分配:
//   r0  : 硬件归零
//   r1  : 中断控制 (使能 + 触发方式)
//   r2  : 中断向量地址
//   r3  : 硬件中断返回地址
//   r4  : UART 基址 0x10000000
//   r5  : 通用临时
//   r6  : 延时计数最大值
//   r7  : 延时计数器
//   r8  : 中断读取数据寄存器
//   r14 : JAL 链接寄存器占位
//   r15 : 程序指针寄存器
// ============================================================================

.equ UART_BASE        0x1000    // 0x10000000 >> 16 = 0x1000
.equ UART_BAUD_RATE   0xE100    // 115200 >> 1 = 57600
.equ UART_INT_RX      0x0001    // int_en=1, type=0 (rx_valid)
.equ DELAY_HIGH       0x00FF    // 延时高16位; (0xFF<<16)*3周期 ≈ 1s @50MHz

.macro interrupt_enable()
    mov r1, r1 | 0x0001 // 开启中断使能
.endm

.macro interrupt_disable()
    mov r1, r1 & 0xFFFE // 关闭中断使能
.endm

.macro return_main()
jmp r3              // 返回主循环
.endm

.macro branch_eq(target, lhs, rhs)
    cmp lhs, rhs
    brc target, "eq"
.endm

.macro branch_ne(target, lhs, rhs)
    cmp lhs, rhs
    brc target, "ne"
.endm

.macro UartSendByte(Rbase, Rbyte, value)
    mov Rbyte, [Rbase + 20]
    mov Rbyte, Rbyte >> 9
    cmp Rbyte, 0x1
    mov Rbyte, 0
    mov Rbyte, Rbyte - 12
    brc r15 + Rbyte, "eq"
    mov Rbyte, value
    mov Rbyte, Rbyte << 24
    mov [Rbase + 16], Rbyte
    mov Rbyte, 0x0010
    mov [Rbase], Rbyte
.endm

.macro UartSendInt(Rbase, Rint, valhi, vallo)
    mov Rint, [Rbase + 20]
    mov Rint, Rint >> 9
    cmp Rint, 0x1
    mov Rint, 0
    mov Rint, Rint - 12
    brc r15 + Rint, "eq"
    mov Rint, valhi
    mov Rint, Rint << 16
    mov Rint, Rint + vallo
    mov [Rbase + 16], Rint
    mov Rint, 0x0070
    mov [Rbase], Rint
.endm

.macro UartSendByteR(Rbase, Rbyte, Rsrc)
    mov Rbyte, [Rbase + 20]
    mov Rbyte, Rbyte >> 9
    cmp Rbyte, 0x1
    mov Rbyte, 0
    mov Rbyte, Rbyte - 12
    brc r15 + Rbyte, "eq"
    mov Rbyte, Rsrc
    mov Rbyte, Rbyte << 24
    mov [Rbase + 16], Rbyte
    mov Rbyte, 0x0010
    mov [Rbase], Rbyte
.endm

.macro UartRecvByte(Rbase, Rbyte)
    mov Rbyte, 0x0001
    mov [Rbase], Rbyte
    mov Rbyte, [Rbase + 8]
    mov Rbyte, Rbyte >> 24
.endm

// .equ sim

// ---------------------------- 初始化 ----------------------------------------
start:
    // 构造 UART 基地址 0x10000000
    mov r4, UART_BASE       // r4 = 0x1000
    mov r4, r4 << 16        // r4 = 0x10000000

    // 配置波特率寄存器 (offset 0x04)
    mov r5, UART_BAUD_RATE  // r5 = 57600
    mov r5, r5 << 1         // r5 = 115200
    mov [r4 + 4], r5        // write 0x10000004 = r5

    // 配置 UART 中断源: rx_valid 触发
    mov r5, UART_INT_RX     // r5 = 1
    mov [r4 + 24], r5       // offset 0x18

    // 配置 CPU 中断: 上升沿触发, 跳转到 isr
    mov r5, isr             // 保存中断跳转地址
    mov r2, r5
    mov r1, 1               // 中断使能，上升沿触发

    // 延时常量
    mov r6, DELAY_HIGH
.ifdef sim
    mov r6, r6 << 6         // r6 = 0x00000FF0
.else
    mov r6, r6 << 16        // r6 = 0x00FF0000
.endif

// ----------------------------- 主循环 ---------------------------------------
main_loop:

    UartSendInt(r4, r5, 0x4865, 0x6c6c) // "Hell"
    UartSendInt(r4, r5, 0x6f20, 0x776f) // "o wo"
    UartSendInt(r4, r5, 0x726c, 0x6421) // "rld!"
    UartSendByte(r4, r5, 0x0a) // "\n"
    UartSendByte(r4, r5, 0x0d) // "\r"

delay:
    mov r7, r7 + 1
    branch_ne(delay, r7, r6)
    mov r7, 0
    jmp main_loop, r14

// ---------------------------- 中断服务程序 ----------------------------------
// 触发条件: rx_valid 上升沿 (接收 FIFO 有数据)
// 行为 : 字符回显
isr:
    interrupt_disable()         // 关闭中断使能

    UartRecvByte(r4, r8)        // Read byte from fifo
    UartSendByteR(r4, r5, r8)   // Loopback

    interrupt_enable()          // 开启中断使能
    return_main()               // 返回主循环
