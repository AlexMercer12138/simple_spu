# MERC32 Compact SoC Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one self-contained Verilog file, separate firmware, flat software files, one complete README, and a safe v2 manifest while migrating valid v1 outputs without losing user work.

**Architecture:** Keep planning and Verilog module emitters unchanged, add a focused pure RTL-bundle emitter, and move manifest shape validation into a reusable SoC module shared by generation and artifact recovery. Continue using the existing staged file activator for atomic replacement, removal, rollback, and exact-file invariants; generator orchestration decides the v1-to-v2 main-file migration before activation.

**Tech Stack:** TypeScript 6, Node.js 24, synchronous filesystem APIs, SHA-256 manifests, Verilog-2005, Icarus Verilog, VSCode extension host tests, plain Node.js contract tests.

**Spec:** `docs/superpowers/specs/2026-09-01-merc32-soc-output-and-fixed-layout-design.md`

## Global Constraints

- New output is exactly `README.md`, `manifest.json`, `hardware/<project>.v`, optional `firmware/ilb_*` and `firmware/dlb_*`, `software/<project>.h`, and `software/main.c`, apart from pre-existing unknown user files that the generator must preserve.
- `hardware/<project>.v` is self-contained Verilog-2005 and contains no generated `` `include`` dependency.
- RTL fragment bodies are not rewritten; stable source comments and separating newlines are the only inserted bytes.
- Firmware is copied byte-for-byte, keeps its extension, is not embedded or converted, and is referenced as `../firmware/<name>`.
- `software/main.c` is user-owned and is never overwritten by normal, Force Generate, or Adopt Output flows.
- A valid v1 output migrates to v2 atomically; both old and new `main.c` paths are always a conflict.
- The extension and repository `LICENSE` files remain; only generated SoC projects stop receiving a copied license.
- Do not add runtime dependencies or change the `*.merc32.json` schema, planner topology, top-module ABI, address allocation, or grouped APB behavior.
- Preserve the existing uncommitted `2.0.2` version edits in `merc32-vsce/package.json`, `merc32-vsce/package-lock.json`, and `merc32-vsce/README.md`; do not bump the version again in this plan.
- Run commands from `merc32-vsce/` unless a step explicitly says otherwise.

---

### Task 1: Build the Complete Human README Renderer

**Files:**
- Modify: `merc32-vsce/scripts/test-soc-generator.js:12-25, 1450-1770`
- Modify: `merc32-vsce/src/soc/emitSoftware.ts:20-160`
- Modify: `merc32-vsce/src/soc/generator.ts:245-375`
- Modify: `merc32-vsce/resources/templates/README.md.tpl`

**Interfaces:**
- Consumes: Existing immutable `SocPlan`, `formatHex32`, current generator identity, and current generated-file inventory.
- Produces: `GeneratedReadmeMetadata` and `renderGeneratedReadme(plan, metadata, template?)`; Task 3 changes the inventory and scaffold paths atomically.

- [ ] **Step 1: Add failing complete-README assertions with compact metadata**

Add an explicit compact metadata fixture and require all resolved tables rather than the old generated-file bullet list alone. Do not change `expectedGeneratedFiles` or the starter template in this task:

```js
const readmeMetadata = {
    sourceIdentity: 'D:/workspace/demo.merc32.json',
    generatorVersion: '2.0.2',
    resourceRevision: 'resource-r1',
    integration: [
        '`iverilog -g2005 -s demo_soc hardware/demo_soc.v`',
        'Edit `software/main.c` and include `software/demo_soc.h`.',
    ],
    outputFiles: [
        'README.md', 'manifest.json', 'hardware/demo_soc.v',
        'firmware/ilb_firmware.mem', 'software/demo_soc.h', 'software/main.c',
    ],
    rtlSources: [
        'rtl/cpu/MERC32_top.v',
        'rtl/cpu/core.v',
        'generated/demo_soc_apb_interconnect.v',
        'generated/demo_soc_plb_router.v',
        'generated/demo_soc.v',
    ],
};
const readme = soc.renderGeneratedReadme(controllerPlan, readmeMetadata);
for (const heading of [
    '## Integration', '## CPU', '## Memories', '## APB peripherals',
    '## External interfaces', '## Interrupt routing', '## Top-level ports',
    '## RTL composition', '## Output files', '## Generation identity',
]) assert.match(readme, new RegExp(`^${heading}$`, 'm'));
assert.match(readme, /\| uart0 \| apb_uart \| apb_uart \| 0x10000000 \| 0x10000fff \|/);
assert.match(readme, /\| external\.wake \| 3 \| falling \| external_wake \|/);
assert.match(readme, /\$readmemh/);
assert.doesNotMatch(readme, /address-map\.json|resolved\.json|rtl\/files\.f|LICENSE/);
```

- [ ] **Step 2: Run the focused generator contract and verify the old contract fails**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: FAIL because `renderGeneratedReadme` does not accept the metadata object and README lacks the resolved sections.

- [ ] **Step 3: Implement the complete README renderer**

Replace the public JSON renderers with private table helpers and introduce this exact call shape:

```ts
export interface GeneratedReadmeMetadata {
    sourceIdentity: string;
    generatorVersion: string;
    resourceRevision: string;
    integration: readonly string[];
    outputFiles: readonly string[];
    rtlSources: readonly string[];
}

