/**
 * The `saas-backend` Stack Schematic, hand-typed from PRD §16.1's "Stack tier"
 * table and WIREFRAME-EXTRACT.md §5. Standing in for `fixtures/saas-backend/`
 * until a real graph loader exists — same reasoning as `./fixture.ts`'s own
 * header comment, and the same gap Wave 3's handoff (assumption 10) and Wave
 * 4's handoff (assumption 0) already recorded for the service tier.
 *
 * **`platform-core` is a real containment parent, not a cosmetic annotation
 * box.** PRD §16.1 states plainly that "`platform-core` contains `auth-service`
 * and `session-service`" — `auth-service` and `session-service` carry it as
 * their actual `parentId`, the same as any other parent-child pair. That it
 * also carries `kind: "group"`, the same string PRD §11.3 names for the
 * annotation tier's cosmetic overlay boxes, is a vocabulary coincidence: the
 * 2 things share a kind because both are "a titled box things sit inside"
 * (PRD §12.4), not because they are the same mechanism. `engine/layout.ts`'s
 * `toGraph` is the one place that has to act on the difference, and its own
 * comment explains how it tells them apart (a group with real children is
 * kept; an empty one, like tier 2's `Token pipeline`, is not).
 *
 * **`ledger-store` nests inside `session-service`**, per the same PRD
 * sentence — a `service`-kind node with a `service`-kind parent. Odd on
 * first read, plainly stated by the source: nothing in PRD §4.1 restricts
 * containment to same-kind pairs, and the fixture is what WIREFRAME-EXTRACT.md
 * §8.2 already flags as the wireframe's own Outline omission (`ledger-store`
 * drawn on canvas but missing from the Outline tree) — Resolution 10.2's
 * ruling is to list it, not to reshape where it sits.
 */
import type { GraphEdge, GraphNode, SchematicGraph, TechStackRow } from "./types";

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
