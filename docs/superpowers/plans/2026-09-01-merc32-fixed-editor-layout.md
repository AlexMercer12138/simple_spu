# MERC32 Fixed Editor Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the SoC configurator fill its Webview and permanently retain three upper panes plus two lower panes, with all excess content scrolling only inside its assigned pane.

**Architecture:** Keep the existing semantic HTML and plain JavaScript editor application. Replace content-sensitive and structural responsive CSS with a fixed viewport grid, then exercise the production HTML/CSS/JS through the existing local visual harness in real headless Chromium/Edge and compare actual bounding rectangles across short, Ports, and 32-route states.

**Tech Stack:** VSCode Webview HTML/CSS, plain browser JavaScript, Node.js 24, JSDOM interaction tests, system Chromium or Microsoft Edge headless mode, Node child processes, VSIX archive smoke tests.

**Spec:** `docs/superpowers/specs/2026-09-01-merc32-soc-output-and-fixed-layout-design.md`

## Global Constraints

- Execute this plan after `docs/superpowers/plans/2026-09-01-merc32-compact-soc-output.md`; its visual fixture already describes one RTL bundle.
- `.editor-shell` owns the complete Webview viewport through `position: fixed` and `inset: 0`; the page itself never scrolls.
- After toolbar and optional invalid banner, upper/lower row tracks are exactly `minmax(0, 4fr)` and `minmax(0, 1fr)`.
- Upper columns remain Navigation 23%, Properties 46%, Summary 31% at every width.
- Lower columns remain PLB address space 70%, Status 30% at every width.
- No media query may stack, re-row, or make visible-overflow any of the five panes.
- Navigation, Properties, Summary, PLB address space, and Status each own `overflow: auto`, `min-width: 0`, and `min-height: 0`.
- For a fixed viewport and toolbar/banner state, short content, long Ports, and 32 interrupt routes produce identical lower-band top, bottom, and height within one physical pixel.
- Preserve all existing editor interactions, keyboard behavior, focus/scroll restoration, generation lifecycle, CSP, and native VSCode theme variables.
- Add no npm dependency; use a system browser selected by `MERC32_BROWSER_PATH` or a deterministic platform candidate list.
- Preserve the existing uncommitted extension version as `2.0.2`.

---

### Task 1: Add Browser Geometry Regression Coverage and Fix the Five-Pane Grid

**Files:**
- Modify: `.gitignore`
- Modify: `merc32-vsce/resources/webview/socEditor.css:1-20, 62-180, 490-660`
- Modify: `merc32-vsce/scripts/test-soc-webview.js:1-70, 151-420, 970-990`
- Create: `merc32-vsce/scripts/test-soc-webview-geometry.js`
- Modify: `merc32-vsce/package.json:330-357`

**Interfaces:**
- Consumes: Production `renderEditorHtml`, `socEditor.css`, `socEditor.js`, the existing `createVisualModel`, and a locally installed Chromium-family browser.
- Produces: Exported visual-harness server/scenarios, `test:soc:webview:geometry`, ignored screenshots under `.test-results/soc-webview-geometry/`, and the fixed CSS grid packaged and audited in Task 2.

- [ ] **Step 1: Extend the visual fixture with three deterministic content scenarios**

Expand `portRows` to 40 rows so Ports must scroll in ordinary editor heights. Add scenario selection before the initial state is posted:

```js
function applyVisualScenario(model, scenario) {
    if (scenario === 'short') {
        model.selectedPath = ['cpu'];
        model.visualSummary = 'validation';
    } else if (scenario === 'ports') {
        model.selectedPath = ['cpu'];
        model.visualSummary = 'port';
    } else if (scenario === 'routes') {
        model.selectedPath = ['interrupt'];
        model.visualSummary = 'validation';
    } else {
        throw new Error(`Unknown visual scenario: ${scenario}`);
    }
    return model;
}
```

In `visualHarnessScript`, read `scenario` from `location.search`, apply it to a cloned model, and click the matching summary tab only after the editor handles `ready`. Expose only test state and posted messages through `window.__socHarness`; do not add this control surface to production `socEditor.js`.

Guard the current unit-test entry point and export the server helpers:

```js
if (require.main === module) {
    runAllWebviewContractTests();
    const serveIndex = process.argv.indexOf('--serve');
    if (serveIndex !== -1) startVisualServer(Number(process.argv[serveIndex + 1]));
}

module.exports = { createVisualModel, startVisualServer, visualEditorHtml, visualHarnessScript };
```

Allow server port `0` and print the actual `server.address().port` in the ready line.

- [ ] **Step 2: Create the real-browser measurement runner**

Locate the browser from `MERC32_BROWSER_PATH` first, followed by these candidates when they exist:

```js
const candidates = process.platform === 'win32' ? [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
] : ['/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome'];
```

Spawn `node scripts/test-soc-webview.js --serve 0`, parse its ready URL, and terminate it in `finally`. For every scenario and viewport, launch the browser with:

