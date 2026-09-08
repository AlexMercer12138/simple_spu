'use strict';

const { runCases } = require('./c-execution');
const assert = require('node:assert/strict');
const { compileCToObject, compileCToObjectDetailed } = require('../out/cCompiler');
const { assembleToObject } = require('../out/linker');

for (const entry of ['main', '__irq_handler']) {
    for (const signature of [
        `struct S ${entry}(void) { return (struct S){7}; }`,
        `int ${entry}(struct S value) { return value.x; }`,
    ]) {
        const result = compileCToObjectDetailed(`struct S { int x; }; ${signature}`);
        assert(result.artifact === undefined, `${entry} requires the startup ABI`);
        assert(result.diagnostics.some(d => d.code === 'C_BACKEND_CAPABILITY' && /startup entry/.test(d.message)));
    }
}

runCases([
    { name: 'aggregate_odd_size_array_member', source: `
        struct Buffer { unsigned char bytes[19]; };
        struct Buffer make(int n) {
            struct Buffer b;
            for (int i = 0; i < 19; i++) b.bytes[i] = n + i;
            return b;
        }
        int inspect(struct Buffer b) { b.bytes[0]++; return b.bytes[0] + b.bytes[18]; }
        int test(void) {
            struct Buffer b = make(11);
            if (make(30).bytes[18] != 48 || inspect(b) != 41) return 1;
            if (b.bytes[0] != 11 || b.bytes[18] != 29) return 2;
            return 0;
        }` },
    { name: 'aggregate_large_copy', source: `
        struct Block { int words[128]; };
        struct Block update(struct Block b) { b.words[0] += 9; b.words[127] = -1; return b; }
        int test(void) {
            struct Block b;
            for (int i = 0; i < 128; i++) b.words[i] = i * 3;
            struct Block r = update(b);
            r = r;
            for (int i = 0; i < 128; i++) {
                if (b.words[i] != i * 3) return 1;
                if (r.words[i] != (i == 0 ? 9 : i == 127 ? -1 : i * 3)) return 2;
            }
            return 0;
        }` },
    { name: 'aggregate_parameter_copy', source: `
        struct Config { unsigned char mode; int count; short limit; };
        int change(struct Config c, int n) {
            c.mode++; c.count += n; c.limit = -7;
            return c.mode + c.count + c.limit;
        }
        int test(void) {
            struct Config c = {2, 40, 9};
            if (change(c, 5) != 41) return 1;
            if (c.mode != 2 || c.count != 40 || c.limit != 9) return 2;
            return 0;
        }` },
    { name: 'aggregate_return_value', source: `
        struct Pair { int x; int y; };
        struct Pair make(int x) { struct Pair p = {x, x + 1}; return p; }
        int test(void) {
            struct Pair a = make(20); struct Pair b = make(50);
            if (a.x != 20 || a.y != 21 || b.x != 50 || b.y != 51) return 1;
            a = make(7);
            if (a.x != 7 || a.y != 8 || make(12).y != 13) return 2;
            return 0;
        }` },
    { name: 'aggregate_nested_callbacks', source: `
        typedef struct Pair { int x; int y; } Pair;
        Pair make(int n) { return (Pair){n, n + 1}; }
        Pair add(Pair a, Pair b) { return (Pair){a.x + b.x, a.y + b.y}; }
        Pair (*callback)(Pair, Pair) = add;
        int test(void) {
            Pair p = (*callback)(make(3), make(9));
            if (p.x != 12 || p.y != 14) return 1;
            p = add(make(4), add(make(5), make(6)));
            if (p.x != 15 || p.y != 18) return 2;
            return 0;
        }` },
    { name: 'aggregate_stack_arguments', source: `
        struct Byte { unsigned char v; };
        struct Byte sum(int a, struct Byte b, int c, struct Byte d,
                        int e, struct Byte f, int g) {
            b.v += 2; d.v += 3; f.v += 4;
            return (struct Byte){a + b.v + c + d.v + e + f.v + g};
        }
        int test(void) {
            struct Byte b = {2}, d = {4}, f = {6};
            struct Byte result = sum(1, b, 3, d, 5, f, 7);
            if (result.v != 37 || b.v != 2 || d.v != 4 || f.v != 6) return 1;
            return 0;
        }` },
    { name: 'aggregate_recursive_return', source: `
        struct Pair { int x; int y; };
        struct Pair recurse(struct Pair p, int n) {
            if (n == 0) return p;
            p.x += n; p.y++;
            return recurse(p, n - 1);
        }
        int test(void) {
            struct Pair p = {10, 20}; struct Pair r = recurse(p, 4);
            if (r.x != 20 || r.y != 24 || p.x != 10 || p.y != 20) return 1;
            return 0;
        }` },
    { name: 'union_value_calls', source: `
        union Value { unsigned value; unsigned char bytes[4]; };
        union Value rotate(union Value v) {
            unsigned char old = v.bytes[0];
            v.bytes[0] = v.bytes[3]; v.bytes[3] = old;
            return v;
        }
        int test(void) {
            union Value v = {.value = 0x12345678u};
            union Value r = rotate(v);
            if (v.value != 0x12345678u || r.value != 0x78345612u) return 1;
            return 0;
        }` },
    { name: 'aggregate_conditional_lifetime', source: `
        struct Sample { short values[3]; unsigned char tag; };
        int calls;
        struct Sample make(int n) { calls++; return (struct Sample){{n, n + 1, n + 2}, 9}; }
        int inspect(struct Sample a, struct Sample b) {
            return a.values[2] * 10 + b.values[1] + a.tag + b.tag;
        }
        int test(void) {
            int flag = 0;
            struct Sample s = flag ? make(70) : make(3);
            if (calls != 1 || s.values[2] != 5 || s.tag != 9) return 1;
            if (inspect(make(2), make(8)) != 67 || calls != 3) return 2;
            for (int i = 0; i < 3; i++) s = make(i);
            if (s.values[0] != 2 || calls != 6) return 3;
            return 0;
        }` },
    { name: 'aggregate_parameter_address', source: `
        struct State { int value; };
        int inspect(struct State a, struct State b, struct State *original) {
            struct State *pa = &a, *pb = &b;
            if (pa == pb || pa == original || pb == original) return 1;
            pa->value = 99;
            if (b.value != 7 || original->value != 7) return 2;
            return 0;
        }
        int test(void) { struct State s = {7}; return inspect(s, s, &s); }` },
    { name: 'aggregate_cross_translation_unit', additionalObjects: [compileCToObject(`
        struct Pair { int x; int y; };
        static int count;
        struct Pair transform(struct Pair p, int n) { count++; p.x += n; p.y += count; return p; }
        struct Pair (*choose(void))(struct Pair, int) { return transform; }
    `, { sourceName: 'aggregate-library.c' })], source: `
        struct Pair { int x; int y; };
        struct Pair transform(struct Pair, int);
        struct Pair (*choose(void))(struct Pair, int);
        int test(void) {
            struct Pair p = {3, 4};
            struct Pair q = transform(p, 7);
            if (q.x != 10 || q.y != 5 || p.x != 3 || p.y != 4) return 1;
            q = choose()(q, 2);
            if (q.x != 12 || q.y != 7) return 2;
            return 0;
        }` },
    { name: 'aggregate_assembly_abi', additionalObjects: [assembleToObject(`
        asm_adjust:
          lw r8, [r6]
          mov r8, r8 + r5
          mov r8, r8 + r7
          lw r7, [r13]
          mov r8, r8 + r7
          sw [r4], r8
          lw r8, [r6 + 4]
          mov r8, r8 + r7
          sw [r4 + 4], r8
          mov r8, 99
          sw [r6], r8
          jmp r14
        asm_to_c:
          mov r13, r13 - 32
          sw [r13 + 28], r14
          mov r7, 2
          sw [r13 + 8], r7
          mov r7, 3
          sw [r13 + 12], r7
          mov r7, 5
          sw [r13], r7
          mov r4, r13 + 16
          mov r5, 1
          mov r6, r13 + 8
          mov r7, 4
          jmp c_adjust, r14
          mov r7, r13 + 16
          cmp r8, r4 == r7
          bz r8, r0 + abi_fail
          lw r7, [r13 + 16]
          cmp r8, r7 == 12
          bz r8, r0 + abi_fail
          lw r7, [r13 + 20]
          cmp r8, r7 == 8
          bz r8, r0 + abi_fail
          mov r4, 0
          jmp abi_done
        abi_fail:
          mov r4, 3
        abi_done:
          lw r14, [r13 + 28]
          mov r13, r13 + 32
          jmp r14
    `, { exports: ['asm_adjust', 'asm_to_c'] })], source: `
        struct Pair { int x; int y; };
        struct Pair asm_adjust(int, struct Pair, int, int);
        int asm_to_c(void);
        struct Pair c_adjust(int lead, struct Pair p, int bias, int tail) {
            p.x += lead + bias + tail; p.y += tail; return p;
        }
        int test(void) {
            struct Pair p = {2, 3}; struct Pair q = asm_adjust(1, p, 4, 5);
            if (q.x != 12 || q.y != 8) return 1;
            if (p.x != 2 || p.y != 3) return 2;
            return asm_to_c();
        }` },
]);
