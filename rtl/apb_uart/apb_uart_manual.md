# APB UART 中文编程手册

## 1. 模块概述

`apb_uart` 是一个 32 位 APB UART 外设，包含相互独立的字节宽 TX FIFO 和
RX FIFO。发送端和接收端可分别持续使能，软件通过 `TX_DATA` 逐字节写入发送
FIFO，通过 `RX_DATA` 逐字节读取接收 FIFO。

当前实现支持：

- 可编程波特率；
- 8 位数据，低位先传输；
- 1 个或 2 个停止位；
- 无校验、奇校验或偶校验；
- 独立的收发使能和 FIFO 清空命令；
- 4 种可选的电平型中断条件；
- 外设软复位。

模块不会报告奇偶校验错误、帧错误或 FIFO 溢出错误。接收校验失败或 RX FIFO
已满时，新字节会被丢弃；TX FIFO 已满时，新的 `TX_DATA` 写入会被忽略。

## 2. 参数与接口

### 2.1 参数

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `SYS_CLK_FREQ` | `50_000_000` | `s_apb_pclk` 频率，单位 Hz |
| `FIFO_DEPTH` | `8` | TX/RX FIFO 深度；应取不小于 8 的 2 的幂，且不超过 128 |

FIFO 存储阵列本身不清零。硬件复位、软复位或 FIFO 清空命令会复位 FIFO
读写指针和数据量，因此清空后旧存储内容不可再访问。

### 2.2 端口

| 端口 | 方向 | 说明 |
|---|---|---|
| `s_apb_pclk` | 输入 | APB、UART 和 FIFO 共用时钟 |
| `s_apb_presetn` | 输入 | 同步低有效复位 |
| `s_apb_psel` | 输入 | APB 从机选择 |
| `s_apb_penable` | 输入 | APB 访问阶段指示 |
| `s_apb_pwrite` | 输入 | `1` 为写，`0` 为读 |
| `s_apb_paddr[31:0]` | 输入 | APB 字节地址 |
| `s_apb_pwdata[31:0]` | 输入 | APB 写数据 |
| `s_apb_pready` | 输出 | APB 传输完成应答 |
| `s_apb_pslverr` | 输出 | 恒为 `0` |
| `s_apb_prdata[31:0]` | 输出 | APB 读数据 |
| `interrupt` | 输出 | 高有效 UART 中断 |
| `uart_rx` | 输入 | 串行接收线，空闲电平为高 |
| `uart_tx` | 输出 | 串行发送线，空闲电平为高 |

## 3. APB 访问行为

寄存器按 32 位对齐，使用 `s_apb_paddr[11:2]` 译码。一次被选中的 APB
传输包含一个等待周期；寄存器写入、FIFO 压入和 FIFO 弹出只在访问完成时
发生一次。UART 活动不会延长 APB 访问。

`s_apb_pslverr` 恒为 `0`。未定义地址的写入被忽略；UART 与另外三个外设不同，
未定义地址的读取会保持上一次已锁存的 `s_apb_prdata`，不会强制返回零。

## 4. 寄存器总表

| 偏移 | 寄存器 | 访问 | 复位值 | 说明 |
|---:|---|---|---:|---|
| `0x00` | `CTRL` | R/W、W1P | `0x0000_0000` | 收发使能、FIFO 清空和软复位 |
| `0x04` | `CONFIG` | R/W | `0x0000_0000` | 波特率、奇偶校验和停止位 |
| `0x08` | `RX_DATA` | R/POP | `0x0000_0000` | RX FIFO 同步读端口 |
| `0x0C` | `RX_STATUS` | R | `0x0000_0100` | RX FIFO 和接收器状态 |
| `0x10` | `TX_DATA` | W | - | 向 TX FIFO 压入一个字节；读取返回零 |
| `0x14` | `TX_STATUS` | R | `0x0000_0100` | TX FIFO 和发送器状态 |
| `0x18` | `INTERRUPT` | R/W | `0x0000_0000` | 中断使能、条件、观察标志和阈值 |

除另有说明外，未列出的位读取为零，写入无效。`CONFIG` 和 `INTERRUPT` 中有
少量未使用但会原样保存的位，具体见对应寄存器说明。

## 5. 寄存器说明

### 5.1 CTRL，偏移 `0x00`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `RX_EN` | R/W | `1`：持续使能接收器；`0`：关闭并复位接收状态机 |
| `1` | `TX_EN` | R/W | `1`：允许 TX FIFO 自动发送；`0`：停止装载后续字节 |
| `2` | `RX_CLR` | W1P | 写 `1` 清空 RX FIFO，并使下一次 `RX_DATA` 读取重新进入预取状态 |
| `3` | `TX_CLR` | W1P | 写 `1` 清空 TX FIFO |
| `31` | `SOFT_RST` | W1P | 写 `1` 复位整个 UART 外设 |

