/**
 * @file    gpio.c
 * @brief   APB GPIO 裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          gpio_reg_read / gpio_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_gpio.v
 * 对应手册: apb_gpio_manual.md
 */

#include "gpio.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 内部辅助宏
 * ========================================================================= */

/** 引脚编号有效性检查：0 ~ 31 */
#define GPIO_PIN_VALID(pin)  ((pin) < 32U)

/** 将引脚编号转换为位掩码 */
#define GPIO_PIN_BIT(pin)    (1UL << (pin))

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int gpio_init(gpio_handle_t *h, uintptr_t base_addr)
{
    /* 参数校验：句柄非空，地址 4 字节对齐（APB 32 位寄存器要求） */
    if (h == NULL || (base_addr & 0x3U) != 0U) {
        return -1;
    }

    /* 保存基地址，转换为 volatile 32 位寄存器指针 */
    h->base = (volatile uint32_t *)base_addr;

    return 0;
}

void gpio_soft_reset(gpio_handle_t *h)
{
    /*
     * 写 CTRL 寄存器 bit31 = 1 触发同步软复位。
     * RTL 中 soft_reset_write = ctrl_write && apb_masked_wdata[31]，
     * ctrl_write 需要 pstrb[3]（最高字节选通）。
     * 32 位全字写对应 pstrb=4'b1111，满足 byte3 选通要求。
     *
     * 写值 0x80000000：仅 bit31 为 1，其余位为 0。
     * CTRL 是 W1P（写 1 置位脉冲），读取恒返回 0。
     */
    gpio_reg_write(h->base, GPIO_REG_CTRL, GPIO_CTRL_SOFT_RST);

    /*
     * 软复位是同步复位，在接下来的 PCLK 上升沿生效。
     * 此处不主动延时，调用方在复位后操作输入前应自行等待
     * 至少 2 个 PCLK（同步器流水线建立时间）。
     */
}

/* =========================================================================
 * 2. 方向配置
 * ========================================================================= */

void gpio_set_pin_dir(gpio_handle_t *h, uint32_t pin, gpio_dir_t dir)
{
    uint32_t mask;
    uint32_t dir_val;

    if (!GPIO_PIN_VALID(pin)) {
        return;
    }

    mask    = GPIO_PIN_BIT(pin);
    dir_val = gpio_reg_read(h->base, GPIO_REG_DIR);

    if (dir == GPIO_DIR_OUTPUT) {
        dir_val |= mask;   /* 对应位置 1：输出 */
    } else {
        dir_val &= ~mask;  /* 对应位清 0：输入 */
    }

    gpio_reg_write(h->base, GPIO_REG_DIR, dir_val);
}

void gpio_set_dir_mask(gpio_handle_t *h, uint32_t mask, gpio_dir_t dir)
{
    uint32_t dir_val;

    /* 掩码限制在 32 位有效范围内 */
    mask &= GPIO_PIN_MASK;

    dir_val = gpio_reg_read(h->base, GPIO_REG_DIR);

    if (dir == GPIO_DIR_OUTPUT) {
        dir_val |= mask;
    } else {
        dir_val &= ~mask;
    }

    gpio_reg_write(h->base, GPIO_REG_DIR, dir_val);
}

void gpio_write_dir(gpio_handle_t *h, uint32_t value)
{
    gpio_reg_write(h->base, GPIO_REG_DIR, value & GPIO_PIN_MASK);
}

uint32_t gpio_read_dir(gpio_handle_t *h)
{
    return gpio_reg_read(h->base, GPIO_REG_DIR);
}

/* =========================================================================
 * 3. 输出操作
 * ========================================================================= */

void gpio_set_pin_level(gpio_handle_t *h, uint32_t pin, gpio_level_t level)
{
    if (!GPIO_PIN_VALID(pin)) {
        return;
    }

    /*
     * 使用原子 SET / CLEAR 寄存器，无需读改写，多上下文安全。
     * SET:    GPIO_OUT = GPIO_OUT | write_data
     * CLEAR:  GPIO_OUT = GPIO_OUT & ~write_data
     */
    if (level == GPIO_LEVEL_HIGH) {
        gpio_reg_write(h->base, GPIO_REG_SET, GPIO_PIN_BIT(pin));
    } else {
        gpio_reg_write(h->base, GPIO_REG_CLEAR, GPIO_PIN_BIT(pin));
    }
}

void gpio_write_out(gpio_handle_t *h, uint32_t value)
{
    gpio_reg_write(h->base, GPIO_REG_OUT, value & GPIO_PIN_MASK);
}

uint32_t gpio_read_out(gpio_handle_t *h)
{
    return gpio_reg_read(h->base, GPIO_REG_OUT);
}

