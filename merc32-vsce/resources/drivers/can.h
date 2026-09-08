/**
 * @file    can.h
 * @brief   APB Classic CAN 裸机驱动头文件
 * @details 基于基地址 + 寄存器偏移的访问方式，支持 CAN 2.0A/B 标准帧/扩展帧、
 *          数据帧/远程帧收发、code/mask 验收过滤、位时序配置、16 路粘滞中断
 *          以及错误状态/TEC/REC 读取。
 *
 * 对应 RTL: apb_can.v
 * 对应手册: apb_can_manual.md
 */

#ifndef __CAN_H__
#define __CAN_H__

#include <stdint.h>
#include <stdbool.h>
#include <stddef.h>  /* size_t */

#ifdef __cplusplus
extern "C" {
#endif

/* =========================================================================
 * 1. 寄存器偏移地址定义（字节地址，32 位对齐）
 * ========================================================================= */

#define CAN_REG_CTRL           0x00U  /**< 运行、模式、FIFO 清空和软复位（R/W、W1P）*/
#define CAN_REG_BIT_TIMING     0x04U  /**< 标称位时序（R/W）              */
#define CAN_REG_STATUS         0x08U  /**< 运行、总线和错误限制状态（R）  */
#define CAN_REG_TX_ID          0x0CU  /**< TX 暂存 ID（R/W）              */
#define CAN_REG_TX_CTRL        0x10U  /**< TX 暂存 IDE/RTR/DLC（R/W）     */
#define CAN_REG_TX_DATA0       0x14U  /**< TX 数据字节 0~3（R/W）         */
#define CAN_REG_TX_DATA1       0x18U  /**< TX 数据字节 4~7（R/W）         */
#define CAN_REG_TX_CMD         0x1CU  /**< TX FIFO 压入和安全终止（W1P）  */
#define CAN_REG_RX_ID          0x20U  /**< 最近弹出帧 ID（R）             */
#define CAN_REG_RX_CTRL        0x24U  /**< 最近弹出帧 IDE/RTR/DLC（R）    */
#define CAN_REG_RX_DATA0       0x28U  /**< 最近弹出帧数据 0~3（R）        */
#define CAN_REG_RX_DATA1       0x2CU  /**< 最近弹出帧数据 4~7（R）        */
#define CAN_REG_RX_CMD         0x30U  /**< RX FIFO 弹出（W1P）            */
#define CAN_REG_FIFO_STATUS    0x34U  /**< FIFO 数量和状态（R）           */
#define CAN_REG_FIFO_THRESHOLD 0x38U  /**< RX/TX crossing 阈值（R/W）     */
#define CAN_REG_ACCEPT_CODE    0x3CU  /**< 验收比较值（R/W）              */
#define CAN_REG_ACCEPT_MASK    0x40U  /**< 验收比较掩码（R/W）            */
#define CAN_REG_IRQ_STATUS     0x44U  /**< 粘滞中断状态（R/W1C）          */
#define CAN_REG_IRQ_ENABLE     0x48U  /**< 中断逐位使能（R/W）            */
#define CAN_REG_ERROR_COUNTER  0x4CU  /**< TEC 和 REC（R）                */
#define CAN_REG_ERROR_STATUS   0x50U  /**< 错误明细和最近位置（R/W1C）    */

/* =========================================================================
 * 2. 位定义与掩码
 * ========================================================================= */

/* CTRL */
#define CAN_CTRL_ENABLE        (1UL << 0)  /**< 请求核心运行（R/W）        */
#define CAN_CTRL_LISTEN_ONLY   (1UL << 1)  /**< 只监听（R/W）              */
#define CAN_CTRL_LOOPBACK      (1UL << 2)  /**< 内部回环（R/W）            */
#define CAN_CTRL_AUTO_RETRY    (1UL << 3)  /**< 自动重发（R/W，复位值 1）  */
#define CAN_CTRL_FILTER_ENABLE (1UL << 4)  /**< 验收过滤使能（R/W）        */
#define CAN_CTRL_TX_CLEAR      (1UL << 8)  /**< 清空排队帧（W1P，需 byte1） */
#define CAN_CTRL_RX_CLEAR      (1UL << 9)  /**< 清空 RX FIFO（W1P，需 byte1）*/
#define CAN_CTRL_SOFT_RESET    (1UL << 31) /**< 复位整个外设（W1P，需 byte3）*/
#define CAN_CTRL_MODE_MASK     0x1FUL      /**< 持久模式位 [4:0]           */

/* BIT_TIMING */
#define CAN_BT_BRP_SHIFT   0U
#define CAN_BT_BRP_MASK    (0x3FFUL << 0)   /**< BRP [9:0]            */
#define CAN_BT_SJW_SHIFT   12U
#define CAN_BT_SJW_MASK    (0x3UL << 12)    /**< SJW [13:12]          */
#define CAN_BT_TSEG1_SHIFT 16U
#define CAN_BT_TSEG1_MASK  (0xFUL << 16)    /**< TSEG1 [19:16]        */
#define CAN_BT_TSEG2_SHIFT 20U
#define CAN_BT_TSEG2_MASK  (0x7UL << 20)    /**< TSEG2 [22:20]        */

/* STATUS */
#define CAN_STATUS_ENABLE          (1UL << 0)
#define CAN_STATUS_RUNNING         (1UL << 1)
#define CAN_STATUS_BUS_IDLE        (1UL << 2)
#define CAN_STATUS_TX_ACTIVE       (1UL << 3)
#define CAN_STATUS_RX_ACTIVE       (1UL << 4)
#define CAN_STATUS_RETRY_PENDING   (1UL << 5)
#define CAN_STATUS_RX_DATA_VALID   (1UL << 6)
#define CAN_STATUS_ERROR_WARNING   (1UL << 7)
#define CAN_STATUS_ERROR_PASSIVE   (1UL << 8)
#define CAN_STATUS_BUS_OFF         (1UL << 9)
#define CAN_STATUS_LISTEN_ONLY     (1UL << 10)
#define CAN_STATUS_LOOPBACK        (1UL << 11)
#define CAN_STATUS_CAN_RX          (1UL << 12)
#define CAN_STATUS_TX_ABORT_PENDING (1UL << 13)

/* TX_CTRL */
#define CAN_TX_CTRL_DLC_MASK  0xFUL   /**< DLC [3:0]           */
#define CAN_TX_CTRL_RTR       (1UL << 4) /**< 1=远程帧          */
#define CAN_TX_CTRL_IDE       (1UL << 5) /**< 1=29 位扩展帧     */

/* TX_CMD / RX_CMD */
#define CAN_TX_CMD_PUSH       (1UL << 0)  /**< 校验并压入一整帧（W1P） */
#define CAN_TX_CMD_ABORT      (1UL << 1)  /**< 安全边界终止活动帧（W1P）*/
#define CAN_RX_CMD_POP        (1UL << 0)  /**< 弹出 RX FIFO 一帧（W1P） */

/* FIFO_STATUS */
#define CAN_FIFO_TX_LEVEL_MASK  0xFFU         /**< [7:0]      */
#define CAN_FIFO_RX_LEVEL_SHIFT 8U
#define CAN_FIFO_RX_LEVEL_MASK  (0xFFUL << 8) /**< [15:8]     */
#define CAN_FIFO_TX_EMPTY       (1UL << 16)
#define CAN_FIFO_TX_FULL        (1UL << 17)
#define CAN_FIFO_RX_EMPTY       (1UL << 18)
#define CAN_FIFO_RX_FULL        (1UL << 19)
#define CAN_FIFO_TX_ACTIVE      (1UL << 20)
#define CAN_FIFO_RX_DATA_VALID  (1UL << 21)

/* FIFO_THRESHOLD */
#define CAN_THRESHOLD_RX_MASK   0xFFU          /**< RX 阈值 [7:0]    */
#define CAN_THRESHOLD_TX_SHIFT  8U
#define CAN_THRESHOLD_TX_MASK   (0xFFUL << 8)  /**< TX 阈值 [15:8]   */

/* IRQ_STATUS / IRQ_ENABLE */
#define CAN_IRQ_RX_FRAME        (1UL << 0)
#define CAN_IRQ_TX_DONE         (1UL << 1)
#define CAN_IRQ_RX_THRESHOLD    (1UL << 2)
#define CAN_IRQ_TX_THRESHOLD    (1UL << 3)
#define CAN_IRQ_TX_FAILED       (1UL << 4)
#define CAN_IRQ_ARBITRATION_LOST (1UL << 5)
#define CAN_IRQ_PROTOCOL_ERROR  (1UL << 6)
#define CAN_IRQ_WARNING_ENTER   (1UL << 7)
#define CAN_IRQ_PASSIVE_ENTER   (1UL << 8)
#define CAN_IRQ_BUS_OFF_ENTER   (1UL << 9)
#define CAN_IRQ_BUS_RECOVERED   (1UL << 10)
#define CAN_IRQ_RX_OVERFLOW     (1UL << 11)
#define CAN_IRQ_TX_OVERFLOW     (1UL << 12)
#define CAN_IRQ_RX_UNDERFLOW    (1UL << 13)
#define CAN_IRQ_CONFIG_ERROR    (1UL << 14)
#define CAN_IRQ_TX_ABORTED      (1UL << 15)
#define CAN_IRQ_ALL             (0xFFFFU)

/* ERROR_COUNTER */
#define CAN_ERROR_COUNTER_TEC_MASK  0x1FFU       /**< TEC [8:0]      */
#define CAN_ERROR_COUNTER_REC_SHIFT 16U
#define CAN_ERROR_COUNTER_REC_MASK  (0xFFUL << 16) /**< REC [23:16] */

/* ERROR_STATUS 低 10 位粘滞标志 */
#define CAN_ERR_STUFF_ERROR         (1UL << 0)
#define CAN_ERR_FORM_ERROR          (1UL << 1)
#define CAN_ERR_CRC_ERROR           (1UL << 2)
#define CAN_ERR_ACK_ERROR           (1UL << 3)
#define CAN_ERR_BIT_ERROR           (1UL << 4)
#define CAN_ERR_ARBITRATION_LOST    (1UL << 5)
#define CAN_ERR_RX_OVERFLOW         (1UL << 6)
#define CAN_ERR_TX_OVERFLOW         (1UL << 7)
#define CAN_ERR_RX_UNDERFLOW        (1UL << 8)
#define CAN_ERR_CONFIG_ERROR        (1UL << 9)
#define CAN_ERR_STATUS_MASK         (0x3FFU)  /**< 可 W1C 清除的低 10 位 */

/* =========================================================================
 * 3. 枚举类型
 * ========================================================================= */

/**
 * @brief 帧格式
 */
typedef enum {
    CAN_FRAME_STANDARD = 0U,  /**< 11 位标准帧 */
    CAN_FRAME_EXTENDED = 1U   /**< 29 位扩展帧 */
} can_frame_format_t;

/**
 * @brief 帧类型
 */
typedef enum {
    CAN_FRAME_DATA = 0U,  /**< 数据帧 */
    CAN_FRAME_REMOTE = 1U /**< 远程帧 */
} can_frame_type_t;

/* =========================================================================
 * 4. 数据结构与驱动句柄
 * ========================================================================= */

/**
 * @brief CAN 帧（与 RX/TX 寄存器字段一一对应）
 */
typedef struct {
    uint32_t id;     /**< 标识符：标准帧 11 位，扩展帧 29 位   */
    uint32_t dlc;    /**< 数据长度码 0~8                       */
    bool     rtr;    /**< true=远程帧                          */
    bool     ide;    /**< true=29 位扩展帧                     */
    uint32_t data0;  /**< 数据字节 0~3（byte0 在 [7:0]）       */
    uint32_t data1;  /**< 数据字节 4~7（byte4 在 [7:0]）       */
} can_frame_t;

/**
 * @brief CAN 驱动句柄
 */
typedef struct {
    volatile uint32_t *base;  /**< 外设寄存器基地址（外部传入，需 32 位对齐） */
} can_handle_t;

/* =========================================================================
 * 5. 寄存器底层读写（基地址 + 偏移）
 * ========================================================================= */

static inline uint32_t can_reg_read(volatile uint32_t *base, uint32_t offset)
{
    return *(volatile uint32_t *)((uintptr_t)base + offset);
}

static inline void can_reg_write(volatile uint32_t *base, uint32_t offset, uint32_t value)
{
    *(volatile uint32_t *)((uintptr_t)base + offset) = value;
}

/* =========================================================================
 * 6. 初始化与复位
 * ========================================================================= */

/**
 * @brief  初始化 CAN 句柄
 * @param  h         CAN 句柄指针
 * @param  base_addr 外设 APB 基地址（物理地址，需 32 位对齐）
 * @return 0 成功，-1 参数错误
 */
int can_init(can_handle_t *h, uintptr_t base_addr);

/**
 * @brief  执行软复位
 * @param  h CAN 句柄指针
 * @details 复位配置、FIFO、核心、错误计数和中断状态。
 */
void can_soft_reset(can_handle_t *h);

/**
 * @brief  使能/关闭 CAN 核心
 * @param  h   CAN 句柄指针
 * @param  en  true 请求核心运行
 *
 * @note   写 CTRL 时保留当前模式位。关闭后 STATUS.ENABLE 立即反映请求，
 *         但 STATUS.RUNNING 只在安全边界后清零；等待重发的活动帧会保留。
 */
void can_enable(can_handle_t *h, bool en);

/**
 * @brief  设置工作模式
 * @param  h         CAN 句柄指针
 * @param  listen_only true=只监听
 * @param  loopback  true=内部回环
 * @param  auto_retry true=自动重发
 * @param  filter_enable true=使能验收过滤
 *
 * @note   LISTEN_ONLY 与 LOOPBACK 不能同时为 1。模式位只允许在
 *         STATUS.RUNNING=0 时修改；运行中修改会被当作非法模式修改。
 */
void can_set_mode(can_handle_t *h, bool listen_only, bool loopback,
                  bool auto_retry, bool filter_enable);

/**
 * @brief  读取当前运行状态
 * @param  h CAN 句柄指针
 * @return STATUS 值
 */
uint32_t can_read_status(can_handle_t *h);

/**
 * @brief  判断核心是否处于运行状态
 * @param  h CAN 句柄指针
 * @return true 运行中
 */
bool can_running(can_handle_t *h);

/**
 * @brief  判断发送通道彻底空闲（TX_LEVEL==0 且 TX_ACTIVE==0）
 * @param  h CAN 句柄指针
 * @return true 空闲
 */
bool can_tx_idle(can_handle_t *h);

/* =========================================================================
 * 7. 位时序
 * ========================================================================= */

/**
 * @brief  配置标称位时序
 * @param  h     CAN 句柄指针
 * @param  brp   BRP 值（每 TQ 时钟数为 BRP+1）
 * @param  sjw   SJW 值（同步跳转宽度为 SJW+1 TQ）
 * @param  tseg1 TSEG1 值（段长度为 TSEG1+1 TQ）
 * @param  tseg2 TSEG2 值（段长度为 TSEG2+1 TQ）
 *
 * @note   要求 TSEG1>=1、SJW<=TSEG2；只在 RUNNING=0 时允许修改。
 *         非法或运行中写入会保持原配置并报告 CONFIG_ERROR。
 */
void can_bit_timing(can_handle_t *h, uint32_t brp, uint32_t sjw,
                    uint32_t tseg1, uint32_t tseg2);

/* =========================================================================
 * 8. 发送
 * ========================================================================= */

/**
 * @brief  发送一帧（轮询，等待 TX FIFO 非满）
 * @param  h     CAN 句柄指针
 * @param  frame 帧数据
 * @return 0 成功，-1 参数错误（DLC>8 或标准帧 ID 超 11 位）
 */
int can_send(can_handle_t *h, const can_frame_t *frame);

/**
 * @brief  等待上一帧发送成功（轮询 TX_DONE / TX_FAILED）
 * @param  h CAN 句柄指针
 * @return 0 成功，-1 最终失败（不再重试）
 */
int can_wait_tx(can_handle_t *h);

/**
 * @brief  在安全协议边界终止活动帧并禁止继续重发
 * @param  h CAN 句柄指针
 *
 * @note   没有活动帧时执行 ABORT 会报告 CONFIG_ERROR。
 *         可等待 CAN_IRQ_TX_ABORTED 中断确认。
 */
void can_tx_abort(can_handle_t *h);

/* =========================================================================
 * 9. 接收
 * ========================================================================= */

/**
 * @brief  批量读取 RX FIFO 帧
 * @param  h        CAN 句柄指针
 * @param  frames   帧缓冲区
 * @param  capacity 容量
 * @return 实际读取帧数
 */
size_t can_read_snapshot(can_handle_t *h, can_frame_t *frames, size_t capacity);

/**
 * @brief  读取 FIFO_STATUS 寄存器
 * @param  h CAN 句柄指针
 * @return FIFO_STATUS 值
 */
uint32_t can_read_fifo_status(can_handle_t *h);

/**
 * @brief  获取 RX FIFO 待弹出帧数
 * @param  h CAN 句柄指针
 * @return RX_LEVEL
 */
uint32_t can_rx_level(can_handle_t *h);

/**
 * @brief  设置 RX/TX crossing 阈值
 * @param  h           CAN 句柄指针
 * @param  rx_threshold RX 上穿阈值（0 关闭）
 * @param  tx_threshold TX 下穿阈值（可为 0）
 */
void can_fifo_threshold(can_handle_t *h, uint32_t rx_threshold, uint32_t tx_threshold);

/* =========================================================================
 * 10. 验收过滤
 * ========================================================================= */

/**
 * @brief  配置 code/mask 验收过滤
 * @param  h    CAN 句柄指针
 * @param  code ACCEPT_CODE 值
 * @param  mask ACCEPT_MASK 值（1=参与比较，0=忽略）
 *
 * @note   匹配式：(frame_key ^ code) & mask == 0。
 *         过滤配置只允许在 RUNNING=0 时修改。
 */
void can_set_filter(can_handle_t *h, uint32_t code, uint32_t mask);

/* =========================================================================
 * 11. 中断管理
 * ========================================================================= */

/**
 * @brief  读取中断状态（粘滞原始位）
 * @param  h CAN 句柄指针
 * @return IRQ_STATUS 值
 */
uint32_t can_irq_read_status(can_handle_t *h);

/**
 * @brief  获取已使能且待处理的中断位
 * @param  h CAN 句柄指针
 * @return IRQ_STATUS & IRQ_ENABLE
 */
uint32_t can_irq_get_pending(can_handle_t *h);

/**
 * @brief  按掩码使能中断
 * @param  h    CAN 句柄指针
 * @param  mask 中断掩码
 */
void can_irq_enable(can_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码禁用中断
 * @param  h    CAN 句柄指针
 * @param  mask 中断掩码
 */
void can_irq_disable(can_handle_t *h, uint32_t mask);

/**
 * @brief  按掩码清除中断状态（W1C）
 * @param  h    CAN 句柄指针
 * @param  mask 要清除的状态位
 */
void can_irq_clear_status(can_handle_t *h, uint32_t mask);

/* =========================================================================
 * 12. 错误状态
 * ========================================================================= */

/**
 * @brief  读取错误计数器（TEC/REC）
 * @param  h   CAN 句柄指针
 * @param  tec 输出 TEC 指针（可为 NULL）
 * @param  rec 输出 REC 指针（可为 NULL）
 */
void can_read_error_counters(can_handle_t *h, uint32_t *tec, uint32_t *rec);

/**
 * @brief  读取错误状态寄存器
 * @param  h CAN 句柄指针
 * @return ERROR_STATUS 值
 */
uint32_t can_read_error_status(can_handle_t *h);

/**
 * @brief  清除错误粘滞标志（W1C 低 10 位）
 * @param  h    CAN 句柄指针
 * @param  mask 要清除的 CAN_ERR_* 标志
 *
 * @note   清除不会改变最近错误类型、字段或仲裁位置。
 */
void can_clear_error_status(can_handle_t *h, uint32_t mask);

#ifdef __cplusplus
}
#endif

#endif /* __CAN_H__ */
