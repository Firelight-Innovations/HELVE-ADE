# HELVE orchestrator — working agreements

## Dev servers: 1420 is the human's, agents use their own

Port **1420 is reserved for `pnpm app`** (`tauri dev`), which Braden runs to verify work. Tauri
starts Vite itself and points the webview at a fixed URL, so that port cannot move and cannot be
shared — anything else holding it fails the whole run rather than degrading.

**If you are an agent and need a browser to verify something, run `pnpm dev:agent`.** It serves the
same app from port 1430, and `strictPort` is off for that mode, so a second and third agent step up
to 1431 and 1432 instead of colliding. Read the port Vite prints; don't assume 1430.

There is no way to run the shell without a Tauri backend under it. `pnpm dev:agent` serves the same
files, so the shell mounts and its layout can be measured, but every call into Rust fails — no
stack, no apps, no terminals, no project. The `?fake=1` fixture that used to answer those calls has
been removed; anything that needs a real backend goes to Braden.

**Never run `pnpm app`, `pnpm dev`, or `tauri dev`** unless you are Braden. Two failure modes, both
seen repeatedly:

- `pnpm dev` takes 1420 and the next `pnpm app` dies with `EADDRINUSE`.
- `tauri dev` exits without reaping its Vite child, orphaning a `node` process that holds 1420
  until it is killed by pid. Stopping the task is not enough — it kills the wrapper, not the child.

Do not kill a process on 1420 to make room for yourself. It is either Braden's running app or
another agent's; ask instead.

## Asking a running HELVE what it is doing

**`pnpm probe` reads the live app.** It talks to the `helve-debug` MCP server the orchestrator
hosts, and works from any terminal — you do not have to be inside HELVE, and nothing has to be
launched or restarted:

```sh
pnpm probe                    # list the tools
pnpm probe shell_snapshot     # windows, clusters, pane trees, instances, terminals — live
pnpm probe recent_errors      # what has failed since launch, backend and webview
pnpm probe boot_status        # how far startup got, and whether it gave up
```

It finds the port and token in `%APPDATA%\com.firelightinnovations.helve\mcp-endpoint.json`, which
`mcp::handoff` writes at every launch, and it refuses a file whose pid is no longer running rather
than talking to whatever took the port afterwards. If it says HELVE has exited, HELVE has exited —
ask Braden to start it.

Two limits worth knowing before you read a result:

- **Every tool is a read.** Nothing here opens, closes or moves anything, deliberately. To *change*
  the running app, ask Braden.
- **Errors inside an app's iframe are not captured**, only the shell's and the backend's. An empty
  `recent_errors` means nothing went wrong *in those two places*. Every answer repeats this in its
  `covers` field; do not report it as "no errors" without the qualifier.

This does not replace looking at the screen. For that, see below.

## Seeing and clicking the UI: `pnpm ui`

**`pnpm ui` drives HELVE's real interface** — screenshots, DOM, and real mouse and keyboard input —
by talking Chrome DevTools Protocol to the WebView2 the app already runs. Not a browser serving the
frontend: the real shell with the real Rust backend under it.

```sh
pnpm ui:build                 # once — builds an agent-owned binary (own identifier)
pnpm ui launch                # start it with the debug port open
pnpm ui snapshot              # every interactive element, with a ref and a position
pnpm ui click e12             # click a ref, or any CSS selector
pnpm ui type "hello"          # type into whatever has focus
pnpm ui key Enter
pnpm ui shot out.png          # screenshot — then Read the file to actually look at it
pnpm ui eval "document.title"
pnpm ui close
```

`snapshot` walks into app iframes, so `e19 app button (305,301) New Project` is Home's own content,
not the shell's. Refs are renumbered by every `snapshot` — take a fresh one before clicking.

Three things to know:

- **It launches its own instance**, built by `pnpm ui:build` with the identifier
  `com.firelightinnovations.helve.agent`. That is what lets it run beside a HELVE Braden started
  without single-instance swallowing it. It gets a private `%APPDATA%` tree, so it starts empty and
  cannot corrupt his layout or project list.
