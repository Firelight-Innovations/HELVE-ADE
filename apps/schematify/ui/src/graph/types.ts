/**
 * The graph vocabulary this app's shell draws against — narrower than
 * `crates/schematify-core`'s eventual schemas (PRD §5), since this wave has
 * no Rust graph to mirror (`00-AGENT-CONTEXT.md` forbids importing or
 * creating that crate). Restated by hand, the way `apps/files/ui/src/rpc.ts`
 * restates its Rust counterpart. See `./index.ts` for the module a later
 * wave replaces once a real loader exists.
 */

/** The 3 tiers a Schematic can draw. Wave 5 builds all 3. */
export type Tier = "stack" | "service" | "module";

/** A node's containment kind. Widened by Wave 5 to match `engine/config.ts`'s
 *  `SchematicNodeKind`: the Module Schematic's 5 facet kinds (PRD §12.11) and
 *  the `screen` kind `references_ui` terminates at. `"group"` covers 2 things
 *  sharing 1 kind string — PRD §16.1's `platform-core` (a real containment
 *  parent) and PRD §11.3's cosmetic annotation overlay — told apart by
 *  `engine/layout.ts`'s `toGraph`, not by kind alone. */
export type NodeKind =
  | "service"
  | "group"
  | "module"
  | "screen"
  | "contract-method"
  | "test-case"
  | "budget"
  | "doc-block"
  | "external-dep"
  | "comment";

/** The `NodeKind` values PRD §11.3 puts in the annotation tier: drawn, per
 *  `../engine/config.ts`'s own `ANNOTATION_KINDS` for the engine's wider
 *  vocabulary, but never counted as a node and never an edge endpoint (the
 *  owner's ruling on the wave 2 acceptance count — "it arranges and it
 *  annotates, it does not mean"). `"comment"` is not a member: this app's
 *  `NodeKind` has no member of that name at all, a separate gap the wiring
 *  handoff names rather than papers over here. */
export const ANNOTATION_NODE_KINDS: readonly NodeKind[] = ["group"];

/** Whether `kind` is annotation-tier — see `ANNOTATION_NODE_KINDS`. */
export function isAnnotationNodeKind(kind: NodeKind): boolean {
  return (ANNOTATION_NODE_KINDS as readonly string[]).includes(kind);
}

/** PRD §5's `layer` values. `frontend` and `external` are `[P]` (PRD §12.6),
 *  drawn by no wireframe — Wave 4's job, not this one. */
export type Layer = "edge" | "backend" | "data" | "frontend" | "external";

/** PRD §7's 8 lifecycle states (§12.7), each drawn with its own geometry by
 *  `engine/anatomy.ts`'s `LIFECYCLE_TREATMENTS` table (Wave 4). */
export type Lifecycle =
  | "draft"
  | "specified"
  | "assigned"
  | "implemented"
  | "reviewed"
  | "accepted"
  | "stale"
  | "deprecated";

/** The 2 Outline badge forms PRD §12.1 names. Canvas-only badges (§12.6)
 *  are Wave 3/4 scope and do not appear here. */
export type OutlineBadge = "ENTRY" | "STALE";

/** PRD §12.8's 4 health conditions, carried directly on the node rather than
 *  derived from per-facet test/budget results — this app's restated
 *  vocabulary (see this file's header comment) has no facet-level pass/fail
 *  data to derive from, the same simplification already made for
 *  `lifecycle` above. `[P]`, recorded in the Wave 4 handoff. */
export type HealthStatus = "passing" | "soft-fail" | "hard-fail" | "no-data";

/** PRD §12.6's facet-count row, tier 2 only. A field is omitted rather than
 *  zeroed when the wireframe draws no chip for it — JWKS Cache draws
 *  `⬤ 2 meth ⬤ 6 test` with no `budg` chip at all, not `⬤ 0 budg`. */
export interface FacetCounts {
  methods?: number;
  tests?: number;
  budgets?: number;
}

/** One node in a Schematic's containment tree. `parentId: null` sits directly
 *  under the Schematic's own root, named by `SchematicGraph.serviceSlug`
 *  regardless of tier — see that field's own comment. */
