/**
 * @file    uart.h
 * @brief   APB UART 裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持可编程波特率、8 数据位、
 *          1/2 停止位、无/奇/偶校验、独立收发使能与 FIFO 清空、4 种电平型
 *          中断条件以及外设软复位。
 *
 * 对应 RTL: apb_uart.v
 * 对应手册: apb_uart_manual.md
 */

#ifndef __UART_H__
#define __UART_H__

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>  /* size_t */

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 * ========================================================================= */

#define UART_REG_CTRL       0x00U  /**< 控制寄存器（R/W、W1P）           */
#define UART_REG_CONFIG     0x04U  /**< 波特率、校验和停止位（R/W）      */
#define UART_REG_RX_DATA    0x08U  /**< RX FIFO 同步读端口（R/POP）      */
#define UART_REG_RX_STATUS  0x0CU  /**< RX FIFO 和接收器状态（R）        */
#define UART_REG_TX_DATA    0x10U  /**< TX FIFO 压入（W，读返回 0）      */
#define UART_REG_TX_STATUS  0x14U  /**< TX FIFO 和发送器状态（R）        */
#define UART_REG_INTERRUPT  0x18U  /**< 中断使能、条件、标志和阈值（R/W）*/

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* CTRL */
#define UART_CTRL_RX_EN     (1UL << 0)   /**< 接收使能（R/W）           */
#define UART_CTRL_TX_EN     (1UL << 1)   /**< 发送使能（R/W）           */
#define UART_CTRL_RX_CLR    (1UL << 2)   /**< 清空 RX FIFO（W1P）       */
#define UART_CTRL_TX_CLR    (1UL << 3)   /**< 清空 TX FIFO（W1P）       */
#define UART_CTRL_SOFT_RST  (1UL << 31)  /**< 软复位（W1P，需 byte3 strobe） */
#define UART_CTRL_EN_MASK   (0x3UL)      /**< RX_EN/TX_EN 掩码 [1:0]    */

/* CONFIG */
#define UART_CONFIG_BAUD_MASK    0x00FFFFFFUL  /**< BAUD_RATE [23:0]    */
#define UART_CONFIG_PARITY_SHIFT 29U           /**< PARITY_TYPE 起始位  */
#define UART_CONFIG_PARITY_MASK  (0x3UL << 29) /**< PARITY_TYPE [30:29] */
#define UART_CONFIG_STOP_BIT     (1UL << 31)   /**< 1=2 个停止位        */

/* RX_STATUS / TX_STATUS */
#define UART_STATUS_LEVEL_MASK  0xFFU    /**< LEVEL [7:0]       */
#define UART_STATUS_EMPTY       (1UL << 8)  /**< FIFO 空       */
#define UART_STATUS_FULL        (1UL << 9)  /**< FIFO 满       */
#define UART_STATUS_BUSY        (1UL << 10) /**< 串行引擎忙    */

/* INTERRUPT */
#define UART_INT_EN            (1UL << 0)   /**< 中断总使能          */
#define UART_INT_TYPE_SHIFT    1U           /**< INT_TYPE 起始位     */
#define UART_INT_TYPE_MASK     (0x3UL << 1) /**< INT_TYPE [2:1]     */
#define UART_INT_FLAG          (1UL << 4)   /**< 中断曾为高的粘滞标志 */
#define UART_INT_RX_THRESHOLD_MASK (0xFFUL << 16) /**< RX 阈值 [23:16] */
#define UART_INT_TX_THRESHOLD_MASK (0xFFUL << 24) /**< TX 阈值 [31:24] */

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 校验类型
 */
typedef enum {
    UART_PARITY_NONE  = 0U,  /**< 无校验 */
    UART_PARITY_ODD   = 1U,  /**< 奇校验 */
    UART_PARITY_EVEN  = 2U   /**< 偶校验 */
} uart_parity_t;

