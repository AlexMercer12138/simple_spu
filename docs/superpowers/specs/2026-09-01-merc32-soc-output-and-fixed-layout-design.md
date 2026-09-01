# MERC32 SoC Compact Output and Fixed Editor Layout Design

## 1. Purpose

Simplify generated SoC projects into a shallow, human-oriented directory and
make the graphical configurator keep a stable three-column upper workbench and
two-column lower information band at every editor size.

This change has two related outcomes:

- A generated project is practical to browse and integrate without traversing
  a copied RTL tree or reconciling redundant JSON descriptions.
- Long property forms, port tables, navigation lists, or interrupt-route lists
  scroll inside their assigned panes and can never move or hide the PLB address
  space and Status panes.

The configuration schema, planned hardware topology, address allocation,
peripheral behavior, and public generated top-module interface do not change.

## 2. Generated Project Contract

### 2.1 Directory layout

Every newly generated project has this managed layout:

```text
README.md
manifest.json
hardware/
  <project>.v
firmware/
  ilb_<source-file-name>
  dlb_<source-file-name>
software/
  <project>.h
  main.c
```

`firmware/` is present only when at least one internal memory has an
initialization file. The file keeps its original extension and bytes. The
`ilb_` or `dlb_` prefix prevents the two memory slots from colliding when their
source files have the same base name.

The output does not contain `rtl/`, `memory/`, `config/`, nested
`software/include/` or `software/src/` directories. It also does not contain
`rtl/files.f`, `address-map.json`, `<project>.resolved.json`, or `LICENSE`.
Removing `LICENSE` applies only to generated SoC projects; the VSCode extension
and source repository retain their own licensing files.

The root intentionally contains one human-readable document and one
machine-readable control file. `manifest.json` is retained for generator
ownership, safety, and extension artifact recovery, not as a second human
configuration format.

### 2.2 Single Verilog file

