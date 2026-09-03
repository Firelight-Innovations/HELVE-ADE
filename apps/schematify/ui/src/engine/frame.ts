/**
 * One frame's draw model. Everything the renderer needs and nothing it has to
 * work out for itself: which boxes are visible, where every edge runs, what
 * the collapsed captions say, what the legend and the readout read.
 *
 * This is also the unit the 16 ms budget in PRD §14.7 is measured against.
 * A React component that measured fast only because it drew nothing would
 * prove nothing, so the budget is asserted here, where the work actually is.
 *
 * Every count on a frame is computed here and stored nowhere (PRD §0.4).
 */
import type { EdgeKind, EdgeStyle, SchematicConfig } from "./config";
import type { DocIndex, SchematicDoc, SchematicNode } from "./doc";
import {
  ancestorsOf,
  childrenOf,
  descendantsOf,
  indexDoc,
  visibleNodes,
  visibleStandIn,
} from "./doc";
import type { Rect } from "./geometry";
import { boundsOf, inflate, rectsOverlap, unionRect } from "./geometry";
import type { Route } from "./routing";
import { routeEdge } from "./routing";
import type { Viewport, ViewportSize } from "./viewport";
import { visibleWorldRect, zoomReadout } from "./viewport";

/** A node as drawn. The captions are strings rather than numbers because the
 *  wireframe fixes their wording (WIREFRAME-EXTRACT.md §1.1) and one place
 *  should own it. */
export interface DrawnNode {
  node: SchematicNode;
  rect: Rect;
  /** Descendants at any depth, computed this frame. */
  childCount: number;
  /** True when this box holds visible children, so its border may be crossed
   *  by an edge (PRD §12.3). */
  container: boolean;
  selected: boolean;
  /** `collapsed · 2 children`, drawn only on a collapsed box. */
  collapsedCaption?: string;
  /** `3 edges aggregated`, drawn only when edges roll up to this border. */
  rollUpCaption?: string;
}

/** An edge as drawn. `stored` separates a real graph edge from the tier-3
 *  rendering of nesting. */
export interface DrawnEdge {
  id: string;
  kind: EdgeKind | "contains";
  style: EdgeStyle;
  route: Route;
  fromId: string;
  toId: string;
  /** How many stored edges this line stands for. Above 1 only when a
   *  collapsed box rolled several into one border-to-border line. */
  aggregated: number;
  /** False for the tier-3 containment line, which no user gesture can create,
   *  delete or reroute, and which enters no edge count. */
  stored: boolean;
  /** The inline label the Module Schematic draws beside a containment line. */
  label?: string;
}

/** One chip beside the zoom readout (PRD §12.1). */
export interface LegendChip {
  kind: EdgeKind | "contains";
  style: EdgeStyle;
}

/** The minimap box and what sits in it (PRD §12.3). Coordinates are already
 *  scaled into the minimap's own box, so the renderer only places them. */
export interface Minimap {
  box: Rect;
  nodes: readonly Rect[];
  viewport: Rect;
}

export interface Frame {
  nodes: readonly DrawnNode[];
  edges: readonly DrawnEdge[];
  legend: readonly LegendChip[];
  legendFooter: string;
  zoom: string;
  minimap: Minimap | null;
  /** The counts the status bar and the header draw, computed here. The
   *  containment renderings are not in `edges`. */
  counts: { nodes: number; edges: number };
}

/** What `buildFrame` needs beyond the document. */
export interface FrameInput {
  doc: SchematicDoc;
  config: SchematicConfig;
  viewport: Viewport;
  size: ViewportSize;
  selection: ReadonlySet<string>;
  index?: DocIndex;
}

/** The minimap's own box, matching the thumbnail the wireframe parks in that
 *  corner (WIREFRAME-EXTRACT.md §1.2). */
const MINIMAP_BOX = { width: 160, height: 110 };