/**
 * @brief 中断条件选择（INT_TYPE）
 */
typedef enum {
    UART_INT_RX_NOT_EMPTY = 0U,  /**< RX FIFO 非空               */
    UART_INT_TX_NOT_FULL  = 1U,  /**< TX FIFO 未满               */
    UART_INT_RX_THRESHOLD = 2U,  /**< RX_LEVEL >= RX_THRESHOLD   */
    UART_INT_TX_THRESHOLD = 3U   /**< TX_LEVEL <= TX_THRESHOLD   */
} uart_int_type_t;

/* =========================================================================
 * 4. 驱动句柄
 * ========================================================================= */

/**
 * @brief UART 驱动句柄
 *
 * fifo_depth 保存硬件参数 FIFO_DEPTH，用于阈值建议和批量接收缓冲区参考。
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
    uint32_t           fifo_depth; /**< TX/RX FIFO 深度（硬件参数）          */
} uart_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

/**
 * @brief  读取 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @return 寄存器值
 */
static inline uint32_t uart_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

/**
 * @brief  写入 32 位寄存器
 * @param  base   寄存器基地址
 * @param  offset 字节偏移（必须 4 字节对齐）
 * @param  value  要写入的值
 *
 * @note   TX_DATA 仅在 pstrb[0]=1 时压入 FIFO；CTRL.SOFT_RST 需要 pstrb[3]。
 *         32 位全字写满足上述要求。
 */
static inline void uart_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 UART 句柄
 * @param  h         UART 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @param  fifo_depth 硬件参数 FIFO_DEPTH（8~128，2 的幂）
 * @return 0 成功，-1 参数错误
 */
int uart_init(uart_handle_t *h, uintptr_t base_addr, uint32_t fifo_depth);

/**
 * @brief  执行软复位（写 CTRL.SOFT_RST = 1）
 * @param  h UART 句柄指针
 *
 * @details 清除控制、配置、中断和两个 FIFO；复位后必须重新初始化。
 */
void uart_soft_reset(uart_handle_t *h);

/**
 * @brief  配置波特率、校验和停止位
 * @param  h          UART 句柄指针
 * @param  baud_rate  目标波特率（Hz），需满足 2 <= floor(fclk/baud) <= 1024
 * @param  parity     校验：UART_PARITY_NONE / ODD / EVEN
 * @param  two_stop   true=2 个停止位，false=1 个停止位
 *
 * @note   应在收发器空闲时修改。写入后串行除法器需约 32 个 PCLK 完成计算，
 *         使能 UART 前至少等待 40 个 PCLK。
 */
void uart_config(uart_handle_t *h, uint32_t baud_rate, uart_parity_t parity, bool two_stop);

/**
 * @brief  使能/关闭接收器
 * @param  h    UART 句柄指针
 * @param  en   true 持续使能；false 关闭并复位接收状态机（不清空 RX FIFO）
 */
void uart_rx_enable(uart_handle_t *h, bool en);

/**
 * @brief  使能/关闭发送器
 * @param  h    UART 句柄指针
 * @param  en   true 允许 TX FIFO 自动发送；false 停止装载后续字节
 */
void uart_tx_enable(uart_handle_t *h, bool en);

/**
 * @brief  清空 RX FIFO
 * @param  h UART 句柄指针
 *
 * @note   命令为 W1P；本函数保留 RX_EN/TX_EN 状态。
 */
void uart_rx_clear(uart_handle_t *h);

/**
 * @brief  清空 TX FIFO
 * @param  h UART 句柄指针
 *
 * @note   命令为 W1P；本函数保留 RX_EN/TX_EN 状态。
 */
void uart_tx_clear(uart_handle_t *h);

/* =========================================================================
 * 7. 发送
 * ========================================================================= */

/**
 * @brief  阻塞发送一个字节（轮询 TX_FULL）
 * @param  h     UART 句柄指针
 * @param  value 待发送字节
 */
