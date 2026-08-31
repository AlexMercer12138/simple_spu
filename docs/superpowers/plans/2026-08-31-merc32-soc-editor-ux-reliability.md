# MERC32 SoC Editor UX and Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the MERC32 SoC custom editor compact and navigable for dense configurations, including while and after SoC generation.

**Architecture:** Retain the native dependency-free Webview and `TextDocument` data model, but split panel scheduling into a testable session object with independent selection, mutation, and action lanes. Expand the closed protocol with presentation options and sequenced action state, then refactor the Webview into a testable controller whose layout always reserves the lower PLB/status track.

**Tech Stack:** TypeScript 6, VS Code Custom Text Editor API, plain HTML/CSS/JavaScript, Node.js assertion scripts, jsdom 26 for development-only DOM tests.

**Spec:** `docs/superpowers/specs/2026-08-31-merc32-soc-editor-ux-reliability-design.md`

## Global Constraints

- Keep the `*.merc32.json` schema, planner, generated RTL, and generated software byte-compatible.
- Keep the Webview runtime free of frontend framework dependencies.
- Keep the current strict CSP, local resource root, 64 KiB message limit, unsafe-property rejection, and host-path redaction.
- Only document mutations require an exact `documentVersion`; selection is version-independent.
- PLB address space and Status must remain visible with 1 through 32 routes at wide, medium, and narrow widths.
- Preserve native dirty state, save, Undo, and Redo through `WorkspaceEdit`.
- Include the intentional deletion of unused `rtl/bridge/apb4_interconnect.v` and `rtl/misc/sync_fifo.v`; verify the active RTL/resource closure does not reference them.

---

## File Structure

- Create `merc32-vsce/src/socEditorSession.ts`: panel-local message lanes, action identity, mutation serialization, and ordered state scheduling.
- Modify `merc32-vsce/src/socWebviewProtocol.ts`: version-independent selection plus document, interrupt-option, and action presentation types.
- Modify `merc32-vsce/src/socEditorProvider.ts`: build the richer view model and delegate panel lifecycle to `SocEditorSession`.
- Modify `merc32-vsce/src/socCommands.ts`: make output-directory reveal best-effort and non-blocking.
- Modify `merc32-vsce/resources/webview/socEditor.js`: testable Webview controller, compact navigation/routes, keyboard tabs, busy states, and UI-state restoration.
- Modify `merc32-vsce/resources/webview/socEditor.css`: fixed shell, three responsive workbench modes, and dense route/layout styling.
- Modify `merc32-vsce/scripts/test-soc-vsce-unit.js`: protocol, view-model, command, and static asset contracts.
- Create `merc32-vsce/scripts/test-soc-editor-session.js`: focused asynchronous panel lifecycle regression tests.
- Create `merc32-vsce/scripts/test-soc-webview.js`: jsdom interaction tests and a local exact-asset visual harness.
- Modify `merc32-vsce/package.json` and `merc32-vsce/package-lock.json`: development-only jsdom dependency and test scripts.
- Delete `rtl/bridge/apb4_interconnect.v` and `rtl/misc/sync_fifo.v`: unused legacy RTL outside the current generator closure.

### Task 1: Extend the Closed Protocol and View Model

**Files:**
- Modify: `merc32-vsce/src/socWebviewProtocol.ts`
- Modify: `merc32-vsce/src/socEditorProvider.ts`
- Test: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Produces `SocDocumentState = 'saved' | 'dirty' | 'readOnly'`.
- Produces `SocInterruptOptionsPresentation` with `controllers`, `directSources`, and `routedSources`.
- Extends `SocGenerationState` with `actionId` and optional `action`.
- Produces `SocActionProgress` for unsequenced command callbacks.
- Changes Select to `{ type: 'select'; path: SocJsonPath }`.
- Extends `buildSocEditorViewModel(..., generation, isDirty)` without exposing host paths.

- [ ] **Step 1: Write failing protocol tests for version-independent selection and sequenced status**

Add these assertions beside the existing `parseWebviewMessage` cases:

