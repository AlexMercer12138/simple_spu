/**
 * @file    sdio.h
 * @brief   APB SDIO/MMC 主机控制器裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持 SD/eMMC/SDIO 命令-响应-
 *          数据事务、1/4/8-bit 总线宽度、PIO FIFO、可选自动 CMD12、
 *          R1b DAT0 busy、SDIO DAT1 中断与 10 路粘滞中断管理。
 *
 * 对应 RTL: apb_sdio.v
 * 对应手册: apb_sdio_manual.md
 */

#ifndef __SDIO_H__
#define __SDIO_H__

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>  /* size_t */

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 * ========================================================================= */

#define SDIO_REG_CTRL            0x00U  /**< 控制寄存器（R/W、W1P）         */
#define SDIO_REG_STATUS          0x04U  /**< 运行状态（R）                  */
#define SDIO_REG_CLK_CFG         0x08U  /**< SDCLK 与连续供钟（R/W）        */
#define SDIO_REG_HOST_CFG        0x0CU  /**< 总线宽度与 SDIO 配置（R/W）    */
#define SDIO_REG_CMD_CFG         0x10U  /**< 命令配置（R/W）                */
#define SDIO_REG_CMD_ARG         0x14U  /**< 命令参数（R/W）                */
#define SDIO_REG_RESP0           0x18U  /**< 响应字 0（R）                  */
#define SDIO_REG_RESP1           0x1CU  /**< 响应字 1（R）                  */
#define SDIO_REG_RESP2           0x20U  /**< 响应字 2（R）                  */
#define SDIO_REG_RESP3           0x24U  /**< 响应字 3（R）                  */
#define SDIO_REG_DATA_CFG        0x28U  /**< 块大小与块数（R/W）            */
#define SDIO_REG_CMD_TIMEOUT     0x2CU  /**< 命令响应超时（R/W）            */
#define SDIO_REG_DATA_TIMEOUT    0x30U  /**< 数据起始/写响应超时（R/W）     */
#define SDIO_REG_BUSY_TIMEOUT    0x34U  /**< DAT0 busy 超时（R/W）          */
#define SDIO_REG_TX_DATA         0x38U  /**< PIO TX 特殊写口（W）           */
#define SDIO_REG_RX_DATA         0x3CU  /**< PIO RX 特殊读/出队口（R/pop）  */
#define SDIO_REG_FIFO_STATUS     0x40U  /**< FIFO 水位与状态（R）           */
#define SDIO_REG_FIFO_THRESHOLD  0x44U  /**< FIFO 中断阈值（R/W）           */
#define SDIO_REG_IRQ_STATUS      0x48U  /**< 粘滞中断状态（R/W1C）          */
#define SDIO_REG_IRQ_ENABLE      0x4CU  /**< 中断使能（R/W）                */
#define SDIO_REG_ERROR_STATUS    0x50U  /**< 错误明细（R，只读）            */
#define SDIO_REG_TRANSFER_COUNT  0x54U  /**< 已传输块/字节数（R）           */
#define SDIO_REG_CARD_STATUS     0x58U  /**< CMD/DAT 实时电平（R）          */
#define SDIO_REG_AUTO_CMD12_RESP 0x5CU  /**< 自动 CMD12 响应（R）           */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* CTRL */
#define SDIO_CTRL_ENABLE       (1UL << 0)   /**< 允许启动和空闲连续供钟（R/W） */
#define SDIO_CTRL_START        (1UL << 1)   /**< 校验并启动（W1P）           */
#define SDIO_CTRL_ABORT        (1UL << 2)   /**< 忙时请求受控中止（W1P）     */
#define SDIO_CTRL_TX_CLEAR     (1UL << 3)   /**< 空闲时清 PIO TX FIFO（W1P） */
#define SDIO_CTRL_RX_CLEAR     (1UL << 4)   /**< 空闲时清 PIO RX FIFO（W1P） */
#define SDIO_CTRL_SOFT_RESET   (1UL << 31)  /**< 复位整个 IP（W1P，需 byte3 strobe） */

