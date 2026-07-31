# APB CAN 中文编程手册

## 1. 模块概述

`apb_can` 是一个 32 位 APB Classic CAN 2.0A/B 外设。发送和接收通道各使用
一个整帧 FIFO，每个 FIFO 条目包含 ID、帧类型、DLC 和最多 8 字节数据。CPU
通过 TX 暂存寄存器组装报文，再使用 `TX_CMD.PUSH` 原子压入 TX FIFO；接收端
使用 `RX_CMD.POP` 一次弹出一整帧。

当前实现支持：

- 11 位标准帧和 29 位扩展帧；
- 数据帧和远程帧，DLC 范围为 0 到 8；
- 位填充、CRC-15、ACK、仲裁和自动重发；
- Stuff、Form、CRC、ACK 和 Bit Error；
- Active/Passive Error Flag、TEC/REC、Error Warning、Error Passive 和 Bus-off；
- 128 组连续 11 个隐性位的 Bus-off 自动恢复；
- 一组可配置 code/mask 验收过滤器；
- Loopback、Listen-only、安全停机和安全终止；
- 16 个独立的粘滞中断事件。

模块不支持 CAN FD、过载帧、Sleep/Wakeup、自动响应远程帧、多组过滤器或发送
优先级队列。外部仍需 CAN 收发器完成逻辑电平与 CANH/CANL 差分总线之间的转换。

## 2. 参数与接口

### 2.1 参数

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `SYS_CLK_FREQ` | `50_000_000` | `s_apb_pclk` 频率，单位 Hz |
| `DEFAULT_BIT_RATE` | `500_000` | 复位后的默认标称位速率 |
| `TX_FIFO_DEPTH` | `8` | TX 整帧 FIFO 深度 |
| `RX_FIFO_DEPTH` | `8` | RX 整帧 FIFO 深度 |

受当前 `sync_fifo` 实现约束，两个 FIFO 深度应分别取不小于 8 的 2 的幂。FIFO
存储阵列不依赖复位清零；复位或清空命令只复位读写指针和条目计数，旧内容不再
有效。

### 2.2 端口

| 端口 | 方向 | 说明 |
|---|---|---|
| `s_apb_pclk` | 输入 | APB、CAN 核心和 FIFO 共用时钟 |
| `s_apb_presetn` | 输入 | 同步低有效复位 |
| `s_apb_psel` | 输入 | APB 从机选择 |
| `s_apb_penable` | 输入 | APB 访问阶段指示 |
| `s_apb_pwrite` | 输入 | `1` 为写，`0` 为读 |
| `s_apb_paddr[31:0]` | 输入 | APB 字节地址 |
| `s_apb_pwdata[31:0]` | 输入 | APB 写数据 |
| `s_apb_pready` | 输出 | APB 传输完成应答 |
| `s_apb_pslverr` | 输出 | 恒为 `0` |
| `s_apb_prdata[31:0]` | 输出 | APB 读数据 |
| `interrupt` | 输出 | 到 CPU 中断控制器的高有效中断 |
| `can_rx` | 输入 | CAN 收发器数字 RX；显性为 `0`，隐性为 `1` |
| `can_tx` | 输出 | CAN 收发器数字 TX；显性为 `0`，隐性为 `1` |

`interrupt` 等价于 Xilinx AXI CAN 的 `intr`：它是 CAN 控制器向 CPU 发出的中断
请求，不是 CAN 收发器引脚。常见 CAN 收发器只需连接 `can_tx`、`can_rx` 以及
收发器自身的使能或待机控制脚。

## 3. APB 访问行为

寄存器按 32 位对齐，使用 `s_apb_paddr[11:2]` 译码。读数据在 APB setup 阶段
锁存，`PREADY` 为注册输出，因此一次被选中的传输包含一个等待周期。寄存器
写入、FIFO push/pop 和 W1C 清除只在访问完成沿发生一次。CAN 总线忙、错误恢复
或 Bus-off 不会延长 APB 访问。

`s_apb_pslverr` 恒为 `0`。未定义地址的写入被忽略，读取返回 `0`。非法帧、非法
配置或非法命令通过 `IRQ_STATUS.CONFIG_ERROR` 和 `ERROR_STATUS.CONFIG_ERROR`
报告，不会让 APB 主机卡死。

