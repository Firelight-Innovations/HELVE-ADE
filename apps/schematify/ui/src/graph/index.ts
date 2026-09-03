/**
 * The one narrow seam between the shell and the graph, ahead of a real loader.
 * PRD §17 Wave 2 needs the shell to "open" `fixtures/saas-backend/`, but
 * `crates/schematify-core`'s loader (PRD §6.4) is on a branch that has not
 * merged, and `00-AGENT-CONTEXT.md` forbids importing that crate.
 *
 * Deliberately pure: nothing here imports `@openkaava/bridge`, so this module
 * unit-tests under plain Node without a `window`. `./backend.ts` is this app's
 * other half, and its only door to Rust.
 *
 * The functions below `loadGraph` read no fixture themselves — they compute
 * from whatever `ServiceGraph` they are given, per PRD §0.4.
 *
 * Wave 3 widened the seam from a loader to a loader *and* a writer without
 * widening it to 2 modules: `SchematifySeam` at the foot of this file is every
 * read and every write the Schematic engine makes.
 */
import { DENSE_SERVICE_GRAPH } from "./dense";
import { AUTH_SERVICE_GRAPH } from "./fixture";
import type { LayoutFile } from "./layout";
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

export type { LayoutAnnotation, LayoutFile, LayoutNode, LayoutViewport } from "./layout";
export { emptyLayout, layoutPath } from "./layout";

/**
 * Returns the Service Schematic the shell opens this wave: the hand-typed
 * fixture in `./fixture.ts`, shaped exactly like the eventual real answer
 * and returned as a `Promise` so a later `invoke("schematify/load-graph")`
 * call (through `./backend.ts`) is a drop-in. **A later wiring wave replaces
 * only this function's body** — every caller reads the graph through this
 * module and never imports `./fixture` directly, so nothing else changes
 * when a real loader lands.
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
 *  1 level under a top-level module.
 *
 *  Throws rather than looping forever if `parentId` describes a cycle — a
 *  hand-typed or malformed fixture should fail loudly here, not hang the
 *  tab. An unknown `parentId` (no node with that id) is treated as top-level
 *  rather than an error, since a real loader's quarantine (PRD §6.4) is the
 *  place a dangling reference gets handled, not this function. */
export function computeDepth(nodes: GraphNode[]): number {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const memo = new Map<string, number>();

  function levelOf(node: GraphNode, visiting: Set<string>): number {
    const cached = memo.get(node.id);
    if (cached !== undefined) return cached;
    if (visiting.has(node.id)) {
      throw new Error(`containment cycle at node ${node.id}`);
    }
    visiting.add(node.id);
    const parent = node.parentId === null ? null : byId.get(node.parentId);
    const level = parent ? levelOf(parent, visiting) + 1 : 2;
    visiting.delete(node.id);
    memo.set(node.id, level);
    return level;
  }

  return nodes.reduce((max, node) => Math.max(max, levelOf(node, new Set())), 1);
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

/**
 * Every read and every write the Schematic engine makes, in one interface.
 * PRD §17 Wave 3 persists positions "through `schematify_write_layout`", and
 * `docs/audits/schematify-baseline.md` §11 resolves that to a JSON-RPC method
 * on the app dispatch (`schematify/write-layout`) rather than a new Tauri
 * command — so the wiring wave replaces the 4 bodies in `defaultSeam` below
 * with 4 `invoke` calls and changes nothing else in this app.
 *
 * The split between `writeLayout` and `writeSemantic` is the enforcement
 * point for PRD §6.2's two-layer rule, not a convenience: a gesture that only
 * arranges the picture may call the first and may never call the second.
 */
export interface SchematifySeam {
  /** `schematify/load-graph`. */
  loadGraph(): Promise<ServiceGraph>;
  /** The dense fixture PRD §16.2 names, the subject of the 16 ms frame
   *  budget. One method rather than a parameter on `loadGraph`, so a caller
   *  cannot ask for it by accident. */
  loadDenseGraph(): Promise<ServiceGraph>;
  /** `schematify/read-layout`. `null` when the Schematic has no layout file
   *  yet, which is the first-run state, not an error. */
  readLayout(slug: string): Promise<LayoutFile | null>;
  /** `schematify/write-layout`. Writes `layout/<slug>.json` and nothing
   *  else. */
  writeLayout(slug: string, file: LayoutFile): Promise<void>;
  /** Any write to the semantic layer — `nodes/`, `edges/` (PRD §6.1). Edge
   *  creation and duplication are the gestures in Wave 3 that reach it. */
  writeSemantic(path: string, json: unknown): Promise<void>;
  /** Removes a semantic file. Undoing an edge creation needs it, so it is
   *  part of the seam rather than a gap a later wave discovers. */
  removeSemantic(path: string): Promise<void>;
}

/**
 * The seam ahead of a backend. Layout and semantic writes are held in memory,
 * so a position survives a tier switch inside one session and does not survive
 * a reload — the same honesty as `loadGraph` returning a fixture. The maps are
 * exported so a test can assert exactly which layer a gesture wrote to.
 */
export function createMemorySeam(): SchematifySeam & {
  layouts: Map<string, LayoutFile>;
  semantic: Map<string, unknown>;
} {
  const layouts = new Map<string, LayoutFile>();
  const semantic = new Map<string, unknown>();
  return {
    layouts,
    semantic,
    loadGraph,
    loadDenseGraph: () => Promise.resolve(DENSE_SERVICE_GRAPH),
    readLayout: (slug) => Promise.resolve(layouts.get(slug) ?? null),
    writeLayout: (slug, file) => {
      layouts.set(slug, file);
      return Promise.resolve();
    },
    writeSemantic: (path, json) => {
      semantic.set(path, json);
      return Promise.resolve();
    },
    removeSemantic: (path) => {
      semantic.delete(path);
      return Promise.resolve();
    },
  };
}

/**
 * The seam the running application uses, backed by `./backend.ts` (the real
 * `schematify/*` methods) through a dynamic `import()` rather than a static
 * one — a static import here would pull `@openkaava/bridge`'s `window`
 * access into the plain-Node `index.test.ts` (see `w2-shell.md`'s fix for
 * the same failure). Memoized so `createBackendSeam`'s in-memory maps
 * persist across calls. `loadGraph()` and `createMemorySeam()` above are
 * untouched — every test that wants the fixture still gets it directly.
 */
let backendSeam: Promise<SchematifySeam> | null = null;
function getBackendSeam(): Promise<SchematifySeam> {
  backendSeam ??= import("./backend").then((m) => m.createBackendSeam());
  return backendSeam;
}

export const defaultSeam: SchematifySeam = {
  loadGraph: () => getBackendSeam().then((seam) => seam.loadGraph()),
  loadDenseGraph: () => getBackendSeam().then((seam) => seam.loadDenseGraph()),
  readLayout: (slug) => getBackendSeam().then((seam) => seam.readLayout(slug)),
  writeLayout: (slug, file) => getBackendSeam().then((seam) => seam.writeLayout(slug, file)),
  writeSemantic: (path, json) => getBackendSeam().then((seam) => seam.writeSemantic(path, json)),
  removeSemantic: (path) => getBackendSeam().then((seam) => seam.removeSemantic(path)),
};