```js
[
    '--headless=new', '--disable-gpu', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1',
    '--virtual-time-budget=3000',
    `--user-data-dir=${profileDir}`, `--window-size=${width},${height}`,
    `--screenshot=${screenshotFile}`, '--dump-dom',
    `${serverUrl}/?scenario=${scenario}&geometry=1`,
]
```

The harness waits for two `requestAnimationFrame` callbacks after rendering, records `getBoundingClientRect()` for `.editor-shell`, `.toolbar`, `.workbench`, all five panes, and `.bottom-band`, then records document and pane `client*`/`scroll*` metrics. Set the scenario's overflowing pane `scrollTop = 48`, wait another frame, and record the shell/lower-band rectangles again. Serialize the result as base64 JSON in a hidden `<pre id="geometry-result">` so `--dump-dom` can return it without changing layout.

Record `getComputedStyle(pane).overflowX` and `overflowY` for all five panes and require both axes to be `auto`; this verifies Navigation, Properties, Summary, PLB address space, and Status own their overflow even when a particular fixture is too short to overflow one of them.

Use these exact viewports:

```js
const viewports = [
    { name: 'wide', width: 1440, height: 900 },
    { name: 'medium', width: 1000, height: 760 },
    { name: 'narrow', width: 640, height: 720 },
    { name: 'short', width: 1100, height: 520 },
];
const scenarios = ['short', 'ports', 'routes'];
```

Write screenshots to `merc32-vsce/.test-results/soc-webview-geometry/<viewport>-<scenario>.png`, remove the directory at the beginning of a run, and retain it after success or failure. Add `merc32-vsce/.test-results/` to `.gitignore`.

- [ ] **Step 3: Add geometry assertions and run them against the current CSS**

For every result, assert with a one-pixel tolerance:

```js
assertRectEquals(result.shell, { left: 0, top: 0,
    right: result.viewport.width, bottom: result.viewport.height });
assert.strictEqual(result.document.scrollWidth, result.document.clientWidth);
assert.strictEqual(result.document.scrollHeight, result.document.clientHeight);
assertSameRow(result.navigation, result.properties, result.summary);
assertSameRow(result.address, result.status);
assertAdjacent(result.navigation, result.properties);
assertAdjacent(result.properties, result.summary);
assertAdjacent(result.address, result.status);
assertClose(result.workbench.height / result.bottomBand.height, 4, 0.03);
assertClose(result.navigation.width / result.workbench.width, 0.23, 0.01);
assertClose(result.properties.width / result.workbench.width, 0.46, 0.01);
assertClose(result.summary.width / result.workbench.width, 0.31, 0.01);
assertClose(result.address.width / result.bottomBand.width, 0.70, 0.01);
assertClose(result.status.width / result.bottomBand.width, 0.30, 0.01);
assertRectEquals(result.bottomBandAfterScroll, result.bottomBand);
```

Require `ports.summary.scrollHeight > ports.summary.clientHeight` and a positive changed `scrollTop`; require the same for `routes.properties`. For each viewport compare all three scenarios' lower-band `top`, `bottom`, and `height`.

Run:

```powershell
npm run compile
node scripts/test-soc-webview.js
node scripts/test-soc-webview-geometry.js
```

Expected: DOM interaction tests pass; geometry FAILS because current media queries re-row/stack panes and current lower-row sizing is content-sensitive in the reproduced cases.

- [ ] **Step 4: Replace content-sensitive shell sizing and structural breakpoints**

Set the page and shell geometry to:

```css
html,
body {
    width: 100%;
    height: 100%;
    overflow: hidden;
}

body {
    margin: 0;
    min-width: 0;
}

.editor-shell {
    position: fixed;
    inset: 0;
    display: grid;
    grid-template-rows: auto auto minmax(0, 4fr) minmax(0, 1fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.workbench {
    display: grid;
    grid-template-columns: minmax(0, 23fr) minmax(0, 46fr) minmax(0, 31fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}

.bottom-band {
    display: grid;
    grid-template-columns: minmax(0, 7fr) minmax(0, 3fr);
    min-width: 0;
    min-height: 0;
    overflow: hidden;
}
```

Remove the lower band's `height: clamp(...)`. Keep `overflow: auto`, `min-width: 0`, and `min-height: 0` on `.navigation-pane`, `.property-pane`, `.summary-pane`, `.address-overview`, and `.generation-state`.

Delete the `max-width: 1020px` and `max-width: 640px` rules that change workbench rows/columns, pane overflow, Summary placement, or bottom-band stacking. The toolbar may wrap its actions inside its auto row, and the `max-width: 440px` rules may compact field rows and tabs only; they must not change five-pane placement.

- [ ] **Step 5: Replace weak CSS-string checks with fixed-geometry contract checks**

Keep a small source-level guard in `runResponsiveCssContractTests`:

