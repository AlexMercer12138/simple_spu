# APB SDIO 主机控制器中文编程手册

## 1. 模块概述

`apb_sdio` 是单时钟域、可综合的 APB4 SD/MMC/SDIO 主机控制器。软件提交一笔命令配置后，硬件依次完成命令、可选响应、可选数据和可选自动 CMD12。它支持 TF Card（microSD）、eMMC 和基础 SDIO I/O 卡的主机侧编程。

支持范围：1/4/8-bit SDR、48-bit 和 136-bit 响应、R1b DAT0 busy、单块/多块、PIO FIFO、外部同步 FIFO DMA、CMD5/CMD52/CMD53、空闲数据期 DAT1 SDIO 中断。数据 CRC 为每根有效 DAT 线独立 CRC16，命令和响应使用 CRC7。

首版不支持 DDR、UHS、HS200、HS400、1.8 V 切换、采样调谐、eMMC boot、RPMB、硬件命令队列、描述符链、内部/总线主控 DMA、SDIO Read Wait、活动数据期命令插入或自动初始化。所有速率均为 SDR-only。

## 2. 参数与接口

### 2.1 参数、时钟和复位

| 参数 | 默认值 | 集成约束 | 含义 |
| --- | ---: | --- | --- |
| `FIFO_DEPTH` | `128` | 建议为 `8..512` 的 2 的幂 | PIO TX/RX FIFO 深度，单位是最多装 4 byte 的字条目 |

`FIFO_DEPTH` 的上述范围/2 的幂是 IP 集成约束，当前 RTL 未对非法参数产生运行期报错。整个 IP 仅使用 `s_apb_pclk`：APB、寄存器、协议引擎、内部 FIFO 和 DMA FIFO 接口均在此域，没有 CDC。`s_apb_presetn` 是同步、低有效复位。

`CLK_CFG.HALF_PERIOD` 为 SD 时钟半周期减一，公式为：

```text
SDCLK = PCLK / (2 * (HALF_PERIOD + 1))
```

引擎在 `sd_clk_o` 下降沿推进输出，在上升沿采样输入。`sd_clk_o` 在不供钟或暂停时保持低；分频配置在空闲且时钟低电平时采样，事务配置则在接受 `START` 时快照。

### 2.2 顶层端口

| 端口 | 方向/宽度 | 含义 |
| --- | --- | --- |
| `s_apb_pclk` | input, 1 | 唯一 PCLK 时钟 |
| `s_apb_presetn` | input, 1 | 同步低有效复位 |
| `s_apb_psel` | input, 1 | APB 选中 |
| `s_apb_penable` | input, 1 | APB access 阶段 |
| `s_apb_pwrite` | input, 1 | `1` 写、`0` 读 |
| `s_apb_paddr` | input, 32 | APB 字节地址，使用 `[11:2]` 译码 |
| `s_apb_pwdata` | input, 32 | APB 写数据 |
| `s_apb_pstrb` | input, 4 | APB4 字节选通 |
| `s_apb_pready` | output, 1 | APB 完成；非空 PIO `RX_DATA` 读会延后一拍 |
| `s_apb_pslverr` | output, 1 | 恒为 `0` |
| `s_apb_prdata` | output, 32 | APB 读数据 |
| `interrupt` | output, 1 | `|(IRQ_STATUS & IRQ_ENABLE)` |
| `sd_clk_o` | output, 1 | SD/MMC 时钟输出 |
| `sd_cmd_i` | input, 1 | CMD 引脚采样值 |
| `sd_cmd_o` | output, 1 | CMD 驱动值 |
| `sd_cmd_t` | output, 1 | CMD 三态；`1` 高阻、`0` 驱动 |
| `sd_dat_i` | input, 8 | DAT[7:0] 采样值 |
| `sd_dat_o` | output, 8 | DAT[7:0] 驱动值 |
| `sd_dat_t` | output, 8 | DAT[7:0] 三态；每位 `1` 高阻、`0` 驱动 |
| `card_detect_n` | input, 1 | 低有效可插拔卡检测，内部两级同步 |
| `write_protect` | input, 1 | 写保护输入，内部两级同步 |
| `emmc_reset_n` | output, 1 | eMMC reset_n 直接由 `HOST_CFG` 控制 |
| `dma_tx_rd_en` | output, 1 | DMA TX 同步 FIFO 读使能 |
| `dma_tx_dout` | input, 32 | DMA TX FIFO 同步读数据 |
| `dma_tx_empty` | input, 1 | DMA TX FIFO 空 |
| `dma_rx_wr_en` | output, 1 | DMA RX FIFO 写使能 |
| `dma_rx_din` | output, 32 | DMA RX FIFO 写数据 |
| `dma_rx_full` | input, 1 | DMA RX FIFO 满 |

