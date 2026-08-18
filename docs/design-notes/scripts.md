# Build and lint scripts

Design rationale moved out of `scripts/` to keep comment concentration under the caps in
STANDARDS.md §10. The source files point back at this page.

## scripts/clippy-baseline.mjs

The alternative used here is a counted baseline. `clippy-baseline.json` records how many warnings of
each lint each file currently has. This script fails only when a count goes _up_, or when a lint
appears in a file that had none. Existing code is grandfathered; new code is not, and neither is a
new violation added to an old file.

Why not `#![allow(...)]` per file, which is the usual Rust answer:

- It edits source files, and the request that prompted this was explicitly "do not refactor existing
  code yet".
- A file-level allow is permanent and unbounded. It hides the twelve `expect()` calls that exist
  today _and_ the thirteenth added tomorrow. A count catches the thirteenth.
- Shrinking it is self-documenting: `--update` after a cleanup pass leaves a diff showing exactly
  what was paid down.
