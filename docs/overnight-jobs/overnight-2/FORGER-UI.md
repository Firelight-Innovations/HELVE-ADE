# Forger — UI Specification

**Companion to `FORGER-SPEC.md`.** That document defines the model; this one defines what the user sees and does. Where the two disagree, the spec wins.

**Design lineage:** Unreal Engine Blueprint editor for node behavior, grouping, and comment boxes. draw.io for freedom of arrangement. The distinction from both: every node and edge here is typed and load-bearing, not decorative.

---

## 1. Application shell

```
┌────────────────────────────────────────────────────────────────┐
│ Breadcrumb: Stack › Auth Service › Token Verifier    [search]  │
├──────────┬─────────────────────────────────────┬───────────────┤
│          │                                      │              │
│ Outline  │            Canvas                    │  Inspector   │
│  tree    │                                      │              │
│          │                                      │              │
│          │                                      │              │
├──────────┴─────────────────────────────────────┴───────────────┤
│ Problems (n)  ·  Runs  ·  Registries  ·  Rules                 │
└────────────────────────────────────────────────────────────────┘
```

**Breadcrumb** is the only navigation between tiers. Three segments maximum, matching the three drill-down levels. Always visible, always clickable back up.

**Outline** is the containment tree of the current tier, mirroring canvas selection both ways. Lifecycle state shown as a leading dot.

**Canvas** is the primary surface. Everything below describes it.

**Inspector** edits the selected node. Empty state shows canvas-level properties.

**Bottom dock** collapses to a status strip. Problems badge shows error count; a non-zero error count is always visible.

---

## 2. The three canvases

All three use the same node-edge-canvas component with a different type vocabulary. One editor, three schemas. This should be built once and configured three ways, not built three times.

### 2.1 Stack canvas (tier 1)

Services and their relationships. Typically 3–20 nodes.

Containment renders as **nesting** — a parent service is a translucent container with children laid out inside it. Dependency renders as **drawn edges** between service boxes. These are different visual channels and must never share a line style.

Service node face shows: name, layer badge, lifecycle dot, export count, and a rolled-up health indicator (worst budget status of any contained module).

### 2.2 Service canvas (tier 2)

All modules composing one service, on a single canvas, at unbounded containment depth. Typically 10–200 nodes.

- Entry point node is visually distinguished and pinned by default at the canvas edge.
- Exported interface renders as a boundary strip along one edge, listing exported contract methods. Clicking one highlights the owning module.
- Deep containment renders as nested boxes, collapsible. A collapsed parent shows a child count and aggregates its children's dependency edges to its own border.

### 2.3 Module canvas (tier 3)

The internals of one module. Typically 5–40 nodes.

Opens with the module root node already present — the same node the user clicked on the tier above, in its second rendering. It cannot be deleted from this canvas.

Facet nodes attach to the root. A new module canvas is pre-seeded with an empty `contract-method`, `test-case`, and `budget` node so the shape is obvious without reading documentation.

Users drag new typed facets from a palette, or invoke an agent to pre-fill them, then review and edit.

---

## 3. Node anatomy

Every node, every tier:

```
┌─────────────────────────────────┐
│ ● Token Verifier          [⋯]   │  header: lifecycle dot, title, menu
│ auth-token-verifier             │  slug, dimmed, monospace
├─────────────────────────────────┤
│ Verifies JWT signatures against │  description, 2 lines, truncated
│ the rotating key set.           │
├─────────────────────────────────┤
│ ⬤ 3 methods  ⬤ 7 tests  ⬤ 2 budg│  facet counts (tier 2 only)
├─────────────────────────────────┤
│ ▸ react  ▸ jose                 │  allowed libraries
└─────────────────────────────────┘
     ○ in                    out ○   connection ports
```

The UUID never appears on the node face. It appears in the Inspector, in a copy-on-click field, and nowhere else.

### 3.1 Lifecycle as visual state

| State | Treatment |
|---|---|
| `draft` | Dashed border, muted fill |
| `specified` | Solid border, neutral fill |
| `assigned` | Solid border, agent glyph in header |
| `implemented` | Solid border, filled progress edge |
| `reviewed` | Solid border, half-filled check |
| `accepted` | Solid border, filled check, saturated accent |
| `stale` | Accepted treatment plus a warning overlay stripe |
| `deprecated` | Heavy desaturation, strikethrough title, 40% opacity |

State must be legible at zoom levels where text is unreadable. Border weight, fill saturation, and overlay geometry carry the signal — color alone is not sufficient.

### 3.2 Health indicator

Separate from lifecycle. Derived from the latest ingested run:

- All hard and soft budgets passing, all tests passing — no indicator.
- Any soft budget or test failing — amber corner wedge.
- Any hard budget failing — red corner wedge.
- No run data — hollow corner wedge.

---

## 4. Edges

| Edge | Style |
|---|---|
| `contains` | Not drawn — expressed as nesting |
| `depends_on` | Solid, arrowhead at target |
| `implements` | Dashed, hollow arrowhead |
| `references_ui` | Dotted, distinct accent, terminates in a Journeyman glyph |
| `covers` (tier 3) | Solid, thin, test → method |
| `satisfies` (tier 3) | Solid, thin, node → budget |
| `documents` (tier 3) | Dotted, thin |

Edge creation drags port to port. If the target type does not accept the edge type, the drop is refused at drag time with the reason shown at the cursor — never accepted then flagged later.

An attempted edge that would create a containment cycle or a dependency cycle is refused the same way.

---

## 5. Canvas interaction