/* STATUS */
#define SDIO_STATUS_BUSY         (1UL << 0)  /**< 事务不在 IDLE             */
#define SDIO_STATUS_ACTIVE_PHASE_SHIFT 1U
#define SDIO_STATUS_ACTIVE_PHASE_MASK  (0xFUL << 1) /**< [4:1]            */
#define SDIO_STATUS_CMD_ACTIVE   (1UL << 5)
#define SDIO_STATUS_DATA_ACTIVE  (1UL << 6)
#define SDIO_STATUS_CLOCK_RUNNING (1UL << 7)
#define SDIO_STATUS_DMA_ACTIVE   (1UL << 8)
#define SDIO_STATUS_TX_STALLED   (1UL << 9)
#define SDIO_STATUS_RX_STALLED   (1UL << 10)
#define SDIO_STATUS_CARD_BUSY    (1UL << 11)
#define SDIO_STATUS_SDIO_IRQ_ACTIVE (1UL << 14)

/* CLK_CFG */
#define SDIO_CLK_HALF_PERIOD_MASK  0xFFFFU      /**< [15:0] SDCLK 半周期减 1 */
#define SDIO_CLK_CLOCK_ENABLE      (1UL << 16)  /**< 允许输出 SDCLK         */
#define SDIO_CLK_CLOCK_CONTINUOUS  (1UL << 17)  /**< 空闲时也持续供钟       */

/* HOST_CFG */
#define SDIO_HOST_BUS_WIDTH_MASK   0x3U         /**< [1:0] 0=1-bit,1=4-bit,2=8-bit */
#define SDIO_HOST_CMD_OPEN_DRAIN   (1UL << 2)   /**< CMD 高电平高阻、低电平驱动  */
#define SDIO_HOST_SDIO_IRQ_ENABLE  (1UL << 5)   /**< 空闲数据期监视 DAT1 低      */

/* CMD_CFG */
#define SDIO_CMD_INDEX_MASK        0x3FU        /**< [5:0] 命令号 0..63       */
#define SDIO_CMD_RESP_TYPE_SHIFT   6U
#define SDIO_CMD_RESP_TYPE_MASK    (0x3UL << 6) /**< [7:6] 0=无,1=48-bit,2=136-bit */
#define SDIO_CMD_RESP_CRC_CHECK    (1UL << 8)   /**< 检查响应 CRC7            */
#define SDIO_CMD_RESP_INDEX_CHECK  (1UL << 9)   /**< 48-bit 响应比对索引      */
#define SDIO_CMD_RESP_BUSY         (1UL << 10)  /**< 响应后等待 DAT0 busy     */
#define SDIO_CMD_DATA_PRESENT      (1UL << 11)  /**< 命令后启动数据阶段      */
#define SDIO_CMD_DATA_WRITE        (1UL << 12)  /**< 1=写卡，0=卡读主机      */
#define SDIO_CMD_DMA_ENABLE        (1UL << 13)  /**< 使用外部 DMA FIFO       */
#define SDIO_CMD_AUTO_CMD12        (1UL << 14)  /**< 多块数据完成后发送 CMD12 */

/* DATA_CFG */
#define SDIO_DATA_BLOCK_SIZE_MINUS1_MASK 0x7FFU       /**< [10:0] 块大小减 1 */
#define SDIO_DATA_BLOCK_COUNT_SHIFT      16U
#define SDIO_DATA_BLOCK_COUNT_MASK       (0xFFFFUL << 16) /**< [31:16] 块数 */

/* FIFO_STATUS */
#define SDIO_FIFO_TX_BYTE_LEVEL_MASK  0xFFFU          /**< [11:0]   */
#define SDIO_FIFO_RX_BYTE_LEVEL_SHIFT 12U
#define SDIO_FIFO_RX_BYTE_LEVEL_MASK  (0xFFFUL << 12) /**< [23:12]  */
#define SDIO_FIFO_TX_EMPTY            (1UL << 24)
#define SDIO_FIFO_TX_FULL             (1UL << 25)
#define SDIO_FIFO_RX_EMPTY            (1UL << 26)
#define SDIO_FIFO_RX_FULL             (1UL << 27)
#define SDIO_FIFO_TX_STALLED          (1UL << 28)
#define SDIO_FIFO_RX_STALLED          (1UL << 29)
#define SDIO_FIFO_DMA_TX_EMPTY        (1UL << 30)
#define SDIO_FIFO_DMA_RX_FULL         (1UL << 31)

/* FIFO_THRESHOLD */
#define SDIO_THRESHOLD_TX_MASK   0xFFFU           /**< TX_THRESHOLD [11:0]   */
#define SDIO_THRESHOLD_RX_SHIFT  16U
#define SDIO_THRESHOLD_RX_MASK   (0xFFFUL << 16)  /**< RX_THRESHOLD [27:16] */