## 4. 寄存器总表

| 偏移 | 寄存器 | 访问 | 复位值 | 说明 |
|---:|---|---|---:|---|
| `0x00` | `CTRL` | R/W、W1P | `0x0000_0008` | 运行、模式、FIFO 清空和软复位 |
| `0x04` | `BIT_TIMING` | R/W | 参数相关；默认 `0x0016_0009` | 标称位时序 |
| `0x08` | `STATUS` | R | `0x0000_1000` | 运行、总线和错误限制状态 |
| `0x0C` | `TX_ID` | R/W | `0x0000_0000` | TX 暂存 ID |
| `0x10` | `TX_CTRL` | R/W | `0x0000_0000` | TX 暂存 IDE、RTR、DLC |
| `0x14` | `TX_DATA0` | R/W | `0x0000_0000` | TX 数据字节 0 到 3 |
| `0x18` | `TX_DATA1` | R/W | `0x0000_0000` | TX 数据字节 4 到 7 |
| `0x1C` | `TX_CMD` | W1P | `0x0000_0000` | TX FIFO 压入和安全终止 |
| `0x20` | `RX_ID` | R | 无有效值 | 最近成功弹出帧的 ID |
| `0x24` | `RX_CTRL` | R | 无有效值 | 最近成功弹出帧的 IDE、RTR、DLC |
| `0x28` | `RX_DATA0` | R | 无有效值 | 最近成功弹出帧的数据字节 0 到 3 |
| `0x2C` | `RX_DATA1` | R | 无有效值 | 最近成功弹出帧的数据字节 4 到 7 |
| `0x30` | `RX_CMD` | W1P | `0x0000_0000` | RX FIFO 弹出 |
| `0x34` | `FIFO_STATUS` | R | `0x0005_0000` | FIFO 数量和状态 |
| `0x38` | `FIFO_THRESHOLD` | R/W | `0x0000_0000` | RX/TX crossing 阈值 |
| `0x3C` | `ACCEPT_CODE` | R/W | `0x0000_0000` | 验收比较值 |
| `0x40` | `ACCEPT_MASK` | R/W | `0x0000_0000` | 验收比较掩码 |
| `0x44` | `IRQ_STATUS` | R/W1C | `0x0000_0000` | 粘滞中断状态 |
| `0x48` | `IRQ_ENABLE` | R/W | `0x0000_0000` | 中断逐位使能 |
| `0x4C` | `ERROR_COUNTER` | R | `0x0000_0000` | TEC 和 REC |
| `0x50` | `ERROR_STATUS` | R/W1C | `0x0000_0000` | 错误明细和最近位置 |

RX 输出来自同步 FIFO 的读数据寄存器，硬件不对该数据寄存器复位。只有
`STATUS.RX_DATA_VALID=1` 时，`RX_ID/RX_CTRL/RX_DATA0/RX_DATA1` 才有意义。

## 5. 寄存器说明

### 5.1 CTRL，偏移 `0x00`

| 位 | 名称 | 访问 | 复位值 | 说明 |
|---:|---|---|---:|---|
| `0` | `ENABLE` | R/W | `0` | 请求核心运行 |
| `1` | `LISTEN_ONLY` | R/W | `0` | 只监听，不驱动数据、ACK 或错误标志 |
| `2` | `LOOPBACK` | R/W | `0` | 内部回环，外部 `can_tx` 保持隐性 |
| `3` | `AUTO_RETRY` | R/W | `1` | 仲裁失败或可重试错误后自动重发 |
| `4` | `FILTER_ENABLE` | R/W | `0` | 使能 code/mask 验收过滤 |
| `8` | `TX_CLEAR` | W1P | `0` | 清空排队帧，不清除活动帧 |
| `9` | `RX_CLEAR` | W1P | `0` | 清空 RX FIFO 并清除 `RX_DATA_VALID` |
| `31` | `SOFT_RESET` | W1P | `0` | 复位整个 CAN 外设 |