`RX_CLR`、`TX_CLR` 和 `SOFT_RST` 是写脉冲，读取恒为零。每次写 `CTRL` 都会
用写数据 `[1:0]` 覆盖两个使能位，因此发出清空命令时应同时写回希望保留的
`RX_EN/TX_EN`。`SOFT_RST` 优先级最高，同一次写入中的其他位不会保留。

关闭 `TX_EN` 只会阻止 TX FIFO 装载下一个字节，已经进入发送移位过程的字节
仍会发送完毕。关闭 `RX_EN` 不会清空 RX FIFO；如需丢弃已接收数据，应同时
使用 `RX_CLR`。

### 5.2 CONFIG，偏移 `0x04`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[23:0]` | `BAUD_RATE` | R/W | 目标波特率，单位 Hz |
| `[28:24]` | `RESERVED` | R/W | 当前 RTL 会保存并回读，但不参与 UART 功能；软件应写零 |
| `[30:29]` | `PARITY_TYPE` | R/W | `00` 无校验，`01` 奇校验，`10` 偶校验，`11` 保留 |
| `31` | `STOP_BIT` | R/W | `0`：1 个停止位；`1`：2 个停止位 |

内部串行位周期采用下式：

```text
BAUD_DIV   = floor(SYS_CLK_FREQ / BAUD_RATE)
实际波特率 = SYS_CLK_FREQ / BAUD_DIV
```

写入新的 `BAUD_RATE` 后，串行除法器需要约 32 个 `PCLK` 完成计算。驱动应在
收发器空闲时修改 `CONFIG`，并在使能 UART 前至少等待 40 个 `PCLK`，与当前
仿真用法保持一致。

接收采样计数器为 10 位。为保证收发均正常，软件配置应满足：

```text
2 <= floor(SYS_CLK_FREQ / BAUD_RATE) <= 1024
```

`BAUD_RATE=0` 或超出上述范围没有硬件报错，但串口时序无效。`PARITY_TYPE=11`
会增加一个校验位周期，但该模式不属于有效协议配置，软件不得使用。接收器
不会检查停止位，也不会产生帧错误状态。

### 5.3 RX_DATA，偏移 `0x08`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[7:0]` | `RX_BYTE` | R/POP | RX FIFO 的同步读数据 |

RX FIFO 是同步读 FIFO。一次非空 `RX_DATA` APB 读取在访问完成时弹出一个
字节，但该字节在下一次 APB 读取时才出现在 `RX_BYTE`。因此，不能把第一次
读取的返回值当作当前 FIFO 首字节。

可靠的批量读取流程如下：

1. 从 `RX_STATUS.RX_LEVEL` 保存当前字节数 `N`；
2. 若 `N=0`，直接返回；
3. 读取一次 `RX_DATA` 并丢弃返回值，用于预取第一个字节；
4. 再读取 `N` 次 `RX_DATA`，依次得到保存快照中的 `N` 个字节。

FIFO 清空或复位后的空读取返回零。完成过至少一次有效弹出后，继续读取空 FIFO
会返回最近一次 FIFO 输出值，但不会再次移动指针，所以软件必须用 `RX_LEVEL`
判断有效数据量。

### 5.4 RX_STATUS，偏移 `0x0C`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[7:0]` | `RX_LEVEL` | R | RX FIFO 当前字节数 |
| `8` | `RX_EMPTY` | R | RX FIFO 为空 |
| `9` | `RX_FULL` | R | RX FIFO 已满 |
| `10` | `RX_BUSY` | R | 接收状态机正在处理一个串行帧 |

`RX_LEVEL` 只统计已经写入 FIFO 的完整、校验通过字节，不包含正在接收的帧。

### 5.5 TX_DATA，偏移 `0x10`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[7:0]` | `TX_BYTE` | W | 向 TX FIFO 压入一个字节 |

写入只使用低 8 位。即使 `TX_EN=0`，软件也可以预装 TX FIFO；以后置位
`TX_EN` 即开始发送。FIFO 已满时写入被静默忽略，因此写之前必须检查
`TX_STATUS.TX_FULL`。读取该寄存器返回零。

### 5.6 TX_STATUS，偏移 `0x14`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[7:0]` | `TX_LEVEL` | R | TX FIFO 当前字节数 |
| `8` | `TX_EMPTY` | R | TX FIFO 为空 |
| `9` | `TX_FULL` | R | TX FIFO 已满 |
| `10` | `TX_BUSY` | R | 正在从 FIFO 装载字节或发送串行帧 |

FIFO 为空不等于物理发送完成。判断整个发送通道空闲时，必须同时满足
`TX_LEVEL==0` 和 `TX_BUSY==0`。

### 5.7 INTERRUPT，偏移 `0x18`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `INT_EN` | R/W | UART 中断总使能 |
| `[2:1]` | `INT_TYPE` | R/W | 中断条件选择 |
| `3` | - | - | 保留，写入时强制清零 |
| `4` | `INT_FLAG` | R/W | 中断输出曾被观察为高的粘滞标志 |
| `[15:5]` | `RESERVED` | R/W | 当前 RTL 会保存并回读，但不参与中断功能；软件应写零 |
| `[23:16]` | `RX_THRESHOLD` | R/W | RX 字节数阈值 |
| `[31:24]` | `TX_THRESHOLD` | R/W | TX 字节数阈值 |

