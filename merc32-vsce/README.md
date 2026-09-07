# MERC32 Toolchain for VSCode

[![Version](https://img.shields.io/badge/Version-2.2.0-blue.svg)](https://github.com/AlexMercer12138/MERC32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MERC32 CPU 的统一 VSCode 扩展，内置汇编器与 C17 编译器，并通过活动栏侧边栏组织构建命令与产物。打开 `.asm` / `.c` 文件时，扩展提供语法高亮、代码片段与右上角一键编译按钮，可将源码编译输出为 Verilog、COE、MIF、Intel HEX、Binary 或 `$readmemh` 内存文件。

## 功能特性

- ▶️ **一键编译** - 打开 `.asm` / `.c` 文件后，编辑器右上角显示编译按钮，自动按文件类型选择流程
- 🧩 **C17 编译器** - Aro C17 freestanding 前端与 MERC32 后端，支持预处理、静态类型检查和裸机代码生成
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

### 打包 NOR Flash 应用镜像

先用已设置实际 ILB 加载地址的 `merc32-asm.c.codeBase` 生成原始 `.bin`，再打包：

```bash
cd merc32-vsce
npm run flash:image -- application.bin application.img 0x1000
```

可选的第四个参数指定入口地址；省略时入口等于加载地址：

```bash
npm run flash:image -- application.bin application.img 0x1000 0x1004
```

生成的镜像在 20 字节头之后原样保留输入 `.bin`，不会重定位或交换任何 payload 字节。头部字段全部为大端 32 位整数：

| Offset | Field | Value |
| ---: | --- | --- |
| `0x00` | magic | `0x4d333246` (`M32F`) |
| `0x04` | image size | 非零且为 4 的倍数的 payload 字节数 |
| `0x08` | load address | 4 字节对齐的 ILB 字节地址 |
| `0x0c` | entry address | payload 内的 4 字节对齐地址 |
| `0x10` | CRC32 | payload 的 IEEE CRC32 |

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
MERC32 C 后端只接受 `0x08000000..0x0FFFFFFF` 内的 `dataBase`；计算得到的
`dataBase + (1 << (dlbAddrWidth + 2))` 是独占上界，且不得超过
`0x10000000`。当前 C 后端的直接标签跳转使用汇编器的有符号 16 位
立即数字面量，因此 `codeBase` 必须位于 `0x00000000..0x00007FFF`（独占上界
`0x00008000`，且 4 字节对齐）；
超出范围会在编译阶段明确报错。
从 bootloader 加载的应用必须把它设置为实际 ILB 加载地址（默认布局使用 `0x1000`）。

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

## C17 编译器

2.2.0 使用固定版本的 [Aro](https://github.com/Vexu/arocc) WASM 作为唯一的生产 C 预处理、语法和语义前端，再由 MERC32 后端生成 `.mobj`、链接运行时并输出汇编或 ROM。普通编译完全离线运行，不依赖 Zig、宿主 C 编译器或网络，也不会在 Aro 失败后回退到旧的手写前端。

默认语言模式是 ISO C17 freestanding。公开目标为 `merc32`，ABI 为 `merc32-c-v1`，数据模型为 `merc32-ilp32`：小端、8 位字节，`short` 为 16 位，`int`、`long` 和指针为 32 位，`long long` 为 64 位，最大自然对齐为 4 字节。

### 预处理、包含与诊断

Aro 负责 C17 宏展开、条件预处理和包含处理，包括函数式及可变参数宏、字符串化和记号粘贴。引号包含依次搜索当前文件目录、调用方给出的包含目录和扩展内置头文件；尖括号包含不搜索当前文件目录，也不会隐式使用宿主编译器的头文件路径。

扩展随包提供以下 freestanding 头文件：

- `float.h`、`iso646.h`、`limits.h`、`stdalign.h`
- `stdbool.h`、`stddef.h`、`stdint.h`、`stdnoreturn.h`

语法、语义和后端能力错误会保留文件、行列、相关位置、包含链与宏展开链，并显示在 VS Code Problems 中。这里提供的是编译器头文件，不包含 hosted C 标准库、POSIX API 或操作系统服务。

### 当前可生成代码的范围

| 类别 | 已支持内容 |
|------|------------|
| 标量与类型 | `_Bool`、字符类型、`short`、`int`、`long` 及无符号版本、`void`、指针、数组、枚举、`typedef`、非 packed 的结构体和联合体，以及 `const` / `volatile` / `restrict` |
| 表达式 | 32 位整数常量及后缀、字符常量、算术/位/逻辑/比较、简单赋值、条件表达式、取地址与解引用、数组下标、成员访问、`sizeof` / `_Alignof`、受支持的隐式转换和同宽显式转换 |
| 控制流 | `if` / `else`、`while`、`do` / `while`、全部 8 种省略子句的 `for`、`switch` / `case` / `default`、fallthrough、`break`、`continue`、`return`、`goto` 和标签 |
| 函数 | 声明与定义、直接调用、多于 4 个参数时的栈传参、内部/外部链接；32 位以内的标量参数和返回值 |
| 对象与初始化 | 自动局部对象、全局/文件作用域静态对象、多维数组、结构体/联合体成员、嵌套及指定初始化、数组长度推导、字符串数组初始化和可重定位地址初始化 |
| 链接与启动 | 多翻译单元 `.mobj` 链接、内部链接隔离、全局初始化调度，以及栈、IRQ 向量、`main` 调用和返回停机的启动代码 |

窄整数对象按 1/2 字节自然对齐，读取时按类型符号扩展或零扩展，参与普通运算前执行整数提升。指针算术和数组下标按元素大小缩放。`compileCToObject` / `compileCFileToObject` 可生成独立翻译单元；`compileC` / `compileCFile` 会链接启动代码并要求程序提供 `main`。

### 尚未生成代码的 C17 能力

Aro 能正确识别和检查的合法 C17 程序不一定都能由当前 MERC32 后端生成代码。以下能力会返回带源码位置的 `C_BACKEND_CAPABILITY` 诊断，不会静默降级或按错误 ABI 编译：

- `long long` 的 64 位值运算，以及 `float`、`double`、`long double` 和复数运算
- 可变参数函数、原子类型、线程局部存储、packed 布局、位域和超过 4 字节的显式对齐
- 聚合值参数、返回值和整体运算，以及非 automatic 的块作用域对象
- 复合字面量、`_Generic` 选择表达式、字符串字面量表达式、不同宽度的显式整数转换，以及复合赋值和 `++` / `--`

当前 `switch` 使用顺序比较；代码分支仍受指令集 16 位绝对跳转范围限制，尚未实现自动远跳转跳板。

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
