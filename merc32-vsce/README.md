# MERC32 Toolchain for VSCode

This directory is the unified VS Code extension for the MERC32 toolchain. It contains the assembler, the Tiny C compiler under `src/cCompiler`, and the MERC32 Activity Bar sidebar used to organize build commands, artifacts, future software simulation, and toolchain settings.

[![Version](https://img.shields.io/badge/Version-2.0.0-blue.svg)](https://github.com/AlexMercer12138/MERC32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MERC32 CPU 的 VSCode 扩展，集成汇编器、语法高亮、代码片段，支持一键编译输出 Verilog、COE、MIF、HEX、BIN 等多种格式。

## 功能特性

- ▶️ **一键编译** - 打开 `.asm` 文件，点击右上角播放按钮直接编译
- 🎨 **语法高亮** - mov/cmp/cmpu/jmp/bz/bnz 指令、寄存器、立即数、标签、注释
- ✂️ **代码片段** - 输入 `mov`、`load`、`store`、`cmp`、`bz`、`macro`、`rept` 等快速生成代码
- 📝 **注释支持** - `//` 格式注释，支持 `Ctrl+/` 快捷键
- 🔤 **括号匹配** - 内存访问括号 `[]` 自动匹配
- 🔄 **多种输出格式** - Verilog、COE、MIF、Intel HEX、Binary
- 🐛 **调试模式** - 生成标签表和替换后的汇编代码

## 安装

### 从 VSIX 安装

```bash
code --install-extension merc32-asm-2.0.0.vsix
```

### 从市场安装（待发布）

在 VSCode 扩展面板搜索 `MERC32 Assembly` 并安装。

## 使用方法

### 编译汇编文件

1. 打开任意 `.asm` 文件
2. 点击编辑器右上角的 ▶ **Compile** 按钮
3. 编译结果自动输出到同目录（或配置的路径）

### 切换编译模式

点击 ▶ 右侧的 ▼ 下拉按钮，选择：

| 模式 | 说明 |
|------|------|
| 正常模式 | 编译并输出文件（默认） |
| 打印模式 | 编译结果输出到输出面板，不保存文件 |
| 调试模式 | 编译并额外生成标签表和替换后的汇编代码 |

### 配置输出格式

在 VSCode 设置中搜索 `MERC32 Assembler`：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `merc32-asm.outputFormat` | 输出格式：verilog / coe / mif / hex / bin / mem | `verilog` |
| `merc32-asm.outputPath` | 自定义输出目录（空则同源文件目录） | `""` |

### 支持的指令语法

汇编器强制一行一条语句，不使用分号分隔。标签可以单独一行，也可以写成 `label: instruction`。

#### 立即数格式

立即数支持 C 语言风格，无需 `#` 前缀：

| 格式 | 示例 | 说明 |
|------|------|------|
| 十进制 | `100`, `-1`, `325` | 有符号十进制整数 |
| 十六进制 | `0xAB`, `0x1234` | `0x` 前缀 |
| 二进制 | `0b110`, `0b1010` | `0b` 前缀 |
| 字符 | `"A"`, `"AB"`, `"\n"` | 双引号内最多两个字符，每字符按 ASCII 编码为 8 位无符号数 |

#### mov 指令

```asm
// 加载立即数 (I-Type)
mov rd, imm               // rd = imm

// 寄存器复制 (R-Type)
mov rd, rs                // rd = rs
```

#### ALU 运算指令

支持 I-Type（立即数）和 R-Type（寄存器）两种形式：

```asm
// I-Type: rs op imm
mov rd, rs + imm          // rd = rs + imm
mov rd, rs - imm          // rd = rs - imm
mov rd, rs & imm          // rd = rs & imm
mov rd, rs | imm          // rd = rs | imm
mov rd, rs ^ imm          // rd = rs ^ imm
mov rd, rs << imm         // rd = rs << imm (逻辑左移)
mov rd, rs >> imm         // rd = rs >> imm (逻辑右移)
mov rd, rs >>> imm        // rd = rs >>> imm (算术右移)

// R-Type: rs2 op rs1
mov rd, rs2 + rs1         // rd = rs2 + rs1
mov rd, rs2 - rs1         // rd = rs2 - rs1
mov rd, rs2 & rs1         // rd = rs2 & rs1
mov rd, rs2 | rs1         // rd = rs2 | rs1
mov rd, rs2 ^ rs1         // rd = rs2 ^ rs1
mov rd, rs2 << rs1        // rd = rs2 << rs1 (逻辑左移)
mov rd, rs2 >> rs1        // rd = rs2 >> rs1 (逻辑右移)
mov rd, rs2 >>> rs1       // rd = rs2 >>> rs1 (算术右移)
```

#### 内存访问指令

```asm
// I-Type: [rs + imm]
mov rd, [rs + imm]        // rd = Mem[rs + imm]
mov [rs + imm], rd        // Mem[rs + imm] = rd

// R-Type: [rs1 + rs2]
mov rd, [rs1 + rs2]       // rd = Mem[rs1 + rs2]
mov [rs1 + rs2], rd       // Mem[rs1 + rs2] = rd

// 偏移为0的简写形式
mov rd, [rs]              // rd = Mem[rs]
mov [rs], rd              // Mem[rs] = rd
```

#### jmp 指令

```asm
jmp imm, rd               // rd = PC+4, PC = r0 + imm
jmp label, rd             // rd = PC+4, PC = r0 + label
jmp rs, rd                // rd = PC+4, PC = r0 + rs
jmp rs + imm, rd          // rd = PC+4, PC = rs + imm
jmp rs - imm, rd          // rd = PC+4, PC = rs + (-imm)
jmp rs1 + rs2, rd         // rd = PC+4, PC = rs1 + rs2

jmp imm                   // PC = r0 + imm，不保存链接
jmp rs                    // PC = r0 + rs，不保存链接
jmp rs + imm              // PC = rs + imm，不保存链接
jmp rs1 + rs2             // PC = rs1 + rs2，不保存链接
```

`r15` 是软件可读写的当前 PC 专用寄存器，不作为普通寄存器分配。直接写入 `r15` 不会改变控制流，寄存器组空闲时硬件会把它刷新为当前指令字节地址。跳转由 JAL、BZ 或 BNZ 完成；按当前 PC 相对跳转时可以把 `r15` 作为基址，例如 `jmp r15 + 8`。

#### cmp / cmpu / bz / bnz 指令（比较与分支）

```asm
cmp  rd, rs2 < rs1        // 有符号比较，rd = 0 或 1
cmp  rd, rs2 == imm       // 16 位立即数先符号扩展
cmpu rd, rs2 >= rs1       // 无符号比较，rd = 0 或 1
cmpu rd, rs2 < imm        // 16 位立即数先零扩展

bz  rd, r0 + label       // rd == 0 时跳到绝对字节地址 label
bnz rd, r0 + label       // rd != 0 时跳到绝对字节地址 label
bz  rd, rs2 + imm        // rd == 0 时跳到 R[rs2] + zero_extend(imm16)
bnz rd, rs2 + rs1        // rd != 0 时跳到 R[rs2] + R[rs1]
```

`cmp` 和 `cmpu` 都支持 `==`、`!=`、`<`、`<=`、`>`、`>=`。分支必须显式写出目标基址；直接标签目标使用 `r0 + label`。旧 `brc/brcu` 语法不再支持。

### 标签支持

```asm
start:
    mov r0, 0
    mov r1, 10

loop:
    mov r0, r0 + r1
    jmp loop, r2
```

### 伪指令

预编译阶段支持 `.equ` 常量/符号、`.prog` 输出名、条件编译、代码段宏、文件引用和重复展开：

```asm
.prog demo
.entry main
.equ count 4
.equ value 0b1000

.macro load_value(rd, value)
    mov rd, value
.endm

.ifdef count
.rept count
    load_value(r1, value)
.endr
.endif

main:
    mov r1, value
```

`.entry label` inserts a reset-vector `jmp label` at address 0. If `.entry` is omitted, execution still starts from the first emitted instruction.

`.include "file.asm"` 会把引用文件按声明顺序追加到主文件之后一起汇编。

### 16 位立即数

十进制立即数默认按 **16 位有符号数** 检查，范围为 `-32768 ~ 32767`；带 `0x`/`0b` 前缀的字面量可直接给出 `0 ~ 0xffff` 的原始位模式。EQ/NE 和有符号关系比较符号扩展该 16 位位模式，无符号关系比较与 `bz/bnz` 的立即数目标按无符号数零扩展。`cmpu ==` 和 `cmpu !=` 是 EQ/NE 的编码别名，因此仍执行符号扩展。

```asm
mov r1, 100               // r1 = 100
mov r2, -1                // r2 = 0xFFFF
mov r3, -32768            // r3 = 0x8000
mov r4, 0xFFFF            // r4 = 65535
```

### 注释

只支持 `//` 格式的注释：

```asm
// 这是注释
mov r0, 1           // 这也是注释
```

## 输出格式说明

### Verilog 格式

生成完整的 Verilog ROM 模块，可直接例化使用：

```verilog
module prog_rom(
    input wire [31:0] prog_addr,
    output reg [31:0] prog_data
)
always @(*) begin
    case (prog_addr)
        0 : prog_data = 32'h00000000
        ...
        default: prog_data = 0
    endcase
end
endmodule
```

### COE 格式（Xilinx）

```
memory_initialization_radix=16
memory_initialization_vector=
00000000,
00001001,
...,
FFFFFFFF
```

### MIF 格式（Altera/Intel）

```
WIDTH=32
DEPTH=256
ADDRESS_RADIX=HEX
DATA_RADIX=HEX
CONTENT BEGIN
    0000 : 00000000
    ...
END
```

### HEX 格式（Intel HEX）

```
:0400000000000010EC
:0400040000010110E6
:00000001FF
```

### MEM 格式（Verilog `$readmemh`）

```
00000010
00010110
```

## 技术规格

| 特性 | 参数 |
|------|------|
| 架构 | 32位 RISC |
| 寄存器数量 | 16个有符号通用寄存器 |
| 指令宽度 | 32位 |
| 指令数量 | 32条（16种功能 x 2种寻址方式） |
| 数据通路 | 单周期执行 |
| 程序存储 | 65536条指令（16位地址） |
| 有符号数支持 | 原生支持 |

`r0` 固定为 0 且写入无效。`r15` 可读写，但空闲时会自动刷新为当前 PC，写入不会直接改变控制流。

## 许可证

MIT License