CMD/DAT 的 `i/o/t` 应在顶层连接 FPGA I/O buffer。开漏 CMD 模式下逻辑高以高阻释放，需要板级上拉。TF 通常仅连接 DAT[3:0]；eMMC 可连接 DAT[7:0]。

## 3. APB访问行为

寄存器为 32-bit 对齐，地址使用 `s_apb_paddr[11:2]`。未定义地址读 `0`、写无副作用；`s_apb_pslverr=0`。除非读取非空 PIO `RX_DATA`，访问没有等待周期；非空 `RX_DATA` 在 setup 期发起同步 FIFO 出队，随后 access 期精确插入一个 APB wait，完成时返回该字。空 `RX_DATA` 立即读 `0`、不出队，并置 `RX_UNDERFLOW`。

普通 R/W 寄存器使用逐字节合并写入：`PSTRB[n]` 控制 `PWDATA[8*n +: 8]`。W1P、W1C 也必须同时有目标 bit 为 1 和该 bit 所在字节选通。`PSTRB=4'b0000` 的写访问正常完成，但不会修改寄存器、产生命令、清中断或写 FIFO。

`TX_DATA` 是特殊写口：所有被选中的 lane 按 lane 0、1、2、3 顺序压缩成连续字节流，而不是保留字节空洞。例如 `PWDATA=32'hccbb_aa99,PSTRB=4'b0101` 入队顺序为 `99,bb`。TX FIFO 满时该次有效写被丢弃并置 `TX_OVERFLOW`。`RX_DATA` 读出的字按小端排列，最低有效字节最先到达。

`CTRL` 同次写的 W1P 优先级为 `SOFT_RESET > ABORT > TX_CLEAR/RX_CLEAR > START`；清 FIFO 同优先级可同时执行。软复位使寄存器、FIFO、状态机和 IRQ 清零，时钟低、CMD/DAT 高阻、`emmc_reset_n=0`。

## 4. 寄存器总表

保留位均读 `0`、写忽略。下表偏移相对外设基地址；`R/pop` 表示读取后在完成的 access 期出队。

