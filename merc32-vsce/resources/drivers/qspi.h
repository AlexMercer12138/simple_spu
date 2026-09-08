/**
 * @file    qspi.h
 * @brief   APB QSPI 主机控制器裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持 SPI Mode 0~3、MSB/LSB
 *          优先、单/双/四线命令-地址-模式位-Dummy-数据事务模板、非字节
 *          对齐头部、TX/RX FIFO 与阈值中断管理。
 *
 * 对应 RTL: apb_qspi.v
 * 对应手册: apb_qspi_manual.md
 */

#ifndef __QSPI_H__
#define __QSPI_H__

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>  /* size_t */

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 * ========================================================================= */

#define QSPI_REG_CTRL           0x00U  /**< 使能与控制命令（R/W、W1P）  */
#define QSPI_REG_STATUS         0x04U  /**< 控制器运行状态（R）          */
#define QSPI_REG_CLOCK_CFG      0x08U  /**< 串行时钟与片选时序（R/W）    */
#define QSPI_REG_TRANSFER_CFG   0x0CU  /**< 数据阶段与片选配置（R/W）    */
#define QSPI_REG_PHASE_CFG      0x10U  /**< 头部阶段与 Dummy 配置（R/W） */
#define QSPI_REG_LENGTH_CFG     0x14U  /**< 数据阶段字节数（R/W）        */
#define QSPI_REG_COMMAND_DATA   0x18U  /**< 命令阶段数据（R/W）          */
#define QSPI_REG_ADDRESS_DATA   0x1CU  /**< 地址阶段数据（R/W）          */
#define QSPI_REG_MODE_DATA      0x20U  /**< 模式位阶段数据（R/W）        */
#define QSPI_REG_TX_DATA        0x24U  /**< TX FIFO 入队（W）            */
#define QSPI_REG_RX_DATA        0x28U  /**< RX FIFO 出队（R/pop）        */
#define QSPI_REG_FIFO_STATUS    0x2CU  /**< FIFO 水位与状态（R）         */
#define QSPI_REG_FIFO_THRESHOLD 0x30U  /**< FIFO 中断阈值（R/W）         */
#define QSPI_REG_IRQ_STATUS     0x34U  /**< 粘滞中断状态（R/W1C）        */
#define QSPI_REG_IRQ_ENABLE     0x38U  /**< 中断输出使能（R/W）          */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* CTRL */
#define QSPI_CTRL_ENABLE       (1UL << 0)   /**< 允许合法事务启动（R/W）  */
#define QSPI_CTRL_START        (1UL << 1)   /**< 校验并启动事务（W1P）    */
#define QSPI_CTRL_ABORT        (1UL << 2)   /**< 请求受控终止（W1P）      */
#define QSPI_CTRL_TX_CLEAR     (1UL << 3)   /**< 空闲时清空 TX FIFO（W1P）*/
#define QSPI_CTRL_RX_CLEAR     (1UL << 4)   /**< 空闲时清空 RX FIFO（W1P）*/
#define QSPI_CTRL_SOFT_RESET   (1UL << 31)  /**< 复位整个外设（W1P，需 byte3 strobe） */

/* STATUS */
#define QSPI_STATUS_BUSY        (1UL << 0)   /**< 正在执行事务或片选间隔 */
#define QSPI_STATUS_ACTIVE_PHASE_SHIFT 1U
#define QSPI_STATUS_ACTIVE_PHASE_MASK  (0xFUL << 1)
#define QSPI_STATUS_TX_STALLED  (1UL << 5)
#define QSPI_STATUS_RX_STALLED  (1UL << 6)
#define QSPI_STATUS_ACTIVE_CS_SHIFT  7U
#define QSPI_STATUS_ACTIVE_CS_MASK   (0xFUL << 7)

/* CLOCK_CFG */
#define QSPI_CLOCK_HALF_PERIOD_MASK  0xFFFFU      /**< [15:0] 半周期减 1 */
#define QSPI_CLOCK_CS_SETUP_SHIFT    16U
#define QSPI_CLOCK_CS_SETUP_MASK     (0xFFUL << 16) /**< [23:16] */
#define QSPI_CLOCK_CS_HOLD_SHIFT     24U
#define QSPI_CLOCK_CS_HOLD_MASK      (0xFUL << 24)  /**< [27:24] */
#define QSPI_CLOCK_CS_HIGH_SHIFT     28U
#define QSPI_CLOCK_CS_HIGH_MASK      (0xFUL << 28)  /**< [31:28] */

