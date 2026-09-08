/**
 * @file    sdio.c
 * @brief   APB SDIO/MMC 主机控制器裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          sdio_reg_read / sdio_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_sdio.v
 * 对应手册: apb_sdio_manual.md
 */

#include "sdio.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int sdio_init(sdio_handle_t *h, uintptr_t base_addr, uint32_t fifo_depth)
{
    /* 参数校验：句柄非空、地址 4 字节对齐、FIFO 深度不小于 8 的 2 的幂 */
    if (h == NULL || (base_addr & 0x3U) != 0U || fifo_depth < 8U) {
        return -1;
    }

    h->base       = (volatile uint32_t *)base_addr;
    h->fifo_depth = fifo_depth;
    h->rx_word = 0U;
    h->rx_remaining = 0U;

    return 0;
}

void sdio_soft_reset(sdio_handle_t *h)
{
    /* SOFT_RESET 需要 pstrb[3]（最高字节选通），32 位全字写满足要求 */
    sdio_reg_write(h->base, SDIO_REG_CTRL, SDIO_CTRL_SOFT_RESET);
    h->rx_word = 0U;
    h->rx_remaining = 0U;
}

/* =========================================================================
 * 2. 时钟与主机配置
 * ========================================================================= */

void sdio_clock_config(sdio_handle_t *h, uint32_t half_period, bool enable, bool continuous)
{
    uint32_t cfg;

    cfg  = half_period & SDIO_CLK_HALF_PERIOD_MASK;
    if (enable) {
        cfg |= SDIO_CLK_CLOCK_ENABLE;
    }
    if (continuous) {
        cfg |= SDIO_CLK_CLOCK_CONTINUOUS;
    }

    sdio_reg_write(h->base, SDIO_REG_CLK_CFG, cfg);
}

void sdio_host_config(sdio_handle_t *h, sdio_bus_width_t bus_width,
                      bool cmd_open_drain, bool sdio_irq_enable)
{
    uint32_t cfg;

    cfg  = (uint32_t)bus_width & SDIO_HOST_BUS_WIDTH_MASK;
    if (cmd_open_drain) {
        cfg |= SDIO_HOST_CMD_OPEN_DRAIN;
    }
    if (sdio_irq_enable) {
        cfg |= SDIO_HOST_SDIO_IRQ_ENABLE;
    }

    sdio_reg_write(h->base, SDIO_REG_HOST_CFG, cfg);
}

/* =========================================================================
 * 3. 命令与数据配置
 * ========================================================================= */

void sdio_cmd_config(sdio_handle_t *h, const sdio_cmd_t *cmd)
{
    uint32_t cfg;

    if (cmd == NULL) {
        return;
    }

    cfg  = cmd->index & SDIO_CMD_INDEX_MASK;
    cfg |= ((uint32_t)cmd->resp_type & 0x3U) << SDIO_CMD_RESP_TYPE_SHIFT;
    if (cmd->resp_crc_check) {
        cfg |= SDIO_CMD_RESP_CRC_CHECK;
    }
    if (cmd->resp_index_check) {
        cfg |= SDIO_CMD_RESP_INDEX_CHECK;
    }
    if (cmd->resp_busy) {
        cfg |= SDIO_CMD_RESP_BUSY;
    }

    sdio_reg_write(h->base, SDIO_REG_CMD_CFG, cfg);
    sdio_reg_write(h->base, SDIO_REG_CMD_ARG, cmd->arg);
}

void sdio_data_config(sdio_handle_t *h, const sdio_data_t *data)
{
    uint32_t cfg;

    if (data == NULL) {
        return;
    }

    /*
     * DATA_CFG：[10:0] BLOCK_SIZE_MINUS1、[31:16] BLOCK_COUNT。
     * 数据命令的块大小范围为 1..2048 字节。
     */
    cfg  = (uint32_t)(data->block_size - 1U) & SDIO_DATA_BLOCK_SIZE_MINUS1_MASK;
    /* 左移前转换为无符号 32 位，保证最大块数不溢出 signed int。 */
    cfg |= ((uint32_t)data->block_count << SDIO_DATA_BLOCK_COUNT_SHIFT) &
           SDIO_DATA_BLOCK_COUNT_MASK;

    sdio_reg_write(h->base, SDIO_REG_DATA_CFG, cfg);

    /* 命令配置先写；数据配置补充 PIO 数据方向及自动 CMD12。 */
    cfg = sdio_reg_read(h->base, SDIO_REG_CMD_CFG);
    cfg &= ~(SDIO_CMD_DATA_WRITE | SDIO_CMD_DMA_ENABLE | SDIO_CMD_AUTO_CMD12);
    cfg |= SDIO_CMD_DATA_PRESENT;
    if (data->write) {
        cfg |= SDIO_CMD_DATA_WRITE;
    }
    if (data->auto_cmd12) {
        cfg |= SDIO_CMD_AUTO_CMD12;
    }
    sdio_reg_write(h->base, SDIO_REG_CMD_CFG, cfg);
}