| 偏移 | 寄存器 | 访问 | 复位值 |
| ---: | --- | --- | ---: |
| `0x00` | `CTRL` | R/W, W1P | `0x0000_0000` |
| `0x04` | `STATUS` | R | 动态 |
| `0x08` | `CLK_CFG` | R/W | `0x0000_0000` |
| `0x0c` | `HOST_CFG` | R/W | `0x0000_0000` |
| `0x10` | `CMD_CFG` | R/W | `0x0000_0000` |
| `0x14` | `CMD_ARG` | R/W | `0x0000_0000` |
| `0x18` | `RESP0` | R | `0x0000_0000` |
| `0x1c` | `RESP1` | R | `0x0000_0000` |
| `0x20` | `RESP2` | R | `0x0000_0000` |
| `0x24` | `RESP3` | R | `0x0000_0000` |
| `0x28` | `DATA_CFG` | R/W | `0x0000_0000` |
| `0x2c` | `CMD_TIMEOUT` | R/W | `0x0000_0000` |
| `0x30` | `DATA_TIMEOUT` | R/W | `0x0000_0000` |
| `0x34` | `BUSY_TIMEOUT` | R/W | `0x0000_0000` |
| `0x38` | `TX_DATA` | W | 不适用 |
| `0x3c` | `RX_DATA` | R/pop | 不适用 |
| `0x40` | `FIFO_STATUS` | R | 动态 |
| `0x44` | `FIFO_THRESHOLD` | R/W | `0x0004_0000` |
| `0x48` | `IRQ_STATUS` | R/W1C | `0x0000_0000` |
| `0x4c` | `IRQ_ENABLE` | R/W | `0x0000_0000` |
| `0x50` | `ERROR_STATUS` | R | `0x0000_0000` |
| `0x54` | `TRANSFER_COUNT` | R | `0x0000_0000` |
| `0x58` | `CARD_STATUS` | R | 动态 |
| `0x5c` | `AUTO_CMD12_RESP` | R | `0x0000_0000` |

## 5. 寄存器说明

### 5.1 `CTRL` (`0x00`)

| 位 | 名称 | 访问 | 说明 |
| ---: | --- | --- | --- |
| 0 | `ENABLE` | R/W | `1` 允许启动和空闲连续供钟；忙时写成 `0` 请求中止 |
| 1 | `START` | W1P | 校验并启动，读回 `0` |
| 2 | `ABORT` | W1P | 忙时请求受控中止，读回 `0` |
| 3 | `TX_CLEAR` | W1P | 仅空闲时清 PIO TX FIFO，读回 `0` |
| 4 | `RX_CLEAR` | W1P | 仅空闲时清 PIO RX FIFO，读回 `0` |
| [30:5] | 保留 | - | 读 `0` |
| 31 | `SOFT_RESET` | W1P | 复位整个 IP，读回 `0` |

`START` 被接受的全部条件：写后的 `ENABLE=1`、`CLK_CFG.CLOCK_ENABLE=1`、非忙、有效卡存在（或 `NON_REMOVABLE=1`）、`RESP_TYPE!=3`、`RESP_BUSY` 仅配 48-bit 响应、若 `DATA_PRESENT=1` 则 `BUS_WIDTH!=3` 且 `BLOCK_COUNT!=0`、若 `AUTO_CMD12=1` 则数据存在且块数大于 1。拒绝启动只置 `CONFIG_ERROR`，不产生完成事件。空闲 ABORT、忙时清 FIFO、以及任何不满足条件的 START 都是配置错误。

### 5.2 `STATUS` (`0x04`)

| 位 | 名称 | 说明 |
| ---: | --- | --- |
| 0 | `BUSY` | 事务不在 IDLE |
| [4:1] | `ACTIVE_PHASE` | `0=IDLE,1=CMD_TX,2=RESP_WAIT,3=RESP_RX,4=DATA_WAIT,5=DATA_RX,6=DATA_TX,7=WRITE_RESP,8=BUSY_WAIT,9=AUTO_CMD12,10=ABORT` |
| 5 | `CMD_ACTIVE` | 命令引擎活动 |
| 6 | `DATA_ACTIVE` | 数据引擎活动 |
| 7 | `CLOCK_RUNNING` | SDCLK 正在请求翻转 |
| 8 | `DMA_ACTIVE` | 当前快照为 DMA 路径 |
| 9 | `TX_STALLED` | 数据边界等待 TX 字节 |
| 10 | `RX_STALLED` | 数据边界等待 RX 空间 |
| 11 | `CARD_BUSY` | 等待 DAT0 释放 |
| 12 | `CARD_PRESENT` | 有效卡存在 |
| 13 | `WRITE_PROTECT` | 两级同步后的写保护 |
| 14 | `SDIO_IRQ_ACTIVE` | 已使能且数据引擎空闲时 DAT1 为低 |
| [31:15] | 保留 | 读 `0` |