```javascript
assert.deepStrictEqual(parseWebviewMessage({
    type: 'select', path: ['memory', 'ilb'],
}), {
    type: 'select', path: ['memory', 'ilb'],
});
assert.strictEqual(parseWebviewMessage({
    type: 'select', documentVersion: 8, path: ['cpu'],
}), undefined, 'selection still accepts a stale-version field');
assert.strictEqual(isCurrentDocumentMessage(
    { type: 'select', path: ['cpu'] }, 99,
), true);
```

Update generation-state fixtures to require:

```javascript
{
    actionId: 3,
    action: 'generate',
    phase: 'generating',
    message: 'Running generator...',
}
```

- [ ] **Step 2: Run the protocol tests and verify the expected failure**

Run:

```powershell
Set-Location merc32-vsce
npm run compile
node scripts/test-soc-vsce-unit.js
```

Expected: FAIL because Select still requires `documentVersion`, and the current generation type has no action identity.

- [ ] **Step 3: Implement the protocol types and parser change**

Add the presentation types:

```typescript
export type SocDocumentState = 'saved' | 'dirty' | 'readOnly';
export type SocEditorActionType = 'autoAssign' | 'validate' | 'generate';

export interface SocInterruptOptionsPresentation {
    controllers: readonly string[];
    directSources: readonly string[];
    routedSources: readonly string[];
}

export interface SocGenerationState {
    actionId: number;
    action?: SocEditorActionType;
    phase: SocGenerationPhase;
    message: string;
}

export type SocActionProgress = Pick<SocGenerationState, 'phase' | 'message'>;
```

Add `documentState` and `interruptOptions` to `SocEditorViewModel`. Change the
message union and parser case to:

```typescript
export type WebviewToHostMessage =
    | { type: 'ready' }
    | { type: 'select'; path: SocJsonPath }
    // Existing versioned mutation and version-independent action cases remain.

case 'select':
    return hasOnlyOwnDataProperties(value, ['type', 'path'])
        && hasOwn(value, 'path') && isPath(value.path)
        ? { type: 'select', path: value.path }
        : undefined;
```

Keep `isCurrentDocumentMessage` unchanged structurally: messages without a
`documentVersion` are current by definition.

- [ ] **Step 4: Add failing view-model tests for saved state and interrupt suggestions**

Build a controller-mode view from `multi-peripheral.merc32.json` and assert:

```javascript
const dirtyView = buildSocEditorViewModel(
    multiText, multiFixture, 12, catalog, ['interrupt'],
    { actionId: 0, phase: 'idle', message: 'Idle.' },
    true,
);
assert.strictEqual(dirtyView.documentState, 'dirty');
assert.deepStrictEqual(dirtyView.interruptOptions.controllers, ['intc0']);
assert.ok(dirtyView.interruptOptions.directSources.includes('intc0.interrupt'));
assert.ok(dirtyView.interruptOptions.routedSources.includes('uart0.interrupt'));
assert.ok(!dirtyView.interruptOptions.routedSources.includes('intc0.interrupt'));

const brokenView = buildSocEditorViewModel(
    '{"cpu":', 'broken.merc32.json', 3, catalog, ['cpu'], undefined, false,
);
assert.strictEqual(brokenView.documentState, 'readOnly');
```

- [ ] **Step 5: Run the view-model tests and verify the expected failure**

Run `npm run test:soc:vsce:unit`.

Expected: FAIL because the view model has neither document state nor interrupt options.

- [ ] **Step 6: Implement view-model presentation without changing the config schema**

Use catalog descriptors and active instances only:

```typescript
function presentInterruptOptions(
    config: SocSourceConfig,
    catalog: ModuleCatalog,
): SocInterruptOptionsPresentation {
    const controllers = config.peripherals
        .filter((item) => item.type === 'apb_intc')
        .map((item) => item.name);
    const sources = config.peripherals.flatMap((item) =>
        (catalog.modules.get(item.type)?.interrupts ?? [])
            .map((interrupt) => ({
                source: `${item.name}.${interrupt}`,
                controllerOutput: item.type === 'apb_intc',
            })));
    return {
        controllers,
        directSources: sources.map((item) => item.source),
        routedSources: sources
            .filter((item) => !item.controllerOutput)
            .map((item) => item.source),
    };
}
```

