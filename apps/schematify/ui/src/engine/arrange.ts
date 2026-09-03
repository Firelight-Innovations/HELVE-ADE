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
import { snap } from "./geometry";
import type { Rect } from "./geometry";

/** Space between two boxes at the same level. */
const GAP = 40;
/** Space between a container's border and its children, with extra at the top
 *  for the container's own header row. */
const PAD = 18;
const HEADER = 34;
/** How many children sit in one row before the flow wraps. */
const ROW = 3;

/** Arranged geometry, by node id. Nodes are not mutated here. */
export type Arrangement = ReadonlyMap<string, Rect>;

export function arrange(doc: SchematicDoc, config: SchematicConfig): Arrangement {
  const index = indexDoc(doc);
  const out = new Map<string, Rect>();
  const sizes = new Map<string, { width: number; height: number }>();

  measure(index, config, null, sizes);
  place(index, config, null, { x: GAP, y: GAP }, sizes, out);

  for (const [id, rect] of out) {
    out.set(id, {
      ...rect,
      x: snap(rect.x, config.grid.size),
      y: snap(rect.y, config.grid.size),
    });
  }
  return out;
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
  const size =
    kids.length === 0 || node.collapsed
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
    if (!kid.collapsed) {
      place(index, config, kid.id, { x: x + PAD, y: y + HEADER }, sizes, out);
    }
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
