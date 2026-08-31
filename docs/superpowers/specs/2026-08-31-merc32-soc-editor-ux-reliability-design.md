# MERC32 SoC Editor UX and Reliability Design

## 1. Purpose

Improve the existing VS Code custom editor for `*.merc32.json` so that dense
SoC configurations remain practical to edit and navigation remains responsive
before, during, and after generation.

The work retains the current dependency-free Webview, structured JSON editing,
strict message validation, and native `TextDocument` ownership. It does not
replace the editor with a frontend framework or change the SoC configuration
schema.

## 2. Confirmed Problems

### 2.1 Navigation labels overlap

Every navigation row reserves a fixed 32 px prefix column. Short values such as
`PRJ`, `CPU`, `ILB`, and `DLB` duplicate the adjacent label. The interrupt row
puts the full mode name in the same column, so `CONTROLLER` overflows into
`Interrupts`.

### 2.2 The persistent lower band is not persistent

The desktop shell reserves a fixed lower row for the PLB address overview and
status. At widths below 800 px, the responsive rule changes the shell to
content height, removes its overflow boundary, and lets all three workbench
panes expand in document flow. A long interrupt route form consequently pushes
the PLB and status sections beyond the viewport.

### 2.3 Generation can block all navigation

Each Webview message is appended to one panel-local Promise queue. A Generate
message owns that queue while the extension saves the document, generates the
SoC, records artifacts, and awaits the best-effort `revealFileInOS` command.
Selection messages received during that interval cannot execute.

Selection messages also carry `documentVersion` even though they do not mutate
the document. A save-time or external document update makes queued selections
stale. Several clicks can therefore be rejected in sequence before a fresh
state reaches the Webview. Closing and reopening the custom editor creates a
new panel session and a new queue, which explains the observed recovery.

### 2.4 Existing tests miss the failure boundary

Current unit coverage checks static HTML/CSS markers, protocol validation,
view-model construction, and command status ordering. Extension-host coverage
tests generation and document editing through command APIs. No test drives a
panel session through Ready, Generate, and a later Select message, and no test
asserts lower-band visibility with many interrupt routes.

## 3. Design Principles

- Navigation remains usable while validation, generation, or an optional OS UI
  action is running.
- Only document mutations require an exact document version.
- Full state snapshots are delivered in order; redundant refresh requests may
  be coalesced but an older snapshot must never replace a newer selection.
- The PLB overview and action status remain visible in a dedicated lower shell
  track at every supported editor width.
- Dense repeated data uses compact rows rather than vertically repeated field
  groups.
- The editor follows VS Code theme variables and native interaction patterns.
- The current CSP, local-resource boundary, and closed message protocol remain
  mandatory.

## 4. Layout

### 4.1 Shell

The shell always occupies `100vh` and always hides page-level overflow. Its rows
are:

1. Toolbar.
2. Optional invalid-JSON banner.
3. `minmax(0, 1fr)` workbench.
4. A bounded lower information track.

The lower track uses a stable responsive height rather than participating in
the workbench content flow. Address entries and status text scroll inside their
own sections if they exceed that track.

### 4.2 Wide editors

Wide editors retain three columns: navigation, properties, and summary. Each
pane has `min-width: 0`, `min-height: 0`, and its own scrolling boundary. Long
property forms cannot resize the workbench or lower track.

### 4.3 Medium editors

Medium editors use two columns in the upper workbench. Navigation and
properties occupy the main row, while the summary spans both columns in a
bounded secondary row. All three panes continue to scroll independently.

### 4.4 Narrow editors

Narrow editors use one workbench column with a single internal vertical scroll
surface for navigation, properties, and summary. The shell itself remains
fixed, so the lower information track is still visible. The lower band stacks
PLB information over status inside its reserved track.

### 4.5 Toolbar

Remove the decorative `M32` mark and text-like pseudo-icons (`A+`, `OK`, and
`>`). The project name and concise command labels provide the necessary
identity and action meaning. Controls may wrap inside the toolbar without
changing the workbench's overflow rules.