void uart_putc(uart_handle_t *h, uint8_t value);

/**
 * @brief  发送一段数据（逐字节轮询）
 * @param  h     UART 句柄指针
 * @param  data  数据指针
 * @param  len   字节数
 */
void uart_write(uart_handle_t *h, const uint8_t *data, size_t len);

/**
 * @brief  等待整个发送通道空闲（TX_LEVEL==0 且 TX_BUSY==0）
 * @param  h UART 句柄指针
 *
 * @note   TX_EMPTY=1 时仍可能有一个字节正在串行发送，必须结合 TX_BUSY。
 */
void uart_flush(uart_handle_t *h);

/**
 * @brief  向 TX FIFO 写入一个字节（非阻塞，需先确认未满）
 * @param  h     UART 句柄指针
 * @param  value 待发送字节
 */
void uart_tx_put(uart_handle_t *h, uint8_t value);

/* =========================================================================
 * 8. 接收
 * ========================================================================= */

/**
 * @brief  批量读取 RX FIFO（同步 FIFO 预取流程）
 * @param  h      UART 句柄指针
 * @param  buffer 接收缓冲区
 * @param  capacity 缓冲区容量
 * @return 实际读取字节数
 *
 * @details 只读取进入函数时已存在的数据：
 *          1. 保存 RX_LEVEL 数量 N；
 *          2. 若 N=0 直接返回；
 *          3. 预取一次 RX_DATA 并丢弃；
 *          4. 再读取 N 次。
 */
size_t uart_read_snapshot(uart_handle_t *h, uint8_t *buffer, size_t capacity);

/**
 * @brief  读取接收状态寄存器原始值
 * @param  h UART 句柄指针
 * @return RX_STATUS 值
 */
uint32_t uart_read_rx_status(uart_handle_t *h);

/**
 * @brief  读取发送状态寄存器原始值
 * @param  h UART 句柄指针
 * @return TX_STATUS 值
 */
uint32_t uart_read_tx_status(uart_handle_t *h);

/**
 * @brief  获取 RX FIFO 当前字节数
 * @param  h UART 句柄指针
 * @return RX_LEVEL
 */
uint32_t uart_rx_level(uart_handle_t *h);

/**
 * @brief  获取 TX FIFO 当前字节数
 * @param  h UART 句柄指针
 * @return TX_LEVEL
 */
uint32_t uart_tx_level(uart_handle_t *h);

/**
 * @brief  判断发送通道是否空闲
 * @param  h UART 句柄指针
 * @return true 空闲，false 忙
 */
bool uart_tx_idle(uart_handle_t *h);

/* =========================================================================
 * 9. 中断配置
 * ========================================================================= */

/**
 * @brief  配置 UART 中断（总使能 + 条件 + 阈值）
 * @param  h         UART 句柄指针
 * @param  enable    true 使能中断输出（INT_EN）
 * @param  type      中断条件（uart_int_type_t）
 * @param  rx_threshold RX 阈值（建议 1..FIFO_DEPTH）
 * @param  tx_threshold TX 阈值（建议 1..FIFO_DEPTH）
 *
 * @note   本函数会重写完整 INTERRUPT 寄存器并使 INT_FLAG 位为零。
 *         中断源是电平条件，ISR 返回前应消除条件或关闭中断。
 */
void uart_int_config(uart_handle_t *h, bool enable, uart_int_type_t type,
                     uint32_t rx_threshold, uint32_t tx_threshold);

/**
 * @brief  清除中断标志（INT_FLAG）
 * @param  h UART 句柄指针
 *
 * @note   清除时应重写完整 INTERRUPT 配置并令位 4 为零。若触发条件仍成立，
 *         interrupt 会继续保持有效，INT_FLAG 也会再次置位。
 */
void uart_int_clear_flag(uart_handle_t *h);

#ifdef __cplusplus
}
#endif

#endif /* __UART_H__ */
