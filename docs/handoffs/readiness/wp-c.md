# WP-C · Contributor documentation — session `wp-c-contrib`

Started 2026-08-18. Branch `docs/contributing`. Worktree:
`.worktrees/contrib`.

**Claimed:**

- `CONTRIBUTING.md` (new)
- `CODE_OF_CONDUCT.md` (new) — Contributor Covenant 2.1, fetched from
  `contributor-covenant.org` and reflowed to 80 columns. The only edit to the
  text is `[INSERT CONTACT METHOD]` becoming
  `braden.seaborn@firelightinnovations.com`; a word-by-word diff against the
  upstream Markdown shows that substitution and nothing else.
- `docs/handoffs/readiness/wp-c.md` (this file)

**Not claimed:** `README.md`, `STANDARDS.md`, `TODO.md`, `package.json`, and
`docs/handoffs/readiness-claims.md` — that last one lives in the main working
tree, so a block written here would not be visible to the other packages
anyway. WP-H should treat this file as the WP-C block.

`.github/PULL_REQUEST_TEMPLATE.md` is WP-B's. `CONTRIBUTING.md` describes what a
pull request has to satisfy (`STANDARDS.md` §9) without claiming that a template
or a CI check exists, so nothing here goes stale if WP-B's shape changes.
`LICENSE` and `NOTICE` are WP-A's and are referenced, not written.

## What `CONTRIBUTING.md` covers

In order: the Windows-only platform statement (first screenful, second heading),
prerequisites and `pnpm install` taken verbatim in substance from the README's
Development section, `pnpm verify` as a gate with the full-versus-fast rule and
why the bundle is the check that matters, why `pnpm baseline` is never run,
`STANDARDS.md` §1 and §4 with §4 flagged as the rule outside code violates
first, §8's bug-fix-arrives-with-its-test, commit message style with four real
subjects from the log, what §9 asks of a pull request, and what will not be
accepted — the commercial tools, the tool protocol as the license boundary, and
the three that follow from it.

One paragraph is deliberately written to survive a package landing beside it.
The frontend test paragraph points at `STANDARDS.md` §8 for which runner covers
`src/` and where a frontend test file goes, rather than naming a config file, so
WP-D can land whatever shape it lands.

What happens after a pull request opens is checked against WP-B's `chore/ci`
(690e52b): the workflow runs literally `pnpm verify` on `windows-latest` and the
status check reads `verify`, and the template asks three questions rather than
offering a checklist. It is phrased as "opening a pull request runs" rather than
"cannot merge until", because branch protection is a checklist item for Braden
and not something a file can set — so the sentence is true today and stays true
once he applies it. The `cargo deny` workflow is described only as a
supply-chain check that is advisory for now, which is what it is until the
dependency tree has been audited once.

## Delta for WP-H

Three sentences for `README.md`, plus one correction that is not mine but that
`CONTRIBUTING.md` now directly contradicts.

### 1. The platform statement

`README.md`, **"Status" paragraph** (the block at line 13, first screenful) —
append:

> HELVE is developed and tested on Windows only. macOS and Linux are untested
> rather than deliberately excluded, and nothing in the design is Windows-only
> in principle — there is simply no machine here that runs them.

`README.md`, **"Development"**, immediately before "Prerequisites, all
one-time:" — insert:

> Every prerequisite below is a Windows prerequisite, and that is the whole
> supported surface today: winget, the MSVC build tools, WebView2. A port to
> macOS or Linux is welcome as a piece of work with a CI runner attached to it,
> not as a patch — open an issue first.

**Why:** the prerequisite list is Windows from top to bottom and nothing says so
out loud, which means a Linux contributor discovers it by failing to install
Visual Studio Build Tools. Saying it in the first screenful costs two sentences
and saves them an evening; saying it again above the prerequisites is where they
will actually be looking when it matters. Both are worded as "untested", which
is the true claim — nobody has decided against those platforms, and the honest
version is also the one that invites the port.

