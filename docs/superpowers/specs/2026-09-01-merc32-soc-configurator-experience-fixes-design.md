# MERC32 SoC Configurator Experience Fixes Design

## 1. Goal

Improve the existing VS Code SoC configurator in four connected areas without
changing the `schemaVersion: 1` JSON structure:

1. Present external-interface ranges using an inclusive high address instead of
   a window-size input.
2. Make the APB interrupt controller an interrupt-editor-owned peripheral and
   derive its parameters from interrupt routing.
3. Give address and memory-capacity inputs fixed, visible units.
4. Remove parameters from the generated SoC top module because source JSON is
   the sole configuration authority.

The existing headless configuration model, catalog model, and saved JSON field
names remain compatible. This is a backward-compatible feature release.

## 2. Existing Behavior and Root Causes

External interfaces currently expose `baseAddress`, `windowSize`, and
`addressWidth` directly in the property editor. Although `windowSize` is useful
to the planner, it is less clear to a user reviewing an address map than the
inclusive final address.

`apb_intc` currently appears in the ordinary APB peripheral catalog. Controller
mode then refers to that separately created peripheral by name. The planner
already overwrites `IRQ_COUNT` and `IRQ_MODE` from interrupt routes for the
selected controller, but the ordinary peripheral property editor still exposes
those catalog parameters. This creates two apparent configuration authorities.

Address and memory-size fields currently use generic text or number controls.
Their unit and required notation are not visually fixed, so equivalent fields
can be entered inconsistently.

For initialized internal RAM, the generated SoC top currently declares
`ILB_INIT_FILE` or `DLB_INIT_FILE` parameters and passes them to the RAM
instances. The JSON already owns the initialization-file choice, so the public
top parameter creates an unnecessary second override point.

## 3. Compatibility Boundary

The saved configuration continues to use the current shapes:

```json
{
  "externalInterfaces": [
    {
      "type": "apb",
      "name": "apb0",
      "baseAddress": "0x10001000",
      "windowSize": 4096,
      "addressWidth": 12
    }
  ],
  "peripherals": [
    {
      "type": "apb_intc",
      "name": "intc0",
      "baseAddress": "0x10000000"
    }
  ],
  "interrupt": {
    "mode": "controller",
    "controller": "intc0",
    "sources": []
  }
}
```

There is no schema-version increment and no migration command. Existing valid
configuration files remain valid input. The editor may normalize a field value
when the user edits it, but it does not rename, relocate, or add required JSON
fields.

The `apb_intc` catalog entry and RTL module remain unchanged. The editor hides
the module from ordinary peripheral creation and treats the matching peripheral
record as controller-owned. Headless parsing and generation continue to accept
existing controller records.

## 4. External Interface High Address

### 4.1 Presentation

The external-interface property editor replaces `Window size` with
`High Address`. Both Base Address and High Address are inclusive 32-bit
addresses rendered as a fixed `0x` prefix followed by an editable eight-digit
hexadecimal body.

For an existing endpoint, the presented high address is:

```text
highAddress = baseAddress + parseByteSize(windowSize) - 1
```

For example, `baseAddress = 0x10001000` and `windowSize = 4096` present
`High Address = 0x10001fff`.

### 4.2 Persistence

High Address is a derived UI field, not a JSON field. When the user commits a
valid high address, the host writes only the existing `windowSize` path:

```text
windowSize = highAddress - baseAddress + 1
```

The written value is a positive integer byte count. The existing planner,
validator, auto-assignment logic, schema, and generated address map continue to
consume `windowSize`.

Changing Base Address keeps the stored window size unchanged and therefore
moves the complete window; the displayed High Address is recomputed from the
new base. High Address is disabled while Base Address is absent or invalid.

The editor does not submit a mutation when the high address is below the base,
outside the unsigned 32-bit range, incomplete, or non-hexadecimal. The existing
document remains unchanged and the field exposes an inline validation state.

## 5. Interrupt Controller Ownership

### 5.1 Peripheral catalog behavior

`apb_intc` is omitted from the Add APB Peripheral choices. If an existing
configuration contains the active controller peripheral, it is not shown as an
ordinary peripheral navigation item and its generic module-parameter form is
not rendered.

The JSON record remains inside `peripherals[]`, because the planner, APB address
map, generated header, and headless tools already consume that representation.

### 5.2 Mode transitions

Selecting Controller mode performs one structured document update that:

- changes `interrupt` to controller mode;
- reuses the existing single `apb_intc` record if one exists;
- otherwise appends `{ "type": "apb_intc", "name": "intc0" }`, choosing a
  collision-free instance name when `intc0` is already used;
