/**
 * Projects the whole-project graph `schematify/load-graph` returns (every
 * node, every edge, every kind, per PRD §6.1 and §14.5) down to the one
 * `ServiceGraph` this app's shell can currently draw — a single service's
 * containment subtree.
 *
 * This narrowing is not something `crates/schematify-core` or the Rust
 * dispatch owns. `ServiceGraph` (`./types.ts`) is Wave 2's own placeholder,
 * built before any tier switch existed — its own header says as much: "PRD
 * §16.1 draws no 'module' label on the wire, but the value exists so a real
 * loader has somewhere to put it later." This file is that real loader's
 * other half: where the real graph's shape and the shell's narrower shape
 * meet, until Wave 5 builds a tier-aware read and this file's job moves
 * there (`docs/overnight-jobs/overnight-2/handoffs/w3-engine.md` assumption
 * 16 names the same seam on the engine's side of the join).
 */
import type { GraphEdge, GraphNode, Layer, Lifecycle, NodeKind, ServiceGraph } from "./types";

/**
 * One node exactly as `schematify_core::Node` serializes it: the envelope
 * flattened with whatever fields its kind adds
 * (`src-tauri/src/apps/schematify.rs`'s `load_graph`). The crate's field
 * names are the Rust struct's own — snake_case, no `rename_all` on the
 * envelope itself — so `authored_by` and `superseded_by` reach here
 * unchanged. Only the fields this projection reads are declared; the rest of
 * each kind's open field map is not consumed here.
 */
export interface RawNode {
  id: string;
  slug: string;
  kind: string;
  title: string;
  lifecycle: string;
  layer?: string;
  parent?: string | null;
  [extra: string]: unknown;
}

/** One edge exactly as `schematify_core::Edge` serializes it. */
export interface RawEdge {
  id: string;
  kind: string;
  source: string;
  target: string;
}

/** The `graph` half of `schematify/load-graph`'s response. Only the two
 *  collections this projection reads are declared — `screens`, `flows`,
 *  `decisions`, `rules`, `libraries` and `brief` all come back too, and no
 *  view this wave draws reads any of them. */
export interface RawGraph {
  nodes: RawNode[];
  edges: RawEdge[];
}

/** The 3 dependency-family edge kinds `./types.ts`'s `GraphEdge` can hold.
 *  `contains` is never a member — containment is `GraphNode.parentId` — and
 *  `covers`, `satisfies`, `documents` have no drawing this app builds yet. */
const FRONTEND_EDGE_KINDS: ReadonlySet<string> = new Set([
  "depends_on",
  "implements",
  "references_ui",
]);

/**
 * core's `Layer` is `#[serde(rename_all = "lowercase")]` over the same 5
 * words `./types.ts`'s `Layer` names, and `Lifecycle` is the same rule over
 * the same 8 words — both wire formats already match this app's vocabulary
 * byte for byte, so no rename happens here.
 */
function asLayer(value: string | undefined): Layer | undefined {
  return value as Layer | undefined;
}

function asLifecycle(value: string): Lifecycle {
  return value as Lifecycle;
}

/**
 * The 2 raw kinds this projection *draws* on a Service Schematic: `module`
 * (PRD tier 2) and `group`, the annotation-tier containment box PRD §11.3
 * and §12.4 both draw on the canvas. `service` is never a member — it is
 * the root the whole graph is drawn under, carried separately as
 * `serviceSlug`/`serviceTitle`.
 *
 * Every other kind is a tier-3 facet the Module Schematic draws, not the
 * Service one — collapsing them to `"module"` instead of excluding them was
 * the bug that inflated a 12-module real service into 70 nodes on first
 * contact with real data; see the wiring handoff.
 *
 * A `group` is drawn but not counted — see `ANNOTATION_NODE_KINDS` in
 * `./types.ts`, which `countNodes` reads for the status-bar figure, and
 * `MODULE_ONLY_EDGE_ENDPOINT_KINDS` below, which keeps a group out of the
 * edge list the same way. Drawn and counted are 2 different questions; a
 * `comment` answers the first "nowhere" (this app's `NodeKind` has no
 * member for it at all, a separate open gap the wiring handoff names) and
 * a `group` answers it "yes" while still answering the second "no".
 */
const SERVICE_SCHEMATIC_KINDS: ReadonlySet<string> = new Set(["module", "group"]);

