void test_pass(int value);

int initialized = 7;
int pending;

int main(void) {
    pending = initialized + 5;
    test_pass(pending);
    return 0;
}
