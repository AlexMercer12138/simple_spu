unsigned int status_addr = 0x008003C0;
unsigned int fail_addr = 0x008003C4;
unsigned int pass_code = 0x600D;
unsigned int fail_code = 0x0BAD;
int global_seed = 3;
int global_buf[4];
int local_initializer_calls = 0;
char global_char_values[] = {
    'A', '\a', '\b', '\f', '\n', '\r', '\t', '\v',
    '\\', '\'', '\"', '\0', '\101', '\x42',
};
unsigned char global_utf8[8] = "中";
short global_short_values[] = {-2, 300,};
unsigned short global_ushort_values[4] = {65535, 9};
int global_int_values[] = {1000, -50, 7,};
unsigned int global_uint_values[4] = {0xFFFFFFFF, 10};

int local_initializer_value(void) {
    local_initializer_calls++;
    return 1234;
}

int initializer_syntax_tests(void) {
    int score = 0;
    char local_chars[8] = "A\n\t\\\"";
    unsigned char local_uchars[] = {1, 255, 3,};
    short local_shorts[4] = {-300, 400};
    unsigned short local_ushorts[] = {60000, 2,};
    int local_ints[4] = {local_initializer_value(), 20};
    unsigned int local_uints[] = {0x80000000, 7,};

    if (global_char_values[0] == 65) score = score + 1;
    if (global_char_values[1] == 7) score = score + 1;
    if (global_char_values[2] == 8) score = score + 1;
    if (global_char_values[3] == 12) score = score + 1;
    if (global_char_values[4] == 10) score = score + 1;
    if (global_char_values[5] == 13) score = score + 1;
    if (global_char_values[6] == 9) score = score + 1;
    if (global_char_values[7] == 11) score = score + 1;
    if (global_char_values[8] == 92) score = score + 1;
    if (global_char_values[9] == 39) score = score + 1;
    if (global_char_values[10] == 34) score = score + 1;
    if (global_char_values[11] == 0) score = score + 1;
    if (global_char_values[12] == 65) score = score + 1;
    if (global_char_values[13] == 66) score = score + 1;

    if (global_utf8[0] == 0xE4) score = score + 1;
    if (global_utf8[1] == 0xB8) score = score + 1;
    if (global_utf8[2] == 0xAD) score = score + 1;
    if (global_utf8[3] == 0) score = score + 1;
    if (global_utf8[4] == 0) score = score + 1;
    if (global_utf8[5] == 0) score = score + 1;
    if (global_utf8[6] == 0) score = score + 1;
    if (global_utf8[7] == 0) score = score + 1;

    if (global_short_values[0] == -2) score = score + 1;
    if (global_short_values[1] == 300) score = score + 1;
    if (global_ushort_values[0] == 65535) score = score + 1;
    if (global_ushort_values[1] == 9) score = score + 1;
    if (global_ushort_values[2] == 0) score = score + 1;
    if (global_ushort_values[3] == 0) score = score + 1;
    if (global_int_values[0] == 1000) score = score + 1;
    if (global_int_values[1] == -50) score = score + 1;
    if (global_int_values[2] == 7) score = score + 1;
    if (global_uint_values[0] == 0xFFFFFFFF) score = score + 1;
    if (global_uint_values[1] == 10) score = score + 1;
    if (global_uint_values[2] == 0) score = score + 1;
    if (global_uint_values[3] == 0) score = score + 1;

    if (local_chars[0] == 65) score = score + 1;
    if (local_chars[1] == 10) score = score + 1;
    if (local_chars[2] == 9) score = score + 1;
    if (local_chars[3] == 92) score = score + 1;
    if (local_chars[4] == 34) score = score + 1;
    if (local_chars[5] == 0) score = score + 1;
    if (local_chars[6] == 0) score = score + 1;
    if (local_chars[7] == 0) score = score + 1;
    if (local_uchars[0] == 1) score = score + 1;
    if (local_uchars[1] == 255) score = score + 1;
    if (local_uchars[2] == 3) score = score + 1;
    if (local_shorts[0] == -300) score = score + 1;
    if (local_shorts[1] == 400) score = score + 1;
    if (local_shorts[2] == 0) score = score + 1;
    if (local_shorts[3] == 0) score = score + 1;
    if (local_ushorts[0] == 60000) score = score + 1;
    if (local_ushorts[1] == 2) score = score + 1;
    if (local_ints[0] == 1234) score = score + 1;
    if (local_ints[1] == 20) score = score + 1;
    if (local_ints[2] == 0) score = score + 1;
    if (local_ints[3] == 0) score = score + 1;
    if (local_uints[0] == 0x80000000) score = score + 1;
    if (local_uints[1] == 7) score = score + 1;
    if (local_initializer_calls == 1) score = score + 1;

    return score;
}

