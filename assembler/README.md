# Simple CPU 汇编器

Simple CPU 的汇编器，支持 MOV/JMP/BRC 三种关键字语法，可输出 Verilog、COE、MIF 等多种格式。

## 安装

### 方式一：本地运行（无需安装）

```bash
python assembler.py program.asm
```

### 方式二：Windows 一键安装

双击运行 `install.bat`：

```bash
install.bat
```

或在命令行中执行：

```bash
install.bat
```

安装程序会自动：
- 检查 Python 环境
- 安装 `sass` 命令到系统

安装完成后需要手动将Scripts目录添加到环境变量 PATH 中，即可在任意路径使用：

```bash
sass program.asm
```

### 方式三：手动安装（跨平台）

```bash
cd assembler
pip install -e .
```

### VSCode 插件安装（可选）

提供语法高亮、代码片段和智能提示功能：

```bash
// 本地开发模式安装
cd assembler/sass-vscode-extension
code --extensionDevelopmentPath=.

// 或手动复制到 VSCode 扩展目录
// Windows: %USERPROFILE%\.vscode\extensions\
// macOS/Linux: ~/.vscode/extensions/
```

插件功能：
- 🎨 **语法高亮** - MOV/JMP/BRC 指令、寄存器、立即数、标签、注释
- ✂️ **代码片段** - 输入 `movi`、`movr`、`jmpl`、`brceq` 等快速生成代码
- 📝 **注释支持** - `//` 格式注释，支持 `Ctrl+/` 快捷键
- 🔤 **括号匹配** - 内存访问括号 `[]` 自动匹配

## 卸载

### Windows 一键卸载

双击运行 `uninstall.bat`：

```bash
uninstall.bat
```

或在命令行中执行：

```bash
uninstall.bat
```

### 手动卸载

```bash
pip uninstall simple-cpu-assembler
```

## 使用方法

### 基本用法

```bash
// 默认输出 Verilog 格式，自动生成 test.v
sass program.asm

// 指定输出格式，自动生成对应扩展名文件
sass program.asm -f coe              // 生成 program.coe
sass program.asm -f mif              // 生成 program.mif
sass program.asm -f hex              // 生成 program.hex
sass program.asm -f bin              // 生成 program.bin

// 指定输出文件名
sass program.asm -o output.v

// 仅打印到命令行，不保存文件
sass program.asm -p

// 生成调试文件(标签表和去注释代码)
sass program.asm -d

// 生成示例程序
sass --sample > sample.asm
```

### 支持的指令语法

#### MOV 指令

```asm
// 加载立即数 (I-Type)
MOV Rd, #imm              // Rd = imm

// 寄存器复制 (R-Type)
MOV Rd, Rs                // Rd = Rs
```

#### ALU 运算指令

支持 I-Type（立即数）和 R-Type（寄存器）两种形式：

```asm
// I-Type: Rs op #imm
MOV Rd, Rs + #imm         // Rd = Rs + imm
MOV Rd, Rs - #imm         // Rd = Rs - imm
MOV Rd, Rs & #imm         // Rd = Rs & imm
MOV Rd, Rs | #imm         // Rd = Rs | imm
MOV Rd, Rs ^ #imm         // Rd = Rs ^ imm
MOV Rd, Rs << #imm        // Rd = Rs << imm (逻辑左移)
MOV Rd, Rs >> #imm        // Rd = Rs >> imm (逻辑右移)
MOV Rd, Rs >>> #imm       // Rd = Rs >>> imm (算术右移)

// R-Type: Rs2 op Rs1
MOV Rd, Rs2 + Rs1         // Rd = Rs2 + Rs1
MOV Rd, Rs2 - Rs1         // Rd = Rs2 - Rs1
MOV Rd, Rs2 & Rs1         // Rd = Rs2 & Rs1
MOV Rd, Rs2 | Rs1         // Rd = Rs2 | Rs1
MOV Rd, Rs2 ^ Rs1         // Rd = Rs2 ^ Rs1
MOV Rd, Rs2 << Rs1        // Rd = Rs2 << Rs1 (逻辑左移)
MOV Rd, Rs2 >> Rs1        // Rd = Rs2 >> Rs1 (逻辑右移)
MOV Rd, Rs2 >>> Rs1       // Rd = Rs2 >>> Rs1 (算术右移)
```

#### 内存访问指令

支持 I-Type（立即数偏移）和 R-Type（寄存器偏移）两种形式：

