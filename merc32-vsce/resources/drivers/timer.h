/**
 * @file    timer.h
 * @brief   APB 双通道 Timer 裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持两个 32 位向上计数通道的
 *          使能/清零/软复位、PCLK 计数与级联计数、包含式终值（MAX）、
 *          PWM 比较输出、溢出/配置错误中断管理。
 *
 * 对应 RTL: apb_timer.v
 * 对应手册: apb_timer_manual.md
 */

#ifndef __TIMER_H__
#define __TIMER_H__

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 *    word_addr = paddr[11:2]，即偏移 >> 2
 * ========================================================================= */

#define TIMER_REG_CTRL            0x00U  /**< 控制寄存器（R/W、W1P）        */
#define TIMER_REG_IRQ_STATUS      0x04U  /**< 中断状态（R/W1C）              */
#define TIMER_REG_IRQ_ENABLE      0x08U  /**< 中断使能（R/W）                */
#define TIMER_REG_T0_CONFIG       0x0CU  /**< Timer 0 计数源和 PWM 配置（R/W）*/
#define TIMER_REG_T0_COUNT        0x10U  /**< Timer 0 当前计数值（R）         */
#define TIMER_REG_T0_MAX          0x14U  /**< Timer 0 包含式终值（R/W）       */
#define TIMER_REG_T0_PWM_COMPARE  0x18U  /**< Timer 0 PWM 比较值（R/W）       */
#define TIMER_REG_T1_CONFIG       0x1CU  /**< Timer 1 计数源和 PWM 配置（R/W）*/
#define TIMER_REG_T1_COUNT        0x20U  /**< Timer 1 当前计数值（R）         */
#define TIMER_REG_T1_MAX          0x24U  /**< Timer 1 包含式终值（R/W）       */
#define TIMER_REG_T1_PWM_COMPARE  0x28U  /**< Timer 1 PWM 比较值（R/W）       */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* CTRL */
#define TIMER_CTRL_T0_EN          (1UL << 0)  /**< Timer 0 使能（R/W）      */
#define TIMER_CTRL_T1_EN          (1UL << 1)  /**< Timer 1 使能（R/W）      */
#define TIMER_CTRL_T0_CLEAR       (1UL << 8)  /**< Timer 0 计数清零（W1P）  */
#define TIMER_CTRL_T1_CLEAR       (1UL << 9)  /**< Timer 1 计数清零（W1P）  */
#define TIMER_CTRL_SOFT_RST       (1UL << 31) /**< 同步软复位（W1P，需 byte3 strobe） */
#define TIMER_CTRL_EN_MASK        (0x3UL)     /**< 两通道使能位掩码 [1:0]   */

/* IRQ_STATUS / IRQ_ENABLE 共用低 3 位布局 */
#define TIMER_IRQ_T0_OVERFLOW     (1UL << 0)  /**< Timer 0 溢出             */
#define TIMER_IRQ_T1_OVERFLOW     (1UL << 1)  /**< Timer 1 溢出             */
#define TIMER_IRQ_CONFIG_ERROR    (1UL << 2)  /**< 运行中写保护或非法级联   */
#define TIMER_IRQ_ALL             (0x7UL)     /**< 全部有效中断位           */

/* T0_CONFIG / T1_CONFIG */
#define TIMER_CONFIG_COUNT_SOURCE (1UL << 0)  /**< 1=对另一 Timer 溢出计数  */
#define TIMER_CONFIG_PWM_MODE     (0x6UL)     /**< PWM 模式位 [2:1]         */
#define TIMER_CONFIG_PWM_POLARITY (1UL << 3)  /**< 0=高有效，1=低有效       */

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 计数源
 */
typedef enum {
    TIMER_COUNT_PCLK     = 0U,  /**< 每个 PCLK 计数一次 */
    TIMER_COUNT_CASCADE  = 1U   /**< 对另一 Timer 的溢出计数 */
} timer_count_source_t;

