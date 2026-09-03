/**
 * The `saas-backend` Stack Schematic, hand-typed from PRD §16.1's "Stack tier"
 * table and WIREFRAME-EXTRACT.md §5. Standing in for `fixtures/saas-backend/`
 * until a real graph loader exists — same reasoning as `./fixture.ts`'s own
 * header comment.
 *
 * **`platform-core` is a real containment parent, not a cosmetic annotation
 * box.** PRD §16.1: "`platform-core` contains `auth-service` and
 * `session-service`" — they carry it as their actual `parentId`. It also
 * carries `kind: "group"`, the same string PRD §11.3 uses for the annotation
 * tier's cosmetic overlay, by vocabulary coincidence rather than shared
 * mechanism — `engine/layout.ts`'s `toGraph` is the one place that tells the
 * 2 apart (a group with real children is kept; an empty one is not).
 */
import type {
  ContractMethodSummary,
  ExportRow,
  GraphEdge,
  GraphNode,
  SchematicGraph,
  TechStackRow,
} from "./types";

/**
 * `api-gateway`'s authored export list and the methods it resolves to —
 * PRD §16.1's own table gives the counts (`11 exports`, `4 modules`) but not
 * the content; no Service Schematic fixture exists for this service the way
 * `./fixture.ts` exists for `auth-service`, so both the 4 module slugs and
 * the 11 method names/signatures below are this fixture's own invention,
 * `[P]`, recorded in the Wave 6 handoff. PRD §17 Wave 6's own acceptance
 * condition needs exactly this: "the Contract tab draws an OpenAPI view for
 * `api-gateway`, whose 11 exports resolve to 11 methods."
 */
const API_GATEWAY_EXPORTS: ExportRow[] = [
  { method: "route_request", moduleSlug: "gateway-router" },
  { method: "rewrite_path", moduleSlug: "gateway-router" },
  { method: "select_backend", moduleSlug: "gateway-router" },
  { method: "forward_token", moduleSlug: "gateway-auth-relay" },
  { method: "strip_internal_headers", moduleSlug: "gateway-auth-relay" },
  { method: "attach_trace_id", moduleSlug: "gateway-auth-relay" },
  { method: "check_quota", moduleSlug: "gateway-rate-guard" },
  { method: "record_hit", moduleSlug: "gateway-rate-guard" },
  { method: "reset_window", moduleSlug: "gateway-rate-guard" },
  { method: "liveness", moduleSlug: "gateway-health" },
  { method: "readiness", moduleSlug: "gateway-health" },
];

const API_GATEWAY_RESOLVED_METHODS: ContractMethodSummary[] = [
  { name: "route_request", signature: "(req: IncomingRequest)", returns: "RoutedRequest" },
  { name: "rewrite_path", signature: "(path: string)", returns: "string" },
  { name: "select_backend", signature: "(req: RoutedRequest)", returns: "Backend" },
  { name: "forward_token", signature: "(req: RoutedRequest)", returns: "RoutedRequest" },
  { name: "strip_internal_headers", signature: "(headers: Headers)", returns: "Headers" },
  { name: "attach_trace_id", signature: "(req: RoutedRequest)", returns: "RoutedRequest" },
  { name: "check_quota", signature: "(clientId: string)", returns: "QuotaState" },
  { name: "record_hit", signature: "(clientId: string)", returns: "void" },
  { name: "reset_window", signature: "(clientId: string)", returns: "void" },
  { name: "liveness", signature: "()", returns: "HealthState" },
  { name: "readiness", signature: "()", returns: "HealthState" },
];

// `ledger-store` nests inside `session-service` — a `service`-kind node with
// a `service`-kind parent, per the same PRD sentence above. Nothing in PRD
// §4.1 restricts containment to same-kind pairs; the wireframe's own Outline
// omits it (WIREFRAME-EXTRACT.md §8.2), and Resolution 10.2 rules to list it
// rather than to reshape where it sits.

/**
 * PRD §16.1's Stack tier table: 7 `service`-kind nodes and 1 `group`. The
 * wireframe's own drawn count ("6 services") is the corrected-by-computation
 * defect Resolution 10.2 rules on — `ledger-store` is the 7th, present on
 * canvas and in this table but missing from the wireframe's own Outline.
 * This fixture carries it as a real node from the start, so `countNodes`/the
 * Outline compute `7` without a special case.
 */
