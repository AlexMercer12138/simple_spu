# APB CAN 控制器手册

| 项目 | 描述 |
|------|------|
| 模块名 | `apb_can` |
| 总线协议 | APB (32-bit) |
| CAN 范围 | Classic CAN 2.0A/B |
| 版本 | v1.1 |

---

## 1. 模块概述

`apb_can` 是一个挂载在 APB 总线上的最小可用 CAN Classic 控制器，支持软件通过寄存器装载一帧 CAN 报文、发起发送、读取 RX FIFO 中的接收帧，并通过中断响应 RX/TX/ERROR/ARB/BUSOFF 事件。

- 支持标准帧 11-bit ID 与扩展帧 29-bit ID；
- 支持 DLC 0-8 与最多 8 字节 payload；
- 发送路径实现 SOF、仲裁场、控制场、数据场、CRC-15、CRC delimiter、ACK slot、ACK delimiter、EOF、IFS；
- 收发路径实现位填充/去填充，RX 校验 CRC/form/stuff；
- 支持 BRP、SJW、TSEG1、TSEG2 位时序配置；
- 支持内部 loopback 模式，外部数字 `can_tx/can_rx` 管脚始终保留；
- 支持软复位、RX 释放、TX request、中断清除和错误标志清除；
- 支持 TEC/REC 错误计数器、Error Active/Passive/Bus-Off 状态机；
- 支持仲裁丢失检测和自动重发；
- 支持 Bus-off 自动恢复（检测到 128 次连续隐性位后恢复）。

模块结构：

```text
       ┌─────────────────────────┐
APB ──>│  apb_can                │──> interrupt
       │                         │
       │      ┌───────────────┐  │
       │      │   can_top     │  │── can_tx
       │      │ (BT+TX+RX+   )│  │── can_rx
       │      │  TEC/REC/     )│  │
       │      │  Retry/BusOff) │  │
       │      └───────────────┘  │
       └─────────────────────────┘
```

---

## 2. 参数列表

| 参数 | 默认值 | 描述 |
|------|--------|------|
| `FIFO_DEPTH` | `4` | RX 帧 FIFO 深度，当前实现按 4 深度组织 |

---

## 3. 端口表

### 3.1 时钟与复位

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `s_apb_pclk` | I | 1 | APB 总线时钟，全部逻辑同步于此时钟 |
| `s_apb_presetn` | I | 1 | 低有效复位 |

### 3.2 APB 从设备接口

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `s_apb_psel` | I | 1 | 从机片选 |
| `s_apb_penable` | I | 1 | 总线使能 |
| `s_apb_pwrite` | I | 1 | 1=写访问，0=读访问 |
| `s_apb_paddr` | I | 32 | 字节地址，内部使用 `paddr[11:2]` 作为字索引 |
| `s_apb_pwdata` | I | 32 | 写数据 |
| `s_apb_pready` | O | 1 | 传输应答 |
| `s_apb_pslverr` | O | 1 | 错误指示，当前恒 0 |
| `s_apb_prdata` | O | 32 | 读数据 |

### 3.3 中断

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `interrupt` | O | 1 | 中断输出，高有效，电平保持到软件清除对应 pending |

### 3.4 CAN 数字接口

| 信号 | 方向 | 位宽 | 描述 |
|------|------|------|------|
| `can_rx` | I | 1 | CAN RX 数字输入，显性为 0，隐性为 1 |
| `can_tx` | O | 1 | CAN TX 数字输出，显性为 0，隐性为 1 |

---

## 4. 寄存器表

寄存器以 32-bit 对齐，地址 = `BASE + offset`。非法地址写访问被忽略，读访问返回 `0x0000_0000`，`PSLVERR` 保持 0。

| 偏移 | 字索引 | 名称 | 访问 | 复位值 | 描述 |
|------|--------|------|------|--------|------|
| `0x00` | 0 | `CTRL` | RW/W1P | `0x0000_0000` | 使能、模式、TX request、RX release、软复位 |
| `0x04` | 1 | `BITTIMING` | RW | `0x0111_0001` | BRP/SJW/TSEG1/TSEG2 |
| `0x08` | 2 | `TX_ID` | RW | `0x0000_0000` | 待发送 ID |
| `0x0C` | 3 | `TX_CTRL` | RW | `0x0000_0000` | 待发送帧 IDE/RTR/DLC |
| `0x10` | 4 | `TX_DATA0` | RW | `0x0000_0000` | 待发送 payload byte0-byte3 |
| `0x14` | 5 | `TX_DATA1` | RW | `0x0000_0000` | 待发送 payload byte4-byte7 |
| `0x18` | 6 | `RX_ID` | RO | `0x0000_0000` | RX FIFO 当前帧 ID |
| `0x1C` | 7 | `RX_CTRL` | RO | `0x0000_0000` | RX FIFO 当前帧 valid/IDE/RTR/DLC |
| `0x20` | 8 | `RX_DATA0` | RO | `0x0000_0000` | RX FIFO 当前帧 payload byte0-byte3 |
| `0x24` | 9 | `RX_DATA1` | RO | `0x0000_0000` | RX FIFO 当前帧 payload byte4-byte7 |
| `0x28` | 10 | `STATUS` | RO | 动态 | TX/RX/总线/错误状态 |
| `0x2C` | 11 | `INTERRUPT` | RW/W1C | `0x0000_0000` | 中断使能与 pending |
| `0x30` | 12 | `ERROR` | RW/W1C | `0x0000_0000` | 错误 sticky 标志 + TEC/REC/错误状态 |
| `0x34` | 13 | `ECR` | RO | `0x0000_0000` | 错误计数器 TEC/REC |

