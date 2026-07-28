unsigned int status_addr = 0x008003C0;
unsigned int fail_addr = 0x008003C4;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;
int global_seed = 3;
int global_buf[4];

int pointer_demo(void) {
    int local = 40;
    int *ptr = &local;
    volatile unsigned int *scratch = (volatile unsigned int *)0x00800200;

    *ptr = *ptr + 2;
    *scratch = *ptr;
    *(scratch + 1) = *scratch + 1;

    return *(scratch + 1);
}

int array_demo(void) {
    int local_buf[4];
    int *p = &local_buf[0];

    local_buf[0] = 3;
    local_buf[1] = 4;
    p[2] = local_buf[0] + local_buf[1];
    *(p + 3) = p[2] + 1;

    global_buf[0] = local_buf[3];
    global_buf[1] = global_buf[0] + 1;

    return local_buf[0] + local_buf[1] + local_buf[2] + local_buf[3] + global_buf[1];
}

int zero(void) {
    return 7;
}

int one(int a) {
    return a + 1;
}

int four(int a, int b, int c, int d) {
    return a + b + c + d;
}

int five(int a, int b, int c, int d, int e) {
    return a + b + c + d + e;
}

int eight(int a, int b, int c, int d, int e, int f, int g, int h) {
    return a + b + c + d + e + f + g + h;
}

int control_flow(int limit) {
    int sum = 0;
    int i = 0;

    while (i < limit) {
        i = i + 1;
        if (i == 2) {
            continue;
        }
        if (i > 6) {
            break;
        }
        sum = sum + i;
    }

    for (i = 0; i < 4; i = i + 1) {
        sum = sum + i;
    }

    if (sum == 25) {
        goto ok;
    }

    sum = 0;

ok:
    return sum;
}

unsigned int unsigned_check(unsigned int a, unsigned int b) {
    unsigned int result = 0;

    if (a > b) {
        result = result + 1;
    }
    if (b <= a) {
        result = result + 2;
    }
    if (a != b) {
        result = result + 4;
    }

    return result;
}

int nested_args(int x) {
    int y = five(x, x + 1, one(x), four(1, 2, 3, 4), eight(1, 2, 3, 4, 5, 6, 7, 8));
    return y;
}

int expression_args(int a, int b) {
    return five(a + 1, b, zero(), 4, a + b);
}

int bit_ops(int x) {
    int y = x << 2;
    y = y ^ 0x55;
    y = y & 0x7F;
    y = y | 0x80;
    y = y >> 1;
    y = ~y;
    y = -y;
    return y;
}

int main(void) {
    int total = 0;
    int expected = 395;
    unsigned int ures = 0;
    volatile unsigned int *status = (volatile unsigned int *)status_addr;
    volatile unsigned int *fail = (volatile unsigned int *)fail_addr;

    total = total + zero();
    total = total + one(4);
    total = total + four(1, 2, 3, 4);
    total = total + five(1, 2, 3, 4, 5);
    total = total + eight(1, 2, 3, 4, 5, 6, 7, 8);
    total = total + control_flow(8);
    total = total + nested_args(global_seed);
    total = total + expression_args(6, 7);
    total = total + bit_ops(9);
    total = total + pointer_demo();
    total = total + array_demo();

    ures = unsigned_check(0xFFFF, 1);
    total = total + ures;

    if (total == expected) {
        *status = pass_code;
    } else {
        *fail = total;
        *status = fail_code;
    }

    return total;
}
