# MERC32 Shared APB Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate one PLB/LB target and one `lb2apb` bridge for all built-in APB peripherals while preserving exact sparse address decoding and independent external-interface routes.

**Architecture:** Keep `SocPlan.endpoints` as the addressable configuration inventory consumed by software, editor, and address-map emitters. Add `SocPlan.routerTargets` as the independent PLB topology: one synthetic `builtin_apb` target owns every exact built-in peripheral range, while each external interface owns one range. The Verilog router and top-level router wiring consume only `routerTargets`; the APB interconnect continues to consume `peripherals` and decode full absolute addresses.

**Tech Stack:** TypeScript 6, Node.js contract tests, deterministic Verilog-2005 emitters, Icarus Verilog (`iverilog`/`vvp`).

**Spec:** `docs/superpowers/specs/2026-08-31-merc32-shared-apb-routing-design.md`

## Global Constraints

- Do not change the SoC JSON schema, catalog format, peripheral address map, software output, editor address rows, command output, or public external-interface ports.
- `SocPlan.endpoints` remains present, ordered, and byte-for-byte equivalent at all existing consumers.
- A non-empty built-in peripheral list produces exactly one `builtin_apb` router target; an empty list produces none.
- `builtin_apb.ranges` contains every exact peripheral `[baseAddress, endAddress]` pair, never a minimum-to-maximum bounding range.
- Every external interface remains an independent router target with its configured range and existing protocol bridge.
- Router targets are sorted deterministically by their lowest range base address.
- Generated RTL remains deterministic Verilog-2005 with the existing single-master, single-outstanding-request behavior.
- No new runtime dependency is introduced.

---

### Task 1: Separate Address Inventory from Router Topology

**Files:**
- Modify: `merc32-vsce/src/soc/model.ts`
- Modify: `merc32-vsce/src/soc/planner.ts`
- Modify: `merc32-vsce/src/soc/validate.ts`
- Test: `merc32-vsce/scripts/test-soc-config.js`

**Interfaces:**
- Consumes: validated `PlannedPeripheral[]` and `PlannedExternalInterface[]` from the existing planner.
- Produces: `PlannedRouterRange`, `PlannedRouterTarget`, and `SocPlan.routerTargets` for Task 2.
- Preserves: `SocPlan.endpoints` and every existing downstream address/software consumer.

- [ ] **Step 1: Add failing planner assertions for grouped exact ranges**

Extend the existing `multi-peripheral.merc32.json` plan assertions in `test-soc-config.js` without changing the `plan.endpoints` expectations:

```javascript
assert.deepStrictEqual(plan.endpoints.map((item) => item.name),
    ['uart0', 'uart1', 'gpio0', 'intc0', 'apb_ext0', 'axi0']);
assert.deepStrictEqual(plan.routerTargets.map((target) => target.name),
    ['builtin_apb', 'apb_ext0', 'axi0']);
assert.deepStrictEqual(plan.routerTargets[0], {
    name: 'builtin_apb',
    ranges: plan.peripherals.map((peripheral) => ({
        baseAddress: peripheral.baseAddress,
        endAddress: peripheral.endAddress,
    })),
});
assert.deepStrictEqual(
    plan.routerTargets.find((target) => target.name === 'apb_ext0').ranges,
    [{ baseAddress: 0x20000000n, endAddress: 0x20000fffn }],
);
assert.deepStrictEqual(plannedMinimal.routerTargets, []);
```

Add a sparse fixture in the same test with built-in peripherals at `0x10000000` and `0x10002000` and an external local-bus endpoint at `0x10001000`. Assert target order is `builtin_apb`, external only if the grouped target's lowest range is lowest, and assert the grouped target retains two distinct ranges rather than covering the gap.

