/**
 * The Inspector's content, computed (PRD §12.12, §17 Wave 6) — every function
 * here is pure and takes plain data, following `anatomy.ts`'s own rule: no
 * function in this file touches the DOM, `InspectorShell.tsx` only maps what
 * is computed here onto markup, and a test exerts the computation directly
 * rather than a render. Every count a tab draws is computed here, from
 * whatever facet children the caller hands in, and never read off a stored
 * total (PRD §0.4).
 *
 * Every literal string quoted in PRD §12.12 is reproduced verbatim below, so
 * a test can compare literally — the same convention `anatomy.ts` states for
 * PRD §12.6/§12.7.
 */
import type {
  ContractMethodSummary,
  ExportRow,
  Lifecycle,
  LifecycleAuditRow,
  LibraryDetail,
} from "../graph";

/** The fields the functions below read. A structural subset of `GraphNode`,
 *  the same style `anatomy.ts`'s `AnatomyNode` narrows to — a unit test hands
 *  these functions a bare object without building a whole graph. */
export interface InspectorNode {
  id: string;
  slug: string;
  title: string;
  kind: string;
  description?: string;
  layer?: string;
  lifecycle?: Lifecycle;
  decisions?: readonly string[];
  assignee?: string;
  auditRows?: readonly LifecycleAuditRow[];
  runReference?: string;
  additionalPassingTests?: number;

  given?: string;
  when?: string;
  then?: string;
  markerToken?: string;
  testLinkState?: "declared" | "linked";
  testStatus?: "passing" | "failing";
  lastDurationMs?: number;
  mismatch?: string;

  signature?: string;
  returns?: string;
  semantics?: string;
  exported?: boolean;
  coversCount?: number;

  budgetTier?: "hard" | "soft";
  budgetThresholdText?: string;
  budgetProbe?: string;
  budgetValueText?: string;
  budgetSignOff?: string;
  budgetTrending?: boolean;

  exports?: readonly ExportRow[];
  resolvedMethods?: readonly ContractMethodSummary[];

  depVersion?: string;
  depLicense?: string;
  docBody?: string;

  screenLinks?: readonly string[];
  inboundReferenceCount?: number;
  danglingReferences?: readonly string[];
}

// --- the tab strip (PRD §12.12, §17 Wave 6's own acceptance condition) -----

/** Every real tab id — the 8 panels S-04 through S-11 name. `"more"` is not
 *  one of these: it is the narrow strip's overflow bucket, never a panel of
 *  its own. */
export type InspectorTabId =
  | "identity"
  | "lifecycle"
  | "contract"
  | "tests"
  | "budgets"
  | "dependencies"
  | "docs"
  | "references";

export const TAB_LABEL: Record<InspectorTabId, string> = {
  identity: "Identity",
  lifecycle: "Lifecycle",
  contract: "Contract",
  tests: "Tests",
  budgets: "Budgets",
  dependencies: "Dependencies",
  docs: "Docs",
  references: "References",
};

/** PRD §12.12: "The `More` tab holds `Budgets`, `Dependencies`, `Docs`, and
 *  `References`." Read in the narrow strip, below. */
export const MORE_TAB_IDS: readonly InspectorTabId[] = [
  "budgets",
  "dependencies",
  "docs",
  "references",
];

/** The width PRD §17 Wave 6's acceptance condition names for each layout. */
export const NARROW_PANEL_WIDTH = 360;
export const WIDE_PANEL_WIDTH = 380;

export interface TabStrip {
  /** The flat, always-visible tabs, in reading order. */
  tabs: InspectorTabId[];
  /** `true` below `WIDE_PANEL_WIDTH`: a `More` tab draws after `tabs`,
   *  holding `MORE_TAB_IDS`. `false` at `WIDE_PANEL_WIDTH` and above: every
   *  tab is flat and no `More` tab draws. */
  hasMore: boolean;
}

/**
 * PRD §12.12: "A tab moves out of `More` when the panel width passes 360 px,
 * and the panel holds 5 flat tabs at 380 px." One tab — `Budgets`, the one
 * WIREFRAME-EXTRACT.md §3's own 380px standalone exhibit draws flat — moves
 * out; `Dependencies`, `Docs` and `References` stay inside `More` below
 * `WIDE_PANEL_WIDTH` and are not reachable at `WIDE_PANEL_WIDTH`, per the
 * PRD sentence's own wording: "the panel holds 5 flat tabs," not "5 flat
 * tabs plus `More`." `[P]`, recorded in the Wave 6 handoff as the one gap a
 * human should weigh in on.
 */
