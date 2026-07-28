# APB UART 控制器手册

| 项目 | 描述 |
|------|------|
| 模块名 | `apb_uart` |
| 总线协议 | APB (32-bit) |
| 版本 | v1.0 |

---

## 1. 模块概述

`apb_uart` 是一个挂载在 APB 总线上的通用异步串口控制器，支持中断输出。

- 可编程波特率；
- 可配置停止位与奇偶校验；
- 内置 4 字节 TX/RX 寄存器缓存（按字节滑动指针访问）+ 内部 FIFO；
- 4 种可配置中断触发类型；
- 支持软复位。

模块结构：

```
       ┌─────────────────────────┐
APB ──►│  apb_uart               │──► interrupt
       │                         │
       │      ┌───────────────┐  │
       │      │   uart_top    │  │── uart_tx
       │      │ (FIFO + PHY)  │  │── uart_rx
       │      └───────────────┘  │
       └─────────────────────────┘
```

---

## 2. 参数列表

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `SYS_CLK_FREQ` | `50_000_000` | APB 时钟频率，单位 Hz；用于内部计算波特率分频值 |
| `FIFO_DEPTH` | `8` | 内部 TX/RX FIFO 深度（字节），必须为 2 的幂，小于等于 64 |

---

## 3. 端口表

### 3.1 时钟与复位

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `s_apb_pclk` | I | 1 | APB 总线时钟，全部逻辑同步于此时钟 |
| `s_apb_presetn` | I | 1 | 低有效复位，与 `s_apb_pclk` 同步 |

### 3.2 APB 从设备接口

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `s_apb_psel` | I | 1 | 从机片选 |
| `s_apb_penable` | I | 1 | 总线使能（第二个时钟） |
| `s_apb_pwrite` | I | 1 | 1=写访问，0=读访问 |
| `s_apb_paddr` | I | 32 | 字节地址（实际只使用 `paddr[31:2]` 作为字地址） |
| `s_apb_pwdata` | I | 32 | 写数据 |
| `s_apb_pready` | O | 1 | 传输应答（典型 1 个 wait state） |
| `s_apb_pslverr` | O | 1 | 错误指示（恒 0） |
| `s_apb_prdata` | O | 32 | 读数据 |

### 3.3 中断

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `interrupt` | O | 1 | 中断输出，高有效 |

### 3.4 串口物理接口

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `uart_rx` | I | 1 | 串行接收线 |
| `uart_tx` | O | 1 | 串行发送线 |

---

## 4. 寄存器表

寄存器以 32-bit 对齐，地址 = `BASE + (字索引 × 4)`。模块内部使用 `paddr[31:2]` 直接作为字索引译码。

| 偏移 | 字索引 | 名称 | 访问 | 复位值 | 描述 |
|------|--------|------|------|--------|------|
| `0x00` | 0 | `CTRL` | RW | `0x0000_0000` | UART 收发控制与软复位 |
| `0x04` | 1 | `CONFIG` | RW | `0x0000_0000` | 波特率、停止位、校验配置 |
| `0x08` | 2 | `RX_BUF` | RO | `0x0000_0000` | 接收数据滑动缓存（读后会清零内部指针） |
| `0x0C` | 3 | `RX_STATUS` | RO | `0x0000_0000` | 接收状态 |
| `0x10` | 4 | `TX_BUF` | WO | `0x0000_0000` | 发送数据滑动缓存 |
| `0x14` | 5 | `TX_STATUS` | RO | `0x0000_0000` | 发送状态 |
| `0x18` | 6 | `INTERRUPT` | RW | `0x0000_0000` | 中断使能、触发源、计数阈值 |

> 注：未列出的偏移读访问返回上一次成功读取数据；写访问被忽略。`PSLVERR` 恒为 0。

### 4.1 CTRL — 控制寄存器 (offset 0x00)