export function renderGeneratedReadme(
    plan: SocPlan,
    metadata: GeneratedReadmeMetadata,
    template: string = readBundledTemplate('README.md.tpl'),
): string;
```

Make table cells escape `|`, backslash, CR, and LF so catalog/config values cannot break Markdown rows. Render sorted parameter entries as `` `NAME=value` `` joined with `<br>`, normalized eight-digit addresses through `formatHex32`, explicit byte sizes, `None configured` for empty repeated sections, the supplied RTL sources/output files, and the full metadata fields.

Rewrite `README.md.tpl` to contain the ten tested headings and named template fields for identity, integration, CPU, memory, peripheral, external-interface, interrupt, port, RTL-source, and output-file content. Update `generator.ts` to pass the current `expectedGeneratedFiles(plan)`, current generated RTL logical sources, source identity, `readGeneratorVersion()`, `resourceRevision`, and the current `rtl/files.f`/nested-software integration instructions. Task 3 replaces only the metadata values with the compact single-file instructions when it switches all paths together, so each checkpoint's generated README remains truthful.

- [ ] **Step 4: Run the emitter assertions and Tiny C scaffold compile**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: PASS. The generator still emits its old tree at this checkpoint, but its README now completely describes the plan and accurately lists that checkpoint's files.

- [ ] **Step 5: Commit the renderer contract**

```powershell
git add -- scripts/test-soc-generator.js src/soc/emitSoftware.ts src/soc/generator.ts resources/templates/README.md.tpl
git commit -m "refactor: define compact SoC output contract"
```

### Task 2: Build the Deterministic Single-File RTL Emitter

**Files:**
- Create: `merc32-vsce/src/soc/emitRtlBundle.ts`
- Modify: `merc32-vsce/src/soc/index.ts`
- Modify: `merc32-vsce/scripts/test-soc-generator.js:12-25, 1450-1745`

**Interfaces:**
- Consumes: `SocPlan`, `renderApbInterconnect`, `renderPlbRouter`, `renderSocTop`, and a generator-supplied `(logicalPath: string) => Buffer` asset reader.
- Produces: `RtlBundle`, `RtlAssetReader`, and `renderRtlBundle(plan, readAsset)` for Task 3.

- [ ] **Step 1: Add a failing bundle-order and byte-preservation test**

Use the controller plan and marker-bearing asset buffers:

```js
const bundle = soc.renderRtlBundle(controllerPlan,
    (logicalPath) => Buffer.from(`module_marker ${logicalPath}\n`, 'utf8'));
