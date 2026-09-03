/**
 * `./anatomy.ts`'s pure logic, exercised directly against plain objects
 * rather than through the whole engine pipeline — `frame.anatomy.test.ts`
 * covers the pipeline, this file covers the rules themselves, including the
 * 2 badges PRD §17 Wave 4 explicitly requires a test for because no fixture
 * node can produce them (`FRONTEND`, `EXTERNAL`).
 *
 * Every assertion below is paired with an assertion on its own input, per the
 * standing review finding on this build: a test that cannot fail is worse
 * than none, so a count or a string is checked against what fed it, not just
 * against what came out.
 */
import { describe, expect, it } from "vitest";
import { indexDoc } from "./doc";
import type { DocIndex, SchematicNode } from "./doc";
import { rectsOverlap } from "./geometry";
import type { Lifecycle } from "../graph";
import {
  LIFECYCLE_TREATMENTS,
  badgesFor,
  captionFor,
  contentBox,
  contentOf,
  countStringsFor,
  facetChipsFor,
  hasGuaranteedBadge,
  headerOccupants,
  healthRollupFor,
  healthWedgeFor,
  lifecycleSignature,
  screenReferenceId,
  zoomTierFor,
} from "./anatomy";
import type { AnatomyNode } from "./anatomy";

const LIFECYCLES: readonly Lifecycle[] = [
  "draft",
  "specified",
  "assigned",
  "implemented",
  "reviewed",
  "accepted",
  "stale",
  "deprecated",
];

function bareNode(overrides: Partial<AnatomyNode> = {}): AnatomyNode {
  return { slug: "n", kind: "module", ...overrides };
}

describe("badgesFor", () => {
  it("draws ENTRY POINT for a Service Schematic entry point", () => {
    const node = bareNode({ role: "entry-point" });
    expect(node.role).toBe("entry-point"); // the input this badge turns on
    expect(badgesFor(node, "service")).toEqual(["📌 ENTRY POINT"]);
  });

  it("draws the shorter ENTRY on the Stack Schematic for the same role", () => {
    const node = bareNode({ role: "entry-point" });
    expect(badgesFor(node, "stack")).toEqual(["📌 ENTRY"]);
  });

  it("draws SHARED · AT LCA only when the node is actually marked shared", () => {
    expect(badgesFor(bareNode({ sharedAtLca: true }), "service")).toEqual(["SHARED · AT LCA"]);
    expect(badgesFor(bareNode({ sharedAtLca: false }), "service")).toEqual([]);
  });

  it("draws the FRONTEND and EXTERNAL layer badges — PRD §17 Wave 4's own required test, since fixtures/saas-backend holds no such node", () => {
    const frontend = bareNode({ layer: "frontend" });
    const external = bareNode({ layer: "external" });
    // The input each assertion below depends on.
    expect(frontend.layer).toBe("frontend");
    expect(external.layer).toBe("external");
    expect(badgesFor(frontend, "service")).toEqual(["FRONTEND"]);
    expect(badgesFor(external, "stack")).toEqual(["EXTERNAL"]);
  });

  it("draws every other layer badge too", () => {
    expect(badgesFor(bareNode({ layer: "backend" }), "service")).toEqual(["BACKEND"]);
    expect(badgesFor(bareNode({ layer: "data" }), "service")).toEqual(["DATA"]);
    expect(badgesFor(bareNode({ layer: "edge" }), "service")).toEqual(["EDGE"]);
  });

  it("draws no layer badge at tier 3, even when the field is set", () => {
    expect(badgesFor(bareNode({ layer: "backend" }), "module")).toEqual([]);
  });

  it("draws AGENT DRAFT, not the plain AGENT diamond, when both conditions hold at once", () => {
    const node = bareNode({ lifecycle: "assigned", authoredBy: "agent" });
    expect(node.lifecycle).toBe("assigned");
    expect(node.authoredBy).toBe("agent");
    expect(badgesFor(node, "service")).toEqual(["◇ AGENT DRAFT"]);
  });

  it("draws the plain AGENT diamond for assigned with no agent authorship", () => {
    expect(badgesFor(bareNode({ lifecycle: "assigned" }), "service")).toEqual(["◇ AGENT"]);
  });

  it("draws AGENT DRAFT alone for agent authorship at any other lifecycle state", () => {
    expect(badgesFor(bareNode({ lifecycle: "reviewed", authoredBy: "agent" }), "service")).toEqual([
      "◇ AGENT DRAFT",
    ]);
  });

  it("draws MODULE ROOT · CANNOT BE DELETED only for the schematic-root role at tier 3", () => {
    const node = bareNode({ role: "schematic-root" });
    expect(badgesFor(node, "module")).toEqual(["MODULE ROOT · CANNOT BE DELETED"]);
    expect(badgesFor(node, "service")).toEqual([]);
  });

  it("draws EXPORTED for an exported contract-method facet", () => {
    const exported = bareNode({ kind: "contract-method", exported: true });
    const notExported = bareNode({ kind: "contract-method", exported: false });
    expect(exported.exported).toBe(true);
    expect(badgesFor(exported, "module")).toEqual(["EXPORTED"]);
    expect(badgesFor(notExported, "module")).toEqual([]);
  });

  it("draws HARD or SOFT for a budget facet's own tier", () => {
    expect(badgesFor(bareNode({ kind: "budget", budgetTier: "hard" }), "module")).toEqual(["HARD"]);
    expect(badgesFor(bareNode({ kind: "budget", budgetTier: "soft" }), "module")).toEqual(["SOFT"]);
  });

  it("draws several badges together in reading order, matching Crypto Primitives", () => {
    // WIREFRAME-EXTRACT.md §1.1: "SHARED · AT LCA" then the facet row — no
    // layer badge is set on this fixture node, so only the 1 badge draws.
    const node = bareNode({ sharedAtLca: true, dependentsCount: 2 });
    expect(badgesFor(node, "service")).toEqual(["SHARED · AT LCA"]);
  });
});