| 位 | 名称 | 类型 | 描述 |
|----|------|------|------|
| `[31]` | `SOFT_RST` | RW | 软复位：写 1 复位串口物理层 |
| `[30:7]` | — | — | 保留 |
| `[6:5]` | `TX_CNT_MAX` | RW | TX 发送长度（取值 0-3，对应 1-4 字节） |
| `[4]` | `TX_EN` | W1S | 写 1 启动一次 TX 发送（**自动清零**） |
| `[3]` | — | — | 保留 |
| `[2:1]` | `RX_CNT_MAX` | RW | RX 接收长度（取值 0-3，对应 1-4 字节） |
| `[0]` | `RX_EN` | W1S | 写 1 启动一次 RX 接收（**自动清零**） |

行为说明：
- 向 `TX_EN` 写 1 时，按照 `TX_CNT_MAX` 对应的长度将 `TX_BUF` 中的数据填充到发送 FIFO 中，发送 FIFO 中存在数据时串口会自动发送，`TX_EN` 会自动清零；
- 向 `RX_EN` 写 1 时，按照 `RX_CNT_MAX` 对应的长度将接收 FIFO 中的数据读取到 `RX_BUF` 中，接收 FIFO 中数据不够一次接收时会持续接收直到满足此次长度，`RX_EN` 会自动清零；

### 4.2 CONFIG — 串口物理层配置 (offset 0x04)

| 位 | 名称 | 类型 | 描述 |
|----|------|------|------|
| `[31]` | `STOP_BIT` | RW | 0=1 个停止位，1=2 个停止位 |
| `[30:29]` | `PARITY_TYPE` | RW | `00`=无校验，`01`=奇校验，`10`=偶校验，`11`=保留 |
| `[28:24]` | — | — | 保留 |
| `[23:0]` | `BAUD_RATE` | RW | 目标波特率（Hz），如 `115200`=`0x01_C200` |

### 4.3 RX_BUF — 接收缓存 (offset 0x08, RO)

| 位 | 字段 | 描述 |
|----|------|------|
| `[31:24]` | `RX_BYTE0` | 第 1 个接收字节 |
| `[23:16]` | `RX_BYTE1` | 第 2 个接收字节 |
| `[15:08]` | `RX_BYTE2` | 第 3 个接收字节 |
| `[07:00]` | `RX_BYTE3` | 第 4 个接收字节 |

行为：
- 接收的字节按 `RX_PTR` 指向位置依次写入；
- 软件读取该寄存器后，硬件清除 `RX_BUF`，并将 `RX_PTR` 复位为 0。

### 4.4 RX_STATUS — 接收状态 (offset 0x0C, RO)

| 位 | 名称 | 描述 |
|----|------|------|
| `[31:10]` | — | 保留 |
| `[9]` | `RX_READY` | 接收使能指示 |
| `[8]` | `RX_VALID` | 接收 FIFO 非空指示 |
| `[7:6]` | `RX_CNT` | 当前一轮已接收字节数 |
| `[5:2]` | `RX_DATA_CNT` | 接收 FIFO 中剩余可读字节数 |
| `[1:0]` | `RX_PTR` | 下一个写入 `RX_BUF` 的字节位置 |

### 4.5 TX_BUF — 发送缓存 (offset 0x10, WO)

| 位 | 字段 | 描述 |
|----|------|------|
| `[31:24]` | `TX_BYTE0` | 第 1 个发送字节 |
| `[23:16]` | `TX_BYTE1` | 第 2 个发送字节 |
| `[15:08]` | `TX_BYTE2` | 第 3 个发送字节 |
| `[07:00]` | `TX_BYTE3` | 第 4 个发送字节 |

行为：
- 写入 `TX_BUF` 后，硬件会清除 `TX_PTR`。

### 4.6 TX_STATUS — 发送状态 (offset 0x14, RO)

| 位 | 名称 | 描述 |
|----|------|------|
| `[31:10]` | — | 保留 |
| `[9]` | `TX_VALID` | 发送使能指示 |
| `[8]` | `TX_READY` | 发送 FIFO 非满指示 |
| `[7:6]` | `TX_CNT` | 当前一轮已发送字节数 |
| `[5:2]` | `TX_DATA_CNT` | 发送 FIFO 中尚未发出的字节数 |
| `[1:0]` | `TX_PTR` | 下一个从 `TX_BUF` 取出的字节位置 |

