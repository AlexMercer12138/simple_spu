# MERC32 Toolchain for VSCode

[![Version](https://img.shields.io/badge/Version-2.3.0-blue.svg)](https://github.com/AlexMercer12138/MERC32)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

MERC32 CPU 的统一 VSCode 扩展，集成可视化 SoC 配置、外设驱动生成、C17 编译器与汇编器。从配置硬件、编写裸机程序到生成 ROM 文件，均可在编辑器中完成。

## 功能特性

- 🧩 **SoC 配置器** - 可视化配置存储器、外设、地址映射与中断路由，一键生成 Verilog 顶层
- 🔧 **自动生成驱动** - 支持 GPIO、Timer、UART、INTC、I2C、QSPI、SDIO 和 CAN
- ▶️ **一键编译** - 打开 `.c` / `.asm` 文件，通过编辑器右上角按钮生成汇编或 ROM
- ⌨️ **命令行编译** - CLI 随扩展分发，配置一次 PATH 后可从外部终端编译，无需打开 VSCode或安装 npm 包
- ⚡ **C17 裸机编译** - 内置 Aro 前端，支持结构体、数组、函数指针等常用语法，默认开启 `basic` 优化
- 🗂️ **工具链侧边栏** - 集中管理 SoC 配置、构建命令和生成产物
- 🎨 **汇编编辑支持** - 语法高亮、代码片段、注释与括号匹配
- 🔄 **多种输出格式** - Verilog、COE、MIF、Intel HEX、Binary 和 `$readmemh` MEM

扩展内置编译器、运行库、RTL 和驱动资源，安装后可离线编译与生成，无需另外安装 C 编译器或检出 IP 仓库。FPGA 综合、仿真和烧录使用相应的外部工具。

## 安装

要求 VSCode 1.74.0 或更高版本。在扩展面板选择 **Install from VSIX...**，或执行：

```bash
code --install-extension merc32-vsce.vsix --force
```

## 使用方法

### 命令行 CLI

编辑器内编译只需 VSCode 和本扩展。独立 CLI 额外使用系统 Node.js（已验证 Node.js 24），不需要发布或安装 npm 包，也不需要执行 `npm install`。

1. 安装 Node.js，确认新终端中 `node --version` 正常。
2. 安装本扩展后，在命令面板执行 **MERC32: Set Up Command Line**。
3. 将显示的目录加入用户 `PATH` 一次。Windows 默认是 `%USERPROFILE%\.merc32\bin`；Linux/macOS 默认是 `$HOME/.merc32/bin`。Windows 可在“环境变量 → 用户变量 → Path → 新建”中添加目录；不要用它替换整个 Path。
4. 新开 PowerShell/CMD，执行 `merc32 --version`。扩展激活后新建的 VSCode 集成终端会自动获得此 PATH。

```powershell
# C → ROM；DLB 位宽需与实际 SoC 一致
merc32 build .\software\main.c --format mem --out-dir .\build --dlb-addr-width 13

# C → 汇编
merc32 compile main.c --emit asm --out-dir build

# 汇编 → 二进制
merc32 assemble main.asm --format bin --out-dir build

# 头文件、宏、加载地址和优化
merc32 build main.c -I include -D DEBUG=1 --code-base 0x1000 --optimization basic

merc32 --help
```

CLI 从磁盘读取一个 `.c` 或 `.asm` 文件；不会读取未保存的编辑器内容、`.vscode/settings.json` 或 SoC 配置。默认值与扩展一致：`verilog` 输出、`basic` 优化、代码基址 `0`、数据基址 `0x08000000`、DLB 位宽 `16`，默认输出到源文件所在目录并保留 ASM。请通过参数覆盖项目需要的设置。

`--format` 支持 `verilog/coe/mif/hex/bin/mem`；`--mode` 支持 `normal/print/debug`，其中 `print` 将结果写到标准输出，`debug` 额外输出标签表和展开后的汇编。`--no-keep-assembly` 不生成中间 ASM，也不会删除已有同名 ASM。诊断写入标准错误；退出码 `0` 表示成功、`1` 表示编译或 I/O 失败、`2` 表示命令行用法错误。

扩展每次正常激活都会更新固定目录中的启动器目标。升级后打开一次 MERC32 源文件或再次执行设置命令即可刷新，PATH 无需更改，之后关闭 VSCode 仍可编译。多个版本/编辑器共用目录时，最后激活的版本生效；可在启动 VSCode 前设置绝对路径 `MERC32_CLI_HOME` 隔离启动器（实际 PATH 为该目录下的 `bin`）。远程 SSH/WSL 窗口中的 CLI 安装在扩展运行的远程环境，Node.js 和 PATH 也需要在该环境配置。

卸载扩展后旧启动器会提示重新安装/设置。启动器目录由用户管理；不再使用时可从 PATH 移除并手动清理。Windows CMD/PowerShell 为当前验证平台，POSIX 启动脚本随包提供。

PowerShell 使用 `merc32.ps1` 保留宏参数中的引号和百分号，例如 `'-DMESSAGE="hello world"'`。如果本机执行策略禁止脚本，可用 CMD 中的 `merc32.cmd` 或直接运行 `node "$env:USERPROFILE\.merc32\bin\merc32-launcher.js" --help`；扩展不会修改执行策略。

### SoC 配置与生成

1. 打开项目文件夹，点击活动栏 **MERC32**，执行 **Create Configuration**。
2. 打开 `*.merc32.json`，配置存储器、外设和中断；也可通过 **Reopen as Text** 编辑 JSON。
3. 按需执行 **Auto-assign Addresses**，然后执行 **Validate** 和 **Generate**。
4. 将生成的 `hardware/<project>.v` 加入 FPGA 或仿真工程，从 `software/main.c` 开始编写应用。

选择 **Controller** 中断模式后，配置器自动管理中断控制器及路由。主要生成文件如下：

| 文件 | 用途 |
| --- | --- |
| `hardware/<project>.v` | 完整 SoC Verilog |
| `software/<project>.h` | 地址映射和中断宏 |
| `software/main.c` | 应用程序 |
| `software/drivers/` | 所选外设的驱动与聚合头 |
| `firmware/` | 可选的存储器初始化文件 |
| `README.md`、`manifest.json` | 工程集成说明和生成文件记录 |

同类多个外设共享一份驱动，通过不同基地址的句柄访问。新建 `main.c` 已包含驱动入口 `drivers/merc32_drivers.h`，按应用需求初始化外设即可。例如，项目 `demo` 中的 `gpio0`：

```c
#include "demo.h"
#include "drivers/merc32_drivers.h"

int main(void) {
    gpio_handle_t gpio;
    gpio_init(&gpio, DEMO_GPIO0_BASE);
    gpio_config_output(&gpio, GPIO_PIN_0, GPIO_LEVEL_HIGH);
    for (;;) {}
}
```

再次生成会更新受管文件并清理不再需要的驱动，但始终保留已有的 `main.c`。手工修改过的受管文件会提示冲突，确认需要替换时使用 **Force Generate**。

### 编译 C 程序

1. 打开应用的 `.c` 文件，例如生成的 `software/main.c`。
2. 点击右上角 **Build C to ROM**，或执行 **Compile C to ASM** 仅生成汇编。
3. 在源文件目录或侧边栏 **Artifacts** 中查看结果。

默认使用 `basic` 优化；需要关闭时，将 `merc32-asm.c.optimization` 设为 `none`。当前构建针对活动文件，不会自动扫描其他 `.c`；使用生成驱动时，在应用中包含一次 `drivers/merc32_drivers.h` 即可。

**编译前请确认内存设置与 SoC 一致。** 新建 SoC 默认 DLB 为 32 KiB，对应 `dlbAddrWidth = 13`；编译器默认值 `16` 对应 256 KiB。可在工作区 `.vscode/settings.json` 中设置：

```json
{
  "merc32-asm.c.dlbAddrWidth": 13,
  "merc32-asm.outputFormat": "mem"
}
```

C 编译面向裸机环境，不包含完整标准库；尚不支持浮点运算、64 位整数值运算和可变参数函数等。详细接口与限制见 [ABI 文档](../docs/ABI.md)。

### 编译汇编程序

打开 `.asm` 文件，点击右上角 **Assemble ASM**。通过 **Select Compile Mode** 切换正常、打印或调试模式；调试模式额外输出标签表与展开后的汇编。语法说明见 [ISA 文档](../docs/ISA.md)。

## 配置项

在 VSCode 设置中搜索 `merc32-asm`：

| 配置项 | 默认值 | 说明 |
| --- | --- | --- |
| `merc32-asm.outputFormat` | `verilog` | `verilog` / `coe` / `mif` / `hex` / `bin` / `mem` |
| `merc32-asm.outputPath` | 空 | 输出目录，空则使用源文件目录 |
| `merc32-asm.c.keepAssembly` | `true` | 构建 ROM 时保留汇编文件 |
| `merc32-asm.c.optimization` | `basic` | 优化模式，可设为 `none` 关闭 |
| `merc32-asm.c.dataBase` | `0x08000000` | DLB 数据基址 |
| `merc32-asm.c.dlbAddrWidth` | `16` | DLB 字地址位宽，用于设置栈顶 |
| `merc32-asm.c.codeBase` | `0x00000000` | ILB 代码链接基址，须与实际加载地址一致 |

所有命令均可在命令面板中搜索 `MERC32` 调用。SoC 配置不会自动修改工作区的 C 编译设置。

## 从源码构建

```bash
cd merc32-vsce
npm ci
npm run package:vsix
npm run test:vsix
```

安装包输出为 `merc32-vsce.vsix`。更新 IP 驱动后，可先执行 `npm run sync:drivers -- ../../ip-repo` 同步资源。
