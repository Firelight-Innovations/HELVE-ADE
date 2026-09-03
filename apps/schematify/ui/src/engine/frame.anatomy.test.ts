/**
 * PRD §17 Wave 4's acceptance condition: "every badge, count, and caption
 * that fixtures/saas-backend can produce draws from that fixture." This app
 * has no such fixture yet — Wave 1's `crates/schematify-core/fixtures/`
 * never landed on this branch, the same gap Wave 3's handoff (assumption 10)
 * records for the dense fixture — so the condition is read against this
 * app's own hand-typed stand-in, `graph/fixture.ts`'s `AUTH_SERVICE_GRAPH`,
 * which Wave 4 populated with every anatomy field
 * WIREFRAME-EXTRACT.md §1.1 draws for this exact screen.
 *
 * Every string below is copied from that section literally, not composed.
 * Each assertion is paired with a check on the fixture's own input field, so
 * a future edit to the fixture that quietly changes the input cannot leave a
 * stale, still-passing assertion behind.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import type { DrawnNode, Frame } from "./frame";
import { buildFrame } from "./frame";
import { buildDoc } from "./layout";
import { SERVICE_CONFIG } from "./presets";
import { AUTH_SERVICE_GRAPH } from "../graph/fixture";

async function serviceFrame(zoom = 0.68): Promise<Frame> {
  const seam = createMemorySeam();
  const doc = buildDoc(await seam.loadGraph(), null, SERVICE_CONFIG);
  return buildFrame({
    doc,
    config: SERVICE_CONFIG,
    viewport: { x: -4000, y: -4000, zoom },
    size: { width: 12000, height: 12000 },
    selection: new Set(),
  });
}

function nodeById(frame: Frame, id: string): DrawnNode {
  const found = frame.nodes.find((drawn) => drawn.node.id === id);
  if (!found) throw new Error(`no drawn node ${id}`);
  return found;
}

function fixtureNode(id: string) {
  const found = AUTH_SERVICE_GRAPH.nodes.find((node) => node.id === id);
  if (!found) throw new Error(`no fixture node ${id}`);
  return found;
}

describe("HTTP Entry — entry point and export count", () => {
  it("carries the badge and export fields the drawn strings come from", () => {
    const raw = fixtureNode("http-entry");
    expect(raw.badge).toBe("ENTRY");
    expect(raw.exportsCount).toBe(4);
  });

  it("draws 📌 ENTRY POINT and 4 exports", async () => {
    const drawn = nodeById(await serviceFrame(), "http-entry");
    expect(drawn.badges).toEqual(["📌 ENTRY POINT"]);
    expect(drawn.counts).toEqual(["4 exports"]);
    expect(drawn.caption).toBeUndefined();
  });
});

describe("Token Issuer — description, full facet row, libraries", () => {
  it("carries the 3 facet counts and 2 libraries the drawn strings come from", () => {
    const raw = fixtureNode("token-issuer");
    expect(raw.facets).toEqual({ methods: 3, tests: 5, budgets: 2 });
    expect(raw.libraries).toEqual(["jose", "zod"]);
  });

  it("draws the description, the full 3-chip facet row, and no caption", async () => {
    const drawn = nodeById(await serviceFrame(), "token-issuer");
    expect(drawn.node.description).toBe(
      "Mints access and refresh pairs, binds them to a session record.",
    );
    expect(drawn.facetChips).toEqual(["⬤ 3 meth", "⬤ 5 test", "⬤ 2 budg"]);
    expect(drawn.node.libraries).toEqual(["jose", "zod"]);
    expect(drawn.badges).toEqual([]);
    expect(drawn.caption).toBeUndefined();
  });
});

describe("Token Verifier — the expanded parent's own contains count", () => {
  it("has exactly 2 children in the fixture", () => {
    const children = AUTH_SERVICE_GRAPH.nodes.filter((node) => node.parentId === "token-verifier");
    expect(children.map((node) => node.id).sort()).toEqual(["clock-skew", "jwks-cache"]);
  });

  it("draws contains 2, not the collapsed wording", async () => {
    const drawn = nodeById(await serviceFrame(), "token-verifier");
    expect(drawn.container).toBe(true);
    expect(drawn.containsCaption).toBe("contains 2");
    expect(drawn.collapsedCaption).toBeUndefined();
  });
});

describe("JWKS Cache — a 2-chip facet row with no budget chip", () => {
  it("carries methods and tests but no budgets field at all", () => {
    const raw = fixtureNode("jwks-cache");
    expect(raw.facets).toEqual({ methods: 2, tests: 6 });
    expect(raw.facets?.budgets).toBeUndefined();
  });

  it("draws exactly 2 chips, never a 0 budg chip", async () => {
    const drawn = nodeById(await serviceFrame(), "jwks-cache");
    expect(drawn.facetChips).toEqual(["⬤ 2 meth", "⬤ 6 test"]);
  });
});

describe("Clock Skew — draft with no run data", () => {
  it("is draft with health explicitly no-data", () => {
    const raw = fixtureNode("clock-skew");
    expect(raw.lifecycle).toBe("draft");
    expect(raw.health).toBe("no-data");
  });

  it("draws the draft · no run data caption and the no-data wedge", async () => {
    const drawn = nodeById(await serviceFrame(), "clock-skew");
    expect(drawn.caption).toEqual({ primary: "draft · no run data" });
    expect(drawn.health).toBe("no-data");
    expect(drawn.lifecycle.borderStyle).toBe("dashed");
  });
});

describe("Session Store — collapsed, with a roll-up caption computed from the fixture's own edges", () => {
  it("is collapsed with exactly 2 children in the graph", () => {
    const raw = fixtureNode("session-store");
    expect(raw.collapsed).toBe(true);
    const children = AUTH_SERVICE_GRAPH.nodes.filter((node) => node.parentId === "session-store");
    expect(children).toHaveLength(2);
  });

  it("draws collapsed · 2 children", async () => {
    const drawn = nodeById(await serviceFrame(), "session-store");
    expect(drawn.collapsedCaption).toBe("collapsed · 2 children");
  });

  it("rolls up exactly 1 aggregated edge — the fixture's own topology, not the wireframe's drawn 3", () => {
    // WIREFRAME-EXTRACT.md §1.1 draws `3 edges aggregated` for this box, but
    // that number describes a screen this app has no real fixture behind.
    // The stand-in fixture's edge list (`graph/fixture.ts`) is, in its own
    // words, "this module's own construction... not asserted by any
    // acceptance condition" — only 1 of its 9 edges (`session-codec ->
    // token-issuer`) touches a node hidden under Session Store's collapse.
    // PRD §0.4 makes the computed value the truth over a drawn one in
    // exactly this situation (WIREFRAME-EXTRACT.md Resolution 10.2 rules the
    // identical question for the Stack Schematic's node and edge counts), so
    // this test asserts what the fixture actually produces rather than
    // forcing a match to a screen this fixture does not reproduce.
    const hiddenEdges = AUTH_SERVICE_GRAPH.edges.filter(
      (edge) => edge.from === "session-codec" || edge.to === "session-codec",
    );
    expect(hiddenEdges).toHaveLength(1);
  });

  it("draws 1 edge aggregated, singular", async () => {
    const drawn = nodeById(await serviceFrame(), "session-store");
    expect(drawn.rollUpCaption).toBe("1 edge aggregated");
  });
});

describe("Crypto Primitives — SHARED · AT LCA, dependents, and a full facet row", () => {
  it("carries the shared flag, the dependent count, and 3 facet counts", () => {
    const raw = fixtureNode("crypto-primitives");
    expect(raw.sharedAtLca).toBe(true);
    expect(raw.dependentsCount).toBe(2);
    expect(raw.facets).toEqual({ methods: 6, tests: 14, budgets: 1 });
  });

  it("draws the badge, the dependents count, and the facet row, with no caption", async () => {
    const drawn = nodeById(await serviceFrame(), "crypto-primitives");
    expect(drawn.badges).toEqual(["SHARED · AT LCA"]);
    expect(drawn.counts).toEqual(["2 dependents"]);
    expect(drawn.facetChips).toEqual(["⬤ 6 meth", "⬤ 14 test", "⬤ 1 budg"]);
    expect(drawn.caption).toBeUndefined();
    // accepted: the heavier 1.5px border, the saturated fill, the full check.
    expect(drawn.lifecycle.borderWidthPx).toBe(1.5);
    expect(drawn.lifecycle.headerGlyph).toBe("✓");
  });
});

describe("Password Hasher — reviewed, awaiting accept", () => {
  it("is lifecycle reviewed with its own description", () => {
    const raw = fixtureNode("password-hasher");
    expect(raw.lifecycle).toBe("reviewed");
    expect(raw.description).toBe("Argon2id hashing with per-tenant cost parameters.");
  });

  it("draws the reviewed caption and the half-check glyph", async () => {
    const drawn = nodeById(await serviceFrame(), "password-hasher");
    expect(drawn.caption).toEqual({ primary: "reviewed · awaiting accept" });
    expect(drawn.lifecycle.headerGlyph).toBe("◐");
  });
});

describe("Rate Limiter — agent-authored, assigned", () => {
  it("is assigned and authored by an agent", () => {
    const raw = fixtureNode("rate-limiter");
    expect(raw.lifecycle).toBe("assigned");
    expect(raw.authoredBy).toBe("agent");
  });

  it("draws ◇ AGENT DRAFT and the agent caption, not the plain AGENT diamond", async () => {
    const drawn = nodeById(await serviceFrame(), "rate-limiter");
    expect(drawn.badges).toEqual(["◇ AGENT DRAFT"]);
    expect(drawn.caption).toEqual({ primary: "Pre-filled by agent. Not reviewed." });
  });

  it("draws exactly 1 diamond on the whole node — the badge, never a 2nd one from the header glyph", async () => {
    // The end-to-end regression check for the double-diamond finding: this
    // is the one fixture node whose lifecycle (assigned) would previously
    // have drawn its own inline "◇" on top of the badge already drawn above.
    const drawn = nodeById(await serviceFrame(), "rate-limiter");
    expect(drawn.lifecycle.headerGlyph).toBe("");
    const diamonds = drawn.badges.filter((badge) => badge.includes("◇"));
    expect(diamonds).toHaveLength(1);
  });
});

describe("Audit Emitter — stale, with the 2-line caption and an amber wedge", () => {
  it("is stale with its own second-line reason and a soft-fail health", () => {
    const raw = fixtureNode("audit-emitter");
    expect(raw.lifecycle).toBe("stale");
    expect(raw.staleReason).toBe("crypto-primitives.sign changed 2h ago. Re-review required.");
    expect(raw.health).toBe("soft-fail");
  });

  it("draws the exact 2-line STALE caption and the amber health wedge", async () => {
    const drawn = nodeById(await serviceFrame(), "audit-emitter");
    expect(drawn.caption).toEqual({
      primary: "⚠ STALE — upstream contract changed",
      secondary: "crypto-primitives.sign changed 2h ago. Re-review required.",
    });
    expect(drawn.health).toBe("soft-fail");
    // stale: the accepted treatment plus the overlay stripe (PRD §12.7).
    expect(drawn.lifecycle.borderWidthPx).toBe(1.5);
    expect(drawn.lifecycle.overlayStripe).toBe(true);
    expect(drawn.badges).toEqual([]);
  });
});

describe("border weight and overlay geometry survive at 22% zoom (PRD §17 Wave 4)", () => {
  it("keeps every node's border weight and overlay stripe unchanged at 0.22 zoom", async () => {
    const full = await serviceFrame(1);
    const geometry = await serviceFrame(0.22);
    expect(full.nodes.length).toBeGreaterThan(0);
    expect(full.nodes.length).toBe(geometry.nodes.length);
    for (const node of full.nodes) {
      const atGeometry = nodeById(geometry, node.node.id);
      expect(atGeometry.lifecycle.borderWidthPx).toBe(node.lifecycle.borderWidthPx);
      expect(atGeometry.lifecycle.borderStyle).toBe(node.lifecycle.borderStyle);
      expect(atGeometry.lifecycle.overlayStripe).toBe(node.lifecycle.overlayStripe);
      expect(atGeometry.lifecycle.bottomFillPct).toBe(node.lifecycle.bottomFillPct);
      expect(atGeometry.health).toBe(node.health);
    }
  });

  it("marks every node's zoom tier as geometry at 0.22, and full at the default 68%", async () => {
    const geometry = await serviceFrame(0.22);
    const full = await serviceFrame(0.68);
    expect(geometry.nodes.length).toBeGreaterThan(0);
    for (const node of geometry.nodes) expect(node.zoomTier).toBe("geometry");
    for (const node of full.nodes) expect(node.zoomTier).toBe("full");
  });
});

describe("the health wedge never overlaps the node menu, for every node this fixture draws", () => {
  it("holds for every visible node at the default zoom", async () => {
    const frame = await serviceFrame(0.68);
    expect(frame.nodes.length).toBeGreaterThan(0);
    for (const drawn of frame.nodes) {
      const { wedge, menu } = drawn.headerOccupants;
      if (!wedge) continue;
      expect(
        wedge.x < menu.x + menu.width &&
          wedge.x + wedge.width > menu.x &&
          wedge.y < menu.y + menu.height &&
          wedge.y + wedge.height > menu.y,
      ).toBe(false);
    }
  });
});
