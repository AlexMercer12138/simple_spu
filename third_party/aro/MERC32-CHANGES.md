# MERC32 Aro Changes

The pinned upstream snapshot remains byte-for-byte auditable through `UPSTREAM-MANIFEST.json`. MERC32-owned additions and modifications are recorded with exact upstream and current SHA-256 values in `MERC32-CHANGES.json`.

| Path | Reason |
|---|---|
| `src/aro.zig` | Export the explicit public MERC32 data-model value. |
| `src/aro/Compilation.zig` | Add the nullable data-model query boundary, guarded freestanding initialization, and MERC32 macro profile. |
| `src/aro/DataModel.zig` | Define the explicit MERC32 ILP32 sizes, alignments, function alignment, and signed-char model. |
| `src/aro/Parser.zig` | Route integer-literal and int128 capability behavior through the selected compilation model. |
| `src/aro/Preprocessor/Parser.zig` | Validate preprocessor intmax width through the selected compilation model. |
| `src/aro/TypeStore.zig` | Use compilation data-model queries for C type sizes, alignments, aliases, pointers, and functions. |
| `src/aro/record_layout.zig` | Apply the selected model's maximum natural alignment without inheriting host record-layout identity. |
