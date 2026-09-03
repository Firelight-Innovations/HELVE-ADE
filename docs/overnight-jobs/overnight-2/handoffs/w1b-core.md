# Wave 1b handoff: `crates/schematify-core`

The data half of PRD wave 1. Everything is inside `crates/schematify-core` plus
its fixtures, and one line each in `eslint.config.js`, `.prettierignore` and the
root `Cargo.toml`. No app, no `src-tauri/`, no `catalog.toml`, no
`vite.config.ts`, and no Tauri command. Wave 2 wires the commands to these
types.

Branch `schematify/w1b-core`, pull request
<https://github.com/Firelight-Innovations/OpenKaava/pull/80>.

---

## 1. The public API other waves call

Import from `schematify_core`. The crate re-exports `uuid::Uuid`, so a consumer
does not declare its own `uuid` and discover at a type error that the versions
differ.

### Identity, addressing, naming

| Item | What it is |
|---|---|
| `mint_id() -> Uuid` | One UUIDv7 from the process-wide minter. |
| `IdMinter::new()`, `::from_seed(u64)`, `.mint()`, `.mint_at(unix_ms)` | A private minter. Strictly monotonic, including inside one millisecond and across a clock that steps back. |
| `id_timestamp_ms(Uuid) -> Option<u64>` | The millisecond a v7 was stamped with. `None` for any other version. |
| `Uri { kind: UriKind, id: Uuid }` | A `schematify://` reference. `Uri::node/screen/flow/decision(id)`, `Uri::parse(&str)`, `Display`, `FromStr`, serde as a string. |
| `UriKind::{Node, Screen, Flow, Decision}` | `.as_str()` and `.directory()`. |
| `UriError` | Names a retired `forger://`, `journeyman://` or `decision://` scheme separately from a malformed one. |
| `Slug` | A validated name. `Slug::new`, `.as_str()`, `.is_decision_shaped()`. Serde as a string. |
| `SlugScope` | PRD section 3.2 as a type. `SlugScope::for_node(&NodeKind, Option<Uuid>)`. |
| `SlugIndex` | `.claim(scope, &Slug, id)`, `.lookup(scope, &str)`. Re-claiming for the same id is not a collision. |

### Schemas

| Item | What it is |
|---|---|
| `Node { envelope: NodeEnvelope, fields: Map<String, Value> }` | The envelope of PRD 5.1 plus an open map. `Node::new(envelope)`, `.with_fields(&T)`, `.id()`, `.kind()`. |
| `Node::service()`, `.module()`, `.contract_method()`, `.test_case()`, `.budget()`, `.doc_block()`, `.external_dep()`, `.comment()`, `.group()` | Typed views over `fields`. Each returns `Result<_, serde_json::Error>`. |
| `NodeKind` | Nine named variants plus `Custom(String)`. `.as_str()`, `.is_annotation()`, `.is_facet()`. |
| `Layer` | Five values, `.badge()`. |
| `ServiceFields`, `ModuleFields`, `ContractMethodFields`, `TestCaseFields`, `BudgetFields`, `DocBlockFields`, `ExternalDepFields`, `CommentFields`, `GroupFields` | The added fields of PRD 5.3 to 5.5. |
| `BudgetTier`, `TestStatus`, `DocAudience`, `Probe` | The enumerations those fields take. |
| `Edge`, `EdgeKind`, `EdgeTier` | PRD 5.6 and 11.1. `Edge::new`, `.is_stored()`, `.is_live()`; `EdgeKind::all()`, `.tier()`, `.is_semantic()`. |
| `Screen`, `Flow`, `FlowStep` | PRD 5.7 and 5.8. |
| `Decision`, `DecisionStatus` | PRD 5.9, plus `.is_superseded_without_successor()` for rule L07. |
| `Rule`, `Severity`, `LibraryEntry`, `LibraryRegistry` | PRD 5.10 and 10. `LibraryRegistry::get`, `.contains`, `.by_name`. |
| `Layout`, `Placement` | PRD 5.10. `Layout::new(slug)`, `.file_name()`. |
| `RunArtifact`, `BudgetResult`, `TestResult`, `LinterResult`, `ReconcileResult`, `RUN_SCHEMA_VERSION` | PRD 5.10. `.is_known_schema()`, `.budgets_passing()`, `.tests_passing()`, `ReconcileResult::drawn()`, `.error_count(bool)`. |
| `ProjectBrief`, `SuccessMetric` | PRD 5.12. |

