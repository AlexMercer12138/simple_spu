/**
 * @file    intc.h
 * @brief   APB 中断控制器裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持 1~32 路中断源的使能管理、
 *          原子置位/清零、粘滞待处理状态管理、固定优先级仲裁（ACTIVE）查询，
 *          以及硬件触发模式（IRQ_MODE 参数）的只读回读。
 *
 * 对应 RTL: apb_intc.v
 * 对应手册: apb_intc_manual.md
 */

#ifndef __INTC_H__
#define __INTC_H__

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 * ========================================================================= */

#define INTC_REG_RAW           0x00U  /**< 当前原始事件状态（R）          */
#define INTC_REG_PENDING       0x04U  /**< 粘滞待处理状态（R）            */
#define INTC_REG_ENABLE        0x08U  /**< 中断使能掩码（R/W）            */
#define INTC_REG_ENABLE_SET    0x0CU  /**< 原子置位 ENABLE（W1S，读 0）   */
#define INTC_REG_ENABLE_CLEAR  0x10U  /**< 原子清零 ENABLE（W1C，读 0）   */
#define INTC_REG_PENDING_SET   0x14U  /**< 软件置位 PENDING（W1S，读 0）  */
#define INTC_REG_PENDING_CLEAR 0x18U  /**< 软件清零 PENDING（W1C，读 0）  */
#define INTC_REG_ACTIVE        0x1CU  /**< 最高优先级中断（R）            */
#define INTC_REG_MODE_LOW      0x20U  /**< 中断 0~15 触发模式（R，参数值） */
#define INTC_REG_MODE_HIGH     0x24U  /**< 中断 16~31 触发模式（R，参数值） */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* ACTIVE */
#define INTC_ACTIVE_ID_MASK   0x1FU    /**< ACTIVE_ID 位域 [4:0]          */
#define INTC_ACTIVE_VALID     (1UL << 31) /**< ACTIVE_VALID：ID 有效标志  */

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 中断源触发模式（IRQ_MODE 参数编码，软件只读）
 */
typedef enum {
    INTC_MODE_HIGH_LEVEL   = 0U,  /**< 高电平触发：irq_sources[n]==1        */
    INTC_MODE_LOW_LEVEL    = 1U,  /**< 低电平触发：irq_sources[n]==0        */
    INTC_MODE_RISING_EDGE  = 2U,  /**< 上升沿触发                          */
    INTC_MODE_FALLING_EDGE = 3U   /**< 下降沿触发                          */
} intc_irq_mode_t;

/* =========================================================================
 * 4. 驱动句柄
 * ========================================================================= */

/**
 * @brief INTC 驱动句柄
 *
 * irq_count 保存硬件例化参数 IRQ_COUNT（1~32），用于对寄存器位进行有效位
 * 屏蔽，避免把超出中断源数量的位当作有效状态。
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
    uint32_t           irq_count; /**< 有效中断源数量（1~32）               */
} intc_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

/**
 * @brief  读取 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @return 寄存器值
 */
static inline uint32_t intc_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

/**
 * @brief  写入 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @param  value  要写入的值
 */
static inline void intc_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化
 * ========================================================================= */

/**
 * @brief  初始化 INTC 句柄
 * @param  h         INTC 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @param  irq_count 硬件例化参数 IRQ_COUNT（1~32）
 * @return 0 成功，-1 参数错误
 */
int intc_init(intc_handle_t *h, uintptr_t base_addr, uint32_t irq_count);

/**
 * @brief  复位后的推荐初始化流程
 * @param  h INTC 句柄指针
 *
 * @details 关闭全部中断，再丢弃复位后累积的历史待处理状态：
 *          1. ENABLE = 0；
 *          2. PENDING_CLEAR = 全 1。
 *
 * @note    若使用电平触发，应在清除 PENDING 前确保外设端中断条件已撤销，
 *          否则相应待处理位会立即重新置位。
 */
void intc_init_clear(intc_handle_t *h);

