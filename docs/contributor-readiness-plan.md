# Contributor readiness — execution plan

> **Status, 2026-08-18: WP-A through WP-F and WP-H are done**, on the branch
> `chore/contributor-readiness`. WP-G, the issue backlog, is not — it depends on
> roadmap #7, the bug-fix pass, which has not run, and filing invented issues
> would be worse than filing none.
>
> What is left is decisions rather than work, and they are Braden's:
>
> 1. **Branch protection.** Cannot be set from a file. The checklist is in
>    `docs/handoffs/readiness/wp-b.md`, including why required approvals should
>    be 0 while there is one maintainer.
> 2. **Fresh squashed history, or keep it.** Still open, and it decides how
>    `docs/handoffs/` is removed — the brand packet and logo ideation are in the
>    history either way unless the history goes.
> 3. **The six placeholder stack repositories.** The README now says they are
>    README-only, which is honest; whether they should exist yet is a separate
>    question.
> 4. **`docs/handoffs/` itself**, including the `readiness/` working notes this
>    plan generated. Inventory and recommendation in
>    `docs/handoffs/readiness/wp-e.md`. None of it should ship.
>
> Two answers found along the way that were not in the plan: the dependency tree
> is clean of GPL-family licenses, and a tool's core is unsandboxed — see
> `docs/tool-protocol.md` §6.

`docs/open-source-plan.md` is the strategy: why open core, what the license
boundary is, what must not happen. This is the execution plan for the part of it
that is still missing, plus the branding system, decomposed into work packages
that several agents can run at once without touching each other's files.

