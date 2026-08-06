# APB QSPI 中文编程手册

## 1. 模块概述

`apb_qspi` 是一个可综合的 APB4 QSPI 主机控制器，支持以下功能：

- SPI Mode 0、1、2、3；
- MSB 优先和 LSB 优先；
- 相互独立的命令、地址、模式位、Dummy 和字节数据阶段；
- 长度为 0 至 32 bit 的命令、地址和模式位；
- 单线、双线和四线头部及数据传输；
- 只发送、只接收和单线全双工数据传输；
- 每笔事务传输 0 至 65535 byte 数据；
- 带字节边界安全暂停功能的 TX 和 RX FIFO；
- 数量可配置的低电平有效片选输出；
- 状态粘滞、可独立屏蔽的中断；
- 通过 `s_apb_pstrb` 实现的 APB4 字节选通写。

控制器采用固定的事务模板：

```text
COMMAND -> ADDRESS -> MODE_BITS -> DUMMY -> DATA
```

每个阶段都可以省略。命令、地址和模式位分别使用独立的数据寄存器及位长度配置，因此可以直接发送非字节对齐头部，无需由软件把整笔任意长度比特流压入 FIFO。启用双线或四线头部时，头部长度仍必须分别按 2 bit 或 4 bit 对齐。

本模块仅支持主机模式，不支持 SPI 从机、XIP、存储器映射、DMA、描述符、DDR 传输或 Flash 命令自动解析。全双工仅支持单线数据阶段。

## 2. 参数与接口

### 2.1 参数

| 参数 | 默认值 | 约束 | 说明 |
| --- | ---: | --- | --- |
| `CS_COUNT` | `4` | `1..16` | 低电平有效片选输出数量 |
| `FIFO_DEPTH` | `16` | `8..128` 范围内的 2 的幂 | TX 和 RX 字节 FIFO 的深度 |

### 2.2 APB 与中断端口

| 端口 | 方向 | 说明 |
| --- | --- | --- |
| `s_apb_pclk` | input | APB、协议引擎和 FIFO 时钟 |
| `s_apb_presetn` | input | 同步低电平有效复位 |
| `s_apb_psel` | input | APB 从设备选中 |
| `s_apb_penable` | input | APB 访问阶段指示 |
| `s_apb_pwrite` | input | APB 访问方向，`1` 表示写 |
| `s_apb_paddr[31:0]` | input | APB 字节地址 |
| `s_apb_pwdata[31:0]` | input | APB 写数据 |
| `s_apb_pstrb[3:0]` | input | APB4 写字节选通 |
| `s_apb_pready` | output | APB 访问完成响应 |
| `s_apb_pslverr` | output | APB 错误响应，恒为 `0` |
| `s_apb_prdata[31:0]` | output | APB 读数据 |
| `interrupt` | output | 任一已使能的粘滞中断状态位置位时拉高 |

### 2.3 QSPI 物理端口

| 端口 | 方向 | 说明 |
| --- | --- | --- |
| `qspi_sclk_o` | output | 串行时钟 |
| `qspi_cs_n[CS_COUNT-1:0]` | output | 低电平有效片选 |
| `qspi_d0_i` | input | 数据线 D0 的输入采样值 |
| `qspi_d0_o` | output | 数据线 D0 的输出驱动值 |
| `qspi_d0_t` | output | 数据线 D0 的三态控制 |
| `qspi_d1_i` | input | 数据线 D1 的输入采样值 |
| `qspi_d1_o` | output | 数据线 D1 的输出驱动值 |
| `qspi_d1_t` | output | 数据线 D1 的三态控制 |
| `qspi_d2_i` | input | 数据线 D2 的输入采样值 |
| `qspi_d2_o` | output | 数据线 D2 的输出驱动值 |
| `qspi_d2_t` | output | 数据线 D2 的三态控制 |
| `qspi_d3_i` | input | 数据线 D3 的输入采样值 |
| `qspi_d3_o` | output | 数据线 D3 的输出驱动值 |
| `qspi_d3_t` | output | 数据线 D3 的三态控制 |

