void test_pass(int value);

int add(int left, int right) {
    return left + right;
}

int twice(int value) {
    return add(value, value);
}

int main(void) {
    test_pass(twice(6));
    return 0;
}