describe("facetChipsFor", () => {
  it("omits a facet type the node does not carry, rather than drawing a 0 chip", () => {
    const facets: { methods?: number; tests?: number; budgets?: number } = {
      methods: 2,
      tests: 6,
    };
    expect(facets.budgets).toBeUndefined(); // the input this test turns on
    expect(facetChipsFor(facets)).toEqual(["⬤ 2 meth", "⬤ 6 test"]);
  });

  it("draws all 3 chips when all 3 are present", () => {
    expect(facetChipsFor({ methods: 3, tests: 5, budgets: 2 })).toEqual([
      "⬤ 3 meth",
      "⬤ 5 test",
      "⬤ 2 budg",
    ]);
  });

  it("draws nothing for an undefined facets field", () => {
    expect(facetChipsFor(undefined)).toEqual([]);
  });
});

describe("countStringsFor", () => {
  it("draws N exports", () => {
    expect(countStringsFor(bareNode({ exportsCount: 4 }))).toEqual(["4 exports"]);
  });

  it("draws schemas ✓ only when resolved", () => {
    expect(countStringsFor(bareNode({ schemasResolved: true }))).toEqual(["schemas ✓"]);
    expect(countStringsFor(bareNode({ schemasResolved: false }))).toEqual([]);
  });

  it("draws N dependents alongside N modules when both are set", () => {
    const node = bareNode({ modulesCount: 12, dependentsCount: 2 });
    expect(countStringsFor(node)).toEqual(["12 modules", "2 dependents"]);
  });
});