---

## 5. 寄存器位定义

### 5.1 CTRL -- 控制寄存器 (offset 0x00)

| 位 | 名称 | 类型 | 描述 |
|----|------|------|------|
| `[31]` | `SOFT_RST` | W1P | 写 1 对 `can_top` 执行软复位，硬件自动清零 |
| `[30:5]` | -- | -- | 保留 |
| `[4]` | `RX_RELEASE` | W1P | 写 1 释放 RX FIFO 当前帧 |
| `[3]` | `TX_REQ` | W1P | 写 1 请求发送当前 TX 寄存器中的完整帧；仅 `TX_READY=1` 且非 Bus-off 时接受 |
| `[2]` | `LOOPBACK` | RW | 1=内部 loopback，TX 输出回接 RX 采样路径 |
| `[1]` | `LISTEN_ONLY` | RW | 1=监听模式，`can_tx` 保持隐性，不发起 TX |
| `[0]` | `ENABLE` | RW | 1=使能 CAN core |

### 5.2 BITTIMING -- 位时序 (offset 0x04)

| 位 | 名称 | 描述 |
|----|------|------|
| `[9:0]` | `BRP` | APB 时钟分频。0 按 1 处理，TQ tick 周期约为 `(BRP) * pclk` |
| `[17:16]` | `SJW` | 同步跳转宽度。0 按 1 处理 |
| `[23:20]` | `TSEG1` | 传播段 + 相位段 1。0 按 1 处理 |
| `[27:24]` | `TSEG2` | 相位段 2。0 按 1 处理 |
| 其他 | -- | 保留 |

位时间约为 `1 + TSEG1 + TSEG2` 个 TQ；采样点位于 `1 + TSEG1`。

### 5.3 TX_ID -- 发送 ID (offset 0x08)

| 位 | 描述 |
|----|------|
| `[28:0]` | 当 `TX_CTRL.IDE=0` 时使用 `[10:0]`；当 `IDE=1` 时使用完整 29-bit ID |
| `[31:29]` | 保留，写入时清零 |

### 5.4 TX_CTRL -- 发送控制 (offset 0x0C)

| 位 | 名称 | 描述 |
|----|------|------|
| `[3:0]` | `DLC` | 数据长度，硬件限制到 0-8 |
| `[4]` | `IDE` | 0=标准帧，1=扩展帧 |
| `[5]` | `RTR` | 远程帧标志。第一版会发送 RTR 位，但 RX/测试主要覆盖数据帧 |
| 其他 | -- | 保留，写入时清零 |

### 5.5 TX_DATA0/TX_DATA1 -- 发送数据 (offset 0x10/0x14)

| 寄存器 | 位 | 描述 |
|--------|----|------|
| `TX_DATA0` | `[31:24]` | byte0 |
| `TX_DATA0` | `[23:16]` | byte1 |
| `TX_DATA0` | `[15:8]` | byte2 |
| `TX_DATA0` | `[7:0]` | byte3 |
| `TX_DATA1` | `[31:24]` | byte4 |
| `TX_DATA1` | `[23:16]` | byte5 |
| `TX_DATA1` | `[15:8]` | byte6 |
| `TX_DATA1` | `[7:0]` | byte7 |

### 5.6 RX_ID/RX_CTRL/RX_DATA0/RX_DATA1 -- 接收窗口

RX 寄存器始终显示 RX FIFO 当前帧。软件读完后通过 `CTRL.RX_RELEASE` 释放当前帧。

`RX_CTRL`：

| 位 | 名称 | 描述 |
|----|------|------|
| `[7]` | `RX_VALID` | 1=RX FIFO 当前帧有效 |
| `[6]` | `IDE` | 当前帧格式 |
| `[5]` | `RTR` | 当前帧 RTR 位 |
| `[3:0]` | `DLC` | 当前帧 DLC |