The document subtitle reports user-meaningful state: `Saved`, `Unsaved
changes`, or `Read-only JSON`. Raw document version numbers are retained only
in the protocol and tests.

## 5. Navigation

Remove the prefix column and every per-item abbreviation. A row contains only
its primary label and, where applicable, a remove control. Instance type remains
available through the control title and in the property pane rather than as a
space-consuming badge.

Section count badges remain because they convey information not present in an
instance label. The selected row uses the native VS Code active-selection
colors and `aria-current`.

Navigation scroll position is preserved across document refreshes. A state
refresh for an edit must not jump the user back to the first section.

## 6. Property Editing

### 6.1 General fields

Fields retain schema-appropriate inputs. Optional fields use a compact clear
button with an accessible name. Controls are disabled only while their own
document mutation is awaiting a refreshed snapshot, not for the full duration
of generation.

When a refresh keeps the same selected object, preserve property scroll,
focused field, selection range, and summary scroll where possible. Selecting a
different object intentionally resets the property pane to its top.

### 6.2 Interrupt editor

Controller mode uses a compact route editor with one header and one row per
route. Each row has Source, IRQ ID, Trigger, and Remove columns. On narrow
editors a route row wraps into a stable two-column form.

The controller field is a select populated from `apb_intc` instances. Interrupt
source fields remain editable for `external.<identifier>` values but provide
catalog-derived peripheral interrupt suggestions. Direct mode uses the same
source suggestion set.

Add Route selects the lowest unused IRQ ID and is disabled at 32 routes. Remove
uses the current route index but is sent as a versioned document mutation, so a
stale removal cannot target a different route.

## 7. Summary and Lower Band

Summary tabs retain Validation, Address, IRQ, Ports, and Dependencies. Tabs use
complete tab semantics: `aria-controls`, roving `tabIndex`, Left/Right arrow
navigation, Home, and End.

Diagnostic rows become keyboard-accessible selection controls. Activating a
diagnostic selects the nearest configurable object for its JSON path and keeps
the diagnostic summary active.

The PLB lower band remains a compact scanning surface, not another editor. It
shows resolved endpoint name and range, scrolls internally, and does not expand
the shell. Status shows the active or most recent action and never serves as the
only indication that navigation was rejected.

## 8. Session and Message Architecture

### 8.1 Responsibilities

Extract panel-local scheduling from `Merc32SocEditorProvider` into a focused
session unit. The provider continues to own HTML construction, catalog loading,
view-model construction, and structured JSON policies. The session unit owns:

- current selection;
- readiness and disposal;
- the document-mutation queue;
- the current long-running action;
- ordered/coalesced state delivery;
- action status delivery.

This boundary makes the failure scenario testable without an Electron DOM.

### 8.2 Message lanes

Messages use three lanes:

- **Selection:** handled immediately against the current parsed document and
  never waits for a generation action. Selection messages do not contain or
  validate `documentVersion`.
- **Mutation:** `setValue`, `unsetValue`, `addInstance`, and `removeInstance`
  remain serialized and require an exact `documentVersion`.
- **Action:** Auto-assign, Validate, and Generate run independently of
  selection. Only one action may be active per panel; duplicate action requests
  are ignored with an explicit current status.

`reopenAsText` remains independent of all three lanes.

### 8.3 State delivery

All complete state snapshots pass through one ordered delivery scheduler. A
new request may coalesce an older request that has not started, but a started
post completes before the next begins. Each snapshot is built from current
document text and current selection immediately before posting.

Document change events schedule a state refresh. Successful mutations also
schedule a refresh explicitly, so correct UI recovery does not depend on event
timing. Action completion schedules a full refresh rather than posting only a
status transition.

### 8.4 Action status

Action status messages carry a monotonically increasing action identifier. The
Webview ignores status from an older action. Action controls disable while an
action is active; navigation, summary tabs, and pane scrolling remain enabled.

The best-effort output-directory reveal is launched after successful generation
without delaying action completion. A later reveal rejection is reported as a
warning through the existing output/error path and cannot retain the panel
session queue.

