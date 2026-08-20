# The stack, end to end

*The stack · 6 min*

What Engine, Forger, Journeyman and the rest are each for.

---

HELVE is not one program: a **stack** of seven repositories. The
orchestrator — the thing you are reading this in — is the one that ties them
together at runtime, and it holds none of their code.

Their health is reported in the **switcher bar**, behind a warning triangle
carrying a count. Clicking it lists the tools that are not well — and only
those. A tool that is where it should be says nothing at all.

> So a stack with nothing wrong raises no badge. An empty result here is the
> healthy answer, not a screen that failed to load.

The list lives in `helve.toml` at the root of the orchestrator's checkout.
Each entry pins an exact version, so a given checkout of the orchestrator
always describes one reproducible stack rather than whatever each
repository's branch tip happens to be today.

## The one that ships

**Engine** is the runtime core — lighting, audio playback, spatial audio
built in. Only it ships inside a finished game, and only it has no frontend: a
runtime the other tools talk to, not a window you open.

## The six that don't

Everything else is authoring-time only. None of it ships with a game.

| Tool       | What                                                                |
| ------------ | ---------------------------------------------------------------------- |
| Forger     | Technical design — specs out the stack and its boundaries.             |
| Journeyman | Game design — design prototyping and rough playable systems.           |
| Turner     | Procedural art — generates art from an artist's rough shape.           |
| Scrivener  | Narrative and dialogue authoring.                                      |
| Quickener  | NPC behaviour and AI tooling.                                          |
| Wright     | Audio authoring and composition.                                       |

> That table is a list of names, not of keys — it borrows the layout because
> two columns is what a glossary wants.

## Why the badge says things are missing

Reads `helve.toml` → looks for each tool's checkout → resolves one of four states

Discovery resolves each checkout to one of four states, and the interface
never shows the raw word for any of them. A checkout that matches the pin
says nothing — that is the silent, healthy case. One that disagrees shows
**needs update**. One with no version marker to read shows **not tracked**.
One with nothing at the checkout path shows **not installed**.

<!-- SCREENSHOT: the stack health list with all three unwell states shown at once, 480x400 -->

_All three unwell states at once, with the count the badge carries. A healthy
tool has no row here at all, and the Engine never gets one — it is a runtime,
not one of the six._

**Missing** and **broken** read differently once you know the words.
`not installed` means nothing is at the checkout path; `needs update` means
the checkout disagrees with the pin. `not tracked` means it is there, but
carries no version to check at all.

On a fresh machine the badge shows all six at **not installed**, and that is
the correct answer rather than a fault. The orchestrator is usable on its
own — Home, the File Explorer, the File Viewer, terminals and search are all
in the binary and need no checkout at all.

> **Not yet:** None of the six is docked in the switcher yet. A tool's core
> is a child process, and the broker that would reach it is not written. So a
> tool tab today could only open on a screen explaining why it is empty. They
> arrive when the broker does.

`checkout-root` in `helve.toml` says where they are looked for, and defaults
to `..` — every Helve repository sitting as a sibling of the orchestrator's
own folder. Cloning the pinned version there is what clears a tool from the
badge; cloning the wrong one only changes which word it shows.

## Apps and tools are different things

Worth knowing, because they look identical once they are on screen — both are
a tab in the switcher and a pane in the window.

A **tool** is code the orchestrator finds: its own repository, its own
release cadence, its frontend served from its own checkout and its core
running as a separate process. It can be missing, unbuilt, or the wrong
version — which is the whole reason a tool has states at all.

An **app** is code the orchestrator _is_. Home, the File Explorer, the File
Viewer and the Tutorials app are apps: they are compiled into the binary.
That leaves no version to disagree with and no way for one to be missing —
which is why none of them can ever raise the badge.

---

**Takeaway:** You can find the stack's health in the switcher bar and tell a
missing tool from a broken one.
