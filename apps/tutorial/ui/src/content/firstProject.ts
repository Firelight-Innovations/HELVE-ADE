import type { Body } from "./blocks";

/**
 * Opening a folder, and what "set up as a HELVE project" actually writes.
 *
 * The second half matters more than the first. A tool that creates files in
 * somebody's repository owes them an exact list, and "initialize" is a word that
 * hides one.
 */
export const firstProject: Body = {
  takeaway:
    "You can open a folder as a project, and you know exactly which two things HELVE wrote into it.",
  blocks: [
    {
      kind: "text",
      body: "A HELVE project is **a folder**. Not a workspace file, not a database entry — a directory on disk that you point HELVE at.",
    },

    { kind: "heading", body: "Open one" },
    {
      kind: "step",
      body: "On the Home screen, click **Open Project** under **Start**. A native folder picker opens.",
      chord: "Ctrl+O",
    },
    {
      kind: "step",
      body: "Pick any folder. It does not have to be a HELVE project, or a git repository, or empty.",
    },
    {
      kind: "step",
      body: "Home now shows it at the top, under **Open**, with its full path.",
    },
    {
      kind: "note",
      body: "The picker is a native OS dialog and it blocks until you answer it. If HELVE looks frozen after clicking, check your other monitor — the button says **choose a folder…** while it is waiting, which is the only clue you get.",
    },

    { kind: "heading", body: "A plain folder is a real project" },
    {
      kind: "text",
      body: 'A folder with no HELVE manifest still opens, and this is deliberate rather than lenient. HELVE has to be able to point at a game that already exists, and the answer to "what happens when the project format changes" must never be "it stops opening".',
    },
    {
      kind: "text",
      body: "Home marks such a folder **not set up** and offers a button: **Set up as a HELVE project**. Nothing forces you to press it.",
    },

    { kind: "heading", body: "What setting it up writes" },
    {
      kind: "text",
      body: "Exactly two things, both at the top level of the folder. Nothing else, anywhere.",
    },
    {
      kind: "step",
      body: "A manifest named after the folder — a project called `Anvil` gets `Anvil.helve`. It is small, hand-editable TOML, and it is meant for version control.",
    },
    {
      kind: "step",
      body: "A `.helve/` directory beside it. This is the opposite of the manifest: everything HELVE *produces* about the project — agent traces, designs, docs — and it grows. It is created empty.",
    },
    {
      kind: "text",
      body: "The manifest looks like this, comments and all:",
    },
    {
      kind: "code",
      body: `[helve]
# Bumped only when a change would make an older HELVE misread this file.
format = 1
created-with = "0.1.0"

[project]
# Stable across renames and moves.
id = "1806e1c4a5f30b80a4d1f39c77e2b510"
name = "Anvil"
created-unix-ms = 1755300000000`,
    },
    {
      kind: "text",
      body: 'The `id` is the point of the file. It is a creation timestamp followed by a hash of that time and the path — not a UUID, because a dependency for one value is a poor trade — and it is stable across renames and moves. It is what HELVE means when it says "this project", since the path is not: you will move the folder eventually.',
    },
    {
      kind: "note",
      body: "The manifest takes the folder's name plus an extension, the way `.uproject` and `.sln` do, because the manifest and the generated directory cannot share one name and both want to be called after the project.",
    },

    { kind: "heading", body: "Recents" },
    {
      kind: "text",
      body: "The project you have open, and the last twenty before it, are remembered in `projects.json` in the OS config directory. It is the only orchestrator state that survives the process — everything else is worked out again at boot.",
    },
    {
      kind: "text",
      body: "A recent whose folder has since been deleted stays in the list, marked **missing**, and cannot be opened. The `×` beside it removes it from the list; nothing on disk is touched.",
    },
    {
      kind: "text",
      body: "Opening a project does four things at once: it sets where the File Explorer starts, where a new terminal opens, the OS window title, and what the next launch restores.",
    },

    { kind: "heading", body: "A project belongs to a cluster" },
    {
      kind: "text",
      body: "Not to the application. Two clusters can have two different projects open at the same time, and each one's File Explorer, terminals and search answer about its own. See **Panes, tabs and clusters**.",
    },
    {
      kind: "soon",
      body: "**Clone Project** is drawn but does nothing, and says **soon** on the button. Cloning is a git operation with progress, authentication and partial-checkout failure, and it is being built on the branch that work lives on. Clone the repository yourself and use **Open Project**.",
    },
  ],
};
