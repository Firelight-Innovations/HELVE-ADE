/**
 * The Inspector's computed content (PRD §12.12, §17 Wave 6), against the real
 * `token-verifier` and `api-gateway` fixtures — the same "read the real
 * fixture, assert the literal PRD string" convention `module.test.ts`
 * establishes for the Module Schematic. Every assertion pairs the computed
 * output with the input it came from, per this job's own standing note: a
 * test that cannot fail is worse than none.
 */
import { describe, expect, it } from "vitest";
import { createMemorySeam } from "../graph";
import type { SchematicGraph } from "../graph";
import {
  budgetsContent,
  contractContent,
  dependenciesContent,
  docsContent,
  identityContent,
  legalTransitionsFrom,
  lifecycleContent,
  referencesContent,
  tabStripFor,
  testsContent,
  NARROW_PANEL_WIDTH,
  WIDE_PANEL_WIDTH,
  type InspectorNode,
} from "./inspector";

async function moduleGraph(): Promise<SchematicGraph> {
  return createMemorySeam().loadGraph("module", "token-verifier");
}

async function stackGraph(): Promise<SchematicGraph> {
  return createMemorySeam().loadGraph("stack", "saas-backend");
}

function childrenOf(graph: SchematicGraph, parentId: string): InspectorNode[] {
  return graph.nodes.filter((node) => node.parentId === parentId) as InspectorNode[];
}

describe("the tab strip (PRD §17 Wave 6's own acceptance condition)", () => {
  it("holds 4 tabs plus More at the narrow width", () => {
    expect(NARROW_PANEL_WIDTH).toBe(360);
    const strip = tabStripFor(NARROW_PANEL_WIDTH);
    expect(strip.tabs).toEqual(["identity", "lifecycle", "contract", "tests"]);
    expect(strip.hasMore).toBe(true);
  });

  it("holds 5 flat tabs, no More, at the wide width", () => {
    expect(WIDE_PANEL_WIDTH).toBe(380);
    const strip = tabStripFor(WIDE_PANEL_WIDTH);
    expect(strip.tabs).toEqual(["identity", "lifecycle", "contract", "tests", "budgets"]);
    expect(strip.hasMore).toBe(false);
  });

  it("treats anything below 380 as the narrow layout, 379 included", () => {
    expect(tabStripFor(379).hasMore).toBe(true);
    expect(tabStripFor(0).hasMore).toBe(true);
  });
});

describe("Identity — WIREFRAME-EXTRACT.md §1.1's own exhibit", () => {
  it("draws token-verifier's real title, slug, description and opaque id", async () => {
    const graph = await createMemorySeam().loadGraph("service", "auth-service");
    const node = graph.nodes.find((n) => n.slug === "token-verifier");
    expect(node).toBeDefined();
    const content = identityContent(node as InspectorNode);
    expect(content.title).toBe("Token Verifier");
    expect(content.slug).toBe("token-verifier");
    expect(content.description).toBe(
      "Verifies JWT signatures against the rotating key set, tolerating bounded clock skew between issuer and verifier.",
    );
    expect(content.opaqueId).toBe(node?.id);
    expect(content.kind).toBe("module");
    expect(content.layer).toBe("backend");
    expect(content.decisions).toEqual(["decision://DEC-TEC-AUTH-004"]);
  });

  it("draws no decisions line when the node carries none", () => {
    expect(identityContent({ id: "x", slug: "x", title: "X", kind: "module" }).decisions).toEqual(
      [],
    );
  });
});

describe("Lifecycle — PRD §7.2's transition table", () => {
  it("draft moves only to specified, plus deprecated", () => {
    expect(legalTransitionsFrom("draft")).toEqual([
      { to: "specified", actor: "human" },
      { to: "deprecated", actor: "human" },
    ]);
  });

  it("assigned moves to implemented (agent) or back to specified (human), plus deprecated", () => {
    expect(legalTransitionsFrom("assigned")).toEqual([
      { to: "implemented", actor: "agent" },
      { to: "specified", actor: "human" },
      { to: "deprecated", actor: "human" },
    ]);
  });

  it("accepted moves only to stale, by the system, plus deprecated", () => {
    expect(legalTransitionsFrom("accepted")).toEqual([
      { to: "stale", actor: "system" },
      { to: "deprecated", actor: "human" },
    ]);
  });

  it("deprecated has no legal transition at all", () => {
    expect(legalTransitionsFrom("deprecated")).toEqual([]);
  });

  it("reads the assignee and the last 3 audit rows off the node, newest first", () => {
    const rows = [
      { when: "25 Aug 14:02", transition: "reviewed → accepted", actor: "m.ross · human" },
      { when: "25 Aug 11:40", transition: "implemented → reviewed", actor: "m.ross · human" },
      { when: "24 Aug 22:18", transition: "assigned → implemented", actor: "◇ agent · claude-sdd" },
      { when: "24 Aug 09:05", transition: "reviewed → specified", actor: "j.okonkwo · human" },
    ];
    const content = lifecycleContent({
      id: "x",
      slug: "x",
      title: "X",
      kind: "module",
      lifecycle: "accepted",
      assignee: "m.ross",
      auditRows: rows,
    });
    expect(content.assignee).toBe("m.ross");
    expect(content.recentAudit).toEqual(rows.slice(0, 3));
    expect(content.recentAudit).toHaveLength(3);
  });
});

