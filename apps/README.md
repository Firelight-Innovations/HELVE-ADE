# Apps

The surfaces the orchestrator ships itself.

An app and a tool look identical in the shell — a tab in the switcher bar, an
iframe in the tool window, `@helve/bridge` in the frontend. The difference is
where the two halves come from, and it decides everything else:

| | Tool | App |
|---|---|---|
| Lives in | its own repository, cloned beside this one | `apps/` in this repo |
| Frontend built by | its own Vite project | this repo's `vite.config.ts` |
| Frontend served from | its dev server, or `helve-tool://` | the shell's own origin |
| Rust half | a child process, over the standard streams | a module in `src-tauri/src/apps/` |
| Can be | missing, unbuilt, the wrong version | none of those — it is in the binary |

So a tool is code the orchestrator *finds*, and an app is code the orchestrator
*is*. Home and Files are apps because what they show is what the orchestrator
already owns: the stack it resolved at boot, the checkout it was pointed at, the
project it will one day open. Putting a process boundary between the shell and a
program that would only ask the shell for all of that again is shipping an IPC
hop in order to talk to ourselves.

`docs/tool-protocol.md` is still the contract for the half that matters to the
frontend. An app's UI calls `invoke("files/list")` through the bridge exactly as
the echo tool's UI calls `invoke("echo")`, and neither knows which kind of host
answered — which is what would let an app be extracted into a tool repo later, or
a tool be absorbed, without its interface code changing.

## Layout

```
apps/
  shared/app.css        the chrome every app draws inside
  home/ui/              Home's frontend
  files/ui/             Files' frontend
```

Each app's Rust half lives in `src-tauri/src/apps/<id>.rs`, and
`src-tauri/src/apps/mod.rs` is the registry that names it, describes it for the
switcher, and routes `invoke` to it. Adding an app means one entry there and one
`index.html` here — plus a line in `vite.config.ts`, which is the one piece that
cannot be inferred (Vite has to be told about every HTML entry point, or it
silently builds none of it).

There is no `package.json` under `apps/`. These are entry points of the
orchestrator's own frontend build, not workspace packages: `apps/home/ui/
index.html` is built to `dist/apps/home/ui/index.html` and served from there, so
one URL works under the Vite dev server and under Tauri's asset host alike.

## Running them

Nothing extra. `pnpm app` serves the apps from the same Vite server it serves the
shell from, and `pnpm dev:agent` does the same in a plain browser — where
`?fake=1` mounts the real app frontends and completes the real handshake.

Their `invoke` calls have no Rust to reach there, so `fakeAppCall` answers a
chosen few of them from a fixture: Home's read and list methods, so its layout
can be measured in a browser in each of its states. Everything else — Files, and
the three actions that open a *native folder picker* — is refused with `-32603`
and the app renders its failure path. That line is drawn on purpose: a fixture
that answered a picker would have to invent a folder the user never chose, and a
fixture disagreeing with the backend in the direction of looking healthier is
worse than no fixture at all.

## The two apps

**Home** (`home/state`, plus the project verbs) — where a session starts: New,
Open and Clone on the left over a Recent list, tutorials on the right. It is the
one app the shell opens on, which is stated in `ShellState::default` rather than
left to whichever tab seeded first.

Two things there are worth knowing. Clone is deliberately inert — cloning is a
git operation with progress, auth and partial-checkout failure, and this repo has
git work in flight on its own branch that the real one is built on rather than
beside; the method exists and refuses, and the button says "soon". And the
tutorials column is drawn but dead: the column is part of the layout, and an
empty half-screen reads as a bug where three cards marked "soon" do not.

The rules about what a project *is* are not here. They live in
`src-tauri/src/project/`, which takes paths and never opens a dialog — see the
README at the repo root.

**Files** (`files/list`, `files/read`) — a directory on the left, the selected
file's text on the right. No editing, no search, no highlighting, no watching for
changes on disk; each of those is worth deciding on its own rather than falling
out of a scaffold. Reads are capped at 256 KiB and say so when they truncate.
