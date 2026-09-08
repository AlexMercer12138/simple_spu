/**
 * @file    timer.c
 * @brief   APB 双通道 Timer 裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          timer_reg_read / timer_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_timer.v
 * 对应手册: apb_timer_manual.md
 */

#include "timer.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 内部辅助：通道参数 -> 寄存器偏移
 * ========================================================================= */

/** 返回通道对应的 CONFIG / COUNT / MAX / PWM_COMPARE 寄存器偏移 */
static uint32_t timer_channel_config_offset(timer_channel_t ch)
{
    return (ch == TIMER_CHANNEL_0) ? TIMER_REG_T0_CONFIG : TIMER_REG_T1_CONFIG;
}

static uint32_t timer_channel_count_offset(timer_channel_t ch)
{
    return (ch == TIMER_CHANNEL_0) ? TIMER_REG_T0_COUNT : TIMER_REG_T1_COUNT;
}

static uint32_t timer_channel_max_offset(timer_channel_t ch)
{
    return (ch == TIMER_CHANNEL_0) ? TIMER_REG_T0_MAX : TIMER_REG_T1_MAX;
}

static uint32_t timer_channel_pwm_offset(timer_channel_t ch)
{
    return (ch == TIMER_CHANNEL_0) ? TIMER_REG_T0_PWM_COMPARE : TIMER_REG_T1_PWM_COMPARE;
}

/** 返回通道对应的 CTRL 使能位 / 清零命令位 */
static uint32_t timer_channel_en_bit(timer_channel_t ch)
{
    return (ch == TIMER_CHANNEL_0) ? TIMER_CTRL_T0_EN : TIMER_CTRL_T1_EN;
}

static uint32_t timer_channel_clear_bit(timer_channel_t ch)
{
    return (ch == TIMER_CHANNEL_0) ? TIMER_CTRL_T0_CLEAR : TIMER_CTRL_T1_CLEAR;
}

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int timer_init(timer_handle_t *h, uintptr_t base_addr)
{
    /* 参数校验：句柄非空，地址 4 字节对齐（APB 32 位寄存器要求） */
    if (h == NULL || (base_addr & 0x3U) != 0U) {
        return -1;
    }

    h->base = (volatile uint32_t *)base_addr;
    return 0;
}

void timer_soft_reset(timer_handle_t *h)
{
    /*
     * 写 CTRL bit31=1 触发同步软复位。
     * SOFT_RST 需要 pstrb[3]（最高字节选通），32 位全字写满足要求。
     * 软复位优先级最高，会恢复全部寄存器、计数器、中断和 PWM 状态。
     */
    timer_reg_write(h->base, TIMER_REG_CTRL, TIMER_CTRL_SOFT_RST);
}

/* =========================================================================
 * 2. 通道使能与计数控制
 * ========================================================================= */

void timer_enable(timer_handle_t *h, timer_channel_t ch)
{
    uint32_t ctrl;

    /* 读改写：仅置位目标通道使能位，保留另一通道使能状态 */
    ctrl  = timer_reg_read(h->base, TIMER_REG_CTRL);
    ctrl |= timer_channel_en_bit(ch);
    timer_reg_write(h->base, TIMER_REG_CTRL, ctrl);
}

void timer_disable(timer_handle_t *h, timer_channel_t ch)
{
    uint32_t ctrl;

    ctrl  = timer_reg_read(h->base, TIMER_REG_CTRL);
    ctrl &= ~timer_channel_en_bit(ch);
    timer_reg_write(h->base, TIMER_REG_CTRL, ctrl);
}

uint32_t timer_get_enable(timer_handle_t *h)
{
    /* 读取时只有 [1:0] 返回保存的通道使能，清零和软复位命令位均返回零 */
    return timer_reg_read(h->base, TIMER_REG_CTRL) & TIMER_CTRL_EN_MASK;
}

void timer_clear_count(timer_handle_t *h, timer_channel_t ch)
{
    uint32_t ctrl;

    /*
     * 清零命令（W1P）在通道使能或关闭时均有效，优先于同一拍的计数事件，
     * 但不会清除 IRQ_STATUS。
     *
     * CTRL 的 byte0 每次写入都会用写数据 [1:0] 覆盖两个使能位，
     * 因此必须读改写保留使能位后再写清零命令。
     */
    ctrl  = timer_reg_read(h->base, TIMER_REG_CTRL) & TIMER_CTRL_EN_MASK;
    ctrl |= timer_channel_clear_bit(ch);
    timer_reg_write(h->base, TIMER_REG_CTRL, ctrl);
}

