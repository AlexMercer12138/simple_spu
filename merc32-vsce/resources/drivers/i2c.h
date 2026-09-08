/**
 * @file    i2c.h
 * @brief   APB I2C 裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持互斥的主机/从机模式：
 *          主机连续写/连续读/写后 RESTART 读，从机 7 位地址匹配、SCL 时钟
 *          拉伸、FIFO 阈值与 14 路粘滞中断管理。
 *
 * 对应 RTL: apb_i2c.v
 * 对应手册: apb_i2c_manual.md
 */

#ifndef __I2C_H__
#define __I2C_H__

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>  /* size_t */

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 * ========================================================================= */

#define I2C_REG_CTRL              0x00U  /**< 使能、模式和控制命令（R/W、W1P）*/
#define I2C_REG_MASTER_CMD        0x04U  /**< 主机命令、地址和长度（R/W）    */
#define I2C_REG_TIMING            0x08U  /**< SCL 预分频值（R/W）            */
#define I2C_REG_STATUS            0x0CU  /**< 总线/协议状态（R）             */
#define I2C_REG_TX_DATA           0x10U  /**< TX FIFO 压入（W，读返回 0）    */
#define I2C_REG_RX_DATA           0x14U  /**< RX FIFO 同步读端口（R/POP）    */
#define I2C_REG_FIFO_STATUS       0x18U  /**< 两个 FIFO 数据量和状态（R）    */
#define I2C_REG_SLAVE_CFG         0x1CU  /**< 7 位从机地址（R/W）            */
#define I2C_REG_STRETCH_TIMEOUT   0x20U  /**< 等待超时周期数（R/W）          */
#define I2C_REG_IRQ_STATUS        0x24U  /**< 粘滞中断状态（R/W1C）          */
#define I2C_REG_IRQ_ENABLE        0x28U  /**< 中断使能（R/W）                */
#define I2C_REG_IRQ_THRESHOLD     0x2CU  /**< 从机 FIFO 阈值（R/W）          */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* CTRL */
#define I2C_CTRL_ENABLE       (1UL << 0)  /**< 使能协议内核（R/W）          */
#define I2C_CTRL_MASTER_MODE  (1UL << 1)  /**< 1=主机，0=从机（R/W）        */
#define I2C_CTRL_START        (1UL << 2)  /**< 校验并启动主机命令（W1P）    */
#define I2C_CTRL_ABORT        (1UL << 3)  /**< 终止主机事务（W1P）          */
#define I2C_CTRL_TX_CLR       (1UL << 4)  /**< 清空 TX FIFO（W1P）          */
#define I2C_CTRL_RX_CLR       (1UL << 5)  /**< 清空 RX FIFO（W1P）          */
#define I2C_CTRL_SOFT_RST     (1UL << 31) /**< 同步软复位（W1P，需 byte3 strobe） */
#define I2C_CTRL_EN_MODE_MASK (0x3UL)     /**< ENABLE/MASTER_MODE 掩码 [1:0] */

/* MASTER_CMD */
#define I2C_CMD_OP_SHIFT      0U
#define I2C_CMD_OP_MASK       (0x3UL << 0)   /**< OP [1:0]                 */
#define I2C_CMD_TARGET_SHIFT  8U
#define I2C_CMD_TARGET_MASK   (0x7FUL << 8)  /**< TARGET_ADDR [14:8]       */
#define I2C_CMD_TX_LEN_SHIFT  16U
#define I2C_CMD_TX_LEN_MASK   (0xFFUL << 16) /**< TX_LEN [23:16]          */
#define I2C_CMD_RX_LEN_SHIFT  24U
#define I2C_CMD_RX_LEN_MASK   (0xFFUL << 24) /**< RX_LEN [31:24]          */

/* TIMING */
#define I2C_TIMING_PRESCALE_MASK 0xFFFFU  /**< SCL_PRESCALE [15:0] */

