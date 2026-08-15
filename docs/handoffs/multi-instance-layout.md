# Handoff: instances, panes, clusters, and a session that comes back

> **Status: built.** This landed on `feat/multi-instance-layout` in two commits.
> The document is kept as the design record and the map of what to read; the
> sections below are still accurate about *why* things are shaped as they are.
> Three things are deliberately not done, and they are listed under **What is
> not built** at the bottom.

Today HELVE can show exactly one of each app. There is one Files, one Home, and
the switcher bar is a row of *the* tools with one of them visible. This is the
work that replaces that with a VSCode-shaped model: many instances of any app,
arranged in a recursive split tree, grouped into clusters, spread across as many
OS windows as there are monitors — and all of it still there after a restart.

The good news, and the thing to build on: **this codebase already solved the
hard half once, for terminals.** A `TerminalSession` has its own id, its own
title, a `window_label` saying which window holds it, and a `group_id` letting
several render as one tab. It can be dragged from any window's panel into any
other's, and it outlives whichever window is showing it. That is exactly the
shape every app surface now needs. Most of this work is generalizing a pattern
that is already here and already correct, not inventing one.

## What changes, in one paragraph

`tool_id` stops being an identity and becomes a *type*. The identity becomes an
instance id — `files-1`, `files-2`, `term-1` — minted the same way
`claim_terminal_id` already mints terminal ids. `WindowPlacement.tool_ids:
Vec<String>` is replaced by a list of clusters, each owning a recursive pane
tree of those instance ids. The terminal panel stays exactly where it is and
keeps doing exactly what it does; terminals gain the ability to *leave* it for
the pane tree. And the whole of `ShellSnapshot` starts being written to disk on
every mutation, so it can be read back at launch.

## The five decisions this is built on

Braden's, stated so nobody re-litigates them mid-implementation:

1. **Recursive split tree**, VSCode-style. Panes split horizontally and
   vertically, each leaf holds a tab strip, dropping a tab on a pane edge splits
   there.
2. **The terminal panel remains a region.** It is not absorbed into the tree.
   New terminals always spawn there, in whichever window asked for one — a
   non-primary window that has never had a terminal grows a panel the moment one
   is created in it. The panel also keeps hosting the git/worktree view, which
   is a large part of why it stays.
3. **The switcher bar switches clusters.** A cluster is a set of apps, a set of
   terminals, and — later — a git worktree. It is "one feature being worked on".
   Switching cluster tabs swaps the entire pane tree and the entire panel
   contents beneath it.
4. **Any instance can be dragged out to its own OS window**, on any monitor.
5. **The layout persists across restarts**, windows and geometry included.

Three assumptions filling gaps, cheap to reverse:

- Terminals belong to a **cluster**, not to a window. A cluster owns a worktree,
  so its terminals are the ones running against that worktree.
- First launch creates **one cluster**, named after the open project.
- Detaching an instance creates a window holding **one implicit cluster** with
  just that instance in it.

The worktree field on a cluster is a **stub in this work** — the type, the
serialization, and a `None`. Braden is building the git half separately. Do not
wire behavior to it; do not leave it out either, because adding a field to a
persisted struct later means a migration and adding it now costs one line.

## The constraint that will bite you first

Read `src/shell/terminal/TerminalDeck.tsx:38-45` before you design the pane
tree. It already hit the problem you are about to hit, and its comment says why:

> wrapping split members in a shared flex parent would mean moving a mounted
> `XTermView` to a new position in the tree the moment a split happens —
> indistinguishable, to React, from unmounting it.

So `TerminalDeck` does not nest. Every session is a permanent flat sibling
`.terminal__slot`, and the split geometry is expressed entirely through two CSS
custom properties, `--pane-index` and `--pane-count`:

```css
.terminal__slot--split[data-active] {
  left:  calc(var(--pane-index) * (100% / var(--pane-count)));
  width: calc(100% / var(--pane-count));
}
```

