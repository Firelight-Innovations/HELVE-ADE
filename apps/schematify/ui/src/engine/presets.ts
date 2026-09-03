/**
 * The 3 tier configurations, as `SchematicConfig` values. This file is the
 * proof of PRD §17 Wave 5's acceptance condition — "one Schematic engine
 * serves all 3 tiers" — held one wave early: nothing below subclasses,
 * branches on the tier at runtime, or reaches into the engine. Each preset is
 * data.
 *
 * Wave 5 owns the content of these presets (node sizes, the facet palette, the
 * export strip). What it should not have to change is the engine itself.
 */
import type { EdgeKindRule, SchematicConfig, SchematicNodeKind, Size } from "./config";

/** Shared by `depends_on` and `implements`: the neutral line every wireframe
 *  draws them with (WIREFRAME-EXTRACT.md §1.3). */
const NEUTRAL_STROKE = "--kv-text-tertiary";

/** PRD §11.1's tier 1 and 2 vocabulary, minus `contains` — containment is
 *  nesting, never a stored edge (PRD §4.1), so it is not a creatable kind and
 *  has no row here. Styles come from PRD §12.5's table. */
const CONTAINMENT_TIER_EDGES: readonly EdgeKindRule[] = [
  {
    kind: "depends_on",
    from: ["service", "module"],
    to: ["service", "module"],
    acyclic: true,
    style: { line: "solid", arrow: "filled", strokeToken: NEUTRAL_STROKE, widthPx: 1.25 },
    inLegend: true,
    refusal: "A depends_on edge joins two services or two modules.",
  },
  {
    kind: "implements",
    from: ["service", "module"],
    to: ["service", "module"],
    acyclic: true,
    style: { line: "dashed", arrow: "hollow", strokeToken: NEUTRAL_STROKE, widthPx: 1.25 },
    inLegend: true,
    refusal: "An implements edge joins two services or two modules.",
  },
  {
    kind: "references_ui",
    from: ["service", "module"],
    to: ["screen"],
    acyclic: false,
    style: { line: "dotted", arrow: "chip", strokeToken: "--kv-agent", widthPx: 1.25 },
    inLegend: true,
    refusal: "A references_ui edge points at a screen.",
  },
];

/** PRD §11.1's tier 3 vocabulary, closed to 3 kinds. The `SATISFIES` callout
 *  on the Module Schematic states the closure in the product's own words. */
const FACET_TIER_EDGES: readonly EdgeKindRule[] = [
  {
    kind: "covers",
    from: ["test-case"],
    to: ["contract-method"],
    acyclic: false,
    style: { line: "solid", arrow: "filled", strokeToken: "--kv-ok", widthPx: 1 },
    inLegend: true,
    refusal: "A covers edge runs from a test case to a contract method.",
  },
  {
    kind: "satisfies",
    from: ["module", "external-dep", "contract-method"],
    to: ["budget"],
    acyclic: false,
    style: { line: "solid", arrow: "filled", strokeToken: "--kv-ok", widthPx: 1 },
    inLegend: true,
    refusal: "A satisfies edge ends at a budget.",
  },
  {
    kind: "documents",
    from: ["doc-block"],
    to: ["module", "contract-method", "test-case", "budget", "external-dep"],
    acyclic: false,
    style: { line: "dotted", arrow: "none", strokeToken: NEUTRAL_STROKE, widthPx: 1 },
    // The one kind a tier allows but does not advertise: PRD §12.1 names the
    // Module Schematic's legend as `contains`, `covers`, `satisfies`, and
    // WIREFRAME-EXTRACT.md §10.3 reaches the same 3 when it rules the chip in.
    // A legend is a drawing, so the drawing sources win over §11.1's list.
    inLegend: false,
    refusal: "A documents edge runs from a doc block to what it documents.",
  },
];

/**
 * Default boxes, in world units, matching the wireframe's drawn geometry
 * (WIREFRAME-EXTRACT.md §1.2, §4.8, §5.2). Wave 4 replaces this with a
 * content-derived size; until then a kind gets one box.
 */
