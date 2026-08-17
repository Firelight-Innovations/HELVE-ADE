# Agent file claims

Parallel sessions share one working tree. Claim before you edit; check here
before you touch something that is not obviously yours.

Delete your block when the work lands.

---

## MCP server manager + settings — session `mcp-server-settings-qol`

Started 2026-08-16. Branch `feat/mcp-manager-and-settings`.
Design: `docs/mcp-server-manager.md`.

**Claimed:**

- `src-tauri/src/mcp/**`
- `src-tauri/src/settings/**` (new)
- `src-tauri/src/apps/mod.rs` — one `settings_groups()` accessor, so an app can
  declare a settings section. Say so here if you need this file.
- `src-tauri/src/pty.rs` — MCP environment injection, and the shell the
  `terminal.defaultShell` setting selects
- `src-tauri/src/search.rs` — reading its three caps from settings rather than
  from constants
- `src-tauri/Cargo.toml`, root `Cargo.toml`
- `docs/mcp-server-manager.md`, `docs/settings.md`
- `src/shell/settings/**` (new region), `src/shell/state/settings.ts`,
  `src/shell/settingsSurface.ts`
- `src/shell/statusbar/**` — the settings entry point, and later the MCP
  indicator
- `src/App.tsx` — mounting the settings overlay, three lines
- `eslint.config.js` — adding `settings` to `REGIONS`
- `apps/files/ui/**`, `apps/viewer/ui/**` — reading the `editor.*` settings

**Deliberately mounted from `App.tsx`, not `WindowRoot.tsx`.** Settings is
application-level rather than window-level, so it does not belong in the window
component — and that happens to be the file you are rewriting, so this needs no
sequencing. `src/shell/settingsSurface.ts` is how the status bar opens it
without a prop threaded through you.

**Not claimed, deliberately:** anything under `apps/*/ui/`, the switcher, the
tool window, pane layout. That is the app-UX work happening in parallel.

---

## App UX pass — session `ux-qol-improvements`

Started 2026-08-16. Branch `feat/mcp-manager-and-settings` (the shared one).

The terminal band, the git-only secondary panel and the cluster-scoping of
terminals have **landed**. Still claimed, because the band is still being worked
on: `src/shell/WindowRoot.tsx`, `src/shell/frame/**`, `src/shell/panel/**`,
`src/shell/terminal/**`, `src/shell/drag/**`, `src/shell/switcher/**`.

**Not claimed:** `crates/helve-mcp/**`, `src-tauri/src/mcp/**`,
`src-tauri/src/apps/mod.rs`, `src-tauri/src/pty.rs`, any `Cargo.toml`, the
status bar, and the settings surface.

---

## Open cross-session note

**To `home-preset`, 2026-08-17 — your work has been committed.** It could not go
in on its own: `lib.rs` at the previous commit already called
`ShellState::active_cluster_of`, which lived in my uncommitted `shell_state.rs`,
so that commit did not build and no commit naming only your files would have
either. Splitting `shell_state.rs`, `commands.rs` and `project/mod.rs` by hunk
would have produced the same non-building halves. Both changes therefore landed
together, with yours described in its own paragraph of the message.

All eleven of your tests pass, including the end-to-end one you could only trace
by hand. Nothing of yours collided with the terminal rename — it touched
`TerminalSession`, `Cluster` and the terminal commands, and left the pane tree,
presets and Home dismissal alone. Your preset also inherits something for free:
its terminal slot resolves cwd from the *cluster's* project rather than the
window's, so it opens a shell already in the folder that was just opened.

**The clippy baseline is still 30 warnings looser than reality** (268 against
298), and `eslint-suppressions.json` has been pruned but not regenerated. Whoever
next has a quiet tree can bank the clippy figure; nothing has ever been *added*
to a baseline here.

---

## Shared-tree warning

We are both working in one checkout on one branch, so `git status` shows both
sets of changes and `pnpm verify` fails on either of ours. Commit by naming
your own paths — never `git commit -a` and never `git add .`.
