# Shell chrome design notes

Design rationale moved out of the source files under `src/shell/titlebar/` and
`src/shell/switcher/` to keep comment concentration under the caps in
STANDARDS.md §10. Nothing here is a summary — each section is the prose as it
stood in the file, moved verbatim, and the source points back at this page.

## src/shell/switcher/ClusterBar.tsx

### Why every tab is here and nowhere else

Panes used to draw their own tab strips and the panel drew one for terminals,
which meant the same handful of surfaces were listed in up to three rows at
once. They are all in this row now, and those two strips are gone rather than
duplicated — a tab in two places is two things that can disagree about which
one is active, and it is twice as much bar for the same information.

What is lost with the pane strips is being able to read a split's contents off
its own header, and what replaces it is `showing`: a member that is on screen
draws lifted. With a split, that is more than one member at once, which is
honest — there really is more than one surface visible.

### Pane groups, which are not the pane strips coming back

A pane holding several surfaces draws as one grouped region here — a raised
tray with thin dividers between its members, so pane membership is something
you read rather than something you have to click to find out. It is worth
being explicit that this does **not** undo the paragraph above, because it
looks at a glance like it might.

It is also the only thing in the window that says two surfaces share a pane,
which is why the first attempt at it being too faint to see was not a
cosmetic miss: with nothing marking the pane, clicking from one of its
members to the other reads as one app replacing another rather than as a
pane showing its other tab. `switcher.css` has what changed and why.

The lesson from the pane strips was not "never show which pane a tab is in".
It was that the same surface must not be *listed twice*, because two listings
are two things that can disagree about which one is active. This is still
exactly one row, and every surface still appears in it exactly once; the row
has gained grouping that mirrors the pane tree, not a second copy of anything.
There is nothing here that can disagree with anything else, because there is
nothing else.

A pane group must also not be mistakable for a *cluster* group, which is the
outer box this one nests in. Both are drawn in the same visual language on
purpose — a region marked by a fill spanning the tabs that belong to it — and
they differ in every variable of it at once: the cluster's fill is darker
than the bar, square, full height, banded in accent along its top, and always
introduced by a named chip; a pane's is lighter, rounded, inset from the bar's
edges, unbanded, and never named. They nest rather than overlap. See
`switcher.css`.

The terminal panel keeps its `+`, its worktree toggle and its collapse
chevron. Those operate the *region*; they are not tabs, and none of them names
a session.

## src/shell/titlebar/useEditTarget.ts

### Paste is disabled on both branches

**Paste is disabled on both branches**, and this is the one item where that
is a decision rather than a consequence:

- `document.execCommand("paste")` has been refused in web content by every
  Chromium-based engine for years — it resolves `false` and does nothing.
  WebView2 is Chromium. So the field branch has no mechanism at all.
- `navigator.clipboard.readText()` is the replacement, and it is gated on the
  `clipboard-read` permission. What a Tauri v2 WebView2 window does with that
  request is not something this work could establish without running the app,
  and browser verification is unavailable in this environment.

The handoff's own instruction for exactly this case is to disable it and say
why rather than ship a Paste that silently does nothing — so it is disabled,
and the hint names Ctrl+V, which works, because it is the *browser's* paste
and never goes through this code at all. Clipboard **write** is not affected:
Cut and Copy go through `navigator.clipboard.writeText` on the app side,
which this repo already relies on in the Files context menu's "Copy path".