/**
 * @brief PWM 模式（PWM_MODE[2:1]）
 */
typedef enum {
    TIMER_PWM_OFF             = 0U,  /**< 关闭：始终无效       */
    TIMER_PWM_NORMAL          = 1U,  /**< 正常 PWM：COUNT < COMPARE 时有效 */
    TIMER_PWM_FORCE_INACTIVE  = 2U,  /**< 强制无效：始终无效   */
    TIMER_PWM_FORCE_ACTIVE    = 3U   /**< 强制有效：始终有效   */
} timer_pwm_mode_t;

/**
 * @brief PWM 输出极性
 */
typedef enum {
    TIMER_PWM_ACTIVE_HIGH = 0U,  /**< 活动电平为高 */
    TIMER_PWM_ACTIVE_LOW  = 1U   /**< 活动电平为低 */
} timer_pwm_polarity_t;

/**
 * @brief 通道编号
 */
typedef enum {
    TIMER_CHANNEL_0 = 0U,  /**< Timer 0 */
    TIMER_CHANNEL_1 = 1U   /**< Timer 1 */
} timer_channel_t;

/* =========================================================================
 * 4. 驱动句柄
 * ========================================================================= */

/**
 * @brief Timer 驱动句柄
 *
 * 所有 API 的第一个参数均为指向本结构体的指针。
 * 调用方需在使用前设置 base 为该 Timer 外设的 APB 基地址。
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
} timer_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

/**
 * @brief  读取 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @return 寄存器值
 */
static inline uint32_t timer_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

/**
 * @brief  写入 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @param  value  要写入的值
 *
 * @note   32 位写操作对应 APB pstrb=4'b1111，全字节选通。
 *         CTRL.SOFT_RST 需要 byte3（最高字节）strobe，全字写满足要求。
 *         CTRL.Tx_CLEAR 位于 byte1，可用 pstrb=4'b0010 单独清计数而不覆盖
 *         使能位；本驱动的 32 位全字写会在命令位旁同时写回使能位。
 */
static inline void timer_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 Timer 句柄
 * @param  h         Timer 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @return 0 成功，-1 参数错误
 */
int timer_init(timer_handle_t *h, uintptr_t base_addr);

/**
 * @brief  执行软复位（写 CTRL.SOFT_RST = 1）
 * @param  h Timer 句柄指针
 *
 * @details 软复位会恢复全部寄存器、计数器、中断和 PWM 状态，
 *          两个通道均关闭、终值恢复为 0xFFFF_FFFF。
 */
void timer_soft_reset(timer_handle_t *h);

/* =========================================================================
 * 7. 通道使能与计数控制
 * ========================================================================= */

/**
 * @brief  使能指定通道
 * @param  h       Timer 句柄指针
 * @param  ch      通道：TIMER_CHANNEL_0 或 TIMER_CHANNEL_1
 *
 * @note   写 CTRL 时只置位目标使能位，保留另一通道使能状态。
 *         建议使能前先完成 CONFIG/MAX/PWM 配置（仅在关闭时允许写）。
 */
void timer_enable(timer_handle_t *h, timer_channel_t ch);

/**
 * @brief  关闭指定通道
 * @param  h Timer 句柄指针
 * @param  ch 通道：TIMER_CHANNEL_0 或 TIMER_CHANNEL_1
 */
void timer_disable(timer_handle_t *h, timer_channel_t ch);

/**
 * @brief  读取两通道使能状态
 * @param  h Timer 句柄指针
 * @return 低 2 位：bit0=T0_EN，bit1=T1_EN
 */
uint32_t timer_get_enable(timer_handle_t *h);

/**
 * @brief  清零指定通道计数值
 * @param  h Timer 句柄指针
 * @param  ch 通道：TIMER_CHANNEL_0 或 TIMER_CHANNEL_1
 *
 * @note   计数清零在使能或关闭时均有效，并优先于同一拍的计数事件，
 *         但不会清除 IRQ_STATUS。本函数保留两通道使能位。
 */
