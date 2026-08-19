# HELVE

The entry point for the HELVE stack. Organizes and loads the dev tools and
holds the shared baseline code that glues everything together and gets the
stack running.

Each dev tool is its own repository shipping a Rust core and a React frontend.
Its own Tauri app is one host for that pair; this orchestrator is a second.
`docs/tool-protocol.md` is the contract between them.

This is a development tool; it does not ship with games built on HELVE.

Status: pre-alpha. The shell frame runs and reports the stack, and its
first-party apps — Home, Files, the file viewer and Tutorials — mount in it and
are answered by Rust. Projects exist: Home opens one, remembers it, and reopens
it on the next launch. The tools themselves are not yet integrated — a tool's
core is a child process and the broker that would reach it is not built.

HELVE is developed and tested on Windows only. macOS and Linux are untested
rather than deliberately excluded, and nothing in the design is Windows-only in
principle — there is simply no machine here that runs them.

## Tech stack

This repo is a [Tauri v2](https://tauri.app) desktop app: a Rust backend
driving a web frontend rendered by the OS webview (WebView2 on Windows).

| Layer | Choice | Lives in |
|---|---|---|
| Backend | Rust (stable) | `src-tauri/src/` |
| Shell/runtime | Tauri v2 | `src-tauri/tauri.conf.json` |
| Frontend | React 19 + TypeScript + Vite | `src/` |
| Stack manifest | TOML | `helve.toml` |

Rust owns everything that touches the machine — reading the manifest, finding
component checkouts, comparing them against the pinned versions. The frontend
is a view over the resulting snapshot, and reaches Rust only through the typed
wrappers in `src/bindings.ts`.

## The stack manifest

`helve.toml` is the source of truth for which components make up the stack and
which version of each one this orchestrator expects. On launch the app reads it,
looks for each component's checkout under `checkout-root` (by default the
sibling directories of this repo), and reports one of four states per tool:

| State | Meaning |
|---|---|
| `v0.1.0` | Checkout present and its version matches the pin |
| `≠` | Checkout present but reports a different version than the pin |
| `unversioned` | Checkout present, no `Cargo.toml` / `package.json` to read a version from |
| `not cloned` | Nothing at the expected path |

Set `HELVE_MANIFEST` to point a dev build at a different manifest.

## Development

`CONTRIBUTING.md` is the guide for working on this repository — prerequisites,
the verification gate, the conventions that are unusual, and what will not be
accepted. `STANDARDS.md` is the rule book it points at.

Every prerequisite below is a Windows prerequisite, and that is the whole
supported surface today. A port to macOS or Linux is welcome as a piece of work
with a CI runner attached to it, not as a patch — open an issue first.

Prerequisites, all one-time:

- **Rust** (stable) — `winget install Rustlang.Rustup`
- **MSVC build tools** — Visual Studio Build Tools 2022 with the *Desktop
  development with C++* workload. Rust uses the MSVC linker on Windows.
- **WebView2 runtime** — preinstalled on Windows 11.
- **Node 20+** and **pnpm** — `npm i -g pnpm`

Then:

```sh
pnpm install          # frontend dependencies
pnpm app              # run the desktop app (tauri dev)
```

The first `pnpm app` compiles the whole Rust dependency tree and takes several
minutes; subsequent runs are incremental and fast. Editing anything under `src/`
hot-reloads; editing anything under `src-tauri/src/` recompiles and restarts the
app automatically.

### Before you commit

**Every commit and every pull request must pass all four checks.** They are a
gate, not a suggestion, and one command runs them:

```sh
pnpm verify
```

| Check | Command | Covers |
|---|---|---|
| Build | `pnpm build` | runs `tsc` first, so this covers types |
| Tests | `pnpm test` | 64 vitest + 305 `cargo test` |
| Lint | `pnpm lint` | ESLint, clippy, comment density |
| Format | `pnpm format:check` | Prettier and rustfmt |

While iterating, `pnpm verify:fast` runs the same four checks in roughly half
the time (17s against 33s). It swaps `pnpm build` for `pnpm typecheck` — the
three workspace packages plus `tsc`, without `vite build` or the icon
generation step. Bundling alone is 21 of the full run's 33 seconds.

**Use it for the inner loop, not as the last check before you commit.** Skipping
the bundle skips the only check that catches a new app missing its entry in
`vite.config.ts` (see `STANDARDS.md` §3 — it fails *silently*), an asset
referenced from CSS or HTML that does not resolve, or anything that type-checks
but cannot be bundled. None of those are type errors.