`hardware/<project>.v` is a genuine self-contained Verilog-2005 compilation
unit. It contains every RTL module required by the selected configuration and
does not use `` `include`` to refer to other generated files.

The deterministic concatenation order is:

1. CPU wrapper, CPU core, arithmetic, and selected storage modules.
2. Selected debug modules.
3. Selected Local Bus protocol bridges.
4. Selected built-in APB peripheral modules.
5. The generated APB interconnect, when built-in peripherals exist.
6. The generated PLB router.
7. The generated `<project>` SoC top module.

Each source fragment appears exactly once and is preceded by a Verilog comment
that identifies its packaged or generated logical source. A separating newline
is inserted without rewriting protected or readable RTL bodies. The order and
separator text are stable so identical inputs produce identical output bytes.

Icarus and integration instructions consume only
`hardware/<project>.v`. `files.f` is unnecessary and is removed from all
generator, smoke-test, and documentation contracts.

### 2.3 Firmware files

Memory initialization files are never embedded in the Verilog output and are
never converted. `.mem`, `.hex`, `.bin`, `.coe`, and other source extensions
are preserved. Copying is byte-for-byte, including binary input.

For an initialized internal RAM, the generated Verilog parameter defaults to
`../firmware/<prefixed-file-name>`, relative to
`hardware/<project>.v`. The current internal `spram` implementation continues
to initialize with `$readmemh`. Therefore, README must state that direct RTL
simulation or synthesis initialization requires content compatible with the
tool's `$readmemh` handling; retaining another format in `firmware/` does not
imply automatic conversion.

## 3. Generated README

`README.md` becomes the complete human-readable description of the resolved
SoC. It contains:

- Project name, generated top module, source-configuration identity, generator
  version, and resource revision.
- A concise integration example that compiles only
  `hardware/<project>.v` and identifies the software and firmware paths.
- CPU debug and JTAG configuration.
- ILB and DLB type, inclusive address range, byte size, word-address width, and
  firmware binding.
- Every built-in peripheral's instance name, type, module, inclusive address
  range, effective parameters, and interrupt outputs.
- Every external interface's instance name, protocol, inclusive address range,
  downstream address width, and effective bridge parameters.
- Interrupt mode, selected controller, IRQ count, and every route's source, ID,
  trigger, and generated top port where applicable.
- Every generated top-level port with direction and width.
- The deterministic RTL composition order and the complete shallow output file
  inventory.

Tables are used for resolved maps and repeated records. Empty sections say that
no matching items were configured instead of emitting empty or misleading
tables. Addresses remain normalized eight-digit hexadecimal values and sizes
remain explicit byte counts so README carries all information previously split
between `address-map.json` and `<project>.resolved.json`.

`software/<project>.h` remains the authoritative machine-consumable address and
feature interface for C software. No consumer in the extension or test suite
may continue to require either removed JSON file.

## 4. Manifest Version 2

### 4.1 Responsibilities

New output writes `manifestVersion: 2`. The manifest retains:

- Project and source-configuration identity.
- Generator version and packaged resource revision.
- The excluded-self manifest policy.
- One record per managed file with path, kind, logical source, and SHA-256.
- Exactly one user-owned scaffold record for `software/main.c`, without a
  managed hash.

The v2 path and kind allowlist describes only the compact layout. Firmware
records are managed byte copies with logical sources
`config:memory.ilb.initFile` and `config:memory.dlb.initFile`. The manifest
continues to reject absolute paths, traversal, links, unsafe aliases, duplicate
case-insensitive paths, unexpected records, and records whose kind or logical
source does not match their path.

The Artifacts view validates v2 rather than trusting arbitrary manifest paths.
It restores the output directory, manifest, README, single hardware file,
software header, user `main.c`, and any declared firmware files that still
exist. Persisted artifact records continue to be associated with the canonical
source configuration.

### 4.2 Version 1 migration

The generator accepts a structurally valid v1 manifest only as migration input
and writes v2 after a successful generation. Existing ownership, path
containment, link rejection, staged activation, recovery, and compare-before-
replace guarantees remain in force.

For v1 managed files:

- An unchanged old RTL asset, generated RTL file, `files.f`, resolved JSON,
  address-map JSON, or generated `LICENSE` is stale and removed atomically.
- An unchanged old memory copy is replaced by the corresponding managed file
  under `firmware/`, then removed from `memory/`.
- A modified managed or stale file stops normal generation with its current
  conflict reason. Force Generate may replace or remove it.
- Unknown user files are never adopted or deleted merely because they are
  inside an old generated directory. Empty obsolete directories are removed
  only after all owned children have migrated or been removed.

The user-owned C scaffold follows explicit collision rules:

| Existing files | Result |
|---|---|
| Neither path exists | Create `software/main.c` from the template. |
| Only `software/src/main.c` exists under a valid v1 manifest | Move its exact bytes to `software/main.c`. |
| Only `software/main.c` exists | Preserve it unchanged and record it as user-owned. |
| Both paths exist | Stop with a conflict, even if their bytes match. |

The migration of old `main.c` is included in the same staged transaction as
managed-file activation. A failed activation must restore the previous output
or preserve the recovery staging directory under the existing recovery policy.
Normal generation and Force Generate never overwrite either user-owned
`main.c`; resolving a two-file collision always requires an explicit user
choice outside the generator.

## 5. Fixed Editor Geometry

### 5.1 Viewport ownership

The Webview owns exactly its visible viewport. `html` and `body` have bounded
height and no page scrolling. `.editor-shell` uses `position: fixed` with
`inset: 0`, `min-width: 0`, `min-height: 0`, and `overflow: hidden` so document
content cannot increase the page box or leave unused space below the editor.

After the toolbar and optional invalid-document banner, the remaining height is
divided into two tracks using `minmax(0, 4fr)` and `minmax(0, 1fr)`. Thus the
upper workbench receives 80 percent and the lower band 20 percent of the
remaining editor height. Neither track derives its size from descendant
content.

### 5.2 Permanent pane structure

The upper workbench always has three columns:

```text
Navigation (23%) | Properties (46%) | Summary (31%)
```

The lower band always has two columns:

```text
PLB address space (70%) | Status (30%)
```

These relationships remain in wide, medium, narrow, and short editor
viewports. Responsive rules may adjust padding, compact controls, or toolbar
wrapping, but may not move Summary to another row, stack any upper pane, stack
the lower panes, or change the page into a content-sized scroll surface.

All five panes have `min-width: 0`, `min-height: 0`, and their own
`overflow: auto`. Navigation, Properties, and Summary scroll independently.
PLB address space and Status also scroll independently when their contents do
not fit. Any horizontal overflow caused by preserving three columns belongs to
the affected pane, never to the Webview page.

Changing between Validation, Address, IRQ, Ports, or Dependencies, selecting a
short property form, or displaying 32 interrupt routes may change only the
pane's scroll extent. For a fixed viewport and toolbar/banner state, the lower
band's top coordinate, bottom coordinate, and height must be identical before
and after those content changes.

## 6. Error Handling and Compatibility

- Invalid source configuration remains byte-preserving and read-only in the
  custom editor.
- A malformed, unsupported, or unsafe manifest stops generation before any
  output change and remains excluded from artifact recovery.
- Output ownership conflicts retain the existing Adopt Output workflow.
- Modified managed output retains normal-generation conflict protection and
  explicit Force Generate behavior, except that user `main.c` is never forced.
- Firmware source read failures are reported before activation and leave the
  current output unchanged.
- Duplicate module definitions in the assembled RTL are a generator/test
  failure, not something delegated to downstream synthesis.
- The generated top module, parameter values, ports, address map, APB grouping,
  PLB routing, and interrupt behavior remain equivalent to the current planned
  SoC.

## 7. Testing Strategy

Implementation follows test-driven development. Contract tests are changed
first and must fail against the current multi-file output and responsive
layout.

### 7.1 Generator and migration tests

- Exact file inventories for minimal, full-peripheral, external-interface,
  debug, internal-memory, and no-firmware configurations.
- Single-file ordering, source separators, one copy per required module,
  absence of `` `include``, deterministic bytes, and absence of removed files.
