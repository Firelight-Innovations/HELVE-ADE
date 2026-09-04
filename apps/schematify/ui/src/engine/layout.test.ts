/**
 * The cosmetic layer, on its own: what `layout/<schematic-slug>.json` holds,
 * what it does not hold, and that a document survives a round trip through it.
 *
 * The second of those is the interesting one. PRD §6.2 makes the split between
 * the two storage layers the enforcement mechanism for "an agent shall not
 * change the design", and a layout file that quietly carried a description or
 * a lifecycle state would be a hole in it.
 */
import { describe, expect, it } from "vitest";
import type { LayoutFile } from "../graph";
import { createMemorySeam, layoutPath } from "../graph";
import { SchematicEngine } from "./engine";
import { buildDoc, toGraph, toLayoutFile } from "./layout";
import { MODULE_CONFIG, SERVICE_CONFIG, STACK_CONFIG } from "./presets";

async function fixtureDoc() {
  const seam = createMemorySeam();
  return buildDoc(await seam.loadGraph(), null, SERVICE_CONFIG);
}

describe("the layout file", () => {
  it("is named after the Schematic slug, under layout/", () => {
    expect(layoutPath("auth-service")).toBe("layout/auth-service.json");
  });

  it("holds geometry and collapse state, and no semantic field", async () => {
    const file = toLayoutFile(await fixtureDoc());
    for (const entry of Object.values(file.nodes)) {
      expect(Object.keys(entry).sort()).toEqual(["collapsed", "height", "width", "x", "y"]);
    }
  });

  it("holds every node's position, keyed by identifier", async () => {
    const doc = await fixtureDoc();
    const file = toLayoutFile(doc);
    expect(Object.keys(file.nodes)).toHaveLength(12);
    expect(file.schematic).toBe("auth-service");
    expect(file.version).toBe(1);
  });

  it("restores the same geometry it stored", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const original = buildDoc(graph, null, SERVICE_CONFIG);
    const restored = buildDoc(graph, toLayoutFile(original), SERVICE_CONFIG);
    expect(restored.nodes.map((node) => node.rect)).toEqual(
      original.nodes.map((node) => node.rect),
    );
    expect(restored.nodes.map((node) => node.collapsed)).toEqual(
      original.nodes.map((node) => node.collapsed),
    );
  });

  it("gives a node the file does not name a deterministic slot rather than the origin", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const first = buildDoc(graph, null, SERVICE_CONFIG);
    const second = buildDoc(graph, null, SERVICE_CONFIG);
    expect(second.nodes.map((node) => node.rect)).toEqual(first.nodes.map((node) => node.rect));
    expect(first.nodes.every((node) => node.rect.width > 0 && node.rect.height > 0)).toBe(true);
    expect(new Set(first.nodes.map((node) => `${node.rect.x},${node.rect.y}`)).size).toBe(12);
  });

  it("snaps an arranged position to the tier's grid", async () => {
    const doc = await fixtureDoc();
    for (const node of doc.nodes) {
      expect(node.rect.x % SERVICE_CONFIG.grid.size).toBe(0);
      expect(node.rect.y % SERVICE_CONFIG.grid.size).toBe(0);
    }
  });

  it("nests a child inside its parent's box", async () => {
    const doc = await fixtureDoc();
    const parent = doc.nodes.find((node) => node.id === "token-verifier");
    const child = doc.nodes.find((node) => node.id === "jwks-cache");
    expect(child?.rect.x).toBeGreaterThanOrEqual(parent?.rect.x ?? 0);
    expect((child?.rect.x ?? 0) + (child?.rect.width ?? 0)).toBeLessThanOrEqual(
      (parent?.rect.x ?? 0) + (parent?.rect.width ?? 0),
    );
  });

  // The Fit corruption traced to here: a stored node whose geometry is not 4
  // real numbers used to be trusted verbatim (`withStored` copied `x`/`y`/
  // `width`/`height` straight off the parsed JSON), so a single missing field
  // put a `NaN` into the node's rect. `boundsOf` (`geometry.ts`) then unioned
  // it into every bounding box the node was part of, and `fitTo`
  // (`viewport.ts`) turned that into a zoom that never recovered — clicking
  // Fit again just recomputed the same poisoned bounds from the same doc.
  // Mutation that must turn this red: in `buildDoc`, change
  // `if (stored && isStoredRectValid(stored))` back to `if (stored)`.
  it("falls back to an arranged position when a stored node's geometry is not finite", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const malformed: LayoutFile = {
      version: 1,
      schematic: "auth-service",
      nodes: {
        "http-entry": { x: 44, y: 44, width: NaN, height: 118 },
      },
      annotations: [],
    };
    const doc = buildDoc(graph, malformed, SERVICE_CONFIG);
    const node = doc.nodes.find((n) => n.id === "http-entry");
    expect(node?.rect.x).toBeDefined();
    expect(Number.isFinite(node?.rect.width)).toBe(true);
    expect(Number.isFinite(node?.rect.height)).toBe(true);
  });

  // Same defect, the annotation path: an annotation has no `arrange`d
  // fallback (PRD §11.3 keeps it out of the semantic graph entirely), so
  // `fromAnnotation` used to trust its stored rect with nothing to fall back
  // to at all. Mutation that must turn this red: in `fromAnnotation`, change
  // `isFiniteRect(stored) ? stored : ...` to just `stored`.
  it("falls back to a default box when a stored annotation's geometry is not finite", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const malformed: LayoutFile = {
      version: 1,
      schematic: "auth-service",
      nodes: {},
      annotations: [
        {
          id: "group-1",
          kind: "group",
          slug: "group-1",
          title: "Bad group",
          parentId: null,
          x: 0,
          y: 0,
          width: undefined as unknown as number,
          height: 200,
        },
      ],
    };
    const doc = buildDoc(graph, malformed, SERVICE_CONFIG);
    const group = doc.nodes.find((n) => n.id === "group-1");
    expect(Number.isFinite(group?.rect.width)).toBe(true);
    expect(Number.isFinite(group?.rect.height)).toBe(true);
  });
});

