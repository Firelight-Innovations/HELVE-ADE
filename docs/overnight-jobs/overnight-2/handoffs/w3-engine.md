# Wave 3 handoff — the Schematic engine

Branch `schematify/w3-engine`, stacked on `schematify/w2-shell`. Pull request
opened with `--base schematify/w2-shell`; the orchestrator retargets it to
`main` once Wave 2 lands.

**This document is the interface Wave 5 builds against.** Sections 1 and 2 are
the part to read before writing a line of the Stack, Service or Module
Schematic. Everything after section 4 is the record.

---

## 1. The configuration surface

One engine, configured 3 ways. The whole interface is
`apps/schematify/ui/src/engine/config.ts`, and the 3 tier configurations are
data in `apps/schematify/ui/src/engine/presets.ts`. Nothing in the engine
branches on the tier.

```ts
interface SchematicConfig {
  tier: "stack" | "service" | "module";
  layoutSlug: string;              // positions persist to layout/<slug>.json
  grid: { size: number; snap: boolean };
  zoom: { min: number; max: number; initial: number };
  edgeKinds: readonly EdgeKindRule[];   // the tier's closed vocabulary, PRD §11.1
  containment: { mode: "nesting" } | { mode: "nesting-and-arrows"; label: string };
  annotations: boolean;            // groups and comments, PRD §12.4
  chrome: { minimap: boolean; zoomReadout: boolean; legend: boolean };
  legendFooter: string;            // the note beside the legend chips
  nodeBox: (kind: SchematicNodeKind) => Size;   // the one callback
}
```

An `EdgeKindRule` is a row rather than a callback, so a refusal can name the
rule it came from and a test can enumerate a tier's vocabulary without running
a drag:

```ts
interface EdgeKindRule {
  kind: EdgeKind;                              // PRD §11.1
  from: readonly (SchematicNodeKind | "*")[];  // what each end accepts
  to: readonly (SchematicNodeKind | "*")[];
  acyclic: boolean;                            // refuse an edge that closes a loop
  style: EdgeStyle;                            // line, arrowhead, --kv-* token, width
  refusal: string;                             // drawn at the cursor on a kind mismatch
}
```

### How a tier is configured

```ts
const engine = await openSchematic(SERVICE_CONFIG);   // or STACK_ / MODULE_
<SchematicCanvas engine={engine} />
```

`openSchematic(config, seam?)` reads the graph and the layout file through the
seam, joins them, and returns a `SchematicEngine`. That is the entire wiring.
`TIER_PRESETS` holds all 3 by tier name for a tier switch.

**Wave 5 should change the presets, not the engine.** If a tier needs
behaviour this shape cannot express, add a field to `SchematicConfig` — a
second canvas is the failure mode this wave exists to prevent.

## 2. What the engine offers

`SchematicEngine` (`engine/engine.ts`) holds one open Schematic. State is
immutable and replaced wholesale; `subscribe(listener)` drives React, and
`settled()` awaits the writes a gesture started.

| Group | Methods |
|---|---|
| Viewport | `pan`, `zoom`, `fit`, `setSize` |
| Selection | `select`, `clearSelection`, `boxSelect`, `hitTest` |
| Arrangement (cosmetic writes only) | `moveSelection`, `toggleCollapse`, `reparent`, `autoSort` |
| Annotation tier (cosmetic writes only) | `addGroup`, `addComment`, `removeAnnotation` |
| Design changes (semantic writes) | `createEdge`, `deleteEdge`, `duplicateSelection`, `copy`, `paste` |
| History | `undo`, `redo`, `canUndo`, `canRedo` |
| Reporting | `state`, `index`, `writes`, `semanticWrites`, `layoutDirty` |

`buildFrame({ doc, config, viewport, size, selection })` turns all of that into
one frame: the visible boxes with their computed captions, every routed edge,
the legend chips, the zoom readout, the minimap, and the node and edge counts.
The renderer decides nothing.

Every refusal comes back as `{ heading: "Drop refused", reason }` from the
method that refused, rather than as a thrown error, because the reason is drawn
at the cursor.