A recursive pane tree rendered as recursive JSX would remount every iframe and
every terminal on every split, resize, or tab move. An iframe that remounts
reloads the app inside it — the Files app would lose its open file and scroll
position every time you dragged anything. **The tree must be a data structure,
not a component hierarchy.**

Two ways out, and this work should take the second:

- **Flat render + computed geometry**, extending what `TerminalDeck` does: walk
  the tree once to compute an absolute rect per leaf, render every instance as a
  flat sibling positioned by that rect. Keeps the existing technique, but the CSS
  custom-property trick only expresses one level of equal-width division and will
  not survive nesting or resizable dividers.
- **A stable portal host per instance.** Mount every live instance once, into a
  container that never moves in the React tree, and `createPortal` it into
  whichever pane element currently owns it. The pane tree can then be as
  recursive as it likes, because re-parenting a portal target does not remount
  the portal's children. This is what handles nesting, dividers, and dragging a
  tab between panes without a reload.

Whichever you pick, the acceptance test is the same: **open a file in Files,
split the pane, drag the tab to the other half, and switch clusters twice. The
file must still be open, at the same scroll position, and the iframe must not
have reloaded.** Verify by putting a `console.count` at the app's entry point,
not by eyeballing it.

## The seams, exhaustively

Every place `tool_id` is currently assumed to identify exactly one live thing.
This list is the actual work; it was compiled by reading the files, not grepping.

### Rust

| Where | What assumes single-instance |
|---|---|
| `shell_state.rs:57` | `WindowPlacement.tool_ids: Vec<String>` — a flat list, so a tool appears in a window at most once |
| `shell_state.rs:59` | `active_tool_id: Option<String>` — one active surface per window |
| `shell_state.rs:165-181` | `set_docked`'s active-preservation logic — must be re-expressed on a tree |
| `shell_state.rs:197-221` | `detach_tool`'s neighbour-focus logic — same |
| `windows.rs:20-22` | `label_for` → `format!("tool-{tool_id}")` — one window per tool, by construction |
| `windows.rs:32-38` | `detach` focuses the existing window instead of making a second |
| `windows.rs:80` | `at_cursor` filters on `label == "main" \|\| starts_with("tool-")` |
| `windows.rs:44-57` | The only `WebviewWindowBuilder`; geometry hardcoded, never saved |
| `boot.rs:392-399` | `finish` shows `"main"` and only `"main"` |
| `project/mod.rs:343-353` | `retitle` hardcodes `"main"` |
| `apps/mod.rs:144` | `apps::call(id, …)` keys on app id — fine, see below |

### Frontend

| Where | What assumes single-instance |
|---|---|
| `state/shellState.ts:19-24` | `WindowPlacement` mirror — same flat list |
| `WindowRoot.tsx:173-196` | `tools` memo maps `placement.toolIds` through a `Map` keyed by tool id; `shownToolId` is one nullable string |
| `ToolWindow.tsx:144-155` | `send(toolId, …)` scans frames for `frame.id === toolId` and **takes the first match** — silently wrong the instant two instances exist |
| `ToolWindow.tsx:324-333` | `key={tool.id}`, `active={tool.id === activeToolId}`, `ready={readyIds.has(tool.id)}` |
| `ToolMount.tsx:38, 49` | `useToolFrontend(tool.id)` and `registerFrame(tool.id, …)` |
| `WindowRoot.tsx:392-412` | `appCommands: Record<toolId, string[]>` |
| `WindowRoot.tsx:507, 671` | `useGitStatus(gitControl, shownToolId)` and `SourceControlView toolId={shownToolId}` — git follows the active *tool*; it should follow the active *cluster* |
| `WindowRoot.tsx:520-523` | ⌘1–9 indexes `tools[index]` |
| `contract.ts:471-473` | `DragPayload` has two kinds, neither of them an instance |
| `switcher.css:25-37` | `.switcher__tab` has no max-width and `.switcher__tabs` no `overflow-x` — cluster tabs will overflow the bar |

### The one place instancing is already free

