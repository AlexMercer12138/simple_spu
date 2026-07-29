# MERC32 Comparison, Branch, and Minimal IRQ Interface Design

## 1. Scope

This change replaces the flag-based `cmp` plus `brc/brcu` model with explicit
boolean comparison results and register-tested branches. It is intentionally
not binary-compatible or assembly-source-compatible with the old instructions.

The implementation responsibility is split as follows:

- The project owner updates the CPU RTL according to `TODO.md`.
- Codex updates the assembler, Tiny C compiler, software tests, and ISA/ABI
  documentation.
- Codex does not modify the CPU RTL during the software implementation.

The design does not add automatic interrupt context preservation, nested IRQ
handling, interrupt-source clearing, or an interrupt-return instruction.

## 2. Register and Interrupt Baseline

All `r1-r15` registers are software-readable and software-writable. This does
not change their architectural roles or make all of them general-purpose:

- `r0` remains the constant-zero register and ignores writes.
- `r1` remains the interrupt control register. Bit 0 is IRQ enable and bits
  2:1 select the trigger mode.
- `r2` remains the interrupt vector byte address.
- `r3` remains the interrupt link byte address.
- `r15` remains the program counter.

A normal instruction write to `r1`, `r2`, or `r3` updates that architectural
register. A normal instruction write to `r15` directly selects the written
value as the next PC; `r15` does not gain a second storage location separate
from the program counter.

The ABI and Tiny C compiler must continue to reserve `r1-r3` and `r15` for
their architectural roles. Software writes are allowed so low-level software
can save and restore special-register state.

When an IRQ is accepted at an instruction boundary, hardware performs only
these architectural operations:

1. `r3 = resolved_next_pc`.
2. `PC = r2`.
3. `r1[0] = 0`, while all other `r1` bits remain unchanged.

`resolved_next_pc` is the already-resolved next address of the completed
instruction. It is `PC + 4` for a sequential instruction, the jump target for
a jump, and the selected next address for `bz/bnz`.

Hardware does not track an active-IRQ state, recognize `jmp r3`, restore
registers, restore comparison state, or automatically re-enable IRQs.

## 3. Boolean Comparison Instructions

### 3.1 Assembly grammar

Signed comparisons use `cmp`; unsigned relational comparisons use `cmpu`:

```asm
cmp  rd, rs2 == rhs
cmp  rd, rs2 != rhs
cmp  rd, rs2 >= rhs
cmp  rd, rs2 <  rhs
cmp  rd, rs2 >  rhs
cmp  rd, rs2 <= rhs

cmpu rd, rs2 >= rhs
cmpu rd, rs2 <  rhs
cmpu rd, rs2 >  rhs
cmpu rd, rs2 <= rhs
```

The comparison expression's left operand must be a register. `rhs` may be a
register or a 16-bit immediate. `cmpu` also accepts `==` and `!=` as aliases
of the signed mnemonic because equality is independent of signedness.

Every instruction writes an exact 32-bit boolean:

```text
R[rd] = condition(R[rs2], rhs) ? 32'd1 : 32'd0
```

No comparison flags or hidden condition state exist.

### 3.2 Immediate semantics

The immediate field is sign-extended to 32 bits for every condition, including
unsigned comparisons. An unsigned comparison then interprets both resulting
32-bit operands as unsigned values. Therefore `-1` represents
`0xffffffff`; a positive unsigned value that does not fit signed 16 bits must
first be loaded into a register.

### 3.3 Encoding

Immediate comparisons use opcode `0x3`:

```text
31                16 15    12 11     8 7      4 3      0
+-------------------+--------+---------+--------+--------+
|      imm16        |  rs2   |   rd    |  0x3   |  cond  |
+-------------------+--------+---------+--------+--------+
```

Register comparisons use opcode `0x4`:

```text
31          20 19    16 15    12 11     8 7      4 3      0
+--------------+--------+--------+---------+--------+--------+
| reserved = 0 |  rs1   |  rs2   |   rd    |  0x4   |  cond  |
+--------------+--------+--------+---------+--------+--------+
```

Condition codes retain the old complementary pairing:

| Code | Condition | Code | Condition |
|---:|---|---:|---|
| `0` | EQ | `1` | NE |
| `2` | SGE | `3` | SLT |
| `4` | SGT | `5` | SLE |
| `6` | UGE | `7` | ULT |
| `8` | UGT | `9` | ULE |

Codes `0xa-0xf` are reserved.

## 4. Register-Tested Branch Instructions

### 4.1 Assembly grammar and behavior

```asm
bz  rd, rs2 + label
bnz rd, rs2 + label
bz  rd, rs2 + rs1
bnz rd, rs2 + rs1
```

`rd` is the value being tested. `rs2` is the target base. The immediate form
adds a label address or unsigned 16-bit immediate; the register form adds
`R[rs1]`. A direct label or register target uses `r0` explicitly:

```asm
bz  r5, r0 + done
bnz r6, r0 + r8
```

The semantics are:

```text
BZ:  next_pc = (R[rd] == 0) ? target : PC + 4
BNZ: next_pc = (R[rd] != 0) ? target : PC + 4
```

Immediate target:

```text
target = R[rs2] + zero_extend(imm16)
```

Register target:

```text
target = R[rs2] + R[rs1]
```

Labels resolve to absolute byte addresses, not PC-relative displacements.
Immediate targets accept only `0..65535`. When `rs2` is `r0`, the assembler
must require the absolute target to be four-byte aligned. With a nonzero base,
or with a register target, final alignment is a runtime software
responsibility. Misaligned targets have unspecified behavior and do not add
exception hardware.

### 4.2 Encoding

The instructions reuse the old `CMP/BRC` function slots:

| Opcode | Function | Target operand | Meaning |
|---:|---:|---|---|
| `0x1` | `0xb` | `zero_extend(imm16)` | BZ immediate |
| `0x2` | `0xb` | `R[rs1]` | BZ register |
| `0x1` | `0xc` | `zero_extend(imm16)` | BNZ immediate |
| `0x2` | `0xc` | `R[rs1]` | BNZ register |

Immediate form:

```text
31                16 15    12 11     8 7      4 3      0
+-------------------+--------+---------+--------+--------+
|      imm16        |  rs2   |   rd    | I=0x1  | B/C    |
+-------------------+--------+---------+--------+--------+
```

Register form:

```text
31          20 19    16 15    12 11     8 7      4 3      0
+--------------+--------+--------+---------+--------+--------+
| reserved = 0 |  rs1   |  rs2   |   rd    | R=0x2  | B/C    |
+--------------+--------+--------+---------+--------+--------+
```

## 5. Assembler Changes

The assembler must:

- Replace the old two-operand flag-setting `cmp` parser with the expression
  grammar in section 3.
- Add `cmpu` and map each operator to the condition table.
- Require a register on the comparison expression's left side.
- Accept a register or signed 16-bit immediate on the right side.
- Replace `brc/brcu` with `bz/bnz` and the target grammar in section 4.
- Resolve branch labels as absolute byte addresses and validate unsigned
  16-bit range and alignment.
- Emit opcodes `0x3/0x4` for comparisons and function codes `0xb/0xc` for
  branches.
- Reject old `cmp ra, rb`, `brc`, and `brcu` syntax with clear diagnostics.

## 6. Tiny C Code Generation

### 6.1 Comparison values

A C relational expression emits one boolean comparison after its two operands
have been evaluated:

```c
result = lhs < rhs;
```

```asm
cmp result_reg, lhs_reg < rhs_reg
```

Pointer and unsigned-integer relational comparisons use `cmpu`; signed integer
comparisons use `cmp`. Equality may use `cmp` for every type.

The compiler removes the old comparison diamond that loaded zero, branched on
hidden flags, loaded one, and joined at an end label.

### 6.2 Control flow

Generic truth tests branch directly on the expression result:

```asm
bz  value_reg, r0 + false_label
bnz value_reg, r0 + true_label
```

`if`, loops, unary `!`, and short-circuit `&&/||` must use `bz/bnz`. No compiler
output may contain `brc` or `brcu`.

### 6.3 Minimal interrupt function

Tiny C retains one optional special function:

```c
void __irq_handler(void);
```

It must return `void`, accept no parameters, and have a definition. When it is
present:

- Reset startup sets `r2` to byte address `4`.
- Address `4` contains a single jump from `__irq_vector` to
  `__irq_handler`.
- The handler keeps the normal Tiny C function prologue and epilogue needed
  for its own stack frame.
- Its final return is `jmp r3` instead of `jmp r14`.
- The compiler does not add an IRQ context frame, save foreground registers,
  clear a peripheral source, suppress nesting, or re-enable IRQs.

`__irq_enable()` and `__irq_disable()` remain available. The user decides if
and when to call them. Repeated interrupts, nested interrupts, context
corruption, and failure to clear a level-triggered source are explicitly
software responsibilities.

## 7. Validation

Assembler tests must cover:

- Exact encodings for all ten conditions in immediate and register forms.
- Signed immediate boundaries and sign extension behavior.
- `cmp/cmpu` operator parsing and invalid operand diagnostics.
- Exact encodings for BZ and BNZ with label, unsigned immediate, and register
  targets.
- Label range and alignment errors.
- Explicit rejection of removed syntax.

Compiler tests must cover:

- All signed, unsigned, equality, and pointer relations.
- Direct `0/1` comparison values without hidden-flag control-flow diamonds.
- `if`, loops, `!`, `&&`, and `||` lowering through `bz/bnz`.
- The minimal IRQ vector and `jmp r3` handler return.
- Absence of automatic IRQ context save and automatic re-enable code.

After the owner completes the RTL changes, integration verification must run:

1. The full assembler and compiler suite.
2. Tiny C CPU RTL execution tests.
3. Tiny C UART RTL execution tests.
4. A minimal IRQ test that verifies vectoring through `r2`, executing
   `__irq_handler`, and returning through `r3` without assuming automatic
   context preservation.
