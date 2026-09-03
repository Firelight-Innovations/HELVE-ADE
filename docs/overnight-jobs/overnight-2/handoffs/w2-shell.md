# Wave 2 handoff — shell, tokens, status bar

Branch `schematify/w2-shell`, stacked on `schematify/w1a-retire` (which itself
carries `main` and the Wave 0 audit and wireframe extraction). PR opened
against `schematify/w1a-retire` per the task brief.

## What was built

All under `apps/schematify/ui/src/`:

- **`tokens.css`** — every PRD §13 token (13.1 through 13.5) as a CSS custom
  property, scoped to this document's `:root` (this app is its own iframe
  document, so it collides with nothing in `/src/tokens.css`). 2 values —
  `--kv-bg-root` and `--kv-accent-hover` — are derived rather than `[W]`, per
  `WIREFRAME-EXTRACT.md`'s Resolutions 7.3a/7.3b: neither hex value occurs
  inside any of the 6 product screens, only in the wireframe tool's own page
  chrome. `--kv-bg-root` is `--kv-bg-app` extended one step darker along the
  existing 3-step surface ladder (`#0d0e10`); `--kv-accent-hover` is
  `--kv-accent` blended 18% toward white (`#e2a35f`). Both are documented at
  the point of definition.
- **`graph/`** — the graph module. `types.ts` is the vocabulary
  (`GraphNode`, `GraphEdge`, `ServiceGraph`), `fixture.ts` is the hand-typed
  `auth-service` Service Schematic reproducing PRD §16.1's 12-node,
  9-edge, depth-3 fixture, and **`index.ts` is the module a later wiring
  wave replaces** — its `loadGraph()` function is the only place that reads
  `fixture.ts`; every caller reads the graph through `index.ts`'s exports
  (`loadGraph`, `countNodes`, `countEdges`, `statusCell1`, `statusCell2`,
  `computeDepth`, `outlineFooter`, `buildOutlineRows`) and never imports
  `fixture.ts` directly. Swapping `loadGraph`'s body for a real
  `invoke("schematify/load-graph", …)` call once `crates/schematify-core`
  merges is the entire wiring change; nothing else in `apps/schematify/ui/`
  needs to move. All counts are computed from the graph at call time (PRD
  §0.4) — none is stored.
- **`shell/`** — `TitleBar`, `TabStrip`, `Breadcrumb`, `Toolbar`, `Outline`
  (with its 3-entry `Design`/`Product`/`Decisions` section switcher),
  `SchematicHost` (an empty frame — Wave 3 builds the engine inside it),
  `InspectorShell` (the 5-tab frame, no tab content — Wave 6), `Dock` (the
  4-tab frame, no tab content — Waves 7 through 9), `StatusBar`, and
  `EmptyStack` (the Stack Schematic first-run state, PRD §12.20).
- **`App.tsx`** — composes the shell around `loadGraph()`'s result. A
  `?view=empty-stack` query param swaps the whole body for `EmptyStack`
  instead, since this wave builds no tier switch to reach it otherwise (see
  "What a human should look at").

`apps/schematify/ui/src/schematify.css` (the Wave 1a placeholder empty-state
stylesheet) was deleted — its one class is unused now that the shell draws
real chrome; `main.tsx` no longer imports it.

## The module the wiring wave replaces

**`apps/schematify/ui/src/graph/index.ts`**, specifically its `loadGraph()`
function. Everything else in `graph/` and `shell/` is written against that
function's return type (`ServiceGraph`) and is unaffected by the swap.

## Acceptance conditions (PRD §17 Wave 2)

| Condition | Result |
|---|---|
| No literal hex value in the Schematify UI | **Pass.** `src/noLiteralHex.test.ts` scans every `.ts`/`.tsx`/`.css` file under `apps/schematify/ui/src/` except `tokens.css` (the one documented exception) for `#[hex]`; 0 offenders, enforced as a regression test, not just a one-time grep. |
| The shell opens the fixture and draws the Outline tree with its header, badges, triangles, and footer | **Pass.** `App.tsx` calls `loadGraph()` and renders `Outline`, which draws `OUTLINE — CONTAINMENT`, the `ENTRY` badge on `http-entry`, the `STALE` badge on `audit-emitter`, `▾`/`▸` triangles, and the footer. `graph/index.test.ts` asserts the row shape (10 rows drawn, `session-store`'s 2 children hidden with a trailing count of 2, `token-verifier`'s 2 children drawn in full) since no DOM renderer is wired into this repo's Vitest config (`environment: "node"`, no jsdom — see `vitest.config.ts`'s own header). A human needs to look at the actual pixels; see below. |
| Status bar cell 1 reads exactly `.kaava/ · 12 nodes · 9 edges` | **Pass**, asserted in `graph/index.test.ts`. |
| Status bar cell 2 reads exactly `layout/auth-service.json clean` | **Pass**, asserted in `graph/index.test.ts`. |
| `pnpm verify` passes | **Pass.** `pnpm build`, `pnpm test:js`, `pnpm lint:js`, `pnpm lint:comments`, `pnpm lint:version`, `pnpm lint:identity`, `pnpm lint:branding`, and `pnpm format:check` all ran clean in the foreground. `pnpm test:rust` and `pnpm lint:rust` ran in the background (no Rust file touched this wave) — see the PR for their result if this line was written before they finished. |

