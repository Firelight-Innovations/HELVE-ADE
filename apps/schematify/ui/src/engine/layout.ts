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
import type { LayoutAnnotation, LayoutFile, LayoutNode, ServiceGraph } from "../graph";
import type { SchematicConfig, SchematicNodeKind } from "./config";
import { arrange } from "./arrange";
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
    rect: { x: 0, y: 0, ...config.nodeBox(node.kind as SchematicNodeKind) },
    collapsed: node.collapsed ?? false,
  }));

  const annotations: SchematicNode[] = (layout?.annotations ?? []).map(fromAnnotation);

  const draft: SchematicDoc = {
    slug: config.layoutSlug,
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
