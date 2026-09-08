/**
 * @file    can.c
 * @brief   APB Classic CAN 裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          can_reg_read / can_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_can.v
 * 对应手册: apb_can_manual.md
 */

#include "can.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int can_init(can_handle_t *h, uintptr_t base_addr)
{
    if (h == NULL || (base_addr & 0x3U) != 0U) {
        return -1;
    }

    h->base = (volatile uint32_t *)base_addr;
    return 0;
}

void can_soft_reset(can_handle_t *h)
{
    /* SOFT_RESET 需要 pstrb[3]（最高字节选通），32 位全字写满足要求 */
    can_reg_write(h->base, CAN_REG_CTRL, CAN_CTRL_SOFT_RESET);
}

void can_enable(can_handle_t *h, bool en)
{
    uint32_t ctrl;

    /*
     * 每次写 CTRL 都会用写数据 [4:0] 覆盖持久位，因此必须读改写保留模式位。
     * 清除 ENABLE 后 STATUS.ENABLE 立即反映请求，但 RUNNING 只在安全边界后清零。
     */
    ctrl = can_reg_read(h->base, CAN_REG_CTRL) & CAN_CTRL_MODE_MASK;
    if (en) {
        ctrl |= CAN_CTRL_ENABLE;
    } else {
        ctrl &= ~CAN_CTRL_ENABLE;
    }
    can_reg_write(h->base, CAN_REG_CTRL, ctrl);
}

void can_set_mode(can_handle_t *h, bool listen_only, bool loopback,
                  bool auto_retry, bool filter_enable)
{
    uint32_t ctrl;

    /*
     * 模式位 [4:1] 只允许在 RUNNING=0 时修改。
     * 运行中请求停止时必须保留当前模式位（例如默认自动重发模式写 0x08，
     * 不能只写零），否则该写入会被当作非法模式修改。
     *
     * 本函数读取当前 ENABLE 状态并保留：若调用时正在运行，只修改模式，
     * 修改后需由调用方在 RUNNING=0 时再调用本函数生效。
     */
    ctrl = can_reg_read(h->base, CAN_REG_CTRL) & CAN_CTRL_ENABLE;

    if (listen_only) {
        ctrl |= CAN_CTRL_LISTEN_ONLY;
    }
    if (loopback) {
        ctrl |= CAN_CTRL_LOOPBACK;
    }
    if (auto_retry) {
        ctrl |= CAN_CTRL_AUTO_RETRY;
    } else {
        ctrl &= ~CAN_CTRL_AUTO_RETRY;
    }
    if (filter_enable) {
        ctrl |= CAN_CTRL_FILTER_ENABLE;
    }

    can_reg_write(h->base, CAN_REG_CTRL, ctrl);
}

uint32_t can_read_status(can_handle_t *h)
{
    return can_reg_read(h->base, CAN_REG_STATUS);
}

bool can_running(can_handle_t *h)
{
    return (can_reg_read(h->base, CAN_REG_STATUS) & CAN_STATUS_RUNNING) != 0U;
}

bool can_tx_idle(can_handle_t *h)
{
    uint32_t status = can_reg_read(h->base, CAN_REG_STATUS);
    uint32_t fifo   = can_reg_read(h->base, CAN_REG_FIFO_STATUS);

    /* 判断发送通道彻底空闲需同时检查 TX_LEVEL==0 和 TX_ACTIVE==0 */
    return ((fifo & CAN_FIFO_TX_LEVEL_MASK) == 0U) &&
           ((status & CAN_STATUS_TX_ACTIVE) == 0U);
}

/* =========================================================================
 * 2. 位时序
 * ========================================================================= */

void can_bit_timing(can_handle_t *h, uint32_t brp, uint32_t sjw,
                    uint32_t tseg1, uint32_t tseg2)
{
    uint32_t timing;

    /*
     * 布局：[9:0] BRP、[13:12] SJW、[19:16] TSEG1、[22:20] TSEG2。
     * 位时序只允许在 RUNNING=0 时修改；写入无效配置或在运行中写入
     * 会保持原配置并报告 CONFIG_ERROR。
     */
    timing  = brp & 0x3FFU;
    timing |= (sjw & 0x3U) << 12;
    timing |= (tseg1 & 0xFU) << 16;
    timing |= (tseg2 & 0x7U) << 20;

    can_reg_write(h->base, CAN_REG_BIT_TIMING, timing);
}