void gpio_set_mask(gpio_handle_t *h, uint32_t mask)
{
    /* 原子置位：写 1 的位被置位，写 0 的位不变 */
    gpio_reg_write(h->base, GPIO_REG_SET, mask & GPIO_PIN_MASK);
}

void gpio_clear_mask(gpio_handle_t *h, uint32_t mask)
{
    /* 原子清零：写 1 的位被清零，写 0 的位不变 */
    gpio_reg_write(h->base, GPIO_REG_CLEAR, mask & GPIO_PIN_MASK);
}

void gpio_toggle_mask(gpio_handle_t *h, uint32_t mask)
{
    /* 原子翻转：写 1 的位被取反，写 0 的位不变 */
    gpio_reg_write(h->base, GPIO_REG_TOGGLE, mask & GPIO_PIN_MASK);
}

void gpio_config_output(gpio_handle_t *h, uint32_t mask, gpio_level_t init_level)
{
    uint32_t dir_val;

    mask &= GPIO_PIN_MASK;

    /*
     * 无毛刺输出配置流程（手册 6.1 节）：
     * 1. 先清零目标位，确保输出锁存器处于已知低电平态
     * 2. 若需要初始高电平，再原子置位
     * 3. 最后设置方向为输出，打开引脚驱动
     *
     * 输出锁存器与方向寄存器独立：输入模式下 gpio_o 仍保持锁存值，
     * 因此先准备好电平再切方向，可避免方向切换时的瞬态毛刺。
     */
    gpio_reg_write(h->base, GPIO_REG_CLEAR, mask);

    if (init_level == GPIO_LEVEL_HIGH) {
        gpio_reg_write(h->base, GPIO_REG_SET, mask);
    }

    /* 设置方向为输出（读改写，仅修改目标位） */
    dir_val  = gpio_reg_read(h->base, GPIO_REG_DIR);
    dir_val |= mask;
    gpio_reg_write(h->base, GPIO_REG_DIR, dir_val);
}

/* =========================================================================
 * 4. 输入读取
 * ========================================================================= */

gpio_level_t gpio_read_pin(gpio_handle_t *h, uint32_t pin)
{
    uint32_t value;

    if (!GPIO_PIN_VALID(pin)) {
        return GPIO_LEVEL_LOW;
    }

    value = gpio_reg_read(h->base, GPIO_REG_IN);

    return ((value & GPIO_PIN_BIT(pin)) != 0U) ? GPIO_LEVEL_HIGH : GPIO_LEVEL_LOW;
}

uint32_t gpio_read_in(gpio_handle_t *h)
{
    /*
     * GPIO_IN 返回经过两级触发器同步后的输入值。
     * 复位或软复位后，sync_valid_pipe 需要 2 个 PCLK 才置位，
     * 在此之前 GPIO_IN 恒返回 0。
     */
    return gpio_reg_read(h->base, GPIO_REG_IN);
}

uint32_t gpio_read_in_mask(gpio_handle_t *h, uint32_t mask)
{
    return gpio_reg_read(h->base, GPIO_REG_IN) & (mask & GPIO_PIN_MASK);
}

/* =========================================================================
 * 5. 中断配置
 * ========================================================================= */

void gpio_irq_set_type(gpio_handle_t *h, gpio_irq_type_t type)
{
    /*
     * IRQ_TYPE 仅低 3 位有效，写高 29 位无影响（RTL 中只取 [2:0]）。
     * 需要 pstrb[0]（最低字节选通），32 位全字写满足要求。
     *
     * 重要副作用（RTL 中 irq_type_write 时）：
     * - irq_status_reg <= 32'd0（清除全部待处理位）
     * - 该拍 irq_event 被屏蔽（irq_event = 0）
     * - 下一拍以当前同步输入重建 gpio_previous_reg 和 irq_history_valid
     */
    gpio_reg_write(h->base, GPIO_REG_IRQ_TYPE, (uint32_t)type & 0x7U);
}

gpio_irq_type_t gpio_irq_get_type(gpio_handle_t *h)
{
    /* 读取时 RTL 返回 {29'd0, irq_type_reg}，仅低 3 位有效 */
    uint32_t val = gpio_reg_read(h->base, GPIO_REG_IRQ_TYPE) & 0x7U;
    return (gpio_irq_type_t)val;
}

void gpio_irq_enable(gpio_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= GPIO_PIN_MASK;

    /* 读改写：仅将目标位置 1，保留其他引脚的使能状态 */
    enable_val  = gpio_reg_read(h->base, GPIO_REG_IRQ_ENABLE);
    enable_val |= mask;
    gpio_reg_write(h->base, GPIO_REG_IRQ_ENABLE, enable_val);
}

