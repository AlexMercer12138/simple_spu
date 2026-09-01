# MERC32 C Frontend and Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the direct Tiny C parser/code generator with a typed TypeScript C frontend and MERC32 backend while preserving the existing scalar ABI and assembly-returning APIs.

**Architecture:** Parse C into a typed AST, perform semantic analysis and layout, lower to a small typed MERC32 IR, then emit relocatable instruction records consumed by the object/linker plan. Single-file APIs use an in-memory link so existing callers still receive assembly.

**Tech Stack:** TypeScript 6, Node.js, Mocha scripts, existing MERC32 assembler and Icarus RTL tests.

**Spec:** `docs/superpowers/specs/2026-09-01-merc32-c-compiler-linker-design.md`

## Global Constraints

- The CPU RTL and instruction encoding remain unchanged.
- Preserve `r4-r7` scalar arguments, `r4` scalar return, `r12/r13/r14` frame/stack/link roles.
- Use the MERC32 data model: `char` 8-bit, `short` 16-bit, `int`/`long` 32-bit, pointers 32-bit, `long long` 64-bit, `float` binary32, `double` binary64.
- Aggregate values use caller storage and hidden `sret` pointer returns; no small-struct register packing.
- Do not add ELF support, packed structs, bit-fields, or a first-pass optimizer.
- Existing `test:c`, `test:c:preprocessor`, and `test:c:rtl` must remain passing.

---

### Task 1: Establish Typed C Model and Module Boundaries

**Files:**
- Create: `merc32-vsce/src/cCompiler/ast.ts`
- Create: `merc32-vsce/src/cCompiler/types.ts`
- Create: `merc32-vsce/src/cCompiler/source.ts`
- Test: `merc32-vsce/scripts/test-c-types.js`
- Modify: `merc32-vsce/src/cCompiler/index.ts`

**Interfaces:**
- `CType` union covers builtin, pointer, array, function, struct, union, enum, and typedef references.
- `SourceLocation` contains `file`, `line`, and `column`.
- `compileCToObject(source, options): Merc32Object` is declared as an adapter boundary without changing the existing `compileC` return type.

- [ ] **Step 1: Write failing type-model tests**

Add assertions that `int`, `unsigned int`, `float`, pointers, arrays, and a two-field struct report the specified size/alignment; assert `struct` alignment is capped at four bytes.

```js
const { builtinType, pointerType, arrayType, structLayout } = require('../out/cCompiler/types');
assert.deepStrictEqual(builtinType('int').size, 4);
assert.deepStrictEqual(pointerType(builtinType('char')).size, 4);
assert.deepStrictEqual(arrayType(builtinType('short'), 3).size, 6);
assert.deepStrictEqual(structLayout([
  { name: 'a', type: builtinType('char') },
  { name: 'b', type: builtinType('int') },
]).size, 8);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm run compile; node scripts/test-c-types.js` from `merc32-vsce`. Expected: module/functions are missing.

- [ ] **Step 3: Implement the model**

Define immutable type constructors, `typeSize`, `typeAlignment`, `isIntegerType`, `isScalarType`, `isCompleteType`, struct/union layout, enum underlying type, and source-location helpers. Keep qualifier bits on the type nodes instead of dropping `const` or `volatile`.

- [ ] **Step 4: Run focused and existing compiler tests**