## 9. View Model and Protocol Changes

The view model adds:

- document saved/dirty presentation state;
- candidate interrupt controller names;
- candidate peripheral interrupt sources;
- active action identity and status.

The `select` message removes `documentVersion`. Mutation messages retain it.
Generation status adds its action identifier. All shapes stay closed, size
limited, JSON-only, and protected against unsafe property names and paths.

No host path, packaged resource path, or new executable capability is exposed
to the Webview.

## 10. Error Handling

- A stale mutation posts a fresh state and a concise status, then clears the
  Webview's mutation-busy state.
- An invalid selection path leaves the prior valid selection unchanged and
  posts the current state.
- A command rejection transitions the matching action to Error and posts a full
  state.
- Panel disposal prevents later status or state delivery but does not leave an
  unhandled rejected Promise.
- Invalid JSON remains read-only and byte-preserving, with Reopen as Text still
  available.

## 11. Testing

### 11.1 Protocol and view-model unit tests

- Accept version-independent selection messages and reject extra fields.
- Continue rejecting stale mutation messages.
- Present controller and interrupt-source candidates from the active catalog and
  configuration.
- Present Saved, Unsaved, and Read-only document states.
- Reject stale action-status identifiers in the Webview state reducer.

### 11.2 Session lifecycle tests

Use a fake document, Webview, and command executor to prove:

- Project, CPU, memory, and interrupt selections work before generation.
- Selection changes are delivered while Generate is unresolved.
- Selection still works after Generate resolves, rejects, or reports progress.
- Duplicate Generate requests do not start a second action.
- A document version change during generation does not invalidate selection.
- Mutations remain serialized and stale mutations refresh rather than overwrite.
- Disposing the panel during generation produces no later Webview posts or
  unhandled rejection.

### 11.3 DOM and layout tests

Run the packaged Webview script in a DOM harness with realistic view models.
Assert navigation, field edits, route add/remove, tabs, keyboard behavior, busy
states, focus restoration, and diagnostic selection by observable DOM state and
posted protocol messages.

Render wide, medium, and narrow fixtures with 32 interrupt routes. For each
viewport assert that:

- navigation labels do not overlap;
- the workbench has a bounded scroll surface;
- PLB and Status are inside the viewport;
- no control text overflows or occludes another control;
- route rows remain editable and removable;
- keyboard focus is visible.

### 11.4 Existing regression suites

Run TypeScript compilation, SoC VS Code unit tests, extension-host configurator
tests, resource packaging checks, and VSIX smoke tests. The generated SoC output
must remain byte-identical because this work does not alter generator planning
or emission.

## 12. Acceptance Criteria

1. No navigation item displays PRJ/CPU/ILB/DLB/type/mode prefix text.
2. Controller mode never overlaps the Interrupts navigation label.
3. PLB address space and Status remain visible with 1 through 32 routes at wide,
   medium, and narrow editor widths.
4. Excess workbench content scrolls inside the upper area and never expands the
   page shell.
5. Project, CPU, ILB, DLB, peripheral, endpoint, and interrupt selections remain
   responsive while Generate is unresolved and after it completes or fails.
6. Generate cannot be started twice from one panel while already active.
7. Rapid selection after a save or generation does not produce stale-version
   rejection.
8. Rapid document edits cannot silently overwrite a newer document version.
9. Route source/controller entry is suggestion-driven and 32 routes remain
   practical to scan and edit.
10. Scroll position, active summary tab, and same-object field focus survive a
    normal state refresh.
11. Invalid JSON behavior, CSP, message size limits, path redaction, native
    undo/redo, and generator output remain unchanged.

## 13. Out of Scope

- Changing the `*.merc32.json` schema or SoC planner.
- Adding FPGA project, constraints, synthesis, or testbench generation.
- Replacing the Webview with React, Vue, or another runtime framework.
- Adding arbitrary drag-and-drop layout customization.
- Changing generated RTL or software output.