每次写 `CTRL` 都会用写数据 `[4:0]` 覆盖持久位；发出 FIFO 清空命令时必须同时
写回需要保留的模式位。`SOFT_RESET` 优先级最高，会复位配置、FIFO、核心、错误
计数和中断状态。

`LISTEN_ONLY` 与 `LOOPBACK` 不能同时为 `1`。位 `[4:1]` 只允许在
`STATUS.RUNNING=0` 时修改。运行中请求停止时，必须保留当前模式位，例如默认
自动重发模式应写 `0x0000_0008`，不能只写零；否则该写入会被当作非法模式修改。

清除 `ENABLE` 后，`STATUS.ENABLE` 立即反映软件请求，但 `STATUS.RUNNING` 只在
当前帧、错误恢复或仲裁接收到达安全边界后清零。等待重发的活动帧会保留，重新
使能后优先重发。

### 5.2 BIT_TIMING，偏移 `0x04`

| 位 | 名称 | 访问 | 实际值 |
|---:|---|---|---|
| `[9:0]` | `BRP` | R/W | 每 TQ 的时钟数为 `BRP+1` |
| `[13:12]` | `SJW` | R/W | 同步跳转宽度为 `SJW+1` TQ |
| `[19:16]` | `TSEG1` | R/W | 段长度为 `TSEG1+1` TQ |
| `[22:20]` | `TSEG2` | R/W | 段长度为 `TSEG2+1` TQ |

```text
TQ_PER_BIT = 1 + (TSEG1 + 1) + (TSEG2 + 1)
BIT_RATE   = SYS_CLK_FREQ / ((BRP + 1) * TQ_PER_BIT)
采样点     = (1 + TSEG1 + 1) / TQ_PER_BIT
```

要求 `TSEG1>=1`，并且 `SJW<=TSEG2`。位时序只允许在 `RUNNING=0` 时修改。
写入无效配置或在运行中写入会保持原配置并报告 `CONFIG_ERROR`。

50 MHz 时钟、500 kbit/s、10 TQ、80% 采样点的配置为：

```text
BRP=9, SJW=0, TSEG1=6, TSEG2=1
BIT_TIMING = 0x0016_0009
```

复位值使用同样的 10 TQ 分段，并根据 `SYS_CLK_FREQ` 和 `DEFAULT_BIT_RATE` 计算
`BRP`。参数组合应保证除法结果非零且位速率误差可接受。

### 5.3 STATUS，偏移 `0x08`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `ENABLE` | R | 软件运行请求 |
| `1` | `RUNNING` | R | 核心已经进入运行状态 |
| `2` | `BUS_IDLE` | R | 核心运行且 TX/RX 均处于空闲边界 |
| `3` | `TX_ACTIVE` | R | 活动发送缓冲包含一帧 |
| `4` | `RX_ACTIVE` | R | 正在接收或校验帧 |
| `5` | `RETRY_PENDING` | R | 活动帧等待自动重发 |
| `6` | `RX_DATA_VALID` | R | RX 输出寄存器包含一次成功弹出的帧 |
| `7` | `ERROR_WARNING` | R | TEC 或 REC 不小于 96 |
| `8` | `ERROR_PASSIVE` | R | TEC 或 REC 不小于 128 |
| `9` | `BUS_OFF` | R | TEC 大于 255 |
| `10` | `LISTEN_ONLY` | R | 当前只听模式 |
| `11` | `LOOPBACK` | R | 当前内部回环模式 |
| `12` | `CAN_RX` | R | 两级同步后的外部 RX 电平 |
| `13` | `TX_ABORT_PENDING` | R | 已请求在安全边界终止活动帧 |

`ENABLE` 与 `RUNNING` 分离用于安全停机。判断发送通道彻底空闲时，应同时检查
`FIFO_STATUS.TX_LEVEL==0` 和 `TX_ACTIVE==0`。

### 5.4 TX 帧寄存器，偏移 `0x0C` 到 `0x1C`

`TX_ID[28:0]` 保存标识符。标准帧只允许使用 `[10:0]`，其高 18 位必须为零；
扩展帧使用完整 29 位。

| `TX_CTRL` 位 | 名称 | 说明 |
|---:|---|---|
| `[3:0]` | `DLC` | 数据长度码，允许 0 到 8 |
| `4` | `RTR` | `1` 为远程帧 |
| `5` | `IDE` | `1` 为 29 位扩展帧 |

