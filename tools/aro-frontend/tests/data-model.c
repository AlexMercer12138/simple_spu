_Static_assert(__STDC_VERSION__ == 201710L, "C17");
_Static_assert(__STDC_HOSTED__ == 0, "freestanding");
_Static_assert(__MERC32__ == 1 && __merc32__ == 1, "target macros");
_Static_assert(__is_target_arch(merc32), "target query");
_Static_assert(!__is_target_arch(x86_64) && !__is_target_arch(wasm32), "no substitute target query");
_Static_assert(!__is_target_os(linux) && !__is_target_os(darwin), "no backing OS");
_Static_assert(!__is_target_vendor(pc) && !__is_target_vendor(apple), "no backing vendor");
_Static_assert(!__is_target_environment(gnu) && !__is_target_environment(none), "no backing environment");
_Static_assert(!__is_target_variant_os(ios), "no backing variant OS");
_Static_assert(!__is_target_variant_environment(simulator), "no backing variant environment");
_Static_assert(!__has_builtin(__builtin_ia32_addcarryx_u64), "no backing architecture builtin");
_Static_assert(__has_builtin(__builtin_types_compatible_p), "common builtin remains available");
_Static_assert(!__has_feature(c_thread_local), "no backing target feature");
_Static_assert(!__has_extension(c_thread_local), "no backing target extension");
_Static_assert(__has_feature(c_alignof), "language feature remains available");
_Static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "little endian");
_Static_assert((char)-1 < 0, "plain char is signed");

#define ASSERT_LAYOUT(type, bytes, align) \
    _Static_assert(sizeof(type) == (bytes) && _Alignof(type) == (align), #type)
ASSERT_LAYOUT(_Bool, 1, 1);
ASSERT_LAYOUT(char, 1, 1);
ASSERT_LAYOUT(signed char, 1, 1);
ASSERT_LAYOUT(unsigned char, 1, 1);
ASSERT_LAYOUT(short, 2, 2);
ASSERT_LAYOUT(unsigned short, 2, 2);
ASSERT_LAYOUT(int, 4, 4);
ASSERT_LAYOUT(unsigned int, 4, 4);
ASSERT_LAYOUT(long, 4, 4);
ASSERT_LAYOUT(unsigned long, 4, 4);
ASSERT_LAYOUT(long long, 8, 4);
ASSERT_LAYOUT(unsigned long long, 8, 4);
ASSERT_LAYOUT(float, 4, 4);
ASSERT_LAYOUT(double, 8, 4);
ASSERT_LAYOUT(long double, 8, 4);
_Static_assert(sizeof(void *) == 4 && _Alignof(void *) == 4, "pointer");

typedef __SIZE_TYPE__ size_t;
typedef __PTRDIFF_TYPE__ ptrdiff_t;
typedef __INTPTR_TYPE__ intptr_t;
typedef __UINTPTR_TYPE__ uintptr_t;
typedef __INTMAX_TYPE__ intmax_t;
typedef __UINTMAX_TYPE__ uintmax_t;
typedef __WCHAR_TYPE__ wchar_t;
typedef __WINT_TYPE__ wint_t;
typedef __SIG_ATOMIC_TYPE__ sig_atomic_t;
typedef __INT_LEAST16_TYPE__ int_least16_t;
typedef __UINT_LEAST16_TYPE__ uint_least16_t;
typedef __INT_FAST16_TYPE__ int_fast16_t;
typedef __UINT_FAST16_TYPE__ uint_fast16_t;
typedef __CHAR16_TYPE__ char16_t;
typedef __CHAR32_TYPE__ char32_t;

#define ASSERT_TYPE(expr, type) \
    _Static_assert(_Generic((expr), type: 1, default: 0), #expr)
ASSERT_TYPE((size_t)0, unsigned int);
ASSERT_TYPE((ptrdiff_t)0, int);
ASSERT_TYPE((intptr_t)0, int);
ASSERT_TYPE((uintptr_t)0, unsigned int);
ASSERT_TYPE((intmax_t)0, long long);
ASSERT_TYPE((uintmax_t)0, unsigned long long);
ASSERT_TYPE((wchar_t)0, int);
ASSERT_TYPE((wint_t)0, unsigned int);
ASSERT_TYPE((sig_atomic_t)0, int);
ASSERT_TYPE((int_least16_t)0, short);
ASSERT_TYPE((uint_least16_t)0, unsigned short);
ASSERT_TYPE((int_fast16_t)0, short);
ASSERT_TYPE((uint_fast16_t)0, unsigned short);
ASSERT_TYPE((char16_t)0, unsigned short);
ASSERT_TYPE((char32_t)0, unsigned int);

ASSERT_TYPE(1, int);
ASSERT_TYPE(1U, unsigned int);
ASSERT_TYPE(1L, long);
ASSERT_TYPE(1UL, unsigned long);
ASSERT_TYPE(1LL, long long);
ASSERT_TYPE(1ULL, unsigned long long);
ASSERT_TYPE(2147483648, long long);
ASSERT_TYPE(2147483648L, long long);
ASSERT_TYPE(4294967295U, unsigned int);
ASSERT_TYPE(4294967296U, unsigned long long);
ASSERT_TYPE(0xffffffff, unsigned int);
ASSERT_TYPE(0xffffffffL, unsigned long);

struct S { char c; long long x; short y; };
_Static_assert(sizeof(struct S) == 16 && _Alignof(struct S) == 4, "struct cap");
union U { char c; long long x; };
_Static_assert(sizeof(union U) == 8 && _Alignof(union U) == 4, "union cap");
enum E { E0, E1 };
_Static_assert(sizeof(enum E) == 4, "enum int");
typedef struct { long long ll; long double ld; } max_align_t;
_Static_assert(_Alignof(max_align_t) == 4, "max_align_t");

_Static_assert(__LDBL_MANT_DIG__ == 53, "long double is binary64");
_Static_assert(__LDBL_MAX_EXP__ == 1024, "long double exponent");
_Static_assert(__FLT_RADIX__ == 2 && __FLT_MANT_DIG__ == 24 && __FLT_MAX_EXP__ == 128, "float is binary32");
_Static_assert(__DBL_MANT_DIG__ == 53 && __DBL_MAX_EXP__ == 1024, "double is binary64");

#if defined(__SIZEOF_INT128__) || defined(__BITINT_MAXWIDTH__) || defined(__FLOAT128__) || defined(__SIZEOF_FLOAT128__)
#error "unsupported 128-bit capability macro"
#endif
#if defined(__GCC_HAVE_TLS) || defined(_REENTRANT) || defined(_MT)
#error "unsupported hosted or TLS capability macro"
#endif
