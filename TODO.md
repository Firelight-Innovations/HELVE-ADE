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

## 9. Contributor readiness (done)

The repository is public, as `Firelight-Innovations/HELVE-ADE`. Landed:
Apache-2.0 with the marks held back, CI running `pnpm verify` on every pull
request and annotating each failure on the line that caused it, a dependency
audit, `CONTRIBUTING.md` and a code of conduct, a frontend test harness, a
tool-protocol stability statement, and the branding system that makes the
trademark line something a fork can act on.

`main` is protected: `verify` and `deny` are required, approvals are zero
because requiring one with a single maintainer would mean nothing can ever
merge, and admins are exempt so a hotfix is still possible. Tighten the last of
those when there is a second maintainer.

`docs/handoffs/` has been removed. It was working material — a brand packet, a
shell spec, agent coordination notes — and none of it was written to be read
from outside the project. It is gone from HEAD only; removing a file in a commit
does not remove it from history, so a fresh squashed history is still the only
way to make it unreachable, and that remains an open call.

Still open:

- Whether the public repository starts from a fresh squashed history.
- What to do about the placeholder stack repositories. They are a `v0.1.0` tag
  against a README, and the README now says so.
- The issue backlog from #7, which is what a first-time contributor actually
  needs and does not exist yet.

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

**Built by the maintainer, like #10 and #12.** Not because outside help is
unwelcome — so that nobody spends a weekend on a foundation that is already
half-written. Once each of the three exists, features and quality-of-life work
on top of it is where an outside change lands best, and a roadmap and a set of
starter issues are coming to say where. This is stated in `CONTRIBUTING.md` and
in the "What should we build next?" discussion, and the three places should
keep agreeing.

Scope intentionally undefined until reached — flesh out in-depth at that point.
One idea is worth carrying: the architecture linter and Forger's editor are the
same boundary model, one checking it and one authoring it, and building the
checker first is what forces the model to be precise before it has to be
pretty.

## 12. Journeyman

Tackled after Forger is working.

---

*Big-picture goal: get HELVE into the best agentic development environment
(ADE) shape possible, done properly, efficiently, and ready for open source.*
