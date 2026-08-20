# Finding things

*Working in the shell · 5 min · after [Terminals](terminals.md)*

Jump to a file by name, and search the project's text.

---

1. Press the chord from anywhere (`Ctrl+K`), or click the field on the right
   of the switcher bar.
2. Type. Results appear after a short pause — long enough that ordinary
   typing starts one search rather than eight.
3. Press `Escape` to leave. The layout underneath is untouched and still
   there.

Search is a **mode the window is in**, not a place in the layout. It covers
the panes rather than taking a pane of its own — which is why it cannot be
split, dragged, or left open behind other work.

## What it actually searches

File **contents**, across the whole of the cluster's project. It walks every
text file under it, reporting each match's line, column and length. It
respects your ignore files the way `ripgrep` does — search is built on the
same crates.

It searches the cluster the search was started in. Two clusters with two
projects search two different trees.

## The three regions

<!-- SCREENSHOT: the search overlay — results across the top, locator and preview below, 1440x900 -->

_Results run across the top; the locator and preview below follow whichever
row the pointer is over._

The **locator** on the left says _where_ the file is, telling two
identically-named files apart. The **preview** on the right says _what is in
it_, confirming you have the right one. Neither alone chooses between
`src/index.ts` and `dist/index.ts`.

> Nothing below the results is interactive. The locator cannot be expanded,
> and the preview cannot be edited — both only narrate what you are passing
> over, with nothing else to manage while you scan.

## Opening a hit

`Enter` on the focused result, or a double-click on any row, puts that file on
screen in a File Viewer in the same cluster.

## Narrowing, in the same field

This is the part worth learning. One field takes both the term and the
filters, so you never move your hands to a second box.

Type a query → Results appear → Narrow, in the same field → Open a hit

| Pattern            | What                                          |
| -------------------- | ------------------------------------------------ |
| `*.md`              | A bare glob. The path must match it.               |
| `src/`              | A trailing slash scopes to a directory.            |
| `path:src/shell`    | The same thing, said explicitly.                   |
| `ext:rs`            | By extension, dot-less.                            |
| `kind:script`       | By file kind, worked out from the extension.       |
| `!dist`             | Negation. `-dist` does the same.                   |

A quoted phrase searches for the phrase. Everything left over once the
filters are stripped out is the thing being searched **for**, rather than
filtered **by** — so `ext:ts useCallback` finds `useCallback` in TypeScript
files.

> The filter buttons above the results write into the same string you are
> typing. One query lives in one place, whether you clicked it or typed it —
> which is why a click can never disagree with the field.

Click a filter button → Writes into the query string → Same as typing it yourself

## The caps, and why they exist

Three limits in Settings → **Search** keep a query on a large checkout from
running away: **Match limit**, **File limit**, and **Skip files larger
than**. Each is read when a search starts, so raising one takes effect on the
next search rather than the one already running.

> **Not yet:** Replace-across-files does not exist, and neither does search
> history. The field starts empty every time.

---

**Takeaway:** You can search a project's contents and narrow the results
without leaving the one field.
