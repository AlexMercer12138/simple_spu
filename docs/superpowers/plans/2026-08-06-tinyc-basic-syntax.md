# Tiny C Basic Syntax Extensions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add character and UTF-8 string literals, scalar array initializers, compound/update/conditional expressions, `do/while`, and `switch` to the MERC32 Tiny C compiler, with compiler and RTL execution coverage.

**Architecture:** Extend the existing lexer, parser, AST, function collector, and assembly code generator in place. Character literals lower to integer nodes; strings use a deduplicated hidden static-byte pool; new expressions preserve short-circuiting and single lvalue evaluation; new control flow reuses the current label stacks.

**Tech Stack:** TypeScript ES2020, Node.js assertion tests, MERC32 assembler, Verilog-2005 RTL, Icarus Verilog through the existing `npm run test:c:rtl` runner.

---

## File Structure

- Modify `merc32-vsce/src/cCompiler/tinyc.ts`: lexer, AST, parser, static-data layout, initializer emission, expression emission, control-flow emission, and semantic validation.
- Modify `merc32-vsce/scripts/test-c-compiler.js`: positive assembly tests and negative diagnostic tests for every new syntax group.
- Modify `example/tinyc_feature_test.c`: executable CPU regression for new expressions, initializers, and control flow.
- Modify `example/tinyc_uart_test.c`: string-based UART `print` regression.
- Modify `merc32-vsce/README.md`: user-facing supported-syntax table and examples.
- Modify `docs/ABI.md`: static string layout, initialization, expression semantics, and control-flow lowering.

Do not modify CPU or peripheral RTL. Existing `tinyc_cpu_tb.v` and `tinyc_uart_tb.v` remain the runtime checkers.

### Task 1: Character Literals and Escapes

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing character-literal tests**

Append a source containing all supported escape classes and compile it through the real compiler and assembler:

```javascript
const characterLiteralSource = String.raw`
int main(void) {
    char plain = 'A';
    char newline = '\n';
    unsigned char quote = '\'';
    unsigned char slash = '\\';
    unsigned char octal = '\101';
    unsigned char hex = '\xFF';
    return plain + newline + quote + slash + octal + hex;
}
`;

const { assembly: characterAssembly } = compileC(characterLiteralSource, {
    moduleName: 'character_literal_test',
});
assert.match(characterAssembly, /mov r7, 0x41/);
assert.match(characterAssembly, /mov r7, 0xA/);
assert.match(characterAssembly, /mov r7, 0xFF/);
assert.ok(new SimpleCPUAssembler().assemble(characterAssembly).machineCodes.length > 0);

expectCompilerError("int main(void) { char c = ''; return 0; }", /empty character literal/);
expectCompilerError("int main(void) { char c = 'ab'; return 0; }", /exactly one byte/);
expectCompilerError("int main(void) { char c = '中'; return 0; }", /exactly one byte/);
expectCompilerError("int main(void) { char c = '\\x100'; return 0; }", /escape value.*byte/);
expectCompilerError("int main(void) { char c = 'a; return 0; }", /unterminated character literal/);
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npm run compile
node scripts/test-c-compiler.js
```

Expected: compilation test fails because the lexer reports `unexpected character` for `'`.

- [ ] **Step 3: Implement character-token decoding**

Add a lexer helper that consumes one quoted character, decodes the approved escapes, UTF-8 encodes raw source characters with `Buffer.from(text, 'utf8')`, and returns the existing numeric token shape:

```typescript
private readCharacterLiteral(line: number, column: number): Token {
    this.advance();
    const bytes = this.readLiteralBytes("'", line, column, 'character');
    if (bytes.length === 0) {
        throw new CompilerError('empty character literal', line, column);
    }
    if (bytes.length !== 1) {
        throw new CompilerError('character literal must encode exactly one byte', line, column);
    }
    return { kind: 'number', text: String(bytes[0]), value: bytes[0], line, column };
}
```

Call this helper before symbol matching in `nextToken()`. Implement `readLiteralBytes`, `readEscapeByte`, and raw UTF-8 segment handling once so Task 2 can reuse them. Reject EOF/newline before the closing quote and reject numeric escape values above `0xFF`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run `npm run test:c`.

Expected: all existing tests plus the new character cases pass.

- [ ] **Step 5: Commit the character-literal slice**

```powershell
git add merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git commit -m "feat: add Tiny C character literals"
```

### Task 2: UTF-8 String Literals and Static String Pool

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing string-pool tests**

Add a program that uses local/global string pointers, adjacent concatenation, UTF-8, and deduplication:

```javascript
const stringLiteralSource = `
char *global_text = "same";

int first(char *text) { return text[0]; }

int main(void) {
    char *local_text = "same";
    return first("A" "B中\\n") + local_text[1] + global_text[2];
}
`;

const { assembly: stringAssembly } = compileC(stringLiteralSource, {
    moduleName: 'string_literal_test',
    dataBase: 0x08000200,
});
assert.match(stringAssembly, /sb \[r8\], r7/);
for (const byte of [0x41, 0x42, 0xe4, 0xb8, 0xad, 0x0a, 0x00]) {
    assert.match(stringAssembly, new RegExp(`mov r7, ${byte > 9 ? `0x${byte.toString(16).toUpperCase()}` : byte}`));
}
assert.strictEqual((stringAssembly.match(/same/g) || []).length, 0);
assert.ok(new SimpleCPUAssembler().assemble(stringAssembly).machineCodes.length > 0);

expectCompilerError('int main(void) { char *s = "unterminated; return 0; }', /unterminated string literal/);
```

Also assert that both `"same"` expressions load the same hidden address by extracting their emitted immediates from the generated assembly.

- [ ] **Step 2: Run the test and verify RED**

Run `npm run test:c`.

Expected: lexer rejects `"` or the parser has no string expression.

- [ ] **Step 3: Add the string token and AST node**

Extend the token and expression unions:

```typescript
interface Token {
    kind: 'identifier' | 'number' | 'string' | 'keyword' | 'symbol' | 'eof';
    text: string;
    value?: number;
    bytes?: number[];
    line: number;
    column: number;
}

interface StringExpr {
    kind: 'string';
    bytes: number[];
    line: number;
    column: number;
}
```

Reuse `readLiteralBytes` for double quotes. In `parsePrimary()`, merge consecutive string tokens by concatenating their byte arrays and create one `StringExpr` without the terminating zero.

- [ ] **Step 4: Add a static-string collection and allocation prepass**

Add a map keyed by a stable byte key such as `bytes.join(',')`:

```typescript
interface StaticString {
    bytes: number[];
    address: number;
}

private readonly staticStrings = new Map<string, StaticString>();
```

After indexing user globals, recursively traverse all global initializers and function bodies. For each string, allocate `bytes.length + 1` bytes at `nextGlobalAddress`, deduplicate identical content, and retain the address. Require `dataBase` in `0x08000000..0x0FFFFFFF`, `dlbAddrWidth` in `1..25`, and the exclusive bound `dataBase + (1 << (dlbAddrWidth + 2))` at or below `0x10000000`; retain the static-data overflow check against that bound.

Extend `emitGlobalInitializers()` to emit each payload byte followed by a zero with `sb`. Extend `emitExpr()` and `exprType()` so a string loads its address and has type `char *`. Extend constant evaluation so a string expression can initialize a global pointer.

- [ ] **Step 5: Traverse strings in FunctionCollector**

Add `case 'string': return;` and recursively visit strings through every existing expression container. This keeps the collector exhaustive and TypeScript's union checking useful.

- [ ] **Step 6: Run tests and verify GREEN**

Run `npm run test:c`.

Expected: UTF-8 bytes, zero termination, pointer initializers, adjacent concatenation, and deduplication assertions pass.

- [ ] **Step 7: Commit the string-pool slice**

```powershell
git add merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git commit -m "feat: add Tiny C UTF-8 string literals"
```

### Task 3: String and Integer Array Initializers

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing initializer tests**

Compile global and local cases covering inferred length, zero fill, trailing commas, all element widths, string arrays, and runtime local expressions:

```javascript
const initializerSource = `
char greeting[] = "hello";
unsigned char utf8[8] = "中";
short signed_table[] = {1, -2, 3,};
unsigned short short_table[5] = {4, 5};
int word_table[] = {6, 7, 8};
unsigned int unsigned_table[4] = {9};

int seed(void) { return 10; }

int main(void) {
    char local_text[4] = "ok";
    int local_values[] = {seed(), 20, 30};
    return greeting[1] + utf8[0] + signed_table[1] + short_table[4]
        + word_table[2] + unsigned_table[3] + local_text[2] + local_values[0];
}
`;
```

Assert the generated assembly contains `sb`, `sh`, and `sw` stores at the expected aligned addresses and emits zero stores for omitted elements.

Add diagnostics:

```javascript
expectCompilerError('int a[]; int main(void) { return 0; }', /incomplete array requires an initializer/);
expectCompilerError('int a[] = {}; int main(void) { return 0; }', /cannot infer.*empty initializer/);
expectCompilerError('int a[2] = {1, 2, 3}; int main(void) { return 0; }', /too many array initializer elements/);
expectCompilerError('int a[2] = "x"; int main(void) { return 0; }', /string initializer requires a character array/);
expectCompilerError('char a[2] = "hi"; int main(void) { return 0; }', /string initializer.*does not fit/);
expectCompilerError('int a[2] = {{1}, {2}}; int main(void) { return 0; }', /nested initializers are not supported/);
```

- [ ] **Step 2: Run the test and verify RED**

Run `npm run test:c`.

Expected: parser rejects `{` after `=` or rejects empty array brackets.

- [ ] **Step 3: Add initializer AST and declarator finalization**

Define:

```typescript
type Initializer = ExprInitializer | ListInitializer;

interface ExprInitializer {
    kind: 'expr-init';
    expr: Expr;
}

interface ListInitializer {
    kind: 'list-init';
    values: Expr[];
    line: number;
    column: number;
}
```

Change global/local declarations to `init?: Initializer`. Let `parseDeclaratorSuffix()` represent `[]` as an incomplete array, parse the initializer, then finalize its length from a list count or UTF-8 string byte count plus one. Reject incomplete arrays without a valid initializer.

Parse `{ expression, ... }` with an optional trailing comma. Reject a nested `{` immediately with the specified diagnostic.

- [ ] **Step 4: Emit global and local initializer stores**

Add helpers that normalize an initializer into element expressions/byte values and a zero-fill count. Global emission calls `evalConstant()` for each list element. Local emission evaluates each explicit element once in order and emits immediate zero stores for the remainder.

For a string array initializer, write its UTF-8 bytes and terminator directly into the array and do not require a separate string-pool copy unless the same literal also appears as an expression.

Update `FunctionCollector.collect()` to visit every local list expression. Update global string collection to skip literals consumed solely as array initializers.

- [ ] **Step 5: Run tests and verify GREEN**

Run `npm run test:c`.

Expected: layout, inferred lengths, zero fill, runtime local expressions, and all negative checks pass.

- [ ] **Step 6: Commit the initializer slice**

```powershell
git add merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git commit -m "feat: add Tiny C array initializers"
```

### Task 4: Compound Assignment and Prefix/Postfix Updates

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing update-expression tests**

Add a compile source exercising every operator, narrow values, pointer scaling, and single lvalue evaluation:

```c
int main(void) {
    int data[4] = {1, 2, 3, 4};
    int i = 0;
    int old = data[i++]++;
    int now = ++data[i];
    int *p = data;
    p += 2;
    p--;
    data[0] += 2;
    data[0] -= 1;
    data[0] *= 3;
    data[0] /= 2;
    data[0] %= 5;
    data[0] &= 7;
    data[0] |= 8;
    data[0] ^= 3;
    data[0] <<= 1;
    data[0] >>= 1;
    return old + now + i + *p + data[0];
}
```

Assert assembly contains `mul/div/rem`, shifts, bit operations, and pointer scaling by four. Add negative checks for `1++`, `data++`, pointer `*=`, and assignment to non-lvalues.

- [ ] **Step 2: Run the test and verify RED**

Run `npm run test:c`.

Expected: lexer or parser rejects `++` and compound tokens.

- [ ] **Step 3: Extend longest-match tokenization and AST**

Recognize three-character `<<=`/`>>=` before two-character tokens, then add `++`, `--`, and all compound assignments. Define:

```typescript
interface CompoundAssignExpr {
    kind: 'compound-assign';
    target: Expr;
    op: string;
    value: Expr;
    line: number;
    column: number;
}

interface UpdateExpr {
    kind: 'update';
    target: Expr;
    delta: 1 | -1;
    prefix: boolean;
    line: number;
    column: number;
}
```

Parse compound assignments in `parseAssignment()`, prefix updates in `parseUnary()`, and postfix updates after all `[]` suffixes in `parsePostfix()`.

- [ ] **Step 4: Implement single-evaluation lvalue emission**

Introduce an address-based helper:

```typescript
private emitLValueAddress(expr: Expr, target: string): CType {
    // variable: global absolute address or r12 + slot offset
    // dereference: evaluate pointer once
    // index: evaluate base and index once, then scale
}
```

Use a temporary slot to preserve this address across RHS evaluation. Load the old value from that address, reuse a shared binary-operation emitter, convert the result to the lvalue type, store once, and return either old or new value according to prefix/postfix semantics.

