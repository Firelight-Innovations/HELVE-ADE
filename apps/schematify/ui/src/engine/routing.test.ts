/**
 * PRD §12.3's 2 routing constraints, asserted rather than eyeballed: an edge
 * routes orthogonally, an edge crosses a group border, an edge never enters a
 * sibling box.
 *
 * The third is the one worth a test with teeth. It is asserted over every edge
 * of the whole fixture, against every box that is not an endpoint, rather than
 * on a hand-picked pair — a router that fails only in the awkward case is the
 * router this repository would ship.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import { buildFrame } from "./frame";
import { childrenOf, indexDoc, visibleNodes } from "./doc";
import { polylineHitsRect } from "./geometry";
import { buildDoc } from "./layout";
import { SERVICE_CONFIG } from "./presets";
import { inPort, isOrthogonal, outPort, routeEdge } from "./routing";
import type { SchematicDoc } from "./doc";

async function serviceFrame() {
  const seam = createMemorySeam();
  const doc = buildDoc(await seam.loadGraph(), null, SERVICE_CONFIG);
  const frame = buildFrame({
    doc,
    config: SERVICE_CONFIG,
    viewport: { x: -4000, y: -4000, zoom: 1 },
    size: { width: 12000, height: 12000 },
    selection: new Set(),
  });
  return { doc, frame };
}

describe("orthogonal routing", () => {
  it("draws every segment of every edge on an axis", async () => {
    const { frame } = await serviceFrame();
    expect(frame.edges.length).toBeGreaterThan(0);
    for (const edge of frame.edges) {
      expect(isOrthogonal(edge.route.points)).toBe(true);
    }
  });

  it("leaves the out port and arrives at the in port", async () => {
    const { doc, frame } = await serviceFrame();
    const byId = indexDoc(doc).byId;
    for (const edge of frame.edges) {
      const from = byId.get(edge.fromId);
      const to = byId.get(edge.toId);
      const points = edge.route.points;
      expect(points[0]).toEqual(outPort(from?.rect ?? { x: 0, y: 0, width: 0, height: 0 }));
      expect(points[points.length - 1]).toEqual(
        inPort(to?.rect ?? { x: 0, y: 0, width: 0, height: 0 }),
      );
    }
  });

  it("never enters a box that is neither end of the edge", async () => {
    const { doc, frame } = await serviceFrame();
    const index = indexDoc(doc);
    const boxes = visibleNodes(doc, index).filter(
      (node) => node.kind !== "group" && childrenOf(index, node.id).length === 0,
    );

    const entered: string[] = [];
    for (const edge of frame.edges) {
      for (const box of boxes) {
        if (box.id === edge.fromId || box.id === edge.toId) continue;
        if (polylineHitsRect(edge.route.points, box.rect)) {
          entered.push(`${edge.fromId} -> ${edge.toId} enters ${box.id}`);
        }
      }
    }
    expect(entered).toEqual([]);
  });

  it("reports honestly when no candidate route is clean", () => {
    // A target walled off on every side: the router draws something rather
    // than dropping the edge, and says the route is not clean.
    const wall = { x: 100, y: -400, width: 20, height: 900 };
    const route = routeEdge(
      { x: 0, y: 0, width: 60, height: 40 },
      { x: 300, y: 0, width: 60, height: 40 },
      [wall],
    );
    expect(route.clean).toBe(false);
    expect(isOrthogonal(route.points)).toBe(true);
    expect(route.points.length).toBeGreaterThan(1);
  });
});

describe("a group border is crossable", () => {
  it("routes straight through a group rather than around it", () => {
    const doc: SchematicDoc = {
      slug: "group-crossing",
      title: "group-crossing",
      nodes: [
        {
          id: "source",
          slug: "source",
          title: "Source",
          kind: "module",
          parentId: null,
          rect: { x: 0, y: 0, width: 80, height: 40 },
          collapsed: false,
        },
        {
          id: "band",
          slug: "band",
          title: "Band",
          kind: "group",
          parentId: null,
          rect: { x: 140, y: -60, width: 120, height: 160 },
          collapsed: false,
        },
        {
          id: "target",
          slug: "target",
          title: "Target",
          kind: "module",
          parentId: null,
          rect: { x: 360, y: 0, width: 80, height: 40 },
          collapsed: false,
        },
      ],
      edges: [{ id: "e1", kind: "depends_on", from: "source", to: "target" }],
    };
    const frame = buildFrame({
      doc,
      config: SERVICE_CONFIG,
      viewport: { x: -500, y: -500, zoom: 1 },
      size: { width: 2000, height: 2000 },
      selection: new Set(),
    });

    const route = frame.edges[0].route;
    expect(route.clean).toBe(true);
    expect(polylineHitsRect(route.points, { x: 140, y: -60, width: 120, height: 160 })).toBe(true);
  });
});