`TX_DATA0[7:0]` 为 CAN 数据字节 0，`TX_DATA0[31:24]` 为字节 3；
`TX_DATA1[7:0]` 为字节 4，`TX_DATA1[31:24]` 为字节 7。远程帧不发送数据字段，
但 DLC 会原样保留。

| `TX_CMD` 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `PUSH` | W1P | 校验暂存寄存器并原子压入一整帧 |
| `1` | `ABORT` | W1P | 在安全协议边界丢弃活动帧并禁止继续重发 |

TX FIFO 满、DLC 大于 8 或标准 ID 高位非零时，`PUSH` 不入队并报告错误。没有
活动帧时执行 `ABORT` 也报告 `CONFIG_ERROR`。`TX_CLEAR` 只清除仍在 FIFO 中的
排队帧，不影响已经装入核心的活动帧。

### 5.5 RX 帧寄存器，偏移 `0x20` 到 `0x30`

RX 帧字段和字节顺序与 TX 寄存器一致。读取 RX 数据寄存器本身不会移动 FIFO。
软件应先确认 `FIFO_STATUS.RX_LEVEL!=0`，再向 `RX_CMD.POP` 写 `1`。该 APB 写
完成后，同步 FIFO 已在下一时钟沿更新输出，随后四个 RX 数据寄存器可按任意
顺序读取，`STATUS.RX_DATA_VALID` 同时置位。

空 FIFO 上执行 `POP` 不改变 FIFO，清除 `RX_DATA_VALID`，并置位 RX 下溢错误。
因此不能把复位后或空弹出后的 RX 寄存器内容当作有效帧。

### 5.6 FIFO_STATUS 与 FIFO_THRESHOLD，偏移 `0x34`、`0x38`

| `FIFO_STATUS` 位 | 名称 | 说明 |
|---:|---|---|
| `[7:0]` | `TX_LEVEL` | TX FIFO 排队帧数，不包含活动帧 |
| `[15:8]` | `RX_LEVEL` | RX FIFO 待弹出帧数 |
| `16` | `TX_EMPTY` | TX FIFO 为空 |
| `17` | `TX_FULL` | TX FIFO 已满 |
| `18` | `RX_EMPTY` | RX FIFO 为空 |
| `19` | `RX_FULL` | RX FIFO 已满 |
| `20` | `TX_ACTIVE` | 活动发送缓冲有效 |
| `21` | `RX_DATA_VALID` | RX 输出寄存器有效 |

`FIFO_THRESHOLD[7:0]` 为 RX 阈值，`[15:8]` 为 TX 阈值：

- RX 数量从阈值下方上穿到阈值或以上时产生一次事件；RX 阈值为 0 时关闭；
- TX 数量从阈值上方下降到阈值或以下时产生一次事件；TX 阈值可为 0；
- 事件只在 crossing 时产生。清除 IRQ 后，如果数量没有离开并重新跨越阈值，
  不会重复置位。

正确接收的帧即使因过滤不匹配或 RX FIFO 已满而不入队，控制器仍会按协议 ACK。
RX FIFO 满时额外置位 `RX_OVERFLOW`。

### 5.7 ACCEPT_CODE 与 ACCEPT_MASK，偏移 `0x3C`、`0x40`

验收键和比较式为：

```text
frame_key[30:0] = {id[28:0], ide, rtr}
match = ((frame_key ^ ACCEPT_CODE) & ACCEPT_MASK) == 0
```

`ACCEPT_MASK` 中 `1` 表示该位参与比较，`0` 表示忽略。两个寄存器的位 31 保留
并读回零。过滤配置只允许在 `RUNNING=0` 时修改；`FILTER_ENABLE=0` 时接收所有
正确帧。

只接收标准数据帧 ID `0x123` 的配置示例：

```text
ACCEPT_CODE = 0x0000_048c    // {29'h123, IDE=0, RTR=0}
ACCEPT_MASK = 0x0000_1fff    // 比较 11 位 ID、IDE 和 RTR
```

