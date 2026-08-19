# WP-F · The branding system — deltas for WP-H

Branch `feat/branding`. The design note is `docs/branding.md`; everything below
is a change to a file WP-F is not allowed to edit.

---

## `STANDARDS.md`

### §7 Naming and layout — add as a new bullet at the end of the list

> - **The product's name is never written out in source.** It comes from
>   `branding.toml`, through the generated `branding.generated.ts` in the
>   frontend and `branding::product_name()` in Rust. `docs/branding.md` has the
>   list of surfaces and, more importantly, the list of names that are *not*
>   branding and must never be renamed — the `.helve` extension, the `helve/*`
>   RPC namespace, the `helve-tool://` scheme, the `@helve/*` scope, the crate
>   names and the bundle identifier are wire formats, and renaming one breaks
>   every tool repository ever written.

Why: the source is about to be Apache-2.0 with the names kept as trademarks, and
that split is only followable if a fork can strip the marks in one place. It also
now has a linter behind it, and §10 says rules that are enforced live here.

### §10 "What is enforced, and how" — add a row to the table

> | §7 the product name is never hardcoded | `scripts/check-branding.mjs` |

Place it after the `§6.5 hooks own state` row and before the
`comment concentration` row, so the mechanical checks stay grouped at the end.

### §8 Tests — the count moved

`src-tauri/src/**` is now **276**, not 274, and the total is **335**, not 333.
Two tests in `src-tauri/src/branding.rs`: one that the embedded `branding.toml`
parses and names something, one that the product's name never again contains
"engine". WP-D is also moving these numbers; take the larger reading.

---

## `README.md`

### Wherever the installer or bundle output is named

`tauri.conf.json`'s `productName` changed from `Helve` to `HELVE`, which is the
name Tauri builds the installer and the bundle directory from. Anything in the
README quoting a built filename — `Helve_0.1.0_x64-setup.exe`,
`Helve_0.1.0_x64_en-US.msi`, or a path under `target/release/bundle/` — now
reads `HELVE_…`. The installed application's own folder name changes with it.

Two things that did **not** change and should not be described as if they had:

- the bundle identifier, still `com.firelightinnovations.helve`;
- therefore the OS configuration directory that holds `projects.json` and
  `settings.json`, which Tauri derives from the identifier and not from
  `productName`. **Nobody's existing projects or settings move.**

### A pointer, wherever the docs are listed

> `docs/branding.md` — what the product is called, and which names are frozen
> because they are wire formats rather than branding.

### If the README ever says the product's name is "HELVE Engine"

It is not, and that string is now gone from the interface. `helve-engine` is a
separate, private repository; the title bar and the About item both used to
claim to be it. `src-tauri/src/branding.rs` carries a test that fails if the
name contains "engine" again.

---

## Nothing needed in `TODO.md`

WP-F does not close a numbered roadmap item on its own. The branding work is
listed in `docs/contributor-readiness-plan.md` rather than in the roadmap, and
whether #9 is done is WP-H's call once every package has landed.

---

## Files WP-F changed, for the integration pass

New: `branding.toml`, `docs/branding.md`, `src-tauri/src/branding.rs`,
`scripts/read-branding.mjs`, `scripts/generate-branding.mjs`,
`scripts/check-branding.mjs`.

Edited: `package.json` (four script entries), `.gitignore`, `.prettierignore`,
`eslint.config.js`, `scripts/check-comments.mjs`, `helve.toml`, `index.html`,
`splash.html`, `src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`,
`src-tauri/src/project/mod.rs`, `src-tauri/src/windows.rs`,
`src-tauri/src/apps/home.rs`, `src/ui/Icon.tsx`,
`src/shell/titlebar/TitleBar.tsx`, `src/shell/titlebar/menus.ts`,
`src/shell/WindowRoot.tsx`, `src/splash/Splash.tsx`, `src/splash/splash.css`,
`apps/home/ui/src/App.tsx`, `apps/home/ui/src/icons.tsx`,
`apps/files/ui/src/trash/TrashView.tsx`.

`package.json` is WP-D's file by the plan's ownership rule; WP-F was granted it
for this package. The four entries are `generate:branding`, `lint:branding`, and
the additions of those two to `build`, `typecheck`, `postinstall` and `lint`.
