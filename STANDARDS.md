# Standards

How code in this repository is expected to look and where it is expected to
live. This is the document a linter rule points at when it fails, and the one a
review comment cites instead of relitigating a preference.

Most of what follows is descriptive: it was already true before it was written
down, and the examples are drawn from code in the repo. Where a rule is
aspirational rather than current practice, it says so.

---

## 1. Layering — what may import what

The repository has one hard rule and it is the one everything else rests on.

**Rust owns everything that touches the machine. The frontend is a view.**

Reading the manifest, resolving checkouts against the filesystem, spawning
processes, opening PTYs, persisting shell state — all of it is Rust. The
frontend never reads a path, never shells out, never decides what is on disk. It
renders a snapshot Rust produced and sends verbs back.

The layers, outermost to innermost:

```
src/shell/*             regions of the interface     ─┐
src/shell/contract.ts   the interface's own vocabulary │ frontend
src/bindings.ts         the only door to Rust         ─┘
        │  (Tauri IPC, JSON)
src-tauri/src/commands.rs   the only door from the frontend  ─┐
src-tauri/src/apps/*        first-party app backends          │ backend
src-tauri/src/*             state, discovery, project, pty    ─┘
        │  (JSON-RPC over stdio)
crates/helve-rpc            the transport, both halves       ─┐
crates/helve-tool-manifest  what a tool declares              │ protocol
docs/tool-protocol.md       the contract itself              ─┘
```

Rules that follow from it:

1. **No component imports `@tauri-apps/api` directly.** `src/bindings.ts` is the
   only file that calls `invoke` or `listen`. A component that needs backend data
   calls a typed wrapper there, and if the wrapper does not exist yet, the fix is
   to add one — not to reach past it.
2. **No region imports another region's source.** The sixteen shell regions are
   built against `src/shell/contract.ts` and nothing else. They receive what they need
   as props typed there and hand back what they produce the same way. This is
   what lets them be worked on in parallel without growing into each other.
3. **The protocol crates depend on nothing above them.** `helve-rpc` and
   `helve-tool-manifest` are consumed by this repo *and* by every tool
   repository. They must not learn about the orchestrator. If a change to one of
   them would only make sense to the orchestrator, it belongs in `src-tauri/`.
4. **Apps reach the shell only through the bridge.** An app's frontend calls
   `invoke` from `@helve/bridge` exactly as a tool's does, and neither knows
   which kind of host answered. That symmetry is deliberate: it is what would let
   an app be extracted into its own tool repo later, or a tool absorbed into
   this one, without its interface code changing.

Rule 2 is enforced by ESLint (§10), with the 23 imports that already crossed a
region boundary grandfathered. The region list lives in `eslint.config.js` and
has to be extended by hand when a directory is added under `src/shell/`.

---

## 2. The two doors

Two files exist purely to be chokepoints. Their value is entirely in being the
*only* way through, so adding a bypass — even a small, obviously-fine one —
costs more than the bypass saves.

### `src/bindings.ts` — the backend boundary

Every Tauri command has exactly one typed wrapper here, and every type here
mirrors a `#[derive(Serialize)]` struct on the Rust side. The mirroring is
hand-maintained on purpose while the command surface is still moving; each type
carries a `Mirrors \`module::Type\`` comment naming its Rust counterpart, and
changing one without the other is the defect this convention exists to make
obvious.

Everything crossing this boundary is plain data. No classes, no functions, no
`Date`, no `Map` — it is JSON on the wire and the types should not pretend
otherwise.

Note also the naming asymmetry it hides: Rust command names stay `snake_case`
when invoked from JS, but their *arguments* arrive `camelCase`. Wrappers absorb
that so no caller has to remember it.

### `src/shell/contract.ts` — the interface boundary

The shell's own vocabulary, deliberately narrower than the backend's. Two rules
are enforced by the shape of the types rather than written down and hoped for:

- **No version number reaches the interface.** `ToolPresentation` has no version
  field, and `toolPresentation()` is the only way to turn a `ResolvedTool` into
  something renderable. A component that wants a version has to go out of its way
  to get one.