/**
 * The 1 raw kind an edge may connect to on a Service Schematic: `module`.
 * PRD §11.3's annotation tier — `group` here, `comment` never reaching this
 * far at all — carries no semantic edge, per the same ruling
 * `SERVICE_SCHEMATIC_KINDS` above encodes: "an annotation-tier box is never
 * a node and never an edge endpoint" (WIREFRAME-EXTRACT.md's Resolutions
 * section). A `group` can be drawn while still never appearing as an
 * edge's `from`/`to`.
 */
const MODULE_ONLY_EDGE_ENDPOINT_KINDS: ReadonlySet<string> = new Set(["module"]);

function asNodeKind(rawKind: "module" | "group"): NodeKind {
  return rawKind;
}

/**
 * Whether `node` sits inside `serviceId`'s containment subtree, walking
 * `parent` up to the root. Guards against a containment cycle the same way
 * `./index.ts`'s `computeDepth` does — a real project is read off a
 * filesystem a person can hand-edit, so a cycle is a real possibility here,
 * not a hypothetical one a fixture could rule out.
 */
function isDescendantOfService(
  node: RawNode,
  serviceId: string,
  byId: ReadonlyMap<string, RawNode>,
): boolean {
  const visiting = new Set<string>();
  let current: RawNode | undefined = node;
  while (current) {
    if (current.parent === serviceId) return true;
    if (!current.parent || visiting.has(current.id)) return false;
    visiting.add(current.id);
    current = byId.get(current.parent);
  }
  return false;
}

/**
 * Builds one service's `ServiceGraph` out of the whole project graph.
 *
 * Throws when no top-level `service` node carries `serviceSlug` — a rejected
 * `openSchematic` is already a handled case (`App.tsx`, Wave 2 review round
 * 2 finding 3: a rejection is caught, shown as `.kv-shell__error`, and still
 * reports the frame painted), so this is a caught rejection, not a crash.
 */
export function projectServiceGraph(raw: RawGraph, serviceSlug: string): ServiceGraph {
  const serviceNode = raw.nodes.find(
    (node) => node.kind === "service" && node.slug === serviceSlug,
  );
  if (!serviceNode) {
    throw new Error(`no service named "${serviceSlug}" in this project`);
  }

  // `byId` stays the full node set — a containment walk has to be able to
  // pass through every node on the way up, kind notwithstanding. Only the
  // *output* is limited to `SERVICE_SCHEMATIC_KINDS`.
  const byId = new Map(raw.nodes.map((node) => [node.id, node]));
  const included = raw.nodes.filter(
    (node) =>
      node.id !== serviceNode.id &&
      SERVICE_SCHEMATIC_KINDS.has(node.kind) &&
      isDescendantOfService(node, serviceNode.id, byId),
  );

  const nodes: GraphNode[] = included.map((node) => ({
    id: node.id,
    slug: node.slug,
    title: node.title,
    kind: asNodeKind(node.kind as "module" | "group"),
    layer: asLayer(node.layer),
    lifecycle: asLifecycle(node.lifecycle),
    parentId: node.parent === serviceNode.id ? null : (node.parent ?? null),
    // No structural source for PRD §12.1's ENTRY badge exists in
    // `crates/schematify-core` yet — `ServiceFields.entry_point` is prose
    // ("how the service starts"), not a flag on a module. Only STALE is
    // derivable tonight; see the wiring handoff.
    badge: node.lifecycle === "stale" ? "STALE" : undefined,
  }));

  // A group can be drawn (above) while never becoming an edge endpoint —
  // `edgeEndpointIds` is module ids only, narrower than `included`, so a
  // `depends_on` naming a group's id is dropped here rather than drawn as
  // though a box could originate or receive a dependency.
  const edgeEndpointIds = new Set(
    included.filter((node) => MODULE_ONLY_EDGE_ENDPOINT_KINDS.has(node.kind)).map((n) => n.id),
  );
  const edges: GraphEdge[] = raw.edges
    .filter(
      (edge) =>
        FRONTEND_EDGE_KINDS.has(edge.kind) &&
        edgeEndpointIds.has(edge.source) &&
        edgeEndpointIds.has(edge.target),
    )
    .map((edge) => ({
      id: edge.id,
      kind: edge.kind as GraphEdge["kind"],
      from: edge.source,
      to: edge.target,
    }));

  return {
    tier: "service",
    serviceSlug: serviceNode.slug,
    serviceTitle: serviceNode.title,
    nodes,
    edges,
  };
}
