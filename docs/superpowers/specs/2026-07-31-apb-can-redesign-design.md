# APB CAN Classic 外设重构设计

## 1. 目标与范围

重新设计 `rtl/can` 下的 CAN 外设。现有 CAN RTL 仅作为帧字段和 CRC 算法参考，不保留内部接口兼容性。对外继续使用 `apb_can` 模块名和现有 APB、`interrupt`、`can_rx`、`can_tx` 端口形式，使其可直接替换旧外设。

本次实现支持 Classic CAN 2.0A/B：

- 11 位标准帧和 29 位扩展帧；
- 数据帧和远程帧，DLC 范围为 0 到 8；
- 整帧 TX/RX FIFO；
- 位填充、CRC-15、ACK、仲裁和自动重发；
- Stuff、Form、CRC、ACK 和 Bit Error；
- Active Error Flag、Passive Error Flag 和 Error Delimiter；
- TEC、REC、Error Warning、Error Passive 和 Bus-off；
- 符合规范的 Bus-off 自动恢复计数；
- 内部回环、只听模式和一组验收 code/mask；
- 独立中断状态和中断使能。

本次不支持 CAN FD、过载帧、Sleep/Wakeup、自动响应远程帧、多组过滤器和高优先级发送缓冲。

## 2. 设计约束

- 所有 RTL 和测试使用 Verilog-2005，文件扩展名为 `.v`。
- 主时钟为 `s_apb_pclk`，内部别名为 `clk`；低有效复位为 `s_apb_presetn`，内部别名为 `rst_n`。
- 除异步输入同步器外，状态逻辑使用同步低有效复位。
- APB 数据宽度固定为 32 位，地址使用 `s_apb_paddr[11:2]` 按字译码。
- `s_apb_pslverr` 恒为 0。非法软件操作通过错误状态和中断报告，不能无限延长 APB 访问。
- TX/RX FIFO 均复用 `rtl/misc/sync_fifo.v`，FIFO 条目是一整帧。
- `TX_FIFO_DEPTH` 和 `RX_FIFO_DEPTH` 独立可配置，默认均为 8。受当前 `sync_fifo` 约束，深度应为不小于 8 的 2 的幂。
- 本阶段只使用 Icarus Verilog 进行编译和仿真，不执行综合；综合和上板验证留到后续任务。

`apb_can` 参数如下：

| 参数 | 默认值 | 说明 |
|---|---:|---|
| `SYS_CLK_FREQ` | `50_000_000` | `s_apb_pclk` 频率，单位 Hz |
| `DEFAULT_BIT_RATE` | `500_000` | 复位后的默认 CAN 标称位速率 |
| `TX_FIFO_DEPTH` | `8` | TX 整帧 FIFO 深度 |
| `RX_FIFO_DEPTH` | `8` | RX 整帧 FIFO 深度 |

## 3. 模块划分

### 3.1 `apb_can.v`

CAN 外设顶层，负责：

- APB 握手、寄存器读写和默认值；
- TX 帧暂存寄存器与原子 `TX_PUSH`；
- 两个 99 位 `sync_fifo` 实例；
- RX FIFO 同步弹出后的帧寄存器视图；
- FIFO 阈值检测；
- 中断状态、使能和错误粘滞状态；
- APB 配置与 CAN 核心之间的命令和事件转换。

### 3.2 `can_core.v`

统一的 CAN 协议引擎，负责：

- 总线空闲、接收、发送、仲裁丢失、错误帧和恢复状态；
- 标准帧和扩展帧的实时串行化与解析；
- 位填充和解填充；
- ACK 发送与检查；
- 活动 TX 帧保存、自动重发和安全终止；
- 验收过滤后的 RX 帧提交；
- TEC/REC 更新、错误状态转换和 Bus-off 恢复；
- Loopback 和 Listen-only 行为。

发送和接收必须共享统一的总线阶段认知。仲裁、ACK、错误标志和接收解析不能由彼此无关的状态机分别决定。

### 3.3 `can_bit_timing.v`

负责：

- 两级同步 `can_rx`；
- 将 APB 时钟按 `BRP` 划分为时间量子 TQ；
- 产生位开始、发送更新、采样和位结束脉冲；
- SOF 的硬同步；
- 帧内边沿的相位重同步，每位最多一次，修正量不超过 SJW。

