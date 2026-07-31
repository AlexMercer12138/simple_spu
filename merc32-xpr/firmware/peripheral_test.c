unsigned int uart_base = 0x10000000;
unsigned int i2c_base = 0x10010000;
unsigned int gpio_base = 0x10020000;
unsigned int timer_base = 0x10030000;
volatile unsigned int timer_ticks = 0;

void delay_cycles(int count) {
    int index = 0;

    while (index < count) {
        index = index + 1;
    }
}

void uart_init(void) {
    volatile unsigned int *uart = (volatile unsigned int *)uart_base;
    int index = 0;

    uart[0] = 0x80000000;
    uart[1] = 115200;
    while (index < 64) {
        index = index + 1;
    }
    uart[0] = 3;
}

int uart_putc(unsigned int value) {
    volatile unsigned int *uart = (volatile unsigned int *)uart_base;
    int remaining = 1000000;

    while ((uart[5] & 0x200) != 0) {
        remaining = remaining - 1;
        if (remaining == 0) {
            return 0;
        }
    }
    uart[4] = value & 0xff;
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

unsigned int hex_digit(unsigned int value) {
    value = value & 0xf;
    if (value < 10) {
        return value + 0x30;
    }
    return value + 0x37;
}

void uart_put_hex_byte(unsigned int value) {
    uart_putc(hex_digit(value >> 4));
    uart_putc(hex_digit(value));
}

void uart_put_hex(unsigned int value) {
    int shift = 28;

    while (shift >= 0) {
        uart_putc(hex_digit(value >> shift));
        shift = shift - 4;
    }
}

void uart_newline(void) {
    uart_putc(0x0d);
    uart_putc(0x0a);
}

void uart_service_rx(void) {
    volatile unsigned int *uart = (volatile unsigned int *)uart_base;
    unsigned int level = uart[3] & 0xff;
    unsigned int value = 0;
    unsigned int discarded = 0;
    int index = 0;

    discarded = uart[2];
    while (index < level) {
        value = uart[2];
        uart_putc(value & 0xff);
        index = index + 1;
    }
}

void print_banner(void) {
    unsigned int message[13];

    message[0] = 0x4d;
    message[1] = 0x45;
    message[2] = 0x52;
    message[3] = 0x43;
    message[4] = 0x33;
    message[5] = 0x32;
    message[6] = 0x20;
    message[7] = 0x46;
    message[8] = 0x50;
    message[9] = 0x47;
    message[10] = 0x41;
    message[11] = 0x0d;
    message[12] = 0x0a;
    uart_write(message, 13);
}

void print_gpio_ok(void) {
    unsigned int message[9];

    message[0] = 0x47;
    message[1] = 0x50;
    message[2] = 0x49;
    message[3] = 0x4f;
    message[4] = 0x20;
    message[5] = 0x4f;
    message[6] = 0x4b;
    message[7] = 0x0d;
    message[8] = 0x0a;
    uart_write(message, 9);
}

void print_i2c_ok(unsigned int address, unsigned int data) {
    unsigned int prefix[9];

    prefix[0] = 0x49;
    prefix[1] = 0x32;
    prefix[2] = 0x43;
    prefix[3] = 0x20;
    prefix[4] = 0x4f;
    prefix[5] = 0x4b;
    prefix[6] = 0x20;
    prefix[7] = 0x30;
    prefix[8] = 0x78;
    uart_write(prefix, 9);
    uart_put_hex_byte(address);
    uart_putc(0x20);
    uart_putc(0x30);
    uart_putc(0x78);
    uart_put_hex_byte(data);
    uart_newline();
}

void print_i2c_fail(void) {
    unsigned int message[10];

    message[0] = 0x49;
    message[1] = 0x32;
    message[2] = 0x43;
    message[3] = 0x20;
    message[4] = 0x46;
    message[5] = 0x41;
    message[6] = 0x49;
    message[7] = 0x4c;
    message[8] = 0x0d;
    message[9] = 0x0a;
    uart_write(message, 10);
}

void print_key(unsigned int keys) {
    unsigned int prefix[6];

    prefix[0] = 0x4b;
    prefix[1] = 0x45;
    prefix[2] = 0x59;
    prefix[3] = 0x20;
    prefix[4] = 0x30;
    prefix[5] = 0x78;
    uart_write(prefix, 6);
    uart_putc(hex_digit(keys));
    uart_newline();
}

void print_timer_tick(unsigned int ticks) {
    unsigned int prefix[13];

    prefix[0] = 0x54;
    prefix[1] = 0x49;
    prefix[2] = 0x4d;
    prefix[3] = 0x45;
    prefix[4] = 0x52;
    prefix[5] = 0x20;
    prefix[6] = 0x74;
    prefix[7] = 0x69;
    prefix[8] = 0x63;
    prefix[9] = 0x6b;
    prefix[10] = 0x20;
    prefix[11] = 0x30;
    prefix[12] = 0x78;
    uart_write(prefix, 13);
    uart_put_hex(ticks);
    uart_newline();
}

void gpio_init(void) {
    volatile unsigned int *gpio = (volatile unsigned int *)gpio_base;

    gpio[2] = 0;
    gpio[1] = 0x0000000f;
}

void gpio_led_test(void) {
    volatile unsigned int *gpio = (volatile unsigned int *)gpio_base;

    gpio[2] = 1;
    delay_cycles(1000000);
    gpio[2] = 2;
    delay_cycles(1000000);
    gpio[2] = 4;
    delay_cycles(1000000);
    gpio[2] = 8;
    delay_cycles(1000000);
    gpio[2] = 0;
}

unsigned int gpio_read_keys(void) {
    volatile unsigned int *gpio = (volatile unsigned int *)gpio_base;

    return (gpio[6] >> 4) & 0xf;
}

void gpio_write_keys(unsigned int keys) {
    volatile unsigned int *gpio = (volatile unsigned int *)gpio_base;

    gpio[2] = keys & 0xf;
}

int i2c_read_address(unsigned int address, unsigned int *value) {
    volatile unsigned int *i2c = (volatile unsigned int *)i2c_base;
    unsigned int status = 0;
    unsigned int level = 0;
    unsigned int discarded = 0;
    int remaining = 1000000;

    i2c[0] = 0x80000000;
    i2c[0] = 2;
    i2c[0] = 0x32;
    i2c[9] = 0x3fff;
    i2c[1] = 1 | (address << 8) | (1 << 24);
    i2c[0] = 3;
    i2c[0] = 7;

    status = i2c[9];
    while (((status & 1) == 0) && ((status & 0x203e) == 0) &&
           (remaining > 0)) {
        remaining = remaining - 1;
        status = i2c[9];
    }

    if ((remaining == 0) || ((status & 0x203e) != 0) ||
        ((status & 1) == 0)) {
        i2c[0] = 2;
        i2c[9] = 0x3fff;
        return 0;
    }

    level = (i2c[6] >> 8) & 0xff;
    if (level != 1) {
        i2c[0] = 2;
        i2c[9] = 0x3fff;
        return 0;
    }

    discarded = i2c[5];
    *value = i2c[5] & 0xff;
    i2c[0] = 2;
    i2c[9] = 0x3fff;
    return 1;
}

void i2c_scan(void) {
    unsigned int address = 0x50;
    unsigned int value = 0;
    int found = 0;

    while (address <= 0x57) {
        if (i2c_read_address(address, &value) != 0) {
            print_i2c_ok(address, value);
            found = 1;
        }
        address = address + 1;
    }
    if (found == 0) {
        print_i2c_fail();
    }
}

void timer_init(void) {
    volatile unsigned int *timer = (volatile unsigned int *)timer_base;

    timer[0] = 0;
    timer[3] = 0;
    timer[5] = 49999999;
    timer[6] = 0;
    timer[1] = 7;
    timer[2] = 1;
    timer[0] = 0x100;
    timer[0] = 1;
}

void __irq_handler(void) {
    volatile unsigned int *timer_status =
        (volatile unsigned int *)0x10030004;

    if ((*timer_status & 1) != 0) {
        *timer_status = 1;
        timer_ticks = timer_ticks + 1;
    }
}

int main(void) {
    unsigned int keys = 0;
    unsigned int last_keys = 16;
    unsigned int ticks = 0;
    unsigned int last_ticks = 0;

    uart_init();
    print_banner();
    gpio_init();
    gpio_led_test();
    print_gpio_ok();
    i2c_scan();
    timer_init();
    __irq_enable();

    while (1) {
        uart_service_rx();

        keys = gpio_read_keys();
        gpio_write_keys(keys);
        if (keys != last_keys) {
            print_key(keys);
            last_keys = keys;
        }

        ticks = timer_ticks;
        if (ticks != last_ticks) {
            print_timer_tick(ticks);
            last_ticks = ticks;
        }
    }

    return 0;
}
