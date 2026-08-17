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
hand-written (`@helve/monaco-languages`) precisely because Monaco does not
ship it, and a hand-written Monarch grammar can be handed to a bare
`editor.api` instance for free. Every other language would arrive by
importing its own entry under `languages/definitions/`, one lazy chunk each,
and that is a bundle decision for whoever decides a source-control diff should be
fully coloured — not a side effect of teaching this editor the one format
HELVE's own config files are written in.

(The short specifier is not a shorthand for the long one: monaco-editor
0.56's `exports` map is `"./*": "./esm/vs/*.js"`, so
`monaco-editor/esm/vs/editor/editor.api` would resolve to
`esm/vs/esm/vs/editor/editor.api.js` and fail. The code below has always been
right; this comment used to name a path that does not exist.)

### The `helve-dark` theme's colours

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
