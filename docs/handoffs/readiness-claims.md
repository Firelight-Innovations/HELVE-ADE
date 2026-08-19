# Contributor-readiness file claims

The work packages in `docs/contributor-readiness-plan.md` run in parallel. Claim
before you edit; check here before you touch something that is not obviously
yours. Delete your block when your package lands.

**`README.md`, `STANDARDS.md` and `TODO.md` are not claimable.** They belong to
WP-H. If your package needs a change in one of them, write the change here — the
exact sentence, the section it belongs in, and why — under a `### Delta for
WP-H` heading inside your own block. WP-H applies them all in one pass.

`package.json` belongs to WP-D.

---

<!-- Template — copy this, do not edit it in place.

## WP-? · <name> — session `<slug>`

Started <date>. Branch `<branch>`. Worktree: yes.

**Claimed:**

- `path` (new)
- `path` — what changed and how much of it

**Not claimed:** anything you looked at and deliberately left alone, and why.

### Delta for WP-H

- `README.md`, "<section>": <the sentence>. Because <reason>.

-->

## WP-F · The branding system — session `branding`

Started 2026-08-18. Branch `feat/branding`. Worktree: yes,
`.worktrees/branding`.

**Claimed:**

- `branding.toml` (new)
- `docs/branding.md` (new)
- `src-tauri/src/branding.rs` (new)
- `scripts/read-branding.mjs`, `scripts/generate-branding.mjs`,
  `scripts/check-branding.mjs` (new)
- `package.json` — four script entries only, granted by the lead for this
  package. WP-D owns the rest of the file.
- `helve.toml` — the `[stack] name` value and the header
- `index.html`, `splash.html`, `src-tauri/tauri.conf.json` — the brand strings
- `.gitignore`, `.prettierignore`, `eslint.config.js`,
  `scripts/check-comments.mjs` — one entry each for the generated modules
- `src-tauri/src/{lib.rs,windows.rs,project/mod.rs,apps/home.rs}` — the three
  places Rust wrote the name out, plus the `mod` line
- `src/ui/Icon.tsx`, `src/shell/titlebar/{TitleBar.tsx,menus.ts}`,
  `src/shell/WindowRoot.tsx`, `src/splash/{Splash.tsx,splash.css}`
- `apps/home/ui/src/{App.tsx,icons.tsx}`,
  `apps/files/ui/src/trash/TrashView.tsx`

**Not claimed:** `apps/tutorial/**` and `docs/*`, which say HELVE because they
are teaching HELVE. `apps/home/ui/src/home.css`, whose mention of the name is a
quotation from the brand packet. Every tier-2 name — the `.helve` extension, the
`helve/*` RPC namespace, the `helve-tool://` scheme, the `@helve/*` scope, the
crate names, the bundle identifier, the config directory: those are wire
formats, and `docs/branding.md` §2 says so at length.

### Delta for WP-H

In `docs/handoffs/readiness/wp-f.md`, as exact sentences with their sections —
STANDARDS §7, §8 and §10, and the README's installer-filename change from
`Helve_…` to `HELVE_…`.