/* STATUS */
#define I2C_STATUS_MASTER_BUSY  (1UL << 0)  /**< 主机命令执行中           */
#define I2C_STATUS_BUS_BUSY     (1UL << 1)  /**< 活动总线事务             */
#define I2C_STATUS_SLAVE_SELECTED (1UL << 2) /**< 从机地址已匹配          */
#define I2C_STATUS_SLAVE_READ   (1UL << 3)  /**< 从机事务方向为读         */
#define I2C_STATUS_STRETCH_ACTIVE (1UL << 4) /**< 从机拉低 SCL 等待数据   */
#define I2C_STATUS_TX_EMPTY     (1UL << 5)
#define I2C_STATUS_TX_FULL      (1UL << 6)
#define I2C_STATUS_RX_EMPTY     (1UL << 7)
#define I2C_STATUS_RX_FULL      (1UL << 8)
#define I2C_STATUS_LAST_TX_SHIFT 16U
#define I2C_STATUS_LAST_RX_SHIFT 24U

/* FIFO_STATUS */
#define I2C_FIFO_TX_LEVEL_MASK  0xFFU        /**< TX_LEVEL [7:0]      */
#define I2C_FIFO_RX_LEVEL_SHIFT 8U
#define I2C_FIFO_RX_LEVEL_MASK  (0xFFUL << 8) /**< RX_LEVEL [15:8]    */
#define I2C_FIFO_TX_EMPTY       (1UL << 16)
#define I2C_FIFO_TX_FULL        (1UL << 17)
#define I2C_FIFO_RX_EMPTY       (1UL << 18)
#define I2C_FIFO_RX_FULL        (1UL << 19)

/* SLAVE_CFG */
#define I2C_SLAVE_ADDR_MASK     0x7FU  /**< SLAVE_ADDR [6:0] */

/* IRQ_STATUS / IRQ_ENABLE 共用低 14 位布局 */
#define I2C_IRQ_MASTER_DONE           (1UL << 0)
#define I2C_IRQ_ADDR_NACK             (1UL << 1)
#define I2C_IRQ_DATA_NACK             (1UL << 2)
#define I2C_IRQ_ARBITRATION_LOST      (1UL << 3)
#define I2C_IRQ_MASTER_TIMEOUT        (1UL << 4)
#define I2C_IRQ_CMD_ERROR             (1UL << 5)
#define I2C_IRQ_SLAVE_RX_THRESHOLD    (1UL << 6)
#define I2C_IRQ_SLAVE_TX_THRESHOLD    (1UL << 7)
#define I2C_IRQ_SLAVE_RX_DONE         (1UL << 8)
#define I2C_IRQ_SLAVE_READ_DONE       (1UL << 9)
#define I2C_IRQ_SLAVE_RX_OVERFLOW     (1UL << 10)
#define I2C_IRQ_SLAVE_TX_UNDERFLOW    (1UL << 11)
#define I2C_IRQ_SLAVE_STRETCH_TIMEOUT (1UL << 12)
#define I2C_IRQ_BUS_ERROR             (1UL << 13)
#define I2C_IRQ_ALL                   (0x3FFFU)
/** 主机错误位集合：MASTER_DONE 可能伴随的错误 */
#define I2C_MASTER_ERROR_MASK (I2C_IRQ_ADDR_NACK | I2C_IRQ_DATA_NACK | \
                               I2C_IRQ_ARBITRATION_LOST | I2C_IRQ_MASTER_TIMEOUT | \
                               I2C_IRQ_CMD_ERROR | I2C_IRQ_BUS_ERROR)

/* IRQ_THRESHOLD */
#define I2C_THRESHOLD_RX_MASK  0xFFU         /**< RX_THRESHOLD [7:0]     */
#define I2C_THRESHOLD_TX_SHIFT 8U
#define I2C_THRESHOLD_TX_MASK  (0xFFUL << 8) /**< TX_THRESHOLD [15:8]    */

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 主机命令操作码
 */
typedef enum {
    I2C_OP_WRITE       = 0U,  /**< 连续写                   */
    I2C_OP_READ        = 1U,  /**< 连续读                   */
    I2C_OP_WRITE_READ  = 2U,  /**< 写后 RESTART 再读        */
    I2C_OP_INVALID     = 3U   /**< 非法                     */
} i2c_op_t;

/* =========================================================================
 * 4. 驱动句柄
 * ========================================================================= */

/**
 * @brief I2C 驱动句柄
 *
 * fifo_depth 保存硬件参数 FIFO_DEPTH，用于长度校验。
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
    uint32_t           fifo_depth; /**< TX/RX FIFO 深度（硬件参数，2 的幂） */
} i2c_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

static inline uint32_t i2c_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

static inline void i2c_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 I2C 句柄
 * @param  h         I2C 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @param  fifo_depth 硬件参数 FIFO_DEPTH（8~128，2 的幂）
 * @return 0 成功，-1 参数错误
 */
