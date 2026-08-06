# MERC32 指令集参考

本文档描述当前 `rtl/cpu/core.v` 实现的 32 位 MERC32 指令集，以及
`merc32-vsce` 汇编器接受的标准语法。所有地址均为字节地址。

## 1. 指令格式

每条指令固定为 32 位：

```text
31                 16 15    12 11     8 7      4 3      0
+--------------------+--------+--------+--------+--------+
| imm[15:0] / rs1    |  rs2   |   rd   | opcode | funct  |
+--------------------+--------+--------+--------+--------+
```

| 字段 | 位宽 | 含义 |
|---|---:|---|
| `imm` | 16 | I-Type 立即数原始位模式 |
| `rs1` | 4 | R-Type 的第二源寄存器，位于 `[19:16]` |
| `rs2` | 4 | 第一源寄存器或地址基址 |
| `rd` | 4 | 结果寄存器；store 时为写数据源，branch 时为条件寄存器 |
| `opcode` | 4 | 操作数形式和指令组 |
| `funct` | 4 | 具体操作 |

### 1.1 Opcode

| Opcode | 名称 | 含义 |
|---:|---|---|
| `0x0` | IALU | ALU，右操作数为 `imm` |
| `0x1` | RALU | ALU，右操作数为 `R[rs1]` |
| `0x2` | IPCU | 比较/分支/跳转，目标或右操作数为 `imm` |
| `0x3` | RPCU | 比较/分支/跳转，目标或右操作数为 `R[rs1]` |
| `0x4` | IMCU | 访存，偏移为 `imm` |
| `0x5` | RMCU | 访存，偏移为 `R[rs1]` |

### 1.2 立即数规则

硬件不会为所有指令统一扩展立即数，具体规则如下：

| 指令 | `imm16` 的解释 |
|---|---|
| SET、ADD、SUB、逻辑、移位 | 零扩展 |
| MUL、DIV、REM | 符号扩展 |
| DIVU、REMU | 零扩展 |
| 有符号比较及 EQ/NE | 符号扩展 |
| 无符号关系比较 | 零扩展 |
| JAL、BZ、BNZ、load/store 地址 | 零扩展后与基址相加 |

因此地址类指令中的 `0xffff` 表示正偏移 65535。汇编器虽然允许
`jmp r8 - 4` 形式并编码为 `0xfffc`，硬件实际执行的是
`R[r8] + 65532`，不是减 4。需要负偏移时应先在寄存器中计算目标地址。

十进制立即数接受 `-32768..32767`，带 `0x` 或 `0b` 前缀的原始位模式
接受 `0..0xffff`。

## 2. 寄存器

| 寄存器 | 硬件/ABI用途 |
|---|---|
| `r0` | 零寄存器，读出为 0，写入无效 |
| `r1` | 中断控制：`[0]` 使能，`[2:1]` 触发方式 |
| `r2` | 中断入口字节地址 |
| `r3` | 中断返回字节地址，接受中断时由硬件写入 |
| `r4-r11` | ABI 参数、返回值和临时寄存器 |
| `r12` | 帧指针 FP |
| `r13` | 栈指针 SP |
| `r14` | 链接寄存器 LR |
| `r15` | 当前指令 PC 的软件可读写视图，不可通过写入改变控制流 |

`r1-r15` 均可由软件读写，以支持上下文保存和恢复；可写不代表其专用功能
被取消。跳转必须使用 JAL、BZ 或 BNZ。

## 3. ALU 指令

ALU funct：

| Funct | 操作 | 汇编语法 |
|---:|---|---|
| `0x0` | SET | `mov rd, imm` |
| `0x1` | ADD | `mov rd, rs2 + rhs` |
| `0x2` | SUB | `mov rd, rs2 - rhs` |
| `0x3` | AND | `mov rd, rs2 & rhs` |
| `0x4` | OR | `mov rd, rs2 | rhs` |
| `0x5` | XOR | `mov rd, rs2 ^ rhs` |
| `0x6` | SLL | `mov rd, rs2 << rhs` |
| `0x7` | SRL | `mov rd, rs2 >> rhs` |
| `0x8` | SRA | `mov rd, rs2 >>> rhs` |
| `0x9` | MUL | `mul rd, rs2, rhs` |
| `0xA` | DIV | `div rd, rs2, rhs` |
| `0xB` | DIVU | `divu rd, rs2, rhs` |
| `0xC` | REM | `rem rd, rs2, rhs` |
| `0xD` | REMU | `remu rd, rs2, rhs` |

其中 `rhs` 可以是寄存器或 16 位立即数。寄存器形式使用 RALU，立即数形式
使用 IALU。

```asm
mov  r4, 100
mov  r5, r4 + 3
mov  r6, r4 + r5
mul  r7, r5, r6
div  r8, r7, -2
divu r9, r7, 10
rem  r10, r7, r6
remu r11, r7, 0xffff
```

