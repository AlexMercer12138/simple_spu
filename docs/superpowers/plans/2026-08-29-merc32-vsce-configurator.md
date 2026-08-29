# MERC32 VSCode Configurator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a default graphical editor for `*.merc32.json`, workspace configuration and artifact views, safe generator commands, precise diagnostics, and an offline VSIX that contains every RTL resource needed to generate and elaborate a MERC32 SoC.

**Architecture:** The VSCode layer is a thin adapter over the headless `src/soc` APIs. A `CustomTextEditorProvider` renders a packaged three-column webview while all persistent state remains in the backing JSON `TextDocument`; pure helpers validate webview messages and compute parser-backed JSON replacements. Commands, diagnostics, tree views, and VSIX smoke tests all call the same generator contracts and resolve packaged assets through `ExtensionContext.extensionUri`.

**Tech Stack:** TypeScript ES2020/CommonJS, VSCode Extension API 1.74, `jsonc-parser`, Node.js, HTML/CSS/JavaScript webview assets, `@vscode/test-electron`, Mocha, `@vscode/vsce`, Icarus Verilog.

**Spec:** `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`

## Global Constraints

- The custom editor selector is exactly `*.merc32.json` with priority `default`; ordinary JSON files are unaffected.
- The backing text document is the only persistent configuration state. All UI edits use `WorkspaceEdit` and participate in save, undo, and redo.
- Invalid or incomplete JSON is never replaced. The graphical editor becomes read-only and can reopen the normal text editor.
- The webview may request operations but may not read files, generate RTL, choose arbitrary host paths, or mutate the document directly.
- Every webview message is structurally validated before dispatch. Use a nonce, strict CSP, and packaged local resources only.
- Generator assets are resolved below `ExtensionContext.extensionUri/resources`; installed operation must not use repository-relative paths or download files.
- Normal generation never overwrites modified managed files. Force generation never overwrites or deletes an existing `software/src/main.c`.
- Output-directory adoption is a separate explicit command and is never implied by force generation.
- Do not add FPGA project generation, constraints, synthesis scripts, or generated testbenches.

---

## File Structure

- Modify `merc32-vsce/package.json`: activation events, custom editor, schema, commands, views, menus, dependencies, and test/package scripts.
- Modify `merc32-vsce/tsconfig.json`: compile extension-test types.
- Modify `merc32-vsce/src/constants.ts`: stable editor, view, command, and suffix IDs.
- Modify `merc32-vsce/src/extension.ts`: compose and dispose configurator services.
- Modify `merc32-vsce/src/toolchainExplorer.ts`: keep only the Toolchain view; artifacts move to the shared Artifacts view.
- Create `merc32-vsce/src/socJsonEdits.ts`: pure `jsonc-parser` updates and minimal text replacement.
- Create `merc32-vsce/src/socWebviewProtocol.ts`: serializable view models and exact host/webview message guards.
- Create `merc32-vsce/src/socDiagnostics.ts`: document validation, source-range mapping, and diagnostic collection.
- Create `merc32-vsce/src/socEditorProvider.ts`: custom text editor lifecycle and host message handling.
- Create `merc32-vsce/src/socCommands.ts`: create, open, validate, assign, generate, force, adopt, and artifact commands.
- Create `merc32-vsce/src/socExplorer.ts`: Configurations, Generate, and Artifacts tree providers.
- Create `merc32-vsce/resources/webview/socEditor.css` and `socEditor.js`: three-column workbench UI.
- Create `merc32-vsce/scripts/test-soc-vsce-unit.js`: pure manifest, protocol, and JSON-edit tests.
- Create `merc32-vsce/src/test/runTest.ts` and `src/test/suite/*.test.ts`: VSCode-host integration tests.
- Create `merc32-vsce/scripts/test-vsix-smoke.js` and `scripts/smoke-extension/**`: packaged clean-install test harness.

### Task 1: Register the Configuration Format and Public Extension Contracts

