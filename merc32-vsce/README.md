# MERC32 Toolchain for VSCode

[![Version](https://img.shields.io/badge/Version-2.0.0-blue.svg)](https://github.com/AlexMercer12138/MERC32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MERC32 CPU 的统一 VSCode 扩展，内置汇编器与 Tiny C 编译器，并通过活动栏侧边栏组织构建命令与产物。打开 `.asm` / `.c` 文件时，扩展提供语法高亮、代码片段与右上角一键编译按钮，可将源码编译输出为 Verilog、COE、MIF、Intel HEX、Binary 或 `$readmemh` 内存文件。

## 功能特性

- ▶️ **一键编译** - 打开 `.asm` / `.c` 文件后，编辑器右上角显示编译按钮，自动按文件类型选择流程
- 🧩 **Tiny C 编译器** - 内置 C 子集编译器，支持函数、指针、数组、控制流与中断处理，可直接生成 ROM
- 🔧 **内置汇编器** - 纯 TypeScript 实现，无需外部工具链即可完成 `.asm` 到机器码的转换
- 🗂️ **工具链侧边栏** - 活动栏 `MERC32` 视图集中管理构建命令与最近生成的产物，点击即可打开
- 🎨 **语法高亮** - mov / cmp / cmpu / jmp / bz / bnz 指令、寄存器、立即数、标签、注释
- ✂️ **代码片段** - 输入 `mov`、`load`、`store`、`cmp`、`bz`、`macro`、`rept` 等快速生成代码
- 📝 **注释支持** - `//` 行注释与 `/* */` 块注释，支持 `Ctrl+/` 快捷键
- 🔤 **括号匹配** - 内存访问括号 `[]`、函数括号 `()`、块 `{}` 自动匹配
- 🔄 **多种输出格式** - Verilog、COE、MIF、Intel HEX、Binary、`$readmemh` MEM
- 🐛 **调试模式** - 额外生成标签表与替换后的汇编代码，便于排查

## 安装

### 从 VSIX 安装

```bash
code --install-extension merc32-vsce-2.0.0.vsix
```

### 从源码构建

```bash
cd merc32-vsce
npm install
npm run compile
```

如需生成 VSIX 安装包：

```bash
cd merc32-vsce
npx vsce package
```

### 从市场安装（待发布）

在 VSCode 扩展面板搜索 `MERC32 Toolchain` 并安装。

## 使用方法

### 工具链侧边栏

点击活动栏中的 `MERC32` 图标打开 `Toolchain` 视图：

- **Build** 组 - 列出所有构建命令，点击即可执行
- **Artifacts** 组 - 列出最近一次构建生成的文件，点击即可在编辑器中打开

### 编译汇编文件

1. 打开任意 `.asm` 文件
2. 点击编辑器右上角的 ▶ **Assemble ASM** 按钮（或侧边栏 `Assemble ASM`）
3. 编译结果按配置的格式输出到源文件同目录（或自定义目录）

### 编译 C 文件

1. 打开任意 `.c` 文件
2. 选择右上角按钮之一：
   - **Build C to ROM** - 编译 C → 生成汇编 → 汇编为最终 ROM 文件
   - **Compile C to ASM** - 仅编译 C 为 `.asm`，不继续汇编

### 切换编译模式

点击 ▶ 右侧的 ▼ 下拉按钮，或在侧边栏点击 `Select Compile Mode`：

| 模式 | 说明 |
|------|------|
| 正常模式 | 编译并输出文件（默认） |
| 打印模式 | 编译结果输出到 `MERC32 Toolchain` 输出面板，不保存文件 |
| 调试模式 | 编译并额外生成 `<name>_label_table.txt` 与 `<name>_replaced.asm` |

## 命令

所有命令均可在命令面板（`Ctrl+Shift+P`）中搜索 `MERC32` 调用：

| 命令 | 标题 | 作用 |
|------|------|------|
| `merc32-asm.compile` | MERC32: Build Active File | 按当前文件类型执行默认构建 |
| `merc32-asm.assembleActive` | MERC32: Assemble ASM | 汇编当前 `.asm` 文件 |
| `merc32-asm.compileCToAsm` | MERC32: Compile C to ASM | 将当前 `.c` 编译为 `.asm` |
| `merc32-asm.buildCToRom` | MERC32: Build C to ROM | 将当前 `.c` 编译并汇编为 ROM |
| `merc32-asm.compilePrint` | MERC32: Assemble ASM (Print Mode) | 以打印模式汇编 |
| `merc32-asm.compileDebug` | MERC32: Assemble ASM (Debug Mode) | 以调试模式汇编 |
| `merc32-asm.selectCompileMode` | MERC32: Select Compile Mode | 切换编译模式 |
| `merc32-asm.openLastArtifact` | MERC32: Open Last Artifact | 打开最近一次生成的产物 |

## 配置项

在 VSCode 设置中搜索 `MERC32 Assembler`：

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `merc32-asm.outputFormat` | 输出格式：`verilog` / `coe` / `mif` / `hex` / `bin` / `mem` | `verilog` |
| `merc32-asm.outputPath` | 自定义输出目录（空则与源文件同目录） | `""` |
| `merc32-asm.c.keepAssembly` | 构建 C 时是否保留中间生成的 `.asm` 文件 | `true` |
| `merc32-asm.c.dataBase` | C 编译器使用的 DLB 数据基址 | `0x00800000` |
| `merc32-asm.c.dlbAddrWidth` | DLB 字地址位宽，用于初始化 C 栈指针 | `16` |

`dataBase` 与 `dlbAddrWidth` 支持 `0x` / `0b` 前缀的字面量。

## 汇编语法参考

汇编器强制一行一条语句，不使用分号分隔。标签可以单独一行，也可以写成 `label: instruction`。

### 立即数格式

立即数支持 C 语言风格，无需 `#` 前缀：

| 格式 | 示例 | 说明 |
|------|------|------|
| 十进制 | `100`, `-1`, `325` | 有符号十进制整数 |
| 十六进制 | `0xAB`, `0x1234` | `0x` 前缀 |
| 二进制 | `0b110`, `0b1010` | `0b` 前缀 |
| 字符 | `"A"`, `"AB"`, `"\n"` | 双引号内最多两个字符，每字符按 ASCII 编码为 8 位无符号数 |

### mov 指令

```asm
// 加载立即数 (I-Type)
mov rd, imm               // rd = imm

// 寄存器复制 (R-Type)
mov rd, rs                // rd = rs
```

### ALU 运算指令

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

### 内存访问指令

```asm
// I-Type: [rs + imm]
mov rd, [rs + imm]        // rd = Mem[rs + imm]
mov [rs + imm], rd        // Mem[rs + imm] = rd

// R-Type: [rs1 + rs2]
mov rd, [rs1 + rs2]       // rd = Mem[rs1 + rs2]
mov [rs1 + rs2], rd       // Mem[rs1 + rs2] = rd

// 偏移为 0 的简写形式
mov rd, [rs]              // rd = Mem[rs]
mov [rs], rd              // Mem[rs] = rd
```

### jmp 指令

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

### cmp / cmpu / bz / bnz 指令（比较与分支）

```asm
cmp  rd, rs2 < rs1        // 有符号比较，rd = 0 或 1
cmp  rd, rs2 == imm       // 16 位立即数先符号扩展
cmpu rd, rs2 >= rs1       // 无符号比较，rd = 0 或 1
cmpu rd, rs2 < imm        // 16 位立即数先零扩展

bz  rd, r0 + label        // rd == 0 时跳到绝对字节地址 label
bnz rd, r0 + label        // rd != 0 时跳到绝对字节地址 label
bz  rd, rs2 + imm         // rd == 0 时跳到 R[rs2] + zero_extend(imm16)
bnz rd, rs2 + rs1         // rd != 0 时跳到 R[rs2] + R[rs1]
```

`cmp` 和 `cmpu` 都支持 `==`、`!=`、`<`、`<=`、`>`、`>=`。分支必须显式写出目标基址；直接标签目标使用 `r0 + label`。旧 `brc/brcu` 语法不再支持。

### 标签

```asm
start:
    mov r0, 0
    mov r1, 10

loop:
    mov r0, r0 + r1
    jmp loop, r2
```

### 伪指令

预编译阶段支持 `.equ` 常量/符号、`.prog` 输出名、`.entry` 入口标签、`.ifdef` / `.else` / `.elsif` / `.endif` 条件编译、`.macro` / `.endm` 代码段宏、`.include` 文件引用和 `.rept` / `.endr` 重复展开：

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

- `.entry label` 在地址 0 处插入 `jmp label` 作为复位向量；省略时从首条指令开始执行
- `.include "file.asm"` 会把引用文件按声明顺序追加到主文件之后一起汇编
- `.macro` 不允许递归调用，参数数量必须匹配

### 16 位立即数

十进制立即数默认按 **16 位有符号数** 检查，范围为 `-32768 ~ 32767`；带 `0x`/`0b` 前缀的字面量可直接给出 `0 ~ 0xffff` 的原始位模式。EQ/NE 和有符号关系比较符号扩展该 16 位位模式，无符号关系比较与 `bz/bnz` 的立即数目标按无符号数零扩展。`cmpu ==` 和 `cmpu !=` 是 EQ/NE 的编码别名，因此仍执行符号扩展。

```asm
mov r1, 100               // r1 = 100
mov r2, -1                // r2 = 0xFFFF
mov r3, -32768            // r3 = 0x8000
mov r4, 0xFFFF            // r4 = 65535
```

### 注释

支持 `//` 行注释与 `/* */` 块注释：

```asm
// 这是行注释
mov r0, 1           // 行尾注释
/* 这是块注释 */
```

## Tiny C 编译器

`src/cCompiler` 实现了一个 C 语言子集编译器，可将 `.c` 源码编译为 MERC32 汇编，再由内置汇编器输出 ROM。

### 支持的 C 子集

| 类别 | 支持内容 |
|------|----------|
| 类型 | `int`、`unsigned int`、`void`、`volatile` 修饰、指针（多级）、数组 |
| 存储 | 全局变量（可带初始化）、函数局部变量 |
| 控制流 | `if` / `else`、`while`、`for`、`break`、`continue`、`return`、`goto`、标签 |
| 二元运算 | `+ - & \| ^ << >> == != < <= > >= && \|\|` 及 `=` 赋值 |
| 一元运算 | `! ~ & * + -`（`*` 为指针解引用，`&` 为取地址） |
| 函数 | 函数定义与声明、函数调用、参数按 `r4`–`r7` 寄存器传递，返回值在 `r4` |
| 类型转换 | 显式 `(type)expr` 强制转换，支持指针与整数互转 |
| 数组与指针 | `arr[i]` 索引、`*ptr` 解引用、指针算术 |

> 注意：编译器不支持乘法、除法、取模及复合赋值运算符。数组下标寻址内部用移位完成元素步长缩放，复杂表达式通过栈临时变量求值。

### MMIO 与中断

通过 `volatile` 指针访问内存映射外设。地址 `0x00800000` 起为 DLB 数据空间，由 `merc32-asm.c.dataBase` 配置：

```c
volatile unsigned int *status = (volatile unsigned int *)0x008003C0;
*status = 0x600D;
```

定义名为 `__irq_handler` 的无参 `void` 函数即可启用中断支持，编译器会在向量地址自动生成跳转指令并保存 / 恢复上下文。通过内置调用 `__irq_enable()` / `__irq_disable()` 控制中断使能：

```c
volatile unsigned int irq_count = 0;

void __irq_handler(void) {
    irq_count = irq_count + 1;
}

int main(void) {
    __irq_enable();
    while (irq_count == 0) {
    }
    return 0;
}
```

### 示例

```c
int data[4];

int sum(int *p, int n) {
    int i = 0;
    int total = 0;
    while (i < n) {
        total = total + p[i];
        i = i + 1;
    }
    return total;
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)0x008003C0;
    data[0] = 1;
    data[1] = 2;
    data[2] = 3;
    data[3] = 4;
    if (sum(data, 4) == 10) {
        *status = 0x600D;
    } else {
        *status = 0x0BAD;
    }
    return 10;
}
```

## 输出格式说明

### Verilog 格式

生成完整的 Verilog ROM 模块，可直接例化使用：

```verilog
// Simple CPU Program Memory Initialization
module prog_rom(
    input wire [15:0] prog_addr,
    output reg [31:0] prog_data
);
always @(*) begin
    case (prog_addr)
        0 : prog_data = 32'h00000000;
        ...
        default: prog_data = 0;
    endcase
end
endmodule
```

### COE 格式（Xilinx）

```
; Simple CPU Program Memory COE File
memory_initialization_radix=16;
memory_initialization_vector=
00000000,
00001001,
...,
FFFFFFFF;
```

### MIF 格式（Altera/Intel）

```
-- Simple CPU Program Memory MIF File
WIDTH=32;
DEPTH=256;

ADDRESS_RADIX=HEX;
DATA_RADIX=HEX;

CONTENT BEGIN
    0000 : 00000000;
    ...
END;
```

### HEX 格式（Intel HEX）

```
:0400000000000010EC
:0400040000010110E6
:00000001FF
```

### MEM 格式（用于 Verilog `$readmemh`）

```
00000010
00010110
```

### BIN 格式

原始大端二进制字节流，每条 32 位指令编码为 4 字节，可直接烧录到片上存储。

## 许可证

MIT License
