# MERC32 C Compiler and Linker Design

## 1. Goal

Extend the current Tiny C toolchain into a practical MERC32 freestanding C
toolchain. The primary user goal is ordinary C programming ergonomics rather
than hosted ISO C completeness or execution speed. The CPU RTL and instruction
encoding remain unchanged.

The toolchain will be restructured around a TypeScript C front end, a typed
MERC32 intermediate representation, a MERC32 code generator, a project-owned
relocatable object format, a linker, and software runtime libraries.

The existing assembly, ROM, and VSCode output surfaces remain available.

## 2. Non-goals

- No floating-point hardware, floating-point registers, cache, or new ISA
  instructions are required by this design.
- No ELF input or output is required.
- No hosted operating system, threads, files, processes, or POSIX library is
  part of the first implementation.
- No packed structures or bit-fields are required initially.
- No optimizer is required for the first implementation; correctness and clear
  diagnostics take precedence.

## 3. Compilation Pipeline

```text
C source and headers
        |
        v
C preprocessor
        |
        v
typed AST and semantic analysis
        |
        v
MERC32 IR
        |
        v
MERC32 backend
        |
        v
.mobj relocatable object
        |
        +---- runtime/startup .mobj
        |
        v
MERC32 linker
        |
        v
linked assembly or memory image
        |
        v
existing ASM/Verilog/COE/MIF/HEX/BIN/MEM output
```

The public TypeScript API remains compatible:

```ts
compileC(source, options): CompileResult
compileCFile(sourceFile, options): CompileResult
```

New internal/publicly testable APIs are added:

```ts
compileCToObject(source, options): Merc32Object
compileCFileToObject(sourceFile, options): Merc32Object
linkObjects(objects, options): LinkedImage
linkFiles(files, options): LinkedImage
```

`compileC` performs an in-memory single-object link and returns assembly, so
existing callers continue to receive the current output shape. The VSCode C
build path compiles objects, adds startup/runtime objects, links them, and
passes the final assembly or image to the existing output formatters.

## 4. Front End and Type System

The current direct-to-assembly parser is replaced by separate lexer,
preprocessor, parser, type, semantic-analysis, AST, IR, and lowering modules.
The implementation may use chibicc as an architectural and test reference,
but its C/x86 backend is not reused and its source is not copied without
license review.

The initial MERC32 data model is:

| Type | Representation |
|---|---:|
| `char` | signed 8-bit |
| `unsigned char` | 8-bit |
| `short` | signed 16-bit |
| `unsigned short` | 16-bit |
| `int` | signed 32-bit |
| `unsigned int` | 32-bit |
| `long` | signed 32-bit |
| `unsigned long` | 32-bit |
| `long long` | signed 64-bit software type |
| `unsigned long long` | 64-bit software type |
| `float` | IEEE-754 binary32 software type |
| `double` | IEEE-754 binary64 software type |
| `long double` | same representation as `double` |
| pointer | 32-bit byte address |
| `size_t` | `unsigned int` |
| `ptrdiff_t` | `int` |
| `enum` | `int` |

The front end must support the common C facilities below:

- `typedef`, nested scopes, and tag namespaces;
- `struct`, `union`, `enum`, incomplete declarations, member access, and
  natural layout;
- `const`, `volatile`, and syntactically accepted `restrict`;
- `void *` and object-pointer conversions;
- function types, function pointers, indirect calls, and array-parameter
  adjustment;
- multidimensional arrays, array-to-pointer decay, and complete declarators;
- `sizeof` and `_Alignof` as compile-time operations;
- comma-separated declarations and standard initializer forms, including
  designated field/index initializers;
- integer, floating, character, and string literals with standard suffixes
  needed by common code;
- the existing control flow and expression operators.

Default aggregate layout uses natural alignment capped at four bytes. A struct
has each field aligned to its type alignment and a total size rounded to the
maximum field alignment. A union has the size and alignment of its largest
member. Bit-fields and packed attributes are explicitly outside the first
implementation.

## 5. ABI

Existing scalar conventions remain stable:

- `r4-r7` carry the first four 32-bit argument words;
- additional argument words are placed in the caller-owned stack argument area;
- scalar return values are placed in `r4`;
- `r12` is the frame pointer, `r13` is the descending data-stack pointer, and
  `r14` is the link register;
- narrow scalar loads, stores, promotions, and truncations retain the current
  semantics;
- `float` is one 32-bit argument/return word containing its IEEE bit pattern.

`long long` and `double` occupy two consecutive 32-bit words, low word first.
They use aligned register/stack word slots; the exact register/stack split is
defined by the same left-to-right word assignment used for ordinary arguments.

Aggregates use a correctness-first memory ABI:

- by-value aggregate arguments are copied into caller argument storage;
- aggregate returns use a hidden first `sret` pointer argument;
- the hidden pointer consumes one ordinary argument word for placement;
- structure assignment and copies use generated byte/half/word accesses or
  runtime `memcpy` where appropriate;
