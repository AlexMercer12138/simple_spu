/**
 * @file    uart.c
 * @brief   APB UART 裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          uart_reg_read / uart_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_uart.v
 * 对应手册: apb_uart_manual.md
 */

#include "uart.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int uart_init(uart_handle_t *h, uintptr_t base_addr, uint32_t fifo_depth)
{
    /* 参数校验：句柄非空、地址 4 字节对齐、FIFO 深度不小于 8 的 2 的幂 */
    if (h == NULL || (base_addr & 0x3U) != 0U || fifo_depth < 8U) {
        return -1;
    }

    h->base       = (volatile uint32_t *)base_addr;
    h->fifo_depth = fifo_depth;

    return 0;
}

void uart_soft_reset(uart_handle_t *h)
{
    /*
     * 写 CTRL bit31=1 触发同步软复位。
     * SOFT_RST 需要 pstrb[3]（最高字节选通），32 位全字写满足要求。
     * 软复位清除控制、配置、中断和两个 FIFO，复位后必须重新初始化。
     */
    uart_reg_write(h->base, UART_REG_CTRL, UART_CTRL_SOFT_RST);
}

void uart_config(uart_handle_t *h, uint32_t baud_rate, uart_parity_t parity, bool two_stop)
{
    uint32_t config;

    /*
     * CONFIG 布局：
     *   [23:0]  BAUD_RATE（Hz）
     *   [28:24] RESERVED（软件应写零）
     *   [30:29] PARITY_TYPE：00 无、01 奇、10 偶、11 保留
     *   [31]    STOP_BIT：0=1 个停止位，1=2 个停止位
     *
     * 内部位周期：BAUD_DIV = floor(SYS_CLK_FREQ / BAUD_RATE)。
     * 写入后需约 32 个 PCLK 完成除法计算，使能前至少等待 40 个 PCLK。
     */
    config  = baud_rate & UART_CONFIG_BAUD_MASK;
    config |= ((uint32_t)parity & 0x3U) << UART_CONFIG_PARITY_SHIFT;
    if (two_stop) {
        config |= UART_CONFIG_STOP_BIT;
    }

    uart_reg_write(h->base, UART_REG_CONFIG, config);
}

void uart_rx_enable(uart_handle_t *h, bool en)
{
    uint32_t ctrl;

    /* 读改写：仅修改 RX_EN，保留 TX_EN */
    ctrl  = uart_reg_read(h->base, UART_REG_CTRL) & UART_CTRL_EN_MASK;
    if (en) {
        ctrl |= UART_CTRL_RX_EN;
    } else {
        ctrl &= ~UART_CTRL_RX_EN;
    }
    uart_reg_write(h->base, UART_REG_CTRL, ctrl);
}

void uart_tx_enable(uart_handle_t *h, bool en)
{
    uint32_t ctrl;

    ctrl  = uart_reg_read(h->base, UART_REG_CTRL) & UART_CTRL_EN_MASK;
    if (en) {
        ctrl |= UART_CTRL_TX_EN;
    } else {
        ctrl &= ~UART_CTRL_TX_EN;
    }
    uart_reg_write(h->base, UART_REG_CTRL, ctrl);
}

void uart_rx_clear(uart_handle_t *h)
{
    uint32_t ctrl;

    /*
     * RX_CLR 是 W1P 命令。每次写 CTRL 都会用写数据 [1:0] 覆盖两个使能位，
     * 因此必须读改写保留 RX_EN/TX_EN 后再写清空命令。
     * 关闭 RX_EN 不会清空 RX FIFO；如需丢弃已接收数据应使用 RX_CLR。
     */
    ctrl  = uart_reg_read(h->base, UART_REG_CTRL) & UART_CTRL_EN_MASK;
    ctrl |= UART_CTRL_RX_CLR;
    uart_reg_write(h->base, UART_REG_CTRL, ctrl);
}

void uart_tx_clear(uart_handle_t *h)
{
    uint32_t ctrl;

    ctrl  = uart_reg_read(h->base, UART_REG_CTRL) & UART_CTRL_EN_MASK;
    ctrl |= UART_CTRL_TX_CLR;
    uart_reg_write(h->base, UART_REG_CTRL, ctrl);
}

/* =========================================================================
 * 2. 发送
 * ========================================================================= */

void uart_putc(uart_handle_t *h, uint8_t value)
{
    /* 轮询 TX_FULL：FIFO 已满时写入被静默忽略，写之前必须检查 */
    while ((uart_reg_read(h->base, UART_REG_TX_STATUS) & UART_STATUS_FULL) != 0U) {
        /* spin */
    }
    uart_reg_write(h->base, UART_REG_TX_DATA, value);
}