## Assumptions, all recorded because a source was silent or in tension

1. **The 9 `auth-service` dependency edges' exact topology.** PRD §16.1 states
   the count (9) and names 1 edge (`session-codec → token-issuer`, part of
   the cycle finding) but never enumerates all 9. `fixture.ts` invents a
   plausible set reproducing the named edge and the count; no acceptance
   condition this wave checks the topology, only `countEdges() === 9`. A
   real loader (Wave 1 → wiring wave) replaces this with whatever
   `fixtures/saas-backend/` actually encodes.
2. **Containment depth counts the service root as level 1.** PRD §16.1 says
   "containment depth 3" for a service whose deepest nodes sit exactly 1
   level under a top-level module. `computeDepth()` in `graph/index.ts`
   documents this convention at the point of definition.
3. **`--kv-bg-root` and `--kv-accent-hover` are derived, not `[W]`.** Per
   `WIREFRAME-EXTRACT.md` Resolutions 7.3a/7.3b — taken as binding per that
   document's own status, not re-argued here.
4. **The title bar, tab strip, breadcrumb, and toolbar are drawn by
   Schematify itself, inside its own iframe**, even though
   `docs/audits/schematify-baseline.md` §3 documents that the real shell
   chrome (title bar, tab strip) is drawn once by the orchestrator's own
   `ClusterBar.tsx`, and no other first-party app draws a second copy of
   either. This wave built what PRD §17 Wave 2 and the task brief explicitly
   ask for ("Build the title bar, the application tab strip, the breadcrumb,
   and the toolbar") rather than resolving that tension unilaterally. A human
   should decide whether Schematify's own title bar and tab strip stay as
   wireframe-faithful chrome inside the iframe, or get cut once a real shell
   integration is scoped — this is a product decision, not a code defect.
5. **Status bar cell 2's "clean" is unconditional.** No layout file writer
   exists yet (Wave 3 builds `schematify_write_layout`), so there is no dirty
   state to report; `statusCell2()` takes a `clean` parameter (default
   `true`) so Wave 3 only needs to pass a real value through, not rewrite the
   function.
6. **`Product` and `Decisions` outline-switcher entries draw a named
   placeholder** ("Product — not built yet.") rather than nothing, so the
   switcher is honestly wired (PRD §12.1 marks the switcher itself `[P]` and
   Wave 2's ruling in `WIREFRAME-EXTRACT.md` §10.3 says build it).
7. **Dock and Inspector draw their tab labels but no tab content.** PRD §17
   Wave 2 says "the Inspector shell" and "the bottom dock frame" — read as
   frame-only, since every tab's content (S-04 through S-14) is named as a
   later wave's scope in section 12.2's wireframe-coverage note and in
   Waves 6 through 9's own bullet lists.
8. **The Stack Schematic empty state (`EmptyStack`) is reachable by
   `?view=empty-stack`, not the default view.** The default view is the
   populated `auth-service` Service Schematic, since every acceptance
   condition this wave names (Outline tree, status bar cells) is about that
   view. Building the tier switch that would show `EmptyStack` on an actually
   empty project is Wave 5 scope ("click-to-drill and breadcrumb walk-up").

## What a human should look at in the morning

No browser was available this wave (`00-AGENT-CONTEXT.md` forbids
`pnpm dev:agent`/`pnpm ui launch` for this job; `pnpm build` was the only
render-adjacent check run). Once safe to do so:

1. Open Schematify (`pnpm app`, the `Schematify` tab) and confirm the shell
   renders as described: title bar, tab strip, breadcrumb/toolbar row,
   Outline (with the section switcher, tree, badges, triangles, footer),
   an empty dotted Schematic frame, an inert Inspector frame, an inert dock
   frame, and a status bar with cells 1 and 2 filled and cells 3 and 4 blank.
2. Load `?view=empty-stack` in the same window and confirm the Stack
   Schematic first-run empty state draws (assumption 8 above).
3. Decide on assumption 4 — whether Schematify's own title bar/tab strip
   chrome should stay, given the real shell already draws one.
4. Sanity-check the Outline tree's visual density and the disabled-control
   styling (search field, `Auto-sort`, `Fit`, tab labels) against the
   wireframe screenshots in `Forger Wireframes.html` / `WIREFRAME-EXTRACT.md`
   §1 — this wave verified strings and counts by unit test, never by eye.

## Left undone, on purpose

- Schematic engine content (Wave 3), lifecycle/health rendering (Wave 4),
  the other 2 Schematics (Wave 5), Inspector tab content (Wave 6), Problems
  panel and status-bar cell 3 (Wave 7), registries/rules/search (Wave 8),
  runs/dashboard/status-bar cell 4 (Wave 9) — all out of this wave's scope
  per PRD §17 and the task brief.
