/**
 * @file    gpio.h
 * @brief   APB GPIO 裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持 32 个独立引脚的
 *          方向配置、输出读写、原子置位/清零/翻转、输入读取以及
 *          全局触发类型的中断管理。
 *
 * 对应 RTL: apb_gpio.v
 * 对应手册: apb_gpio_manual.md
 */

#ifndef __GPIO_H__
#define __GPIO_H__

#include <stdint.h>
#include <stdbool.h>

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 *    word_addr = paddr[11:2]，即偏移 >> 2
 * ========================================================================= */

#define GPIO_REG_CTRL        0x00U  /**< 控制寄存器（W1P，bit31 软复位）      */
#define GPIO_REG_DIR         0x04U  /**< 方向寄存器（R/W，1=输出，0=输入）     */
#define GPIO_REG_OUT         0x08U  /**< 输出锁存器（R/W）                      */
#define GPIO_REG_SET         0x0CU  /**< 原子置位（W，写 1 置位，读返回 0）    */
#define GPIO_REG_CLEAR       0x10U  /**< 原子清零（W，写 1 清零，读返回 0）    */
#define GPIO_REG_TOGGLE      0x14U  /**< 原子翻转（W，写 1 翻转，读返回 0）    */
#define GPIO_REG_IN          0x18U  /**< 输入寄存器（R，双级同步后的值）        */
#define GPIO_REG_IRQ_TYPE    0x1CU  /**< 中断触发类型（R/W，全局，[2:0] 有效） */
#define GPIO_REG_IRQ_ENABLE  0x20U  /**< 中断使能掩码（R/W，每引脚独立）        */
#define GPIO_REG_IRQ_STATUS  0x24U  /**< 中断状态（R/W1C，粘滞待处理位）        */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

#define GPIO_PIN_0           (1UL << 0)
#define GPIO_PIN_1           (1UL << 1)
#define GPIO_PIN_2           (1UL << 2)
#define GPIO_PIN_3           (1UL << 3)
#define GPIO_PIN_4           (1UL << 4)
#define GPIO_PIN_5           (1UL << 5)
#define GPIO_PIN_6           (1UL << 6)
#define GPIO_PIN_7           (1UL << 7)
#define GPIO_PIN_8           (1UL << 8)
#define GPIO_PIN_9           (1UL << 9)
#define GPIO_PIN_10          (1UL << 10)
#define GPIO_PIN_11          (1UL << 11)
#define GPIO_PIN_12          (1UL << 12)
#define GPIO_PIN_13          (1UL << 13)
#define GPIO_PIN_14          (1UL << 14)
#define GPIO_PIN_15          (1UL << 15)
#define GPIO_PIN_16          (1UL << 16)
#define GPIO_PIN_17          (1UL << 17)
#define GPIO_PIN_18          (1UL << 18)
#define GPIO_PIN_19          (1UL << 19)
#define GPIO_PIN_20          (1UL << 20)
#define GPIO_PIN_21          (1UL << 21)
#define GPIO_PIN_22          (1UL << 22)
#define GPIO_PIN_23          (1UL << 23)
#define GPIO_PIN_24          (1UL << 24)
#define GPIO_PIN_25          (1UL << 25)
#define GPIO_PIN_26          (1UL << 26)
#define GPIO_PIN_27          (1UL << 27)
#define GPIO_PIN_28          (1UL << 28)
#define GPIO_PIN_29          (1UL << 29)
#define GPIO_PIN_30          (1UL << 30)
#define GPIO_PIN_31          (1UL << 31)
#define GPIO_PIN_ALL         (0xFFFFFFFFUL)  /**< 全部 32 个引脚 */
#define GPIO_PIN_MASK        (0xFFFFFFFFUL)  /**< 有效位掩码 */

#define GPIO_CTRL_SOFT_RST   (1UL << 31)     /**< CTRL 软复位位（W1P，需 byte3 strobe） */

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 引脚方向
 */
typedef enum {
    GPIO_DIR_INPUT  = 0U,  /**< 输入 / 高阻（gpio_t=1） */
    GPIO_DIR_OUTPUT = 1U   /**< 输出驱动（gpio_t=0）    */
} gpio_dir_t;

/**
 * @brief 引脚电平
 */
