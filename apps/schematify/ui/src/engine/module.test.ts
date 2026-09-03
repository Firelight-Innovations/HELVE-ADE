/**
 * The Module Schematic (PRD §12.11), against the real `token-verifier`
 * fixture (`../graph/module.ts`) — the facet cards, the coverage readout, the
 * `SATISFIES` callout, and the module root's own undeletable rule. PRD §17
 * Wave 5's own acceptance condition — "the coverage readout computes `7 of 8`
 * on the fixture" — is the test to read first.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import { coverageBody, coverageOf, facetContentFor, SATISFIES_CALLOUT } from "./anatomy";
import { buildFrame } from "./frame";
import { buildDoc } from "./layout";
import { MODULE_CONFIG } from "./presets";
import { SchematicEngine } from "./engine";

async function moduleDoc() {
  const seam = createMemorySeam();
  const graph = await seam.loadGraph("module", "token-verifier");
  return buildDoc(graph, null, MODULE_CONFIG);
}

async function moduleFrame() {
  const doc = await moduleDoc();
  return buildFrame({
    doc,
    config: MODULE_CONFIG,
    viewport: { x: -4000, y: -4000, zoom: 1 },
    size: { width: 12000, height: 12000 },
    selection: new Set(),
  });
}

describe("the module fixture", () => {
  it("loads token-verifier with a root and 8 facets", async () => {
    const doc = await moduleDoc();
    expect(doc.nodes).toHaveLength(9);
    const root = doc.nodes.find((node) => node.role === "schematic-root");
    expect(root?.slug).toBe("token-verifier");
    expect(doc.nodes.filter((node) => node.parentId === root?.id)).toHaveLength(8);
  });

  it("carries all 3 contract-methods, including skew_window", () => {
    // WIREFRAME-EXTRACT.md Resolution 10.1 row 8.2: the wireframe's own
    // canvas skips this method's card; ruled a mock incompleteness, drawn
    // here per that ruling.
    return moduleDoc().then((doc) => {
      const methods = doc.nodes.filter((node) => node.kind === "contract-method");
      expect(methods.map((node) => node.slug).sort()).toEqual([
        "refresh_keys",
        "skew_window",
        "verify_signature",
      ]);
    });
  });
});

describe("the coverage readout formula", () => {
  it("computes 7 of 8 on the real per-method counts", () => {
    // PRD §16.1: verify_signature 4 covers edges, refresh_keys 3, skew_window
    // 0. present = 4 + 3 + 0 = 7. expected sums each method's own count when
    // it has any, and exactly 1 for a method with none (skew_window), so
    // expected = 4 + 3 + 1 = 8.
    const readout = coverageOf([
      { slug: "verify_signature", kind: "contract-method", coversCount: 4 },
      { slug: "refresh_keys", kind: "contract-method", coversCount: 3 },
      { slug: "skew_window", kind: "contract-method", coversCount: 0 },
    ]);
    expect(readout.present).toBe(7);
    expect(readout.expected).toBe(8);
    expect(readout.uncovered).toEqual(["skew_window"]);
  });

  it("draws the wireframe's exact body sentence for the fixture's own numbers", () => {
    const readout = coverageOf([
      { slug: "verify_signature", kind: "contract-method", coversCount: 4 },
      { slug: "refresh_keys", kind: "contract-method", coversCount: 3 },
      { slug: "skew_window", kind: "contract-method", coversCount: 0 },
    ]);
    expect(coverageBody(readout)).toBe(
      "7 of 8 covers edges present. skew_window has none — the number line coverage never reports.",
    );
  });

  it("draws no uncovered clause when every method has at least 1 covers edge", () => {
    const readout = coverageOf([{ slug: "a", kind: "contract-method", coversCount: 2 }]);
    expect(coverageBody(readout)).toBe("2 of 2 covers edges present.");
  });

  it("computes the frame's own moduleReadouts from the live document", async () => {
    const frame = await moduleFrame();
    expect(frame.moduleReadouts?.coverage).toEqual({
      heading: "COVERAGE OF DESIGN",
      body: "7 of 8 covers edges present. skew_window has none — the number line coverage never reports.",
    });
  });

  it("is null on every tier but the Module Schematic", async () => {
    const seam = createMemorySeam();
    const doc = buildDoc(await seam.loadGraph(), null, MODULE_CONFIG);
    // A doc built from the service-tier fixture under MODULE_CONFIG holds no
    // contract-method nodes at all, so the readout is null rather than a
    // 0-of-0 reading nobody asked for.
    const frame = buildFrame({
      doc,
      config: MODULE_CONFIG,
      viewport: { x: -4000, y: -4000, zoom: 1 },
      size: { width: 12000, height: 12000 },
      selection: new Set(),
    });
    expect(frame.moduleReadouts).toBeNull();
  });
});

describe("the SATISFIES callout", () => {
  it("draws PRD §11.1's exact wording", () => {
    expect(SATISFIES_CALLOUT).toEqual({
      heading: "SATISFIES",
      body: "A dep can satisfy a budget. Edge types at tier 3 are closed: covers, satisfies, documents.",
    });
  });

  it("is the same object the frame draws beside the coverage readout", async () => {
    const frame = await moduleFrame();
    expect(frame.moduleReadouts?.satisfies).toBe(SATISFIES_CALLOUT);
  });
});

describe("facet card content", () => {
  it("draws a contract-method's signature, return, and matched-covers line", () => {
    expect(
      facetContentFor({
        slug: "verify_signature",
        kind: "contract-method",
        signature: "(token: string, jwks: KeySet)",
        returns: "Result<Claims, VerifyError>",
        coversCount: 4,
      }),
    ).toEqual([
      "(token: string, jwks: KeySet) → Result<Claims, VerifyError>",
      "✓ 4 covers · matched in code",
    ]);
  });

  it("draws the no-covers line for a method with 0 covers edges", () => {
    expect(
      facetContentFor({
        slug: "skew_window",
        kind: "contract-method",
        signature: "()",
        returns: "Duration",
        coversCount: 0,
      }),
    ).toEqual(["() → Duration", "▲ no covers edge from any test case"]);
  });

  it("draws a budget's threshold, probe, and value", () => {
    expect(
      facetContentFor({
        slug: "verify_p95",
        kind: "budget",
        budgetThresholdText: "< 3 ms",
        budgetProbe: "pnpm bench:verify",
        budgetValueText: "1.8 ms",
      }),
    ).toEqual(["verify_p95 < 3 ms", "probe: pnpm bench:verify", "1.8 ms"]);
  });

  it("draws a budget with no value as an em dash", () => {
    expect(facetContentFor({ slug: "cold_start_p95", kind: "budget" })).toEqual(["—"]);
  });

  it("draws a test-case's status word", () => {
    expect(facetContentFor({ slug: "t1", kind: "test-case", testStatus: "passing" })).toEqual([
      "passing",
    ]);
    expect(facetContentFor({ slug: "t2", kind: "test-case", testStatus: "failing" })).toEqual([
      "failing",
    ]);
  });

  it("draws a doc-block's audience and body", () => {
    expect(
      facetContentFor({
        slug: "doc-1",
        kind: "doc-block",
        docAudience: "agent",
        docBody: "Call verify_signature before any session lookup…",
      }),
    ).toEqual(["audience: agent", "Call verify_signature before any session lookup…"]);
  });

  it("draws an external-dep's pinned version and registry state", () => {
    expect(
      facetContentFor({
        slug: "jose",
        kind: "external-dep",
        depVersion: "5.2.4",
        depLicense: "MIT",
        depRegistryOk: true,
      }),
    ).toEqual(["jose@5.2.4", "MIT · registry ✓"]);
  });

  it("draws nothing for a module or a service", () => {
    expect(facetContentFor({ slug: "m", kind: "module" })).toEqual([]);
    expect(facetContentFor({ slug: "s", kind: "service" })).toEqual([]);
  });
});

describe("the module root", () => {
  it("cannot be deleted, on the real fixture", async () => {
    const seam = createMemorySeam();
    const graph = await seam.loadGraph("module", "token-verifier");
    const engine = new SchematicEngine(MODULE_CONFIG, buildDoc(graph, null, MODULE_CONFIG), seam);
    const root = engine.state.doc.nodes.find((node) => node.role === "schematic-root");
    expect(root?.slug).toBe("token-verifier");
    expect(engine.canDelete(root?.id ?? "")?.reason).toBe("Token Verifier cannot be deleted.");
    expect(engine.isPinned(root?.id ?? "")).toBe(true);
  });

  it("draws its own computed facet count and screen reference", async () => {
    const frame = await moduleFrame();
    const root = frame.nodes.find((node) => node.node.role === "schematic-root");
    expect(root?.counts).toContain("layer backend · 8 facets");
    expect(root?.counts).toContain("schematify://screen/login-form");
  });
});