```js
assert.match(rule(cssSource, '.editor-shell'), /position:\s*fixed/);
assert.match(rule(cssSource, '.editor-shell'), /inset:\s*0/);
assert.match(rule(cssSource, '.editor-shell'),
    /minmax\(0,\s*4fr\).*minmax\(0,\s*1fr\)/s);
assert.match(rule(cssSource, '.workbench'), /23fr.*46fr.*31fr/s);
assert.match(rule(cssSource, '.bottom-band'), /7fr.*3fr/s);
assert.doesNotMatch(cssSource, /\.workbench\s*\{[^}]*grid-template-rows/s);
assert.doesNotMatch(cssSource, /\.bottom-band\s*\{[^}]*height:\s*clamp/s);
```

Do not treat these as a substitute for the browser suite; their purpose is to make an accidental structural media-query reintroduction fail with a concise message.

- [ ] **Step 6: Wire geometry tests into the normal SoC test commands**

Use scripts that avoid recursive compilation:

```json
"test:soc:webview:dom": "node scripts/test-soc-webview.js",
"test:soc:webview:geometry": "node scripts/test-soc-webview-geometry.js",
"test:soc:webview": "npm run compile && npm run test:soc:webview:dom && npm run test:soc:webview:geometry"
```

Add `npm run test:soc:webview` to `test:soc` before generator/RTL tests so release verification cannot omit actual layout geometry.

- [ ] **Step 7: Run all DOM and browser states and inspect extreme screenshots**

Run:

```powershell
npm run test:soc:webview
```

Expected: All 12 viewport/scenario measurements pass. Open at least:

```text
.test-results/soc-webview-geometry/narrow-routes.png
.test-results/soc-webview-geometry/short-ports.png
.test-results/soc-webview-geometry/wide-routes.png
```

Verify the screenshots show one upper row of three panes, one lower row of two panes, no overlap, reachable controls, stable lower-band position, and no blank strip below the shell.

- [ ] **Step 8: Run editor interaction and extension regressions**

Run:

```powershell
npm run compile
node scripts/test-soc-editor-session.js
node scripts/test-soc-vsce-unit.js
npm run test:extension
```

Expected: Generation lifecycle, selection during/after generation, mutation serialization, keyboard tabs, route editing, focus restoration, CSP, and extension-host configurator tests all pass.

- [ ] **Step 9: Commit the fixed grid and browser regression suite**

```powershell
git add -- ../.gitignore resources/webview/socEditor.css scripts/test-soc-webview.js scripts/test-soc-webview-geometry.js package.json package-lock.json
git commit -m "fix: keep SoC editor panes in a fixed grid"
```

When staging `package.json` and `package-lock.json`, verify the existing `2.0.2` edits are preserved and no dependency entries were added.

### Task 2: Prove the Fixed Layout Is Present in the Packaged 2.0.2 VSIX

**Files:**
- Modify: `merc32-vsce/scripts/test-vsix-smoke.js:330-410`
- Regenerate ignored artifact: `merc32-vsce/merc32-vsce.vsix`

**Interfaces:**
- Consumes: Task 1 CSS and geometry suite plus compact-output templates from the preceding output plan.
- Produces: Archive-level layout assertions and a release-tested version `2.0.2` VSIX.

- [ ] **Step 1: Add failing archive assertions for the shipped CSS contract**

After locating `extension/resources/webview/socEditor.css` in the archive, decode it and require:

```js
assert.match(packagedCss, /\.editor-shell\s*\{[^}]*position:\s*fixed/s);
assert.match(packagedCss, /\.editor-shell\s*\{[^}]*inset:\s*0/s);
assert.match(packagedCss, /\.workbench\s*\{[^}]*23fr[^}]*46fr[^}]*31fr/s);
assert.match(packagedCss, /\.bottom-band\s*\{[^}]*7fr[^}]*3fr/s);
assert.doesNotMatch(packagedCss, /\.bottom-band\s*\{[^}]*height:\s*clamp/s);
```

Also assert the packaged README template contains `## Memories`, `## Interrupt routing`, and `## RTL composition`, and packaged `main.c.tpl` contains `#include "{{HEADER_FILE}}"` without `../include/`.

- [ ] **Step 2: Run the archive test against the currently stale VSIX**

Run:

```powershell
node scripts/test-vsix-smoke.js merc32-vsce.vsix
```

Expected: FAIL on the packaged fixed-grid or compact-template assertion, proving the test checks archive bytes rather than only the working tree.

- [ ] **Step 3: Rebuild and test the real VSIX**

Run:

```powershell
npm test
npm run test:soc
npm run package:vsix
npm run test:vsix
```

Expected: All unit, browser geometry, generator, single-file RTL, resource, install, offline network-guard, extension-host, Icarus, and archive assertions pass for `merc32-vsce.vsix` version `2.0.2`.

- [ ] **Step 4: Perform final visual and repository checks**

Run:

```powershell
npm run test:soc:webview:geometry
git diff --check
git status --short
```

Open the three extreme screenshots again and compare their lower-band top edge. Confirm there are no unexpected tracked changes; the `2.0.2` metadata must either already be included in an intentional implementation/release commit or remain clearly identified for the final release commit.

- [ ] **Step 5: Commit the archive-level release contract**

```powershell
git add -- scripts/test-vsix-smoke.js
git commit -m "test: enforce fixed SoC layout in packaged VSIX"
```
