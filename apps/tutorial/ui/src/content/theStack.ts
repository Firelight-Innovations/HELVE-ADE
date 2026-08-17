import type { Body } from "./blocks";

/**
 * What the seven repositories are for.
 *
 * The one tutorial with almost nothing to click. It is here because every other
 * page says "the stack" as though the reader already knows, and because the
 * status bar reports six tools that are not installed — which reads as breakage
 * until you know none of them are meant to be there yet.
 */
export const theStack: Body = {
  takeaway:
    "You can read the stack list in the status bar and tell a missing tool from a broken one.",
  blocks: [
    {
      kind: "text",
      body: "HELVE is not one program. It is a **stack** of seven repositories, and the thing you are reading this in — the orchestrator — is the one that ties them together at runtime. It holds none of their code.",
    },
    {
      kind: "text",
      body: "The list lives in `helve.toml` at the root of the orchestrator's checkout. Each entry pins an exact version, so a given checkout of the orchestrator always describes one reproducible stack rather than whatever each repository's branch tip happens to be today.",
    },

    { kind: "heading", body: "The one that ships" },
    {
      kind: "text",
      body: "**Engine** is the runtime core — lighting, audio playback, spatial audio built in. It is the only piece that ends up inside a finished game, and the only one with no frontend: it is a runtime the other tools talk to, not a window you open.",
    },

    { kind: "heading", body: "The six that don't" },
    {
      kind: "text",
      body: "Everything else is authoring-time only. None of it is shipped with a game.",
    },
    {
      kind: "keys",
      rows: [
        { chord: "Forger", what: "Technical design — specs out the stack and its boundaries." },
        {
          chord: "Journeyman",
          what: "Game design — design prototyping and rough playable systems.",
        },
        { chord: "Turner", what: "Procedural art — generates art from an artist's rough shape." },
        { chord: "Scrivener", what: "Narrative and dialogue authoring." },
        { chord: "Quickener", what: "NPC behaviour and AI tooling." },
        { chord: "Wright", what: "Audio authoring and composition." },
      ],
    },
    {
      kind: "note",
      body: "That table is a list of names, not of keys — it borrows the layout because two columns is what a glossary wants.",
    },

    { kind: "heading", body: "Why the status bar says things are missing" },
    {
      kind: "text",
      body: "On launch the orchestrator reads `helve.toml`, looks for each component's checkout beside its own, and reports one of four states per tool: the version if it matches the pin, `≠` if the checkout is there but reports something else, `unversioned` if there is nothing to read a version from, and `not cloned` if nothing is at the expected path.",
    },
    {
      kind: "text",
      body: "On a fresh machine every one of them says **not cloned**, and that is the correct answer rather than a fault. The orchestrator is usable on its own — Home, the File Explorer, the File Viewer, terminals and search are all in the binary and need no checkout at all.",
    },
    {
      kind: "soon",
      body: "None of the six is docked in the switcher yet. A tool's core is a child process, and the broker that would reach it is not written — so a tool tab today could only open on a screen explaining why it is empty. They arrive when the broker does.",
    },
    {
      kind: "text",
      body: "`checkout-root` in `helve.toml` says where they are looked for, and defaults to `..` — every Helve repository sitting as a sibling of the orchestrator's own folder. Cloning one there is all it takes for the status bar to start reporting it.",
    },

    { kind: "heading", body: "Apps and tools are different things" },
    {
      kind: "text",
      body: "Worth knowing, because they look identical once they are on screen — both are a tab in the switcher and a pane in the window.",
    },
    {
      kind: "text",
      body: "A **tool** is code the orchestrator finds: its own repository, its own release cadence, its frontend served from its own checkout and its core running as a separate process. It can be missing, unbuilt, or the wrong version — which is the whole reason the status bar has states.",
    },
    {
      kind: "text",
      body: "An **app** is code the orchestrator *is*. Home, the File Explorer, the File Viewer and this Tutorials pane are apps: they are compiled into the binary, so there is no version to disagree with and no way for one to be missing. That is why none of them appears in the stack list.",
    },
  ],
};
