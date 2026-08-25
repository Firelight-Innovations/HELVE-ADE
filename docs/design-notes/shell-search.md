# Shell search — design notes

Design rationale moved out of `src/shell/search/*` to keep comment concentration under the
caps in STANDARDS.md §10. Nothing here is a summary; each section is the prose as it stood in
the source, and the source file points back at this page.

## src/shell/search/types.ts

These are deliberately _not_ in `contract.ts` yet. `contract.ts` is the shell's shared surface
— the other agent working this branch owns the git region of it — and everything here is still
moving. Once the overlay's shape settles, `SearchHit` and `SearchKind` graduate into the search
block of `contract.ts` and `SearchIndex` is rewritten around them; until then the churn stays
local to this directory.

The existing `SearchType`/`SearchResult`/`SearchIndex` trio in `contract.ts` still backs the
collapsed slot's stub list. It is untouched here on purpose: the collapsed field and its Ctrl+K
entry point are unchanged, and only what happens after it expands is new.

### `SearchKind`

What a hit _is_, which is a coarser question than its file extension.

The five-way `SearchType` in `contract.ts` was drawn from the handoff crop and mixes two
different axes — three file kinds alongside "terminal output" and "tool settings", which are
not files at all. This is the file axis only, pending Braden's call on whether the non-file
types survive.

### `SearchHit.path`

`path` is absolute, because every consumer needs it absolute: the locator tree walks it back to
the search root, and the preview pane hands it straight to `files/read`. Relative display is a
rendering concern, computed against the root at draw time rather than stored.

### `SearchHit.matches`

Every place inside the file the query matched, in file order.

Empty for a hit that matched on its _name_ only, which is a real and common case: search
matches names and contents both, and a file whose name matches has nothing inside it to point
at. The results list draws such a hit as a single row with nothing nested under it.

A list rather than one match because find-and-replace made it one: a replace steps through
matches, not files, so a file with nine of them owes the user nine stops. That is also what the
results region nests — a file row with its matches under it — and what makes "417 results in 32
files" a number this shape can actually produce.

### `ResultRow`

The results region flattened to what it actually draws: one entry per row.

The region is a nested list — a file, then its matches — but it is rendered and navigated as a
flat one, because the arrow keys have to step through _matches_ and a nested structure makes
"the next row" a tree walk. Flattening once, here, is the same trick `LocatorTree` plays for the
same reason, and it is what lets the cursor be a single integer.

A file whose name matched but whose contents did not contributes one `file` row and no `match`
rows, so it is a stop on the way past rather than a header over nothing.

### `LocatorNode`

Mirrors the `Entry` shape `files/list` returns rather than inventing a new one, so a listing
maps onto it without translation. `kind` drops Files' `"other"` case into `"file"`: the locator
only ever draws a folder or a leaf, and a socket or symlink drawn as a leaf is correct enough
for a pane whose only job is showing you where something sits.

## src/shell/search/openHit.ts

Both gestures land here through the same one-argument call, which is why the two can disagree
about _which_ row without this module having to care — the keyboard resolves its row from the
cursor, the pointer resolves its row from itself, and both hand over a finished path. See
`SearchOverlayProps.onOpen` for why that distinction is load-bearing rather than tidy.

Deliberately not a hook and not a component — the overlay's key handling is someone else's code
(see `SearchOverlay.tsx`), and this module exists precisely so that code can call one function
without importing the tool window's internals to do it. That is also why the two things this
needs — "which window am I" and "which frame belongs to that window" — are both resolved from
module-scope lookups (`windowLabel()`, `toolWindowBridge()`) rather than taken as parameters: a
caller with no props to lean on can still say what it means, because both sides already agree on
the address.

### What this does not do

It does not focus the pane Files ends up in, or the search overlay's own closing — both are the
caller's job, and both need state (`activePaneId`, `searchExpanded`) that lives in
`WindowRoot.tsx` and has no business being threaded through here.

It reveals the file in Files' tree only as far as that tree already reaches on its own: opening
a tab sets `activePath`, which `App.tsx` passes to `Explorer` as `selectedPath`, and `Explorer`
puts the keyboard cursor there and gives the row the "open" treatment — but only if the row
already exists, which means every ancestor folder between the project root and this file has
already been expanded. A folder nobody has browsed to has no rows loaded for it at all
(`explorer/useTree.ts` is lazy on purpose), so revealing a file under a folder nobody has opened
would mean walking every ancestor and awaiting a `files/list` at each level before the leaf row
exists to put a cursor on — real work, and none of the machinery for it exists on either side of
the app boundary today. Opening the tab is the whole of what this does; see the handoff summary
for the trade.

### `openHitInFiles`'s `clusterId === null` guard

