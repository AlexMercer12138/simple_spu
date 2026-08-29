# MERC32 SoC Generator Execution Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Each referenced plan contains checkbox (`- [ ]`) steps for tracking.

**Goal:** Deliver the approved offline MERC32 SoC generator without coupling hardware stabilization, compiler preprocessing, generator logic, and VSCode UI into one unreviewable change.

**Architecture:** Four implementation plans form a dependency chain. Hardware first locks the public ABI and creates the protected interrupt-controller artifact; Tiny C preprocessing is independent and may follow immediately; the headless generator then consumes the stable RTL and software interfaces; the VSCode configurator and VSIX packaging integrate the completed headless engine last.

**Tech Stack:** Verilog-2005, Icarus Verilog, TypeScript ES2020/CommonJS, Node.js, VSCode Extension API, JSON Schema, PowerShell, `rtl lib`.

**Spec:** `docs/superpowers/specs/2026-08-29-merc32-soc-generator-design.md`

## Global Constraints

- ILB is fixed at `0x00000000` - `0x07FFFFFF`, DLB at `0x08000000` - `0x0FFFFFFF`, and PLB at `0x10000000` - `0xFFFFFFFF`.
- Generated and new handwritten RTL must compile as Verilog-2005.
- The checked-in `rtl/apb_intc/apb_intc.v` must be the flattened protected artifact; readable INTC source belongs in `D:\Development\Projects\ip-repo`.
- Do not write an INTC programming manual in this project.
- Peripheral RTL is opaque and must not be parsed or rewritten by the generator.
- Generated SoC directories are self-contained and must not depend on the source checkout.
- Existing user `main.c` files are never overwritten, including force regeneration.
- No FPGA vendor project, constraints, synthesis scripts, or generated testbench output.

---

## Plan Order

1. `docs/superpowers/plans/2026-08-29-merc32-hardware-foundation.md`
   Locks the address ABI, stabilizes `MERC32_top`, implements `apb_intc`, moves
   its readable source to the IP repository, and commits only the protected
   distribution artifact here.

2. `docs/superpowers/plans/2026-08-29-tinyc-preprocessor.md`
   Adds quoted includes, object macros, conditionals, include guards, source
   diagnostics, and the new DLB software default.

3. `docs/superpowers/plans/2026-08-29-merc32-soc-generator-core.md`
   Implements configuration parsing, catalog validation, normalized planning,
   RTL/software emission, safe regeneration, packaged resources, and generated
   RTL matrix checks.

4. `docs/superpowers/plans/2026-08-29-merc32-vsce-configurator.md`
   Adds the `*.merc32.json` default graphical editor, activity-bar integration,
   diagnostics, commands, artifact display, and clean VSIX installation smoke
   verification.

## Cross-Plan Gates

- [ ] Hardware plan: all existing RTL/Tiny C simulations pass with the locked
  address ABI and stable Local Bus wrapper.
- [ ] Hardware plan: protected `apb_intc.v` passes its public testbench after
  clear source has been committed in the IP repository.
- [ ] Tiny C plan: file preprocessing tests and existing compiler regressions
  pass; repository firmware runs at the new DLB base.
- [ ] Generator plan: every generated matrix elaborates using only its own
  `rtl/files.f`; ownership tests prove `main.c` and unmanaged files survive.
- [ ] VSCE plan: a packaged VSIX installed in a clean directory generates and
  elaborates a SoC without the MERC32 checkout.

## Final Program Verification

- [ ] Run `git status --short` in both repositories and account for every path.
- [ ] Run `npm test` and `npm run test:c:rtl` from `merc32-vsce`.
- [ ] Run the hardware plan's Icarus regression commands.
- [ ] Run `npm run test:soc` and `npm run test:extension`.
- [ ] Package the VSIX, inspect its contents, install it in a clean extension
  test environment, generate the maximal fixture, and elaborate `rtl/files.f`.
- [ ] Confirm `rg -n "0080_0000|00800000" README.md docs/ABI.md example
  merc32-vsce/src merc32-vsce/package.json rtl/cpu rtl/sim` finds no old DLB
  address in active RTL, compiler defaults, tests, examples, or user
  documentation. Historical specifications and plans are deliberately excluded.