Run `npm run compile; node scripts/test-c-types.js; npm run test:c`. Expected: both pass; existing behavior is still provided by the compatibility adapter.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/scripts/test-c-types.js
git commit -m "feat: add typed MERC32 C model"
```

### Task 2: Port Lexer, Preprocessor Boundary, and Complete Declarators

**Files:**
- Create: `merc32-vsce/src/cCompiler/lexer.ts`
- Create: `merc32-vsce/src/cCompiler/parser.ts`
- Create: `merc32-vsce/src/cCompiler/declarations.ts`
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Test: `merc32-vsce/scripts/test-c-parser.js`

**Interfaces:**
- `tokenizeC(source): Token[]`
- `parseTranslationUnit(tokens): TranslationUnit`
- `parseDeclarator` handles pointer, array, function, and parenthesized declarators.
- Existing `preprocessCFile` remains the file-level entry point; parser accepts its mapped source output.

- [ ] **Step 1: Add failing parser fixtures**

Cover comma declarations, `typedef`, `struct` definitions/forward declarations, function pointers, array parameters, multidimensional arrays, standard integer suffixes, floating literals, and designated initializers.

```js
const unit = parse('typedef unsigned long word; struct S { int x; word y; }; int f(int (*cb)(int), int a[2][3]);');
assert.strictEqual(unit.declarations[0].kind, 'typedef');
assert.strictEqual(unit.declarations[1].type.kind, 'struct');
assert.strictEqual(unit.declarations[2].declarators[0].type.kind, 'function');
```

- [ ] **Step 2: Run parser tests before implementation**

Run `npm run compile; node scripts/test-c-parser.js`. Expected: FAIL because the new parser entry points do not exist.

- [ ] **Step 3: Implement tokenization**

Move comment/literal handling into `lexer.ts`; recognize C keywords, suffix-bearing integer/floating literals, ellipsis, member operators, and all assignment/shift operators. Preserve mapped source locations for diagnostics.

- [ ] **Step 4: Implement declarator parsing**

Use a declarator-node pass followed by type construction so `int (*p)(int)` and `int a[2][3]` are represented correctly. Normalize array parameters to pointers only during function-type construction, not while parsing globals.

- [ ] **Step 5: Run parser and preprocessor regressions**

Run `npm run compile; node scripts/test-c-parser.js; npm run test:c:preprocessor`. Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/scripts/test-c-parser.js
git commit -m "feat: parse complete C declarators"
```

### Task 3: Semantic Analysis, Scopes, and Initializers

**Files:**
- Create: `merc32-vsce/src/cCompiler/sema.ts`
- Create: `merc32-vsce/src/cCompiler/initializers.ts`
- Modify: `merc32-vsce/src/cCompiler/ast.ts`
- Test: `merc32-vsce/scripts/test-c-sema.js`

**Interfaces:**
- `analyzeTranslationUnit(unit): AnalyzedProgram`
- `Scope` resolves ordinary identifiers, typedef names, and tag names using C scope rules.
- `layoutAggregate(type): AggregateLayout`
- `lowerInitializer(type, initializer): NormalizedInitializer`

- [ ] **Step 1: Write failing semantic tests**

Test nested typedef scopes, tag reuse, incomplete struct completion, `sizeof`, pointer compatibility, array decay, `const` assignment rejection, designated initializers, and aggregate copy requirements.

```js
const program = analyze('typedef int T; struct S { char c; int x; }; int main(void) { T n; struct S s = {.x = 3}; return sizeof(s) + n; }');
assert.strictEqual(program.functions[0].body.locals.get('n').type.kind, 'builtin');
assert.strictEqual(program.constants.get('sizeof(struct S)'), 8);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run `npm run compile; node scripts/test-c-sema.js`. Expected: FAIL until scope and layout analysis exist.

- [ ] **Step 3: Implement scopes and type checking**

Implement separate ordinary/tag namespaces, typedef-name disambiguation, lvalue/modifiable-lvalue checks, integer promotions/usual arithmetic conversions, pointer conversions including `void *`, function-call arity/type checks, and compile-time constant evaluation.

- [ ] **Step 4: Implement aggregate layout and initializers**

Compute natural field offsets, union overlap, trailing padding, multidimensional array strides, designated field/index initialization, zero fill, string initialization, and static-vs-automatic initializer validation.

- [ ] **Step 5: Run semantic and existing tests**

Run `npm run compile; node scripts/test-c-sema.js; npm run test:c`. Expected: new tests pass and existing Tiny C corpus remains valid.

- [ ] **Step 6: Commit**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/scripts/test-c-sema.js
git commit -m "feat: add C semantic analysis and aggregate layout"
```

### Task 4: Typed IR and Scalar MERC32 Backend Parity

**Files:**
- Create: `merc32-vsce/src/cCompiler/ir.ts`
- Create: `merc32-vsce/src/cCompiler/lower.ts`
- Create: `merc32-vsce/src/cCompiler/codegen.ts`
- Create: `merc32-vsce/src/cCompiler/registers.ts`
- Test: `merc32-vsce/scripts/test-c-backend.js`

**Interfaces:**
- `lowerProgram(program): Merc32Module`
- `generateObject(module): Merc32Object`
- `generateAssembly(module): string`
- `VirtualRegisterAllocator` spills to frame slots and reserves `r0-r3`, `r12-r15`.

- [ ] **Step 1: Capture existing assembly as golden fixtures**

