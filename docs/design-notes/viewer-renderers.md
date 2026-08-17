# Viewer renderers — design notes

Design rationale moved out of the source to keep comment concentration under the caps in
STANDARDS.md §10. Nothing here was rewritten: each passage is the prose as it stood in the file it
came from, and the file points back at the section that holds it.

## apps/viewer/ui/src/viewer/activeEditor.ts

Which Monaco editor is mounted right now, for the code that cannot reach it.

The Edit menu's items — Undo, Cut, Find — are the app's answer to a message that arrives from the
shell, not to anything inside the viewer's tree. So the command handler in `App.tsx` needs the live
editor, and `TextViewer` is the only thing that has one. This is the seam between them, and it is
the same shape as `documents` in `../tabs/useOpenFiles`: module scope, one Files frame per window,
so one registry.

**The Monaco import below is `import type` and must stay that way.** This module is reachable from
`App.tsx` at load, and a plain `import` here would drag Monaco's 3.86 MB into the Files entry chunk
— undoing the dynamic-import discipline `./registry.ts` exists to protect. See the far longer
version of this warning at the top of `../tabs/useOpenFiles.ts`, which holds a model for the same
reason and under the same rule. Nothing in this file *creates* anything; it holds a reference to
what `TextViewer` made.

At most one editor exists at a time: switching tabs unmounts the viewer and mounts a new one, and
the unmount clears this. `set(null)` is guarded on identity so a late unmount cannot clear an
editor that has already replaced it — React commits the new mount's effect before the old one's
cleanup in some orderings, and clearing on the wrong one would leave the Edit menu pointed at
nothing while a file was plainly on screen.

### `subscribeActiveEditor`

Watch for an editor arriving or leaving.

`App.tsx` needs this because the mount is *asynchronous*: opening a file renders a tab immediately
and only creates the editor once `files/read` comes back, so nothing React already re-renders on
marks the moment the Edit menu becomes usable. Paired with `activeEditor`, this is a
`useSyncExternalStore` source.

## apps/viewer/ui/src/viewer/monaco.ts

### What the module deliberately does not do

- No `editor.main`. That barrel registers every bundled language _and_ the full
  TypeScript/CSS/HTML/JSON IntelliSense infrastructure as an import side effect — four more worker
  chunks and every Monarch grammar Monaco ships, for an editor that needs a dozen of them.
- No `languages/features/typescript`. TypeScript and JavaScript get the Monarch tokenizer from
  `languages/definitions/` — colour, brackets, comments — but no IntelliSense, because `ts.worker`
  is the single largest chunk Monaco can produce and this is a file editor, not an IDE. Same
  reasoning for `languages/features/css` and `.../html`, whose definitions entries also give
  tokenization without a language service. JSON is the one exception, argued for in the source.
- No diff editor wiring. `src/shell/diff/DiffView.tsx` has its own; see the theme note below for
  what happens when that one moves in here.

### `register.all`: the curation experiment, and why not to repeat it

The whole barrel, and that is a _measured_ decision rather than the lazy one. DO NOT REDO THIS
EXPERIMENT; here is what it found (monaco-editor 0.56, Vite 7, `pnpm build`, chunk sizes as Vite
reports them):

```
  chunk               register.all      curated        delta
  TextViewer.js         3,859.44 kB   3,440.32 kB    -419.12 kB
  jsonMode.js              54.16 kB     478.73 kB    +424.57 kB
  TOTAL minified        3,913.60 kB   3,919.05 kB      +5.45 kB
  TOTAL gzip            1,014.41 kB   1,017.36 kB      +2.95 kB
```

The curated build dropped ten contributions that are provably inert in this app — codelens,
dropOrPasteInto, gpu, inlayHints, inlineCompletions, linkedEditing, parameterHints, rename,
semanticTokens, stickyScroll — every one of which needs a provider that nothing here registers. It
looked like it saved 419 kB off `TextViewer`. **It saved nothing.** Almost exactly that much
reappeared in `jsonMode`: those modules were reachable from the dropped features' static graph, and
with the features gone Rollup could no longer hoist them out of the one dynamic chunk that still
needs them. Total bytes went _up_ by 5.45 kB.

So the trade was: 419 kB deferred out of the chunk every text file loads and into the chunk only a
`.json` file loads, at the price of 54 hand-maintained import lines whose failure mode — a feature
silently absent — is invisible, and which would have to be revisited the day a language service is
added (a TypeScript worker turns rename, parameterHints, inlayHints and semanticTokens back into
live features). Under the ~500 kB bar this was weighed against, and a wash in total bytes, that is
not worth the correctness margin: this is a lazily-loaded chunk served off Tauri's local asset host,
so the cost is parse time, once, with no network in it.

What would actually move this number is not curation. It is the ~28 MB of `esm/vs` that the core
editor pulls in regardless of which contributions are listed. If this chunk ever has to shrink for
real, that is where to look.

### The worker environment

The alternative was to keep one worker and switch every JSON mode flag except `tokens` off.
Rejected: it costs the whole JSON language service to save a chunk that is lazily fetched anyway,
and it leaves a live footgun — anyone turning a flag back on gets a hang rather than a missing
feature.

Expect two JSON worker chunks in the build regardless. `workerManager.js` contains a literal
`new Worker(new URL('json.worker.js', import.meta.url))` that Vite's `vite:worker-import-meta-url`
plugin emits by static analysis, reachable at runtime or not. The `?worker` import in the source is
the second. That is expected, not a bug.

### The theme

