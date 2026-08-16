# Open source plan

Helve, Forger, and Journeyman go public. The game-specific tools stay private and
load into the same shell through the same tool protocol.

This is the **open core** model, and it is the standard answer to "I want an open
product with closed parts." VS Code is the exact precedent: an MIT-licensed core,
proprietary first-party extensions, and one public extension API that both use.
There is no fork and no second codebase. The only thing that distinguishes a
private tool from a public one is which repository it is cloned from.

The architecture for this already exists. `helve.toml` lists every component as
its own repo at a pinned version, `crates/helve-tool-manifest` parses what a tool
declares, and `crates/helve-rpc` is how the shell talks to it. That seam *is* the
license boundary. What is missing is everything around it: a license, enforced
standards, CI, and documentation aimed at someone who does not already know how
this works.

---

## The rule that keeps this from becoming a fork

**The tool protocol is the license boundary. Nothing crosses it.**

The moment a private tool reaches into orchestrator internals instead of going
through `docs/tool-protocol.md`, the public repo becomes a thing that has to be
shaped around private needs in ways no outside contributor can explain, and every
core refactor breaks closed code that nobody else can see.

When a private tool needs something from core:

1. Generalize it so any tool could want it, and land it in the public repo.
2. If it cannot be generalized, it belongs in the tool, not in core.

There is no third option. "Just this once, reach into core" is how open core
projects rot.

The same rule in the other direction: **develop in the public repo, consume it
privately.** Never build internally and periodically dump to open source. That
path produces sanitization work on every release, unreviewable mega-commits, an
eventual leaked secret, and a community that cannot follow the work.

---

## Sequencing

The order matters more than the contents. Standards and CI have to land *before*
the repo is public, because retrofitting a linter onto a codebase that has taken
outside PRs means rewriting other people's contributions. Legal and docs can land
last, because they are cheap once the code has stopped moving.

Do not do any of this until the orchestrator is feature complete. Phase 0 is
finishing what is already in flight.

| Phase | What | Blocking public? | Rough cost |
|---|---|---|---|
| 0 | Finish the core orchestrator | — | in flight |
| 1 | Write the standards down | yes | half a day |
| 2 | Enforce them with off-the-shelf tools | yes | 1 day |
| 3 | GitHub infra: CI, PR templates, branch protection | yes | half a day |
| 4 | Licensing and repo janitor work | yes | half a day |
| 5 | Documentation pass | partly | 2 days |
| 6 | Architecture linter and MCP | no | weeks |

Phases 1 through 4 are about a week of evenings. Phase 5 overlaps. Phase 6 is a
project in its own right and must not block the others.

---

## Phase 1 — Write the standards down

Before any tooling. A linter that enforces rules nobody wrote down is a linter
whose failures look arbitrary, and the first thing an outside contributor does
with an arbitrary rule is open an issue arguing about it.

Produce `STANDARDS.md`. It covers, in order of how often it will be cited:

1. **Module boundaries** — what may import what. Rust owns anything touching the
   machine; the frontend reaches Rust only through `src/bindings.ts`. Write down
   the layering that is already true, then the parts that are aspirational.
2. **The tool protocol contract** — what a tool may assume about the host, and
   what the host guarantees. This is the document outside contributors will read
   most and the one that must not change casually.
3. **Naming and file layout** — where a new app goes, where a new crate goes,
   what the `apps/*/ui` and `crates/*` conventions actually require.
4. **Comment density and voice** — this codebase explains *why* in prose above
   the code, and that is unusual enough that it needs to be stated or new
   contributions will not match.
5. **Error handling** — `thiserror` is already a workspace dependency. Say when a
   crate defines its own error type versus propagating.

Write it as prose with examples from the existing code, not as a bullet list of
prohibitions.

---

## Phase 2 — Enforce with tools that already exist

**Do not build a custom code linter.** ESLint, Prettier, `rustfmt`, and `clippy`
are better than anything worth writing here, and time spent reimplementing them
is time not spent on the thing that actually needs to exist (phase 6).

Land, in this order:

1. **`rustfmt` + `clippy`** with a `clippy.toml` and `-D warnings` in CI. Cheapest
   win, and Rust is where the correctness risk lives.
2. **ESLint (flat config) + Prettier** for `src/`, `apps/`, `packages/`. Expect
   real violations — `tsc --strict` catches types, not structure.
3. **Import boundary rules** via `eslint-plugin-boundaries` or
   `dependency-cruiser`. This is the machine-checkable half of phase 1 item 1,
   and it is the closest off-the-shelf thing to what Forger will eventually do.
4. **Test coverage where there is none.** The runners exist and are already
   wired: `packages/bridge/vitest.config.ts`, plus `cargo test` covering
   `crates/helve-tool-manifest/tests/` and `examples/echo-tool/tests/`. The
   protocol layer is genuinely tested. What has nothing is `src-tauri/src/`
   (2100 lines in `shell_state.rs` alone) and every component under `src/`.
   Extend vitest to the shell, and add `#[cfg(test)]` coverage to the state
   machines before they grow further.
5. **`cargo-deny`** for license and advisory checking on the dependency tree.
   Required once the repo is public and someone asks what is vendored in.

Budget a full day for fixing what these turn up, separate from the day spent
configuring them. A 264-file codebase written without a linter will not be clean.

---

## Phase 3 — GitHub infrastructure

Worth doing for its own sake even if the repo never goes public. Solo work
benefits from a gate that catches the thing you were about to push at 2am.

1. **CI workflow** — `pnpm build` (which runs `tsc`) and
   `cargo check --manifest-path src-tauri/Cargo.toml` are already the two agreed
   checks in `CLAUDE.md`. Add `clippy`, `fmt --check`, `eslint`, and tests.
   Windows runner, because Tauri on Windows is the target and it is where the
   MSVC linker problems appear.
