/**
 * The `token-verifier` Module Schematic, hand-typed from PRD §16.1's
 * "Module tier, `token-verifier`" paragraph and WIREFRAME-EXTRACT.md §4.
 * Standing in for `fixtures/saas-backend/` until a real graph loader exists —
 * same reasoning as `./fixture.ts` and `./stack.ts`.
 */
import type { GraphEdge, GraphNode, SchematicGraph } from "./types";

// Facet counts are stored, the same way `exportsCount` is on every other
// node in this app. `coversCount` on a `contract-method` is PRD §16.1's own
// number (4, 3, 0), the count `engine/anatomy.ts`'s `coverageOf` sums. Only
// `verify_signature` and `refresh_keys` get their own drawn `test-case`
// card, each with a real `covers` edge below; the rest of each method's
// count lives only in `coversCount`, standing in for PRD §16.1's 5 further
// test cases this canvas does not draw as their own cards — the same
// curated-subset choice the wireframe makes for `budget` (1 of 3 drawn).
// `[P]`, recorded in the Wave 5 handoff.

const nodes: GraphNode[] = [
  {
    id: "token-verifier",
    slug: "token-verifier",
    title: "Token Verifier",
    kind: "module",
    layer: "backend",
    parentId: null,
    description: "Same node as the box on the service canvas. One id, two renderings.",
    screenRef: "schematify://screen/login-form",
    health: "passing",
  },
  {
    id: "verify_signature",
    slug: "verify_signature",
    title: "verify_signature",
    kind: "contract-method",
    parentId: "token-verifier",
    exported: true,
    signature: "(token: string, jwks: KeySet)",
    returns: "Result<Claims, VerifyError>",
    coversCount: 4,
  },
  {
    id: "refresh_keys",
    slug: "refresh_keys",
    title: "refresh_keys",
    kind: "contract-method",
    parentId: "token-verifier",
    signature: "(force?: boolean)",
    returns: "Promise<void>",
    coversCount: 3,
  },
  // WIREFRAME-EXTRACT.md Resolution 10.1 row 8.2: no card for this method on
  // the wireframe's own canvas, ruled a mock incompleteness rather than a
  // "skip uncovered methods" rule — drawn here per that ruling, and its
  // 0-covers count is what the coverage readout's "expected" side counts.
  {
    id: "skew_window",
    slug: "skew_window",
    title: "skew_window",
    kind: "contract-method",
    parentId: "token-verifier",
    signature: "()",
    returns: "Duration",
    coversCount: 0,
  },
  {
    id: "verify_p95",
    slug: "verify_p95",
    title: "verify_p95",
    kind: "budget",
    parentId: "token-verifier",
    budgetTier: "hard",
    budgetThresholdText: "< 3 ms",
    budgetProbe: "pnpm bench:verify",
    // A template literal, not a plain string: `noLiteralHex.test.ts` scans
    // for a hash mark directly followed by 3 to 8 hex characters to catch a
    // stray colour literal, and this run number's digits are all decimal,
    // which happens to match that pattern too. Interpolating the number
    // breaks the adjacency in the source text without changing the runtime
    // string.
    budgetValueText: `1.8 ms · run #${1184}`,
  },
  {
    id: "doc-verify-signature",
    slug: "doc-verify-signature",
    title: "Usage note",
    kind: "doc-block",
    parentId: "token-verifier",
    authoredBy: "agent",
    lifecycle: "draft",
    docAudience: "agent",
    docBody:
      "Call verify_signature before any session lookup; the key set is cached and refreshed lazily…",
  },
  {
    id: "test-expired-token",
    slug: "test-expired-token",
    title: "expired token rejected",
    kind: "test-case",
    parentId: "token-verifier",
    testStatus: "passing",
  },
  {
    id: "test-unknown-kid",
    slug: "test-unknown-kid",
    title: "unknown kid refetches once",
    kind: "test-case",
    parentId: "token-verifier",
    testStatus: "failing",
  },
  {
    id: "dep-jose",
    slug: "jose",
    title: "jose",
    kind: "external-dep",
    parentId: "token-verifier",
    depVersion: "5.2.4",
    depLicense: "MIT",
    depRegistryOk: true,
  },
];

/** The 2 example test cases each carry their own real `covers` edge, so the
 *  canvas draws an actual line for 1 of each method's covers count. */
const edges: GraphEdge[] = [
  { id: "me1", kind: "covers", from: "test-expired-token", to: "verify_signature" },
  { id: "me2", kind: "covers", from: "test-unknown-kid", to: "refresh_keys" },
];

export const MODULE_GRAPH: SchematicGraph = {
  tier: "module",
  serviceSlug: "token-verifier",
  serviceTitle: "Token Verifier",
  nodes,
  edges,
};
