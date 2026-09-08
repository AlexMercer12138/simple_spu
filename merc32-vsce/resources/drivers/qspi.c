/**
 * @file    qspi.c
 * @brief   APB QSPI 主机控制器裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          qspi_reg_read / qspi_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_qspi.v
 * 对应手册: apb_qspi_manual.md
 */

#include "qspi.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int qspi_init(qspi_handle_t *h, uintptr_t base_addr, uint32_t cs_count, uint32_t fifo_depth)
{
    /* 参数校验：句柄非空、地址 4 字节对齐、CS_COUNT 1~16、FIFO 深度不小于 8 */
    if (h == NULL || (base_addr & 0x3U) != 0U ||
        cs_count == 0U || cs_count > 16U || fifo_depth < 8U) {
        return -1;
    }

    h->base       = (volatile uint32_t *)base_addr;
    h->cs_count   = cs_count;
    h->fifo_depth = fifo_depth;

    return 0;
}

void qspi_soft_reset(qspi_handle_t *h)
{
    /* SOFT_RESET 需要 pstrb[3]（最高字节选通），32 位全字写满足要求 */
    qspi_reg_write(h->base, QSPI_REG_CTRL, QSPI_CTRL_SOFT_RESET);
}

/* =========================================================================
 * 2. 配置
 * ========================================================================= */

void qspi_clock_config(qspi_handle_t *h, uint32_t half_period,
                       uint32_t cs_setup, uint32_t cs_hold, uint32_t cs_high)
{
    uint32_t cfg;

    cfg  = half_period & QSPI_CLOCK_HALF_PERIOD_MASK;
    cfg |= (cs_setup & 0xFFU) << QSPI_CLOCK_CS_SETUP_SHIFT;
    cfg |= (cs_hold & 0xFU) << QSPI_CLOCK_CS_HOLD_SHIFT;
    cfg |= (cs_high & 0xFU) << QSPI_CLOCK_CS_HIGH_SHIFT;

    qspi_reg_write(h->base, QSPI_REG_CLOCK_CFG, cfg);
}

void qspi_transfer_config(qspi_handle_t *h, qspi_data_width_t data_width,
                          qspi_data_dir_t data_dir, uint32_t spi_mode,
                          bool lsb_first, bool single_rx_d1, uint32_t cs_select)
{
    uint32_t cfg;

    cfg  = (uint32_t)data_width & QSPI_TRANSFER_DATA_WIDTH_MASK;
    cfg |= ((uint32_t)data_dir & 0x3U) << QSPI_TRANSFER_DATA_DIR_SHIFT;
    cfg |= (spi_mode & 0x3U) << QSPI_TRANSFER_SPI_MODE_SHIFT;
    if (lsb_first) {
        cfg |= QSPI_TRANSFER_LSB_FIRST;
    }
    if (single_rx_d1) {
        cfg |= QSPI_TRANSFER_SINGLE_RX_D1;
    }
    cfg |= (cs_select & 0xFU) << QSPI_TRANSFER_CS_SELECT_SHIFT;

    qspi_reg_write(h->base, QSPI_REG_TRANSFER_CFG, cfg);
}

void qspi_phase_config(qspi_handle_t *h, uint32_t cmd_bits, qspi_hdr_width_t cmd_width,
                       uint32_t addr_bits, qspi_hdr_width_t addr_width,
                       uint32_t mode_bits, qspi_hdr_width_t mode_width,
                       uint32_t dummy_cycles)
{
    uint32_t cfg;

    cfg  = cmd_bits & QSPI_PHASE_COMMAND_BITS_MASK;
    cfg |= ((uint32_t)cmd_width & 0x3U) << QSPI_PHASE_COMMAND_WIDTH_SHIFT;
    cfg |= (addr_bits & 0x3FU) << QSPI_PHASE_ADDRESS_BITS_SHIFT;
    cfg |= ((uint32_t)addr_width & 0x3U) << QSPI_PHASE_ADDRESS_WIDTH_SHIFT;
    cfg |= (mode_bits & 0x3FU) << QSPI_PHASE_MODE_BITS_SHIFT;
    cfg |= ((uint32_t)mode_width & 0x3U) << QSPI_PHASE_MODE_WIDTH_SHIFT;
    cfg |= (dummy_cycles & 0xFFU) << QSPI_PHASE_DUMMY_CYCLES_SHIFT;

    qspi_reg_write(h->base, QSPI_REG_PHASE_CFG, cfg);
}

void qspi_length_config(qspi_handle_t *h, uint32_t data_bytes)
{
    qspi_reg_write(h->base, QSPI_REG_LENGTH_CFG, data_bytes & QSPI_LENGTH_DATA_BYTES_MASK);
}

