/**
 * The draw model: the zoom readout, the edge legend, the minimap, the counts,
 * and the one rendering that is not an edge.
 *
 * The containment-arrow tests are the ones to read first. WIREFRAME-EXTRACT.md
 * Resolution 10.1 row 7.1 rules that the Module Schematic draws a labelled
 * line for a relation the graph stores as nesting, and that "a user cannot
 * create, delete, or reroute one, and it never appears in any edge count".
 * Each half of that sentence has an assertion below.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import { buildFrame } from "./frame";
import { buildDoc } from "./layout";
import { MODULE_CONFIG, SERVICE_CONFIG, STACK_CONFIG } from "./presets";
import { zoomReadout } from "./viewport";

async function frameFor(config = SERVICE_CONFIG, zoom = 1) {
  const seam = createMemorySeam();
  const doc = buildDoc(await seam.loadGraph(), null, config);
  return buildFrame({
    doc,
    config,
    viewport: { x: -4000, y: -4000, zoom },
    size: { width: 12000, height: 12000 },
    selection: new Set(),
  });
}

describe("the zoom readout", () => {
  it("draws the wireframe's 2 forms", () => {
    expect(zoomReadout({ x: 0, y: 0, zoom: 0.68 })).toBe("68%");
    expect(zoomReadout({ x: 0, y: 0, zoom: 1 })).toBe("100%");
  });

  it("comes off the live viewport rather than a stored number", async () => {
    expect((await frameFor(SERVICE_CONFIG, 0.55)).zoom).toBe("55%");
  });
});

describe("the edge legend", () => {
  it("draws one chip per edge kind the tier's vocabulary holds", async () => {
    const frame = await frameFor(SERVICE_CONFIG);
    expect(frame.legend.map((chip) => chip.kind)).toEqual([
      "depends_on",
      "implements",
      "references_ui",
    ]);
    expect(frame.legendFooter).toBe("contains = nesting · depends_on = drawn");
  });

  it("leads the Module Schematic's legend with the containment chip", async () => {
    const frame = await frameFor(MODULE_CONFIG);
    expect(frame.legend[0].kind).toBe("contains");
    expect(frame.legend.map((chip) => chip.kind)).toContain("covers");
  });

  it("carries each kind's own line style, so a chip cannot disagree with its edges", async () => {
    const frame = await frameFor(SERVICE_CONFIG);
    const implementsChip = frame.legend.find((chip) => chip.kind === "implements");
    expect(implementsChip?.style.line).toBe("dashed");
    expect(implementsChip?.style.arrow).toBe("hollow");
  });
});

describe("the containment rendering at tier 3", () => {
  it("draws a labelled line from a parent to each child", async () => {
    const frame = await frameFor(MODULE_CONFIG);
    const rendered = frame.edges.filter((edge) => edge.kind === "contains");
    expect(rendered.length).toBeGreaterThan(0);
    for (const edge of rendered) expect(edge.label).toBe("contains");
  });

  it("marks every one of them as not stored", async () => {
    const frame = await frameFor(MODULE_CONFIG);
    for (const edge of frame.edges.filter((edge) => edge.kind === "contains")) {
      expect(edge.stored).toBe(false);
    }
  });

  it("keeps them out of the edge count", async () => {
    const frame = await frameFor(MODULE_CONFIG);
    const rendered = frame.edges.filter((edge) => edge.kind === "contains");
    expect(rendered.length).toBeGreaterThan(0);
    expect(frame.counts.edges).toBe(9);
  });

  it("draws none of them on a tier whose containment is plain nesting", async () => {
    for (const config of [STACK_CONFIG, SERVICE_CONFIG]) {
      const frame = await frameFor(config);
      expect(frame.edges.filter((edge) => edge.kind === "contains")).toEqual([]);
    }
  });

  it("holds no stored edge a user could delete for any of them", async () => {
    const seam = createMemorySeam();
    const doc = buildDoc(await seam.loadGraph(), null, MODULE_CONFIG);
    expect(doc.edges.some((edge) => (edge.kind as string) === "contains")).toBe(false);
  });
});

describe("counts", () => {
  it("computes them from the document rather than reading a stored field", async () => {
    const frame = await frameFor(SERVICE_CONFIG);
    expect(frame.counts).toEqual({ nodes: 12, edges: 9 });
  });
});

describe("the minimap", () => {
  it("scales every visible box into its own box, with the viewport over it", async () => {
    const frame = await frameFor(SERVICE_CONFIG);
    const minimap = frame.minimap;
    expect(minimap).not.toBeNull();
    expect(minimap?.box).toEqual({ x: 0, y: 0, width: 160, height: 110 });
    expect(minimap?.nodes).toHaveLength(10);
    for (const rect of minimap?.nodes ?? []) {
      expect(rect.x).toBeGreaterThanOrEqual(-0.001);
      expect(rect.y).toBeGreaterThanOrEqual(-0.001);
      expect(rect.width).toBeLessThanOrEqual(160);
    }
  });

  it("is absent on a tier configured without one", async () => {
    const seam = createMemorySeam();
    const config = { ...SERVICE_CONFIG, chrome: { ...SERVICE_CONFIG.chrome, minimap: false } };
    const doc = buildDoc(await seam.loadGraph(), null, config);
    const frame = buildFrame({
      doc,
      config,
      viewport: { x: 0, y: 0, zoom: 1 },
      size: { width: 1320, height: 700 },
      selection: new Set(),
    });
    expect(frame.minimap).toBeNull();
  });
});

describe("selection reaches the draw model", () => {
  it("marks the selected boxes and no others", async () => {
    const seam = createMemorySeam();
    const doc = buildDoc(await seam.loadGraph(), null, SERVICE_CONFIG);
    const frame = buildFrame({
      doc,
      config: SERVICE_CONFIG,
      viewport: { x: -4000, y: -4000, zoom: 1 },
      size: { width: 12000, height: 12000 },
      selection: new Set(["token-issuer"]),
    });
    expect(frame.nodes.filter((drawn) => drawn.selected).map((drawn) => drawn.node.id)).toEqual([
      "token-issuer",
    ]);
  });
});