### 4.7 INTERRUPT — 中断控制 (offset 0x18)

| 位 | 名称 | 描述 |
|----|------|------|
| `[31:24]` | `TX_CNT_THRESH` | 当触发源 = 3 时使用：与 `TX_DATA_CNT` 比较 |
| `[23:16]` | `RX_CNT_THRESH` | 当触发源 = 2 时使用：与 `RX_DATA_CNT` 比较 |
| `[15:5]` | — | 保留 |
| `[4]` | `INT_FLAG` | 粘滞中断标志；硬件置 1，软件写 0 清除，读取不清除 |
| `[3]` | — | 保留，写入时强制清零 |
| `[2:1]` | `INT_TYPE` | 触发源选择，见下表 |
| `[0]` | `INT_EN` | 中断使能 |

`INT_FLAG` 在 `interrupt` 有效后由硬件置 1。读取 `INTERRUPT` 不改变该标志；
软件需要写回控制值并令 bit 4 为 `0` 才能清除。bit 3 始终为保留位，RTL 在
读写寄存器时使用掩码将其保持为 `0`。

中断触发源（`INT_TYPE`）：

| 取值 | 触发条件 |
|------|----------|
| `00` | `RX_VALID` UART 接收 FIFO 非空 |
| `01` | `TX_READY` UART 发送 FIFO 非满 |
| `10` | `RX_DATA_CNT == RX_CNT_THRESH` |
| `11` | `TX_DATA_CNT == TX_CNT_THRESH` |

---

## 6. 编程指导

