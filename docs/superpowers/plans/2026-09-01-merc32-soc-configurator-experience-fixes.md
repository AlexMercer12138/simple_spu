# MERC32 SoC Configurator Experience Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the version-1 JSON schema unchanged while making address ranges, interrupt-controller configuration, fixed-unit inputs, external IRQ pins, and generated SoC top configuration unambiguous.

**Architecture:** Preserve `windowSize` and the existing `apb_intc` peripheral record as the persisted/headless model, but make the editor host derive high-address presentation and own controller lifecycle through atomic multi-path JSON edits. Keep the Webview presentation-only, derive external IRQ pin names in the planner from route occurrence order, and write RAM initialization paths directly into child instances so the generated project top has no public parameters.

**Tech Stack:** TypeScript 6, VS Code custom text editor API, JSONC structured edits, browser JavaScript/CSS, Node.js assertion suites with JSDOM, Verilog-2005 RTL generation, repository Icarus verification, `@vscode/vsce` packaging.

**Spec:** `docs/superpowers/specs/2026-09-01-merc32-soc-configurator-experience-fixes-design.md`

## Global Constraints

- Keep `schemaVersion: 1` and all existing JSON field names, including `externalInterfaces[].windowSize` and the `apb_intc` record in `peripherals[]`.
- High Address is inclusive and persists only `windowSize = highAddress - baseAddress + 1`.
- Generated external interrupt pins are `external_interrupt0`, `external_interrupt1`, ... in route occurrence order; ordinary peripheral routes do not consume numbers.
- Use Verilog-2005 only; do not modify readable/protected interrupt-controller implementation source.
- Preserve unrelated working-tree changes and use `apply_patch` for source edits.
- Follow strict red-green-refactor: every production behavior is preceded by a focused failing test whose expected value is hand-derived.
- This backward-compatible feature release is `2.1.0`; update version metadata only after implementation tests pass and commit it before the final provenance package build.
- If VKS MCP tools are unavailable, report that explicitly and do not represent Icarus verification as VKS verification.

---

## File Structure

- Modify `merc32-vsce/src/socEditorProvider.ts`: derive editor-only high addresses, hide/own `apb_intc`, produce atomic controller updates, and present source choices.
- Modify `merc32-vsce/src/socWebviewProtocol.ts`: add serializable controller/high-address/source-option presentation fields or message shapes needed by the Webview without adding JSON schema fields.
- Modify `merc32-vsce/resources/webview/socEditor.js`: render fixed-unit inputs, derived High Address, controller fields, and real source selects.
- Modify `merc32-vsce/resources/webview/socEditor.css`: style prefix/suffix input groups and retain fixed-pane geometry.
- Modify `merc32-vsce/src/soc/planner.ts`: assign external top ports by route occurrence order and keep each external route distinct.
- Modify `merc32-vsce/src/soc/validate.ts`: allow repeatable external routes while retaining duplicate ordinary-source rejection and reserve occurrence-derived Verilog symbols.
- Modify `merc32-vsce/src/soc/emitVerilog.ts`: remove the generated top parameter list and pass planned RAM initialization paths directly to `spram`.
- Modify `merc32-vsce/scripts/test-soc-vsce-unit.js`: host/view-model/controller/high-address regression coverage.
- Modify `merc32-vsce/scripts/test-soc-webview.js`: DOM behavior for unit-bearing controls and source selects.
- Modify `merc32-vsce/scripts/test-soc-webview-geometry.js`: keep geometry fixtures and selectors representative of the revised controls while retaining all fixed-shell assertions.
- Modify `merc32-vsce/scripts/test-soc-config.js`: duplicate external-source validation and planned symbol collision coverage.
- Modify `merc32-vsce/scripts/test-soc-generator.js`: planner, README/header, parameterless top, and RAM initialization assertions.
- Modify `merc32-vsce/scripts/test-soc-rtl.js`: generated RTL compile/simulation fixtures and parameterless top integration.
- Modify `merc32-vsce/scripts/fixtures/soc/*.merc32.json` only to keep behavioral fixtures representative; retain `windowSize` and current controller JSON shapes.
- Modify `merc32-vsce/README.md`, `package.json`, and the root/package version entries in `package-lock.json` for release `2.1.0` after implementation verification.

