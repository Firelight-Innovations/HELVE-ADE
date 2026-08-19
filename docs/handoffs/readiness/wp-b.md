# WP-B · CI and GitHub infrastructure — session `chore-ci`

Started 2026-08-18. Branch `chore/ci`. Worktree: yes,
`.worktrees/ci`.

The block lives in this per-package file rather than in
`docs/handoffs/readiness-claims.md` because wave 1 runs in six worktrees, and six
agents appending to one shared file is a merge conflict with extra steps.

**Claimed:**

- `.github/workflows/verify.yml` (new)
- `.github/workflows/deny.yml` (new)
- `.github/PULL_REQUEST_TEMPLATE.md` (new)
- `.github/ISSUE_TEMPLATE/bug_report.yml` (new)
- `.github/ISSUE_TEMPLATE/feature_request.yml` (new)
- `.github/ISSUE_TEMPLATE/config.yml` (new)
- `.github/CODEOWNERS` (new)
- `.github/SECURITY.md` (new)
- `docs/handoffs/readiness/wp-b.md` (new — this file)

**Not claimed:**

- `deny.toml`. WP-A owns it. `deny.yml` is written assuming it lands at the
  repository root, and is non-blocking until it does.
- `package.json`, `README.md`, `STANDARDS.md`, `TODO.md`, `CLAUDE.md`. Deltas
  below.
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`. WP-C. GitHub finds both at the
  repository root, so neither needs a `.github/` copy, and two copies of a code
  of conduct is how they drift.

---

## Why `deny` is a second workflow rather than a second job

Because it answers a different question, and required status checks are named
after workflows.

`verify` answers "is this branch correct", from one command a contributor can
run offline. `cargo deny check` answers "is what we depend on still acceptable",
needs the network for the advisory database, and can change its answer on a day
nobody pushed anything. Folding it into `verify.yml` would mean the branch
protection rule below either covers both — making the supply-chain check
blocking before the tree has ever been audited — or covers neither. Separate
files also leave room to put a `schedule:` trigger on `deny` later, which is the
natural thing to want, without putting a cron on the gate.

## What could not be verified from here

This worktree has no `node_modules`, and a workflow cannot be run locally in any
case. Neither `verify.yml` nor `deny.yml` has executed. The plan's "done when"
for this package — a deliberately broken pull request goes red and reverting it
goes green — still has to happen against the real repository. The cheapest break
is a bare `unwrap()` in any `src-tauri` module, which `clippy::unwrap_used`
catches with an empty baseline.

---

## Repository settings a human has to apply

Branch protection cannot be set from a file, and four of these are not branch
protection at all — they are the settings that decide whether the files above do
anything.

### Branch protection on `main`

- [ ] **Require a pull request before merging.** Set required approvals to **0**
      for now. With a single maintainer, requiring one approval means nothing
      can ever merge — GitHub does not let an author approve their own pull
      request. Raise it to 1 the day there is a second maintainer.
- [ ] **Require status checks to pass**, and select **`verify`**. That is the
      one check that should ever be required.
- [ ] **Do not require `deny`.** While its check step carries
      `continue-on-error: true` the job reports success no matter what it finds,
      so requiring it would add a check that cannot fail. Require it in the same
      change that removes that line.
- [ ] **Require branches to be up to date before merging.** This is what stops
      two individually-green pull requests from merging into a red `main`.
- [ ] **Block force pushes** to `main`, and **block deletion**.
- [ ] Decide whether administrators may bypass. Recommended: they may, while the
      project has one maintainer, because the alternative is being locked out of
      your own repository by a stuck check on a Friday.

### Settings the files above depend on

- [ ] **Create the `maintainers` team** in the `Firelight-Innovations`
      organisation, or replace the five `@Firelight-Innovations/maintainers`
      lines in `.github/CODEOWNERS` with a personal handle. **If the team does
      not exist, CODEOWNERS is invalid and GitHub silently requests no reviews
      at all.** It does not fail loudly. I had no personal GitHub handle
      available to write instead, which is why the team form is there.
- [ ] **Enable Discussions.** `.github/ISSUE_TEMPLATE/config.yml` turns blank
      issues off and sends questions to Discussions; with Discussions disabled
      that link 404s and the only remaining route is a form.
- [ ] **Enable private vulnerability reporting** (Settings → Advanced Security →
      Private vulnerability reporting). It is off by default, and it is the
      primary route `.github/SECURITY.md` names.
- [ ] **Confirm the `bug` and `enhancement` labels exist.** They ship with a new
      repository, and both issue forms apply them, so an issue silently loses
      its label if either has been renamed. WP-G will also want
      `good-first-issue`.

### One decision, not a checkbox

`.github/SECURITY.md` currently prints **braden.seaborn@firelightinnovations.com**
as the fallback route when private reporting is unavailable. That is a real
personal address going into a public file. If a role address such as
`security@firelightinnovations.com` exists or can exist, swap it — a role
address survives a personal one being rotated, and it is one line to change now
versus a published policy to amend later.

---

## Delta for WP-D (`package.json`)

- Add `"packageManager": "pnpm@10.19.0"` at the top level, after
  `"type": "module"`. Because CI has to install a specific pnpm before it can
  read anything else, and with no `packageManager` field the only place to say
  which one is `.github/workflows/verify.yml` — where it is a second copy of a
  fact that already exists in `node_modules/.modules.yaml` and will drift from
  it. With the field present, that workflow line becomes `version: false` and
  `pnpm/action-setup` reads the version from `package.json` instead. Corepack
  reads the same field, so a contributor gets the matching pnpm too.

  I took `10.19.0` from the `packageManager:` line that pnpm itself recorded in
  the existing `node_modules/.modules.yaml` in the main checkout. Worth
  confirming against `pnpm --version` before committing it.

## Delta for WP-H

- `README.md`, near the top of whatever section describes building and
  verifying: **"Every pull request runs `pnpm verify` on `windows-latest` — the
  same single command CLAUDE.md asks you to run before pushing, deliberately not
  a re-implementation of it."** Because the one thing a contributor wants to
  know about a CI badge is whether the thing it checks is the thing they can run,
  and here it is exactly that.

- `README.md`, immediately beside that sentence, the status badge:
  `[![verify](https://github.com/Firelight-Innovations/helve/actions/workflows/verify.yml/badge.svg)](https://github.com/Firelight-Innovations/helve/actions/workflows/verify.yml)`.
  Because a gate that is not visible from the front page gets treated as
  optional. Note the badge renders as "no status" until the workflow has run on
  `main` once.

- `README.md`, in the same area: **"Security reports go through the private
  route in [`.github/SECURITY.md`](.github/SECURITY.md), not the issue
  tracker."** Because GitHub surfaces the security policy in a tab most people
  never open, and a vulnerability filed publicly cannot be unfiled.

- `STANDARDS.md` §10, appended to the opening paragraph (the one ending
  "`pnpm lint` is the single command that runs the three checks"): **"Since
  wave 1 of the contributor-readiness work, `pnpm verify` also runs on every
  pull request, on `windows-latest`, as one step rather than four —
  `.github/workflows/verify.yml` says why at length. A supply-chain check
  (`cargo deny check`) runs as a separate workflow, and is advisory until the
  dependency tree has been audited once."** Because §10 is the section that
  answers "what is enforced, and how", and until now the honest answer to "how"
  was "somebody remembers to run it".

- `STANDARDS.md` §10, in the `slop` subsection: no change needed. It already
  gives the reason `pnpm slop` is not in `pnpm lint`, and `verify.yml` cites it
  rather than restating it.

---

## Two things in `CLAUDE.md` that are now wrong

Neither is mine to fix — reporting them so they land in one voice.

1. **The test counts contradict `STANDARDS.md` §8.** CLAUDE.md's verification
   table says "28 vitest + 212 `cargo test`". §8's table says 333 tests: 274 in
   `src-tauri`, 15 in `helve-rpc`, 11 in `helve-tool-manifest`, 5 in
   `examples/echo-tool`, and 28 in `packages/bridge` — 305 under `cargo test`,
   not 212. WP-D is changing the vitest half of that number again, so whoever
   applies WP-D's count should correct the cargo half in the same pass.

2. **Nothing in `CLAUDE.md` mentions that the gate now runs anywhere but
   locally.** The document reads as though `pnpm verify` is entirely
   honour-system, which was true when it was written and is the premise this
   whole package exists to change. A sentence in the Verification section
   pointing at `.github/workflows/verify.yml` would close it. I did not add it,
   because `CLAUDE.md` is agent-facing instruction that several packages are
   about to want a line in, and six agents editing it in six worktrees is the
   collision the file-ownership rule exists to prevent. Suggest WP-H takes it
   along with the other three.

Nothing in `package.json` contradicts the plan. Its `verify` script is exactly
the four checks CLAUDE.md documents, in the order CLAUDE.md documents them,
which is the assumption `verify.yml` is built on.