void timer_clear_count(timer_handle_t *h, timer_channel_t ch);

/* =========================================================================
 * 8. 通道配置（仅在对应通道关闭时允许写）
 * ========================================================================= */

/**
 * @brief  配置通道（计数源 + PWM 模式 + 极性）
 * @param  h         Timer 句柄指针
 * @param  ch         通道
 * @param  source     计数源：TIMER_COUNT_PCLK 或 TIMER_COUNT_CASCADE
 * @param  pwm_mode   PWM 模式
 * @param  polarity   PWM 极性
 *
 * @note   必须在通道关闭时写入，否则写入被忽略并置位 CONFIG_ERROR。
 *         级联时两个通道不能互相选择对方为源，否则写入被拒绝。
 */
void timer_config_channel(timer_handle_t *h, timer_channel_t ch,
                          timer_count_source_t source,
                          timer_pwm_mode_t pwm_mode,
                          timer_pwm_polarity_t polarity);

/**
 * @brief  写入通道包含式终值 MAX
 * @param  h   Timer 句柄指针
 * @param  ch  通道
 * @param  max 终值（周期 = max + 1 个有效计数事件）
 *
 * @note   必须在通道关闭时写入。MAX=0 表示每个有效计数事件都溢出。
 */
void timer_set_max(timer_handle_t *h, timer_channel_t ch, uint32_t max);

/**
 * @brief  读取通道当前计数值
 * @param  h   Timer 句柄指针
 * @param  ch  通道
 * @return 32 位当前计数值
 */
uint32_t timer_get_count(timer_handle_t *h, timer_channel_t ch);

/**
 * @brief  写入通道 PWM 比较值
 * @param  h       Timer 句柄指针
 * @param  ch      通道
 * @param  compare PWM 比较值（正常 PWM 模式下 COUNT < COMPARE 时输出有效）
 *
 * @note   必须在通道关闭时写入。COMPARE=0 → 0% 活动；COMPARE>MAX → 100% 活动。
 */
void timer_set_pwm_compare(timer_handle_t *h, timer_channel_t ch, uint32_t compare);

/* =========================================================================
 * 9. 中断管理
 * ========================================================================= */

/**
 * @brief  读取中断状态（原始粘滞位）
 * @param  h Timer 句柄指针
 * @return 低 3 位有效：T0_OVERFLOW / T1_OVERFLOW / CONFIG_ERROR
 */
uint32_t timer_irq_read_status(timer_handle_t *h);

/**
 * @brief  获取已使能且待处理的中断位（interrupt = STATUS & ENABLE）
 * @param  h Timer 句柄指针
 * @return STATUS & ENABLE 的结果
 */
uint32_t timer_irq_get_pending(timer_handle_t *h);

/**
 * @brief  按掩码使能中断
 * @param  h    Timer 句柄指针
 * @param  mask 中断掩码（TIMER_IRQ_*）
 */
void timer_irq_enable(timer_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码禁用中断
 * @param  h    Timer 句柄指针
 * @param  mask 中断掩码（TIMER_IRQ_*）
 */
void timer_irq_disable(timer_handle_t *h, uint32_t mask);

/**
 * @brief  直接写入中断使能寄存器
 * @param  h     Timer 句柄指针
 * @param  value 低 3 位使能掩码
 */
void timer_irq_write_enable(timer_handle_t *h, uint32_t value);

/**
 * @brief  按掩码清除（W1C）中断状态
 * @param  h    Timer 句柄指针
 * @param  mask 要清除的状态位（写 1 清除，写 0 不变）
 *
 * @note   硬件事件与 W1C 同拍时事件置位优先。若 Timer 以 MAX=0 连续运行，
 *         单纯 W1C 无法保持状态为零，应先把对应通道关闭或清零再清位。
 */
void timer_irq_clear_status(timer_handle_t *h, uint32_t mask);

#ifdef __cplusplus
}
#endif

#endif /* __TIMER_H__ */
