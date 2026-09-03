const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SimpleCPUAssembler } = require('../out/assembler');
const {
  applyRelocations,
  layoutSections,
  linkFiles,
  linkObjects,
  LinkerError,
  relaxControlFlow,
  serializeObject,
} = require('../out/linker');

const object = (sections, symbols, relocations = []) => ({
  version: 1,
  target: 'merc32',
  abi: 'merc32-c-v1',
  sections,
  symbols,
  relocations,
});

const section = (name, content, alignment = name === 'text' ? 4 : 1, extra = {}) => ({
  name,
  alignment,
  size: name === 'text' ? content.length * 4 : content.length,
  content,
  ...extra,
});

const findSection = (linked, objectIndex, name) => linked.sections.find(
  candidate => candidate.objectIndex === objectIndex && candidate.name === name,
);

// ABS32 must patch the complete little-endian byte field using a local definition.
{
  const input = object(
    [section('text', [0]), section('data', [0, 0, 0, 0])],
    [{ name: 'localData', binding: 'local', section: 'data', offset: 0, defined: true }],
    [{ section: 'data', offset: 0, kind: 'ABS32', symbol: 'localData', addend: 4 }],
  );
  const linked = applyRelocations(layoutSections([input], { dataBase: 0x12340000 }));
  assert.deepStrictEqual(findSection(linked, 0, 'data').content, [0x04, 0x00, 0x34, 0x12]);
  assert.strictEqual(linked.relocationsApplied, 1);
}

// HI16 applies the addend before selecting the upper half of the address.
{
  const input = object(
    [section('text', [0]), section('data', [0, 0])],
    [{ name: 'target', binding: 'local', section: 'data', offset: 0, defined: true }],
    [{ section: 'data', offset: 0, kind: 'HI16', symbol: 'target', addend: 0x20 }],
  );
  const linked = applyRelocations(layoutSections([input], { dataBase: 0x1234fff0 }));
  assert.deepStrictEqual(findSection(linked, 0, 'data').content, [0x35, 0x12]);
}

// LO16 applies the addend before selecting the lower half of the address.
{
  const input = object(
    [section('text', [0]), section('data', [0, 0])],
    [{ name: 'target', binding: 'local', section: 'data', offset: 0, defined: true }],
    [{ section: 'data', offset: 0, kind: 'LO16', symbol: 'target', addend: 0x20 }],
  );
  const linked = applyRelocations(layoutSections([input], { dataBase: 0x1234fff0 }));
  assert.deepStrictEqual(findSection(linked, 0, 'data').content, [0x10, 0x00]);
}

// IMM16 patches only the instruction's upper field and preserves its low half.
{
  const caller = object(
    [section('text', [0x00000501])],
    [{ name: 'target', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind: 'IMM16', symbol: 'target', addend: 5 }],
  );
  const callee = object(
    [section('data', [0, 0, 0, 0])],
    [{ name: 'target', binding: 'global', section: 'data', offset: 2, defined: true }],
  );
  const linked = applyRelocations(layoutSections([caller, callee], { dataBase: 0x4560 }));
  assert.strictEqual(findSection(linked, 0, 'text').content[0] >>> 0, 0x45670501);
}

// CALL16 encodes an aligned absolute unsigned byte target into JAL's imm16 field.
{
  const caller = object(
    [section('text', [0x00000e2c])],
    [{ name: 'callee', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'callee', addend: 4 }],
  );
  const callee = object(
    [section('text', [0x00000e2c])],
    [{ name: 'callee', binding: 'global', section: 'text', offset: 0, defined: true }],
  );
  const linked = applyRelocations(layoutSections([caller, callee]));
  assert.strictEqual(findSection(linked, 0, 'text').content[0] >>> 0, 0x00080e2c);
}

// BRANCH16 uses the same absolute r0 + imm16 addressing rule as the ISA.
{
  const caller = object(
    [section('text', [0x0000042a])],
    [{ name: 'taken', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind: 'BRANCH16', symbol: 'taken', addend: 0 }],
  );
  const target = object(
    [section('text', [0x00000e2c])],
    [{ name: 'taken', binding: 'global', section: 'text', offset: 0, defined: true }],
  );
  const linked = applyRelocations(layoutSections([caller, target], { textBase: 0x20 }));
  assert.strictEqual(findSection(linked, 0, 'text').content[0] >>> 0, 0x0024042a);
}

