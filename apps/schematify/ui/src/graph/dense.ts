/**
 * The dense fixture PRD §16.2 describes: 1 service, 200 modules at containment
 * depth 5, 260 dependency edges. Wave 3 asserts the 16 ms frame budget
 * (PRD §14.7) against it.
 *
 * PRD §16.2 puts this fixture on disk at `fixtures/dense-service/`, produced by
 * `fixtures/generate.mjs`. Neither exists on this branch — `crates/schematify-core`
 * and its fixtures are being built on a sibling branch that has not merged, and
 * `00-AGENT-CONTEXT.md` forbids this wave from importing that crate. So the
 * fixture is generated here to the same numbers, deterministically, and reached
 * only through the seam (`./index.ts`'s `loadDenseGraph`). When the real
 * fixture lands, that one method reads it and this file goes.
 *
 * Determinism matters twice over: a frame budget measured against a shape that
 * varies between runs is not a budget, and a shape that varies cannot be
 * compared to the real fixture when it arrives.
 */
import type { GraphEdge, GraphNode, ServiceGraph } from "./types";

/** PRD §16.2's 3 numbers, named so a test asserts against the specification
 *  rather than against whatever this file happens to produce. */
export const DENSE_MODULE_COUNT = 200;
export const DENSE_EDGE_COUNT = 260;
export const DENSE_DEPTH = 5;

/** Modules per level, deepest level taking the remainder. 8 + 24 + 72 + 96 is
 *  200, and 4 levels of modules under the service root is depth 5 by the
 *  convention `computeDepth` documents (the root counts as level 1). */
const FANOUT = [8, 3, 3];

function buildNodes(): GraphNode[] {
  const nodes: GraphNode[] = [];
  let levelIds: string[] = [];

  const push = (index: number, parentId: string | null): string => {
    const id = `dense-${index}`;
    nodes.push({
      id,
      slug: id,
      title: `Dense Module ${index}`,
      kind: "module",
      parentId,
      lifecycle: index % 7 === 0 ? "accepted" : "specified",
    });
    return id;
  };

  for (let i = 0; i < FANOUT[0]; i += 1) levelIds.push(push(nodes.length, null));

  for (const fanout of FANOUT.slice(1)) {
    const next: string[] = [];
    for (const parent of levelIds) {
      for (let i = 0; i < fanout; i += 1) next.push(push(nodes.length, parent));
    }
    levelIds = next;
  }

  // The remainder hangs off the deepest full level, in order, so the fixture
  // reaches exactly 200 modules without changing the tree's depth.
  let cursor = 0;
  while (nodes.length < DENSE_MODULE_COUNT) {
    push(nodes.length, levelIds[cursor % levelIds.length]);
    cursor += 1;
  }
  return nodes;
}

/**
 * Edges by index arithmetic rather than a random source: the same 260 pairs
 * every run, on every machine. The stride is coprime with the node count, so
 * one lap of the walk visits every node exactly once; each further lap shifts
 * the target by a second offset, which is what lets the walk reach 260 pairs
 * across 200 nodes instead of exhausting itself after one lap.
 */
function buildEdges(nodes: readonly GraphNode[]): GraphEdge[] {
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const count = nodes.length;
  const limit = count * count;
  for (let step = 0; edges.length < DENSE_EDGE_COUNT; step += 1) {
    if (step > limit) throw new Error("dense fixture: cannot reach the specified edge count");
    const lap = Math.floor(step / count);
    const from = nodes[step % count];
    const to = nodes[(step * 37 + 11 + lap * 7) % count];
    const key = `${from.id}->${to.id}`;
    if (from.id === to.id || seen.has(key)) continue;
    seen.add(key);
    edges.push({ id: `dense-e${edges.length}`, kind: "depends_on", from: from.id, to: to.id });
  }
  return edges;
}

const nodes = buildNodes();

export const DENSE_SERVICE_GRAPH: ServiceGraph = {
  tier: "service",
  serviceSlug: "dense-service",
  serviceTitle: "Dense Service",
  nodes,
  edges: buildEdges(nodes),
};
