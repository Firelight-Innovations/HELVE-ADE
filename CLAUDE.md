# HELVE orchestrator — working agreements

## Dev servers: 1420 is the human's, agents use their own

Port **1420 is reserved for `pnpm app`** (`tauri dev`), which Braden runs to verify work. Tauri
starts Vite itself and points the webview at a fixed URL, so that port cannot move and cannot be
shared — anything else holding it fails the whole run rather than degrading.

**If you are an agent and need a browser to verify something, run `pnpm dev:agent`.** It serves the
same app from port 1430, and `strictPort` is off for that mode, so a second and third agent step up
to 1431 and 1432 instead of colliding. Read the port Vite prints; don't assume 1430.

Append `?fake=1` to run the shell with no Tauri backend — see `src/shell/state/fakeBackend.ts`.

**Never run `pnpm app`, `pnpm dev`, or `tauri dev`** unless you are Braden. Two failure modes, both
seen repeatedly:

- `pnpm dev` takes 1420 and the next `pnpm app` dies with `EADDRINUSE`.
- `tauri dev` exits without reaping its Vite child, orphaning a `node` process that holds 1420
  until it is killed by pid. Stopping the task is not enough — it kills the wrapper, not the child.

Do not kill a process on 1420 to make room for yourself. It is either Braden's running app or
another agent's; ask instead.

## Verification

`pnpm build` (which runs `tsc` first) and `cargo check --manifest-path src-tauri/Cargo.toml` are the
two checks every change must pass. Chrome measurements go through the `mcp__claude-in-chrome__*`
tools against `pnpm dev:agent`.

A minimized or occluded Chrome window reports `document.visibilityState === "hidden"`, and in that
state `requestAnimationFrame` never fires and `getBoundingClientRect()` silently returns **stale**
layout. Check `visibilityState` first and take a screenshot before measuring — it forces a layout
pass. Never report a measurement taken in a hidden window as passing.

## Editing source

Use the `Edit` tool. Do **not** rewrite files with PowerShell
(`Get-Content | -replace | Set-Content`) — Windows PowerShell 5.1 reads as ANSI, so every em-dash in
this codebase's comments is silently corrupted and written back as valid UTF-8 mojibake. `cargo
check` and `tsc` both pass on the corruption; only reading the file catches it.