---

### Task 1: Editor-host derived range and controller ownership

**Files:**
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`
- Modify: `merc32-vsce/src/socWebviewProtocol.ts`
- Modify: `merc32-vsce/src/socEditorProvider.ts`

**Interfaces:**
- Consumes: current `SocSourceConfig`, catalog descriptors, `buildJsonReplacement`, and versioned `setValue` mutations.
- Produces: controller presentation with instance index/name/base address; external-interface derived high-address presentation; atomic `JsonValueUpdate[]` for controller mode changes and renames; catalog presentation without ordinary `apb_intc` creation.

- [ ] **Step 1: Add failing host/view-model tests for derived High Address**

Add assertions to `test-soc-vsce-unit.js` using the existing `multi-peripheral.merc32.json` fixture:

```js
const apbExternal = multiView.externalInterfacePresentation.find((item) => item.name === 'apb_ext0');
assert.deepStrictEqual(apbExternal, {
    index: 0,
    name: 'apb_ext0',
    highAddress: '0x10004fff',
});
assert.deepStrictEqual(buildSocDocumentUpdates(parsedMultiForEditing.config, catalog, {
    type: 'setValue', documentVersion: 12,
    path: ['externalInterfaces', 0, 'highAddress'], value: '0x10005fff',
}), [{ path: ['externalInterfaces', 0, 'windowSize'], value: 8192 }]);
```

Also assert that a high address below `0x10004000`, an incomplete address, and a high address that overflows a 32-bit range return `undefined` and do not introduce a `highAddress` JSON property.

The production change caught by these tests is a wrong inclusive calculation or accidental schema mutation.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
Set-Location merc32-vsce
npm run compile
node scripts/test-soc-vsce-unit.js
```

Expected: FAIL because `externalInterfacePresentation` and the editor-only `highAddress` mutation path do not exist.

- [ ] **Step 3: Add failing tests for controller-owned lifecycle**

Add literal expectations covering:

```js
assert.ok(!multiView.catalog.modules.some((item) => item.type === 'apb_intc'));
assert.deepStrictEqual(multiView.interruptController, {
    peripheralIndex: 3,
    name: 'intc0',
    baseAddress: '0x10003000',
});

assert.deepStrictEqual(buildSocDocumentUpdates(parsedStandard.config, catalog, {
    type: 'setValue', documentVersion: 1,
    path: ['interrupt', 'mode'], value: 'controller',
}), [
    { path: ['peripherals', 1], value: { type: 'apb_intc', name: 'intc0' } },
    { path: ['interrupt'], value: { mode: 'controller', controller: 'intc0', sources: [] } },
]);
```

Use a collision fixture with an ordinary `intc0` instance and expect the new controller name `intc1`. For an existing controller, expect reuse instead of append. For `controller -> none` and `controller -> direct`, expect one atomic replacement that removes the managed peripheral and replaces `interrupt`. For controller rename, expect both `peripherals[index].name` and `interrupt.controller` updates.

The production change caught is split-brain controller state or a schema-invalid intermediate edit.

- [ ] **Step 4: Run the focused test and verify the new controller cases fail**

Run the same compile/unit command. Expected: FAIL on the first controller-ownership assertion while the prior deliberate high-address failure remains understood.

- [ ] **Step 5: Implement minimal protocol and host changes**

Add presentation types similar to:

```ts
export interface SocExternalInterfacePresentation {
    index: number;
    name: string;
    highAddress?: string;
}

export interface SocInterruptControllerPresentation {
    peripheralIndex: number;
    name: string;
    baseAddress?: string;
}
```