Add a collision fixture with at least one built-in peripheral plus an external interface named `builtin_apb`. Assert planning is rejected with `SOC_VERILOG_SYMBOL_COLLISION` at `['externalInterfaces', 0, 'name']`. Also assert the same external name remains legal when there are no built-in peripherals, because the synthetic namespace is then absent.

- [ ] **Step 2: Run the planner suite and verify RED**

Run:

```powershell
Set-Location merc32-vsce
npm run test:soc:config
```

Expected: TypeScript may still compile, but the Node assertion fails because `plan.routerTargets` is `undefined`. The failure must be about the missing topology property, not fixture parsing or overlap validation.

- [ ] **Step 3: Add the explicit router topology model**

Add to `model.ts`:

```typescript
export interface PlannedRouterRange {
    baseAddress: bigint;
    endAddress: bigint;
}

export interface PlannedRouterTarget {
    name: string;
    ranges: readonly PlannedRouterRange[];
}
```

Add `routerTargets: readonly PlannedRouterTarget[];` to `SocPlan` immediately after `endpoints`.

In `planner.ts`, import `PlannedRouterTarget` and construct topology independently of `endpoints`:

```typescript
function planRouterTargets(
    peripherals: readonly PlannedPeripheral[],
    externalInterfaces: readonly PlannedExternalInterface[],
): PlannedRouterTarget[] {
    const targets: PlannedRouterTarget[] = externalInterfaces.map((endpoint) => ({
        name: endpoint.name,
        ranges: [{ baseAddress: endpoint.baseAddress, endAddress: endpoint.endAddress }],
    }));
    if (peripherals.length > 0) {
        targets.push({
            name: 'builtin_apb',
            ranges: peripherals.map((peripheral) => ({
                baseAddress: peripheral.baseAddress,
                endAddress: peripheral.endAddress,
            })),
        });
    }
    return targets.sort((left, right) =>
        compareBigints(left.ranges[0].baseAddress, right.ranges[0].baseAddress));
}
```

Call it after planning the two source lists and include the frozen result in `SocPlan`. All range arrays are non-empty by construction.

- [ ] **Step 4: Update generated-symbol validation for synthetic topology**

In `validate.ts`, stop calling `recordEndpointSymbols` for built-in peripherals. Their APB instance, interrupt, descriptor-port, and APB-interconnect symbols remain recorded exactly as today.

When `config.peripherals.length > 0`, reserve these additional generated symbols:

```typescript
reserve('top', [
    'builtin_apb_router_rden', 'builtin_apb_router_wren',
    'builtin_apb_router_addr', 'builtin_apb_router_strb',
    'builtin_apb_router_wdata', 'builtin_apb_router_rdata',
    'builtin_apb_router_ack',
]);
reserve('router', [
    'builtin_apb_rden', 'builtin_apb_wren', 'builtin_apb_addr',
    'builtin_apb_strb', 'builtin_apb_wdata', 'builtin_apb_rdata',
    'builtin_apb_ack', 'ENDPOINT_TARGET_BUILTIN_APB',
]);
```

Keep `recordEndpointSymbols` for every external interface so user names still collide against the synthetic `builtin_apb` namespace and all external endpoint symbol checks remain active.

- [ ] **Step 5: Verify GREEN and compatibility**

Run:

```powershell
npm run test:soc:config
npm run test:soc:vsce:unit
npm run compile
```

Expected: all pass; the existing `endpoints`, resolved-config, software, top-port, interrupt, deep-freeze, and deterministic-order assertions remain unchanged and green.

- [ ] **Step 6: Commit the planning model**

```powershell
git add -- src/soc/model.ts src/soc/planner.ts src/soc/validate.ts scripts/test-soc-config.js
git commit -m "refactor: separate SoC router topology"
```

### Task 2: Emit One Built-In APB Router Channel

**Files:**
- Modify: `merc32-vsce/src/soc/emitVerilog.ts`
- Test: `merc32-vsce/scripts/test-soc-generator.js`
- Test: `merc32-vsce/scripts/test-soc-rtl.js`