- **Never point this at a build a user is running.** `withGlobalTauri` is on and `csp` is null, so
  anything holding the debug port can call every `#[tauri::command]` through
  `window.__TAURI__.core.invoke`. The port only opens for a process deliberately launched with the
  environment variable, and it must stay that way.
- **Avoid clicking anything that opens a native dialog** — folder pickers and the like block the
  webview, and the session stops responding until someone dismisses it by hand. `New Project`,
  `Open Project` and `Clone Project` on the Home screen are the ones to leave alone.

`pnpm ui console` only reports what is logged while it is listening; CDP keeps no backlog. For
failures that already happened, `pnpm probe recent_errors` is the one that remembers.

## Verification

**Every commit and every pull request must pass all four checks. No exceptions, and none of them
are advisory.** One command runs the lot:

```sh
pnpm verify     # build -> test -> lint -> format:check
```

| Check | Command | Covers |
|---|---|---|
| Build | `pnpm build` | runs `tsc` first, so this covers types |
| Tests | `pnpm test` | 28 vitest + 212 `cargo test`, all currently passing |
| Lint | `pnpm lint` | ESLint, clippy, comment density |
| Format | `pnpm format:check` | Prettier and rustfmt; `pnpm format` applies |

`pnpm test` is both halves — `pnpm test:js` for the workspace packages, `pnpm test:rust` for
`cargo test --workspace`. Run the whole thing before you claim a change is done. A build that
compiles is not a change that works.

### While you are iterating, use `pnpm verify:fast`

```sh
pnpm verify:fast    # 17s, vs 33s for the full pnpm verify
```

It swaps `pnpm build` for `pnpm typecheck`, which builds the three workspace packages and runs
`tsc` but skips `vite build` and `generate:icons`. `vite build` alone is 21 of the full run's 33
seconds, and `generate:icons` wipes and rewrites 1115 files in `public/icons/material/` — two
agents running it at once race and produce a phantom failure.

**`verify:fast` is for the inner loop only. The last run before you commit must be the full
`pnpm verify`.** Skipping the bundle means skipping the one check that catches:

- a new app missing its entry in `vite.config.ts` — STANDARDS.md §3 warns that this is the one
  piece that cannot be inferred, and the app *silently* does not build;
- assets referenced from CSS or HTML that fail to resolve;
- anything that type-checks but cannot be bundled, such as a bad dynamic import.

None of those are type errors, so `tsc` passing tells you nothing about them.

**A failing test is never fixed by deleting or skipping the test.** If a test is genuinely wrong,
say so and explain why in the commit message rather than quietly removing it. Per STANDARDS.md §8,
a bug fix arrives with the test that would have caught it — that is the one test rule described as
non-negotiable.

The three lint baselines (`eslint-suppressions.json`, `clippy-baseline.json`,
`comment-baseline.json`) grandfather violations that predate the linters. They are ratchets: they
may shrink and may not grow. **Never run `pnpm baseline` to make a check pass** — it regenerates
all three and would absorb your new violation, which is the exact thing they exist to prevent. Fix
the code instead.

Chrome measurements go through the `mcp__claude-in-chrome__*` tools against `pnpm dev:agent`.

A minimized or occluded Chrome window reports `document.visibilityState === "hidden"`, and in that
state `requestAnimationFrame` never fires and `getBoundingClientRect()` silently returns **stale**
layout. Check `visibilityState` first and take a screenshot before measuring — it forces a layout
pass. Never report a measurement taken in a hidden window as passing.

## Editing source

Use the `Edit` tool. Do **not** rewrite files with PowerShell
(`Get-Content | -replace | Set-Content`) — Windows PowerShell 5.1 reads as ANSI, so every em-dash in
this codebase's comments is silently corrupted and written back as valid UTF-8 mojibake. `cargo
check` and `tsc` both pass on the corruption; only reading the file catches it.