/* IRQ_STATUS / IRQ_ENABLE */
#define SDIO_IRQ_CMD_DONE        (1UL << 0)
#define SDIO_IRQ_DATA_DONE       (1UL << 1)
#define SDIO_IRQ_TRANSFER_DONE   (1UL << 2)
#define SDIO_IRQ_ERROR           (1UL << 3)
#define SDIO_IRQ_ABORTED         (1UL << 4)
#define SDIO_IRQ_SDIO_INTERRUPT  (1UL << 7)
#define SDIO_IRQ_TX_THRESHOLD    (1UL << 8)
#define SDIO_IRQ_RX_THRESHOLD    (1UL << 9)
#define SDIO_IRQ_TX_OVERFLOW     (1UL << 10)
#define SDIO_IRQ_RX_UNDERFLOW    (1UL << 11)
#define SDIO_IRQ_ALL             (0xF9FUL)  /* 有效位合集（不含保留 [6:5]） */

/* ERROR_STATUS（只读，接受下一笔 START 或复位时清零） */
#define SDIO_ERR_CMD_TIMEOUT       (1UL << 0)
#define SDIO_ERR_CMD_CRC_ERROR     (1UL << 1)
#define SDIO_ERR_CMD_INDEX_ERROR   (1UL << 2)
#define SDIO_ERR_CMD_END_BIT_ERROR (1UL << 3)
#define SDIO_ERR_DATA_TIMEOUT      (1UL << 4)
#define SDIO_ERR_DATA_CRC_ERROR    (1UL << 5)
#define SDIO_ERR_DATA_END_BIT_ERROR (1UL << 6)
#define SDIO_ERR_WRITE_RESPONSE_ERROR (1UL << 7)
#define SDIO_ERR_BUSY_TIMEOUT      (1UL << 8)
#define SDIO_ERR_AUTO_CMD12_ERROR  (1UL << 9)
#define SDIO_ERR_CONFIG_ERROR      (1UL << 10)
#define SDIO_ERR_ABORTED           (1UL << 12)
#define SDIO_ERR_PHASE_SHIFT       16U
#define SDIO_ERR_PHASE_MASK        (0xFUL << 16)
#define SDIO_ERR_CMD_INDEX_SHIFT   20U
#define SDIO_ERR_CMD_INDEX_MASK    (0x3FUL << 20)

/* CARD_STATUS */
#define SDIO_CARD_CMD_LEVEL        (1UL << 2)
#define SDIO_CARD_DAT_LEVEL_SHIFT  3U
#define SDIO_CARD_DAT_LEVEL_MASK   (0xFFUL << 3)
#define SDIO_CARD_SDIO_IRQ_ACTIVE  (1UL << 11)

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 响应类型
 */
typedef enum {
    SDIO_RESP_NONE    = 0U,  /**< 无响应（如 CMD0）        */
    SDIO_RESP_48      = 1U,  /**< 48-bit 响应              */
    SDIO_RESP_136     = 2U   /**< 136-bit 响应（R2）       */
} sdio_resp_type_t;

/**
 * @brief 总线宽度
 */
typedef enum {
    SDIO_BUS_1BIT = 0U,  /**< 1-bit（DAT0）   */
    SDIO_BUS_4BIT = 1U,  /**< 4-bit（DAT3:0） */
    SDIO_BUS_8BIT = 2U   /**< 8-bit（DAT7:0） */
} sdio_bus_width_t;

/* =========================================================================
 * 4. 数据结构与驱动句柄
 * ========================================================================= */

/**
 * @brief 命令配置（CMD_CFG + CMD_ARG + 响应寄存器）
 */
typedef struct {
    uint32_t          index;       /**< 命令号 0..63                 */
    sdio_resp_type_t  resp_type;   /**< 响应类型                     */
    bool              resp_crc_check;  /**< 检查响应 CRC7            */
    bool              resp_index_check; /**< 48-bit 响应比对索引      */
    bool              resp_busy;    /**< 响应后等待 DAT0 busy（仅 48-bit）*/
    uint32_t          arg;         /**< 命令参数                     */
} sdio_cmd_t;

/**
 * @brief 数据配置（DATA_CFG + 数据方向）
 */
typedef struct {
    uint16_t block_size;   /**< 块大小（1..2048 字节） */
    uint16_t block_count;  /**< 块数（数据事务必须 1..65535） */
    bool     write;        /**< true=主机写卡，false=卡读主机 */
    bool     auto_cmd12;   /**< 多块数据完成后发送 CMD12 */
} sdio_data_t;

