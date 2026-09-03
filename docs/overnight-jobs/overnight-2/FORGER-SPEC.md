# Forger — Specification

**Status:** Draft 1. Source of truth for what Forger is and how its data behaves. Companion document: `FORGER-UI.md`.

---

## 1. Purpose and boundary

Forger is the technical design layer of the Veistra agentic development methodology. It produces the Software Design Document (SDD) as a typed, machine-readable graph.

**In scope:** module structure, service topology, public contracts, test-case declarations, resource budgets, allowed external dependencies, code-standard rules, documentation attached to design nodes, and the audit trail proving the built codebase matches the design.

**Out of scope:** what the software is for, who uses it, UX flows, wireframes, product decisions. Those belong to Journeyman. Forger *references* Journeyman artifacts; it does not contain them.

**Explicitly not a build system.** Forger declares probes and ingests their results. It never executes tests, linters, or benchmarks. A developer keeps their own toolchain and their own CI. A `git clone` plus that CI produces every number Forger displays, with Forger uninstalled.

**Explicitly not the decision log.** Decisions live in a separate app. Forger nodes reference decisions by URI.

---

## 2. The three tiers

Forger presents exactly three levels of drill-down. Each level is a canvas. Clicking a node opens the level below it.

| Tier | Canvas shows | Node kind |
|---|---|---|
| 1 — Stack | All services in the system, their containment tree and their dependency edges | Service |
| 2 — Service | All modules composing one service, arbitrarily deep containment, plus the service entry point and its exported interface | Module |
| 3 — Module | The internals of one module: its contract methods, test cases, budgets, docs, external deps | Facet |

Drill-down depth is fixed at three. Structural depth inside tiers 1 and 2 is unbounded — a service may contain a module which contains a module which contains a module, and all of it renders on the single service canvas. Depth in the *tree* is not depth in the *navigation*.

A module drawn as a box on the service canvas and the root node on that module's own canvas are one node in two renderings. Not two objects, not two files, not two ids.

---

## 3. Two relations, never merged

**Containment** is a strict tree. Exactly one parent. Purely organizational — it answers *where does this live*. Renders as nesting or a boxed hierarchy.

**Dependency** is a directed acyclic graph. Many edges, no ownership implied. It answers *what does this call*. Renders as drawn edges.

A shared component is never a child of one of its consumers. Its containment parent is the lowest common ancestor of everything that depends on it; each consumer gets a `depends_on` edge. This rule is identical at the service tier and the module tier, and is enforced by one linter implementation at both.

**Allowed dependencies** is a third, separate concept: the whitelist of *external libraries* a node may use. It is a field on the node, not an edge. Internal relationships are edges; external libraries are a list.

---

## 4. Identity

Every node, edge, rule, decision reference, and registry entry carries two identifiers.

- **`id`** — UUIDv7. Opaque, immutable, generated locally without coordination, time-sortable. Every reference anywhere in the system stores this and only this.
- **`slug`** — human-readable, mutable, unique within its parent scope. Rendered in the UI and searchable in code. Never stored in a reference.

Sequential or path-derived ids are prohibited. Two agents on two branches minting `MOD-0042` produces two different nodes sharing one identity, and no tool errors on it. UUIDv7 makes the collision impossible rather than unlikely.

Renaming or reclassifying a node changes the slug and nothing else. No inbound reference breaks.

---

## 5. Storage

All design data is atomic JSON on the project filesystem, tracked by git. One node per file. No aggregate index file exists — no `graph.json`, no `graph.yaml`. On start, Forger walks the tree, parses every file, and reconstructs the graph in memory.

Natural language lives inside JSON string fields, not in sibling Markdown files.

### 5.1 Three file layers with three different owners

```
sdd/
  nodes/<uuid>.json        # semantic — human-authored, human-owned
  edges/<uuid>.json        # semantic — human-authored, human-owned
  rules/<uuid>.json        # semantic — code standards and linter rules
  registry/libraries.json  # semantic — approved external libraries
  runs/<node-uuid>/*.json  # audit — machine-written, append-only, never hand-edited
  layout/<canvas-uuid>.json# cosmetic — positions, groups, collapse state
```