**These three sentences and WP-B's `verify.yml` are one decision in three
places.** If decision 2 comes back as anything other than Windows-only, the
README, `CONTRIBUTING.md` and the workflow's single `windows-latest` job all
move, and moving one without the others is worse than moving none — prose
promising Linux over a runner that only proves Windows is the "looks like
coverage" failure WP-B's own runner comment argues against. WP-B records the
same coupling in `docs/handoffs/readiness/wp-b.md` (53545bf).

### 2. The `CONTRIBUTING.md` pointer

`README.md`, **"Development"**, as the first line of the section, before the
platform sentence above:

> `CONTRIBUTING.md` is the guide for working on this repository — prerequisites,
> the verification gate, the conventions that are unusual, and what will not be
> accepted. `STANDARDS.md` is the rule book it points at.

`README.md`, **end of "Before you commit"**, after the sentence about a bug fix
arriving with its test:

> `CONTRIBUTING.md` explains why the full form is the one that matters and what
> the baselines are for.

**Why:** an outsider arriving from GitHub's sidebar link reads `CONTRIBUTING.md`
first; an outsider arriving from a search reads the README first and needs one
line telling them the longer document exists. Two pointers is not redundancy
here, because the README's Development section and its "Before you commit"
section answer two different questions and a reader lands in one or the other.

### 3. The baselines paragraph in the README is now wrong

`README.md` lines 116–131 ("Lint baselines") says the baselines "record what
already exists", and then:

> `pnpm baseline` rewrites all three. Use it **after** a cleanup pass, to bank
> the improvement — never to make a failing check pass, since it would absorb
> the new violation along with everything else.

That was true when the baselines held 43, 298 and 106 findings. All three are
`{}` now (`STANDARDS.md` §10, and commit c16150d emptied the last one), and from
empty there is no improvement left to bank — every write is absorption. CLAUDE.md
and `CONTRIBUTING.md` both say never run it, so the README is the one document
that still tells a contributor to.

Suggested replacement for the two paragraphs, keeping the table:

> The linters were switched on against a codebase written without them, so all
> three checks are **ratchets** rather than gates: they record what exists and
> fail when a count goes *up*. **All three baselines are now empty**, which
> makes a violation today a violation rather than a number to compare against.
>
> **Never run `pnpm baseline`.** It rewrites all three at once, and from empty
> it can only absorb whatever is currently broken — the exact thing the ratchet
> exists to prevent. `STANDARDS.md` §10 has the single-check form and what it
> takes to justify reaching for it.

**Why:** this is the one stale line in the repo that actively instructs someone
to do the thing three other documents forbid, and it is in the section a
contributor reads at exactly the moment a check is failing them.

## Other staleness found, for whoever owns it

- **Test counts disagree three ways.** `README.md:86` says "28 vitest + 212
  `cargo test`"; `STANDARDS.md` §8 says 333 total (274 + 15 + 11 + 5 under
  `cargo test`, 28 vitest); `STANDARDS.md` §9's table says "all 240 tests".
  `CLAUDE.md` says "28 vitest + 212 `cargo test`" as well. WP-D owns the
  corrected number; §9's table needs the same fix as §8, and CLAUDE.md is
  nobody's package. `CONTRIBUTING.md` cites no count at all, deliberately.
- **`README.md:311`** points at `company/docs/design/helve-tool-integration.md`,
  which no outsider can open. WP-E has this one; noting it because it is in the
  paragraph a contributor reads right after `CONTRIBUTING.md` sends them to
  `docs/tool-protocol.md`, whose line 8 has the same pointer.
- **The README says "Helve", `CONTRIBUTING.md` says "HELVE".** Per the plan the
  product name in user-facing prose is HELVE, and decision 4 settles the rest.
  The README's own "Projects" section already writes *HELVE*, so it disagrees
  with its own first line. WP-F and WP-H between them.
- **`README.md:66`** teaches `pnpm app` as the second command anyone runs.
  That is right for a contributor and wrong for an agent (CLAUDE.md reserves
  port 1420), and the two documents do not acknowledge each other. Not worth
  fixing in the README; worth knowing it is deliberate.
