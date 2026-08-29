# MERC32 SoC Generator Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a deterministic VSCode-independent engine that validates `*.merc32.json`, plans a SoC, emits self-contained Verilog-2005 and software scaffolding, and safely regenerates managed files.

**Architecture:** Source JSON and bundled catalog entries are parsed into explicit source types, semantically validated, then normalized into an immutable `SocPlan` using `bigint` for addresses. Focused emitters consume only `SocPlan`; a file manager stages output and enforces manifest ownership. Packaged RTL is prepared from catalog dependency allowlists before VSIX packaging and is opaque to the engine.

**Tech Stack:** TypeScript ES2020/CommonJS, Node.js, `ajv`, `jsonc-parser`, Verilog-2005, Icarus Verilog, Node `assert` tests.

**Spec:** `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`

## Global Constraints

- The generator core must not import `vscode`.
- Use `bigint` for normalized addresses and range arithmetic; emit addresses as
  eight-digit hexadecimal strings in JSON and Verilog literals in RTL.
- Fixed CPU regions are not source configuration fields.
- Preserve existing explicit addresses; auto-assignment writes concrete source
  addresses and never silently relocates an instance.
- Every generated RTL file must compile with `iverilog -g2005`.
- Catalog RTL is opaque; copy exact files and do not parse or transform them.
- A pre-existing `software/src/main.c` is always user-owned and skipped.
- Managed-file conflicts require explicit force; cross-configuration directory
  ownership requires explicit adoption and is not bypassed by force.

---

## File Structure

- Create `merc32-vsce/src/soc/model.ts`: source, catalog, diagnostic, and
  normalized plan types.
- Create `merc32-vsce/src/soc/address.ts`: unsigned parsing, formatting, ranges,
  alignment, and allocation.
- Create `merc32-vsce/src/soc/catalog.ts`: catalog load and public lookup.
- Create `merc32-vsce/src/soc/config.ts`: JSON parsing, schema validation, and
  source-node paths.
- Create `merc32-vsce/src/soc/validate.ts`: catalog-aware semantic rules.
- Create `merc32-vsce/src/soc/planner.ts`: immutable memory, endpoint, IRQ,
  port, and dependency plan.
- Create `merc32-vsce/src/soc/emitVerilog.ts`: top, PLB router, and N-way APB.
- Create `merc32-vsce/src/soc/emitSoftware.ts`: resolved JSON, address JSON,
  header, README, and starter main.
- Create `merc32-vsce/src/soc/fileManager.ts`: staging, hashes, ownership,
  conflicts, stale files, and adoption.
- Create `merc32-vsce/src/soc/generator.ts`: public orchestration API.
- Create `merc32-vsce/src/soc/index.ts`: stable public exports.
- Create catalog, schema, templates, fixtures, and test scripts under
  `merc32-vsce/resources` and `merc32-vsce/scripts`.

### Task 1: Define Source and Normalized Model Contracts

**Files:**
- Create: `merc32-vsce/src/soc/model.ts`
- Create: `merc32-vsce/src/soc/address.ts`
- Create: `merc32-vsce/src/soc/index.ts`
- Create: `merc32-vsce/scripts/test-soc-config.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `SocSourceConfig`, `ModuleCatalog`, `SocDiagnostic`, `SocPlan`,
  `SocJsonRange`, `SocSourceMap`, `parseU32`, `parseByteSize`, `formatHex32`,
  `rangeEnd`, and `alignUp`.

- [ ] **Step 1: Add failing unsigned-address tests**

```javascript
const {
    parseU32, parseByteSize, formatHex32, rangeEnd, alignUp,
} = require('../out/soc');

