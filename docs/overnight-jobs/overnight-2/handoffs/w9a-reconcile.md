# Wave 9a handoff — marker scanning and `kaava reconcile`

## What was built

`crates/schematify-reconcile`, a new workspace member (picked up automatically
by the existing `crates/*` glob — no root `Cargo.toml` edit). Six library
modules plus a `kaava` binary target:

- `token.rs` — the `@kaava:<uuid> <slug>` marker grammar (PRD section 9.1), a
  compiled `Regex` built once per scan, and `parse_token`/`parse_captures` for
  testing the grammar directly.
- `scan.rs` — `scan_tree(root) -> ScanResult`, walking with `ignore::WalkBuilder`
  (`.gitignore` honored via `require_git(false)`, `node_modules`/`target`
  always excluded), reading every file's raw bytes and regex-matching line by
  line regardless of language.
- `graph.rs` — the `GraphLookup` trait (see below), `InMemoryGraph`, and
  `JsonFileGraph`.
- `outcome.rs` — `ReconcileOutcome`, one variant per PRD section 9.2 row, each
  carrying its evidence (`EvidenceSite` — file and line).
- `reconcile.rs` — `reconcile(root, graph) -> ReconcileRun`, the comparison
  that turns a scan plus a graph into outcomes; `has_error`/`exit_code`.
- `report.rs` — `write_run_files` (the `runs/<node-uuid>/reconcile.json`
  writer) and `render_text`/`render_json` for the `--out` report.
- `src/bin/kaava.rs` — `kaava reconcile [--root <path>] [--out <path>]
  [--format text|json]`.

## Public API for the wiring wave

**Implement `GraphLookup` (`crates/schematify-reconcile/src/graph.rs`) for
whatever `schematify-core` exposes as its loaded graph, and pass it (or `&dyn
GraphLookup`) to `reconcile::reconcile` in place of `JsonFileGraph`.** Nothing
else in this crate changes.

```rust
pub trait GraphLookup {
    fn lookup(&self, id: Uuid) -> Option<NodeFacts>;
    fn markable_node_ids(&self) -> Vec<Uuid>;
}
```

`NodeFacts { id, slug, kind, lifecycle }` carries `kind` and `lifecycle` as
the wire strings from the common node envelope (PRD section 5.1), not as
`schematify-core` enums — this crate cannot depend on that crate's types any
more than its code.

