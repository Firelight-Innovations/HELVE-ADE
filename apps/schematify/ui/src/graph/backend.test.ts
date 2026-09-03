/**
 * `createBackendSeam().loadGraph`'s tier/slug routing — the exact defect
 * this wave was opened to fix: `loadRealGraph` used to ignore both
 * parameters entirely and always return the `auth-service` Service
 * Schematic, so a Module-location Problems row's click-through opened an
 * empty canvas (`docs/overnight-jobs/overnight-2/handoffs/w7b-problems.md`
 * §6 item 3).
 *
 * `@openkaava/bridge` is mocked rather than imported for real — its root
 * export touches `window` at module load, which this file (plain Node, no
 * jsdom, same as every other test in this app) has none of. `./index.ts`
 * keeps `./backend.ts` out of its own static imports for the identical
 * reason; this file does the same thing a level lower, by faking the one
 * thing `backend.ts` actually calls.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
vi.mock("@openkaava/bridge", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
  KaavaRpcError: class KaavaRpcError extends Error {},
}));

// Import after the mock: `vi.mock` calls are hoisted above every import in
// this file by vitest's transform, so `./backend`'s own static
// `import { invoke } from "@openkaava/bridge"` resolves to the mock above,
// never the real bridge.
const { createBackendSeam } = await import("./backend");

function response(nodes: Record<string, unknown>[]) {
  return { graph: { nodes, edges: [] }, report: { clean: true } };
}

const AUTH_SERVICE = {
  id: "svc-auth",
  slug: "auth-service",
  kind: "service",
  title: "Auth Service",
  lifecycle: "accepted",
  parent: null,
};
const BILLING_SERVICE = {
  id: "svc-billing",
  slug: "billing-service",
  kind: "service",
  title: "Billing Service",
  lifecycle: "accepted",
  parent: null,
};
const TOKEN_VERIFIER = {
  id: "mod-verifier",
  slug: "token-verifier",
  kind: "module",
  title: "Token Verifier",
  lifecycle: "accepted",
  parent: "svc-auth",
};
const COLD_START_BUDGET = {
  id: "budget-cold-start",
  slug: "cold_start_p95",
  kind: "budget",
  title: "cold_start_p95",
  lifecycle: "accepted",
  parent: "mod-verifier",
  metric: "cold_start_p95",
  op: "<",
  value: 800,
  unit: "ms",
  tier: "hard",
};

beforeEach(() => {
  invokeMock.mockReset();
});

describe("createBackendSeam().loadGraph", () => {
  it("draws the requested service, not the hardcoded auth-service default", async () => {
    invokeMock.mockResolvedValue(response([BILLING_SERVICE]));
    const graph = await createBackendSeam().loadGraph("service", "billing-service");
    expect(graph.tier).toBe("service");
    expect(graph.serviceSlug).toBe("billing-service");
  });

  it("draws the requested module and the offending node inside it, not an empty Module Schematic", async () => {
    invokeMock.mockResolvedValue(response([AUTH_SERVICE, TOKEN_VERIFIER, COLD_START_BUDGET]));
    const graph = await createBackendSeam().loadGraph("module", "token-verifier");
    expect(graph.tier).toBe("module");
    expect(graph.serviceSlug).toBe("token-verifier");
    expect(graph.nodes.map((n) => n.slug)).toContain("cold_start_p95");
  });

  it("still defaults to the auth-service Service Schematic when called with no arguments", async () => {
    invokeMock.mockResolvedValue(response([AUTH_SERVICE]));
    const graph = await createBackendSeam().loadGraph();
    expect(graph.tier).toBe("service");
    expect(graph.serviceSlug).toBe("auth-service");
  });

  it("draws an honest empty graph for the stack tier, never a silently wrong service", async () => {
    const graph = await createBackendSeam().loadGraph("stack", "saas-backend");
    expect(graph.tier).toBe("stack");
    expect(graph.nodes).toHaveLength(0);
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
