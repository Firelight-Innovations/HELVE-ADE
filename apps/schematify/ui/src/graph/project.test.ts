/**
 * `projectServiceGraph` is the one place the real, whole-project graph
 * (`schematify/load-graph`'s response) and this app's narrower `ServiceGraph`
 * meet. These assertions read the written content — the actual nodes, edges,
 * and their fields — rather than only checking that the function did not
 * throw, per STANDARDS.md §8's rule that an assertion which cannot fail is
 * worse than none.
 */
import { describe, expect, it, vi } from "vitest";
import { coversCountFor } from "../engine/anatomy";
import { countNodes } from "./index";
import { projectModuleGraph, projectServiceGraph, type RawGraph, type RawNode } from "./project";

function node(partial: Partial<RawNode> & Pick<RawNode, "id" | "slug" | "kind">): RawNode {
  return {
    title: partial.slug,
    lifecycle: "accepted",
    parent: null,
    ...partial,
  };
}

const RAW: RawGraph = {
  nodes: [
    node({ id: "svc", slug: "auth-service", kind: "service", title: "Auth Service" }),
    node({ id: "m1", slug: "http-entry", kind: "module", title: "HTTP Entry", parent: "svc" }),
    node({
      id: "m2",
      slug: "token-verifier",
      kind: "module",
      title: "Token Verifier",
      parent: "svc",
    }),
    node({
      id: "m3",
      slug: "jwks-cache",
      kind: "module",
      title: "JWKS Cache",
      parent: "m2",
      layer: "backend",
    }),
    node({
      id: "m4",
      slug: "audit-emitter",
      kind: "module",
      title: "Audit Emitter",
      parent: "svc",
      lifecycle: "stale",
    }),
    node({ id: "g1", slug: "core", kind: "group", title: "Core", parent: "svc" }),
    // A different service entirely, and a module inside it — neither should
    // ever appear in `auth-service`'s projection.
    node({ id: "svc2", slug: "billing-service", kind: "service", title: "Billing Service" }),
    node({ id: "n1", slug: "invoicer", kind: "module", title: "Invoicer", parent: "svc2" }),
    // A module's tier-3 facets. The Module Schematic draws these, not the
    // Service one — dropped entirely, not collapsed to "module" (that
    // collapse was tried first and inflated a 12-module real service into
    // 70 nodes on contact with `fixtures/saas-backend/`; see the wiring
    // handoff).
    node({ id: "f1", slug: "verify", kind: "contract-method", title: "verify", parent: "m2" }),
    node({ id: "f2", slug: "verify-case-1", kind: "test-case", title: "Case 1", parent: "m2" }),
    node({ id: "f3", slug: "verify-p95", kind: "budget", title: "verify_p95", parent: "m2" }),
    // An annotation this app's `NodeKind` has no member for at all.
    node({ id: "c1", slug: "watch-out", kind: "comment", title: "Watch out", parent: "svc" }),
  ],
  edges: [
    { id: "e1", kind: "depends_on", source: "m1", target: "m2" },
    { id: "e2", kind: "depends_on", source: "m1", target: "svc2" }, // crosses services — dropped
    { id: "e3", kind: "contains", source: "svc", target: "m1" }, // never a GraphEdge
    { id: "e4", kind: "implements", source: "m4", target: "m2" },
    { id: "e5", kind: "depends_on", source: "n1", target: "svc2" }, // wrong service entirely
    { id: "e6", kind: "depends_on", source: "m1", target: "g1" }, // a group is drawn, never an edge endpoint
  ],
};

