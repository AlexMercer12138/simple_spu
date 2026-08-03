# APB 双通道 Timer 中文编程手册

## 1. 模块概述

`apb_timer` 是一个 32 位 APB 双通道定时器外设。Timer 0 和 Timer 1 各自
包含一个 32 位向上计数器、周期终值寄存器、PWM 比较寄存器和 PWM 输出。

每个通道可选择以下计数源：

- 每个 `PCLK` 计数一次；
- 对另一个 Timer 的溢出脉冲计数，实现级联分频。

外设提供一个组合中断输出，用于报告两个通道的溢出和配置错误。硬件会拒绝
运行中修改通道配置，也会拒绝两个通道互相级联形成无时钟源的闭环。

## 2. 接口

| 端口 | 方向 | 说明 |
|---|---|---|
| `s_apb_pclk` | 输入 | APB 和两个 Timer 的共用时钟 |
| `s_apb_presetn` | 输入 | 同步低有效复位 |
| `s_apb_psel` | 输入 | APB 从机选择 |
| `s_apb_penable` | 输入 | APB 访问阶段指示 |
| `s_apb_pwrite` | 输入 | `1` 为写，`0` 为读 |
| `s_apb_paddr[31:0]` | 输入 | APB 字节地址 |
| `s_apb_pwdata[31:0]` | 输入 | APB 写数据 |
| `s_apb_pready` | 输出 | APB 传输完成应答 |
| `s_apb_pslverr` | 输出 | 恒为 `0` |
| `s_apb_prdata[31:0]` | 输出 | APB 读数据 |
| `interrupt` | 输出 | 已使能待处理状态的逻辑或 |
| `pwm0` | 输出 | Timer 0 PWM 输出 |
| `pwm1` | 输出 | Timer 1 PWM 输出 |

## 3. APB 访问行为

寄存器按 32 位对齐，使用 `s_apb_paddr[11:2]` 译码。被选中的传输包含一个
等待周期；读数据在 APB setup 阶段锁存，并保持到传输完成。

未定义地址读取返回零，未定义地址写入无效，`s_apb_pslverr` 恒为 `0`。

## 4. 寄存器总表

| 偏移 | 寄存器 | 访问 | 复位值 | 说明 |
|---:|---|---|---:|---|
| `0x00` | `CTRL` | R/W、W1P | `0x0000_0000` | 通道使能、计数清零和软复位 |
| `0x04` | `IRQ_STATUS` | R/W1C | `0x0000_0000` | 溢出和配置错误待处理状态 |
| `0x08` | `IRQ_ENABLE` | R/W | `0x0000_0000` | 中断使能 |
| `0x0C` | `T0_CONFIG` | R/W | `0x0000_0000` | Timer 0 计数源和 PWM 配置 |
| `0x10` | `T0_COUNT` | R | `0x0000_0000` | Timer 0 当前计数值 |
| `0x14` | `T0_MAX` | R/W | `0xFFFF_FFFF` | Timer 0 包含式终值 |
| `0x18` | `T0_PWM_COMPARE` | R/W | `0x0000_0000` | Timer 0 PWM 比较值 |
| `0x1C` | `T1_CONFIG` | R/W | `0x0000_0000` | Timer 1 计数源和 PWM 配置 |
| `0x20` | `T1_COUNT` | R | `0x0000_0000` | Timer 1 当前计数值 |
| `0x24` | `T1_MAX` | R/W | `0xFFFF_FFFF` | Timer 1 包含式终值 |
| `0x28` | `T1_PWM_COMPARE` | R/W | `0x0000_0000` | Timer 1 PWM 比较值 |

除另有说明外，保留位读取为零，写入无效。

## 5. 寄存器说明

### 5.1 CTRL，偏移 `0x00`

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `T0_EN` | R/W | Timer 0 使能 |
| `1` | `T1_EN` | R/W | Timer 1 使能 |
| `8` | `T0_CLEAR` | W1P | 写 `1` 把 Timer 0 计数值清零 |
| `9` | `T1_CLEAR` | W1P | 写 `1` 把 Timer 1 计数值清零 |
| `31` | `SOFT_RST` | W1P | 写 `1` 同步复位整个 Timer 外设 |

读取时只有 `[1:0]` 返回保存的通道使能，清零和软复位命令位均返回零。每次写
`CTRL` 都会用写数据 `[1:0]` 覆盖两个使能位，因此清零某个计数器时，应同时
写回希望保持运行的通道使能。

计数清零在通道使能或关闭时都有效，并且优先于同一拍的计数事件，但不会清除
`IRQ_STATUS`。`SOFT_RST` 优先级最高，会恢复全部寄存器、计数器、中断和 PWM
状态。

### 5.2 IRQ_STATUS 与 IRQ_ENABLE，偏移 `0x04`、`0x08`

两个寄存器使用相同的低 3 位布局：

| 位 | 名称 | 置位条件 |
|---:|---|---|
| `0` | `T0_OVERFLOW` | Timer 0 到达终值并回到零 |
| `1` | `T1_OVERFLOW` | Timer 1 到达终值并回到零 |
| `2` | `CONFIG_ERROR` | 运行中写受保护寄存器，或请求互相级联 |