Add them to `SocEditorViewModel`. In `buildSocEditorViewModel`, compute high address only when base and size parse safely:

```ts
const base = parseU32(endpoint.baseAddress!);
const high = rangeEnd(base, parseByteSize(endpoint.windowSize));
highAddress: formatHex32(high)
```

Treat `['externalInterfaces', index, 'highAddress']` as an editor-only accepted path inside `buildSocDocumentUpdates`, not in `isEditableSocPath`. Convert it to the existing `windowSize` update with unsigned `bigint` arithmetic and a safe JSON integer.

Filter `apb_intc` from `presentCatalog(catalog).modules`. Add small helpers:

```ts
function interruptControllerIndex(config: SocSourceConfig): number | undefined;
function nextControllerName(config: SocSourceConfig): string;
function controllerModeUpdates(config: SocSourceConfig): JsonValueUpdate[];
function leaveControllerUpdates(config: SocSourceConfig, nextMode: 'none' | 'direct'): JsonValueUpdate[];
```

Ensure removal edits use the original peripheral index and interrupt replacement in one `buildJsonReplacement` transaction. Add an editor-only controller name path, for example `['interrupt', 'controllerName']`, that maps atomically to the two persisted paths.

- [ ] **Step 6: Run focused tests and refactor while green**

Run:

```powershell
npm run test:soc:vsce:unit
```

Expected: PASS. Remove duplicated address parsing/name allocation logic without changing behavior.

- [ ] **Step 7: Commit the host-side behavior**

```powershell
git add -- merc32-vsce/src/socWebviewProtocol.ts merc32-vsce/src/socEditorProvider.ts merc32-vsce/scripts/test-soc-vsce-unit.js
git commit -m "feat: make SoC editor own interrupt controller state"
```

---

### Task 2: Fixed-unit Webview controls and interrupt source selects

**Files:**
- Modify: `merc32-vsce/scripts/test-soc-webview.js`
- Modify: `merc32-vsce/scripts/test-soc-webview-geometry.js`
- Modify: `merc32-vsce/resources/webview/socEditor.js`
- Modify: `merc32-vsce/resources/webview/socEditor.css`

**Interfaces:**
- Consumes: Task 1 view-model fields and existing versioned mutation messages.
- Produces: reusable address and KiB controls; High Address UI backed by the editor-only path; Interrupts-owned INTC fields; source `select` controls using ordinary peripheral choices plus reusable external choice.

- [ ] **Step 1: Update DOM fixtures to the new view-model contract**

Keep fixture JSON unchanged, but add `externalInterfacePresentation`,
`interruptController`, and structured interrupt options such as:

```js
interruptOptions: {
    directSources: [
        { value: 'uart0.interrupt', label: 'uart0.interrupt', kind: 'peripheral' },
        { value: 'external', label: 'External interrupt', kind: 'external' },
    ],
    routedSources: [
        { value: 'uart0.interrupt', label: 'uart0.interrupt', kind: 'peripheral' },
        { value: 'external', label: 'External interrupt', kind: 'external' },
    ],
}
```

Do not compute expected High Address with production helpers; use literal `0x2000ffff` in the visual fixture.

- [ ] **Step 2: Add failing fixed-unit control tests**

Add DOM assertions that:

```js
assert.strictEqual(document.querySelector('[data-field-path="[\"externalInterfaces\",0,\"windowSize\"]"]'), null);
assert.strictEqual(document.querySelector('.external-high-address .input-prefix').textContent, '0x');
assert.strictEqual(document.querySelector('.external-high-address input').value, '2000ffff');
assert.strictEqual(document.querySelector('.memory-capacity .input-suffix').textContent, 'KiB');
assert.strictEqual(document.querySelector('.memory-capacity input').value, '32');
```