### 5.3 `CLK_CFG` (`0x08`) 和 `HOST_CFG` (`0x0c`)

| 寄存器/位 | 名称 | 说明 |
| --- | --- | --- |
| `CLK_CFG[15:0]` | `HALF_PERIOD` | SDCLK 半周期减一 |
| `CLK_CFG[16]` | `CLOCK_ENABLE` | 允许输出 SDCLK |
| `CLK_CFG[17]` | `CLOCK_CONTINUOUS` | 空闲时也持续供钟 |
| `CLK_CFG[31:18]` | 保留 | 读 `0` |
| `HOST_CFG[1:0]` | `BUS_WIDTH` | `0=1-bit,1=4-bit,2=8-bit,3=非法` |
| `HOST_CFG[2]` | `CMD_OPEN_DRAIN` | CMD 高电平高阻、低电平驱动 |
| `HOST_CFG[3]` | `NON_REMOVABLE` | 忽略 `card_detect_n` 并视作存在 |
| `HOST_CFG[4]` | `EMMC_RESET_N` | `emmc_reset_n` 输出 |
| `HOST_CFG[5]` | `SDIO_IRQ_ENABLE` | 空闲数据期监视 DAT1 低 |
| `HOST_CFG[31:6]` | 保留 | 读 `0` |

### 5.4 `CMD_CFG` (`0x10`)、`CMD_ARG` (`0x14`) 与响应寄存器

| 位 | `CMD_CFG` 名称 | 说明 |
| ---: | --- | --- |
| [5:0] | `CMD_INDEX` | 命令号 `0..63` |
| [7:6] | `RESP_TYPE` | `0=无,1=48-bit,2=136-bit,3=非法` |
| 8 | `RESP_CRC_CHECK` | 检查响应 CRC7；R3/R4 等应由软件清零 |
| 9 | `RESP_INDEX_CHECK` | 仅 48-bit 响应比对索引 |
| 10 | `RESP_BUSY` | 响应后等待 DAT0 busy 释放，只允许 48-bit |
| 11 | `DATA_PRESENT` | 命令后启动数据阶段 |
| 12 | `DATA_WRITE` | `1` 主机写卡，`0` 卡读主机 |
| 13 | `DMA_ENABLE` | 使用外部 DMA FIFO |
| 14 | `AUTO_CMD12` | 多块数据完成后发送 CMD12 |
| [31:15] | 保留 | 读 `0` |

`CMD_ARG[31:0]` 是完整命令参数。48-bit 响应时 `RESP0=response[39:8]`；`RESP1[5:0]=response[45:40]`、`RESP1[12:6]=response CRC7`、`RESP1[13]=end bit`、`RESP1[31:14]=0`，`RESP2/RESP3=0`。136-bit 响应时 `{RESP3,RESP2,RESP1,RESP0}=接收帧[127:0]`，即除最先接收的 8 bit 外的原始 128 bit；不提供 R2 索引。无响应不会更新响应寄存器。

### 5.5 `DATA_CFG`、超时与数据口

| 寄存器/位 | 名称 | 说明 |
| --- | --- | --- |
| `DATA_CFG[10:0]` | `BLOCK_SIZE_MINUS1` | 块大小减一，实际 `1..2048` byte |
| `DATA_CFG[15:11]` | 保留 | 读 `0` |
| `DATA_CFG[31:16]` | `BLOCK_COUNT` | 数据块数，数据事务必须 `1..65535` |
| `CMD_TIMEOUT[31:0]` | - | 命令响应等待超时，PCLK 周期；`0` 禁用 |
| `DATA_TIMEOUT[31:0]` | - | 数据起始/写响应等待超时，PCLK 周期；`0` 禁用 |
| `BUSY_TIMEOUT[31:0]` | - | R1b/写后 DAT0 busy 超时，PCLK 周期；`0` 禁用 |
| `TX_DATA[31:0]` | - | PIO TX 特殊写口，PSTRB 压缩入队 |
| `RX_DATA[31:0]` | - | PIO RX 特殊读/出队口，尾字高字节补零 |

