# APB I2C 中文编程手册

## 1. 模块概述

`apb_i2c` 是一个 32 位 APB I2C 外设，可工作在互斥的主机模式或从机模式，
内部包含相互独立的字节宽 TX FIFO 和 RX FIFO。软件直接处理原始字节流，硬件
不解释从机寄存器地址或上层协议。

主机模式支持三种命令：

- 连续写；
- 连续读；
- 连续写后产生 RESTART，再连续读。

从机模式支持运行前配置的 7 位地址。外部主机写入的字节依次进入 RX FIFO；
软件预先写入 TX FIFO 的字节按顺序返回给外部主机。从机发送 FIFO 暂时为空时，
硬件可拉低 SCL 等待软件补充数据。

当前实现不支持 10 位地址、广播地址专用处理、多主机命令排队或从机寄存器地址
自动解析。

## 2. 参数与接口

### 2.1 参数

| 参数 | 默认值 | 要求 |
|---|---:|---|
| `SYS_CLK_FREQ` | `50_000_000` | APB 和协议内核时钟频率，单位 Hz |
| `FIFO_DEPTH` | `16` | 8 至 128 字节之间的 2 的幂 |

FIFO 存储阵列本身不清零。硬件复位、软复位、模式切换或 FIFO 清空命令会复位
FIFO 指针和数据量，旧内容随后不可访问。

### 2.2 APB 与中断端口

| 端口 | 方向 | 说明 |
|---|---|---|
| `s_apb_pclk` | 输入 | APB 和 I2C 内核共用时钟 |
| `s_apb_presetn` | 输入 | 同步低有效复位 |
| `s_apb_psel` | 输入 | APB 从机选择 |
| `s_apb_penable` | 输入 | APB 访问阶段指示 |
| `s_apb_pwrite` | 输入 | `1` 为写，`0` 为读 |
| `s_apb_paddr[31:0]` | 输入 | APB 字节地址 |
| `s_apb_pwdata[31:0]` | 输入 | APB 写数据 |
| `s_apb_pready` | 输出 | APB 传输完成应答 |
| `s_apb_pslverr` | 输出 | 恒为 `0` |
| `s_apb_prdata[31:0]` | 输出 | APB 读数据 |
| `interrupt` | 输出 | 所有已使能待处理中断的逻辑或 |

### 2.3 I2C 开漏端口

| 端口 | 方向 | 说明 |
|---|---|---|
| `scl_o`、`sda_o` | 输出 | 恒为 `0`，连接开漏输出缓冲器的数据端 |
| `scl_t`、`sda_t` | 输出 | `0` 拉低对应总线，`1` 释放对应总线 |
| `scl_i`、`sda_i` | 输入 | 外部解析后的实际总线电平 |

板级必须提供上拉电阻，并保证所有开漏驱动器正确线与。外设关闭时，SCL 和 SDA
均处于释放状态。

## 3. APB 访问行为

寄存器按 32 位对齐，使用 `s_apb_paddr[11:2]` 译码。被选中的 APB 传输包含
一个等待周期；寄存器和 FIFO 副作用只在访问完成时发生一次。I2C 总线活动不会
阻塞 APB 访问。

未定义地址读取返回零，未定义地址写入无效，`s_apb_pslverr` 恒为 `0`。

## 4. 寄存器总表

| 偏移 | 寄存器 | 访问 | 复位值 | 说明 |
|---:|---|---|---:|---|
| `0x00` | `CTRL` | R/W、W1P | `0x0000_0000` | 使能、模式和控制命令 |
| `0x04` | `MASTER_CMD` | R/W | `0x0000_0000` | 主机命令、目标地址和传输长度 |
| `0x08` | `TIMING` | R/W | 由参数计算 | SCL 预分频值 |
| `0x0C` | `STATUS` | R | 实时状态 | 总线、协议状态和最后传输计数 |
| `0x10` | `TX_DATA` | W | - | 向 TX FIFO 压入一个字节；读取返回零 |
| `0x14` | `RX_DATA` | R/POP | `0x0000_0000` | RX FIFO 同步读端口 |
| `0x18` | `FIFO_STATUS` | R | `0x0005_0000` | 两个 FIFO 的数据量和空满状态 |
| `0x1C` | `SLAVE_CFG` | R/W | `0x0000_0050` | 7 位从机地址 |
| `0x20` | `STRETCH_TIMEOUT` | R/W | `SYS_CLK_FREQ / 1000` | 等待超时周期数 |
| `0x24` | `IRQ_STATUS` | R/W1C | `0x0000_0000` | 14 个粘滞中断状态位 |
| `0x28` | `IRQ_ENABLE` | R/W | `0x0000_0000` | 14 个中断使能位 |
| `0x2C` | `IRQ_THRESHOLD` | R/W | `0x0000_0001` | 从机 RX/TX FIFO 阈值 |