The split is not organizational tidiness. It is the enforcement mechanism for *an agent shall not change the SDD*: the permission boundary is a path glob, so CODEOWNERS and a CI path check enforce it mechanically instead of by instruction. A benchmark harness appending latency numbers can never conflict with a human editing a contract, because they write to different files.

Layout is separate for the same reason. Dragging a node shall not dirty a semantic file. Layout conflicts are cosmetic and safe to auto-resolve.

### 5.2 Branch behavior

Design data varying by branch is correct, not a defect. A feature branch that changes the design and the code together, reviewed as one pull request, is the traceability property working as designed.

The `runs/` layer is the exception — benchmark history and sign-off records should survive branch deletion. This is the natural seam for the future hosted store: `nodes/` stays in git, `runs/` moves to the server keyed by opaque id. The git-versus-canonical-store conflict listed as an open item in the philosophy document largely dissolves once the two layers live in different places.

### 5.3 Nothing is ever deleted

A node with inbound edges cannot be deleted. It moves to `deprecated` with a `superseded_by` pointing at its replacement. This applies to nodes, edges, rules, and registry entries without exception.

Boot validation has exactly one behavior for a dangling reference: quarantine the referring node and report it. Never silently drop.

---

## 6. Node schema

Common envelope on every node:

```json
{
  "id": "0192f4a1-...",
  "slug": "auth-token-verifier",
  "kind": "module",
  "title": "Token Verifier",
  "description": "Natural-language statement of what this module does, why it exists, and its place in the system.",
  "lifecycle": "specified",
  "parent": "0192f4a0-...",
  "decisions": ["decision://DEC-TEC-AUTH-004"],
  "created": "2026-08-25T00:00:00Z",
  "superseded_by": null
}
```

### 6.1 Service node

Adds:
- `entry_point` — how the service starts, and under what conditions.
- `exports` — array of contract-method node ids explicitly published across the service boundary.
- `schemas` — for data services, the schema definition (local or remote).

**Exports are authored, never aggregated.** Lower-level contracts do not propagate upward automatically. A service's outward-facing entry point almost always composes, transforms, or orchestrates several internal calls rather than passing one through, so an automatic roll-up would both leak internals and misdescribe the surface. Everything not on the export list is internal by construction, which gives a free CI check: a cross-service call to a non-exported method fails.

### 6.2 Module node

Adds:
- `allowed_libraries` — array of registry entry ids. A library not in the registry cannot be whitelisted.
- `ui_refs` — array of `journeyman://` URIs for front-end elements this module backs.
- `layer` — `backend` | `frontend` | `data` | `external`.

### 6.3 Facet nodes (tier 3)

Typed vocabulary. Each is its own file with the common envelope plus:

**`contract-method`** — `signature`, `params[]`, `returns`, `errors[]`, `semantics` (natural language), `exported` (bool).

**`test-case`** — `given`, `when`, `then`, `impl_ref` (marker token found in code), `status` (`declared` | `linked` | `passing` | `failing`).

**`budget`** — `metric`, `op`, `value`, `unit`, `tier` (`hard` | `soft` | `target`), `probe`.

**`doc-block`** — `body`, `audience` (`agent` | `human` | `both`).

**`external-dep`** — `registry_ref`, `usage_note`.

**`comment`** and **`group`** — annotation tier, see §10.

---

## 7. Budgets and probes

A budget declares a target and the command that measures it:

```json
{
  "metric": "cold_start_p95",
  "op": "<",
  "value": 200,
  "unit": "ms",
  "tier": "hard",
  "probe": { "command": "pnpm bench:startup", "parser": "forger-bench-v1" }
}
```

**A budget with no probe is a Forger lint error.** An unmeasurable quality claim is exactly the T2 violation the writing standard blocks, applied to design data instead of prose.

Tier semantics:
- `hard` — probe failure blocks CI.
- `soft` — probe failure warns and requires a named human sign-off to merge.
- `target` — tracked and graphed, never blocks.

CI runs the probe and emits a results artifact in a fixed schema. Forger ingests the artifact into `runs/` and renders it. Forger does not invoke the command.

---

## 8. Code linkage and the graph twin

Every design element that corresponds to something in code carries a marker token, placed anywhere in the file:

```
@forger:0192f4a1-4c3d-7890-a1b2-c3d4e5f6a7b8 auth-token-verifier.verify_signature
```

A fixed token searched by plain regex, not a docstring convention — comment syntax varies per language and a docstring parser breaks on the first language nobody anticipated. The UUID is authoritative; the trailing slug is there so a human can grep for a readable name.

Reconciliation runs in CI with four defined outcomes:

| Outcome | Meaning | Handling |
|---|---|---|
| Matched | Design element and code site agree | Pass |
| Declared, absent | Design says it exists; no marker in code | Unimplemented — expected while `lifecycle < implemented`, error after |
| Present, unknown | Marker in code, no such node | Error — undocumented deviation |
| Duplicate | Same id at two code sites | Error — the copy-paste failure, will happen constantly |

This is the graph twin from the philosophy document, running at symbol granularity rather than file granularity.

---

## 9. Lifecycle and staleness

```
draft → specified → assigned → implemented → reviewed → accepted
                        ↑                         │
                        └─────── rejected ────────┘
```

A human drafts and specifies. Assignment hands the node to an agent. The agent implements. A human reviews, and either accepts or bounces the node back to `specified` with feedback. Every transition appends to `runs/<node-uuid>/audit.json` with actor, timestamp, and reason.

**Staleness cascade:** when a node's contract changes, every node with an inbound `depends_on` edge to it drops from `accepted` to `stale`. Staleness is resolved only by a human re-review. Without the cascade, sign-off decays silently and the accepted state becomes a lie.

---

## 10. Typed vocabulary and the annotation tier

Every node and every edge carries a type. Edge types are closed at each tier:

- Tier 1–2: `contains`, `depends_on`, `implements`, `references_ui`
- Tier 3: `covers`, `satisfies`, `documents`

A `test-case` connected by `covers` to a `contract-method` yields coverage-of-design — the number that matters, and the one line coverage never reports.

**User-defined types** are permitted. They register a schema, declare which edge types they accept, and participate in the graph normally.

**Freeform nodes are annotation tier.** They are excluded from graph-twin reconciliation and may not carry semantic edges. A comment shall not be able to hold a `covers` edge. Without this rule the anti-slop constraint has a hole shaped like a text box, and load-bearing design detail ends up somewhere the reconciler cannot see.

---

## 11. Registries

**Library registry** — the single global list of approved external libraries: name, version pin, license, rationale, approving decision URI. A module may only whitelist a library present here. This puts license enforcement at design time; a GPL dependency becomes a blocked add rather than an audit-time discovery.

**Rule registry** — code standards and linter rules. Each carries: natural-language statement, the enforcing command, the marker token locating its implementation, severity, and its own audit history.

The tech-stack view is *derived* from per-node `allowed_libraries` aggregated against the registry. It is never authored directly, or the system holds two answers to "do we use NumPy."

---

## 12. Cross-app addressing

Forger references other HELVE apps by URI:

- `decision://<uuid>` — decision log entry
- `journeyman://screen/<uuid>` — PRD screen or flow
- `forger://node/<uuid>` — internal, for cross-service references

References may dangle until resolvers exist. Once a resolver ships, dangling references of that scheme become CI errors. This URI scheme is a required addition to the HELVE App API surface, and Forger is the app that forces its definition.

---

## 13. Linter rules Forger enforces on itself

| Rule | Severity |
|---|---|
| Containment graph is a tree — no node has two parents | Error |
| Dependency graph is acyclic | Error |
| Shared node sits at or above the LCA of its dependents | Warn |
| Budget declared without a probe | Error |
| Contract method with no `covers` edge from any test case | Warn |
| Library whitelisted but absent from registry | Error |
| Annotation node carrying a semantic edge | Error |
| Reference to a `deprecated` node without acknowledgement | Warn |
| Dangling reference after resolver exists | Error |

---

## 14. Open items

- Disposition of in-progress agent work when a node is bounced from `reviewed` to `specified`.
- Whether `soft` budget sign-offs expire.
- Migration path for a node whose `kind` changes (module promoted to service).
- Conflict semantics when the hosted `runs/` store and local git history disagree on lifecycle state.
