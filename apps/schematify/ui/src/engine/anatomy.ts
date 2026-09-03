/**
 * Node anatomy (PRD §12.6, §12.7, §12.8) — Wave 4. Every function here is
 * pure and takes plain data, so it is what `frame.test.ts`-style tests exert
 * directly and what `frame.ts` calls to fill in `DrawnNode`. Nothing in this
 * file touches the DOM; `SchematicCanvas.tsx` only maps what is computed here
 * onto markup, per that file's own "the renderer decides nothing" rule.
 *
 * PRD §12.7's badge, count, and caption text is drawn verbatim from
 * WIREFRAME-EXTRACT.md §1.1 and §2.2 — every literal string below is copied
 * from there, not composed loosely, so a test can compare literally.
 */
import type { FacetCounts, HealthStatus, Layer, Lifecycle, Tier } from "../graph";
import { descendantsOf } from "./doc";
import type { DocIndex, SchematicNode } from "./doc";
import type { Rect } from "./geometry";
import type { Size } from "./config";

/** The fields `badgesFor`, `countStringsFor` and `captionFor` read. A
 *  structural subset of `SchematicNode` rather than the type itself, so a
 *  unit test can hand these functions a bare object without building a whole
 *  document — the FRONTEND/EXTERNAL badge test (PRD §17 Wave 4's own
 *  acceptance condition) is exactly that: a node no fixture holds. */
export interface AnatomyNode {
  slug: string;
  kind: string;
  role?: "entry-point" | "schematic-root";
  layer?: Layer;
  lifecycle?: Lifecycle;
  authoredBy?: "human" | "agent";
  description?: string;
  facets?: FacetCounts;
  libraries?: readonly string[];
  exportsCount?: number;
  modulesCount?: number;
  dependentsCount?: number;
  sharedAtLca?: boolean;
  schemasResolved?: boolean;
  deprecatedSuccessor?: string;
  staleReason?: string;
  health?: HealthStatus;
  exported?: boolean;
  budgetTier?: "hard" | "soft";
}

const LAYER_BADGE: Record<Layer, string> = {
  edge: "EDGE",
  backend: "BACKEND",
  data: "DATA",
  frontend: "FRONTEND",
  external: "EXTERNAL",
};

/**
 * The closed badge set (PRD §12.6's table). Order matches the table's own
 * reading order. `tier` decides `ENTRY` vs `ENTRY POINT` (PRD §12.6: one
 * badge names the Stack Schematic's entry service, the other the Service
 * Schematic's entry point) and whether a layer badge draws at all — PRD
 * §12.6's closing line extends the layer badge to "both tiers" (stack and
 * service), never tier 3.
 *
 * `◇ AGENT` (lifecycle `assigned`) and `◇ AGENT DRAFT` (`authored_by`
 * `agent`) are 2 separate rows of the PRD table with 2 separate conditions,
 * but WIREFRAME-EXTRACT.md §1.1's Rate Limiter — `assigned` and agent-
 * authored at once — draws only the more specific `◇ AGENT DRAFT`, not both
 * diamonds side by side. `[P]`: read as "AGENT DRAFT supersedes the plain
 * AGENT badge when both conditions hold," recorded in the Wave 4 handoff.
 */
export function badgesFor(node: AnatomyNode, tier: Tier): string[] {
  const badges: string[] = [];
  if (node.role === "entry-point") {
    badges.push(tier === "stack" ? "📌 ENTRY" : "📌 ENTRY POINT");
  }
  if (node.sharedAtLca) badges.push("SHARED · AT LCA");
  if (node.layer && tier !== "module") badges.push(LAYER_BADGE[node.layer]);
  if (node.authoredBy === "agent") {
    badges.push("◇ AGENT DRAFT");
  } else if (node.lifecycle === "assigned") {
    badges.push("◇ AGENT");
  }
  if (node.role === "schematic-root" && tier === "module") {
    badges.push("MODULE ROOT · CANNOT BE DELETED");
  }
  if (node.kind === "contract-method" && node.exported) badges.push("EXPORTED");
  if (node.kind === "budget" && node.budgetTier) {
    badges.push(node.budgetTier === "hard" ? "HARD" : "SOFT");
  }
  return badges;
}

