# Wave 5 handoff — the three Schematics

Branch `schematify/w5-schematics`, stacked on `schematify/w4-nodes`. Pull
request opened with `--base schematify/w4-nodes`; the orchestrator retargets
it to `main` once Wave 4 lands.

## 1. How each tier configures the engine

Wave 3 already built all 3 presets (`STACK_CONFIG`, `SERVICE_CONFIG`,
`MODULE_CONFIG` in `apps/schematify/ui/src/engine/presets.ts`) and Wave 4
built the node-anatomy pipeline that reads them. Wave 5's job was narrower
than it first looked: the presets existed, but nothing outside them was
tier-aware yet. `App.tsx` opened exactly one config
(`SERVICE_CONFIG`/`auth-service`) on every load, and `openSchematic` always
called `seam.loadGraph()` with no arguments, which always returned the same
12-node service fixture no matter which config asked for it.

**What Wave 5 actually changed to make 3 tiers real:**

- `SchematifySeam.loadGraph(tier?, slug?)` — widened from 0 arguments to 2,
  both defaulted to Wave 2/3's original single fixture so every pre-Wave-5
  call site (`seam.loadGraph()`, all across the existing test suite) keeps
  reading exactly what it always has. `graph/index.ts`'s `loadGraph` now
  dispatches to 1 of 3 fixture files: `graph/stack.ts` (`saas-backend`, new
  this wave), `graph/fixture.ts` (`auth-service`, unchanged), `graph/module.ts`
  (`token-verifier`, new this wave). An unknown slug returns an empty graph
  (root only) rather than throwing, so a drill-down into a service or module
  this stand-in has no content for still opens.
- `engine/navigation.ts`'s `configFor(target)` — `TIER_PRESETS` is 1 static
  value per tier, but a Service or Module Schematic is 1 *instance* per
  service/module. `configFor` overrides a preset's `layoutSlug` per drill
  target (the Stack Schematic never needs this — there is exactly 1 stack).
- `App.tsx` — now holds `path: DrillTarget[]`, the breadcrumb's own history.
  Every entry re-opens through the exact same `openSchematic` call the first
  paint always used; there is no 2nd "switch tier" code path.

**The engine itself did not fork.** `engine.ts`, `routing.ts`, and
`rules.ts` are untouched by this wave. `frame.ts` and `anatomy.ts` grew new
*computations* (facet content, the coverage readout, the 2 callouts), each
gated by a new `SchematicConfig` field rather than a `tier` check — see
§2 for the 1 place I initially got this wrong and fixed it.

## 2. What the configuration surface could not express, and what I did instead

One real gap, caught and fixed before this handoff was written, not left as
a footnote:

**The free-floating callouts.** PRD §12.11's coverage/`SATISFIES` pair and
PRD §4.3's shared-node callout are drawn on exactly 1 tier each. My first
pass wrote `config.tier === "module"` / `config.tier === "stack"` directly
inside `frame.ts`'s `buildFrame` — exactly the thing the Wave 3 handoff
warns against ("if you find yourself adding a tier check inside the engine,
stop"). I added `SchematicConfig.calloutKind: "module-readouts" |
"shared-node" | "none"`, set once per preset in `presets.ts`, and changed
`buildFrame` to read that field instead. `engine/stack.test.ts` and
`engine/module.test.ts` each assert the field directly, so a future agent
who reintroduces a tier check here breaks a named test, not just a review
comment.

**Nothing else needed a new field.** The facet cards, the module root's
computed facet count and screen reference, and the export strip all reuse
mechanisms Wave 3/4 already built (`anatomy.ts`'s pure functions,
`DrawnNode.counts`, the existing selection/click machinery) — see §3's
per-surface notes for how.

**One thing I did not try to force into config: the graph vocabulary
itself.** `NodeKind` (`graph/types.ts`) and `GraphEdge.kind` needed real
widening — a facet card is a real new kind of thing, not a configuration of
an existing one. That is a data-model change, not an engine fork, and it
was already anticipated: `engine/config.ts`'s `SchematicNodeKind` already
carried all 5 facet kinds before this wave (Wave 3 built it that way on
purpose). I only had to bring `graph/types.ts`'s `NodeKind` up to match it.

## 3. Acceptance conditions (PRD §17 Wave 5)

| Condition | Result |
|---|---|
| One Schematic engine serves all 3 tiers | **Pass.** No tier branch in `engine.ts`, `routing.ts`, or `rules.ts`. The 1 branch I did write inside `frame.ts` reads `SchematicConfig.calloutKind`, not `tier` — see §2. `engine.test.ts`'s pre-existing "one engine, three configurations" test and this wave's `stack.test.ts`/`module.test.ts` cover it from both directions. |
| A click on a service opens its Service Schematic; a click on a module opens its Module Schematic | **Pass, logic only — no browser to click through.** `engine/navigation.ts`'s `nextDrillTarget` is the pure decision function, unit-tested for both directions and for the "goes nowhere" cases (a group, a facet card, the wrong kind at the wrong tier). `SchematicCanvas.tsx` turns a true click (pointer down/up with 0 movement) into a call to it; that wiring itself is untested, per this app's standing "no jsdom" limit — see §5. |
| Breadcrumb walk-up | **Pass, logic only.** `Breadcrumb.tsx`'s segments are buttons now; clicking one truncates `App.tsx`'s `path` array. Same untested-wiring caveat as above. |
| The module root node cannot be deleted | **Pass, against the real fixture.** `engine/module.test.ts`'s "cannot be deleted, on the real fixture" test opens `token-verifier` through the actual seam (not the auth-service stand-in an older test happened to reuse) and asserts `engine.canDelete(root.id)` refuses with `"Token Verifier cannot be deleted."` The predicate itself (`SchematicEngine.canDelete`) is Wave 3's; this wave's job was proving it against real module data, which no earlier wave's fixture had. |
| The coverage readout computes `7 of 8` on the fixture | **Pass.** `engine/anatomy.ts`'s `coverageOf` sums PRD §16.1's own per-method numbers (`verify_signature` 4, `refresh_keys` 3, `skew_window` 0) under a formula this wave defines (§4, item 5): `present` sums every method's covers count; `expected` sums the same count when it is above 0, and exactly 1 when it is 0. `4+3+0=7`, `4+3+1=8`. `module.test.ts` asserts the formula directly, the exact wireframe sentence it produces, and that the live `buildFrame` output carries it. |
| Stack Schematic: shared-node callout, `CANVAS PROPERTIES` empty state, footer note | **Pass.** Callout: `anatomy.ts`'s `sharedNodeCallout`, gated by `calloutKind`, reproduces PRD §4.3's exact string for `event-bus`. Empty state: `InspectorShell.tsx` now branches on "stack tier, nothing selected" and draws the heading, the computed body (services/edges/depth all live, only the timestamp is a placeholder — §4 item 8), and the 4-row derived tech stack. Footer note: pre-existing `legendFooter` mechanism, unchanged. |
| Service Schematic: pinned entry point, export strip with `←` marker and row-to-module highlight | **Pass.** Pinned entry point is Wave 3's `nodePolicy`, untouched. The export strip itself did not exist before this wave — I initially wired only the *data* (`graph.exports`) and had to come back and build the actual component once I noticed the gap; `SchematicCanvas.tsx`'s new `ExportStrip` draws it, and a row click calls `engine.select`, which is what lights the module (the same selection state every other node-click already used). |
| Module Schematic: facet palette, facet cards, agent-draft controls, `SATISFIES` callout, coverage readout | **Pass.** Palette: new `FacetPalette.tsx`, drawn inert (no write path exists to drag onto, same as the 2 empty-state actions). Facet cards: `anatomy.ts`'s `facetContentFor`, 1 case per facet kind, unit-tested against literal PRD/wireframe strings for all 5. Agent-draft controls: 3 disabled buttons on a `doc-block` card while `lifecycle: "draft"`. `SATISFIES`: a fixed constant, PRD §11.1 quoted exactly. Coverage: see the row above. |
| Module Schematic empty state | **Pass.** New `EmptyModule.tsx`, reachable at `?view=empty-module`, the same convention Wave 2 established for `?view=empty-stack`. |
| Click-to-drill and breadcrumb walk-up | **Pass, logic only** — see the 2 rows above. |
| `Auto-sort` and `Fit` on all 3 tiers | **Pass, by construction.** `Toolbar.tsx` calls `engine.autoSort()`/`engine.fit()`; neither method nor the toolbar branches on tier, so this was never separately at risk once the engine opened 3 real tiers instead of always the same 1. |
| `pnpm verify` passes | **Pass.** See §6. |

## 4. Assumptions, every one of them

0. **`serviceSlug`/`serviceTitle` keep their original names** on the now-3-tier
   `SchematicGraph` (renamed from `ServiceGraph`, kept as an alias) rather
   than a tier-generic rename, since every existing caller already reads
   them that way and a rename touches call sites for no behavioural change.
1. **`platform-core` is a real semantic node, not a cosmetic annotation
   group**, even though it shares the `"group"` kind string PRD §11.3 uses
   for the annotation tier. PRD §16.1 states plainly that it *contains*
   `auth-service` and `session-service` as real children — an annotation
   group (Wave 3's `addGroup`) never gains real children by construction.
   `engine/layout.ts`'s `toGraph` tells the 2 apart by exactly that: a group
   with real children in the projection is kept (so the Stack Outline lists
   it, matching the wireframe); an empty one (tier 2's `Token pipeline`) is
   dropped (also matching the wireframe, which never lists it). This is the
   fix for the exact bug flagged in advance: the pre-Wave-5 projection
   collapsed every non-`service` kind to `"module"` and dropped every group
   unconditionally, which would have hidden `platform-core` and miscounted
   every facet card as a module the moment the Module Schematic opened.
2. **`ledger-store` nests inside `session-service`** — a `service`-kind
   node with a `service`-kind parent — because PRD §16.1 states it plainly
   and nothing in PRD §4.1 restricts containment to same-kind pairs.
3. **Computed stack containment depth is 4**, not the wireframe's drawn `2`
   nor WIREFRAME-EXTRACT.md's own speculative "would make depth 3" — both
   undercount because neither treats `platform-core` as a real containment
   level. PRD §0.4 makes the computed value the truth; `stack.test.ts`
   asserts `4` directly rather than either drawn number.
4. **The stack's 7 dependency edges** are this wave's own construction from
   PRD §16.1's prose ("Seven dependency edges join them"), per
   WIREFRAME-EXTRACT.md Resolution 10.2's own ruling for this exact fixture.
   Every one of `event-bus`'s 4 dependents holds an edge to it (matching its
   own drawn badge); the remaining 3 join `api-gateway` to the services it
   fronts.
5. **The coverage-readout formula** (§3's table) is this wave's own
   invention — no source states it. I chose it because it reproduces PRD
   §16.1's own literal per-method numbers into the wireframe's own drawn
   `7 of 8` without hand-tuning either side; it is the 1 number in this
   handoff I'd most want a human to re-derive independently.
6. **The shared-node callout's heading names the slug, not the title.**
   PRD §4.3's literal text is `WHY EVENT-BUS SITS HERE` — the hyphenated
   slug form, not `EVENT BUS`. Generalised via a small numeral-to-word table
   (1 through 6) for any future shared node's own dependent count.
7. **Facet-card content is 5 short generic string lines per kind**
   (`facetContentFor`), rendered by the same generic caption-line mapping
   `NodeBox` already used for every other node, rather than 5 bespoke JSX
   blocks. Keeps `SchematicCanvas.tsx`'s "the renderer decides nothing" rule
   intact; the cost is that a real product would likely want per-kind
   typography (a signature in a different weight than a probe command) that
   this wave's flat string list cannot carry.
8. **`CANVAS PROPERTIES`'s `layout saved 4m ago`** stays the wireframe's
   literal placeholder text — no real timestamp is tracked anywhere in this
   app yet, only `layoutDirty`'s clean/modified boolean.
9. **The screen-reference path uses `schematify://`**, PRD §16.1's own form
   (the renamed one, per PRD §12.5: "changed to `schematify://screen/...`"),
   not WIREFRAME-EXTRACT.md's unrenamed `journeyman://` — the PRD section is
   explicit that this is the corrected form.
10. **Default landing view is unchanged**: the Service Schematic for
    `auth-service`, per Wave 2/3's own acceptance conditions. Only the
    breadcrumb's `Stack` segment changed meaning — it now walks up to a real
    Stack Schematic instead of sitting as a static label.
11. **A module re-clicked at its own Module Schematic does not navigate.**
    `nextDrillTarget` only fires stack→service and service→module; a facet
    card, an annotation node, or the open root itself all return `null`.
12. **Free-floating annotation boxes (the 2 callouts and the export strip)
    are positioned at a fixed canvas corner**, not the wireframe's own
    measured pixel inset. No browser was available to check placement
    against a real canvas — see §5.
13. **The facet palette, the 3 doc-block review controls, and the Module
    Schematic empty state's own seed action are all drawn inert.** None has
    a write path this wave's seam makes (`schematify_write_node` is a later
    wiring wave's work), the same reasoning `EmptyStack.tsx` already gave
    its own disabled action.
14. **The contract-sheet arrangement now groups facets by kind**
    (`contract-method`, `test-case`, `budget`, `doc-block`, `external-dep`,
    then the 2 annotation kinds — the palette's own order) rather than the
    flat single column Wave 3 shipped as a first cut. Positions are still
    the same single column at the same offset from the root; only the
    ordering within it changed.
15. **Only `auth-service` and `token-verifier` carry real fixture content.**
    Drilling into any other service or module (e.g. `billing-service`,
    `jwks-cache`) opens a Schematic with a root and nothing else, since
    those fixtures do not exist on this branch — the same gap Wave 3 and
    Wave 4 already recorded for the service tier, now also true of the 2
    new tiers.

## 5. What a human must look at

No browser was available this wave either, the same limit every prior
wave's handoff records. Everything below is unverified on screen.

1. **The Stack Schematic** (drill up via the breadcrumb's `Stack` segment
   from the default view, or open with a tier switch once one exists in the
   running app). Look for: 7 service boxes plus 1 `Platform Core` group box
   containing `Auth Service` and `Session Service`; a `WHY EVENT-BUS SITS
   HERE` callout somewhere in the top-right or bottom area; the header line
   reading `7 services · 7 dependency edges` beside the breadcrumb; the
   Inspector's right panel reading `CANVAS PROPERTIES` with the derived
   tech-stack table below it, when nothing is selected.
2. **Clicking a service box** on the Stack Schematic — confirm it actually
   opens that service's own Service Schematic (only `auth-service` has real
   content; anything else will look empty, which is expected per assumption
   15, not a bug).
3. **The Service Schematic's export strip**, top-right corner: 4 rows,
   `issue_pair`/`verify_signature`/`revoke`/`check_password`, each with its
   owning module name. Click one and confirm the named module's box gets
   the `kv-node--selected` accent border and the strip's own row grows a
   `←` marker.
4. **Drilling into `token-verifier`** from the Service Schematic (click its
   box). Confirm: a left-rail `FACET PALETTE` panel appears between the
   Outline and the canvas; the root box reads `MODULE ROOT · CANNOT BE
   DELETED`, `layer backend · 8 facets`, and `schematify://screen/login-form`;
   8 facet cards fan out in 1 column, grouped contract-method → test-case →
   budget → doc-block → external-dep; the `skew_window` card reads
   `▲ no covers edge from any test case`; a `COVERAGE OF DESIGN` box reads
   `7 of 8 covers edges present. skew_window has none…`; a `SATISFIES` box
   sits near it.
5. **The doc-block card's 3 buttons** (`Accept`/`Edit`/`Discard`) — confirm
   they render but do nothing when clicked (by design this wave).
6. **`?view=empty-module`** — confirm the 3 dashed placeholder cards and the
   `◈ NOT HERE` boundary note render legibly at whatever width the app
   frame actually is.
7. **Breadcrumb walk-up** — from the Module Schematic, confirm clicking
   `Auth Service` in the breadcrumb returns to the Service Schematic, and
   clicking `Stack` from there reaches the Stack Schematic, without a full
   page reload or a flash of the wrong tier's chrome.
8. **Zoomed-out module facet cards** — confirm the new `facet-content` and
   `draft-controls` rows disappear at the `mid`/`geometry` zoom tiers the
   same way `description`/`badges`/`facets` already did (Wave 4's own rule,
   extended by this wave's CSS selectors rather than re-derived).

## 6. Verification

| Check | Result |
|---|---|
| `pnpm build` | Pass |
| `pnpm test:js` | Pass — 592 in the workspace suite (228 this app's), plus the bridge's own 28 |
| `pnpm lint:js` | Pass, 0 errors, 8 pre-existing warnings, none in this app |
| `pnpm lint:comments` | Pass, 0 files above limit, 0 new baseline entries |
| `pnpm lint:version`, `lint:identity`, `lint:branding` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test:rust`, `pnpm lint:rust` | Pass — clippy at its baseline of 0; no Rust file was touched this wave |

`pnpm baseline` was never run. No test was deleted or skipped.

## 7. Left undone, on purpose

- **Real per-kind facet typography** — a signature, a probe command, and a
  doc-block body all draw as the same generic dim mono line (assumption 7).
- **A kind picker for the tier-3 edge gesture** — Wave 3's own assumption 7
  carries forward unchanged; a port drag still creates the tier's first edge
  kind (`covers` at tier 3).
- **The facet palette's drag gesture, the doc-block review actions, and the
  Module Schematic empty state's seed action** — all drawn, none wired
  (assumption 13).
- **Real fixture content for any service or module beyond `auth-service`/
  `token-verifier`** (assumption 15).
- **Search** — the toolbar's search field stays disabled at every tier,
  Wave 8 scope, unchanged from Wave 3.
- **Pixel-accurate placement of the 2 callouts and the export strip**
  (assumption 12) — geometry is a reasonable fixed corner, not a
  wireframe-measured coordinate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EkL1TAeCe1DYp1FZFRhfXQ