assert.strictEqual(parseU32('0xFFFFFFFF'), 0xffffffffn);
assert.strictEqual(parseByteSize('32KiB'), 32768n);
assert.strictEqual(parseByteSize('16MiB'), 16777216n);
assert.strictEqual(formatHex32(0x10000000n), '0x10000000');
assert.strictEqual(rangeEnd(0x10000000n, 4096n), 0x10000fffn);
assert.strictEqual(alignUp(0x10000001n, 4096n), 0x10001000n);
assert.throws(() => parseU32('0x100000000'), /32-bit unsigned/);
assert.throws(() => rangeEnd(0xfffff000n, 8192n), /overflows/);
```

Add `test:soc:config` and a composite `test:soc` script to `package.json`.

- [ ] **Step 2: Verify missing-module failure**

```powershell
Set-Location merc32-vsce
npm run test:soc:config
```

Expected: FAIL because `out/soc` does not exist.

- [ ] **Step 3: Define exact source and plan types**

Use discriminated unions:

```typescript
export type MemorySource =
    | { type: 'internal_ram'; size: number | string; initFile?: string }
    | { type: 'external_local_bus'; size: number | string };

export interface ProjectSource {
    name: string;
    outputDir: string;
}

export interface CpuSource {
    debug?: boolean;
    jtagIdCode?: string;
}

export interface PeripheralSource {
    type: string;
    name: string;
    baseAddress?: string;
    parameters?: Record<string, number | string | boolean>;
}

export interface ExternalInterfaceSource {
    type: 'local_bus' | 'apb' | 'axi4_lite' | 'wishbone' | 'avalon' | 'drp';
    name: string;
    baseAddress?: string;
    windowSize: number | string;
    addressWidth: number;
    parameters?: Record<string, number | string | boolean>;
}

export type InterruptTrigger = 'high' | 'low' | 'rising' | 'falling';

export interface ControllerInterruptSource {
    source: string;
    id: number;
    trigger: InterruptTrigger;
}

export type InterruptSource =
    | { mode: 'none' }
    | { mode: 'direct'; source: string }
    | {
        mode: 'controller';
        controller: string;
        sources: readonly ControllerInterruptSource[];
    };

export interface SocSourceConfig {
    schemaVersion: 1;
    project: ProjectSource;
    cpu: CpuSource;
    memory: { ilb: MemorySource; dlb: MemorySource };
    peripherals: readonly PeripheralSource[];
    externalInterfaces: readonly ExternalInterfaceSource[];
    interrupt: InterruptSource;
}

export interface SocDiagnostic {
    severity: 'error' | 'warning';
    code: string;
    path: readonly (string | number)[];
    message: string;
}

export interface SocJsonRange {
    offset: number;
    length: number;
}

export interface SocSourceMap {
    rangeFor(path: readonly (string | number)[]): SocJsonRange | undefined;
}

export type CatalogParameterType =
    | 'integer' | 'boolean' | 'string' | 'enum' | 'powerOfTwo';

export interface CatalogParameter {
    type: CatalogParameterType;
    default: number | string | boolean;
    minimum?: number;
    maximum?: number;
    values?: readonly (number | string | boolean)[];
}

export interface CatalogPort {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number | { parameter: string };
}

export interface ModuleDescriptor {
    type: string;
    module: string;
    rtlFiles: readonly string[];
    multiple: boolean;
    addressSize: number;
    alignment: number;
    parameters: Readonly<Record<string, CatalogParameter>>;
    ports: readonly CatalogPort[];
    interrupts: readonly string[];
}

export interface ProtocolDescriptor {
    type: ExternalInterfaceSource['type'];
    rtlFiles: readonly string[];
    alignment: number;
    addressWidthParameter?: string;
    ports: readonly CatalogPort[];
}

export interface ModuleCatalog {
    modules: ReadonlyMap<string, ModuleDescriptor>;
    protocols: ReadonlyMap<string, ProtocolDescriptor>;
}

export interface PlannedPort {
    name: string;
    direction: 'input' | 'output' | 'inout';
    width: number;
}

export interface PlannedMemory {
    type: MemorySource['type'];
    sizeBytes: bigint;
    wordAddressWidth: number;
    initFile?: { source: string; outputName: string };
}

export interface PlannedRange {
    name: string;
    type: string;
    baseAddress: bigint;
    sizeBytes: bigint;
    endAddress: bigint;
    sourcePath: readonly (string | number)[];
}

export interface PlannedPeripheral extends PlannedRange {
    kind: 'peripheral';
    module: string;
    parameters: Readonly<Record<string, number | string | boolean>>;
    ports: readonly PlannedPort[];
    interrupts: readonly string[];
}