`apps::call(app, id, method, params)` takes the **app** id and dispatches into
`REGISTRY`. Nothing in `apps/` holds per-instance state: `files.rs` takes an
absolute path on every method that names a file, and its own header says so. So
**two Files instances need no Rust change at all**, provided the frontend keys
its own state per instance and keeps passing paths.

The single exception is `files::default_root` (`apps/files.rs:1268`), which
falls back to the one global open project. That is correct today and stays
correct — a new Files instance opening at the project root is the right default.
It only becomes a problem when a cluster has its own worktree, which is Braden's
next piece of work, not this one.

## Landmines

Four things that fail silently rather than loudly. Each cost a real debugging
session to find by reading; none of them would have announced itself.

**Quit collapses the layout before it can be saved.** `lib.rs:69-74` is the only
window event handler, and on `Destroyed` it calls `windows::reclaim`, which
folds a closing window's tools and terminals back into `main`. On application
quit, `Destroyed` fires for *every* window — so by the time the process ends,
the state has already collapsed to one window holding everything. A save-on-exit
hook would faithfully persist that, every time, and it would look like the tree
serialization was broken when it was not.

The fix is the one `project::store` already models: **save on every mutation,
inside the write lock, never on exit.** `project/mod.rs:185-199` calls
`store::save` inside the guard and emits outside it. Match that shape exactly —
hook `ShellState::mutate` (`shell_state.rs:154-161`), which every mutator
already funnels through, so no change can land unsaved. Note `set_terminal_title`
deliberately bypasses `mutate` to suppress no-op broadcasts (`shell_state.rs:331-349`);
it still needs to persist, so give it the same save call by hand or route the
suppression differently.

**A new window label gets zero permissions, and says nothing.** Tauri 2 scopes
capabilities per window label. `capabilities/default.json` globs `["main",
"tool-*"]`, and `core:default` is what carries `event:allow-listen`. A window
labelled `win-2` will mount, render, and then receive no `shell:state`, no
`project:changed`, no `pty:data:*` — a blank window with no error in any console.
Add the glob in the same commit that changes the label scheme.

**`window_at_cursor` answers with a label and nothing else.** `windows.rs:74-94`
hit-tests the cursor against window rects and returns a label. That is enough to
move a terminal into another window's panel, which is all it was built for. It is
**not** enough to drop a tab into a specific *pane* of another window. Dropping
across windows at pane granularity needs either a richer Rust hit-test that
returns window-local coordinates, or the target window reporting its own pane
rects. Decide before building the cross-window drop, not during.

**PTYs do not survive a restart.** `PtySessions` is `Default` at `lib.rs:59` and
dies with the process. Restore brings back terminal *tabs*, not live shells.
Respawn a fresh shell in the restored tab's cwd rather than showing a dead tab —
a tab that looks alive and eats keystrokes is the exact failure
`shell_state.rs:126-131` already warns about for a different reason. Flag it as
reversible; Braden may prefer an explicitly dead tab with a restart affordance.

## The model

Rust owns all of it, for the reason `contract.ts:184-189` already gives about
terminal groups: anything a tab can be dragged across windows with cannot live in
one window's local state, because it would come apart the moment it moved. A
client-side pane tree would be the first shell layout state not in the
`shell:state` broadcast, and it would be wrong for the same reason.

```rust
pub struct SurfaceInstance {
    /// `files-1`, `term-3`. Minted like terminal ids already are.
    pub id: String,
    /// Which app or tool this is an instance *of*. Never an identity.
    pub app_id: String,
    pub kind: SurfaceKind,   // App | Tool | Terminal
    pub title: String,
}

pub enum PaneNode {
    Split { dir: SplitDir, ratio: f32, children: Vec<PaneNode> },
    Leaf  { id: String, tabs: Vec<String>, active_tab: Option<String> },
}

pub struct Cluster {
    pub id: String,
    pub name: String,
    pub tree: PaneNode,
    /// Terminals live in the panel, and the panel belongs to the cluster.
    pub terminal_ids: Vec<String>,
    pub active_terminal: Option<String>,
    /// STUB. Type and serde only — Braden's git work fills this in.
    pub worktree: Option<WorktreeRef>,
}

pub struct WindowPlacement {
    pub label: String,
    pub clusters: Vec<Cluster>,
    pub active_cluster_id: Option<String>,
    pub geometry: Option<WindowGeometry>,
}
```