### 5.8 IRQ_STATUS 与 IRQ_ENABLE，偏移 `0x44`、`0x48`

`IRQ_STATUS` 是 W1C 粘滞状态，`IRQ_ENABLE` 为逐位使能：

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

| 位 | 名称 | 事件 |
|---:|---|---|
| `0` | `RX_FRAME` | 正确帧成功进入 RX FIFO |
| `1` | `TX_DONE` | 活动帧发送成功 |
| `2` | `RX_THRESHOLD` | RX FIFO 上穿阈值 |
| `3` | `TX_THRESHOLD` | TX FIFO 下穿阈值 |
| `4` | `TX_FAILED` | 发送最终失败且不再重试 |
| `5` | `ARBITRATION_LOST` | 仲裁丢失 |
| `6` | `PROTOCOL_ERROR` | 任一协议错误 |
| `7` | `WARNING_ENTER` | 进入 Error Warning |
| `8` | `PASSIVE_ENTER` | 进入 Error Passive |
| `9` | `BUS_OFF_ENTER` | 进入 Bus-off |
| `10` | `BUS_RECOVERED` | Bus-off 自动恢复完成 |
| `11` | `RX_OVERFLOW` | 正确帧因 RX FIFO 满而丢弃 |
| `12` | `TX_OVERFLOW` | TX FIFO 满时执行 `PUSH` |
| `13` | `RX_UNDERFLOW` | RX FIFO 空时执行 `POP` |
| `14` | `CONFIG_ERROR` | 非法配置、帧或命令 |
| `15` | `TX_ABORTED` | 活动帧已在安全边界终止 |

写 `IRQ_STATUS` 只清除写入值中为 `1` 的位。同一时钟出现的新事件优先于 W1C，
所以不会因同时清除而丢失。清状态不会改变 `IRQ_ENABLE`。

### 5.9 ERROR_COUNTER 与 ERROR_STATUS，偏移 `0x4C`、`0x50`

| `ERROR_COUNTER` 位 | 名称 | 说明 |
|---:|---|---|
| `[8:0]` | `TEC` | 9 位发送错误计数器；第 9 位用于表示 Bus-off |
| `[23:16]` | `REC` | 8 位接收错误计数器 |

TEC 或 REC 达到 96 时进入 Error Warning，达到 128 时进入 Error Passive；TEC
大于 255 时进入 Bus-off。成功发送会降低 TEC，成功接收会降低或规范化 REC。
Listen-only 可以记录错误状态，但不会修改 TEC/REC。

| `ERROR_STATUS` 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `STUFF_ERROR` | R/W1C | 位填充错误 |
| `1` | `FORM_ERROR` | R/W1C | 固定格式位错误 |
| `2` | `CRC_ERROR` | R/W1C | 接收 CRC 不匹配 |
| `3` | `ACK_ERROR` | R/W1C | 发送端未收到 ACK |
| `4` | `BIT_ERROR` | R/W1C | 非仲裁位采样与发送不一致 |
| `5` | `ARBITRATION_LOST` | R/W1C | 仲裁丢失 |
| `6` | `RX_OVERFLOW` | R/W1C | RX FIFO 溢出 |
| `7` | `TX_OVERFLOW` | R/W1C | TX FIFO 溢出 |
| `8` | `RX_UNDERFLOW` | R/W1C | RX FIFO 下溢 |
| `9` | `CONFIG_ERROR` | R/W1C | 非法配置、帧或命令 |
| `[12:10]` | `LAST_ERROR_TYPE` | R | 0 无、1 Stuff、2 Form、3 CRC、4 ACK、5 Bit |
| `13` | - | R | 保留，读回 0 |
| `[17:14]` | `LAST_ERROR_FIELD` | R | 最近协议错误所在字段 |
| `[23:18]` | `ARB_LOST_POS` | R | 仲裁字段内的零基丢失位置 |

`LAST_ERROR_FIELD` 编码：0 无，1 SOF，2 仲裁，3 控制，4 数据，5 CRC，6 ACK，
7 EOF，8 Error Delimiter，9 Intermission。写 `ERROR_STATUS` 只清除低 10 位粘滞
标志，不改变最近错误类型、字段或仲裁位置。