四根串行数据线均为双向端口。对于任意数据线，`qspi_dN_t=1` 表示高阻，`qspi_dN_t=0` 表示由 `qspi_dN_o` 驱动物理引脚。顶层设计需要使用 FPGA 厂商 I/O Buffer 或等效电路连接每组 `qspi_dN_i/o/t` 信号；I/O Buffer 不包含在本 IP 内。

## 3. APB 访问行为

所有寄存器按 32 bit 对齐，使用 `s_apb_paddr[11:2]` 译码。未定义地址读回 `0`，写入未定义地址没有副作用，`s_apb_pslverr` 始终保持低电平。

除读取非空 `RX_DATA` 外，所有 APB 访问均无等待周期。读取非空 `RX_DATA` 时，为配合同步 FIFO 读操作，控制器准确插入一个 APB 等待周期；读取空 FIFO 则立即返回 `0`，不插入等待周期，也不执行出队。

普通 R/W 寄存器支持按字节选通写。`s_apb_pstrb[n]` 控制 `s_apb_pwdata[8*n +: 8]` 对应的字节，未选中的字节保持原值。命令位、W1P 位、W1C 位和 FIFO 入队同样受其所在字节对应的 PSTRB 控制。`s_apb_pstrb=4'b0000` 时，写访问正常完成，但不会修改寄存器、操作 FIFO、执行命令或清除中断。

`TX_DATA` 仅在 `s_apb_pstrb[0]=1` 时入队；`CTRL.SOFT_RESET` 仅在 `s_apb_pstrb[3]=1` 时执行。软件进行完整寄存器写入时宜使用 `4'b1111`，执行命令、清除中断或写入 FIFO 时也可以仅选通目标位所在的字节。

## 4. 寄存器总表

下表偏移均相对于外设基地址。保留位读回 `0`，写入无效。

| 偏移 | 寄存器 | 访问属性 | 复位值 | 说明 |
| ---: | --- | --- | ---: | --- |
| `0x00` | `CTRL` | R/W、W1P | `0x0000_0000` | 使能与控制命令 |
| `0x04` | `STATUS` | R | `0x0000_0000` | 控制器运行状态 |
| `0x08` | `CLOCK_CFG` | R/W | `0x0000_0000` | 串行时钟与片选时序 |
| `0x0C` | `TRANSFER_CFG` | R/W | `0x0000_0000` | 数据阶段与片选配置 |
| `0x10` | `PHASE_CFG` | R/W | `0x0000_0000` | 头部阶段与 Dummy 配置 |
| `0x14` | `LENGTH_CFG` | R/W | `0x0000_0000` | 数据阶段字节数 |
| `0x18` | `COMMAND_DATA` | R/W | `0x0000_0000` | 命令阶段数据 |
| `0x1C` | `ADDRESS_DATA` | R/W | `0x0000_0000` | 地址阶段数据 |
| `0x20` | `MODE_DATA` | R/W | `0x0000_0000` | 模式位阶段数据 |
| `0x24` | `TX_DATA` | W | 不适用 | TX FIFO 入队 |
| `0x28` | `RX_DATA` | R/pop | 不适用 | RX FIFO 出队 |
| `0x2C` | `FIFO_STATUS` | R | 动态值 | FIFO 水位与状态 |
| `0x30` | `FIFO_THRESHOLD` | R/W | `0x0000_0100` | FIFO 中断阈值 |
| `0x34` | `IRQ_STATUS` | R/W1C | `0x0000_0000` | 粘滞中断状态 |
| `0x38` | `IRQ_ENABLE` | R/W | `0x0000_0000` | 中断输出使能 |

## 5. 寄存器说明

### 5.1 CTRL，偏移 `0x00`

| 位 | 名称 | 访问属性 | 说明 |
| ---: | --- | --- | --- |
| `0` | `ENABLE` | R/W | 置 `1` 后允许合法事务启动 |
| `1` | `START` | W1P | 校验当前配置并启动一笔事务 |
| `2` | `ABORT` | W1P | 请求受控终止当前事务 |
| `3` | `TX_CLEAR` | W1P | 空闲时清空 TX FIFO |
| `4` | `RX_CLEAR` | W1P | 空闲时清空 RX FIFO |
| `31` | `SOFT_RESET` | W1P | 复位整个外设 |