`IRQ_STATUS` 为粘滞状态，硬件事件即使未使能也会记录。向某位写 `1` 清除该位，
写 `0` 保持不变。`IRQ_ENABLE` 决定相应状态是否驱动中断输出：

```text
interrupt = |(IRQ_STATUS & IRQ_ENABLE)
```

硬件事件与 W1C 同拍发生时，事件置位优先。例如 Timer 以 `MAX=0` 连续运行时，
每个有效计数事件都会溢出，单纯写 W1C 无法保持状态为零；软件应先关闭或清零
对应通道，再清除待处理位。

通道溢出首先在 `timer_channel` 内产生一个寄存脉冲，APB 包装层在下一拍把该
事件写入 `IRQ_STATUS`。因此软件看到待处理位相对计数器回零有一个固定的
`PCLK` 延迟。

### 5.3 T0_CONFIG 与 T1_CONFIG，偏移 `0x0C`、`0x1C`

两个配置寄存器的位定义相同：

| 位 | 名称 | 访问 | 说明 |
|---:|---|---|---|
| `0` | `COUNT_SOURCE` | R/W | `0`：每个 `PCLK` 计数；`1`：对另一 Timer 的溢出计数 |
| `[2:1]` | `PWM_MODE` | R/W | PWM 模式，见下表 |
| `3` | `PWM_POLARITY` | R/W | `0`：高有效；`1`：低有效 |

`PWM_MODE` 编码：

| 值 | 模式 | 使能时的逻辑活动状态 |
|---:|---|---|
| `00` | 关闭 | 始终无效 |
| `01` | 正常 PWM | `COUNT < PWM_COMPARE` 时有效 |
| `10` | 强制无效 | 始终无效 |
| `11` | 强制有效 | 始终有效 |

写入只保存低 4 位。

### 5.4 T0_COUNT 与 T1_COUNT，偏移 `0x10`、`0x20`

只读的 32 位当前计数值。通道关闭时保持当前值，除非软件发出对应 `CLEAR` 或
软复位。读取计数器没有副作用。

### 5.5 T0_MAX 与 T1_MAX，偏移 `0x14`、`0x24`

32 位包含式终值。每个有效计数事件执行：

```text
COUNT < MAX  -> COUNT = COUNT + 1
COUNT >= MAX -> COUNT = 0，同时产生一次 overflow
```

因此，直接使用 `PCLK` 的通道周期为：

```text
周期时钟数 = MAX + 1
溢出频率   = PCLK_FREQ / (MAX + 1)
```

`MAX=0` 表示每个有效计数事件都溢出，不表示停止。比较使用 `>=`，因此即使软件
在通道关闭时把 `MAX` 改到小于当前保持计数值，重新使能后的第一个有效计数事件
也会安全回零。

### 5.6 T0_PWM_COMPARE 与 T1_PWM_COMPARE，偏移 `0x18`、`0x28`

32 位 PWM 比较值。在正常 PWM 模式中，计数值满足 `COUNT < PWM_COMPARE`
时输出处于活动电平。

当 `0 <= PWM_COMPARE <= MAX+1` 时，理想占空比为：

```text
占空比 = PWM_COMPARE / (MAX + 1)
```

具体边界行为：

- `PWM_COMPARE=0`：0% 活动时间；
- `0 < PWM_COMPARE <= MAX`：每周期前 `PWM_COMPARE` 个计数值有效；
- `PWM_COMPARE>MAX`：100% 活动时间；
- 当 `MAX=0xFFFF_FFFF` 时无法用更大的 32 位比较值表示精确 100%，应使用
  强制有效模式。

`PWM_POLARITY=0` 时，活动电平为高；`PWM_POLARITY=1` 时，活动电平为低。
通道关闭时 PWM 始终输出物理无效电平，因此高有效配置输出 `0`，低有效配置
输出 `1`。

## 6. 配置写保护与级联

### 6.1 运行时写保护

每个通道的 `Tx_CONFIG`、`Tx_MAX` 和 `Tx_PWM_COMPARE` 只能在该通道关闭时
修改。通道运行期间的写入会被忽略，原值保持不变，并置位
`IRQ_STATUS.CONFIG_ERROR`。

`CTRL`、`IRQ_STATUS` 和 `IRQ_ENABLE` 不受该保护限制；软件可以在运行时使能、
关闭或清零计数器。

### 6.2 单向级联

当通道的 `COUNT_SOURCE=1` 时，它在另一个通道每次溢出后计数一次。硬件禁止
两个通道同时选择对方溢出作为计数源。如果另一个通道已经配置为级联，再尝试把
本通道也设为级联，写入会被拒绝并置位 `CONFIG_ERROR`。

切换级联方向时，应先在两个通道都关闭的情况下，把两个 `COUNT_SOURCE` 都清零，
再设置新的目标通道，避免旧配置导致新写入被拒绝。