void uart_write(uart_handle_t *h, const uint8_t *data, size_t len)
{
    size_t i;

    for (i = 0U; i < len; ++i) {
        uart_putc(h, data[i]);
    }
}

void uart_flush(uart_handle_t *h)
{
    uint32_t status;

    /* 连续发送时只需在 FIFO 满时等待，不应逐字节等待 TX_BUSY 清零 */
    for (;;) {
        status = uart_reg_read(h->base, UART_REG_TX_STATUS);
        if ((status & UART_STATUS_LEVEL_MASK) == 0U &&
            (status & UART_STATUS_BUSY) == 0U) {
            break;
        }
    }
}

void uart_tx_put(uart_handle_t *h, uint8_t value)
{
    /* 非阻塞压入；调用方需先通过 uart_tx_level / TX_FULL 确认未满 */
    uart_reg_write(h->base, UART_REG_TX_DATA, value);
}

/* =========================================================================
 * 3. 接收
 * ========================================================================= */

size_t uart_read_snapshot(uart_handle_t *h, uint8_t *buffer, size_t capacity)
{
    size_t count;
    size_t i;

    /* 1. 从 RX_STATUS.RX_LEVEL 保存当前字节数 N */
    count = uart_reg_read(h->base, UART_REG_RX_STATUS) & UART_STATUS_LEVEL_MASK;
    if (count > capacity) {
        count = capacity;
    }

    /* 2. 若 N=0 直接返回 */
    if (count == 0U) {
        return 0U;
    }

    /* 3. 读取一次 RX_DATA 并丢弃返回值，用于预取第一个字节 */
    (void)uart_reg_read(h->base, UART_REG_RX_DATA);

    /* 4. 再读取 N 次，依次得到保存快照中的 N 个字节 */
    for (i = 0U; i < count; ++i) {
        buffer[i] = (uint8_t)uart_reg_read(h->base, UART_REG_RX_DATA);
    }

    return count;
}

uint32_t uart_read_rx_status(uart_handle_t *h)
{
    return uart_reg_read(h->base, UART_REG_RX_STATUS);
}

uint32_t uart_read_tx_status(uart_handle_t *h)
{
    return uart_reg_read(h->base, UART_REG_TX_STATUS);
}

uint32_t uart_rx_level(uart_handle_t *h)
{
    return uart_reg_read(h->base, UART_REG_RX_STATUS) & UART_STATUS_LEVEL_MASK;
}

uint32_t uart_tx_level(uart_handle_t *h)
{
    return uart_reg_read(h->base, UART_REG_TX_STATUS) & UART_STATUS_LEVEL_MASK;
}

bool uart_tx_idle(uart_handle_t *h)
{
    uint32_t status = uart_reg_read(h->base, UART_REG_TX_STATUS);

    /* FIFO 为空不等于物理发送完成；需同时满足 LEVEL==0 且 BUSY==0 */
    return ((status & UART_STATUS_LEVEL_MASK) == 0U) &&
           ((status & UART_STATUS_BUSY) == 0U);
}

/* =========================================================================
 * 4. 中断配置
 * ========================================================================= */

void uart_int_config(uart_handle_t *h, bool enable, uart_int_type_t type,
                     uint32_t rx_threshold, uint32_t tx_threshold)
{
    uint32_t reg;

    /*
     * INTERRUPT 布局：
     *   [0]    INT_EN
     *   [2:1]  INT_TYPE
     *   [3]    保留（写入时强制清零）
     *   [4]    INT_FLAG（本函数写入 0）
     *   [15:5] RESERVED（软件应写零）
     *   [23:16] RX_THRESHOLD
     *   [31:24] TX_THRESHOLD
     */
    reg  = ((uint32_t)type & 0x3U) << UART_INT_TYPE_SHIFT;
    reg |= (rx_threshold & 0xFFU) << 16;
    reg |= (tx_threshold & 0xFFU) << 24;
    if (enable) {
        reg |= UART_INT_EN;
    }

    uart_reg_write(h->base, UART_REG_INTERRUPT, reg);
}

void uart_int_clear_flag(uart_handle_t *h)
{
    uint32_t reg;

    /*
     * 清除 INT_FLAG 时应重写完整 INTERRUPT 配置并令位 4 为零。
     * 若触发条件仍成立，interrupt 会继续保持有效，INT_FLAG 也会再次置位。
     * 本函数保留当前中断配置（EN、TYPE、阈值），仅清标志位。
     */
    reg  = uart_reg_read(h->base, UART_REG_INTERRUPT);
    reg &= ~UART_INT_FLAG;  /* 位 4 写 0 */
    uart_reg_write(h->base, UART_REG_INTERRUPT, reg);
}
