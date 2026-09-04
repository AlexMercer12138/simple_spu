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

extern int redeclared_object;
int redeclared_object = 3;

QualifiedWord qualified_word = 9;
QualifiedPointer qualified_pointer = 0;
_Atomic(unsigned int) atomic_word = 1;
long long signed_min = (-9223372036854775807LL - 1);
unsigned long long unsigned_max = 18446744073709551615ULL;
float exact_float = 1.5f;
float negative_zero_float = -0.0f;
double exact_double = -2.25;
double negative_zero_double = ((double)(-0.0));
long double exact_long_double = 3.0L;
long double negative_zero_long_double = (long double)((-0.0L));
char embedded_nul[] = "A\0B";
const char *literal_pointer = "C";
const char *pointer_array[3] = { "D", 0, "E" };

struct StringAggregate {
    const char *head;
    const char *tail[2];
};

struct StringAggregate string_aggregate = {
    .head = "F",
    .tail[1] = "G",
};

int address_base[4];
int *object_address_positive = address_base + 3;
int *object_address_negative = (int *)((char *)address_base - 4);

int add(int lhs, int rhs);

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