export interface PlannedExternalInterface extends PlannedRange {
    kind: 'external';
    addressWidth: number;
    parameters: Readonly<Record<string, number | string | boolean>>;
    ports: readonly PlannedPort[];
}

export interface PlannedInterruptSource {
    source: string;
    topPort?: string;
    id?: number;
    trigger?: InterruptTrigger;
}

export type PlannedInterrupt =
    | { mode: 'none'; sources: readonly [] }
    | { mode: 'direct'; sources: readonly [PlannedInterruptSource] }
    | {
        mode: 'controller';
        controller: string;
        irqCount: number;
        irqMode: bigint;
        sources: readonly PlannedInterruptSource[];
    };

export interface SocPlan {
    sourceFile: string;
    projectName: string;
    outputDir: string;
    topModule: string;
    cpu: { debug: boolean; jtagIdCode: bigint };
    memory: { ilb: PlannedMemory; dlb: PlannedMemory };
    peripherals: readonly PlannedPeripheral[];
    externalInterfaces: readonly PlannedExternalInterface[];
    endpoints: readonly (PlannedPeripheral | PlannedExternalInterface)[];
    topPorts: readonly PlannedPort[];
    interrupt: PlannedInterrupt;
    rtlFiles: readonly string[];
}
```

Use `external.<identifier>` as the only top-level external interrupt reference;
it emits an `external_<identifier>` input port. Reject all other unresolved
source strings. Emitters must not consult source JSON or catalog after planning.

- [ ] **Step 4: Implement strict unsigned helpers**

Accept decimal integer bytes or case-insensitive `KiB`/`MiB` strings. Reject
fractional, negative, unsafe numeric, zero-size, and unsupported-unit inputs.
Do not use bitwise JavaScript operators for address arithmetic.

- [ ] **Step 5: Run tests and commit the contracts**

```powershell
npm run test:soc:config
git add -- src/soc scripts/test-soc-config.js package.json
git commit -m "feat: define MERC32 SoC generator model"
```

### Task 2: Build the Opaque Module and Protocol Catalog

**Files:**
- Create: `merc32-vsce/resources/catalog/modules/*.json`
- Create: `merc32-vsce/resources/catalog/protocols.json`
- Create: `merc32-vsce/src/soc/catalog.ts`
- Modify: `merc32-vsce/scripts/test-soc-config.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `loadCatalog(assetRoot: string): ModuleCatalog` and
  `getModule(type)`, `getProtocol(type)` lookups.

- [ ] **Step 1: Add catalog tests for every built-in type**

Assert the catalog contains exactly these initial peripheral types:

```javascript
const expected = [
    'apb_can', 'apb_gpio', 'apb_i2c', 'apb_intc',
    'apb_qspi', 'apb_sdio', 'apb_timer', 'apb_uart',
];
assert.deepStrictEqual([...catalog.modules.keys()].sort(), expected);
assert.strictEqual(catalog.modules.get('apb_qspi').ports
    .find((port) => port.name === 'qspi_cs_n').width.parameter, 'CS_COUNT');
assert.deepStrictEqual(catalog.modules.get('apb_uart').rtlFiles,
    ['rtl/apb_uart/apb_uart.v']);
```

Test duplicate type, duplicate port, missing RTL path, invalid parameter default,
and unknown dynamic-width parameter failures.

- [ ] **Step 2: Create one committed JSON descriptor per APB module**

Use 4 KiB address size/alignment for the initial APB modules. Record these exact
public parameters and physical ports:

- `apb_uart`: `SYS_CLK_FREQ`, `FIFO_DEPTH`; `uart_rx`, `uart_tx`; interrupt.
- `apb_gpio`: no parameters; 32-bit `gpio_i`, `gpio_o`, `gpio_t`; interrupt.
- `apb_timer`: no parameters; `pwm0`, `pwm1`; interrupt.
- `apb_i2c`: `SYS_CLK_FREQ`, `FIFO_DEPTH`; `scl_o/t/i`, `sda_o/t/i`; interrupt.
- `apb_qspi`: `CS_COUNT`, `FIFO_DEPTH`; SCLK, dynamic CS, four DQ i/o/t sets;
  interrupt.
- `apb_sdio`: `FIFO_DEPTH`; SD clock/cmd/data, card detect, write protect, eMMC
  reset, and DMA handshake/data ports; interrupt.
- `apb_can`: `SYS_CLK_FREQ`, `DEFAULT_BIT_RATE`, `TX_FIFO_DEPTH`,
  `RX_FIFO_DEPTH`; `can_rx`, `can_tx`; interrupt.
- `apb_intc`: generator-owned wiring, `IRQ_COUNT`, `IRQ_MODE`, no physical pins,
  and one CPU interrupt output role.

Power-of-two FIFO constraints must match existing RTL expectations. Set
`multiple: false` only for `apb_intc`; all ordinary peripherals allow multiple
instances.

- [ ] **Step 3: Define bridge protocol descriptors**

Record exact packaged bridge files and parameter mappings for Local Bus, APB,
AXI4-Lite, Wishbone, Avalon, and DRP. Each descriptor defines its external port
suffixes, directions, widths, and the bridge address-width parameter. Local Bus
is a direct endpoint with no bridge file.

- [ ] **Step 4: Implement catalog structural validation**

Parse JSON with explicit runtime guards. Return immutable maps and reject extra
unknown catalog fields. Resolve only logical asset-relative paths; reject
absolute paths and `..` traversal.

- [ ] **Step 5: Run and commit catalog tests**

```powershell
npm run test:soc:config
git add -- resources/catalog src/soc/catalog.ts scripts/test-soc-config.js package.json
git commit -m "feat: catalog MERC32 SoC modules and bridges"
```

### Task 3: Parse, Validate, and Auto-Assign `*.merc32.json`

**Files:**
- Create: `merc32-vsce/src/soc/config.ts`
- Create: `merc32-vsce/src/soc/validate.ts`
- Create: `merc32-vsce/src/soc/schema.ts`
- Create: `merc32-vsce/resources/schema/merc32.schema.json`
- Create: `merc32-vsce/scripts/fixtures/soc/minimal.merc32.json`
- Create: `merc32-vsce/scripts/fixtures/soc/multi-peripheral.merc32.json`
- Modify: `merc32-vsce/src/soc/address.ts`
- Modify: `merc32-vsce/scripts/test-soc-config.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces:

```typescript
export interface ParseSocResult {
    config?: SocSourceConfig;
    sourceMap: SocSourceMap;
    diagnostics: readonly SocDiagnostic[];
}

export interface AddressAssignment {
    path: readonly (string | number)[];
    address: string;
}

export interface AddressAssignmentResult {
    config: SocSourceConfig;
    assignments: readonly AddressAssignment[];
    diagnostics: readonly SocDiagnostic[];
}

export function parseSocConfig(
    text: string,
    file: string,
    catalog: ModuleCatalog,
): ParseSocResult;

export function validateSocConfig(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): readonly SocDiagnostic[];

export function assignMissingAddresses(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): AddressAssignmentResult;

export function generateSocSchema(catalog: ModuleCatalog): object;
```

- [ ] **Step 1: Add fixture and diagnostic-path tests**

The minimal fixture uses external ILB/DLB, no peripherals, no interrupts. The
multi fixture uses two UARTs, GPIO, INTC, a 12-bit APB endpoint, and a 32-bit AXI
endpoint. Add invalid cases and assert exact diagnostic codes and paths:

```javascript
assertDiagnostic(overlap, 'SOC_ADDRESS_OVERLAP', ['peripherals', 1, 'baseAddress']);
assertDiagnostic(badName, 'SOC_IDENTIFIER', ['peripherals', 0, 'name']);
assertDiagnostic(badIrq, 'SOC_IRQ_SOURCE', ['interrupt', 'sources', 0, 'source']);
assertDiagnostic(badWidth, 'SOC_ENDPOINT_WIDTH', ['externalInterfaces', 0, 'addressWidth']);
```

- [ ] **Step 2: Add `ajv` and `jsonc-parser` runtime dependencies**

```powershell
Set-Location merc32-vsce
npm install ajv@^8.17.1 jsonc-parser@^3.3.1
```

Commit `package-lock.json` from this point onward because runtime dependencies
must be reproducible; remove its current `.gitignore` entry in the same change.

- [ ] **Step 3: Generate the schema and implement JSON parsing**

Implement `generateSocSchema` from catalog parameter definitions and protocol
types, with `additionalProperties: false` at every closed object. Write the
sorted result to `resources/schema/merc32.schema.json` and make the test compare
the committed file byte-for-byte with freshly generated JSON. Use `jsonc-parser`
only for syntax nodes and source paths; reject comments and trailing commas so
the file remains standard JSON. Compile the generated schema with Ajv and
convert every Ajv `instancePath` to `(string | number)[]`.

- [ ] **Step 4: Implement all semantic rules**

Validate names, uniqueness, project output, memory power-of-two sizes and max
25-bit word width, catalog parameters, top-port collisions, endpoint alignment,
unsigned range overflow, PLB containment, overlap, INTC count, direct source
count, source references, IDs 0..31, unique IDs, and trigger names. A source is
valid only as `<instance>.<catalogInterrupt>` or `external.<identifier>`; derive
and collision-check the latter's `external_<identifier>` top input. Emit warnings
for unconnected ordinary peripheral interrupts and sparse address holes.

- [ ] **Step 5: Implement explicit-only auto-assignment**

Copy the source config, visit missing addresses in source-array order, and find
the lowest free aligned PLB range. Built-ins use catalog alignment; external
ports below 32 bits use `2^addressWidth`; 32-bit ports use the protocol alignment.
Return the normalized hexadecimal path/value assignments and a cloned config
containing those values without mutating the input. If existing semantic errors
make allocation unsafe, return no assignments and include those diagnostics.

- [ ] **Step 6: Run and commit config behavior**

```powershell
npm run test:soc:config
git add -- .gitignore merc32-vsce/package.json merc32-vsce/package-lock.json merc32-vsce/resources/schema merc32-vsce/scripts/fixtures merc32-vsce/scripts/test-soc-config.js merc32-vsce/src/soc
git commit -m "feat: validate MERC32 SoC configurations"
```

### Task 4: Plan a Complete Immutable SoC

**Files:**
- Create: `merc32-vsce/src/soc/planner.ts`
- Modify: `merc32-vsce/src/soc/model.ts`
- Modify: `merc32-vsce/scripts/test-soc-config.js`

**Interfaces:**
- Produces:

```typescript
export interface SocPlanResult {
    plan?: SocPlan;
    diagnostics: readonly SocDiagnostic[];
}

export function planSoc(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): SocPlanResult;
```

`plan` is absent when diagnostics contain an error; a present plan has no source
defaults left unresolved. Warnings remain in `diagnostics`.

- [ ] **Step 1: Add normalized-plan assertions**

For the multi fixture, assign known IDs `0` through `3` the trigger modes high,
low, rising, and falling, respectively, then assert:

```javascript
assert.deepStrictEqual(plan.endpoints.map((item) => item.name),
    ['uart0', 'uart1', 'gpio0', 'intc0', 'apb_ext0', 'axi0']);
assert.strictEqual(plan.endpoints[0].baseAddress, 0x10000000n);
assert.strictEqual(plan.externalInterfaces.find((x) => x.name === 'apb_ext0').addressWidth, 12);
assert.deepStrictEqual(plan.interrupt.sources.map((x) => [x.id, x.source]), [
    [0, 'uart0.interrupt'], [1, 'uart1.interrupt'], [2, 'gpio0.interrupt'],
    [3, 'external.wake'],
]);
assert.deepStrictEqual(plan.interrupt.sources.map((x) => [x.id, x.trigger]), [
    [0, 'high'], [1, 'low'], [2, 'rising'], [3, 'falling'],
]);
assert.strictEqual(plan.interrupt.irqMode & 0xffn, 0xe4n);
assert.ok(plan.rtlFiles.includes('rtl/apb_intc/apb_intc.v'));
```

Also assert generated physical port names and widths for QSPI and SDIO fixtures.

- [ ] **Step 2: Verify missing planner failure**

Run `npm run test:soc:config`. Expected: FAIL on `planSoc` import.

- [ ] **Step 3: Normalize defaults and derive memory plans**

Derive internal RAM word widths with `log2(sizeBytes / 4)`. Derive external
Local Bus port widths the same way. Resolve default debug/JTAG values and copy
init-file source paths relative to the config file.

- [ ] **Step 4: Derive endpoints, APB group, ports, IRQ, and dependency closure**

Sort endpoint decode order numerically by base address and dependencies
lexically by logical path. Build every top port in the plan, including dynamic
catalog widths and external protocol ports. For controller mode derive
`IRQ_COUNT = max(id) + 1` and pack two trigger bits per source into a 64-bit
Verilog parameter value.

- [ ] **Step 5: Freeze plan objects and commit**

Freeze arrays and objects before returning in development/tests. Then run:

```powershell
npm run test:soc:config
git add -- merc32-vsce/src/soc merc32-vsce/scripts/test-soc-config.js
git commit -m "feat: plan normalized MERC32 SoCs"
```

### Task 5: Emit Verilog-2005 SoC Glue

**Files:**
- Create: `merc32-vsce/src/soc/emitVerilog.ts`
- Create: `merc32-vsce/scripts/test-soc-generator.js`
- Create: `merc32-vsce/scripts/test-soc-rtl.js`
- Create: `merc32-vsce/scripts/fixtures/soc/all-peripherals.merc32.json`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces:
  - `renderSocTop(plan): string`
  - `renderPlbRouter(plan): string`
  - `renderApbInterconnect(plan): string | undefined`

- [ ] **Step 1: Add golden structural assertions**

Assert generated text includes:

```javascript
assert.match(top, /^module demo_soc\b/m);
assert.match(top, /MERC32_top #\(/);
assert.match(top, /apb_uart[^;]*uart0_inst/s);
assert.match(top, /\.AXI_ADDR_WIDTH\s*\(32\)/);
assert.match(top, /output wire \[11:0\] apb_ext0_m_apb_paddr/);
assert.match(router, /32'h2000_0000/);
assert.match(router, /active_endpoint/);
assert.doesNotMatch(top, /`ifdef IF_/);
```

For `interrupt.mode=none`, assert the CPU interrupt connection is `1'b0`; for
direct mode assert the exact source; for controller mode assert one INTC
instance and no second controller.

- [ ] **Step 2: Verify emitter imports fail**

Add `test:soc:generator` and run it. Expected: FAIL on missing emitter exports.

- [ ] **Step 3: Implement a small line-oriented Verilog writer**

Use an internal writer with `line`, `indent`, and `block` methods. Never produce
SystemVerilog arrays, `logic`, `always_comb`, interfaces, packages, or structs.
Use explicit scalar/vector wires and module ports.

- [ ] **Step 4: Emit the stateful PLB router**

Generate one localparam per endpoint, combinational decode for an idle request,
a registered active endpoint, one-cycle request forwarding, and response muxing
that remains on the active endpoint until ack. Unmapped requests set no target
and never acknowledge.

- [ ] **Step 5: Emit the N-way APB decoder and SoC top**

Generate one select and response pair per built-in peripheral. The top must
instantiate memories/ports independently, one shared built-in `lb2apb`, one
bridge per external endpoint, physical ports, optional external IRQ
synchronizers, and debug/JTAG tie-offs according to the plan.

- [ ] **Step 6: Add generated RTL matrix elaboration**

The Node script generates to unique temp directories and runs:

```javascript
spawnSync('iverilog', [
    '-Wall', '-Wno-timescale', '-g2005',
    '-s', fixture.topModule,
    '-o', path.join(tempDir, 'soc.vvp'),
    '-f', 'files.f',
], { cwd: path.join(outputDir, 'rtl'), encoding: 'utf8' });
```

Cover minimal external memory/no IRQ, internal memories, multi-instance APB,
controller mode, simultaneous protocols, 12/32-bit address ports, debug off,
and all bundled peripherals.

- [ ] **Step 7: Run and commit Verilog emitters**

```powershell
npm run test:soc:generator
npm run test:soc:rtl
git add -- merc32-vsce/src/soc/emitVerilog.ts merc32-vsce/scripts/test-soc-generator.js merc32-vsce/scripts/test-soc-rtl.js merc32-vsce/scripts/fixtures/soc merc32-vsce/package.json
git commit -m "feat: emit configurable MERC32 SoC RTL"
```

### Task 6: Emit Software, Metadata, and User-Owned `main.c`

**Files:**
- Create: `merc32-vsce/src/soc/emitSoftware.ts`
- Create: `merc32-vsce/resources/templates/main.c.tpl`
- Create: `merc32-vsce/resources/templates/README.md.tpl`
- Modify: `merc32-vsce/scripts/test-soc-generator.js`

**Interfaces:**
- Produces `renderResolvedConfig`, `renderAddressMap`, `renderSocHeader`,
  `renderGeneratedReadme`, and `renderStarterMain`.

- [ ] **Step 1: Add exact output assertions**

Assert header output contains include guards and only object macros:

```c
#ifndef DEMO_SOC_H
#define DEMO_SOC_H
#define DEMO_SOC_ILB_SIZE 32768
#define DEMO_SOC_DLB_BASE 0x08000000
#define DEMO_SOC_UART0_BASE 0x10000000
#define DEMO_SOC_UART0_IRQ 0
#define MERC32_IRQ_TRIGGER_HIGH 0
#define MERC32_IRQ_TRIGGER_LOW 1
#define MERC32_IRQ_TRIGGER_RISING 2
#define MERC32_IRQ_TRIGGER_FALLING 3
#define DEMO_SOC_UART0_IRQ_TRIGGER MERC32_IRQ_TRIGGER_HIGH
#endif
```

Assert `address-map.json` has normalized address strings and no Markdown map is
emitted. Compile starter `main.c` plus the header through the file-aware Tiny C
API and assembler.

- [ ] **Step 2: Implement deterministic JSON and C emission**

Write JSON with two-space indentation and trailing newline. Sort object keys
only in generated documents; preserve semantically meaningful array order. Use
uppercase sanitized project/instance identifiers in macros and reject collisions
during validation.

- [ ] **Step 3: Implement the minimal starter main template**

The generated file is exactly based on:

```c
#include "../include/{{HEADER_FILE}}"

int main(void) {
    while (1) {
    }
    return 0;
}
```

Do not add unconfigured peripheral initialization. Controller configurations may
include an empty named dispatch function only when the Tiny C interrupt function
contract is already public and tested; otherwise leave dispatch to Phase 2.

- [ ] **Step 4: Run and commit software emission**

```powershell
npm run test:soc:generator
npm run test:c:preprocessor
git add -- merc32-vsce/src/soc/emitSoftware.ts merc32-vsce/resources/templates merc32-vsce/scripts/test-soc-generator.js
git commit -m "feat: emit MERC32 SoC software scaffolding"
```

### Task 7: Implement Safe Staged Generation

**Files:**
- Create: `merc32-vsce/src/soc/fileManager.ts`
- Create: `merc32-vsce/src/soc/generator.ts`
- Modify: `merc32-vsce/src/soc/index.ts`
- Modify: `merc32-vsce/scripts/test-soc-generator.js`

**Interfaces:**
- Produces:

```typescript
export interface GenerateSocOptions {
    configFile: string;
    assetRoot: string;
    force?: boolean;
    adoptOutput?: boolean;
}

export interface GenerateSocResult {
    outputDir: string;
    manifestFile: string;
    files: readonly string[];
    warnings: readonly SocDiagnostic[];
    skippedUserFiles: readonly string[];
}

export interface SocFileConflict {
    path: string;
    reason: 'modified-managed' | 'modified-stale' | 'output-owned';
}

export class SocGenerationError extends Error {
    readonly diagnostics: readonly SocDiagnostic[];
    readonly conflicts: readonly SocFileConflict[];
}

export function generateSoc(options: GenerateSocOptions): GenerateSocResult;
```

- [ ] **Step 1: Add ownership and failure-injection tests**

Cover first generation, byte-identical regeneration, modified managed file,
force replacement, stale unchanged removal, stale modified preservation/conflict,
unmanaged file preservation, existing `main.c` content and timestamp,
cross-config output refusal, explicit adoption, missing asset, and a write failure
before activation leaving the old output intact.

- [ ] **Step 2: Implement SHA-256 manifest records**

Each managed record contains relative path, SHA-256, logical source, and kind.
Record project name, canonical source config path, generator version, and resource
revision. Record `main.c` as `scaffold/user-owned` without a managed hash.

- [ ] **Step 3: Implement sibling staging and narrow activation**

Create a unique sibling staging directory with `fs.mkdtempSync`, render/copy all
content, hash it, and verify files before target changes. During activation,
replace only managed paths, then remove only unchanged stale managed paths.
Always delete only the exact unique staging directory in `finally`.

- [ ] **Step 4: Implement conflict and ownership gates**

`force` bypasses modified-managed-file conflicts but never overwrites `main.c`.
`adoptOutput` updates source ownership only after every existing managed hash is
verified; it does not imply force. Throw `SocGenerationError` with structured
diagnostics and conflicts before writing any managed target when validation,
ownership, or conflict gates fail.

- [ ] **Step 5: Run deterministic and safety tests**

```powershell
npm run test:soc:generator
```

Expected: repeated output hashes match, and all negative cases leave sentinel
files unchanged.

- [ ] **Step 6: Commit generation orchestration**

```powershell
git add -- merc32-vsce/src/soc merc32-vsce/scripts/test-soc-generator.js
git commit -m "feat: safely generate self-contained MERC32 SoCs"
```

### Task 8: Prepare RTL Resources and Prove Checkout Independence

**Files:**
- Create: `merc32-vsce/scripts/prepare-resources.js`
- Create generated during build: `merc32-vsce/resources/rtl/**`
- Create generated during build: `merc32-vsce/resources/resource-manifest.json`
- Modify: `.gitignore`
- Modify: `merc32-vsce/.vscodeignore`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/scripts/test-soc-rtl.js`

**Interfaces:**
- Produces a packaged asset root accepted by `loadCatalog` and `generateSoc`.

- [ ] **Step 1: Add missing-resource and allowlist tests**

Assert preparation copies every transitive catalog file, CPU/debug/misc base
dependency, bridge file, catalog, schema, template, and license. Assert it copies
no `rtl/sim` file and fails when a catalog path has the wrong case.

- [ ] **Step 2: Implement resource preparation**

Resolve repository root from `__dirname`, load the committed catalog, regenerate
`resources/schema/merc32.schema.json` through `generateSocSchema`, create a
sorted allowlist, copy exact files into `resources/rtl`, and write SHA-256 plus
`git rev-parse HEAD` into `resource-manifest.json`. Remove and recreate only the
known generated resource directories, never the extension root.

- [ ] **Step 3: Wire build and package scripts**

Use:

```json
"prepare:resources": "node scripts/prepare-resources.js",
"vscode:prepublish": "npm run prepare:resources && npm run compile",
"test:soc": "npm run test:soc:config && node scripts/test-soc-generator.js && node scripts/test-soc-rtl.js"
```

Ignore generated `merc32-vsce/resources/rtl/` and resource manifest in Git, but
do not exclude them in `.vscodeignore`. Exclude test scripts/fixtures from the
VSIX after resource preparation.

- [ ] **Step 4: Run from packaged assets only**

Prepare resources, temporarily set the test engine's asset root to
`merc32-vsce/resources`, generate into a unique OS temp directory, and elaborate
from generated `rtl/files.f`. The test must not read repository-root `rtl` after
preparation.

- [ ] **Step 5: Run the complete headless suite**

```powershell
Set-Location merc32-vsce
npm run prepare:resources
npm run compile
npm run test:soc
npm test
npm run test:c:rtl
Set-Location ..
git diff --check
```

Expected: all suites pass and generated resource files are ignored but present.

- [ ] **Step 6: Commit resource packaging support**

```powershell
git add -- .gitignore merc32-vsce/.vscodeignore merc32-vsce/package.json merc32-vsce/package-lock.json merc32-vsce/scripts/prepare-resources.js merc32-vsce/scripts/test-soc-rtl.js
git commit -m "build: package MERC32 RTL generator resources"
```
