/**
 * The product layer's wire vocabulary (PRD §5.7, §5.8, §5.9, §5.12) —
 * restated by hand from `crates/schematify-core`'s `Screen`, `Flow`,
 * `FlowStep`, `Decision` and `ProjectBrief`, the same convention
 * `../graph/project.ts`'s `RawNode`/`RawEdge` already use for the design
 * graph: this app may not import the crate directly
 * (`docs/audits/schematify-baseline.md` §7), so the shapes are typed here
 * against what `schematify/load-graph` actually serializes, field name for
 * field name, snake_case included.
 */

/** `schematify_core::Decision`'s `status` field — always drawn upper-case,
 *  per PRD §5.9. */
export type DecisionStatus = "ACTIVE" | "SUPERSEDED";

/** One row of `schematify/load-graph`'s `decisions` array, exactly as
 *  `schematify_core::Decision` serializes it. */
export interface RawDecision {
  id: string;
  kind: "decision";
  slug: string;
  title: string;
  context: string;
  decision: string;
  consequences: string;
  status: DecisionStatus;
  supersedes?: string | null;
  superseded_by?: string | null;
  date: string;
}

/** One row of `schematify/load-graph`'s `screens` array. */
export interface RawScreen {
  id: string;
  kind: "screen";
  slug: string;
  title: string;
  purpose: string;
  states: string[];
  acceptance: string[];
  design_ref?: string | null;
  backed_by: string[];
}

/** One step of a flow, exactly as `schematify_core::FlowStep` serializes it. */
export interface RawFlowStep {
  screen: string;
  action: string;
}

/** One row of `schematify/load-graph`'s `flows` array. */
export interface RawFlow {
  id: string;
  kind: "flow";
  slug: string;
  title: string;
  trigger: string;
  steps: RawFlowStep[];
  outcome: string;
}

/** One measurable claim, exactly as `schematify_core::SuccessMetric`
 *  serializes it. */
export interface RawSuccessMetric {
  name: string;
  value: number;
  unit: string;
}

/** `schematify/load-graph`'s `brief` field — `null` on a project that has
 *  never written one, the first-run state, not an error. */
export interface RawProjectBrief {
  product_name: string;
  problem: string;
  users: string[];
  goals: string[];
  non_goals: string[];
  constraints: string[];
  success_metrics: RawSuccessMetric[];
}