## 3. Edge routing, and the line that is not an edge

**Routing** (`engine/routing.ts`) enumerates 5 orthogonal shapes — straight
across, split at the midpoint, around above, around below, and a last-resort
dogleg — and takes the first that enters no obstacle, breaking ties on bend
count then length. PRD §12.3's 2 constraints are one predicate applied to a
list `frame.ts` chooses:

- **An edge crosses a group border.** A container is not an obstacle. The
  obstacle list is the visible boxes that have no visible children, minus
  groups, minus either endpoint's own ancestry.
- **An edge never enters a sibling box.** Everything else is an obstacle, and
  `routing.test.ts` asserts it over every edge of the whole fixture against
  every box that is not one of its 2 ends, not on a chosen pair.

When no candidate is clean the shortest is drawn anyway and the route is marked
`clean: false`. An edge that vanishes is worse than one drawn awkwardly, and
PRD open item 19.8 still owns the routing algorithm and the bundling rule above
40 edges.

**The rendered-not-stored line.** WIREFRAME-EXTRACT.md Resolution 10.1 row 7.1
rules that the Module Schematic draws containment from the module root to each
facet card as a labelled arrow, though the graph stores no containment edge.
That is expressed as `containment: { mode: "nesting-and-arrows", label }`:

- `frame.ts` synthesises those lines every frame from `parentId`;
- each carries `stored: false` and its label, and no identifier a gesture can
  name;
- none is in `doc.edges`, so nothing can create, delete or reroute one;
- `Frame.counts.edges` counts `doc.edges` and never sees them.

`frame.test.ts` asserts each of those 4 separately, and asserts that a tier
whose mode is plain `nesting` draws none.

## 4. Acceptance conditions (PRD §17 Wave 3)

| Condition | Result |
|---|---|
| A node drag writes no semantic file; only the layout file changes | **Pass.** `engine.test.ts` asserts it on both sides of the seam: the engine's own write log is empty of semantic paths, and the memory seam's semantic map is empty, while `layout/auth-service.json` holds the new position. Drags, collapses, reparents, groups and comments are all asserted the same way. |
| A semantic edge dropped on a comment is refused with §11.3's text | **Pass.** Compared literally, not by substring: `A comment is annotation tier. It cannot carry covers or any semantic edge.` Asserted for a drop on a comment, a drag from a comment, and that nothing at all is written when it refuses. |
| A cycle edge is refused with §12.5's text | **Pass.** `A dependency edge here would create a cycle.` Asserted for a direct loop back and for a 3-node loop. |
| A duplicate mints a new UUIDv7 | **Pass.** The identifier is not the original, matches the version-7 and variant bits, and the slug takes `-copy`, then `-copy-2`. A duplicated subtree mints one for every node in it. |
| The dense fixture holds a 16 ms frame time, asserted from a test suite | **Pass.** `frameBudget.test.ts`. Median of 21 runs, **1.18 ms** on the reference machine (min 1.05, max 2.25) against the 16 ms budget. |
| `pnpm verify` passes | **Pass.** See section 8. |

### Why the frame budget cannot pass vacuously

Three guards, because a timing test that cannot fail is worse than none:

1. The subject is checked against PRD §16.2's own numbers before anything is
   timed — 200 modules, 260 edges, containment depth 5, each asserted.
2. The viewport is sized to hold the whole fixture, so culling removes nothing,
   and every sampled frame is asserted to have drawn all 200 boxes. A frame
   that got faster by drawing less fails on the sample that did it.
3. The threshold is the PRD's 16 ms with no machine allowance and no skip. A
   slow machine fails this test, which is the intended behaviour: §14.7 marks
   the budget `hard`, and a hard budget gates a wave.

A second case runs the same assertion with a fifth of the graph collapsed,
because roll-up and stand-in resolution are work a flat fixture never does.

## 5. The seam, and the two storage layers

Wave 2 established `apps/schematify/ui/src/graph/index.ts` as the one module a
backend replaces. Wave 3 widened it from a loader to a loader and a writer
without widening it to a second module. `SchematifySeam` is now every read and
every write this app makes:

