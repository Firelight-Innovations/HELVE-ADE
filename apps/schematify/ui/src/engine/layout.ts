/**
 * The join between the semantic graph and the cosmetic layout file, in both
 * directions: `buildDoc` opens a Schematic, `toLayoutFile` produces what a
 * change persists. The file's own shape is `../graph/layout.ts`, beside the
 * seam that writes it.
 *
 * Groups and comments round-trip through the cosmetic file in full. PRD §6.1
 * already names groups as layout content, and PRD §11.3 puts both kinds in the
 * annotation tier — out of reconciliation and unable to carry a semantic edge
 * — so keeping them out of `nodes/` is what makes "an annotation is not design
 * data" true on disk rather than only in the linter.
 */
import type { GraphNode, LayoutAnnotation, LayoutFile, LayoutNode, ServiceGraph } from "../graph";
import type { NodeRole, SchematicConfig, SchematicNodeKind } from "./config";
import { arrange } from "./arrange";
import { contentOf } from "./anatomy";
import type { SchematicDoc, SchematicNode } from "./doc";
import type { Viewport } from "./viewport";

/**
 * Joins the semantic graph to the cosmetic file. A node the file names keeps
 * the position it was left at; a node it does not name takes a deterministic
 * arranged slot (`arrange.ts`), because a node with no stored position still
 * has to be drawn and PRD §12.3 forbids running auto-sort on load.
 */
export function buildDoc(
  graph: ServiceGraph,
  layout: LayoutFile | null,
  config: SchematicConfig,
): SchematicDoc {
  const semantic: SchematicNode[] = graph.nodes.map((node) => ({
    id: node.id,
    slug: node.slug,
    title: node.title,
    kind: node.kind as SchematicNodeKind,
    parentId: node.parentId,
    rect: {
      x: 0,
      y: 0,
      ...config.nodeBox(node.kind as SchematicNodeKind, contentOf(node)),
    },
    collapsed: node.collapsed ?? false,
    role: roleOf(node, config),
    badge: node.badge,
    lifecycle: node.lifecycle,
    layer: node.layer,
    description: node.description,
    authoredBy: node.authoredBy,
    facets: node.facets,
    libraries: node.libraries,
    health: node.health,
    exportsCount: node.exportsCount,
    modulesCount: node.modulesCount,
    dependentsCount: node.dependentsCount,
    sharedAtLca: node.sharedAtLca,
    schemasResolved: node.schemasResolved,
    deprecatedSuccessor: node.deprecatedSuccessor,
    staleReason: node.staleReason,
    exported: node.exported,
    budgetTier: node.budgetTier,
  }));

  const annotations: SchematicNode[] = (layout?.annotations ?? []).map(fromAnnotation);

  const draft: SchematicDoc = {
    slug: config.layoutSlug,
    title: graph.serviceTitle,
    nodes: [...semantic, ...annotations],
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
    })),
  };

  const arranged = arrange(draft, config);
  return {
    ...draft,
    nodes: draft.nodes.map((node) => {
      const stored = layout?.nodes[node.id];
      if (stored) return withStored(node, stored);
      if (node.kind === "group" || node.kind === "comment") return node;
      return { ...node, rect: arranged.get(node.id) ?? node.rect };
    }),
  };
}

/**
 * The part a node plays, read off what the graph already says rather than off
 * a second list: the entry point is the node the Outline badges `ENTRY`
 * (PRD §12.1, §12.10), and a Schematic's root is the node whose slug names the
 * Schematic itself, which at tier 3 is the module root (PRD §12.11).
 */
function roleOf(node: GraphNode, config: SchematicConfig): NodeRole | undefined {
  if (node.slug === config.layoutSlug) return "schematic-root";
  if (node.badge === "ENTRY") return "entry-point";
  return undefined;
}

/**
 * The live graph, projected back out of the document — what the Outline and
 * the status bar read, so their counts move when the engine's do. Annotations
 * are dropped: a comment is not a node (PRD §11.3), and counting one would
 * make the status bar read 13 nodes for a 12-node service.
 */
export function toServiceGraph(doc: SchematicDoc): ServiceGraph {
  return {
    tier: "service",
    serviceSlug: doc.slug,
    serviceTitle: doc.title,
    nodes: doc.nodes
      .filter((node) => node.kind !== "comment" && node.kind !== "group")
      .map((node) => ({
        id: node.id,
        slug: node.slug,
        title: node.title,
        kind: node.kind === "service" ? "service" : "module",
        parentId: node.parentId,
        badge: node.badge,
        lifecycle: node.lifecycle,
        collapsed: node.collapsed,
      })),
    edges: doc.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind as "depends_on" | "implements" | "references_ui",
      from: edge.from,
      to: edge.to,
    })),
  };
}

function fromAnnotation(entry: LayoutAnnotation): SchematicNode {
  return {
    id: entry.id,
    slug: entry.slug,
    title: entry.title,
    kind: entry.kind,
    parentId: entry.parentId,
    rect: { x: entry.x, y: entry.y, width: entry.width, height: entry.height },
    collapsed: entry.collapsed ?? false,
    author: entry.author,
    body: entry.body,
  };
}

function withStored(node: SchematicNode, stored: LayoutNode): SchematicNode {
  return {
    ...node,
    rect: { x: stored.x, y: stored.y, width: stored.width, height: stored.height },
    collapsed: stored.collapsed ?? node.collapsed,
  };
}

/** The file to write after a change: every node's geometry, every annotation
 *  in full, and the viewport. Nothing semantic. */
export function toLayoutFile(doc: SchematicDoc, viewport?: Viewport): LayoutFile {
  const nodes: Record<string, LayoutNode> = {};
  const annotations: LayoutAnnotation[] = [];

  for (const node of doc.nodes) {
    if (node.kind === "group" || node.kind === "comment") {
      annotations.push({
        id: node.id,
        kind: node.kind,
        slug: node.slug,
        title: node.title,
        parentId: node.parentId,
        x: node.rect.x,
        y: node.rect.y,
        width: node.rect.width,
        height: node.rect.height,
        collapsed: node.collapsed,
        author: node.author,
        body: node.body,
      });
      continue;
    }
    nodes[node.id] = {
      x: node.rect.x,
      y: node.rect.y,
      width: node.rect.width,
      height: node.rect.height,
      collapsed: node.collapsed,
    };
  }

  return { version: 1, schematic: doc.slug, nodes, annotations, viewport };
}