// Far direct calls keep their fixed width and fail with complete relocation context.
{
  const debug = { file: 'far-call.masm', line: 7, column: 3 };
  const caller = object(
    [section('text', [0x00000e2c])],
    [{ name: 'farTarget', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'farTarget', addend: 0, debug }],
  );
  const target = object(
    [section('data', [0])],
    [{ name: 'farTarget', binding: 'global', section: 'data', offset: 0, defined: true }],
  );
  assert.throws(
    () => applyRelocations(layoutSections([caller, target], { dataBase: 0x10000 })),
    error => error instanceof LinkerError &&
      error.message === "CALL16 relocation 'farTarget' target out of range: 65536" &&
      error.symbol === 'farTarget' && error.objectIndex === 0 &&
      error.section === 'text' && error.offset === 0 && error.debug === debug,
  );
}

// Far direct branches also reject overflow instead of expanding the section.
{
  const caller = object(
    [section('text', [0x0000042a])],
    [{ name: 'farTarget', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind: 'BRANCH16', symbol: 'farTarget', addend: 0 }],
  );
  const target = object(
    [section('data', [0])],
    [{ name: 'farTarget', binding: 'global', section: 'data', offset: 0, defined: true }],
  );
  assert.throws(
    () => applyRelocations(layoutSections([caller, target], { dataBase: 0x10000 })),
    error => error instanceof LinkerError &&
      error.message === "BRANCH16 relocation 'farTarget' target out of range: 65536" &&
      error.symbol === 'farTarget' && error.objectIndex === 0 &&
      error.section === 'text' && error.offset === 0,
  );
}

// Direct control-flow relocations require aligned byte addresses.
for (const [kind, word] of [['CALL16', 0x00000e2c], ['BRANCH16', 0x0000042a]]) {
  const caller = object(
    [section('text', [word])],
    [{ name: 'misaligned', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind, symbol: 'misaligned', addend: 0 }],
  );
  const target = object(
    [section('data', [0])],
    [{ name: 'misaligned', binding: 'global', section: 'data', offset: 0, defined: true }],
  );
  assert.throws(
    () => applyRelocations(layoutSections([caller, target], { dataBase: 6 })),
    error => error instanceof LinkerError &&
      error.message === `${kind} relocation 'misaligned' target is not 4-byte aligned: 6`,
  );
}

// The fixed-width direct form is valid only when the encoded base is r0.
for (const [kind, word] of [['CALL16', 0x00002e2c], ['BRANCH16', 0x0000242a]]) {
  const caller = object(
    [section('text', [word])],
    [{ name: 'target', binding: 'global', defined: false }],
    [{ section: 'text', offset: 0, kind, symbol: 'target', addend: 0 }],
  );
  const target = object(
    [section('text', [0x00000e2c])],
    [{ name: 'target', binding: 'global', section: 'text', offset: 0, defined: true }],
  );
  assert.throws(
    () => applyRelocations(layoutSections([caller, target])),
    error => error instanceof LinkerError && error.message === `${kind} relocation 'target' requires r0 base`,
  );
}

// linkObjects returns a patched image and resolves the requested entry point.
{
  const caller = object(
    [section('text', [0x00000e2c], 4, { source: 'start:\n  jmp helper, r14\n' })],
    [
      { name: 'start', binding: 'global', section: 'text', offset: 0, defined: true },
      { name: 'helper', binding: 'global', defined: false },
    ],
    [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'helper', addend: 0 }],
  );
  const callee = object(
    [section('text', [0x000e003c], 4, { source: 'helper:\n  jmp r14\n' })],
    [{ name: 'helper', binding: 'global', section: 'text', offset: 0, defined: true }],
  );
  const image = linkObjects([caller, callee], { textBase: 0x20, entrySymbol: 'start' });
  assert.deepStrictEqual(image.machineCodes.map(word => word >>> 0), [0x00240e2c, 0x000e003c]);
  assert.strictEqual(image.entryAddress, image.symbols.get('start'));
  assert.strictEqual(image.entryAddress, 0x20);
  assert.match(image.assembly, /start:/);
  assert.match(image.assembly, /helper:/);
  assert.match(image.assembly, /jmp 0x24, r14/);
  assert.deepStrictEqual(
    new SimpleCPUAssembler().assemble(image.assembly).machineCodes.map(word => word >>> 0),
    image.machineCodes.map(word => word >>> 0),
  );
}