int i2c_init(i2c_handle_t *h, uintptr_t base_addr, uint32_t fifo_depth);

/**
 * @brief  执行软复位
 * @param  h I2C 句柄指针
 * @details 同步复位整个 I2C 外设（寄存器、FIFO、协议内核、中断状态）。
 */
void i2c_soft_reset(i2c_handle_t *h);

/**
 * @brief  设置 I2C 时钟预分频
 * @param  h         I2C 句柄指针
 * @param  prescale  SCL_PRESCALE 值
 *
 * @note   SCL_FREQ = SYS_CLK_FREQ / (4 * (SCL_PRESCALE + 1))。
 *         新值在下一条被接受的主机命令中生效。
 */
void i2c_set_timing(i2c_handle_t *h, uint32_t prescale);

/**
 * @brief  设置等待超时周期数
 * @param  h     I2C 句柄指针
 * @param  cycles PCLK 周期数（0 表示立即超时，无"无限等待"编码）
 */
void i2c_set_stretch_timeout(i2c_handle_t *h, uint32_t cycles);

/* =========================================================================
 * 7. 模式与使能
 * ========================================================================= */

/**
 * @brief  选择主机或从机模式（外设须处于关闭状态）
 * @param  h     I2C 句柄指针
 * @param  master true=主机，false=从机
 *
 * @note   只有写入发生前 ENABLE=0 时模式变化才被接受。成功切换会复位
 *         两个协议内核并清空两个 FIFO。已使能时切换会置位 CMD_ERROR。
 *         本函数保持外设关闭，需随后调用 i2c_enable()。
 */
void i2c_set_mode(i2c_handle_t *h, bool master);

/**
 * @brief  使能/关闭 I2C 外设
 * @param  h   I2C 句柄指针
 * @param  en  true 使能当前所选协议内核
 */
void i2c_enable(i2c_handle_t *h, bool en);

/**
 * @brief  读取当前使能与模式
 * @param  h I2C 句柄指针
 * @return CTRL[1:0]：bit0=ENABLE，bit1=MASTER_MODE
 */
uint32_t i2c_get_enable_mode(i2c_handle_t *h);

/* =========================================================================
 * 8. 主机操作
 * ========================================================================= */

/**
 * @brief  主机写命令
 * @param  h       I2C 句柄指针
 * @param  target  7 位目标地址（不含 R/W 位）
 * @param  data    发送数据
 * @param  len     字节数（1..FIFO_DEPTH）
 * @return 0 成功，-1 参数错误
 *
 * @note   本函数执行完整流程：清旧状态 -> 配置 -> 装入 TX -> START ->
 *         等待 MASTER_DONE -> 检查错误。属于阻塞调用。
 */
int i2c_master_write(i2c_handle_t *h, uint8_t target, const uint8_t *data, size_t len);

/**
 * @brief  主机读命令
 * @param  h       I2C 句柄指针
 * @param  target  7 位目标地址（不含 R/W 位）
 * @param  buffer  接收缓冲区
 * @param  len     字节数（1..FIFO_DEPTH）
 * @return 0 成功，-1 参数错误或主机错误
 *
 * @note   阻塞调用，按同步 FIFO 流程读取 RX 数据。
 */
int i2c_master_read(i2c_handle_t *h, uint8_t target, uint8_t *buffer, size_t len);

/**
 * @brief  主机写后读命令（写数据后 RESTART 再读）
 * @param  h         I2C 句柄指针
 * @param  target    7 位目标地址
 * @param  wdata     写阶段数据
 * @param  wlen      写字节数
 * @param  rbuffer   读阶段缓冲区
 * @param  rlen      读字节数
 * @return 0 成功，-1 参数错误或主机错误
 */
int i2c_master_write_read(i2c_handle_t *h, uint8_t target,
                          const uint8_t *wdata, size_t wlen,
                          uint8_t *rbuffer, size_t rlen);

/**
 * @brief  检查主机错误位
 * @param  h     I2C 句柄指针
 * @param  status 已保存的 IRQ_STATUS 值
 * @return true 存在主机错误
 */
bool i2c_master_error(const i2c_handle_t *h, uint32_t status);

