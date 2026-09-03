/**
 * The graph vocabulary this app's shell draws against — narrower than
 * `crates/schematify-core`'s eventual schemas (PRD §5), since this wave has
 * no Rust graph to mirror (`00-AGENT-CONTEXT.md` forbids importing or
 * creating that crate). Restated by hand, the way `apps/files/ui/src/rpc.ts`
 * restates its Rust counterpart. See `./index.ts` for the module a later
 * wave replaces once a real loader exists.
 */

/** The 3 tiers a Schematic can draw. Only "service" is built this wave. */
export type Tier = "stack" | "service" | "module";

/** A node's containment kind. PRD §16.1 draws no "module" label on the wire,
 *  but the value exists so a real loader has somewhere to put it later. */
export type NodeKind = "service" | "group" | "module";

/** The `NodeKind` values PRD §11.3 puts in the annotation tier: drawn, per
 *  `../engine/config.ts`'s own `ANNOTATION_KINDS` for the engine's wider
 *  vocabulary, but never counted as a node and never an edge endpoint (the
 *  owner's ruling on the wave 2 acceptance count — "it arranges and it
 *  annotates, it does not mean"). `"comment"` is not a member: this app's
 *  `NodeKind` has no member of that name at all, a separate gap the wiring
 *  handoff names rather than papers over here. */
export const ANNOTATION_NODE_KINDS: readonly NodeKind[] = ["group"];

/** Whether `kind` is annotation-tier — see `ANNOTATION_NODE_KINDS`. */
export function isAnnotationNodeKind(kind: NodeKind): boolean {
  return (ANNOTATION_NODE_KINDS as readonly string[]).includes(kind);
}

/** PRD §5's `layer` values. `frontend` and `external` are `[P]` (PRD §12.6),
 *  drawn by no wireframe — Wave 4's job, not this one. */
export type Layer = "edge" | "backend" | "data" | "frontend" | "external";

/** PRD §7's 8 lifecycle states (§12.7), each drawn with its own geometry by
 *  `engine/anatomy.ts`'s `LIFECYCLE_TREATMENTS` table (Wave 4). */
export type Lifecycle =
  | "draft"
  | "specified"
  | "assigned"
  | "implemented"
  | "reviewed"
  | "accepted"
  | "stale"
  | "deprecated";

/** The 2 Outline badge forms PRD §12.1 names. Canvas-only badges (§12.6)
 *  are Wave 3/4 scope and do not appear here. */
export type OutlineBadge = "ENTRY" | "STALE";

/** PRD §12.8's 4 health conditions, carried directly on the node rather than
 *  derived from per-facet test/budget results — this app's restated
 *  vocabulary (see this file's header comment) has no facet-level pass/fail
 *  data to derive from, the same simplification already made for
 *  `lifecycle` above. `[P]`, recorded in the Wave 4 handoff. */
export type HealthStatus = "passing" | "soft-fail" | "hard-fail" | "no-data";

/** PRD §12.6's facet-count row, tier 2 only. A field is omitted rather than
 *  zeroed when the wireframe draws no chip for it — JWKS Cache draws
 *  `⬤ 2 meth ⬤ 6 test` with no `budg` chip at all, not `⬤ 0 budg`. */
export interface FacetCounts {
  methods?: number;
  tests?: number;
  budgets?: number;
}

/** One node in a service's containment tree. `parentId: null` sits directly
 *  under the service root named by `ServiceGraph.serviceSlug`. */
export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  kind: NodeKind;
  layer?: Layer;
  lifecycle?: Lifecycle;
  parentId: string | null;
  /** At most 1, per PRD §12.1's closed 2-value set. */
  badge?: OutlineBadge;
  /** Starts the Outline row collapsed (`▸`, trailing child count, no child
   *  rows) rather than expanded (`▾`, children drawn in full). */
  collapsed?: boolean;

  // --- PRD §12.6 node anatomy (Wave 4) --------------------------------------

  /** Clamped to 2 lines on the node face. */
  description?: string;
  /** PRD §5.1's `authored_by` — drives `◇ AGENT DRAFT` and its caption. */
  authoredBy?: "human" | "agent";
  /** The facet-count row's 3 chips, tier 2 only. */
  facets?: FacetCounts;
  /** `allowed_libraries`, resolved to display names: `▸ jose  ▸ zod`. */
  libraries?: readonly string[];
  /** PRD §12.8. `undefined` reads as `"passing"` — no wedge. */
  health?: HealthStatus;
  /** PRD §5.3's `exports`, already counted — draws `N exports`. */
  exportsCount?: number;
  /** A Stack-tier service's module count — draws `N modules`. Wave 5. */
  modulesCount?: number;
  /** PRD §4.3: pairs with `sharedAtLca` for `N dependents`. */
  dependentsCount?: number;
  /** True at a node PRD §4.3 places at its dependents' LCA. */
  sharedAtLca?: boolean;
  /** PRD §5.3's `schemas`, resolved: draws `schemas ✓`. */
  schemasResolved?: boolean;
  /** `deprecated` only: draws `thisSlug → successorSlug`. */
  deprecatedSuccessor?: string;
  /** `stale` only: PRD §7.4's second caption line. */
  staleReason?: string;
  /** A `contract-method` facet's `exported` (PRD §5.5) — draws `EXPORTED`.
   *  Forward-carried; no facet kind exists in `NodeKind` yet. */
  exported?: boolean;
  /** A `budget` facet's `tier` (PRD §5.5) — draws `HARD` or `SOFT`. */
  budgetTier?: "hard" | "soft";
}

/** One dependency-family edge. `contains` is deliberately absent —
 *  containment is `GraphNode.parentId`, never an edge (PRD §4.1). */
export interface GraphEdge {
  id: string;
  kind: "depends_on" | "implements" | "references_ui";
  from: string;
  to: string;
}

/** The whole Service Schematic for one service. What `loadGraph()` in
 *  `./index.ts` returns. */
export interface ServiceGraph {
  tier: "service";
  serviceSlug: string;
  serviceTitle: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}