**Interfaces:**
- Consumes: `SocPlan.routerTargets` from Task 1.
- Produces: one router port set per topology target and direct `builtin_apb_router_*` to `builtin_apb_bridge_inst` wiring.
- Preserves: APB interconnect decoding from `plan.peripherals` and external endpoint integration from `plan.externalInterfaces`.

- [ ] **Step 1: Add failing generated-RTL topology assertions**

For the existing controller plan in `test-soc-generator.js`, assert:

```javascript
assert.strictEqual((router.match(/output wire builtin_apb_rden/g) || []).length, 1);
assert.strictEqual((top.match(/builtin_apb_bridge_inst/g) || []).length, 1);
for (const name of ['uart0', 'uart1', 'gpio0', 'intc0']) {
    assert.doesNotMatch(`${top}\n${router}`, new RegExp(`\\b${name}_router_`));
}
assert.match(top, /\.lb_rden\s*\(builtin_apb_router_rden\)/);
assert.match(top, /\.lb_addr\s*\(builtin_apb_router_addr\)/);
assert.match(top, /assign builtin_apb_router_ack = builtin_apb_lb_valid;/);
assert.match(router, /ENDPOINT_TARGET_BUILTIN_APB/);
assert.match(router, /32'h1000_0000.*32'h1000_0fff/s);
assert.match(router, /32'h1000_1000.*32'h1000_1fff/s);
assert.match(top, /apb_ext0_router_rden/);
assert.match(top, /axi0_router_rden/);
```

Add a sparse plan with built-in ranges on both sides of an external target and assert the `builtin_apb` decode line contains two parenthesized range clauses joined by `||`; assert the external target has its own decode branch. Keep the existing minimal-plan assertions and add absence of `builtin_apb_router_*`, built-in bridge, and APB interconnect.

- [ ] **Step 2: Add the failing sparse-router behavior simulation**

Replace the synthetic `endpoints` plan in `simulateStatefulRouter()` with:

```javascript
routerTargets: [
    {
        name: 'builtin_apb',
        ranges: [
            { baseAddress: 0x10000000n, endAddress: 0x10000fffn },
            { baseAddress: 0x10002000n, endAddress: 0x10002fffn },
        ],
    },
    {
        name: 'external_gap',
        ranges: [{ baseAddress: 0x10001000n, endAddress: 0x10001fffn }],
    },
],
```

Rename the testbench channel declarations/connections accordingly. Add transactions that assert:

- `0x10000040` selects `builtin_apb`.
- `0x10002004` also selects the same `builtin_apb` channel.
- `0x10001008` selects only `external_gap`.
- `0x10003000` selects neither target and is not acknowledged.
- While a request is outstanding, changing the master address does not forward a second request and only the active target can complete it.

- [ ] **Step 3: Run both suites and verify RED**

Run:

```powershell
npm run test:soc:generator
npm run test:soc:rtl
```

Expected: generator assertions fail because built-in peripheral router signals still exist and `builtin_apb_router_*` does not; the synthetic RTL router render or compile fails because the emitter still consumes `plan.endpoints`. Each failure must identify missing topology behavior rather than fixture parsing or malformed testbench syntax.

- [ ] **Step 4: Make the PLB router consume only `routerTargets`**

In `renderPlbRouter`, replace every topology loop, target count, constant, response mux, and empty-router branch based on `plan.endpoints` with `plan.routerTargets`.

Render each target's decode as an OR over exact ranges. Add a small pure formatting helper, for example:

```typescript
function routerTargetCondition(target: PlannedRouterTarget): string {
    return target.ranges.map((range) =>
        `((m_addr >= ${hex32(range.baseAddress)}) && (m_addr <= ${hex32(range.endAddress)}))`)
        .join(' || ');
}
```

The existing `if`/`else if` priority, request latch, single response mux, reset, and no-match behavior remain otherwise unchanged.

