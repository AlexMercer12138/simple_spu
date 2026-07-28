volatile unsigned int irq_count = 0;
volatile unsigned int irq_error = 0;
volatile unsigned int irq_bytes[2];

unsigned int status_addr = 0x008003C0;
unsigned int fail_addr = 0x008003C4;
unsigned int irq_count_addr = 0x008003C8;
unsigned int ready_code = 0x1234;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;

int uart_wait_tx(void) {
    volatile unsigned int *tx_status = (volatile unsigned int *)0x10000014;
    int remaining = 100000;

    while ((*tx_status & 0x100) == 0) {
        remaining = remaining - 1;
        if (remaining == 0) {
            return 0;
        }
    }
    return 1;
}

int uart_putc(unsigned int value) {
    volatile unsigned int *ctrl = (volatile unsigned int *)0x10000000;
    volatile unsigned int *tx_buf = (volatile unsigned int *)0x10000010;

    if (uart_wait_tx() == 0) {
        return 0;
    }
    *tx_buf = (value & 0xFF) << 24;
    *ctrl = 0x10;
    return 1;
}

void __irq_handler(void) {
    volatile unsigned int *ctrl = (volatile unsigned int *)0x10000000;
    volatile unsigned int *rx_buf = (volatile unsigned int *)0x10000008;
    volatile unsigned int *rx_status = (volatile unsigned int *)0x1000000C;
    volatile unsigned int *uart_interrupt = (volatile unsigned int *)0x10000018;
    volatile unsigned int *irq_count_status =
        (volatile unsigned int *)irq_count_addr;
    unsigned int index = irq_count;
    int remaining = 100000;

    *uart_interrupt = 0;
    *ctrl = 1;
    while (((*rx_status & 3) == 0) && (remaining != 0)) {
        remaining = remaining - 1;
    }

    if (remaining == 0 || index >= 2) {
        irq_error = 1;
    } else {
        irq_bytes[index] = (*rx_buf >> 24) & 0xFF;
        irq_count = index + 1;
        *irq_count_status = irq_count;
    }

    *uart_interrupt = 1;
}

int main(void) {
    volatile unsigned int *config = (volatile unsigned int *)0x10000004;
    volatile unsigned int *uart_interrupt = (volatile unsigned int *)0x10000018;
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;
    unsigned int heartbeat = 0;
    unsigned int guard = 0x2468ACE0;
    unsigned int echo_count = 0;
    unsigned int delay = 0;

    *config = 100000;
    while (delay < 64) {
        delay = delay + 1;
    }
    *uart_interrupt = 1;
    __irq_enable();
    *status = ready_code;

    while (echo_count < 2 && irq_error == 0) {
        if (echo_count < irq_count) {
            if (uart_putc(irq_bytes[echo_count]) == 0) {
                irq_error = 3;
            } else {
                echo_count = echo_count + 1;
            }
        }

        if (guard == 0x2468ACE0) {
            heartbeat = heartbeat + 1;
        } else {
            irq_error = 2;
        }
    }

    __irq_disable();
    *uart_interrupt = 0;
    if (irq_error != 0 || irq_count != 2 || echo_count != 2 ||
        heartbeat == 0 || irq_bytes[0] != 0x21 || irq_bytes[1] != 0x3F) {
        *fail = irq_error + 20;
        *status = fail_code;
        return 1;
    }

    *status = pass_code;
    return 0;
}
