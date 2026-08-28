import type { Body } from "./blocks";

/**
 * What the stack's repositories are for.
 *
 * The one tutorial with almost nothing to click. It is here because every other
 * page says "the stack" as though the reader already knows, and because a fresh
 * machine raises a warning badge over tools that are not installed — which
 * reads as breakage until you know none of them are meant to be there yet.
 */
export const theStack: Body = {
  takeaway:
    "You can find the stack's health in the switcher bar and tell a missing tool from a broken one.",
  blocks: [
    {
      kind: "text",
      body: "OpenKaava is not one program: a **stack** of separate repositories. The orchestrator — the thing you are reading this in — is the one that ties them together when it runs, and it holds none of their code.",
    },
    {
      kind: "text",
      body: "Their health is reported in the **switcher bar**, behind a warning triangle carrying a count. Clicking it lists the tools that are not well — and only those. A tool that is where it should be says nothing at all.",
    },
    {
      kind: "note",
      body: "So a stack with nothing wrong raises no badge. An empty result here is the healthy answer, not a screen that failed to load.",
    },
    {
      kind: "text",
      body: "The list lives in `kaava.toml` at the root of the orchestrator's checkout. Each entry pins an exact version, so a given checkout of the orchestrator always describes one reproducible stack rather than whatever each repository's branch tip happens to be today.",
    },

    { kind: "heading", body: "The tools" },
    {
      kind: "text",
      body: "Every component is an authoring tool — a window you open while you work, never something that ships in whatever you build with it.",
    },
    {
      kind: "keys",
      rows: [
        { chord: "Forger", what: "Technical design — specs out the stack and its boundaries." },
        {
          chord: "Journeyman",
          what: "Design prototyping and rough playable systems.",
        },
      ],
    },
    {
      kind: "note",
      body: "That table is a list of names, not of keys — it borrows the layout because two columns is what a glossary wants.",
    },

    { kind: "heading", body: "Why the badge says things are missing" },
    {
      kind: "flow",
      steps: [
        "Reads `kaava.toml`",
        "looks for each tool's checkout",
        "resolves one of four states",
      ],
    },
    {
      kind: "text",
      body: "Discovery resolves each checkout to one of four states, and the interface never shows the raw word for any of them. A checkout that matches the pin says nothing — that is the silent, healthy case. One that disagrees shows **needs update**. One with no version marker to read shows **not tracked**. One with nothing at the checkout path shows **not installed**.",
    },
    {
      kind: "mock",
      view: "stack-list",
      caption:
        "Two unwell tools and the count the badge carries. A healthy tool has no row here at all, which is why an empty list is the good outcome rather than a broken one.",
    },
    {
      kind: "text",
      body: "**Missing** and **broken** read differently once you know the words. `not installed` means nothing is at the checkout path; `needs update` means the checkout disagrees with the pin. `not tracked` means it is there, but carries no version to check at all.",
    },
    {
      kind: "text",
      body: "On a fresh machine the badge shows all six at **not installed**, and that is the correct answer rather than a fault. The orchestrator is usable on its own — Home, the File Explorer, the File Viewer, terminals and search are all in the binary and need no checkout at all.",
    },
    {
      kind: "soon",
      body: "Neither tool is docked in the switcher yet. A tool's core is a child process, and the broker that would reach it is not written. So a tool tab today could only open on a screen explaining why it is empty. They arrive when the broker does.",
    },
    {
      kind: "text",
      body: "`checkout-root` in `kaava.toml` says where they are looked for, and defaults to `..` — every OpenKaava repository sitting as a sibling of the orchestrator's own folder. Cloning the pinned version there is what clears a tool from the badge; cloning the wrong one only changes which word it shows.",
    },

    { kind: "heading", body: "Apps and tools are different things" },
    {
      kind: "text",
      body: "Worth knowing, because they look identical once they are on screen — both are a tab in the switcher and a pane in the window.",
    },
    {
      kind: "text",
      body: "A **tool** is code the orchestrator finds: its own repository, its own release cadence, its frontend served from its own checkout and its core running as a separate process. It can be missing, unbuilt, or the wrong version — which is the whole reason a tool has states at all.",
    },
    {
      kind: "text",
      body: "An **app** is code the orchestrator *is*. Home, the File Explorer, the File Viewer and this Tutorials pane are apps: they are compiled into the binary. That leaves no version to disagree with and no way for one to be missing — which is why none of them can ever raise the badge.",
    },
  ],
};
