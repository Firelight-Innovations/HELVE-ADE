/**
 * PRD §14.7's hard budget: "Service Schematic frame time, dense fixture, under
 * 16 ms", and PRD §17 Wave 3's acceptance condition that it is "asserted from
 * a test suite" rather than measured by hand.
 *
 * Three things keep this from passing vacuously, which is the only way a
 * timing test earns its place:
 *
 * 1. The subject is checked against PRD §16.2's own numbers — 200 modules,
 *    260 edges, containment depth 5 — before a single frame is timed.
 * 2. The viewport is sized to show the whole fixture, so culling removes
 *    nothing, and the frame is asserted to have drawn all 200 boxes and all
 *    260 edges. A frame that measured fast by drawing less fails here first.
 * 3. The threshold is the PRD's 16 ms, with no machine allowance and no skip.
 *    A slow machine fails this test, and that is the intended behaviour: the
 *    budget is `hard`, and §14.7 says a hard budget gates a wave.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import { DENSE_DEPTH, DENSE_EDGE_COUNT, DENSE_MODULE_COUNT } from "../graph/dense";
import { computeDepth } from "../graph";
import { buildFrame } from "./frame";
import type { FrameInput } from "./frame";
import { boundsOf } from "./geometry";
import { buildDoc } from "./layout";
import { SERVICE_CONFIG } from "./presets";

/** PRD §14.7. Not a target, not a soft threshold. */
const BUDGET_MS = 16;
/** Odd, so the median is a real sample rather than a mean of two. */
const SAMPLES = 21;
const WARMUP = 5;

async function denseInput(): Promise<FrameInput> {
  const seam = createMemorySeam();
  const graph = await seam.loadDenseGraph();
  const doc = buildDoc(graph, null, SERVICE_CONFIG);
  const bounds = boundsOf(doc.nodes.map((node) => node.rect));
  if (!bounds) throw new Error("the dense fixture arranged to nothing");
  return {
    doc,
    config: SERVICE_CONFIG,
    // A viewport large enough to hold the whole fixture at zoom 1, so nothing
    // is culled and the measurement is of the worst frame, not a lucky one.
    viewport: { x: bounds.x - 100, y: bounds.y - 100, zoom: 1 },
    size: { width: bounds.width + 200, height: bounds.height + 200 },
    selection: new Set(),
  };
}

describe("the dense fixture holds the 16 ms frame budget", () => {
  it("is the fixture PRD §16.2 specifies", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadDenseGraph();
    expect(graph.nodes).toHaveLength(DENSE_MODULE_COUNT);
    expect(graph.edges).toHaveLength(DENSE_EDGE_COUNT);
    expect(computeDepth(graph.nodes)).toBe(DENSE_DEPTH);
    expect(DENSE_MODULE_COUNT).toBe(200);
    expect(DENSE_EDGE_COUNT).toBe(260);
    expect(DENSE_DEPTH).toBe(5);
  });

  it("draws the whole fixture in the frame being measured", async () => {
    const frame = buildFrame(await denseInput());
    expect(frame.nodes).toHaveLength(DENSE_MODULE_COUNT);
    expect(frame.edges).toHaveLength(DENSE_EDGE_COUNT);
  });

  it("builds a frame in under 16 ms, at the median of 21 runs", async () => {
    const input = await denseInput();
    for (let i = 0; i < WARMUP; i += 1) buildFrame(input);

    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const started = performance.now();
      const frame = buildFrame(input);
      samples.push(performance.now() - started);
      // Inside the loop, so a frame that quietly stopped drawing cannot be
      // the reason a later sample got faster.
      expect(frame.nodes).toHaveLength(DENSE_MODULE_COUNT);
    }

    const sorted = [...samples].sort((a, b) => a - b);
    const median = sorted[Math.floor(SAMPLES / 2)];
    expect(Number.isFinite(median)).toBe(true);
    expect(median).toBeGreaterThan(0);
    expect(median).toBeLessThan(BUDGET_MS);
  });

  it("holds the budget with a fifth of the graph collapsed, which adds roll-up work", async () => {
    const base = await denseInput();
    const collapsedIds = new Set(
      base.doc.nodes.filter((node, i) => i % 5 === 0 && node.parentId !== null).map((n) => n.id),
    );
    const input: FrameInput = {
      ...base,
      doc: {
        ...base.doc,
        nodes: base.doc.nodes.map((node) =>
          collapsedIds.has(node.id) ? { ...node, collapsed: true } : node,
        ),
      },
    };
    for (let i = 0; i < WARMUP; i += 1) buildFrame(input);

    const samples: number[] = [];
    for (let i = 0; i < SAMPLES; i += 1) {
      const started = performance.now();
      buildFrame(input);
      samples.push(performance.now() - started);
    }
    const median = [...samples].sort((a, b) => a - b)[Math.floor(SAMPLES / 2)];
    expect(median).toBeLessThan(BUDGET_MS);
  });
});
