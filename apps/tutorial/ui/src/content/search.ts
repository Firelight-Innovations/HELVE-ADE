import type { Body } from "./blocks";

/**
 * Search, and its query grammar.
 *
 * The grammar is the reason this tutorial exists. VS Code splits filtering
 * across a second field, so nobody arrives expecting one box to take both — and
 * a person who never learns `ext:` or a trailing slash uses maybe a third of
 * what is there.
 */
export const search: Body = {
  takeaway:
    "You can search a project's contents and narrow the results without leaving the one field.",
  blocks: [
    {
      kind: "step",
      body: "Press the chord from anywhere, or click the field on the right of the switcher bar.",
      chord: "Ctrl+K",
    },
    {
      kind: "step",
      body: "Type. Results appear after a short pause — long enough that ordinary typing starts one search rather than eight.",
    },
    {
      kind: "step",
      body: "Press `Escape` to leave. The layout underneath is untouched and still there.",
    },
    {
      kind: "text",
      body: "Search is a **mode the window is in**, not a place in the layout. It covers the panes rather than taking a pane of its own — which is why it cannot be split, dragged, or left open behind other work.",
    },

    { kind: "heading", body: "What it actually searches" },
    {
      kind: "text",
      body: "File **contents**, across the whole of the cluster's project — a real walk over every text file under it, reporting every line a query matches with its line, column and length. It respects your ignore files the way `ripgrep` does, because it is built from the same crates.",
    },
    {
      kind: "text",
      body: "It searches the cluster the search was started in. Two clusters with two projects search two different trees.",
    },

    { kind: "heading", body: "The three regions" },
    {
      kind: "text",
      body: "Results run across the top. The lower half is split in two, and both halves follow whichever row your pointer is over.",
    },
    {
      kind: "text",
      body: "The **locator** on the left says *where* the file is, which is what tells two identically-named files apart. The **preview** on the right says *what is in it*, which is what confirms it is the one you meant. Neither alone is enough to choose between `src/index.ts` and `dist/index.ts`.",
    },
    {
      kind: "note",
      body: "Nothing below the results is interactive. The locator cannot be expanded and the preview cannot be edited — they narrate what you are passing over, so there is no second thing to manage while you are scanning.",
    },

    { kind: "heading", body: "Opening a hit" },
    {
      kind: "text",
      body: "`Enter` on the focused result, or a double-click on any row, puts that file on screen in a File Viewer in the same cluster.",
    },

    { kind: "heading", body: "Narrowing, in the same field" },
    {
      kind: "text",
      body: "This is the part worth learning. One field takes both the term and the filters, so you never move your hands to a second box.",
    },
    {
      kind: "keys",
      rows: [
        { chord: "*.md", what: "A bare glob. The path must match it." },
        { chord: "src/", what: "A trailing slash scopes to a directory." },
        { chord: "path:src/shell", what: "The same thing, said explicitly." },
        { chord: "ext:rs", what: "By extension, dot-less." },
        { chord: "kind:script", what: "By file kind, worked out from the extension." },
        { chord: "!dist", what: "Negation. `-dist` does the same." },
      ],
    },
    {
      kind: "text",
      body: "A quoted phrase searches for the phrase. Everything left over once the filters are stripped out is the thing being searched **for**, rather than filtered **by** — so `ext:ts useCallback` finds `useCallback` in TypeScript files.",
    },
    {
      kind: "note",
      body: "The filter buttons above the results write into the same string you are typing. There is one query, in one place, whether you clicked it or typed it — which is why a click can never disagree with the field.",
    },

    { kind: "heading", body: "The caps, and why they exist" },
    {
      kind: "text",
      body: "Three limits in Settings → **Search** keep a query on a large checkout from running away: **Match limit**, **File limit**, and **Skip files larger than**. Each is read when a search starts, so raising one takes effect on the next search rather than the one already running.",
    },
    {
      kind: "soon",
      body: "There is no replace-across-files, and no search history. The field starts empty every time.",
    },
  ],
};
