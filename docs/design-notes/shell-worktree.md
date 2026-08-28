# Shell worktree and diff design notes

Design rationale moved out of the source to keep comment concentration under the caps in
STANDARDS.md section 10; the source files point back here.

## src/shell/diff/DiffView.tsx

### Sharing Monaco with the Files app

Files (`apps/files`) also uses Monaco, wired separately in
`apps/files/ui/src/viewer/monaco.ts`. The two do not collide: an app runs in
its own iframe, so each has its own `self.MonacoEnvironment` and its own
theme registry. They do share chunks — both entries reach the same
`monaco-editor` modules, so Rollup hoists them into one shared dynamic
chunk. That is fine and deliberate: it is dynamic on both sides, so
`index.html` preloads none of it.

### Why `editor.api`, and why TOML is the only language

Imported from `monaco-editor/editor/editor.api`, not `.../editor.main` —
`editor.main` registers every bundled language, and the IntelliSense
infrastructure behind them, as a side effect of import. None of that is
needed to show a read-only diff.

The cost of that choice is that Monaco arrives here knowing no *bundled*
language, so `language` below is honoured for exactly one value: `"toml"`,
registered by the `registerToml` call further down. Every other id resolves
to nothing and renders as plain text — which is the same answer the prop gave
for every id before, so no caller regresses.

That asymmetry is not an oversight, it is the shape of the fix. TOML is
hand-written (`@openkaava/monaco-languages`) precisely because Monaco does not
ship it, and a hand-written Monarch grammar can be handed to a bare
`editor.api` instance for free. Every other language would arrive by
importing its own entry under `languages/definitions/`, one lazy chunk each,
and that is a bundle decision for whoever decides a source-control diff should be
fully coloured — not a side effect of teaching this editor the one format
OpenKaava's own config files are written in.

(The short specifier is not a shorthand for the long one: monaco-editor
0.56's `exports` map is `"./*": "./esm/vs/*.js"`, so
`monaco-editor/esm/vs/editor/editor.api` would resolve to
`esm/vs/esm/vs/editor/editor.api.js` and fail. The code below has always been
right; this comment used to name a path that does not exist.)

### The `kaava-dark` theme's colours

Colours are lifted from src/tokens.css, not chosen here. `editor.background`
and `editor.foreground` reuse --bg and --text directly. The diff
insert/remove backgrounds reuse --ok and --err — the same pair
`CHANGE_TOKEN` in contract.ts already uses for added ("A") and deleted
("D") files — at two alphas: a low "wash" alpha for the full-line
background, matching the --accent-wash convention already in tokens.css,
and a stronger alpha for the character-level highlight within a changed
line.

The four diff colours are 8-digit hex rather than `rgba(...)`, and that is
not a style preference. Monaco parses a theme colour with `Color.fromHex`,
which is `parseHex(hex) || Color.red` (base/common/color.js:182), and
`parseHex` accepts only `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`. A
perfectly valid CSS `rgba()` string is not rejected loudly — it silently
becomes **opaque red**. These four were written that way and did render red;
nothing mounts this component, so nobody had seen it. The alpha byte is
round(alpha * 255): 0.08 is 0x14, 0.25 is 0x40.

## src/shell/diff/reviewPrompt.ts

### The pasted format is a contract

On one side is a person writing prose in a panel; on the other is a coding
agent reading it out of a terminal or a paste buffer, with no schema between
them but the shape of these lines. It has to stay deterministic — the same
notes always produce the same string — and it has to survive being pasted into
a shell.

Surviving a shell is what `escapeBody` is for, and why the body ends up on one
line inside quotes: a newline in a pasted string is a submitted line, so an
unescaped two-paragraph note would hand the agent its first paragraph and run
the second as a command. The four replacements happen in a fixed order,
backslash first, because escaping the escape character after the others would
escape their backslashes a second time.

### Why there is a preamble and Orca has none

Orca has an agent chat pane and can put a batch of notes into it as a labelled
message. OpenKaava has a terminal, so this string arrives as raw typing at whatever
prompt is sitting there, with nothing around it to say that a list of
file-and-line blocks is a review rather than a paste accident. One sentence in
front of the blocks is what makes it read as an instruction.

### Why the scope line

The same path at the same line means different code in each of the three diffs
a note can be written against. An agent told only "line 12 of src/a.rs" would
go looking in the working tree even when the note was about what the branch
changed since it forked.

## src/shell/diff/AnnotatedDiff.tsx

### Why the notes are fetched per diff rather than hoisted

`useGitStatus` is hoisted into `WindowRoot` because two regions read one status
and two fetches would be two chances to disagree about the branch. None of that
applies here. Nothing else reads these notes, only one diff is open at a time,
and the whole file is a few kilobytes of JSON — so the cost of re-reading on a
file switch is a rounding error, and hoisting would put a fourth review-shaped
prop through `WindowRoot`, which is already the largest file in the tree.

Re-reading is also what makes another window's notes appear. There is no
watcher behind any of this, and a fetch on mount is the entire update model —
the same one `GitControl` uses, for the same reason.

### Why the notes list sits under the diff and not inside it

This is the one substantial departure from Orca, which floats a card in a
Monaco view zone at the commented line. In a wide editor that is plainly the
better answer: the note sits against the code it is about.

This diff is mounted in a panel whose default width is `--w-panel-default`,
380 pixels. A card of prose inserted between two lines of code at that width
pushes most of the visible diff off screen and takes the surrounding lines —
the ones that give the note its meaning — with it. A list below keeps both
readable, and the glyph-margin marker plus `DiffAnnotations.reveal` are what
keep a note and its line findable from each other.

The cost is real and worth stating: with the list scrolled and the diff
scrolled independently, a note and its line can both be visible without being
beside each other. Clicking the note's line label is what closes that gap, and
it is why that label is a button rather than text.

## src/shell/diff/reviewComments.ts

### Why `markAtLine` is a named function

Two callers in `DiffView` ask the same question and must not answer it
differently: the glyph margin's click handler asks whether a line already has a
marker, to decide between opening what is there and starting something new, and
the hover affordance asks the same thing to decide whether to draw its `+`.

They were written as two separate `.find` calls and did disagree. Monaco merges
decorations rather than letting one win, so a noted line drew both classes into
the same twelve-pixel glyph cell and grew a plus through its own dot on hover.
One function, five tests, and the two surfaces now cannot drift.

Overlapping ranges are legal — a note on 3-9 and a note on 5 are both about
line 5 — and the decorations are in file order, so the first match is the one
starting soonest.