## 6. 编程指导

以下伪代码假定 `CAN` 指向 CAN 寄存器基地址，且每个成员为 32 位。

### 6.1 初始化与 500 kbit/s 配置

```c
CAN->CTRL = 1u << 31;                   /* 软复位 */
CAN->BIT_TIMING = 0x00160009u;          /* 50 MHz, 500 kbit/s, 80% */
CAN->FIFO_THRESHOLD = (2u << 8) | 2u;  /* TX=2, RX=2 */
CAN->ACCEPT_CODE = 0;
CAN->ACCEPT_MASK = 0;                  /* 接收所有帧 */
CAN->ERROR_STATUS = 0x3ffu;            /* 清错误粘滞位 */
CAN->IRQ_STATUS = 0xffffu;             /* 清旧事件 */
CAN->IRQ_ENABLE = (1u << 0) | (1u << 1) |
                  (1u << 4) | (1u << 6) |
                  (1u << 9) | (1u << 10);
CAN->CTRL = (1u << 3) | (1u << 0);     /* AUTO_RETRY + ENABLE */
```

修改位时序、过滤或模式前，应写回当前模式位并清除 `ENABLE`，等待
`STATUS.RUNNING==0`，再修改配置并重新使能。

### 6.2 轮询发送

```c
int can_send(uint32_t id, int ide, int rtr, uint8_t dlc,
             uint32_t data0, uint32_t data1)
{
    if (dlc > 8 || (!ide && id > 0x7ffu))
        return -1;

    while (CAN->FIFO_STATUS & (1u << 17)) /* TX_FULL */
        ;

    CAN->TX_ID = id;
    CAN->TX_CTRL = (uint32_t)dlc |
                   ((uint32_t)rtr << 4) |
                   ((uint32_t)ide << 5);
    CAN->TX_DATA0 = data0;
    CAN->TX_DATA1 = data1;
    CAN->TX_CMD = 1u << 0;              /* PUSH */
    return 0;
}

int can_wait_tx(void)
{
    for (;;) {
        uint32_t irq = CAN->IRQ_STATUS;
        if (irq & (1u << 1)) {
            CAN->IRQ_STATUS = 1u << 1;
            return 0;
        }
        if (irq & (1u << 4)) {
            CAN->IRQ_STATUS = 1u << 4;
            return -1;
        }
    }
}
```

连续发送时只需在 `TX_FULL` 时等待，不应逐帧等待 `TX_ACTIVE` 清零。CPU 写入
后可以立即修改 TX 暂存寄存器；已压入 FIFO 的 99 位帧不会受影响。

### 6.3 批量接收

```c
struct can_frame {
    uint32_t id;
    uint32_t ctrl;
    uint32_t data0;
    uint32_t data1;
};

size_t can_read_snapshot(struct can_frame *out, size_t capacity)
{
    size_t i;
    size_t count = (CAN->FIFO_STATUS >> 8) & 0xffu;
    if (count > capacity)
        count = capacity;

    for (i = 0; i < count; ++i) {
        CAN->RX_CMD = 1u << 0;          /* 同步 FIFO POP */
        if (!(CAN->STATUS & (1u << 6)))
            break;
        out[i].id = CAN->RX_ID;
        out[i].ctrl = CAN->RX_CTRL;
        out[i].data0 = CAN->RX_DATA0;
        out[i].data1 = CAN->RX_DATA1;
    }
    return i;
}
```

`RX_CMD` 写传输本身提供了同步 FIFO 更新所需的时钟，因此之后直接读取 RX
寄存器，不需要额外读取一个虚假帧。必须检查 `RX_LEVEL` 或 `RX_DATA_VALID`，避免
把空 FIFO 保留的旧输出当作新帧。

### 6.4 验收过滤

配置过滤器时先安全停止核心：

```c
uint32_t mode = CAN->CTRL & 0x1eu;
CAN->CTRL = mode;                       /* ENABLE=0，保留模式 */
while (CAN->STATUS & (1u << 1))         /* RUNNING */
    ;

CAN->ACCEPT_CODE = 0x0000048cu;         /* 标准数据帧 0x123 */
CAN->ACCEPT_MASK = 0x00001fffu;
CAN->CTRL = mode | (1u << 4) | 1u;     /* FILTER_ENABLE + ENABLE */
```

