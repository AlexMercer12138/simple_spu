volatile unsigned int irq_count = 0;

unsigned int status_addr = 0x008003C0;
unsigned int ready_code = 0x1234;
unsigned int pass_code = 0x600D;

void __irq_handler(void) {
    volatile unsigned int *status = (volatile unsigned int *)status_addr;

    irq_count = irq_count + 1;
    *status = pass_code + irq_count;
}

int main(void) {
    volatile unsigned int *status = (volatile unsigned int *)status_addr;

    __irq_enable();
    *status = ready_code;

    while (irq_count < 2) {
    }

    __irq_disable();
    while (1) {
    }

    return 0;
}
