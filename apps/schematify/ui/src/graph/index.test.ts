/**
 * The 2 status-bar cells and the Outline footer are exact-string acceptance
 * conditions for Wave 2 (PRD §17), so these assertions match those strings
 * literally rather than loosely. Everything here is computed from
 * `AUTH_SERVICE_GRAPH` at call time — none of it is a stored count, per PRD
 * §0.4 — so a change to the fixture that changed a count would fail exactly
 * the test that should catch it.
 */
import { describe, expect, it } from "vitest";
import { AUTH_SERVICE_GRAPH } from "./fixture";
import {
  buildOutlineRows,
  computeDepth,
  countEdges,
  countNodes,
  loadGraph,
  outlineFooter,
  statusCell1,
  statusCell2,
} from "./index";

describe("loadGraph", () => {
  it("resolves the auth-service fixture", async () => {
    const graph = await loadGraph();
    expect(graph.serviceSlug).toBe("auth-service");
  });
});

describe("computed counts", () => {
  it("counts 12 nodes", () => {
    expect(countNodes(AUTH_SERVICE_GRAPH)).toBe(12);
  });

  it("counts 9 edges", () => {
    expect(countEdges(AUTH_SERVICE_GRAPH)).toBe(9);
  });

  it("computes containment depth 3", () => {
    expect(computeDepth(AUTH_SERVICE_GRAPH.nodes)).toBe(3);
  });
});

describe("status bar", () => {
  it("draws cell 1 exactly as PRD §17 Wave 2 requires", () => {
    expect(statusCell1(AUTH_SERVICE_GRAPH)).toBe(".kaava/ · 12 nodes · 9 edges");
  });

  it("draws cell 2 exactly as PRD §17 Wave 2 requires", () => {
    expect(statusCell2(AUTH_SERVICE_GRAPH)).toBe("layout/auth-service.json clean");
  });

  it("draws cell 2 as modified when the layout is not clean", () => {
    expect(statusCell2(AUTH_SERVICE_GRAPH, false)).toBe("layout/auth-service.json modified");
  });
});

describe("outline footer", () => {
  it("reads 12 nodes · depth 3", () => {
    expect(outlineFooter(AUTH_SERVICE_GRAPH)).toBe("12 nodes · depth 3");
  });
});

describe("buildOutlineRows", () => {
  const rows = buildOutlineRows(AUTH_SERVICE_GRAPH);

  it("draws every root-level node and every expanded node's children, but no row for a collapsed node's children", () => {
    // 12 nodes total; session-store's 2 children (session-codec,
    // session-index) get no row of their own because session-store is
    // collapsed. 12 - 2 = 10 rows.
    expect(rows).toHaveLength(10);
    expect(rows.some((row) => row.node.id === "session-codec")).toBe(false);
    expect(rows.some((row) => row.node.id === "session-index")).toBe(false);
  });

  it("draws token-verifier's children as their own rows, since it is not collapsed", () => {
    expect(rows.some((row) => row.node.id === "jwks-cache")).toBe(true);
    expect(rows.some((row) => row.node.id === "clock-skew")).toBe(true);
  });

  it("gives the collapsed session-store row a trailing count of 2", () => {
    const sessionStore = rows.find((row) => row.node.id === "session-store");
    expect(sessionStore?.hiddenChildCount).toBe(2);
  });

  it("draws the ENTRY badge on http-entry and the STALE badge on audit-emitter, and no other row", () => {
    const badged = rows.filter((row) => row.node.badge !== undefined);
    expect(badged.map((row) => [row.node.id, row.node.badge])).toEqual([
      ["http-entry", "ENTRY"],
      ["audit-emitter", "STALE"],
    ]);
  });

  it("indents a child one level deeper than its parent", () => {
    const parent = rows.find((row) => row.node.id === "token-verifier");
    const child = rows.find((row) => row.node.id === "jwks-cache");
    expect(child?.depth).toBe((parent?.depth ?? 0) + 1);
  });
});