/**
 * @brief  终止正在执行的主机事务（ABORT）
 * @param  h I2C 句柄指针
 *
 * @note   仅用于仍在活动的主机事务；写入时保持 ENABLE=1 和 MASTER_MODE=1。
 *         调用后等待 STATUS.MASTER_BUSY 清零。
 */
void i2c_master_abort(i2c_handle_t *h);

/* =========================================================================
 * 9. 从机配置
 * ========================================================================= */

/**
 * @brief  设置 7 位从机地址
 * @param  h    I2C 句柄指针
 * @param  addr 7 位地址（不含 R/W 位）
 *
 * @note   地址只能在 ENABLE=0 时修改。已使能时写入不同地址会被忽略并
 *         置位 CMD_ERROR。
 */
void i2c_slave_set_addr(i2c_handle_t *h, uint8_t addr);

/**
 * @brief  设置从机 FIFO 阈值
 * @param  h            I2C 句柄指针
 * @param  rx_threshold RX 数据量高水位
 * @param  tx_threshold TX 数据量低水位
 *
 * @note   复位值 RX=1、TX=0。复位后空 TX FIFO 在从机使能后立即满足
 *         SLAVE_TX_THRESHOLD，可用于请求软件装入首批响应数据。
 */
void i2c_slave_set_threshold(i2c_handle_t *h, uint32_t rx_threshold, uint32_t tx_threshold);

/**
 * @brief  向 TX FIFO 压入一个从机响应字节
 * @param  h     I2C 句柄指针
 * @param  value 字节
 * @return 0 成功，-1 FIFO 已满（置位 CMD_ERROR）
 */
int i2c_slave_tx_put(i2c_handle_t *h, uint8_t value);

/**
 * @brief  批量读取从机 RX 数据（同步 FIFO 预取流程）
 * @param  h      I2C 句柄指针
 * @param  buffer 缓冲区
 * @param  capacity 容量
 * @return 实际读取字节数
 */
size_t i2c_slave_read_snapshot(i2c_handle_t *h, uint8_t *buffer, size_t capacity);

/* =========================================================================
 * 10. FIFO 与状态查询
 * ========================================================================= */

/**
 * @brief  读取 FIFO_STATUS 寄存器
 * @param  h I2C 句柄指针
 * @return FIFO_STATUS 值
 */
uint32_t i2c_read_fifo_status(i2c_handle_t *h);

/**
 * @brief  读取 STATUS 寄存器
 * @param  h I2C 句柄指针
 * @return STATUS 值
 */
uint32_t i2c_read_status(i2c_handle_t *h);

/**
 * @brief  获取 TX FIFO 字节数
 * @param  h I2C 句柄指针
 * @return TX_LEVEL
 */
uint32_t i2c_tx_level(i2c_handle_t *h);

/**
 * @brief  获取 RX FIFO 字节数
 * @param  h I2C 句柄指针
 * @return RX_LEVEL
 */
uint32_t i2c_rx_level(i2c_handle_t *h);

/**
 * @brief  判断主机是否忙
 * @param  h I2C 句柄指针
 * @return true 忙
 */
bool i2c_master_busy(i2c_handle_t *h);

/* =========================================================================
 * 11. 中断管理
 * ========================================================================= */

/**
 * @brief  读取中断状态（粘滞原始位）
 * @param  h I2C 句柄指针
 * @return IRQ_STATUS 低 14 位
 */
uint32_t i2c_irq_read_status(i2c_handle_t *h);

/**
 * @brief  获取已使能且待处理的中断位
 * @param  h I2C 句柄指针
 * @return IRQ_STATUS & IRQ_ENABLE
 */
uint32_t i2c_irq_get_pending(i2c_handle_t *h);

/**
 * @brief  按掩码使能中断
 * @param  h    I2C 句柄指针
 * @param  mask 中断掩码
 */
void i2c_irq_enable(i2c_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码禁用中断
 * @param  h    I2C 句柄指针
 * @param  mask 中断掩码
 */
void i2c_irq_disable(i2c_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码清除中断状态（W1C）
 * @param  h    I2C 句柄指针
 * @param  mask 要清除的状态位
 *
 * @note   若阈值/电平条件仍成立，W1C 后对应位会在下一拍再次置位，
 *         应先在清除前补充或排空 FIFO。
 */
void i2c_irq_clear_status(i2c_handle_t *h, uint32_t mask);

#ifdef __cplusplus
}
#endif

#endif /* __I2C_H__ */
