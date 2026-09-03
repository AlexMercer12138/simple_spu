# MERC32 Toolchain for VSCode

[![Version](https://img.shields.io/badge/Version-2.1.0-blue.svg)](https://github.com/AlexMercer12138/MERC32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MERC32 CPU 的统一 VSCode 扩展，内置汇编器与 Tiny C 编译器，并通过活动栏侧边栏组织构建命令与产物。打开 `.asm` / `.c` 文件时，扩展提供语法高亮、代码片段与右上角一键编译按钮，可将源码编译输出为 Verilog、COE、MIF、Intel HEX、Binary 或 `$readmemh` 内存文件。

## 功能特性

- ▶️ **一键编译** - 打开 `.asm` / `.c` 文件后，编辑器右上角显示编译按钮，自动按文件类型选择流程
- 🧩 **Tiny C 编译器** - 支持 8/16/32 位整数、函数、指针、数组、乘除余、控制流与中断处理
- 🔧 **内置汇编器** - 纯 TypeScript 实现，无需外部工具链即可完成 `.asm` 到机器码的转换
- 🗂️ **工具链侧边栏** - 活动栏 `MERC32` 视图集中管理构建命令与最近生成的产物，点击即可打开
- 🎨 **语法高亮** - ALU、乘除余、宽度化访存、比较、分支和跳转指令
- ✂️ **代码片段** - 输入 `mov`、`mul`、`lw`、`sw`、`cmp`、`bz`、`macro`、`rept` 等快速生成代码
- 📝 **注释支持** - `//` 行注释与 `/* */` 块注释，支持 `Ctrl+/` 快捷键
- 🔤 **括号匹配** - 内存访问括号 `[]`、函数括号 `()`、块 `{}` 自动匹配
- 🔄 **多种输出格式** - Verilog、COE、MIF、Intel HEX、Binary、`$readmemh` MEM
- 🐛 **调试模式** - 额外生成标签表与替换后的汇编代码，便于排查

## 安装

### 从 VSIX 安装

```bash
code --install-extension merc32-vsce.vsix
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
npm run package:vsix
```

### 从市场安装（待发布）

在 VSCode 扩展面板搜索 `MERC32 Toolchain` 并安装。

## 使用方法

### SoC 配置与生成

1. 在工作区中新建任意名称的 `*.merc32.json` 文件。
2. 直接打开文件使用图形化编辑器，或选择 **Reopen as Text** 编辑 JSON。
3. 依次执行 **Validate**、**Auto-assign**（需要自动分配地址时）和 **Generate**。
4. 将生成目录中的 `hardware/<project>.v` 作为唯一的 SoC Verilog 源文件加入 FPGA 或仿真工程；例如使用 `iverilog -g2005 -s <project> hardware/<project>.v`。
5. 从 `software/main.c` 开始编写裸机软件，并包含 `software/<project>.h` 中的软件地址映射。
6. 如配置了存储器初始化文件，生成器会将其放入可选的 `firmware/` 目录。

配置器中的地址字段固定显示 `0x` 前缀并只编辑 8 位十六进制数字，RAM 容量固定显示 `KiB` 后缀。外部接口使用包含在地址范围内的 **High Address**；保存时 JSON 仍保持版本 1 的 `windowSize` 字段，并按 `windowSize = High Address - Base Address + 1` 自动换算。

选择 **Controller** 中断模式后，配置器会自动创建并管理一个 `apb_intc`，其 Instance name 与 Base address 在 Interrupts 页面修改，`IRQ_COUNT` 和 `IRQ_MODE` 由路由自动生成。中断源通过下拉框选择已添加外设的中断或可重复选择的 External interrupt；生成 RTL 时，外部中断引脚按路由出现顺序命名为 `external_interrupt0`、`external_interrupt1` 等。

生成的项目 SoC 顶层模块只公开端口，不公开配置参数；CPU、桥接器、RAM 和外设参数都由 JSON 配置对应的生成结果内部维护。

VSIX 已包含生成所需的目录、模板、许可证和 RTL 资源，安装后可离线、独立生成，不依赖 MERC32 仓库检出。生成器绝不会覆盖已经存在的 `software/main.c`。输出包含可集成的 RTL 和软件起始文件，但不生成 FPGA 工程或 testbench。

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
| `merc32-asm.c.dataBase` | C 编译器使用的 DLB 数据基址 | `0x08000000` |
| `merc32-asm.c.dlbAddrWidth` | DLB 字地址位宽（`1..25`），用于初始化 C 栈指针 | `16` |
| `merc32-asm.c.codeBase` | C 编译器使用的 4 字节对齐 ILB 代码基址 | `0x00000000` |

`dataBase` 与 `dlbAddrWidth` 支持 `0x` / `0b` 前缀的字面量。
Tiny C 只接受 `0x08000000..0x0FFFFFFF` 内的 `dataBase`；计算得到的
`dataBase + (1 << (dlbAddrWidth + 2))` 是独占上界，且不得超过
`0x10000000`。`codeBase` 必须位于 `0x00000000..0x07FFFFFF`；从 bootloader
加载的应用必须把它设置为实际 ILB 加载地址。

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

// 乘法、除法与余数；rhs 可为寄存器或立即数
mul  rd, rs2, rhs         // 乘积低 32 位
div  rd, rs2, rhs         // 有符号商
divu rd, rs2, rhs         // 无符号商
rem  rd, rs2, rhs         // 有符号余数
remu rd, rs2, rhs         // 无符号余数
```

### 内存访问指令

```asm
lw  rd, [rs2 + rhs]       // 32 位读取
lh  rd, [rs2 + rhs]       // 16 位读取并符号扩展
lhu rd, [rs2 + rhs]       // 16 位读取并零扩展
lb  rd, [rs2 + rhs]       // 8 位读取并符号扩展
lbu rd, [rs2 + rhs]       // 8 位读取并零扩展

sw [rs2 + rhs], rd        // 写入 rd[31:0]
sh [rs2 + rhs], rd        // 写入 rd[15:0]
sb [rs2 + rhs], rd        // 写入 rd[7:0]

// rhs 可为寄存器或 16 位立即数；省略时等价于 0
lw rd, [rs2]
sw [rs2], rd

// 旧 word 访问兼容别名
mov rd, [rs2 + rhs]       // lw
mov [rs2 + rhs], rd       // sw
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

预编译阶段支持 `.equ` 常量/符号、`.prog` 输出名、`.org` 链接地址、`.entry` 入口标签、`.ifdef` / `.else` / `.elsif` / `.endif` 条件编译、`.macro` / `.endm` 代码段宏、`.include` 文件引用和 `.rept` / `.endr` 重复展开：

```asm
.prog demo
.org 0x1000
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

- `.org address` 设置 4 字节对齐的链接地址，只重定位标签而不填充机器码；省略时为 0
- `.entry label` 在当前链接地址插入 `jmp label`；省略时从首条指令开始执行
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

### Tiny C 预处理

文件编译会先运行一个最小化预处理器。它支持：

- 相对于包含文件解析的引号包含：`#include "path/to/header.h"`
- 对象式 `#define` 和 `#undef`
- `#if`、`#ifdef`、`#ifndef`、`#else` 和 `#endif` 条件编译
- 常规包含守卫，以及原始源文件、行和列的错误诊断

例如，头文件可只用受支持的指令编写包含守卫：

```c
#ifndef BOARD_REGS_H
#define BOARD_REGS_H

#define UART0_BASE 0x10000000

#endif
```

这不是完整的 C 预处理器。函数式宏、尖括号/系统头文件、记号粘贴、字符串化、可变参数宏和标准库均不受支持。

### 支持的 C 子集

| 类别 | 支持内容 |
|------|----------|
| 类型 | `char`、`unsigned char`、`short`、`unsigned short`、`int`、`unsigned int`、`void`、`volatile`、指针、数组 |
| 字面量 | 十进制/十六进制/二进制整数、字符字面量、UTF-8 字符串字面量及相邻字符串拼接 |
| 存储 | 全局变量、函数局部变量、一维整数数组及其初始化 |
| 控制流 | `if` / `else`、`while`、`do` / `while`、`for`、`switch` / `case` / `default`、`break`、`continue`、`return`、`goto`、标签 |
| 二元运算 | `+ - * / % & \| ^ << >> == != < <= > >= && \|\|` |
| 赋值与更新 | `=`、`+= -= *= /= %= &= \|= ^= <<= >>=`、前缀/后缀 `++ --` |
| 一元与条件运算 | `! ~ & * + -`、`?:`（`*` 为指针解引用，`&` 为取地址） |
| 函数 | 函数定义与声明、函数调用、参数按 `r4`–`r7` 寄存器传递，返回值在 `r4` |
| 类型转换 | 显式 `(type)expr` 强制转换，支持指针与整数互转 |
| 数组与指针 | `arr[i]` 索引、`*ptr` 解引用、指针算术 |

窄整数对象按 1/2 字节自然对齐，读取时按类型符号扩展或零扩展，参与普通运算前提升为 32 位 `int`。数组下标和指针算术按所指类型的 1/2/4 字节元素大小缩放。

### 字符与字符串字面量

字符和字符串支持 `\n`、`\r`、`\t`、`\0`、`\\`、`\'`、`\"`、`\a`、`\b`、`\f`、`\v`，以及 1 至 3 位八进制转义和至少 1 位十六进制转义 `\x...`；转义值必须位于 `0x00..0xFF`。普通非 ASCII 源字符按 UTF-8 编码，因此字符字面量解码后必须恰好为 1 字节，多字节 UTF-8 字符不能用作字符字面量。

字符串按 UTF-8 保存，转义规则与字符字面量相同；相邻字符串先拼接，再追加一个 NUL 字节。字符串表达式的类型为 `char *`，可用于全局或局部指针初始化，也可直接作为函数实参。以下仅为已有 `uart_print` 接口的调用片段，完整可构建示例见 [`tinyc_uart_test.c`](../example/tinyc_uart_test.c)：

```c
int uart_print(char *text);

int main(void) {
    uart_print("hello\n");
    return 0;
}
```

相同字节内容的字符串字面量共享静态地址。字符串字面量只按语言约定只读，硬件不提供写保护；需要修改文本时应使用字符数组。静态数据布局和初始化实现见 [Tiny C ABI 的“数据内存与静态数据”](../docs/ABI.md#5-数据内存与静态数据)。

### 数组初始化

一维 `char`、`unsigned char`、`short`、`unsigned short`、`int` 和 `unsigned int` 数组支持固定长度或从初始化器推导长度：

```c
int values[] = {1, 2, 3,};
unsigned short table[5] = {10, 20};
char message[] = "hello";
unsigned char buffer[16] = "hello";
```

显式数组长度当前只接受单个正整数数值字面量（十进制、十六进制或二进制）；不接受括号、标识符或运算表达式。空括号 `[]` 只能依靠紧随其后的非空列表或字符串初始化器推导长度。

列表允许尾逗号；固定长度多出的元素补零，初始化项过多则报错。全局数组列表只能使用整数常量表达式；局部数组元素可使用运行时表达式，在声明处按源码顺序各求值一次，随后补零。

字符串初始化仅适用于 `char` / `unsigned char` 数组，内容为 UTF-8 payload 和 NUL。省略长度时推导为 payload 字节数加 1；固定容量必须容纳 payload 和 NUL，剩余元素补零。

### 更新、条件和控制流语义

复合赋值和 `++` / `--` 的左值地址只计算一次。前缀更新返回写回后的值，后缀更新返回写回前的值。指针只支持 `+=`、`-=`、`++`、`--`，并按所指元素的 1/2/4 字节大小缩放；其他指针复合赋值不受支持。

`?:` 的优先级低于 `||`、高于赋值，按右结合解析。条件只求值一次，且只执行选中的分支。两个整数分支执行整数提升和通常算术转换；类型相同的对象指针可互选，指针也可与值为零的整数常量表达式互选。两个分支都为 `void` 时，结果只能出现在表达式语句或显式丢弃值的上下文中。

`do` / `while` 的循环体至少执行一次，`continue` 转到条件判断，`break` 退出循环。`switch` 只求值一次控制表达式，然后按源码顺序与各 `case` 整数常量表达式比较；`case` 值转换到提升后的控制类型后不得重复。标签按源码顺序生成且不隐式跳转，因此支持 fallthrough。`break` 退出词法上最近的循环或 `switch`；`continue` 只针对循环，所以循环内嵌 `switch` 中的 `continue` 仍继续最近的外层循环。

### 子集范围与工具链限制

Tiny C 是面向 MERC32 裸机程序的明确子集，并非完整的标准 C 实现。当前不支持：

- 多维数组、嵌套初始化列表、指针数组和函数指针
- `struct`、`union`、`enum` 及其初始化，`long` 和浮点类型
- 通用标量花括号初始化、数组参数语法和 `void *`
- `const`、只读存储区和运行时写保护
- `sizeof`、`typedef` 和运行时库
- 整数字面量类型后缀（例如 `U`、`L`、`UL`）
- `switch` 跳转表优化；当前固定使用顺序比较

上述是语言子集限制。另有一项全工具链的大程序限制：Tiny C 当前生成直接标签跳转/分支，汇编器再把标签替换为 16 位绝对立即数；当代码增大到目标标签地址无法编码时，汇编会失败，目前没有自动的 far-label 跳板或长跳转展开。

### MMIO 与中断

通过 `volatile` 指针访问内存映射外设。地址 `0x08000000` 起为 DLB 数据空间，由 `merc32-asm.c.dataBase` 配置：

```c
volatile unsigned int *status = (volatile unsigned int *)0x080003C0;
*status = 0x600D;
```

定义名为 `__irq_handler` 的无参 `void` 函数即可启用中断支持，编译器会在向量地址自动生成跳转指令并保存 / 恢复上下文。通过内置调用 `__irq_enable()` / `__irq_disable()` 控制上升沿中断使能；高有效中断控制器输出使用 `__irq_enable_level()`。后者写入 `r1=5`，而原有 `__irq_enable()` 继续写入 `r1=1`：

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
    volatile unsigned int *status = (volatile unsigned int *)0x080003C0;
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