// A requested entry point is mandatory, not an optional lookup hint.
{
  const input = object(
    [section('text', [0x00000e2c])],
    [{ name: 'start', binding: 'global', section: 'text', offset: 0, defined: true }],
  );
  assert.throws(
    () => linkObjects([input], { entrySymbol: 'missing' }),
    error => error instanceof LinkerError &&
      error.message === "entry symbol 'missing' not found" && error.symbol === 'missing',
  );
}

// linkFiles consumes serialized object paths and forwards link options.
{
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'merc32-linker-'));
  try {
    const caller = object(
      [section('text', [0x00000e2c])],
      [
        { name: 'start', binding: 'global', section: 'text', offset: 0, defined: true },
        { name: 'helper', binding: 'global', defined: false },
      ],
      [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'helper', addend: 0 }],
    );
    const callee = object(
      [section('text', [0x000e003c])],
      [{ name: 'helper', binding: 'global', section: 'text', offset: 0, defined: true }],
    );
    const files = [path.join(tempRoot, 'caller.mobj'), path.join(tempRoot, 'callee.mobj')];
    fs.writeFileSync(files[0], serializeObject(caller), 'utf8');
    fs.writeFileSync(files[1], serializeObject(callee), 'utf8');
    const image = linkFiles(files, { textBase: 0x40, entrySymbol: 'start' });
    assert.deepStrictEqual(image.machineCodes.map(word => word >>> 0), [0x00440e2c, 0x000e003c]);
    assert.strictEqual(image.entryAddress, 0x40);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

// Full-address relocation kinds reject values outside the unsigned 32-bit domain.
for (const [kind, bytes] of [['ABS32', [0, 0, 0, 0]], ['HI16', [0, 0]], ['LO16', [0, 0]]]) {
  const input = object(
    [section('text', [0]), section('data', bytes)],
    [{ name: 'zero', binding: 'local', section: 'text', offset: 0, defined: true }],
    [{ section: 'data', offset: 0, kind, symbol: 'zero', addend: 0x100000000 }],
  );
  assert.throws(
    () => applyRelocations(layoutSections([input])),
    error => error instanceof LinkerError &&
      error.message === `${kind} relocation 'zero' value out of range: 4294967296`,
  );
}

// IMM16 rejects values that do not fit its unsigned field.
{
  const input = object(
    [section('text', [0x00000501])],
    [{ name: 'zero', binding: 'local', section: 'text', offset: 0, defined: true }],
    [{ section: 'text', offset: 0, kind: 'IMM16', symbol: 'zero', addend: 0x10000 }],
  );
  assert.throws(
    () => applyRelocations(layoutSections([input])),
    error => error instanceof LinkerError &&
      error.message === "IMM16 relocation 'zero' value out of range: 65536",
  );
}

// ABS32 in text replaces one complete word at the byte-relative instruction offset.
{
  const input = object(
    [section('text', [0, 0xfeedbeef])],
    [{ name: 'target', binding: 'local', section: 'text', offset: 4, defined: true }],
    [{ section: 'text', offset: 0, kind: 'ABS32', symbol: 'target', addend: 0x12340000 }],
  );
  const linked = applyRelocations(layoutSections([input]));
  assert.deepStrictEqual(findSection(linked, 0, 'text').content.map(word => word >>> 0), [0x12340004, 0xfeedbeef]);
}

// Patched assembly uses raw-bit syntax for IMM16 values above signed decimal range.
{
  const caller = object(
    [section('text', [0x00000400], 4, { source: 'start:\n  mov r4, target\n' })],
    [
      { name: 'start', binding: 'global', section: 'text', offset: 0, defined: true },
      { name: 'target', binding: 'global', defined: false },
    ],
    [{ section: 'text', offset: 0, kind: 'IMM16', symbol: 'target', addend: 0 }],
  );
  const target = object(
    [section('data', [0])],
    [{ name: 'target', binding: 'global', section: 'data', offset: 0, defined: true }],
  );
  const image = linkObjects([caller, target], { dataBase: 0x8000 });
  assert.match(image.assembly, /mov r4, 0x8000/);
  assert.deepStrictEqual(
    new SimpleCPUAssembler().assemble(image.assembly).machineCodes.map(word => word >>> 0),
    image.machineCodes.map(word => word >>> 0),
  );
}

const records = relaxControlFlow([{ opcode: 'jmp', target: 'far', address: 0 }], new Map([['far', 0x100000]]));
assert.strictEqual(records[0].opcode, 'long-jmp');
console.log('linker relocation tests passed');