/**
 * The facet-count row's chips, tier 2 only (PRD §12.6): `⬤ 3 meth`,
 * `⬤ 5 test`, `⬤ 2 budg`, one entry per facet type the node actually
 * carries — JWKS Cache draws 2 chips, not 3 with a `0 budg`, so an absent
 * count draws no chip at all rather than a zero one.
 */
export function facetChipsFor(facets: FacetCounts | undefined): string[] {
  if (!facets) return [];
  const chips: string[] = [];
  if (facets.methods !== undefined) chips.push(`⬤ ${facets.methods} meth`);
  if (facets.tests !== undefined) chips.push(`⬤ ${facets.tests} test`);
  if (facets.budgets !== undefined) chips.push(`⬤ ${facets.budgets} budg`);
  return chips;
}

/**
 * Every other count string PRD §12.6 lists, in the node's own reading order.
 * `contains N`, `collapsed · N children` and `N edges aggregated` are
 * `frame.ts`'s own business (they need the document index, not just the
 * node), so they are not duplicated here.
 */
export function countStringsFor(node: AnatomyNode): string[] {
  const out: string[] = [];
  if (node.exportsCount !== undefined) out.push(`${node.exportsCount} exports`);
  if (node.modulesCount !== undefined) out.push(`${node.modulesCount} modules`);
  if (node.dependentsCount !== undefined) out.push(`${node.dependentsCount} dependents`);
  if (node.schemasResolved) out.push("schemas ✓");
  return out;
}

/** One caption, drawn where a state carries a reason (PRD §12.6). At most 1
 *  — the table's own priority order, highest first: `stale` outranks every
 *  other state, since staleness is a linter-relevant contract breach and not
 *  merely a lifecycle position. */
export interface Caption {
  primary: string;
  secondary?: string;
}

export function captionFor(node: AnatomyNode): Caption | undefined {
  if (node.lifecycle === "stale") {
    return { primary: "⚠ STALE — upstream contract changed", secondary: node.staleReason };
  }
  if (node.authoredBy === "agent") {
    return { primary: "Pre-filled by agent. Not reviewed." };
  }
  if (node.lifecycle === "deprecated" && node.deprecatedSuccessor) {
    return { primary: `${node.slug} → ${node.deprecatedSuccessor}` };
  }
  if (node.lifecycle === "reviewed") {
    return { primary: "reviewed · awaiting accept" };
  }
  if (node.lifecycle === "draft") {
    if (node.kind === "service" && (node.exportsCount ?? 0) === 0) {
      return { primary: "draft · 0 exports authored" };
    }
    if (node.health === undefined || node.health === "no-data") {
      return { primary: "draft · no run data" };
    }
  }
  return undefined;
}

// --- lifecycle rendering (PRD §12.7) ----------------------------------------

/**
 * How one lifecycle state draws, entirely in shape rather than colour: a
 * `--kv-*` token still names the colour a state happens to use, but every
 * field a sighted-with-colour-removed reader needs is a discrete geometric
 * choice — border style and weight, whether the header dot is a ring or a
 * disc, which (if any) glyph sits in the header, how wide the bottom-edge
 * fill runs, whether a diagonal stripe overlays the card, the card's own
 * opacity, and whether the title is struck through.
 */
export interface LifecycleTreatment {
  borderStyle: "solid" | "dashed";
  borderWidthPx: 1 | 1.5;
  /** A `--kv-*` token. Colour, never the only cue — WIREFRAME-EXTRACT.md
   *  §8.2 rules the per-state dot fill "a redundant cue," and this token is
   *  that same redundancy applied to the border. Deliberately excluded from
   *  `lifecycleSignature`, which proves the 8 states apart without it. */
  borderToken: string;
  dotFill: "hollow" | "filled";
  /** A `--kv-*` token for the dot, same redundant-cue status as
   *  `borderToken`. */
  dotToken: string;
  /** `reviewed` draws its dot at 55% (WIREFRAME-EXTRACT.md §2.2); every
   *  other state is fully opaque. */
  dotOpacityPct: 55 | 100;
  headerGlyph: "" | "◇" | "◐" | "✓" | "⚠";
  /** 0 draws no bottom-edge fill at all. */
  bottomFillPct: 0 | 64 | 100;
  /** A `--kv-*` token, or `""` when `bottomFillPct` is 0. */
  bottomFillToken: string;
  overlayStripe: boolean;
  opacityPct: 100 | 40;
  titleStruck: boolean;
  /** The wireframe's own reference-sheet caption (WIREFRAME-EXTRACT.md
   *  §2.2), e.g. `draft — dashed, muted fill`. */
  legendCaption: string;
}