超时计数以 PCLK 为单位。TX 空、RX 满或 RX 尚未被软件接走造成的完整字节边界停钟时，数据阶段的相应等待不推进数据超时；命令响应、写响应和 busy 等非暂停等待仍按 PCLK 计数。

### 5.6 FIFO、IRQ、错误、计数和卡状态

| 寄存器/位 | 名称 | 说明 |
| --- | --- | --- |
| `FIFO_STATUS[11:0]` | `TX_BYTE_LEVEL` | PIO TX 有效字节数 |
| `FIFO_STATUS[23:12]` | `RX_BYTE_LEVEL` | 已提交、可读的 PIO RX 字节数 |
| 24/25 | `TX_EMPTY/TX_FULL` | PIO TX 条目空/满 |
| 26/27 | `RX_EMPTY/RX_FULL` | PIO RX 条目空/满 |
| 28/29 | `TX_STALLED/RX_STALLED` | 当前引擎数据暂停状态 |
| 30/31 | `DMA_TX_EMPTY/DMA_RX_FULL` | 外部 DMA FIFO 原样状态 |
| `FIFO_THRESHOLD[11:0]` | `TX_THRESHOLD` | `TX_BYTE_LEVEL <=` 此值时事件 |
| `FIFO_THRESHOLD[15:12]` | 保留 | 读 `0` |
| `FIFO_THRESHOLD[27:16]` | `RX_THRESHOLD` | `RX_BYTE_LEVEL >=` 此值时事件 |
| `FIFO_THRESHOLD[31:28]` | 保留 | 读 `0` |
| `TRANSFER_COUNT[15:0]` | `BLOCKS_DONE` | 已完成块数 |
| `TRANSFER_COUNT[27:16]` | `BYTES_DONE` | 当前块完成字节数 |
| `TRANSFER_COUNT[31:28]` | 保留 | 读 `0` |
| `CARD_STATUS[0]` | `CARD_PRESENT` | 有效卡存在 |
| `CARD_STATUS[1]` | `WRITE_PROTECT` | 同步写保护 |
| `CARD_STATUS[2]` | `CMD_LEVEL` | `sd_cmd_i` 实时电平 |
| `CARD_STATUS[10:3]` | `DAT_LEVEL` | `sd_dat_i[7:0]` 实时电平 |
| `CARD_STATUS[11]` | `SDIO_IRQ_ACTIVE` | 空闲 DAT1 低 |
| `CARD_STATUS[12]` | `EMMC_RESET_N` | 输出当前值 |
| `CARD_STATUS[31:13]` | 保留 | 读 `0` |
| `AUTO_CMD12_RESP[31:0]` | - | 自动 CMD12 的 `response[39:8]` |

`FIFO_THRESHOLD` 仅在 PIO 路径生效；复位值为 TX=`0`、RX=`4`。`FIFO_STATUS` 的 PIO level 不含 DMA 数据。全部未列出的字段均为保留位。

### 5.7 `IRQ_STATUS` (`0x48`) 与 `IRQ_ENABLE` (`0x4c`)

两寄存器位定义相同，`IRQ_STATUS` 为 W1C 粘滞位，`IRQ_ENABLE` 为普通 R/W mask；二者 `[31:12]` 保留为零。硬件置位和 W1C 同拍冲突时硬件置位优先（set-wins）。