级联源的溢出是寄存事件，目标通道在下一拍消费该事件。该固定相位延迟不改变
稳定状态下的总分频比。若源通道终值为 `SOURCE_MAX`，目标通道终值为
`DEST_MAX`，且源通道使用 `PCLK`，则：

```text
目标溢出周期 = (SOURCE_MAX + 1) * (DEST_MAX + 1) 个 PCLK
```

## 7. 编程指导

以下伪代码假定 `TIMER` 指向 Timer 寄存器基地址。

### 7.1 独立周期定时器

```c
TIMER->CTRL &= ~TIMER_CTRL_T0_EN;        /* 先关闭 Timer 0 */
TIMER->T0_CONFIG = TIMER_COUNT_PCLK;
TIMER->T0_MAX = period_pclk - 1u;
TIMER->T0_PWM_COMPARE = 0;
TIMER->IRQ_STATUS = TIMER_IRQ_T0_OVERFLOW;
TIMER->IRQ_ENABLE |= TIMER_IRQ_T0_OVERFLOW;
TIMER->CTRL = (TIMER->CTRL & 0x3u) |
              TIMER_CTRL_T0_EN | TIMER_CTRL_T0_CLEAR;
```

`period_pclk` 必须至少为 1。清零命令和使能可以在同一次 `CTRL` 写入中使用，
清零优先，计数从后续时钟开始。

### 7.2 定时器中断服务

```c
void timer_isr(void)
{
    uint32_t pending = TIMER->IRQ_STATUS & TIMER->IRQ_ENABLE;

    if (pending & TIMER_IRQ_T0_OVERFLOW)
        service_timer0();
    if (pending & TIMER_IRQ_T1_OVERFLOW)
        service_timer1();
    if (pending & TIMER_IRQ_CONFIG_ERROR)
        report_bad_timer_write();

    TIMER->IRQ_STATUS = pending;         /* W1C */
}
```

若中断处理时间接近或超过定时器周期，粘滞位只能表示“至少发生过一次”，不会累计
丢失的溢出次数。需要精确计数时，软件必须保证及时处理或使用更长周期。

### 7.3 级联定时器

```c
TIMER->CTRL = 0;                         /* 两个通道都关闭 */
TIMER->T0_CONFIG = TIMER_COUNT_PCLK;     /* 先明确源通道 */
TIMER->T1_CONFIG = TIMER_COUNT_CASCADE;  /* Timer 1 由 Timer 0 溢出驱动 */
TIMER->T0_MAX = source_divider - 1u;
TIMER->T1_MAX = destination_divider - 1u;
TIMER->IRQ_STATUS = TIMER_IRQ_T0_OVERFLOW |
                    TIMER_IRQ_T1_OVERFLOW |
                    TIMER_IRQ_CONFIG_ERROR;
TIMER->CTRL = TIMER_CTRL_T0_EN | TIMER_CTRL_T1_EN |
              TIMER_CTRL_T0_CLEAR | TIMER_CTRL_T1_CLEAR;
```

如果只关心最终低频事件，可仅使能目标通道的溢出中断，源通道待处理位仍会记录，
必要时定期 W1C 清除。

### 7.4 PWM 输出

```c
TIMER->CTRL &= ~TIMER_CTRL_T0_EN;
TIMER->T0_MAX = pwm_period_pclk - 1u;
TIMER->T0_PWM_COMPARE = pwm_high_pclk;
TIMER->T0_CONFIG = TIMER_COUNT_PCLK |
                   TIMER_PWM_NORMAL |
                   TIMER_PWM_ACTIVE_HIGH;
TIMER->CTRL = (TIMER->CTRL & 0x3u) |
              TIMER_CTRL_T0_EN | TIMER_CTRL_T0_CLEAR;
```

PWM 参数只能在通道关闭时更新。改变周期或占空比的推荐顺序是：关闭通道、写
`MAX` 和 `PWM_COMPARE`、写模式与极性、清零、重新使能。该实现不会在周期
边界自动缓存新参数，所以不支持运行中无毛刺更新。

### 7.5 配置错误恢复

```c
if (TIMER->IRQ_STATUS & TIMER_IRQ_CONFIG_ERROR) {
    TIMER->CTRL &= ~affected_channel_enable;
    /* 重新写入合法的 CONFIG/MAX/COMPARE */
    TIMER->IRQ_STATUS = TIMER_IRQ_CONFIG_ERROR;
}
```

配置错误只报告被拒绝的写入，不会自动关闭正在运行的通道，也不会修改原有配置。

## 8. 使用限制与检查清单

- `MAX` 是包含式终值，周期为 `MAX+1` 个有效计数事件；
- `MAX=0` 表示每拍溢出；
- 配置、终值和 PWM 比较值只能在对应通道关闭时写入；
- 两个通道不能互相级联，切换方向前应先清除旧级联配置；
- `CLEAR` 只清计数器，不清中断状态；
- 写 `CTRL` 时必须保留另一个通道所需的使能位；
- PWM 通道关闭时输出无效电平，低有效模式下该电平为高；
- 中断状态为粘滞位，不累计同类事件次数；
- W1C 与新事件同拍时事件置位优先；
- 无效地址不会产生 `PSLVERR`。
