/**
 * The `auth-service` Service Schematic, hand-typed from PRD §16.1 and
 * WIREFRAME-EXTRACT.md §1.1, standing in for `fixtures/saas-backend/` until a
 * real graph loader exists. See `./index.ts`'s doc comment for what replaces
 * this file and how.
 */
import type { GraphEdge, GraphNode, ServiceGraph } from "./types";

/**
 * PRD §16.1 "Service tier, `auth-service`" table: 12 module nodes,
 * containment depth 3. `token-verifier` draws expanded in the Outline (its
 * children `jwks-cache` and `clock-skew` get their own rows,
 * WIREFRAME-EXTRACT.md §1.1); `session-store` draws collapsed with a
 * trailing count of 2, so its children `session-codec` and `session-index`
 * are present in the graph but draw no Outline row of their own this wave.
 */
const nodes: GraphNode[] = [
  {
    id: "http-entry",
    slug: "http-entry",
    title: "HTTP Entry",
    kind: "module",
    parentId: null,
    badge: "ENTRY",
  },
  {
    id: "token-issuer",
    slug: "token-issuer",
    title: "Token Issuer",
    kind: "module",
    parentId: null,
  },
  {
    id: "token-verifier",
    slug: "token-verifier",
    title: "Token Verifier",
    kind: "module",
    parentId: null,
  },
  {
    id: "jwks-cache",
    slug: "jwks-cache",
    title: "JWKS Cache",
    kind: "module",
    parentId: "token-verifier",
  },
  {
    id: "clock-skew",
    slug: "clock-skew",
    title: "Clock Skew",
    kind: "module",
    parentId: "token-verifier",
    lifecycle: "draft",
  },
  {
    id: "session-store",
    slug: "session-store",
    title: "Session Store",
    kind: "module",
    parentId: null,
    collapsed: true,
  },
  {
    id: "session-codec",
    slug: "session-codec",
    title: "Session Codec",
    kind: "module",
    parentId: "session-store",
  },
  {
    id: "session-index",
    slug: "session-index",
    title: "Session Index",
    kind: "module",
    parentId: "session-store",
  },
  {
    id: "crypto-primitives",
    slug: "crypto-primitives",
    title: "Crypto Primitives",
    kind: "module",
    parentId: null,
    lifecycle: "accepted",
  },
  {
    id: "password-hasher",
    slug: "password-hasher",
    title: "Password Hasher",
    kind: "module",
    parentId: null,
    lifecycle: "reviewed",
  },
  {
    id: "rate-limiter",
    slug: "rate-limiter",
    title: "Rate Limiter",
    kind: "module",
    parentId: null,
    lifecycle: "assigned",
  },
  {
    id: "audit-emitter",
    slug: "audit-emitter",
    title: "Audit Emitter",
    kind: "module",
    parentId: null,
    lifecycle: "stale",
    badge: "STALE",
  },
];

/**
 * PRD §16.1 states "9 dependency edges" for this tier but does not enumerate
 * them (only 1 is named directly, the `session-codec → token-issuer → …`
 * cycle in the Problems table). The 9 below are this module's own
 * construction — plausible `depends_on` relations among the 12 named nodes
 * that reproduce that one named edge. Topology is not asserted by any
 * acceptance condition this wave, only the count; a real loader replaces
 * this choice with whatever `fixtures/saas-backend/` actually encodes.
 */
const edges: GraphEdge[] = [
  { id: "e1", kind: "depends_on", from: "http-entry", to: "token-issuer" },
  { id: "e2", kind: "depends_on", from: "http-entry", to: "token-verifier" },
  { id: "e3", kind: "depends_on", from: "token-issuer", to: "crypto-primitives" },
  { id: "e4", kind: "depends_on", from: "token-verifier", to: "crypto-primitives" },
  { id: "e5", kind: "depends_on", from: "password-hasher", to: "crypto-primitives" },
  { id: "e6", kind: "depends_on", from: "rate-limiter", to: "token-verifier" },
  { id: "e7", kind: "depends_on", from: "audit-emitter", to: "crypto-primitives" },
  // The one edge PRD §16.1's Problems table names directly, part of the
  // `session-codec → token-issuer → …` cycle finding (Wave 7 builds the
  // linter that reports it; this wave only carries the edge).
  { id: "e8", kind: "depends_on", from: "session-codec", to: "token-issuer" },
  { id: "e9", kind: "depends_on", from: "token-issuer", to: "session-store" },
];

export const AUTH_SERVICE_GRAPH: ServiceGraph = {
  tier: "service",
  serviceSlug: "auth-service",
  serviceTitle: "Auth Service",
  nodes,
  edges,
};