除另有说明外，保留位读取为零，写入无效。

## 5. 寄存器说明

### 5.1 CTRL，偏移 `0x00`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `ENABLE` | R/W | 使能当前所选协议内核 |
| `1` | `MASTER_MODE` | R/W | `0`：从机；`1`：主机 |
| `2` | `START` | W1P | 校验并启动一条主机命令 |
| `3` | `ABORT` | W1P | 终止本外设正在执行的主机事务 |
| `4` | `TX_CLR` | W1P | 清空 TX FIFO |
| `5` | `RX_CLR` | W1P | 清空 RX FIFO |
| `31` | `SOFT_RST` | W1P | 同步复位整个 I2C 外设 |

读取时仅 `[1:0]` 返回保存的模式和使能状态，所有命令位均读零。每次写
`CTRL` 都会用写数据 `[1:0]` 更新保存值，所以发出 `START`、`ABORT` 或 FIFO
清空命令时，必须同时保留所需的 `ENABLE` 和 `MASTER_MODE`。

`SOFT_RST` 优先级最高，同一次写入中的其他操作无效。

#### 模式切换限制

只有写入发生前 `ENABLE=0` 时，`MASTER_MODE` 的变化才会被接受。成功切换模式
会复位两个协议内核并清空两个 FIFO。外设已使能时尝试改变模式会保留旧模式并
置位 `CMD_ERROR`；即使该次写入同时把 `ENABLE` 清零，模式也不会在同一拍改变。
因此驱动必须使用两次独立写入：先关闭，再切换模式。

#### 控制命令限制

- `START` 使用写入前已经保存的 `ENABLE`、模式和命令寄存器进行校验，不能与
  “使能外设”合并为同一次写入；
- 主机命令或已选中的从机事务活动期间，`TX_CLR/RX_CLR` 会被拒绝，FIFO 保持
  不变并置位 `CMD_ERROR`；
- `ABORT` 只对活动的主机事务有效。写入时必须保持 `ENABLE=1` 和
  `MASTER_MODE=1`，让主机内核有机会结束事务并产生 `MASTER_DONE`。

### 5.2 MASTER_CMD，偏移 `0x04`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[1:0]` | `OP` | R/W | `0` 写，`1` 读，`2` 写后读，`3` 非法 |
| `[14:8]` | `TARGET_ADDR` | R/W | 不含 R/W 位的 7 位目标地址 |
| `[23:16]` | `TX_LEN` | R/W | 本命令发送的数据字节数 |
| `[31:24]` | `RX_LEN` | R/W | 本命令接收的数据字节数 |

硬件接受 `START` 时，会锁存 `MASTER_CMD`、`TIMING` 和
`STRETCH_TIMEOUT`。事务活动期间修改这些寄存器只影响下一条命令。硬件不提供
命令队列；当前命令结束前再次启动会被拒绝。

`START` 的全部接受条件如下：

- 外设已使能且处于主机模式；
- 没有活动命令；
- 写命令：`1 <= TX_LEN <= FIFO_DEPTH` 且 `RX_LEN=0`；
- 读命令：`TX_LEN=0` 且 `1 <= RX_LEN <= FIFO_DEPTH`；
- 写后读命令：两个长度均在 `1..FIFO_DEPTH`；
- TX FIFO 中至少已有 `TX_LEN` 个字节；
- RX FIFO 的剩余空间至少为 `RX_LEN` 个字节。

不满足任一条件时，命令不会改变 FIFO 或 I2C 总线，并置位 `CMD_ERROR`。

### 5.3 TIMING，偏移 `0x08`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[15:0]` | `SCL_PRESCALE` | R/W | I2C 四分之一周期的预分频值 |

时钟关系为：

```text
一个 I2C 四分之一周期 = SCL_PRESCALE + 1 个 PCLK
SCL_FREQ = SYS_CLK_FREQ / (4 * (SCL_PRESCALE + 1))
```

复位值按下式计算，并限制最小为零：

```text
SCL_PRESCALE_RESET = ceil(SYS_CLK_FREQ / 400000) - 1
```