For invalid JSON, return empty option arrays and `readOnly`. For valid JSON,
return `dirty` or `saved` from the new `isDirty` argument. Initialize idle state
with `actionId: 0`.

- [ ] **Step 7: Run tests and commit the protocol/view-model change**

Run:

```powershell
npm run test:soc:vsce:unit
npm run compile
git add -- src/socWebviewProtocol.ts src/socEditorProvider.ts scripts/test-soc-vsce-unit.js
git commit -m "feat: present reliable SoC editor state"
```

Expected: all existing and new protocol/view-model tests PASS.

### Task 2: Separate Selection, Mutation, and Action Lanes

**Files:**
- Create: `merc32-vsce/src/socEditorSession.ts`
- Modify: `merc32-vsce/src/socEditorProvider.ts`
- Create: `merc32-vsce/scripts/test-soc-editor-session.js`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Consumes parsed `WebviewToHostMessage` values and provider callbacks.
- Produces `SocEditorSession.receive(value): Promise<void>`.
- Produces `SocEditorSession.documentChanged(): Promise<void>`.
- Produces `SocEditorSession.dispose(): void`.
- Selection bypasses mutation/action queues; mutation remains serialized; one action runs at a time.

- [ ] **Step 1: Add the focused session test command and failing lifecycle test**

Add:

```json
"test:soc:editor-session": "npm run compile && node scripts/test-soc-editor-session.js"
```

Create a fake services object with a deferred Generate Promise:

```javascript
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return { promise, resolve, reject };
}

function latestState(messages) {
    return [...messages].reverse().find((message) => message.type === 'state');
}

async function waitFor(predicate) {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('session condition did not settle');
}

function createSessionServices(overrides = {}) {
    let documentVersion = 1;
    return {
        currentDocumentVersion: () => documentVersion,
        setDocumentVersion: (value) => { documentVersion = value; },
        normalizeSelection: (path) => [...path],
        buildState: (selectedPath, generation) => ({
            documentVersion,
            documentState: 'saved',
            readOnly: false,
            catalog: { modules: [], externalInterfaces: [] },
            diagnostics: [],
            selectedPath,
            addressRows: [],
            interruptRows: [],
            portRows: [],
            dependencyRows: [],
            interruptOptions: { controllers: [], directSources: [], routedSources: [] },
            generation,
        }),
        postMessage: async () => true,
        mutate: async () => true,
        executeAction: async () => true,
        reopenAsText: async () => {},
        ...overrides,
    };
}

const deferred = createDeferred();
const posted = [];
const actions = [];
const services = createSessionServices({
    postMessage: async (message) => { posted.push(message); return true; },
    executeAction: async (type, report) => {
        actions.push(type);
        await report({ phase: 'generating', message: 'Running generator...' });
        return deferred.promise;
    },
});
const session = new SocEditorSession(services);

await session.receive({ type: 'ready' });
await session.receive({ type: 'generate' });
await session.receive({ type: 'select', path: ['project'] });
assert.deepStrictEqual(latestState(posted).value.selectedPath, ['project']);
assert.strictEqual(actions.length, 1);

await session.receive({ type: 'generate' });
assert.strictEqual(actions.length, 1, 'duplicate Generate started a second action');

deferred.resolve(true);
await waitFor(() => latestState(posted).value.generation.phase === 'generated');
await session.receive({ type: 'select', path: ['interrupt'] });
assert.deepStrictEqual(latestState(posted).value.selectedPath, ['interrupt']);
```

Add rejection, document-version change, stale mutation, and disposed-panel cases
using the same observable posted messages.

- [ ] **Step 2: Run the session test and verify the expected failure**

Run `npm run test:soc:editor-session`.

Expected: FAIL because `out/socEditorSession` does not exist.

- [ ] **Step 3: Implement the session service contract and ordered scheduler**

Define:

```typescript
export interface SocEditorSessionServices {
    currentDocumentVersion(): number;
    normalizeSelection(path: SocJsonPath, previous?: SocJsonPath): SocJsonPath | undefined;
    buildState(selectedPath: SocJsonPath | undefined, status: SocGenerationState): SocEditorViewModel;
    postMessage(message: HostToWebviewMessage): PromiseLike<boolean>;
    mutate(message: SocMutationMessage): Promise<boolean>;
    executeAction(
        type: SocEditorActionType,
        report: (status: SocActionProgress) => Promise<void>,
    ): Promise<SocEditorCommandOutcome>;
    reopenAsText(): Promise<void>;
}
```

Use separate members:

```typescript
private mutationQueue = Promise.resolve();
private stateQueue = Promise.resolve();
private requestedState = 0;
private actionId = 0;
private activeAction: SocEditorActionType | undefined;
private ready = false;
private disposed = false;
```

`scheduleState()` increments `requestedState`, skips only queued requests that
have not started, builds current state immediately before posting, and awaits
posts in order. `receive(select)` normalizes selection and calls
`scheduleState()` directly. Mutation messages append only to `mutationQueue`.

`receive(action)` starts `runAction()` without appending it to either queue and
returns after the action has started. `runAction()` reports sequenced progress,
maps false/throw to Error, clears `activeAction`, and awaits a complete state
refresh in `finally`.

- [ ] **Step 4: Run the session tests and make the asynchronous cases pass**

Run `npm run test:soc:editor-session`.

Expected: PASS, including selection while the deferred Generate is unresolved.

- [ ] **Step 5: Replace provider-local queues with `SocEditorSession`**

In `resolveCustomTextEditor`, construct one session and wire callbacks:

```typescript
const session = new SocEditorSession({
    currentDocumentVersion: () => document.version,
    normalizeSelection: (candidate, previous) => {
        const parsed = parseSocConfig(document.getText(), document.fileName, this.catalog);
        return parsed.config && isSelectableSocPath(parsed.config, candidate)
            ? [...candidate]
            : previous;
    },
    buildState: (selection, generation) => buildSocEditorViewModel(
        document.getText(), document.fileName, document.version,
        this.catalog, selection, generation, document.isDirty,
    ),
    postMessage: (message) => panel.webview.postMessage(message),
    mutate: (message) => this.applyMutationMessage(document, message),
    executeAction: (type, report) => executeSocEditorCommand(
        type, document.uri,
        (command, ...args) => this.vscodeApi.commands.executeCommand(command, ...args),
        report,
    ),
    reopenAsText: async () => {
        await this.vscodeApi.commands.executeCommand('vscode.openWith', document.uri, 'default');
    },
});
```

The Webview listener calls `void session.receive(value)`. The document-change
listener calls `void session.documentChanged()` for the matching URI. The panel
dispose listener calls `session.dispose()` before disposing subscriptions.
Delete the old single `messageQueue` and private `handleMessage` scheduler.

- [ ] **Step 6: Run provider, session, and compile tests**

Run:

```powershell
npm run test:soc:editor-session
npm run test:soc:vsce:unit
npm run compile
```

Expected: PASS with no unhandled Promise rejection output.

- [ ] **Step 7: Commit the session architecture**

```powershell
git add -- src/socEditorSession.ts src/socEditorProvider.ts scripts/test-soc-editor-session.js package.json
git commit -m "fix: keep SoC editor navigation responsive"
```

### Task 3: Make Post-Generation Reveal Non-Blocking

**Files:**
- Modify: `merc32-vsce/src/socCommands.ts`
- Test: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Keeps `runSocGeneration(...): Promise<SocEditorCommandOutcome>` unchanged.
- Changes only the optional `revealFileInOS` tail: generation success no longer waits for it.

- [ ] **Step 1: Write a failing non-blocking reveal test**

Provide an executor whose reveal Promise remains unresolved:

```javascript
function createDeferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolveValue, rejectValue) => {
        resolve = resolveValue;
        reject = rejectValue;
    });
    return { promise, resolve, reject };
}

async function settlesWithin(promise, milliseconds) {
    const timeout = Symbol('timeout');
    const result = await Promise.race([
        promise,
        new Promise((resolve) => setTimeout(() => resolve(timeout), milliseconds)),
    ]);
    assert.notStrictEqual(result, timeout);
    return result;
}

const reveal = createDeferred();
const originalExecuteCommand = generationVscode.commands.executeCommand;
const revealVscode = {
    ...generationVscode,
    commands: {
        async executeCommand(command, ...args) {
            if (command === 'revealFileInOS') return reveal.promise;
            return originalExecuteCommand(command, ...args);
        },
    },
};
const nonBlockingServices = {
    ...successfulServices,
    vscodeApi: revealVscode,
};
const generation = runSocGeneration(explicitUri, 'normal', nonBlockingServices);
assert.strictEqual(await settlesWithin(generation, 250), true,
    'successful generation waited for revealFileInOS');
reveal.resolve(undefined);
```

Add a rejected reveal case and assert generation still returns true while the
existing warning reporter receives the failure.

- [ ] **Step 2: Run the unit test and verify the expected failure**

Run `npm run test:soc:vsce:unit`.

Expected: FAIL at `settlesWithin` because `runSocGeneration` awaits the deferred reveal.

- [ ] **Step 3: Launch reveal as a handled best-effort tail**

Replace the awaited block with:

```typescript
void Promise.resolve(vscodeApi.commands.executeCommand('revealFileInOS', outputUri))
    .catch((error: unknown) => reportGenerationWarning(
        vscodeApi,
        services.output,
        'the generated output directory could not be revealed',
        error,
    ));
```

Artifact recording remains awaited. The detached Promise always has a rejection
handler and never changes the successful generator outcome.

- [ ] **Step 4: Run and commit the generation-tail fix**

```powershell
npm run test:soc:vsce:unit
npm run test:soc:generator
git add -- src/socCommands.ts scripts/test-soc-vsce-unit.js
git commit -m "fix: release SoC editor after generation"
```

Expected: both suites PASS and generated output remains byte-identical.

### Task 4: Build a Testable Webview Controller and Compact Editor UI

**Files:**
- Modify: `merc32-vsce/resources/webview/socEditor.js`
- Modify: `merc32-vsce/src/socEditorProvider.ts`
- Create: `merc32-vsce/scripts/test-soc-webview.js`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/package-lock.json`

**Interfaces:**
- Produces CommonJS-testable `createSocEditorApp(window, vscode)` while auto-starting in the Webview.
- Consumes the richer `SocEditorViewModel` from Task 1.
- Keeps `acquireVsCodeApi().postMessage(...)` as the only Webview-to-host boundary.
- Adds development-only `jsdom` pinned to `26.1.0`.

- [ ] **Step 1: Install the pinned DOM test dependency and add the test command**

Run:

```powershell
Set-Location merc32-vsce
npm install --save-dev --save-exact jsdom@26.1.0
```

Add:

```json
"test:soc:webview": "npm run compile && node scripts/test-soc-webview.js"
```

- [ ] **Step 2: Write failing jsdom tests for navigation and command concurrency**

Load the body from `renderEditorHtml`, install a fake `acquireVsCodeApi`, evaluate
the production script, and deliver a realistic state message. Assert:

```javascript
assert.deepStrictEqual(
    [...document.querySelectorAll('.nav-label')].slice(0, 4).map((node) => node.textContent),
    ['Project', 'CPU', 'ILB memory', 'DLB memory'],
);
assert.strictEqual(document.querySelectorAll('.nav-badge').length, 0);