W1P 位读回 `0`。一次写操作同时置位多个命令时，优先级依次为 `SOFT_RESET`、`ABORT`、FIFO 清空、`START`。忙碌期间清除 `ENABLE` 会请求受控中止，并在终止后保持控制器禁用。

### 5.2 STATUS，偏移 `0x04`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `0` | `BUSY` | 正在执行事务或必要的片选高电平间隔 |
| `[4:1]` | `ACTIVE_PHASE` | 当前协议引擎状态 |
| `5` | `TX_STALLED` | 正在字节边界等待 TX 数据 |
| `6` | `RX_STALLED` | 正在字节边界等待 RX 空间 |
| `[10:7]` | `ACTIVE_CS` | 事务启动时锁存的片选编号；空闲时为 `0` |

`ACTIVE_PHASE` 编码如下：

| 编码 | 状态 |
| ---: | --- |
| `0` | `IDLE` |
| `1` | `CS_SETUP` |
| `2` | `COMMAND` |
| `3` | `ADDRESS` |
| `4` | `MODE_BITS` |
| `5` | `DUMMY` |
| `6` | `DATA` |
| `7` | `CS_HOLD` |
| `8` | `CS_HIGH` |

### 5.3 CLOCK_CFG，偏移 `0x08`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `[15:0]` | `HALF_PERIOD` | SCLK 半周期减 1，单位为 PCLK 周期 |
| `[23:16]` | `CS_SETUP` | 片选有效到开始串行活动之间的完整 PCLK 周期数 |
| `[27:24]` | `CS_HOLD` | 最后一个 SCLK 边沿到片选无效之间的完整 PCLK 周期数 |
| `[31:28]` | `CS_HIGH` | 片选无效后的完整 PCLK 周期数 |

生成的串行时钟频率为：

```text
SCLK = PCLK / (2 * (HALF_PERIOD + 1))
```

任一片选时序字段为 `0` 时，表示对应区间不增加额外等待周期。

### 5.4 TRANSFER_CFG，偏移 `0x0C`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `[1:0]` | `DATA_WIDTH` | 数据线宽：`0=单线`、`1=双线`、`2=四线`、`3=非法` |
| `[3:2]` | `DATA_DIR` | 数据方向：`0=无数据`、`1=发送`、`2=接收`、`3=全双工` |
| `[5:4]` | `SPI_MODE` | SPI Mode 0、1、2 或 3 |
| `6` | `LSB_FIRST` | `0=MSB 优先`，`1=LSB 优先` |
| `7` | `SINGLE_RX_D1` | 单线接收时，`0` 从 D0 采样，`1` 从 D1 采样 |
| `[11:8]` | `CS_SELECT` | `qspi_cs_n` 片选索引 |

全双工仅允许使用单线数据阶段，此时固定由 D0 输出并从 D1 采样，`SINGLE_RX_D1` 被忽略。

### 5.5 PHASE_CFG，偏移 `0x10`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `[5:0]` | `COMMAND_BITS` | 命令长度，范围为 `0..32` bit |
| `[7:6]` | `COMMAND_WIDTH` | 命令线宽：`0=单线`、`1=双线`、`2=四线` |
| `[13:8]` | `ADDRESS_BITS` | 地址长度，范围为 `0..32` bit |
| `[15:14]` | `ADDRESS_WIDTH` | 地址线宽：`0=单线`、`1=双线`、`2=四线` |
| `[21:16]` | `MODE_BITS` | 模式位长度，范围为 `0..32` bit |
| `[23:22]` | `MODE_WIDTH` | 模式位线宽：`0=单线`、`1=双线`、`2=四线` |
| `[31:24]` | `DUMMY_CYCLES` | 数据线不驱动的完整 SCLK 周期数，范围为 `0..255` |

长度为 `0` 的头部阶段被跳过，其线宽字段被忽略。有效头部的线宽编码 `3` 非法；有效双线头部的长度必须为偶数，有效四线头部的长度必须是 4 的整数倍。