typedef enum {
    GPIO_LEVEL_LOW  = 0U,  /**< 低电平 */
    GPIO_LEVEL_HIGH = 1U   /**< 高电平 */
} gpio_level_t;

/**
 * @brief 全局中断触发类型（IRQ_TYPE[2:0]，对全部 32 个引脚生效）
 *
 * @note 写 IRQ_TYPE 会产生三个副作用：
 *       1. 清除全部 IRQ_STATUS 位；
 *       2. 该时钟禁止产生新事件；
 *       3. 以当前同步输入重建边沿历史基准。
 *       因此改变触发类型不会把当前稳定电平误判为一次边沿。
 */
typedef enum {
    GPIO_IRQ_TYPE_LOW_LEVEL    = 0U,  /**< 低电平触发           */
    GPIO_IRQ_TYPE_HIGH_LEVEL   = 1U,  /**< 高电平触发           */
    GPIO_IRQ_TYPE_RISING_EDGE  = 2U,  /**< 上升沿触发           */
    GPIO_IRQ_TYPE_FALLING_EDGE = 3U,  /**< 下降沿触发           */
    GPIO_IRQ_TYPE_BOTH_EDGE    = 4U,  /**< 任意边沿（双边沿）   */
    GPIO_IRQ_TYPE_DISABLE_5    = 5U,  /**< 禁止事件检测（保留） */
    GPIO_IRQ_TYPE_DISABLE_6    = 6U,  /**< 禁止事件检测（保留） */
    GPIO_IRQ_TYPE_DISABLE      = 7U   /**< 禁止事件检测（复位默认值） */
} gpio_irq_type_t;

/* =========================================================================
 * 4. 驱动句柄
 * ========================================================================= */

/**
 * @brief GPIO 驱动句柄
 *
 * 所有 API 的第一个参数均为指向本结构体的指针。
 * 调用方需在使用前设置 base 为该 GPIO 外设的 APB 基地址。
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
} gpio_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

/**
 * @brief  读取 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @return 寄存器值
 */
