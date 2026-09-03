/**
 * The configuration surface. One Schematic engine, configured 3 ways (PRD §17
 * Wave 3) — this file is the whole interface Wave 5 programs against when it
 * builds the Stack, Service and Module Schematics. Nothing below draws; every
 * value here is read by `engine.ts`, `rules.ts`, `routing.ts` or `frame.ts`.
 *
 * The shape is deliberately declarative. An edge kind is a row in a table
 * rather than a callback, so a refusal can name the rule it came from, and so
 * a test can enumerate what a tier accepts without running a drag. The `screen`
 * kind is here because `references_ui` terminates at one (PRD §5.7, §12.5),
 * even though no Schematic draws a screen's box this wave.
 */
import type { Tier } from "../graph";

/** Every edge kind in PRD §11.1. A tier's own closed set is
 *  `SchematicConfig.edgeKinds`, not this type. */
export type EdgeKind =
  "depends_on" | "implements" | "references_ui" | "covers" | "satisfies" | "documents";

/** A node kind the engine can hold: the graph's containment kinds, PRD
 *  §12.11's 5 facet kinds, and §11.3's 2 annotation kinds. */
export type SchematicNodeKind =
  | "service"
  | "module"
  | "screen"
  | "contract-method"
  | "test-case"
  | "budget"
  | "doc-block"
  | "external-dep"
  | "comment"
  | "group";

/** PRD §11.3's annotation tier: no semantic edge, no reconciliation, and
 *  persisted to the cosmetic layout file rather than to `nodes/`. */
export const ANNOTATION_KINDS: readonly SchematicNodeKind[] = ["comment", "group"];

/** True when this kind sits in the annotation tier (PRD §11.3). */
export function isAnnotationKind(kind: string): boolean {
  return (ANNOTATION_KINDS as readonly string[]).includes(kind);
}

/** How one edge kind draws (PRD §12.5). A legend chip reads the same style its
 *  edges do, so the two cannot disagree. */
export interface EdgeStyle {
  line: "solid" | "dashed" | "dotted";
  arrow: "filled" | "hollow" | "chip" | "none";
  /** A `--kv-*` custom property name, never a colour value (PRD §13). */
  strokeToken: string;
  widthPx: number;
}

/** One row of a tier's closed edge vocabulary. `from` and `to` name the node
 *  kinds each end accepts, and a drag whose ends do not match both lists is
 *  refused at drag time with `refusal` (PRD §12.5). */
export interface EdgeKindRule {
  kind: EdgeKind;
  from: readonly (SchematicNodeKind | "*")[];
  to: readonly (SchematicNodeKind | "*")[];
  /** Refuse an edge of this kind that would close a directed cycle
   *  (PRD §12.5). `depends_on` carries it; `covers` does not. */
  acyclic: boolean;
  style: EdgeStyle;
  /** Whether this kind gets a chip beside the zoom readout. What a tier allows
   *  and what its legend advertises are different questions: PRD §12.1 names 3
   *  chips at tier 3 where §11.1 allows 4 kinds. */
  inLegend: boolean;
  /** Drawn at the cursor when a drag's ends do not match. The heading
   *  `Drop refused` is the engine's, never this string's. */
  refusal: string;
}

/**
 * How containment draws. Containment is never a stored edge (PRD §4.1) — it is
 * `parentId` — but tier 3 additionally *draws* a labelled line for it, per
 * WIREFRAME-EXTRACT.md Resolution 10.1 row 7.1. `"nesting-and-arrows"` is that
 * rendering: the line is synthesised at draw time, is not in `doc.edges`,
 * cannot be created, deleted or rerouted, and never enters an edge count.
 */
export type ContainmentRendering =
  { mode: "nesting" } | { mode: "nesting-and-arrows"; label: string };

/** Which Schematic chrome this tier draws (PRD §12.1). Three flags because
 *  WIREFRAME-EXTRACT.md §10.3 adds the readout and the legend at tier 3, which
 *  draws neither in the wireframe. */
export interface ChromeConfig {
  minimap: boolean;
  zoomReadout: boolean;
  legend: boolean;
}

/** A part a node plays, as opposed to what kind of thing it is. Each tier says
 *  in `NodePolicy` what a role costs. */
export type NodeRole = "entry-point" | "schematic-root";

/**
 * What a role costs a node. PRD §12.10 pins the service entry point to the
 * Schematic edge; §12.11 pins the module root and draws
 * `MODULE ROOT · CANNOT BE DELETED`. `undeletable` is reported by `canDelete`
 * rather than enforced on a gesture, because PRD §6.6 says nothing is ever
 * deleted at all and the engine offers no delete.
 */
export interface NodePolicy {
  pinned: { roles: readonly NodeRole[]; edge: "left" | "right" };
  undeletable: readonly NodeRole[];
}

/** How default placement and `Auto-sort` lay a Schematic out: children flowing
 *  row-major inside their parent, or PRD §12.11's "facets fan outward. The
 *  Schematic reads as a contract sheet, not as a free graph." */
export type ArrangementStrategy = "nested-flow" | "contract-sheet";

/** Pan and zoom limits, and where a Schematic starts (PRD §12.3). */
export interface ZoomConfig {
  min: number;
  max: number;
  initial: number;
}

/** The dot grid this tier draws on, and whether a drag snaps to it. Tier 1
 *  uses the larger grid (`--kv-grid-size-stack`, PRD §13.5). */
export interface GridConfig {
  size: number;
  snap: boolean;
}

/** A drawn box's size in world units. */
export interface Size {
  width: number;
  height: number;
}

/**
 * The whole configuration surface. A tier is one of these, and `TIER_PRESETS`
 * in `./presets.ts` holds the 3. A tier that needs a rule this shape cannot
 * express adds a field here rather than forking the engine.
 */
export interface SchematicConfig {
  /** Which tier this configuration draws. Chooses nothing by itself — every
   *  behavioural difference below is explicit. */
  tier: Tier;
  /** Names `layout/<slug>.json`, the cosmetic file positions persist to. */
  layoutSlug: string;
  grid: GridConfig;
  zoom: ZoomConfig;
  /** The tier's closed edge vocabulary (PRD §11.1). A kind absent from this
   *  list cannot be drawn on this tier at all. */
  edgeKinds: readonly EdgeKindRule[];
  containment: ContainmentRendering;
  /** How a node with no stored position is placed, and what `Auto-sort`
   *  produces (PRD §12.3, §12.11). */
  arrangement: ArrangementStrategy;
  /** Which roles pin, to which edge, and which no gesture may delete. */
  nodePolicy: NodePolicy;
  /** Whether groups and comments (PRD §12.4) are offered. Every tier says
   *  `true` today; a read-only Schematic is the plausible 4th configuration. */
  annotations: boolean;
  chrome: ChromeConfig;
  /** The note beside the legend chips, e.g.
   *  `contains = nesting · depends_on = drawn` (PRD §12.1). */
  legendFooter: string;
  /** The default box for a node of this kind, before any layout file overrides
   *  it. The one callback: Wave 4 sizes a node from its content. */
  nodeBox: (kind: SchematicNodeKind) => Size;
}

/** The refusal a surface draws under `Drop refused` (PRD §11.3, §12.5),
 *  anchored at the cursor by the caller. */
export interface Refusal {
  heading: "Drop refused";
  reason: string;
}

/** The refusal envelope, so no caller types the heading itself. */
export function refuse(reason: string): Refusal {
  return { heading: "Drop refused", reason };
}