/**
 * @brief SDIO 驱动句柄
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
    uint32_t           fifo_depth; /**< PIO FIFO 深度（硬件参数，2 的幂）   */
    uint32_t           rx_word;    /**< 已弹出字的剩余字节，由驱动维护 */
    uint32_t           rx_remaining; /**< rx_word 中未交付的字节数 */
} sdio_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

static inline uint32_t sdio_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

static inline void sdio_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 SDIO 句柄
 * @param  h         SDIO 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @param  fifo_depth 硬件参数 FIFO_DEPTH（8..512，2 的幂）
 * @return 0 成功，-1 参数错误
 */
int sdio_init(sdio_handle_t *h, uintptr_t base_addr, uint32_t fifo_depth);

/**
 * @brief  执行软复位
 * @param  h SDIO 句柄指针
 * @details 使寄存器、FIFO、状态机和 IRQ 清零，时钟低、CMD/DAT 高阻；
 *          复位不会产生事务完成中断。
 */
void sdio_soft_reset(sdio_handle_t *h);

/* =========================================================================
 * 7. 时钟与主机配置
 * ========================================================================= */

/**
 * @brief  配置 SDCLK
 * @param  h           SDIO 句柄指针
 * @param  half_period SDCLK 半周期减 1（SDCLK = PCLK / (2*(HALF_PERIOD+1))）
 * @param  enable      true 允许输出 SDCLK
 * @param  continuous  true 空闲时也持续供钟
 */
void sdio_clock_config(sdio_handle_t *h, uint32_t half_period, bool enable, bool continuous);

/**
 * @brief  配置主机总线宽度与 SDIO 中断
 * @param  h              SDIO 句柄指针
 * @param  bus_width      总线宽度（sdio_bus_width_t）
 * @param  cmd_open_drain CMD 开漏模式
 * @param  sdio_irq_enable 使能空闲数据期 DAT1 监视
 */
void sdio_host_config(sdio_handle_t *h, sdio_bus_width_t bus_width,
                      bool cmd_open_drain, bool sdio_irq_enable);

/* =========================================================================
 * 8. 命令与数据配置
 * ========================================================================= */

/**
 * @brief  配置命令（CMD_CFG + CMD_ARG）
 * @param  h    SDIO 句柄指针
 * @param  cmd  命令配置
 */
void sdio_cmd_config(sdio_handle_t *h, const sdio_cmd_t *cmd);

/**
 * @brief  配置 PIO 数据阶段（DATA_CFG 和 CMD_CFG 数据相关位）
 * @param  h     SDIO 句柄指针
 * @param  data  数据配置
 * @note 在 sdio_cmd_config 之后调用，设置 DATA_PRESENT/方向/AUTO_CMD12 并清 DMA_ENABLE。
 */
void sdio_data_config(sdio_handle_t *h, const sdio_data_t *data);

/**
 * @brief  设置命令/数据/busy 超时
 * @param  h           SDIO 句柄指针
 * @param  cmd_timeout 命令响应等待超时（PCLK 周期，0 禁用）
 * @param  data_timeout 数据起始/写响应等待超时（PCLK 周期，0 禁用）
 * @param  busy_timeout R1b/写后 DAT0 busy 超时（PCLK 周期，0 禁用）
 */
void sdio_timeout_config(sdio_handle_t *h, uint32_t cmd_timeout,
                         uint32_t data_timeout, uint32_t busy_timeout);

/* =========================================================================
 * 9. PIO FIFO 操作
 * ========================================================================= */

/**
 * @brief  向 PIO TX FIFO 压入一个字节
 * @param  h     SDIO 句柄指针
 * @param  value 字节
 * @return 0 成功，-1 FIFO 满（不写 FIFO）
 * @note 使用 volatile uint8_t 写产生 PSTRB=0001，只压入一个字节。
 */
int sdio_tx_put(sdio_handle_t *h, uint8_t value);

/**
 * @brief  从 PIO RX FIFO 读取一个字节
 * @param  h SDIO 句柄指针
 * @return 字节；软件缓存和硬件 FIFO 都空时返回 0，不读 RX_DATA，不触发 RX_UNDERFLOW
 * @note 每次硬件读取弹出最多 4 字节，后续调用依次交付缓存字节。
 *       FIFO_STATUS 仅统计硬件中的字节，不包含 h->rx_remaining。
 *       请勿混用原始 RX_DATA 读取；原始 RX_CLEAR 后需重新初始化句柄缓存。
 */
uint8_t sdio_rx_get(sdio_handle_t *h);

