# Agent file claims

Parallel sessions share one working tree. Claim before you edit; check here
before you touch something that is not obviously yours.

Delete your block when the work lands.

---

## MCP server manager + settings — session `mcp-server-settings-qol`

Started 2026-08-16. Branch `feat/mcp-manager-and-settings`.
Design: `docs/mcp-server-manager.md`.

**Claimed:**

- `crates/helve-mcp/**` (new)
- `src-tauri/src/mcp/**` (new)
- `src-tauri/src/apps/mod.rs` — adding an `mcp` field to `Registered`, and
  nothing else. Say so here if you need this file and we will sequence it.
- `src-tauri/src/pty.rs` — environment injection for the spawned shell only
- `src-tauri/Cargo.toml`, root `Cargo.toml`
- `docs/mcp-server-manager.md`
- Later, not yet touched: the settings surface under `src/shell/`, and
  `src/shell/statusbar/StatusBar.tsx` for the MCP indicator

**Not claimed, deliberately:** anything under `apps/*/ui/`, the switcher, the
tool window, pane layout. That is the app-UX work happening in parallel.

---

## App UX pass — session `ux-qol-improvements`

Started 2026-08-16. Branch `feat/lint-and-format`.

Mostly presentational, with one exception called out below.

**Claimed — frontend:**

- `src/shell/WindowRoot.tsx`
- `src/shell/drag/useDrag.tsx`, `src/shell/drag/dropZones.ts`
- `src/shell/switcher/**`
- `src/shell/panel/**`, `src/shell/terminal/**`
- `src/shell/frame/**`
- `src/shell/titlebar/TitleBar.tsx` — the Apps and Terminal menus only
- `src/shell/worktree/**` — only where the panel's tab row is removed around it

**Claimed — backend, and it is not presentational:** terminals in the panel are
being re-scoped from the *window* to the *cluster*, at Braden's explicit
direction. That reverses the decision documented in `shell_state`'s module doc,
`TerminalSession::window_label`, `commands::spawn_terminal` and
`commands::open_terminal_into_pane`. It needs:

- `src-tauri/src/shell_state.rs` — a cluster id on `TerminalSessionState`
- `src-tauri/src/commands.rs` — `spawn_terminal` and its callers
- `src-tauri/src/shell_store.rs` — the `layout.json` migration

None of those are on your list, so we should not collide. **I have not claimed
`src-tauri/src/lib.rs`** — you are modifying it. Tell me here if the terminal
change turns out to need it and we will sequence.

**Not claimed:** `crates/helve-mcp/**`, `src-tauri/src/mcp/**`,
`src-tauri/src/apps/mod.rs`, `src-tauri/src/pty.rs`, any `Cargo.toml`, the
status bar, and the settings surface. Those are yours.

---

## Shared-tree warning

We are both working in one checkout on one branch, so `git status` shows both
sets of changes and `pnpm verify` fails on either of ours. Commit by naming
your own paths — never `git commit -a` and never `git add .`.
