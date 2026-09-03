/**
 * Deterministic arrangement. Two callers, deliberately distinguished:
 *
 * - **Default placement.** A node the layout file does not name still has to
 *   be drawn somewhere. `arrange` supplies that slot when the document is
 *   built. This is not auto-sort, and it does not move a node whose position
 *   the file already holds.
 * - **`Auto-sort`.** The toolbar control (PRD §12.1, §12.3), which rearranges
 *   everything and is undoable. PRD §12.3 states auto-sort never runs on load,
 *   which is exactly the distinction above.
 *
 * The arrangement is a nested row-major flow: children lay out inside their
 * parent, the parent grows to hold them, and the result is stable for a given
 * document, so two runs on the same graph produce the same picture.
 */
import type { SchematicConfig } from "./config";
import type { DocIndex, SchematicDoc, SchematicNode } from "./doc";
import { childrenOf, indexDoc } from "./doc";
import { boundsOf, snap } from "./geometry";
import type { Rect } from "./geometry";

/** Space between two boxes at the same level. */
const GAP = 40;
/** Space between a container's border and its children, with extra at the top
 *  for the container's own header row. */
const PAD = 18;
const HEADER = 34;
/** How many children sit in one row before the flow wraps. */
const ROW = 3;
/** The gap between a contract sheet's root and the column that fans off it. */
const FAN = 120;

/** Arranged geometry, by node id. Nodes are not mutated here. */
export type Arrangement = ReadonlyMap<string, Rect>;

export function arrange(doc: SchematicDoc, config: SchematicConfig): Arrangement {
  const index = indexDoc(doc);
  if (config.arrangement === "contract-sheet") return contractSheet(doc, index, config);
  return nestedFlow(index, config);
}

/**
 * PRD §12.11's tier-3 arrangement: the root holds the left edge and every
 * facet fans out to its right in one column, ordered by the palette's own
 * order, so the Schematic reads as a contract sheet rather than a free graph.
 *
 * A first cut. Wave 5 owns the facet cards themselves and will want to group
 * the column by card kind or split it in two; that is a change here and
 * nowhere else.
 */
function contractSheet(doc: SchematicDoc, index: DocIndex, config: SchematicConfig): Arrangement {
  const out = new Map<string, Rect>();
  const roots = doc.nodes.filter((node) => node.role === "schematic-root");
  const rootNode = roots[0] ?? childrenOf(index, null)[0];
  const rootSize = rootNode ? config.nodeBox(rootNode.kind) : { width: 0, height: 0 };
  if (rootNode) out.set(rootNode.id, { x: GAP, y: GAP, ...rootSize });

  const columnX = snap(GAP + rootSize.width + FAN, config.grid.size);
  let y = GAP;
  for (const node of doc.nodes) {
    if (node.id === rootNode?.id) continue;
    const size = config.nodeBox(node.kind);
    out.set(node.id, { x: columnX, y: snap(y, config.grid.size), ...size });
    y += size.height + GAP;
  }
  return out;
}

function nestedFlow(index: DocIndex, config: SchematicConfig): Arrangement {
  const out = new Map<string, Rect>();
  const sizes = new Map<string, { width: number; height: number }>();

  measure(index, config, null, sizes);
  place(index, config, null, { x: GAP, y: GAP }, sizes, out);

  for (const [id, rect] of out) {
    // A collapsed box is drawn at its own size, not at the size of the block
    // its children needed — but those children were still laid out inside that
    // block, so every node has a distinct position to return to on expand.
    const node = index.byId.get(id);
    const collapsed = node?.collapsed ? config.nodeBox(node.kind) : null;
    out.set(id, {
      x: snap(rect.x, config.grid.size),
      y: snap(rect.y, config.grid.size),
      width: collapsed?.width ?? rect.width,
      height: collapsed?.height ?? rect.height,
    });
  }
  return out;
}

/**
 * The box a container needs to hold what is inside it, which is what expanding
 * a collapsed box resizes to. Returns `null` for a node with no children.
 */
