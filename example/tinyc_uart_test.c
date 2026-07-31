unsigned int status_addr = 0x008003C0;
unsigned int detail_addr = 0x008003C4;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;
unsigned int uart_base = 0x10000000;

void uart_delay(int count) {
    int index = 0;

    while (index < count) {
        index = index + 1;
    }
}

void uart_init(unsigned int baud_rate) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;

    uart[0] = 0x80000000;
    uart[1] = baud_rate;
    uart_delay(64);
    uart[0] = 0x0000000C;
    uart[0] = 0x00000003;
}

int uart_wait_tx(int limit) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;

    while ((uart[5] & 0x200) != 0) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    return 1;
}

int uart_putc(unsigned int value) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;

    if (uart_wait_tx(100000) == 0) {
        return 0;
    }
    uart[4] = value & 0xFF;
    return 1;
}

int uart_write(unsigned int *data, int length) {
    int index = 0;

    while (index < length) {
        if (uart_putc(data[index]) == 0) {
            return 0;
        }
        index = index + 1;
    }
    return 1;
}

int uart_getc_with_limit(unsigned int *value, int limit) {
    volatile unsigned int *uart =
        (volatile unsigned int *)uart_base;
    unsigned int discarded = 0;

    while ((uart[3] & 0xFF) == 0) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }

    discarded = uart[2];
    *value = uart[2] & 0xFF;
    return 1;
}

int uart_getc(unsigned int *value) {
    return uart_getc_with_limit(value, 100000);
}

int uart_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)status_addr;
    volatile unsigned int *detail =
        (volatile unsigned int *)detail_addr;

    *detail = stage;
    *status = fail_code;
    return 1;
}

int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)status_addr;
    volatile unsigned int *detail =
        (volatile unsigned int *)detail_addr;
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
        return uart_fail(1);
    }
    if (uart_getc_with_limit(&received, 128) != 0) {
        return uart_fail(2);
    }

    *detail = 0x1001;
    if (uart_getc(&received) == 0) {
        return uart_fail(3);
    }
    if (received != 0x21) {
        return uart_fail(4);
    }
    if (uart_putc(received) == 0) {
        return uart_fail(5);
    }

    *status = pass_code;
    return 0;
}