| 位 | 名称 | 置位条件 |
| ---: | --- | --- |
| 0 | `CMD_DONE` | 主命令阶段完成 |
| 1 | `DATA_DONE` | 数据阶段完成 |
| 2 | `TRANSFER_DONE` | 已接受事务结束 |
| 3 | `ERROR` | 任一错误事件 |
| 4 | `ABORTED` | 软件禁用/ABORT/移卡导致中止 |
| 5 | `CARD_INSERTED` | 两级同步后检测到插入 |
| 6 | `CARD_REMOVED` | 两级同步后检测到移除 |
| 7 | `SDIO_INTERRUPT` | 空闲数据期 DAT1 低 |
| 8 | `TX_THRESHOLD` | PIO TX 低水位 |
| 9 | `RX_THRESHOLD` | PIO RX 高水位 |
| 10 | `TX_OVERFLOW` | 对满 PIO TX 写入 |
| 11 | `RX_UNDERFLOW` | 从空 PIO RX 读取 |

### 5.8 `ERROR_STATUS` (`0x50`)

该寄存器只读，不是 W1C。复位或接受下一笔 `START` 时清零；其后 13 个错误位对当前事务 OR 锁存，`ERROR_PHASE` 和 `ERROR_CMD_INDEX` 仅捕获第一批错误并保持到下次清零。若第一批错误来自 AUTO_CMD12，命令索引记录为 12。`[15:13]` 保留为零。

| 位 | 名称 | 来源 |
| ---: | --- | --- |
| 0 | `CMD_TIMEOUT` | 命令响应超时 |
| 1 | `CMD_CRC_ERROR` | 响应 CRC7 错 |
| 2 | `CMD_INDEX_ERROR` | 48-bit 响应索引错 |
| 3 | `CMD_END_BIT_ERROR` | 命令响应起始/传输/结束格式错 |
| 4 | `DATA_TIMEOUT` | 数据起始或写响应等待超时 |
| 5 | `DATA_CRC_ERROR` | 任一有效 DAT 线 CRC16 错 |
| 6 | `DATA_END_BIT_ERROR` | 数据结束位错 |
| 7 | `WRITE_RESPONSE_ERROR` | 写响应令牌不是接受码 `010` 或格式错 |
| 8 | `BUSY_TIMEOUT` | 命令 R1b 或写后 DAT0 busy 超时 |
| 9 | `AUTO_CMD12_ERROR` | 自动 CMD12 期间任意命令错误 |
| 10 | `CONFIG_ERROR` | 控制命令/START 配置被拒绝 |
| 11 | `CARD_REMOVED` | 活动事务中检测到移卡 |
| 12 | `ABORTED` | Host 外部中止事件 |
| [15:13] | 保留 | 读 `0` |
| [19:16] | `ERROR_PHASE` | 第一批错误发生时的 `ACTIVE_PHASE` |
| [25:20] | `ERROR_CMD_INDEX` | 第一批错误的活动命令号；AUTO_CMD12 为 12，空闲拒绝 START 使用拟启动命令，忙时拒绝使用活动命令 |
| [31:26] | 保留 | 读 `0` |

## 6. 命令、响应与数据时序

命令帧始终为 `start(0), transmission(1), CMD[5:0], ARG[31:0], CRC7, end(1)`。CMD 推挽时直接驱动，开漏模式只驱动低位。无响应命令在命令发送结束后完成；48/136-bit 响应在 CMD 上升沿接收，并校验 `start=0, transmission=0, end=1`。48-bit 才可索引检查；R2 的 CRC 校验仍可配置。R1b 以 `RESP_BUSY=1` 请求，在 48-bit 响应后继续供钟直到 DAT0 释放。

响应映射请使用 5.4 的 bit 精确定义。自动 CMD12 使用固定 `CMD12, ARG=0, 48-bit response, CRC/index check=1, busy=1`，其有效响应参数写入 `AUTO_CMD12_RESP`。

数据路径映射为：1-bit 使用 DAT0，按 byte[7] 至 byte[0] 串行；4-bit 每时钟组先传/收 byte[7:4] 到 DAT[3:0]，再传/收 byte[3:0]；8-bit 每时钟组 byte[7:0] 对应 DAT[7:0]。每条有效线均有独立 CRC16；读阶段检查起始、CRC 和结束，写阶段发送起始、数据、CRC、结束后接收 5-bit 写响应并等 DAT0 busy。多块按 `BLOCK_SIZE * BLOCK_COUNT` 结束；需要停止命令的多块事务可启用 AUTO_CMD12。