### 5.6 LENGTH_CFG，偏移 `0x14`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `[15:0]` | `DATA_BYTES` | 数据阶段准确传输的字节数，范围为 `0..65535` |
| `[31:16]` | 保留 | 读回 `0`，写入无效 |

`DATA_BYTES=0` 时省略数据阶段。

### 5.7 头部数据寄存器，偏移 `0x18`、`0x1C`、`0x20`

| 偏移 | 寄存器 | 说明 |
| ---: | --- | --- |
| `0x18` | `COMMAND_DATA` | 命令阶段的 32 bit 数据 |
| `0x1C` | `ADDRESS_DATA` | 地址阶段的 32 bit 数据 |
| `0x20` | `MODE_DATA` | 模式位阶段的 32 bit 数据 |

对于长度为 `N` bit 的阶段，仅使用对应寄存器的 `[N-1:0]`。MSB 优先时先发送 bit `N-1`，LSB 优先时先发送 bit `0`。

### 5.8 TX_DATA 与 RX_DATA，偏移 `0x24`、`0x28`

向 `TX_DATA[7:0]` 写入数据且 `s_apb_pstrb[0]=1` 时，向 TX FIFO 压入一个字节，其他字节通道不起作用。FIFO 已满时的入队数据被丢弃，同时置位 `IRQ_STATUS.TX_OVERFLOW`。

读取非空 `RX_DATA` 时，控制器插入一个 APB 等待周期，随后弹出一个字节并在 `s_apb_prdata[7:0]` 返回。读取空 FIFO 时立即返回 `0`，不会出队。

### 5.9 FIFO_STATUS，偏移 `0x2C`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `[7:0]` | `TX_LEVEL` | 软件可见的 TX 字节数量 |
| `[15:8]` | `RX_LEVEL` | 软件可见的 RX 字节数量 |
| `16` | `TX_EMPTY` | TX 路径没有排队等待的字节 |
| `17` | `TX_FULL` | TX 路径无法接收更多字节 |
| `18` | `RX_EMPTY` | RX 路径没有完整字节 |
| `19` | `RX_FULL` | RX 路径无法接收更多字节 |
| `20` | `TX_STALLED` | 串行引擎正在等待 TX 数据 |
| `21` | `RX_STALLED` | 串行引擎正在等待 RX 空间 |

`TX_LEVEL` 包含 FIFO 适配器已暂存或正在读取的字节，`RX_LEVEL` 包含等待写入同步 FIFO 的完整字节。该统计方式使软件观察到的容量与串行引擎实际可用容量一致。

### 5.10 FIFO_THRESHOLD，偏移 `0x30`

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| `[7:0]` | `TX_THRESHOLD` | `TX_LEVEL <= TX_THRESHOLD` 时产生阈值事件 |
| `[15:8]` | `RX_THRESHOLD` | `RX_LEVEL >= RX_THRESHOLD` 时产生阈值事件 |

只有 `ENABLE=1` 时才计算阈值事件。复位后 TX 阈值为 `0`，RX 阈值为 `1`。如果软件清除状态位后对应水位条件仍成立，该状态位会在下一个时钟周期再次置位。

### 5.11 IRQ_STATUS 与 IRQ_ENABLE，偏移 `0x34`、`0x38`

两个寄存器采用相同的位布局：

| 位 | 名称 | 置位条件 |
| ---: | --- | --- |
| `0` | `TRANSFER_DONE` | 已接受的事务结束 |
| `1` | `ABORTED` | 已接受的事务被中止或控制器被禁用 |
| `2` | `CONFIG_ERROR` | 非法启动或控制命令被拒绝 |
| `3` | `TX_OVERFLOW` | 低字节写选通有效且 TX FIFO 已满时尝试入队 |
| `4` | `TX_THRESHOLD` | 已使能控制器的 TX 低水位条件成立 |
| `5` | `RX_THRESHOLD` | 已使能控制器的 RX 高水位条件成立 |