int update_syntax_tests(void) {
    int score = 0;
    int value = 10;
    unsigned int unsigned_value = 0x80000000;
    char narrow_char = 127;
    unsigned char narrow_uchar = 255;
    short narrow_short = 32767;
    unsigned short narrow_ushort = 65535;
    int data[3] = {10, 20, 30};
    int index = 0;
    int assigned = 0;
    int old = 0;
    int updated = 0;

    value += 5;
    if (value == 15) score = score + 1;
    value -= 3;
    if (value == 12) score = score + 1;
    value *= 4;
    if (value == 48) score = score + 1;
    value /= 6;
    if (value == 8) score = score + 1;
    value %= 5;
    if (value == 3) score = score + 1;
    value &= 6;
    if (value == 2) score = score + 1;
    value |= 8;
    if (value == 10) score = score + 1;
    value ^= 3;
    if (value == 9) score = score + 1;
    value <<= 2;
    if (value == 36) score = score + 1;
    value >>= 1;
    if (value == 18) score = score + 1;

    unsigned_value >>= 31;
    if (unsigned_value == 1) score = score + 1;
    narrow_char += 2;
    if (narrow_char == -127) score = score + 1;
    narrow_uchar += 2;
    if (narrow_uchar == 1) score = score + 1;
    narrow_short += 2;
    if (narrow_short == -32767) score = score + 1;
    narrow_ushort += 2;
    if (narrow_ushort == 1) score = score + 1;

    assigned = (data[index++] += 5);
    if (assigned == 15) score = score + 1;
    if (index == 1) score = score + 1;
    if (data[0] == 15) score = score + 1;
    if (data[1] == 20) score = score + 1;

    value = 5;
    old = value++;
    if (old == 5) score = score + 1;
    if (value == 6) score = score + 1;
    updated = ++value;
    if (updated == 7) score = score + 1;
    if (value == 7) score = score + 1;
    old = value--;
    if (old == 7) score = score + 1;
    if (value == 6) score = score + 1;
    updated = --value;
    if (updated == 5) score = score + 1;
    if (value == 5) score = score + 1;

    return score;
}

int pointer_update_tests(void) {
    int score = 0;
    char bytes[] = {1, 2, 3};
    short halves[] = {10, 20, 30, 40};
    int words[] = {100, 200, 300, 400};
    char *byte_ptr = bytes;
    short *half_ptr = halves;
    int *word_ptr = words;

    byte_ptr++;
    if (*byte_ptr == 2) score = score + 1;
    byte_ptr--;
    if (*byte_ptr == 1) score = score + 1;
    byte_ptr += 2;
    if (*byte_ptr == 3) score = score + 1;
    byte_ptr -= 1;
    if (*byte_ptr == 2) score = score + 1;

    half_ptr++;
    if (*half_ptr == 20) score = score + 1;
    half_ptr--;
    if (*half_ptr == 10) score = score + 1;
    half_ptr += 3;
    if (*half_ptr == 40) score = score + 1;
    half_ptr -= 2;
    if (*half_ptr == 20) score = score + 1;

    word_ptr++;
    if (*word_ptr == 200) score = score + 1;
    word_ptr--;
    if (*word_ptr == 100) score = score + 1;
    word_ptr += 2;
    if (*word_ptr == 300) score = score + 1;
    word_ptr -= 1;
    if (*word_ptr == 200) score = score + 1;

    return score;
}

int conditional_syntax_tests(void) {
    int score = 0;
    int condition = 0;
    int counter = 10;
    int choice = 0;
    int nested = 0;

    choice = condition++ ? ++counter : --counter;
    if (condition == 1) score = score + 1;
    if (counter == 9) score = score + 1;
    if (choice == 9) score = score + 1;

    choice = condition++ ? (counter += 3) : (counter += 100);
    if (condition == 2) score = score + 1;
    if (counter == 12) score = score + 1;
    if (choice == 12) score = score + 1;

    nested = 0 ? (counter += 1000) : 0 ? (counter += 2000) : (counter += 4);
    if (nested == 16) score = score + 1;
    if (counter == 16) score = score + 1;
    nested = 1 ? (0 ? 100 : 7) : 200;
    if (nested == 7) score = score + 1;

    return score;
}

