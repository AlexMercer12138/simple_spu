# MERC32 Runtime Provenance

The runtime assembly files are original project-owned code. `mem.asm` implements
byte-oriented `memcpy`, `memmove`, `memset`, `memcmp`, `strlen`, and `strcmp` for
the MERC32 C ABI. Floating-point assembly remains ABI stubs.
Host reference arithmetic uses ECMAScript `DataView` and `BigInt` semantics for
test vectors only. No GPL compiler runtime source is copied into this repository.
