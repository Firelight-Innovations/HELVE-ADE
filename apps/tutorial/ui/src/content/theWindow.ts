import type { Body } from "./blocks";

/**
 * The vocabulary tutorial. Everything after this one says "the switcher bar" or
 * "the band" without stopping to explain it, so this is where those get names.
 *
 * Deliberately short and deliberately first. It has no steps worth calling
 * steps — it is a labelled diagram, now drawn as one rather than only argued
 * for in prose.
 */
export const theWindow: Body = {
  takeaway:
    "You can name every band of the HELVE window, which is what the rest of these tutorials assume.",
  blocks: [
    {
      kind: "text",
      body: "The HELVE window is five horizontal bands stacked in a column. Only the middle one grows. Naming them is worth four minutes, because every other tutorial says these words without stopping.",
    },
    {
      kind: "mock",
      view: "window-bands",
      caption: "The five bands, each named by the arrow pointing at it.",
    },

    { kind: "heading", body: "1. The title bar" },
    { kind: "mock", view: "title-bar", caption: "The menu bar and the window controls beside it." },
    {
      kind: "text",
      body: "Top of the window. Holds the menu bar — **File**, **Edit**, **Apps**, **View**, **Run**, **Terminal**, **Help** — and the window controls. When the window is narrow the menus collapse behind a single hamburger button rather than wrapping.",
    },
    {
      kind: "text",
      body: "**Apps** and the switcher bar's `+` menu are the same list, built once.",
    },
    {
      kind: "note",
      body: "Every accelerator drawn beside a menu item is one the keystroke actually performs. An item with no accelerator beside it has no shortcut, rather than an undocumented one.",
    },

    { kind: "heading", body: "2. The switcher bar" },
    {
      kind: "mock",
      view: "switcher-bar",
      caption: "Clusters on the left, the `+` between them, search on the right.",
    },
    {
      kind: "text",
      body: "Under the title bar. On the left are your **clusters** — each one an independent workspace with its own project and its own arrangement of panes. On the right is the search field, and between them the `+` that opens something new.",
    },
    {
      kind: "text",
      body: "The `+` menu lists every app this build ships — **Home**, **File Explorer**, **File Viewer**, **Tutorials** — plus **Terminal**, plus your saved layout presets.",
    },
    {
      kind: "text",
      body: "The bar also holds a warning-triangle badge, listing any tool whose health is not **ok** — **needs update**, **not tracked**, or **not installed**. It counts only the six authoring tools; the Engine is a runtime and never appears there. On a fresh machine all six read **not installed**, which is correct rather than broken; see **The stack, end to end** for why.",
    },

    { kind: "heading", body: "3. The tool window" },
    {
      kind: "text",
      body: "The large middle band, and the only one that grows. It holds the **panes** of whichever cluster is showing, each with an app in it.",
    },
    { kind: "flow", steps: ["One pane fills it", "split it", "two panes, each with its own app"] },
    {
      kind: "text",
      body: "To its right is the **secondary panel**, which today shows source control and nothing else. `Ctrl+B` collapses it to a strip and brings it back.",
      // The panel is deliberately roomier than source control fills — it is
      // meant to grow more views. Saying that here would be describing the
      // roadmap rather than the window.
    },

    { kind: "heading", body: "4. The terminal band" },
    {
      kind: "text",
      body: "Under the tool window, across the full width. Wide and short, which is the shape a terminal wants. Ctrl and the key under Escape opens and closes it.",
    },
    {
      kind: "text",
      body: "The band belongs to the **cluster**, not to the window.",
    },
    {
      kind: "flow",
      steps: ["Switch clusters", "the terminal band swaps too", "same as the panes above"],
    },
    {
      kind: "note",
      body: "Drag the line above the band to resize it. Shove it down past a point and it snaps shut; lift it past the tool window's floor and it takes the whole column. Both have a deliberate dead zone, so neither happens by accident.",
    },

    { kind: "heading", body: "5. The status bar" },
    {
      kind: "mock",
      view: "status-bar",
      caption: "Engine status, the branch and its diff stat, GitHub, then settings.",
    },
    {
      kind: "text",
      body: "The thin bar along the bottom. It reports, left to right, the engine's status, the open cluster's branch and how far it has diverged, and a diff-stat readout of the working tree. GitHub status and the sliders glyph that opens **Settings** finish the row.",
    },

    { kind: "heading", body: "Worth knowing now" },
    {
      kind: "keys",
      rows: [
        { chord: "Ctrl+K", what: "Search this project." },
        { chord: "Ctrl+B", what: "Show or hide the secondary panel." },
        { chord: "Ctrl+`", what: "Show or hide the terminal band." },
        { chord: "Ctrl+Shift+`", what: "New terminal." },
        { chord: "F11", what: "Full screen." },
        { chord: "Ctrl+1", what: "…through `Ctrl+9`, select the nth tab in this window's bar." },
      ],
    },
    {
      kind: "soon",
      body: "`Ctrl+Shift+P` opens a command palette that is not built yet, the **Run** menu does nothing, and **Help** has four items that are all inert. They are drawn because the shape of the menu is settled; none of them acts.",
    },
  ],
};