/* =========================================================================
 * 7. 中断使能管理
 * ========================================================================= */

/**
 * @brief  直接写入中断使能寄存器（整体覆盖）
 * @param  h     INTC 句柄指针
 * @param  value 使能掩码（仅有效位被使用）
 */
void intc_write_enable(intc_handle_t *h, uint32_t value);

/**
 * @brief  读取中断使能寄存器
 * @param  h INTC 句柄指针
 * @return 使能掩码（仅有效位被使用）
 */
uint32_t intc_read_enable(intc_handle_t *h);

/**
 * @brief  原子置位中断使能（W1S，不影响其他位）
 * @param  h    INTC 句柄指针
 * @param  mask 要使能的中断位掩码
 */
void intc_enable_set(intc_handle_t *h, uint32_t mask);

/**
 * @brief  原子清零中断使能（W1C，不影响其他位）
 * @param  h    INTC 句柄指针
 * @param  mask 要禁用的中断位掩码
 */
void intc_enable_clear(intc_handle_t *h, uint32_t mask);

/* =========================================================================
 * 8. 待处理状态管理
 * ========================================================================= */

/**
 * @brief  读取待处理状态（粘滞原始位）
 * @param  h INTC 句柄指针
 * @return 待处理掩码
 */
uint32_t intc_read_pending(intc_handle_t *h);

/**
 * @brief  读取当前原始事件状态（非粘滞瞬时值）
 * @param  h INTC 句柄指针
 * @return 原始事件掩码
 *
 * @note   软件通常应以粘滞的 PENDING 为准，避免因轮询间隔漏掉边沿。
 */
uint32_t intc_read_raw(intc_handle_t *h);

/**
 * @brief  软件置位待处理状态（W1S，可用于软件触发中断/自测）
 * @param  h    INTC 句柄指针
 * @param  mask 要置位的待处理位掩码
 */
void intc_pending_set(intc_handle_t *h, uint32_t mask);

/**
 * @brief  软件清零待处理状态（W1C，中断服务应答）
 * @param  h    INTC 句柄指针
 * @param  mask 要清除的待处理位掩码
 *
 * @note   对仍保持有效的高/低电平中断执行清零，待处理位不会持续为零。
 *         必须先消除外部中断条件，或先屏蔽该路中断，再清除待处理位。
 */
void intc_pending_clear(intc_handle_t *h, uint32_t mask);

/* =========================================================================
 * 9. 固定优先级仲裁
 * ========================================================================= */

/**
 * @brief  读取 ACTIVE 寄存器原始值
 * @param  h INTC 句柄指针
 * @return ACTIVE 原始值（bit31 有效标志，[4:0] ID）
 */
uint32_t intc_read_active(intc_handle_t *h);

/**
 * @brief  判断当前是否存在已使能待处理中断
 * @param  h INTC 句柄指针
 * @return true 存在，false 不存在
 */
bool intc_active_valid(intc_handle_t *h);

/**
 * @brief  获取当前最高优先级中断 ID
 * @param  h INTC 句柄指针
 * @return 中断 ID（0~IRQ_COUNT-1）
 *
 * @note   仅当 intc_active_valid() 为 true 时返回值有效；
 *         没有符合条件的中断时 ACTIVE_ID=0 且 ACTIVE_VALID=0。
 */
uint32_t intc_get_active_id(intc_handle_t *h);

/* =========================================================================
 * 10. 触发模式回读（硬件参数，只读）
 * ========================================================================= */

/**
 * @brief  读取指定中断源的触发模式
 * @param  h   INTC 句柄指针
 * @param  id  中断 ID（0~IRQ_COUNT-1）
 * @return 触发模式（intc_irq_mode_t 编码）
 *
 * @note   IRQ_MODE 是硬件例化参数，软件只读。超过 IRQ_COUNT 的位读取为零。
 */
intc_irq_mode_t intc_get_mode(intc_handle_t *h, uint32_t id);

#ifdef __cplusplus
}
#endif

#endif /* __INTC_H__ */