2. **Cache aggressively** — `Swatinem/rust-cache` and pnpm store caching. Without
   them a Tauri build on a cold runner is slow enough that you will stop waiting
   for CI, which defeats the point.
3. **Branch protection on `main`** — require CI green, require a PR. Even solo.
4. **PR and issue templates** — a PR template that asks "which phase of the tool
   protocol does this touch" is worth more than a generic checklist.
5. **`CODEOWNERS`** — trivial now, load-bearing later.

Deliberately skipped: release automation, changesets, semantic-release. Add them
when there is something to release on a cadence.

---

## Phase 4 — Licensing and janitor work

1. **Pick the license: Apache-2.0.** Not MIT — Apache carries an explicit patent
   grant, which matters once a commercial game engine loads into the same shell.
   Not GPL or AGPL under any circumstances: a copyleft core gives someone a real
   argument that the private tools loading into it are derivative works.
   - Change `license = "UNLICENSED"` in `Cargo.toml` to `"Apache-2.0"`.
   - Add `LICENSE` and `NOTICE` at the repo root.
2. **Trademark the name separately from the code.** Apache the source, keep
   "Helve," "Forger," and "Journeyman" as marks. Rust, Docker, and Mozilla all do
   exactly this. It is the only lever left once the code is freely copyable.
3. **Start the public repo with a fresh history.** Squash to a single initial
   commit rather than filtering this one. `docs/handoffs/` contains a brand packet,
   logo ideation, and design HTML that may not be yours to publish, and scrubbing
   history correctly is harder than it looks. A clean first commit costs nothing
   and removes the entire class of problem.
4. **Neutralize the game-specific copy.** `README.md` currently says "it does not
   ship with games built on Helve," and `helve.toml` describes tools in game
   terms. Make the core vocabulary domain-neutral and let each installed tool
   supply its own language.
   - **Do not** add a build-time text swap between "software" and "game." That is
     a fork with extra steps, and small forks grow.
5. **Say in the README that some first-party tools are commercial.** Up front.
   People forgive this. They do not forgive finding out on their third weekend.

---

## Phase 5 — Documentation

`docs/` today is three files plus a handoffs folder, and it is written for
someone who already has the context. Public docs are written for someone who does
not.

1. **`docs/tool-protocol.md` becomes the flagship.** It is the API that the whole
   open core model rests on. It needs a worked example end to end, versioning
   rules, and a statement of what is stable versus what may still move.
2. **A "build your first tool" guide** using `examples/echo-tool`. If someone
   cannot get a tool mounting in the shell in twenty minutes, there is no
   ecosystem.
3. **An architecture overview** — the Rust/webview split, why `helve.toml` exists,
   how a tool is discovered and launched.
4. **`CONTRIBUTING.md`** stating what will and will not be accepted, and pointing
   at `STANDARDS.md`. Be blunt about the private-tools situation here too.
5. **`CODE_OF_CONDUCT.md`** — Contributor Covenant, ten minutes, done.

`docs/handoffs/` should not go public as-is. It is working material and reads
like it.

---

## Phase 6 — The architecture linter and the MCP

This is the interesting one and it must not block anything above it.

**The insight worth keeping:** Forger is described as "technical design software —
specs out the stack and its boundaries." An architecture linter that checks real
code against declared boundaries is *the same engine* as a design tool that lets
you declare those boundaries by dragging them around. One is the checker, the
other is the authoring surface. Building the checker first is the right order,
because it forces the boundary model to be precise enough to evaluate before it
has to be pretty enough to render.

So the sequence is:

1. **Define the boundary model** — what a rule can say. "Layer A may not import
   layer B." "Crate X is the only thing allowed to touch the filesystem." "Every
   tool RPC method must be declared in the manifest." Start with the rules this
   repo actually needs.
2. **Build the checker** as a standalone binary that reads a rule file and a
   source tree and reports violations. Rust, in `crates/`, so it is shared the
   same way `helve-rpc` is.
3. **Wire it into CI** as a normal check, next to clippy.
4. **Then the MCP** — wrap the checker so an agent can ask "does this change
   violate a boundary" before writing the code rather than after CI rejects it.
   The MCP is a thin shell over the checker; it is not where the value lives, and
   building it first would mean building an MCP with nothing behind it.
5. **Then Forger's editor** consumes the same rule model as its document format.

**The trap to avoid:** starting at step 4. An MCP that enforces standards you
have not written yet, using a checker that does not exist, is a weekend that
produces a demo and no enforcement. Steps 1 through 3 are the useful part and
they are also the part that makes Forger tractable later.

---

## Decisions still open

1. **How do private tools authenticate?** `helve.toml` points at GitHub repo URLs.
   Public tools clone anonymously; private ones need tokens, SSH, or a GitHub
   App. The credential path should be designed into the tool-source abstraction
   now, because retrofitting auth through a resolver is painful.
2. **Clone or signed artifact?** Cloning a repo into a desktop shell is arbitrary
   code execution. Signed release artifacts with checksums are safer, remove the
   git dependency on the user's machine, and give a version pin that actually
   means something.
3. **What is a tool allowed to do?** Tauri has a capability system. Decide what
   permissions a mounted tool gets and whether installing one should prompt.
4. **Do Forger and Journeyman live in the Helve repo or their own?** `helve.toml`
   already says their own. That is probably right, but it means three public
   repos to keep green, not one.

---

## The one real risk

If every impressive tool is private, the public surface is a shell and two
builders, and outsiders see a demo rather than a product. VS Code survives this
because the open core is completely useful standing alone.

**Forger and Journeyman have to be a complete product with zero private tools
installed.** If they are, contributors show up. If they read as a teaser for
something behind a login, the repo collects stars and no pull requests.