export function buildFrame(input: FrameInput): Frame {
  const { doc, config, viewport, size, selection } = input;
  const index = input.index ?? indexDoc(doc);
  const visible = visibleNodes(doc, index);
  const view = inflate(visibleWorldRect(viewport, size), 200);

  const rollUp = new Map<string, number>();
  const edges = buildEdges(doc, index, config, visible, rollUp);
  const drawnNodes = visible
    .filter((node) => rectsOverlap(node.rect, view))
    .map((node) => drawNode(node, index, selection, rollUp));

  return {
    nodes: drawnNodes,
    edges: edges.filter((edge) => routeTouches(edge, view)),
    legend: buildLegend(config),
    legendFooter: config.legendFooter,
    zoom: zoomReadout(viewport),
    minimap: config.chrome.minimap ? buildMinimap(visible, viewport, size) : null,
    counts: { nodes: doc.nodes.length, edges: doc.edges.length },
  };
}

function drawNode(
  node: SchematicNode,
  index: DocIndex,
  selection: ReadonlySet<string>,
  rollUp: ReadonlyMap<string, number>,
): DrawnNode {
  const kids = childrenOf(index, node.id);
  const childCount = node.collapsed ? descendantsOf(index, node.id).length : kids.length;
  const aggregated = rollUp.get(node.id) ?? 0;
  return {
    node,
    rect: node.rect,
    childCount,
    container: !node.collapsed && kids.length > 0,
    selected: selection.has(node.id),
    collapsedCaption: node.collapsed ? `collapsed · ${childCount} children` : undefined,
    rollUpCaption:
      aggregated > 0 ? `${aggregated} edge${aggregated === 1 ? "" : "s"} aggregated` : undefined,
  };
}

/**
 * Stored edges, rerouted through whatever box actually stands in for each end,
 * then aggregated. An edge whose ends both collapse into the same box is not
 * drawn at all — it is internal to that box now — and several edges that
 * collapse onto the same pair become one line carrying a count, which is the
 * roll-up PRD §12.3 requires and the wireframe's `3 edges aggregated`.
 */
function buildEdges(
  doc: SchematicDoc,
  index: DocIndex,
  config: SchematicConfig,
  visible: readonly SchematicNode[],
  rollUp: Map<string, number>,
): DrawnEdge[] {
  const obstacles = visible.filter(
    (node) => node.kind !== "group" && childrenOf(index, node.id).length === 0,
  );
  const grouped = new Map<
    string,
    { kind: EdgeKind; from: SchematicNode; to: SchematicNode; ids: string[] }
  >();

  for (const edge of doc.edges) {
    const from = visibleStandIn(index, edge.from);
    const to = visibleStandIn(index, edge.to);
    if (!from || !to || from.id === to.id) continue;
    if (from.id !== edge.from) rollUp.set(from.id, (rollUp.get(from.id) ?? 0) + 1);
    if (to.id !== edge.to) rollUp.set(to.id, (rollUp.get(to.id) ?? 0) + 1);
    const key = `${edge.kind}|${from.id}|${to.id}`;
    const bucket = grouped.get(key);
    if (bucket) bucket.ids.push(edge.id);
    else grouped.set(key, { kind: edge.kind, from, to, ids: [edge.id] });
  }

  const out: DrawnEdge[] = [];
  for (const entry of grouped.values()) {
    const rule = config.edgeKinds.find((candidate) => candidate.kind === entry.kind);
    if (!rule) continue;
    out.push({
      id: entry.ids[0],
      kind: entry.kind,
      style: rule.style,
      route: routeEdge(
        entry.from.rect,
        entry.to.rect,
        obstaclesFor(obstacles, index, entry.from, entry.to),
      ),
      fromId: entry.from.id,
      toId: entry.to.id,
      aggregated: entry.ids.length,
      stored: true,
    });
  }

  out.push(...containmentRenderings(config, index, visible, obstacles));
  return out;
}