**Files:**
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/src/constants.ts`
- Create: `merc32-vsce/src/socWebviewProtocol.ts`
- Create: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Produces `SOC_CONFIG_SUFFIX`, `SOC_EDITOR_VIEW_TYPE`, `SOC_VIEW_IDS`, and these command IDs:
  `createConfig`, `openConfig`, `autoAssign`, `validate`, `generate`,
  `forceGenerate`, `adoptOutput`, `openArtifact`, and `reopenAsText`.
- Produces `HostToWebviewMessage`, `WebviewToHostMessage`,
  `SocEditorViewModel`, and `parseWebviewMessage(value)`.

- [ ] **Step 1: Add failing package-manifest and message-guard tests**

Load `package.json` and assert exact contributions:

```javascript
const selector = pkg.contributes.customEditors[0];
assert.strictEqual(selector.viewType, 'merc32.socConfigEditor');
assert.strictEqual(selector.priority, 'default');
assert.deepStrictEqual(selector.selector, [{ filenamePattern: '*.merc32.json' }]);
assert.deepStrictEqual(pkg.contributes.jsonValidation, [{
    fileMatch: '*.merc32.json',
    url: './resources/schema/merc32.schema.json',
}]);
assert.ok(!JSON.stringify(pkg.contributes.customEditors).includes('*.json"'));
```

Add message tests that accept `{ type: 'setValue', path: ['cpu', 'debug'], value: true }`
and reject unknown message types, inherited properties, non-array paths,
non-string path segments, `__proto__`/`prototype`/`constructor` segments, unknown
keys, and host file paths.

- [ ] **Step 2: Add the unit script and verify failure**

Add:

```json
"test:soc:vsce:unit": "npm run compile && node scripts/test-soc-vsce-unit.js"
```

Run `npm run test:soc:vsce:unit`. Expected: FAIL because the contributions and
`out/socWebviewProtocol` do not exist.

- [ ] **Step 3: Add exact manifest contributions**

Register activation for `onCustomEditor:merc32.socConfigEditor`, all eight SoC
commands, and the three SoC views. The relevant manifest shape is:

```json
"customEditors": [{
  "viewType": "merc32.socConfigEditor",
  "displayName": "MERC32 SoC Configurator",
  "selector": [{ "filenamePattern": "*.merc32.json" }],
  "priority": "default"
}],
"jsonValidation": [{
  "fileMatch": "*.merc32.json",
  "url": "./resources/schema/merc32.schema.json"
}],
"views": {
  "merc32-toolchain": [
    { "id": "merc32-toolchain.configurations", "name": "SoC Configurations" },
    { "id": "merc32-toolchain.generate", "name": "Generate" },
    { "id": "merc32-toolchain.build", "name": "Toolchain" },
    { "id": "merc32-toolchain.artifacts", "name": "Artifacts" }
  ]
}
```

Put Create Configuration in the Configurations view title menu and Refresh in
the Configurations and Artifacts view title menus. Put Validate, Auto-assign,
Generate, and Force Generate in the custom editor title menu using
`activeCustomEditorId == merc32.socConfigEditor`.

- [ ] **Step 4: Define constants and closed message unions**

Use literal command IDs under `merc32.soc.*`. `parseWebviewMessage` must first
require a plain own-property object, switch on `type`, reject keys outside each
message's allowlist, and return `undefined` for malformed payloads. Allow only:

```typescript
type WebviewToHostMessage =
    | { type: 'ready' }
    | { type: 'select'; path: readonly (string | number)[] }
    | { type: 'setValue'; path: readonly (string | number)[]; value: JsonValue }
    | { type: 'addInstance'; collection: 'peripherals' | 'externalInterfaces'; itemType: string }
    | { type: 'removeInstance'; collection: 'peripherals' | 'externalInterfaces'; index: number }
    | { type: 'autoAssign' | 'validate' | 'generate' | 'reopenAsText' };
```

Host messages are only `{ type: 'state'; value: SocEditorViewModel }` and
`{ type: 'generationStatus'; phase; message }`. The view model contains parsed
configuration data, catalog presentation metadata, diagnostics, selected path,
address rows, interrupt rows, port rows, dependency rows, and generation state;
it contains no absolute packaged-asset paths.

- [ ] **Step 5: Run and commit manifest contracts**

```powershell
npm run test:soc:vsce:unit
git add -- package.json src/constants.ts src/socWebviewProtocol.ts scripts/test-soc-vsce-unit.js
git commit -m "feat: register MERC32 SoC configuration format"
```

### Task 2: Add Parser-Backed JSON Edits and Live Diagnostics

**Files:**
- Create: `merc32-vsce/src/socJsonEdits.ts`
- Create: `merc32-vsce/src/socDiagnostics.ts`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Consumes `loadCatalog`, `parseSocConfig`, `validateSocConfig`,
  `assignMissingAddresses`, `SocDiagnostic`, and `SocSourceMap` from `src/soc`.
- Produces:

```typescript
export interface JsonValueUpdate {
    path: readonly (string | number)[];
    value: JsonValue | undefined;
}