当 PIO/DMA TX 无字节或 RX 无空间时，时钟只在完整字节边界停止，CMD/DAT 保持稳定；恢复后从原字节边界继续，CRC 字段中不暂停。

## 7. PIO、DMA、中断与错误恢复

PIO TX FIFO 每条为 35 bit：`{valid_byte_count[2:0], data[31:0]}`，其中 count 为 1..4。PIO RX FIFO 每条为 34 bit：`{valid_byte_count_minus1[1:0], data[31:0]}`。RX 接收的 1、2、3 个尚未组成完整字的字节不会对软件可见，也不会计入 `RX_BYTE_LEVEL`；直到收满 4 byte 或整笔事务最后字节 (`rx_last`) 才提交。提交尾字低位对齐，高位零填充。清 FIFO 只允许空闲，且清除已提交条目及正在打包状态。

DMA 完全绕过 PIO FIFO 和 PIO level/threshold。TX 是同步 FIFO 读：`dma_tx_rd_en` 脉冲后下一拍采样 `dma_tx_dout`，字内以小端顺序输出 `[7:0]`、`[15:8]`、`[23:16]`、`[31:24]`；最后 word 的多余高字节按 `DATA_CFG` 总字节数忽略。RX 满 word 或尾 word 在 `dma_rx_wr_en=1` 同拍给出 `dma_rx_din`，同样小端，尾 word 无效高字节补零。DMA 模式下 `TX_DATA/RX_DATA` PIO 内容不被消费/填充，PIO 阈值也不置位。

错误恢复建议：读取并保存 `ERROR_STATUS`、读取/清除相应 `IRQ_STATUS`，必要时发 `ABORT` 或忙时清 `ENABLE`，等待 `TRANSFER_DONE/ABORTED` 后再清 PIO FIFO、重新配置并发起新 START。命令错误不会进入数据阶段；数据错误在 `AUTO_CMD12=1`、多块且卡仍存在时仍会尝试 CMD12。活动移卡立即停钟并释放 CMD/DAT；不可移动 eMMC 通过事务快照的 `NON_REMOVABLE` 屏蔽检测变化。`card_detect_n` 与 `write_protect` 均为两级同步。DAT1 仅在 `SDIO_IRQ_ENABLE=1` 且数据引擎不活动时监视，软件服务设备并使 DAT1 释放后再 W1C `SDIO_INTERRUPT`。

## 8. TF Card、eMMC、SDIO编程指导

下述为软件最小序列，实际量产驱动必须按卡规范解析 OCR/CID/CSD/EXT_CSD、处理轮询与重试，并正确设置低速初始化分频。

### 8.1 TF Card（SD）

1. 设 `NON_REMOVABLE=0`，确认 `CARD_PRESENT`；使能控制器、`CLOCK_ENABLE` 和连续低速时钟，初始使用 1-bit。
2. 发 CMD0（无响应），CMD8 参数通常 `0x000001aa`、48-bit R7；循环 CMD55 + ACMD41（R3，关闭 CRC 检查）直到 OCR ready。
3. 发 CMD2(R2)、CMD3(R6)、CMD7(R1b)，用 RCA 选卡；发 CMD55(R1) + ACMD6(ARG=2) 选择 4-bit，再将主机 `BUS_WIDTH=1`。
4. 依据 CSD/卡状态选择 CMD17/CMD24 单块或 CMD18/CMD25 多块。多块 CMD18/CMD25 通常开启 `AUTO_CMD12`；读写长度通过 `DATA_CFG` 配置为块大小和块数。

### 8.2 eMMC

