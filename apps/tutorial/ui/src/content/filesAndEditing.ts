import type { Body } from "./blocks";

/**
 * The two file apps, and the rule between them: the Explorer never draws a
 * file's contents, and the Viewer never browses.
 *
 * The preview-tab rule gets a heading of its own because it is the behaviour
 * most likely to look like a bug — a tab that replaces itself is alarming until
 * you know it is deliberate.
 */
export const filesAndEditing: Body = {
  takeaway:
    "You can move around a project without leaving forty tabs behind, and you know which files the Viewer will not open as text.",
  blocks: [
    {
      kind: "text",
      body: "Two apps, deliberately. **File Explorer** is the shape of the project — folders, and what is in them. **File Viewer** is the contents. The Explorer never draws a file; clicking a row asks the shell for a Viewer in the same cluster instead.",
    },
    {
      kind: "note",
      body: 'They share one Rust half. There is one filesystem, and a second copy of "read this file" would be a second chance for the two to disagree about the guard that keeps two writers from clobbering each other.',
    },

    { kind: "heading", body: "Browsing" },
    {
      kind: "step",
      body: "Open a **File Explorer** from the `+` in the switcher bar. It roots itself at the cluster's project.",
    },
    {
      kind: "step",
      body: "Single-click a file. It opens in a File Viewer beside you, in a **preview** tab.",
    },
    {
      kind: "step",
      body: "Single-click another. The preview tab is **taken over** rather than a second tab appearing.",
    },
    {
      kind: "text",
      body: "That is VS Code's rule, and it is the reason browsing a folder leaves you with one tab instead of forty. Type anything into a preview tab and it stops being one — the next click then opens a new tab beside it rather than throwing your edit away.",
    },

    { kind: "heading", body: "Changing the shape of a project" },
    {
      kind: "text",
      body: "Right-click a row in the Explorer. The menu holds:",
    },
    {
      kind: "keys",
      rows: [
        {
          chord: "New File",
          what: "And **New Folder**, both created inside the folder you clicked.",
        },
        { chord: "Rename", what: "Edits the name in place." },
        { chord: "Delete", what: "Moves to the system trash — see below." },
        { chord: "Copy path", what: "And **Copy relative path**, relative to the project root." },
        { chord: "Reveal in File Explorer", what: "Opens the OS file manager at that item." },
        {
          chord: "Open with the default app",
          what: "Hands the file to whatever the OS uses for it.",
        },
      ],
    },
    {
      kind: "text",
      body: "**Delete moves to the system trash rather than removing anything**, which is why it can be confirmed once and then trusted. Settings → **File Explorer** → **Ask before deleting** turns the confirmation off.",
    },
    {
      kind: "soon",
      body: "Turning that off still leaves one prompt in place: if the thing you are deleting has **unsaved** edits under it, HELVE asks anyway. The trash can give back the last *saved* version of a file — the typing you have not saved is the one thing it cannot return.",
    },

    { kind: "heading", body: "Editing" },
    {
      kind: "text",
      body: "The Viewer holds files in tabs. `Ctrl+S` saves, `Ctrl+Shift+S` saves as, `Ctrl+D` duplicates. Undo, redo, cut, copy, paste, find and replace are the editor's own and work as they do everywhere.",
    },
    {
      kind: "text",
      body: "Every `editor.*` setting — font size, tab width, wrapping, the minimap, line numbers, whitespace — is read when an editor is **created**. Changing one does nothing to a file already open; open another and it is there. The setting says so under the control.",
    },

    { kind: "heading", body: "Not everything is text" },
    {
      kind: "text",
      body: "The Viewer picks how to draw a file from its extension:",
    },
    {
      kind: "keys",
      rows: [
        {
          chord: "Images",
          what: "`png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `ico`, `avif` — drawn, not editable.",
        },
        {
          chord: "SVG",
          what: "Rendered, and it can toggle to its own source — an SVG is genuinely both.",
        },
        { chord: "PDF", what: "Rendered." },
        { chord: "Mermaid", what: "`mmd` and `mermaid` are drawn as diagrams." },
        {
          chord: "Everything else",
          what: "Tried as text, because a name cannot say whether bytes decode.",
        },
      ],
    },
    {
      kind: "text",
      body: "A file that turns out not to be valid UTF-8 falls through to an **Unsupported** panel rather than filling the editor with replacement characters.",
    },
    {
      kind: "note",
      body: "Text reads are capped, and the Viewer says so at the seam when it truncates rather than quietly showing you part of a file. The cap is Settings → **File Explorer** → **Open at most**. Truncation is only honest when you can see where it happened, which is why images and PDFs are not truncated at all — they are simply refused past a much larger limit.",
    },

    { kind: "heading", body: "Git decoration" },
    {
      kind: "text",
      body: "If the project is a git repository, changed files are marked in the tree and ignored files are dimmed, without you asking for it. The Viewer can show what changed within a file against `HEAD`. **Git, and a worktree per branch** goes further.",
    },
  ],
};