```asm
// I-Type: [Rs + #imm]
MOV Rd, [Rs + #imm]       // Rd = Mem[Rs + imm]
MOV [Rs + #imm], Rd       // Mem[Rs + imm] = Rd

// R-Type: [Rs1 + Rs2]
MOV Rd, [Rs1 + Rs2]       // Rd = Mem[Rs1 + Rs2]
MOV [Rs1 + Rs2], Rd       // Mem[Rs1 + Rs2] = Rd

// 偏移为0的简写形式
MOV Rd, [Rs]              // Rd = Mem[Rs] (等同于 [Rs + #0])
MOV [Rs], Rd              // Mem[Rs] = Rd (等同于 [Rs + #0])
```

#### JMP 指令

语法: `JMP target, Rd` (与 BRC 指令结构保持一致)

```asm
// 跳转到立即数地址 (I-Type)
JMP #imm, Rd              // Rd = PC+1, PC = imm

// 跳转到标签 (I-Type)
JMP label, Rd             // Rd = PC+1, PC = label

// 寄存器跳转 (R-Type)
JMP Rs, Rd                // Rd = PC+1, PC = Rs
```

**注意：** `target` 是跳转目标，`Rd` 是链接寄存器（用于保存返回地址）。

#### BRC 指令（分支）

支持寄存器跳转和立即数/标签跳转：

```asm
// 寄存器跳转 (R-Type)
BRC Rs, Rd2 == Rd1        // if (Rd2 == Rd1) PC = Rs
BRC Rs, Rd2 != Rd1        // if (Rd2 != Rd1) PC = Rs
BRC Rs, Rd2 <  Rd1        // if (Rd2 <  Rd1) PC = Rs  (有符号比较)
BRC Rs, Rd2 >= Rd1        // if (Rd2 >= Rd1) PC = Rs  (有符号比较)

// 立即数跳转 (I-Type)
BRC #imm, Rd2 == Rd1      // if (Rd2 == Rd1) PC = #imm
BRC #imm, Rd2 != Rd1      // if (Rd2 != Rd1) PC = #imm

// 标签跳转 (I-Type，自动汇编为立即数)
BRC label, Rd2 == Rd1     // if (Rd2 == Rd1) PC = label
BRC label, Rd2 != Rd1     // if (Rd2 != Rd1) PC = label
```

**注意：** BLT 和 BGE 使用有符号数比较

### 标签支持

```asm
start:
    MOV R0, #0
    MOV R1, #10

loop:
    MOV R0, R0 + R1
    JMP loop, R2        // 跳转到标签 (JMP target, Rd)
```

### 有符号立即数

立即数为 **16位有符号数**，范围 `-32768 ~ 32767`。

```asm
// 正数
MOV R1, #100              // R1 = 100

// 负数（汇编为补码）
MOV R2, #-1               // R2 = 0xFFFF
MOV R3, #-32768           // R3 = 0x8000

// 十六进制表示（自动解释为无符号值）
MOV R4, #0xFFFF           // R4 = 65535 (等同于 #-1 的无符号表示)
```

### 注释

只支持 `//` 格式的注释：

```asm
// 这是注释
MOV R0, #1          // 这也是注释
```

## 输出格式说明

### Verilog 格式

生成完整的 Verilog ROM 模块，可直接例化使用：

```verilog
// Simple CPU Program Memory Initialization
module prog_rom(
    input wire [7:0] prog_addr,
    output reg [31:0] prog_data
);
always @(*) begin
    case (prog_addr)
        0 : prog_data = 32'h00000000;
        1 : prog_data = 32'h00001001;
        ...
        default: prog_data = 0;
    endcase
end
endmodule
```

### COE 格式（Xilinx）

Xilinx FPGA 内存初始化文件，每行一条指令：

```
// Simple CPU Program Memory COE File
memory_initialization_radix=16;
memory_initialization_vector=
00000000,
00001001,
00000002,
...,
FFFFFFFF;
```

### MIF 格式（Altera/Intel）

Altera/Intel FPGA 内存初始化文件：

```
WIDTH=32;
DEPTH=256;

ADDRESS_RADIX=HEX;
DATA_RADIX=HEX;

CONTENT BEGIN
    0000 : 00000000;
    0001 : 00001001;
    ...
END;
```

### HEX 格式（Intel HEX）

标准Intel HEX格式，包含数据记录和结束记录：

```
:0400000000000010EC
:0400040000010110E6
:0400080000020210E0
:00000001FF
```

格式说明：`:BBAAAATTDD...CC`
- `BB` - 字节数
- `AAAA` - 地址
- `TT` - 记录类型（00=数据，01=结束）
- `DD...` - 数据字节
- `CC` - 校验和

## 参考代码

- example路径下

## 许可证

MIT License