Exercise input sanitization by setting an address body to `12xzABcd999`, dispatching `input`, and expecting `12abcd99`; dispatch `change` with eight valid digits and expect a persisted value with `0x`. Verify fewer than eight digits posts no mutation. Change capacity to `64` and expect `64KiB`.

The production changes caught are editable prefixes/units, unbounded characters, premature invalid mutations, or byte/KiB confusion.

- [ ] **Step 3: Add failing controller/source-select tests**

Replace the existing datalist expectations with real select behavior:

```js
assert.strictEqual(document.querySelector('.interrupt-controller'), null);
assert.strictEqual(document.querySelector('.interrupt-controller-name').value, 'intc0');
assert.strictEqual(document.querySelector('.interrupt-controller-base .input-prefix').textContent, '0x');
assert.strictEqual(document.querySelector('.route-source').tagName, 'SELECT');
assert.deepStrictEqual([...document.querySelector('.route-source').options].map((option) => option.textContent), [
    'uart0.interrupt', 'External interrupt',
]);
```

With two routes, prove `uart0.interrupt` is unavailable in the second row but External interrupt is available in both. Selecting External interrupt must post a unique valid JSON source such as `external.irq0`; adding another route must select a different token such as `external.irq1`. Assert ordinary navigation/Add Peripheral has no `apb_intc` item and no INTC parameter controls.

The production change caught is free-text interrupt input, duplicate ordinary routing, or a non-repeatable external option.

- [ ] **Step 4: Run the DOM suite and verify RED**

Run:

```powershell
Set-Location merc32-vsce
npm run test:soc:webview:dom
```

Expected: FAIL because current fields are generic inputs/datalists and INTC remains an ordinary peripheral.

- [ ] **Step 5: Implement reusable unit-bearing controls**

In `socEditor.js`, add focused helpers rather than branching throughout `addField`:

```js
function addHexField(label, path, value, options = {}) { /* fixed 0x + 8 digits */ }
function addKibField(label, path, value) { /* numeric body + fixed KiB */ }
function byteSizeToWholeKib(value) { /* number or KiB/MiB input */ }
```

Build the wrapper as a field control group containing a non-editable prefix or suffix span and the input. On `input`, strip non-hex characters and limit to eight lowercase digits. On `change`, post only complete valid values. Preserve optional clear behavior for base addresses.

Use `addHexField` for JTAG ID, peripheral/external/controller Base Address, and external High Address. Use `addKibField` for ILB/DLB capacity. Render High Address from Task 1 presentation and send the editor-only high-address path.

- [ ] **Step 6: Implement Interrupts-owned controller form and source selects**

In navigation, exclude `apb_intc` rows from ordinary peripherals. In Controller mode, render:

```js
addField('Instance name', ['interrupt', 'controllerName'], controller.name, { kind: 'text' });
addHexField('Base address', ['peripherals', controller.peripheralIndex, 'baseAddress'], controller.baseAddress, { optional: true });
```

Build every route source as a `select`. The persisted route value remains unchanged for peripheral sources. Map any `external.*` current value to the External interrupt option. When External interrupt is newly selected, choose the lowest collision-free `external.irqN` token from all current routes before posting.

For each route, omit/disable ordinary options used by another route, while including its own current ordinary value and the reusable external choice. Direct mode uses the same select shape.

- [ ] **Step 7: Add CSS and run DOM/geometry tests**

Add compact classes such as `.unit-input`, `.input-prefix`, `.input-suffix`, and `.field-invalid`. Keep route grid minimums compatible with the current fixed shell.

Run:

```powershell
npm run test:soc:webview
```

Expected: DOM and geometry suites PASS at all existing viewport/scenario fixtures. If geometry fails, adjust only the revised control sizing or representative fixture selectors; do not loosen shell anchoring assertions.

- [ ] **Step 8: Commit the Webview behavior**

