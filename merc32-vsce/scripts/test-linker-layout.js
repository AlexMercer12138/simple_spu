const assert = require('assert');
const { linkObjects } = require('../out/linker');
const { resolveSymbols, layoutSections, LinkerError } = require('../out/linker/resolver');

const object = (sections, symbols, relocations = [], header = {}) => ({
  version: 1,
  target: 'merc32',
  abi: 'merc32-c-v1',
  sections,
  symbols,
  relocations,
  ...header,
});
const section = (name, alignment, size) => ({
  name,
  alignment,
  size,
  ...(name === 'bss' ? {} : { content: Array(name === 'text' ? size / 4 : size).fill(0) }),
});

const a = object(
  [section('text', 4, 4), section('rodata', 8, 3), section('data', 4, 2), section('bss', 8, 1)],
  [
    { name: 'main', binding: 'global', section: 'text', offset: 0, defined: true },
    { name: 'aData', binding: 'global', section: 'data', offset: 0, defined: true },
    { name: 'aBss', binding: 'global', section: 'bss', offset: 0, defined: true },
    { name: 'private', binding: 'local', section: 'text', offset: 0, defined: true },
  ],
);
const b = object(
  [section('text', 8, 8), section('data', 8, 3), section('bss', 4, 2)],
  [
    { name: 'helper', binding: 'global', section: 'text', offset: 4, defined: true },
    { name: 'bData', binding: 'global', section: 'data', offset: 0, defined: true },
    { name: 'bBss', binding: 'global', section: 'bss', offset: 0, defined: true },
    { name: 'private', binding: 'local', section: 'text', offset: 0, defined: true },
  ],
);

const resolved = resolveSymbols([a, b]);
const layout = layoutSections([a, b], { textBase: 0x20, dataBase: 0x100 });
assert.strictEqual(resolved.get('main').objectIndex, 0);
assert.strictEqual(resolved.has('private'), false, 'local names must not enter the external table');
assert.strictEqual(layout.sections.get('text:0'), 0x20);
assert.strictEqual(layout.sections.get('text:1'), 0x28);
assert.strictEqual(layout.sections.get('rodata:2'), 0x30);
assert.strictEqual(layout.sections.get('data:3'), 0x100);
assert.strictEqual(layout.sections.get('data:4'), 0x108);
assert.strictEqual(layout.sections.get('bss:5'), 0x110);
assert.strictEqual(layout.sections.get('bss:6'), 0x114);
assert.strictEqual(layout.symbols.get('helper'), 0x2c);
assert.strictEqual(layout.symbols.get('aData'), 0x100);
assert.strictEqual(layout.symbols.get('bData'), 0x108);
assert.strictEqual(layout.symbols.get('aBss'), 0x110);
assert.strictEqual(layout.symbols.get('bBss'), 0x114);
assert.strictEqual(layout.symbols.has('private'), false, 'local names must remain object-private');
assert.throws(() => layoutSections([a], { textBase: 0x20, dataBase: 0x20 }), /overlap/);

const malformedContent = object([{ name: 'text', alignment: 4, size: 4, content: [0, 0] }], []);
const malformedObjectError = error => error instanceof LinkerError && error.objectIndex === 0 && /size\/content/.test(error.message);
assert.throws(() => resolveSymbols([malformedContent]), malformedObjectError);
assert.throws(() => layoutSections([malformedContent]), malformedObjectError);

const malformedRelocation = object(
  [section('text', 4, 4)],
  [{ name: 'target', binding: 'global', section: 'text', offset: 0, defined: true }],
  [{ section: 'text', offset: 4, kind: 'CALL16', symbol: 'target', addend: 0, debug: { file: 'layout.masm', line: 3, column: 1 } }],
);
assert.throws(
  () => resolveSymbols([malformedRelocation]),
  error => error instanceof LinkerError && error.symbol === 'target' && error.objectIndex === 0 && error.section === 'text' && error.offset === 4 && error.debug.file === 'layout.masm',
);

const callerOnly = object(
  [section('text', 4, 4)],
  [{ name: 'foo', binding: 'global', defined: false }],
  [{ section: 'text', offset: 0, kind: 'CALL16', symbol: 'foo', addend: 0 }],
);
assert.throws(() => linkObjects([callerOnly]), /unresolved.*foo/);
assert.throws(() => resolveSymbols([a, a]), /duplicate.*main/);
assert.throws(() => resolveSymbols([a, object([], [], [], { abi: 'different-abi' })]), /abi mismatch/);
assert.throws(() => resolveSymbols([a, object([], [], [], { target: 'other-target' })]), /target mismatch/);
assert.throws(() => resolveSymbols([a, object([], [], [], { version: 2 })]), /version mismatch/);
assert.throws(
  () => resolveSymbols([object([section('text', 4, 4)], [{ name: 'pastEnd', binding: 'global', section: 'text', offset: 5, defined: true }])]),
  /outside section/,
);

const lastByteLayout = layoutSections([
  object([section('bss', 1, 1)], []),
], { textBase: 0xffffffff });
assert.strictEqual(lastByteLayout.sections.get('bss:0'), 0xffffffff);
assert.doesNotThrow(() => layoutSections([
  object([section('bss', 1, 0xffffffff)], []),
], { textBase: 1 }));

for (const options of [
  { textBase: 0x100000000 },
  { dataBase: 0x100000000 },
  { textBase: Number.MAX_SAFE_INTEGER + 1 },
]) {
  assert.throws(() => layoutSections([object([], [])], options), /invalid section base/);
}

assert.throws(
  () => layoutSections([object([section('bss', 1, 2)], [])], { textBase: 0xffffffff }),
  /section layout exceeds 32-bit address space/,
);
assert.throws(
  () => layoutSections([object([section('bss', 4, 0)], [])], { textBase: 0xffffffff }),
  /section layout exceeds 32-bit address space/,
);
assert.throws(
  () => layoutSections([object([{ name: 'bss', alignment: 1, size: Number.MAX_SAFE_INTEGER + 1 }], [])]),
  /invalid section size/,
);
assert.throws(
  () => layoutSections([
    object(
      [section('bss', 1, 1)],
      [{ name: 'pastAddressSpace', binding: 'global', section: 'bss', offset: 1, defined: true }],
    ),
  ], { textBase: 0xffffffff }),
  /symbol 'pastAddressSpace' address outside 32-bit address space/,
);

console.log('linker layout tests passed');
