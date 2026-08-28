# The stack, end to end

*The stack · 6 min*

What Forger and Journeyman are each for.

---

OpenKaava is not one program: an orchestrator plus a small stack of separate
authoring tools that mount into it. The orchestrator — the thing you are
reading this in — is the one that ties them together at runtime, and it
holds none of their code.

Their health is reported in the **switcher bar**, behind a warning triangle
carrying a count. Clicking it lists the tools that are not well — and only
those. A tool that is where it should be says nothing at all.

> So a stack with nothing wrong raises no badge. An empty result here is the
> healthy answer, not a screen that failed to load.

The list lives in `kaava.toml` at the root of the orchestrator's checkout.
Each entry pins an exact version, so a given checkout of the orchestrator
always describes one reproducible stack rather than whatever each
repository's branch tip happens to be today.

## The two tools

| Tool       | What                                                                |
| ------------ | ---------------------------------------------------------------------- |
| Forger     | Technical design — specs out the stack and its boundaries.             |
| Journeyman | Product design — design prototyping and rough, interactive systems.    |

## Why the badge says things are missing

Reads `kaava.toml` → looks for each tool's checkout → resolves one of four states

Discovery resolves each checkout to one of four states, and the interface
never shows the raw word for any of them. A checkout that matches the pin
says nothing — that is the silent, healthy case. One that disagrees shows
**needs update**. One with no version marker to read shows **not tracked**.
One with nothing at the checkout path shows **not installed**.

<!-- SCREENSHOT: the stack health list with all three unwell states shown at once, 480x400 -->

_All three unwell states at once, with the count the badge carries. A healthy
tool has no row here at all._

**Missing** and **broken** read differently once you know the words.
`not installed` means nothing is at the checkout path; `needs update` means
the checkout disagrees with the pin. `not tracked` means it is there, but
carries no version to check at all.

On a fresh machine the badge shows both tools at **not installed**, and that
is the correct answer rather than a fault. The orchestrator is usable on its
own — Home, the File Explorer, the File Viewer, terminals and search are all
in the binary and need no checkout at all.

> **Not yet:** Neither tool is docked in the switcher yet. A tool's core is
> a child process, and the broker that would reach it is not written. So a
> tool tab today could only open on a screen explaining why it is empty. They
> arrive when the broker does.

`checkout-root` in `kaava.toml` says where they are looked for, and defaults
to `..` — every OpenKaava repository sitting as a sibling of the orchestrator's
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
