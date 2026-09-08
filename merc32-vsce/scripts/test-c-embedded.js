'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runCases } = require('./c-execution');
const includeRoot = path.resolve(__dirname, '../resources/c-frontend/include');
const headers = { includePaths: ['include'], virtualFiles: fs.readdirSync(includeRoot)
    .map(name => ({ path: `include/${name}`, source: fs.readFileSync(path.join(includeRoot, name), 'utf8') })) };

const cases = [
    { name: 'increments', source: `
        int calls; unsigned char byte = 255; unsigned char *address(void) { calls++; return &byte; }
        int test(void) {
            int x = 4; int old = x++; int now = ++x;
            if (old != 4 || now != 6 || x != 6) return 1;
            old = x--; now = --x;
            if (old != 6 || now != 4 || x != 4) return 2;
            old = (*address())++;
            if (old != 255 || byte != 0 || calls != 1) return 3;
            if (--byte != 255) return 4;
            int a[4]; int *p = a; int *q = p++;
            if (q != a || p != a + 1 || ++p != a + 2 || --p != a + 1) return 5;
            _Bool b = 0; if (++b != 1 || b++ != 1 || b != 1) return 6;
            return 0;
        }` },
    { name: 'compound_assignment', source: `
        unsigned char bytes[2] = {250, 17}; int calls;
        unsigned char *address(void) { calls++; return bytes; }
        int test(void) {
            int x = 10; x += 3; x -= 2; x *= 4; x /= 2; x %= 7;
            x |= 16; x &= 17; x ^= 3; x <<= 2; x >>= 1;
            if (x != 36) return 1;
            if ((*address() += 10) != 4 || calls != 1 || bytes[1] != 17) return 2;
            bytes[0] = 255; bytes[0] /= 256;
            if (bytes[0] != 0) return 3;
            int s = -8; s /= 2u; if (s != 2147483644) return 4;
            s = -8; s >>= 1u; if (s != -4) return 5;
            if ((s >> 1u) != -2 || (-8 >> 1u) != -4) return 8;
            int a[4]; int *p = a; p += 3; p -= 2;
            if (p != a + 1) return 6;
            _Bool b = 1; b += 3; if (b != 1) return 7;
            return 0;
        }` },
    { name: 'integer_casts', source: `
        int test(void) {
            unsigned x = 0x1234ff80u; signed char c = -2; short s = -3;
            if ((unsigned char)x != 128 || (signed char)x != -128) return 1;
            if ((unsigned short)x != 65408 || (short)x != -128) return 2;
            if ((int)c != -2 || (unsigned)c != 0xfffffffeu || (int)s != -3) return 3;
            if ((_Bool)256 != 1 || (_Bool)x != 1 || (_Bool)0 != 0) return 4;
            int n = 0; (void)(n = 3); if (n != 3) return 5;
            return 0;
        }` },
    { name: 'strings', source: `
        const char *global = "global";
        int at(const char *s, int i) { return s[i]; }
        const char *get(void) { return "persist"; }
        int test(void) {
            const char *s = "ab\\0cd";
            if (at("hello", 4) != 'o' || "xy"[2] != 0) return 1;
            if (s[2] != 0 || s[3] != 'c' || s[5] != 0) return 2;
            if (get()[3] != 's' || global[0] != 'g') return 3;
            char local[] = "local"; if (local[4] != 'l' || local[5] != 0) return 4;
            char padded[8] = "abc"; char exact[3] = "abc";
            if (padded[3] != 0 || padded[7] != 0 || exact[2] != 'c') return 5;
            return 0;
        }` },
    { name: 'static_locals', source: `
        int shared = 7;
        int next(void) { static int count = 3; return count++; }
        int other(void) { static int count; return ++count; }
        int *slot(void) { static int state = 42; static int *p = &state; return p; }
        int test(void) {
            if (next() != 3 || next() != 4 || other() != 1 || next() != 5) return 1;
            { extern int shared; if (shared != 7) return 2; }
            if (*slot() != 42) return 3; *slot() = 8; if (*slot() != 8) return 4;
            return 0;
        }` },
    { name: 'callbacks_generic_comma', source: `
        int add(int x) { return x + 3; }
        int apply(int (*cb)(int), int x) { return (*cb)(x); }
        int calls; int bump(void) { calls++; return 9; }
        int test(void) {
            int (*cb)(int) = add;
            if (apply(cb, 4) != 7 || (*cb)(5) != 8 || (&*cb)(6) != 9) return 1;
            int x = (bump(), 5); if (x != 5 || calls != 1) return 2;
            x = _Generic(bump(), int: 7, default: bump());
            if (x != 7 || calls != 1) return 3;
            _Generic(x, int: x, default: calls) = 12;
            if (x != 12 || calls != 1) return 4;
            return 0;
        }` },
    { name: 'aggregates', source: `
        struct S { unsigned char tag; int values[3]; short tail; };
        int visits; int value(void) { return ++visits; }
        int test(void) {
            struct S a = {.tag = 5, .values = {[2] = 17}, .tail = -2};
            struct S b; b = a; a.values[2] = 30;
            if (b.tag != 5 || b.values[0] != 0 || b.values[2] != 17 || b.tail != -2) return 1;
            b = (struct S){.values = {value(), 8}, .tag = 9};
            if (b.tag != 9 || b.values[0] != 1 || b.values[1] != 8 || b.values[2] != 0 || b.tail != 0) return 2;
            struct S c = b;
            if ((c = a).values[2] != 30) return 3;
            union U { int a; unsigned char b[4]; } u = {.b = {[2] = 4}};
            if (u.b[0] != 0 || u.b[2] != 4) return 4;
            int *p = (int[]){[2] = 11}; if (p[0] != 0 || p[2] != 11) return 5;
            int *q = &(int){23}; if (*q != 23) return 6;
            return 0;
        }` },
    { name: 'memory_runtime', options: headers, source: `
        #include <string.h>
        int test(void) {
            char a[12]; char b[12];
            if (memset(a, 0x123, 12) != a || a[11] != '#') return 1;
            if (memcpy(b, "hello", 6) != b || strcmp(b, "hello") != 0 || strlen(b) != 5) return 2;
            if (memmove(b + 1, b, 6) != b + 1 || strcmp(b + 1, "hello") != 0) return 3;
            if (memcmp("a", "b", 1) >= 0 || memcmp("x", "x", 1) != 0) return 4;
            return 0;
        }` },
    { name: 'offsetof_static_literals', options: headers, source: `
        #include <stddef.h>
        struct S {char a; int b[3];};
        _Static_assert(offsetof(struct S, b[2]) == 12, "layout");
        struct S *p = &(struct S){.a = 4, .b = {[1] = 9}};
        struct S value = (struct S){.b = {2,3,4}};
        int test(void) {
            if (offsetof(struct S,b) != 4 || p->a != 4 || p->b[0] != 0 || p->b[1] != 9) return 1;
            if (value.a != 0 || value.b[2] != 4) return 2;
            return 0;
        }` },
    { name: 'literal_lifetime', source: `
        int test(void) {
            int *previous = 0; int n = 0;
            again:;
            int *current = &(int){++n};
            if (previous && previous != current) return 1;
            previous = current;
            if (n < 2) goto again;
            if (*previous != 2) return 2;
            struct S {int x;int y;} a={1,2};
            a=(struct S){a.y,a.x};
            return a.x != 2 || a.y != 1;
        }` },
    { name: 'runtime_override', options: headers, source: `
        #include <string.h>
        size_t strlen(const char *s) { return 17; }
        int test(void) {
            char a[4]; memset(a, 'x', 3); a[3]=0;
            return strlen(a) != 17 || strcmp(a,"xxx") != 0;
        }` },
];

const selectedCase = process.argv.slice(2).find(argument => !argument.startsWith('--'));
runCases(selectedCase ? cases.filter(test => test.name === selectedCase) : cases);