export interface TextReplacement {
    offset: number;
    length: number;
    text: string;
}

export function buildJsonReplacement(
    source: string,
    updates: readonly JsonValueUpdate[],
): TextReplacement;

export class SocDiagnostics implements vscode.Disposable {
    refresh(document: vscode.TextDocument): readonly SocDiagnostic[];
    clear(document: vscode.TextDocument): void;
}
```

- [ ] **Step 1: Add exact edit tests**

Start from formatted standard JSON and assert adding `baseAddress`, changing
`cpu.debug`, deleting `initFile`, adding an array item, and removing an array
item all preserve two-space formatting and the final newline. Assert a batch of
three address assignments produces one `TextReplacement`, reparses to the
expected object, and changes no unrelated string. Assert invalid JSON and a
dangerous path throw before returning an edit.

- [ ] **Step 2: Implement sequential structured updates and one minimal replacement**

For every update, call `jsonc-parser.modify` with:

```typescript
{
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: detectEol(source) },
    isArrayInsertion: false,
}
```

Apply each returned edit to an in-memory string with `applyEdits`, reparsing
after each update. Compute the longest equal prefix and suffix between original
and final text and return the one differing span. Never stringify and replace
the whole document.

- [ ] **Step 3: Add diagnostic conversion tests**

Use a real `TextDocument` in the extension suite later; in the unit test expose
and test a pure `diagnosticRange(documentText, sourceMap, diagnostic)` helper.
Assert an overlap diagnostic targets the second `baseAddress`, an unknown field
targets that property, and a missing required field falls back to the nearest
existing parent object rather than the entire file.

- [ ] **Step 4: Implement document validation and debounce wiring**

`SocDiagnostics.refresh` ignores files that do not end in `.merc32.json`, calls
`parseSocConfig(document.getText(), document.fileName, catalog)`, adds semantic
diagnostics only when parsing produced a config, maps offsets through
`document.positionAt`, and publishes under source `MERC32 SoC`. Map severity to
`DiagnosticSeverity.Error`/`Warning` and attach the stable diagnostic code.
For Ajv `additionalProperties` diagnostics, append
`params.additionalProperty` to the parent path so the underline targets the
unknown key rather than the enclosing object.

Register `onDidOpenTextDocument`, `onDidChangeTextDocument`, and
`onDidCloseTextDocument` listeners in the class. Debounce changes per URI for
150 ms, clear pending timers on close/dispose, and validate all already-open
matching documents on construction.

- [ ] **Step 5: Run and commit edits and diagnostics**

```powershell
npm run test:soc:vsce:unit
npm run compile
git add -- src/socJsonEdits.ts src/socDiagnostics.ts scripts/test-soc-vsce-unit.js
git commit -m "feat: validate and edit MERC32 SoC JSON"
```

### Task 3: Build the Three-Column Custom Text Editor

**Files:**
- Create: `merc32-vsce/src/socEditorProvider.ts`
- Create: `merc32-vsce/resources/webview/socEditor.css`
- Create: `merc32-vsce/resources/webview/socEditor.js`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Consumes `buildJsonReplacement`, `parseWebviewMessage`, catalog metadata,
  source parsing/planning, and command IDs.
- Produces:

```typescript
export class Merc32SocEditorProvider
    implements vscode.CustomTextEditorProvider { /* provider methods */ }