`IRQ_STATUS` 是粘滞 W1C 寄存器，写 `1` 清除对应状态位；同一周期硬件置位和软件 W1C 冲突时，硬件置位优先。`IRQ_ENABLE` 只控制外部中断输出，不影响状态位记录：

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

已接受的事务被中止时，`TRANSFER_DONE` 和 `ABORTED` 同时置位。被拒绝的 `START` 只置位 `CONFIG_ERROR`，不会置位 `TRANSFER_DONE`。

## 6. 串行时序、线宽与事务阶段

### 6.1 事务阶段

每笔事务严格按照以下顺序执行：

```text
COMMAND -> ADDRESS -> MODE_BITS -> DUMMY -> DATA
```

长度为 `0` 的阶段会被跳过。命令、地址和模式位阶段分别从 `COMMAND_DATA`、`ADDRESS_DATA` 和 `MODE_DATA` 取数；Dummy 阶段所有数据线均保持高阻；数据阶段通过 TX/RX FIFO 交换完整字节。

### 6.2 启动条件

仅当以下条件全部满足时，`START` 才会被接受：

- `ENABLE=1` 且 `BUSY=0`；
- `CS_SELECT < CS_COUNT`；
- 每个有效头部不超过 32 bit，线宽编码合法且长度满足线宽对齐要求；
- 有效数据阶段的线宽合法、方向不为 `none`；
- 全双工数据阶段使用单线模式；
- 至少存在一个头部 bit、Dummy 周期或数据字节。

`DATA_BYTES=0` 时忽略数据线宽和方向。非法启动被拒绝并置位 `CONFIG_ERROR`。

忙碌或禁用时写 `START`、空闲时写 `ABORT`、忙碌时清空任一 FIFO 均属于非法控制操作，会置位 `CONFIG_ERROR`。

### 6.3 SPI 时钟模式

`SPI_MODE[1]` 对应 CPOL，`SPI_MODE[0]` 对应 CPHA。SCLK 空闲电平由 CPOL 决定；前沿使 SCLK 离开 CPOL 电平，后沿使 SCLK 返回 CPOL 电平。

- CPHA 为 0 时，控制器在前沿之前准备输出，在前沿采样，在后沿推进下一组输出；
- CPHA 为 1 时，控制器在前沿改变输出，在后沿采样。

### 6.4 数据线映射

MSB 优先双线输出时，时间较早的 bit 映射到 D1，较晚的 bit 映射到 D0。MSB 优先四线输出时，每组 bit 按发送先后依次映射到 D3、D2、D1、D0。LSB 优先时，最早的一组 bit 按数据线编号递增顺序映射。输入时使用对应的逆映射，还原软件可见的数据字节。

各传输方式的数据线使用规则如下：

| 传输方式 | 输出线 | 输入线 |
| --- | --- | --- |
| 单线发送 | D0 | 无 |
| 双线发送 | D1:D0 | 无 |
| 四线发送 | D3:D0 | 无 |
| 单线接收 | 无 | 由 `SINGLE_RX_D1` 选择 D0 或 D1 |
| 双线接收 | 无 | D1:D0 |
| 四线接收 | 无 | D3:D0 |
| 单线全双工 | D0 | D1 |

只接收阶段和 Dummy 阶段将所有数据线置为高阻。空闲期间以及片选为高电平时，四根数据线均为高阻。

### 6.5 非字节对齐头部

命令、地址和模式位阶段均可独立配置 0 至 32 bit 长度，因此可以直接表示常见 SPI 外设使用的非字节对齐头部。例如，12 bit 四线模式字段由三个四线组发送，无需补齐为两个字节。

线宽决定每个 SCLK 周期传输的 bit 数，因此有效双线头部长度必须被 2 整除，有效四线头部长度必须被 4 整除。单线头部没有额外对齐要求。数据阶段始终以完整字节计数。

## 7. FIFO、暂停、中断、中止与配置快照

### 7.1 配置快照

`START` 被接受时，协议引擎会锁存全部时序、传输、阶段、长度和头部数据配置。事务忙碌期间写这些寄存器只会配置下一笔事务，不会改变当前事务。忙碌期间仍可正常服务 FIFO，并可对中断状态执行 W1C。

