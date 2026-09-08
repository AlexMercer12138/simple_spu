# MERC32 Toolchain

[![Version](https://img.shields.io/badge/Version-2.2.0-blue.svg)](https://github.com/AlexMercer12138/MERC32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MERC32 的 VS Code 裸机开发工具链。从可视化 SoC 配置出发，生成硬件顶层、软件地址映射与所选外设的 C 驱动，再将 C 程序编译、链接为可用于仿真或 FPGA 存储器初始化的 ROM 文件。汇编器同时支持 C 后端输出和手写 MERC32 汇编。

```text
*.merc32.json
    -> SoC 配置、地址分配、中断路由
    -> hardware/<project>.v + software/<project>.h + software/drivers/
    -> software/main.c
    -> C17 前端 -> MERC32 对象与链接 -> 汇编 -> ROM
```

安装的 VSIX 包含 Aro WASM 前端、freestanding 头文件、运行库、汇编器，以及 SoC 生成所需的 RTL、驱动、目录描述、模板和许可证。正常编译与生成可离线完成，不需要检出 MERC32 或外设仓库，也不需要安装 Zig 或宿主 C 编译器。FPGA 综合、仿真和烧录仍使用相应的外部工具。

## 安装与快速开始

要求 VS Code 1.74.0 或更高版本。使用已构建的安装包：

```bash
code --install-extension merc32-vsce.vsix
```

1. 打开项目文件夹，点击活动栏的 **MERC32**，执行 **MERC32 SoC: Create Configuration**。
2. 打开生成的 `*.merc32.json`，在可视化编辑器中设置项目名、输出目录、ILB/DLB 存储器、外设、外部接口和中断路由。
3. 按需执行 **Auto-assign Addresses**，然后执行 **Validate** 和 **Generate**。
4. 打开输出目录中的 `software/main.c`，使用生成的地址宏和驱动编写应用。
5. 将 C 编译设置与实际 SoC 内存布局对应，执行 **MERC32: Build C to ROM**。在 **Artifacts** 中打开构建产物。
6. 将 `hardware/<project>.v` 加入 FPGA 或仿真工程；根据所用存储器选择 ROM 输出格式并接入初始化文件。

新建配置默认使用 32 KiB ILB 和 32 KiB DLB。编译器的默认 DLB 栈设置对应 256 KiB，因此第一次构建默认 SoC 前，应在工作区 `.vscode/settings.json` 中设置：

```json
{
  "merc32-asm.c.dataBase": "0x08000000",
  "merc32-asm.c.dlbAddrWidth": 13,
  "merc32-asm.c.codeBase": "0x00000000",
  "merc32-asm.c.optimization": "basic",
  "merc32-asm.outputFormat": "mem"
}
```

`dlbAddrWidth` 是 **32 位字地址位宽**，32 KiB 对应 `2^13` 个字。SoC 配置不会自动同步 VS Code 的 C 编译设置；修改存储器容量或应用加载地址后，需要一并调整这些设置。`basic` 为可选优化，扩展默认仍为 `none`。

## SoC 配置与生成

`*.merc32.json` 默认由 **MERC32 SoC Configurator** 打开，也可执行 **Reopen as Text** 使用 JSON 编辑器。配置采用严格 JSON，提供 schema 校验、地址冲突检查和定位诊断。

配置器支持 CPU 调试选项、内部 RAM 或外部 Local Bus 存储器、APB 外设、外部总线接口，以及直接中断或中断控制器路由。地址字段固定显示 `0x` 前缀，容量以 KiB 显示。外部接口的 **High Address** 包含在地址范围内；保存时按 `windowSize = High Address - Base Address + 1` 写入版本 1 JSON。

选择 **Controller** 模式后，配置器自动管理 `apb_intc`。控制器名称和基地址在 Interrupts 页面设置，`IRQ_COUNT` 与 `IRQ_MODE` 从路由生成。中断源可选择已添加外设或 External interrupt；外部中断顶层端口按路由顺序命名为 `external_interrupt0`、`external_interrupt1` 等。

### 输出目录

以项目 `demo` 为例，默认输出位置为配置文件旁的 `generated/demo/`：

```text
generated/demo/
  hardware/
    demo.v
  software/
    demo.h
    main.c
    drivers/
      merc32_drivers.h
      gpio.h
      gpio.c
      ...
  firmware/             # 仅在配置了存储器初始化文件时生成
  README.md
  manifest.json
```

| 产物 | 内容与用途 |
| --- | --- |
| `hardware/<project>.v` | 合并 CPU、桥接器、存储器和所选外设的完整 SoC Verilog 源文件 |
| `software/<project>.h` | 内存与实例的基地址、大小、末地址、功能宏和中断路由宏 |
| `software/drivers/<type>.h`、`.c` | 按实际使用的外设类型生成的公开驱动接口与实现 |
| `software/drivers/merc32_drivers.h` | 将所选驱动实现纳入当前翻译单元，适配活动文件构建 |
| `software/main.c` | 仅首次创建的应用起始文件，由用户维护 |
| `firmware/` | 配置引用的存储器初始化文件副本 |
| `README.md`、`manifest.json` | 端口与集成说明、地址布局、生成来源、资源版本和文件哈希 |

将 `hardware/<project>.v` 作为该 SoC 的唯一 Verilog 源文件加入工程，例如 `iverilog -g2005 -s demo hardware/demo.v`。生成的顶层仅公开端口，配置参数在内部固化。生成器不创建 FPGA 工程、引脚约束或 testbench；存在固件绑定时，以生成目录中的 README 为准设置仿真工作目录与初始化文件路径。

### 自动生成 C 驱动

支持 `gpio`、`timer`、`uart`、`intc`、`i2c`、`qspi`、`sdio` 和 `can` 八类外设。仅生成当前 SoC 使用的驱动，同类多个实例共享一份 `.c/.h`；Controller 模式自动加入的中断控制器也会生成 `intc` 驱动。当前不支持 USB 外设生成。

驱动通过调用方提供的句柄和基地址访问寄存器，具体实例地址来自 `<project>.h`，不写死在通用驱动中。以项目名 `demo`、GPIO 实例名 `gpio0` 为例：

```c
#include "demo.h"
#include "drivers/merc32_drivers.h"

int main(void) {
    gpio_handle_t gpio = { (volatile uint32_t *)DEMO_GPIO0_BASE };
    gpio_config_output(&gpio, GPIO_PIN_0, GPIO_LEVEL_LOW);
    gpio_set_mask(&gpio, GPIO_PIN_0);
    for (;;) {
    }
}
```

新建的 `main.c` 已包含项目头文件和 `drivers/merc32_drivers.h`。驱动生成不等于外设初始化：波特率、分频、GPIO 方向、总线模式和中断使能等参数由应用按硬件连接与运行需求设置。

**当前 VS Code 构建命令只编译活动 `.c` 文件，不会扫描或自动链接目录内其他 `.c`。** `drivers/merc32_drivers.h` 会包含所选驱动的实现，因此只需构建 `main.c`。在一个程序中只让一个翻译单元包含该聚合头；采用独立对象编译时，应用包含 `drivers/<type>.h`，各驱动 `.c` 分别编译后参与链接，避免重复定义。

### 再次生成与文件归属

RTL、项目头文件、驱动及聚合头均是生成器管理的文件。再次 Generate 会更新它们，并删除已不再需要且未被修改的旧产物；删除某类外设的最后一个实例时，其驱动也会被清理。

生成器通过 `manifest.json` 中的哈希检查修改。已手工修改的受管文件或待清理文件会阻止普通生成并报告冲突。**Force Generate** 用于明确替换这些修改；**Adopt Output** 用于接管属于其他配置的输出目录。`software/main.c` 一旦存在就不会被覆盖，包括强制生成。旧项目需要自行为保留的 `main.c` 加入驱动包含语句；应用代码应放在用户维护的文件中。

## C17 编译器

编译流程使用固定版本的 Aro WASM 完成预处理、语法与语义分析，再由 MERC32 后端生成 `.mobj` 对象、链接启动代码与所需运行库，最终输出汇编或 ROM。Aro 是生产 C 前端，前端错误不会回退到另一套解析器。

默认语言模式为 ISO C17 freestanding，目标为 `merc32`，ABI 为 `merc32-c-v1`，数据模型为 `merc32-ilp32`：8 位字节、小端数据布局，`short` 为 16 位，`int`、`long` 和指针为 32 位，最大自然对齐为 4 字节。类型模型中的 `long long` 为 64 位，但后端尚不支持其值运算。

### 当前支持范围

| 类别 | 可生成代码的主要能力 |
| --- | --- |
| 类型 | `_Bool`、8/16/32 位整数、指针、数组、枚举、`typedef`、普通结构体与联合体，`const` / `volatile` / `restrict` |
| 表达式 | 算术、位运算、逻辑与比较、复合赋值、自增减、条件与逗号表达式、成员及下标访问、指针算术、整数转换、`sizeof` / `_Alignof` / `offsetof`、`_Generic` |
| 控制流 | `if`、`while`、`do`、`for`、`switch`、`break`、`continue`、`return`、`goto` 与标签 |
| 函数 | 直接调用、函数指针、递归、栈上传递额外参数、内部与外部链接，以及结构体/联合体按值传参和返回 |
| 对象 | 全局与局部对象、块作用域静态及 extern、多维数组、嵌套与指定初始化、字符串、复合字面量、聚合赋值与地址重定位 |
| 启动与链接 | 栈初始化、全局初始化、IRQ 向量与上下文、`main` 调用及返回停机、多翻译单元对象链接、远控制流展开 |

Aro 支持函数式与可变参数宏、条件预处理、字符串化和记号粘贴。引号包含搜索源文件目录、调用方配置的包含目录与内置头文件；不隐式使用宿主系统头文件。诊断显示在 VS Code Problems 中，并保留源码位置、相关位置、包含链和宏展开信息。

内置头文件包括 `float.h`、`iso646.h`、`limits.h`、`stdalign.h`、`stdbool.h`、`stddef.h`、`stdint.h`、`stdnoreturn.h`、`string.h` 和 `merc32_irq.h`。这是 freestanding 环境，不包含完整 hosted C 标准库、POSIX 或操作系统服务。

### 运行库、MMIO 与中断

`string.h` 提供 `memcpy`、`memmove`、`memset`、`memcmp`、`strlen` 和 `strcmp`。普通 C 构建自动按需链接内置字节循环实现。MMIO 使用 `volatile` 访问，生成驱动已提供相应寄存器操作。

包含 `merc32_irq.h` 后，可定义 `void __irq_handler(void)` 作为中断处理函数。`__irq_enable()` 启用上升沿中断，`__irq_enable_level()` 对应高有效中断控制器输出，`__irq_disable()` 关闭中断。`irq_save()` 保存控制状态并关中断，`irq_restore(saved)` 恢复状态，可用于嵌套临界区。这些接口是编译器内置的直接调用，不支持取函数地址或重新定义。中断处理程序仍须按外设及控制器接口清除相应中断源。

### 优化与代码大小

`merc32-asm.c.optimization` 支持 `none` 和 `basic`，默认 `none`。`basic` 同时应用于 **Compile C to ASM** 和 **Build C to ROM**：

- 对重复初始化字节生成填充循环，包括 BSS 清零、稀疏初始化和字符串补零。
- 在基本块内传播与折叠常量，选用立即数指令，简化局部访存并删除未使用的纯计算。
- 折叠已知条件分支，删除不可达代码，缩短跳转链并清理多余跳转和标签。
- 根据活跃性复用临时栈槽，部分临时值保存在 `r9-r11`，叶函数省略不必要的返回地址保存。
- 在同一翻译单元中内联符合限制的小型叶函数，随后继续简化计算。
- 完整 C 构建在链接时裁剪未使用函数与不可达调用链，按依赖保留内存运行库函数。

优化保持可达路径上的 `volatile` 访问及副作用；调用、IRQ 操作和未知操作形成保守屏障。当前没有跨基本块寄存器分配或循环展开。内联仅适用于短小、无分支、无其他调用和无需局部对象的函数，并受展开预算限制；`inline` 关键字不保证内联，也不进行跨翻译单元内联。

优化会改变指令数量、栈帧和软件延时循环的时间，外设时序应使用硬件计时器。两种模式保持相同 ABI，可混合链接。独立对象编译保留全部函数；调用 `linkObjects` 时可用 `gcFunctions: true` 启用裁剪，用 `keepSymbols` 保留额外入口。当前不裁剪全局数据。

### 能力边界与对象链接

**C17 前端不代表后端已经实现所有 C17 运行语义。** 当前不生成 64 位整数值运算、浮点/复数运算、可变参数函数、原子类型、线程局部存储、packed 布局、位域和超过 4 字节的显式对齐。未支持的后端能力会报告带源码位置的 `C_BACKEND_CAPABILITY` 诊断。GNU `weak` / `section` 不提供弱符号或自定义节语义；被 Aro 忽略的属性会保留前端警告。随资源保留的软浮点汇编是占位实现，普通 C 构建不会链接它。

`compileCToObject` / `compileCFileToObject` 可生成独立翻译单元，`linkObjects` 提供多对象链接；这些是工具链 API，当前没有对应的 VS Code 多文件工程构建命令。`compileC` / `compileCFile` 及界面的 C 构建会加入启动代码并要求 `main`，**Compile C to ASM** 输出的也是已链接汇编。

C 调用、跳转和条件分支在目标地址超出短指令范围时自动展开，`none` 与 `basic` 均适用；程序正文可跨越 32 KiB 和 64 KiB。汇编互调、聚合参数与返回值、对象格式及链接接口见 [ABI 文档](../docs/ABI.md)。

## 命令与设置

活动栏 **MERC32** 包含 **SoC Configurations**、**Generate**、**Toolchain** 和 **Artifacts** 视图。以下命令可在命令面板搜索；打开 `.c` 时编辑器右上角提供 **Build C to ROM**，打开 `.asm` 时提供 **Assemble ASM**。

| 命令标题 | 用途 |
| --- | --- |
| `MERC32 SoC: Create Configuration` / `Open Configuration` | 创建或打开 SoC 配置 |
| `MERC32 SoC: Auto-assign Addresses` / `Validate` | 分配缺失地址、校验配置 |
| `MERC32 SoC: Generate` | 生成当前配置的硬件和软件 |
| `MERC32 SoC: Force Generate` / `Adopt Output` | 处理受管文件修改或输出目录归属变更 |
| `MERC32 SoC: Reopen as Text` / `Refresh` | 文本编辑配置、刷新视图 |
| `MERC32: Build Active File` | 按活动文件类型执行 C 构建或汇编 |
| `MERC32: Build C to ROM` | C 编译、链接并汇编为所选格式 |
| `MERC32: Compile C to ASM` | C 编译、链接并输出汇编 |
| `MERC32: Assemble ASM` | 汇编活动 `.asm` 文件 |
| `MERC32: Select Compile Mode` | 切换正常、打印或调试模式 |
| `MERC32: Assemble ASM (Print Mode)` / `Assemble ASM (Debug Mode)` | 直接使用对应模式汇编 |
| `MERC32: Open Last Artifact` | 打开最近产物 |

正常模式写出产物；打印模式将汇编结果写到 **MERC32 Toolchain** 输出面板；调试模式还生成标签表与预处理后的汇编。该调试模式用于检查构建产物，不是 CPU 源码调试器。

在 VS Code 设置中搜索 `merc32-asm`：

| 设置 | 默认值 | 作用 |
| --- | --- | --- |
| `merc32-asm.outputFormat` | `verilog` | `verilog` / `coe` / `mif` / `hex` / `bin` / `mem` |
| `merc32-asm.outputPath` | 空字符串 | 空值表示源文件目录；自定义目录建议使用绝对路径 |
| `merc32-asm.c.keepAssembly` | `true` | C 构建 ROM 时保留中间 `.asm` |
| `merc32-asm.c.dataBase` | `"0x08000000"` | DLB 数据基址 |
| `merc32-asm.c.dlbAddrWidth` | `16` | DLB 字地址位宽，整数 `1..25`，决定初始栈顶 |
| `merc32-asm.c.codeBase` | `"0x00000000"` | ILB 代码链接基址，须对应实际加载位置 |
| `merc32-asm.c.optimization` | `"none"` | `none` 或 `basic` |

`dataBase` 和 `codeBase` 接受十进制、`0x` 或 `0b` 前缀的字符串。`dataBase` 必须位于 `0x08000000..0x0FFFFFFF`，栈区域独占上界 `dataBase + 2^(dlbAddrWidth + 2)` 不得超过 `0x10000000`，并且必须落在实际 DLB 容量内。

`codeBase` 须为 4 字节对齐的 `0x00000000..0x00007FFF` 地址，以保留近端复位与中断入口；代码末端独占上界不超过 `0x08000000`。这些是工具链地址限制，程序仍须满足实际 ILB 容量和加载器分区。

## ROM 与 Flash 输出

| 格式 | 文件 | 典型用途 |
| --- | --- | --- |
| Verilog | `.v` | 指令 ROM 模块 |
| COE | `.coe` | Xilinx 存储器初始化 |
| MIF | `.mif` | Intel/Altera 存储器初始化 |
| Intel HEX | `.hex` | 支持 Intel HEX 的加载工具 |
| Binary | `.bin` | 原始指令字节流、应用镜像输入 |
| `$readmemh` | `.mem` | Verilog 仿真或存储器初始化 |

Binary 每条 32 位指令按大端顺序输出 4 字节；这是指令文件编码，与 C 对象采用的小端数据布局不同。格式转换不会替代地址链接或 FPGA 存储器配置。

仓库提供 NOR Flash 镜像封装命令。先以实际 ILB 加载地址编译 `.bin`，例如参考 bootloader 的应用使用 `merc32-asm.c.codeBase = "0x1000"`，再在 `merc32-vsce` 目录执行：

```bash
npm run flash:image -- application.bin application.img 0x1000
```

可在末尾另加入口地址，省略时入口等于加载地址。镜像在原始 payload 前添加 20 字节大端头，包含 `M32F` 标识、长度、加载地址、入口和 IEEE CRC32；不重定位或交换 payload 字节。Flash 偏移、分区与硬件参数见 [参考启动加载器](../example/nor_flash_bootloader.c) 和 [仓库启动说明](../README.md)。该脚本是源码仓库工具，扩展未提供 Flash 烧录命令。

## 汇编语法参考

汇编器为独立的 TypeScript 实现，提供语法高亮、代码片段、注释和括号匹配。它也用于检查 C 后端生成的代码、编写启动逻辑或进行底层验证。

每行一条语句，不使用分号分隔；标签可单独成行或写在指令前。立即数无需 `#` 前缀，支持十进制、`0x`、`0b` 和双引号字符字面量。常用形式：

```asm
.prog demo
.org 0x1000
.entry main

main:
    mov r4, 10
    mov r5, r4 + 1
    mul r6, r5, 2
    cmp r7, r6 > r4
    bz r7, r0 + done
    mov r6, 0
done:
    jmp done
```

支持 `mov` 与 ALU 表达式、`mul` / `div` / `divu` / `rem` / `remu`、`lb` / `lbu` / `lh` / `lhu` / `lw`、`sb` / `sh` / `sw`、`cmp` / `cmpu`、`bz` / `bnz` 和 `jmp`。分支标签须写作 `r0 + label`，旧 `brc/brcu` 语法已移除。

预处理提供 `.equ`、`.prog`、`.org`、`.entry`、`.include`、条件编译、宏与重复展开。`.org` 重定位标签但不填充镜像；`.entry` 插入入口跳转；`.include` 按声明顺序将引用文件追加到主文件后。指令编码、立即数扩展和寄存器语义见 [ISA 文档](../docs/ISA.md)，C 与汇编互调见 [ABI 文档](../docs/ABI.md)。

## 从源码开发与打包

在完整源码仓库中使用 Node.js 与 npm：

```bash
cd merc32-vsce
npm ci
npm run compile
npm run prepare:resources
npm test
```

`prepare:resources` 校验并收集随包资源；普通扩展构建使用仓库中的 Aro WASM，不重新编译 Aro。RTL 执行回归还需要 Icarus Verilog。常用专项检查包括：

驱动以 `ip-repo/<外设>/drivers/` 为维护源，扩展保存独立快照。更新 IP 驱动后，在打包前执行 `npm run sync:drivers -- ../../ip-repo`，再运行 `npm run test:soc:drivers`；来源提交、工作区修改状态和文件 SHA-256 记录在 `resources/drivers/provenance.json`。日常安装和生成不依赖 IP 仓库路径。

| 命令 | 检查范围 |
| --- | --- |
| `npm run test:soc` | 配置、编辑器、生成器、RTL 与运行时依赖 |
| `npm run test:c:optimization` | 两种优化模式的执行结果、代码量、栈帧与相关回归 |
| `npm run test:c:function-gc` / `test:c:inline` / `test:c:control-flow` | 函数裁剪、内联、控制流简化 |
| `npm run test:c:far-control-flow` | 远调用与分支展开 |
| `npm run test:extension` | 扩展资源与 VS Code 扩展宿主集成 |

发布前按仓库 [AGENTS.md](../AGENTS.md) 判断版本：仅修复递增 PATCH，兼容功能递增 MINOR，重大或破坏性变更递增 MAJOR；同一未发布版本的重打包不重复递增。同步 `package.json`、`package-lock.json` 的两个版本字段及本页徽章，提交版本元数据后再进行最终来源可追溯构建：

```bash
npm run package:vsix
npm run test:vsix
```

安装包输出为 `merc32-vsce.vsix`。发布验证还须确认 VSIX 内 `extension/package.json` 与源文件一致；仓库 VSIX smoke 检查实际安装包及独立运行所需资源，不能用仅通过 TypeScript 编译替代。

## 许可证

扩展采用 MIT License。Aro、Unicode 数据和其他随包资源的许可证与来源记录随 VSIX 一并提供。