/* =========================================================================
 * 3. 发送
 * ========================================================================= */

int can_send(can_handle_t *h, const can_frame_t *frame)
{
    uint32_t tx_ctrl;

    if (frame == NULL) {
        return -1;
    }
    if (frame->dlc > 8U) {
        return -1;
    }
    /* 标准帧只允许使用 [10:0]，高 18 位必须为零 */
    if (!frame->ide && frame->id > 0x7FFUL) {
        return -1;
    }

    /* 连续发送时只需在 TX_FULL 时等待，不应逐帧等待 TX_ACTIVE 清零 */
    while ((can_reg_read(h->base, CAN_REG_FIFO_STATUS) & CAN_FIFO_TX_FULL) != 0U) {
        /* spin */
    }

    can_reg_write(h->base, CAN_REG_TX_ID, frame->id & 0x1FFFFFFFUL);

    tx_ctrl  = frame->dlc & CAN_TX_CTRL_DLC_MASK;
    if (frame->rtr) {
        tx_ctrl |= CAN_TX_CTRL_RTR;
    }
    if (frame->ide) {
        tx_ctrl |= CAN_TX_CTRL_IDE;
    }
    can_reg_write(h->base, CAN_REG_TX_CTRL, tx_ctrl);

    can_reg_write(h->base, CAN_REG_TX_DATA0, frame->data0);
    can_reg_write(h->base, CAN_REG_TX_DATA1, frame->data1);

    /* PUSH：校验暂存寄存器并原子压入一整帧 */
    can_reg_write(h->base, CAN_REG_TX_CMD, CAN_TX_CMD_PUSH);

    return 0;
}

int can_wait_tx(can_handle_t *h)
{
    for (;;) {
        uint32_t irq = can_reg_read(h->base, CAN_REG_IRQ_STATUS);

        if ((irq & CAN_IRQ_TX_DONE) != 0U) {
            can_reg_write(h->base, CAN_REG_IRQ_STATUS, CAN_IRQ_TX_DONE);
            return 0;
        }
        if ((irq & CAN_IRQ_TX_FAILED) != 0U) {
            can_reg_write(h->base, CAN_REG_IRQ_STATUS, CAN_IRQ_TX_FAILED);
            return -1;
        }
    }
}

void can_tx_abort(can_handle_t *h)
{
    /* 在安全协议边界丢弃活动帧并禁止继续重发 */
    can_reg_write(h->base, CAN_REG_TX_CMD, CAN_TX_CMD_ABORT);
}

/* =========================================================================
 * 4. 接收
 * ========================================================================= */

size_t can_read_snapshot(can_handle_t *h, can_frame_t *frames, size_t capacity)
{
    size_t i;
    size_t count = (can_reg_read(h->base, CAN_REG_FIFO_STATUS) >> CAN_FIFO_RX_LEVEL_SHIFT) & 0xFFU;

    if (frames == NULL) {
        return 0U;
    }
    if (count > capacity) {
        count = capacity;
    }

    for (i = 0U; i < count; ++i) {
        uint32_t ctrl;

        /* 同步 FIFO POP：该写传输提供更新所需时钟 */
        can_reg_write(h->base, CAN_REG_RX_CMD, CAN_RX_CMD_POP);

        /* 必须检查 RX_DATA_VALID，避免把空 FIFO 保留的旧输出当作新帧 */
        if ((can_reg_read(h->base, CAN_REG_STATUS) & CAN_STATUS_RX_DATA_VALID) == 0U) {
            break;
        }

        frames[i].id    = can_reg_read(h->base, CAN_REG_RX_ID) & 0x1FFFFFFFUL;
        ctrl            = can_reg_read(h->base, CAN_REG_RX_CTRL);
        frames[i].dlc   = ctrl & CAN_TX_CTRL_DLC_MASK;
        frames[i].rtr   = (ctrl & CAN_TX_CTRL_RTR) != 0U;
        frames[i].ide   = (ctrl & CAN_TX_CTRL_IDE) != 0U;
        frames[i].data0 = can_reg_read(h->base, CAN_REG_RX_DATA0);
        frames[i].data1 = can_reg_read(h->base, CAN_REG_RX_DATA1);
    }

    return i;
}

