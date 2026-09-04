void test_pass(int value);

int scalar(int left, int right) {
    return left + right * 2;
}

int main(void) {
    test_pass(scalar(3, 4));
    return 0;
}
