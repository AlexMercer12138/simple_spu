/**
 * @file    intc.c
 * @brief   APB 中断控制器裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          intc_reg_read / intc_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_intc.v
 * 对应手册: apb_intc_manual.md
 */

#include "intc.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 内部辅助：有效位掩码
 * ========================================================================= */

/** 返回 IRQ_COUNT 个有效位的掩码（1~32 位） */
static uint32_t intc_valid_mask(const intc_handle_t *h)
{
    if (h->irq_count >= 32U) {
        return 0xFFFFFFFFUL;
    }
    return (1UL << h->irq_count) - 1UL;
}

/* =========================================================================
 * 1. 初始化
 * ========================================================================= */

int intc_init(intc_handle_t *h, uintptr_t base_addr, uint32_t irq_count)
{
    /* 参数校验：句柄非空、地址 4 字节对齐、IRQ_COUNT 在 1~32 范围 */
    if (h == NULL || (base_addr & 0x3U) != 0U ||
        irq_count == 0U || irq_count > 32U) {
        return -1;
    }

    h->base      = (volatile uint32_t *)base_addr;
    h->irq_count = irq_count;

    return 0;
}

void intc_init_clear(intc_handle_t *h)
{
    uint32_t mask = intc_valid_mask(h);

    /* 初始化期间先关闭全部中断，再丢弃复位后累积的状态 */
    intc_reg_write(h->base, INTC_REG_ENABLE, 0U);
    intc_reg_write(h->base, INTC_REG_PENDING_CLEAR, mask);
}

/* =========================================================================
 * 2. 中断使能管理
 * ========================================================================= */

void intc_write_enable(intc_handle_t *h, uint32_t value)
{
    intc_reg_write(h->base, INTC_REG_ENABLE, value & intc_valid_mask(h));
}

uint32_t intc_read_enable(intc_handle_t *h)
{
    return intc_reg_read(h->base, INTC_REG_ENABLE) & intc_valid_mask(h);
}

void intc_enable_set(intc_handle_t *h, uint32_t mask)
{
    /*
     * W1S：写 1 置位对应使能位，写 0 保持不变。
     * 原子置位适合多个软件上下文分别管理不同中断源，
     * 可避免 ENABLE 读改写覆盖其他上下文的更新。
     */
    intc_reg_write(h->base, INTC_REG_ENABLE_SET, mask & intc_valid_mask(h));
}

void intc_enable_clear(intc_handle_t *h, uint32_t mask)
{
    /* W1C：写 1 清零对应使能位，写 0 保持不变 */
    intc_reg_write(h->base, INTC_REG_ENABLE_CLEAR, mask & intc_valid_mask(h));
}

/* =========================================================================
 * 3. 待处理状态管理
 * ========================================================================= */

uint32_t intc_read_pending(intc_handle_t *h)
{
    return intc_reg_read(h->base, INTC_REG_PENDING) & intc_valid_mask(h);
}

uint32_t intc_read_raw(intc_handle_t *h)
{
    /*
     * RAW 是经过触发模式转换后的瞬时状态，不经过使能掩码，也不是粘滞状态。
     * 边沿模式下相应位从变化起保持有效直到下一个 PCLK 更新历史样本，
     * 可能短于一个完整时钟周期；软件通常应读取 PENDING。
     */
    return intc_reg_read(h->base, INTC_REG_RAW) & intc_valid_mask(h);
}

void intc_pending_set(intc_handle_t *h, uint32_t mask)
{
    /* W1S：软件置位待处理位，与硬件事件走相同路径 */
    intc_reg_write(h->base, INTC_REG_PENDING_SET, mask & intc_valid_mask(h));
}

void intc_pending_clear(intc_handle_t *h, uint32_t mask)
{
    /*
     * W1C：软件清零待处理位，用于中断服务完成后的应答。
     *
     * 硬件原始事件与 PENDING_CLEAR 同拍发生时，事件置位优先：
     *   PENDING = (PENDING & ~clear_bits) | RAW
     * 因此对仍保持有效的高/低电平中断执行清零，待处理位不会持续为零。
     * 服务程序必须先消除外部中断条件，或先屏蔽该路中断再清位。
     */
    intc_reg_write(h->base, INTC_REG_PENDING_CLEAR, mask & intc_valid_mask(h));
}

/* =========================================================================
 * 4. 固定优先级仲裁
 * ========================================================================= */

uint32_t intc_read_active(intc_handle_t *h)
{
    /* 读取 ACTIVE 没有确认或清除副作用 */
    return intc_reg_read(h->base, INTC_REG_ACTIVE);
}

bool intc_active_valid(intc_handle_t *h)
{
    return (intc_reg_read(h->base, INTC_REG_ACTIVE) & INTC_ACTIVE_VALID) != 0U;
}

uint32_t intc_get_active_id(intc_handle_t *h)
{
    uint32_t active = intc_reg_read(h->base, INTC_REG_ACTIVE);
    return active & INTC_ACTIVE_ID_MASK;
}

/* =========================================================================
 * 5. 触发模式回读
 * ========================================================================= */

intc_irq_mode_t intc_get_mode(intc_handle_t *h, uint32_t id)
{
    uint32_t reg;
    uint32_t field;

    if (id >= h->irq_count) {
        return INTC_MODE_HIGH_LEVEL;  /* 超出 IRQ_COUNT 的字段读取为零 */
    }

    if (id < 16U) {
        reg = intc_reg_read(h->base, INTC_REG_MODE_LOW);
    } else {
        reg   = intc_reg_read(h->base, INTC_REG_MODE_HIGH);
        id -= 16U;
    }

    field = (reg >> (2U * id)) & 0x3U;
    return (intc_irq_mode_t)field;
}