Allow pointer `+=`, `-=`, `++`, and `--` only; scale increments with `typeSizeBytes(derefType(pointerType))`. Reject all other pointer update operators.

- [ ] **Step 5: Make type collection exhaustive**

Add compound/update handling to `emitExpr`, `exprType`, all AST collectors, string collectors, and constant-expression rejection. Keep normal assignment behavior unchanged except where it can safely share the new lvalue address helper.

- [ ] **Step 6: Run tests and verify GREEN**

Run `npm run test:c`.

Expected: all update syntax assembles, negative diagnostics match, and the test proves the index update appears once.

- [ ] **Step 7: Commit the update-operator slice**

```powershell
git add merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git commit -m "feat: add Tiny C update operators"
```

### Task 5: Conditional Expressions

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing conditional-expression tests**

Use side effects to prove short-circuiting and nesting:

```c
int choose(int condition, int *counter) {
    return condition ? ++*counter : --*counter;
}

int main(void) {
    int counter = 10;
    int a = choose(1, &counter);
    int b = choose(0, &counter);
    int c = 0 ? 1 : 1 ? 2 : 3;
    return a + b + c + counter;
}
```

Assert generated assembly has separate true/false/end labels and branches before either side effect. Add incompatible pointer/integer branch diagnostics where neither side is the integer constant zero.

- [ ] **Step 2: Run the test and verify RED**

Run `npm run test:c`.

Expected: lexer rejects `?`.

- [ ] **Step 3: Add parser precedence and AST**

Define `ConditionalExpr` with its `line` and `column`, recognize `?` as a symbol, and insert `parseConditional()` between logical-or and assignment. Parse the middle operand with `parseExpression()` and the false operand recursively with `parseConditional()` to preserve right associativity.

- [ ] **Step 4: Emit short-circuit conditional code**

Determine a common result type before emission. Generate false and end labels, branch on the condition, emit exactly one branch expression into the requested target, convert it to the common type, and join at the end label. Add exhaustive collector/type cases.

- [ ] **Step 5: Run tests and verify GREEN**

Run `npm run test:c`.

Expected: conditional source compiles and assembler validation passes.

- [ ] **Step 6: Commit the conditional-expression slice**

```powershell
git add merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git commit -m "feat: add Tiny C conditional expressions"
```

### Task 6: do/while and switch/case/default

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing control-flow tests**

Add source covering one-shot `do`, `continue`, switch fallthrough, shared cases, default, nested switch, and switch inside a loop:

```c
int classify(int value) {
    int result = 0;
    do {
        result++;
        if (result < 2) continue;
    } while (result < 3);

    switch (value) {
    case 'a':
        result += 10;
    case 'b':
        result += 20;
        break;
    case 3:
    case 4:
        result += 40;
        break;
    default:
        result += 80;
    }
    return result;
}
```

Add negative tests for duplicate cases, multiple defaults, nonconstant cases, `case/default` outside switch, `break` outside loop/switch, and `continue` outside a loop.

- [ ] **Step 2: Run the test and verify RED**

Run `npm run test:c`.

Expected: parser treats `do`, `switch`, `case`, and `default` as identifiers or fails on their syntax.

- [ ] **Step 3: Add statement AST and parser cases**

Add keywords and nodes:

```typescript
interface DoWhileStmt { kind: 'do-while'; body: Statement; test: Expr; line: number; column: number; }
interface SwitchStmt { kind: 'switch'; test: Expr; body: Statement; line: number; column: number; }
interface CaseStmt { kind: 'case'; value?: Expr; statement: Statement; line: number; column: number; }
```

Parse `do statement while (expression);`, `switch (expression) statement`, `case constant-expression: statement`, and `default: statement`.

- [ ] **Step 4: Emit do/while labels**

Generate body, condition, and end labels. Push the end label on `breakLabels` and the condition label on `continueLabels`, emit the body first, then branch back when the test is true.

- [ ] **Step 5: Collect and validate switch labels**

Before emitting a switch body, recursively collect case nodes without descending into nested switches. Evaluate each case with `evalConstant()`, convert it to the promoted switch type, reject duplicates/default conflicts, and allocate a label for every case node.

Evaluate the switch expression once into a temporary slot, compare it against each case value, jump to the matching case, then jump to default or end. Push only the end label on `breakLabels`. Emit case labels in source order without implicit jumps to preserve fallthrough.

- [ ] **Step 6: Update collectors and diagnostics**

