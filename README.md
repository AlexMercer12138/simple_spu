# Simple CPU

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Verilog](https://img.shields.io/badge/Language-Verilog-blue.svg)](https://en.wikipedia.org/wiki/Verilog)

一个轻量级32位RISC CPU核心，采用Verilog HDL实现，面向嵌入式系统和SoC应用。

<p align="center">
  <img src="https://img.shields.io/badge/Architecture-32bit%20RISC-green.svg" alt="Architecture">
  <img src="https://img.shields.io/badge/Registers-16-green.svg" alt="Registers">
  <img src="https://img.shields.io/badge/Instructions-30-green.svg" alt="Instructions">
  <img src="https://img.shields.io/badge/Bus-AXI4--Lite-orange.svg" alt="Bus">
</p>

---

## ✨ 特性

- 🚀 **单周期执行** - 大多数指令在一个指令周期完成
- 📦 **资源占用少** - 适合FPGA实现，逻辑资源消耗低
- 🔌 **AXI4-Lite接口** - 标准总线接口，便于集成到ARM/SoC系统
- 📝 **灵活指令集** - 16种功能 × 2种寻址方式 = 32条指令
- 🔄 **三级流水线** - 取指、执行和跳转阶段串行处理
- 🔢 **有符号数支持** - 原生支持有符号数运算和比较
- 🎨 **VSCode 插件** - 语法高亮、代码片段、智能提示

---

## 🚀 快速开始

### 文件结构

```
CPU/
├── rtl/
│   └── simple_cpu.v              # CPU核心代码
├── assembler/                    # 汇编器
│   ├── assembler.py              # 汇编器主程序
│   ├── sass-vscode-extension/    # VSCode插件
│   │   ├── package.json
│   │   ├── syntaxes/
│   │   ├── snippets/
│   │   └── language-configuration/
│   ├── setup.py                  # 安装脚本
│   └── README.md                 # 汇编器使用说明
├── README.md                     # 项目介绍
└── ISA.md                        # 指令集参考
```

### 端口说明

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `clk` | Input | 1 | 系统时钟 |
| `rst_n` | Input | 1 | 低电平有效复位 |
| `prog_addr` | Output | 8 | 程序地址（256条指令） |
| `prog_data` | Input | 32 | 程序数据（指令） |

**AXI4-Lite主接口**

| 通道 | 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|------|
| 写地址 | `m_axi_awvalid/awready/awaddr` | master | 1/1/32 | 写地址通道 |
| 写数据 | `m_axi_wvalid/wready/wdata/wstrb` | master | 1/1/32/4 | 写数据通道 |
| 写响应 | `m_axi_bvalid/bready/bresp` | master | 1/1/2 | 写响应通道 |
| 读地址 | `m_axi_arvalid/arready/araddr` | master | 1/1/32 | 读地址通道 |
| 读数据 | `m_axi_rvalid/rready/rresp/rdata` | master | 1/1/2/32 | 读数据通道 |

---

## 🧩 指令集

### 指令格式

所有指令均为 **32位定长** 格式，采用分层编码：

```
31                 16  15  12  11   8  7    4  3    0
├─────────────────────┼───────┼───────┼───────┼───────┤
│   immediate/src_1   │ src_2 │ dest  │ opcode│ funct │
│       [15:0]        │ [3:0] │ [3:0] │ [3:0] │ [3:0] │
└─────────────────────┴───────┴───────┴───────┴───────┘
```

| 字段 | 位宽 | 描述 |
|------|------|------|
| `immediate` | 16位 [31:16] | 立即数/地址偏移 |
| `reg_src_1` | 4位 [19:16] | 源寄存器1索引 |
| `reg_src_2` | 4位 [15:12] | 源寄存器2索引 |
| `reg_dest` | 4位 [11:8] | 目标寄存器索引 |
| `opcode` | 4位 [7:4] | 操作类型码 |
| `funct` | 4位 [3:0] | 功能码 |

### 操作类型码 (Opcode)

| Opcode | 类型 | 说明 |
|--------|------|------|
| `0001` | I-Type | 立即数操作 - 使用16位立即数作为操作数 |
| `0010` | R-Type | 寄存器操作 - 使用寄存器值作为操作数 |

### 功能码 (Funct)

| Funct | 助记符 | 描述 |
|-------|--------|------|
| `0000` | `SET` | 设置/移动 |
| `0001` | `ADD` | 加法 |
| `0010` | `SUB` | 减法 |
| `0011` | `AND` | 按位与 |
| `0100` | `OR`  | 按位或 |
| `0101` | `XOR` | 按位异或 |
| `0110` | `SLL` | 逻辑左移 |
| `0111` | `SRL` | 逻辑右移 |
| `1000` | `SRA` | 算术右移 |
| `1001` | `MWR` | 内存写 |
| `1010` | `MRD` | 内存读 |
| `1011` | `JAL` | 跳转并链接 |
| `1100` | `BEQ` | 相等分支 |
| `1101` | `BNE` | 不等分支 |
| `1110` | `BLT` | 小于分支（有符号比较） |
| `1111` | `BGE` | 大于等于分支（有符号比较） |

---

## 🛠️ 汇编器

项目包含一个Python汇编器，支持简洁的 MOV/JMP/BRC 语法：

```bash
cd assembler
python assembler.py program.asm     # 生成 program.v
```

### 汇编示例

```asm
; 计算 1+2+3+4 = 10
start:
    MOV R0, #0
    MOV R1, #1
    MOV R2, #2
    MOV R3, R1 + R2      ; R3 = 3
    MOV [R0], R3         ; Mem[0] = R3
loop:
    JMP R4, loop         ; 无限循环
```

### 支持的输出格式

| 格式 | 命令 | 说明 |
|------|------|------|
| Verilog | `-f verilog` | 完整的ROM模块 |
| COE | `-f coe` | Xilinx FPGA 内存初始化 |
| MIF | `-f mif` | Altera/Intel FPGA 内存初始化 |
| HEX | `-f hex` | Intel HEX文件 |
| BIN | `-f bin` | 二进制 |

详细说明见 [assembler/README.md](assembler/README.md)

---

## 🏗️ 架构

### 微架构

```
    取指阶段            执行阶段             跳转阶段
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  prog_load  │ --> │  prog_exec  │ --> │  prog_step  │
└─────────────┘     └─────────────┘     └─────────────┘
```

### 寄存器文件

- **16个32位有符号寄存器** (`regi_int[0:15]`)
- 复位后，16个寄存器初始化为值 `0`

#### 寄存器使用约定

| 寄存器 | 用途 | 说明 |
|--------|------|------|
| `R0` | 零寄存器 | 固定为0，**不可写入** |
| `R1-R15` | 通用寄存器 | 可自由使用，包括作为JMP链接寄存器 |

---

## 📊 技术规格

| 特性 | 参数 |
|------|------|
| 架构 | 32位 RISC |
| 寄存器数量 | 16个有符号通用寄存器 |
| 指令宽度 | 32位 |
| 指令数量 | 32条（16种功能 × 2种寻址方式） |
| 数据通路 | 单周期执行 |
| 内存接口 | AXI4-Lite |
| 程序存储 | 256条指令（8位地址） |
| 时间刻度 | 1ns / 1ps |
| 有符号数支持 | 原生支持 |

---

## ⚠️ 已知限制

- 程序存储有限 - 8位地址仅支持256条指令
- 无硬件乘法/除法 - 需软件实现复杂运算
- 无中断支持 - 需要外部中断控制器
- 无调试接口 - 需要时序仿真验证程序正确性

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
- [汇编器文档](assembler/README.md) - 汇编器使用指南
- [VSCode 插件](assembler/sass-vscode-extension) - 语法高亮和代码片段

---

<p align="center">
  Made with ❤️ for FPGA enthusiasts
</p>
