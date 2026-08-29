# MERC32 SoC Generator and VSCode Configurator Design

## 1. Purpose

Turn the existing MERC32 VSCode extension into an offline, configuration-driven
SoC generator. A user installs one VSIX, creates one or more `*.merc32.json`
files, edits each configuration through a graphical custom editor or as JSON,
and generates a self-contained RTL directory that can be added to another
project without access to the MERC32 repository.

The first release generates:

- A configured MERC32 SoC top level.
- Internal or external instruction and data memory connections.
- Any number of supported built-in APB peripheral instances.
- Any number of mapped external Local Bus, APB, AXI4-Lite, Wishbone, Avalon, or
  DRP endpoints.
- Optional direct or controller-based interrupt routing.
- All required CPU, memory, bridge, debug, and peripheral RTL.
- A deterministic RTL file list and machine-readable address map.
- A generated C configuration header.
- A starter `main.c` only when one does not already exist.

The release does not generate FPGA vendor projects, constraints, synthesis
scripts, or user-facing testbenches.

## 2. Design Principles

1. The checked-in RTL is the authoritative hardware source. Packaged RTL is a
   build artifact of the VSIX.
2. Peripheral RTL is opaque. The generator uses catalog metadata and never
   parses, rewrites, or derives behavior from protected RTL text.
3. The CPU keeps a small, stable interface. Configuration-dependent wiring
   belongs in the generated SoC layer.
4. A configuration is the only source of project state. The graphical editor
   does not keep a private copy.
5. Generation is deterministic, validates everything before writing, and does
   not silently overwrite user changes.
6. Generated RTL remains compatible with Verilog-2005.
7. The generator core is independent of the VSCode API so a later CLI can use
   exactly the same behavior.

## 3. Locked CPU Address ABI

The first locked MERC32 hardware and software address ABI is:

| Region | Inclusive byte address range | Capacity |
|---|---:|---:|
| ILB | `0x00000000` - `0x07FFFFFF` | 128 MiB |
| DLB | `0x08000000` - `0x0FFFFFFF` | 128 MiB |
| PLB | `0x10000000` - `0xFFFFFFFF` | 3840 MiB |

These boundaries are fixed and are not configuration parameters. The old DLB
base at `0x00800000` is removed without a compatibility mode or address-map
version. All repository software, examples, tests, compiler defaults, and ABI
documentation move to `0x08000000` in the same change.

`merc32_core` decodes the regions using `0x08000000` and `0x10000000` as the two
thresholds. ILB and DLB continue to expose word offsets relative to their
regions. Therefore, DLB byte address `0x08000000` appears as word address zero
on the DLB Local Bus.

`ILB_ADDR_WIDTH` and `DLB_ADDR_WIDTH` remain word address widths and may not
exceed 25. A 25-bit word address covers the complete 128 MiB region. Internal
memory sizes must be powers of two, divisible by four bytes, and fit their
fixed region.

## 4. RTL Layering

### 4.1 `merc32_core`

`merc32_core` contains the CPU architecture and the fixed ILB, DLB, and PLB
decode. It retains one interrupt input and the existing debug request interface.
No configurable SoC interconnect or peripheral logic is added to the core.

### 4.2 `MERC32_top`

`MERC32_top` becomes the stable CPU distribution wrapper. It contains:

- `merc32_core`.
- Optional JTAG debug logic controlled by `DEBUG_EN`.
- External ILB, DLB, and PLB Local Bus ports.

The current `IF_AXI_LITE`, `IF_APB`, `IF_WBC`, `IF_AVALON`, and `IF_DRP`
preprocessor selection is removed. The wrapper no longer instantiates an
external protocol bridge. Its PLB ports use an explicit `plb_*` naming scheme.
JTAG ports remain part of this stable wrapper; when debug is disabled, the
existing tie-off behavior is retained.

### 4.3 Generated `<project>_soc`

