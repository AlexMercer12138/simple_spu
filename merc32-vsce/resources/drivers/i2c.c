/**
 * @file    i2c.c
 * @brief   APB I2C 裸机驱动实现
 * @details 基于基地址 + 寄存器偏移的访问方式，所有寄存器操作均通过
 *          i2c_reg_read / i2c_reg_write 完成，不依赖任何硬编码地址。
 *
 * 对应 RTL: apb_i2c.v
 * 对应手册: apb_i2c_manual.md
 */

#include "i2c.h"
#include <stddef.h>  /* NULL */

/* =========================================================================
 * 1. 初始化与复位
 * ========================================================================= */

int i2c_init(i2c_handle_t *h, uintptr_t base_addr, uint32_t fifo_depth)
{
    /* 参数校验：句柄非空、地址 4 字节对齐、FIFO 深度不小于 8 的 2 的幂 */
    if (h == NULL || (base_addr & 0x3U) != 0U || fifo_depth < 8U) {
        return -1;
    }

    h->base       = (volatile uint32_t *)base_addr;
    h->fifo_depth = fifo_depth;

    return 0;
}

void i2c_soft_reset(i2c_handle_t *h)
{
    /*
     * 写 CTRL bit31=1 触发同步软复位。
     * SOFT_RST 需要 pstrb[3]（最高字节选通），32 位全字写满足要求。
     */
    i2c_reg_write(h->base, I2C_REG_CTRL, I2C_CTRL_SOFT_RST);
}

void i2c_set_timing(i2c_handle_t *h, uint32_t prescale)
{
    i2c_reg_write(h->base, I2C_REG_TIMING, prescale & I2C_TIMING_PRESCALE_MASK);
}

void i2c_set_stretch_timeout(i2c_handle_t *h, uint32_t cycles)
{
    i2c_reg_write(h->base, I2C_REG_STRETCH_TIMEOUT, cycles);
}

/* =========================================================================
 * 2. 模式与使能
 * ========================================================================= */

void i2c_set_mode(i2c_handle_t *h, bool master)
{
    uint32_t ctrl;

    /*
     * 只有写入发生前 ENABLE=0 时，MASTER_MODE 变化才会被接受。
     * 成功切换模式会复位两个协议内核并清空两个 FIFO。
     * 外设已使能时尝试改变模式会保留旧模式并置位 CMD_ERROR。
     * 因此驱动必须使用两次独立写入：先关闭（本函数保持关闭），再使能。
     */
    ctrl = 0U;
    if (master) {
        ctrl |= I2C_CTRL_MASTER_MODE;
    }
    i2c_reg_write(h->base, I2C_REG_CTRL, ctrl);
}

void i2c_enable(i2c_handle_t *h, bool en)
{
    uint32_t ctrl;

    /* 读改写：保留模式位，只修改 ENABLE */
    ctrl = i2c_reg_read(h->base, I2C_REG_CTRL) & I2C_CTRL_EN_MODE_MASK;
    if (en) {
        ctrl |= I2C_CTRL_ENABLE;
    } else {
        ctrl &= ~I2C_CTRL_ENABLE;
    }
    i2c_reg_write(h->base, I2C_REG_CTRL, ctrl);
}

uint32_t i2c_get_enable_mode(i2c_handle_t *h)
{
    return i2c_reg_read(h->base, I2C_REG_CTRL) & I2C_CTRL_EN_MODE_MASK;
}

/* =========================================================================
 * 3. 主机操作
 * ========================================================================= */

/** 内部：等待一条主机命令结束并返回错误检查结果 */
static int i2c_master_wait_done(i2c_handle_t *h)
{
    uint32_t status;

    /* 轮询等待 MASTER_DONE */
    while ((i2c_reg_read(h->base, I2C_REG_IRQ_STATUS) & I2C_IRQ_MASTER_DONE) == 0U) {
        /* spin */
    }

    status = i2c_reg_read(h->base, I2C_REG_IRQ_STATUS);

    /* MASTER_DONE 只表示命令已经结束，不表示成功；必须检查错误位 */
    if ((status & I2C_MASTER_ERROR_MASK) != 0U) {
        i2c_reg_write(h->base, I2C_REG_IRQ_STATUS, status); /* W1C 已处理 */
        return -1;
    }

    i2c_reg_write(h->base, I2C_REG_IRQ_STATUS, status);     /* W1C */
    return 0;
}