void sdio_timeout_config(sdio_handle_t *h, uint32_t cmd_timeout,
                         uint32_t data_timeout, uint32_t busy_timeout)
{
    sdio_reg_write(h->base, SDIO_REG_CMD_TIMEOUT, cmd_timeout);
    sdio_reg_write(h->base, SDIO_REG_DATA_TIMEOUT, data_timeout);
    sdio_reg_write(h->base, SDIO_REG_BUSY_TIMEOUT, busy_timeout);
}

/* =========================================================================
 * 4. PIO FIFO 操作
 * ========================================================================= */

int sdio_tx_put(sdio_handle_t *h, uint8_t value)
{
    uint32_t fifo;

    fifo = sdio_reg_read(h->base, SDIO_REG_FIFO_STATUS);
    if ((fifo & SDIO_FIFO_TX_FULL) != 0U) {
        /* TX FIFO 满时该次有效写被丢弃并置 TX_OVERFLOW */
        return -1;
    }

    /* 单字节写仅选通 lane 0；32 位写会错误地压入 value,0,0,0。 */
    *(volatile uint8_t *)((uintptr_t)h->base + SDIO_REG_TX_DATA) = value;
    return 0;
}

uint8_t sdio_rx_get(sdio_handle_t *h)
{
    uint32_t count;
    uint8_t value;

    if (h->rx_remaining == 0U) {
        count = (sdio_reg_read(h->base, SDIO_REG_FIFO_STATUS) >>
                 SDIO_FIFO_RX_BYTE_LEVEL_SHIFT) & 0xFFFU;
        if (count == 0U) {
            return 0U;
        }
        h->rx_word = sdio_reg_read(h->base, SDIO_REG_RX_DATA);
        h->rx_remaining = count < 4U ? count : 4U;
    }
    value = (uint8_t)h->rx_word;
    h->rx_word >>= 8;
    --h->rx_remaining;
    return value;
}

uint32_t sdio_read_fifo_status(sdio_handle_t *h)
{
    return sdio_reg_read(h->base, SDIO_REG_FIFO_STATUS);
}

void sdio_fifo_threshold(sdio_handle_t *h, uint32_t tx_threshold, uint32_t rx_threshold)
{
    /* 阈值仅在 PIO 路径生效；复位值 TX=0、RX=4 */
    sdio_reg_write(h->base, SDIO_REG_FIFO_THRESHOLD,
                   (tx_threshold & SDIO_THRESHOLD_TX_MASK) |
                   ((rx_threshold & 0xFFFU) << SDIO_THRESHOLD_RX_SHIFT));
}

/* =========================================================================
 * 5. 事务执行
 * ========================================================================= */

int sdio_start(sdio_handle_t *h)
{
    /* 忙碌时写 START 属于非法控制操作，会置位 CONFIG_ERROR */
    if ((sdio_reg_read(h->base, SDIO_REG_STATUS) & SDIO_STATUS_BUSY) != 0U) {
        return -1;
    }

    /* 新事务前调用方必须已读完上一事务的缓存与硬件 RX FIFO。 */
    h->rx_word = 0U;
    h->rx_remaining = 0U;
    /* 先使能，再写 ENABLE|START；拒绝启动只置 CONFIG_ERROR，不产生完成事件 */
    sdio_reg_write(h->base, SDIO_REG_CTRL, SDIO_CTRL_ENABLE);
    sdio_reg_write(h->base, SDIO_REG_CTRL, SDIO_CTRL_ENABLE | SDIO_CTRL_START);
    return 0;
}