### Storage

| Item | What it is |
|---|---|
| `write_json_atomic(&Path, &T)` | Temporary file in the same directory, `sync_all`, rename. Pretty-printed with a trailing newline. |
| `AtomicWriteError` | Names the step that failed. |
| `Store::open(project_root)` | Everything below hangs off this. |
| `.kaava_dir()`, `.node_path(id)`, `.edge_path`, `.screen_path`, `.flow_path`, `.decision_path`, `.rule_path`, `.libraries_path()`, `.brief_path()`, `.layout_path(slug)`, `.run_path(node, n)`, `.audit_path(node)` | PRD 6.1 as functions. |
| `.init()` | Creates the nine directories. |
| `.write_node`, `.write_edge`, `.write_screen`, `.write_flow`, `.write_decision`, `.write_rule`, `.write_libraries`, `.write_layout`, `.write_run` | Atomic writes. `write_edge` returns `false` for a `contains` edge and writes nothing. `write_run` refuses an unknown schema before touching the disk. |
| `.write_transition(&mut Node, to, actor, actor_name, at, reason) -> Result<AuditRow>` | The PRD 6.3 pair. Checks the transition first, so an illegal one writes nothing. |
| `.read_audit(node)`, `.rename_layout(from, to)`, `.deprecate(...)`, `.delete_node(...)` | `delete_node` always errors, per PRD 6.6. |
| `WriteLayer`, `layer_of(&Path)`, `allowed_together(&[PathBuf])` | The CI path gate of PRD 6.2 and 6.3 as functions. |

### Loading and the graph

| Item | What it is |
|---|---|
| `load_project(&Path) -> Result<LoadOutcome>` | Walks `.kaava/`. The only error is `CoreError::NoProject`. |
| `LoadOutcome { graph, report }` | |
| `Report { quarantined, unreadable, slug_collisions, slug_index, duration_ms }` | `.is_clean()`, `.slug_owner(scope, slug)`. |
| `Quarantine { subject, field, reference, reason, file }`, `QuarantineReason`, `ReadProblem` | `subject` is the referring thing, never the missing one. |
| `Graph` | `.node`, `.nodes`, `.edge`, `.edges`, `.screen(s)`, `.flow(s)`, `.decision(s)`, `.rules`, `.layout`, `.runs`, `.audit`, `.libraries`, `.brief`. |
| `Graph` containment | `.children`, `.roots`, `.descendants`, `.ancestors`, `.lowest_common_ancestor(&[Uuid])`, `.modules_of_service(id)`, `.facet_count(module)`. |
| `Graph` dependency | `.dependencies`, `.dependents`, `.is_shared`, `.shared_node_parent`, `.shared_node_is_at_lca`, `.has_dependency_cycle`, `.dependency_cycle`. |
| `Graph` mutation | `.insert_node`, `.insert_edge`, `.insert_screen`, `.insert_flow`, `.insert_decision`, `.insert_rule`, `.insert_layout`, `.insert_run`, `.insert_audit`, `.set_libraries`, `.set_brief`, `.quarantine`, `.reindex`. Call `.reindex()` after inserting. |
| `Graph` misc | `.node_count`, `.edge_count`, `.nodes_of_kind(&NodeKind)`, `.is_quarantined`, `.quarantined`. |

### Lifecycle

