# Wave 7c handoff — drawing the scope a drill-through asks for

Branch `schematify/w7c-drill`, off `main`. Follow-on to wave 7b: fixes the
gap that handoff flagged rather than fixed — `graph/backend.ts`'s
`loadRealGraph` ignored `tier` and `slug` entirely, so a Problems row's
click-through onto a Module-location finding opened an empty canvas.

## 1. The defect, and why it was silent

`createBackendSeam().loadGraph` was assigned `loadRealGraph`, a **0-argument**
function, against `SchematifySeamLike.loadGraph(): Promise<ServiceGraph>` — a
0-argument interface. `engine/index.ts`'s `openSchematic` has called
`seam.loadGraph(config.tier, config.layoutSlug)` since wave 5, but JavaScript
never enforces arity: the extra 2 arguments were silently dropped at every
call site, and `loadRealGraph` always answered the same `auth-service`
Service Schematic no matter which tier or slug asked. Nothing in the type
system caught it because `SchematifySeamLike`'s own restatement of the real
`SchematifySeam` interface (`./index.ts`) had drifted to `(): …` right along
with the implementation — the interface never disagreed with the bug.

## 2. What was built

- **`graph/backend.ts`** — `loadRealGraph(tier?, slug?)` now routes by tier:
  `service` → `projectServiceGraph` (already generic across any slug, just
  never called with the real one); `module` → the new
  `projectModuleGraph`; `stack` → an honest empty graph (see §4).
  `SchematifySeamLike.loadGraph` widened to match the real interface it was
  supposed to restate.
- **`graph/project.ts`** — `projectModuleGraph(raw, moduleSlug)`, the tier-3
  counterpart of `projectServiceGraph`. Draws the module root as its own
  node (`parentId: null`) plus every facet under it (`contract-method`,
  `test-case`, `budget`, `doc-block`, `external-dep`), each with its
  kind-specific fields read off the flat wire node
  (`schematify_core::Node`'s `#[serde(flatten)]` envelope-plus-fields
  shape): a contract method's `signature`/`returns`/`exported` and its
  computed `coversCount` (counted from live `covers` edges, the same way
  `projectServiceGraph` computes everything at draw time per PRD §0.4); a
  budget's `tier`/threshold text/probe command (`budgetValueText` stays
  `undefined` — `BudgetFields` has no "last measured value" field at all,
  so this doesn't invent one); a test case's status, narrowed to
  `passing`/`failing`; a doc block's audience and body; an external dep's
  version and license, resolved against the `libraries` registry
  `schematify/load-graph` already returns (a new `RawGraph.libraries`
  field, and a new `RawLibraryEntry` type). `covers`/`satisfies`/`documents`
  edges between included facets are kept, matching tier 3's closed edge
  vocabulary (PRD §11.1). `isDescendantOfService` renamed to the
  tier-generic `isDescendantOf`, `badge`/`staleReason` factored into a
  shared `staleFields` helper — both walks were already tier-agnostic, only
  their names weren't.
- **`graph/backend.test.ts`**, new — the direct proof of the fix: mocks
  `@openkaava/bridge`'s `invoke` (this file never touches `window`, same
  reason `./index.ts` keeps `./backend.ts` out of its own static imports)
  and asserts `createBackendSeam().loadGraph(tier, slug)` actually draws
  the requested scope.
- **`graph/project.test.ts`** — 18 new cases under `projectModuleGraph`,
  shaped after PRD §16.1's own `token-verifier` paragraph (a
  `cold_start_p95` budget with no probe — the exact node an L03 Problems
  row has to land on).

## 3. Made to fail on purpose

**`backend.test.ts`, all 4 cases, against the real defect.** Reverted
`loadRealGraph` to its pre-fix, 0-argument body (`git diff` of the exact
change is in this commit's history — the whole point was to run it against
the *actual* old code, not a stand-in), reran the suite: 3 of 4 failed —
"draws the requested service" (`no service named "auth-service"` — the mock
graph in that test has no `auth-service` at all, correctly), "draws the
requested module" (`tier` came back `"service"`, not `"module"`), and "draws
an honest empty graph for the stack tier" (crashed trying to read `.graph`
off an unmocked response, since the old code called `invoke` unconditionally
and the stack-tier test never primed a mock response for it — exactly the
"silently wrong service" this fix exists to stop). Reverted back to the fix,
reran clean.

