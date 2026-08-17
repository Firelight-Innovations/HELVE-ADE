# Shell state — design notes

Design rationale moved out of `src/shell/state/*` to keep comment concentration under the
caps in STANDARDS.md §10. Nothing here is a summary; each section is the prose as it stood
in the source, and the source file points back at this page.

## src/shell/state/presets.ts

Fetched once, then subscribed — the same shape `useShellState` uses and for the same
reason: Tauri events have no replay buffer, so a window that only subscribed would sit with
an empty menu until somebody saved something. Subscribe first, then fetch, and discard the
fetch if an event beat it home.

Not an optimisation either. Presets are one global list and every window a projection of
it, so a second window still offering yesterday's menu after a save in the first is the
drift `shell:state` exists to prevent — for one event on a deliberate save and nothing the
rest of the time.

Deliberately not a store: nothing here caches, merges or reconciles. Rust merges the
built-ins with the file and broadcasts the whole answer; this re-renders with it.

### `applyPreset`

Takes no cluster id, and that is the contract rather than an omission: the menu row is
drawn in the bar of the cluster you are looking at, so the backend acts on the window's
active cluster, as `open_instance` does. See `commands::apply_preset`.

## src/shell/state/project.ts

The shell has never needed this before — a project was something the apps knew about,
reached over transport B, and Rust broadcast `project:changed` only so `ToolWindow` could
relay it into the app frames. The title bar names the project now, so the shell has become
a subscriber in its own right and needs its own read of the same two things: the current
value, and every change after it.

**Per cluster, and that is what makes the title bar work at all.** A project belongs to a
cluster, so "which project" is not a question the process can answer — two windows on two
monitors are meant to name two different ones at the same time. The bar asks about
whichever cluster its own window is showing, which is why this takes an id rather than
reading an ambient value.

The initial read goes through the `cluster_project` command (reached through
`clusterProject` in `src/bindings.ts`). It used to go through Home's `home/state`, borrowed
because the shell had no command of its own; that stopped working once the answer became
scoped, since Home's method reports the *calling surface's* cluster and the bar is not a
surface. The comment that used to sit here said a `project/state` command would be the one
line that changes — this is that change.

### `useClusterProject`

`null` for "this cluster has no project", for "this window has no cluster" (`clusterId`
itself `null`), and for "not answered yet" alike — the title bar draws the same thing for
all three, and a further distinction would be one with nowhere to show.

Re-fetched when the cluster changes, because switching chips changes the answer without any
event firing: nothing about the *project* moved. The subscription covers the other half, a
project opening or closing under a cluster that is already on screen.