uint32_t can_read_fifo_status(can_handle_t *h)
{
    return can_reg_read(h->base, CAN_REG_FIFO_STATUS);
}

uint32_t can_rx_level(can_handle_t *h)
{
    return (can_reg_read(h->base, CAN_REG_FIFO_STATUS) >> CAN_FIFO_RX_LEVEL_SHIFT) & 0xFFU;
}

void can_fifo_threshold(can_handle_t *h, uint32_t rx_threshold, uint32_t tx_threshold)
{
    can_reg_write(h->base, CAN_REG_FIFO_THRESHOLD,
                  (rx_threshold & CAN_THRESHOLD_RX_MASK) |
                  ((tx_threshold & 0xFFU) << CAN_THRESHOLD_TX_SHIFT));
}

/* =========================================================================
 * 5. 验收过滤
 * ========================================================================= */

void can_set_filter(can_handle_t *h, uint32_t code, uint32_t mask)
{
    /* 匹配式：(frame_key ^ code) & mask == 0；位 31 保留并读回零 */
    can_reg_write(h->base, CAN_REG_ACCEPT_CODE, code & 0x7FFFFFFFUL);
    can_reg_write(h->base, CAN_REG_ACCEPT_MASK, mask & 0x7FFFFFFFUL);
}

/* =========================================================================
 * 6. 中断管理
 * ========================================================================= */

uint32_t can_irq_read_status(can_handle_t *h)
{
    return can_reg_read(h->base, CAN_REG_IRQ_STATUS) & CAN_IRQ_ALL;
}

uint32_t can_irq_get_pending(can_handle_t *h)
{
    /* 对应 RTL: interrupt = |(IRQ_STATUS & IRQ_ENABLE) */
    uint32_t status = can_reg_read(h->base, CAN_REG_IRQ_STATUS);
    uint32_t enable = can_reg_read(h->base, CAN_REG_IRQ_ENABLE);
    return status & enable;
}

void can_irq_enable(can_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= CAN_IRQ_ALL;

    enable_val  = can_reg_read(h->base, CAN_REG_IRQ_ENABLE);
    enable_val |= mask;
    can_reg_write(h->base, CAN_REG_IRQ_ENABLE, enable_val);
}

void can_irq_disable(can_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= CAN_IRQ_ALL;

    enable_val  = can_reg_read(h->base, CAN_REG_IRQ_ENABLE);
    enable_val &= ~mask;
    can_reg_write(h->base, CAN_REG_IRQ_ENABLE, enable_val);
}

void can_irq_clear_status(can_handle_t *h, uint32_t mask)
{
    /* W1C：只清除写入值中为 1 的位；同拍新事件优先于 W1C */
    can_reg_write(h->base, CAN_REG_IRQ_STATUS, mask & CAN_IRQ_ALL);
}

/* =========================================================================
 * 7. 错误状态
 * ========================================================================= */

void can_read_error_counters(can_handle_t *h, uint32_t *tec, uint32_t *rec)
{
    uint32_t reg = can_reg_read(h->base, CAN_REG_ERROR_COUNTER);

    if (tec != NULL) {
        *tec = reg & CAN_ERROR_COUNTER_TEC_MASK;
    }
    if (rec != NULL) {
        *rec = (reg >> CAN_ERROR_COUNTER_REC_SHIFT) & 0xFFU;
    }
}

uint32_t can_read_error_status(can_handle_t *h)
{
    return can_reg_read(h->base, CAN_REG_ERROR_STATUS);
}

void can_clear_error_status(can_handle_t *h, uint32_t mask)
{
    /* 写 ERROR_STATUS 只清除低 10 位粘滞标志，不改变最近错误类型/字段/位置 */
    can_reg_write(h->base, CAN_REG_ERROR_STATUS, mask & CAN_ERR_STATUS_MASK);
}