| Item | What it is |
|---|---|
| `Lifecycle` | Eight states. `.as_str()`, `.all()`, `Display`. |
| `Actor::{Human, Agent, System}` | `.as_str()`, `Display`. |
| `check_transition(from, to, actor) -> Result<&TransitionRule, LifecycleError>` | The gate wave 10 enforces at the command boundary. |
| `LifecycleError::{IllegalTransition, HumanOnly, WrongActor}` | `HumanOnly` is the PRD 7.3 refusal and is separate on purpose. |
| `transition_table()`, `transitions_from(Lifecycle)`, `TransitionRule` | The PRD 7.2 table as data, for a surface that draws it. |
| `AuditRow` | One row of `runs/<node>/audit.json`. |
| `contract_fields_changed(&Node, &Node) -> bool` | PRD 7.4's definition of a contract change. |
| `stale_cascade(&Graph, changed) -> Vec<Uuid>` | The accepted dependents that drop to `stale`. |

### Errors

`CoreError` is the one error the crate returns across its surface, with a
`Result<T>` alias. `SlugError`, `UriError`, `LifecycleError` and
`AtomicWriteError` each convert into it.

---

## 2. Acceptance conditions

| Condition | Result | Evidence |
|---|---|---|
| `pnpm verify` passes | **Pass** | Section 6 below lists each step and its result. |
| The loader reads `fixtures/stress-2000/` in under 1000 ms, asserted from a test | **Pass** | `tests/fixtures.rs::the_stress_fixture_loads_inside_the_wave_one_budget`. The measured load is roughly 60 ms on this machine, against a 1000 ms budget. |
| A dangling reference produces a quarantine record and no crash | **Pass** | Nine reasons in `QuarantineReason`, covered by `load_tests.rs`. `every_kind_of_dangling_reference_is_reported_rather_than_dropped` exercises seven at once. |
| Every named node in PRD 16.1 exists in `fixtures/saas-backend/` | **Pass** | `tests/fixtures.rs::every_node_named_in_the_wireframe_fixture_exists`, against a 32-slug list. |

Test coverage the prompt asked for, all passing: round-trip serialisation of
every schema; slug uniqueness rejection per scope; UUIDv7 monotonicity across
5000 mints in one millisecond and across a backward clock step; the atomic
writer leaving no partial file and no temporary; the loader quarantining a
dangling reference; every legal and every illegal cell of the PRD 7.2 table
(`every_illegal_transition_is_refused` walks all 64 pairs); and the shared-node
rule at both tiers, including a node above and a node below the lowest common
ancestor.

**133 tests**: 115 unit, 17 integration, one doc-test target with none.

---

## 3. PRD ambiguities resolved

**A node is an envelope plus an open map, not a tagged enum.** PRD 11.2 lets a
user register a node kind this build has never seen. Under a
`#[serde(tag = "kind")]` enum that file is a parse error at load time; under the
open map it round-trips byte for byte and only the typed view is unavailable.
The typed views (`node.module()` and its siblings) give back the safety for the
nine known kinds.

**`GroupFields` has no `title`.** PRD 5.5 lists `title` among a group's added
fields, and the envelope in 5.1 already has one. A node cannot carry two, and
serde rejects the duplicate outright. The heading drawn on a group box is
`envelope.title`.

**`facet_count` is a method, not a field.** PRD 5.4 marks it computed and 0.4
forbids storing a count, so it is `Graph::facet_count(module)` and appears in no
JSON file.

**The staleness cascade is direct dependents only.** PRD 7.4 names "every node
with an inbound `depends_on` edge to the owning node". A node that goes stale
has had no contract change of its own to propagate, and a transitive reading
would mark a whole subtree stale on one signature edit. `stale_cascade` also
walks up from a changed facet to its owning module, because dependency edges are
drawn between modules rather than between facets.

**A quarantined node stays in the graph.** PRD 6.6 says quarantine and report.
Dropping the node would put its own children out of reach and turn one dangling
reference into a cascade of them. `Graph::is_quarantined` is how a surface finds
out; the node is still addressable.

**`load_project` returns one error.** Only "there is no `.kaava/` here". A
malformed file, a dangling reference and a slug collision are all reported in
the `Report` beside a graph that loaded, because a project that half-loads is
worth drawing.

