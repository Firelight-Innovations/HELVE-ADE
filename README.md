# Helve

The entry point for the Helve stack. Organizes and loads the dev tools and
holds the shared baseline code that glues everything together and gets the
stack running.

Each dev tool may end up integrated as something like a separate web app
loaded into this — exact approach still being worked out, as is how engine
building fits in.

This is a development tool; it does not ship with games built on Helve.

Status: pre-alpha. The shell frame runs and reports the stack; the tool surface
is blank and the tools themselves are not yet integrated. Projects don't exist
yet either — the picker comes before the tools do.

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

Other useful commands:

```sh
cargo test    --manifest-path src-tauri/Cargo.toml
cargo clippy  --manifest-path src-tauri/Cargo.toml   # Rust linter
cargo fmt     --manifest-path src-tauri/Cargo.toml   # Rust formatter
```

Note there is no separate "build the frontend" step for running the app.
`pnpm build` and `pnpm dev` are only the frontend half; `tauri.conf.json` invokes
them via `beforeDevCommand` / `beforeBuildCommand`. Use the two `app` scripts.

### Release builds

```sh
pnpm app:build
```

Compiles the frontend to static files, embeds them in an optimized binary, and
produces installers. Takes a few minutes — the release profile has no cheap
incremental rebuild. Artifacts land in `src-tauri/target/release/`:

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

```
helve.toml            stack manifest — pinned component versions
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
    error.rs            one error type, serializable across the IPC boundary
    state.rs            shared app state
  capabilities/       Tauri permissions, scoped per window label
  tauri.conf.json     window, bundle and build configuration
```

### Startup

The app opens on a splash window while `boot.rs` locates the manifest, reads
it, and scans the checkouts on a background thread. When that finishes the
snapshot goes into `AppState`, the main window is shown, and the splash closes.
The main window reads the cached snapshot rather than scanning again.

Two things there are load-bearing and easy to break:

- **Tauri events are not replayed.** Boot can finish before the splash webview
  has registered its listener, so the splash also polls `boot_status` once on
  mount, after `listen` has resolved. Both paths are needed; neither is
  redundant.
- **A watchdog forces the handoff** ten seconds after boot reaches a terminal
  state, so a frontend bug can't strand the user on a splash that never closes.

### Shell

`Shell.tsx` is the frame: a title bar, an activity rail, the tool surface, and
a status bar. The rail is generated from the manifest, so adding a `[[tool]]`
entry puts it in the UI with no shell code change.

The tool surface is **intentionally blank**. Each tool is separate software in
its own repo and none are integrated yet, and there is no project to open them
against. See the comment in `ToolSurface.tsx` for what that seam has to
support — notably that the authoring tools are web apps but the engine is a
native GPU surface, which is a different hosting mechanism entirely.

Adding a command: write it in `commands.rs`, register it in the
`generate_handler!` list in `lib.rs`, then add a typed wrapper in
`src/bindings.ts`. The TypeScript types there are a hand-maintained mirror of
the Rust structs — keep them in sync.

## The stack

Helve is deliberately **multi-repo**, not a monorepo — each piece below is
its own repository, tagged with the `helve` and `helve-stack` topics on
GitHub so they cluster together. This repo (`helve`) is the one that ties
them together at runtime; it doesn't contain their code.

| Repo | What it is | Ships with a game? |
|---|---|---|
| [helve-engine](https://github.com/Firelight-Innovations/helve-engine) | Runtime core (Rust) — lighting, audio playback, spatial audio built in | **Yes** |
| [helve-forger](https://github.com/Firelight-Innovations/helve-forger) | Technical design software — specs out the stack and its boundaries | No |
| [helve-journeyman](https://github.com/Firelight-Innovations/helve-journeyman) | Game design software — design prototyping, rough playable systems | No |
| [helve-turner](https://github.com/Firelight-Innovations/helve-turner) | Procedural art system — generates art from an artist's rough shape | No |
| [helve-scrivener](https://github.com/Firelight-Innovations/helve-scrivener) | Narrative/dialogue authoring tool | No |
| [helve-quickener](https://github.com/Firelight-Innovations/helve-quickener) | NPC behavior / AI tooling | No |
| [helve-wright](https://github.com/Firelight-Innovations/helve-wright) | Audio authoring/composition tooling | No |

Each repo cuts tagged semantic-version releases (`v0.1.0`, ...) rather than
tracking a floating branch tip. `helve` pins to specific tagged versions of
each component, not to branch heads.