`ShellSnapshot` keeps `windows`, `engine`, and a flat `instances: Vec<SurfaceInstance>`
alongside the trees — the trees hold ids only, so an instance's title can change
without rewriting a tree, exactly as `TerminalSession.title` works now.

None of the shell types derive `Deserialize` today (only `EngineState` does).
`project::store` solved this with a parallel `Stored` type rather than deriving
it on the wire types, and that separation is worth keeping: the wire type can
gain a field the on-disk type ignores, and vice versa.

Keep the pure-function-plus-`mutate`-wrapper split that `shell_state.rs` already
uses. `close_terminal_pure` and `group_with_pure` are unit-tested against a bare
`Vec` with no Tauri in sight (`shell_state.rs:439-544`), and the pane tree needs
that far more than they did — insert, remove, split, and the collapse rule
(a split with one remaining child becomes that child) are exactly the operations
that get subtly wrong and are trivial to test.

## Prior art to reuse, not reinvent

- **Terminal grouping** — `group_with_pure` and `close_terminal_pure`
  (`shell_state.rs:405-437`), including "a group of one stops being a group".
  That teardown rule is the same shape as the pane-tree collapse rule.
- **Divider dragging** — `Frame.tsx:100-185`. It writes a framer `useMotionValue`
  directly rather than routing every frame through React state, and it has real
  hysteresis on the maximize threshold. Pane dividers should use the same
  technique; do not re-derive it.
- **Atomic persistence** — `project/store.rs:23-154` in full. New `FILE`
  constant, new `Stored`, same `load`/`save`/`file`. Its four invariants
  (never fatal, atomic temp+rename, forward-compatible via `#[serde(default)]`,
  written to the config dir and never beside a project) all apply unchanged.
- **Per-session event topics** — `pty::data_event(id)` (`pty.rs:44-46`). If
  anything new needs per-instance events, this is the established pattern and
  the reasoning for it is in that file.
- **The menu bar** — `defaultMenus()` in `TitleBar.tsx:201` and its
  `CommandHandlers` / `blocked()` convention. The Apps menu is a new `Menu` in
  that factory and needs no new machinery. Note `MenuItem` has **no submenu**
  and the file forbids faking one twice over, so Apps is a flat list of app
  names.

## Work, in order

Each stage should leave `tsc` and `cargo check` green. Stages 1–3 are Rust and
can land before any frontend work; the frontend is unusable between 4 and 8, so
those should be one branch.

1. **Model.** `SurfaceInstance`, `PaneNode`, `Cluster`, new `WindowPlacement`.
   Pure functions for tree insert/remove/split/collapse, with tests. No commands
   wired yet.
2. **Persistence.** `shell_store.rs` modelled on `project/store.rs`. Hook
   `mutate`. Add `Moved`/`Resized` to `on_window_event` for geometry. Fix the
   quit-collapse in `reclaim`.
3. **Commands and labels.** `win-<n>` labels, capability glob, `open_instance`,
   `close_instance`, `move_instance`, `split_pane`, `detach_instance`. Restore
   windows at launch, clamped to the visible desktop — a window whose saved
   monitor is gone must be re-centred, not restored off-screen. `boot::finish`
   iterates windows instead of showing `"main"`.
4. **Contract and state.** Mirror the types in `contract.ts` and
   `state/shellState.ts`. Make `fakeBackend.ts` produce a *real* mutating tree —
   see below, this is not optional.
5. **Pane tree.** The portal-host renderer and its dividers.
6. **Bridge re-keying.** `ToolWindow`'s frames map, `readyIds`, and `send()` move
   to instance ids. The security property must survive: identity is resolved from
   `event.source` against the map of mounted iframes, **never** from the message
   body. `callApp` and the `helve/painted` report still name the app id.