Two callers use this trait: `reconcile::reconcile(root: &Path, graph: &dyn
GraphLookup) -> ReconcileRun` (the comparison logic) and
`src/bin/kaava.rs::run_reconcile`, which today constructs `JsonFileGraph::load(&root)`
and would instead construct the real graph. `schematify_reconcile_status`
(the Tauri command PRD section 9.3 names) is expected to call
`report::write_run_files`'s output — it reads `runs/<node-uuid>/reconcile.json`
off disk rather than calling into this crate directly ("Schematify shall
never scan the working tree from the interface process," PRD 9.3) — so the
wiring wave's other job is on the `schematify-core`/Tauri side, not here.

## Acceptance conditions

| Condition | Status |
|---|---|
| `pnpm verify` passes | Pass — `build`, `test:js` (394 tests), `lint:js` (0 errors, 8 pre-existing warnings in unrelated files), `lint:comments`, `lint:version`, `lint:identity`, `lint:branding`, `format:check` all green; `test:rust` and `lint:rust` (`clippy-baseline.mjs`) run separately, see below |
| Duplicate marker token → error, exit code 1 | Pass — `tests/cli_reconcile.rs::duplicate_marker_token_exits_1` spawns the real compiled `kaava` binary via `CARGO_BIN_EXE_kaava` and asserts `Some(1)` |
| Every PRD 9.2 outcome reachable and tested | Pass — `Matched`, `DeclaredAbsent` (both `error: false` and `error: true`), `PresentUnknown`, `Duplicate` each have a direct unit test in `reconcile.rs`, plus `outcome.rs` tests each variant's `is_error`/`kind`/`drawn` mapping |
| Crate compiles and tests without `crates/schematify-core` existing | Pass — that crate does not exist in this worktree; `schematify-reconcile` depends on nothing under `crates/` |

38 tests total (34 unit + 4 integration), all passing as of this commit.
`cargo test --workspace` and `node scripts/clippy-baseline.mjs` (== `pnpm
lint:rust`) were run separately per the process instructions (foreground
`cargo test`/`clippy` on a large workspace risks the 600s watchdog); both were
green for this crate — `lint:rust` reported "0 warnings, none above the
baseline of 0" for the whole workspace.

## Assumptions

1. **Which node kind requires a marker.** PRD 9.1/9.2 do not say which node
   *kinds* are expected to carry a code marker — only that "every design
   element with a counterpart in code" does. `JsonFileGraph::markable_node_ids`
   returns only `contract-method` facets: the one facet kind PRD section 5.5
   gives `signature`/`params`/`returns`, matching the PRD's own example
   (`token-verifier.verify_signature`). Service and module nodes describe
   groupings, not one callable. This is the one place the set would need to
   widen — `MARKABLE_KINDS` in `graph.rs`.
2. **`reconcile.json`'s schema.** PRD 9.3 names the path, not the shape. It
   is `{schema: "kaava-reconcile-v1", at: <rfc3339>, outcome: <the
   ReconcileOutcome, flattened>}`, mirroring how `run-<n>.json` carries a
   `schema` tag (section 5.10). Overwritten each run — the PRD gives this
   file no run number the way `run-<n>.json` has one.
3. **Which node id a `runs/` directory is keyed by, for `present_unknown` and
   `duplicate`.** Section 9.3 says the command writes one file "for every
   node it touches." Read broadly: `present_unknown` and `duplicate` outcomes
   key their `runs/<id>/` directory by the marker's own id even though no
   graph node exists for it, rather than being omitted from the on-disk
   audit trail entirely.
4. **Exit code 2 also covers a bad CLI argument**, not only "no project at
   that path" — PRD 9.3 defines no other code for that failure class.
5. **`declared_absent`'s error boundary** is lifecycle ∈ {`implemented`,
   `reviewed`, `accepted`, `stale`}, excluding `deprecated` (a superseded
   node is not expected to still be backed by live code) — see the doc
   comment on `LIFECYCLE_REQUIRES_MARKER` in `reconcile.rs`.
6. **`.gitignore` without a `.git` directory.** `ignore::WalkBuilder`
   defaults to requiring a discoverable `.git` before honoring any
   `.gitignore`. Set `require_git(false)` so "respect .gitignore" holds even
   for a fresh scaffold or a checkout without `.git` — this also matches the
   task instruction, which named `.gitignore` unconditionally.
7. **No `clap` dependency.** `--root`/`--out`/`--format` are hand-parsed in
   `src/bin/kaava.rs`; `clap` is not yet in this workspace's dependency tree,
   and three flags did not seem worth the addition or the `deny.toml` check.

## Left undone, and why

- **`schematify_reconcile_status`, the Tauri command PRD 9.3 names**, and any
  UI. Out of this wave's scope per the task brief (crate + CLI only); the
  wiring wave section above names what it would call.
- **`kaava`'s other subcommands** (load-graph, lint, search, etc. from PRD
  14.5/section 9 neighbors) — this binary has only `reconcile`; later waves
  add a subcommand by matching on it in `main`, no shared file to edit.
- **Comment-syntax-aware scanning was deliberately not built.** The PRD states
  the token is "found by plain regular expression" specifically because a
  per-language parser "breaks on the first language nobody anticipated." The
  scanner reads raw text with one regex for every file; the "handle the
  comment syntaxes... at minimum" requirement is met because that single path
  already handles Rust `//`, Python `#`, JSX `{/* */}`, HTML `<!-- -->`, and
  TOML `#` without special-casing any of them — tested directly in
  `scan.rs::finds_markers_across_several_comment_syntaxes`.

## Verification run

- `pnpm install` — clean.
- `cargo test -p schematify-reconcile` — 38 passed, 0 failed.
- `cargo clippy` via `node scripts/clippy-baseline.mjs` — 0 warnings above baseline.
- `cargo fmt -p schematify-reconcile` — applied once, clean since.
- `pnpm run build`, `pnpm run test:js`, `pnpm run lint:js`, `pnpm run
  lint:comments`, `pnpm run lint:version`, `pnpm run lint:identity`, `pnpm run
  lint:branding`, `pnpm run format:check` — all green.
- `cargo test --workspace` — 14 test binaries, all `test result: ok`, 0 failures.
