#define INNER_SUM(a, b) ((a) + (b))
#define OUTER_SUM(a, b) INNER_SUM(a, b)

struct Pair {
    int first;
    int second;
};

typedef int (*BinaryOperation)(int, int);

int add(int lhs, int rhs) {
    return lhs + rhs;
}

long control(int *pointer, int count, BinaryOperation indirect) {
    int local = 1;
    typedef int LocalInt;
    struct LocalPair { int value; };
    enum LocalChoice { local_choice = 3 };
    LocalInt alias = local;
    struct LocalPair local_pair;
    char narrow = 2;
    int array[3];
    struct Pair pair;
    struct Pair *pair_pointer = &pair;
    char character = 'A';
    double floating = 1.5;
    char *text = "ok";

    array[0] = local;
    pair.first = array[0];
    pair_pointer->second = count;
    local += narrow;
    local_pair.value = alias;
    local += local_choice;
    ++local;
    local--;
    pointer = pointer + local;
    local = add(local, count);
    local = indirect(local, count);
    local = count ? local : *pointer;
    local = (int)(short)local;
    local = (int)sizeof array + (int)_Alignof(struct Pair);
    pair = (struct Pair){ local, count };
    local = _Generic(local, char: count, int: local, default: count);
    local = OUTER_SUM(local, 2);
    local = (count ? pair : pair).first;
    (&pair)->first = local;

    if ((local && count) || *pointer) {
        local = local + 1;
    } else {
        local = local - 1;
    }

    while (local < count) {
        local++;
        if (local == 4) continue;
        if (local == 7) break;
    }

    do {
        --local;
    } while (local > count);

    for (int index = 0; index < count; ++index) {
        local = local + index;
    }

    switch (local) {
        case 0:
            local = 1;
        case 1:
            local = 2;
            break;
        default:
            goto finished;
    }

finished:
    ;
    return local;
}

int generic_sum(int value) {
    return _Generic(value, int: value, default: value) + 1;
}

int compare_pointer(int *pointer) {
    return pointer == 0;
}

int local_link(int value) {
    extern int later_helper(int);
    return later_helper(value);
}

int later_helper(int value) {
    return value;
}

char automatic_aggregates(char value) {
    char values[3] = { value, 1, 0 };
    struct Pair pair = { .first = value, .second = 1 };
    values[0] += 1;
    return values[0] + pair.first;
}

struct Pair global_pair = { 1, 2 };