It covers roadmap item #9 and the branding work. It does **not** cover the app
download system (#10) — see [Where the app system fits](#where-the-app-system-fits)
at the end for the two decisions in it that should be made before the repo is
public, and why the rest of it should wait.

---

## Where the repo actually stands

The readiness is lopsided, and the shape of the lopsidedness decides the plan.

The parts most projects never get to are done. STANDARDS.md is written *and*
enforced, with §10 mapping each rule to the linter that checks it and all three
baselines emptied to `{}`. `docs/design-notes/` holds the long-form rationale.
`docs/tool-protocol.md` is the API the open core model rests on and it exists.
Thirty Rust modules carry `#[cfg(test)]`. `pnpm verify` is one command and it is
treated as a gate rather than a suggestion.

The parts every project does in an afternoon are at zero. There is no `LICENSE`,
no `.github/` directory of any kind, and no `CONTRIBUTING.md`. `Cargo.toml` says
`license = "UNLICENSED"`.

So this is not a long project. It is a short one that has never been started,
and the ordering below is chosen so that six agents can start it simultaneously.

`TODO.md` is stale, by the way — it shows #1 in progress, but the history says
#2 through #6 and #8 have all landed. WP-H corrects it.

---

## Standing rules for every work package

These are not new. They are collected here because an agent starting from this
document may not have read the others, and each of them has already cost a day
at least once.

1. **Finish on a full `pnpm verify`.** `verify:fast` is the inner loop. The last
   run before the PR is the full one, because the bundle is the only check that
   catches an app missing from `vite.config.ts`, which fails *silently*.
2. **Never run `pnpm baseline`.** All three baselines are empty. From empty, a
   rewrite can only make things worse, and absorbing a new violation is the one
   thing the ratchet exists to prevent.
3. **Never run `pnpm app`, `pnpm dev`, or `tauri dev`.** Port 1420 is Braden's.
   Use `pnpm dev:agent` and read the port Vite prints.
4. **Edit source with the `Edit` tool, never with PowerShell.** Windows
   PowerShell 5.1 reads as ANSI and silently corrupts every em-dash in the
   comments. `cargo check` and `tsc` both pass on the corruption.
5. **Take a git worktree.** See below — this is the one addition.
6. **Claim your files** in `docs/handoffs/readiness-claims.md`, in the format
   `docs/handoffs/agent-claims.md` already uses. Delete your block when the work
   lands.
7. **Match the prose voice.** STANDARDS.md §4. New contributor-facing documents
   are written the way this codebase writes: prose that says why, with the
   rejected alternative named. A bullet list of prohibitions is not the house
   style, and CONTRIBUTING.md is the first document an outsider reads.
8. **Commit messages are imperative sentences** describing the change from the
   codebase's point of view — "Give the shell panes, clusters, and many
   instances of one app", not "feat: add panes". This is worth stating because
   WP-C has to write it down for contributors, and because every agent here will
   otherwise default to Conventional Commits.

### Each work package takes its own git worktree

Wave 1 is six packages running at once, and every one of them ends by running
`pnpm verify`. In a shared working tree that is a guaranteed collision:
`pnpm build` runs `generate:icons`, which wipes and rewrites 1115 files under
`public/icons/material/`, and two of those at once produce a phantom failure
that looks like a real bug and is not.

One worktree per package removes that, and removes file contention as a second
order effect. The claims file stays anyway, because the claims are what tell the
integrating agent which packages touched what.

---

## The file-ownership rule

Four files are wanted by almost every package: `README.md`, `STANDARDS.md`,
`TODO.md`, and `package.json`. Splitting them by section across six agents is
how merge conflicts get manufactured.

**No package below edits `README.md`, `STANDARDS.md`, or `TODO.md`.** Instead,
each writes the delta it needs into its own block of
`docs/handoffs/readiness-claims.md` — the exact sentence, the section it belongs
in, and why. WP-H owns all three files and applies every delta in one pass, in
one voice, at the end. `package.json` is owned by WP-D alone.

---

## Wave 1 — six packages, no dependencies between them

### WP-A · License and legal

**Branch:** `chore/license`
**Blocked by:** decision 1 and decision 6 below.

Apache-2.0, per `open-source-plan.md` phase 4: the explicit patent grant is the
reason, and it matters precisely because a commercial engine will load into this
shell. Not MIT, which has no such grant. Not GPL or AGPL under any
circumstances — a copyleft core hands someone a real argument that the private
tools mounting into it are derivative works.

- `LICENSE` — Apache-2.0, verbatim, unmodified.
- `NOTICE` — copyright line, and the trademark statement from decision 6. This
  is where "the source is Apache, the names are not" gets said.
- `Cargo.toml` — `license = "UNLICENSED"` becomes `"Apache-2.0"`. Check each
  workspace member inherits it rather than setting its own.
- `package.json` is `"private": true` and stays that way; the published npm
  packages under `packages/` need their own `license` field, and
  `@helve/bridge` is the one outside repos will actually install.
- `deny.toml` and `cargo-deny` — license and advisory checking over the
  dependency tree. Add it as a separate script (`pnpm lint:deps`), **not** into
  `pnpm lint`, because it needs a network fetch for the advisory database and
  `pnpm verify` must keep working on a plane. WP-B wires it into CI as its own
  job.

**Done when:** `cargo deny check` passes, or its failures are listed in the PR
with a recommendation for each. A GPL-family transitive dependency is a finding,
not a thing to quietly accept.

**Do not:** add license headers to every source file. Apache-2.0 does not
require them, this codebase's file headers are prose about the module, and 264
files of boilerplate would bury it.

---

### WP-B · CI and GitHub infrastructure

**Branch:** `chore/ci`
**Blocked by:** nothing.

This is the highest-leverage package in the plan. `pnpm verify` is a strong gate
that is currently 100% honor-system: a drive-by fixing a typo in `files.rs`
means Braden pulls the branch and runs four checks on a Windows box by hand.
That works at two PRs a week and collapses at ten.

- `.github/workflows/verify.yml` — **runs `pnpm verify` and nothing else.**
  That constraint is the point: if CI runs a different command than the one in
  CLAUDE.md, "passes locally, fails in CI" becomes a category of problem that
  exists. It should not exist.
- `windows-latest` runner. Tauri on Windows is the target and the MSVC linker
  is where the surprises are. A second Linux job may be added later *only* if
  decision 2 says Linux is supported.
- Caching is not optional. `Swatinem/rust-cache` plus the pnpm store. A cold
  Tauri dependency tree is minutes, and CI nobody waits for is CI nobody has.
- `concurrency` group keyed on the ref, cancel-in-progress. `permissions:
  contents: read`. Pin actions to a major version.
- A separate `cargo deny check` job once WP-A lands `deny.toml`. It is allowed
  to be a different command because it is a different question — supply chain,
  not correctness — and unlike `verify` it needs the network.
- `pnpm slop` stays out of the gate. STANDARDS.md §10 already explains why: it
  needs Python, `fd` and `rg` on PATH, and one of its rules is a percentile
  ranking that can never be empty by construction.
- `.github/PULL_REQUEST_TEMPLATE.md` — short. Which layer does this touch
  (§1), did `pnpm verify` pass, and for a bug fix, where is the test that would
  have caught it. `open-source-plan.md` phase 3.4 is right that a template
  asking a real question beats a generic checklist.
- `.github/ISSUE_TEMPLATE/` — bug, feature, and a config that points questions
  at Discussions rather than the tracker.
- `CODEOWNERS` — trivial now, load-bearing the first time someone touches
  `docs/tool-protocol.md`.
- `SECURITY.md` — where to report privately, and what the expected response
  window is. This matters more than usual here: the app download system will
  eventually execute downloaded code.
- Branch protection on `main` cannot be set from a file. Write the intended
  settings into the PR description as a checklist for Braden: require the
  `verify` check, require a PR, no force-push.

**Done when:** a deliberately broken PR (a `clippy::unwrap_used` violation is
the cheapest) goes red, and reverting it goes green.

---

### WP-C · Contributor documentation

**Branch:** `docs/contributing`
**Blocked by:** decision 2.

- `CONTRIBUTING.md`. Everything a small contributor needs and currently has to
  infer: the prerequisites, `pnpm install`, that `pnpm verify` is a gate rather
  than a suggestion and must be the full form before pushing, that STANDARDS.md
  is the rule book, that the comment voice in §4 is unusual and non-optional,
  that a bug fix arrives with its test (§8), and the commit message style.
  Also, bluntly: some first-party tools are commercial and always will be, and
  the tool protocol is the boundary — a PR that reaches around it is declined on
  principle rather than on quality. People forgive that when it is stated up
  front. `open-source-plan.md` phase 4.5 is right that they do not forgive
  finding out on the third weekend.
- **The platform statement**, and it goes near the top of `CONTRIBUTING.md` as
  well as into the README delta. Every prerequisite in this repo is Windows —
  winget, MSVC build tools, WebView2. Nothing currently tells a Linux
  contributor whether they can build at all. Whatever decision 2 says, say it in
  the first screenful. It saves them an evening and saves us the issue.
- `CODE_OF_CONDUCT.md` — Contributor Covenant, unmodified, with a real contact
  address. Ten minutes.
- The README delta goes to WP-H. Do not edit `README.md`.

**Done when:** someone who has never seen this repo can go from clone to a green
`pnpm verify` using only `CONTRIBUTING.md`, on the platforms decision 2 names.

---

### WP-D · A frontend test harness

**Branch:** `test/frontend-harness`
**Blocked by:** nothing. **Owns `package.json`.**

This is the one substantive engineering gap in the plan, and it is the one that
bites the exact contribution class we are trying to enable.

`test:js` filters `./packages/**` and `./examples/**`. The entire vitest suite is
`packages/bridge/src/client.test.ts`. `src/` and `apps/` have none — which is
where nearly every drive-by bug fix will land, because UI bugs are the ones
outsiders find. Meanwhile STANDARDS.md §8 calls "a bug fix arrives with the test
that would have caught it" the one non-negotiable test rule. A contributor
fixing a `Shell.tsx` bug cannot comply: there is no runner configured and no
convention for where the file goes.

- Root `vitest.config.ts` covering `src/**` and `apps/*/ui/src/**`.
- **Node environment, not jsdom, and no `@testing-library/react` for now.** The
  shell has a lot of genuinely pure logic — `src/shell/state/*`,
  `src/shell/search/kinds.ts`, `src/shell/titlebar/menus.ts`, the layout maths —
  and that is where the bugs with test-shaped answers live. Pulling in jsdom and
  a rendering library is a real dependency decision that should be made when a
  bug fix actually needs it, by the PR that needs it, rather than speculatively
  here. Say this in the config's header comment so the next person does not
  think it was an oversight.
- Extend `test:js` in `package.json` to include the root config. Keep
  `pnpm test` as the two halves it already is.
- Seed it with real tests, not smoke tests. Six to ten against the highest
  traffic pure modules, each one written the way it would be written if it were
  catching a regression.
- The STANDARDS.md §8 delta — where a frontend test file goes and what it is
  named — goes to WP-H. So does the corrected test count in the README, which
  currently says 28 vitest.

**Done when:** `pnpm test:js` runs tests under `src/`, and a deliberately
introduced logic bug in one of the covered modules fails it.

---

### WP-E · Documentation hygiene

**Branch:** `docs/hygiene`
**Blocked by:** decision 5.

Four things that are individually small and collectively decide whether the
first outside reader trusts the repo.

1. **Two dangling private references.** `README.md:311` and
   `docs/tool-protocol.md:8` both point at
   `company/docs/design/helve-tool-integration.md`, a path no outsider can open,
   sitting in the two most-read documents. Either bring the content across or
   drop the pointer. Do not leave a reference to a repository that does not
   exist for the reader. (The README half is a delta to WP-H; the
   `tool-protocol.md` half is yours.)
2. **A stability statement in `docs/tool-protocol.md`.** Phase 5.1 of the
   open-source plan asks for it and it is not there. What is stable, what may
   still move, and what the versioning rule is. This is load-bearing for the
   ordering question at the bottom of this document: the first thing an early
   contributor does is write a tool against this format, and a format that
   changes underneath them burns the first cohort.
3. **Audit the seven stack repo links** in the README table. If they are
   private or empty, the README opens with seven 404s. Depending on decision 5,
   either the links go or the table gains a column saying what exists today.
   (Delta to WP-H, but the audit is yours.)
4. **`docs/handoffs/` does not go public as-is.** It is tracked, and it holds
   `HELVE Brand Packet.html`, `HELVE logo ideation.zip`, two VS Code
   screenshots, and working material that reads like working material.
   Recommend the whole directory moves out of the repo before publication.
   Note that this interacts with decision 3 — if history is squashed, removing
   the files in a commit is enough; if it is not, the zip and the brand packet
   are in the history forever.

---

### WP-F · The branding system

**Branch:** `feat/branding`
**Blocked by:** decision 4 and decision 6. **Largest package; give it the most
capable agent.**

#### Why this is worth building, which is not the obvious reason

The obvious reason is "make it easy to change names and logos." The real reason
is that WP-A is about to Apache-license the source while keeping HELVE, Forger
and Journeyman as trademarks — the standard open-core split that Rust, Docker
and Mozilla all use. That position is unenforceable and, more importantly,
*unfollowable*, unless a fork can strip the marks in one place. Right now a fork
would have to find them by grep.

**The branding system is the mechanism that makes the trademark policy
workable.** It should be built so that the answer to "what must I change to ship
an unbranded build" is a file and a command, not a conversation.

The second reason is smaller but immediate: the product does not currently agree
with itself on its own name. `tauri.conf.json` says `Helve`, the title bar says
`HELVE Engine`, the splash wordmark says `HELVE`, `helve.toml` says `Helve`. One
source of truth forces that to be answered once — which is decision 4.

#### Three tiers, and only one of them is in scope

This distinction is the whole design, and getting it wrong breaks every tool
repo and every project already on disk.

**Tier 1 — presentation. In scope, and swappable.**
Window title and About box (`src/shell/titlebar/TitleBar.tsx`,
`src/shell/titlebar/menus.ts:334`), the splash wordmark and field
(`splash.html`, `src/splash/Splash.tsx`, `public/helve-splash-field.svg`), page
titles (`index.html`, `splash.html`), the Home lockup
(`apps/home/ui/src/icons.tsx`), the mark drawn inline in `src/ui/Icon.tsx`, the
app icons and installer names (`tauri.conf.json` `productName`, `bundle.icon`),
the `Helve Wordmark` font face, and the SVGs in `assets/`.

**Tier 2 — identity and compatibility. Explicitly frozen. Do not template
these, do not rename them, do not make them configurable.**
The `helve.toml` filename, the `.helve` extension and the `.helve/` directory,
the `helve/*` RPC method namespace (`helve/painted`, `helve/commands`,
`helve/open`, `helve/publish`), the `helve-tool://` URL scheme, the `@helve/*`
npm scope, the crate names, the bundle identifier
`com.firelightinnovations.helve`, the config directory holding `projects.json`,
and the `helve-<id>` MCP server key.

These are wire formats and on-disk contracts. Renaming any of them breaks every
tool repo that has ever been written and stops existing projects opening. A
branding system that touches them is not a branding system, it is a rename
script with a config file. Put this list in the design note and in the config
file's own header, because the next person to read the config will assume the
opposite.

**Tier 3 — the trademark surface.** Which is exactly tier 1, enumerated. That
correspondence is the deliverable.

#### Recommended shape: generate the frontend, check everything else

`branding.toml` at the repo root, beside `helve.toml`, same idiom and read the
same way. Product name, short name, wordmark text, company, About text,
installer name, and the paths to the mark, wordmark and splash-field assets.

- **Rust reads `branding.toml` directly**, exactly as `manifest.rs` reads
  `helve.toml`. The `toml` crate is already a workspace dependency. No
  generation step.
- **The frontend gets a generated module** — `src/branding.generated.ts`,
  gitignored, emitted by `scripts/generate-branding.mjs`, wired into
  `postinstall` and `build` the way `generate:icons` already is. A browser
  cannot read TOML, and the alternative (an async fetch for the window title) is
  worse.
- **`tauri.conf.json`, `index.html`, `splash.html` and `package.json` are
  checked, not rewritten.** `scripts/check-branding.mjs`, added to `pnpm lint`,
  asserts that each of them agrees with `branding.toml` and fails naming the
  file and the field when they drift.

The generate-and-check split is the recommendation rather than
generate-everything for two reasons. Tauri owns the schema of its config file
and rewriting a tracked file on every build produces spurious diffs and a
`format:check` that disagrees with itself. And a check that *names the surface
it is checking* is the machine-readable trademark list from tier 3 — the same
work, delivering both answers. It is also the idiom the repo already uses: the
baselines check and report rather than silently fixing.

`assets/` becomes the brand pack: the mark, the wordmark, the splash field and
the wordmark font, referenced by path from `branding.toml` rather than by
hardcoded import. `src/ui/Icon.tsx` currently draws the mark as inline SVG
paths, which is the one call site that needs real thought — either it loads the
branded asset or it stays as the default mark and is listed as a surface a fork
must replace. Say which, and why, in the design note.

#### Scope guards

- **Not a theming system.** Colours and fonts are `src/tokens.css` and stay
  there. Brand strings and brand assets only. A branding system that grows a
  palette becomes the settings screen with extra steps.
- **Not a build-time text swap.** `open-source-plan.md` phase 4.4 warns against
  a build flag switching "game" for "software", on the grounds that it is a fork
  with extra steps and small forks grow. The same trap applies here. One config,
  read once, one build.
- **No renaming in tier 2.** Repeated because it is the failure mode.
- Prose in the tutorials and docs is not templated. `apps/tutorial/**` says
  HELVE because it is teaching HELVE. Leave it.

#### Deliverables

`branding.toml`, `scripts/generate-branding.mjs`, `scripts/check-branding.mjs`,
the Rust reader, the consuming call sites, and `docs/branding.md` as the design
note — following the convention of `docs/settings.md` and `docs/tutorials.md`,
including the tier-2 frozen list and the reasoning for check-over-rewrite.

**Done when:** changing the product name in `branding.toml` and running
`pnpm build` produces an app whose window title, About item, splash wordmark,
page titles and installer name all show the new name **with zero source edits**;
and editing any one of those surfaces directly fails `pnpm lint` with a message
naming `branding.toml`.

---

## Wave 2 — after wave 1 lands

### WP-G · The issue backlog

**Branch:** none — this is GitHub work, not repo work.
**Blocked by:** WP-B, for the labels and templates.

Small contributions do not appear spontaneously. They come from
`good-first-issue` labels. A repo with an empty tracker collects stars and no
pull requests, however ready it is — which is the failure mode
`open-source-plan.md` closes on.

Roadmap #7, the bug-fix pass, is the natural source: as the sweep finds small
things, **file them instead of fixing them.** Eight to twelve is enough to seed
a tracker.

An issue that gets a first PR names the file, describes the wrong behaviour and
the right one, and says which check will prove it — `pnpm test:js`, now that
WP-D exists. An issue that says "the file tree flickers sometimes" gets nothing.
Write the first kind.

### WP-H · Integration and the final pass

**Branch:** `docs/readiness-integration`
**Blocked by:** every other package.
**Owns `README.md`, `STANDARDS.md`, `TODO.md`, `docs/open-source-plan.md`.**

Reads every block in `docs/handoffs/readiness-claims.md` and applies the deltas
in one voice:

- README: the platform statement, the license section, a pointer to
  `CONTRIBUTING.md`, the corrected test counts from WP-D, the `company/` and
  stack-table fixes from WP-E, and whatever WP-F changed about how the product
  names itself.
- STANDARDS: §8 gains where a frontend test goes; a short section on the
  branding boundary, pointing at `docs/branding.md` for the frozen tier-2 list —
  because "do not hardcode the product name" is now a rule, and STANDARDS is
  where rules live.
- TODO.md: mark #2 through #6 and #8 landed, mark #9 done, and reflect what this
  plan decided about #10.
- `open-source-plan.md`: mark phases 1 through 5 against reality. It is a good
  document and it should not read as aspirational once it is true.

Then delete the claims file.

---

## Decisions that block work

These are Braden's, and each one blocks a specific package. Answering 1, 2 and 4
unblocks wave 1 entirely.

| # | Decision | Blocks |
|---|---|---|
| 1 | Apache-2.0 confirmed, and the copyright line — "Firelight Innovations" or personal? | WP-A |
| 2 | Platform support: Windows only, or others best-effort, or others supported? | WP-B, WP-C |
| 3 | Fresh squashed history, or keep it? Phase 4.3 recommends squashing; it costs PRs #7–#13 as visible history | WP-E, publication |
| 4 | The product's name: "HELVE" or "HELVE Engine"? Four surfaces currently disagree | WP-F |
| 5 | Are the seven stack repos public, empty, or private? | WP-E |
| 6 | Trademark policy: may a fork use the name? The usual answer is no for the mark, yes for "based on" | WP-A, WP-F |

Decision 3 blocks publication rather than the work, so it does not need
answering this week — but it needs answering before anything is pushed public,
and WP-E's handling of `docs/handoffs/` depends on which way it goes.

---

## Where the app system fits

Roadmap #10 stays after this plan, with one exception.

Two of the four open questions in `open-source-plan.md` — clone versus signed
artifact, and what a mounted tool is permitted to do — are security decisions,
and they should be answered before the repo is public rather than when the
downloader is built. Cloning a GitHub repository into a desktop shell and
running it is arbitrary code execution. If a downloader ships in that shape it
becomes the first CVE-shaped issue and an outsider's first impression of the
project's judgment. Both questions are free to answer now, on paper, and
expensive to retrofit through a resolver later. Write the answers into
`docs/tool-protocol.md` as part of WP-E's stability statement.

The rest of #10 should wait, with one caveat that runs the other way. The first
thing an early contributor does is write a tool against the manifest format. If
that format is expected to move during #10, either build #10 first or say
plainly in `docs/tool-protocol.md` what is stable and what may still move — which
is WP-E item 2, and is the reason it is in this plan rather than the next one.