Extend `test-c-backend.js` with the current arithmetic, pointer, call, loop, interrupt, and MMIO examples. Assert semantic instruction patterns rather than exact temporary labels.

- [ ] **Step 2: Run parity tests against the new entry point**

Run `npm run compile; node scripts/test-c-backend.js`. Expected: FAIL because the new lowering/codegen path is not connected.

- [ ] **Step 3: Implement typed IR**

Define basic blocks and instructions for constants, loads/stores, address arithmetic, integer operations, comparisons, conditional/unconditional branches, direct/indirect calls, returns, aggregate copy, and runtime calls. Attach source locations and relocation symbols to symbolic operands.

- [ ] **Step 4: Implement scalar lowering and frame layout**

Lower existing Tiny C expressions/control flow to IR, preserve evaluation order and short-circuiting, assign the current frame layout rules, spill virtual registers to DLB stack slots, and emit the existing prologue/epilogue and interrupt handler context saves.

- [ ] **Step 5: Run backend and RTL regressions**

Run `npm run compile; node scripts/test-c-backend.js; npm run test:c; npm run test:c:rtl`. Expected: all pass without RTL changes.

- [ ] **Step 6: Commit**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/scripts/test-c-backend.js
git commit -m "feat: lower typed C IR to MERC32"
```

### Task 5: Aggregate, Function-Pointer, and Floating Lowering

**Files:**
- Modify: `merc32-vsce/src/cCompiler/lower.ts`
- Modify: `merc32-vsce/src/cCompiler/codegen.ts`
- Modify: `merc32-vsce/src/cCompiler/ir.ts`
- Test: `merc32-vsce/scripts/test-c-advanced-backend.js`

**Interfaces:**
- `lowerAggregateArgument` emits caller storage and copy operations.
- `lowerAggregateReturn` emits hidden `sret` parameter handling.
- `lowerFloatOperation` emits runtime symbol calls such as `__addsf3`.

- [ ] **Step 1: Add failing advanced backend tests**

Compile and inspect programs containing struct assignment/return, union member access, function pointers, `float` expressions, and `double` word-pair arguments. Assert relocation symbols are retained instead of requiring local labels.

- [ ] **Step 2: Implement aggregate and indirect-call lowering**

Generate field address calculations, copies through byte/half/word accesses, hidden `sret` handling, array decay, and register-indirect JAL calls using the ABI-approved scratch register policy.

- [ ] **Step 3: Implement float/64-bit lowering contracts**

Represent float values as 32-bit bit patterns and lower binary32 operations/conversions/comparisons to runtime calls. Represent `double` and `long long` as low-word/high-word pairs with explicit word order; emit calls even before all runtime symbols are linked.

- [ ] **Step 4: Run advanced tests**

Run `npm run compile; node scripts/test-c-advanced-backend.js; npm run test:c`. Expected: compile succeeds and object output contains the documented runtime relocations.

- [ ] **Step 5: Commit**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/scripts/test-c-advanced-backend.js
git commit -m "feat: lower aggregates function pointers and float calls"
```

### Task 6: Public API and Legacy Migration

**Files:**
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Modify: `merc32-vsce/src/compilerService.ts`
- Modify: `merc32-vsce/src/extensionCommands.ts`
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Test: `merc32-vsce/scripts/test-c-integration.js`

**Interfaces:**
- Existing `compileC` and `compileCFile` remain source-compatible.
- New object APIs are exported from `src/cCompiler/index.ts`.

- [ ] **Step 1: Add integration tests for API compatibility**

Assert that old callers receive assembly, new callers receive a versioned object, source locations survive preprocessing, and `buildCFileToRom` still returns the existing artifact list.

- [ ] **Step 2: Route single-file compile through in-memory linking**

Replace the old direct generator in the default path only after parity tests pass. Keep the legacy implementation isolated for differential debugging, without exposing a second user-facing compiler mode.

- [ ] **Step 3: Run the complete C baseline**

Run `npm run test:c; npm run test:c:preprocessor; npm run test:c:rtl; node scripts/test-c-integration.js`. Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add merc32-vsce/src/cCompiler merc32-vsce/src/compilerService.ts merc32-vsce/src/extensionCommands.ts merc32-vsce/scripts/test-c-compiler.js merc32-vsce/scripts/test-c-integration.js
git commit -m "feat: switch C APIs to typed MERC32 compiler"
```