1. 设 `NON_REMOVABLE=1`，按板级需要先拉低后释放 `EMMC_RESET_N`；使能低速连续时钟、1-bit，可按设备要求使用开漏 CMD 初始化。
2. 发 CMD0，循环 CMD1(ARG 常含工作电压窗口，R3，CRC 通常关闭) 至 OCR ready；发 CMD2(R2)、CMD3、CMD7(R1b) 进入 transfer state。
3. CMD8 读取 512-byte EXT_CSD；通过 CMD6 写 EXT_CSD 的 BUS_WIDTH/HS_TIMING，并在卡确认后同步更新主机到 4-bit 或 8-bit SDR 和目标分频。
4. 使用 CMD17/CMD24 或 CMD18/CMD25 传输。eMMC 若软件先用 CMD23 指定块数，可关闭 AUTO_CMD12；仍须确保 `DATA_CFG.BLOCK_COUNT` 为准确数值。

### 8.3 SDIO

1. 以 1-bit 初始化，发 CMD0，循环 CMD5(R4；关闭 CRC 检查) 至 ready，再发 CMD3、CMD7。
2. CMD52 参数是单字节 direct I/O：bit31 为写、[30:28] function number、bit27 RAW、[25:9] 17-bit register address、[7:0] data。用 CMD52 写 CCCR 总线接口控制寄存器以选择卡侧 4-bit 后，再更新主机 `BUS_WIDTH=1`。
3. CMD53 参数提示：bit31 写方向、[30:28] function、bit27 block mode、bit26 increment address、[25:9] 17-bit address、[8:0] count。字节模式 count `0` 表示 512 byte；块模式 count `0` 也代表 512 块，软件必须让 `DATA_CFG` 的块大小/块数与 CMD53 含义一致。使用固定地址时清 bit26。
4. 需要卡中断时置 `HOST_CFG.SDIO_IRQ_ENABLE`；仅在无活动数据阶段，DAT1 低才生成 `SDIO_INTERRUPT`。

## 9. 使用限制与检查清单

- 仅 SDR-only：不得把 DDR、UHS、HS200/HS400、1.8 V、tuning 或 boot/RPMB/queue 当作硬件功能。
- `FIFO_DEPTH` 使用 2 的幂，建议 `8..512`；根据最坏 ISR 延迟选择深度及 `FIFO_THRESHOLD`。
- 所有 command/data/clock/timeout 配置在 START 接受时快照；忙时写寄存器只影响下一笔。
- 每次 START 前确认 `ENABLE`、`CLOCK_ENABLE`、卡存在、合法响应类型/总线宽度、非零块数，以及 AUTO_CMD12 仅用于多块数据。
- PIO 写尾字必须用正确 PSTRB；PIO/DMA 读尾字的高字节为零，不应作为卡数据。
- DMA TX 外部 FIFO 必须满足一拍同步读语义；DMA RX 必须在 `dma_rx_wr_en` 同拍接受数据。
- 对 R3/R4 关闭 CRC7 检查；R1b 配置 `RESP_BUSY` 和足够 `BUSY_TIMEOUT`。
- 始终处理 12 个 IRQ：`CMD_DONE`、`DATA_DONE`、`TRANSFER_DONE`、`ERROR`、`ABORTED`、`CARD_INSERTED`、`CARD_REMOVED`、`SDIO_INTERRUPT`、`TX_THRESHOLD`、`RX_THRESHOLD`、`TX_OVERFLOW`、`RX_UNDERFLOW`。
- 读取 13 个错误位：`CMD_TIMEOUT`、`CMD_CRC_ERROR`、`CMD_INDEX_ERROR`、`CMD_END_BIT_ERROR`、`DATA_TIMEOUT`、`DATA_CRC_ERROR`、`DATA_END_BIT_ERROR`、`WRITE_RESPONSE_ERROR`、`BUSY_TIMEOUT`、`AUTO_CMD12_ERROR`、`CONFIG_ERROR`、`CARD_REMOVED`、`ABORTED`，并同时记录 phase/index。
- 复位、禁用、ABORT 和移卡后先等待终止状态再重配；不要在忙时清 PIO FIFO。
