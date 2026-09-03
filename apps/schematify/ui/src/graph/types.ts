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

/** PRD §7's 8 lifecycle states (§12.7). No lifecycle treatment draws this
 *  wave (Wave 4); the fixture carries the value for that wave to read. */
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