int i2c_master_write(i2c_handle_t *h, uint8_t target, const uint8_t *data, size_t len)
{
    size_t i;

    if (len == 0U || len > h->fifo_depth) {
        return -1;
    }

    /* 确认主机模式已使能且空闲 */
    if (!i2c_master_busy(h) && (i2c_get_enable_mode(h) & I2C_CTRL_MASTER_MODE) != 0U) {
        /* 空闲状态清 FIFO、清旧中断 */
        i2c_reg_write(h->base, I2C_REG_CTRL,
                      I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_RX_CLR);
    }

    /* 配置写命令：OP=WRITE、TARGET、TX_LEN、RX_LEN=0 */
    i2c_reg_write(h->base, I2C_REG_MASTER_CMD,
                  ((uint32_t)I2C_OP_WRITE << I2C_CMD_OP_SHIFT) |
                  ((uint32_t)target << I2C_CMD_TARGET_SHIFT) |
                  ((uint32_t)len << I2C_CMD_TX_LEN_SHIFT));

    /* 向 TX_DATA 写入至少 TX_LEN 个字节 */
    for (i = 0U; i < len; ++i) {
        i2c_reg_write(h->base, I2C_REG_TX_DATA, data[i]);
    }

    /* 单独写 START（ENABLE 与 START 必须分成两次写入） */
    i2c_reg_write(h->base, I2C_REG_CTRL,
                  I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_START);

    return i2c_master_wait_done(h);
}

/** 内部：按同步 FIFO 流程排空 RX（先保存数量，预取一次，再读 N 次） */
static size_t i2c_drain_rx(i2c_handle_t *h, uint8_t *buffer, size_t capacity)
{
    size_t count;
    size_t i;

    count = i2c_rx_level(h);
    if (count > capacity) {
        count = capacity;
    }
    if (count == 0U) {
        return 0U;
    }

    (void)i2c_reg_read(h->base, I2C_REG_RX_DATA);  /* 预取，必须丢弃 */
    for (i = 0U; i < count; ++i) {
        buffer[i] = (uint8_t)i2c_reg_read(h->base, I2C_REG_RX_DATA);
    }

    return count;
}

int i2c_master_read(i2c_handle_t *h, uint8_t target, uint8_t *buffer, size_t len)
{
    if (len == 0U || len > h->fifo_depth) {
        return -1;
    }

    /* 空闲时清 RX FIFO，保留模式和使能 */
    i2c_reg_write(h->base, I2C_REG_CTRL,
                  I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_RX_CLR);

    /* 配置读命令：OP=READ、TARGET、TX_LEN=0、RX_LEN */
    i2c_reg_write(h->base, I2C_REG_MASTER_CMD,
                  ((uint32_t)I2C_OP_READ << I2C_CMD_OP_SHIFT) |
                  ((uint32_t)target << I2C_CMD_TARGET_SHIFT) |
                  ((uint32_t)len << I2C_CMD_RX_LEN_SHIFT));

    i2c_reg_write(h->base, I2C_REG_CTRL,
                  I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_START);

    if (i2c_master_wait_done(h) != 0) {
        return -1;
    }

    i2c_drain_rx(h, buffer, len);
    return 0;
}

int i2c_master_write_read(i2c_handle_t *h, uint8_t target,
                          const uint8_t *wdata, size_t wlen,
                          uint8_t *rbuffer, size_t rlen)
{
    size_t i;

    if (wlen == 0U || wlen > h->fifo_depth ||
        rlen == 0U || rlen > h->fifo_depth) {
        return -1;
    }

    /* 空闲状态清空两个 FIFO */
    i2c_reg_write(h->base, I2C_REG_CTRL,
                  I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE |
                  I2C_CTRL_TX_CLR | I2C_CTRL_RX_CLR);

    /* 配置写后读命令：OP=WRITE_READ、TX_LEN、RX_LEN 均非零 */
    i2c_reg_write(h->base, I2C_REG_MASTER_CMD,
                  ((uint32_t)I2C_OP_WRITE_READ << I2C_CMD_OP_SHIFT) |
                  ((uint32_t)target << I2C_CMD_TARGET_SHIFT) |
                  ((uint32_t)wlen << I2C_CMD_TX_LEN_SHIFT) |
                  ((uint32_t)rlen << I2C_CMD_RX_LEN_SHIFT));

    /* 装入写阶段数据 */
    for (i = 0U; i < wlen; ++i) {
        i2c_reg_write(h->base, I2C_REG_TX_DATA, wdata[i]);
    }

    /* 启动：硬件发送写数据后不产生 STOP，直接 RESTART 并读取指定字节数 */
    i2c_reg_write(h->base, I2C_REG_CTRL,
                  I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_START);

    if (i2c_master_wait_done(h) != 0) {
        return -1;
    }

    i2c_drain_rx(h, rbuffer, rlen);
    return 0;
}

bool i2c_master_error(const i2c_handle_t *h, uint32_t status)
{
    (void)h;
    return (status & I2C_MASTER_ERROR_MASK) != 0U;
}