int switch_classify(int value) {
    int result = 0;

    switch (value) {
    case 1:
        result += 1;
    case 2:
        result += 2;
        break;
    case 3:
    case 4:
        result += 4;
        break;
    default:
        result += 8;
    }
    return result;
}

int switch_without_default(int value) {
    int result = 1;

    switch (value) {
    case 7:
        result += 2;
    }
    return result;
}

int nested_switch_value(int outer, int inner) {
    int result = 0;

    switch (outer) {
    case 1:
        switch (inner) {
        case 2:
            result += 1;
            break;
        default:
            result += 2;
        }
        result += 4;
        break;
    default:
        result += 8;
    }
    return result;
}

int loop_in_switch_value(void) {
    int result = 0;

    switch (1) {
    case 1:
        while (result < 3) {
            result++;
            break;
        }
        result += 4;
        break;
    default:
        result += 8;
    }
    return result;
}

int control_syntax_tests(void) {
    int score = 0;
    int count = 0;
    int sum = 0;
    int index = 0;
    int result = 0;
    int loop_index = 0;
    int loop_sum = 0;

    do {
        count++;
    } while (0);
    if (count == 1) score = score + 1;

    count = 0;
    do {
        count++;
        if (count < 3) continue;
        sum += count;
    } while (count < 4);
    if (count == 4) score = score + 1;
    if (sum == 7) score = score + 1;

    if (switch_classify(1) == 3) score = score + 1;
    if (switch_classify(2) == 2) score = score + 1;
    if (switch_classify(3) == 4) score = score + 1;
    if (switch_classify(4) == 4) score = score + 1;
    if (switch_classify(9) == 8) score = score + 1;
    if (switch_without_default(7) == 3) score = score + 1;
    if (switch_without_default(99) == 1) score = score + 1;
    if (nested_switch_value(1, 2) == 5) score = score + 1;
    if (nested_switch_value(1, 9) == 6) score = score + 1;
    if (nested_switch_value(9, 2) == 8) score = score + 1;

    switch (index++) {
    case 0:
        result = 10;
        break;
    default:
        result = 20;
    }
    if (index == 1) score = score + 1;
    if (result == 10) score = score + 1;

    while (loop_index < 4) {
        loop_index++;
        switch (loop_index) {
        case 1:
            continue;
        case 2:
            loop_sum += 2;
            break;
        default:
            loop_sum += 1;
        }
        loop_sum += 10;
        if (loop_index == 3) break;
    }
    if (loop_index == 3) score = score + 1;
    if (loop_sum == 23) score = score + 1;
    if (loop_in_switch_value() == 5) score = score + 1;

    return score;
}

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
    int expected = 520;
    int initializer_result = 0;
    int update_result = 0;
    int pointer_result = 0;
    int conditional_result = 0;
    int control_result = 0;
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

    initializer_result = initializer_syntax_tests();
    if (initializer_result != 59) {
        *fail = 0x01000000 | (initializer_result & 0x00FFFFFF);
        *status = fail_code;
        return initializer_result;
    }
    update_result = update_syntax_tests();
    if (update_result != 27) {
        *fail = 0x02000000 | (update_result & 0x00FFFFFF);
        *status = fail_code;
        return update_result;
    }
    pointer_result = pointer_update_tests();
    if (pointer_result != 12) {
        *fail = 0x03000000 | (pointer_result & 0x00FFFFFF);
        *status = fail_code;
        return pointer_result;
    }
    conditional_result = conditional_syntax_tests();
    if (conditional_result != 9) {
        *fail = 0x04000000 | (conditional_result & 0x00FFFFFF);
        *status = fail_code;
        return conditional_result;
    }
    control_result = control_syntax_tests();
    if (control_result != 18) {
        *fail = 0x05000000 | (control_result & 0x00FFFFFF);
        *status = fail_code;
        return control_result;
    }

    total = total + initializer_result;
    total = total + update_result;
    total = total + pointer_result;
    total = total + conditional_result;
    total = total + control_result;

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