/* TRANSFER_CFG */
#define QSPI_TRANSFER_DATA_WIDTH_MASK 0x3U        /**< [1:0]   */
#define QSPI_TRANSFER_DATA_DIR_SHIFT  2U
#define QSPI_TRANSFER_DATA_DIR_MASK   (0x3UL << 2) /**< [3:2]  */
#define QSPI_TRANSFER_SPI_MODE_SHIFT  4U
#define QSPI_TRANSFER_SPI_MODE_MASK   (0x3UL << 4) /**< [5:4]  */
#define QSPI_TRANSFER_LSB_FIRST       (1UL << 6)   /**< [6]    */
#define QSPI_TRANSFER_SINGLE_RX_D1    (1UL << 7)   /**< [7]    */
#define QSPI_TRANSFER_CS_SELECT_SHIFT 8U
#define QSPI_TRANSFER_CS_SELECT_MASK  (0xFUL << 8) /**< [11:8] */

/* PHASE_CFG */
#define QSPI_PHASE_COMMAND_BITS_MASK  0x3FU        /**< [5:0]    */
#define QSPI_PHASE_COMMAND_WIDTH_SHIFT 6U
#define QSPI_PHASE_COMMAND_WIDTH_MASK (0x3UL << 6) /**< [7:6]    */
#define QSPI_PHASE_ADDRESS_BITS_SHIFT 8U
#define QSPI_PHASE_ADDRESS_BITS_MASK  (0x3FUL << 8) /**< [13:8]  */
#define QSPI_PHASE_ADDRESS_WIDTH_SHIFT 14U
#define QSPI_PHASE_ADDRESS_WIDTH_MASK (0x3UL << 14) /**< [15:14] */
#define QSPI_PHASE_MODE_BITS_SHIFT    16U
#define QSPI_PHASE_MODE_BITS_MASK     (0x3FUL << 16) /**< [21:16] */
#define QSPI_PHASE_MODE_WIDTH_SHIFT   22U
#define QSPI_PHASE_MODE_WIDTH_MASK    (0x3UL << 22) /**< [23:22] */
#define QSPI_PHASE_DUMMY_CYCLES_SHIFT 24U
#define QSPI_PHASE_DUMMY_CYCLES_MASK  (0xFFUL << 24) /**< [31:24] */

/* LENGTH_CFG */
#define QSPI_LENGTH_DATA_BYTES_MASK   0xFFFFU       /**< [15:0] */

/* FIFO_STATUS */
#define QSPI_FIFO_TX_LEVEL_MASK  0xFFU          /**< [7:0]   */
#define QSPI_FIFO_RX_LEVEL_SHIFT 8U
#define QSPI_FIFO_RX_LEVEL_MASK  (0xFFUL << 8)  /**< [15:8]  */
#define QSPI_FIFO_TX_EMPTY       (1UL << 16)
#define QSPI_FIFO_TX_FULL        (1UL << 17)
#define QSPI_FIFO_RX_EMPTY       (1UL << 18)
#define QSPI_FIFO_RX_FULL        (1UL << 19)
#define QSPI_FIFO_TX_STALLED     (1UL << 20)
#define QSPI_FIFO_RX_STALLED     (1UL << 21)

/* FIFO_THRESHOLD */
#define QSPI_THRESHOLD_TX_MASK   0xFFU          /**< [7:0]   */
#define QSPI_THRESHOLD_RX_SHIFT  8U
#define QSPI_THRESHOLD_RX_MASK   (0xFFUL << 8)  /**< [15:8]  */

/* IRQ_STATUS / IRQ_ENABLE */
#define QSPI_IRQ_TRANSFER_DONE   (1UL << 0)
#define QSPI_IRQ_ABORTED         (1UL << 1)
#define QSPI_IRQ_CONFIG_ERROR    (1UL << 2)
#define QSPI_IRQ_TX_OVERFLOW     (1UL << 3)
#define QSPI_IRQ_TX_THRESHOLD    (1UL << 4)
#define QSPI_IRQ_RX_THRESHOLD    (1UL << 5)
#define QSPI_IRQ_ALL             (0x3FU)

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 数据阶段线宽
 */