export async function applySocDocumentUpdates(
    document: vscode.TextDocument,
    updates: readonly JsonValueUpdate[],
): Promise<boolean>;
```

- [ ] **Step 1: Add provider HTML and protocol tests**

Export a pure `renderEditorHtml(webview, extensionUri, nonce)` helper and assert
the HTML has exactly one nonce-bearing script, no inline event handlers, no
remote URL, and this CSP:

```text
default-src 'none'; img-src WEBVIEW_SOURCE; style-src WEBVIEW_SOURCE;
font-src WEBVIEW_SOURCE; script-src 'nonce-NONCE';
```

Assert webview resource URIs point only below `resources/webview`. Add protocol
tests for stale `documentVersion`, unsupported property paths, and oversized
messages above 64 KiB.

- [ ] **Step 2: Implement provider lifecycle and document synchronization**

Register with:

```typescript
vscode.window.registerCustomEditorProvider(
    SOC_EDITOR_VIEW_TYPE,
    provider,
    { webviewOptions: { retainContextWhenHidden: true } },
);
```

In `resolveCustomTextEditor`, restrict `localResourceRoots` to the packaged
webview directory, install HTML, subscribe to the backing document's changes,
and post a complete state snapshot after `ready` and every matching document
version change. Dispose panel-local subscriptions with the panel. Keep only the
selected JSON path as ephemeral panel state; never cache a mutable config copy.

- [ ] **Step 3: Apply host-side edits through `WorkspaceEdit`**

For `setValue`, `addInstance`, and `removeInstance`, reject stale versions,
parse the current document, verify the path is editable for the selected schema
node, then call the exported `applySocDocumentUpdates` helper. That helper calls
`buildJsonReplacement` and applies exactly one replacement:

```typescript
const edit = new vscode.WorkspaceEdit();
edit.replace(document.uri, new vscode.Range(
    document.positionAt(replacement.offset),
    document.positionAt(replacement.offset + replacement.length),
), replacement.text);
await vscode.workspace.applyEdit(edit);
```

Do not auto-save. A failed edit posts a fresh state plus a nonfatal status and
leaves document text unchanged.

- [ ] **Step 4: Implement the packaged workbench UI**

Build a fixed, responsive editor surface with:

- Top toolbar: Auto-assign, Validate, and Generate commands with VSCode-style
  icons and tooltips.
- Left navigation: CPU, ILB, DLB, APB peripherals, external endpoints,
  interrupt routing, and add/remove controls.
- Center property pane: checkboxes for booleans, numeric/text inputs for
  values, selects for enums/module types, and parameter controls derived from
  catalog metadata.
- Right summary: validation, address, IRQ, port, and dependency tabs.
- Bottom band: fixed PLB address-space overview and generation status.

Use `box-sizing: border-box`, 4/8 px spacing, maximum 8 px radii, VSCode theme
variables, stable grid tracks (`minmax(210px, 0.8fr) minmax(320px, 1.4fr)
minmax(260px, 1fr)`), and a single-column layout below 760 px. Inputs and labels
must wrap without overlap. The browser script renders text with `textContent`,
never `innerHTML`, and sends only closed protocol messages.

- [ ] **Step 5: Handle invalid JSON without destructive recovery**

When the parse result has no config, disable every mutation and generation
control, show the parse diagnostic and line/column, and leave only Reopen as
Text enabled. That action sends `reopenAsText`; the host executes:

```typescript
await vscode.commands.executeCommand('vscode.openWith', document.uri, 'default');
```

- [ ] **Step 6: Run and commit the custom editor**

```powershell
npm run test:soc:vsce:unit
npm run compile
git add -- src/socEditorProvider.ts resources/webview scripts/test-soc-vsce-unit.js
git commit -m "feat: add graphical MERC32 SoC editor"
```

### Task 4: Add Safe Configuration and Generator Commands

**Files:**
- Create: `merc32-vsce/src/socCommands.ts`
- Modify: `merc32-vsce/src/socEditorProvider.ts`
- Modify: `merc32-vsce/src/constants.ts`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Consumes `generateSoc(GenerateSocOptions)`, `assignMissingAddresses`,
  `SocGenerationError`, diagnostics, and `applySocDocumentUpdates`.
- Produces `registerSocCommands(context, services): vscode.Disposable[]` and
  `resolveSocConfigUri(argument): vscode.Uri | undefined`.

- [ ] **Step 1: Add target resolution and starter-config tests**

Assert target priority is explicit tree/editor URI, active custom-editor URI,
then the only workspace `*.merc32.json`; multiple files with no explicit target
must require Quick Pick. Assert `createConfigText('control_board')` emits valid
schema version 1 JSON with project output `generated/control_board`, debug off,
32 KiB internal ILB/DLB, empty peripheral/interface arrays, and interrupt mode
`none`.

- [ ] **Step 2: Implement create and open commands**

Create uses `showSaveDialog` defaulting to `soc.merc32.json`, rejects any name
without the compound suffix, refuses an existing URI, derives a legal project
identifier from the filename, writes through `workspace.fs.writeFile`, then
opens with `vscode.openWith(uri, SOC_EDITOR_VIEW_TYPE)`. Open scans all workspace
folders with `findFiles('**/*.merc32.json', '**/{.git,node_modules}/**')` and
uses Quick Pick when needed.

- [ ] **Step 3: Implement previewed auto-assignment as one undo step**

Parse and validate the open document, call `assignMissingAddresses`, and show a
modal preview whose detail contains one `path -> 0xXXXXXXXX` line per assignment.
Only an explicit Assign button passes all assignments to one
`applySocDocumentUpdates` call. Cancel and validation errors leave the document
and dirty state unchanged.

- [ ] **Step 4: Implement validation and normal generation**

Validation refreshes diagnostics and writes warnings plus a normalized address
table to the shared `MERC32 Toolchain` output channel. Generation first saves a
dirty document and stops if save returns false, then calls:

```typescript
generateSoc({
    configFile: uri.fsPath,
    assetRoot: vscode.Uri.joinPath(context.extensionUri, 'resources').fsPath,
});
```

Run inside `window.withProgress`, report planning/staging/activation status to
the custom editor, reveal the output directory after success, and update the
artifact store. Catch `SocGenerationError`, refresh diagnostics, list each
conflict in the output channel, and show one concise error notification.

- [ ] **Step 5: Keep force and adoption separate**

Force Generate requires a modal confirmation stating it may replace modified
managed files but will not replace `main.c`, then calls `generateSoc` with only
`force: true`. Adopt Output requires a different modal confirmation naming the
config and output directory, then calls with only `adoptOutput: true`. A conflict
that also requires force must be resolved by a subsequent explicit Force
Generate; never set both flags from one command.

- [ ] **Step 6: Run and commit command handling**

```powershell
npm run test:soc:vsce:unit
npm run compile
git add -- src/constants.ts src/socCommands.ts src/socEditorProvider.ts scripts/test-soc-vsce-unit.js
git commit -m "feat: add MERC32 SoC generator commands"
```

### Task 5: Integrate Configurations, Generate, Toolchain, and Artifacts Views

**Files:**
- Create: `merc32-vsce/src/socExplorer.ts`
- Modify: `merc32-vsce/src/toolchainExplorer.ts`
- Modify: `merc32-vsce/src/extensionCommands.ts`
- Modify: `merc32-vsce/src/types.ts`
- Modify: `merc32-vsce/src/extension.ts`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js`

