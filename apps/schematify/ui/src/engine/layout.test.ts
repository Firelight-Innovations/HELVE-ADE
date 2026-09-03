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
import { createMemorySeam, layoutPath } from "../graph";
import { buildDoc, toLayoutFile } from "./layout";
import { SERVICE_CONFIG } from "./presets";

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
});
