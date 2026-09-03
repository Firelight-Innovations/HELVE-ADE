/**
 * The one narrow seam between the shell and the graph, ahead of a real
 * loader. PRD §17 Wave 2 needs the shell to "open" `fixtures/saas-backend/`
 * — but `crates/schematify-core`'s graph loader (PRD §6.4) is being built on
 * a sibling branch that has not merged, and `00-AGENT-CONTEXT.md` forbids
 * this wave from importing or creating that crate.
 *
 * The functions below `loadGraph` are pure and read no fixture themselves —
 * they take whatever `ServiceGraph` they're given and compute from it, per
 * PRD §0.4's counts rule, so a real graph swapped in tomorrow keeps every
 * string and count correct.
 */
import { AUTH_SERVICE_GRAPH } from "./fixture";
import type { GraphNode, ServiceGraph } from "./types";

export type {
  GraphEdge,
  GraphNode,
  Layer,
  Lifecycle,
  OutlineBadge,
  ServiceGraph,
  Tier,
} from "./types";

/**
 * Returns the Service Schematic the shell opens this wave: the hand-typed
 * fixture in `./fixture.ts`, shaped exactly like the eventual real answer
 * and returned as a `Promise` so a later `invoke("schematify/load-graph")`
 * call is a drop-in. **A later wiring wave replaces only this function's
 * body** — every caller reads the graph through this module and never
 * imports `./fixture` directly, so nothing else changes when a real loader
 * lands.
 */
export function loadGraph(): Promise<ServiceGraph> {
  return Promise.resolve(AUTH_SERVICE_GRAPH);
}

/** The `.kaava/` storage root every tier's status-bar cell 1 names (PRD
 *  §6.1: "Decision SCH-ARC-003 changes the root to `.kaava/`. Wave 2 draws
 *  `.kaava/` in that cell."). */
export const KAAVA_ROOT = ".kaava/";

/** Node count, computed rather than cached on the graph — PRD §0.4. */
export function countNodes(graph: ServiceGraph): number {
  return graph.nodes.length;
}

/** Edge count, computed rather than cached on the graph — PRD §0.4. */
export function countEdges(graph: ServiceGraph): number {
  return graph.edges.length;
}

/** Status bar cell 1: the storage root and the counts that suit the tier
 *  (PRD §12.1). The Service Schematic counts nodes and edges. */
export function statusCell1(graph: ServiceGraph): string {
  return `${KAAVA_ROOT} · ${countNodes(graph)} nodes · ${countEdges(graph)} edges`;
}

/** Status bar cell 2: the layout file this Schematic's positions persist to
 *  (PRD §12.3), and its git status. Nothing writes a layout file yet this
 *  wave (that lands in Wave 3 behind `schematify_write_layout`), so "clean"
 *  is the only honest reading — there is no dirty state to report. */
export function statusCell2(graph: ServiceGraph, clean = true): string {
  return `layout/${graph.serviceSlug}.json ${clean ? "clean" : "modified"}`;
}

/** Containment depth counting the service root itself as level 1, so a
 *  top-level module is level 2 and a module nested one level deeper is level
 *  3 — matching PRD §16.1's "Twelve module nodes, containment depth 3" for a
 *  service whose deepest nodes (`jwks-cache`, `session-codec`, …) sit exactly
 *  1 level under a top-level module. */
export function computeDepth(nodes: GraphNode[]): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const memo = new Map<string, number>();

  function levelOf(node: GraphNode): number {
    const cached = memo.get(node.id);
    if (cached !== undefined) return cached;
    const parent = node.parentId === null ? null : byId.get(node.parentId);
    const level = parent ? levelOf(parent) + 1 : 2;
    memo.set(node.id, level);
    return level;
  }

  return nodes.reduce((max, node) => Math.max(max, levelOf(node)), 1);
}

/** The Outline footer string, e.g. `12 nodes · depth 3` (PRD §12.1). */
export function outlineFooter(graph: ServiceGraph): string {
  return `${countNodes(graph)} nodes · depth ${computeDepth(graph.nodes)}`;
}

/** One flattened, indented row of the Outline tree, in the reading order
 *  `Outline.tsx` draws. */
export interface OutlineRow {
  node: GraphNode;
  /** 0 for a node directly under the service root. */
  depth: number;
  hasChildren: boolean;
  /** Present only on a collapsed parent — the count its trailing badge draws
   *  (PRD §12.1: "a bare child count on a collapsed parent"). */
  hiddenChildCount?: number;
}

/** Flattens `graph.nodes` into Outline rows: a node with children and no
 *  `collapsed: true` draws its children as their own rows right after it
 *  (recursively); a `collapsed: true` node draws no child rows at all and
 *  instead carries `hiddenChildCount`, the number of nodes underneath it. */
export function buildOutlineRows(graph: ServiceGraph): OutlineRow[] {
  const childrenOf = new Map<string | null, GraphNode[]>();
  for (const node of graph.nodes) {
    const bucket = childrenOf.get(node.parentId) ?? [];
    bucket.push(node);
    childrenOf.set(node.parentId, bucket);
  }

  function countDescendants(id: string): number {
    const kids = childrenOf.get(id) ?? [];
    return kids.reduce((sum, kid) => sum + 1 + countDescendants(kid.id), 0);
  }

  function walk(parentId: string | null, depth: number): OutlineRow[] {
    const kids = childrenOf.get(parentId) ?? [];
    return kids.flatMap((node) => {
      const kidsOfNode = childrenOf.get(node.id) ?? [];
      const hasChildren = kidsOfNode.length > 0;
      const row: OutlineRow = { node, depth, hasChildren };
      if (hasChildren && node.collapsed) {
        row.hiddenChildCount = countDescendants(node.id);
        return [row];
      }
      return [row, ...walk(node.id, depth + 1)];
    });
  }

  return walk(null, 0);
}