export interface GraphNode {
  id: string;
  slug: string;
  title: string;
  kind: NodeKind;
  layer?: Layer;
  lifecycle?: Lifecycle;
  parentId: string | null;
  /** At most 1, per PRD §12.1's closed 2-value set. */
  badge?: OutlineBadge;
  /** Starts the Outline row collapsed (`▸`, trailing child count, no child
   *  rows) rather than expanded (`▾`, children drawn in full). */
  collapsed?: boolean;

  // --- PRD §12.6 node anatomy (Wave 4) --------------------------------------

  /** Clamped to 2 lines on the node face. */
  description?: string;
  /** PRD §5.1's `authored_by` — drives `◇ AGENT DRAFT` and its caption. */
  authoredBy?: "human" | "agent";
  /** The facet-count row's 3 chips, tier 2 only. */
  facets?: FacetCounts;
  /** `allowed_libraries`, resolved to display names: `▸ jose  ▸ zod`. */
  libraries?: readonly string[];
  /** PRD §12.8. `undefined` reads as `"passing"` — no wedge. */
  health?: HealthStatus;
  /** PRD §5.3's `exports`, already counted — draws `N exports`. */
  exportsCount?: number;
  /** A Stack-tier service's module count — draws `N modules`. Wave 5. */
  modulesCount?: number;
  /** PRD §4.3: pairs with `sharedAtLca` for `N dependents`. */
  dependentsCount?: number;
  /** True at a node PRD §4.3 places at its dependents' LCA. */
  sharedAtLca?: boolean;
  /** PRD §5.3's `schemas`, resolved: draws `schemas ✓`. */
  schemasResolved?: boolean;
  /** `deprecated` only: draws `thisSlug → successorSlug`. */
  deprecatedSuccessor?: string;
  /** `stale` only: PRD §7.4's second caption line. */
  staleReason?: string;
  /** A `contract-method` facet's `exported` (PRD §5.5) — draws `EXPORTED`. */
  exported?: boolean;
  /** A `budget` facet's `tier` (PRD §5.5) — draws `HARD` or `SOFT`. */
  budgetTier?: "hard" | "soft";

  // --- PRD §12.11 facet content (Wave 5), tier 3 only -----------------------

  /** `contract-method`: the parameter list, e.g. `(token: string, jwks: KeySet)`. */
  signature?: string;
  /** `contract-method`: the return type, e.g. `Result<Claims, VerifyError>`. */
  returns?: string;
  /** `budget`: the threshold text, e.g. `< 3 ms`. */
  budgetThresholdText?: string;
  /** `budget`: the probe command, e.g. `pnpm bench:verify`. */
  budgetProbe?: string;
  /** `budget`: the latest measured value, e.g. `1.8 ms` plus a run reference.
   *  `undefined` draws `—` (PRD §12.12: "A budget with no value draws `—`."). */
  budgetValueText?: string;
  /** `test-case`: the status word PRD §12.11 draws on a Module Schematic card. */
  testStatus?: "passing" | "failing";
  /** `doc-block`: PRD §12.11's `audience: agent` line. */
  docAudience?: string;
  /** `doc-block`: the drafted body text. */
  docBody?: string;
  /** `external-dep`: the pinned version, e.g. `5.2.4` (draws `jose@5.2.4`). */
  depVersion?: string;
  /** `external-dep`: the license name, e.g. `MIT`. */
  depLicense?: string;
  /** `external-dep`: whether the registry resolved it — draws `registry ✓`. */
  depRegistryOk?: boolean;
  /** A module root only: PRD §12.5's tier-3 screen-reference path,
   *  `schematify://screen/<slug>`. */
  screenRef?: string;

  // --- PRD §12.12 Inspector content (Wave 6) --------------------------------

  /** PRD §5.1's `decisions`, resolved to slugs (PRD §3.3) — Identity and
   *  References prefix each `decision://`. */
  decisions?: readonly string[];
  /** A module facet's parent only: the Budgets tab's run reference, e.g.
   *  `run #<N> · <age>`. */
  runReference?: string;
  /** The Lifecycle tab's assignee, and the field `Assign` writes. */
  assignee?: string;
  /** The Lifecycle tab's last-3 audit rows, newest first. */
  auditRows?: readonly LifecycleAuditRow[];