**A `references_ui` edge resolves its target against the screens.** Every other
edge endpoint is a node. This is the one place an endpoint leaves the node
collection, and the loader is explicit about it rather than quarantining every
such edge.

**The library registry is not part of quarantine's node collection.** A missing
`allowed_libraries` entry quarantines the module with reason `MissingLibrary`.
Rule L04 in wave 7 reports the same condition; the loader reporting it too is
deliberate, because the graph cannot resolve the reference at all.

**Slug scope for a facet uses the immediate parent.** PRD 3.2 says "its module
root". Every facet in the fixture is a direct child of its module, so the two
readings coincide. If a facet ever nests under another facet, `SlugScope::for_node`
will need the module root passed in rather than the parent; the signature
already takes an `Option<Uuid>` so no caller changes.

---

## 4. Wireframe arithmetic conflicts

PRD 0.4 decides all of these the same way: the computed value is the truth and
the wireframe carries the conflict. Section 16.4 lists the first two. The other
three turned up while building the fixture and are new.

| # | Drawn | Computed | Where | Resolution |
|---|---|---|---|---|
| 1 | `6 services` on the Stack Schematic | `7 services` | PRD 16.4, open item 19.11 | The fixture holds seven nodes of kind `service`. A surface counts them. |
| 2 | `layer backend · 4 facets` on the module root | 15 facets on `token-verifier` | PRD 16.4, open item 19.12 | The wireframe draws seven facet cards beside a count of four; the fixture's full facet count is 15, which is what 5.4 defines. |
| 3 | `2 dependents` on `crypto-primitives` alongside `crypto-primitives.sign changed 2h ago` staling `audit-emitter` | 2 dependents, and `audit-emitter` is not one of them | New | The two cannot both hold. Rule L10 fires only if every dependent of `crypto-primitives` sits inside one subtree, and `audit-emitter` sits outside it. The fixture keeps the drawn count and the L10 warning, and makes `audit-emitter` stale from `token-verifier`, whose `verify_signature` the contract history shows changing on 25 Aug. The caption naming `crypto-primitives.sign` is the part that does not follow. |
| 4 | One `Contract method with no covers edge` row, against `token-issuer.mint` | Two rows: `token-issuer.mint` and `token-verifier.skew_window` | New | 16.1 gives `skew_window` zero covers edges explicitly, and rule L11 fires on any contract method with none. Either the Problems panel is truncated or L11 is meant to fire on exported methods alone. The fixture reproduces the content and wave 7 will report two rows. |
| 5 | The five most recent audit rows | Six rows are needed to make them legal | New | The drawn rows run `reviewed → specified` at 24 Aug 09:05 and then `assigned → implemented` at 24 Aug 22:18, with nothing between them. PRD 7.2 has no such edge. The fixture inserts `specified → assigned` at 24 Aug 12:40, which pushes `21 Aug 15:31` out of the five most recent. Four of the five drawn rows are reproduced exactly. |

`http-entry` draws `4 exports` and the export strip lists four methods on other
modules. That is not a conflict: the badge is the service's export count drawn
on its entry-point module, and the fixture computes it from `auth-service`.

---

## 5. Assumptions

- **Fixture identifiers are seeded, not minted.** A fixture rebuilt with a live
  clock changes 5648 files on every run and cannot be reviewed. The generator
  mints UUIDv7-shaped ids from a seeded stream, so a regeneration is an empty
  diff. The layout matches RFC 9562, so the loader cannot tell.
- **All three fixtures are committed**, 5648 files and about 4 MB. A wave 3
  agent running `cargo test` should not also need `node` on the path. They are
  in `.prettierignore` because Prettier would reformat all of them and the
  regeneration diff would then depend on which tool ran last.
- **`fixtures/generate.mjs` is the entry point** and delegates: `fixture.mjs`
  holds the shared machinery, `saas-backend.mjs` the authored fixture,
  `generated.mjs` the two synthetic ones.
- **The unnamed services get modules.** PRD 16.1 gives module counts for four of
  the seven services. `ledger-store`, `notification-service` and `event-bus` get
  two each, which is the smallest number that lets `ledger-store` hold its three
  authored exports.
