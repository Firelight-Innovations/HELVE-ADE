# Wiring wave handoff — the swap

Branch `schematify/wiring`, off `main` at `3a30391` (after wave 3's engine
merged). This wave connects the application to `crates/schematify-core`
through the seam every earlier wave was told to read the graph through, per
`docs/overnight-jobs/overnight-2/00-AGENT-CONTEXT.md`.

## What was built

### Rust: `src-tauri/src/apps/schematify.rs`

Six JSON-RPC methods on Schematify's one dispatch function — no new Tauri
command, no `generate_handler!` line, no `bindings.ts` wrapper, per
`docs/audits/schematify-baseline.md` §11 and `home.rs`'s own pattern. Every
method requires an `actor: "human" | "agent"` parameter and refuses a call
missing or misusing it (decision SCH-API-003) — parsed and validated, but
not yet fed to a policy, since none of these six reach a lifecycle
transition. `src-tauri/Cargo.toml` gained one dependency,
`schematify-core = { path = "../crates/schematify-core" }`.

| Method | Params | Does |
|---|---|---|
| `schematify/state` | — | Unchanged, wave 1a's. |
| `schematify/open-project` | `actor` | Reports the cluster's project root and whether `.kaava/` exists under it. Read-only — does not call `Store::init()`. |
| `schematify/load-graph` | `actor` | `load_project`, shaped by hand into `{ graph: { nodes, edges, screens, flows, decisions, rules, libraries, brief }, report: { clean, quarantined, unreadable, slugCollisions, idCollisions, misnamed, durationMs } }`. Hand-shaped because `Graph` and `Report`'s own sub-types (`Quarantine`, `IdCollision`, …) carry no `Serialize` — the crate is a library, not a wire format. |
| `schematify/write-node` | `actor`, `node` | Deserializes `node` as `schematify_core::Node` (whole envelope + kind fields) and writes it via `Store::write_node`. |
| `schematify/write-edge` | `actor`, `edge` | Same, for `Edge`. Reports `stored: false` for a `contains` edge, which the crate refuses to write at all. |
| `schematify/write-layout` | `actor`, `slug`, `layout` | Writes `layout/<slug>.json` **verbatim**, not through `schematify_core::Layout`/`Placement` — see "The layout mismatch" below. |
| `schematify/read-layout` | `actor`, `slug` | Reads the same file back verbatim, or `null` if it does not exist. Not one of PRD §14.5's ten — added because a write-only seam cannot serve `openSchematic`, which reads a layout before drawing anything. |