- **No backend vocabulary reaches the interface.** The backend's states are
  `ready | mismatch | unversioned | missing`; a person reads "needs update",
  "not tracked", "not installed". That mapping happens once, in `healthOf`.

When adding to this file, prefer the narrower type. The question is not "what
does the backend know" but "what is a component *allowed* to know" — and the
answer is usually less than you first reach for.

---

## 3. Apps and tools

The distinction is in `apps/README.md` and is worth restating because it decides
where new code goes:

> A tool is code the orchestrator *finds*. An app is code the orchestrator *is*.

| | Tool | App |
|---|---|---|
| Lives in | its own repository | `apps/` in this repo |
| Rust half | a child process, over stdio | a module in `src-tauri/src/apps/` |
| Can be missing or the wrong version | yes | no — it is in the binary |

**Write a new surface as an app when what it shows is something the orchestrator
already owns.** Home and Files qualify: the stack resolved at boot, the checkout
it was pointed at, the open project. Putting a process boundary between the shell
and a program that would only ask the shell for all of that again is shipping an
IPC hop to talk to ourselves.

**Write it as a tool when it has its own domain, its own release cadence, or
needs to ship separately from the orchestrator.** Everything in `helve.toml` is
a tool for one of those three reasons.

Adding an app means three edits and no more: a registry entry in
`src-tauri/src/apps/mod.rs`, an `index.html` under `apps/<id>/ui/`, and a line in
`vite.config.ts`. The Vite entry is the one piece that cannot be inferred — miss
it and the app silently does not build.

Every app owes the shell one call: `reportPainted()` from `@helve/bridge`, once
its first meaningful content is committed to the DOM. The right moment is the
*content*, not the fetch that produced it. An error state counts.

---

## 4. Comments and prose

This is the convention most likely to surprise a new contributor, so it is stated
plainly: **this codebase explains itself in prose, and the prose explains *why*,
not *what*.**

Concretely:

1. **Every module opens with a doc comment** — `//!` in Rust, a `/** */` block in
   TypeScript — that says what the module is *for* and what seam it sits on. Not
   a restatement of its name.
2. **Record the alternative you rejected and why.** This is the highest-value
   comment in the repo and there are dozens of them. From `apps/README.md`:
   putting a process boundary between the shell and Home was considered and
   rejected, and the reasoning is preserved. Someone will reconsider that
   decision in a year, and the comment is what stops them relitigating it from
   scratch.
3. **Document what is deliberately absent.** `ToolPresentation` says which fields
   it does not have and why. `AppInfo` says why it has a `url` where a tool does
   not, and why it has no `status`. Absence is a decision, and an undocumented
   decision reads as an oversight.
4. **Explain non-obvious mechanics at the point of use.** `bootStatus()` carries
   a paragraph on why it exists at all — Tauri events have no replay buffer, so a
   listener registered after boot emitted never sees that event. Nobody would
   reconstruct that from the signature.
5. **Say when something is safe to call twice, capped, or lossy.** `loadStack`
   documents that it doubles as refresh. `finishBoot` documents that repeat calls
   are safe. Files documents its 256 KiB read cap.

What not to write: comments that restate the line below them, `// TODO` without a
name or a condition for removal, and commented-out code. Delete it; git has it.

**Tone.** Plain declarative sentences. It is fine to be blunt about a limitation
("Clone is deliberately inert", "the tutorials column is drawn but dead"). It is
not fine to be vague about one.

---

## 5. Rust

### Errors

`thiserror` is a workspace dependency and is the default. Follow
`crates/helve-tool-manifest`:

- One error enum per crate or per bounded domain, with `#[derive(Error)]`.
- `#[error("...")]` messages name the thing that failed and the value that caused
  it: `#[error("invalid tool id {id:?}: must match ^[a-z][a-z0-9-]*$")]`. A
  message a user can act on, not a category.
