# MERC32 Compare/Branch Software Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace flag-based comparison and branches in the assembler and Tiny C compiler with boolean `cmp/cmpu`, `bz/bnz`, and a minimal dedicated IRQ function, without changing RTL.

**Architecture:** Comparison is an internal assembler instruction class encoded by opcodes `0x3/0x4`; branches reuse funct `0xb/0xc` under existing immediate/register opcodes. Tiny C materializes relations into a GPR and branches on that value. The IRQ vector remains at byte address 4 but contains only a jump to a normally compiled `__irq_handler` whose final return is `jmp r3`.

**Tech Stack:** TypeScript 6, Node.js assertion scripts, MERC32 fixed-width 32-bit ISA, Markdown and JSON editor metadata.

---

## File Map

- `merc32-vsce/src/assembler.ts`: new grammar and encodings.
- `merc32-vsce/scripts/test-pseudo-instructions.js`: assembler encodings and errors.
- `merc32-vsce/src/cCompiler/tinyc.ts`: comparison, control flow, and IRQ lowering.
- `merc32-vsce/scripts/test-c-compiler.js`: generated assembly contracts.
- `merc32-vsce/syntaxes/merc32-asm.tmLanguage.json`: mnemonic highlighting.
- `merc32-vsce/snippets/merc32-asm.json`: instruction snippets when applicable.
- `ISA.md` and `ABI.md`: public architecture and software conventions.

RTL source and RTL testbenches are outside this plan.

### Task 1: Add Failing Assembler Tests

**Files:**
- Modify: `merc32-vsce/scripts/test-pseudo-instructions.js`

- [ ] **Step 1: Replace old CMP/BRC fixtures with all register conditions**