/** The 8 states (PRD §7.1, §12.7), each drawn from
 *  WIREFRAME-EXTRACT.md §2.2's example-card table. */
export const LIFECYCLE_TREATMENTS: Record<Lifecycle, LifecycleTreatment> = {
  draft: {
    borderStyle: "dashed",
    borderWidthPx: 1,
    borderToken: "--kv-line-draft",
    dotFill: "hollow",
    dotToken: "--kv-text-faint",
    dotOpacityPct: 100,
    headerGlyph: "",
    bottomFillPct: 0,
    bottomFillToken: "",
    overlayStripe: false,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "draft — dashed, muted fill",
  },
  specified: {
    borderStyle: "solid",
    borderWidthPx: 1,
    borderToken: "--kv-line",
    dotFill: "filled",
    dotToken: "--kv-text-secondary",
    dotOpacityPct: 100,
    headerGlyph: "",
    bottomFillPct: 0,
    bottomFillToken: "",
    overlayStripe: false,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "specified — solid, neutral",
  },
  assigned: {
    borderStyle: "solid",
    borderWidthPx: 1,
    borderToken: "--kv-line",
    dotFill: "filled",
    dotToken: "--kv-text-secondary",
    dotOpacityPct: 100,
    headerGlyph: "◇",
    bottomFillPct: 0,
    bottomFillToken: "",
    overlayStripe: false,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "assigned — agent glyph",
  },
  implemented: {
    borderStyle: "solid",
    borderWidthPx: 1,
    borderToken: "--kv-line",
    dotFill: "filled",
    dotToken: "--kv-warn",
    dotOpacityPct: 100,
    headerGlyph: "",
    bottomFillPct: 64,
    bottomFillToken: "--kv-accent",
    overlayStripe: false,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "implemented — filled edge",
  },
  reviewed: {
    borderStyle: "solid",
    borderWidthPx: 1,
    borderToken: "--kv-line",
    dotFill: "filled",
    dotToken: "--kv-ok",
    dotOpacityPct: 55,
    headerGlyph: "◐",
    bottomFillPct: 100,
    bottomFillToken: "--kv-line-draft",
    overlayStripe: false,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "reviewed — half check",
  },
  accepted: {
    borderStyle: "solid",
    borderWidthPx: 1.5,
    borderToken: "--kv-ok",
    dotFill: "filled",
    dotToken: "--kv-ok",
    dotOpacityPct: 100,
    headerGlyph: "✓",
    bottomFillPct: 100,
    bottomFillToken: "--kv-ok",
    overlayStripe: false,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "accepted — full check, saturated",
  },
  stale: {
    borderStyle: "solid",
    borderWidthPx: 1.5,
    borderToken: "--kv-ok",
    dotFill: "filled",
    dotToken: "--kv-ok",
    dotOpacityPct: 100,
    headerGlyph: "⚠",
    bottomFillPct: 100,
    bottomFillToken: "--kv-warn",
    overlayStripe: true,
    opacityPct: 100,
    titleStruck: false,
    legendCaption: "stale — accepted + stripe",
  },
  deprecated: {
    borderStyle: "solid",
    borderWidthPx: 1,
    borderToken: "--kv-line",
    dotFill: "filled",
    dotToken: "--kv-text-faint",
    dotOpacityPct: 100,
    headerGlyph: "",
    bottomFillPct: 0,
    bottomFillToken: "",
    overlayStripe: false,
    opacityPct: 40,
    titleStruck: true,
    legendCaption: "deprecated — 40%, struck",
  },
};

/** A colour-blind fingerprint of a treatment: every field but the token
 *  names (a token names a colour, and the whole point of this function is to
 *  prove the states differ without one). Two states are indistinguishable
 *  with colour removed exactly when this string collides. */