### 3.4 `can_crc.v`

重新编写串行 CAN CRC-15 累加器，生成多项式为 `0x4599`。模块提供同步清零和单比特使能输入。发送和接收路径分别实例化，填充位不进入 CRC。

### 3.5 被替代文件

实现完成后删除或停止使用旧的 `can_top.v`、`can_tx.v`、`can_rx.v` 和 `can_fifo.v`。旧的 `can_bit_timing.v`、`can_crc.v` 和 `apb_can.v` 由新实现覆盖。

## 4. 帧格式与 FIFO 数据流

FIFO 条目宽度为 99 位：

```text
{id[28:0], ide, rtr, dlc[3:0], data[63:0]}
```

- 标准帧使用 `id[10:0]`，`id[28:11]` 必须为 0。
- 扩展帧使用完整 `id[28:0]`。
- `data[7:0]` 为 CAN 数据字节 0，之后按字节递增，`data[63:56]` 为字节 7。
- 远程帧不发送数据字段，DLC 保留为请求的数据长度。

CPU 写 TX 暂存寄存器后执行 `TX_PUSH`。包装层校验帧格式，并在同一个 APB 完成沿将完整 99 位帧压入 TX FIFO。CAN 核心请求下一帧时，包装层弹出 FIFO；同步 FIFO 在下一拍提供数据，包装层再向核心产生一个周期的 `tx_frame_valid`。

核心将帧复制到活动发送缓冲。活动帧已经不计入 `TX_LEVEL`，但 `FIFO_STATUS.TX_ACTIVE` 为 1。仲裁失败或可重试错误不会重新读取 CPU 暂存区，也不会丢失活动帧。只有发送成功、关闭自动重发后的最终失败或安全终止后，活动缓冲才释放。

接收帧通过 CRC 和格式检查后，先决定 ACK，再执行验收过滤。正确帧即使被过滤或 RX FIFO 已满，仍应 ACK；过滤仅决定是否提交给 CPU。通过过滤且 FIFO 未满的帧以单个 99 位写操作进入 RX FIFO。

CPU 写 `RX_POP` 后弹出一整帧。同步 FIFO 的输出在下一拍更新，随后 `RX_ID/RX_CTRL/RX_DATA0/RX_DATA1` 可按任意顺序读取。成功弹出置 `RX_DATA_VALID`；空弹出清除该标志并报告下溢。读取 RX 数据寄存器本身不移动 FIFO。

## 5. APB 行为

APB 行为与 `apb_i2c` 一致：

- setup 阶段锁存读数据；
- `PREADY` 为注册输出，一次传输只完成一次；
- 写寄存器、FIFO push/pop 和 W1C 只在 APB 访问完成沿发生；
- 未定义地址读回 0，写入被忽略；
- CAN 总线忙、等待 ACK、错误恢复或 Bus-off 均不延长 APB 访问。

## 6. 寄存器总表

