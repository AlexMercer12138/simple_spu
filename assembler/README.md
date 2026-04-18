# Simple CPU 汇编器

Simple CPU 的汇编器，支持 MOV/JMP/BRC 三种关键字语法，可输出 Verilog、COE、MIF 等多种格式。

## 安装

### 方式一：本地运行（无需安装）

```bash
python assembler.py program.asm
```

### 方式二：安装为命令行工具

```bash
cd assembler
pip install -e .
```

安装后可在任意路径使用：

```bash
simple-asm program.asm
# 或
scpu-asm program.asm
```

## 使用方法

### 基本用法

```bash
# 默认输出 Verilog 格式，自动生成 test.v
simple-asm program.asm

# 指定输出格式，自动生成对应扩展名文件
simple-asm program.asm -f coe      # 生成 program.coe
simple-asm program.asm -f mif      # 生成 program.mif
simple-asm program.asm -f hex      # 生成 program.hex
simple-asm program.asm -f bin      # 生成 program.bin

# 指定输出文件名
simple-asm program.asm -o output.v

# 仅打印到命令行，不保存文件
simple-asm program.asm -p

# 生成示例程序
simple-asm --sample > sample.asm
```

### 支持的指令语法

#### MOV 指令

```asm
; 加载立即数
MOV Rd, #imm              ; Rd = imm

; 寄存器操作
MOV Rd, Rs                ; Rd = Rs
MOV Rd, Rs2 + Rs1         ; Rd = Rs2 + Rs1
MOV Rd, Rs2 - Rs1         ; Rd = Rs2 - Rs1
MOV Rd, Rs2 & Rs1         ; Rd = Rs2 & Rs1
MOV Rd, Rs2 | Rs1         ; Rd = Rs2 | Rs1
MOV Rd, Rs2 ^ Rs1         ; Rd = Rs2 ^ Rs1
MOV Rd, Rs2 << Rs1        ; Rd = Rs2 << Rs1
MOV Rd, Rs2 >> Rs1        ; Rd = Rs2 >> Rs1

; 内存访问
MOV Rd, [Rs]              ; Rd = Mem[Rs]
MOV [Rs1], Rs2            ; Mem[Rs1] = Rs2
```

#### ⚠️ 重要约定：R0 不可写入

**R0 固定为 0，禁止作为目标寄存器写入！**

```asm
; ❌ 错误：不要向R0写入数据
MOV R0, #100              ; 虽然语法允许，但强烈不推荐
MOV R0, R1                ; 同上

; ✅ 正确：R0只能作为源寄存器使用
MOV R1, R0                ; R1 = 0（读取R0的值）
MOV [R0], R2              ; Mem[0] = R2（地址计算使用R0=0）
```

> **为什么有这个约定？**
> - 全零指令 `0x00000000` 被解释为 `SET R0, #0`
> - 如果程序未初始化内存或跳转到了空地址，R0会被清零
> - 遵守约定可避免难以调试的BUG

#### JMP 指令

```asm
; 跳转到立即数地址
JMP Rd, #imm              ; Rd = PC+1, PC = imm

; 跳转到标签
JMP Rd, label             ; Rd = PC+1, PC = label

; 寄存器跳转
JMP Rd, Rs                ; Rd = PC+1, PC = Rs
```

#### BRC 指令（分支）

```asm
BRC Rs, Rd2 == Rd1        ; if (Rd2 == Rd1) PC = Rs
BRC Rs, Rd2 != Rd1        ; if (Rd2 != Rd1) PC = Rs
BRC Rs, Rd2 <  Rd1        ; if (Rd2 <  Rd1) PC = Rs
BRC Rs, Rd2 >= Rd1        ; if (Rd2 >= Rd1) PC = Rs
BRC Rs, Rd2 >  Rd1        ; if (Rd1 <  Rd2) PC = Rs
BRC Rs, Rd2 <= Rd1        ; if (Rd1 >= Rd2) PC = Rs
```

### 标签支持

```asm
start:
    MOV R0, #0
    MOV R1, #10

loop:
    MOV R0, R0 + R1
    JMP R2, loop        ; 跳转到标签
```

### 注释

支持 `#` 和 `;` 开头的注释：

```asm
; 这是注释
MOV R0, #1          # 这也是注释
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
        default: prog_data = 0;
        0 : prog_data = 32'h00000000;
        1 : prog_data = 32'h00001001;
        ...
    endcase
end
endmodule
```

### COE 格式（Xilinx）

Xilinx FPGA 内存初始化文件，每行一条指令：

```
; Simple CPU Program Memory COE File
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

### HEX 格式

纯十六进制，每行一条指令：

```
00000000
00001001
00000002
...
```

## 完整示例

```asm
; 计算 1 + 2 + 3 + 4 = 10
start:
    MOV R0, #0          ; R0 = 0 (累加器)
    MOV R1, #1          ; R1 = 1
    MOV R2, #2          ; R2 = 2
    MOV R3, #3          ; R3 = 3
    MOV R4, #4          ; R4 = 4

    MOV R5, R1          ; R5 = R1
    MOV R5, R5 + R2     ; R5 = R5 + R2 = 3
    MOV R5, R5 + R3     ; R5 = R5 + R3 = 6
    MOV R5, R5 + R4     ; R5 = R5 + R4 = 10

    MOV [R0], R5        ; 存储结果到内存地址0
    MOV R6, [R0]        ; 从内存读取到R6

loop:
    JMP R7, loop        ; 无限循环
```

编译后自动生成 `test.v`：

```bash
$ simple-asm test.asm
成功: 已生成 test.v (11 条指令)
```

## 许可证

MIT License