click('[data-command="generate"]');
dispatchGenerationStatus({
    actionId: 4, action: 'generate', phase: 'generating', message: 'Running generator...',
});
clickNav('CPU');
assert.deepStrictEqual(posted.at(-1), { type: 'select', path: ['cpu'] });
assert.strictEqual(navButton('CPU').disabled, false);
assert.strictEqual(commandButton('generate').disabled, true);
```

Expected initial failure: the browser script cannot be constructed under
jsdom, emits prefix badges, includes `documentVersion` in Select, and does not
disable duplicate actions.

- [ ] **Step 3: Refactor the browser script into a testable controller**

Use a small universal wrapper:

```javascript
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) {
        module.exports = api;
    } else {
        api.createSocEditorApp(root, root.acquireVsCodeApi());
    }
}(typeof globalThis === 'object' ? globalThis : this, function () {
    function createSocEditorApp(root, vscode) {
        const document = root.document;
        // Bind fixed-shell controls, receive state, and render through DOM APIs.
    }
    return { createSocEditorApp };
}));
```

Track `model`, active summary, pending mutation, latest action ID, scroll state,
and focused field inside the returned app closure. Ignore a generation status
whose `actionId` is lower than the latest accepted action ID.

- [ ] **Step 4: Remove redundant navigation and toolbar text**

Change navigation construction to:

```javascript
system.body.appendChild(navButton('Project', ['project']));
system.body.appendChild(navButton('CPU', ['cpu']));
system.body.appendChild(navButton('ILB memory', ['memory', 'ilb']));
system.body.appendChild(navButton('DLB memory', ['memory', 'dlb']));
```

`navButton` appends only `.nav-label`, sets `aria-current` for the selected row,
and posts `{ type: 'select', path }`. Instance rows put type in `title`, not
visible prefix text. Remove the `M32`, `A+`, `OK`, `>`, and `{ }` spans from
`renderEditorHtml`; retain concise text command labels and tooltips.

- [ ] **Step 5: Add failing compact interrupt-editor tests**

Deliver controller-mode states with 3 and 32 routes, then assert:

```javascript
assert.strictEqual(document.querySelectorAll('.route-row').length, 3);
assert.strictEqual(routeSource(0).getAttribute('list'), 'interrupt-source-options');
assert.deepStrictEqual(
    [...controllerSelect().options].map((option) => option.value),
    ['intc0'],
);
assert.strictEqual(addRouteButton().disabled, false);

deliverState(modelWithRoutes(32));
assert.strictEqual(addRouteButton().disabled, true);
clickRemoveRoute(7);
assert.strictEqual(posted.at(-1).type, 'setValue');
assert.strictEqual(posted.at(-1).documentVersion, model.documentVersion);
assert.strictEqual(posted.at(-1).value.length, 31);
```

- [ ] **Step 6: Implement the compact route grid and suggestion controls**

Create one `.route-editor` with a header and stable rows. Use an input plus
`datalist` for Source so `external.<identifier>` remains valid. Use a select for
Controller populated from `model.interruptOptions.controllers`. Reuse
`directSources` in direct mode and `routedSources` in controller mode.

Keep Add Route's lowest-unused-ID behavior and set:

```javascript
addRoute.disabled = model.readOnly || interrupt.sources.length >= 32 || pendingMutation;
```

- [ ] **Step 7: Add and implement keyboard summary and diagnostic navigation tests**

Tests dispatch ArrowRight, ArrowLeft, Home, and End on summary tabs and assert
`aria-selected`, `tabIndex`, focus, and panel content. A diagnostic activation
must post Select for the nearest selectable prefix:

```javascript
assert.deepStrictEqual(selectionForDiagnosticPath(
    ['interrupt', 'sources', 2, 'trigger'], model,
), ['interrupt']);
assert.deepStrictEqual(selectionForDiagnosticPath(
    ['peripherals', 1, 'baseAddress'], model,
), ['peripherals', 1]);
```

Render diagnostic rows as buttons or button-semantic controls with an accessible
name and click/Enter/Space activation.

- [ ] **Step 8: Preserve interaction state across same-object refreshes**

Before a full render, capture:

```javascript
{
    navigationScrollTop,
    propertyScrollTop,
    summaryScrollTop,
    focusedPath,
    selectionStart,
    selectionEnd,
    selectedPath: model && model.selectedPath,
}
```

After rendering, always restore navigation and summary scroll. Restore property
scroll, focus, and text selection only when selectedPath is unchanged. Reset
property scroll to zero when the selected object changes. A received full state
clears `pendingMutation`; sending a mutation sets it immediately and disables
only property mutation controls.

- [ ] **Step 9: Run and commit Webview interaction tests**

Run:

```powershell
npm run test:soc:webview
npm run test:soc:vsce:unit
npm run compile
git add -- resources/webview/socEditor.js src/socEditorProvider.ts scripts/test-soc-webview.js scripts/test-soc-vsce-unit.js package.json package-lock.json
git commit -m "feat: refine SoC editor interactions"
```

Expected: interaction tests PASS with no `innerHTML`, inline handlers, remote
URLs, or open message shapes.

### Task 5: Fix Responsive Layout and Verify the Complete Workflow

**Files:**
- Modify: `merc32-vsce/resources/webview/socEditor.css`
- Modify: `merc32-vsce/scripts/test-soc-webview.js`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Wide: three independently scrolling panes.
- Medium: navigation/properties above a spanning summary row.
- Narrow: one internally scrolling upper workbench.
- Every mode: fixed viewport shell plus bounded, visible lower information track.
- `node scripts/test-soc-webview.js --serve 4173` serves exact production assets and a 32-route fixture.

- [ ] **Step 1: Write failing CSS shell and breakpoint contracts**

Replace the current weak static assertions with declarations extracted from
their exact rules:

```javascript
assert.match(rule(css, '.editor-shell'), /height:\s*100vh/);
assert.match(rule(css, '.editor-shell'), /overflow:\s*hidden/);
assert.match(rule(css, '.editor-shell'), /minmax\(0,\s*1fr\)/);
assert.match(rule(css, '.bottom-band'), /height:\s*clamp\(/);
assert.doesNotMatch(css, /\.editor-shell\s*\{[^}]*height:\s*auto/s);
assert.strictEqual(css.includes('.nav-badge'), false);
assert.ok(css.includes('.route-row'));
```

Run `npm run test:soc:webview` and confirm failure against the current responsive
rule that sets `height: auto`.

- [ ] **Step 2: Implement the fixed shell and wide layout**

Use:

```css
.editor-shell {
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) clamp(112px, 20vh, 180px);
    width: 100%;
    height: 100vh;
    overflow: hidden;
}