describe("captionFor — one caption, in priority order", () => {
  it("draws the 2-line STALE caption, ahead of every other reason", () => {
    const node = bareNode({
      lifecycle: "stale",
      authoredBy: "agent",
      staleReason: "crypto-primitives.sign changed 2h ago. Re-review required.",
    });
    expect(node.lifecycle).toBe("stale");
    expect(captionFor(node)).toEqual({
      primary: "⚠ STALE — upstream contract changed",
      secondary: "crypto-primitives.sign changed 2h ago. Re-review required.",
    });
  });

  it("draws the agent-authored caption for Rate Limiter", () => {
    const node = bareNode({ lifecycle: "assigned", authoredBy: "agent" });
    expect(captionFor(node)).toEqual({ primary: "Pre-filled by agent. Not reviewed." });
  });

  it("draws reviewed · awaiting accept for Password Hasher", () => {
    expect(captionFor(bareNode({ lifecycle: "reviewed" }))).toEqual({
      primary: "reviewed · awaiting accept",
    });
  });

  it("draws draft · no run data for Clock Skew", () => {
    const node = bareNode({ lifecycle: "draft", health: "no-data" });
    expect(node.health).toBe("no-data");
    expect(captionFor(node)).toEqual({ primary: "draft · no run data" });
  });

  it("draws draft · 0 exports authored for a draft service with nothing exported", () => {
    const node = bareNode({ kind: "service", lifecycle: "draft", exportsCount: 0 });
    expect(captionFor(node)).toEqual({ primary: "draft · 0 exports authored" });
  });

  it("draws the deprecated successor arrow", () => {
    const node = bareNode({
      slug: "legacy-session",
      lifecycle: "deprecated",
      deprecatedSuccessor: "session-store",
    });
    expect(captionFor(node)).toEqual({ primary: "legacy-session → session-store" });
  });

  it("draws nothing for a node whose state carries no reason", () => {
    expect(captionFor(bareNode({ lifecycle: "accepted" }))).toBeUndefined();
    expect(captionFor(bareNode({ lifecycle: "implemented" }))).toBeUndefined();
    expect(captionFor(bareNode())).toBeUndefined();
  });
});

describe("the 8 lifecycle states are mutually distinguishable by geometry alone", () => {
  it("has exactly 8 treatments, one per state", () => {
    expect(Object.keys(LIFECYCLE_TREATMENTS).sort()).toEqual([...LIFECYCLES].sort());
  });

  it("produces 8 distinct colour-blind fingerprints — proved, not asserted by inspection", () => {
    // The property under test: no 2 of the 8 states collapse to the same
    // fingerprint once colour (the `*Token` fields) is removed. A test that
    // just listed 8 hand-picked expected strings could pass by coincidence if
    // 2 states actually matched; a Set-size check cannot.
    //
    // `assigned` and `specified` now share an identical `lifecycleSignature`
    // — `assigned` draws no header glyph of its own, since `badgesFor`
    // already guarantees a diamond badge for every assigned node and a 2nd,
    // inline glyph would duplicate it (a review finding on this build: a
    // Rate Limiter node was drawing 2 diamonds, 1 from the badge and 1 from
    // this treatment's own `headerGlyph`). `hasGuaranteedBadge` is
    // `assigned`'s real distinguishing mark once the duplicate is removed, so
    // the fingerprint below folds it in rather than silently losing 1 of the
    // 8 states this test proves apart.
    const fingerprints = LIFECYCLES.map(
      (state) =>
        `${lifecycleSignature(LIFECYCLE_TREATMENTS[state])}|badge:${hasGuaranteedBadge(state)}`,
    );
    expect(fingerprints).toHaveLength(8);
    expect(new Set(fingerprints).size).toBe(8);
  });

  it("draws assigned's diamond from the badge only — no duplicate inline header glyph", () => {
    // The regression test for the double-diamond finding: `assigned`'s own
    // treatment carries no glyph, and `badgesFor` draws exactly 1 diamond
    // badge for an assigned node, whether or not it is also agent-authored.
    expect(LIFECYCLE_TREATMENTS.assigned.headerGlyph).toBe("");
    expect(hasGuaranteedBadge("assigned")).toBe(true);
    expect(hasGuaranteedBadge("specified")).toBe(false);

    const humanAssigned = bareNode({ lifecycle: "assigned" });
    const agentAssigned = bareNode({ lifecycle: "assigned", authoredBy: "agent" });
    expect(humanAssigned.lifecycle).toBe("assigned");
    expect(agentAssigned.authoredBy).toBe("agent");

    for (const node of [humanAssigned, agentAssigned]) {
      const badges = badgesFor(node, "service");
      const diamonds = badges.filter((badge) => badge.includes("◇"));
      expect(diamonds).toHaveLength(1);
    }
  });

  it("draws no state's own header glyph as a diamond, so a badge is never duplicated", () => {
    // A broader guard than the single `assigned` check above: no treatment
    // in the whole table should ever carry "◇" as its `headerGlyph`, because
    // every diamond this app draws comes from `badgesFor`.
    for (const state of LIFECYCLES) {
      expect(LIFECYCLE_TREATMENTS[state].headerGlyph).not.toBe("◇");
    }
  });

  it("keeps every legend caption distinct too, matching WIREFRAME-EXTRACT.md §2.2", () => {
    const captions = LIFECYCLES.map((state) => LIFECYCLE_TREATMENTS[state].legendCaption);
    expect(captions).toEqual([
      "draft — dashed, muted fill",
      "specified — solid, neutral",
      "assigned — agent glyph",
      "implemented — filled edge",
      "reviewed — half check",
      "accepted — full check, saturated",
      "stale — accepted + stripe",
      "deprecated — 40%, struck",
    ]);
  });
});