```javascript
result = assemble(`
cmp  r1, r2 == r3
cmp  r1, r2 != r3
cmp  r1, r2 >= r3
cmp  r1, r2 <  r3
cmp  r1, r2 >  r3
cmp  r1, r2 <= r3
cmpu r1, r2 >= r3
cmpu r1, r2 <  r3
cmpu r1, r2 >  r3
cmpu r1, r2 <= r3
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0x00032140', '0x00032141', '0x00032142', '0x00032143',
    '0x00032144', '0x00032145', '0x00032146', '0x00032147',
    '0x00032148', '0x00032149',
])
```

- [ ] **Step 2: Add immediate and branch encoding fixtures**

```javascript
result = assemble(`
cmp  r4, r5 > -1
cmpu r4, r5 < -1
bz   r1, r2 + 0x8000
bnz  r3, r4 + 0xffff
bz   r1, r2 + r3
bnz  r4, r5 + r6
`)
assert.deepStrictEqual(hex(result.machineCodes), [
    '0xffff5434', '0xffff5437',
    '0x8000211b', '0xffff431c',
    '0x0003212b', '0x0006542c',
])
```

- [ ] **Step 3: Add precise invalid-input checks**

Add `mustThrow` cases for non-register `rd` or comparison LHS, invalid
operators, signed-16 comparison overflow, negative/overflowing/unaligned
direct branch immediates, missing branch base, and removed `brc/brcu` syntax.
Use `bz r1, r0 + 3` for the alignment failure; a nonzero runtime base cannot
be checked statically.

- [ ] **Step 4: Prove the tests fail first**

Run `npm run test:pseudo` in `merc32-vsce`.

Expected: failure at the first expression-form `cmp` or `bz/bnz` because the
old parser does not support it.

### Task 2: Implement Assembler Grammar and Encoding

**Files:**
- Modify: `merc32-vsce/src/assembler.ts`
- Test: `merc32-vsce/scripts/test-pseudo-instructions.js`

- [ ] **Step 1: Define non-conflicting internal instruction kinds**

```typescript
export enum InstructionType {
    SET = 0x0, ADD = 0x1, SUB = 0x2, AND = 0x3, OR = 0x4,
    XOR = 0x5, SLL = 0x6, SRL = 0x7, SRA = 0x8,
    MWR = 0x9, MRD = 0xA, BZ = 0xB, BNZ = 0xC,
    JAL = 0xD, CMP = 0xE,
}
```

`CMP=0xe` is internal only; encoded compare funct comes from the condition.

- [ ] **Step 2: Parse `cmp/cmpu` expressions**

Change `parseCmp` to accept an `unsigned` flag and return canonical operands
`[condition, rd, rs2, rhs]`. Tokenize the second comma-separated operand and
require exactly `rs2 operator rhs`. Require registers for `rd` and `rs2`, and
a register or signed-16 immediate for `rhs`.

Use these operator maps:

```typescript
const common = { '==': CompareCondition.EQ, '!=': CompareCondition.NE };
const signed = { ...common, '>=': SGE, '<': SLT, '>': SGT, '<=': SLE };
const unsigned = { ...common, '>=': UGE, '<': ULT, '>': UGT, '<=': ULE };
```

- [ ] **Step 3: Parse `bz/bnz` targets**

Add `parseBranch` returning `[rd, rs2, target]`. Accept only:

```asm
bz|bnz rd, rs2 + (u16|label|rs1)
```

Do not preserve subtraction or omitted-base aliases. After labels are replaced,
numeric targets must be `0..65535`. Require four-byte alignment only when the
base is `r0`; otherwise the final address is not statically known.

- [ ] **Step 4: Replace mnemonic dispatch**

Dispatch `cmp`, `cmpu`, `bz`, and `bnz`; remove `brc/brcu`. The supported-list
diagnostic becomes `mov, jmp, cmp, cmpu, bz, bnz`.

- [ ] **Step 5: Encode comparison opcodes**

```typescript
if (type === InstructionType.CMP) {
    const condition = Number.parseInt(ops[0], 10);
    const rd = this.parseRegister(ops[1]);
    const rs2 = this.parseRegister(ops[2]);
    const rhs = ops[3];
    if (this.isImmediate(rhs)) {
        const imm = this.parseImmediate(rhs, 16);
        return (imm << 16) | (rs2 << 12) | (rd << 8) |
            (0x3 << 4) | condition;
    }
    const rs1 = this.parseRegister(rhs);
    return (rs1 << 16) | (rs2 << 12) | (rd << 8) |
        (0x4 << 4) | condition;
}
```

- [ ] **Step 6: Encode branches**

For BZ/BNZ, encode `rd` as the tested register and `rs2` as the target base.
Numeric targets use raw unsigned 16 bits with opcode `0x1`; register targets
use `rs1` with opcode `0x2`. Funct is the instruction kind `0xb/0xc`.

- [ ] **Step 7: Run the focused suite**

Run `npm run test:pseudo`.

Expected: `pseudo-instruction tests passed`.

### Task 3: Lower Tiny C Comparisons and Branches

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Add failing generated-assembly assertions**

Extend the C fixture with signed, unsigned, equality, unary-not, loop, and
short-circuit expressions. Assert:

```javascript
assert.match(assembly, /cmp r\d+, r7 < r8/)
assert.match(assembly, /cmpu r\d+, r7 >= r8/)
assert.match(assembly, /\bbz r7, r0 \+ /)
assert.match(assembly, /\bbnz r7, r0 \+ /)
assert.doesNotMatch(assembly, /\bbrcu?\b/)
assert.doesNotMatch(assembly, /cmp_true|cmp_end/)
```

- [ ] **Step 2: Prove the compiler test fails**

Run `npm run test:c`.

Expected: failure because generated output still contains old CMP/BRC flow.

- [ ] **Step 3: Emit direct comparison values**

Keep the existing operand evaluation and temporary discipline, then emit:

```typescript
const mnemonic = this.shouldUseUnsignedCompare(expr.left, expr.right)
    ? 'cmpu'
    : 'cmp';
