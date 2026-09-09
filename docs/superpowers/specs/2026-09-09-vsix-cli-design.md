# VSIX-distributed MERC32 CLI

Approved in conversation: distribute the CLI with the existing VSIX, use a separately installed Node.js, and configure PATH once. No npm publication or bundled Node runtime.

The CLI and editor share a VS Code-independent build service. The editor supplies its settings; the CLI supplies explicit arguments with the same defaults. Commands are `build` (C or ASM to ROM), `compile` (C to ASM), and `assemble` (ASM to ROM). Support existing output formats, modes, memory settings, optimization, and C include paths/macros. Diagnostics go to stderr, artifact paths to stdout, and failures return nonzero exit codes. CLI does not read editor settings or unsaved buffers.

Activation creates/refreshes `~/.merc32/bin` launchers and their target manifest and adds that directory to new integrated terminals. A command shows the directory for manual user PATH setup. Subsequent extension activation refreshes the target after upgrades. External terminals then run the packaged compiler without a running editor. Uninstalled/missing targets produce an actionable error. Windows CMD/PowerShell are the primary verified environment; provide a POSIX shell launcher as well.

Keep compiled code, WASM, headers, and runtime resources together in VSIX. Verify real CLI builds, diagnostics, arguments, paths with spaces, launcher upgrades, installed-extension use, and packaged resources. A feature release increments 2.2.0 to 2.3.0; commit metadata before the final provenance build and run the repository VSIX smoke. Do not publish externally.
