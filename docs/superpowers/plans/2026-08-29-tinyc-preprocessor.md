# Tiny C Preprocessor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Tiny C compile generated SoC headers through quoted includes, object macros, conditional directives, include guards, and source-aware diagnostics.

**Architecture:** A file-aware preprocessing module runs before the existing Tiny C lexer. It emits plain C plus a per-output-line source map; direct `compileC(string)` remains unchanged, while a pure Node `compileCFile` API preprocesses and remaps `CompilerError` locations. The VSCode-dependent compiler service delegates to that API. Macro replacement is token-aware and the conditional expression evaluator is self-contained rather than using host-language `eval`.

**Tech Stack:** TypeScript ES2020/CommonJS, Node.js `fs`/`path`, existing Tiny C compiler, Node `assert` tests.

**Spec:** `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`

## Global Constraints

- Support quoted `#include`, object `#define`, `#undef`, `#if`, `#ifdef`,
  `#ifndef`, `#else`, and `#endif`.
- Do not add function-style macros, angle-bracket system includes, token pasting,
  stringification, variadic macros, or a standard library.
- Never replace tokens inside comments, character literals, or string literals.
- Include cycles and include depth above 32 are errors.
- File compilation diagnostics must report original file, line, and column.
- Direct `compileC(source)` API behavior and existing compiler tests remain valid.

---

## File Structure

- Create `merc32-vsce/src/cPreprocessor.ts`: directives, file loading, macros,
  conditional expressions, and source maps.
- Modify `merc32-vsce/src/cCompiler/index.ts`: expose pure file compilation,
  preprocessing, and diagnostic remapping without importing `vscode`.
- Modify `merc32-vsce/src/compilerService.ts`: delegate file compilation to the
  pure compiler API and retain only settings, artifact, and output-file logic.
- Modify `merc32-vsce/src/cCompiler/tinyc.ts`: optional source file on
  `CompilerError` without changing direct compile behavior.
- Modify `merc32-vsce/src/cCompiler/index.ts`: export new diagnostic type fields.
- Create `merc32-vsce/scripts/test-c-preprocessor.js`: filesystem and compiler
  integration tests.
- Modify `merc32-vsce/package.json`: add test command to the normal suite.
- Modify `merc32-vsce/README.md`: document supported preprocessing subset.

### Task 1: Define the File Preprocessing Contract

**Files:**
- Create: `merc32-vsce/src/cPreprocessor.ts`
- Create: `merc32-vsce/scripts/test-c-preprocessor.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces:
  - `preprocessCFile(entryFile: string, options?: CPreprocessOptions): PreprocessedC`
  - `CPreprocessOptions { readFile?, realPath?, maxIncludeDepth? }`
  - `PreprocessedC { code: string; lineMap: readonly CSourceLocation[] }`
  - `CSourceLocation { file: string; line: number }`
  - `CPreprocessorError { file: string; line: number; column: number }`

- [ ] **Step 1: Write failing include and macro tests**

Create a temporary project in the Node test:

```javascript
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-cpp-'));
fs.writeFileSync(path.join(root, 'soc.h'), [
    '#ifndef DEMO_SOC_H',
    '#define DEMO_SOC_H',
    '#define UART0_BASE 0x10000000',
    '#define UART0_IRQ 3',
    '#endif',
    '',
].join('\n'));
fs.writeFileSync(path.join(root, 'main.c'), [
    '#include "soc.h"',
    'char *text = "UART0_BASE";',
    'int main(void) { return UART0_IRQ; }',
    '',
].join('\n'));

const result = preprocessCFile(path.join(root, 'main.c'));
assert.match(result.code, /return 3;/);
assert.match(result.code, /"UART0_BASE"/);
assert.ok(result.lineMap.some((line) => line.file.endsWith('soc.h')));
```

Always remove only the unique `mkdtemp` directory in `finally`.

- [ ] **Step 2: Add the test script and verify missing export failure**

Add:

```json
"test:c:preprocessor": "npm run compile && node scripts/test-c-preprocessor.js",
"test": "npm run test:pseudo && node scripts/test-c-preprocessor.js && node scripts/test-c-compiler.js"
```

Run:

```powershell
Set-Location merc32-vsce
npm run test:c:preprocessor
```

Expected: FAIL because `out/cPreprocessor` does not exist.

- [ ] **Step 3: Add exact public types and a file loader shell**

Start `cPreprocessor.ts` with:

```typescript
export interface CSourceLocation {
    file: string;
    line: number;
}

export interface PreprocessedC {
    code: string;
    lineMap: readonly CSourceLocation[];
}

export interface CPreprocessOptions {
    readFile?: (file: string) => string;
    realPath?: (file: string) => string;
    maxIncludeDepth?: number;
}