**`project.test.ts`, the covers-count case.** Changed
`coversCount: inboundCovers.get(node.id) ?? 0` to a hardcoded `0`, reran:
"draws a contract method's signature, returns, exported, and covers count"
failed (`expected +0 to be 2`). Reverted.

## 4. The stack tier, deliberately left out

The task named "opening a Service or Module Schematic" — not Stack. No rule
in `crates/schematify-core/src/lint.rs` produces a `Location::Stack` finding
on the reference fixture (none of the 5 rows does), so no Problems-panel
click-through exercises it either. Building a real `projectStackGraph`
(services, the `platform-core` group, the derived tech stack) is comparable
in size to `projectModuleGraph` and wasn't asked for — `loadRealGraph`
answers the stack tier with the same honest empty graph
(`{tier, serviceSlug: slug, serviceTitle: slug, nodes: [], edges: []}`)
`graph/index.ts`'s stand-in loader already returns for a slug it has no
fixture for, rather than silently drawing the wrong service (the exact
defect this branch fixes) or crashing. Flagged here rather than worked
around quietly, the same way the wave 7b handoff flagged the original gap.

## 5. Acceptance

| Condition | Result |
|---|---|
| `loadRealGraph` honours tier and slug for Service and Module Schematics | **Pass.** `backend.test.ts`'s 4 cases; §3 records the deliberate-break proof against the real pre-fix code. |
| The Problems-panel click-through lands on the right node | **Pass, for what a real project can serve.** `resolveClickThrough` (wave 7b, untouched) already computed the correct `NavigationTarget`/`select` id — the missing piece was that the target Schematic drew nothing once opened. Now it draws the requested module's real facets, `cold_start_p95` included, so `engine.select([id])` (`App.tsx`, wave 7b) has a real node to find. Not re-verified against a live browser — see §6. |

## 6. What a human must check by eye

No browser was available (`00-AGENT-CONTEXT.md`'s standing limit). Once a
real `.kaava/` project is open in OpenKaava:

1. Drill from the Stack Schematic (or the breadcrumb) into a service other
   than `auth-service` — confirm its own modules draw, not `auth-service`'s.
2. From the Service Schematic, click a module box — confirm the Module
   Schematic that opens draws that module's own facets (contract methods,
   test cases, budgets, doc blocks, external deps), not an empty canvas.
3. Click a Problems row whose location is `› <some module>` — confirm the
   app navigates to that module's real Module Schematic and the offending
   facet ends up selected (`kv-node--selected`, per the export-strip
   precedent wave 5 already verified this same selection mechanism against).
4. An external-dep card — confirm its version/license line reads the real
   registry values, not blank, when the project's library registry holds
   the dependency.
5. A budget card with no probe (PRD §16.1's `cold_start_p95` is the
   canonical one) — confirm its "last value" line draws `—`, not a stale
   placeholder.

## 7. Verification

| Step | Result |
|---|---|
| `npx tsc -p tsconfig.json --noEmit` | Pass |
| `npx vitest run apps/schematify` | Pass — 295 tests (was 265 after wave 7b) |
| `npx eslint apps/schematify/ui/src` | Pass, 0 errors |
| `npx prettier --check apps/schematify/ui/src` | Pass |
| `node scripts/check-comments.mjs` | Pass, 0 above limit, 0 grandfathered |
| `pnpm verify` (full) | See PR — this file was written before that run's own result landed; the PR carries whichever came back. |

No Rust file changed this branch — the defect and its fix are entirely in
`apps/schematify/ui/src/graph/`. `cargo test --workspace` is expected to
show the same pre-existing, shared-`CARGO_TARGET_DIR` false failures the
orchestrator has already named as `sch-fix-flake`'s to own, not this
branch's.

`pnpm baseline` was never run. No test was deleted or skipped.

## 8. Left undone

- A real Stack Schematic projector (§4) — separately scoped, not this
  branch's.
- No live-browser verification (§6).
- `budgetValueText` stays permanently `undefined` for every real budget —
  not a gap this branch introduced; `schematify_core::node::BudgetFields`
  has no field to read one from at all.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_016X8PJJ3xTD4BTuNBLSJyTQ