### 7.2 TX/RX FIFO 与边界暂停

无论串行线宽如何，FIFO 条目始终为字节。软件可以在 `START` 前预装 TX 字节，也可以在事务执行期间继续补充。

当 TX 字节不可用时，协议引擎保持片选有效，只在字节边界将 SCLK 暂停于 CPOL 电平；软件压入下一个完整字节后自动继续。RX 路径在无法存放下一个字节时同样会在新字节开始前暂停，软件读取 `RX_DATA` 释放空间后自动继续。控制器不会在一个字节的中间暂停。

全双工模式下，每个 `DATA_BYTES` 计数消耗一个 TX 字节并产生一个 RX 字节；只发送模式每个计数消耗一个 TX 字节；只接收模式每个计数产生一个 RX 字节。软件应以 `FIFO_STATUS` 为准，不应依赖固定的软件服务时序。

### 7.3 中断处理

典型中断服务流程为：先读取 `IRQ_STATUS`，根据状态服务 FIFO 或处理事务终止，再用覆盖目标位所在字节的 PSTRB 将已处理状态写回 `IRQ_STATUS`。

阈值中断源由电平条件产生并锁存。清除状态前应先解除对应条件，否则状态位会立即再次置位。例如：

- RX 阈值中断应先读取数据，直至 `RX_LEVEL < RX_THRESHOLD`，再清除 bit 5；
- TX 阈值中断应先补充数据，使 `TX_LEVEL > TX_THRESHOLD`，再清除 bit 4。

### 7.4 中止与复位

执行 `ABORT` 或在忙碌期间清除 `ENABLE` 时，控制器停止串行时钟，将 SCLK 恢复到当前 CPOL 电平，丢弃未完成的 RX 字节，依次完成 `CS_HOLD`、片选释放和 `CS_HIGH`，然后产生事务终止状态。中止前已完成的 TX 字节保持已消耗状态，已完成的 RX 字节仍保留在 FIFO 中。

`s_apb_presetn=0` 或 `CTRL.SOFT_RESET=1` 会清除配置、FIFO 指针与水位、中断状态和协议引擎状态，并使所有片选输出为高电平、SCLK 为低电平、四根数据线为高阻。复位不会产生事务完成中断。

## 8. 编程指导

### 8.1 推荐初始化与事务流程

1. 确认 `STATUS.BUSY=0`。
2. 通过 `CTRL.TX_CLEAR` 和 `CTRL.RX_CLEAR` 清空 FIFO。
3. 配置 `CLOCK_CFG`、`TRANSFER_CFG`、`PHASE_CFG` 和 `LENGTH_CFG`。
4. 写入有效阶段对应的头部数据寄存器。
5. 对发送事务预装 TX FIFO。
6. 置位 `CTRL.ENABLE`。
7. 写入 `ENABLE | START` 启动事务。
8. 通过轮询或中断服务 FIFO，等待事务结束并读取接收数据。

以下示例使用 32 bit APB 全字写。`QSPI` 表示寄存器块基地址；示例中省略了含义明确的 FIFO 轮询细节。

### 8.2 1-1-1 JEDEC ID 读取

```c
QSPI->CTRL = (1u << 3) | (1u << 4);  /* 空闲时清空 TX 和 RX FIFO */
QSPI->CLOCK_CFG = half_period;
QSPI->TRANSFER_CFG = 0x00000088u;    /* 单线接收，D1 输入，Mode 0，CS0 */
QSPI->PHASE_CFG = 0x00000008u;       /* 8 bit 单线命令 */
QSPI->LENGTH_CFG = 3u;
QSPI->COMMAND_DATA = 0x9fu;
QSPI->CTRL = 1u;                     /* ENABLE */
QSPI->CTRL = 3u;                     /* ENABLE | START */

while (QSPI->STATUS & 1u)            /* BUSY */
    ;
id[0] = (uint8_t)QSPI->RX_DATA;
id[1] = (uint8_t)QSPI->RX_DATA;
id[2] = (uint8_t)QSPI->RX_DATA;
```