Each half is available on its own when you want a narrower loop still:

```sh
pnpm typecheck    # workspace packages + tsc, no bundle
pnpm test:js      # vitest across the workspace packages
pnpm test:rust    # cargo test --workspace
pnpm lint:js      # ESLint only
pnpm lint:rust    # clippy only
pnpm format       # apply Prettier and rustfmt rather than just checking
pnpm slop         # structural report — advisory, not part of the gate
```

A failing test is not fixed by deleting or skipping it. Per `STANDARDS.md` §8, a
bug fix arrives with the test that would have caught it. `CONTRIBUTING.md`
explains why the full form is the one that matters and what the baselines are
for.

#### Lint baselines

The linters were switched on against a codebase written without them, so all
three are **ratchets** rather than gates: they record what already exists and
fail only when a count goes *up*. A new violation in an already-dirty file still
fails, because counts are kept per file and per rule.

| File | Holds |
|---|---|
| `eslint-suppressions.json` | pre-existing ESLint findings |
| `clippy-baseline.json` | pre-existing clippy warnings, per file and lint |
| `comment-baseline.json` | files above the comment-density caps |

`pnpm baseline` rewrites all three. Use it **after** a cleanup pass, to bank the
improvement — never to make a failing check pass, since it would absorb the new
violation along with everything else.

Note that `cargo clippy` replays cached diagnostics — it will report "Finished"
in well under a second without actually rechecking anything. To force a real
check of a crate you just changed, `cargo clean -p <crate>` first. That rebuilds
only that crate, not the dependency tree.

Note there is no separate "build the frontend" step for running the app.
`pnpm build` and `pnpm dev` are only the frontend half; `tauri.conf.json` invokes
them via `beforeDevCommand` / `beforeBuildCommand`. Use the two `app` scripts.

### Release builds

```sh
pnpm app:build
```

Compiles the frontend to static files, embeds them in an optimized binary, and
produces installers. Takes a few minutes — the release profile has no cheap
incremental rebuild. Artifacts land in `target/release/`:

| Path | What |
|---|---|
| `helve-orchestrator.exe` | the app, self-contained |
| `bundle/msi/Helve_<ver>_x64_en-US.msi` | MSI installer |
| `bundle/nsis/Helve_<ver>_x64-setup.exe` | NSIS installer |

WiX and NSIS are downloaded automatically on the first release build.

**A release build needs a manifest pointed at a real stack checkout.**
`bundle.resources` ships a copy of `helve.toml`, but its `checkout-root = ".."`
resolves relative to wherever the manifest ends up — which is the install
directory, not your code tree. `locate()` searches in this order:

1. `$HELVE_MANIFEST`
2. the repo root (dev builds only, via `CARGO_MANIFEST_DIR`)
3. a `helve.toml` placed next to the installed executable
4. the copy bundled into the app

Steps 1 and 3 are the ones that make an installed build useful. Until the
orchestrator can be pointed at a workspace directly, run it from the repo.

### Layout

This repo is both a Cargo workspace and a pnpm workspace. It isn't only the
desktop app any more: the tool protocol needs libraries that *other* HELVE
repos depend on, so those live outside `src-tauri/` and are shared through the
workspace. One consequence worth knowing — Rust build output is at `target/`,
not `src-tauri/target/`, so every crate compiles the Tauri dependency tree once
between them rather than once each.

