# HELVE Roadmap

Rough execution order as of 2026-08-15. Items are mostly sequential; a couple
are explicitly parallel or vague-on-purpose (noted inline).

## 1. Clustering & app system (in progress, almost done)
- Current work on `feat/multi-instance-layout`.

## 2. Lint/lending rules (kicks off once #1 lands)
- Add linting rules, enforced on all **new** code.
- Grandfather in existing code — ignore violations there for now.
- Grandfather clause gets lifted during the codebase cleanup pass (#7), at
  which point the rules apply to everything.

## 3. Search feature + Git sidebar / Git integration (parallel, same branch)
- Two features worked side by side on one branch.

## 4. MCP server manager
- Lets apps register MCP servers.
- Settings-menu UI for users to manage those registered MCP servers.

## 5. Full settings & preferences menu

## 6. Tutorials & documentation
- This is the point where prepping for open source begins.

## 7. Bug-fix pass
- Once docs + settings are done, sweep and fix small outstanding issues.

## 8. Codebase cleanup & standards
- Clean up the codebase.
- Establish the coding standards contributors will be held to.
- Lint grandfather clause from #2 is removed here — rules now apply to all code.

## 9. Contributor readiness
- Make the repo presentable to potential contributors.
- Write contribution guidelines — clear on what is/isn't allowed.
- Build out GitHub tasks/issues and general repo documentation.
- Write the README.md — approachable, clear, well-presented.
- → HELVE is ready to open source.

## 10. App download system
- Download full apps from GitHub repos and let the orchestrator execute/run them.
- Each app needs a defined manifest format for this.
- File-structure restructuring happens alongside this work.

## 11. Forger (vague for now)
- Scope intentionally undefined until reached — flesh out in-depth at that point.

## 12. Journeyman
- Tackled after Forger is working.

---
*Big-picture goal: get HELVE into the best agentic development environment
(ADE) shape possible, done properly, efficiently, and ready for open source.*