The generated SoC top level instantiates `MERC32_top` and all configured system
components. It decides whether ILB and DLB connect to internal `spram` instances
or appear as external Local Bus ports. It also instantiates the generated PLB
router, protocol bridges, the built-in APB subsystem, peripheral instances, and
interrupt wiring.

The generated top exposes only ports that the configuration needs. For example,
JTAG pins are exposed only when debug is enabled, and ILB Local Bus pins are
exposed only when ILB uses external memory.

## 5. Memory Configuration

ILB and DLB are configured independently. Each supports:

- `internal_ram`: instantiate the packaged `spram`, configure its word address
  width from the selected byte size, and optionally copy an initialization file.
- `external_local_bus`: expose the corresponding registered Local Bus through
  the generated SoC top.

An initialization file is copied into the generated `memory/` directory. The
generated SoC top provides an initialization-file parameter with the copied
path as its default so an integrating project can override it.

The source configuration may express byte sizes as unsigned integers or IEC
strings such as `32KiB`. The resolved configuration always writes integer byte
counts.

## 6. PLB Routing and External Endpoints

### 6.1 Router behavior

The generated PLB router is a single-master, single-outstanding-transaction
router. It accepts the CPU request pulse, records the selected endpoint, forwards
the request and payload, and keeps the response selection stable until that
endpoint acknowledges. This matches the existing MERC32 Local Bus request and
acknowledgement contract.

Each endpoint has an explicit inclusive range derived from `baseAddress` and
`windowSize`. Overlaps are errors. An unmapped access is not acknowledged,
preserving current CPU behavior.

### 6.2 Built-in APB subsystem

All built-in APB peripherals share one `lb2apb` bridge. A generated N-way APB
decoder replaces the fixed four-way `apb4_interconnect`. It creates one select
per configured instance and multiplexes response data and ready. The existing
fixed interconnect may remain for legacy users but is not used by generated
systems.

APB peripherals receive the full bridge address; existing modules continue to
decode their low register-address bits. Peripheral catalog entries state their
required address size and alignment.

### 6.3 External endpoints

External Local Bus, APB, AXI4-Lite, Wishbone, Avalon, and DRP endpoints are
modeled as repeatable mapped endpoints. A SoC may contain multiple instances of
the same or different protocols.

Each endpoint separately configures:

- `baseAddress`: the CPU-visible PLB base.
- `windowSize`: the CPU-visible decode size.
- `addressWidth`: the downstream protocol address-port width.
- Protocol-specific bridge parameters.

Downstream addresses always use the low configured bits of the absolute CPU
address:

```verilog
assign endpoint_addr = plb_addr[ENDPOINT_ADDR_WIDTH-1:0];
```

There is no relative/absolute mode. A 12-bit port naturally emits
`0x000` - `0xFFF`; a 32-bit port retains the complete absolute address.

Validation requires `windowSize <= 2^addressWidth`. When `addressWidth < 32`,
`baseAddress` must be aligned to `2^addressWidth`, which guarantees the mapped
window begins at downstream address zero. All ranges must remain inside PLB and
all address arithmetic uses unsigned 32-bit semantics.

## 7. Interrupt Architecture

The CPU retains one interrupt input. The generated system supports three modes:

- `none`: tie the CPU interrupt input to zero and emit no interrupt routing.
- `direct`: connect exactly one selected peripheral interrupt or top-level
  external interrupt directly to the CPU.
- `controller`: require one `apb_intc` peripheral and route configured sources
  through it.

Only one `apb_intc` instance is allowed in the first release. Peripheral
instances may expose interrupts without connecting them; this produces a
warning, not an implicit assignment.

### 7.1 `apb_intc` distribution contract

The interrupt controller is distributed as the single, self-contained file:

`rtl/apb_intc/apb_intc.v`

It is Verilog-2005, has no include files or child module dependencies, and keeps
a stable public module and file name so the source can later be maintained in a
private repository and replaced by a protected, flattened implementation.

The controller parameters are:

- `IRQ_COUNT`, from 1 through 32.
- `IRQ_MODE`, two constant bits per source with the normative encoding
  `0` = high level, `1` = low level, `2` = rising edge, and `3` = falling
  edge.