- README tables cover every resolved configuration category and contain the
  same addresses, parameters, interrupts, ports, firmware paths, and module
  list represented by the plan.
- Firmware retains its original bytes and extension, disambiguates ILB/DLB
  names, and produces the correct relative RTL parameter.
- Manifest v2 allowlisting, ownership, hashes, conflicts, force behavior,
  atomic activation, and recovery.
- Every v1 migration case, including unchanged and modified stale files,
  firmware relocation, exact `main.c` preservation, two-path collision, and
  unknown user files in obsolete directories.
- Artifact recovery accepts valid v1 and v2 records during transition, exposes
  the correct v2 compact files, and rejects forged paths or records.

### 7.2 RTL tests

Every generated RTL matrix case invokes Icarus with only
`hardware/<project>.v`. Existing transaction, reset, grouped APB, sparse PLB,
external bridge, interrupt-controller, and top-port checks remain. Full cases
also assert that each expected module elaborates from the single file and no
duplicate module is present.

### 7.3 Browser geometry tests

The visual harness gains browser-level geometry assertions rather than relying
only on CSS text matching or JSDOM. At wide, medium, narrow, and short
viewports, it records bounding rectangles and scroll metrics for the shell,
three upper panes, and two lower panes.

For each viewport it switches between short content, the Ports table, and 32
interrupt routes and asserts:

- The shell exactly covers the viewport and the document has no page-level
  horizontal or vertical scroll.
- Navigation, Properties, and Summary share one upper row in left-to-right
  order; PLB address space and Status share one lower row.
- The lower band remains inside the viewport and its top, bottom, and height do
  not change across content states.
- Overflowing content has `scrollHeight > clientHeight` in its own pane and is
  reachable by wheel/scroll without moving the shell or another row.
- Pane rectangles do not overlap, controls remain reachable, and text does not
  occlude neighboring panes.

The browser suite captures screenshots for the extreme route and Ports cases
to make layout regressions inspectable. DOM interaction tests for navigation,
generation lifecycle, focus restoration, route edits, and summary tabs remain
in place.

### 7.4 Release verification

Run TypeScript compilation, the complete `npm test` and SoC test matrix,
single-file Icarus simulations, extension-host configurator tests, resource
closure checks, VSIX dependency and smoke tests, and browser geometry tests.
Inspect the packaged VSIX rather than only the source tree to prove the updated
template, generator, Webview CSS, and scripts are shipped.

## 8. Acceptance Criteria

1. A new generated SoC contains only the documented shallow layout, with one
   Verilog file and no redundant address/resolved JSON, file list, or generated
   license.
2. `hardware/<project>.v` alone compiles and simulates every supported SoC
   matrix case as Verilog-2005.
3. Firmware is separate, byte-identical to its source, and referenced through
   `../firmware/...`; README documents the current `$readmemh` limitation.
4. README completely describes the resolved address map, CPU, memories,
   modules, interfaces, interrupts, ports, parameters, files, and integration
   command.
5. Manifest v2 preserves ownership, hashing, conflict, force, recovery, and
   Artifacts behavior without trusting arbitrary paths.
6. Regenerating a v1 output safely removes unchanged obsolete generated files,
   relocates firmware, and preserves old `software/src/main.c` byte-for-byte.
7. A modified stale managed file conflicts normally; a simultaneous old and new
   `main.c` always conflicts and neither file is changed.
8. At every tested viewport the editor remains upper-three/lower-two, fills the
   viewport, has no page scroll, and uses pane-local scrolling.
9. Long Ports or interrupt content cannot change the PLB/Status band's
   position or size.
10. Existing editor interactions, generation recovery, SoC behavior, and
    configuration compatibility continue to pass their regression suites.

## 9. Out of Scope

- Changing the `*.merc32.json` schema or the configured output directory.
- Converting firmware between memory formats or embedding firmware in Verilog.
- Changing `$readmemh` to a format-aware runtime loader.
- Splitting the generated RTL by module or generating vendor project files.
- Changing the grouped built-in APB architecture or external endpoint routing.
- Replacing the Webview implementation with a frontend framework.
- Removing the source repository or extension package license.