Monaco's theme API takes colour _strings_, so this is the one place in the app where a literal hex
is unavoidable — which is exactly why the comments beside each value are mandatory rather than
decorative.

Alphas are 8-digit `#RRGGBBAA`, not `rgba()`. Monaco parses theme colours with `Color.fromHex`,
which understands `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA` and **silently returns opaque red for
anything else** — including a perfectly valid `rgba(...)` string. The two-hex-digit suffix is
`round(alpha * 255)`; the alphas themselves follow the `--accent-wash` convention already in
tokens.css.

**`inherit: true`.** Syntax token colours are inherited from vs-dark rather than restated. The
handoff's palette names UI surfaces, not grammar scopes, so inventing a token colour here would be
inventing a colour, which that file may not do.

**The current line.** One step up from the page — the same step `--surface` makes against `--bg`
everywhere else in the product. The border is set to the same value rather than to a transparent
black, so vs-dark's default outline disappears without the source naming a colour that is not a
token.

**Selection and cursor.** Accent, because tokens.css gives `--accent` to focus, and a selection is
where focus is. Three strengths: the live selection, the same selection once the editor loses focus,
and other occurrences of the selected text.

**Find.** `--warn`, not `--accent`: a find match is not focus, and drawing it in the focus colour
next to a selection drawn in the focus colour would make the two unreadable against each other.

**Indent guides.** The numbered keys are 0.56's; the unsuffixed `editorIndentGuide.*` names are
deprecated aliases and are not restated.

**Minimap.** The minimap is page, not chrome, so it takes `--bg` and disappears into the editor
beside it — vs-dark's default would draw a lighter column along the right edge and read as a second
pane. Its slider is the scrollbar's, one step quieter at rest: the minimap _is_ a scrollbar, and two
different sliders on one edge would look like two different controls.

**The widgets the feature barrel brings with it.** Find, hover, suggest and the context menu all
float above the page, so they take `--surface` and a `--line` hairline like every other floating
panel in the shell.

**Diagnostics.** Only JSON produces these today; the mapping is the shell's, so it stays right when
a second language service arrives.

### `editorSettingsFrom` and `mountEditor`

`automaticLayout: true` matches `DiffView`'s posture: the pane's size is decided by a flexbox and a
draggable splitter rather than by anything that could call `layout()` at the right moment. It is
also what keeps the minimap honest — the map's width is a function of the editor's, and a splitter
drag that did not re-layout would leave it drawn at the old width.

Whether the minimap is drawn at all is `editor.minimap`. The three settings beside it are not,
because they are about _this_ pane rather than about minimaps:

- `renderCharacters: false`. The character-accurate map is a canvas of real glyphs at sub-pixel
  size; the block rendering says the same thing about shape and indentation, reads better next to a
  small editor, and is much cheaper to repaint on every keystroke.
- `maxColumn: 80`. Uncapped, the map is as wide as the longest line in the file, and a minified line
  would eat a third of a pane that is already sharing its width with the tree.
- `showSlider: "mouseover"`. At rest the map is a picture of the file; the viewport box appears when
  the pointer arrives, which is when it is a control.

Not `size: "fill"` or `"proportional"`: the default `"actual"` draws one map line per file line and
stops, so a short file gets a short map instead of one stretched to the pane's height, and the map's
vertical position agrees with the scrollbar beside it.

### The dirty-diff gutter and its peek

**`peekHeightPx`.** Rows of vertical space one peek needs, in the editor's own line height rather
than a fixed pixel count — which is load-bearing now that `fontSize` is `editor.fontSize` rather
than a literal: it lines up with the surrounding text at whatever size the editor is actually
drawing, and does not clip at the top of the range.

**`GitGutter.update`.** A peek left open across a hunk swap would show text next to a bar it no
longer describes: after a save, the same line can belong to a different hunk or none at all.

**`hunkCoversLine` and `hunkDecoration`.** A deletion covers no current line at all — its `lines` is
0 — so it can only ever match the one line its wedge is drawn against, which is `start` itself.
Without `isWholeLine`, a three-line addition would show a bar on its first line alone.

**`headLines`.** Splitting on `"\n"` alone would leave a trailing `\r` on every line, which renders
as an invisible difference on a line that is actually identical to the one below it in the peek — a
confusing thing to debug from a screenshot, since the two lines look the same.

**`peekRow`.** A `div` rather than a line inside one shared `<pre>`: each row needs its own
background tint, and a background painted per line is what makes this read as a diff instead of two
blocks of plain text.

**`PEEK_MAX_ROWS`.** The peek is a view zone, so its height is real document flow — an uncapped one
over a hunk that deleted four thousand lines is a peek several screens tall that pushes the rest of
the file out of view, and since a peek is closed by clicking the same gutter bar that opened it,
that bar is now scrolled far off screen. One click, stuck editor.

**`peekBudget`.** A hunk that removed three thousand lines and added five would otherwise spend the
entire budget on the removed side and show none of what replaced it — which is the half the reader
is usually looking for.

**`peekMore`.** A reader who saw forty rows and no marker would reasonably conclude that was all of
it, which is a worse failure than showing nothing.

**`buildPeek`.** Both slices fall out of one rule with no per-`kind` branching needed: an addition
has `originalLines: 0`, so its HEAD slice is empty and only the added rows draw; a deletion has
`lines: 0`, so only the removed rows draw. A modification draws both, in the order a unified diff
would.

**`peekHeight`.** A zone sized to four thousand lines around forty rows of content is the same stuck
editor by another route. The `+1` covers a truncation marker; one spare row costs nothing and a
clipped last line looks broken.