因此默认 SCL 不高于标称 100 kHz。新值在下一条被接受的主机命令中生效。

### 5.4 STATUS，偏移 `0x0C`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `MASTER_BUSY` | R | 一条已接受的主机命令正在执行 |
| `1` | `BUS_BUSY` | R | 当前协议内核处于活动总线事务状态 |
| `2` | `SLAVE_SELECTED` | R | 从机地址已匹配且事务未结束 |
| `3` | `SLAVE_READ` | R | 当前从机事务方向为外部主机读取本设备 |
| `4` | `STRETCH_ACTIVE` | R | 从机因等待 TX 数据而拉低 SCL |
| `5` | `TX_EMPTY` | R | TX FIFO 为空 |
| `6` | `TX_FULL` | R | TX FIFO 已满 |
| `7` | `RX_EMPTY` | R | RX FIFO 为空 |
| `8` | `RX_FULL` | R | RX FIFO 已满 |
| `[23:16]` | `LAST_TX_COUNT` | R | 最近一次已完成事务的发送数据字节数 |
| `[31:24]` | `LAST_RX_COUNT` | R | 最近一次已完成事务的接收数据字节数 |

主机计数不包含地址字节，并在新命令被接受时清零。主机命令结束时两个计数同时
锁存。对于从机写后 RESTART 读，RX 计数在 RESTART 时锁存，TX 计数在读事务
结束时锁存。

### 5.5 TX_DATA，偏移 `0x10`

写 `TX_DATA[7:0]` 向 TX FIFO 压入一个字节，高 24 位被忽略。FIFO 已满时，
写入被拒绝并置位 `CMD_ERROR`。读取 `TX_DATA` 返回零。

主机模式应在发出 `START` 前装入至少 `TX_LEN` 个字节。从机模式可以提前装入
响应数据，也可以在 `STRETCH_ACTIVE=1` 时由中断处理程序补充。

### 5.6 RX_DATA，偏移 `0x14`

`RX_DATA[7:0]` 连接同步读 FIFO。一次非空 APB 读取在访问完成时弹出一个字节，
该字节在下一次 APB 读取时返回。软件必须使用以下流程：

1. 从 `FIFO_STATUS.RX_LEVEL` 保存字节数 `N`；
2. 若 `N=0`，不读取 `RX_DATA`；
3. 读取一次 `RX_DATA` 并丢弃返回值；
4. 再读取 `N` 次，依次取得保存快照中的全部字节。

复位或 RX FIFO 清空后的空读取返回零。至少完成过一次有效弹出后，继续读取空
FIFO 会返回最近一次输出值，但不移动指针，因此不得用 `RX_DATA` 的数值判断
FIFO 是否为空。

### 5.7 FIFO_STATUS，偏移 `0x18`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[7:0]` | `TX_LEVEL` | R | TX FIFO 当前字节数 |
| `[15:8]` | `RX_LEVEL` | R | RX FIFO 当前字节数 |
| `16` | `TX_EMPTY` | R | TX FIFO 为空 |
| `17` | `TX_FULL` | R | TX FIFO 已满 |
| `18` | `RX_EMPTY` | R | RX FIFO 为空 |
| `19` | `RX_FULL` | R | RX FIFO 已满 |

APB 与协议内核可以在同一拍操作 FIFO。FIFO 非满时，同时压入和弹出会保持数据
量不变；FIFO 在该拍开始时已满，则弹出可被接受，而压入仍被拒绝，因此数据量
减少一。TX 满写会置位 `CMD_ERROR`。

### 5.8 SLAVE_CFG，偏移 `0x1C`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[6:0]` | `SLAVE_ADDR` | R/W | 不含 R/W 位的 7 位从机地址 |

地址只能在 `ENABLE=0` 时修改。已使能时写入不同地址会被忽略并置位
`CMD_ERROR`。当前实现不支持 10 位地址；地址 `0x00` 也不会获得通用广播专用
语义，只会作为普通比较值使用。

### 5.9 STRETCH_TIMEOUT，偏移 `0x20`

该寄存器是原始 `PCLK` 周期数，用于限制：

- 主机等待初始忙总线释放；
- 主机等待外部器件释放被拉伸的 SCL；
- 从机等待软件向空 TX FIFO 补充数据。

`0` 表示立即超时，没有“无限等待”编码。主机命令接受时会锁存当前值；从机
直接使用寄存器当前值。