`clusterId` mirrors `PreviewPane.tsx`'s own convention in this directory: `null` means no
cluster rather than an absent one, and there is nothing sensible to open into, so this resolves
without doing anything. That is not a case the overlay should ever produce — a hit only exists
because a search ran against some cluster's project — but it costs nothing to make the no-op
explicit rather than let a `null` reach `paneTabs` further down as an unexplained early return.

### Opening a first Files instance

No pane or split axis to aim at: this call has no `activePaneId` to measure from (that is
`WindowRoot.tsx`'s local state, not something a standalone module can reach), so a first Files
opens as a tab in the active cluster's first pane rather than splitting toward wherever the user
was last looking. Reasonable for what is, today, a single deliberate open rather than a habitual
one.

### Pushing the event into a frame that may not exist yet

The frame this instance mounts into may not exist yet — `openInstance` resolves before
`ToolWindow` has mounted the iframe or completed its hello/ready handshake, and even the
_existing_-instance branch races a Files that is still booting from a previous open.
`sendEventWhenReady` queues across that gap and delivers the moment the frame says ready; see
`ToolWindow.tsx`. If this window's `ToolWindow` has not registered a bridge at all yet, there is
nothing to queue into — a race no keystroke can actually land inside, since there is no overlay
to press Enter in until the window holding it has painted once.

## src/shell/search/searchSource.ts

### `SearchRequest.root`

Absolute directory being searched — kept for source compatibility with the caller and because
other parts of the overlay (the locator tree) still need a root to display paths relative to.
Unused for resolving _where_ to search: that is now `clusterId`'s job, resolved on the Rust side
the same way every other cluster-scoped command resolves one (see `search.rs`'s module doc). The
frontend cannot hand the backend a directory to run in even if it wanted to — `cluster_path` is
not exposed to it.

## src/shell/search/query.ts

### `toQueryString` — the round trip, case by case

For `parseQuery(toQueryString(p))` to deep-equal `p` for every `p` `parseQuery` can produce,
these are the cases worth writing down:

- **Empty needle.** Omitted entirely rather than emitted as `""` — an empty token stream parses
  back to `needle: ""` on its own, so there is nothing to round-trip.
- **A needle that looks like a token** (`*.md`, `path:x`, a lone `-` followed by more text).
  `needsQuoting` flags exactly the shapes `classifyToken` would otherwise misparse and
  `serializeNeedle` wraps the needle in a quoted phrase, which `parseQuery` always reads as
  needle text regardless of what's inside. Both checks are written to mirror each other's
  thresholds (`length > 1` before treating a leading `!`/`-` as a marker, same for a trailing
  `/`) — under-quoting a needle that needed it is a parse bug, so the mirrored check leans safe
  wherever the two could disagree.
- **A multi-word needle** (`render scene`). Emitted as bare words, not as one quoted phrase —
  see `serializeNeedle`. Quoting here would round-trip correctly and still be wrong, because it
  rewrites text the user typed.
- **A quoted phrase**, including one containing `"` or `\`. `quoteNeedle` backslash-escapes both
  before wrapping, and `tokenize` reverses exactly that escaping — this is not a lossy case, just
  one that needs the escape pass to not be.
- **An extension that is also a kind name** (`ext:script` alongside `kind:script`). No collision:
  `extensions` and `kinds` are always spelled with their own prefix keyword on both ends of the
  round trip, so the two arrays never share a token's meaning even when they share a token's
  text.

## src/shell/search/previewMonaco.ts

### The two integrations this file was mined from

Two existing integrations were mined for this one, and neither could just be imported:
`src/shell/diff/DiffView.tsx` is shell-side like this pane, but its `editor.api`-only import
means it has no tokenizer for any language, and this pane's whole job is showing a file's syntax;
`apps/files/ui/src/viewer/monaco.ts` has the tokenizer wiring and the theme this pane wants, but
it lives in `apps/files/`, which `src/` may not import from (and vice versa — see CLAUDE.md's app
isolation rule). So this file borrows the _shape_ of both — DiffView's worker wiring and disposal
discipline, Files' language table and theme palette — and restates it, with comments marking what
came from where.

## src/shell/search/useSearchBarHold.ts

Search opens and closes as two beats — the field crosses the bar, then the overlay comes down;
the overlay rolls up, then the field crosses back. The first three of those fall out of framer
for free, because they are animations and an animation can be given a delay. The fourth cannot:
the cluster chips do not animate back at all. `switcher.css` is explicit about why — the
collapsed row has an empty rect, so there is nothing for framer to interpolate and the chips
return already drawn.

So on close, the chips reappear the instant the boolean flips, which would put them back
underneath a field that is still full width and still shrinking. The fix is not to delay an
animation but to delay the state change, which is what this is: one boolean, held at `true` for
as long as the overlay takes to leave, and never held on the way in.

Opening is deliberately not deferred. The bar leads that direction, and a field that hesitated
before crossing would be answering the keystroke late.