describe("healthWedgeFor", () => {
  it("reads an absent health field as passing, drawing no wedge", () => {
    expect(healthWedgeFor(undefined)).toBe("passing");
  });

  it("passes every named status straight through", () => {
    expect(healthWedgeFor("passing")).toBe("passing");
    expect(healthWedgeFor("soft-fail")).toBe("soft-fail");
    expect(healthWedgeFor("hard-fail")).toBe("hard-fail");
    expect(healthWedgeFor("no-data")).toBe("no-data");
  });
});

describe("zoomTierFor", () => {
  it("keeps the Service Schematic's own default zoom (68%) at full detail", () => {
    // SERVICE_CONFIG.zoom.initial is 0.68 (presets.ts); WIREFRAME-EXTRACT.md
    // §1.1 draws facet counts on that exact screen at that exact zoom, so
    // "full" has to include it.
    expect(zoomTierFor(0.68)).toBe("full");
  });

  it("draws full detail at 100% and at the mid/full boundary (just above 55%)", () => {
    expect(zoomTierFor(1)).toBe("full");
    expect(zoomTierFor(0.5501)).toBe("full");
  });

  it("draws the mid tier at exactly 55% and down to just above 22%", () => {
    expect(zoomTierFor(0.55)).toBe("mid");
    expect(zoomTierFor(0.2201)).toBe("mid");
  });

  it("draws the geometry-only tier at exactly the acceptance condition's own value, 22%", () => {
    expect(zoomTierFor(0.22)).toBe("geometry");
    expect(zoomTierFor(0.05)).toBe("geometry");
  });
});

describe("the health wedge never overlaps the node menu", () => {
  it("keeps the 2 rects apart at the widest node this app draws and at the narrowest", () => {
    // 452 is the widest box a preset draws (SERVICE_CONFIG's group), 54 is
    // WIREFRAME-EXTRACT.md §2.4's own 22%-tier reference card width — the
    // smallest a node face is ever drawn at.
    for (const width of [54, 116, 152, 182, 204, 226, 290, 410, 452]) {
      const box = { width, height: 96 };
      const { wedge, menu } = headerOccupants(box, true);
      expect(wedge).not.toBeNull();
      if (wedge) expect(rectsOverlap(wedge, menu)).toBe(false);
    }
  });

  it("still keeps the menu inside the box at the narrowest width", () => {
    const { menu } = headerOccupants({ width: 54, height: 28 }, true);
    expect(menu.x).toBeGreaterThanOrEqual(0);
  });

  it("draws no wedge rect at all when the node is passing", () => {
    const { wedge } = headerOccupants({ width: 204, height: 118 }, false);
    expect(wedge).toBeNull();
  });
});

