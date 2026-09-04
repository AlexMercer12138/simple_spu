typedef const unsigned long QualifiedWord;
typedef int MatrixRow[3];
typedef int BinaryOperation(int lhs, int rhs);
typedef int * const volatile restrict QualifiedPointer;

enum SignedChoice {
    CHOICE_NEGATIVE = -7,
    CHOICE_LARGE = 2147483647
};

struct Inner {
    char marker;
    int value;
};

union Payload {
    unsigned long word;
    struct Inner inner;
};

struct Outer {
    enum SignedChoice choice;
    union Payload payload;
    MatrixRow rows[2];
};

struct BitFields {
    unsigned int low : 3;
    unsigned int high : 5;
};

struct BitFields zero_bits = { 0 };

QualifiedWord qualified_word = 9;
QualifiedPointer qualified_pointer = 0;
_Atomic(unsigned int) atomic_word = 1;
long long signed_min = (-9223372036854775807LL - 1);
unsigned long long unsigned_max = 18446744073709551615ULL;
float exact_float = 1.5f;
double exact_double = -2.25;
long double exact_long_double = 3.0L;
char embedded_nul[] = "A\0B";
const char *literal_pointer = "C";

int address_base[4];
int *object_address_positive = address_base + 3;
int *object_address_negative = (int *)((char *)address_base - 4);

int add(int lhs, int rhs) {
    return lhs + rhs;
}

BinaryOperation *function_address = add;

struct Outer partial = {
    .payload.inner.value = 42,
    .rows[1][2] = -5,
};

union Payload selected_union = {
    .inner.marker = 'Z',
    .inner.value = 17,
};

struct Outer zero_initialized = { 0 };