All controller inputs are synchronous to its APB clock. Generated top-level
external sources are synchronized before entering the controller. Internal APB
peripheral sources share the clock and connect directly.

Edge events latch in pending state. A level source becomes pending while its
configured active level is present; clearing it while the source remains active
allows it to become pending again. Enabled pending source zero has the highest
fixed priority. The controller output is high-level active and software
configures the CPU interrupt mode accordingly. Tiny C controller firmware uses
the no-argument `__irq_enable_level()` intrinsic, which emits interrupt control
value `5`; legacy `__irq_enable()` continues to emit rising-edge control value
`1`, and `__irq_disable()` continues to emit `0`.

The APB register map is:

| Offset | Name | Access | Meaning |
|---:|---|---|---|
| `0x00` | `RAW` | RO | Trigger-normalized current source state |
| `0x04` | `PENDING` | RO | Latched pending sources before enable masking |
| `0x08` | `ENABLE` | RW | Interrupt enable mask |
| `0x0C` | `ENABLE_SET` | WO | W1S enable bits |
| `0x10` | `ENABLE_CLEAR` | WO | W1C enable bits |
| `0x14` | `PENDING_SET` | WO | W1S software-pending bits |
| `0x18` | `PENDING_CLEAR` | WO | W1C pending bits |
| `0x1C` | `ACTIVE` | RO | Bit 31 valid, bits 4:0 highest active source ID |
| `0x20` | `MODE_LO` | RO | Trigger modes for sources 0 through 15 |
| `0x24` | `MODE_HI` | RO | Trigger modes for sources 16 through 31 |

Bits above `IRQ_COUNT` read as zero and ignore writes. APB byte strobes are
honored. The generated C header records every assigned source ID and trigger
mode.

### 7.2 Source ownership and protected release

The readable `apb_intc` implementation is developed and verified before its
release form is produced. At the end of the controller task:

1. Copy the verified readable source to
   `D:\Development\Projects\ip-repo\intc\apb_intc.v`.
2. Run `rtl lib index`, `rtl lib status`, and `rtl lib deps apb_intc` from the
   IP repository to verify its library entry and dependency closure.