this.emit(`${mnemonic} ${target}, r7 ${expr.op} r8`);
return intType();
```

Remove `cmp_true/cmp_end` labels and zero/one branch diamonds.

- [ ] **Step 4: Emit unary not directly**

After evaluating into `target`, emit:

```typescript
this.emit(`cmp ${target}, ${target} == 0`);
```

- [ ] **Step 5: Branch on boolean registers**

```typescript
private emitBranchIfFalse(expr: Expr, label: string): void {
    this.emitExpr(expr, 'r7');
    this.emit(`bz r7, r0 + ${label}`);
}

private emitBranchIfTrue(expr: Expr, label: string): void {
    this.emitExpr(expr, 'r7');
    this.emit(`bnz r7, r0 + ${label}`);
}
```

Keep the existing short-circuit graph and change only its branch primitive.

- [ ] **Step 6: Run software tests**

Run `npm test`.

Expected: assembler and Tiny C compiler integration tests pass.

### Task 4: Simplify the Tiny C IRQ Interface

**Files:**
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`

- [ ] **Step 1: Replace the IRQ wrapper expectation**

Require `__irq_vector` to contain exactly `jmp __irq_handler`. Require the
`__irq_handler_return` block to end with `jmp r3`. Assert absence of the old
28-byte wrapper and any compiler-inserted IRQ re-enable.

- [ ] **Step 2: Prove the IRQ test fails**

Run `npm run test:c`.

Expected: failure because the old vector still saves registers.

- [ ] **Step 3: Emit the minimal vector**

Delete `IRQ_WRAPPER_FRAME_SIZE` and implement:

```typescript
private emitInterruptVector(): void {
    this.emit('__irq_vector:');
    this.emit(`jmp ${IRQ_HANDLER_NAME}`);
}
```

- [ ] **Step 4: Select the special return register**

Preserve the normal function frame setup and restoration. Change only the last
return instruction in `emitFunction`:

```typescript
this.emit(`jmp ${fn.name === IRQ_HANDLER_NAME ? 'r3' : 'r14'}`);
```

Do not save foreground context or emit an implicit `mov r1, 1`.

- [ ] **Step 5: Run software tests**

Run `npm test`.

Expected: all software tests pass.

### Task 5: Update ISA, ABI, and Editor Metadata

**Files:**
- Modify: `ISA.md`
- Modify: `ABI.md`
- Modify when old mnemonics are present: `merc32-vsce/syntaxes/merc32-asm.tmLanguage.json`
- Modify when old snippets are present: `merc32-vsce/snippets/merc32-asm.json`

- [ ] **Step 1: Replace obsolete ISA text**

Document opcodes `0x3/0x4`, condition codes, expression-form `cmp/cmpu`,
`bz/bnz`, compare sign extension, branch zero extension, and removal of hidden
flags and `brc/brcu`.

- [ ] **Step 2: Replace obsolete ABI interrupt text**

Document writable-but-reserved special registers, automatic clear of only
`r1[0]`, `r3=resolved_next_pc`, and the compiler's context-free IRQ handler.

- [ ] **Step 3: Update highlighting and snippets**

Replace old mnemonic lists or snippets with `cmp`, `cmpu`, `bz`, and `bnz`.
Leave unrelated syntax and snippets unchanged.

- [ ] **Step 4: Run software checks**

Run `npm test` and `git diff --check`.

Expected: software tests pass and the diff check exits zero.

### Task 6: Software-Only Completion Gate

**Files:**
- Verify only; do not modify RTL.

- [ ] **Step 1: Build TypeScript**

Run `npm run compile` in `merc32-vsce`; expect exit code zero.

- [ ] **Step 2: Run all software tests**

Run `npm test` in `merc32-vsce`; expect both test scripts to pass.

- [ ] **Step 3: Inspect generated assembly contracts**

Confirm tests reject `brc/brcu`, hidden-flag CMP, the IRQ context wrapper, and
implicit IRQ re-enable output.

- [ ] **Step 4: Stop at the RTL boundary**

Do not run `npm run test:c:rtl`, Icarus, VKS, or any RTL test. Record that RTL
integration is deferred until the project owner explicitly reports completion.

- [ ] **Step 5: Report the handoff**

Report software files changed, exact software test results, remaining RTL
dependency, and confirmation that this implementation did not modify RTL.