/* =========================================================================
 * 3. 通道配置
 * ========================================================================= */

void timer_config_channel(timer_handle_t *h, timer_channel_t ch,
                          timer_count_source_t source,
                          timer_pwm_mode_t pwm_mode,
                          timer_pwm_polarity_t polarity)
{
    uint32_t config;

    /*
     * CONFIG 仅低 4 位有效：bit0 计数源、[2:1] PWM 模式、bit3 极性。
     * 写入只保存低 4 位。
     *
     * 注意：Tx_CONFIG 只能在通道关闭时修改。运行期间的写入会被忽略，
     * 原值保持不变并置位 IRQ_STATUS.CONFIG_ERROR。
     */
    config  = (uint32_t)source & 0x1U;
    config |= ((uint32_t)pwm_mode & 0x3U) << 1;
    config |= ((uint32_t)polarity & 0x1U) << 3;

    timer_reg_write(h->base, timer_channel_config_offset(ch), config);
}

void timer_set_max(timer_handle_t *h, timer_channel_t ch, uint32_t max)
{
    /* 32 位包含式终值，只能在通道关闭时写入 */
    timer_reg_write(h->base, timer_channel_max_offset(ch), max);
}

uint32_t timer_get_count(timer_handle_t *h, timer_channel_t ch)
{
    /* 只读计数值，读取没有副作用 */
    return timer_reg_read(h->base, timer_channel_count_offset(ch));
}

void timer_set_pwm_compare(timer_handle_t *h, timer_channel_t ch, uint32_t compare)
{
    /* 32 位 PWM 比较值，只能在通道关闭时写入 */
    timer_reg_write(h->base, timer_channel_pwm_offset(ch), compare);
}

/* =========================================================================
 * 4. 中断管理
 * ========================================================================= */

uint32_t timer_irq_read_status(timer_handle_t *h)
{
    /* 粘滞原始状态位，不受 IRQ_ENABLE 影响 */
    return timer_reg_read(h->base, TIMER_REG_IRQ_STATUS) & TIMER_IRQ_ALL;
}

uint32_t timer_irq_get_pending(timer_handle_t *h)
{
    /* 对应 RTL: interrupt = |(IRQ_STATUS & IRQ_ENABLE) */
    uint32_t status = timer_reg_read(h->base, TIMER_REG_IRQ_STATUS);
    uint32_t enable = timer_reg_read(h->base, TIMER_REG_IRQ_ENABLE);
    return status & enable;
}

void timer_irq_enable(timer_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= TIMER_IRQ_ALL;

    enable_val  = timer_reg_read(h->base, TIMER_REG_IRQ_ENABLE);
    enable_val |= mask;
    timer_reg_write(h->base, TIMER_REG_IRQ_ENABLE, enable_val);
}

void timer_irq_disable(timer_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= TIMER_IRQ_ALL;

    enable_val  = timer_reg_read(h->base, TIMER_REG_IRQ_ENABLE);
    enable_val &= ~mask;
    timer_reg_write(h->base, TIMER_REG_IRQ_ENABLE, enable_val);
}

void timer_irq_write_enable(timer_handle_t *h, uint32_t value)
{
    timer_reg_write(h->base, TIMER_REG_IRQ_ENABLE, value & TIMER_IRQ_ALL);
}

void timer_irq_clear_status(timer_handle_t *h, uint32_t mask)
{
    /*
     * W1C：向某位写 1 清除该位，写 0 保持不变。
     * 硬件事件与 W1C 同拍发生时，事件置位优先。
     *
     * 若 Timer 以 MAX=0 连续运行，每个有效计数事件都会溢出，
     * 单纯写 W1C 无法保持状态为零；软件应先关闭或清零对应通道再清位。
     */
    timer_reg_write(h->base, TIMER_REG_IRQ_STATUS, mask & TIMER_IRQ_ALL);
}