export function lifecycleSignature(t: LifecycleTreatment): string {
  return [
    t.borderStyle,
    t.borderWidthPx,
    t.dotFill,
    t.headerGlyph,
    t.bottomFillPct,
    t.overlayStripe,
    t.opacityPct,
    t.titleStruck,
  ].join("|");
}

// --- health rendering (PRD §12.8) -------------------------------------------

/** Which of the 4 wedge treatments a health value draws. `passing` and
 *  `undefined` both draw none — most nodes carry no health field at all, and
 *  that reads the same as an explicit `passing`. */
export function healthWedgeFor(health: HealthStatus | undefined): HealthStatus {
  return health ?? "passing";
}

const HEALTH_RANK: Record<HealthStatus, number> = {
  passing: 0,
  "no-data": 1,
  "soft-fail": 2,
  "hard-fail": 3,
};

const HEALTH_ROLLUP_WORDS: Record<Exclude<HealthStatus, "passing">, string> = {
  "no-data": "no run data",
  "soft-fail": "soft budget trending",
  "hard-fail": "hard budget failing",
};

/**
 * A service node's health, rolled up as the worst status of any contained
 * module, stated in words (PRD §12.8: "The node face states that status in
 * words and draws a wedge.") `[P]`: the exact wording
 * (`worst contained: N <words> trending`) generalises WIREFRAME-EXTRACT.md
 * §1.1's one drawn example (`worst contained: 1 soft budget trending`,
 * Auth Service on the Stack Schematic) to the other 2 non-passing statuses,
 * since no source gives their wording. Recorded in the Wave 4 handoff. Not
 * reachable through this wave's Service Schematic fixture — no node in it is
 * `service`-kind — so this is tested directly against a synthetic document
 * for Wave 5 to call once the Stack Schematic exists.
 */
export function healthRollupFor(serviceNode: SchematicNode, index: DocIndex): Caption | undefined {
  let worst: HealthStatus = "passing";
  let count = 0;
  for (const node of descendantsOf(index, serviceNode.id)) {
    if (node.kind !== "module") continue;
    const health = node.health ?? "passing";
    if (HEALTH_RANK[health] > HEALTH_RANK[worst]) {
      worst = health;
      count = 1;
    } else if (health === worst && worst !== "passing") {
      count += 1;
    }
  }
  if (worst === "passing") return undefined;
  return { primary: `worst contained: ${count} ${HEALTH_ROLLUP_WORDS[worst]}` };
}

// --- the 3 zoom tiers (PRD §12.7) -------------------------------------------

export type ZoomTier = "full" | "mid" | "geometry";

/**
 * `full` draws everything; `mid` drops the description, the facet row and
 * the library row (title, slug and state survive); `geometry` drops text
 * entirely, leaving border weight, the bottom-edge fill, the overlay stripe
 * and the health wedge (PRD §12.7, WIREFRAME-EXTRACT.md §2.4).
 *
 * `[P]`: the wireframe's 3 reference points (100%, 55%, 22%) are an exhibit
 * on screen 1b, not stated as literal runtime thresholds, and reading them
 * that literally would drop the facet row at the Service Schematic's own
 * default 68% zoom (SERVICE_CONFIG.zoom.initial) — contradicting
 * WIREFRAME-EXTRACT.md §1.1, which draws facet counts on that exact screen at
 * that exact zoom. The boundaries below instead sit at the 2 reference
 * points themselves (`> 0.55` is `full`, so 68% and 100% both qualify;
 * `> 0.22` is `mid`; the rest is `geometry`, so the acceptance condition's
 * own value, 22%, lands there) — the reference points bound tiers rather
 * than naming exact breakpoints. Recorded in the Wave 4 handoff as the
 * surface a human should confirm.
 */
export function zoomTierFor(zoom: number): ZoomTier {
  if (zoom > 0.55) return "full";
  if (zoom > 0.22) return "mid";
  return "geometry";
}

// --- header geometry: the health wedge never reaches the node menu ---------

/** The wireframe's own corner triangle (WIREFRAME-EXTRACT.md §1.3: "14px
 *  corner triangle"). */
