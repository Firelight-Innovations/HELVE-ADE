import { useCallback, useRef } from "react";
import type { DropTarget, SplitDir } from "../contract";

/**
 * The drop-target registry.
 *
 * What this replaced was a set of hardcoded DOM queries: the drag layer looked
 * up `[data-region="switcher"]`, `[data-region="panel"]`, and — worst of it —
 * `bar.querySelectorAll(".switcher__tab")`, reaching across into another
 * region's CSS class names to work out where a tab would land. That was
 * survivable while there was exactly one bar and one panel. There are now an
 * arbitrary number of panes and tab strips, created and destroyed as the user
 * splits and closes things, and no query can enumerate them without knowing
 * their markup.
 *
 * So regions opt in instead. A pane registers itself as a pane; a tab strip
 * registers itself and offers a way to measure its tabs. The drag layer knows
 * only the shapes below, and never what any region's DOM looks like.
 *
 * ## Why a module singleton rather than a context
 *
 * Because the scope of "one registry" is exactly one window, and a window is
 * exactly one webview with its own JavaScript context. There is no arrangement
 * in which a single page hosts two independent shells that would need separate
 * registries — a second HELVE window is a second webview, with its own copy of
 * this module.
 *
 * A context would also have forced an ordering problem for no benefit:
 * `WindowRoot` both consumes the hit-test (through `useDrag`) and renders the
 * regions that register with it, so a provider would have to sit *above*
 * `WindowRoot` in `App`, where nothing else about the drag layer lives. Getting
 * that wrong fails silently — every drop resolves to `detach`, because an
 * unreachable registry has no zones and no zones means no target.
 *
 * Registration is a ref callback rather than an effect, so a zone appears the
 * moment its element does and disappears the moment it unmounts. There is no
 * window in which a pane is on screen but not yet a target, which is exactly
 * the window a fast drag would fall into.
 */
export type DropZone =
  | { kind: "pane"; paneId: string }
  | {
      kind: "strip";
      paneId: string;
      /** Measured on demand, because a strip scrolls and its tabs move. */
      tabRects: () => DOMRect[];
    }
  | { kind: "panel" };

interface Registered {
  zone: DropZone;
  el: HTMLElement;
}

/**
 * How far into a pane counts as its edge.
 *
 * A quarter of the axis, which is what VSCode's gesture feels like: far enough
 * in that aiming for "this pane" does not accidentally split it, close enough to
 * the edge that aiming for a split does not need precision. Smaller makes
 * splitting fiddly; larger makes appending to a strip nearly impossible in a
 * narrow pane.
 */
const EDGE_FRACTION = 0.25;

let zones: Registered[] = [];

function add(zone: DropZone, el: HTMLElement): void {
  zones = [...zones.filter((z) => z.el !== el), { zone, el }];
}

function remove(el: HTMLElement): void {
  zones = zones.filter((z) => z.el !== el);
}

/**
 * Where a release at this point would land.
 *
 * Most specific first, and the order is the whole logic. A strip sits inside the
 * pane it belongs to, so testing panes first would mean a drop between two tabs
 * always resolved to "append to this pane" and the insertion caret could never
 * be honoured.
 */
export function hitTest(x: number, y: number): DropTarget {
  for (const { zone, el } of zones) {
    if (zone.kind !== "strip") continue;
    if (!within(el.getBoundingClientRect(), x, y)) continue;
    return { kind: "strip", paneId: zone.paneId, index: insertionIndex(zone.tabRects(), x) };
  }

  for (const { zone, el } of zones) {
    if (zone.kind !== "pane") continue;
    const rect = el.getBoundingClientRect();
    if (!within(rect, x, y)) continue;
    return { kind: "pane", paneId: zone.paneId, ...edgeOf(rect, x, y) };
  }

  for (const { zone, el } of zones) {
    if (zone.kind !== "panel") continue;
    if (within(el.getBoundingClientRect(), x, y)) return { kind: "panel" };
  }

  // Over no registered zone. Releasing here makes a window.
  return { kind: "detach" };
}

/**
 * Register an element as a drop target. Returns a ref callback to spread onto it.
 *
 * The zone is read through a ref so the returned callback's identity is stable.
 * An unstable ref callback makes React detach and reattach on every render,
 * which here would mean deregistering and reregistering the zone continuously —
 * and a drag sampling the registry mid-render would see it missing.
 */
export function useDropZone(zone: DropZone): (el: HTMLElement | null) => void {
  const held = useRef<HTMLElement | null>(null);
  const latest = useRef(zone);
  latest.current = zone;

  return useCallback((el: HTMLElement | null) => {
    if (held.current) remove(held.current);
    held.current = el;
    if (el) add(latest.current, el);
  }, []);
}

function within(rect: DOMRect, x: number, y: number): boolean {
  return x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom;
}

/**
 * Which edge band a point falls in, or none.
 *
 * Left and right give a row split — the panes end up side by side — and top and
 * bottom a column. `before` says which side the new pane takes, so dropping on
 * the left opens to the left rather than always to the right.
 *
 * The horizontal bands are tested first. A pane's tab strip already occupies its
 * top edge and is a strip zone of its own, so the only way to reach the top band
 * at all is below that strip, where a sideways intent is the more likely one.
 */
function edgeOf(rect: DOMRect, x: number, y: number): { edge: SplitDir | null; before: boolean } {
  const bandX = rect.width * EDGE_FRACTION;
  const bandY = rect.height * EDGE_FRACTION;

  if (x - rect.left < bandX) return { edge: "row", before: true };
  if (rect.right - x < bandX) return { edge: "row", before: false };
  if (y - rect.top < bandY) return { edge: "column", before: true };
  if (rect.bottom - y < bandY) return { edge: "column", before: false };
  return { edge: null, before: false };
}

/**
 * How many tab midpoints the pointer has passed — the index a drop inserts at.
 * Midpoints rather than leading edges, so a tab changes places once the pointer
 * is more than half past it, which is where the eye expects it to.
 */
function insertionIndex(rects: DOMRect[], x: number): number {
  let index = 0;
  for (const rect of rects) {
    if (x > rect.left + rect.width / 2) index += 1;
  }
  return index;
}