```powershell
git add -- merc32-vsce/resources/webview/socEditor.js merc32-vsce/resources/webview/socEditor.css merc32-vsce/scripts/test-soc-webview.js merc32-vsce/scripts/test-soc-webview-geometry.js
git commit -m "feat: standardize SoC configurator inputs"
```

---

### Task 3: External IRQ occurrence semantics and derived INTC parameters

**Files:**
- Modify: `merc32-vsce/scripts/test-soc-config.js`
- Modify: `merc32-vsce/scripts/test-soc-generator.js`
- Modify: `merc32-vsce/src/soc/validate.ts`
- Modify: `merc32-vsce/src/soc/planner.ts`
- Modify: `merc32-vsce/src/soc/emitSoftware.ts`

**Interfaces:**
- Consumes: unchanged `interrupt.source` strings (`<instance>.<interrupt>` or `external.<identifier>`).
- Produces: one distinct planned external port per external route occurrence, stable list-order numbering, duplicate-external acceptance, duplicate-peripheral rejection, and unchanged ID/trigger-derived INTC parameters.

- [ ] **Step 1: Add failing validation tests for repeatable external routes**

Create a controller fixture with:

```js
sources: [
    { source: 'external.irq', id: 0, trigger: 'high' },
    { source: 'uart0.interrupt', id: 1, trigger: 'rising' },
    { source: 'external.irq', id: 2, trigger: 'low' },
]
```

Assert it has no `SOC_IRQ_SOURCE_DUPLICATE`, no generated-symbol collision, and remains otherwise valid. Keep/add a companion fixture with `uart0.interrupt` twice and assert `SOC_IRQ_SOURCE_DUPLICATE` at the second source path.

The production change caught is treating external pins as named singleton sources or accidentally allowing duplicate ordinary device interrupts.

- [ ] **Step 2: Add failing planner tests for occurrence-order port names**

Plan a literal route list and assert:

```js
assert.deepStrictEqual(plan.interrupt.sources.map((source) => source.topPort), [
    'external_interrupt0', undefined, 'external_interrupt1',
]);
assert.deepStrictEqual(plan.topPorts.filter((port) => port.name.startsWith('external_interrupt')), [
    { name: 'external_interrupt0', direction: 'input', width: 1 },
    { name: 'external_interrupt1', direction: 'input', width: 1 },
]);
```

Add a single-external direct-mode case expecting `external_interrupt0`, and a route-removal case proving remaining external sources compact to `0`, `1`.

Assert a legacy INTC parameter object such as `{ IRQ_COUNT: 32, IRQ_MODE: 0 }` is overridden by literal derived values from the route IDs/triggers.

- [ ] **Step 3: Run configuration and generator suites and verify RED**

Run:

```powershell
Set-Location merc32-vsce
npm run test:soc:config
npm run test:soc:generator
```

Expected: validation rejects repeated `external.irq`, and planned ports still use identifier-derived names.

- [ ] **Step 4: Implement occurrence-aware validation**

In `validateInterrupts`, apply duplicate detection only to non-external sources:

```ts
const external = /^external\./.test(source.source);
if (!external && sourceNames.has(source.source)) { /* duplicate diagnostic */ }
```

Do not deduplicate external top ports or macros by identifier. During generated-symbol validation, enumerate external route occurrences and reserve `external_interrupt${index}` plus its synchronizer names. Keep paths attached to the exact source occurrence.

- [ ] **Step 5: Implement occurrence-aware planning**

Pass an external occurrence index into interrupt-source planning:

```ts
function planInterruptSource(source: string, externalIndex?: number): PlannedInterruptSource {
    return source.startsWith('external.')
        ? { source, topPort: `external_interrupt${externalIndex}` }
        : { source };
}
```

Walk the original route list in occurrence order to assign external indices before sorting controller sources by IRQ ID. Preserve the assigned `topPort` when sorting. For Direct mode, use index zero. In `planTopPorts`, retain external route occurrence order rather than sorting/deduplicating the derived names.

- [ ] **Step 6: Run focused suites and refactor while green**