.workbench {
    display: grid;
    grid-template-columns: minmax(190px, 0.72fr) minmax(340px, 1.45fr) minmax(250px, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
```

Keep each wide pane independently scrollable. Change `.nav-button` to one
`minmax(0, 1fr)` track and add compact route-grid styles with stable Source,
IRQ, Trigger, and Remove tracks.

- [ ] **Step 3: Implement medium and narrow modes without releasing the shell**

At medium width, define two workbench columns and two bounded rows; Summary
spans both columns in the second row. At narrow width, define one workbench
column with `overflow: auto`, let its three child panes participate in that
internal scroll, and stack the two lower-band sections inside the unchanged
reserved shell row. Never set shell height to `auto` or page overflow to
`visible`.

- [ ] **Step 4: Add the exact-asset visual harness mode**

When invoked with `--serve <port>`, `test-soc-webview.js` starts an HTTP server
bound to `127.0.0.1`. It serves:

- `renderEditorHtml(...)` with local CSS/JS URIs;
- the checked-in production CSS and JS;
- a nonce-bearing harness script that mocks `acquireVsCodeApi`;
- a controller-mode state containing 32 routes and representative diagnostics,
  endpoints, ports, and dependencies.

The harness responds to Select and mutation messages with a new full state and
simulates sequenced generation progress. It must not be included in the VSIX;
`scripts/**` is already excluded.

- [ ] **Step 5: Run automated CSS and DOM tests**

Run:

```powershell
npm run test:soc:webview
npm run test:soc:vsce:unit
npm run test:soc:editor-session
```

Expected: PASS with the 32-route DOM fixture.

- [ ] **Step 6: Perform browser layout verification at three viewports**

Start:

```powershell
node scripts/test-soc-webview.js --serve 4173
```

Use the in-app browser at `http://127.0.0.1:4173` and capture:

- 1440 x 900: three panes and lower band visible.
- 900 x 700: two-column upper row, spanning summary, and lower band visible.
- 480 x 800: internally scrolling one-column workbench and stacked lower band visible.

At every viewport inspect DOM rectangles and assert:

```javascript
const shell = document.querySelector('.editor-shell').getBoundingClientRect();
const workbench = document.querySelector('.workbench').getBoundingClientRect();
const bottom = document.querySelector('.bottom-band').getBoundingClientRect();
if (bottom.bottom > innerHeight || bottom.top < workbench.bottom - 1) {
    throw new Error('lower band is outside its reserved viewport track');
}
for (const element of document.querySelectorAll('button, input, select')) {
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0) throw new Error('collapsed control');
}
```

Exercise Generate, then Project/CPU/ILB/DLB/Interrupts while progress is active,
and verify the property heading changes on every click.

- [ ] **Step 7: Run extension-host and packaging regression tests**

The deleted legacy RTL files are absent from the catalog and packaged resource
closure, so the normal preparation and packaging path must pass directly in the
working tree:

```powershell
Set-Location merc32-vsce
npm run test:soc:config
npm run test:soc:generator
npm run test:extension
npm run package:vsix
npm run test:vsix
```

Verify generated resource preparation leaves no unexpected tracked changes
outside the intended editor/test files and the two approved RTL deletions.

- [ ] **Step 8: Run final diff checks and commit the layout/test harness**

```powershell
git diff --check
git status --short
git add -- resources/webview/socEditor.css scripts/test-soc-webview.js scripts/test-soc-vsce-unit.js
git commit -m "fix: keep SoC editor status dock visible"
```

Expected status before commit: only intended editor/test files and the two
approved RTL deletions.

### Task 6: Remove the Two Unused Legacy RTL Modules

**Files:**
- Delete: `rtl/bridge/apb4_interconnect.v`
- Delete: `rtl/misc/sync_fifo.v`

**Interfaces:**
- Removes no catalog entry, generated RTL dependency, instantiated module, or public SoC Generator interface.

- [ ] **Step 1: Prove neither file belongs to the active closure**

Run:

```powershell
rg -n -S "apb4_interconnect\.v|sync_fifo\.v|apb4_interconnect|sync_fifo" merc32-vsce rtl docs README.md -g '!merc32-vsce/resources/rtl/**' -g '!merc32-vsce/out/**'
```

Expected: no source, catalog, resource manifest, generator, or test reference.
The historical architecture sentence in the 2026-08-29 design and the CAN
manual's prose about a FIFO implementation are documentation, not dependencies.

- [ ] **Step 2: Run resource closure and hardware tests with the files absent**

```powershell
Set-Location merc32-vsce
npm run prepare:resources
npm run test:extension:resources
npm run test:soc:rtl
Set-Location ..
```

Expected: PASS without either deleted path being requested or copied.

- [ ] **Step 3: Commit the approved deletions**

```powershell
git add -- rtl/bridge/apb4_interconnect.v rtl/misc/sync_fifo.v
git commit -m "rtl: remove unused legacy helpers"
```

### Task 7: Final Review and Completion Evidence

**Files:**
- Review only: all files changed by Tasks 1 through 5

**Interfaces:**
- Consumes every acceptance criterion from the design spec.
- Produces a verified source tree and a concise final report; no new production behavior.

- [ ] **Step 1: Run the code-simplifier pass on recently modified files**

Use the `code-simplifier` skill, constrained to the SoC editor/session/protocol,
Webview assets, and their tests. Preserve all public interfaces and rerun the
focused test after each simplification.

- [ ] **Step 2: Request a code review of the complete implementation**

Use `superpowers:requesting-code-review` against the design spec and the diff
from `d97b925`. Resolve every correctness, regression, or missing-test finding;
do not fold in unrelated refactoring.

- [ ] **Step 3: Run verification from a clean command invocation**

Run the focused suites again after review changes:

```powershell
Set-Location merc32-vsce
npm run test:soc:webview
npm run test:soc:editor-session
npm run test:soc:vsce:unit
npm run test:soc:config
npm run test:soc:generator
npm run compile
```

Repeat the three browser viewports and the Generate-then-navigate workflow if
review changed any Webview JavaScript or CSS.

- [ ] **Step 4: Audit the final worktree and acceptance criteria**

Run:

```powershell
git diff --check d97b925..HEAD
git status --short --branch
git log --oneline d97b925..HEAD
```

Confirm all 11 acceptance criteria in the spec have test or visual evidence.
Confirm the two approved RTL deletions are committed and no active resource or
test closure references them.