function boxFor(sizes: Partial<Record<SchematicNodeKind, Size>>, fallback: Size) {
  return (kind: SchematicNodeKind): Size => sizes[kind] ?? fallback;
}

/** Tier 1 (PRD §12.9). The larger dot grid, services and groups only. */
export const STACK_CONFIG: SchematicConfig = {
  tier: "stack",
  layoutSlug: "stack",
  grid: { size: 26, snap: true },
  zoom: { min: 0.2, max: 2, initial: 1 },
  edgeKinds: CONTAINMENT_TIER_EDGES,
  containment: { mode: "nesting" },
  annotations: true,
  arrangement: "nested-flow",
  // No wireframe pins anything at tier 1, and PRD §12.9 asks for nothing
  // pinned; the entry point is named here anyway so the Stack Schematic's
  // `api-gateway` holds the same edge its Service counterpart does.
  nodePolicy: { pinned: { roles: ["entry-point"], edge: "left" }, undeletable: [] },
  chrome: { minimap: true, zoomReadout: true, legend: true },
  legendFooter: "click a service to drill into its modules",
  nodeBox: boxFor(
    { service: { width: 240, height: 104 }, group: { width: 260, height: 290 } },
    {
      width: 228,
      height: 104,
    },
  ),
};

/** Tier 2 (PRD §12.10). The Schematic the wireframe draws in full. */
export const SERVICE_CONFIG: SchematicConfig = {
  tier: "service",
  layoutSlug: "auth-service",
  grid: { size: 22, snap: true },
  zoom: { min: 0.2, max: 2, initial: 0.68 },
  edgeKinds: CONTAINMENT_TIER_EDGES,
  containment: { mode: "nesting" },
  annotations: true,
  arrangement: "nested-flow",
  // PRD §12.10: "The entry-point node pins to the Schematic edge."
  nodePolicy: { pinned: { roles: ["entry-point"], edge: "left" }, undeletable: [] },
  chrome: { minimap: true, zoomReadout: true, legend: true },
  legendFooter: "contains = nesting · depends_on = drawn",
  nodeBox: boxFor(
    {
      module: { width: 204, height: 118 },
      comment: { width: 230, height: 100 },
      group: { width: 452, height: 330 },
    },
    { width: 204, height: 118 },
  ),
};

/**
 * Tier 3 (PRD §12.11). The one preset whose containment renders as drawn
 * arrows — WIREFRAME-EXTRACT.md Resolution 10.1 row 7.1, the ruling that the
 * Module Schematic draws a labelled line for a relation the graph stores as
 * nesting. `frame.ts` synthesises those lines; they are in no edge count and
 * no user gesture reaches them.
 */
export const MODULE_CONFIG: SchematicConfig = {
  tier: "module",
  layoutSlug: "token-verifier",
  grid: { size: 22, snap: true },
  zoom: { min: 0.2, max: 2, initial: 1 },
  edgeKinds: FACET_TIER_EDGES,
  containment: { mode: "nesting-and-arrows", label: "contains" },
  // PRD §12.11: "Facets fan outward. The Schematic reads as a contract sheet,
  // not as a free graph."
  annotations: true,
  arrangement: "contract-sheet",
  // PRD §12.11: the root "pins to the left edge" and draws
  // `MODULE ROOT · CANNOT BE DELETED`.
  nodePolicy: {
    pinned: { roles: ["schematic-root"], edge: "left" },
    undeletable: ["schematic-root"],
  },
  chrome: { minimap: true, zoomReadout: true, legend: true },
  legendFooter: "contains · covers · satisfies",
  nodeBox: boxFor(
    {
      module: { width: 238, height: 128 },
      "contract-method": { width: 290, height: 96 },
      budget: { width: 290, height: 84 },
      "doc-block": { width: 290, height: 110 },
      "test-case": { width: 136, height: 68 },
      "external-dep": { width: 136, height: 60 },
      comment: { width: 230, height: 100 },
    },
    { width: 200, height: 90 },
  ),
};

/** The 3 presets by tier, so a caller can switch tier without a `switch`. */
export const TIER_PRESETS = {
  stack: STACK_CONFIG,
  service: SERVICE_CONFIG,
  module: MODULE_CONFIG,
} as const;
