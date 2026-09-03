# NOR Flash Bootloader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load, verify, and execute a relocated MERC32 application from SPI NOR flash.

**Architecture:** Identify local-bus responses by request origin so ordinary CPU stores can target writable ILB. Add an assembler code origin and a minimal Tiny C indirect-jump intrinsic, package raw binaries in a deterministic CRC32 image, and provide a polling QSPI bootloader that copies the payload into ILB before jumping.

**Tech Stack:** Verilog-2005, TypeScript, Node.js, MERC32 Tiny C, APB4 QSPI

**Spec:** `docs/superpowers/specs/2026-09-03-nor-flash-bootloader-design.md`

## Global Constraints

- Preserve the fixed ILB/DLB/PLB address map and all `MERC32_top` ports.
- Preserve existing assembler and Tiny C output when `codeBase` is zero or omitted.
- Use big-endian 32-bit image fields and payload bytes.
- Use Verilog-2005 only and retain one-cycle registered local-bus requests.
- Do not change package versions or package a VSIX in this feature branch.

---

### Task 1: CPU Data Access To ILB

**Files:**
- Modify: `rtl/cpu/core.v`
- Modify: `rtl/sim/merc32_core_tb.v`
- Modify: `merc32-vsce/scripts/test-hardware.js`

**Interfaces:**
- Consumes: existing ILB local-bus request and acknowledgement ports
- Produces: ordinary `lw/lh/lhu/lb/lbu/sw/sh/sb` transactions targeting ILB

- [x] Add an RTL test program that stores an encoded instruction to ILB, reads it back, jumps to it, and checks the executed result.
- [x] Run `npm run test:hardware` and verify the new check fails because CPU data transactions to ILB never assert `ilb_wren` or complete.
- [x] Add fetch/data/debug request-origin state, permit CPU data requests to target ILB, route acknowledgement by origin, and capture instructions only for fetch responses.
- [x] Run `npm run test:hardware` and verify all hardware tests pass with the updated core check count.
- [x] Commit the RTL and test changes.

### Task 2: Relocatable Assembly And Dynamic Jump

**Files:**
- Modify: `merc32-vsce/src/preprocessor.ts`
- Modify: `merc32-vsce/src/assembler.ts`
- Modify: `merc32-vsce/src/cCompiler/tinyc.ts`
- Modify: `merc32-vsce/src/configuration.ts`
- Modify: `merc32-vsce/src/compilerService.ts`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/scripts/test-pseudo-instructions.js`
- Modify: `merc32-vsce/scripts/test-c-compiler.js`
- Modify: `docs/ISA.md`
- Modify: `docs/ABI.md`

**Interfaces:**
- Produces: `PreprocessResult.origin`, `CompileOptions.codeBase`, `.org <u32>`, and `void __jump(unsigned int address)`

- [x] Add assembler tests showing `.org 0x1000` relocates `.entry` and labels without output padding and rejects duplicate, unaligned, negative, and greater-than-u32 origins.
- [x] Run `npm run test:pseudo` and verify failure because `.org` is unsupported.
- [x] Parse and propagate one origin, then initialize all assembler byte/debug PCs from it while leaving machine-code array indices at zero.
- [x] Run `npm run test:pseudo` and verify all pseudo-instruction tests pass.
- [x] Add Tiny C tests for `codeBase` and `__jump`, including invalid code bases, arity, pointer/integer requirements, and value-context rejection.
- [x] Run `npm run test:c` and verify the tests fail because these APIs do not exist.
- [x] Emit `.org` for nonzero `codeBase`; implement `__jump` as an integer-only, non-returning intrinsic that evaluates once and emits `jmp r7`.
- [x] Expose `merc32-asm.c.codeBase` through extension settings and compiler service, and document both additions.
- [x] Run `npm test` and verify toolchain tests pass.
- [x] Commit the toolchain and documentation changes.

### Task 3: Flash Image Packer

**Files:**
- Create: `merc32-vsce/src/flashImage.ts`
- Create: `merc32-vsce/scripts/test-flash-image.js`
- Modify: `merc32-vsce/package.json`
- Modify: `merc32-vsce/README.md`

**Interfaces:**
- Produces: `createFlashImage(payload: Buffer, options: { loadAddress: number; entryAddress?: number }): Buffer`
- Produces: `npm run flash:image -- <input.bin> <output.img> <load-address> [entry-address]`

- [x] Add exact-byte and rejection tests for the 20-byte header, IEEE CRC32, payload preservation, load/entry alignment, empty/non-word payload, and address overflow.
- [x] Run the flash-image test and verify it fails because `out/flashImage` is absent.
- [x] Implement CRC32, validation, deterministic image generation, and a direct-execution CLI without external dependencies.
- [x] Run the flash-image test and verify all image tests pass.
- [x] Add the npm command and document usage and header layout.
- [x] Commit the image packer changes.

### Task 4: Reference QSPI NOR Bootloader

**Files:**
- Create: `example/nor_flash_bootloader.c`
- Create: `merc32-vsce/scripts/test-nor-flash-bootloader.js`
- Modify: `merc32-vsce/package.json`
- Modify: `README.md`

**Interfaces:**
- Consumes: `apb_qspi` register interface, writable ILB, `.org`, `__jump`, and the flash image header
- Produces: buildable bootloader source resident at ILB address zero

- [ ] Add a build test that compiles and assembles the reference bootloader and asserts its origin, entry, QSPI read command, status writes, CRC polynomial, and final indirect jump.
- [ ] Run the bootloader test and verify it fails because the reference source is absent.
- [ ] Implement bounded QSPI polling, header validation, chunked payload reads, big-endian word assembly, ILB stores, CRC32 verification, success/failure status, and final `__jump`.
- [ ] Run the bootloader test and verify it passes.
- [ ] Document bootloader constants, flash programming workflow, and application `codeBase=0x1000` requirement.
- [ ] Commit the bootloader and documentation changes.

### Task 5: Integration Verification

**Files:**
- Modify only if verification exposes a defect in a previously changed file.

**Interfaces:**
- Consumes: all prior task outputs
- Produces: fresh end-to-end verification evidence

- [ ] Run `npm test`.
- [ ] Run `npm run test:hardware`.
- [ ] Run `npm run test:flash-image` and `npm run test:bootloader`.
- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Record that VKS tools were unavailable and whether the fallback simulator exposed any new VKS-related issue.
- [ ] Request a focused code review, resolve all critical and important findings, and rerun the affected suites.
