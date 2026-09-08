# MERC32

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Verilog](https://img.shields.io/badge/Language-Verilog-blue.svg)](https://en.wikipedia.org/wiki/Verilog)

一个轻量级32位RISC CPU核心，采用Verilog HDL实现，面向嵌入式系统和SoC应用。

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-32bit%20RISC-green.svg" alt="Architecture">
  <img src="https://img.shields.io/badge/Registers-16-green.svg" alt="Registers">
  <img src="https://img.shields.io/badge/Instructions-32-green.svg" alt="Instructions">
  <img src="https://img.shields.io/badge/Bus-AXI4--Lite-orange.svg" alt="Bus">
</p>

---

## ✨ 特性

- 🚀 **单周期执行** - 大多数指令在一个指令周期完成
- 📦 **资源占用少** - 适合FPGA实现，逻辑资源消耗低
- 🔌 **支持多接口** - 支持 AMBA 标准总线接口，便于集成到ARM/SoC系统
- 📝 **灵活指令集** - 4位操作类型 × 4位功能码 = 最多256条指令
- 🔄 **中断控制器** - 支持软件配置中断使能，中断触发方式，中断向量
- 🔢 **有符号数支持** - 原生支持有符号数运算和比较
- 🎨 **VSCode 扩展** - 集成汇编器、编译器、语法高亮、代码片段

---

## 🚀 快速开始

### 文件结构

```
MERC32/
├── docs/                         # 文档
├── example/                      # 示例程序
├── merc32-vsce/                  # VSCode 汇编器扩展
├── rtl/                          # RTL源代码
├── LICENSE                       # MIT许可证
└── README.md                     # 项目介绍
```

### 端口说明

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `clk` | Input | 1 | 系统时钟 |
| `rst_n` | Input | 1 | 低电平有效复位 |
| `interrupt` | Input | 1 | 中断请求信号 |
| `tck` | Input | 1 | JTAG 调试接口 |
| `tms` | Input | 1 | JTAG 调试接口 |
| `tdi` | Input | 1 | JTAG 调试接口 |
| `tdo` | Output | 1 | JTAG 调试接口 |

### 顶层参数

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `ILB_ADDR_WIDTH` | `16` | 指令本地总线字地址宽度 |
| `DLB_ADDR_WIDTH` | `16` | 数据本地总线字地址宽度 |
| `JTAG_IDCODE_VALUE` | `32'h4d32_0001` | JTAG IDCODE |
| `DEBUG_EN` | `1` | 设为 `1` 启用 JTAG 调试；设为 `0` 时综合裁剪调试模块，并将 `tdo` 固定为 `0` |

### 固定软件地址映射

| 区域 | 字节地址范围 |
|------|--------------|
| ILB | `0x00000000` - `0x07FFFFFF` |
| DLB | `0x08000000` - `0x0FFFFFFF` |
| PLB | `0x10000000` - `0xFFFFFFFF` |

**Local Bus 接口**

`MERC32_top` 固定提供三组 Local Bus。ILB 和 DLB 可直接连接 `spram.v`
或 FPGA RAM IP；PLB 用于连接外设。协议桥应在 CPU 包装器之外实现。

| ILB 信号 | 方向 | 位宽 | 描述 |
|----------|------|------|------|
| `ilb_rden` / `ilb_wren` | Output | 1 | 读/写请求 |
| `ilb_addr` | Output | `ILB_ADDR_WIDTH` | 指令存储器字地址 |
| `ilb_strb` | Output | 4 | 字节写使能 |
| `ilb_wdata` | Output | 32 | 写数据 |
| `ilb_rdata` | Input | 32 | 读数据 |
| `ilb_ack` | Input | 1 | 请求完成应答 |

| DLB 信号 | 方向 | 位宽 | 描述 |
|----------|------|------|------|
| `dlb_rden` / `dlb_wren` | Output | 1 | 读/写请求 |
| `dlb_addr` | Output | `DLB_ADDR_WIDTH` | 数据存储器字地址 |
| `dlb_strb` | Output | 4 | 字节写使能 |
| `dlb_wdata` | Output | 32 | 写数据 |
| `dlb_rdata` | Input | 32 | 读数据 |
| `dlb_ack` | Input | 1 | 请求完成应答 |

| PLB 信号 | 方向 | 位宽 | 描述 |
|----------|------|------|------|
| `plb_rden` / `plb_wren` | Output | 1 | 读/写请求 |
| `plb_addr` | Output | 32 | 外设字节地址 |
| `plb_strb` | Output | 4 | 字节写使能 |
| `plb_wdata` | Output | 32 | 写数据 |
| `plb_rdata` | Input | 32 | 读数据 |
| `plb_ack` | Input | 1 | 请求完成应答 |

---

## 🛠️ VSCode 工具链扩展

项目提供 `merc32-vsce` VSCode 扩展，集成了 MERC32 汇编器与 Tiny C 编译器，并通过活动栏侧边栏组织构建命令与产物。打开 `.asm` / `.c` 文件时，扩展会提供语法高亮、代码片段以及右上角的一键编译按钮，支持正常、打印、调试三种编译模式，并可将结果输出为 Verilog、COE、MIF、Intel HEX、Binary 或 `$readmemh` 内存文件。

当前 C 工具链使用 Aro C17 freestanding 前端，支持标准宏展开、条件预处理和包含，
再生成 MERC32 对象并链接。已补齐常用整数表达式、字符串、局部静态对象、复合字面量、
内存/字符串运行库和中断临界区接口。诊断定位到原始源文件、行和列；完整支持范围与限制见
[merc32-vsce/README.md](merc32-vsce/README.md#c17-编译器)。

详细安装、使用方法与配置项见 [merc32-vsce/README.md](merc32-vsce/README.md)。

### QSPI NOR 启动加载器

[`example/nor_flash_bootloader.c`](example/nor_flash_bootloader.c) 是默认 SoC
布局的参考启动加载器。它占用 ILB `0x00000000..0x00000fff`，通过
`0x10004000` 的 `apb_qspi` 从 NOR Flash 偏移 `0x00100000` 读取镜像，并将
状态写到 `0x08000000`。QSPI 使用 `0x03` 读命令、24 位地址、1-1-1 模式，
`CLOCK_CFG=1`、`TRANSFER_CFG=0x00000088`、`PHASE_CFG=0x00001808`。

应用必须使用 Tiny C 配置 `merc32-asm.c.codeBase=0x1000` 编译，并且完整落在
ILB `0x00001000..0x00007fff`。先将编译得到的原始大端 Binary 用
`npm run flash:image -- <application.bin> <application.img> 0x1000 [entry]`
封装为带 20 字节大端头和 IEEE CRC32 的镜像，再用 Flash 编程器把
`application.img` 写入 Flash 偏移 `0x00100000`。启动成功写入
`0x600d0000` 后间接跳转到镜像入口；失败写入 `0x0bad0000 | reason`，其中
非零原因码依次标识 QSPI、magic、大小、加载地址、入口、Flash 范围和 CRC。

---

## 🏗️ 架构

### 微架构

项目采用状态机架构，程序运行稳定，吞吐量低

```mermaid
stateDiagram-v2
    direction LR
    LOAD --> EXEC
    EXEC --> WREG
    WREG --> STEP
    STEP --> LOAD: 正常循环
    STEP --> INTR: 中断触发
    INTR --> LOAD: 中断返回
    STEP --> HALT: 调试模式
    HALT --> LOAD: 单步调试
```

### 寄存器文件

- 软件可见 16 个 32 位寄存器，其中 `r0` 固定为 `0`
- `r1-r3` 和 `r15` 为专用寄存器，`r4-r14` 为通用寄存器组
- 复位后寄存器初始化为 `0`；通用寄存器组在 CPU 的初始化状态中逐项清零

### 寄存器使用约定

| 寄存器 | 用途 | 说明 |
|--------|------|------|
| `r0` | 零寄存器 | 固定为0，**不可写入** |
| `r1` | 中断控制寄存器 | r1[0]=中断使能，r1[2:1]=中断触发类型 |
| `r2` | 中断跳转寄存器 | 中断跳转地址 |
| `r3` | 中断返回寄存器 | 中断返回地址 |
| `r4-r14` | 通用寄存器 | 可自由使用 |
| `r15` | PC寄存器 | 软件可读写，空闲时自动刷新为当前指令地址 |

### JTAG 单寄存器访问

JTAG 指令宽度为 5 位，寄存器访问指令 `IR_DBG_REGS` 的编码为
`5'b10011`。该指令使用一个 37 位数据寄存器，每次只读取一个 CPU
寄存器：

| 位段 | 含义 |
|------|------|
| `[0]` | 请求位；在 `Update-DR` 写入 `1` 发起一次读取，捕获响应时恒为 `0` |
| `[4:1]` | 寄存器编号 `0-15`；响应中返回实际读取的编号 |
| `[36:5]` | 32 位寄存器数据；发起请求时忽略 |

CPU 只有在调试暂停状态下才接受寄存器读取请求。发起请求后，可读取
`IR_DBG_STATUS`：bit 5 为寄存器事务忙标志，bit 6 为响应有效标志。
等待 bit 5 清零并确认 bit 6 为 `1` 后，再捕获 `IR_DBG_REGS` 取得编号和
数据。事务忙时提交的新请求不会启动另一笔访问。

---

## 📄 许可证

本项目采用 [MIT License](LICENSE) 许可证。

---

## 👤 作者

- **Mercer**
- WeChat: zxw895674551
- Email: alexmercer@outlook.com

---

## 📚 相关文档

- [指令集参考](ISA.md) - 完整的指令集说明
- [VSCode 汇编器扩展](assembler/README.md) - 扩展安装、使用和市场页说明

---

<p align="center">
  Made with ❤️ for FPGA enthusiasts
</p>