3. Package from the IP repository with:

   ```powershell
   rtl lib pack --flat --encrypt apb_intc `
     D:\Development\Projects\simple_cpu\rtl\apb_intc\apb_intc.v --force
   ```

4. Re-run the standalone controller testbench and generated-SoC elaboration
   against that packaged file, then record its nonzero size and SHA-256 without
   printing its protected body.

The readable implementation remains in the IP maintenance repository. This
repository retains only the single flattened protected distribution file at
`rtl/apb_intc/apb_intc.v`. Its stable public module, parameters, ports, and
behavior remain the catalog contract. The interrupt-controller programming
manual is deliberately excluded from this project and will be written in the
IP maintenance repository by its separate maintainer.

## 8. Configuration File

### 8.1 Naming and editor association

Configurations use the compound suffix `*.merc32.json`, for example:

- `minimal.merc32.json`
- `debug.merc32.json`
- `control-board.merc32.json`

The VSCode custom editor selector matches only `*.merc32.json` and has default
priority. Ordinary JSON files are unaffected. Users can reopen a configuration
with the normal text editor at any time. Multiple configurations may coexist in
one workspace and generate different SoCs.

### 8.2 Source shape

Every source configuration has `schemaVersion: 1`. This version migrates future
configuration syntax; it is not an address-map compatibility version.

An illustrative configuration is:

```json
{
  "schemaVersion": 1,
  "project": {
    "name": "demo_soc",
    "outputDir": "generated/demo_soc"
  },
  "cpu": {
    "debug": true,
    "jtagIdCode": "0x4d320001"
  },
  "memory": {
    "ilb": {
      "type": "internal_ram",
      "size": "32KiB",
      "initFile": "firmware.mem"
    },
    "dlb": {
      "type": "external_local_bus",
      "size": "64KiB"
    }
  },
  "peripherals": [
    {
      "type": "apb_uart",
      "name": "uart0",
      "baseAddress": "0x10000000",
      "parameters": {
        "SYS_CLK_FREQ": 50000000,
        "FIFO_DEPTH": 8
      }
    },
    {
      "type": "apb_intc",
      "name": "intc0",
      "baseAddress": "0x10001000"
    }
  ],
  "externalInterfaces": [
    {
      "type": "axi4_lite",
      "name": "axi0",
      "baseAddress": "0x20000000",
      "windowSize": "16MiB",
      "addressWidth": 32
    }
  ],
  "interrupt": {
    "mode": "controller",
    "controller": "intc0",
    "sources": [
      {
        "source": "uart0.interrupt",
        "id": 0,
        "trigger": "high"
      }
    ]
  }
}
```

Source addresses are hexadecimal strings to remain readable and avoid host
language signed conversion. Resolved addresses use normalized eight-digit
hexadecimal strings. `outputDir` is resolved relative to the configuration file.

### 8.3 Schema and semantic validation

The VSIX registers a bundled JSON Schema only for `*.merc32.json`. The build
generates the schema from catalog definitions so configuration, UI, and runtime
validation share one set of parameter constraints.

Schema validation covers shape and primitive constraints. Generator semantic
validation covers:

- Legal and unique Verilog identifiers.
- Unique instance and top-level port names.
- Known module and protocol types.
- Parameter types, ranges, enums, and power-of-two requirements.
- Memory capacity and word address widths.
- Address alignment, overflow, and overlaps. Sparse holes are valid and are
  reported in the address summary rather than rejected.
- External endpoint address-width constraints.
- Valid interrupt source references, IDs, modes, and controller count.
- Complete packaged RTL and template dependencies.

Unknown fields are errors unless the schema explicitly designates an extension
object.

## 9. Module Catalog

The module catalog is packaged separately from RTL. A peripheral entry records:

- Public type and Verilog module name.
- Exact RTL distribution file list.
- Whether multiple instances are allowed.
- Address size and alignment.
- Parameter definitions and constraints.
- APB connection contract.
- Physical top-level ports, including widths derived from parameters.
- Interrupt outputs.
- Software register metadata when available.

For example:

```json
{
  "type": "apb_uart",
  "module": "apb_uart",
  "rtlFiles": ["rtl/apb_uart/apb_uart.v"],
  "multiple": true,
  "addressSize": 4096,
  "parameters": {
    "SYS_CLK_FREQ": {
      "type": "integer",
      "minimum": 1,
      "default": 50000000
    },
    "FIFO_DEPTH": {
      "type": "powerOfTwo",
      "minimum": 2,
      "default": 8
    }
  },
  "ports": [
    { "name": "uart_rx", "direction": "input", "width": 1 },
    { "name": "uart_tx", "direction": "output", "width": 1 }
  ],
  "interrupts": ["interrupt"]
}
```

The first release accepts only bundled catalog entries. A future release may
load reviewed third-party descriptors, but arbitrary plugin loading is not part
of this scope.

## 10. Generator Architecture

The implementation is divided into five VSCode-independent layers:

1. Configuration parser and source-location mapper.
2. Module and protocol catalog.
3. Schema and semantic validator.
4. Immutable normalized SoC intermediate representation.
5. RTL, manifest, address-map, and software emitters.

The data flow is:

```text
*.merc32.json
  -> schema validation
  -> catalog-aware semantic validation
  -> address, IRQ, port, and dependency planning
  -> immutable normalized SoC model
  -> deterministic output emitters
```

Instances and dependencies are sorted by stable names and numeric addresses.
The same configuration and packaged asset version must produce byte-identical
generated files.

The generated physical port convention prefixes catalog port names with the
instance name, such as `uart0_uart_rx` and `uart0_uart_tx`. Dynamic-width ports
derive their width from validated instance parameters.

The software emitter consumes the same normalized model as the RTL emitter. It
never reparses source JSON, which prevents software constants from diverging
from generated hardware.

## 11. VSIX Resource Packaging

The installed extension contains:

```text
resources/
  rtl/
  catalog/
  schema/
  templates/
  licenses/