`INT_TYPE` 编码如下：

| 值 | 中断输出条件 |
|---:|---|
| `0` | RX FIFO 非空 |
| `1` | TX FIFO 未满 |
| `2` | `RX_LEVEL >= RX_THRESHOLD` |
| `3` | `TX_LEVEL <= TX_THRESHOLD` |

`interrupt` 是对所选条件进行寄存后的电平输出，仅在 `INT_EN=1` 时有效。
`INT_FLAG` 不是中断请求锁存器，也不参与 `interrupt` 计算；它只表示硬件曾观察
到中断输出为高。清除该标志时，应重写完整 `INTERRUPT` 配置并令位 4 为零。
如果触发条件仍成立，`interrupt` 会继续保持有效，`INT_FLAG` 也会再次置位。

阈值建议设置在 `1..FIFO_DEPTH`。`RX_THRESHOLD=0` 会始终满足 RX 阈值条件；
TX 未满和 TX 阈值两种模式在空 FIFO 时通常立即有效，驱动应在没有待发送数据
时关闭相应中断，避免持续进入中断处理程序。

## 6. 编程指导

以下伪代码假定 `UART` 指向 UART 寄存器基地址。

### 6.1 初始化

```c
UART->CTRL = (1u << 31);                 /* 软复位 */
UART->CONFIG = baud_rate
             | (parity_type << 29)
             | (two_stop_bits << 31);
delay_pclk(40);                          /* 等待波特率除法完成 */

UART->CTRL = (1u << 2) | (1u << 3);     /* 清空两个 FIFO，保持关闭 */
UART->INTERRUPT = 0;                     /* 默认先使用轮询 */
UART->CTRL = (1u << 0) | (1u << 1);     /* 持续使能 RX 和 TX */
```

若只需要单向通信，可仅使能对应方向。

### 6.2 轮询发送

```c
void uart_putc(uint8_t value)
{
    while (UART->TX_STATUS & (1u << 9))  /* TX_FULL */
        ;
    UART->TX_DATA = value;
}

void uart_flush(void)
{
    while (((UART->TX_STATUS & 0xffu) != 0) ||
           (UART->TX_STATUS & (1u << 10))) /* TX_BUSY */
        ;
}
```

连续发送时只需在 FIFO 满时等待，不应逐字节等待 `TX_BUSY` 清零。

### 6.3 批量接收

```c
size_t uart_read_snapshot(uint8_t *buffer)
{
    size_t i;
    size_t count = UART->RX_STATUS & 0xffu;

    if (count == 0)
        return 0;

    (void)UART->RX_DATA;                 /* 同步 FIFO 预取，必须丢弃 */
    for (i = 0; i < count; ++i)
        buffer[i] = (uint8_t)UART->RX_DATA;

    return count;
}
```

该函数只读取进入函数时已经存在的数据。读取期间新到达的字节会留给下一次调用，
不会因为采用保存的 `RX_LEVEL` 而被误读。

### 6.4 中断模式

接收中断推荐选择“RX FIFO 非空”或合理的 RX 阈值。ISR 应循环读取，直到
触发条件解除；只清 `INT_FLAG` 不能撤销电平型中断。

```c
void uart_rx_isr(void)
{
    uint8_t buffer[UART_FIFO_DEPTH];

    while ((UART->RX_STATUS & 0xffu) != 0)
        consume(buffer, uart_read_snapshot(buffer));

    UART->INTERRUPT = UART_INT_RX_NOT_EMPTY; /* 位 4 写 0 */
}
```

发送中断适合软件维护一个更大的环形缓冲区。每次中断尽量填满硬件 FIFO；软件
缓冲区耗尽后关闭 `INT_EN`，下次入队时再开启。

### 6.5 重新配置与清空

- 修改波特率、校验或停止位前，先停止写入，等待 `TX_LEVEL=0` 且
  `TX_BUSY=0`，再关闭收发器；
- 写 `CONFIG` 后等待至少 40 个 `PCLK`，再重新使能；
- 仅需丢弃缓存数据时使用 `RX_CLR/TX_CLR`，并在同一次 `CTRL` 写入中保留
  所需使能位；
- `SOFT_RST` 会清除控制、配置、中断和两个 FIFO，复位后必须重新初始化。

## 7. 使用限制与检查清单

- UART 固定为 8 数据位、低位先传输；
- 接收器不检查停止位，不提供帧错误状态；
- 奇偶校验失败、RX FIFO 满和 TX FIFO 满均不会产生专用错误中断；
- `RX_DATA` 必须按同步 FIFO 预取流程读取；
- `TX_EMPTY=1` 时仍可能有一个字节正在串行发送，应结合 `TX_BUSY` 判断完成；
- 中断源是电平条件，ISR 返回前应消除条件或关闭中断；
- 非法寄存器地址不会产生 `PSLVERR`，UART 非法读还会保留上一次读数据。