export class CPreprocessorError extends Error {
    constructor(
        message: string,
        readonly file: string,
        readonly line: number,
        readonly column: number,
    ) {
        super(`${file}:${line}:${column}: ${message}`);
        this.name = 'CPreprocessorError';
    }
}
```

Use injected readers for unit tests and `fs.readFileSync`/`fs.realpathSync` as
defaults. Normalize entry paths with `path.resolve`.

- [ ] **Step 4: Commit the contract and red tests**

```powershell
git add -- merc32-vsce/src/cPreprocessor.ts merc32-vsce/scripts/test-c-preprocessor.js merc32-vsce/package.json
git commit -m "test: define Tiny C preprocessing contract"
```

### Task 2: Implement Includes and Token-Aware Object Macros

**Files:**
- Modify: `merc32-vsce/src/cPreprocessor.ts`
- Modify: `merc32-vsce/scripts/test-c-preprocessor.js`

**Interfaces:**
- Consumes: Task 1 public types.
- Produces: recursive quoted includes, include guards, `#define`, and `#undef`.

- [ ] **Step 1: Add negative and lexical tests**

Cover these exact cases:

```javascript
assert.match(preprocess('int x = VALUE;', { VALUE: '7' }), /int x = 7;/);
assert.match(preprocess('char *s = "VALUE";', { VALUE: '7' }), /"VALUE"/);
assert.match(preprocess("int c = 'V';", { V: '7' }), /'V'/);
assert.match(preprocess('/* VALUE */ int x;', { VALUE: '7' }), /\/\* VALUE \*\//);
assert.throws(() => preprocessFile('missing.c'), /cannot read include/);
assert.throws(() => preprocessFile('function_macro.c'), /function-style macros are not supported/);
```

Add a nested relative include where `inc/a.h` includes `nested/b.h`; assert the
second path resolves relative to `a.h`, not the entry file.

- [ ] **Step 2: Implement directive scanning and recursive file processing**

Use one context per preprocessing call:

```typescript
interface PreprocessContext {
    macros: Map<string, string>;
    includeStack: string[];
    output: string[];
    lineMap: CSourceLocation[];
    maxIncludeDepth: number;
}
```

Recognize a directive only when `#` is the first non-whitespace token on a
logical line and the scanner is not inside a block comment. Emit a blank line
for each directive so same-file locations remain intuitive. Append included
content at the include line and record each output line's originating file and
line.

- [ ] **Step 3: Implement identifier-only recursive macro expansion**

Scan ordinary source into identifier, literal, comment, whitespace, and symbol
segments. Expand only identifiers found in `macros`. Track an expansion stack:

```typescript
if (expansionStack.includes(name)) {
    throw error(`recursive macro expansion for '${name}'`, location);
}
if (expansionStack.length >= 64) {
    throw error('macro expansion depth exceeds 64', location);
}
```

Reject a `#define NAME(` directive as a function-style macro. `#undef NAME`
silently removes a missing macro, matching conventional preprocessors.

- [ ] **Step 4: Run the focused preprocessor suite**

```powershell
npm run test:c:preprocessor
```

Expected: include, guard, lexical-isolation, and failure cases pass.

- [ ] **Step 5: Commit include and macro support**

```powershell
git add -- merc32-vsce/src/cPreprocessor.ts merc32-vsce/scripts/test-c-preprocessor.js
git commit -m "feat: add Tiny C includes and object macros"
```

### Task 3: Add Conditional Directives and Robust Include Errors

**Files:**
- Modify: `merc32-vsce/src/cPreprocessor.ts`
- Modify: `merc32-vsce/scripts/test-c-preprocessor.js`

**Interfaces:**
- Produces: deterministic conditional stack and integer `#if` evaluator.

- [ ] **Step 1: Add conditional behavior tests**

Create cases for:

```c
#define ENABLED 1
#if ENABLED && (IRQ_COUNT == 3)
int selected = 1;
#else
int selected = 0;
#endif
```

Also test nested inactive branches, `#ifdef`, `#ifndef`, `defined(NAME)`, unknown
identifiers evaluating to zero, unmatched `#else`, duplicate `#else`, missing
`#endif`, include cycles, and a 33-file include chain.

- [ ] **Step 2: Verify the new tests fail**

Run `npm run test:c:preprocessor`. Expected: FAIL on the first conditional.

- [ ] **Step 3: Implement a conditional-frame stack**

Use:

```typescript
interface ConditionalFrame {
    parentActive: boolean;
    branchActive: boolean;
    branchTaken: boolean;
    elseSeen: boolean;
}
```

Inactive branches must process only nesting directives; they must not load
includes or define/undefine macros.

- [ ] **Step 4: Implement the integer expression parser**

Tokenize numbers, identifiers, `defined`, parentheses, unary `! ~ + -`,
multiplicative/additive, shifts, relational/equality, bitwise operators, and
logical `&& ||`. Expand object macros before evaluation and treat remaining
identifiers as zero. Use 32-bit integer operations and explicitly reject divide
or remainder by zero.