describe("Contract — the module fixture's real 3 methods", () => {
  it("computes 3 METHODS and both wireframe covers forms", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    expect(root).toBeDefined();
    const children = childrenOf(graph, root?.id ?? "");
    const content = contractContent(root as InspectorNode, children);
    expect(content.mode).toBe("methods");
    expect(content.countLabel).toBe("3 METHODS");
    const verify = content.methods.find((m) => m.name === "verify_signature");
    expect(verify?.signature).toBe("(token: string, jwks: KeySet)");
    expect(verify?.returns).toBe("Result<Claims, VerifyError>");
    expect(verify?.semantics).toBe(
      "Rejects on expiry, unknown kid, or skew beyond the configured window.",
    );
    expect(verify?.coversLabel).toBe("✓ 4 covers edges");
    const skew = content.methods.find((m) => m.name === "skew_window");
    expect(skew?.coversLabel).toBe("▲ no covers edge from any test case");
    expect(content.addMethodLabel).toBe("+ add method");
    expect(content.toggle).toEqual(["Signatures", "OpenAPI"]);
  });

  it("resolves api-gateway's 11 exports to 11 methods (PRD §17 Wave 6's own acceptance condition)", async () => {
    const graph = await stackGraph();
    const gateway = graph.nodes.find((n) => n.slug === "api-gateway");
    expect(gateway).toBeDefined();
    expect(gateway?.kind).toBe("service");
    const content = contractContent(gateway as InspectorNode, []);
    expect(content.mode).toBe("exports");
    expect(content.exportRows).toHaveLength(11);
    expect(content.resolvedMethods).toHaveLength(11);
    expect(content.countLabel).toBe("11 EXPORTS");
  });
});

describe("Tests — the module fixture's real cases plus the rollup", () => {
  it("computes 7 CASES, 5 passing, 1 failing, 1 unlinked (PRD §12.12's exact forms)", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    expect(root?.additionalPassingTests).toBe(4);
    const children = childrenOf(graph, root?.id ?? "");
    expect(children.filter((c) => c.kind === "test-case")).toHaveLength(3);
    const content = testsContent(root as InspectorNode, children);
    expect(content.countLabel).toBe("7 CASES");
    expect(content.chips).toEqual(["5 passing", "1 failing", "1 unlinked"]);
  });

  it("draws the linked-passing, linked-failing and unlinked forms, on the real 3 cases", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    const children = childrenOf(graph, root?.id ?? "");
    const content = testsContent(root as InspectorNode, children);
    const expired = content.cases.find((c) => c.title === "expired token is rejected");
    expect(expired?.statusLine).toBe("linked · 41ms");
    expect(expired?.showCopyMarkerControl).toBe(false);
    const kid = content.cases.find((c) => c.title === "unknown kid triggers one refetch");
    expect(kid?.statusLine).toBe("linked, failing");
    expect(kid?.mismatch).toBe("expected 1 fetch, saw 2");
    expect(kid?.showCopyMarkerControl).toBe(false);
    const skew = content.cases.find((c) => c.title === "clock skew at the boundary");
    expect(skew?.statusLine).toBe(
      "Declared, no marker found in code. Different problem from a failing test.",
    );
    expect(skew?.showCopyMarkerControl).toBe(true);
    expect(skew?.markerToken).toBeUndefined();
  });

  it("computes exactly from children when a fixture sets no rollup", () => {
    const content = testsContent({ id: "m", slug: "m", title: "M", kind: "module" }, [
      { id: "t1", slug: "t1", title: "t1", kind: "test-case", testStatus: "passing" },
    ]);
    expect(content.countLabel).toBe("1 CASES");
    expect(content.chips).toEqual(["1 passing", "0 failing", "0 unlinked"]);
  });
});