Run:

```powershell
npm run test:soc:config
npm run test:soc:generator
```

Expected: PASS, including existing collision and macro tests. If software header macros now use `EXTERNAL_INTERRUPT0`, assert those literal generated names rather than the persistence token.

- [ ] **Step 7: Commit planner/validation behavior**

```powershell
git add -- merc32-vsce/src/soc/validate.ts merc32-vsce/src/soc/planner.ts merc32-vsce/src/soc/emitSoftware.ts merc32-vsce/scripts/test-soc-config.js merc32-vsce/scripts/test-soc-generator.js
git commit -m "feat: number external interrupt pins by route order"
```

---

### Task 4: Parameterless generated SoC top and RTL verification

**Files:**
- Modify: `merc32-vsce/scripts/test-soc-generator.js`
- Modify: `merc32-vsce/scripts/test-soc-rtl.js`
- Modify: `merc32-vsce/src/soc/emitVerilog.ts`

**Interfaces:**
- Consumes: planned memory `initFile.outputName`, generated firmware layout, child-module parameter APIs.
- Produces: a generated project top declared only with ports; direct literal `spram.INIT_FILE` values; unchanged child CPU/bridge/peripheral parameters.

- [ ] **Step 1: Add failing generator assertions**

For an internal-memory plan with an ILB init file and an uninitialized DLB, assert literal behavior:

```js
const top = soc.renderSocTop(internalPlan);
assert.match(top, /^module internal_soc \(/m);
assert.doesNotMatch(top, /^module internal_soc #\(/m);
assert.doesNotMatch(top, /parameter (?:ILB|DLB)_INIT_FILE/);
assert.match(top, /\.INIT_FILE \("\.\.\/firmware\/ilb_firmware\.mem"\)/);
assert.match(top, /\.INIT_FILE \(""\)/);
```

Also assert CPU, APB peripheral, and bridge child instances still contain their required parameter overrides. This catches accidental removal of all parameterization rather than only top-level parameters.

- [ ] **Step 2: Update/add failing RTL integration fixture**

Change the integration testbench instantiation from:

```verilog
generated_soc #(.ILB_INIT_FILE(...)) dut (...);
```

to plain:

```verilog
generated_soc dut (...);
```

Use a JSON fixture with an actual initialization file and verify the generated single RTL bundle compiles and reads the copied relative path without a top-level override.

- [ ] **Step 3: Run generator/RTL suites and verify RED**

Run:

```powershell
Set-Location merc32-vsce
npm run test:soc:generator
npm run test:soc:rtl
```

Expected: generator assertions fail on existing top parameters; the updated RTL integration cannot compile until emission changes.

- [ ] **Step 4: Implement the minimal Verilog emitter change**

In `renderSocTop`, always call:

```ts
emitModuleHeader(writer, plan.topModule, [], plan.topPorts.map(formatTopPort));
```

In `emitMemoryInstances`, derive the child value directly:

```ts
const initFile = memory.initFile === undefined
    ? ''
    : `../firmware/${memory.initFile.outputName}`;
emitInstance(writer, 'spram', `${prefix}_ram_inst`, [
    ['ADDR_WIDTH', `${memory.wordAddressWidth}`],
    ['INIT_FILE', quoteVerilog(initFile)],
], connections);
```

Do not change `emitInstance` behavior for child modules. Leave CPU/APB/bridge/IP parameters generator-owned.

- [ ] **Step 5: Run generator and RTL verification**

Run:

```powershell
npm run test:soc:generator
npm run test:soc:rtl
```

Expected: all generator assertions pass; repository Icarus compilation and behavioral simulations pass with no new warnings. Record whether VKS tools are available; do not claim VKS simulation if they are absent.

- [ ] **Step 6: Commit RTL generation behavior**