| 偏移 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0x00` | `CTRL` | R/W、W1P | 控制模式、FIFO 命令和软复位 |
| `0x04` | `BIT_TIMING` | R/W | BRP、SJW、TSEG1、TSEG2 |
| `0x08` | `STATUS` | R | 总线和错误限制状态 |
| `0x0C` | `TX_ID` | R/W | TX 暂存 ID |
| `0x10` | `TX_CTRL` | R/W | TX 暂存 IDE、RTR、DLC |
| `0x14` | `TX_DATA0` | R/W | TX 字节 0 到 3 |
| `0x18` | `TX_DATA1` | R/W | TX 字节 4 到 7 |
| `0x1C` | `TX_CMD` | W1P | 压入和安全终止 |
| `0x20` | `RX_ID` | R | 最近弹出帧的 ID |
| `0x24` | `RX_CTRL` | R | 最近弹出帧的 IDE、RTR、DLC |
| `0x28` | `RX_DATA0` | R | RX 字节 0 到 3 |
| `0x2C` | `RX_DATA1` | R | RX 字节 4 到 7 |
| `0x30` | `RX_CMD` | W1P | 弹出一帧 |
| `0x34` | `FIFO_STATUS` | R | FIFO 数量和状态 |
| `0x38` | `FIFO_THRESHOLD` | R/W | RX/TX 中断阈值 |
| `0x3C` | `ACCEPT_CODE` | R/W | 验收比较值 |
| `0x40` | `ACCEPT_MASK` | R/W | 验收比较掩码 |
| `0x44` | `IRQ_STATUS` | R/W1C | 中断状态 |
| `0x48` | `IRQ_ENABLE` | R/W | 中断使能 |
| `0x4C` | `ERROR_COUNTER` | R | TEC 和 REC |
| `0x50` | `ERROR_STATUS` | R/W1C | 错误明细和最近错误位置 |

## 7. 寄存器位定义

### 7.1 `CTRL`

| 位 | 名称 | 复位值 | 说明 |
|---:|---|---:|---|
| 0 | `ENABLE` | 0 | 请求运行 CAN 核心 |
| 1 | `LISTEN_ONLY` | 0 | 只监听，不驱动 ACK 或错误标志 |
| 2 | `LOOPBACK` | 0 | 内部回环，不驱动外部 CAN 总线 |
| 3 | `AUTO_RETRY` | 1 | 仲裁失败或可重试发送错误后自动重发 |
| 4 | `FILTER_ENABLE` | 0 | 使能验收 code/mask |
| 8 | `TX_CLEAR` | 0 | W1P，清除排队帧，不清除活动帧 |
| 9 | `RX_CLEAR` | 0 | W1P，清除 RX FIFO 和 `RX_DATA_VALID` |
| 31 | `SOFT_RESET` | 0 | W1P，复位整个 CAN 外设 |

`LISTEN_ONLY` 与 `LOOPBACK` 不能同时为 1。模式位只允许在 `STATUS.RUNNING=0` 时修改。写 `ENABLE=0` 会请求核心在安全协议边界停止；若活动帧正在等待重发，核心保留该帧，重新使能后优先继续发送。

每次写 `CTRL` 都会用写数据 `[4:0]` 覆盖持久控制位，W1P 位读回为 0。驱动发出 FIFO 清空或软复位以外的控制脉冲时，必须同时写回希望保留的持久控制位。`SOFT_RESET` 优先级最高。

### 7.2 `BIT_TIMING`

| 位 | 名称 | 实际值 |
|---:|---|---|
| `[9:0]` | `BRP` | 每 TQ 的 APB 时钟数为 `BRP+1` |
| `[13:12]` | `SJW` | 同步跳转宽度为 `SJW+1` TQ |
| `[19:16]` | `TSEG1` | 段长度为 `TSEG1+1` TQ |
| `[22:20]` | `TSEG2` | 段长度为 `TSEG2+1` TQ |

每位总 TQ 数为：

```text
TQ_PER_BIT = 1 + (TSEG1 + 1) + (TSEG2 + 1)
BIT_RATE   = SYS_CLK_FREQ / ((BRP + 1) * TQ_PER_BIT)
```

要求 `TSEG1+1` 至少为 2，`SJW+1 <= TSEG2+1`。配置只允许在核心停止时修改。默认使用 10 TQ、80% 采样点，并根据 `SYS_CLK_FREQ` 和 `DEFAULT_BIT_RATE` 计算默认 BRP；默认参数为 50 MHz 和 500 kbit/s。

### 7.3 `STATUS`

| 位 | 名称 | 说明 |
|---:|---|---|
| 0 | `ENABLE` | 软件运行请求 |
| 1 | `RUNNING` | 核心已经进入运行状态 |
| 2 | `BUS_IDLE` | 已观察到总线空闲 |
| 3 | `TX_ACTIVE` | 存在活动发送帧 |
| 4 | `RX_ACTIVE` | 正在接收或校验帧 |
| 5 | `RETRY_PENDING` | 活动帧等待重发 |
| 6 | `RX_DATA_VALID` | RX 输出寄存器包含一次成功弹出的帧 |
| 7 | `ERROR_WARNING` | TEC 或 REC 不小于 96 |
| 8 | `ERROR_PASSIVE` | TEC 或 REC 不小于 128 |
| 9 | `BUS_OFF` | TEC 超过 255 |
| 10 | `LISTEN_ONLY` | 当前只听模式 |
| 11 | `LOOPBACK` | 当前回环模式 |
| 12 | `CAN_RX` | 同步后的 CAN 接收电平 |
| 13 | `TX_ABORT_PENDING` | 已请求安全终止活动帧 |

### 7.4 TX/RX 帧寄存器

`TX_ID` 和 `RX_ID` 使用 `[28:0]`。`TX_CTRL` 和 `RX_CTRL` 使用：

| 位 | 名称 | 说明 |
|---:|---|---|
| `[3:0]` | `DLC` | 0 到 8 |
| 4 | `RTR` | 1 为远程帧 |
| 5 | `IDE` | 1 为 29 位扩展帧 |

`TX_DATA0[7:0]` 是字节 0，`TX_DATA0[31:24]` 是字节 3；`TX_DATA1` 对应字节 4 到 7。RX 数据寄存器采用相同顺序。

### 7.5 `TX_CMD` 与 `RX_CMD`

| 寄存器位 | 名称 | 说明 |
|---|---|---|
| `TX_CMD[0]` | `PUSH` | 校验并压入一帧 |
| `TX_CMD[1]` | `ABORT` | 在安全协议边界放弃活动帧并禁止其继续重发 |
| `RX_CMD[0]` | `POP` | 从 RX FIFO 弹出一整帧 |

`TX_PUSH` 在 DLC 大于 8、标准 ID 高位非 0 或 TX FIFO 已满时失败。`TX_ABORT` 不会在任意位中间突然释放显性电平；若活动帧已开始参与总线，则先完成当前协议动作和错误恢复，再丢弃活动帧。

### 7.6 `FIFO_STATUS` 与 `FIFO_THRESHOLD`

`FIFO_STATUS`：

| 位 | 名称 | 说明 |
|---:|---|---|
| `[7:0]` | `TX_LEVEL` | 排队帧数，不含活动帧 |
| `[15:8]` | `RX_LEVEL` | 待弹出帧数 |
| 16 | `TX_EMPTY` | TX FIFO 为空 |
| 17 | `TX_FULL` | TX FIFO 已满 |
| 18 | `RX_EMPTY` | RX FIFO 为空 |
| 19 | `RX_FULL` | RX FIFO 已满 |
| 20 | `TX_ACTIVE` | 活动发送缓冲有效 |
| 21 | `RX_DATA_VALID` | RX 输出寄存器有效 |

`FIFO_THRESHOLD[7:0]` 为 RX 阈值，`[15:8]` 为 TX 阈值。RX 数量从阈值下方上穿时置位 RX 阈值事件；RX 阈值为 0 时关闭该事件。TX 数量从阈值上方下降到阈值或以下时置位 TX 阈值事件。事件只在跨越时产生，清除中断状态而数量未重新跨越时不会重复置位。

### 7.7 验收过滤

验收键为：

```text
frame_key[30:0] = {id[28:0], ide, rtr}
match = ((frame_key ^ ACCEPT_CODE) & ACCEPT_MASK) == 0
```

`ACCEPT_MASK` 中 1 表示该位参与比较，0 表示忽略。位 31 保留并读回 0。复位时 code 和 mask 均为 0；因此 mask 为 0 时接收所有正确帧。

### 7.8 中断

`IRQ_STATUS` 为 W1C，`IRQ_ENABLE` 为逐位使能：

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

| 位 | 事件 |
|---:|---|
| 0 | RX 帧成功进入 FIFO |
| 1 | TX 帧发送成功 |
| 2 | RX FIFO 上穿阈值 |
| 3 | TX FIFO 下穿阈值 |
| 4 | TX 发送失败且不再重试 |
| 5 | 仲裁丢失 |
| 6 | 任一协议错误 |
| 7 | 进入 Error Warning |
| 8 | 进入 Error Passive |
| 9 | 进入 Bus-off |
| 10 | Bus-off 恢复完成 |
| 11 | RX FIFO 溢出 |
| 12 | TX FIFO 溢出 |
| 13 | RX 空弹出 |
| 14 | 非法配置或非法命令 |
| 15 | 活动发送帧已安全终止 |

`interrupt` 是控制器到 CPU 中断控制器的输出，等价于 Xilinx AXI CAN 的 `intr`，不是 CAN 收发器引脚。物理 CAN 接口仍只有 `can_tx` 和 `can_rx`。

### 7.9 错误计数与明细

`ERROR_COUNTER[8:0]` 为 9 位 TEC，`[23:16]` 为 8 位 REC。TEC 需要第 9 位表示超过 255 的 Bus-off 条件。

`ERROR_STATUS` 定义如下：

| 位 | 名称 | 说明 |
|---:|---|---|
| 0 | `STUFF_ERROR` | 粘滞，W1C |
| 1 | `FORM_ERROR` | 粘滞，W1C |
| 2 | `CRC_ERROR` | 粘滞，W1C |
| 3 | `ACK_ERROR` | 粘滞，W1C |
| 4 | `BIT_ERROR` | 粘滞，W1C |
| 5 | `ARBITRATION_LOST` | 粘滞，W1C |
| 6 | `RX_OVERFLOW` | 粘滞，W1C |
| 7 | `TX_OVERFLOW` | 粘滞，W1C |
| 8 | `RX_UNDERFLOW` | 粘滞，W1C |
| 9 | `CONFIG_ERROR` | 粘滞，W1C |
| `[13:10]` | `LAST_ERROR_TYPE` | 0 无、1 Stuff、2 Form、3 CRC、4 ACK、5 Bit |
| `[17:14]` | `LAST_ERROR_FIELD` | 0 无、1 SOF、2 仲裁、3 控制、4 数据、5 CRC、6 ACK、7 EOF、8 Error Delimiter、9 Intermission |
| `[23:18]` | `ARB_LOST_POS` | 从仲裁字段第一个 ID 位开始计数的零基位位置 |

`ERROR_STATUS[31:24]` 保留并读回 0。写入只清除 `[9:0]` 中为 1 的粘滞位，不改变只读诊断字段。下一次对应事件更新最近错误或仲裁位置，软复位将这些字段清零。

## 8. CAN 协议行为

### 8.1 发送与位填充

核心从 SOF 到 CRC 序列实时产生原始帧位并计算 CRC-15。SOF 至 CRC 序列范围内，连续发送 5 个相同电平后插入一个反相填充位；填充位不进入 CRC。CRC delimiter 之后停止位填充。

标准帧发送 11 位 ID、RTR、IDE、保留位和 DLC。扩展帧发送 11 位基本 ID、SRR、IDE、18 位扩展 ID、RTR、保留位和 DLC。远程帧不包含数据字段。

### 8.2 仲裁

仲裁字段内发送隐性位但采样到显性位时判定仲裁丢失。节点立即停止驱动活动帧，切换为接收获胜帧，不产生错误标志。活动帧进入重试等待；标准帧与相同基本 ID 的扩展帧竞争时，标准帧在 SRR/IDE 位置获胜。

仲裁字段之外，除 ACK slot、Passive Error Flag 等规范例外外，发送位与采样位不一致产生 Bit Error。

### 8.3 接收、CRC 与 ACK

接收端从 SOF 开始解析并解填充。Stuff、CRC delimiter、ACK delimiter、EOF 和字段固定值均需校验。CRC 比较通过且格式正确时，普通活动节点在 ACK slot 驱动显性位。发送节点在 ACK slot 采样不到显性位时产生 ACK Error。

节点不会把自己在普通模式下成功发送的帧提交到 RX FIFO；仲裁失败后接收到的获胜帧可正常提交。验收过滤和 FIFO 容量不影响 ACK 决策。

### 8.4 错误标志与错误限制

检测到 Stuff、Form、CRC、ACK 或 Bit Error 后：

- Error Active 节点发送 6 个显性位的 Active Error Flag；
- Error Passive 节点发送 6 个隐性位的 Passive Error Flag；
- 随后处理 8 个隐性位的 Error Delimiter 和 3 个隐性位的 Intermission；
- Error Passive 发送节点在重发前额外等待 8 个隐性位的 Suspend Transmission。

本节点的 Active Error Flag 固定驱动 6 个显性位。由于多个节点的错误标志可能叠加，Error Delimiter 必须观察到连续 8 个隐性位才算完成；期间出现显性位会重新开始 delimiter 计数。

TEC/REC 按 Classic CAN 错误限制规则增减。TEC 或 REC 达到 96 进入 Error Warning；任一计数达到 128 进入 Error Passive；TEC 超过 255 进入 Bus-off。成功发送和成功接收按规范降低相应计数。

Bus-off 时 `can_tx` 保持隐性。控制器统计 128 次“连续观察到 11 个隐性位”的事件；任一显性位会清零当前 11 位组计数，但不会清除已经完成的组数。完成 128 组后 TEC/REC 清零，回到 Error Active，并置位恢复中断。

### 8.5 总线空闲与停止

正常帧后至少观察 3 个隐性 Intermission 位才允许开始下一帧。核心停止请求不会在帧或错误标志中途任意释放总线，而是在当前协议动作结束后进入停止状态。

### 8.6 Loopback

内部 Loopback 不驱动外部 `can_tx`，而把发送位反馈给内部接收和位监控路径。核心在内部模拟 ACK，成功帧仍经过 CRC、解析和验收过滤后进入 RX FIFO。Loopback 用于软件和 RTL 自检，不验证外部收发器。

### 8.7 Listen-only

Listen-only 始终让 `can_tx` 保持隐性，不发送 ACK、错误标志或数据帧。它可以解析、过滤和接收正确帧，也可记录协议错误状态，但不修改 TEC/REC。TX FIFO 可预装，退出只听模式并重新运行后再发送。

## 9. 非法操作处理

以下操作不会卡住 APB，也不会破坏当前有效配置，而是置位 `IRQ_STATUS.CONFIG_ERROR` 和对应错误明细：

- 运行期间修改位时序、模式或过滤配置；
- 同时使能 Loopback 和 Listen-only；
- 无效位时序配置；
- DLC 大于 8；
- 标准帧的 ID 高 18 位非 0；
- 没有活动帧时请求 `TX_ABORT`。

TX FIFO 满时 `TX_PUSH` 置 TX 溢出；RX FIFO 空时 `RX_POP` 置 RX 下溢。收到正确帧但 RX FIFO 满时仍 ACK，随后丢弃并置 RX 溢出。

## 10. 验证设计

项目只保留一个 CAN 外设集成测试 `rtl/sim/apb_can_tb.v`，替换旧的 `rtl/sim/tb_apb_can.v`。测试使用两个 `apb_can` 实例连接到显性优先的共享总线，并提供测试台故障驱动。测试台包含全局超时，所有 APB 任务也包含等待超时。

覆盖项：

1. 复位默认值、注册式 APB 读写、未定义地址和非法命令不阻塞。
2. TX/RX FIFO 顺序、数量、满空、阈值、清空、溢出和下溢。
3. 标准/扩展数据帧和远程帧，覆盖 DLC 0 与 8。
4. 两节点真实 ACK，以及过滤丢弃和 RX 满时仍 ACK。
5. 不同 ID、相同基本 ID 标准/扩展帧的仲裁与自动重发顺序。
6. 产生多个填充位的数据模式和 CRC-15 检查。
7. Stuff、Form、CRC、ACK 和 Bit Error，以及 Active/Passive Error Flag。
8. TEC/REC 的 Warning、Error Passive、Bus-off 和恢复转换。
9. Bus-off 恢复只在 128 组 11 个连续隐性位后完成。
10. Loopback、Listen-only、关闭自动重发和安全终止。
11. 中断屏蔽、W1C、阈值越界和错误明细。
12. 采样点以及早、晚边沿的 SJW 重同步。

使用 OSS CAD Suite 环境中的 Icarus Verilog，以 Verilog-2005 模式编译并运行。通过标准是编译和运行进程退出码为 0、测试台失败计数为 0、输出统一 PASS，并且没有触发超时。本阶段不运行 Yosys 综合。

## 11. 文档交付

重写 `rtl/can/apb_can_manual.md`，使用中文并参考 `rtl/uart/apb_uart_manual.md` 的章节结构：

1. 模块概述；
2. 参数与接口；
3. APB 访问行为；
4. 寄存器总表；
5. 逐寄存器说明；
6. 编程指导；
7. 使用限制与检查清单。

编程指导至少包含 500 kbit/s 位时序示例、轮询发送、批量接收、验收过滤、中断处理和 Bus-off 恢复观察流程。