Traverse all new statements in `FunctionCollector` and string collection. Track active switch depth during statement emission so `case/default` outside a switch reports the required source location. Add `line` and `column` to `BreakStmt` and `ContinueStmt`, then update their diagnostics; the break error must mention loop or switch.

- [ ] **Step 7: Run tests and verify GREEN**

Run `npm run test:c`.

Expected: all control-flow cases and diagnostics pass and generated assembly assembles.

- [ ] **Step 8: Commit the control-flow slice**

```powershell
git add merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/scripts/test-c-compiler.js
git commit -m "feat: add Tiny C switch and do while"
```

### Task 7: Execute New Syntax on CPU RTL and UART

**Files:**
- Modify: `example/tinyc_feature_test.c`
- Modify: `example/tinyc_uart_test.c`
- Modify if expected byte count changes: `rtl/sim/tinyc_uart_tb.v`

- [ ] **Step 1: Extend the CPU feature firmware**

Add focused functions to `tinyc_feature_test.c` using the new syntax directly. Include global and local initializers, UTF-8 byte checks, prefix/postfix value checks, `array[index++] += value`, pointer increments, conditional side effects, do/while continue behavior, and switch fallthrough/default. Return a deterministic subtotal and update `expected` by the same amount.

Use checks that make individual semantic mistakes change the final pass/fail total; do not only test whether the source compiles.

- [ ] **Step 2: Run RTL and verify the firmware test fails before final expectation is corrected**

Run `npm run test:c:rtl` after adding the new feature function but before updating `expected`.

Expected: `tinyc_feature_test` reports `TEST FAIL` with the new computed total, proving the RTL path executed the new code.

- [ ] **Step 3: Set the exact expected total and verify CPU GREEN**

Update the firmware's `expected` constant to the manually calculated total. Run `npm run test:c:rtl` and require `tinyc_feature_test` to pass.

- [ ] **Step 4: Replace the UART word-array writer with a string print path**

Use this interface shape in `tinyc_uart_test.c`:

```c
int uart_print(char *text) {
    int index = 0;
    while (text[index] != '\0') {
        if (uart_putc((unsigned char)text[index]) == 0) {
            return 0;
        }
        index++;
    }
    return 1;
}
```

Call `uart_print("MERC32\r\n")`, retain the existing RX test, and echo the received byte. Keep the testbench expected stream as `MERC32\r\n!`; change it only if the chosen literal intentionally changes bytes.

- [ ] **Step 5: Run the complete RTL suite**

Run `npm run test:c:rtl`.

Expected: exactly six `TEST PASS` markers and `MERC32 Tiny C RTL suite passed (6 tests)`.

- [ ] **Step 6: Commit runtime coverage**

```powershell
git add example/tinyc_feature_test.c example/tinyc_uart_test.c rtl/sim/tinyc_uart_tb.v
git commit -m "test: execute Tiny C syntax extensions on RTL"
```

Only stage `tinyc_uart_tb.v` if its expected stream actually changes.

### Task 8: Documentation and Final Verification

**Files:**
- Modify: `merc32-vsce/README.md`
- Modify: `docs/ABI.md`

- [ ] **Step 1: Update user documentation**

Document:

- character/string syntax, escapes, UTF-8, zero termination, adjacent concatenation
- hidden static RAM string storage and read-only-by-convention behavior
- inferred/fixed one-dimensional array initialization and zero fill
- all compound assignments and prefix/postfix updates
- ternary short-circuiting
- do/while and switch fallthrough/break/continue behavior
- remaining exclusions from the design specification

Add a concise UART example using `uart_print("hello\n")`.

- [ ] **Step 2: Run toolchain tests**

Run:

```powershell
npm test
```

Expected: pseudo-instruction and Tiny C compiler suites pass.

- [ ] **Step 3: Run full RTL execution tests**

Run:

```powershell
npm run test:c:rtl
```

Expected: all six firmware tests pass, including the updated CPU feature and UART string paths.

- [ ] **Step 4: Check JSON and repository formatting**

Run:

```powershell
git diff --check
git status --short
```

Expected: no whitespace errors and only intended source, test, example, and documentation changes remain.

- [ ] **Step 5: Commit documentation**

```powershell
git add merc32-vsce/README.md docs/ABI.md
git commit -m "docs: document Tiny C syntax extensions"
```

- [ ] **Step 6: Review final commit range**

Run `git log --oneline 9677bc7..HEAD` and inspect `git diff 9677bc7..HEAD --stat`.

Expected: the range contains only the planned compiler, test, example, and documentation slices plus the already committed baseline work.