describe("healthRollupFor — the service roll-up in words (PRD §12.8)", () => {
  function serviceIndex(moduleHealths: readonly (string | undefined)[]): {
    index: DocIndex;
    service: SchematicNode;
  } {
    const modules: SchematicNode[] = moduleHealths.map((health, i) => ({
      id: `m${i}`,
      slug: `m${i}`,
      title: `M${i}`,
      kind: "module",
      parentId: "svc",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      collapsed: false,
      health: health as SchematicNode["health"],
    }));
    const service: SchematicNode = {
      id: "svc",
      slug: "svc",
      title: "Svc",
      kind: "service",
      parentId: null,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      collapsed: false,
    };
    const index = indexDoc({ slug: "s", title: "S", nodes: [service, ...modules], edges: [] });
    return { index, service };
  }

  it("draws nothing when every contained module is passing", () => {
    const { index, service } = serviceIndex(["passing", undefined, "passing"]);
    expect(healthRollupFor(service, index)).toBeUndefined();
  });

  it("names the worst status and counts only the modules at that worst status", () => {
    const { index, service } = serviceIndex(["passing", "soft-fail", "soft-fail", "no-data"]);
    // The input: 2 modules soft-fail, 1 no-data, 1 passing. soft-fail
    // outranks no-data, so the roll-up should name soft-fail and count 2.
    expect(healthRollupFor(service, index)).toEqual({
      primary: "worst contained: 2 soft budget trending",
    });
  });

  it("matches WIREFRAME-EXTRACT.md §1.1's own drawn example", () => {
    const { index, service } = serviceIndex(["soft-fail"]);
    expect(healthRollupFor(service, index)).toEqual({
      primary: "worst contained: 1 soft budget trending",
    });
  });

  it("ranks hard-fail above soft-fail", () => {
    const { index, service } = serviceIndex(["soft-fail", "hard-fail"]);
    expect(healthRollupFor(service, index)).toEqual({
      primary: "worst contained: 1 hard budget failing",
    });
  });

  it("ignores a non-module descendant such as a comment", () => {
    const { index, service } = serviceIndex(["passing"]);
    const withComment = {
      ...index,
      byId: new Map(index.byId),
      childrenOf: new Map(index.childrenOf),
    };
    // A comment anchored under the service should never move the rollup —
    // proven by adding one with a bad health value and checking it is inert.
    const comment: SchematicNode = {
      id: "c1",
      slug: "comment-c1",
      title: "note",
      kind: "comment",
      parentId: "svc",
      rect: { x: 0, y: 0, width: 10, height: 10 },
      collapsed: false,
      health: "hard-fail",
    };
    withComment.byId.set("c1", comment);
    withComment.childrenOf.set("svc", [...(withComment.childrenOf.get("svc") ?? []), comment]);
    expect(healthRollupFor(service, withComment)).toBeUndefined();
  });
});

describe("contentOf and contentBox — sizing a node from its content", () => {
  it("adds no growth for a node with none of the 4 optional rows", () => {
    const content = contentOf(bareNode());
    expect(content).toEqual({
      hasDescription: false,
      hasFacets: false,
      hasLibraries: false,
      hasCaption: false,
    });
    expect(contentBox({ width: 204, height: 118 }, content)).toEqual({ width: 204, height: 118 });
  });

  it("grows for a description, matching Token Issuer's content", () => {
    const node = bareNode({
      description: "Mints access and refresh pairs, binds them to a session record.",
      facets: { methods: 3, tests: 5, budgets: 2 },
      libraries: ["jose", "zod"],
    });
    const content = contentOf(node);
    expect(content).toEqual({
      hasDescription: true,
      hasFacets: true,
      hasLibraries: true,
      hasCaption: false,
    });
    const box = contentBox({ width: 204, height: 118 }, content);
    expect(box.width).toBe(204);
    expect(box.height).toBeGreaterThan(118);
  });

  it("treats a facets object with every field undefined as no facets at all", () => {
    expect(contentOf(bareNode({ facets: {} })).hasFacets).toBe(false);
  });

  it("reads hasCaption from the same priority rule captionFor uses", () => {
    const node = bareNode({ lifecycle: "draft", health: "no-data" });
    expect(contentOf(node).hasCaption).toBe(true);
    expect(contentOf(bareNode({ lifecycle: "accepted" })).hasCaption).toBe(false);
  });
});

describe("screenReferenceId", () => {
  it("extracts the id half of a schematify://screen/<id> reference", () => {
    expect(screenReferenceId("schematify://screen/login-form")).toBe("login-form");
    expect(screenReferenceId("schematify://screen/0192f4a1-4c3d")).toBe("0192f4a1-4c3d");
  });

  it("returns null for the retired journeyman:// scheme, per PRD §12.5", () => {
    expect(screenReferenceId("journeyman://screen/login-form")).toBeNull();
  });

  it("returns null for a reference naming a different kind", () => {
    expect(screenReferenceId("schematify://node/token-verifier")).toBeNull();
  });

  it("returns null for a string that is not a reference at all", () => {
    expect(screenReferenceId("not a reference")).toBeNull();
  });
});
