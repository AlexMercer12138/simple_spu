volatile unsigned int irq_count = 0;
volatile unsigned int irq_error = 0;

unsigned int status_addr = 0x080003C0;
unsigned int fail_addr = 0x080003C4;
unsigned int ready_code = 0x1234;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;

unsigned int irq_compare_noise(unsigned int value) {
    if (value > 3) {
        return value - 1;
    }
    return value + 1;
}

void __irq_handler(void) {
    irq_count = irq_count + 1;
    if (irq_compare_noise(7) == 0) {
        irq_error = 1;
    }
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;
    unsigned int guard = 0x13579BDF;
    unsigned int iterations = 0;

    __irq_enable();
    *status = ready_code;

    while (irq_count == 0) {
        if (guard == 0x13579BDF) {
            iterations = iterations + 1;
        } else {
            irq_error = 2;
        }
        if (iterations > 100000) {
            irq_error = 3;
            break;
        }
    }

    __irq_disable();
    if (irq_count != 1 || irq_error != 0 ||
        guard != 0x13579BDF || iterations == 0) {
        *fail = irq_error + 10;
        *status = fail_code;
        return 1;
    }

    *status = pass_code;
    return 0;
}
