void test_pass(int value);

int main(void) {
    int value = 0;
    int index;
    for (index = 0; index < 4; index = index + 1) {
        if (index == 2) continue;
        value = value + index;
    }
    while (value < 8) value = value + 1;
    test_pass(value);
    return 0;
}