从机读地址到达而 TX FIFO 为空时，从机拉低 SCL 等待。若地址阶段等待超时，
硬件释放总线、NACK 地址，不置位 `SLAVE_READ_DONE`。若发送中途 TX FIFO
耗尽并超时，硬件发送 `0xFF`、计入一个发送字节，并允许外部主机正常结束读。
若 TX 数据与超时在同一拍到达，数据有效优先。

### 5.10 IRQ_STATUS 与 IRQ_ENABLE，偏移 `0x24`、`0x28`

两个寄存器使用相同的低 14 位布局。`IRQ_STATUS` 为粘滞状态，写 `1` 清除；
`IRQ_ENABLE` 决定对应状态是否驱动中断输出：

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

| 位 | 名称 | 置位条件 |
|---:|---|---|
| `0` | `MASTER_DONE` | 任意已接受的主机命令结束，包括错误或中止 |
| `1` | `ADDR_NACK` | 目标设备 NACK 任一主机地址阶段 |
| `2` | `DATA_NACK` | 目标设备 NACK 主机写数据字节 |
| `3` | `ARBITRATION_LOST` | 主机发送高电平但在 SCL 高期间采样到 SDA 为低 |
| `4` | `MASTER_TIMEOUT` | 主机等待总线空闲或 SCL 变高超时 |
| `5` | `CMD_ERROR` | 命令非法、控制操作非法或 TX FIFO 满写 |
| `6` | `SLAVE_RX_THRESHOLD` | 已使能从机的 RX 数据量不小于 RX 阈值 |
| `7` | `SLAVE_TX_THRESHOLD` | 已使能从机的 TX 数据量不大于 TX 阈值 |
| `8` | `SLAVE_RX_DONE` | 匹配的从机写事务因 STOP 或 RESTART 结束 |
| `9` | `SLAVE_READ_DONE` | 匹配的从机读事务因 NACK 或 STOP 结束 |
| `10` | `SLAVE_RX_OVERFLOW` | 收到的字节无法写入 RX FIFO |
| `11` | `SLAVE_TX_UNDERFLOW` | 外部主机请求字节时 TX FIFO 为空 |
| `12` | `SLAVE_STRETCH_TIMEOUT` | 软件未在时钟拉伸超时前补充 TX 数据 |
| `13` | `BUS_ERROR` | 活动协议内核检测到非法总线阶段 |

状态位会在对应中断未使能时照常记录。硬件事件与 W1C 同拍发生时，事件置位优先。
`MASTER_DONE` 只表示命令已经结束，不表示成功；驱动必须同时检查位 `1..5` 和
位 `13`。

### 5.11 IRQ_THRESHOLD，偏移 `0x2C`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `[7:0]` | `RX_THRESHOLD` | R/W | 从机 RX 数据量高水位，复位值 `1` |
| `[15:8]` | `TX_THRESHOLD` | R/W | 从机 TX 数据量低水位，复位值 `0` |

阈值条件只在已使能的从机模式中有效。若条件持续成立，W1C 清除对应状态后，该位
会在下一拍再次置位。阈值通常应限制在 `0..FIFO_DEPTH`；RX 阈值为零会持续
满足条件。复位后的 TX 阈值为零，因此空 TX FIFO 在从机使能后会立即满足
`SLAVE_TX_THRESHOLD`，适合用来请求软件装入首批响应数据；不需要该行为时，
应关闭对应中断或改写阈值。

## 6. 编程指导

### 6.1 通用初始化和模式切换

以下伪代码中的每一行表示一次独立 APB 写入：

```c
I2C->CTRL = (1u << 31);                 /* 软复位 */
I2C->CTRL = 0;                          /* 保持关闭的从机模式 */
I2C->CTRL = I2C_CTRL_MASTER_MODE;       /* 如需主机，单独切换模式 */
I2C->TIMING = prescale;
I2C->STRETCH_TIMEOUT = timeout_cycles;
I2C->IRQ_STATUS = 0x3fffu;              /* 清除全部历史状态 */
I2C->IRQ_ENABLE = irq_mask;
I2C->CTRL = I2C_CTRL_ENABLE | mode_bit; /* 单独使能 */
```

从已使能模式切换到另一模式时，先写 `ENABLE=0`，确认活动事务已结束，再用下一次
写入改变 `MASTER_MODE`。模式变化会自动清空两个 FIFO。

### 6.2 主机写