- **`platform-core` is a containment parent.** It has kind `group`, which PRD 5.5
  puts in the annotation tier, and 16.1 has it containing two services.
  Containment is not an edge, so the annotation rule of 11.3 is not engaged.
- **The fixture carries the defects the Problems panel draws**, on purpose: a
  dependency cycle through `session-codec`, `cold_start_p95` with no probe, and
  the `m.ross` comment holding a `covers` edge. Waves 7 and 10 have something to
  find. A fixture that lints clean would be the wrong test input.
- **The directory is not fsynced after the rename.** A directory handle cannot
  be flushed on Windows the way a file can. The guarantee this writer makes is
  that no reader sees a partial file, not that a rename survives a power cut; a
  design file lost that way is recovered from git.
- **Reading is parallel.** `load.rs` splits each directory across
  `available_parallelism()` threads. The stress fixture is 5000 files against a
  1000 ms budget and sequential reading on Windows was not obviously going to
  fit. There is generous headroom now.
- **Attribution.** Commits carry `Co-Authored-By: Claude Opus 5`, per the
  orchestrator prompt and the session's attribution notice, rather than the
  `Claude Fable 5.1` line in `00-AGENT-CONTEXT.md`.

---

## 6. Verification

| Step | Result |
|---|---|
| `pnpm build` | Pass |
| `pnpm test:js` | Pass, unchanged by this wave |
| `pnpm test:rust` | Pass, 133 new tests in `schematify-core` |
| `pnpm lint:js` | Pass, 0 errors and the 8 pre-existing React hook warnings |
| `pnpm lint:rust` | Pass, no new clippy findings and no baseline change |
| `pnpm lint:comments` | Pass, 0 grandfathered |
| `pnpm lint:version`, `lint:identity`, `lint:branding` | Pass |
| `pnpm format:check` | Pass |

No baseline file was regenerated.

---

## 7. Files outside the crate

Three, each one line of content.

- `Cargo.toml` — `uuid`, `getrandom` and `tempfile` added to
  `[workspace.dependencies]`, following the existing convention that versions
  are pinned there. The `crates/*` glob already makes the new crate a member,
  so no member list changed.
- `eslint.config.js` — `crates/*/fixtures/*.mjs` added to the glob that grants
  Node globals, beside `scripts/**/*.mjs`.
- `.prettierignore` — `crates/schematify-core/fixtures/*/`, the generated JSON.

Nothing in `apps/`, `src-tauri/`, `catalog.toml` or `vite.config.ts` was
touched, so this merges independently of the wave 1a rename.

---

## 8. Left undone

- **`crates/schematify-reconcile` is not here.** PRD 9.3 puts the `kaava
  reconcile` binary in its own crate, and wave 9 owns it. Nothing in this crate
  scans a working tree.
- **`packages/schematify-ui` is not here.** PRD wave 1 lists it; it is the
  interface half and belongs to wave 1a or wave 2.
- **The terminology rows are not added to `core/terminology.csv`.** PRD section
  2 asks for them before wave 1 closes. That file is outside the repository, at
  `C:/Users/bjsea/Documents/Viestra/company/core/`, and is not in this
  worktree. Whoever closes wave 1 should add the twelve terms and the seven
  acronym rows.
- **No Tauri command.** Deliberate, and the prompt said so. Wave 2 wires them.
- **The graph linter is not implemented.** PRD 10.4 belongs to wave 7. The
  predicates each rule needs are here and named in the API table above:
  `shared_node_is_at_lca` for L10, `dependency_cycle` for L02,
  `BudgetFields::probe` for L03, `LibraryRegistry::contains` for L04,
  `NodeKind::is_annotation` with `EdgeKind::is_semantic` for L05,
  `Decision::is_superseded_without_successor` for L07.
- **The `ui_refs` cache is not written automatically.** PRD 5.11 makes the
  `references_ui` edge authoritative and the cache derived, written by
  Schematify on every edge change. The types and the mismatch check are here;
  the write happens wherever an edge is created, which is wave 3.