/**
 * The boxes this edge may not enter. A container is left out because PRD §12.3
 * says an edge crosses a group border, and so is either endpoint's own
 * ancestry, since a child's edge necessarily leaves through its parent.
 *
 * The bounding-box prefilter is what keeps this affordable: the dense fixture
 * asks this question 260 times, and only the boxes anywhere near the two ends
 * can possibly be hit.
 */
function obstaclesFor(
  candidates: readonly SchematicNode[],
  index: DocIndex,
  from: SchematicNode,
  to: SchematicNode,
): Rect[] {
  const span = inflate(unionRect(from.rect, to.rect), 64);
  const exempt = new Set<string>([from.id, to.id]);
  for (const node of ancestorsOf(index, from.id)) exempt.add(node.id);
  for (const node of ancestorsOf(index, to.id)) exempt.add(node.id);
  const out: Rect[] = [];
  for (const node of candidates) {
    if (exempt.has(node.id)) continue;
    if (!rectsOverlap(node.rect, span)) continue;
    out.push(node.rect);
  }
  return out;
}

/**
 * The Module Schematic's containment arrows — WIREFRAME-EXTRACT.md Resolution
 * 10.1 row 7.1. These are a rendering of nesting, not edges: they are
 * synthesised here every frame from `parentId`, they carry `stored: false`,
 * they are absent from `doc.edges`, and `Frame.counts.edges` never sees them.
 * A tier whose containment mode is plain nesting produces none.
 */
function containmentRenderings(
  config: SchematicConfig,
  index: DocIndex,
  visible: readonly SchematicNode[],
  obstacles: readonly SchematicNode[],
): DrawnEdge[] {
  if (config.containment.mode !== "nesting-and-arrows") return [];
  const label = config.containment.label;
  const style: EdgeStyle = {
    line: "solid",
    arrow: "filled",
    strokeToken: "--kv-text-tertiary",
    widthPx: 1,
  };
  const out: DrawnEdge[] = [];
  for (const node of visible) {
    if (node.parentId === null) continue;
    const parent = index.byId.get(node.parentId);
    if (!parent) continue;
    out.push({
      id: `contains:${parent.id}:${node.id}`,
      kind: "contains",
      style,
      route: routeEdge(parent.rect, node.rect, obstaclesFor(obstacles, index, parent, node)),
      fromId: parent.id,
      toId: node.id,
      aggregated: 1,
      stored: false,
      label,
    });
  }
  return out;
}

function buildLegend(config: SchematicConfig): LegendChip[] {
  const chips: LegendChip[] = config.edgeKinds.map((rule) => ({
    kind: rule.kind,
    style: rule.style,
  }));
  if (config.containment.mode === "nesting-and-arrows") {
    chips.unshift({
      kind: "contains",
      style: { line: "solid", arrow: "filled", strokeToken: "--kv-text-tertiary", widthPx: 1 },
    });
  }
  return chips;
}

function routeTouches(edge: DrawnEdge, view: Rect): boolean {
  const points = edge.route.points;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const box = {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) || 1,
      height: Math.abs(a.y - b.y) || 1,
    };
    if (rectsOverlap(box, view)) return true;
  }
  return false;
}

/** The minimap: every visible box scaled into a fixed corner box, with the
 *  current viewport drawn over it. Health and error marks are Wave 4 and Wave
 *  7 content; the geometry is here. */
function buildMinimap(
  visible: readonly SchematicNode[],
  viewport: Viewport,
  size: ViewportSize,
): Minimap | null {
  const bounds = boundsOf(visible.map((node) => node.rect));
  if (!bounds) return null;
  const view = visibleWorldRect(viewport, size);
  const whole = unionRect(bounds, view);
  const scale = Math.min(MINIMAP_BOX.width / whole.width, MINIMAP_BOX.height / whole.height);
  const project = (rect: Rect): Rect => ({
    x: (rect.x - whole.x) * scale,
    y: (rect.y - whole.y) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });
  return {
    box: { x: 0, y: 0, ...MINIMAP_BOX },
    nodes: visible.map((node) => project(node.rect)),
    viewport: project(view),
  };
}
