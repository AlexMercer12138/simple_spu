# MERC32 Aro Changes

The pinned upstream snapshot remains byte-for-byte auditable through `UPSTREAM-MANIFEST.json`. MERC32-owned additions and modifications are recorded with exact upstream and current SHA-256 values in `MERC32-CHANGES.json`.

| Path | Reason |
|---|---|
| `src/aro.zig` | Export the explicit public MERC32 data-model value. |
| `src/aro/Compilation.zig` | Add the nullable data-model query boundary, guarded freestanding initialization, MERC32 macro profile, isolated target predicates, target-independent alias selection, bounded source-provider include boundary with typed failures and include-site propagation, and freestanding I/O guards. |
| `src/aro/DataModel.zig` | Define the explicit MERC32 ILP32 sizes, alignments, function alignment, and signed-char model. |
| `src/aro/Parser.zig` | Route integer-literal and int128 capability behavior through the selected compilation model. |
| `src/aro/Preprocessor.zig` | Route builtin and feature checks through model-aware compilation capability queries, enforce configurable include depth and canonical cycle checks, and compile out verbose stderr logging for freestanding builds. |
| `src/aro/Preprocessor/Parser.zig` | Validate preprocessor intmax width through the selected compilation model. |
| `src/aro/TypeStore.zig` | Use compilation data-model queries for C type sizes, alignments, aliases, pointers, and functions. |
| `src/aro/record_layout.zig` | Apply the selected model's maximum natural alignment without inheriting host record-layout identity. |