7. **Drag.** A real drop-target registry, replacing the hardcoded
   `.switcher__tab` queries in `useDrag.tsx:172`. Tab → tab strip, tab → pane
   edge, tab → other window, tab → desktop.
8. **Clusters and the Apps menu.** Switcher bar switches clusters; add create,
   rename, close, and tab overflow. Apps menu spawns instances. Panel appears
   when the active cluster first has a terminal or the git view is opened.

## Verification

`pnpm build` (which runs `tsc`) and `cargo check --manifest-path
src-tauri/Cargo.toml` are the two gates, plus `cargo test` for the new tree
functions. All three green before reporting anything.

**The fake backend is the only interactive verification available here.** Chrome
has not been able to reach the dev server in this environment, so runtime checks
go to Braden. That makes `?fake=1` load-bearing rather than a nicety, and
`fakeBackend.ts` carries its own warning about this at lines 1901-1917: a
hardcoded `toolIds` that disagreed with `ShellState::default` hid a real
empty-switcher-bar bug for the whole life of the fixture. Today `fakeSnapshot()`
returns a hardcoded single window and **no fake mutations exist** for
`setDockedTools`, `setActiveTool`, or `detachTool` — terminals are the only
reactive part. If the fake does not grow real mutating split/move/close/cluster
operations that call `publishFakeShellState()`, every layout interaction in this
work becomes unverifiable by anyone.

Manual test plan for Braden, on `pnpm app`:

1. Open two Files instances from the Apps menu. Open a different file in each.
2. Split a pane vertically, then horizontally. Drag the divider.
3. Drag a tab onto the opposite pane's edge; confirm it splits there and the
   file is still open at the same scroll position.
4. Create a second cluster. Confirm it opens on Home, that switching swaps both
   the tree and the panel, and that the first cluster's chip collapses to a
   count matching what it was holding.
5. Drag an instance out to a new window. Move it to the second monitor.
6. Create a terminal in the new window; confirm its panel appears.
7. Drag a terminal from the panel into the pane tree, and back.
8. Close HELVE. Reopen. Both windows, both monitors, both clusters, same trees.
9. Unplug the second monitor and reopen. The window must appear on the remaining
   display, not off-screen.
10. Reorder two tabs inside the bar, then release a tab over the bar's empty
    right-hand end. It must land in the row, not open a new window.

## What is not built

Three gaps, all deliberate, all flagged rather than hidden.

**Cross-window drops land in a new window, not in the target window's pane.**
`window_at_cursor` returns a label and nothing else — it hit-tests window
rectangles, so it cannot say *where inside* another window the cursor was.
Dropping a tab over another HELVE window therefore detaches it into its own
window rather than guessing a pane. Making this work properly needs a richer
Rust hit-test that returns window-local coordinates, or the target window
reporting its own pane rects. The reasoning is repeated at the call site in
`drag/useDrag.tsx`.

**The git view follows the active surface's app, not the cluster's worktree.**
`Cluster.worktree` exists, serializes, and restores — it is the stub this work
promised — but nothing reads it, so `useGitStatus` is still keyed on an app id
as it was before. Pointing a live git view at an unpopulated field would report
"no repository" for every cluster, which is worse than leaving it as it was.
This is the seam Braden's git work plugs into.

**A restored terminal gets a fresh shell in the project root, not its old cwd.**
`shell_store` remembers the tab; `PtySessions` dies with the process, so there is
nothing to reattach to. The cwd a session had is not recorded, so respawning uses
the project root. Recording it is a small addition to `TerminalSession` whenever
it is wanted.

## Verification actually run

- `pnpm build` (which runs `tsc`) — clean.
- `cargo check --manifest-path src-tauri/Cargo.toml` — clean, no warnings.
- `cargo test` — **113 passing**, up from 76. The new ones cover the pane tree
  (insert, remove, split, the collapse and flatten rules, the size-weight
  invariant), the id counters a restore rebuilds, and the layout file's round
  trip and forward compatibility.
