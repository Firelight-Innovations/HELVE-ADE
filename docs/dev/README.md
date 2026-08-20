# Developing HELVE

This section is for someone working on the orchestrator's code, not someone
running the app. If you want to use HELVE instead, see
[the user docs](../user/README.md).

The prose these pages are built from already lives in this repository, close
to the code it describes. Rather than duplicate it — and have two copies
drift apart — this page is a map to where it actually is.

## Making a change

Start with [CONTRIBUTING.md](../../CONTRIBUTING.md) at the repository root.
It covers, in order: getting a build, why `pnpm verify` is a gate rather than
a suggestion (and what `pnpm verify:fast` is and is not for), the two rules
most reviews turn on, commit message style, and what a pull request will not
be accepted for. Read it before your first change — it is written for someone
who has never seen the repo.

## How the project works, technically

- **[STANDARDS.md](../../STANDARDS.md)** — the rule book. Layering (what may
  import what), the two files that exist purely as chokepoints, the
  app/tool distinction, comment conventions, Rust and TypeScript style, test
  expectations, and exactly what is mechanically enforced versus what is
  still a convention.
- **[The tool protocol](../tool-protocol.md)** — the wire contract between
  the orchestrator and a tool: the exact bytes, the exact field names, and
  the reasoning behind each rule that has one. This is the API every tool
  repository is built against.
- **[Design notes](../design-notes/)** — longer rationale that would have
  overrun a module's comment budget: why a mechanism is shaped the way it
  is, and what was considered and rejected. One page per area, e.g.
  `shell-state.md`, `backend-project.md`, `files-app.md`.
- **[Settings](../settings.md)** — what a setting costs to add, and the rule
  that a row writing a value nothing reads is worse than no row at all.
- **[The Files app's methods](../files-app-methods.md)** — the RPC surface a
  frontend, or an agent, uses to browse, edit and delete files.
- **[The MCP server manager](../mcp-server-manager.md)** — how HELVE hosts
  MCP servers for a coding agent, and the rule that decides what earns one.
- **[Tutorials](../tutorials.md)** — how the in-app Tutorials feature itself
  is built, if you're adding or editing one. (Not to be confused with the
  tutorial *content* in [the user docs](../user/tutorials/README.md).)
- **[Branding](../branding.md)** — which names are branding (configurable)
  and which are wire formats (frozen), and the two scripts that enforce the
  distinction.

## Releases and updates

**[Releases and updates](releases.md)** says plainly what exists today (a
manual `pnpm app:build`) and what does not (CI-driven builds, signing, an
updater).

## Where this is all going

**[`TODO.md`](../../TODO.md)** is the roadmap, and it is the only forward-looking
document that is kept current. It says what has landed, what is being built now,
and what is deliberately still ahead — including which pieces the maintainer is
building directly rather than farming out.