- no small-struct register packing is required initially.

Function pointers contain byte addresses and use the existing register-indirect
JAL form. The backend emits a register-indirect call while preserving the
standard link-register behavior.

## 6. MERC32 IR and Backend

The IR is intentionally small and typed. It contains explicit loads, stores,
address calculations, integer operations, comparisons, branches, calls,
returns, aggregate copies, and runtime calls. Floating operations lower to
runtime calls before final instruction selection.

The first backend may use simple virtual registers and stack spilling. It must
reserve the architectural roles already specified by the ABI and must not
allocate `r0-r3` or `r12-r15` as ordinary temporaries. Correctness is preferred
over register-allocation quality.

The backend emits relocatable instruction records rather than assuming that a
symbol fits a 16-bit immediate. Symbolic calls, branches, and addresses retain
their relocation records until linking.

## 7. Software Runtime

Runtime code is ordinary MERC32 object code and is linked like user code. The
initial runtime set is:

```text
startup and global initialization
memcpy, memset, memcmp, strlen, strcmp
64-bit integer helpers
__addsf3, __subsf3, __mulsf3, __divsf3
__eqsf2, __ltsf2, __lesf2
__floatsisf, __fixsfsi
```

The binary32 implementation handles normal finite values, signed zero,
infinities, NaNs, normalization, and the selected default rounding mode. It
uses only existing integer instructions, shifts, comparisons, multiply,
divide, and memory operations. The first implementation may use hand-written
MERC32 assembly to avoid a bootstrap dependency; once the backend is stable,
the runtime can be migrated to C source and self-hosted.

Binary64 support has its ABI and type representation in the initial design but
may be delivered after binary32 arithmetic. No user-visible ABI change is
allowed when it is added.

Runtime source must record algorithm provenance and license information. Any
code or algorithm derived from chibicc, compiler-rt, or libgcc is reviewed on
a file-by-file basis before inclusion.

## 8. `.mobj` Object Format

The first object format is project-owned and does not target ELF. Development
serialization uses JSON for inspectability. A versioned binary representation
may be added later without changing compiler or linker semantics.

An object contains:

- a header with format version, target, and ABI/data-model identifier;
- text, rodata, data, and bss-size sections;
- defined and undefined symbols with binding and section offsets;
- relocation records containing section, offset, kind, symbol, and addend;
- source file/line/column information for diagnostics.

Static symbols are private to an object; external symbols are resolved by name.
The linker reports duplicate strong definitions, unresolved references, section
overflow, and ABI mismatches with source locations.

## 9. Linker and Relocations

The linker performs section layout, symbol resolution, relocation, runtime and
startup insertion, and final image emission. The final output remains assembly
or one of the current memory formats.

Relocation handling must account for the ISA's 16-bit immediate limit:

- near calls use `jmp label, r14`;
- far calls load a complete address into an ABI-approved scratch register and
  use register-indirect JAL;
- far conditional branches invert the condition around a long indirect jump;
- full data addresses use multi-instruction immediate construction;
- scratch-register use is documented and cannot clobber frame, stack, or link
  registers.

The linker may perform relaxation from long forms to near forms, but correctness
does not depend on relaxation. Large programs must not fail merely because a
label exceeds the direct 16-bit target range.

## 10. Migration and Testing

Existing Tiny C examples and tests remain the compatibility baseline. The RTL
is not modified by this project. The following test layers are required:

1. Lexer/preprocessor/parser/type tests for declarations, scopes, aggregate
   layout, initialization, conversions, and diagnostics.
2. Backend/ABI golden tests for existing scalar assembly, stack arguments,
   function pointers, aggregate copies, and interrupt/MMIO behavior.
3. Linker tests for multi-object layout, symbol visibility, relocations,
   unresolved/duplicate symbols, near/far calls, far branches, and overflow.
4. Runtime tests comparing software-float results with host IEEE behavior,
   including zero, subnormal boundaries, infinities, NaNs, and rounding cases.
5. MERC32/Icarus execution tests for runtime routines and representative C
   programs.
6. Existing `test:c`, `test:c:preprocessor`, and `test:c:rtl` suites, followed by
   VSIX smoke verification and all current output-format tests.

The legacy compiler may remain under a clearly named compatibility directory
during migration for differential testing, but the new frontend/backend become
the default only after the existing Tiny C corpus passes.

## 11. Delivery Order

The architecture is fixed up front, while implementation is delivered in
verifiable increments:

1. Type system, complete declarators, aggregates, typedefs, and compile-time
   layout operations.
2. Typed IR and scalar backend parity with the current Tiny C output/ABI.
3. `.mobj` serialization and linker with multi-file and far-control-flow
   support.
4. Startup/memory runtime and migration of existing C builds.
5. Binary32 software floating point and C lowering.
6. Binary64/64-bit helpers and broader freestanding library coverage.

Each increment must leave the existing RTL unchanged and keep the current final
output formats usable.
