# Shell surfaces design notes

Long-form design rationale moved verbatim out of the shell's surface regions — panes, drag, tool
window, terminal, keys, panel — to keep comment concentration under the caps in STANDARDS.md §10.
Each of those files points back here; the prose is the same prose, only further from the code it is
about.

## src/shell/panes/splitOnOpen.ts

Which way the focused pane splits when something is opened into it.

Opening an app gives it a **pane of its own** rather than a tab in the pane you were looking at — see
`PaneNode::open_into` in `src-tauri/src/layout.rs`, which is where that decision and its two refusals
are written down. This is the one piece of it that cannot be made in Rust.

### The rule

**Split the focused pane along its longer axis.** A pane wider than it is tall gains a right-hand
column; a pane taller than it is wide gains a bottom row. On the usual wide window that makes the
second app a column beside the first, and a third opened while that column is focused halves *the
column* into two rows rather than cutting a third slice off the width. Repeatedly splitting one axis
is what turns a layout into slivers, and always splitting the long side is what stops it: every pane
stays as close to square as the arrangement allows.

A tie goes to a row. It is reachable only on an exactly square pane, and a window is wider than it is
tall far more often than not.

### Why this is measured in the frontend and not derived in Rust

Because "longer" is a fact about pixels, and Rust does not have any. A `PaneNode`'s `sizes` are
fractions of a parent, deliberately — the window is resizable, and a layout stored in pixels would
have to be recomputed on every resize and would restore wrongly onto a different monitor (see
`layout.rs`, and the `flexBasis` comment in `PaneTree.tsx`). A tree of fractions can say a pane has
half its parent's width; it cannot say whether that is 900px or 300px, and it has never heard of the
window at all. A heuristic over tree *shape* — "the root is a row, so split the other way" — would be
inventing an answer and would be wrong the first time somebody dragged a divider or made the window
tall. So the frontend, which has the rendered rectangle, measures it and passes the answer down; Rust
uses what it is given and guesses nothing.

Measured at the moment of the gesture rather than tracked, because that is the only moment the answer
is needed and the only moment it is certainly current.

### The fallback

No pane id, or a pane the registry cannot find — the moment before the first `shell:state`, or a
cluster with nothing drawn yet — falls back to the shape of the window itself. That is the right
guess rather than a lazy one: a cluster with one pane draws that pane over essentially the whole app
area, so the window's proportions and the pane's are the same question. Returning `null` instead
would silently restore the old put-it-in-a-tab behaviour in precisely the case nobody would think to
test.