typedef enum {
    QSPI_WIDTH_SINGLE = 0U,  /**< 单线  */
    QSPI_WIDTH_DUAL   = 1U,  /**< 双线  */
    QSPI_WIDTH_QUAD   = 2U,  /**< 四线  */
} qspi_data_width_t;

/**
 * @brief 数据阶段方向
 */
typedef enum {
    QSPI_DIR_NONE       = 0U,  /**< 无数据         */
    QSPI_DIR_SEND       = 1U,  /**< 只发送         */
    QSPI_DIR_RECEIVE    = 2U,  /**< 只接收         */
    QSPI_DIR_FULL_DUPLEX = 3U  /**< 单线全双工     */
} qspi_data_dir_t;

/**
 * @brief 头部阶段线宽
 */
typedef enum {
    QSPI_HDR_SINGLE = 0U,  /**< 单线 */
    QSPI_HDR_DUAL   = 1U,  /**< 双线 */
    QSPI_HDR_QUAD   = 2U   /**< 四线 */
} qspi_hdr_width_t;

/* =========================================================================
 * 4. 驱动句柄
 * ========================================================================= */

/**
 * @brief QSPI 驱动句柄
 *
 * cs_count 与 fifo_depth 保存硬件参数，用于索引/长度校验。
 */
typedef struct {
    volatile uint32_t *base;   /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
    uint32_t           cs_count;  /**< 片选数量（硬件参数 CS_COUNT，1~16）    */
    uint32_t           fifo_depth; /**< TX/RX FIFO 深度（硬件参数，2 的幂）   */
} qspi_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

static inline uint32_t qspi_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

static inline void qspi_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 QSPI 句柄
 * @param  h         QSPI 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @param  cs_count  硬件参数 CS_COUNT（1~16）
 * @param  fifo_depth 硬件参数 FIFO_DEPTH（8~128，2 的幂）
 * @return 0 成功，-1 参数错误
 */
int qspi_init(qspi_handle_t *h, uintptr_t base_addr, uint32_t cs_count, uint32_t fifo_depth);

/**
 * @brief  执行软复位
 * @param  h QSPI 句柄指针
 * @details 清除配置、FIFO 指针与水位、中断状态和协议引擎状态；
 *          复位不会产生事务完成中断。
 */
void qspi_soft_reset(qspi_handle_t *h);

/* =========================================================================
 * 7. 配置
 * ========================================================================= */

/**
 * @brief  配置时钟与片选时序
 * @param  h           QSPI 句柄指针
 * @param  half_period SCLK 半周期减 1（SCLK = PCLK / (2*(HALF_PERIOD+1))）
 * @param  cs_setup    片选有效到开始串行活动的 PCLK 周期数
 * @param  cs_hold     最后 SCLK 边沿到片选无效的 PCLK 周期数
 * @param  cs_high     片选无效后的 PCLK 周期数
 */
void qspi_clock_config(qspi_handle_t *h, uint32_t half_period,
                       uint32_t cs_setup, uint32_t cs_hold, uint32_t cs_high);

/**
 * @brief  配置数据阶段与片选
 * @param  h          QSPI 句柄指针
 * @param  data_width 数据线宽
 * @param  data_dir   数据方向
 * @param  spi_mode   SPI Mode 0~3
 * @param  lsb_first  true=LSB 优先
 * @param  single_rx_d1 单线接收时 true 从 D1 采样
 * @param  cs_select  片选索引
 */
void qspi_transfer_config(qspi_handle_t *h, qspi_data_width_t data_width,
                          qspi_data_dir_t data_dir, uint32_t spi_mode,
                          bool lsb_first, bool single_rx_d1, uint32_t cs_select);

/**
 * @brief  配置头部阶段与 Dummy 周期
 * @param  h             QSPI 句柄指针
 * @param  cmd_bits      命令长度（0~32 bit，0 表示跳过）
 * @param  cmd_width     命令线宽
 * @param  addr_bits     地址长度（0~32 bit）
 * @param  addr_width    地址线宽
 * @param  mode_bits     模式位长度（0~32 bit）
 * @param  mode_width    模式位线宽
 * @param  dummy_cycles  Dummy SCLK 周期数（0~255）
 */