**Interfaces:**
- Produces `SocConfigurationProvider`, `SocActionProvider`,
  `Merc32ArtifactsProvider`, and `Merc32ArtifactStore`.
- Preserves all existing ASM and Tiny C command IDs and behavior.

- [ ] **Step 1: Add pure tree-model tests**

Assert configurations sort by workspace-relative path and support multiple
same-directory files. Assert Generate contains Validate, Auto-assign, Generate,
and Force Generate in that order. Assert Artifacts includes existing compiler
files plus, per generated SoC, output directory, `manifest.json`, top RTL,
generated header, and `address-map.json`; missing files are omitted after
refresh rather than retained as dead entries.

- [ ] **Step 2: Implement configuration discovery and watchers**

Use one `RelativePattern(folder, '**/*.merc32.json')` watcher per workspace
folder. Refresh on create/delete/rename and workspace-folder changes. Each tree
item opens its URI with `SOC_EDITOR_VIEW_TYPE`; the empty state offers Create
Configuration. Do not parse every ordinary JSON document during discovery.

- [ ] **Step 3: Split the existing explorer without changing toolchain commands**

Keep Build actions in `Merc32ToolchainExplorer` and move its existing artifacts
to `Merc32ArtifactStore`. Update `extensionCommands.ts` to publish compiler
artifacts through the store. Persist only generated SoC output URI/config URI
pairs in `context.workspaceState`; compiler artifacts remain session state.

- [ ] **Step 4: Implement artifact opening**