- sets `interrupt.controller` to that instance name; and
- initializes `interrupt.sources` as an empty array.

Selecting None or Direct removes the controller-owned `apb_intc` record and
replaces the interrupt object with the selected mode's current schema shape.
Removal and interrupt replacement occur in one workspace edit so the document
never exposes an intermediate mismatched controller reference.

If a text-authored configuration contains an `apb_intc` that is not referenced
by controller mode, it remains valid headless input but the configurator treats
it as stale controller state. The next interrupt-mode transition normalizes it
according to the rules above.

### 5.3 Controller fields

Controller mode displays these controller-owned fields in the Interrupts
property page:

- Instance name, backed by `peripherals[controllerIndex].name` and mirrored to
  `interrupt.controller` in the same edit.
- Base address, backed by `peripherals[controllerIndex].baseAddress`.

Renaming the controller must update both JSON paths atomically. Base address
remains optional so the existing Auto-assign Addresses action can allocate it.

`IRQ_COUNT` and `IRQ_MODE` are never shown as editable fields. The planner
continues to derive them from the controller routes:

- `IRQ_COUNT = max(configured IRQ ID) + 1`;
- `IRQ_MODE` uses the existing two-bit trigger encoding at each configured ID.

Any legacy `parameters.IRQ_COUNT` or `parameters.IRQ_MODE` values remain accepted
for JSON compatibility but do not control the active generated controller; the
derived values continue to override them.

## 6. Interrupt Source Selection and External Pins

### 6.1 Source controls

Direct and controller source controls become real `select` elements rather than
free-text inputs with datalist suggestions.

The choices are:

- every interrupt output of every added ordinary peripheral, shown with its
  qualified instance reference such as `uart0.interrupt`; and
- one reusable `External interrupt` choice.

An ordinary peripheral interrupt may be routed at most once. Options already
used by another route are disabled or omitted from subsequent route selects.
`External interrupt` remains selectable for any number of routes.

### 6.2 JSON representation

The source field remains a string in the existing schema. When External
interrupt is selected, the editor stores a valid `external.<identifier>` token.
It chooses a collision-free internal identifier for the JSON record. The
identifier is persistence detail only and is not used as the generated pin
name.

Existing text-authored `external.<identifier>` sources are presented as
External interrupt and remain valid. Selecting or retaining them does not
require a schema migration.

### 6.3 Generated pin numbering

The planner assigns external interrupt top ports by their occurrence order in
the active route list:

```text
first external route  -> external_interrupt0
second external route -> external_interrupt1
third external route  -> external_interrupt2
```

Numbering always begins at zero, including when there is only one external
source. Ordinary peripheral routes do not consume an external number. Deleting
a route compacts the remaining external numbering on the next plan and RTL
generation.

Each external route is a distinct pin even if a text-authored configuration
repeats the same `external.<identifier>` token. Validation therefore permits
repeated external selections while continuing to reject duplicate ordinary
peripheral interrupt routes.

Controller IRQ IDs remain explicit and independent from external pin numbers.
The route at IRQ ID 7 may therefore use `external_interrupt0` if it is the first
external route in list order.

## 7. Fixed-Unit Inputs

### 7.1 Hexadecimal addresses

All SoC address controls use one shared address component:

- fixed, non-editable `0x` prefix;
- editable body limited to eight hexadecimal characters;
- lowercase normalized display;
- commit only when exactly eight digits are present;
- optional address fields retain an accessible clear action.

This component is used for peripheral Base Address, external-interface Base
Address and High Address, controller Base Address, and CPU JTAG ID Code.
The persisted address remains the existing `0x12345678` string.

### 7.2 RAM capacity

ILB and DLB capacity controls use a numeric body and a fixed, non-editable
`KiB` suffix. For ordinary KiB-aligned memory values, the editor converts the
existing byte-size representation to KiB for display and persists the edited
value as `<digits>KiB`, for example `32KiB`.

The headless parser continues to accept every currently supported byte-size
form. A legacy valid value that cannot be represented as a whole number of KiB
is not silently rounded; the editor marks it as requiring text-mode repair or a
new whole-KiB value before it can be changed through the standardized field.

## 8. Generated SoC Top Parameters

The generated project top module has a plain port header and no `#(...)`
parameter list.

