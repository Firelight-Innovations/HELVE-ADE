# HELVE Roadmap

Rough execution order. Items are mostly sequential; a couple are explicitly
parallel or vague-on-purpose (noted inline). Updated 2026-08-18.

## Done

Kept rather than deleted, because the order things landed in is the argument
for the order the rest should land in.

| # | What | Landed as |
|---|---|---|
| 1 | Clustering & app system — panes, clusters, many instances of one app | #7, #8 |
| 2 | Lint rules, enforced on new code with the old grandfathered | #10 |
| 3 | Search feature + Git sidebar, worked in parallel on one branch | #9 |
| 4 | MCP server manager, and the settings UI to manage what registers | #11 |
| 5 | Full settings & preferences menu, generated from a schema | #11 |
| 6 | Tutorials & documentation | #12, #13 |
| 8 | Codebase cleanup & standards — grandfather clause lifted | #12 |

The lint grandfather clause from #2 is gone: all three baselines are empty, so
a violation today is a violation rather than a number to compare against.

## 7. Bug-fix pass

The one item out of order, and deliberately so — it now runs *alongside* #9
rather than before it. Sweep and fix small outstanding issues, but **file the
small ones as GitHub issues instead of fixing them**. A public repository with
an empty tracker gets stars and no pull requests, and this pass is the only
source of `good-first-issue` material that will exist on day one.

An issue that gets a first pull request names the file, describes the wrong
behaviour and the right one, and says which check proves it. Eight to twelve is
enough to seed a tracker.

## 9. Contributor readiness (in progress)

`docs/contributor-readiness-plan.md` is the execution plan;
`docs/open-source-plan.md` is the strategy behind it.

Landing now: Apache-2.0 with the marks held back, CI running `pnpm verify` on
every pull request, a dependency audit, `CONTRIBUTING.md` and a code of conduct,
a frontend test harness, a tool-protocol stability statement, and the branding
system that makes the trademark line something a fork can act on.

Still open, and each one is a decision rather than a task:

- Whether the public repository starts from a fresh squashed history.
  `docs/handoffs/` holds a brand packet and logo ideation that may not be ours
  to publish, and removing files in a commit does not remove them from history.
- Branch protection settings, which cannot be set from a file —
  `docs/handoffs/readiness/wp-b.md` has the checklist.
- What to do about the six placeholder stack repositories. They are a `v0.1.0`
  tag against a README, and the README now says so.

→ HELVE is ready to open source once those are answered.

## 10. App download system

Download full apps from GitHub repos and let the orchestrator execute them.
Each app needs a defined manifest format. File-structure restructuring happens
alongside this work.

**Two of its questions were pulled forward into #9** and are answered on paper
in `docs/tool-protocol.md` rather than left until the downloader is built:
whether a tool arrives as a clone or as a signed artifact, and what a mounted
tool is permitted to do under Tauri's capability system. Cloning a repository
into a desktop shell and running it is arbitrary code execution, and that is a
decision to make before the repository is public rather than after.

The rest waits. The one caveat runs the other way: the first thing an early
contributor does is write a tool against the manifest format, so if that format
is expected to move here, `docs/tool-protocol.md` has to keep saying plainly
what is stable and what is not.

## 11. Forger (vague for now)

Scope intentionally undefined until reached — flesh out in-depth at that point.
`docs/open-source-plan.md` phase 6 has the one idea worth keeping: the
architecture linter and Forger's editor are the same boundary model, one
checking it and one authoring it, and building the checker first is what forces
the model to be precise before it has to be pretty.

## 12. Journeyman

Tackled after Forger is working.

---

*Big-picture goal: get HELVE into the best agentic development environment
(ADE) shape possible, done properly, efficiently, and ready for open source.*
