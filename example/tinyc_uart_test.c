unsigned int status_addr = 0x008003C0;
unsigned int fail_addr = 0x008003C4;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;

void uart_init(unsigned int baud_rate) {
    volatile unsigned int *config = (volatile unsigned int *)0x10000004;
    int i = 0;

    *config = baud_rate;
    while (i < 64) {
        i = i + 1;
    }
}

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

int uart_write(unsigned int *data, int length) {
    int i = 0;

    while (i < length) {
        if (uart_putc(data[i]) == 0) {
            return 0;
        }
        i = i + 1;
    }
    return 1;
}

int uart_getc(unsigned int *value) {
    volatile unsigned int *ctrl = (volatile unsigned int *)0x10000000;
    volatile unsigned int *rx_buf = (volatile unsigned int *)0x10000008;
    volatile unsigned int *rx_status = (volatile unsigned int *)0x1000000C;
    int remaining = 100000;

    *ctrl = 0x1;
    while ((*rx_status & 0x3) == 0) {
        remaining = remaining - 1;
        if (remaining == 0) {
            return 0;
        }
    }

    *value = (*rx_buf >> 24) & 0xFF;
    return 1;
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;
    unsigned int message[8];
    unsigned int received = 0;

    message[0] = 0x4D;
    message[1] = 0x45;
    message[2] = 0x52;
    message[3] = 0x43;
    message[4] = 0x33;
    message[5] = 0x32;
    message[6] = 0x0D;
    message[7] = 0x0A;

    uart_init(100000);
    if (uart_write(message, 8) == 0) {
        *fail = 1;
        *status = fail_code;
        return 1;
    }
    if (uart_getc(&received) == 0) {
        *fail = 2;
        *status = fail_code;
        return 2;
    }
    if (uart_putc(received) == 0) {
        *fail = 3;
        *status = fail_code;
        return 3;
    }

    *status = pass_code;
    return 0;
}