```
Cargo.toml            Rust workspace root
pnpm-workspace.yaml   Node workspace root
helve.toml            stack manifest — pinned component versions
docs/
  tool-protocol.md      the wire contract between the shell and a tool
crates/               Rust libraries shared with the tool repos
  helve-tool-manifest/  parses and validates helve-tool.toml
  helve-rpc/            JSON-RPC over the standard streams, both halves
packages/             npm packages shipped to the tool repos
  bridge/               @helve/bridge — one tool frontend, either host
examples/
  echo-tool/            reference tool: manifest + core + frontend
apps/                 first-party surfaces — see apps/README.md
  shared/app.css        the chrome every app draws inside
  home/ui/              Home: the stack at a glance
  files/ui/             Files: browse the checkout
  viewer/ui/            Viewer: read a file, whatever its format
  tutorial/ui/          Tutorials: the guided tour, drawn from a catalog
index.html            Vite entry point (main window)
splash.html           Vite entry point (splash window)
src/                  React frontend
  bindings.ts           typed wrappers over the Rust commands
  App.tsx               owns the stack snapshot, renders the shell
  tokens.css            palette and resets, shared by both windows
  shell/                the frame tools run inside
    Shell.tsx             title bar + rail + surface + status bar
    ActivityRail.tsx      tool strip, generated from helve.toml
    ToolSurface.tsx       where a tool renders — blank for now
    StatusBar.tsx         stack health, active tool
  views/
    StackView.tsx         stack diagnostics, reached from the status bar
  splash/               the startup window
  components/           ToolCard, StatusBadge
src-tauri/            Rust backend
  src/
    main.rs             binary entry point (thin shim over lib.rs)
    lib.rs              builds the Tauri app, registers state and commands
    boot.rs             the startup sequence behind the splash
    commands.rs         the #[tauri::command] bridge to the frontend
    manifest.rs         locating and parsing helve.toml
    tool.rs             tool types: declared spec vs. resolved status
    discovery.rs        joins the manifest against the filesystem
    apps/               the first-party apps' Rust halves
      mod.rs              the registry, and `invoke` routing
      home.rs             home/state, and the folder pickers
      files.rs            files/list, files/read
    project/            what a project is, and which one is open
      mod.rs              open / create / initialize / close / forget
      marker.rs           the <name>.helve manifest
      store.rs            the recents file, and what survives a restart
    error.rs            one error type, serializable across the IPC boundary
    state.rs            shared app state
  capabilities/       Tauri permissions, scoped per window label
  tauri.conf.json     window, bundle and build configuration
```

## Projects

A project is **a folder**. It becomes a *HELVE* project when it holds a
`<name>.helve` manifest — small, hand-editable TOML, meant for version control —
with a `.helve/` directory beside it for everything HELVE generates about it:
agent traces, designs, docs, the history of how the game got built. The two
cannot share one name, which is why the manifest takes the project's own name and
an extension, the way `.uproject` and `.sln` do.

A folder with no manifest still opens. That is deliberate: HELVE can be pointed at
a game that already exists, and the answer to "what happens when the `.helve`
format changes" is never "it stops opening". Home marks such a folder *not set
up* and offers to write one.

Which project is open, and the last twenty opened before it, live in
`projects.json` in the OS config directory — the only orchestrator state that
survives the process. Everything else is re-derived at boot. Opening a project
sets where the Files app starts, where a new terminal opens, and the OS window
title; the next launch restores it.

`src-tauri/src/project/` is the whole of it, and it owns no user interface: it
takes paths. Choosing a folder by pointing at one is Home's job
(`src-tauri/src/apps/home.rs`), which keeps "open this project" something a
command-line flag or a double-clicked `.helve` file could do later without a
human at the keyboard.

### Startup

The app opens on a splash window while `boot.rs` locates the manifest, reads
it, and scans the checkouts on a background thread. The main window is created
at the same time but hidden, so its webview — and every app iframe in it — is
loading throughout. When the scan finishes, the snapshot goes into `AppState`
and boot waits for each first-party app to report a painted frame; then the
main window is shown and the splash closes. The main window reads the cached
snapshot rather than scanning again.

Four things there are load-bearing and easy to break:

- **Tauri events are not replayed.** Boot can finish before the splash webview
  has registered its listener, so the splash also polls `boot_status` once on
  mount, after `listen` has resolved. Both paths are needed; neither is
  redundant.
- **A watchdog forces the handoff** ten seconds after boot reaches a terminal
  state, so a frontend bug can't strand the user on a splash that never closes.
- **The apps are waited for, not started.** They boot in parallel behind the
  splash whether anything waits or not; waiting is what stops the window being
  revealed mid-load, with a boot overlay as the first thing anyone sees.
- **That wait is bounded** at four seconds — inside the splash's own five-second
  minimum, so a timeout costs no startup time — and an app that misses it is
  logged and left behind rather than allowed to hold the window hostage.

### Shell

`Shell.tsx` is the frame: a title bar, an activity rail, the tool surface, and
a status bar. The rail is generated from the manifest, so adding a `[[tool]]`
entry puts it in the UI with no shell code change.

The switcher holds this build's own apps and nothing else. The tools are
resolved and still reported — the warning badge and its health list read the
full stack — but none of them are docked: a tool's core is a child process, the
broker that would reach it is not written, and there is no project to open one
against, so a tool tab today could only open on a state explaining why it is
empty. They come back when the broker does.

### Apps

`apps/` holds the surfaces the orchestrator ships itself: Home, Files, the file
viewer and Tutorials today. They mount in the same tool window a tool would, speak the same transport to the
shell, and import the same `@helve/bridge` — but their frontends are entry points
of *this* repo's Vite build and their Rust halves are modules in
`src-tauri/src/apps/`, reached in-process rather than over a pipe. A tool is code
the orchestrator finds; an app is code the orchestrator is. `apps/README.md` has
the full comparison and the reasoning.