- Wrap the underlying cause with `source` rather than stringifying it.
- The orchestrator has one `AppError` in `src-tauri/src/error.rs` and a `Result`
  alias; commands return that, not `Box<dyn Error>` and not `String`.

**No `unwrap()` or `expect()` on anything that depends on the filesystem, a
process, or user input.** They are acceptable for genuine invariants — a
regex literal compiling, a mutex you own — and those cases should carry a comment
saying which invariant is being asserted.

### Modules

- Private modules, flat public re-exports. `crates/helve-rpc/src/lib.rs` declares
  `mod codec; mod host; mod tool;` and re-exports the public surface in one
  place, so a consumer imports `helve_rpc::ToolProcess`, not
  `helve_rpc::host::ToolProcess`. That keeps internal file organization free to
  change without breaking anyone.
- `src-tauri/src/lib.rs` lists its modules alphabetically. Keep it that way.

### Commands

Every `#[tauri::command]` lives in `src-tauri/src/commands.rs` and carries a doc
comment describing what it does and any repeat-call semantics. Commands should be
thin — resolve arguments, call into the module that owns the logic, return. Logic
in a command is logic that cannot be tested without Tauri.

---

## 6. TypeScript

`tsconfig.json` runs `strict`, `noUnusedLocals`, `noUnusedParameters`, and
`noFallthroughCasesInSwitch`. Those are the floor, not the standard.

1. **No `any`.** `unknown` at boundaries, narrowed immediately. `appCall` returns
   `Promise<unknown>` for exactly this reason.
2. **Discriminated unions over optional fields.** `ToolStatus` and `BootStatus`
   both use an internal tag — narrow on `status.state` and the right fields
   appear. Prefer this to a struct where half the fields are `| undefined`.
3. **`type` for unions and mirrors, `interface` for object shapes.** This is what
   the existing code does; consistency matters more than the merits.
4. **CSS lives next to the component that uses it**, named for it —
   `explorer/explorer.css`, `tabs/tabs.css`. Design tokens live in
   `src/tokens.css` and are referenced as `var(--warn)`, never as literal colors
   in a component.
5. **Hooks starting with `use` own state and effects; everything else is pure.**
   `useTree`, `useOpenFiles`, `useVirtualRows` are the pattern.

---

## 7. Naming and layout

- Rust: `snake_case` files and functions, `PascalCase` types, crates as
  `helve-<thing>`.
- TypeScript: `PascalCase.tsx` for components, `camelCase.ts` for everything
  else, `PascalCase` for types.
- Tool and app ids match `^[a-z][a-z0-9-]*$` — enforced by
  `helve-tool-manifest` and worth matching for anything id-shaped.
- RPC methods are `namespace/verb`: `files/list`, `files/read`, `home/state`.
- Directories are singular when they hold one concept (`viewer/`, `explorer/`)
  and plural when they hold many of a kind (`apps/`, `crates/`, `icons/`).

---

## 8. Tests

**Every commit and every pull request must pass all tests.** `pnpm test` runs
both halves; `pnpm verify` runs tests alongside the build, the linters and the
formatters. A failing test is never fixed by deleting or skipping it.

What exists today — 240 tests, all passing:

| Where | Count | Runner |
|---|---|---|
| `src-tauri/src/**` | 183 | `cargo test` |
| `crates/helve-rpc` | 15 | `cargo test` |
| `crates/helve-tool-manifest` | 11 | `cargo test` |
| `examples/echo-tool` | 3 | `cargo test` |
| `packages/bridge` | 28 | vitest |

The protocol layer is covered because it is a published contract. The state
machines are now covered too: `shell_state.rs` has 35 tests, `layout.rs` has 32,
`shell_store.rs` has 11.

What is expected going forward:

1. **Anything in `crates/` needs tests.** Other repositories depend on these. A
   change without a test is a change no tool author can trust.
2. **State machines get unit tests before they grow.** This was aspirational when
   first written and is now largely true; keep it that way. New state transitions
   arrive with `#[cfg(test)]` coverage in the same commit.