export const HEALTH_WEDGE_SIZE = 14;
/** The `[⋯]` node-menu control's own square hit area. No wireframe measures
 *  it; `[P]`, sized to sit comfortably inside the 34px+ header row every
 *  node kind draws. */
export const NODE_MENU_SIZE = 12;
/** The gap kept between the wedge's own corner and the node menu, so the 2
 *  top-right occupants WIREFRAME-EXTRACT.md §2.4 names never touch even at
 *  the smallest node width this app draws. */
export const NODE_MENU_INSET = 4;

export interface HeaderOccupants {
  wedge: Rect | null;
  menu: Rect;
}

/**
 * Where the health wedge and the node menu sit, in the node's own local
 * coordinates (top-left `0,0`). The wedge is pinned to the exact top-right
 * corner (PRD §12.6: "the upper corner opposite the ports... holds that
 * corner alone"); the menu sits inside the header row, shifted left of the
 * wedge by its own width plus `NODE_MENU_INSET` so the 2 can never overlap —
 * `anatomy.test.ts` proves that geometrically across every node width this
 * app draws rather than trusting the arithmetic here.
 */
export function headerOccupants(box: Size, hasWedge: boolean): HeaderOccupants {
  const wedge: Rect | null = hasWedge
    ? {
        x: box.width - HEALTH_WEDGE_SIZE,
        y: 0,
        width: HEALTH_WEDGE_SIZE,
        height: HEALTH_WEDGE_SIZE,
      }
    : null;
  const clearance = hasWedge ? HEALTH_WEDGE_SIZE + NODE_MENU_INSET : NODE_MENU_INSET;
  const menu: Rect = {
    x: box.width - clearance - NODE_MENU_SIZE,
    y: NODE_MENU_INSET,
    width: NODE_MENU_SIZE,
    height: NODE_MENU_SIZE,
  };
  return { wedge, menu };
}

// --- content-derived sizing (PRD §12.6; config.ts: "Wave 4 sizes a node
// from its content") ---------------------------------------------------------

/** Which optional rows a node's content adds beyond the header and slug
 *  every node draws. */
export interface NodeContent {
  hasDescription?: boolean;
  hasFacets?: boolean;
  hasLibraries?: boolean;
  hasCaption?: boolean;
}

/** Fixed per-row growth, in world px. `[P]`: no wireframe states these as
 *  independent constants (WIREFRAME-EXTRACT.md §1.2 gives 1 finished box size
 *  per drawn node, not a row-height ladder to derive one from), so this is an
 *  engineering estimate sized to fit the content each row actually draws.
 *  Recorded in the Wave 4 handoff. */
const ROW_GROWTH = { description: 24, facets: 16, libraries: 14, caption: 16 } as const;

/** Grows a kind's base box to fit whichever optional rows this node's
 *  content adds. A node with no description, no facets, no libraries and no
 *  caption keeps exactly the base size — the same box Wave 3 drew. */
export function contentBox(base: Size, content: NodeContent): Size {
  let height = base.height;
  if (content.hasDescription) height += ROW_GROWTH.description;
  if (content.hasFacets) height += ROW_GROWTH.facets;
  if (content.hasLibraries) height += ROW_GROWTH.libraries;
  if (content.hasCaption) height += ROW_GROWTH.caption;
  return { width: base.width, height };
}

/** Reads the content flags straight off an `AnatomyNode`, so a caller does
 *  not have to duplicate the "what counts as content" rules `contentBox`
 *  itself does not know. Takes the full `AnatomyNode` shape (rather than
 *  just the 3 fields it inspects directly) because `hasCaption` reruns
 *  `captionFor`'s own priority rule, which reads lifecycle, health and
 *  authorship too. */
export function contentOf(node: AnatomyNode): NodeContent {
  return {
    hasDescription: Boolean(node.description),
    hasFacets: Boolean(
      node.facets &&
      (node.facets.methods !== undefined ||
        node.facets.tests !== undefined ||
        node.facets.budgets !== undefined),
    ),
    hasLibraries: Boolean(node.libraries && node.libraries.length > 0),
    hasCaption: Boolean(captionFor(node)),
  };
}