若需要匹配多个 ID，可把相应 ID 位的 mask 写零。过滤只控制 RX FIFO 提交，不
改变 CRC 检查和 ACK 行为。

### 6.5 中断处理

ISR 应先保存 `IRQ_STATUS`，再读取错误诊断和处理 FIFO，最后只清除已经处理的
位。推荐优先处理 Bus-off 和协议错误，再处理 RX/TX：

```c
void can_isr(void)
{
    uint32_t handled = 0;
    uint32_t pending = CAN->IRQ_STATUS & CAN->IRQ_ENABLE;

    if (pending & ((1u << 9) | (1u << 6) | (1u << 4))) {
        log_can_error(CAN->ERROR_COUNTER, CAN->ERROR_STATUS);
        handled |= pending & ((1u << 9) | (1u << 6) | (1u << 4));
    }
    if (pending & ((1u << 0) | (1u << 2))) {
        drain_can_rx_fifo();
        handled |= pending & ((1u << 0) | (1u << 2));
    }
    if (pending & ((1u << 1) | (1u << 3))) {
        fill_can_tx_fifo();
        handled |= pending & ((1u << 1) | (1u << 3));
    }
    handled |= pending & 0xfc00u;
    CAN->IRQ_STATUS = handled;           /* W1C */
}
```

W1C 与新事件同周期发生时，新事件保持置位。ISR 返回前可再次读取
`IRQ_STATUS & IRQ_ENABLE`，直到没有待处理事件。

### 6.6 Bus-off 与恢复

进入 Bus-off 后，`can_tx` 强制为隐性，`ERROR_COUNTER.TEC` 大于 255，
`IRQ_STATUS.BUS_OFF_ENTER` 置位。硬件随后统计 128 次完整的 11 个连续隐性位：
显性位只清零当前组内计数，不清除已经完成的组数。

最后一组完成后，TEC/REC 清零，退出 Error Passive/Bus-off，并置位
`BUS_RECOVERED`。如果 `AUTO_RETRY=1` 且仍有活动帧，该帧会在恢复后重新参与
总线。软件可以只观察恢复中断，也可以写 `CTRL.SOFT_RESET` 强制丢弃所有状态并
重新初始化。

### 6.7 Loopback、Listen-only 与安全终止

- Loopback 使用真实发送、位填充、CRC 和接收解析路径，但外部 `can_tx` 始终为
  隐性，适合驱动自检，不验证外部收发器；
- Listen-only 可接收和过滤帧，也记录错误类型，但不发送 ACK/错误标志且不修改
  TEC/REC；
- `TX_CMD.ABORT` 只在协议安全边界释放活动帧。可等待 `TX_ABORTED` 中断确认，
  不能假设命令写入后 `TX_ACTIVE` 立即清零。

## 7. 使用限制与检查清单

- 仅支持 Classic CAN 2.0A/B，最大有效载荷为 8 字节；
- 需要外部 CAN 收发器；`interrupt` 连接 CPU，不连接收发器；
- `can_tx/can_rx` 使用显性低、隐性高的数字电平；
- FIFO 深度使用不小于 8 的 2 的幂；
- 标准帧 ID 高 18 位必须为零，DLC 必须在 0 到 8；
- 位时序、模式和过滤配置只能在 `RUNNING=0` 时修改；
- 写 `CTRL` 清空或停止时必须同时保留需要的模式位；
- `TX_EMPTY` 不包含活动帧，应结合 `TX_ACTIVE` 判断发送通道；
- RX 数据寄存器只在成功 `POP` 后有效，空弹出会报告下溢；
- RX 过滤不影响 ACK，RX FIFO 满也仍会 ACK 正确帧；
- 阈值中断是 crossing 事件，不是持续电平条件；
- IRQ 和错误低位均为 W1C，清除时只写需要清除的位；
- 未定义 APB 地址和非法命令不会产生 `PSLVERR`，应检查错误状态；
- 上板前应使用实际 `SYS_CLK_FREQ` 重新计算位时序，并验证收发器延迟和采样点。