/**
 * @brief  读取 FIFO_STATUS 寄存器
 * @param  h SDIO 句柄指针
 * @return FIFO_STATUS 值
 */
uint32_t sdio_read_fifo_status(sdio_handle_t *h);

/**
 * @brief  设置 PIO FIFO 阈值
 * @param  h            SDIO 句柄指针
 * @param  tx_threshold TX 低水位（TX_BYTE_LEVEL <= 此值时事件）
 * @param  rx_threshold RX 高水位（RX_BYTE_LEVEL >= 此值时事件）
 */
void sdio_fifo_threshold(sdio_handle_t *h, uint32_t tx_threshold, uint32_t rx_threshold);

/* =========================================================================
 * 10. 事务执行
 * ========================================================================= */

/**
 * @brief  启动一笔事务
 * @param  h SDIO 句柄指针
 * @return 0 已接受，-1 配置错误（置位 CONFIG_ERROR，不产生完成事件）
 *
 * @note   调用前应确认 ENABLE=1、CLOCK_ENABLE=1、STATUS.BUSY=0 且设备已插入。
 *         所有配置在 START 接受时快照。
 */
int sdio_start(sdio_handle_t *h);

/**
 * @brief  等待事务结束（轮询 TRANSFER_DONE / ABORTED / ERROR）
 * @param  h SDIO 句柄指针
 * @return 0 正常结束，-1 错误或中止
 */
int sdio_wait_done(sdio_handle_t *h);

/**
 * @brief  读取 STATUS 寄存器
 * @param  h SDIO 句柄指针
 * @return STATUS 值
 */
uint32_t sdio_read_status(sdio_handle_t *h);

/**
 * @brief  检查控制器是否忙
 * @param  h SDIO 句柄指针
 * @return true 忙
 */
bool sdio_busy(sdio_handle_t *h);

/**
 * @brief  请求受控中止当前事务
 * @param  h SDIO 句柄指针
 */
void sdio_abort(sdio_handle_t *h);

/* =========================================================================
 * 11. 响应与传输进度
 * ========================================================================= */

/**
 * @brief  读取 48-bit 响应主字（response[39:8]）
 * @param  h SDIO 句柄指针
 * @return RESP0 值
 */
uint32_t sdio_read_resp0(sdio_handle_t *h);

/**
 * @brief  读取 136-bit 响应原始 128 bit
 * @param  h     SDIO 句柄指针
 * @param  words 输出数组（至少 4 项）：{RESP0,RESP1,RESP2,RESP3}
 */
void sdio_read_resp136(sdio_handle_t *h, uint32_t words[4]);

/**
 * @brief  读取已传输块数与当前块字节数
 * @param  h           SDIO 句柄指针
 * @param  blocks_done 输出已完成块数（可为 NULL）
 * @param  bytes_done  输出当前块完成字节数（可为 NULL）
 */
void sdio_read_transfer_count(sdio_handle_t *h, uint32_t *blocks_done, uint32_t *bytes_done);

/**
 * @brief  读取自动 CMD12 的响应
 * @param  h SDIO 句柄指针
 * @return AUTO_CMD12_RESP 值
 */
uint32_t sdio_read_auto_cmd12_resp(sdio_handle_t *h);

/**
 * @brief  读取卡状态（CMD/DAT 实时电平）
 * @param  h SDIO 句柄指针
 * @return CARD_STATUS 值
 */
uint32_t sdio_read_card_status(sdio_handle_t *h);

/* =========================================================================
 * 12. 中断与错误
 * ========================================================================= */

/**
 * @brief  读取中断状态（粘滞原始位）
 * @param  h SDIO 句柄指针
 * @return IRQ_STATUS 值
 */
uint32_t sdio_irq_read_status(sdio_handle_t *h);

/**
 * @brief  按掩码使能中断
 * @param  h    SDIO 句柄指针
 * @param  mask 中断掩码
 */
void sdio_irq_enable(sdio_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码清除中断状态（W1C；同拍硬件置位优先）
 * @param  h    SDIO 句柄指针
 * @param  mask 要清除的状态位
 */
void sdio_irq_clear_status(sdio_handle_t *h, uint32_t mask);

/**
 * @brief  读取错误状态寄存器（只读，下一笔 START 或复位时清零）
 * @param  h SDIO 句柄指针
 * @return ERROR_STATUS 值
 */
uint32_t sdio_read_error_status(sdio_handle_t *h);

#ifdef __cplusplus
}
#endif

#endif /* __SDIO_H__ */