```powershell
git add -- merc32-vsce/src/soc/emitVerilog.ts merc32-vsce/scripts/test-soc-generator.js merc32-vsce/scripts/test-soc-rtl.js
git commit -m "feat: generate parameterless SoC top modules"
```

---

### Task 5: Integration regression, documentation, and release package

**Files:**
- Modify: `merc32-vsce/README.md`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/package-lock.json`
- Generated package: `merc32-vsce/merc32-vsce.vsix`

**Interfaces:**
- Consumes: Tasks 1-4 and repository release policy.
- Produces: verified extension `2.1.0`, committed version metadata before packaging, source/VSIX version equality, and passing repository VSIX smoke.

- [ ] **Step 1: Run the complete focused SoC regression before versioning**

Run from `merc32-vsce`:

```powershell
npm run test:soc:config
npm run test:soc:editor-session
npm run test:soc:webview
npm run test:soc:vsce:unit
npm run test:soc:generator
npm run test:soc:rtl
npm run test:vsix:deps
```

Expected: all commands exit zero. Fix only regressions caused by this feature using a new red-green cycle.

- [ ] **Step 2: Run the broader extension regression**

Run:

```powershell
npm test
npm run test:extension:resources
```

Expected: TypeScript and all non-Electron repository unit suites pass. Run Electron extension tests if the environment supports them:

```powershell
npm run test:extension
```

If the environment blocks Electron, record the exact failure instead of claiming the suite passed.

- [ ] **Step 3: Update user-facing README behavior and version metadata**

Document concise configurator behavior in `merc32-vsce/README.md`: High Address presentation with persisted `windowSize`, Controller-owned INTC, fixed `0x`/`KiB` units, external pin numbering, and parameterless generated top.

Change exactly:

```json
// merc32-vsce/package.json
"version": "2.1.0"

// merc32-vsce/package-lock.json root and packages[""] entries
"version": "2.1.0"
```

Update the README badge from `Version-2.0.3` to `Version-2.1.0`. Do not alter transitive dependency versions that happen to equal `2.0.3`.

- [ ] **Step 4: Verify and commit version metadata before packaging**

Run:

```powershell
node -e "const p=require('./package.json'); const l=require('./package-lock.json'); if(p.version!=='2.1.0'||l.version!=='2.1.0'||l.packages[''].version!=='2.1.0') process.exit(1)"
git diff --check
```

Expected: exit zero. Then commit:

```powershell
git add -- merc32-vsce/README.md merc32-vsce/package.json merc32-vsce/package-lock.json
git commit -m "chore: release extension 2.1.0"
```

- [ ] **Step 5: Build the final provenance VSIX**

Run only after the version commit:

```powershell
npm run package:vsix
```

Expected: `merc32-vsce.vsix` is created successfully from the committed source metadata.

- [ ] **Step 6: Verify packaged version equals source**

Use the already installed `adm-zip` dependency:

```powershell
node -e "const fs=require('fs');const AdmZip=require('adm-zip');const src=require('./package.json');const zip=new AdmZip('merc32-vsce.vsix');const packed=JSON.parse(zip.readAsText('extension/package.json'));if(packed.version!==src.version){throw new Error('VSIX version mismatch: '+packed.version+' != '+src.version)};console.log(packed.version)"
```

Expected output: `2.1.0`.

- [ ] **Step 7: Run the repository VSIX smoke**

Run:

```powershell
npm run test:vsix
```

Expected: package integrity, install/activation, fixed-layout, generator, and runtime smoke checks pass. Preserve the produced VSIX unless repository convention or the smoke script removes it.

- [ ] **Step 8: Fresh final verification and status audit**

Run:

```powershell
git status --short
git log -6 --oneline
npm run test:soc
npm run test:vsix
```

Expected: only the intentionally produced VSIX may be untracked/modified; every required suite passes freshly. Re-read the spec requirement-by-requirement and confirm each has a corresponding passing assertion or visible generated artifact.

Do not make a completion claim until this fresh output has been read in full.