assert.ok(Buffer.isBuffer(bundle.content));
assert.strictEqual(new Set(bundle.logicalSources).size, bundle.logicalSources.length);
assert.deepStrictEqual(bundle.logicalSources.slice(0, 4), [
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
]);
assert.strictEqual(bundle.logicalSources.at(-1), 'generated/demo_soc.v');
for (const source of bundle.logicalSources) {
    assert.strictEqual((bundle.content.toString('utf8')
        .match(new RegExp(`Source: ${source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g')) || []).length, 1);
}
assert.doesNotMatch(bundle.content.toString('utf8'), /`include\b/);
assert.strictEqual(soc.renderRtlBundle(controllerPlan,
    (logicalPath) => Buffer.from(`module_marker ${logicalPath}\n`)).content.equals(bundle.content), true);
```

Also assert an asset body lacking a final newline appears byte-for-byte between its source marker and exactly two separating LF bytes.

- [ ] **Step 2: Run the focused test and verify the new export is missing**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: FAIL with `soc.renderRtlBundle is not a function`.

- [ ] **Step 3: Implement the pure bundle emitter**

Create these interfaces and fixed source ordering:

```ts
export type RtlAssetReader = (logicalPath: string) => Buffer;

export interface RtlBundle {
    content: Buffer;
    logicalSources: readonly string[];
}

const FOUNDATION_ORDER = [
    'rtl/cpu/MERC32_top.v',
    'rtl/cpu/core.v',
    'rtl/misc/div.v',
    'rtl/misc/mul.v',
    'rtl/misc/spram.v',
] as const;

export function renderRtlBundle(plan: SocPlan, readAsset: RtlAssetReader): RtlBundle;
```

Select foundation files in `FOUNDATION_ORDER`, then sorted `rtl/debug/`, then sorted `rtl/bridge/`, then all other selected packaged files sorted lexically. Append generated APB interconnect when defined, generated PLB router, and generated top. Use logical names `generated/<project>_apb_interconnect.v`, `generated/<project>_plb_router.v`, and `generated/<project>.v`.

Assemble each fragment this way without decoding and re-encoding the body:

```ts
const marker = Buffer.from(`// ---- Source: ${logicalSource} ----\n`, 'ascii');
chunks.push(marker, body);
if (body.length === 0 || body[body.length - 1] !== 0x0a) chunks.push(Buffer.from('\n'));
chunks.push(Buffer.from('\n'));
```

Reject duplicate logical sources before concatenation. Export the module from `src/soc/index.ts`.

- [ ] **Step 4: Run bundle and existing Verilog emitter tests**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
node scripts/test-soc-config.js
```

Expected: Bundle assertions and existing planner/emitter contracts pass; old generator inventory failures remain for Task 3.

- [ ] **Step 5: Commit the bundle emitter**

```powershell
git add -- src/soc/emitRtlBundle.ts src/soc/index.ts scripts/test-soc-generator.js
git commit -m "feat: assemble generated SoC RTL into one file"
```

### Task 3: Generate the Compact Layout and Manifest v2

**Files:**
- Create: `merc32-vsce/src/soc/manifest.ts`
- Modify: `merc32-vsce/src/soc/generator.ts:82-375, 512-651`
- Modify: `merc32-vsce/src/soc/emitSoftware.ts:20-160`
- Modify: `merc32-vsce/src/soc/emitVerilog.ts:192-205`
- Modify: `merc32-vsce/src/soc/index.ts`
- Modify: `merc32-vsce/scripts/test-soc-generator.js:170-450, 1450-1515`
- Modify: `merc32-vsce/resources/templates/main.c.tpl`

**Interfaces:**
- Consumes: `renderRtlBundle`, Task 1 output renderers, existing file-manager safety primitives, and catalog RTL allowlists.
- Produces: `SocManifest`, `SocManifestV1`, `SocManifestV2`, `parseSocManifest(value, options)`, and fresh v2 generator output for Tasks 4 and 5.

- [ ] **Step 1: Add failing fresh-generation and v2 allowlist tests**

Change the orchestration inventory to:

```js
const expectedFiles = [
    'README.md',
    'manifest.json',
    'hardware/demo_soc.v',
    'software/demo_soc.h',
    'software/main.c',
];
assert.strictEqual(firstManifest.manifestVersion, 2);
assert.deepStrictEqual(firstManifest.files.find((record) => record.path === 'software/main.c'), {
    kind: 'scaffold/user-owned',
    logicalSource: 'templates/main.c.tpl',
    path: 'software/main.c',
});
assert.strictEqual(firstManifest.files.find((record) => record.path === 'hardware/demo_soc.v').kind,
    'generated/rtl-bundle');
for (const removed of [
    'rtl', 'memory', 'config', 'address-map.json', 'LICENSE',
]) assert.strictEqual(fs.existsSync(path.join(outputDir, removed)), false);
```

For initialized memories, write one binary `Buffer.from([0x00, 0xff, 0x7f, 0x80])` and one text file, then assert exact bytes under `firmware/` and `../firmware/ilb_<name>` / `../firmware/dlb_<name>` in the hardware bundle.

Forge v2 records for `../victim`, an absolute path, `hardware/other.v`, a second user scaffold, a firmware path with the wrong slot, a mismatched logical source, and a manifest self-record. Assert `SOC_MANIFEST` and an unchanged directory snapshot for normal, force, and adopt invocations.

- [ ] **Step 2: Run the generator test and verify it still emits v1 and the old tree**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: FAIL on `manifestVersion === 2` or the compact expected inventory.

- [ ] **Step 3: Create the shared manifest model and strict parsers**

Define the discriminated union and parser:

```ts
export const V1_MAIN_PATH = 'software/src/main.c' as const;
export const V2_MAIN_PATH = 'software/main.c' as const;

export interface SocManifestBase {
    files: readonly ManifestFileRecord[];
    generatorVersion: string;
    manifestFile: {
        hashPolicy: 'excluded-self';
        kind: 'control/manifest';
        path: 'manifest.json';
    };
    projectName: string;
    resourceRevision: string;
    sourceConfig: string;
}

export type SocManifestV1 = SocManifestBase & { manifestVersion: 1 };
export type SocManifestV2 = SocManifestBase & { manifestVersion: 2 };
export type SocManifest = SocManifestV1 | SocManifestV2;

export interface ParseSocManifestOptions {
    allowedAssetRtlPaths?: ReadonlySet<string>;
}

export function parseSocManifest(value: unknown, options: ParseSocManifestOptions = {}): SocManifest;
```

The v1 allowlist is the current exact generated path map plus safe `rtl/` assets and `memory/(ilb|dlb)_<basename>`. When `allowedAssetRtlPaths` is supplied, v1 `asset/rtl` records must occur in that set. The v2 allowlist is only:

```ts
const v2Exact = new Map([
    [`hardware/${projectName}.v`, ['generated/rtl-bundle', 'generator:renderRtlBundle']],
    [`software/${projectName}.h`, ['generated/software-header', 'generator:renderSocHeader']],
    ['README.md', ['generated/documentation', 'templates/README.md.tpl']],
]);
const firmwarePattern = /^firmware\/(ilb|dlb)_([^/]+)$/;
```

Change the starter-source expectation to `#include "demo_soc.h"` and remove assertions that require public `renderAddressMap` or `renderResolvedConfig` exports.

Require exactly one version-appropriate user record, SHA-256 only on managed records, no manifest self-record, canonical safe relative paths, and case-insensitive uniqueness. Export from `src/soc/index.ts`.

- [ ] **Step 4: Rewire fresh generation to the compact files**

In `generator.ts`, set:

```ts
const MAIN_PATH = V2_MAIN_PATH;
const MANIFEST_PATH = 'manifest.json';
```

Build the RTL bundle first, then pass its `logicalSources` plus generator and resource metadata into `renderGeneratedReadme`. Emit only:

```ts
generatedFile(`hardware/${plan.topModule}.v`, rtlBundle.content,
    'generator:renderRtlBundle', 'generated/rtl-bundle');
generatedFile(`firmware/${memory.initFile.outputName}`, firmwareBytes,
    `config:memory.${slot}.initFile`, 'source/firmware');
generatedFile(`software/${headerFileName(plan)}`, renderSocHeader(plan),
    'generator:renderSocHeader', 'generated/software-header');
generatedFile('README.md', readme,
    'templates/README.md.tpl', 'generated/documentation');
```

Remove generation of copied RTL assets, separate generated Verilog, `files.f`, resolved/address JSON, and generated license. Write `manifestVersion: 2` and validate existing manifests via `parseSocManifest(value, { allowedAssetRtlPaths })`.

Change the internal-memory default path in `renderSocTop` from `../memory/<name>` to `../firmware/<name>`. Keep the empty-string default for an internal RAM without an initialization file.

At the same time, replace `expectedGeneratedFiles` with:

```ts
export function expectedGeneratedFiles(plan: SocPlan): readonly string[] {
    const files = ['README.md', 'manifest.json', `hardware/${plan.topModule}.v`];
    for (const memory of [plan.memory.ilb, plan.memory.dlb]) {
        if (memory.initFile !== undefined) files.push(`firmware/${memory.initFile.outputName}`);
    }
    files.push(`software/${headerFileName(plan)}`, 'software/main.c');
    return files;
}
```

Remove the unused public resolved/address JSON renderers after moving their formatting helpers behind README rendering. Change `main.c.tpl` to include the same-directory header:

```c
#include "{{HEADER_FILE}}"

int main(void) {
    while (1) {
    }
    return 0;
}
```

- [ ] **Step 5: Run fresh-output, manifest, deterministic, and firmware tests**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: PASS for all existing and newly updated tests. No v1 migration matrix is added until Task 4, so this checkpoint is green.

- [ ] **Step 6: Commit fresh v2 generation**

```powershell
git add -- src/soc/manifest.ts src/soc/generator.ts src/soc/emitSoftware.ts src/soc/emitVerilog.ts src/soc/index.ts scripts/test-soc-generator.js resources/templates/main.c.tpl
git commit -m "feat: generate compact manifest v2 projects"
```

### Task 4: Migrate v1 Outputs and Protect Both main.c Paths

**Files:**
- Modify: `merc32-vsce/src/soc/generator.ts:146-240, 380-495`
- Modify: `merc32-vsce/src/soc/manifest.ts`
- Modify: `merc32-vsce/scripts/test-soc-generator.js:250-1455`
- Test: `merc32-vsce/src/soc/fileManager.ts` through existing generator race/rollback tests; modify only if a failing atomic-move case proves the existing activation contract is insufficient.

**Interfaces:**
- Consumes: Parsed v1/v2 manifests, `ExpectedTargetState`, `activateStagedFiles`, staged v2 `main.c`, and managed-file hashes.
- Produces: `MainActivation` and v1 stale-file migration operations consumed by `generateSoc`.

- [ ] **Step 1: Add the complete failing migration matrix**

Create a helper that generates a v1 fixture using the old allowlisted paths and hashes. Add cases for:

```js
const mainCases = [
    { old: false, next: false, outcome: 'template' },
    { old: true, next: false, outcome: 'migrate-exact-bytes' },
    { old: false, next: true, outcome: 'preserve-next' },
    { old: true, next: true, outcome: 'user-owned-collision' },
];
```

Use non-UTF-8 bytes for the old scaffold to prove exact migration. Assert both-path collision leaves the complete snapshot unchanged for `force: false` and `force: true`. Assert an old path without a valid v1 manifest conflicts instead of being guessed as owned.

Add unchanged/modified v1 cases for copied RTL, generated RTL, `files.f`, both JSONs, license, and memory copies. Normal generation removes unchanged stale records and relocates memory; normal generation rejects modified stale records; Force Generate removes modified stale records; Adopt Output never authorizes modified stale cleanup from another owner. Preserve an unmanaged file inside `rtl/` and prove only empty owned directories disappear.

- [ ] **Step 2: Run migration tests and verify the first unsupported transition fails**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: FAIL because old `software/src/main.c` is not moved and modified stale files still conflict under Force Generate.

- [ ] **Step 3: Implement explicit user-scaffold activation planning**

Add:

```ts
interface MainActivation {
    content: Buffer;
    createOnlyPaths: readonly ActivationTarget[];
    invariantPaths: readonly ActivationTarget[];
    removePaths: readonly ActivationTarget[];
    skippedUserFiles: readonly string[];
}

function planMainActivation(
    outputDir: string,
    previous: SocManifest | undefined,
    template: GeneratedFile,
): MainActivation;
```

Inspect both paths before creating the staging directory. If both are regular files, or the old path exists without a valid v1 user record, throw `SocGenerationError` with a new `SocFileConflict.reason` value `user-owned-collision`. If only the v1 path exists, read its bytes, stage those bytes at `software/main.c`, create the new path with its expected-missing state, and remove the old path with the exact inspected identity/hash. If only the new path exists, make it an invariant. If neither exists, stage the template as create-only.

Pass the returned operations into the existing single `activateStagedFiles` call:

```ts
createOnlyPaths: mainActivation.createOnlyPaths,
removePaths: [...inspection.stalePaths, ...mainActivation.removePaths],
invariantPaths: mainActivation.invariantPaths,
```

Return `mainActivation.skippedUserFiles`. Never branch on `force` for a user scaffold.

- [ ] **Step 4: Allow verified stale cleanup under the exact force rules**

Remove the special case that always conflicts for an unchanged old memory copy. For a hash-mismatched stale managed record, use:

```ts
if (adopting || !force) {
    conflicts.push({ path: relativePath, reason: 'modified-stale' });
} else {
    stalePaths.set(relativePath, {
        kind: 'regular-file',
        sha256: inspectedHash,
        identity: identityOf(status),
    });
}
```

Keep modified desired records as `modified-managed`, force-replaceable only when not adopting. Continue feeding every operation's exact identity and hash into activation so the existing TOCTOU and rollback checks cover migrated removals.

- [ ] **Step 5: Run migration, race, rollback, and recovery tests**

Run:

```powershell
npm run compile
node scripts/test-soc-generator.js
```

Expected: All fresh and v1 migration cases pass, including injected staging races, activation rollback, recovery-directory retention, exact old-main bytes, Force Generate stale cleanup, and unknown-file preservation.

- [ ] **Step 6: Commit migration behavior**

```powershell
git add -- src/soc/generator.ts src/soc/manifest.ts scripts/test-soc-generator.js
git commit -m "feat: migrate generated SoC outputs to manifest v2"
```

### Task 5: Recover v1 and v2 Artifacts Safely

**Files:**
- Modify: `merc32-vsce/src/socExplorer.ts:255-270, 380-445, 622-747`
- Modify: `merc32-vsce/scripts/test-soc-vsce-unit.js:180-330, 1210-1445`
- Modify: `merc32-vsce/src/test/suite/configurator.test.ts:165-250`

**Interfaces:**
- Consumes: `parseSocManifest` and its safe-record validation from Task 3.
- Produces: `artifactPathsFromManifest(value)` and `ArtifactManifestBinding` supporting valid v1 and v2 persisted outputs.

- [ ] **Step 1: Add failing artifact-binding tests for both versions**

Keep one valid v1 fixture and add a valid v2 fixture with README, hardware, header, main, and two firmware records. Require this v2 order:

```js
assert.deepStrictEqual(artifactPathsFromManifest(v2Manifest), [
    'README.md',
    'hardware/demo.v',
    'software/demo.h',
    'software/main.c',
    'firmware/ilb_boot.mem',
    'firmware/dlb_data.bin',
]);
```

Assert forged v2 kinds, hashes, duplicate paths, main hashes, firmware slot mismatches, unlisted files, and unsafe paths return `undefined`. Update store-refresh fixtures so the Artifacts group contains the output directory and manifest followed by existing compact files; missing optional firmware is skipped without invalidating the group.

- [ ] **Step 2: Run VSCode-independent unit tests and verify v2 is rejected**

Run:

```powershell
npm run compile
node scripts/test-soc-vsce-unit.js
```

Expected: FAIL because `artifactManifestBinding` accepts only version 1 and requires the old three paths.

- [ ] **Step 3: Reuse manifest parsing and select only validated artifacts**

Import `parseSocManifest`, catch its validation error, and map paths by version:

```ts
function artifactManifestBinding(value: unknown): ArtifactManifestBinding | undefined {
    let manifest: SocManifest;
    try {
        manifest = parseSocManifest(value);
    } catch {
        return undefined;
    }
    return {
        paths: manifest.manifestVersion === 1
            ? legacyArtifactPaths(manifest)
            : compactArtifactPaths(manifest),
        sourceConfig: manifest.sourceConfig,
    };
}
```

For v1 preserve the current top/header/address-map selection. For v2 require one exact README, bundle, header, and main record, then append validated firmware records in ILB-before-DLB lexical order. Remove duplicate local manifest-record allowlisting from `socExplorer.ts`; keep `artifactPathsFromManifest` exported from this module for API compatibility.

- [ ] **Step 4: Run artifact unit and extension-host recovery tests**

Run:

```powershell
npm run compile
node scripts/test-soc-vsce-unit.js
npm run test:extension
```

Expected: Valid persisted v1 and v2 outputs reappear, forged manifests are ignored with the existing error callback, and generated v2 groups expose the compact files.

- [ ] **Step 5: Commit artifact recovery**

```powershell
git add -- src/socExplorer.ts scripts/test-soc-vsce-unit.js src/test/suite/configurator.test.ts
git commit -m "feat: restore compact SoC artifacts from manifest v2"
```

### Task 6: Move Every Consumer to the Single RTL File and Verify the VSIX

**Files:**
- Modify: `merc32-vsce/scripts/test-soc-rtl.js:600-650, 1270-1470`
- Modify: `merc32-vsce/scripts/smoke-extension/suite/icarus.js`
- Modify: `merc32-vsce/scripts/test-smoke-extension.js`
- Modify: `merc32-vsce/scripts/smoke-extension/suite/index.js:95-165`
- Modify: `merc32-vsce/scripts/test-soc-webview.js:35-55, 225-245`
- Modify: `merc32-vsce/README.md:44-60`
- Modify only if test expectations require it: `merc32-vsce/scripts/test-vsix-smoke.js`

**Interfaces:**
- Consumes: The final v2 file paths from Tasks 1-5.
- Produces: Single-file Icarus matrix, installed-VSIX smoke coverage, current visual dependency fixture, and user-facing integration instructions. This is the prerequisite state for `2026-09-01-merc32-fixed-editor-layout.md`.

- [ ] **Step 1: Change RTL and smoke tests to fail unless exactly one generated `.v` is used**

Replace `files.f` assertions with:

```js
const hardwareRoot = path.join(generationResult.outputDir, 'hardware');
const hardwareFile = path.join(hardwareRoot, `${generatedConfig.project.name}.v`);
assert.deepStrictEqual(listVerilogFiles(hardwareRoot), [`${generatedConfig.project.name}.v`]);
const args = [
    '-Wall', '-Wno-timescale', '-g2005',
    '-s', generatedConfig.project.name,
    '-o', outputFile,
    hardwareFile,
];
assert.strictEqual(args.filter((argument) => argument.endsWith('.v')).length, 1);
```

Pass `hardwareFile` to every generated-SoC testbench compile instead of `-f files.f`. Change the smoke helper signature to:

```js
runIcarusElaboration({ outputDir, hardwareFile, topModule, timeoutMs, spawnSync })
```

Require installed output `README.md`, `manifest.json`, `hardware/all_peripherals_soc.v`, `software/all_peripherals_soc.h`, and `software/main.c`; reject old output paths and assert `manifestVersion === 2`.

- [ ] **Step 2: Run RTL and smoke unit tests and verify old file-list assumptions fail**

Run:

```powershell
npm run compile
node scripts/test-soc-rtl.js
node scripts/test-smoke-extension.js
```

Expected: FAIL at the remaining `rtl/files.f` or old `runIcarusElaboration` contract before consumer changes are complete.

- [ ] **Step 3: Complete all single-file consumer changes**

Update `assembleAndElaborate`, external IRQ reset, and single-source controller simulations so their testbench source is the only second `.v` argument. Keep `-g2005`, `-Wall`, `-Wno-timescale`, explicit `-s`, timeout, cleanup, and warning assertions unchanged.

Change the visual dependency fixture from separate generated top/router entries to:

```js
dependencyRows: [
    { name: 'hardware/flight_controller.v', kind: 'generated/rtl', detail: 'Complete SoC RTL bundle' },
    { name: 'software/flight_controller.h', kind: 'generated/header', detail: 'Software address map' },
],
```

Update the extension README instructions to compile `hardware/<project>.v`, edit `software/main.c`, include `software/<project>.h`, and describe optional `firmware/`. Preserve the already-edited `2.0.2` badge.

- [ ] **Step 4: Run the complete output and RTL regression set**

Run:

```powershell
npm run compile
node scripts/test-soc-config.js
node scripts/test-soc-generator.js
node scripts/test-soc-rtl.js
node scripts/test-soc-vsce-unit.js
node scripts/test-smoke-extension.js
npm run test:soc:webview
npm run test:extension
npm run test:vsix:deps
```

Expected: All commands pass and every generated RTL simulation compiles from one hardware file.

- [ ] **Step 5: Package and test the actual 2.0.2 VSIX**

Run:

```powershell
npm test
npm run package:vsix
npm run test:vsix
```

Expected: `merc32-vsce.vsix` is rebuilt as version `2.0.2`; installed smoke generation produces manifest v2 and Icarus elaborates `hardware/all_peripherals_soc.v` without repository RTL access or network access.

- [ ] **Step 6: Inspect the packaged resource and output contracts**

Run:

```powershell
node -e "const AdmZip=require('adm-zip');const z=new AdmZip('merc32-vsce.vsix');const n=z.getEntries().map(e=>e.entryName);for(const p of ['extension/resources/templates/README.md.tpl','extension/resources/templates/main.c.tpl','extension/out/soc/generator.js','extension/out/soc/emitRtlBundle.js','extension/out/soc/manifest.js']){if(!n.includes(p))throw new Error('missing '+p)};console.log('compact output resources present')"
git status --short
```

Expected: The five packaged entries are present. Only intentional source changes, the pre-existing `2.0.2` metadata changes, the ignored VSIX, and any later fixed-layout-plan changes appear.

- [ ] **Step 7: Commit consumer and documentation updates**

```powershell
git add -- scripts/test-soc-rtl.js scripts/smoke-extension/suite/icarus.js scripts/test-smoke-extension.js scripts/smoke-extension/suite/index.js scripts/test-soc-webview.js README.md
git commit -m "test: verify compact SoC output end to end"
```
