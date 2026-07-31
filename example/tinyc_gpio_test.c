unsigned int gpio_base = 0x10020000;
volatile unsigned int gpio_irq_seen = 0;
volatile unsigned int gpio_irq_count = 0;

void gpio_init(unsigned int direction, unsigned int output) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[2] = output;
    gpio[1] = direction;
}

void gpio_write(unsigned int value) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[2] = value;
}

void gpio_set(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[3] = mask;
}

void gpio_clear(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[4] = mask;
}

void gpio_toggle(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[5] = mask;
}

unsigned int gpio_read(void) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    return gpio[6];
}

void gpio_irq_config(unsigned int type, unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[8] = 0;
    gpio[7] = type;
    gpio[9] = 0xFFFFFFFF;
    gpio[8] = mask;
}

unsigned int gpio_irq_pending(void) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    return gpio[9];
}

void gpio_irq_clear(unsigned int mask) {
    volatile unsigned int *gpio =
        (volatile unsigned int *)gpio_base;

    gpio[9] = mask;
}

void __irq_handler(void) {
    unsigned int pending = gpio_irq_pending();

    if (pending != 0) {
        gpio_irq_seen = gpio_irq_seen | pending;
        gpio_irq_count = gpio_irq_count + 1;
        gpio_irq_clear(pending);
    }
}

int gpio_wait_input(unsigned int expected, int limit) {
    while (gpio_read() != expected) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    return 1;
}

int gpio_wait_irq(int limit) {
    while (gpio_irq_count == 0) {
        limit = limit - 1;
        if (limit == 0) {
            return 0;
        }
    }
    return 1;
}

int gpio_fail(unsigned int stage) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;

    *detail = stage;
    *status = 0x0BAD;
    return 1;
}

int main(void) {
    volatile unsigned int *status =
        (volatile unsigned int *)0x008003C0;
    volatile unsigned int *detail =
        (volatile unsigned int *)0x008003C4;

    gpio_init(0x0000000F, 0);
    gpio_write(5);
    *detail = 0x2001;
    gpio_set(2);
    *detail = 0x2002;
    gpio_clear(1);
    *detail = 0x2003;
    gpio_toggle(0xF);
    *detail = 0x2004;

    *detail = 0x2100;
    if (gpio_wait_input(0xA0, 100000) == 0) {
        return gpio_fail(1);
    }
    *detail = 0x2101;
    if (gpio_wait_input(0, 100000) == 0) {
        return gpio_fail(2);
    }

    gpio_irq_config(2, 0x10);
    __irq_enable();
    *detail = 0x2102;
    if (gpio_wait_irq(100000) == 0) {
        return gpio_fail(3);
    }
    __irq_disable();
    if ((gpio_irq_seen & 0x10) == 0) {
        return gpio_fail(4);
    }
    if (gpio_irq_count != 1) {
        return gpio_fail(5);
    }
    if (gpio_irq_pending() != 0) {
        return gpio_fail(6);
    }

    *detail = 0x2103;
    *status = 0x600D;
    return 0;
}