File artifacts use `workspace.openTextDocument` plus `showTextDocument`.
Directory artifacts use `revealFileInOS`. Refresh removes persisted SoC records
whose output or manifest no longer exists. Never interpret an artifact path
received from the webview; artifact commands accept only tree items created by
the extension host.

- [ ] **Step 5: Compose activation and disposal**

In `activate`, create one output channel, catalog, diagnostics service, artifact
store, providers, and editor provider. Register all four tree views and both
command sets in `context.subscriptions`. If packaged catalog loading fails,
retain ASM/Tiny C activation, publish the asset error, disable only SoC actions,
and show the failure once.

- [ ] **Step 6: Run existing and new unit suites, then commit**

```powershell
npm test
npm run test:soc:vsce:unit
git add -- src/extension.ts src/extensionCommands.ts src/toolchainExplorer.ts src/socExplorer.ts src/types.ts scripts/test-soc-vsce-unit.js
git commit -m "feat: integrate MERC32 SoC workspace views"
```

### Task 6: Add VSCode-Host Integration Tests

**Files:**
- Create: `merc32-vsce/src/test/runTest.ts`
- Create: `merc32-vsce/src/test/suite/index.ts`
- Create: `merc32-vsce/src/test/suite/configurator.test.ts`
- Create: `merc32-vsce/src/test/fixtures/minimal.merc32.json`
- Modify: `merc32-vsce/tsconfig.json`
- Modify: `merc32-vsce/package.json`

**Interfaces:**
- Produces `npm run test:extension` using VSCode 1.74.3 in an isolated user-data
  and extensions directory.

- [ ] **Step 1: Install and configure the extension test dependencies**

```powershell
npm install --save-dev @vscode/test-electron@^2.5.2 mocha@^10.8.2 @types/mocha@^10.0.10
```

Add `mocha` to `compilerOptions.types` and scripts:

```json
"test:extension": "npm run compile && node out/test/runTest.js"
```

`runTest.ts` creates unique temp `user-data` and `extensions` directories and
passes both through `launchArgs`. Do not pass `--disable-extensions`, because it
can disable the extension under test. Remove only those exact directories in
`finally`.

- [ ] **Step 2: Add failing association and schema tests**

Open `minimal.merc32.json` through `vscode.open`; assert the active tab input is
`TabInputCustom` with view type `merc32.socConfigEditor`. Open an ordinary
`settings.json`; assert it is a text editor. Introduce an overlap using a text
edit and wait for a `MERC32 SoC` diagnostic on the second address range, then
undo and assert it clears.

- [ ] **Step 3: Add synchronization and invalid-JSON tests**

Import and call `applySocDocumentUpdates`, the same host edit helper used by
`setValue`; assert the document becomes dirty, save it, execute Undo/Redo, and
assert `cpu.debug` follows every state.
Replace the document with incomplete JSON, invoke Validate, and assert the file
is byte-identical afterward and has a syntax diagnostic. Invoke Reopen as Text
and assert the active tab is no longer the custom view.

- [ ] **Step 4: Add command and artifact tests**

Copy two configs into the fixture workspace, generate each through its explicit
URI, and assert distinct output directories and persisted artifact groups.
Assert Auto-assign changes only missing addresses, normal generation refuses a
modified managed top, Force Generate restores it, and an existing `main.c`
retains exact bytes and `mtimeMs` across both commands. Assert a second config
cannot claim the first output directory until the explicit adoption command.

- [ ] **Step 5: Run extension and regression suites**

```powershell
npm run test:extension
npm test
npm run test:soc
```

Expected: custom/text association, diagnostic ranges, undo/redo, safe
generation, ownership, and artifact refresh tests pass without network access
after the VSCode test binary has been cached.

- [ ] **Step 6: Commit extension tests**

```powershell
git add -- package.json package-lock.json tsconfig.json src/test
git commit -m "test: cover MERC32 SoC configurator integration"
```

### Task 7: Package and Smoke-Test the Offline VSIX