### 5.7 STATUS -- 状态寄存器 (offset 0x28)

| 位 | 名称 | 描述 |
|----|------|------|
| `[17]` | `BUS_OFF` | Bus-off 状态 |
| `[16]` | `ERROR_PASSIVE` | Error Passive 状态 |
| `[15]` | `ERROR_ACTIVE` | Error Active 状态 |
| `[14]` | -- | 保留 |
| `[13]` | `BUS_IDLE` | 总线连续隐性达到内部门限 |
| `[12:11]` | -- | 保留 |
| `[10:8]` | `RX_COUNT` | RX FIFO 帧数量 |
| `[7:5]` | -- | 保留 |
| `[4]` | `RX_VALID` | RX FIFO 非空 |
| `[3]` | -- | 保留 |
| `[2]` | `TX_DONE` | TX done 脉冲采样读数，主要用于仿真/调试；可靠完成事件请读 `INTERRUPT.TX_PENDING` |
| `[1]` | `TX_BUSY` | 发送忙 |
| `[0]` | `TX_READY` | core enable 且 TX 不忙且非 Bus-off |

### 5.8 INTERRUPT -- 中断寄存器 (offset 0x2C)

| 位 | 名称 | 类型 | 描述 |
|----|------|------|------|
| `[0]` | `RX_INT_EN` | RW | RX frame available 中断使能 |
| `[1]` | `TX_INT_EN` | RW | TX complete 中断使能 |
| `[2]` | `ERR_INT_EN` | RW | ERROR 中断使能 |
| `[3]` | `ARB_INT_EN` | RW | Arbitration lost 中断使能 |
| `[4]` | `BUSOFF_INT_EN` | RW | Bus-off 中断使能 |
| `[16]` | `RX_PENDING` | W1C | RX FIFO 从空到非空后置位；写 1 清除 |
| `[17]` | `TX_PENDING` | W1C | TX 完成后置位；写 1 清除 |
| `[18]` | `ERR_PENDING` | W1C | 任一错误事件后置位；写 1 清除 |
| `[19]` | `ARB_PENDING` | W1C | 仲裁丢失后置位；写 1 清除 |
| `[20]` | `BUSOFF_PENDING` | W1C | 进入 Bus-off 时置位；写 1 清除 |

`interrupt = (RX_INT_EN & RX_PENDING) | (TX_INT_EN & TX_PENDING) | (ERR_INT_EN & ERR_PENDING) | (ARB_INT_EN & ARB_PENDING) | (BUSOFF_INT_EN & BUSOFF_PENDING)`。

### 5.9 ERROR -- 错误寄存器 (offset 0x30)

| 位 | 名称 | 类型 | 描述 |
|----|------|------|------|
| `[5]` | `ARB_LOST` | W1C | 仲裁丢失 |
| `[4]` | `BIT_ERROR` | W1C | TX 非 loopback 模式下采样值与发送值不一致 |
| `[3]` | `ACK_ERROR` | W1C | TX 在 ACK slot 未检测到显性 ACK |
| `[2]` | `FORM_ERROR` | W1C | CRC delimiter/ACK delimiter/EOF/IFS form 错误 |
| `[1]` | `STUFF_ERROR` | W1C | RX 去填充检测到连续 6 个相同位 |
| `[0]` | `CRC_ERROR` | W1C | RX CRC 校验失败 |
| `[15:8]` | `REC` | RO | RX 错误计数器（来自 can_top） |
| `[23:16]` | `TEC` | RO | TX 错误计数器（来自 can_top） |
| `[29]` | `ERROR_ACTIVE` | RO | Error Active 状态 |
| `[30]` | `ERROR_PASSIVE` | RO | Error Passive 状态 |
| `[31]` | `BUS_OFF` | RO | Bus-off 状态 |

### 5.10 ECR -- 错误计数器寄存器 (offset 0x34)

| 位 | 名称 | 描述 |
|----|------|------|
| `[23:16]` | `TEC` | TX 错误计数器 |
| `[7:0]` | `REC` | RX 错误计数器 |

---

## 6. 编程指导

### 6.1 初始化

```text
1. 写 BITTIMING，配置 BRP/SJW/TSEG1/TSEG2。
2. 写 INTERRUPT[4:0]，选择需要的中断源。
3. 写 CTRL.ENABLE=1；调试可同时设置 CTRL.LOOPBACK=1。
```

### 6.2 发送标准数据帧

```text
等待 (STATUS.TX_READY == 1)
TX_ID    = id[10:0]
TX_CTRL  = {IDE=0, RTR=0, DLC}
TX_DATA0 = {byte0, byte1, byte2, byte3}
TX_DATA1 = {byte4, byte5, byte6, byte7}
CTRL     = ENABLE | LOOPBACK(可选) | TX_REQ
等待 INTERRUPT.TX_PENDING 或轮询 STATUS.TX_BUSY 清零
```