**Free arrangement.** Nodes drag anywhere and stay where they were left across reloads. Positions persist to `layout/<canvas-uuid>.json`, never to semantic files.

**Auto-sort** applies a layout algorithm to the whole canvas or to a selection only. Always undoable, never automatic, never on load.

**Groups** — select nodes, group them, get a titled box with its own color and collapse toggle. Groups are annotation-tier: no semantic meaning, excluded from reconciliation, freely nestable.

**Comments** — free-floating text boxes, optionally anchored to a node. Annotation-tier. Cannot carry semantic edges; attempting one is refused at drag time.

**Multi-select, box-select, copy, paste, duplicate, undo/redo** as standard. Duplicating a node mints a new UUIDv7 and appends a suffix to the slug — never copies an id.

**Minimap** bottom-right, showing error and health markers so problems are findable in a large service canvas without panning.

**Zoom-to-fit, zoom-to-selection, and search-jump** all animate rather than cut, so the user keeps spatial orientation.

---

## 6. Inspector

Tabbed, contents by node kind.

**Identity** — title, slug, description, kind, opaque id (read-only, copy button), created date.

**Lifecycle** — current state, transition buttons valid from the current state only, assignee, and the last three audit entries with a link to the full log.

**Contract** (service, module) — method list with signatures. Toggle to a formal rendering — OpenAPI-style for HTTP surfaces, plain signature listing otherwise. Exported methods marked; on a service, this is the authored export list and is directly editable here.

**Tests** — declared cases, their `impl_ref` marker token, link status, and last result. A case with no code link is visually distinct from one that is linked but failing; these are different problems.

**Budgets** — metric rows with tier, current value from the latest run, and a sparkline of history. A budget missing a probe shows an inline error and a fix affordance.

**Dependencies** — two sections, never merged: internal `depends_on` edges (read-only, edited on canvas) and allowed external libraries (edited here, picked from registry, with license shown).

**Docs** — the agent-facing documentation body. This is what an agent traverses the graph to read, so it gets a first-class editor, not a cramped text field.

**References** — decision URIs, Journeyman URIs, inbound reference count. Dangling references flagged.

---

## 7. Module dashboard

Reached from a module's Inspector or from its canvas root node. Read-only. Renders the ingested audit trail:

- Latest run summary — pass or fail per budget, test results, linter results.
- History graphs per budget metric, with the threshold drawn as a line so a trend toward the limit is visible before it breaches.
- Lifecycle audit log — every transition, actor, timestamp, reason.
- Contract change history, since contract changes are what trigger staleness downstream.
- Reconciliation status — matched, unimplemented, unknown, duplicate.

Nothing on this screen is editable. It is the record of what happened, not a place to make things happen.

---

## 8. Problems panel

Bottom dock. Every linter finding from spec §13, grouped by severity, each row clicking through to the offending node on the appropriate canvas.

Errors and warnings visually separated. The panel is the single place a user goes to answer "is the design valid," so it must never require scrolling to discover an error exists — errors sort first and the badge count is always visible on the collapsed strip.

---

## 9. Registries and rules screens

Not canvases. Tabular, searchable, sortable — this is the Excel-shaped part of the product.

**Libraries** — name, version pin, license, rationale, approving decision, and count of modules using it. Adding a library with an incompatible license is blocked with the reason stated, not warned after the fact.

**Rules** — natural-language statement, enforcing command, marker token, severity, audit history. A user shall be able to read every standard an agent is expected to follow on one screen. This is the answer to "what are the rules here," and it should read as a document, not as a config dump.

**Tech stack view** — derived, read-only, aggregated from per-module `allowed_libraries` against the library registry. Explicitly not editable, because authoring here would create a second answer to what the project depends on.

---

## 10. Search

Global, keyboard-invoked, spanning nodes, contract methods, test cases, rules, libraries, and decisions.

Searchable by slug, title, description text, and marker token. Results grouped by kind, showing the breadcrumb path to each hit so the user knows which tier they are jumping into.

This search must interoperate with the HELVE-ADE native search surface — cross-app results should reach Journeyman and the decision log. That interface is not yet defined and this is one of the drivers for defining it.

---

## 11. Agent affordances

Agent involvement appears in three places and nowhere else:

1. **Assign** — on a node, hands it to an agent, moves lifecycle to `assigned`.
2. **Pre-fill** — on an empty module canvas or an empty facet, drafts content for human review. Pre-filled content enters at `draft` and is visually marked as agent-authored until a human accepts it.
3. **Review queue** — a filtered list of nodes at `implemented` awaiting human review, and nodes at `stale` awaiting re-review.

An agent never transitions a node to `accepted`. That transition is human-only and the UI should make that structurally impossible rather than merely discouraged.

---

## 12. Empty and first-run states

A new project opens on an empty stack canvas with one action: create the first service. Each tier's empty state names what belongs there and what belongs elsewhere — a module canvas empty state should say what a module is and explicitly note that user-facing behavior belongs in Journeyman, because that boundary is the single most likely thing for a new user to get wrong.

---

## 13. What to prototype first

In order, for the first Claude Design pass:

1. Service canvas with nested containment, dependency edges, groups, and comments — the densest and most load-bearing screen.
2. Node anatomy across all lifecycle and health states, at three zoom levels.
3. Inspector with the Contract, Tests, and Budgets tabs populated.
4. Module canvas with root node and typed facets.
5. Stack canvas.
6. Module dashboard.

Registries, rules, problems, and search are conventional table and list surfaces; they can follow once the canvas language is settled.