void gpio_irq_disable(gpio_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= GPIO_PIN_MASK;

    enable_val  = gpio_reg_read(h->base, GPIO_REG_IRQ_ENABLE);
    enable_val &= ~mask;
    gpio_reg_write(h->base, GPIO_REG_IRQ_ENABLE, enable_val);
}

void gpio_irq_write_enable(gpio_handle_t *h, uint32_t value)
{
    gpio_reg_write(h->base, GPIO_REG_IRQ_ENABLE, value & GPIO_PIN_MASK);
}

uint32_t gpio_irq_read_enable(gpio_handle_t *h)
{
    return gpio_reg_read(h->base, GPIO_REG_IRQ_ENABLE);
}

uint32_t gpio_irq_read_status(gpio_handle_t *h)
{
    /*
     * IRQ_STATUS 是粘滞原始待处理位，不受 IRQ_ENABLE 影响。
     * 即使引脚中断被禁用，发生的事件仍会置位对应状态位。
     */
    return gpio_reg_read(h->base, GPIO_REG_IRQ_STATUS);
}

uint32_t gpio_irq_get_pending(gpio_handle_t *h)
{
    /*
     * 对应 RTL: interrupt = |(irq_status_reg & irq_enable_reg)
     * 返回按位与的结果，每一位表示该引脚"已使能且待处理"。
     * 调用方可在 ISR 中用此值判断哪些引脚需要处理。
     */
    uint32_t status = gpio_reg_read(h->base, GPIO_REG_IRQ_STATUS);
    uint32_t enable = gpio_reg_read(h->base, GPIO_REG_IRQ_ENABLE);
    return status & enable;
}

void gpio_irq_clear_status(gpio_handle_t *h, uint32_t mask)
{
    /*
     * W1C（Write 1 to Clear）：向某位写 1 清除该位，写 0 保持不变。
     * RTL: irq_status_reg <= (irq_status_reg & ~apb_masked_wdata) | irq_event
     *
     * 注意事项：
     * - 新硬件事件与 W1C 同拍发生时，事件置位优先（irq_event 最终或上）。
     * - 电平触发：若输入仍处于有效电平，W1C 后状态会立即或很快重新置位。
     *   必须先消除外部中断条件，再调用本函数。
     */
    gpio_reg_write(h->base, GPIO_REG_IRQ_STATUS, mask & GPIO_PIN_MASK);
}

void gpio_irq_config_edge(gpio_handle_t *h, uint32_t mask, gpio_irq_type_t type)
{
    uint32_t dir_val;
    uint32_t enable_val;

    mask &= GPIO_PIN_MASK;

    /*
     * 步骤 1：配置期间先屏蔽目标引脚中断，防止配置过程中产生误触发
     */
    enable_val  = gpio_reg_read(h->base, GPIO_REG_IRQ_ENABLE);
    enable_val &= ~mask;
    gpio_reg_write(h->base, GPIO_REG_IRQ_ENABLE, enable_val);

    /*
     * 步骤 2：设置目标引脚为输入方向
     * 只有 GPIO_DIR=0 的引脚能产生新的中断事件
     */
    dir_val  = gpio_reg_read(h->base, GPIO_REG_DIR);
    dir_val &= ~mask;
    gpio_reg_write(h->base, GPIO_REG_DIR, dir_val);

    /*
     * 步骤 3：写 IRQ_TYPE
     * 这一步会自动：
     *   - 清除全部 IRQ_STATUS（irq_status_reg <= 0）
     *   - 该拍禁止新事件产生
     *   - 以当前同步输入重建边沿历史基准（gpio_previous_reg）
     * 因此不会把当前稳定电平误判为一次边沿。
     *
     * 注意：IRQ_TYPE 是全局配置，会影响所有 32 个引脚，
     * 调用方需确保这是期望的行为。
     */
    gpio_reg_write(h->base, GPIO_REG_IRQ_TYPE, (uint32_t)type & 0x7U);

    /*
     * 步骤 4：W1C 清除目标引脚可能残留的旧待处理状态
     * （写 IRQ_TYPE 已清全部状态，此步为双重保险，针对极端时序）
     */
    gpio_reg_write(h->base, GPIO_REG_IRQ_STATUS, mask);

    /*
     * 步骤 5：使能目标引脚中断
     */
    enable_val = gpio_reg_read(h->base, GPIO_REG_IRQ_ENABLE);
    enable_val |= mask;
    gpio_reg_write(h->base, GPIO_REG_IRQ_ENABLE, enable_val);
}