**Left undone, and why:** `schematify_transition` (needs `write_transition`
plus real actor-gated lifecycle policy — a bigger, separate piece of work
than wiring), `schematify_lint` (the linter is wave 7's, not built),
`schematify_ingest_run` and `schematify_search` (nothing on the front end
calls either yet), `schematify_reconcile_status` (same). All five depend on
machinery this wave did not build; wiring a method to nothing would be
guessing, not connecting.

13 new Rust tests in `schematify.rs`, each asserting written content (a
reader gets back what was sent) rather than only "did not throw" — including
one that round-trips a layout file carrying fields `schematify_core::Layout`
cannot hold, to pin the deliberate mismatch below. `cargo test --workspace`:
811 passed, 1 pre-existing ignored (`github::live::fetches_a_real_repository`),
0 failed. `clippy`: 0 warnings, at the baseline of 0.

### The layout mismatch — read this before touching layout persistence

`schematify_core::Layout`/`Placement` (PRD §5.10, minimal reading: position
and size, keyed by id string) do not match
`apps/schematify/ui/src/graph/layout.ts`'s `LayoutFile` — what wave 3's
engine actually reads and writes. `LayoutFile` also carries a `version`, a
combined `{x, y, zoom}` viewport (the crate splits `zoom` and `pan`
separately), and whole `LayoutAnnotation` records for groups and comments
(`title`, `author`, `body`) that `Placement` has nowhere to put.

Rather than lossily reshape one to fit the other (which would silently drop
every comment body on the first real write), `schematify/write-layout` and
`schematify/read-layout` write and read the frontend's JSON **verbatim**,
through the same atomic writer `Store` itself uses
(`schematify_core::write_json_atomic`), at the same path
`Store::layout_path` computes. This is documented at the function and pinned
by a round-trip test. Reconciling the two types is a wave 3/crate decision,
not this wave's to make silently.

## Front end: the fixture is replaced behind the seam

`apps/schematify/ui/src/graph/index.ts`'s `defaultSeam` — what
`engine/index.ts`'s `openSchematic` uses when `App.tsx` calls it with no seam
argument, i.e. what the running application actually uses — now resolves to
a real backend instead of `createMemorySeam()`. Three new/changed files, all
inside the seam (`graph/`):

- **`graph/project.ts`** (new). Projects the whole-project graph
  `schematify/load-graph` returns down to the one-service `ServiceGraph`
  shape `./types.ts` still defines (Wave 2's placeholder — no tier switch
  exists yet, PRD §17 Wave 5). Picks the node with `kind: "service"` whose
  `slug` matches, walks `parent` to find every descendant (cycle-guarded, the
  same pattern `index.ts`'s `computeDepth` already uses), collapses every
  non-`group` kind to `"module"` (the same collapse `engine/layout.ts`'s
  `toServiceGraph` already makes in the other direction — see w3 handoff
  assumption 16), and keeps only `depends_on`/`implements`/`references_ui`
  edges whose both ends survive the filter. Fully unit-tested
  (`project.test.ts`, 13 assertions) against a hand-built multi-service raw
  graph, including a containment-cycle case.
- **`graph/backend.ts`** (extended). Adds `createBackendSeam()`: real
  `invoke` calls for `loadGraph` (via the projection above),
  `loadDenseGraph` (unchanged — still the in-code dense fixture; the real
  dense fixture doesn't exist on disk, wave 3's own assumption 10),
  `readLayout`, `writeLayout`. `writeSemantic`/`removeSemantic` stay
  in-memory — see "What still doesn't persist" below.
- **`graph/index.ts`**. `defaultSeam` now reaches `createBackendSeam()`
  through a **dynamic** `import("./backend")`, memoized, rather than a
  static one. A static import would pull `@openkaava/bridge`'s `window`
  access into `index.test.ts`, which runs on plain Node — the exact failure
  wave 2's review round 2 already fixed once by splitting `rpc.ts` into
  `backend.ts`. `loadGraph()` (the fixture-returning function) and
  `createMemorySeam()` are byte-for-byte unchanged.

**No file outside `graph/` changed an import.** `App.tsx`,
`engine/index.ts`, `engine/presets.ts`, every `shell/` component — untouched.

### Which service the app opens on

`engine/presets.ts`'s `SERVICE_CONFIG` hardcodes `layoutSlug: "auth-service"`
(Wave 3 scope). `graph/backend.ts` hardcodes the same slug as the service to
project from the real graph. This is not an independent guess:
`fixtures/saas-backend/` was built specifically to reproduce PRD §16.1's
`auth-service` fixture (`w1b-core.md`'s own acceptance condition — "Every
named node in PRD 16.1 exists in `fixtures/saas-backend/`" — and its
generator, `fixtures/saas-backend.mjs`, literally sets
`parent: service.id` on every top-level module, confirmed by reading it).
Against `fixtures/saas-backend/`, the app should draw the same graph it drew
against the hand-typed fixture. Against a project with no `auth-service`,
`loadRealGraph()` throws a named error, which `App.tsx`'s existing rejection
handling (wave 2 review round 2's fix) already renders as
`.kv-shell__error` rather than hanging. Wave 5's tier switch is where a real,
non-hardcoded service picker belongs.

### The ENTRY badge has no real source yet

`schematify_core` has no structural "this module is the service's entry
point" flag — `ServiceFields.entry_point` is prose ("how the service
starts"), not a module reference. `project.ts` derives `STALE` from
`lifecycle` but never derives `ENTRY`; a real project's Outline will show no
`ENTRY` badge until a later wave adds that concept to the schema or derives
it some other way. Documented at the point of derivation in `project.ts`.

### What still doesn't persist against a real project

A node drag **does** now reach a real `layout/<slug>.json` file
(`schematify/write-layout`) — task item 4's requirement.

A reparent, a duplicate, or an edge dragged into existence do **not** yet
reach a real `nodes/`/`edges/` file. `engine/engine.ts`'s own
`nodeJson`/`edgeJson` — unchanged by this wave, and explicitly out of scope
("no file outside the seam should change its imports; if you find yourself
editing a component, stop") — build a **deliberately partial** payload:
`{ id, slug, title, kind, parent }` for a node, `{ id, kind, from, to }` for
an edge. That file's own comment states why: "Wave 1's schemas own the full
shape, and this engine writes only what a duplicate or a reparent can
honestly know." `schematify_core::NodeEnvelope` requires `lifecycle`,
`authored_by` and `created`; `Edge` requires `created`. None are optional,
and `schematify/write-node`/`write-edge` refuse a payload missing them (see
the round-trip tests in `schematify.rs`).

So routing the engine's existing partial JSON straight to the real commands
would fail every reparent and duplicate outright. Inventing the missing
fields in `backend.ts` would be guessing content the engine never claimed to
know — a real node-creation flow knows a lifecycle and an author; this seam
does not. `createBackendSeam()`'s `writeSemantic`/`removeSemantic` therefore
stay backed by an in-memory `Map`, identical in behavior to
`createMemorySeam()`'s. **A reparent, duplicate, or dragged-in edge persists
only for the running session tonight, exactly as before this wave** — only
the layout write became real. Completing the other two is Wave 3 (widen
`nodeJson`/`edgeJson` to a full, schema-valid payload) or Wave 6 (a real
node-creation form that knows an author and a lifecycle) engineering, not a
wiring change.

## How the front end selects the fixture for tests

Unchanged from before this wave, and this is the answer to "how do tests
stay backend-free":

- `graph/index.ts`'s exported `loadGraph()` function still always returns
  the hand-typed `AUTH_SERVICE_GRAPH` fixture. `index.test.ts` imports and
  calls it directly — untouched by this wave, still green.
- `graph/index.ts`'s exported `createMemorySeam()` still wraps that same
  fixture plus in-memory layout/semantic maps. Every engine test
  (`engine.test.ts`, `frame.test.ts`, `frameBudget.test.ts`,
  `layout.test.ts`, `routing.test.ts`) constructs its own
  `createMemorySeam()` explicitly and passes it to `openSchematic` — none of
  them read `defaultSeam`, so none of them touch the real backend or
  `@openkaava/bridge`.
- Only `defaultSeam` changed, and only `App.tsx` (via `openSchematic`'s
  default parameter) reads `defaultSeam`. `App.tsx` is not under test this
  wave (no jsdom in this repo's Vitest config, per wave 2's own header
  comment) — its behavior against a real project is the one thing this
  wiring cannot prove from a test, see below.

## Verified, and how

| Check | Result |
|---|---|
| `pnpm build` | Pass. `dist/assets/schematify-*.js` built, 35.13 kB. |
| `pnpm test:js` | Pass — 490 + 28 (bridge), including 13 new `project.test.ts` assertions on real projected content, not just "did not throw". |
| `pnpm typecheck` (`tsc`) | Pass, plus re-run as `npx tsc -p tsconfig.json --noEmit --typeRoots ./__no_types__` (wave 2's technique for ruling out this machine's stray home-directory `@types/node`) — also clean. No Node builtin, no post-ES2020 API in any new file. |
| `pnpm lint:js` | Pass — 0 errors, the same 8 pre-existing React-hook warnings named in the wave 2/3 handoffs, none in a file this wave touched. |
| `pnpm lint:comments` | Pass after trimming 3 files that first exceeded the 20-consecutive-comment-line cap (`backend.ts`, `index.ts`, `schematify.rs`) — moved detail into this handoff instead of re-baselining. 0 grandfathered. |
| `pnpm lint:version`/`lint:identity`/`lint:branding` | Pass. |
| `pnpm format:check` | Pass, after `cargo fmt --all` (rustfmt wanted several lines in the new test module rewrapped). |
| `cargo test --workspace` | Pass — 811 passed, 1 pre-existing ignored, 0 failed. Run twice: once piped through `tail` (masked the real per-crate totals — a lesson worth naming so it isn't repeated), once captured whole to confirm the untruncated result. |
| `cargo clippy` (`node scripts/clippy-baseline.mjs`) | Pass — 0 warnings, at the baseline of 0. |
| `pnpm baseline` | Never run. |

No test was deleted or skipped.

## Assumptions

1. **`actor` is parsed and validated on every method, but not yet acted on.**
   None of the six methods this wave wires reach a lifecycle transition, so
   there is no policy for wave 10's gate to attach to yet — but every call
   still has to name who it is, honestly, per the task's explicit
   instruction not to default it silently.
2. **The front end always sends `actor: "human"`.** This app has no
   agent-initiated gesture yet — every call reaching `backend.ts` today
   follows a person's mouse and keyboard. One constant
   (`graph/backend.ts`'s `ACTOR`), not re-derived per call.
3. **`schematify/open-project` is read-only** — reports whether `.kaava/`
   exists, never calls `Store::init()` to create it. PRD §14.5 says
   "validates", not "creates"; a project with no `.kaava/` tree yet is a
   state `load-graph` already reports honestly (`CoreError::NoProject`,
   surfaced as a plain refusal).
4. **`schematify/load-graph`'s response is hand-shaped JSON, not a direct
   serialization of `Graph`/`Report`.** Neither type derives `Serialize`
   (the crate is a library, not a wire protocol) — see the table above.
5. **The layout write/read is verbatim JSON, not `schematify_core::Layout`.**
   The two shapes disagree (see "The layout mismatch"); reshaping losslessly
   is a crate-design decision, not this wave's to make unilaterally.
6. **`auth-service` is the one service slug this wave projects**, matching
   `SERVICE_CONFIG`'s hardcoded `layoutSlug` and confirmed against the real
   fixture generator, not guessed independently.
7. **No ENTRY badge for real data.** No structural source for it exists in
   `crates/schematify-core` yet.
8. **A contains, covers, satisfies, or documents edge is dropped from the
   real-graph projection.** `./types.ts`'s `GraphEdge` union only names 3
   kinds; containment is `parentId`, and the other 2 have no drawing yet.

## What a human must check on screen

Nobody watched this run against a real window tonight
(`00-AGENT-CONTEXT.md` forbids `pnpm app`/`pnpm dev:agent`/`pnpm ui launch`
for this job). In the morning, with a project that has a `.kaava/` tree
seeded from `crates/schematify-core/fixtures/saas-backend/` (or any real
project with an `auth-service`):

1. Open Schematify. Confirm it draws the real graph rather than hanging on
   the splash screen or showing `.kv-shell__error` — a wrong
   `DEFAULT_SERVICE_SLUG` or a project missing `auth-service` would show the
   latter, which is the intended failure mode, not a crash.
2. Drag a node, then look at `.kaava/layout/auth-service.json` on disk
   directly — confirm it now holds the new position, and that no file under
   `.kaava/nodes/` or `.kaava/edges/` changed. Reopen the app and confirm
   the position survived (loaded back through `readLayout`).
3. Reparent or duplicate a node, then check `.kaava/nodes/` — confirm
   (per "What still doesn't persist" above) that **nothing changed on
   disk**, and that this matches what you expect before Wave 3/6 completes
   the partial-payload gap. If a human decides this gap should close sooner,
   it is `engine/engine.ts`'s `nodeJson`/`edgeJson` that need widening, not
   this file.
4. Compare the real `auth-service` Outline tree against the fixture's —
   PRD §16.1's numbers (12 modules, 9 edges, depth 3) should still hold if
   `fixtures/saas-backend/` matches its own acceptance condition; a mismatch
   points at `project.ts`'s subtree walk, not at the fixture.

---

🤖 Generated with [Claude Code](https://claude.com/claude-code)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EkL1TAeCe1DYp1FZFRhfXQ
