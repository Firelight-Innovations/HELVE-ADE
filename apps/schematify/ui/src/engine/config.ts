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

/** Every edge kind in PRD §11.1, both tier bands in one union. A tier's own
 *  closed set is `SchematicConfig.edgeKinds`, not this type. */
export type EdgeKind =
  "depends_on" | "implements" | "references_ui" | "covers" | "satisfies" | "documents";

/** A node kind the engine can hold. The 3 containment kinds come from the
 *  graph, the 5 facet kinds from PRD §12.11's palette, and the 2 annotation
 *  kinds from §11.3. `"*"` in an edge rule matches any of them. */
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

/** PRD §11.3's annotation tier. A node of one of these kinds carries no
 *  semantic edge, appears in no reconciliation, and persists to the cosmetic
 *  layout file rather than to `nodes/`. */
export const ANNOTATION_KINDS: readonly SchematicNodeKind[] = ["comment", "group"];

/** True when this kind sits in the annotation tier (PRD §11.3). */
export function isAnnotationKind(kind: string): boolean {
  return (ANNOTATION_KINDS as readonly string[]).includes(kind);
}

/** How one edge kind draws (PRD §12.5's style table). The legend chip reads
 *  the same style its edges do, so the two can never disagree. */
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
  /** When true, an edge of this kind that would close a directed cycle is
   *  refused (PRD §12.5). `depends_on` carries it; `covers` does not. */
  acyclic: boolean;
  style: EdgeStyle;
  /** Drawn at the cursor when a drag's ends do not match `from`/`to`. The
   *  heading `Drop refused` is added by the engine, never by this string. */
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

/** Which Schematic chrome this tier draws (PRD §12.1). Three flags rather than
 *  one, because WIREFRAME-EXTRACT.md §10.3 adds the readout and the legend to
 *  the Module Schematic, which draws neither in the wireframe. */
export interface ChromeConfig {
  minimap: boolean;
  zoomReadout: boolean;
  legend: boolean;
}

/** Pan and zoom limits, and where a fresh Schematic starts (PRD §12.3). */
export interface ZoomConfig {
  min: number;
  max: number;
  initial: number;
}

/** The dot grid this tier draws on, and whether a drag snaps to it. The
 *  Stack Schematic uses the larger grid (`--kv-grid-size-stack`, PRD §13.5). */
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
 * The whole configuration surface: 10 fields, no callbacks except `nodeBox`.
 * A tier is one of these. `TIER_PRESETS` in `./presets.ts` holds the 3 Wave 5
 * starts; a tier that needs a rule this shape cannot express should add a
 * field here rather than fork the engine.
 */
export interface SchematicConfig {
  /** Which tier this configuration draws. Chooses nothing by itself — every
   *  behavioural difference below is explicit. */
  tier: Tier;
  /** Names the cosmetic file positions persist to, `layout/<slug>.json`
   *  (PRD §6.1, §12.3). */
  layoutSlug: string;
  grid: GridConfig;
  zoom: ZoomConfig;
  /** The tier's closed edge vocabulary (PRD §11.1). An edge kind absent from
   *  this list cannot be drawn on this tier at all. */
  edgeKinds: readonly EdgeKindRule[];
  containment: ContainmentRendering;
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

/** The refusal every surface draws under the heading `Drop refused`
 *  (PRD §11.3, §12.5). Anchored at the cursor by the caller. */
export interface Refusal {
  heading: "Drop refused";
  reason: string;
}

/** Builds the refusal envelope, so no caller types the heading itself. */
export function refuse(reason: string): Refusal {
  return { heading: "Drop refused", reason };
}