```ts
interface SchematifySeam {
  loadGraph(): Promise<ServiceGraph>;               // schematify/load-graph
  loadDenseGraph(): Promise<ServiceGraph>;          // the §16.2 benchmark fixture
  readLayout(slug): Promise<LayoutFile | null>;     // schematify/read-layout
  writeLayout(slug, file): Promise<void>;           // schematify/write-layout
  writeSemantic(path, json): Promise<void>;         // nodes/, edges/
  removeSemantic(path): Promise<void>;
}
```

`createMemorySeam()` is the one implementation, and the wiring wave replaces
its 6 bodies with 6 `invoke` calls. Per
`docs/audits/schematify-baseline.md` §11, those are JSON-RPC methods on
`schematify.rs`'s own dispatch, not new `#[tauri::command]`s — no
`generate_handler!` line and no `src/bindings.ts` entry.

The split between `writeLayout` and `writeSemantic` is the enforcement point
for PRD §6.2, not a convenience. A gesture that only arranges the picture may
call the first and may never call the second, and the acceptance test reads the
seam to prove it.

`layout/<schematic-slug>.json` holds positions, sizes, collapse state, the
annotation tier and the viewport. `layout.test.ts` asserts that each node entry
holds exactly `x`, `y`, `width`, `height`, `collapsed` and nothing else.

## 6. Assumptions, every one of them

Recorded because a source was silent or in tension. Each is a decision this
wave made alone, and each is cheap to reverse.

1. **Groups and comments persist to the layout file, not to `nodes/`.**
   PRD §6.1 names groups as layout content; §11.3 puts both kinds in the
   annotation tier, out of reconciliation and unable to carry a semantic edge.
   Comments are not named in §6.1's list, and are stored the same way on the
   grounds that they are the same tier. The consequence is deliberate: creating
   a comment writes no semantic file.
2. **The group refusal wording.** §11.3 gives the exact sentence for a comment.
   No source draws the group's, so it is the same sentence with the kind named:
   `A group is annotation tier. It cannot carry covers or any semantic edge.`
3. **The containment-cycle refusal wording.** §12.5 requires the refusal and
   supplies no text. `A containment change here would create a cycle.` `[P]`,
   parallel to the dependency sentence the PRD does supply.
4. **Two refusals no source asks for**: a duplicate edge
   (`That edge already exists.`) and a self-edge (`An edge needs two different
   nodes.`). Both `[P]`. The first exists because a second identical edge would
   double every count while being indistinguishable from the first.
5. **The duplicate slug suffix is `-copy`, then `-copy-2`.** §12.3 requires "a
   suffix" and names none. Uniqueness is checked against siblings only, per
   §3.2's slug scope.
6. **Cycle detection spans every acyclic kind at once**, so a loop alternating
   `depends_on` and `implements` is refused. Both are dependency-family
   relations and the linter would report the loop either way.
7. **A port drag creates the tier's first edge kind** (`depends_on` at tiers 1
   and 2, `covers` at tier 3). No kind picker exists yet; that is Wave 5 or 6
   surface, and the engine takes the kind as an argument already.
8. **The legend draws one chip per configured edge kind.** PRD §12.1 says the
   Module Schematic legend "reads `contains`, `covers`, `satisfies`" — 3 items
   — but §11.1's tier-3 vocabulary also holds `documents`, so the chip row
   drawn is 4 wide. Trimming it is a one-line change in the preset if the owner
   wants the PRD's exact 3.
9. **The roll-up caption pluralises.** The wireframe draws `3 edges
   aggregated`; a count of 1 draws `1 edge aggregated` rather than the
   ungrammatical singular of the drawn string.
10. **The dense fixture is generated in TypeScript**, at
    `graph/dense.ts`, to PRD §16.2's numbers, because `fixtures/dense-service/`
    and `fixtures/generate.mjs` do not exist on this branch and
    `00-AGENT-CONTEXT.md` forbids importing `crates/schematify-core`. It is
    reached only through the seam's `loadDenseGraph`, so the real fixture
    replaces one method.