export function tabStripFor(panelWidthPx: number): TabStrip {
  if (panelWidthPx >= WIDE_PANEL_WIDTH) {
    return { tabs: ["identity", "lifecycle", "contract", "tests", "budgets"], hasMore: false };
  }
  return { tabs: ["identity", "lifecycle", "contract", "tests"], hasMore: true };
}

// --- Identity (S-04) --------------------------------------------------------

export interface IdentityContent {
  title: string;
  slug: string;
  description?: string;
  /** The copy-on-click field (PRD §17 Wave 6: "and nowhere else"). */
  opaqueId: string;
  kind: string;
  layer?: string;
  /** Each already prefixed `decision://`, the drawn form (PRD §3.3). */
  decisions: string[];
}

export function identityContent(node: InspectorNode): IdentityContent {
  return {
    title: node.title,
    slug: node.slug,
    description: node.description,
    opaqueId: node.id,
    kind: node.kind,
    layer: node.layer,
    decisions: (node.decisions ?? []).map((slug) => `decision://${slug}`),
  };
}

// --- Lifecycle (S-05) --------------------------------------------------------

/** PRD §7.2's transition table, restated as a lookup. `any → deprecated` is
 *  appended to every non-`deprecated` state below rather than listed once,
 *  so a caller reads one state's full legal-transition set in one place. */
const TRANSITIONS: Record<Exclude<Lifecycle, "deprecated">, { to: Lifecycle; actor: string }[]> = {
  draft: [{ to: "specified", actor: "human" }],
  specified: [{ to: "assigned", actor: "human" }],
  assigned: [
    { to: "implemented", actor: "agent" },
    { to: "specified", actor: "human" },
  ],
  implemented: [
    { to: "reviewed", actor: "human" },
    { to: "specified", actor: "human" },
  ],
  reviewed: [
    { to: "accepted", actor: "human" },
    { to: "specified", actor: "human" },
  ],
  accepted: [{ to: "stale", actor: "system" }],
  stale: [
    { to: "accepted", actor: "human" },
    { to: "specified", actor: "human" },
  ],
};

export interface LifecycleTransition {
  to: Lifecycle;
  actor: string;
}

/** Every transition legal from `state` (PRD §7.2), `deprecated` included:
 *  "any → deprecated, human" applies to every state but `deprecated` itself,
 *  which has no legal transition at all — PRD §7.1 draws it as one of the 2
 *  states off the main path, with no arrow leaving it. */
export function legalTransitionsFrom(state: Lifecycle): LifecycleTransition[] {
  if (state === "deprecated") return [];
  return [...TRANSITIONS[state], { to: "deprecated", actor: "human" }];
}

export interface LifecycleContent {
  state: Lifecycle;
  transitions: LifecycleTransition[];
  assignee?: string;
  /** The 3 most recent rows, newest first (PRD §12.12: "the last 3 audit
   *  rows"). */
  recentAudit: LifecycleAuditRow[];
  auditLogLinkLabel: string;
}

export function lifecycleContent(node: InspectorNode): LifecycleContent {
  const state = node.lifecycle ?? "draft";
  return {
    state,
    transitions: legalTransitionsFrom(state),
    assignee: node.assignee,
    recentAudit: (node.auditRows ?? []).slice(0, 3),
    auditLogLinkLabel: "View full log",
  };
}

// --- Contract (S-06) ---------------------------------------------------------

export interface ContractMethodBlock {
  name: string;
  signature: string;
  returns: string;
  semantics?: string;
  exported: boolean;
  /** PRD §12.12's exact 2 forms: `✓ 4 covers edges` or `▲ no covers edge
   *  from any test case`. */
  coversLabel: string;
}

function coversLabelFor(coversCount: number | undefined): string {
  const count = coversCount ?? 0;
  return count > 0 ? `✓ ${count} covers edges` : "▲ no covers edge from any test case";
}

function methodBlock(method: InspectorNode): ContractMethodBlock {
  return {
    name: method.title,
    signature: method.signature ?? "()",
    returns: method.returns ?? "void",
    semantics: method.semantics,
    exported: method.exported ?? false,
    coversLabel: coversLabelFor(method.coversCount),
  };
}