`MUL` 返回 64 位乘积的低 32 位。对相同的 32 位输入位模式，有符号和
无符号乘法的低 32 位相同，因此 ISA 只提供一条 `mul`。

`DIV/REM` 使用有符号运算，`DIVU/REMU` 使用无符号运算。除数为零时，
除法器返回商 `0xffffffff`、余数为原被除数。

## 4. 内存访问

MCU funct：

| Funct | 指令 | 操作 |
|---:|---|---|
| `0x0` | LW | 读取 32 位 |
| `0x1` | LH | 读取 16 位并符号扩展 |
| `0x2` | LHU | 读取 16 位并零扩展 |
| `0x3` | LB | 读取 8 位并符号扩展 |
| `0x4` | LBU | 读取 8 位并零扩展 |
| `0x5` | SW | 写入 `R[rd][31:0]` |
| `0x6` | SH | 写入 `R[rd][15:0]` |
| `0x7` | SB | 写入 `R[rd][7:0]` |

有效地址：

```text
I-Type: address = R[rs2] + zero_extend(imm16)
R-Type: address = R[rs2] + R[rs1]
```

汇编语法：

```asm
lw  r4, [r8 + 4]
lh  r5, [r8 + r9]
lhu r6, [r8]
lb  r7, [r8 + 1]
lbu r8, [r10 + r11]

sw [r8 + 4], r4
sh [r8 + r9], r5
sb [r8 + 1], r6
```

`[rs2]` 等价于 `[rs2 + 0]`。为兼容旧源码，下面两种 word 访问仍作为
`lw/sw` 别名：

```asm
mov rd, [rs2 + offset]    // lw
mov [rs2 + offset], rd    // sw
```

字节写选通和写数据 lane 由 CPU 根据地址低两位生成。软件必须保证：

- LW/SW 地址按 4 字节对齐。
- LH/LHU/SH 地址按 2 字节对齐。
- LB/LBU/SB 可使用任意字节地址。

硬件不产生未对齐异常，未对齐访问的结果不应依赖。

## 5. 比较、分支与跳转

PCU funct：

| Funct | 含义 |
|---:|---|
| `0x0` | EQ |
| `0x1` | NE |
| `0x2` | SGE |
| `0x3` | SLT |
| `0x4` | SGT |
| `0x5` | SLE |
| `0x6` | UGE |
| `0x7` | ULT |
| `0x8` | UGT |
| `0x9` | ULE |
| `0xA` | BZ |
| `0xB` | BNZ |
| `0xC` | JAL |

比较结果直接写入 `rd`，值为 0 或 1，不存在隐藏条件码：

```asm
cmp  rd, rs2 == rhs
cmp  rd, rs2 <  rhs
cmpu rd, rs2 >= rhs
```

`cmp` 的关系比较为有符号，`cmpu` 的关系比较为无符号。两者的
`==/!=` 使用相同硬件编码；立即数 EQ/NE 按符号扩展处理。

分支语义：

```asm
bz  rd, rs2 + target    // R[rd] == 0 时跳转
bnz rd, rs2 + target    // R[rd] != 0 时跳转
```

`target` 可以是寄存器或无符号 16 位立即数/标签。立即数形式目标为
`R[rs2] + zero_extend(target)`，寄存器形式为 `R[rs2] + R[rs1]`。
绝对标签通常写作 `r0 + label`。

JAL 语法：

```asm
jmp target[, rd]
jmp rs2 + target[, rd]
```

执行时先令 `R[rd] = PC + 4`，再跳到计算出的目标；省略 `rd` 时使用
`r0`，即不保存链接。寄存器间接返回写作 `jmp r14`。

## 6. 中断架构动作

`r1[0]` 为中断使能，`r1[2:1]` 依次选择上升沿、下降沿、高电平和低电平。
`r2` 保存中断入口字节地址。

CPU 接受中断时只执行：

1. 清除 `r1[0]`。
2. 把已解析的下一条指令地址写入 `r3`。
3. 跳转到 `R[r2]`。

硬件不保存其他寄存器、不维护中断活动状态，也没有专用中断返回指令。
保存上下文、清除中断源、重新使能以及执行 `jmp r3` 返回均由软件负责。

## 7. 汇编器伪指令

汇编器支持：

- `.equ` 常量或定义符号
- `.prog` 输出名
- `.entry` 复位入口
- `.ifdef/.elsif/.else/.endif` 条件编译
- `.macro/.endm` 参数宏
- `.include` 文件引用
- `.rept/.endr` 重复展开

```asm
.prog demo
.entry main
.equ count 4

.macro clear(rd)
    mov rd, 0
.endm

main:
    clear(r4)
    jmp main
```

汇编器强制一行一条语句，支持 `//` 和 `/* ... */` 注释。标签是字节地址，
`.entry label` 会在地址 0 插入一条 `jmp label`。

## 8. 相关文档

- [Tiny C ABI](ABI.md)
- [VSCode 工具链说明](../merc32-vsce/README.md)