void qspi_phase_config(qspi_handle_t *h, uint32_t cmd_bits, qspi_hdr_width_t cmd_width,
                       uint32_t addr_bits, qspi_hdr_width_t addr_width,
                       uint32_t mode_bits, qspi_hdr_width_t mode_width,
                       uint32_t dummy_cycles);

/**
 * @brief  配置数据阶段字节数
 * @param  h          QSPI 句柄指针
 * @param  data_bytes 数据字节数（0~65535，0 省略数据阶段）
 */
void qspi_length_config(qspi_handle_t *h, uint32_t data_bytes);

/**
 * @brief  写入头部数据寄存器
 * @param  h      QSPI 句柄指针
 * @param  cmd    命令阶段数据（仅低 COMMAND_BITS 位有效）
 * @param  addr   地址阶段数据（仅低 ADDRESS_BITS 位有效）
 * @param  mode   模式位阶段数据（仅低 MODE_BITS 位有效）
 */
void qspi_header_data(qspi_handle_t *h, uint32_t cmd, uint32_t addr, uint32_t mode);

/* =========================================================================
 * 8. 事务执行
 * ========================================================================= */

/**
 * @brief  向 TX FIFO 压入一个字节
 * @param  h     QSPI 句柄指针
 * @param  value 字节
 * @return 0 成功，-1 FIFO 已满（置位 IRQ_STATUS.TX_OVERFLOW）
 */
int qspi_tx_put(qspi_handle_t *h, uint8_t value);

/**
 * @brief  从 RX FIFO 读取一个字节
 * @param  h QSPI 句柄指针
 * @return 字节；空 FIFO 读取返回 0 且不出队
 */
uint8_t qspi_rx_get(qspi_handle_t *h);

/**
 * @brief  启动一笔事务
 * @param  h QSPI 句柄指针
 * @return 0 已接受，-1 非法启动（置位 CONFIG_ERROR）
 *
 * @note   调用前应确认 STATUS.BUSY=0 并完成全部配置与 TX 预装。
 */
int qspi_start(qspi_handle_t *h);

/**
 * @brief  等待事务结束（轮询 TRANSFER_DONE）
 * @param  h QSPI 句柄指针
 * @return 0 正常结束，-1 被中止
 */
int qspi_wait_done(qspi_handle_t *h);

/**
 * @brief  检查控制器是否忙
 * @param  h QSPI 句柄指针
 * @return true 忙
 */
bool qspi_busy(qspi_handle_t *h);

/* =========================================================================
 * 9. FIFO 与中断
 * ========================================================================= */

/**
 * @brief  读取 FIFO_STATUS 寄存器
 * @param  h QSPI 句柄指针
 * @return FIFO_STATUS 值
 */
uint32_t qspi_read_fifo_status(qspi_handle_t *h);

/**
 * @brief  获取 TX 字节数
 * @param  h QSPI 句柄指针
 * @return TX_LEVEL
 */
uint32_t qspi_tx_level(qspi_handle_t *h);

/**
 * @brief  获取 RX 字节数
 * @param  h QSPI 句柄指针
 * @return RX_LEVEL
 */
uint32_t qspi_rx_level(qspi_handle_t *h);

/**
 * @brief  设置 FIFO 阈值
 * @param  h            QSPI 句柄指针
 * @param  tx_threshold TX 低水位（TX_LEVEL <= 此值时事件）
 * @param  rx_threshold RX 高水位（RX_LEVEL >= 此值时事件）
 */
void qspi_fifo_threshold(qspi_handle_t *h, uint32_t tx_threshold, uint32_t rx_threshold);

/**
 * @brief  读取中断状态（粘滞原始位）
 * @param  h QSPI 句柄指针
 * @return IRQ_STATUS 值
 */
uint32_t qspi_irq_read_status(qspi_handle_t *h);

/**
 * @brief  按掩码使能中断
 * @param  h    QSPI 句柄指针
 * @param  mask 中断掩码
 */
void qspi_irq_enable(qspi_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码清除中断状态（W1C）
 * @param  h    QSPI 句柄指针
 * @param  mask 要清除的状态位
 *
 * @note   阈值中断应先解除对应水位条件再清位，否则立即再次置位。
 */
void qspi_irq_clear_status(qspi_handle_t *h, uint32_t mask);

#ifdef __cplusplus
}
#endif

#endif /* __QSPI_H__ */