```

Repository-root `rtl/` remains authoritative. Before VSIX packaging, a resource
preparation script:

1. Loads all bundled catalog entries.
2. Builds an allowlist of required RTL and license files.
3. Copies those files into `merc32-vsce/resources/rtl` while preserving logical
   paths.
4. Fails on a missing dependency or case mismatch.
5. Writes a resource manifest with file hashes and the source revision.
6. Generates the JSON Schema from catalog definitions.

The VSIX ignore rules include prepared resources and exclude development source,
tests, and `node_modules` content not required at runtime. Installed code locates
assets through `ExtensionContext.extensionUri`; it never assumes a sibling
repository or downloads RTL.

Protected, flattened peripheral RTL is copied as an opaque file. Replacing a
file with a new protected implementation does not require generator changes as
long as its path, module name, parameters, and ports retain their catalog
contract.

## 12. VSCode User Experience

### 12.1 Custom text editor

`*.merc32.json` opens by default in a three-column custom text editor:

- Left: CPU, memories, APB peripheral instances, external endpoints, and an add
  action.
- Center: editable properties for the selected object.
- Right: current address, IRQ, port, dependency, and validation summary.
- Bottom: a persistent PLB address-space overview and generation status.
- Top: auto-assign addresses, validate, and generate actions.

The editor uses the backing `TextDocument`. UI changes apply structured JSON
edits through `WorkspaceEdit`, preserving formatting where practical and
participating in native dirty state, save, undo, and redo. Text-editor changes
refresh the webview. Invalid or incomplete JSON is never replaced; the graphical
editor becomes read-only, reports the parse location, and offers to reopen the
text editor.

The webview uses a strict content security policy, local packaged assets, a
nonce, and validated message payloads. Generation and file access stay in the
extension host, not in the webview.

### 12.2 Activity bar

The existing MERC32 activity bar remains and organizes:

- `SoC Configurations`: create and open workspace `*.merc32.json` files.
- `Generate`: validate, auto-assign, generate, and explicitly force regeneration.
- `Toolchain`: retain current ASM and Tiny C commands.
- `Artifacts`: list compiler outputs and recent generated SoC directories and
  manifests.

The activity bar is an entry and status surface, not a compressed copy of the
full configurator.

### 12.3 Address assignment

The UI offers automatic assignment, but every assigned base address is written
explicitly into the source configuration. Adding or deleting another endpoint
never silently relocates an existing endpoint. Manual editing is allowed and
immediately validated.

Automatic assignment keeps every existing explicit address. It visits only
unassigned entries in source-array order and places each at the lowest aligned
free PLB address at or above `0x10000000`. Alignment uses the catalog alignment
for built-in peripherals and `2^addressWidth` for a narrow external endpoint.
The command previews every proposed address before one structured edit writes
them to the configuration.

## 13. Generated Output

Each configuration writes a separate self-contained directory:

```text
generated/demo_soc/
  rtl/
    demo_soc.v
    generated/
      demo_soc_plb_router.v
      demo_soc_apb_interconnect.v
    cpu/
    debug/
    misc/
    bridge/
    apb_uart/
    apb_gpio/
    apb_intc/
    ... selected peripheral directories ...
    files.f
  memory/
    firmware.mem
  software/
    include/
      demo_soc.h
    src/
      main.c
  config/
    demo_soc.resolved.json
  address-map.json
  manifest.json
  README.md
  LICENSE