describe("toGraph — the projection Outline and StatusBar read", () => {
  // Wave 5 fix: before this wave the projection collapsed every node's kind
  // to "service" or "module" (`node.kind === "service" ? "service" :
  // "module"`), silently correct only because "module" was the only other
  // kind a document ever held. The Wave 4 handoff flagged this in advance —
  // "the projection... collapses every non-service kind to a module, so
  // facet cards would be counted as modules the moment the Module Schematic
  // opens" — and this block is the regression test for exactly that.
  it("carries a facet's real kind through, not collapsed to module", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph("module", "token-verifier");
    const doc = buildDoc(graph, null, MODULE_CONFIG);
    const projected = toGraph(doc);
    const kinds = new Set(projected.nodes.map((node) => node.kind));
    expect(kinds).toContain("contract-method");
    expect(kinds).toContain("budget");
    expect(kinds).toContain("test-case");
    expect(kinds).toContain("doc-block");
    expect(kinds).toContain("external-dep");
    expect(kinds).not.toContain("service");
  });

  it("reads tier off the document rather than assuming service", async () => {
    const seam = createMemorySeam();
    const stackDoc = buildDoc(await seam.loadGraph("stack", "saas-backend"), null, STACK_CONFIG);
    expect(toGraph(stackDoc).tier).toBe("stack");
    const moduleDoc = buildDoc(
      await seam.loadGraph("module", "token-verifier"),
      null,
      MODULE_CONFIG,
    );
    expect(toGraph(moduleDoc).tier).toBe("module");
  });

  it("keeps a group with real children, so the Stack Outline lists platform-core", async () => {
    const seam = createMemorySeam();
    const doc = buildDoc(await seam.loadGraph("stack", "saas-backend"), null, STACK_CONFIG);
    const projected = toGraph(doc);
    const group = projected.nodes.find((node) => node.id === "platform-core");
    expect(group).toBeDefined();
    expect(group?.kind).toBe("group");
  });

  it("drops a group with no children, so a cosmetic annotation box never appears in the Outline", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const engine = new SchematicEngine(SERVICE_CONFIG, buildDoc(graph, null, SERVICE_CONFIG), seam);
    engine.addGroup({ x: 0, y: 0, width: 100, height: 100 }, "Empty annotation");
    const projected = toGraph(engine.state.doc);
    expect(projected.nodes.some((node) => node.kind === "group")).toBe(false);
  });

  it("still drops every comment, regardless of children", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph();
    const engine = new SchematicEngine(SERVICE_CONFIG, buildDoc(graph, null, SERVICE_CONFIG), seam);
    engine.addComment({ x: 0, y: 0, width: 230, height: 100 }, "m.ross", "note");
    const projected = toGraph(engine.state.doc);
    expect(projected.nodes.some((node) => node.kind === "comment")).toBe(false);
  });
});