How they will mount is settled, and `docs/tool-protocol.md` is the whole of
it — the wire format, and the reasoning behind each rule that has one. In short,
a tool ships a Rust core plus a React frontend, its own Tauri app is just one
host for that pair and this shell is a second, and the frontend mounts in an
iframe served from the checkout. The engine is not one of those surfaces — it is a C++
runtime with no frontend that the orchestrator starts and the tools talk to
directly.

### Tools

The protocol is built ahead of the first real tool, and `examples/echo-tool` is
what it is tested against — a complete tool in miniature, with a
`helve-tool.toml`, a core that speaks JSON-RPC over its standard streams, and a
frontend whose only host coupling is `@helve/bridge`. Copying it is the
intended way to start a tool repo.

Two transports meet in the shell. The frontend talks to the shell over window
messages; the shell talks to the core over the child process's standard
streams. Tool code sees neither: it calls `invoke("echo", …)` from the bridge
and gets an answer, under either host.

The broker that joins those two transports is not built yet — the shell's tool
surface is still blank. `crates/helve-rpc` is the shell's half of the second
transport, and `packages/bridge` is the tool's half of the first.

Adding a command: write it in `commands.rs`, register it in the
`generate_handler!` list in `lib.rs`, then add a typed wrapper in
`src/bindings.ts`. The TypeScript types there are a hand-maintained mirror of
the Rust structs — keep them in sync.

## The stack

HELVE is deliberately **multi-repo**, not a monorepo — each piece below is
its own repository, tagged with the `helve` and `helve-stack` topics on
GitHub so they cluster together. This repo (`helve`) is the one that ties
them together at runtime; it doesn't contain their code.

| Repo | What it is | Ships with a game? | Status |
|---|---|---|---|
| helve-engine | Runtime core (Rust) — lighting, audio playback, spatial audio built in | **Yes** | Closed source, not published |
| [helve-forger](https://github.com/Firelight-Innovations/helve-forger) | Technical design software — specs out the stack and its boundaries | No | Placeholder — README only |
| [helve-journeyman](https://github.com/Firelight-Innovations/helve-journeyman) | Game design software — design prototyping, rough playable systems | No | Placeholder — README only |
| [helve-turner](https://github.com/Firelight-Innovations/helve-turner) | Procedural art system — generates art from an artist's rough shape | No | Placeholder — README only |
| [helve-scrivener](https://github.com/Firelight-Innovations/helve-scrivener) | Narrative/dialogue authoring tool | No | Placeholder — README only |
| [helve-quickener](https://github.com/Firelight-Innovations/helve-quickener) | NPC behavior / AI tooling | No | Placeholder — README only |
| [helve-wright](https://github.com/Firelight-Innovations/helve-wright) | Audio authoring/composition tooling | No | Placeholder — README only |

**Only this repository has code in it today.** The other six are a `v0.1.0` tag
against a README — which is what `helve.toml` pins, and why the shell's own
health list reports them as `unversioned` rather than matching the pin. The pin
is a placeholder holding a shape, not a release, and the intent below is the
plan rather than a description of something already happening.

`helve-engine` is closed source and stays that way. That is the open-core line:
the tool protocol is the boundary, everything on this side of it is Apache-2.0,
and the engine sits on the other side along with the other first-party tools
that will be commercial.

Each repo is meant to cut tagged semantic-version releases (`v0.1.0`, ...)
rather than tracking a floating branch tip, and `helve` pins to specific tagged
versions of each component, not to branch heads.

## License

HELVE is Apache-2.0. The full text is in [LICENSE](LICENSE), and
[NOTICE](NOTICE) is the file a redistributor has to carry with it.

Apache rather than MIT because of the patent grant, which matters here
specifically: a commercial engine loads into this shell through the tool
protocol, and MIT says nothing about patents at all. Not GPL or AGPL under any
circumstances — a copyleft core hands someone a real argument that the private
tools mounting into it are derivative works.

The license covers the code and not the names. HELVE, Forger and Journeyman, and
the marks that go with them, are trademarks of Firelight Innovations. Fork this,
sell what you build on it, and say plainly that your work is based on HELVE —
all of that is fine. Shipping it *as* HELVE is not. `NOTICE` says why at length;
the short version is that once the source is freely copyable, the name is the
only thing left telling a user which build is executing tools on their machine.