```

`demo_soc.v` is the integration top. `rtl/files.f` lists relative RTL paths and
is not a vendor project script. `address-map.json` is the only address-map
presentation; no Markdown address map is generated. `README.md` documents the
top module, parameters, ports, file list, and generation identity.

The generated header contains selected memory sizes, peripheral base addresses
and sizes, external windows, interrupt IDs and trigger modes, and available
feature macros. It defines `MERC32_IRQ_TRIGGER_HIGH`,
`MERC32_IRQ_TRIGGER_LOW`, `MERC32_IRQ_TRIGGER_RISING`, and
`MERC32_IRQ_TRIGGER_FALLING` with values `0` through `3`, respectively, plus a
`<PROJECT>_<INSTANCE>_IRQ_TRIGGER` macro for every assigned controller source.
It uses object-style macros accepted by the Tiny C preprocessor.

`software/src/main.c` is a scaffold and is user-owned:

- Create it only if the path does not exist.
- If it exists, skip it without prompting, hashing, replacing, or deleting it.
- Record it in the manifest as `scaffold/user-owned`, not as a managed generated
  file.
- Include the generated header by a relative quoted include.

Future driver files are managed separately from `software/src` application
files so driver updates never overwrite user programs.

## 14. Safe Regeneration and Diagnostics

All parsing, validation, planning, rendering, and packaged-dependency checks
complete before managed target files are changed. New content is first written
to a sibling temporary directory and verified.

`manifest.json` records every managed file's SHA-256 hash, logical source,
generator version, and packaged resource revision. On regeneration:

- Only files listed as managed by the previous manifest may be replaced.
- A managed file whose current hash differs from the old manifest causes a
  conflict and is not overwritten by default.
- Force regeneration is an explicit user command and may replace conflicted
  managed files after confirmation.
- A stale managed file is removed only when its content still matches the old
  manifest.
- Files not owned by the manifest are never removed.
- `main.c` is always skipped when present, including force regeneration.

The manifest also records the source configuration identity and project name.
If another `*.merc32.json` already owns the selected output directory,
generation stops instead of adopting or replacing its files. Moving or
renaming a configuration requires an explicit output-directory adoption action;
force regeneration alone does not bypass this ownership check.

Semantic problems create VSCode diagnostics on the corresponding JSON range.
The graphical editor marks the same fields. The MERC32 output channel records
the generation summary, resolved address table, warnings, and file conflicts.

Fatal errors include invalid JSON, unknown modules, illegal identifiers,
parameter violations, overlaps, invalid interrupt references, missing packaged
assets, and write failures. Unconnected peripheral interrupts and unused
optional external signals are warnings.

## 15. Tiny C Preprocessor

The first release adds a minimal preprocessing stage so generated headers are
usable by the built-in compiler. It supports:

- Quoted `#include "..."` resolved relative to the including file.
- Object-style `#define`.
- `#undef`.
- `#if`, `#ifdef`, `#ifndef`, `#else`, and `#endif`.
- Conventional include guards.

It does not initially support function-style macros, system includes using
angle brackets, token pasting, stringification, variadic macros, or a standard C
library.

Macro replacement is token-aware and does not modify strings or comments.
Diagnostics retain the original include file and line. Include cycles and a
bounded include-depth violation are errors. The generated header deliberately
uses only the supported subset.

The default Tiny C data base changes to `0x08000000`. The public compiler API
accepts `dataBase` only in `0x08000000` through `0x0FFFFFFF` and accepts
`dlbAddrWidth` only in `1` through `25`. The exclusive limit
`dataBase + 2^(dlbAddrWidth + 2)` may equal but never exceed `0x10000000`, so
stack and static-data calculations remain inside the fixed DLB region.

## 16. Verification

### 16.1 RTL and address ABI

- Add exact CPU decode boundary tests at `0x07FFFFFF`, `0x08000000`,
  `0x0FFFFFFF`, and `0x10000000`.
- Migrate and run all existing CPU, JTAG, Tiny C, and peripheral regressions.
- Verify DLB word offset zero for byte address `0x08000000`.
- Verify 25-bit maximum ILB and DLB word addressing.

### 16.2 Interrupt controller

The standalone `apb_intc` testbench covers reset, APB byte strobes, enable
read/write/set/clear, software pending, W1C pending, all four trigger modes,
short edge events, persistent levels, source masking, fixed priority, active ID,
unused bits, `IRQ_COUNT` limits, and one-cycle output transitions.