11. **Default placement is not auto-sort.** A node the layout file does not
    name takes a deterministic arranged slot, because it has to be drawn
    somewhere and §12.3 forbids running auto-sort on load. `Auto-sort` is the
    toolbar control, rearranges everything, and is one undoable step.
12. **A hidden node is still placed.** A child inside a collapsed box is laid
    out as though the box were open, so expanding gives every node a position
    of its own. Collapsing shrinks a box to its kind's own size; expanding
    grows it around what it holds.
13. **Undo is snapshot-based and per Schematic**, and inverts the semantic half
    of a step as well as the cosmetic one — undoing an edge creation removes
    `edges/<uuid>.json`. No method on the engine performs a lifecycle
    transition, so §12.3's "undo shall never revert a lifecycle transition" is
    structural here rather than a check.
14. **The tier drawn by the running app is fixed to the Service Schematic.**
    The tier switch is Wave 5's `click-to-drill and breadcrumb walk-up`.
15. **`references_ui` targets a `screen` node kind** that no Schematic draws a
    box for this wave. The kind is named in the vocabulary so the edge table
    stays honest rather than widening the rule to `*`.

## 7. What a human must look at, because no test covers it

Vitest here runs on `node` with no jsdom (`vitest.config.ts` states why), and
no browser was available to this wave. So **every pixel below is unverified**,
and the component that draws them (`engine/SchematicCanvas.tsx`) has no test at
all. Everything it delegates to is tested; nothing it does itself is.

1. **That the Schematic draws at all**, inside the shell's own frame: boxes on
   the dot grid, edges between them, the zoom readout and legend chips at the
   lower left, the minimap at the lower right.
2. **Every pointer gesture.** Wheel to zoom about the cursor, alt-drag or
   middle-drag to pan, drag on empty space to box-select, drag a box to move
   it, drag from a right-edge port to another box to create an edge.
   Ctrl+Z / Ctrl+Shift+Z / Ctrl+C / Ctrl+V / Ctrl+D, and Escape.
3. **The refusal toast**: drop an edge on a comment and confirm the reason
   appears at the cursor, reads the §11.3 sentence, and appears *before* the
   drop rather than after it.
4. **Whether the arranged picture is any good.** The nested row-major flow is
   deterministic and legible in the abstract; nobody has seen it. It is the
   most likely thing to want redoing, and it is 1 file (`engine/arrange.ts`).
5. **Whether routing looks right at 68% zoom** with the fixture's real
   geometry, particularly edges that leave a nested box.
6. **Whether a node box at the default sizes reads** at all. Sizes come from
   the wireframe's drawn geometry, but node anatomy is Wave 4's, so what draws
   inside them today is a title, a slug and 2 captions.

## 8. Verification

| Check | Result |
|---|---|
| `pnpm build` | Pass |
| `pnpm test:js` | Pass — 88 tests in `apps/schematify/ui/src`, whole suite green |
| `pnpm lint:js` | Pass |
| `pnpm lint:comments` | Pass, with no new baseline entry |
| `pnpm lint:version`, `lint:identity`, `lint:branding` | Pass |
| `pnpm format:check` | Pass |
| `pnpm test:rust`, `pnpm lint:rust` | Pass — no Rust file was touched this wave |

`pnpm baseline` was never run. No test was deleted or skipped.

## 9. Left undone, on purpose

- **Node anatomy** (badges, lifecycle treatments, health wedges, the 3 zoom
  tiers) is Wave 4. The box drawn today is deliberately plain.
- **The 3 Schematics** — tier switch, drill-down, breadcrumb walk-up, export
  strip, facet palette, the shared-node callout — are Wave 5, and the presets
  are where they start.
- **Edge bundling above 40 edges** (PRD open item 19.8) is not implemented. The
  router draws every edge individually; the dense fixture holds the frame
  budget without bundling.
- **A kind picker for edge creation.** See assumption 7.
- **Search**, so the toolbar's search field stays disabled — Wave 8.
- **Animated zoom-to-fit.** §12.3 asks for animation and `fit()` cuts. The
  destination viewport is computed in one place (`viewport.ts`'s `fitTo`), so
  animating it is a change in the component, not in the engine.
