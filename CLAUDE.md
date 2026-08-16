# HELVE orchestrator — working agreements

## Dev servers: 1420 is the human's, agents use their own

Port **1420 is reserved for `pnpm app`** (`tauri dev`), which Braden runs to verify work. Tauri
starts Vite itself and points the webview at a fixed URL, so that port cannot move and cannot be
shared — anything else holding it fails the whole run rather than degrading.

**If you are an agent and need a browser to verify something, run `pnpm dev:agent`.** It serves the
same app from port 1430, and `strictPort` is off for that mode, so a second and third agent step up
to 1431 and 1432 instead of colliding. Read the port Vite prints; don't assume 1430.

There is no way to run the shell without a Tauri backend under it. `pnpm dev:agent` serves the same
files, so the shell mounts and its layout can be measured, but every call into Rust fails — no
stack, no apps, no terminals, no project. The `?fake=1` fixture that used to answer those calls has
been removed; anything that needs a real backend goes to Braden.

**Never run `pnpm app`, `pnpm dev`, or `tauri dev`** unless you are Braden. Two failure modes, both
seen repeatedly:

- `pnpm dev` takes 1420 and the next `pnpm app` dies with `EADDRINUSE`.
- `tauri dev` exits without reaping its Vite child, orphaning a `node` process that holds 1420
  until it is killed by pid. Stopping the task is not enough — it kills the wrapper, not the child.

Do not kill a process on 1420 to make room for yourself. It is either Braden's running app or
another agent's; ask instead.

## Verification

**Every commit and every pull request must pass all four checks. No exceptions, and none of them
are advisory.** One command runs the lot:

```sh
pnpm verify     # build -> test -> lint -> format:check
```

| Check | Command | Covers |
|---|---|---|
| Build | `pnpm build` | runs `tsc` first, so this covers types |
| Tests | `pnpm test` | 28 vitest + 212 `cargo test`, all currently passing |
| Lint | `pnpm lint` | ESLint, clippy, comment density |
| Format | `pnpm format:check` | Prettier and rustfmt; `pnpm format` applies |

`pnpm test` is both halves — `pnpm test:js` for the workspace packages, `pnpm test:rust` for
`cargo test --workspace`. Run the whole thing before you claim a change is done. A build that
compiles is not a change that works.

**A failing test is never fixed by deleting or skipping the test.** If a test is genuinely wrong,
say so and explain why in the commit message rather than quietly removing it. Per STANDARDS.md §8,
a bug fix arrives with the test that would have caught it — that is the one test rule described as
non-negotiable.

The three lint baselines (`eslint-suppressions.json`, `clippy-baseline.json`,
`comment-baseline.json`) grandfather violations that predate the linters. They are ratchets: they
may shrink and may not grow. **Never run `pnpm baseline` to make a check pass** — it regenerates
all three and would absorb your new violation, which is the exact thing they exist to prevent. Fix
the code instead.

Chrome measurements go through the `mcp__claude-in-chrome__*` tools against `pnpm dev:agent`.

A minimized or occluded Chrome window reports `document.visibilityState === "hidden"`, and in that
state `requestAnimationFrame` never fires and `getBoundingClientRect()` silently returns **stale**
layout. Check `visibilityState` first and take a screenshot before measuring — it forces a layout
pass. Never report a measurement taken in a hidden window as passing.

## Editing source

Use the `Edit` tool. Do **not** rewrite files with PowerShell
(`Get-Content | -replace | Set-Content`) — Windows PowerShell 5.1 reads as ANSI, so every em-dash in
this codebase's comments is silently corrupted and written back as valid UTF-8 mojibake. `cargo
check` and `tsc` both pass on the corruption; only reading the file catches it.
