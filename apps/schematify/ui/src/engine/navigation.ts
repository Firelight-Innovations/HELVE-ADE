/**
 * Click-to-drill (PRD §17 Wave 5): "A click on a service opens its Service
 * Schematic, and a click on a module opens its Module Schematic." Pure and
 * DOM-free on purpose — `SchematicCanvas.tsx` has no test at all (that file's
 * own header comment explains why: `vitest.config.ts` runs on `node` with no
 * jsdom), so the *decision* of where a click leads lives here, where it is
 * unit-tested, and the component only turns a "was this a click, not a drag"
 * gesture into a call to it.
 *
 * Breadcrumb walk-up is not a pure function of one node — it depends on the
 * path already walked, which is navigation history, not document state — so
 * it stays as `App.tsx`'s own small piece of React state (an array of
 * `DrillTarget`, truncated on a breadcrumb click). This module owns only the
 * one decision that is a pure function of "what was clicked, at which tier."
 */
import type { Tier } from "../graph";
import type { SchematicConfig } from "./config";
import { TIER_PRESETS } from "./presets";

export interface DrillTarget {
  tier: Tier;
  slug: string;
  /** Carried along so a breadcrumb segment has a title to draw without a 2nd
   *  lookup back into whatever graph is loaded at the time. */
  title: string;
}

/** The node fields a drill decision needs — a structural subset, the same
 *  style `anatomy.ts`'s `AnatomyNode` already uses for the same reason. */
export interface DrillableNode {
  kind: string;
  slug: string;
  title: string;
}

/**
 * Where a click on `node` navigates to, given the tier it was clicked on —
 * or `null` when this kind has no drill target at this tier (a click on a
 * module's own facet card, or on an annotation node, goes nowhere).
 *
 * Only 2 rows exist because only 2 are named: PRD §17 Wave 5 gives exactly
 * "a click on a service" (stack tier) and "a click on a module" (service
 * tier). A click on a module at the Module Schematic's own tier (a facet's
 * container, i.e. the root re-clicked) is deliberately not a 3rd row — the
 * root is already the open Schematic, and re-opening it would be a no-op
 * dressed as navigation.
 */
export function nextDrillTarget(tier: Tier, node: DrillableNode): DrillTarget | null {
  if (tier === "stack" && node.kind === "service") {
    return { tier: "service", slug: node.slug, title: node.title };
  }
  if (tier === "service" && node.kind === "module") {
    return { tier: "module", slug: node.slug, title: node.title };
  }
  return null;
}

/**
 * The configuration to open for a drill target. `TIER_PRESETS` is 1 static
 * value per tier, but a Service or Module Schematic is 1 per instance — the
 * Service Schematic for whichever service was clicked, not always
 * `auth-service` — so `layoutSlug` (the value both `openSchematic` reads the
 * graph by and the layout file is named after) is overridden per target.
 * The Stack Schematic has exactly 1 instance, so it never needs the
 * override; the preset's own `layoutSlug` (`"stack"`) already names it.
 */
export function configFor(target: DrillTarget): SchematicConfig {
  const preset = TIER_PRESETS[target.tier];
  if (target.tier === "stack") return preset;
  return { ...preset, layoutSlug: target.slug };
}
