unsigned int timer_base = 0x10030000;
volatile unsigned int timer_ticks = 0;

void timer_disable(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    unsigned int control = timer[0] & 3;

    if (channel == 0) {
        control = control & 2;
    } else if (channel == 1) {
        control = control & 1;
    }
    timer[0] = control;
}

void timer_enable(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    unsigned int control = timer[0] & 3;

    if (channel == 0) {
        control = control | 1;
    } else if (channel == 1) {
        control = control | 2;
    }
    timer[0] = control;
}

void timer_clear(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;
    unsigned int control = timer[0] & 3;

    if (channel == 0) {
        timer[0] = control | 0x100;
    } else if (channel == 1) {
        timer[0] = control | 0x200;
    }
}

int timer_configure(unsigned int channel, unsigned int config,
                    unsigned int count_max,
                    unsigned int pwm_compare) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;

    if (channel == 0) {
        timer_disable(0);
        timer[3] = config;
        timer[5] = count_max;
        timer[6] = pwm_compare;
        timer_clear(0);
        return 1;
    }
    if (channel == 1) {
        timer_disable(1);
        timer[7] = config;
        timer[9] = count_max;
        timer[10] = pwm_compare;
        timer_clear(1);
        return 1;
    }
    return 0;
}

unsigned int timer_count(unsigned int channel) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;

    if (channel == 0) {
        return timer[4];
    }
    if (channel == 1) {
        return timer[8];
    }
    return 0;
}

void timer_irq_enable(unsigned int mask) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;

    timer[2] = mask & 7;
}

unsigned int timer_irq_pending(void) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;

    return timer[1] & 7;
}

void timer_irq_clear(unsigned int mask) {
    volatile unsigned int *timer =
        (volatile unsigned int *)timer_base;

    timer[1] = mask & 7;
}

void __irq_handler(void) {
    unsigned int pending = timer_irq_pending();

    if ((pending & 1) != 0) {
        timer_irq_clear(1);
        timer_ticks = timer_ticks + 1;
    }
    if ((pending & 6) != 0) {
        timer_irq_clear(pending & 6);
    }
}

int timer_fail(unsigned int stage) {
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
    unsigned int stopped_ticks = 0;
    int remaining = 400000;
    int settle = 256;

    if (timer_configure(2, 0, 1, 0) != 0) {
        return timer_fail(1);
    }
    if (timer_configure(0, 0, 4095, 0) == 0) {
        return timer_fail(2);
    }
    if (timer_configure(1, 2, 31, 8) == 0) {
        return timer_fail(3);
    }

    timer_irq_clear(7);
    timer_irq_enable(1);
    timer_enable(1);
    timer_enable(0);
    __irq_enable();
    *detail = 0x3001;

    while ((timer_ticks < 3) && (remaining > 0)) {
        remaining = remaining - 1;
    }
    if (remaining == 0) {
        return timer_fail(4);
    }

    timer_disable(0);
    __irq_disable();
    timer_irq_enable(0);
    timer_irq_clear(7);
    stopped_ticks = timer_ticks;
    while (settle > 0) {
        settle = settle - 1;
    }
    if (timer_ticks != stopped_ticks) {
        return timer_fail(5);
    }
    if ((timer_irq_pending() & 1) != 0) {
        return timer_fail(6);
    }

    *detail = 0x3002;
    *status = 0x600D;
    return 0;
}