**Files:**
- Create: `merc32-vsce/scripts/test-vsix-smoke.js`
- Create: `merc32-vsce/scripts/smoke-extension/package.json`
- Create: `merc32-vsce/scripts/smoke-extension/suite/index.js`
- Modify: `merc32-vsce/scripts/prepare-resources.js`
- Modify: `merc32-vsce/.vscodeignore`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/README.md`

**Interfaces:**
- Produces `npm run package:vsix` and `npm run test:vsix`.
- Consumes the generator plan's `resources/resource-manifest.json` and prepared
  `resources/rtl` allowlist.

- [ ] **Step 1: Add VSIX tooling and exact content assertions**

```powershell
npm install --save-dev @vscode/vsce@^3.6.2 adm-zip@^0.5.16
```

The smoke script opens the VSIX as ZIP and asserts it contains compiled
extension code, catalog JSON, schema, templates, licenses, webview CSS/JS,
resource manifest, CPU/core/debug/misc RTL, every catalog dependency, and the
protected `rtl/apb_intc/apb_intc.v`. Assert it contains no `src/`, `scripts/`,
test fixture, repository `.git`, `rtl/sim`, readable INTC maintenance path, or
`node_modules/typescript` entry.

- [ ] **Step 2: Package all runtime dependencies and webview assets**

Extend `prepare-resources.js` so its deterministic manifest covers webview,
catalog, schema, template, license, and RTL resources. Keep checked-in webview
assets intact while recreating only generated `resources/rtl` and generated
manifest/schema outputs. Update `.vscodeignore` to exclude development sources,
maps, tests, fixtures, and unused modules while explicitly retaining `out/**`,
runtime dependency files, and `resources/**`.

- [ ] **Step 3: Add deterministic package scripts**

Use:

```json
"package:vsix": "npm run vscode:prepublish && vsce package --out merc32-vsce.vsix",
"test:vsix": "node scripts/test-vsix-smoke.js merc32-vsce.vsix"
```

Package twice from the same Git revision and compare the uncompressed extension
file map and per-file SHA-256 values; ignore ZIP container timestamps. A changed
resource hash is a failure.

- [ ] **Step 4: Build a clean installed-extension smoke harness**

The Node script creates one unique temp root, copies only the smoke extension
harness and maximal config fixture there, installs the VSIX with the cached
VSCode CLI into a temp `extensions` directory, and launches extension tests with
that directory and a fresh `user-data` directory. The harness declares
`extensionDependencies: ["Vikai-mercer.merc32-vsce"]`, executes
`merc32.soc.generate` for the temp config, and asserts the command is provided
by the installed extension rather than an extension-development path.

- [ ] **Step 5: Prove offline generation and self-contained elaboration**

Inside the smoke host, disable proxy/network environment variables, generate
the maximal fixture, assert `software/src/main.c`, header, resolved JSON,
`address-map.json`, manifest, and `rtl/files.f` exist, then run:

```javascript
spawnSync('iverilog', [
    '-Wall', '-Wno-timescale', '-g2005',
    '-s', 'all_peripherals_soc',
    '-o', path.join(output, 'all_peripherals.vvp'),
    '-f', 'files.f',
], { cwd: path.join(output, 'rtl'), encoding: 'utf8' });
```

Search every `files.f` entry and generated manifest source for the temporary
workspace only; fail if any path contains the MERC32 repository checkout. Clean
up only the exact smoke temp root in `finally`.

- [ ] **Step 6: Document installed workflow and run the release gate**

Document: create any named `*.merc32.json`, edit graphically or as JSON,
validate/assign/generate, add `rtl/files.f` to integration, and start software in
`software/src/main.c`. State that the VSIX is offline/self-contained, generation
never overwrites an existing `main.c`, and FPGA projects/testbenches are not
generated.

Run:

```powershell
npm run prepare:resources
npm run compile
npm test
npm run test:soc
npm run test:extension
npm run package:vsix
npm run test:vsix
Set-Location ..
git diff --check
git status --short
```

Expected: every suite passes; the clean installed VSIX generates and elaborates
without a repository checkout.

- [ ] **Step 7: Commit VSIX delivery support**

```powershell
git add -- merc32-vsce/.vscodeignore merc32-vsce/package.json merc32-vsce/package-lock.json merc32-vsce/README.md merc32-vsce/scripts/prepare-resources.js merc32-vsce/scripts/test-vsix-smoke.js merc32-vsce/scripts/smoke-extension
git commit -m "build: deliver offline MERC32 SoC generator VSIX"
```
