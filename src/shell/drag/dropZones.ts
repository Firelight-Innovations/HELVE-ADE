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
      /**
       * Which pane a release at this x lands in, and that pane's own tab rects.
       *
       * A function of the position rather than a fixed `paneId`, and that is a
       * bug fix rather than a generalisation. This used to be
       * `paneId: dropPaneId` — the *focused* pane — for a release anywhere over
       * the row, so releasing a tab directly on top of a chip belonging to some
       * other pane moved that tab **into the focused pane**. `commit`'s `strip`
       * branch calls `moveInstance`, so that was a real write to the tree that
       * persisted: the pane you were pointing at was ignored and its occupant
       * was replaced by whatever you had hold of.
       *
       * It hid for as long as it did because it is invisible in the case it is
       * reached most: when the tab is already in the focused pane, "move it into
       * the focused pane" is a reorder that changes nothing. It only misbehaves
       * across panes, which was a rare arrangement until opening an app started
       * making one.
       *
       * The row is still one zone spanning the whole bar — see the call site for
       * why anything narrower is dangerous — and it still answers with the
       * focused pane over the parts of it that are not any pane's tabs. Which
       * region a point falls in is the bar's own question about its own markup,
       * so the bar answers it; this module goes on knowing nothing about how the
       * row is drawn.
       *
       * Measured on demand, because the row scrolls and a stale rect puts the
       * caret in the wrong gap the moment it does.
       */
      at: (x: number) => { paneId: string; tabRects: DOMRect[] };
    }
  | { kind: "panel" };

/**
 * A registration holds the zone's **ref**, not the zone.
 *
 * This was `zone: DropZone`, a value copied in at attach time, and the copy was
 * a bug with teeth. `useDropZone` returns a ref callback with a stable identity
 * — deliberately, see below — so React attaches it once and never calls it
 * again for as long as the element lives. A pane's element outlives far more
 * than a pane: `PaneTree` renders `<Pane>` with no key, so switching clusters
 * hands the same DOM node a leaf from a different tree, React reconciles by
 * position, and the ref is not re-invoked. The registry went on answering with
 * the pane id the element had when it first mounted, which after one cluster
 * switch names a pane in a cluster that is not on screen.
 *
 * What that produced: dropping a tab on a pane's edge resolved to a `pane`
 * target whose `paneId` belonged to another cluster, so `split_pane` either
 * split something invisible or found nothing at all — either way, no split
 * where the user aimed. Reordering in the cluster bar kept working throughout,
 * because the bar's `paneId` comes from `dropPaneId` and its ref is an inline
 * arrow that React re-attaches on every render. That asymmetry is what made the
 * fault look like "splitting is broken" rather than "the registry is stale".
 *
 * Holding the ref instead means a zone is read at the moment it is hit-tested
 * and is therefore never older than the render that last set it.
 */
interface Registered {
  zone: { readonly current: DropZone };
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

function add(zone: { readonly current: DropZone }, el: HTMLElement): void {
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
  for (const { zone: held, el } of zones) {
    const zone = held.current;
    if (zone.kind !== "strip") continue;
    if (!within(el.getBoundingClientRect(), x, y)) continue;
    // The pane is resolved from where the pointer is, not from which pane
    // happens to be focused. See `DropZone`'s `at` for what the second one cost.
    const hit = zone.at(x);
    return { kind: "strip", paneId: hit.paneId, index: insertionIndex(hit.tabRects, x) };
  }

  for (const { zone: held, el } of zones) {
    const zone = held.current;
    if (zone.kind !== "pane") continue;
    const rect = el.getBoundingClientRect();
    if (!within(rect, x, y)) continue;
    return { kind: "pane", paneId: zone.paneId, ...edgeOf(rect, x, y) };
  }

  for (const { zone: held, el } of zones) {
    if (held.current.kind !== "panel") continue;
    if (within(el.getBoundingClientRect(), x, y)) return { kind: "panel" };
  }

  // Over no registered zone. Releasing here makes a window.
  return { kind: "detach" };
}

/**
 * The rectangle a pane is drawn on right now, or `null` if it is not on screen.
 *
 * Not a drag concern, and it lives here anyway because this registry is already
 * the one thing in the shell that knows which element is which pane — the same
 * fact `hitTest` walks, asked by id instead of by point. The alternative was a
 * second lookup somewhere else reaching for `.pane` by class name, which is
 * exactly the arrangement this module's header exists to describe replacing.
 *
 * Measured on the spot rather than cached, for the reason the strip zone's
 * `tabRects` gives: a divider drag and an OS window resize both move these
 * without going through React, so a stored rect is wrong as often as not.
 *
 * The caller is `panes/splitOnOpen.ts`, which turns this into the axis a newly
 * opened surface splits along. Reading it goes through the held ref, so it is
 * never older than the render that last set it — see `Registered`.
 */
export function paneRect(paneId: string): DOMRect | null {
  for (const { zone: held, el } of zones) {
    const zone = held.current;
    if (zone.kind === "pane" && zone.paneId === paneId) return el.getBoundingClientRect();
  }
  return null;
}

/**
 * Register an element as a drop target. Returns a ref callback to spread onto it.
 *
 * The zone is read through a ref so the returned callback's identity is stable.
 * An unstable ref callback makes React detach and reattach on every render,
 * which here would mean deregistering and reregistering the zone continuously —
 * and a drag sampling the registry mid-render would see it missing.
 *
 * That stability is exactly why the ref itself has to be what gets registered,
 * rather than the zone it currently holds. A callback React only ever calls once
 * cannot be the thing that keeps a registration current, and reading
 * `latest.current` inside it only ever captured the first value. See
 * `Registered`.
 */
export function useDropZone(zone: DropZone): (el: HTMLElement | null) => void {
  const held = useRef<HTMLElement | null>(null);
  const latest = useRef(zone);
  latest.current = zone;

  return useCallback((el: HTMLElement | null) => {
    if (held.current) remove(held.current);
    held.current = el;
    if (el) add(latest, el);
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