static inline uint32_t gpio_reg_read(volatile uint32_t *base, uint32_t offset)
{
    /* 偏移以字节为单位，转换为 32 位字索引：offset / 4 */
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
 */
static inline void gpio_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 GPIO 句柄
 * @param  h        GPIO 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @return 0 成功，-1 参数错误
 */
int gpio_init(gpio_handle_t *h, uintptr_t base_addr);

/**
 * @brief  执行软复位（写 CTRL.SOFT_RST = 1）
 * @param  h GPIO 句柄指针
 *
 * @details 软复位会：
 *          - 全部引脚恢复为输入（GPIO_DIR = 0）
 *          - 清零输出锁存器（GPIO_OUT = 0）
 *          - 清零中断使能（IRQ_ENABLE = 0）
 *          - IRQ_TYPE 恢复为禁用编码 7
 *          - 清除全部待处理状态（IRQ_STATUS = 0）
 *
 * @note    软复位是同步复位，在 PCLK 上升沿生效。
 *          复位后输入同步器需要约 2 个 PCLK 才能输出有效值。
 */
void gpio_soft_reset(gpio_handle_t *h);

/* =========================================================================
 * 7. 方向配置
 * ========================================================================= */

/**
 * @brief  设置单个引脚方向
 * @param  h    GPIO 句柄指针
 * @param  pin  引脚编号（0~31）
 * @param  dir  方向：GPIO_DIR_INPUT 或 GPIO_DIR_OUTPUT
 */
void gpio_set_pin_dir(gpio_handle_t *h, uint32_t pin, gpio_dir_t dir);

/**
 * @brief  按掩码批量设置引脚方向（读改写）
 * @param  h     GPIO 句柄指针
 * @param  mask  引脚掩码（为 1 的位受影响）
 * @param  dir   方向：GPIO_DIR_INPUT 或 GPIO_DIR_OUTPUT
 *
 * @note  多上下文操作不同位时，单引脚方向无原子寄存器，
 *        需调用方自行保证互斥（关中断 / 锁）。
 */
void gpio_set_dir_mask(gpio_handle_t *h, uint32_t mask, gpio_dir_t dir);

/**
 * @brief  直接写入完整方向寄存器
 * @param  h     GPIO 句柄指针
 * @param  value 32 位方向值（1=输出，0=输入）
 */
void gpio_write_dir(gpio_handle_t *h, uint32_t value);

/**
 * @brief  读取方向寄存器
 * @param  h GPIO 句柄指针
 * @return 32 位方向值
 */
uint32_t gpio_read_dir(gpio_handle_t *h);

/* =========================================================================
 * 8. 输出操作
 * ========================================================================= */

/**
 * @brief  设置单个输出引脚电平
 * @param  h     GPIO 句柄指针
 * @param  pin   引脚编号（0~31）
 * @param  level 电平：GPIO_LEVEL_LOW 或 GPIO_LEVEL_HIGH
 *
 * @note  使用原子 SET/CLEAR 寄存器实现，无需读改写，多上下文安全。
 */
void gpio_set_pin_level(gpio_handle_t *h, uint32_t pin, gpio_level_t level);

/**
 * @brief  直接写入完整输出锁存器
 * @param  h     GPIO 句柄指针
 * @param  value 32 位输出值
 *
 * @note  适合一次性更新全部输出。读改写可能与 ISR 竞争，
 *        只改少量位时优先使用 gpio_set_mask / gpio_clear_mask / gpio_toggle_mask。
 */
void gpio_write_out(gpio_handle_t *h, uint32_t value);

/**
 * @brief  读取输出锁存器当前值
 * @param  h GPIO 句柄指针
 * @return 32 位输出锁存值
 */
uint32_t gpio_read_out(gpio_handle_t *h);

/**
 * @brief  原子置位：将 mask 中为 1 的输出位置 1
 * @param  h    GPIO 句柄指针
 * @param  mask 引脚掩码
 *
 * @note  一次 APB 写完成，无需读改写。写 0 的位保持不变。
 */
void gpio_set_mask(gpio_handle_t *h, uint32_t mask);

/**
 * @brief  原子清零：将 mask 中为 1 的输出位清 0
 * @param  h    GPIO 句柄指针
 * @param  mask 引脚掩码
 */
void gpio_clear_mask(gpio_handle_t *h, uint32_t mask);

/**
 * @brief  原子翻转：将 mask 中为 1 的输出位取反
 * @param  h    GPIO 句柄指针
 * @param  mask 引脚掩码
 */
void gpio_toggle_mask(gpio_handle_t *h, uint32_t mask);

/**
 * @brief  无毛刺地配置输出（先准备电平，再打开输出驱动）
 * @param  h           GPIO 句柄指针
 * @param  mask        要配置为输出的引脚掩码
 * @param  init_level  初始电平：GPIO_LEVEL_LOW 或 GPIO_LEVEL_HIGH
 *
 * @details 按照手册推荐的无毛刺输出配置流程：
 *          1. 先清零目标位（确保已知初始态）
 *          2. 按需置位（设置初始高电平）
 *          3. 最后设置方向为输出（打开驱动）
 *          这样方向切换时不会出现不期望的瞬态电平。
 */
void gpio_config_output(gpio_handle_t *h, uint32_t mask, gpio_level_t init_level);

/* =========================================================================
 * 9. 输入读取
 * ========================================================================= */

/**
 * @brief  读取单个输入引脚电平
 * @param  h   GPIO 句柄指针
 * @param  pin 引脚编号（0~31）
 * @return GPIO_LEVEL_HIGH 或 GPIO_LEVEL_LOW
 *
 * @note  读取的是经过双级同步器后的值，不包含去抖功能。
 *        复位后需等待约 2 个 PCLK 同步器才输出有效值。
 */
gpio_level_t gpio_read_pin(gpio_handle_t *h, uint32_t pin);

/**
 * @brief  读取全部 32 位输入值
 * @param  h GPIO 句柄指针
 * @return 32 位同步输入值
 */
uint32_t gpio_read_in(gpio_handle_t *h);

/**
 * @brief  按掩码读取输入值
 * @param  h    GPIO 句柄指针
 * @param  mask 引脚掩码
 * @return 掩码后的输入值（未选中位为 0）
 */
uint32_t gpio_read_in_mask(gpio_handle_t *h, uint32_t mask);

/* =========================================================================
 * 10. 中断配置
 * ========================================================================= */

/**
 * @brief  设置全局中断触发类型
 * @param  h    GPIO 句柄指针
 * @param  type 触发类型（见 gpio_irq_type_t）
 *
 * @warning 全部 32 个引脚共用一个触发类型，不能同时让不同引脚
 *          使用不同触发方式。需要混合策略时统一使用双边沿
 *          （GPIO_IRQ_TYPE_BOTH_EDGE），在 ISR 中读 GPIO_IN 判断方向。
 *
 * @note    写 IRQ_TYPE 会自动清除全部 IRQ_STATUS 并重建边沿历史，
 *          因此调用后无需手动清除旧状态。
 */
void gpio_irq_set_type(gpio_handle_t *h, gpio_irq_type_t type);

/**
 * @brief  读取当前全局中断触发类型
 * @param  h GPIO 句柄指针
 * @return 触发类型（低 3 位有效）
 */
gpio_irq_type_t gpio_irq_get_type(gpio_handle_t *h);

/**
 * @brief  按掩码使能引脚中断
 * @param  h    GPIO 句柄指针
 * @param  mask 要使能的引脚掩码
 *
 * @note  使能只影响中断输出（interrupt 信号），不影响事件记录。
 *        屏蔽期间发生的事件仍会置位 IRQ_STATUS，使能后立即驱动中断。
 */
void gpio_irq_enable(gpio_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码禁用引脚中断
 * @param  h    GPIO 句柄指针
 * @param  mask 要禁用的引脚掩码
 */
void gpio_irq_disable(gpio_handle_t *h, uint32_t mask);

/**
 * @brief  直接写入中断使能寄存器
 * @param  h     GPIO 句柄指针
 * @param  value 32 位使能掩码
 */
void gpio_irq_write_enable(gpio_handle_t *h, uint32_t value);

/**
 * @brief  读取中断使能寄存器
 * @param  h GPIO 句柄指针
 * @return 32 位使能掩码
 */
uint32_t gpio_irq_read_enable(gpio_handle_t *h);

/**
 * @brief  读取中断待处理状态（原始粘滞位）
 * @param  h GPIO 句柄指针
 * @return 32 位待处理状态
 *
 * @note  返回的是原始 IRQ_STATUS，不受 IRQ_ENABLE 影响。
 *        若需获取"已使能且待处理"的位，请用 gpio_irq_get_pending()。
 */
uint32_t gpio_irq_read_status(gpio_handle_t *h);

/**
 * @brief  获取已使能且待处理的中断位（interrupt = |(STATUS & ENABLE)）
 * @param  h GPIO 句柄指针
 * @return STATUS & ENABLE 的结果
 */
uint32_t gpio_irq_get_pending(gpio_handle_t *h);

/**
 * @brief  按掩码清除（W1C）中断待处理状态
 * @param  h    GPIO 句柄指针
 * @param  mask 要清除的引脚掩码（写 1 清除，写 0 不变）
 *
 * @warning 对于电平触发：若输入仍处于有效电平，状态无法持续清除
 *          （同拍事件会立即覆盖 W1C，或下一拍重新置位）。
 *          电平中断 ISR 必须先消除外部中断条件，再调用本函数。
 *
 * @note    新硬件事件与 W1C 同拍发生时，事件置位优先。
 */
void gpio_irq_clear_status(gpio_handle_t *h, uint32_t mask);

/**
 * @brief  完整配置边沿中断（按手册推荐流程）
 * @param  h     GPIO 句柄指针
 * @param  mask  要配置的引脚掩码
 * @param  type  触发类型（建议边沿类：RISING / FALLING / BOTH_EDGE）
 *
 * @details 执行流程：
 *          1. 屏蔽目标引脚中断（IRQ_ENABLE &= ~mask）
 *          2. 设置为输入（GPIO_DIR &= ~mask）
 *          3. 写 IRQ_TYPE（自动清状态 + 重建边沿基准）
 *          4. W1C 清除可能的旧状态
 *          5. 使能目标引脚中断
 *
 * @note    调用方应在配置前确保 PCLK 已稳定运行至少 2 个周期，
 *          以使输入同步器输出有效。若刚复位，可插入短延时。
 */
void gpio_irq_config_edge(gpio_handle_t *h, uint32_t mask, gpio_irq_type_t type);

#ifdef __cplusplus
}
#endif

#endif /* __GPIO_H__ */
