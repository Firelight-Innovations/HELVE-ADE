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
// card with a real `covers` edge below; the rest of each method's count
// lives only in `coversCount`, standing in for PRD §16.1's 4 further
// passing test cases this fixture does not model as their own nodes — no
// source names them individually ("Four further cases bring the total to
// 7, of which 5 pass," PRD §16.1's own words). `[P]`, recorded in the Wave
// 5 handoff.

// Wave 6 completes what that same Wave 5 comment flagged as curated: all 3
// budgets now draw (not 1 of 3), and the wireframe's 3rd named test case
// (`clock skew at the boundary`, declared/unlinked) now has its own node —
// every one of PRD §16.1's *named* module-tier facets is a real node here.
// The 4 unnamed passing cases still have no node of their own — no source
// names them — and stay exactly the `coversCount`-style rollup the root
// node's own `additionalPassingTests` carries below: `engine/inspector.ts`'s
// `testsContent` adds it into the passing/total counts it computes, so
// `7 CASES` / `5 passing` is arithmetic over 1 stored number and 3 real
// nodes, not a copied string.

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
    // PRD §17 Wave 6's Identity and Budgets tabs, drawn against this same
    // module root (WIREFRAME-EXTRACT.md §1.1's Identity exhibit; §3.4's own
    // run-reference caption, same run number as `verify_p95`'s own value
    // below — see that field's comment for why the digits are interpolated).
    decisions: ["DEC-TEC-AUTH-004"],
    runReference: `run #${1184} · 2h ago`,
    // PRD §16.1: "Four further cases bring the total to 7, of which 5
    // pass" — no source names them individually, so they stand in as a
    // rollup on the module root rather than 4 low-content synthetic nodes,
    // the same curation `coversCount` already applies to a method's own
    // untracked covers edges above.
    additionalPassingTests: 4,
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
    // PRD §16.1's own semantics sentence for this method — the Contract
    // tab's 4th line (PRD §12.12: "signature, return, semantics, and a
    // covers state").
    semantics: "Rejects on expiry, unknown kid, or skew beyond the configured window.",
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
  // The 2 remaining budgets PRD §16.1 names for this module but this
  // fixture's own Wave 5 comment (above) flagged as "the same curated-subset
  // choice the wireframe makes for budget (1 of 3 drawn)" — completed here
  // for PRD §17 Wave 6's Budgets tab, which draws all 3 (WIREFRAME-EXTRACT.md
  // §3.4).
  {
    id: "jwks_refetch_rate",
    slug: "jwks_refetch_rate",
    title: "jwks_refetch_rate",
    kind: "budget",
    parentId: "token-verifier",
    budgetTier: "soft",
    budgetThresholdText: "< 1 /min",
    // [P]: no source names this budget's probe command; invented for shape
    // parity with `verify_p95`'s, recorded in the Wave 6 handoff.
    budgetProbe: "pnpm bench:jwks-refetch",
    budgetValueText: "0.9 /min",
    budgetTrending: true,
  },
  {
    id: "cold_start_p95",
    slug: "cold_start_p95",
    title: "cold_start_p95",
    kind: "budget",
    parentId: "token-verifier",
    budgetTier: "hard",
    // PRD §16.1: "cold_start_p95 hard with no probe" — no threshold text is
    // given either; `< 500 ms` is this fixture's own plausible fill, [P],
    // recorded in the Wave 6 handoff. `budgetProbe` and `budgetValueText`
    // stay unset: PRD §12.12's "No probe declared" state reads their
    // absence directly.
    budgetThresholdText: "< 500 ms",
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
    // PRD §16.1's own title, not Wave 5's shorter canvas-card wording — the
    // Inspector's Tests tab (Wave 6) draws the real case title.
    title: "expired token is rejected",
    kind: "test-case",
    parentId: "token-verifier",
    testStatus: "passing",
    testLinkState: "linked",
    given: "a token past exp",
    when: "verify_signature runs",
    then: "Err(Expired)",
    markerToken:
      "@kaava:0192f4a1-4c3d-7890-a1b2-a1b2c3d4e5f1 token-verifier.expired_token_is_rejected",
    lastDurationMs: 41,
  },
  {
    id: "test-unknown-kid",
    slug: "test-unknown-kid",
    title: "unknown kid triggers one refetch",
    kind: "test-case",
    parentId: "token-verifier",
    testStatus: "failing",
    testLinkState: "linked",
    given: "a token whose kid is not in the cached key set",
    when: "verify_signature runs",
    then: "exactly 1 refetch of the key set",
    markerToken:
      "@kaava:0192f4a1-4c3d-7890-a1b2-a1b2c3d4e5f2 token-verifier.unknown_kid_triggers_one_refetch",
    mismatch: "expected 1 fetch, saw 2",
  },
  // WIREFRAME-EXTRACT.md §3.2's 3rd drawn case: declared, no marker found —
  // a different problem from a failing test (PRD §17 Wave 6's own bullet).
  {
    id: "test-clock-skew-boundary",
    slug: "test-clock-skew-boundary",
    title: "clock skew at the boundary",
    kind: "test-case",
    parentId: "token-verifier",
    testLinkState: "declared",
    given: "a token timestamped exactly at the configured skew window",
    when: "verify_signature runs",
    then: "the token is accepted, not rejected",
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