int sdio_wait_done(sdio_handle_t *h)
{
    for (;;) {
        uint32_t irq = sdio_reg_read(h->base, SDIO_REG_IRQ_STATUS);

        if ((irq & SDIO_IRQ_TRANSFER_DONE) != 0U) {
            sdio_reg_write(h->base, SDIO_REG_IRQ_STATUS, SDIO_IRQ_TRANSFER_DONE);
            return ((irq & (SDIO_IRQ_ERROR | SDIO_IRQ_ABORTED)) != 0U) ? -1 : 0;
        }
        if ((irq & (SDIO_IRQ_ERROR | SDIO_IRQ_ABORTED)) != 0U) {
            sdio_reg_write(h->base, SDIO_REG_IRQ_STATUS,
                           irq & (SDIO_IRQ_ERROR | SDIO_IRQ_ABORTED));
            return -1;
        }
    }
}

uint32_t sdio_read_status(sdio_handle_t *h)
{
    return sdio_reg_read(h->base, SDIO_REG_STATUS);
}

bool sdio_busy(sdio_handle_t *h)
{
    return (sdio_reg_read(h->base, SDIO_REG_STATUS) & SDIO_STATUS_BUSY) != 0U;
}

void sdio_abort(sdio_handle_t *h)
{
    /* 忙时请求受控中止；空闲 ABORT 属于配置错误 */
    sdio_reg_write(h->base, SDIO_REG_CTRL, SDIO_CTRL_ABORT);
    h->rx_word = 0U;
    h->rx_remaining = 0U;
}

/* =========================================================================
 * 6. 响应与传输进度
 * ========================================================================= */

uint32_t sdio_read_resp0(sdio_handle_t *h)
{
    return sdio_reg_read(h->base, SDIO_REG_RESP0);
}

void sdio_read_resp136(sdio_handle_t *h, uint32_t words[4])
{
    if (words == NULL) {
        return;
    }
    words[0] = sdio_reg_read(h->base, SDIO_REG_RESP0);
    words[1] = sdio_reg_read(h->base, SDIO_REG_RESP1);
    words[2] = sdio_reg_read(h->base, SDIO_REG_RESP2);
    words[3] = sdio_reg_read(h->base, SDIO_REG_RESP3);
}

void sdio_read_transfer_count(sdio_handle_t *h, uint32_t *blocks_done, uint32_t *bytes_done)
{
    uint32_t reg = sdio_reg_read(h->base, SDIO_REG_TRANSFER_COUNT);

    if (blocks_done != NULL) {
        *blocks_done = reg & 0xFFFFU;
    }
    if (bytes_done != NULL) {
        *bytes_done = (reg >> 16) & 0xFFFU;
    }
}

uint32_t sdio_read_auto_cmd12_resp(sdio_handle_t *h)
{
    return sdio_reg_read(h->base, SDIO_REG_AUTO_CMD12_RESP);
}

uint32_t sdio_read_card_status(sdio_handle_t *h)
{
    return sdio_reg_read(h->base, SDIO_REG_CARD_STATUS);
}

/* =========================================================================
 * 7. 中断与错误
 * ========================================================================= */

uint32_t sdio_irq_read_status(sdio_handle_t *h)
{
    return sdio_reg_read(h->base, SDIO_REG_IRQ_STATUS) & SDIO_IRQ_ALL;
}

void sdio_irq_enable(sdio_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= SDIO_IRQ_ALL;

    enable_val  = sdio_reg_read(h->base, SDIO_REG_IRQ_ENABLE);
    enable_val |= mask;
    sdio_reg_write(h->base, SDIO_REG_IRQ_ENABLE, enable_val);
}

void sdio_irq_clear_status(sdio_handle_t *h, uint32_t mask)
{
    /* W1C：写 1 清除；同拍硬件置位优先（set-wins） */
    sdio_reg_write(h->base, SDIO_REG_IRQ_STATUS, mask & SDIO_IRQ_ALL);
}

uint32_t sdio_read_error_status(sdio_handle_t *h)
{
    /* 只读；复位或接受下一笔 START 时清零 */
    return sdio_reg_read(h->base, SDIO_REG_ERROR_STATUS);
}