> 以下示例与 [uart_test.asm](file:///d:/Software/simple_cpu/example/uart_test.asm) 完全对应。
> 关键约定：`CNT_MAX = N` 时，一次操作的字节数为 **N+1**；启动一次收/发只需向 CTRL 写一次相应的 `EN` 位（硬件自动清零）。

### 6.1 初始化序列（推荐）

```
1. 写 CONFIG    = 115200             // 直接填目标波特率(Hz)
2. 写 INTERRUPT = 0x00000001         // INT_EN=1, INT_TYPE=00 (RX_VALID 触发)
3. （可选）配置 CPU 中断向量, 选择上升沿触发
```

无需显式发起软复位；上电复位 (`presetn`) 已将所有寄存器清零。

### 6.2 发送 1 字节示例

```
等待 TX 通道空闲:
    while ((TX_STATUS >> 9) & 1) ;       // 等待 TX_VALID == 0

写入数据并启动:
    TX_BUF = byte << 24;                 // 单字节放在 [31:24]
    CTRL   = 0x0010;                     // TX_EN=1, TX_CNT_MAX=0 (1 字节)
```

对应汇编宏（[uart_test.asm](file:///d:/Software/simple_cpu/example/uart_test.asm) 中 `UartSendByte`）。

### 6.3 发送 4 字节示例

```
等待 TX 通道空闲:
    while ((TX_STATUS >> 9) & 1) ;       // 等待 TX_VALID == 0

写入数据并启动:
    TX_BUF = {b0, b1, b2, b3};           // 写后硬件自动清 TX_PTR
    CTRL   = 0x0070;                     // TX_EN=1, TX_CNT_MAX=3 (4 字节)
```

对应汇编宏 `UartSendInt`。**每发一帧都需要重写 CTRL**，因为 `TX_EN` 硬件自动清零。

### 6.4 接收 1 字节示例

```
启动接收:
    CTRL = 0x0001;                       // RX_EN=1, RX_CNT_MAX=0 (1 字节)

读取数据 (硬件填满后会自动清 RX_EN):
    byte = RX_BUF >> 24;                 // 单字节位于 [31:24]
                                         // 读 RX_BUF 后 RX_PTR/RX_BUF 自动清零
```

轮询接收完成时应等待 `RX_STATUS.RX_PTR != 0`，再读取 `RX_BUF`。不要要求软件
必须观察到 `RX_READY` 从 1 变为 0：如果字节在启动 RX 前已经进入 FIFO，硬件
可能在两次软件读寄存器之间完成搬运，软件将看不到短暂的 `RX_READY=1`。

对应汇编宏 `UartRecvByte`。

### 6.5 中断模式

主循环周期性发送 `"Hello world!\r\n"`，串口接收到的字节通过中断原样回送。

```
主循环:
    1. 等待 TX_VALID==0, 调用 UartSendInt(0x4865_6C6C)   // "Hell"
    2. 等待 TX_VALID==0, 调用 UartSendInt(0x6F20_776F)   // "o wo"
    3. 等待 TX_VALID==0, 调用 UartSendInt(0x726C_6421)   // "rld!"
    4. 等待 TX_VALID==0, 调用 UartSendByte(0x0A)         // "\n"
    5. 等待 TX_VALID==0, 调用 UartSendByte(0x0D)         // "\r"
    6. 延时, 跳回 1

ISR (RX_VALID 上升沿):
    1. 关 CPU 中断使能 (防止重入)
    2. CTRL = 0x0001;            读取 RX_BUF >> 24       // UartRecvByte
    3. 等待 TX_VALID==0
    4. TX_BUF = byte << 24;  CTRL = 0x0010              // UartSendByter 回送
    5. 开 CPU 中断使能
    6. jmp r2[15:0]              返回主程序
```

### 6.6 软复位

如需在运行中复位 UART 物理层，写 `CTRL[31] = 1` 即可；硬件下一拍即将下层 `uart_top` 的 `rst_n` 拉低。

### 6.7 寄存器副作用速查

下列副作用由硬件自动完成，软件无需显式操作：

| 操作 | 自动效果 |
|------|---------|
| 读 `RX_BUF` | `RX_STATUS[1:0] ← 0`，`RX_BUF ← 0` |
| 写 `TX_BUF` | `TX_STATUS[1:0] ← 0` |
| RX 收满 (`RX_CNT == RX_CNT_MAX`) | `CTRL.RX_EN ← 0` |
| TX 发完 (`TX_CNT == TX_CNT_MAX`) | `CTRL.TX_EN ← 0` |

---

## 7. 应用注意事项

1. **波特率切换**：写 `CONFIG.BAUD_RATE` 后需要约 32 个 `pclk` 周期完成除法器收敛，期间不应启动新的 TX。
2. **CNT_MAX 配置**：必须与软件期望的滑动窗口长度一致；若设置 `RX_CNT_MAX=3` 而软件按 1 字节读取，会出现指针越界等待。
3. **中断触发模式**：本控制器输出电平型 `interrupt`，建议在 CPU 端选择上升沿触发以避免重复进入 ISR。
4. **PSLVERR**：当前实现恒为 0，因此非法地址访问不会报错，调试时需自行核对地址。
5. **FIFO 深度**：`FIFO_DEPTH` 决定连续突发能力；若开启 `INT_TYPE = 2/3`（基于 FIFO 计数阈值），阈值不得超过 `FIFO_DEPTH`。

---

## 8. 实例化模板

```verilog
apb_uart #(
    .SYS_CLK_FREQ   (50_000_000),
    .FIFO_DEPTH     (8))
u_apb_uart (
    .s_apb_pclk     (pclk),
    .s_apb_presetn  (presetn),

    .s_apb_psel     (psel),
    .s_apb_penable  (penable),
    .s_apb_pwrite   (pwrite),
    .s_apb_paddr    (paddr),
    .s_apb_pwdata   (pwdata),

    .s_apb_pready   (pready),
    .s_apb_pslverr  (pslverr),
    .s_apb_prdata   (prdata),

    .interrupt      (uart_irq),

    .uart_rx        (uart_rx),
    .uart_tx        (uart_tx));
```

---

## 9. 相关文件

- [apb_uart.v](file:///d:/Software/simple_cpu/rtl/uart/apb_uart.v) — APB 寄存器与中断包装
- [uart_top.v](file:///d:/Software/simple_cpu/rtl/uart/uart_top.v) — UART 核心（FIFO + 物理层）
- [tb_apb_uart.v](file:///d:/Software/simple_cpu/rtl/uart/tb_apb_uart.v) — 模块级仿真测试平台
- [uart_test.asm](file:///d:/Software/simple_cpu/example/uart_test.asm) — 周期打印 + 中断回显示例