3. **Pure functions in the frontend get vitest coverage** — `toolPresentation`,
   `healthOf`, the layout math. Components do not need render tests yet; that is
   a deliberate omission, not an oversight.
4. **A bug fix comes with the test that would have caught it.** This is the only
   test rule that is non-negotiable.

---

## 9. What "done" means

Before a pull request is ready:

1. **`pnpm verify` passes.** This is the whole mechanical gate, and it is not
   optional for any commit or pull request. It runs, in order:

   | Step | Covers |
   |---|---|
   | `pnpm build` | `tsc` runs first, so this covers types |
   | `pnpm test` | all 240 tests, both runners (§8) |
   | `pnpm lint` | ESLint, clippy, comment density (§10) |
   | `pnpm format:check` | Prettier and rustfmt |

2. New modules have doc comments; new decisions have their rejected alternative
   recorded.
3. If it touches `docs/tool-protocol.md`, `src/bindings.ts`, or
   `src/shell/contract.ts`, the PR description says so explicitly. Those three
   are contracts other code and other repositories are built against.

Item 1 is mechanical and belongs in CI; once that workflow lands
(`docs/open-source-plan.md` phase 3) this list shortens to items 2 and 3. Until
then it is on whoever opens the PR, which is why it is one command.

---

## 10. What is enforced, and how

Formatters and linters are configured. `rustfmt`, Prettier, `clippy` and ESLint
all run, and `pnpm lint` is the single command that runs the three checks.

| Rule | Enforced by |
|---|---|
| §1.1 only `bindings.ts` may call Tauri | ESLint `no-restricted-imports` |
| §1.2 region isolation | ESLint, one config block per region |
| §1.4 apps reach the bridge via `@helve/bridge` | ESLint `no-restricted-imports` |
| §4.1 module doc comments | `missing_docs`, in `crates/*` only |
| §5 no `unwrap`/`expect` | `clippy::unwrap_used`, `expect_used` |
| §5 flat public re-exports | `unreachable_pub`, in `crates/*` only |
| §6.1 no `any` | `@typescript-eslint/no-explicit-any` |
| §6.3 `type` vs `interface` | `consistent-type-definitions` |
| §6.5 hooks own state | `react-hooks/rules-of-hooks` |
| comment concentration | `scripts/check-comments.mjs` |

Two of those are narrower than they look. `missing_docs` and `unreachable_pub`
are set in `crates/*/src/lib.rs`, not workspace-wide, because both are about a
*published surface* — what another repository imports and has to understand.
`src-tauri` has no such surface; its `pub` items exist to cross module
boundaries inside one binary. Applying them everywhere produced 1115 warnings,
816 of them against `src-tauri` alone.

### Baselines

Every rule above was switched on against a codebase written without it, so all
three checks are **ratchets** rather than gates. Existing violations are
recorded; the check fails when a count goes up, not when it is non-zero.

| File | Holds |
|---|---|
| `eslint-suppressions.json` | 43 findings, ESLint's own bulk-suppression format |
| `clippy-baseline.json` | 298 warnings, per file and lint |
| `comment-baseline.json` | 106 files above the density caps |

The rule for all three is the same: **a baseline may shrink, and may not grow.**
Adding a violation to a file that already has some still fails, because the
count is per file and per rule. After a cleanup pass, `pnpm baseline` rewrites
all three and the diff shows exactly what was paid down.

Re-baselining to make a check pass is a decision, not a formality. If a new
violation is genuinely correct, the honest move is usually to change the rule
and say why here, rather than to widen the baseline silently.

### Still not enforced

- The `src/bindings.ts` mirroring (§2) is checked by nobody; `tauri-specta`
  could generate the file once the command surface stops moving.
- Nothing enforces the RPC method naming convention (§7).
- Prettier and `rustfmt` are not wired to a pre-commit hook, so formatting is
  checked (`pnpm format:check`) but not applied automatically.

Each is a candidate rule for the architecture checker in
`docs/open-source-plan.md`. A rule that can be stated precisely enough to appear
in this section is a rule that can be mechanized.
