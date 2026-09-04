void test_pass(int value);

struct Pair {
    int first;
    int second;
};

struct Pair pair = { 4, 9 };

int main(void) {
    pair.second = pair.second + 1;
    test_pass(pair.first + pair.second);
    return 0;
}