export interface ContractContent {
  /** `"methods"` for a module (or any node whose children include
   *  `contract-method` facets): a block per method. `"exports"` for a
   *  `service`-kind node (PRD §12.12: "On a service node, this tab edits
   *  the authored export list."). */
  mode: "methods" | "exports";
  /** `3 METHODS`, always plural per the wireframe's own drawn form. */
  countLabel: string;
  toggle: readonly ["Signatures", "OpenAPI"];
  methods: ContractMethodBlock[];
  addMethodLabel: string;
  /** `exports` mode only: the authored list the export-list editor edits. */
  exportRows: readonly ExportRow[];
  /** `exports` mode only, OpenAPI toggle: the resolved method blocks the
   *  export list maps to (PRD §17 Wave 6's own acceptance condition). */
  resolvedMethods: ContractMethodBlock[];
}

export function contractContent(
  node: InspectorNode,
  children: readonly InspectorNode[],
): ContractContent {
  if (node.kind === "service") {
    const exportRows = node.exports ?? [];
    const resolved = (node.resolvedMethods ?? []).map((m) => ({
      name: m.name,
      signature: m.signature,
      returns: m.returns,
      semantics: m.semantics,
      exported: true,
      coversLabel: coversLabelFor(undefined),
    }));
    return {
      mode: "exports",
      countLabel: `${exportRows.length} EXPORTS`,
      toggle: ["Signatures", "OpenAPI"],
      methods: [],
      addMethodLabel: "+ add method",
      exportRows,
      resolvedMethods: resolved,
    };
  }
  const methods = children.filter((child) => child.kind === "contract-method");
  return {
    mode: "methods",
    countLabel: `${methods.length} METHODS`,
    toggle: ["Signatures", "OpenAPI"],
    methods: methods.map(methodBlock),
    addMethodLabel: "+ add method",
    exportRows: [],
    resolvedMethods: [],
  };
}

// --- Tests (S-07) -------------------------------------------------------------

export interface TestCaseRow {
  title: string;
  given?: string;
  when?: string;
  then?: string;
  /** PRD §12.12's per-state form: `linked · 41ms`, `linked, failing`, or the
   *  unlinked sentence. */
  statusLine: string;
  markerToken?: string;
  mismatch?: string;
  /** WIREFRAME-EXTRACT.md Resolution 7.2: drawn only on an unlinked case —
   *  a linked case's marker already lives in its own source file. */
  showCopyMarkerControl: boolean;
}

const UNLINKED_LINE = "Declared, no marker found in code. Different problem from a failing test.";

function testCaseRow(testCase: InspectorNode): TestCaseRow {
  const linked = testCase.testLinkState !== "declared";
  let statusLine: string;
  if (!linked) {
    statusLine = UNLINKED_LINE;
  } else if (testCase.testStatus === "failing") {
    statusLine = "linked, failing";
  } else {
    statusLine = `linked · ${testCase.lastDurationMs ?? 0}ms`;
  }
  return {
    title: testCase.title,
    given: testCase.given,
    when: testCase.when,
    then: testCase.then,
    statusLine,
    markerToken: testCase.markerToken,
    mismatch: testCase.testStatus === "failing" ? testCase.mismatch : undefined,
    showCopyMarkerControl: !linked,
  };
}

export interface TestsContent {
  countLabel: string;
  chips: string[];
  cases: TestCaseRow[];
}

/**
 * `moduleNode.additionalPassingTests` folds into both the passing chip and
 * the total: the same curation `coversCount` already applies to a
 * contract-method's own untracked covers edges (`../graph/module.ts`'s own
 * comment), read here rather than duplicated into a stored summary string.
 * `0`/`undefined` changes nothing — every fixture that models every one of
 * its cases as a real node computes this function exactly from `children`.
 */
export function testsContent(
  moduleNode: InspectorNode,
  children: readonly InspectorNode[],
): TestsContent {
  const cases = children.filter((child) => child.kind === "test-case");
  const rollup = moduleNode.additionalPassingTests ?? 0;
  const passing = cases.filter((c) => c.testStatus === "passing").length + rollup;
  const failing = cases.filter((c) => c.testStatus === "failing").length;
  const unlinked = cases.filter((c) => c.testLinkState === "declared").length;
  return {
    countLabel: `${cases.length + rollup} CASES`,
    chips: [`${passing} passing`, `${failing} failing`, `${unlinked} unlinked`],
    cases: cases.map(testCaseRow),
  };
}

// --- Budgets (S-08) -----------------------------------------------------------

export interface BudgetRow {
  metric: string;
  tierBadge: string;
  value: string;
  threshold?: string;
  /** `"trending"` draws the sign-off note and control; `"no-probe"` draws
   *  the lint-error note and the 2 controls; `"normal"` draws none of that. */
  state: "normal" | "trending" | "no-probe";
  probe?: string;
}