1. 确认主机模式已使能且 `STATUS.MASTER_BUSY=0`；
2. 必要时在空闲状态清 FIFO、清旧中断；
3. 设置 `TIMING`、`STRETCH_TIMEOUT` 和写命令的 `MASTER_CMD`；
4. 向 `TX_DATA` 写入至少 `TX_LEN` 个字节；
5. 单独写 `CTRL = ENABLE | MASTER_MODE | START`；
6. 等待 `IRQ_STATUS.MASTER_DONE=1`；
7. 读取并检查所有主机错误位，再用 W1C 清除已处理状态。

### 6.3 主机读

```c
I2C->CTRL = I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE |
            I2C_CTRL_RX_CLR;            /* 必须保持模式和使能 */
I2C->MASTER_CMD = I2C_OP_READ
                | (target << 8)
                | (rx_len << 24);
I2C->CTRL = I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE |
            I2C_CTRL_START;

while (!(I2C->IRQ_STATUS & I2C_IRQ_MASTER_DONE))
    ;
status = I2C->IRQ_STATUS;
if (status & I2C_MASTER_ERROR_MASK)
    handle_error(status);
else
    i2c_drain_rx_snapshot();             /* 先预取一次，再读取 N 次 */
I2C->IRQ_STATUS = status;                /* W1C 已处理状态 */
```

`RX_LEN` 不能大于发命令时 RX FIFO 的剩余空间。

### 6.4 主机写后读

1. 在空闲状态清空两个 FIFO；
2. 装入写阶段数据；
3. 设置 `OP=2`，并令 `TX_LEN`、`RX_LEN` 均非零；
4. 发出 `START`；
5. 硬件发送写数据，不产生 STOP，直接产生 RESTART 并读取指定字节数；
6. 等待 `MASTER_DONE`，检查错误，然后按同步 FIFO 流程读取 RX 数据。

### 6.5 从机服务

1. 关闭外设并选择从机模式；
2. 设置 `SLAVE_CFG`、超时、FIFO 阈值和中断使能；
3. 若响应已知，可预装 TX FIFO；
4. 使能从机；
5. 处理 `SLAVE_RX_THRESHOLD/SLAVE_RX_DONE` 时，保存 `RX_LEVEL`，预取一次，
   再读取保存数量的原始字节；
6. 处理 `SLAVE_TX_THRESHOLD/SLAVE_TX_UNDERFLOW` 时，及时补充 TX FIFO；
7. 处理完成后 W1C 对应状态。若阈值条件仍成立，应先补充或排空 FIFO，再清位。

从机软件应把 `SLAVE_STRETCH_TIMEOUT` 视为已发生的数据完整性错误。地址阶段
超时会 NACK；发送中途超时会向外部主机填充 `0xFF`。

### 6.6 中止与错误恢复

```c
/* 仅用于仍在活动的主机事务 */
I2C->CTRL = I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_ABORT;
while (I2C->STATUS & I2C_STATUS_MASTER_BUSY)
    ;

status = I2C->IRQ_STATUS;                /* MASTER_DONE 也可能伴随错误 */
I2C->IRQ_STATUS = status;
I2C->CTRL = I2C_CTRL_MASTER_MODE;        /* 关闭 */
I2C->CTRL = I2C_CTRL_MASTER_MODE |
            I2C_CTRL_TX_CLR | I2C_CTRL_RX_CLR;
```

若软件直接清除 `ENABLE`，协议内核会复位并释放总线，但不应再依赖正常的
`MASTER_DONE` 收尾流程。需要可诊断的中止结果时，应优先使用 `ABORT` 并保持
外设使能，等待命令结束。

## 7. 使用限制与检查清单

- `CTRL` 是整字覆盖寄存器，命令写入时必须保留模式和使能位；
- 使能和 `START` 必须分成两次 APB 写入；
- 从已使能状态切换模式也必须先关闭，再单独修改模式；
- `MASTER_DONE` 包含成功、NACK、仲裁丢失、超时、中止和总线错误结束；
- 主机发命令前必须保证 TX 数据足够且 RX 空间足够；
- RX FIFO 必须按“保存数据量、预取一次、读取 N 次”的顺序访问；
- FIFO 清空不能在主机命令或已选中从机事务期间执行；
- `STRETCH_TIMEOUT=0` 表示立即超时，不表示禁用超时；
- 电平阈值中断在条件未解除时会在 W1C 后重新置位；
- 板级 SCL/SDA 必须按开漏方式连接并提供上拉。