describe("projectServiceGraph", () => {
  const graph = projectServiceGraph(RAW, "auth-service");

  it("names the service by its slug and title", () => {
    expect(graph.serviceSlug).toBe("auth-service");
    expect(graph.serviceTitle).toBe("Auth Service");
    expect(graph.tier).toBe("service");
  });

  it("includes auth-service's own modules and its group, not billing-service's", () => {
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["g1", "m1", "m2", "m3", "m4"].sort());
  });

  it("drops every tier-3 facet under a module — the Module Schematic's content, not the Service one's", () => {
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).not.toContain("f1");
    expect(ids).not.toContain("f2");
    expect(ids).not.toContain("f3");
  });

  it("drops a comment — an annotation this app's NodeKind cannot represent", () => {
    expect(graph.nodes.map((n) => n.id)).not.toContain("c1");
  });

  it("draws a group as a node, but see index.test.ts / index.ts for why it is not counted", () => {
    // Per the owner's ruling: drawn and counted are different questions. A
    // group is annotation-tier (PRD §11.3) and is excluded from
    // `countNodes` (`./index.ts`), not from this projection — it is a real
    // containment box the Service Schematic draws.
    expect(graph.nodes.map((n) => n.id)).toContain("g1");
    expect(graph.nodes.find((n) => n.id === "g1")?.kind).toBe("group");
  });

  it("maps a top-level module's parent to null, matching the fixture convention", () => {
    const httpEntry = graph.nodes.find((n) => n.id === "m1");
    expect(httpEntry?.parentId).toBeNull();
  });

  it("keeps a nested node's real parent id", () => {
    const jwksCache = graph.nodes.find((n) => n.id === "m3");
    expect(jwksCache?.parentId).toBe("m2");
  });

  it("keeps the module kind as-is", () => {
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    expect(byId.get("m1")?.kind).toBe("module");
  });

  it("carries layer through when the raw node has one", () => {
    expect(graph.nodes.find((n) => n.id === "m3")?.layer).toBe("backend");
  });

  it("badges a stale node STALE and nothing else", () => {
    const badged = graph.nodes.filter((n) => n.badge !== undefined);
    expect(badged.map((n) => n.id)).toEqual(["m4"]);
    expect(badged[0].badge).toBe("STALE");
  });

  it("draws PRD §7.4's exact second caption line for a stale node with a stale mark", () => {
    const withStale: RawGraph = {
      nodes: [
        node({ id: "svc", slug: "auth-service", kind: "service", title: "Auth Service" }),
        node({
          id: "m2",
          slug: "crypto-primitives",
          kind: "module",
          title: "Crypto Primitives",
          parent: "svc",
        }),
        node({
          id: "m4",
          slug: "audit-emitter",
          kind: "module",
          title: "Audit Emitter",
          parent: "svc",
          lifecycle: "stale",
          stale: { source: "m2", member: "sign", at: "2026-08-25T12:00:00Z" },
        }),
      ],
      edges: [],
    };
    const now = Date.parse("2026-08-25T14:00:00Z");
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const result = projectServiceGraph(withStale, "auth-service");
      const auditEmitter = result.nodes.find((n) => n.id === "m4");
      expect(auditEmitter?.staleReason).toBe(
        "crypto-primitives.sign changed 2h ago. Re-review required.",
      );
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it("leaves staleReason undefined for a stale node with no stale mark yet", () => {
    // A node written `stale` before Wave 10 started setting the field, or
    // one the CI-facing loader quarantined the reference out of — either
    // way, no caption is better than a caption naming nothing.
    const noMark: RawGraph = {
      nodes: [
        node({ id: "svc", slug: "auth-service", kind: "service" }),
        node({
          id: "m4",
          slug: "audit-emitter",
          kind: "module",
          parent: "svc",
          lifecycle: "stale",
        }),
      ],
      edges: [],
    };
    const result = projectServiceGraph(noMark, "auth-service");
    expect(result.nodes.find((n) => n.id === "m4")?.staleReason).toBeUndefined();
  });

  it("keeps a depends_on edge whose ends are both in the subtree", () => {
    expect(graph.edges.some((e) => e.id === "e1")).toBe(true);
  });

  it("drops an edge that crosses into another service", () => {
    expect(graph.edges.some((e) => e.id === "e2")).toBe(false);
    expect(graph.edges.some((e) => e.id === "e5")).toBe(false);
  });

  it("drops a contains edge — containment is parentId, never an edge", () => {
    expect(graph.edges.some((e) => e.id === "e3")).toBe(false);
  });

  it("drops an edge naming a group as an endpoint, even though the group itself is drawn", () => {
    expect(graph.edges.some((e) => e.id === "e6")).toBe(false);
  });

  it("keeps an implements edge, renaming source/target to from/to", () => {
    const implementsEdge = graph.edges.find((e) => e.id === "e4");
    expect(implementsEdge).toEqual({ id: "e4", kind: "implements", from: "m4", to: "m2" });
  });

  it("throws when no service carries the requested slug", () => {
    expect(() => projectServiceGraph(RAW, "no-such-service")).toThrow(/no-such-service/);
  });

  it("draws 13 nodes but counts 12, against auth-service's real containment shape", () => {
    // `fixtures/saas-backend/`'s actual `auth-service` (real slugs, real
    // containment — see the wiring handoff's fixture comparison): 12
    // modules plus one real top-level group, `token-pipeline`. Drawn and
    // counted are different questions per the owner's ruling — this test is
    // what the ruling asked to be asserted against the real fixture's
    // shape, not just against a synthetic `g1`/`m1` stand-in above.
    const auth: RawGraph = {
      nodes: [
        node({ id: "svc", slug: "auth-service", kind: "service", title: "Auth Service" }),
        node({ id: "n1", slug: "http-entry", kind: "module", parent: "svc" }),
        node({ id: "n2", slug: "token-issuer", kind: "module", parent: "svc" }),
        node({ id: "n3", slug: "token-verifier", kind: "module", parent: "svc" }),
        node({ id: "n4", slug: "jwks-cache", kind: "module", parent: "n3" }),
        node({ id: "n5", slug: "clock-skew", kind: "module", parent: "n3" }),
        node({ id: "n6", slug: "session-store", kind: "module", parent: "svc" }),
        node({ id: "n7", slug: "session-codec", kind: "module", parent: "n6" }),
        node({ id: "n8", slug: "session-index", kind: "module", parent: "n6" }),
        node({ id: "n9", slug: "crypto-primitives", kind: "module", parent: "svc" }),
        node({ id: "n10", slug: "password-hasher", kind: "module", parent: "svc" }),
        node({ id: "n11", slug: "rate-limiter", kind: "module", parent: "svc" }),
        node({ id: "n12", slug: "audit-emitter", kind: "module", parent: "svc" }),
        node({ id: "n13", slug: "token-pipeline", kind: "group", parent: "svc" }),
      ],
      edges: [],
    };
    const result = projectServiceGraph(auth, "auth-service");
    expect(result.nodes).toHaveLength(13);
    expect(result.nodes.map((n) => n.slug)).toContain("token-pipeline");
    expect(countNodes(result)).toBe(12);
  });

  it("does not hang on a containment cycle that never reaches the service", () => {
    const cyclic: RawGraph = {
      nodes: [
        node({ id: "svc", slug: "auth-service", kind: "service" }),
        node({ id: "a", slug: "a", kind: "module", parent: "b" }),
        node({ id: "b", slug: "b", kind: "module", parent: "a" }),
      ],
      edges: [],
    };
    const result = projectServiceGraph(cyclic, "auth-service");
    expect(result.nodes).toHaveLength(0);
  });
});