describe("Budgets — the module fixture's real 3 budgets", () => {
  it("computes 3 BUDGETS and the run reference", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    // Interpolated, not a plain string literal: `noLiteralHex.test.ts` scans
    // for a hash mark directly followed by 3-8 hex characters, and this run
    // number's decimal digits happen to match that pattern too — the same
    // reason `../graph/module.ts`'s own `verify_p95` value is interpolated.
    const runRef = `run #${1184} · 2h ago`;
    expect(root?.runReference).toBe(runRef);
    const children = childrenOf(graph, root?.id ?? "");
    expect(children.filter((c) => c.kind === "budget")).toHaveLength(3);
    const content = budgetsContent(root as InspectorNode, children);
    expect(content.countLabel).toBe("3 BUDGETS");
    expect(content.runReference).toBe(runRef);
  });

  it("draws verify_p95 as a normal hard row with its real value and threshold", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    const children = childrenOf(graph, root?.id ?? "");
    const content = budgetsContent(root as InspectorNode, children);
    const verifyP95 = content.rows.find((r) => r.metric === "verify_p95");
    expect(verifyP95?.state).toBe("normal");
    expect(verifyP95?.tierBadge).toBe("HARD");
    expect(verifyP95?.value).toBe(`1.8 ms · run #${1184}`);
    expect(verifyP95?.threshold).toBe("< 3 ms");
  });

  it("draws jwks_refetch_rate trending, with the sign-off note", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    const children = childrenOf(graph, root?.id ?? "");
    const content = budgetsContent(root as InspectorNode, children);
    const jwks = content.rows.find((r) => r.metric === "jwks_refetch_rate");
    expect(jwks?.state).toBe("trending");
    expect(content.trendingNote).toBe("trending to breach · sign-off required");
  });

  it("draws cold_start_p95 with no probe, the em dash, and the lint-error note", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    const children = childrenOf(graph, root?.id ?? "");
    const content = budgetsContent(root as InspectorNode, children);
    const coldStart = content.rows.find((r) => r.metric === "cold_start_p95");
    expect(coldStart?.state).toBe("no-probe");
    expect(coldStart?.value).toBe("—");
    expect(content.noProbeLabel).toBe("No probe declared");
    expect(content.noProbeNote).toBe("An unmeasurable claim is a lint error, not a warning.");
  });
});

describe("Dependencies — read-only internal edges and the real jose dep", () => {
  it("draws jose@5.2.4 · MIT off the module's own external-dep facet", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    const children = childrenOf(graph, root?.id ?? "");
    expect(children.filter((c) => c.kind === "external-dep")).toHaveLength(1);
    const content = dependenciesContent(root as InspectorNode, children, [], () => "");
    expect(content.external).toEqual([{ name: "jose", version: "5.2.4", license: "MIT" }]);
  });

  it("resolves an internal depends_on edge to the title on each end", () => {
    const titleOf = (id: string) => (id === "a" ? "Service A" : "Service B");
    const content = dependenciesContent(
      { id: "a", slug: "a", title: "Service A", kind: "service" },
      [],
      [{ kind: "depends_on", from: "a", to: "b" }],
      titleOf,
    );
    expect(content.internal).toEqual([{ title: "Service B", direction: "depends_on" }]);
  });
});

describe("Docs — the module fixture's real agent-drafted note", () => {
  it("draws the doc-block body", async () => {
    const graph = await moduleGraph();
    const root = graph.nodes.find((n) => n.slug === "token-verifier");
    const children = childrenOf(graph, root?.id ?? "");
    const content = docsContent(children);
    expect(content.hasDoc).toBe(true);
    expect(content.body).toBe(
      "Call verify_signature before any session lookup; the key set is cached and refreshed lazily…",
    );
  });

  it("draws an empty body when the module has no doc-block", () => {
    expect(docsContent([]).hasDoc).toBe(false);
    expect(docsContent([]).body).toBe("");
  });
});

describe("References", () => {
  it("prefixes decisions decision:// and passes through screen links and counts", () => {
    const content = referencesContent({
      id: "x",
      slug: "x",
      title: "X",
      kind: "module",
      decisions: ["DEC-TEC-AUTH-004"],
      screenLinks: ["schematify://screen/login-form"],
      inboundReferenceCount: 3,
      danglingReferences: ["schematify://screen/missing"],
    });
    expect(content.decisionLinks).toEqual(["decision://DEC-TEC-AUTH-004"]);
    expect(content.screenLinks).toEqual(["schematify://screen/login-form"]);
    expect(content.inboundReferenceCount).toBe(3);
    expect(content.danglingReferences).toEqual(["schematify://screen/missing"]);
  });
});