export function boxAroundChildren(
  index: DocIndex,
  config: SchematicConfig,
  node: SchematicNode,
): Rect | null {
  const kids = childrenOf(index, node.id);
  const bounds = boundsOf(kids.map((kid) => kid.rect));
  if (!bounds) return null;
  const own = config.nodeBox(node.kind);
  return {
    x: Math.min(node.rect.x, bounds.x - PAD),
    y: Math.min(node.rect.y, bounds.y - HEADER),
    width: Math.max(own.width, bounds.width + PAD * 2),
    height: Math.max(own.height, bounds.height + PAD + HEADER),
  };
}

/** Bottom-up: a leaf takes its configured box, a container takes whichever is
 *  larger, its own box or the block its children need. */
function measure(
  index: DocIndex,
  config: SchematicConfig,
  parentId: string | null,
  sizes: Map<string, { width: number; height: number }>,
): { width: number; height: number } {
  const kids = childrenOf(index, parentId);
  for (const kid of kids) measure(index, config, kid.id, sizes);

  const block = blockSize(kids, sizes, parentId === null);
  if (parentId === null) return block;

  const node = index.byId.get(parentId) as SchematicNode;
  const own = config.nodeBox(node.kind);
  // Collapse is deliberately ignored here: a hidden child still needs a
  // position, so the block is measured as though every container were open.
  const size =
    kids.length === 0
      ? own
      : {
          width: Math.max(own.width, block.width + PAD * 2),
          height: Math.max(own.height, block.height + PAD + HEADER),
        };
  sizes.set(parentId, size);
  return size;
}

/** The bounding size of a wrapped row-major flow of children. */
function blockSize(
  kids: readonly SchematicNode[],
  sizes: Map<string, { width: number; height: number }>,
  atRoot: boolean,
): { width: number; height: number } {
  if (kids.length === 0) return { width: 0, height: 0 };
  const perRow = atRoot ? ROW + 1 : ROW;
  let width = 0;
  let height = 0;
  let rowWidth = 0;
  let rowHeight = 0;
  kids.forEach((kid, i) => {
    const size = sizes.get(kid.id) ?? { width: 0, height: 0 };
    rowWidth += size.width + (i % perRow === 0 ? 0 : GAP);
    rowHeight = Math.max(rowHeight, size.height);
    if (i % perRow === perRow - 1 || i === kids.length - 1) {
      width = Math.max(width, rowWidth);
      height += rowHeight + (height === 0 ? 0 : GAP);
      rowWidth = 0;
      rowHeight = 0;
    }
  });
  return { width, height };
}

/** Top-down: hand each child its origin, then recurse inside it. */
function place(
  index: DocIndex,
  config: SchematicConfig,
  parentId: string | null,
  origin: { x: number; y: number },
  sizes: Map<string, { width: number; height: number }>,
  out: Map<string, Rect>,
): void {
  const kids = childrenOf(index, parentId);
  if (kids.length === 0) return;
  const perRow = parentId === null ? ROW + 1 : ROW;

  let x = origin.x;
  let y = origin.y;
  let rowHeight = 0;
  kids.forEach((kid, i) => {
    const size = sizes.get(kid.id) ?? config.nodeBox(kid.kind);
    if (i % perRow === 0 && i > 0) {
      x = origin.x;
      y += rowHeight + GAP;
      rowHeight = 0;
    }
    out.set(kid.id, { x, y, width: size.width, height: size.height });
    place(index, config, kid.id, { x: x + PAD, y: y + HEADER }, sizes, out);
    x += size.width + GAP;
    rowHeight = Math.max(rowHeight, size.height);
  });
}

/** The document with every node moved to its arranged slot — what `Auto-sort`
 *  commits, as one undoable step. */
export function autoSorted(doc: SchematicDoc, config: SchematicConfig): SchematicDoc {
  const arrangement = arrange(doc, config);
  return {
    ...doc,
    nodes: doc.nodes.map((node) => ({ ...node, rect: arrangement.get(node.id) ?? node.rect })),
  };
}
