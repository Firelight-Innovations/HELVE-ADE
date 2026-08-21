# Third-party notices

Source in this repository that was written elsewhere, and what its own licence
asks of anyone redistributing it.

This file covers **code**, not dependencies. Crates and npm packages carry
their own licences and are checked by `cargo deny check` (`pnpm lint:deps`);
they are not listed here. What is listed here is code that was read, adapted
and committed into this tree, where the licence travels with the copy rather
than with a lockfile entry.

`NOTICE` beside this file is the Apache-2.0 notice for HELVE's own source and
the statement of what the trademarks cover. The two do not overlap.

---

## Orca — `stablyai/orca`

MIT License. Copyright (c) 2026 Lovecast Inc.

Orca is an Electron application that runs coding agents in git worktrees. It
solved several problems this repository is now solving, and where its answer
was the right one it was adapted rather than reinvented. Everything below is a
port: Orca is Electron and Node, HELVE is Tauri and Rust, so no file was copied
whole. Each site carries a header comment naming the Orca file it came from.

| Here | From |
|---|---|
| `src-tauri/src/quoting.rs` | `src/renderer/src/components/terminal-pane/pane-helpers.ts` (`shellEscapePath`) |
| `src/shell/drag/useFileDrag.ts` | `src/renderer/src/components/terminal-pane/terminal-drop-handler.ts` |

A note on the attribution itself, because it does not match what this
repository's own planning notes said to write. Those notes recorded Orca's
copyright as Stably AI; the `LICENSE` file in `stablyai/orca` at commit
`59892a2f` reads **Copyright (c) 2026 Lovecast Inc.** The licence file wins
over the note, so that is what is carried here.

### The licence

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### What is not carried over

Orca's name, marks and user-facing strings. "Orca" appears in this repository
only in attribution — this file, and the header comments the table above points
at. It is not a value, a class name, a MIME type or anything a user can see.