- `packages/bridge` — 20 passing.

One thing worth knowing about that list: `cargo check` does **not** build tests,
and it passed on a change that broke three of them. `cargo test` is the gate that
matters, not `cargo check`.

**Not run: the app.** Chrome cannot reach the dev server in this environment and
`pnpm app` is Braden's alone, so nothing here has been seen running. Every claim
above is about compilation and unit tests. The manual test plan is the real
check, and it has not been performed.

## Revision: one tab bar

Built as first written, this shell drew tabs in three places at once — the
cluster bar, a strip per pane, and the terminal panel's row — and the same
handful of surfaces appeared in two or three of them. Braden's correction was to
collapse all of it into one row, modelled on Chrome's tab groups.

**What the bar is now.** A chip per cluster. The open cluster's chip is followed
inline by everything in it: the layout's surfaces in layout order, then the
panel's terminals. Clicking another chip expands that cluster and collapses this
one. A collapsed chip carries a count instead of its contents.

**What went away.** `PaneTree` no longer draws a strip — a pane is a host with a
focus outline, and `pane__host` is now the pane's whole area rather than
everything below a header. `SecondaryPanel` no longer draws session tabs; what
is left in that row operates the region (`+`, the worktree segment, the collapse
chevron), none of which names a session. `ClusterMember` in `contract.ts` is the
one shape the bar draws, flattened from those two sources and derived fresh on
every render — no membership is stored anywhere it could drift from the tree or
from `terminals`.

**The two things worth knowing before changing it.**

*There is no sliding accent rule on the members, only on the chip.* A split shows
two surfaces at once and the panel can show a third, so "the active tab" is not a
single thing the row could point at. `showing` — a lifted background — is a claim
that stays true however many panes there are; a rule would have to pick one of
several equally-current tabs and be wrong about the rest.

*The whole row is one strip drop zone, registered on `.switcher__tabs`.* Two
reasons, both load-bearing. A zone that stopped at the last tab would leave the
space beside it resolving to `detach`, so releasing an inch wide of the row would
silently open a new OS window — the most destructive outcome in the gesture,
reached by the smallest miss. And one element that always exists beats one per
group: `useDropZone` holds a single element, so a zone that migrated as the open
cluster changed would depend on React detaching the old ref before attaching the
new. It does, but the day someone assumes otherwise, every drop lands nowhere.
The rects it measures are still only the focused pane's own tabs, because the row
lists several panes at once and the terminals are not in the tree at all.

**A new cluster opens Home** (`commands::add_cluster`), as does File > New
Window, for the reason `seed_first_run` already opened it on a first launch: a
cluster is where a piece of work starts, and Home is the surface that starts one.
Composed in the command layer rather than folded into `ShellState::add_cluster`,
which stays a primitive that does what its name says.

**Still not built, and now more visible than before:** dropping a tab onto
*another* cluster's chip does nothing. It is the obvious Chrome gesture and
`move_instance` already takes a cluster id, so the frontend half is small — but a
terminal moved that way would be in cluster B's tree while `TerminalSession
.cluster_id` still said A, and `sessions` filters on that field, so it would draw
in both places. Moving a terminal across clusters has to update that field in the
same mutation before this can be wired up.

## Constraints

From `CLAUDE.md`, binding:

- **Never run `pnpm app`, `pnpm dev`, or `tauri dev`.** Port 1420 is Braden's,
  and `tauri dev` orphans a Vite child that holds it until killed by pid. Use
  `pnpm dev:agent` (1430+), reading the port Vite actually prints.
- **Edit tool only.** Never rewrite a source file through PowerShell
  `Get-Content | -replace | Set-Content` — PS 5.1 reads as ANSI and silently
  turns every em-dash in this codebase into mojibake that both `cargo check` and
  `tsc` accept.
- Match the surrounding voice. This codebase writes prose comments explaining
  *why*, and the why is usually a failure someone already hit.
