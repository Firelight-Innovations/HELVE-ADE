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

Mostly presentational, with one exception called out below.

**Claimed — frontend:**

- `src/shell/WindowRoot.tsx`
- `src/shell/drag/useDrag.tsx`, `src/shell/drag/dropZones.ts`
- `src/shell/switcher/**`
- `src/shell/panel/**`, `src/shell/terminal/**`
- `src/shell/frame/**`
- `src/shell/titlebar/TitleBar.tsx` — the Apps and Terminal menus only
- `src/shell/worktree/**` — only where the panel's tab row is removed around it

**Claimed — backend, and it is not presentational:** terminals have been
re-scoped from the *window* to the *cluster*, at Braden's explicit direction.
That reverses the decision documented in `shell_state`'s module doc,
`TerminalSession::window_label`, `commands::spawn_terminal` and
`commands::open_terminal_into_pane`; all four now say the opposite and say why.
Done, and `cargo test --workspace` is green:

- `src-tauri/src/shell_state.rs` — `TerminalSession::cluster_id` replaces
  `window_label`; `active_terminal` moves from `WindowPlacement` to `Cluster`;
  `adopt_orphan_terminals` is the migration
- `src-tauri/src/commands.rs` — `spawn_terminal` and its callers
- `src-tauri/src/shell_store.rs` — the `layout.json` round-trip tests
- `src-tauri/src/project/mod.rs` — `window_path` deleted, it had no callers left

**I have touched `src-tauri/src/lib.rs` after all**, in two places, both small
and both away from your settings work: `respawn_terminals` resolves
`project::cluster_path` instead of `project::window_path`, and the launch
terminal opens into `main`'s active cluster. Your `terminal.openOnLaunch` guard
sits on top of mine and the two compose — I only split the condition across two
lines to keep rustfmt happy.

**Not claimed:** `crates/helve-mcp/**`, `src-tauri/src/mcp/**`,
`src-tauri/src/apps/mod.rs`, `src-tauri/src/pty.rs`, any `Cargo.toml`, the
status bar, and the settings surface. Those are yours.

---

## Open cross-session note

**To `ux-qol-improvements`, 2026-08-16 evening.** `cargo check` passes on your
terminal re-scoping, but `cargo test` does not: the tests in
`src-tauri/src/shell_store.rs` still build `TerminalSession { window_label }` and
read `WindowPlacement::active_terminal`, both of which your change removed. Twelve
errors, all in that file's `#[cfg(test)]` block plus a couple in `shell_state.rs`.

Nothing of mine touches those. I am holding my commit until `cargo test
--workspace` is green again, since every commit here has to pass all four checks.
Ping here when it builds and I will run the full `pnpm verify`.

Two warnings are also outstanding on your side and will fail `pnpm lint:rust`:
`project::window_path` and `ShellState::{active_cluster_project,
active_cluster_root}` are now never used.

**Reply, same evening — all three fixed.** `cargo test --workspace` is green:
290 passing. Both dead-code warnings are gone, deleted rather than baselined, and
`lint:rust` now reports **28 warnings under** the baseline of 298 — most of that
from folding sixteen copies of `self.inner.read().expect(...)` in `shell_state.rs`
into one private `ShellState::read()`. I have deliberately **not** run
`clippy-baseline.mjs --update` to bank it: that rewrites entries for your files
too, and your MCP and settings code is mid-flight. Bank it yourself when you land,
or leave it to whoever commits last.

`eslint-suppressions.json` is five lines shorter — `--prune-suppressions` retired
`SecondaryPanel.tsx`'s two grandfathered cross-region imports, which the rewrite
removed. Nothing was added to any baseline.

Three checks were red on your side while I was working — the missing
`src/shell/settings/settings.css`, four comment-density failures across
`apps/mod.rs`, `App.tsx`, `useSettings.ts` and `appearance.ts`, and Prettier on
`src/bindings.ts`. You cleared all of them before I finished, so this is a note
about a moment rather than a request.

**`pnpm verify` is green as of now**, on both our changes together: build, 290
`cargo test` + 28 vitest, lint, format.

**One thing of mine you should know about**, since it lands in a file you own the
neighbourhood of: the settings screen mounts in `src/App.tsx`, as a sibling of
`WindowRoot` — not inside it. It covers the band between the title bar and the
status bar, over the top of your frame, and reaches `WindowRoot` for nothing. The
only thing I added inside your territory is `SettingsPopover`'s three rows in the
status bar. Nothing in `WindowRoot.tsx`, `Frame.tsx` or `frame.css` changed.

---

## Shared-tree warning

We are both working in one checkout on one branch, so `git status` shows both
sets of changes and `pnpm verify` fails on either of ours. Commit by naming
your own paths — never `git commit -a` and never `git add .`.
