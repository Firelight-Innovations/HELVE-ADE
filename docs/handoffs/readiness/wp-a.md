# WP-A · License and legal — branch `chore/license`

Started 2026-08-18. Worktree: `.worktrees/license`. Nothing here was verified by
running it; see [What could not be verified](#what-could-not-be-verified).

## Claimed

- `LICENSE` (new) — the Apache License 2.0, verbatim, including the appendix.
  Not retyped and not fetched over the network: copied byte-for-byte from a
  vendored copy already on this machine and checked by hash. SHA-256
  `cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30`, which is
  the published hash of `https://www.apache.org/licenses/LICENSE-2.0.txt`. 202
  lines, LF, leading blank line, `Copyright [yyyy] [name of copyright owner]`
  left as the placeholder it is meant to be. Five copies in the local Cargo
  registry agree with it exactly. **If this file is ever edited, that hash is
  how you know.**
- `NOTICE` (new) — the copyright line, a paragraph saying that the license
  covers this repository and not the first-party tools that mount into it, and
  the trademark statement. Apache-2.0 section 4 obliges redistributors to carry
  this file, which is why the trademark position lives here rather than only in
  the README.
- `Cargo.toml` — `license = "UNLICENSED"` becomes `"Apache-2.0"`, with the
  reasoning (patent grant; not MIT, never GPL) written above it.
- `src-tauri/Cargo.toml` — **had no `license` key at all.** Now
  `license.workspace = true`. This was the one real finding in item 3 of the
  brief; the other three members were already correct.
- `packages/bridge/package.json`, `packages/file-icons/package.json`,
  `packages/monaco-languages/package.json` — one `"license": "Apache-2.0"` line
  each, after `description`.
- `packages/bridge/LICENSE` (new) — **an addition the brief did not ask for,
  and the easiest thing here to revert if it is unwanted.** `@helve/bridge` is
  the package outside tool repos install, and npm publishes only what is under
  the package directory: with the license text at the repo root, the tarball
  would have declared Apache-2.0 and shipped none of it, which is the one thing
  section 4(a) actually requires. npm always includes a root-level `LICENSE` in
  a tarball regardless of the `files` array, so nothing else needed changing.
  The other two packages were deliberately left without one — they are internal
  workspace dependencies nobody outside installs, and if that ever stops being
  true they need the same file.
- `deny.toml` (new) — advisories and licenses over the transitive tree.
  An allow-list rather than a deny-list, which is what makes the GPL-family
  requirement answer itself: anything not named is a finding, so GPL, AGPL and
  LGPL are denied by construction rather than by a list that has to guess their
  names. MPL-2.0 *is* allowed, and that is the one entry that carries an
  argument rather than a nod — its reciprocity is file-scoped, it arrives
  unavoidably through `option-ext` under Tauri, and the file says so.

## Not claimed

- `README.md`, `STANDARDS.md`, `TODO.md`, root `package.json` — deltas below.
- `src-tauri/tauri.conf.json` — WP-F is templating it. There is a real gap
  there; see the delta.
- Per-file license headers. Apache-2.0 does not require them, and 264 files of
  boilerplate would bury the prose headers that explain what each module is for.
- `src-tauri/Cargo.toml`'s `version`, `authors` and `edition`, which are still
  spelled out literally instead of inheriting from `[workspace.package]` like
  every other member. Untidy, harmless, and not this package's business — but
  it is why `license` was missing in the first place, so whoever tidies it
  should do all four together.

## What could not be verified

This worktree has no `node_modules` and no warm Cargo `target/`, so nothing here
was executed — not `pnpm verify`, not `cargo check`, not `cargo deny`.

- `Cargo.toml`, `src-tauri/Cargo.toml`, `deny.toml` and all three
  `package.json` files were parsed as TOML and JSON respectively and are
  syntactically valid.
- `LICENSE` and `NOTICE` have no extension, so Prettier infers no parser and
  `format:check` will not look at them. `scripts/check-comments.mjs` only reads
  `.rs`, `.ts`, `.tsx` and `.mjs`, so `deny.toml` is invisible to it too.
  Nothing added here should be able to move `pnpm verify`.
- **The plan's "done when" for this package — `cargo deny check` passes, or its
  failures are listed with a recommendation for each — is not met and cannot be
  met from here.** `deny.toml` closes with a note saying so. Expect the `allow`
  list to need one or two additions on the first real run. A denial is the check
  working; whoever runs it first should read what it names before widening
  anything, and a GPL-family hit is a finding to escalate, not to allow.

## Contradictions with the plan

1. The plan's WP-A bullet list assigns `pnpm lint:deps` to this package, but
   the file-ownership rule three sections earlier gives the root `package.json`
   to WP-D alone. The two do not agree. This package followed ownership and
   wrote the script as a delta rather than editing the file — the config it
   needs exists either way, and a one-line script is cheaper to hand over than
   a merge conflict in the file every package wants.
2. The plan says `deny.toml` should be added "as a separate script, **not** into
   `pnpm lint`". Done, and `deny.toml`'s header explains the reasoning to
   whoever reads it next rather than leaving it to be rediscovered.

## Delta for WP-D — root `package.json`

Add one script, immediately after `"lint:comments"` so it reads as a sibling of
the other lint entries while staying out of the `lint` aggregate above them:

```json
"lint:deps": "cargo deny check",
```

`deny.toml` is at the repo root, so no `--manifest-path` is needed. Do **not**
add it to the `"lint"` script. The advisories check fetches the RustSec database
over the network and `pnpm verify` has to keep passing offline; WP-B runs it as
its own CI job for the same reason.

## Delta for WP-H

**`README.md`, new section near the end, after the stack table and before
whatever closes the file. Heading "License".**

> HELVE is Apache-2.0. The full text is in [LICENSE](LICENSE), and
> [NOTICE](NOTICE) is the file a redistributor has to carry with it.
>
> Apache rather than MIT because of the patent grant, which matters here
> specifically: a commercial engine loads into this shell through the tool
> protocol, and MIT says nothing about patents at all. Not GPL or AGPL under
> any circumstances — a copyleft core hands someone a real argument that the
> private tools mounting into it are derivative works.
>
> The license covers the code and not the names. HELVE, Forger and Journeyman,
> and the marks that go with them, are trademarks of Firelight Innovations. Fork
> this, sell what you build on it, and say plainly that your work is based on
> HELVE — all of that is fine. Shipping it *as* HELVE is not. NOTICE says why at
> length; the short version is that once the source is freely copyable, the name
> is the only thing left telling a user which build is executing tools on their
> machine.

Because the README currently says nothing about the license at all, and the
first question an outside reader has about a public repository is this one.

**`STANDARDS.md` §10, the table mapping rules to the linter that checks them —
one row, or one sentence beneath it:**

> Dependency licensing and advisories are checked by `cargo deny check`, run as
> `pnpm lint:deps` and as its own CI job. It is deliberately outside
> `pnpm verify`, because it needs the network and `pnpm verify` must not.

Because §10's whole promise is that every rule names its enforcing tool, and a
check that exists but is not in the aggregate command is exactly the kind of
thing that otherwise gets forgotten and then rediscovered as a surprise in CI.

## Delta for WP-B — CI

`deny.toml` is at the repo root and configures all four checks, so the job is
`cargo deny check` with no arguments. `EmbarkStudios/cargo-deny-action` is the
usual way to get the binary without a cold `cargo install`. Two things worth
knowing before it goes red: the tool's config schema changed at v2 and this file
is written for a current release (no `version = 2` key, no `[licenses] deny`
list, both of which were removed), and the advisories half is time-dependent, so
this job can fail on a commit that changed nothing. That is the job working, but
it means it should not gate a merge the same way `verify` does.

## Delta for WP-F — branding, and two gaps

1. `NOTICE` closes by saying that stripping the marks should be an edit to the
   branding configuration rather than a grep through the source. It deliberately
   does not name a file, because `docs/branding.md` does not exist yet. Once it
   does, that last paragraph should point at it — a trademark policy a fork
   cannot mechanically comply with is a trademark policy nobody complies with.
2. **The installer ships no license.** `src-tauri/tauri.conf.json` has
   `bundle.resources` carrying `helve.toml` into the app and nothing else, and
   no `licenseFile` anywhere. Apache-2.0 section 4(a) applies to distributing
   the built app, not only the source, so `LICENSE` and `NOTICE` should join
   `helve.toml` in `bundle.resources`, and the Windows installer should be
   pointed at `LICENSE` through its NSIS/WiX license field. Left undone here
   because that file is being templated by WP-F and two packages editing it is
   a guaranteed conflict.
3. Minor, and only worth a glance: the crate `description` fields and
   `tauri.conf.json`'s `productName` say `Helve`, while `NOTICE`, the README and
   the splash say `HELVE`. That is decision 4's territory, not this package's,
   but `NOTICE` now spells it `HELVE` in a file redistributors must reproduce —
   so if decision 4 lands the other way, this file is one of the surfaces to
   change.