### 8.3 带 12 bit 头部的 1-4-4 快速读取

本例展示独立的非字节对齐头部接口。12 bit 四线模式字段合法，因为 12 能被 4 整除；该字段在 6 个 Dummy 周期之前由三个四线组发送。

```c
QSPI->CTRL = (1u << 3) | (1u << 4);
QSPI->CLOCK_CFG = half_period;
QSPI->TRANSFER_CFG = 0x0000000au;    /* 四线接收，Mode 0，CS0 */
QSPI->PHASE_CFG = 0x068c9808u;       /* 8b x1 命令，24b x4 地址，
                                        12b x4 模式位，6 个 Dummy 周期 */
QSPI->LENGTH_CFG = read_length;
QSPI->COMMAND_DATA = 0xebu;
QSPI->ADDRESS_DATA = address & 0x00ffffffu;
QSPI->MODE_DATA = 0xabcu;            /* 恰好 12 个有效 bit */
QSPI->CTRL = 1u;
QSPI->CTRL = 3u;

while (remaining != 0u) {
    if ((QSPI->FIFO_STATUS & (1u << 18)) == 0u) {
        *destination++ = (uint8_t)QSPI->RX_DATA;
        --remaining;
    }
}
```

### 8.4 1-1-4 四线写入

```c
QSPI->CTRL = (1u << 3) | (1u << 4);
QSPI->CLOCK_CFG = half_period;
QSPI->TRANSFER_CFG = 0x00000006u;    /* 四线发送，Mode 0，CS0 */
QSPI->PHASE_CFG = 0x00001808u;       /* 8 bit 命令和 24 bit 地址均为单线 */
QSPI->LENGTH_CFG = 4u;
QSPI->COMMAND_DATA = 0x32u;
QSPI->ADDRESS_DATA = address & 0x00ffffffu;
QSPI->TX_DATA = payload[0];
QSPI->TX_DATA = payload[1];
QSPI->TX_DATA = payload[2];
QSPI->TX_DATA = payload[3];
QSPI->CTRL = 1u;
QSPI->CTRL = 3u;
```

### 8.5 单线全双工

```c
QSPI->CTRL = (1u << 3) | (1u << 4);
QSPI->CLOCK_CFG = half_period;
QSPI->TRANSFER_CFG = 0x0000000cu;    /* 单线全双工，D0 输出、D1 输入 */
QSPI->PHASE_CFG = 0u;                /* 无头部 */
QSPI->LENGTH_CFG = 3u;
QSPI->TX_DATA = tx[0];
QSPI->TX_DATA = tx[1];
QSPI->TX_DATA = tx[2];
QSPI->CTRL = 1u;
QSPI->CTRL = 3u;
```

## 9. 使用限制与检查清单

- `CS_COUNT` 必须在 `1..16` 范围内，`CS_SELECT` 只能使用有效索引。
- `FIFO_DEPTH` 必须是 `8..128` 范围内的 2 的幂。
- `s_apb_presetn` 必须与 `s_apb_pclk` 同步使用。
- 每组 `qspi_dN_i/o/t` 必须通过双向 I/O Buffer 连接物理引脚。
- `qspi_dN_t=1` 表示高阻，`qspi_dN_t=0` 表示输出驱动。
- 目标器件要求数据线具有确定空闲电平时，应在 IP 外部提供适当的上拉或下拉。
- 应根据目标器件数据手册配置片选建立、保持和高电平间隔。
- 有效双线和四线头部必须分别满足 2 bit 和 4 bit 长度对齐要求。
- 数据阶段以完整字节计数，不支持非字节对齐的数据阶段。
- 软件压入或弹出 FIFO 前，应检查满、空或水位字段。
- 清除阈值中断状态前，应先解除对应的水位条件。
- 修改外部引脚连接或启动下一笔事务前，应等待 `STATUS.BUSY=0`。
- 不要依赖忙碌期间写入的新配置改变当前事务；这些配置仅用于下一笔事务。
- 本 IP 仅支持主机模式，不提供 SPI 从机功能。