### 6.3 发送扩展数据帧

```text
TX_ID   = id[28:0]
TX_CTRL = {IDE=1, RTR=0, DLC}
CTRL    = ENABLE | LOOPBACK(可选) | TX_REQ
```

### 6.4 接收与释放

```text
等待 STATUS.RX_VALID 或 INTERRUPT.RX_PENDING
读取 RX_ID、RX_CTRL、RX_DATA0、RX_DATA1
CTRL = ENABLE | LOOPBACK(可选) | RX_RELEASE
```

### 6.5 中断清除

向 `INTERRUPT[20:16]` 写 1 清除对应 pending，同时可在同一次写中保持 `[4:0]` 使能位：

```text
INTERRUPT = 0x001f_001f  // 清全部 pending，并保持五类中断使能
```

### 6.6 软复位

写 `CTRL[31]=1` 会对 `can_top` 进行软复位，清空内部 TX/RX 状态机和 RX FIFO，TEC/REC 归零；APB 可见配置寄存器保留，`SOFT_RST` 硬件自动清零。

### 6.7 错误状态查询

```text
读 STATUS[17:15] 获取当前错误状态：
  ERROR_ACTIVE=1, ERROR_PASSIVE=0, BUS_OFF=0  -> Error Active
  ERROR_PASSIVE=1                              -> Error Passive
  BUS_OFF=1                                    -> Bus-off
```

### 6.8 错误计数器查询

```text
读 ECR 获取 TEC/REC：
  TEC = ECR[23:16]
  REC = ECR[7:0]
```

### 6.9 Bus-off 恢复

硬件自动恢复：进入 Bus-off 后，检测到 128 次连续隐性位（bus_idle + bit_tick），TEC 和 REC 清零，自动回到 Error Active 状态。软件也可通过软复位（CTRL.SOFT_RST=1）加速恢复。

### 6.10 仲裁丢失与自动重发

硬件自动重发：当发送帧在仲裁阶段丢失（被更高优先级帧抢占）或发生 ACK/bit 错误时，硬件自动置位 retry_pending，待总线空闲后重新发送同一帧。软件可通过 `INTERRUPT.ARB_PENDING` 跟踪仲裁丢失事件。

### 6.11 Bus-off 中断

进入 Bus-off 时触发 `INTERRUPT.BUSOFF_PENDING`。软件可通过使能 `BUSOFF_INT_EN` 来接收此中断。Bus-off 期间 `TX_READY=0`，不允许软件发起发送；`can_tx` 强制为隐性。

---

## 7. 限制

1. 仅支持 Classic CAN 2.0A/B，不支持 CAN FD。
2. ACK slot 在 loopback 模式下内部视为 ACK 成功；非 loopback 单节点测试若外部没有应答节点，会置位 `ACK_ERROR`。
3. 当前 RX FIFO 实现深度为 4，`FIFO_DEPTH` 参数应保持默认值 4。
4. 仅提供数字 `can_tx/can_rx`，不包含外部 CAN 收发器模型和 standby/silent 控制脚。
5. 本次实现为独立 APB 外设，未接入 SoC 顶层地址译码和中断汇聚。
6. Bus-off 恢复采用简化计数（每个 bus_idle+bit_tick 计数一次），非严格按 CAN 2.0 规范的 11 连续隐性位序列计数。

---

## 8. 实例化模板

```verilog
apb_can #(
    .FIFO_DEPTH     (4))
u_apb_can (
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

    .interrupt      (can_irq),

    .can_rx         (can_rx),
    .can_tx         (can_tx));
```

---

## 9. 相关文件

- [apb_can.v](file:///d:/Software/simple_cpu/rtl/can/apb_can.v) -- APB 寄存器与中断包装
- [can_top.v](file:///d:/Software/simple_cpu/rtl/can/can_top.v) -- CAN 核心顶层（含 TEC/REC/重发/Bus-off）
- [can_bit_timing.v](file:///d:/Software/simple_cpu/rtl/can/can_bit_timing.v) -- 位时序 tick 生成
- [can_tx.v](file:///d:/Software/simple_cpu/rtl/can/can_tx.v) -- CAN TX 路径
- [can_rx.v](file:///d:/Software/simple_cpu/rtl/can/can_rx.v) -- CAN RX 路径
- [can_crc.v](file:///d:/Software/simple_cpu/rtl/can/can_crc.v) -- CRC-15 模块
- [can_fifo.v](file:///d:/Software/simple_cpu/rtl/can/can_fifo.v) -- RX 帧 FIFO
- [tb_apb_can.v](file:///d:/Software/simple_cpu/rtl/sim/tb_apb_can.v) -- APB 集成仿真