void i2c_master_abort(i2c_handle_t *h)
{
    /*
     * 仅用于仍在活动的主机事务。写入时必须保持 ENABLE=1 和 MASTER_MODE=1，
     * 让主机内核有机会结束事务并产生 MASTER_DONE。
     */
    i2c_reg_write(h->base, I2C_REG_CTRL,
                  I2C_CTRL_ENABLE | I2C_CTRL_MASTER_MODE | I2C_CTRL_ABORT);
}

/* =========================================================================
 * 4. 从机配置
 * ========================================================================= */

void i2c_slave_set_addr(i2c_handle_t *h, uint8_t addr)
{
    /* 地址只能在 ENABLE=0 时修改；已使能时写入会被忽略并置位 CMD_ERROR */
    i2c_reg_write(h->base, I2C_REG_SLAVE_CFG, addr & I2C_SLAVE_ADDR_MASK);
}

void i2c_slave_set_threshold(i2c_handle_t *h, uint32_t rx_threshold, uint32_t tx_threshold)
{
    i2c_reg_write(h->base, I2C_REG_IRQ_THRESHOLD,
                  (rx_threshold & I2C_THRESHOLD_RX_MASK) |
                  ((tx_threshold & 0xFFU) << I2C_THRESHOLD_TX_SHIFT));
}

int i2c_slave_tx_put(i2c_handle_t *h, uint8_t value)
{
    uint32_t fifo;

    fifo = i2c_reg_read(h->base, I2C_REG_FIFO_STATUS);
    if ((fifo & I2C_FIFO_TX_FULL) != 0U) {
        return -1;  /* FIFO 已满时写入被拒绝并置位 CMD_ERROR */
    }

    i2c_reg_write(h->base, I2C_REG_TX_DATA, value);
    return 0;
}

size_t i2c_slave_read_snapshot(i2c_handle_t *h, uint8_t *buffer, size_t capacity)
{
    return i2c_drain_rx(h, buffer, capacity);
}

/* =========================================================================
 * 5. FIFO 与状态查询
 * ========================================================================= */

uint32_t i2c_read_fifo_status(i2c_handle_t *h)
{
    return i2c_reg_read(h->base, I2C_REG_FIFO_STATUS);
}

uint32_t i2c_read_status(i2c_handle_t *h)
{
    return i2c_reg_read(h->base, I2C_REG_STATUS);
}

uint32_t i2c_tx_level(i2c_handle_t *h)
{
    return i2c_reg_read(h->base, I2C_REG_FIFO_STATUS) & I2C_FIFO_TX_LEVEL_MASK;
}

uint32_t i2c_rx_level(i2c_handle_t *h)
{
    return (i2c_reg_read(h->base, I2C_REG_FIFO_STATUS) >> I2C_FIFO_RX_LEVEL_SHIFT) & 0xFFU;
}

bool i2c_master_busy(i2c_handle_t *h)
{
    return (i2c_reg_read(h->base, I2C_REG_STATUS) & I2C_STATUS_MASTER_BUSY) != 0U;
}

/* =========================================================================
 * 6. 中断管理
 * ========================================================================= */

uint32_t i2c_irq_read_status(i2c_handle_t *h)
{
    /* 粘滞原始状态位，不受 IRQ_ENABLE 影响 */
    return i2c_reg_read(h->base, I2C_REG_IRQ_STATUS) & I2C_IRQ_ALL;
}

uint32_t i2c_irq_get_pending(i2c_handle_t *h)
{
    /* 对应 RTL: interrupt = |(IRQ_STATUS & IRQ_ENABLE) */
    uint32_t status = i2c_reg_read(h->base, I2C_REG_IRQ_STATUS);
    uint32_t enable = i2c_reg_read(h->base, I2C_REG_IRQ_ENABLE);
    return status & enable;
}

void i2c_irq_enable(i2c_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= I2C_IRQ_ALL;

    enable_val  = i2c_reg_read(h->base, I2C_REG_IRQ_ENABLE);
    enable_val |= mask;
    i2c_reg_write(h->base, I2C_REG_IRQ_ENABLE, enable_val);
}

void i2c_irq_disable(i2c_handle_t *h, uint32_t mask)
{
    uint32_t enable_val;

    mask &= I2C_IRQ_ALL;

    enable_val  = i2c_reg_read(h->base, I2C_REG_IRQ_ENABLE);
    enable_val &= ~mask;
    i2c_reg_write(h->base, I2C_REG_IRQ_ENABLE, enable_val);
}

void i2c_irq_clear_status(i2c_handle_t *h, uint32_t mask)
{
    /*
     * W1C：向某位写 1 清除该位。硬件事件与 W1C 同拍时事件置位优先。
     * 若阈值/电平条件仍成立，W1C 后对应位会在下一拍再次置位，
     * 应先在清除前补充或排空 FIFO。
     */
    i2c_reg_write(h->base, I2C_REG_IRQ_STATUS, mask & I2C_IRQ_ALL);
}
