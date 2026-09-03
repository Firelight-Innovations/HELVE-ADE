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
import type {
  GraphNode,
  LayoutAnnotation,
  LayoutFile,
  LayoutNode,
  SchematicGraph,
} from "../graph";
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
  graph: SchematicGraph,
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
    signature: node.signature,
    returns: node.returns,
    coversCount: node.coversCount,
    budgetThresholdText: node.budgetThresholdText,
    budgetProbe: node.budgetProbe,
    budgetValueText: node.budgetValueText,
    testStatus: node.testStatus,
    docAudience: node.docAudience,
    docBody: node.docBody,
    depVersion: node.depVersion,
    depLicense: node.depLicense,
    depRegistryOk: node.depRegistryOk,
    screenRef: node.screenRef,
  }));

  const annotations: SchematicNode[] = (layout?.annotations ?? []).map(fromAnnotation);

  const draft: SchematicDoc = {
    slug: config.layoutSlug,
    title: graph.serviceTitle,
    tier: config.tier,
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
 * the status bar read, so their counts move when the engine's do.
 *
 * **Wave 5 fix.** Before this wave the projection was shaped for the one
 * tier the engine ever opened: every node's `kind` collapsed to `"service"`
 * or `"module"` (`node.kind === "service" ? "service" : "module"`), and
 * `tier` was hardcoded `"service"`. That was silently correct as long as
 * `"module"` was the only other kind a document ever held. The moment the
 * Module Schematic opens, a `contract-method` or `test-case` facet node
 * would have collapsed to `"module"` too — the Outline would have called a
 * `budget` card a module, and `countServices` (stack tier) would have
 * miscounted every facet as a module rather than not counting it at all.
 * This function now carries every node's real `kind` through untouched, and
 * reads `tier` off the document rather than assuming.
 *
 * A comment is always dropped: PRD §11.3 keeps it out of reconciliation, and
 * counting one would make the status bar read 13 nodes for a 12-node
 * service, which Wave 3 already established. A `group` is dropped only when
 * it has no children in the surviving projection — PRD §16.1's stack-tier
 * `platform-core` (2 real children, `auth-service` and `session-service`) is
 * a real containment parent the Outline lists as its own row
 * (WIREFRAME-EXTRACT.md §5.1), while a cosmetic annotation group added by a
 * gesture (`engine/engine.ts`'s `addGroup`, e.g. tier 2's `Token pipeline`)
 * never gains real children and never appears in the Outline
 * (WIREFRAME-EXTRACT.md §1.1's Outline rows have no such entry). The 2 share
 * a kind string but not this behaviour — `./presets.ts`'s and `../graph`'s
 * own comments say more about why. `[P]`, recorded in the Wave 5 handoff.
 */
export function toGraph(doc: SchematicDoc): SchematicGraph {
  const withoutComments = doc.nodes.filter((node) => node.kind !== "comment");
  const childCounts = new Map<string, number>();
  for (const node of withoutComments) {
    if (node.parentId === null) continue;
    childCounts.set(node.parentId, (childCounts.get(node.parentId) ?? 0) + 1);
  }
  const kept = withoutComments.filter(
    (node) => node.kind !== "group" || (childCounts.get(node.id) ?? 0) > 0,
  );

  return {
    tier: doc.tier ?? "service",
    serviceSlug: doc.slug,
    serviceTitle: doc.title,
    nodes: kept.map((node) => ({
      id: node.id,
      slug: node.slug,
      title: node.title,
      kind: node.kind,
      layer: node.layer,
      parentId: node.parentId,
      badge: node.badge,
      lifecycle: node.lifecycle,
      collapsed: node.collapsed,
      exportsCount: node.exportsCount,
      modulesCount: node.modulesCount,
      dependentsCount: node.dependentsCount,
      sharedAtLca: node.sharedAtLca,
      schemasResolved: node.schemasResolved,
      health: node.health,
    })),
    edges: doc.edges.map((edge) => ({
      id: edge.id,
      kind: edge.kind,
      from: edge.from,
      to: edge.to,
    })),
  };
}

/** @deprecated Use `toGraph` — kept as an alias so a caller that only ever
 *  meant the service tier still reads naturally. */
export const toServiceGraph = toGraph;

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