/**
 * `projectModuleGraph` — the wave 7c counterpart of `projectServiceGraph`
 * above. Shaped after PRD §16.1's `token-verifier` module paragraph: a
 * `cold_start_p95` budget with no probe (the exact node an L03 Problems row's
 * click-through has to land on, per the wave 7b handoff's known gap) and a
 * `verify_signature` contract method with 2 live `covers` edges.
 */
describe("projectModuleGraph", () => {
  const RAW: RawGraph = {
    nodes: [
      node({ id: "svc", slug: "auth-service", kind: "service", title: "Auth Service" }),
      node({
        id: "mod",
        slug: "token-verifier",
        kind: "module",
        title: "Token Verifier",
        parent: "svc",
        layer: "backend",
        description: "Verifies JWT signatures against the rotating key set.",
        ui_refs: ["schematify://screen/login-form"],
      }),
      node({
        id: "verify",
        slug: "verify_signature",
        kind: "contract-method",
        title: "verify_signature",
        parent: "mod",
        signature: "(token: string, jwks: KeySet)",
        returns: "Result<Claims, VerifyError>",
        exported: true,
      }),
      node({
        id: "budget",
        slug: "cold_start_p95",
        kind: "budget",
        title: "cold_start_p95",
        parent: "mod",
        metric: "cold_start_p95",
        op: "<",
        value: 800,
        unit: "ms",
        tier: "hard",
      }),
      node({
        id: "test1",
        slug: "test-expired-token",
        kind: "test-case",
        title: "expired token is rejected",
        parent: "mod",
        status: "passing",
      }),
      node({
        id: "doc",
        slug: "doc-verify",
        kind: "doc-block",
        title: "Usage note",
        parent: "mod",
        audience: "agent",
        body: "Call verify_signature before any session lookup.",
      }),
      node({
        id: "dep",
        slug: "jose",
        kind: "external-dep",
        title: "jose",
        parent: "mod",
        registry_ref: "lib-jose",
      }),
      // A different module entirely — nothing here should leak in.
      node({ id: "mod2", slug: "token-issuer", kind: "module", parent: "svc" }),
      node({
        id: "other-method",
        slug: "mint",
        kind: "contract-method",
        title: "mint",
        parent: "mod2",
      }),
    ],
    edges: [
      { id: "e1", kind: "covers", source: "test1", target: "verify" },
      { id: "e2", kind: "covers", source: "test1", target: "verify" }, // 2nd case, same method
      { id: "e3", kind: "covers", source: "test1", target: "other-method" }, // wrong module — dropped
      { id: "e4", kind: "depends_on", source: "verify", target: "budget" }, // not a tier-3 kind — dropped
    ],
    libraries: { libraries: [{ id: "lib-jose", name: "jose", version: "5.2.4", license: "MIT" }] },
  };

  const graph = projectModuleGraph(RAW, "token-verifier");

  it("names the module by its slug and title, tier module", () => {
    expect(graph.serviceSlug).toBe("token-verifier");
    expect(graph.serviceTitle).toBe("Token Verifier");
    expect(graph.tier).toBe("module");
  });

  it("draws the module root as its own node, parentId null, unlike a service root", () => {
    const root = graph.nodes.find((n) => n.id === "mod");
    expect(root).toBeDefined();
    expect(root?.parentId).toBeNull();
    expect(root?.description).toBe("Verifies JWT signatures against the rotating key set.");
    expect(root?.screenRef).toBe("schematify://screen/login-form");
    expect(root?.layer).toBe("backend");
  });

  it("includes only token-verifier's own facets, not token-issuer's", () => {
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["budget", "doc", "mod", "test1", "verify", "dep"].sort());
  });

  it("keeps a facet's real parent id — the module's own, not null", () => {
    expect(graph.nodes.find((n) => n.id === "verify")?.parentId).toBe("mod");
  });

  it("draws a contract method's signature, returns, and exported flag — not a stored covers count", () => {
    const verify = graph.nodes.find((n) => n.id === "verify");
    expect(verify?.signature).toBe("(token: string, jwks: KeySet)");
    expect(verify?.returns).toBe("Result<Claims, VerifyError>");
    expect(verify?.exported).toBe(true);
    // Wave 6 removed GraphNode.coversCount as a PRD §0.4 breach — a caller
    // computes it from the real edges via coversCountFor, below, not from a
    // field this projection would otherwise be storing a 2nd time.
  });

  it("returns real covers edges a caller can compute coversCountFor from — 2 for this module, not the 3rd targeting a different module's facet", () => {
    const coversTargetingVerify = graph.edges.filter(
      (e) => e.kind === "covers" && e.to === "verify",
    );
    expect(coversTargetingVerify).toHaveLength(2);
    expect(coversCountFor("verify", graph.edges)).toBe(2);
  });

  it("draws a budget's tier, threshold text, and leaves budgetValueText undefined — no probe, PRD §16.1's exact node", () => {
    const budget = graph.nodes.find((n) => n.id === "budget");
    expect(budget?.budgetTier).toBe("hard");
    expect(budget?.budgetThresholdText).toBe("< 800 ms");
    expect(budget?.budgetProbe).toBeUndefined();
    expect(budget?.budgetValueText).toBeUndefined();
  });

  it("draws a test case's status", () => {
    expect(graph.nodes.find((n) => n.id === "test1")?.testStatus).toBe("passing");
  });

  it("draws a doc block's audience and body", () => {
    const doc = graph.nodes.find((n) => n.id === "doc");
    expect(doc?.docAudience).toBe("agent");
    expect(doc?.docBody).toBe("Call verify_signature before any session lookup.");
  });

  it("resolves an external dep's version and license off the library registry", () => {
    const dep = graph.nodes.find((n) => n.id === "dep");
    expect(dep?.depVersion).toBe("5.2.4");
    expect(dep?.depLicense).toBe("MIT");
    expect(dep?.depRegistryOk).toBe(true);
  });

  it("marks an external dep unresolved when its registry_ref names nothing in libraries", () => {
    const withUnresolvedDep: RawGraph = {
      nodes: [
        node({ id: "svc", slug: "auth-service", kind: "service" }),
        node({ id: "mod", slug: "token-verifier", kind: "module", parent: "svc" }),
        node({
          id: "dep",
          slug: "ghost",
          kind: "external-dep",
          parent: "mod",
          registry_ref: "no-such-library",
        }),
      ],
      edges: [],
    };
    const result = projectModuleGraph(withUnresolvedDep, "token-verifier");
    const dep = result.nodes.find((n) => n.id === "dep");
    expect(dep?.depRegistryOk).toBe(false);
    expect(dep?.depVersion).toBeUndefined();
  });

  it("keeps a covers edge between 2 included facets", () => {
    expect(graph.edges.filter((e) => e.kind === "covers")).toHaveLength(2);
  });

  it("drops a covers edge that reaches outside this module", () => {
    expect(graph.edges.some((e) => e.id === "e3")).toBe(false);
  });

  it("drops an edge kind tier 3 does not carry", () => {
    expect(graph.edges.some((e) => e.id === "e4")).toBe(false);
  });

  it("throws when no module carries the requested slug", () => {
    expect(() => projectModuleGraph(RAW, "no-such-module")).toThrow(/no-such-module/);
  });

  it("draws PRD §7.4's caption on a stale module root, the same as a stale service-tier module", () => {
    const withStale: RawGraph = {
      nodes: [
        node({ id: "svc", slug: "auth-service", kind: "service" }),
        node({ id: "dep-src", slug: "crypto-primitives", kind: "module", parent: "svc" }),
        node({
          id: "mod",
          slug: "audit-emitter",
          kind: "module",
          parent: "svc",
          lifecycle: "stale",
          stale: { source: "dep-src", member: "sign", at: "2026-08-25T12:00:00Z" },
        }),
      ],
      edges: [],
    };
    const now = Date.parse("2026-08-25T14:00:00Z");
    const dateNowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const result = projectModuleGraph(withStale, "audit-emitter");
      const root = result.nodes.find((n) => n.id === "mod");
      expect(root?.badge).toBe("STALE");
      expect(root?.staleReason).toBe("crypto-primitives.sign changed 2h ago. Re-review required.");
    } finally {
      dateNowSpy.mockRestore();
    }
  });
});