  /** `test-case`: the 3 given/when/then lines. */
  given?: string;
  when?: string;
  then?: string;
  /** `test-case`: PRD §9.1's marker token. */
  markerToken?: string;
  /** `test-case`: `"declared"` is the unlinked state; `"linked"` pairs with
   *  `testStatus` for the passing/failing forms. */
  testLinkState?: "declared" | "linked";
  /** `test-case`, linked and passing only: last duration in ms. */
  lastDurationMs?: number;
  /** `test-case`, linked and failing only: the mismatch text. */
  mismatch?: string;

  /** `contract-method`: the semantics sentence. */
  semantics?: string;

  /** `budget`: set once a human signs off a trending soft budget;
   *  `undefined` draws the sign-off control. */
  budgetSignOff?: string;
  /** `budget`, soft tier only: near its threshold. A stored curation flag —
   *  no source gives this app a time series to derive a trend from. */
  budgetTrending?: boolean;

  /** A `service`-kind node only (stack tier): the authored export list the
   *  Contract tab edits (PRD §12.12). Distinct from `SchematicGraph.exports`
   *  (the service tier's own export strip, PRD §12.10) — this lives on the
   *  service node itself, one level up. */
  exports?: readonly ExportRow[];
  /** A `service`-kind node only: the method blocks `exports` resolves to,
   *  for the Contract tab's OpenAPI toggle. */
  resolvedMethods?: readonly ContractMethodSummary[];

  /** References tab: screen links, inbound reference count, and dangling
   *  marks (decision links come off `decisions` above). */
  screenLinks?: readonly string[];
  inboundReferenceCount?: number;
  danglingReferences?: readonly string[];
}

/** One row of the Lifecycle tab's audit log (PRD §12.12, §7.2), e.g.
 *  `25 Aug 14:02 · reviewed → accepted · m.ross · human`. */
export interface LifecycleAuditRow {
  when: string;
  transition: string;
  actor: string;
}

/** One resolved method block behind a service's export list (PRD §12.12's
 *  Contract tab, OpenAPI mode) — a restatement of `GraphNode`'s own
 *  `signature`/`returns`/`semantics`, for a method not projected as a real
 *  facet node. */
export interface ContractMethodSummary {
  name: string;
  signature: string;
  returns: string;
  semantics?: string;
}

/** One row of the Dependencies tab's external-library list (PRD §12.12),
 *  e.g. `jose 5.2.4 · MIT`. */
export interface LibraryDetail {
  name: string;
  version: string;
  license: string;
}

/** One typed edge. `contains` is deliberately absent — containment is
 *  `GraphNode.parentId`, never an edge (PRD §4.1); tier 3's drawn containment
 *  arrow is synthesised at draw time (`engine/frame.ts`) and is never one of
 *  these. Tiers 1-2 use the first 3 kinds; tier 3 uses the last 3. */
export interface GraphEdge {
  id: string;
  kind: "depends_on" | "implements" | "references_ui" | "covers" | "satisfies" | "documents";
  from: string;
  to: string;
}

/** One row of the Service Schematic's export strip (PRD §12.10): an authored
 *  method and the module that owns it. */
export interface ExportRow {
  method: string;
  moduleSlug: string;
}

/** One row of the Stack Schematic's derived tech stack (PRD §12.9). */
export interface TechStackRow {
  name: string;
  version: string;
  license: string;
  moduleCount: number;
}

/**
 * One open Schematic's whole graph, at any of the 3 tiers. `serviceSlug`/
 * `serviceTitle` name the Schematic's own root regardless of tier — kept
 * under their original names rather than renamed, since every existing
 * caller reads them that way. `[P]`, recorded in the Wave 5 handoff.
 */
export interface SchematicGraph {
  tier: Tier;
  serviceSlug: string;
  serviceTitle: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Service tier only (PRD §12.10). */
  exports?: readonly ExportRow[];
  /** Stack tier only (PRD §12.9). */
  techStack?: readonly TechStackRow[];
}

/** @deprecated Use `SchematicGraph` — kept so a caller that only ever meant
 *  the service tier still reads naturally. Wave 5 widened the type this
 *  alias points at; nothing about the alias itself changed. */
export type ServiceGraph = SchematicGraph;
