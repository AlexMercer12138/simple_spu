# Task 3 Report: MERC32 Custom Text Editor

## Result

Implemented the three-column `CustomTextEditorProvider`, its packaged CSS/JavaScript workbench,
and the staged versioned webview protocol. The backing `TextDocument` remains the only mutable
configuration state. Provider registration is exposed through `Merc32SocEditorProvider.register`
for the extension composition task; Task 4 command registration was not implemented.

## RED Evidence

The initial expanded unit contract failed before provider implementation:

```text
npm run test:soc:vsce:unit
Error: Cannot find module '../out/socEditorProvider'
```

Two security/behavior refinements were also driven through explicit RED failures:

```text
accepted invalid message: {"type":"setValue",...,"value":"C:\\outside"}
view model leaked an absolute project output path
controller interrupt routes cannot be added or removed
```

The first one-edit GREEN attempt exposed and corrected a test mistake: the minimal replacement for
`false` to `true` is `tru` because the common trailing `e` is preserved. The test now reconstructs
and asserts the resulting document rather than assuming a whole-token replacement.

## GREEN Evidence

```text
npm run test:soc:vsce:unit
MERC32 VSCode SoC unit contracts passed.

npm run test:soc:config
MERC32 SoC configuration tests passed.

node --check resources/webview/socEditor.js
exit 0

git diff --check
exit 0
```

## View Structure

- Top toolbar: Auto-assign, Validate, Generate, and Reopen as Text actions.
- Left navigation: Project, CPU, ILB, DLB, APB instances, external endpoints, interrupt routing,
  catalog-backed add controls, and instance remove controls.
- Center properties: boolean checkboxes, text/numeric fields, type and enum selects, catalog-backed
  module parameter inputs, and editable controller interrupt routes.
- Right summary: Validation, Address, IRQ, Ports, and Dependencies tabs.
- Bottom band: stable-height PLB endpoint overview and generation status.
- Responsive behavior: the exact three-track desktop grid collapses to one column at 760 px;
  compact fields and toolbar actions wrap again at 440 px.

Invalid or schema-incomplete JSON produces a read-only snapshot with safe empty planning summaries,
line/column diagnostics, disabled configuration actions, and only Reopen as Text available as a
recovery command.

## Protocol And Host Safety

- `select`, `setValue`, `addInstance`, and `removeInstance` now require a positive integer
  `documentVersion`; stale versions are rejected before selection or mutation dispatch.
- Command-only messages remain exact, versionless, and closed to additional keys.
- Encoded JSON messages are rejected above exactly 65,536 UTF-8 bytes before the type switch.
- Dangerous keys, unsupported schema paths, host paths, traversal, URIs, and packaged asset paths
  are rejected. Host-to-webview configuration presentation redacts any manually typed host or asset
  path without mutating the backing document.
- Every mutation reparses the current document, checks catalog/schema editability, validates the
  prospective structured result, and applies exactly one `WorkspaceEdit` replacement. No save is
  requested.
- Panel messages are serialized, document-change subscriptions are URI/version filtered, and every
  panel-local subscription is disposed with the panel. No mutable configuration copy is cached.
- HTML contains one nonce-bearing local script, the exact strict CSP, no remote URL, no inline event
  handler, and only resources below `resources/webview`. Browser rendering uses `textContent` and
  DOM construction, never an HTML string sink.

## Self-Review

- Confirmed state summaries use real `parseSocConfig`, `planSoc`, and immutable catalog metadata.
- Confirmed failed/stale/schema-invalid edits post a fresh state plus nonfatal status and do not call
  `WorkspaceEdit`.
- Confirmed CSS uses VSCode theme variables, 4/8 px spacing, radii no larger than 8 px, stable grid
  tracks, fixed desktop bottom-band dimensions, and no viewport-scaled typography or overlapping
  absolute positioning.
- Confirmed protected RTL was not inspected.
- Real VSCode host interaction and visual screenshots remain intentionally deferred to Task 6 by
  the approved plan.
