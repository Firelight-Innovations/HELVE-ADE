# Releases and updates

**There is no release workflow yet.** No CI job builds installers, no
artifacts are signed, and there is no updater. Say that plainly before
anything below, because "how do I ship a build" has an honest answer today
and it is smaller than the question implies.

## What exists

A release *build* — one machine, produced by hand:

```sh
pnpm app:build
```

This compiles the frontend to static files, embeds them in an optimized Rust
binary, and produces installers. `README.md`'s **Release builds** section has
the full account — where the artifacts land (`target/release/`), why the
manifest needs `$HELVE_MANIFEST` or a `helve.toml` beside the installed
executable, and why `productName` is checked against `branding.toml`.

That command works. It is not a pipeline: nobody runs it but the person doing
it, nothing signs the output, and nothing publishes it anywhere.

## What does not exist

- **No CI-driven build.** `pnpm verify` runs on every pull request (see
  [Contributing](../../CONTRIBUTING.md)), but that is the test-and-lint gate,
  not a release job. No workflow produces an installer from a tag.
- **No code signing.** The MSI and NSIS installers `pnpm app:build` produces
  are unsigned. Windows will warn about them.
- **No updater.** HELVE does not check for a newer version of itself, and
  there is no mechanism for one build to hand off to the next.
- **No versioning or tagging convention for the orchestrator itself.** The
  *stack* components (`helve-forger`, `helve-journeyman`) are meant to
  cut tagged semver releases that `helve.toml` pins — see the root
  [README.md](../../README.md#the-stack) — but that convention has not yet
  been applied to this repository's own releases.

## Where this is going

`TODO.md` sequences the work that leads here — standards and CI landed first,
then the GitHub infrastructure, and release automation is deliberately deferred
until there is something worth releasing on a cadence. If you want to work on
this, read that first so a
contribution fits the order rather than jumping ahead of it.