void qspi_header_data(qspi_handle_t *h, uint32_t cmd, uint32_t addr, uint32_t mode)
{
    qspi_reg_write(h->base, QSPI_REG_COMMAND_DATA, cmd);
    qspi_reg_write(h->base, QSPI_REG_ADDRESS_DATA, addr);
    qspi_reg_write(h->base, QSPI_REG_MODE_DATA, mode);
}

/* =========================================================================
 * 3. 事务执行
 * ========================================================================= */

int qspi_tx_put(qspi_handle_t *h, uint8_t value)
{
    uint32_t fifo;

    fifo = qspi_reg_read(h->base, QSPI_REG_FIFO_STATUS);
    if ((fifo & QSPI_FIFO_TX_FULL) != 0U) {
        /* 已满时的入队被丢弃并置位 IRQ_STATUS.TX_OVERFLOW */
        return -1;
    }

    /* 仅低字节写选通有效时入队；32 位全字写满足 pstrb[0]=1 */
    qspi_reg_write(h->base, QSPI_REG_TX_DATA, value);
    return 0;
}

uint8_t qspi_rx_get(qspi_handle_t *h)
{
    /* 读取非空 RX_DATA 会插入一个 APB 等待周期并弹出；空读取返回 0 不出队 */
    return (uint8_t)qspi_reg_read(h->base, QSPI_REG_RX_DATA);
}

int qspi_start(qspi_handle_t *h)
{
    /* 忙碌或禁用时写 START 属于非法控制操作，会置位 CONFIG_ERROR */
    if ((qspi_reg_read(h->base, QSPI_REG_STATUS) & QSPI_STATUS_BUSY) != 0U) {
        return -1;
    }

    /* 置位 ENABLE 后再写 ENABLE|START；校验失败只置 CONFIG_ERROR */
    qspi_reg_write(h->base, QSPI_REG_CTRL, QSPI_CTRL_ENABLE);
    qspi_reg_write(h->base, QSPI_REG_CTRL, QSPI_CTRL_ENABLE | QSPI_CTRL_START);
    return 0;
}

int qspi_wait_done(qspi_handle_t *h)
{
    for (;;) {
        uint32_t irq = qspi_reg_read(h->base, QSPI_REG_IRQ_STATUS);

        if ((irq & QSPI_IRQ_TRANSFER_DONE) != 0U) {
            qspi_reg_write(h->base, QSPI_REG_IRQ_STATUS, QSPI_IRQ_TRANSFER_DONE);
            return ((irq & QSPI_IRQ_ABORTED) != 0U) ? -1 : 0;
        }
    }
}

bool qspi_busy(qspi_handle_t *h)
{
    return (qspi_reg_read(h->base, QSPI_REG_STATUS) & QSPI_STATUS_BUSY) != 0U;
}

/* =========================================================================
 * 4. FIFO 与中断
 * ========================================================================= */

uint32_t qspi_read_fifo_status(qspi_handle_t *h)
{
    return qspi_reg_read(h->base, QSPI_REG_FIFO_STATUS);
}

uint32_t qspi_tx_level(qspi_handle_t *h)
{
    return qspi_reg_read(h->base, QSPI_REG_FIFO_STATUS) & QSPI_FIFO_TX_LEVEL_MASK;
}

uint32_t qspi_rx_level(qspi_handle_t *h)
{
    return (qspi_reg_read(h->base, QSPI_REG_FIFO_STATUS) >> QSPI_FIFO_RX_LEVEL_SHIFT) & 0xFFU;
}

void qspi_fifo_threshold(qspi_handle_t *h, uint32_t tx_threshold, uint32_t rx_threshold)
{
    qspi_reg_write(h->base, QSPI_REG_FIFO_THRESHOLD,
                   (tx_threshold & QSPI_THRESHOLD_TX_MASK) |
                   ((rx_threshold & 0xFFU) << QSPI_THRESHOLD_RX_SHIFT));
}

uint32_t qspi_irq_read_status(qspi_handle_t *h)
{
    return qspi_reg_read(h->base, QSPI_REG_IRQ_STATUS) & QSPI_IRQ_ALL;
}

void qspi_irq_enable(qspi_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= QSPI_IRQ_ALL;

    enable_val  = qspi_reg_read(h->base, QSPI_REG_IRQ_ENABLE);
    enable_val |= mask;
    qspi_reg_write(h->base, QSPI_REG_IRQ_ENABLE, enable_val);
}

void qspi_irq_clear_status(qspi_handle_t *h, uint32_t mask)
{
    /*
     * W1C：写 1 清除对应状态位；同一周期硬件置位与 W1C 冲突时硬件置位优先。
     * 阈值中断应先解除水位条件再清位，否则状态位立即再次置位。
     */
    qspi_reg_write(h->base, QSPI_REG_IRQ_STATUS, mask & QSPI_IRQ_ALL);
}
