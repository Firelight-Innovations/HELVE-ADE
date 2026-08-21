# Using HELVE

This section is for someone who wants to *run* HELVE, not build it. If you
want to contribute code instead, see [the developer docs](../dev/README.md).

## What HELVE is

HELVE is an **ADE** — an Agentic Development Environment. It is one shell
that a stack of separate authoring tools mount into, the way VS Code is one
shell that extensions mount into. `README.md` at the repository root has the
full picture of the stack; the short version is that this repository — the
**orchestrator** — is the shell, and each tool (Forger for technical design,
Journeyman for product design) is its own project that plugs into it.

Today the orchestrator itself is what runs: the window, Home, the File
Explorer, the File Viewer, and Tutorials. The stack tools are placeholders —
see [The stack, end to end](tutorials/the-stack.md) for exactly what that
means and why the switcher bar shows them as "not installed" on a fresh
machine.

## Getting it running

[Download the installer](https://github.com/Firelight-Innovations/HELVE-ADE/releases/latest/download/HELVE-setup.exe)
and run it. It installs for your account only. It never asks for
administrator rights. Windows SmartScreen will warn about it, because it is
not signed. Click **More info**, then **Run anyway**.

HELVE runs on Windows only. To build it from source instead, the root
[README.md](../../README.md#build-from-source) has the prerequisites; the
short version is `pnpm install` then `pnpm app`.

## Learning your way around

[Tutorials](tutorials/README.md) is ten short pages, the same ones the
Tutorials app inside HELVE shows you. Start with **The HELVE window** if
you've never opened it before — it names the parts of the frame that every
other tutorial refers to without re-explaining.

## Found a problem, or want something that isn't here?

Open an issue on GitHub. `.github/ISSUE_TEMPLATE/bug_report.yml` and
`feature_request.yml` are there for exactly that.