- [ ] **Step 5: Run and commit conditional support**

```powershell
npm run test:c:preprocessor
git add -- merc32-vsce/src/cPreprocessor.ts merc32-vsce/scripts/test-c-preprocessor.js
git commit -m "feat: add Tiny C conditional preprocessing"
```

### Task 4: Integrate File Preprocessing with Tiny C Diagnostics

**Files:**
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`
- Modify: `merc32-vsce/src/cCompiler/index.ts`
- Modify: `merc32-vsce/src/compilerService.ts`
- Modify: `merc32-vsce/scripts/test-c-preprocessor.js`

**Interfaces:**
- Consumes: `preprocessCFile`, `CPreprocessOptions`, `CompileOptions`, and
  `CompilerError`.
- Produces:

```typescript
export interface CompileFileOptions extends CompileOptions {
    preprocess?: CPreprocessOptions;
}

export function compileCFile(
    sourceFile: string,
    options?: CompileFileOptions,
): CompileResult;
```

`src/cCompiler/index.ts` and everything it imports remain free of `vscode`.

- [ ] **Step 1: Add a generated-header compiler integration test**

Write `demo_soc.h` and `main.c` under the test temp directory:

```c
#ifndef DEMO_SOC_H
#define DEMO_SOC_H
#define DEMO_SOC_UART0_BASE 0x10000000
#define DEMO_SOC_UART0_IRQ 0
#endif
```

```c
#include "../include/demo_soc.h"
int main(void) {
    volatile unsigned int *uart =
        (volatile unsigned int *)DEMO_SOC_UART0_BASE;
    return DEMO_SOC_UART0_IRQ + (*uart & 0);
}
```

Import `compileCFile` from `../out/cCompiler`. Assert
`compileCFile(mainPath, { moduleName: 'demo_main' }).assembly` contains the full
base-load sequence and assembles successfully with `SimpleCPUAssembler`. This
test runs in plain Node and must not import `out/compilerService`.

- [ ] **Step 2: Add source remapping to `CompilerError`**

Extend the constructor compatibly:

```typescript
constructor(
    message: string,
    readonly line?: number,
    readonly column?: number,
    readonly sourceFile?: string,
) { /* format sourceFile:line:column when present */ }
```

Existing three-argument calls and direct tests must retain their current
messages when `sourceFile` is absent.

- [ ] **Step 3: Implement the pure file-aware compiler API**

In `src/cCompiler/index.ts`, import `preprocessCFile` from `../cPreprocessor`,
preprocess `sourceFile`, and pass the resulting code plus `CompileOptions` to
`compileC`. Do not forward the `preprocess` property into `compileC`. Catch only
`CompilerError`; map `error.line` through `lineMap[error.line - 1]` and throw a
new `CompilerError` with the original file and line. Preserve the compiler's
column as a best-effort column within that originating line. Let
`CPreprocessorError` pass through unchanged.

- [ ] **Step 4: Delegate the VSCode service to `compileCFile`**

Replace the raw `fs.readFileSync` and `compileC` call in
`compileCFileToAssembly` with:

```typescript
const result = compileCFile(sourceFile, {
    dataBase: settings.cDataBase,
    dlbAddrWidth: settings.cDlbAddrWidth,
    moduleName: baseName,
});
```

Keep directory creation, assembly-file writing, and artifact construction in
`compilerService.ts`; this layer may continue importing VSCode-backed settings.

- [ ] **Step 5: Run all compiler tests**

```powershell
npm run test:c:preprocessor
npm run test:c
npm test
```

Expected: generated-header integration passes and all prior compiler messages
remain compatible.

- [ ] **Step 6: Commit compiler integration**

```powershell
git add -- merc32-vsce/src/cCompiler/tinyc.ts merc32-vsce/src/cCompiler/index.ts merc32-vsce/src/compilerService.ts merc32-vsce/scripts/test-c-preprocessor.js
git commit -m "feat: preprocess Tiny C files before compilation"
```

### Task 5: Document and Regress the Tiny C Subset

**Files:**
- Modify: `merc32-vsce/README.md`
- Modify: `README.md`
- Verify: all compiler and RTL firmware files

**Interfaces:**
- Produces: published preprocessing behavior consumed by generated software.

- [ ] **Step 1: Document supported and rejected directives**

Add a concise Tiny C preprocessing section with one include-guard example and
an explicit list of unsupported function macros, system headers, token pasting,
stringification, and variadics.

- [ ] **Step 2: Run full extension and firmware regressions**

```powershell
Set-Location merc32-vsce
npm test
npm run test:c:rtl
Set-Location ..
git diff --check
git status --short
```

Expected: all tests pass and only planned documentation changes remain.

- [ ] **Step 3: Commit documentation**

```powershell
git add -- README.md merc32-vsce/README.md
git commit -m "docs: describe Tiny C preprocessing"
```