const NO_PROBE_LABEL = "No probe declared";
const NO_PROBE_NOTE = "An unmeasurable claim is a lint error, not a warning.";
const TRENDING_NOTE = "trending to breach · sign-off required";

function budgetRow(budget: InspectorNode): BudgetRow {
  const hasProbe = Boolean(budget.budgetProbe);
  const state: BudgetRow["state"] = !hasProbe
    ? "no-probe"
    : budget.budgetTrending
      ? "trending"
      : "normal";
  return {
    metric: budget.title,
    tierBadge: budget.budgetTier === "soft" ? "SOFT" : "HARD",
    value: budget.budgetValueText ?? "—",
    threshold: budget.budgetThresholdText,
    state,
    probe: budget.budgetProbe,
  };
}

export interface BudgetsContent {
  countLabel: string;
  runReference?: string;
  rows: BudgetRow[];
  /** The `"no-probe"` row state's own heading (PRD §12.12: "A budget with
   *  no probe draws `No probe declared`"), separate from `value`'s own
   *  `—` — PRD §12.12 draws the 2 forms for 2 different reasons. */
  noProbeLabel: string;
  noProbeNote: string;
  trendingNote: string;
}

export function budgetsContent(
  moduleNode: InspectorNode,
  children: readonly InspectorNode[],
): BudgetsContent {
  const budgets = children.filter((child) => child.kind === "budget");
  return {
    countLabel: `${budgets.length} BUDGETS`,
    runReference: moduleNode.runReference,
    rows: budgets.map(budgetRow),
    noProbeLabel: NO_PROBE_LABEL,
    noProbeNote: NO_PROBE_NOTE,
    trendingNote: TRENDING_NOTE,
  };
}

// --- Dependencies (S-09) -------------------------------------------------------

export interface InternalDependencyRow {
  title: string;
  direction: "depends_on" | "depended_on_by";
}

export interface DependenciesContent {
  internal: InternalDependencyRow[];
  external: LibraryDetail[];
}

/** A structural edge subset — `dependencies.ts`-style pure input, no full
 *  `GraphEdge` required. */
export interface InspectorEdge {
  kind: string;
  from: string;
  to: string;
}

/**
 * External libraries come off the module's own `external-dep` facet
 * children (PRD §5.5), not a 2nd stored list — `jose@5.2.4 · MIT` is the
 * same fact `../engine/anatomy.ts`'s `facetContentFor` draws on that
 * facet's own canvas card, read here for the Dependencies tab instead.
 */
export function dependenciesContent(
  node: InspectorNode,
  children: readonly InspectorNode[],
  edges: readonly InspectorEdge[],
  titleOf: (id: string) => string,
): DependenciesContent {
  const internal: InternalDependencyRow[] = [];
  for (const edge of edges) {
    if (edge.kind !== "depends_on") continue;
    if (edge.from === node.id) internal.push({ title: titleOf(edge.to), direction: "depends_on" });
    else if (edge.to === node.id) {
      internal.push({ title: titleOf(edge.from), direction: "depended_on_by" });
    }
  }
  const external: LibraryDetail[] = children
    .filter((child) => child.kind === "external-dep" && child.depVersion && child.depLicense)
    .map((dep) => ({
      name: dep.slug,
      version: dep.depVersion as string,
      license: dep.depLicense as string,
    }));
  return { internal, external };
}

// --- Docs (S-10) ----------------------------------------------------------------

export interface DocsContent {
  body: string;
  audience?: string;
  hasDoc: boolean;
}

export function docsContent(children: readonly InspectorNode[]): DocsContent {
  const doc = children.find((child) => child.kind === "doc-block");
  return { body: doc?.docBody ?? "", audience: undefined, hasDoc: Boolean(doc) };
}

// --- References (S-11) -----------------------------------------------------------

export interface ReferencesContent {
  decisionLinks: string[];
  screenLinks: string[];
  inboundReferenceCount: number;
  danglingReferences: string[];
}

export function referencesContent(node: InspectorNode): ReferencesContent {
  return {
    decisionLinks: (node.decisions ?? []).map((slug) => `decision://${slug}`),
    screenLinks: [...(node.screenLinks ?? [])],
    inboundReferenceCount: node.inboundReferenceCount ?? 0,
    danglingReferences: [...(node.danglingReferences ?? [])],
  };
}
