# Releases and updates

A release is cut from a **tag**, built on GitHub, and published as a **draft**
that a person reviews before it goes out. Nothing is signed yet, and there is
no updater. Both of those absences are deliberate and are described at the
bottom rather than left to be discovered.

## Cutting one

```sh
node scripts/check-version.mjs --set 0.2.0   # writes package.json + Cargo.toml
cargo update -w                              # Cargo.lock carries the version too
pnpm verify                                  # the gate, as always
git commit -am "Release 0.2.0"
git push
git tag v0.2.0
git push origin v0.2.0
```

The tag push is what starts `.github/workflows/release.yml`. It builds on
`windows-latest`, and roughly fifteen minutes later a **draft** release is
waiting at `/releases` with the MSI and the NSIS setup attached. Read the
generated notes, edit them, press publish.

The draft is the review step. A tag push on its own has none, and a published
release with wrong notes cannot be quietly fixed once people have the link.

### Trying it without a tag

`release.yml` also answers `workflow_dispatch`. Run it from the Actions tab and
it performs the same build, then hangs the installers off the workflow run as
artifacts for a fortnight instead of publishing anything. Use it when changing
the workflow, because the alternative way to test a release build is to push a
tag, and a tag is the one thing in this process that cannot be taken back
cleanly.

## Where the version lives

**`package.json` is the only place to edit it.** Everything else either
inherits or is checked, and `pnpm lint` fails on a disagreement.

| Place | How |
|---|---|
| `package.json` | the source of truth |
| `src-tauri/tauri.conf.json` | `"version": "../package.json"`, read by Tauri itself |
| `src-tauri/Cargo.toml` | `version.workspace = true` |
| `Cargo.toml` | `[workspace.package]`, **checked** — Cargo cannot indirect |

Only the last one is a copy, because Cargo has no way to read a version out of
another file. `scripts/check-version.mjs` compares it against `package.json` on
every `pnpm lint`, and `--set` writes both at once so the two cannot be bumped
apart by hand.

The script also asserts that the two indirections are still indirections. A
commit that replaced `"../package.json"` with a literal would look like a
simplification and would silently restore the drift the check exists to
prevent, so that specific edit fails the lint.

The release workflow runs the same script with `--tag`, before it builds
anything. A tag that disagrees with `package.json` would produce installers
whose filenames state a version that is not the one compiled into them, and
nothing about the finished artifact reveals that. It fails at the top of the
job instead.

## Building one by hand

```sh
pnpm app:build
```

The same command CI runs. It compiles the frontend to static files, embeds them
in an optimized Rust binary, and produces installers under `target/release/`.
The release profile has no cheap incremental rebuild, so expect minutes.

| Path | What |
|---|---|
| `helve-orchestrator.exe` | the app, self-contained |
| `bundle/msi/HELVE_<ver>_x64_en-US.msi` | MSI installer |
| `bundle/nsis/HELVE_<ver>_x64-setup.exe` | NSIS installer |

Those filenames come from `productName` in `tauri.conf.json`, which is checked
against `branding.toml` — renaming the product renames the installers with it.
The bundle identifier does *not* change, and neither does the OS configuration
directory Tauri derives from it, so nobody's existing projects or settings move.

WiX and NSIS are downloaded automatically on the first release build. The
workflow does not cache them, or the Rust `target/` directory: release-profile
artifacts are a separate cache entry from the dev-profile ones that gate every
pull request, GitHub evicts at 10 GB per repository, and a release runs a
handful of times a month. Paying a cold build for the thing people download
beats making the gate everyone waits for miss its cache.

## The installed build cannot find a stack

**This is the one caveat that will be mistaken for a bug.** `bundle.resources`
ships a copy of `helve.toml`, but its `checkout-root = ".."` resolves relative
to wherever the manifest ends up — which is the install directory, not your
code tree. `locate()` searches in this order:

1. `$HELVE_MANIFEST`
2. the repo root (dev builds only, via `CARGO_MANIFEST_DIR`)
3. a `helve.toml` placed next to the installed executable
4. the copy bundled into the app

Steps 1 and 3 are the ones that make an installed build useful. Until the
orchestrator can be pointed at a workspace directly, an installed copy reports
every tool as `not cloned`, and that reading is correct. Run from the repo to
see a stack resolve. `.github/release-preamble.md` says so on every release, so
the answer arrives with the download rather than after a bug report.

## What still does not exist

- **No code signing.** The MSI and the setup.exe are unsigned, so Windows
  SmartScreen shows "Windows protected your PC" and hides the Run button behind
  **More info**. A certificate is a purchase rather than a configuration:
  Azure Trusted Signing is the cheap route but wants an organization identity
  with some history behind it, and an OV or EV certificate runs to a few hundred
  a year. When one exists it arrives as a repository secret and `release.yml`
  gains two `env:` lines. That is why signing is absent from the workflow
  rather than stubbed out in it.
- **No updater.** HELVE does not check for a newer version of itself. Tauri's
  updater needs a minisign keypair — free, unrelated to the certificate above —
  a `latest.json` endpoint, and `bundle.createUpdaterArtifacts`. It is worth
  wiring once releases happen on a cadence rather than one at a time.
- **Releases are not marked prerelease.** `0.1.x` and the status badge already
  say pre-alpha, and marking them would stop `/releases/latest` resolving,
  which is the stable download URL worth having.