const nodes: GraphNode[] = [
  {
    id: "api-gateway",
    slug: "api-gateway",
    title: "API Gateway",
    kind: "service",
    layer: "edge",
    parentId: null,
    badge: "ENTRY",
    exportsCount: 11,
    modulesCount: 4,
    health: "passing",
    // PRD §17 Wave 6's Contract tab, service mode (PRD §12.12: "On a
    // service node, this tab edits the authored export list.").
    exports: API_GATEWAY_EXPORTS,
    resolvedMethods: API_GATEWAY_RESOLVED_METHODS,
  },
  {
    id: "platform-core",
    slug: "platform-core",
    title: "Platform Core",
    kind: "group",
    parentId: null,
  },
  {
    id: "auth-service",
    slug: "auth-service",
    title: "Auth Service",
    kind: "service",
    layer: "backend",
    lifecycle: "accepted",
    parentId: "platform-core",
    exportsCount: 4,
    modulesCount: 12,
    // PRD §12.8: a service node draws its worst-contained health in words
    // rather than its own state's caption. No module in this stand-in
    // fixture is itself `service`-kind (the service tier is its own
    // fixture, `./fixture.ts`), so `healthRollupFor` has nothing to roll up
    // from here — `health: "soft-fail"` reproduces the wireframe's drawn
    // words directly instead. `[P]`, recorded in the Wave 5 handoff.
    health: "soft-fail",
  },
  {
    id: "session-service",
    slug: "session-service",
    title: "Session Service",
    kind: "service",
    layer: "data",
    parentId: "platform-core",
    exportsCount: 2,
    modulesCount: 6,
    health: "passing",
  },
  {
    id: "billing-service",
    slug: "billing-service",
    title: "Billing Service",
    kind: "service",
    layer: "backend",
    parentId: null,
    exportsCount: 6,
    modulesCount: 9,
    health: "soft-fail",
  },
  {
    id: "notification-service",
    slug: "notification-service",
    title: "Notification Service",
    kind: "service",
    lifecycle: "draft",
    parentId: null,
    exportsCount: 0,
    health: "no-data",
  },
  {
    id: "ledger-store",
    slug: "ledger-store",
    title: "Ledger Store",
    kind: "service",
    layer: "data",
    parentId: "session-service",
    exportsCount: 3,
    schemasResolved: true,
    health: "passing",
  },
  {
    id: "event-bus",
    slug: "event-bus",
    title: "Event Bus",
    kind: "service",
    lifecycle: "accepted",
    parentId: null,
    sharedAtLca: true,
    dependentsCount: 4,
    health: "passing",
  },
];

/**
 * PRD §16.1: "Seven dependency edges join them," unenumerated. Built from the
 * prose per WIREFRAME-EXTRACT.md Resolution 10.2's own ruling on this exact
 * fixture — from PRD text, not from tracing the wireframe's SVG pixel
 * geometry. Every one of `event-bus`'s 4 dependents (PRD's own drawn
 * `4 dependents` badge) holds a `depends_on` edge to it, which is what PRD
 * §4.3 requires of a shared node's consumers; the remaining 3 join
 * `api-gateway` to the 3 services it fronts.
 */
const edges: GraphEdge[] = [
  { id: "se1", kind: "depends_on", from: "api-gateway", to: "auth-service" },
  { id: "se2", kind: "depends_on", from: "api-gateway", to: "session-service" },
  { id: "se3", kind: "depends_on", from: "api-gateway", to: "billing-service" },
  { id: "se4", kind: "depends_on", from: "auth-service", to: "event-bus" },
  { id: "se5", kind: "depends_on", from: "session-service", to: "event-bus" },
  { id: "se6", kind: "depends_on", from: "billing-service", to: "event-bus" },
  { id: "se7", kind: "depends_on", from: "notification-service", to: "event-bus" },
];

/** PRD §16.1's derived tech stack, assigned across the 7 services' modules. */
const techStack: TechStackRow[] = [
  { name: "jose", version: "5.2.4", license: "MIT", moduleCount: 6 },
  { name: "zod", version: "3.23.8", license: "MIT", moduleCount: 14 },
  { name: "argon2", version: "0.31", license: "Apache-2.0", moduleCount: 2 },
  { name: "postgres", version: "3.4", license: "Unlicense", moduleCount: 9 },
];

export const STACK_GRAPH: SchematicGraph = {
  tier: "stack",
  serviceSlug: "saas-backend",
  serviceTitle: "saas-backend",
  nodes,
  edges,
  techStack,
};