### 16.3 Generator

Unit tests cover configuration parsing, source ranges, identifier checks,
catalog lookup, parameter constraints, address alignment and overlap, unsigned
overflow, memory sizing, interrupt references, dependency closure, and stable
ordering.

Golden tests require byte-identical output for repeat generation. Ownership
tests cover modified managed files, explicit force behavior, stale files,
unmanaged files, and an existing `main.c` whose contents and timestamp must not
change.

Icarus Verilog-2005 elaborates generated matrices for:

- Minimal CPU, external ILB/DLB, no interrupts.
- Internal ILB/DLB RAM.
- Multiple instances of one APB peripheral type.
- Multiple APB types and `apb_intc`.
- Multiple simultaneous external protocols.
- 12-bit and 32-bit downstream address ports.
- Debug disabled.
- A maximal configuration containing every bundled peripheral type.

The generated `rtl/files.f` is the only input list used for these elaboration
checks, proving there is no implicit repository dependency.

### 16.4 Tiny C

Tests cover include resolution, nested includes, include guards, object macro
replacement, conditional compilation, `#undef`, comment and string isolation,
cycles, depth limits, and source diagnostics. A generated `main.c` and header
must compile through ASM to ROM. Existing software is regenerated at the new DLB
base and continues to pass simulation.

### 16.5 VSCode and VSIX

Extension tests cover default custom-editor association, graphical/text
synchronization, save, undo/redo, invalid JSON behavior, diagnostics, generation
commands, and artifact refresh.

Packaging tests inspect VSIX contents for the catalog, schema, templates,
licenses, and every catalog dependency. An installation smoke test in a clean
directory with no MERC32 checkout performs an offline generation and elaborates
its `rtl/files.f`.

## 17. Delivery Phases

### Phase 1: usable offline SoC generation

- Lock and migrate the new address ABI.
- Refactor the stable CPU wrapper.
- Implement and verify the interrupt controller, migrate its readable source to
  the IP maintenance repository, and retain only its verified flattened
  protected single-file package in this repository.
- Implement catalog, schema, validator, normalized model, and emitters.
- Implement the `*.merc32.json` graphical custom editor and activity-bar entry.
- Package all RTL and resources in the VSIX.
- Generate self-contained RTL, address JSON, C header, and optional starter
  `main.c`.
- Add the Tiny C minimal preprocessor.

### Phase 2: software ecosystem

- Add complete register metadata to peripheral catalog entries.
- Generate register field masks and typed instance constants.
- Add stable UART, GPIO, Timer, I2C, and later peripheral drivers.
- Build the active SoC application's `main.c` directly from its configuration.
- Feed the resulting ROM image back into configured internal ILB memory.

### Phase 3: automation and ecosystem

- Add a CLI that reuses the generator core.
- Add presets, configuration cloning, and address-map comparison.
- Add reviewed third-party module descriptors.
- Optionally emit standard register descriptions such as SVD.

### Later candidates

- A VSCode Debug Adapter over the existing JTAG transport.
- Clock/reset domain descriptions and CDC bridges.
- DMA, ROM, and shared-memory endpoint types.
- Address-space and FPGA resource estimates.
- Private-maintenance-repository tooling that publishes protected single-file
  RTL and matching catalog metadata.

FPGA vendor project generation, constraints, and generated testbenches remain
outside these phases unless separately requested.

## 18. Scope Boundaries

This project changes the CPU address thresholds and software defaults but does
not otherwise change the ISA or CPU execution model. It stabilizes the CPU
wrapper, adds one interrupt controller, adds generated interconnect glue, and
substantially extends the VSCode extension and Tiny C front end.

It does not make protected peripherals editable, infer peripheral metadata from
RTL, support arbitrary third-party plugins in the first release, generate FPGA
projects, write the interrupt-controller programming manual, or preserve the
pre-lock `0x00800000` DLB mapping.
