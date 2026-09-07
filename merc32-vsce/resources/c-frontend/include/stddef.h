#ifndef MERC32_STDDEF_H
#define MERC32_STDDEF_H

typedef unsigned int size_t;
typedef int ptrdiff_t;
typedef int wchar_t;
typedef struct { long long __ll; long double __ld; } max_align_t;

#define NULL ((void *)0)
#define offsetof(type, member) __builtin_offsetof(type, member)

#endif