For an internal RAM with an initialization file, the generator writes the
planned copied firmware path directly into that RAM instance's `INIT_FILE`
parameter. For an internal RAM without an initialization file, it writes the
empty string directly. `ADDR_WIDTH` and other parameters required by child RTL
modules remain generator-owned child-instance parameters; only the generated
SoC top's public parameter list is removed.

This makes the source JSON the only user configuration authority while keeping
the existing protected IP and bridge module interfaces intact.

## 9. Validation and Error Handling

- Derived high-address arithmetic uses unsigned 32-bit values and rejects
  overflow or reversed ranges before sending a document mutation.
- The existing semantic validator remains authoritative for alignment,
  downstream address width, overlap, PLB bounds, and missing base addresses.
- Controller creation, removal, and rename use multi-path structured updates so
  the schema is valid after the single edit.
- If controller mode cannot identify exactly one managed controller record, the
  editor presents the existing diagnostics and does not guess across duplicate
  `apb_intc` records.
- Source selects are built from the current catalog and configuration snapshot;
  stale mutations retain the existing document-version rejection behavior.
- External pin numbering is recomputed from source order and is never persisted
  as a second configuration field.

## 10. Implementation Boundaries

The change is expected to touch these focused areas:

- `src/soc/model.ts`, `schema.ts`, `validate.ts`, `planner.ts`, and `address.ts`
  only where external-route semantics or reusable address arithmetic require it;
  the JSON object structure remains unchanged.
- `src/socEditorProvider.ts` and `src/socWebviewProtocol.ts` for controller-owned
  presentation, source choices, derived high-address data, and atomic dependent
  edits.
- `resources/webview/socEditor.js` and `socEditor.css` for fixed-unit controls,
  the controller form, real source selects, and inline input validity.
- `src/soc/emitVerilog.ts` for parameterless generated top modules and direct
  RAM initialization-file values.
- Existing SoC fixtures and JavaScript/TypeScript test suites for regression
  coverage. Fixture JSON retains `windowSize` and the current controller shape.

No readable protected IP source is changed. No new Verilog module is created.

## 11. Testing Strategy

Implementation follows red-green-refactor cycles.

### 11.1 Configuration and editor-host tests

- Existing schema-version-1 fixtures still parse.
- High Address presentation is inclusive and writes the expected numeric
  `windowSize` without adding a `highAddress` property.
- Invalid, incomplete, reversed, and overflowing high addresses do not mutate
  the document.
- Selecting Controller atomically adds or reuses one `apb_intc` and updates the
  interrupt object.
- Leaving Controller atomically removes the managed controller.
- Controller rename updates the peripheral name and controller reference.
- `apb_intc` cannot be added through the ordinary peripheral action and its
  parameters are absent from the ordinary UI.
- The source option model contains ordinary peripheral interrupts plus the
  reusable external choice.

### 11.2 Webview DOM and geometry tests

- Address fields render fixed `0x` prefixes and eight-character sanitized
  bodies.
- Memory fields render fixed `KiB` suffixes and persist whole-KiB strings.
- External endpoints render High Address and no Window size field.
- Controller fields appear in Interrupts and not in the peripheral pane.
- Route sources are selects; ordinary duplicates are unavailable while
  External interrupt remains reusable.
- Existing fixed-pane geometry still holds with the revised controller and
  route forms at supported viewport sizes.

### 11.3 Planner and generator tests

- Multiple external routes generate `external_interrupt0`,
  `external_interrupt1`, and so on in route occurrence order.
- One external route still generates `external_interrupt0`.
- Removing an earlier external route compacts numbering.
- Repeated external source tokens are accepted as distinct routes; duplicate
  ordinary peripheral sources remain rejected.
- Controller `IRQ_COUNT` and `IRQ_MODE` are derived from IDs and triggers and
  override legacy stored parameter values.
- The generated SoC top contains no module parameter list.
- RAM instances receive JSON-planned initialization paths directly.
- Generated Verilog remains Verilog-2005 compatible and passes the repository's
  compile, elaboration, and behavioral interrupt matrix.

### 11.4 Release verification

Run the focused SoC configuration, editor, Webview, generator, and RTL suites,
then the full extension tests required by the repository. Because this adds
backward-compatible behavior, update the extension version from `2.0.3` to
`2.1.0`, commit version metadata before the provenance build, package the VSIX,
verify `extension/package.json` inside it matches the source package, and run
the repository VSIX smoke test.

The Verilog workflow will use the repository's available verification tools.
If the required VKS MCP simulation tools are unavailable in this environment,
the final report will state that explicitly and will distinguish the existing
Icarus-based repository verification from VKS verification.