- [ ] **Step 5: Make top-level router wiring consume only `routerTargets`**

Change `emitTopWires` and `emitRouterInstance` to declare/connect `<target>_router_*` signals from `plan.routerTargets`. Do not change the separate `plan.peripherals` and `plan.externalInterfaces` loops that instantiate APB devices and external bridges.

- [ ] **Step 6: Connect the grouped channel directly to the built-in bridge**

In `emitBuiltinApbSubsystem`, remove the request OR reduction and per-peripheral response fan-out. Use direct assignments and router-owned address/data signals:

```typescript
writer.line('assign builtin_apb_lb_rden = builtin_apb_router_rden;');
writer.line('assign builtin_apb_lb_wren = builtin_apb_router_wren;');
writer.line('assign builtin_apb_router_rdata = builtin_apb_lb_rdata;');
writer.line('assign builtin_apb_router_ack = builtin_apb_lb_valid;');
```

Connect `lb2apb` with:

```typescript
['lb_strb', 'builtin_apb_router_strb'],
['lb_wdata', 'builtin_apb_router_wdata'],
['lb_addr', 'builtin_apb_router_addr'],
```

Keep the 32-bit APB address, all peripheral selections/responses, interrupt wiring, protocol bridges, and built-in instance parameters unchanged.

- [ ] **Step 7: Verify GREEN, deterministic output, and simulated routing behavior**

Run:

```powershell
npm run test:soc:generator
npm run test:soc:rtl
npm run test:soc:config
npm run compile
```

Expected: all pass; repeated `renderSocTop`, `renderPlbRouter`, and `renderApbInterconnect` calls remain byte-identical; `router_stateful_behavior: PASS`; the complete generated RTL matrix elaborates with `-g2005` and no warnings.

- [ ] **Step 8: Commit the emitter topology and behavior proof**

```powershell
git add -- src/soc/emitVerilog.ts scripts/test-soc-generator.js scripts/test-soc-rtl.js
git commit -m "fix: share builtin APB router channel"
```

### Task 3: Verify Cross-Layer Compatibility and Packaging

**Files:**
- Review only: all files changed by Tasks 1-2
- Evidence: `.superpowers/sdd/2026-08-31-merc32-shared-apb-routing/task-3-report.md`

**Interfaces:**
- Consumes: the planned topology, deterministic Verilog emitters, editor summaries, generated resource closure, extension host, and packaged VSIX from Tasks 1-2.
- Produces: clean cross-layer, browser, extension-host, and package evidence without adding production behavior.

- [ ] **Step 1: Run cross-layer regressions from fresh command invocations**

Run:

```powershell
npm run test:soc:config
npm run test:soc:generator
npm run test:soc:vsce:unit
npm run test:soc:webview
npm run test:soc:editor-session
npm run test:extension:resources
npm run compile
```

- [ ] **Step 2: Repeat the exact-asset browser workflow**

Start:

```powershell
node scripts/test-soc-webview.js --serve 4173
```

At 1440x900, 900x700, and 480x800, click Generate followed by Project/CPU/Memory/Interrupts. Confirm the property heading changes while generation progress remains active, the 32-route fixture remains usable, and PLB address/status stay inside the reserved lower viewport track. Stop the harness after recording results in the task report.

- [ ] **Step 3: Run extension-host and VSIX verification**

```powershell
npm run test:extension
npm run package:vsix
npm run test:vsix
```

Expected: extension-host tests, resource closure, package creation, and VSIX smoke all pass with the two approved legacy RTL files absent.

- [ ] **Step 4: Audit the shared-routing branch state**

```powershell
Set-Location ..
git diff --check f21a94a..HEAD
git status --short --branch
git log --oneline f21a94a..HEAD
```

Expected: only intentional commits are present, the worktree is clean, and the task report contains the exact command outcomes plus browser geometry/workflow evidence.
