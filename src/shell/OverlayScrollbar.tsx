/**
 * A hover-revealed scrollbar that floats over a horizontally-scrolling strip
 * instead of reserving track space at its edge.
 *
 * The two strips this draws for — `.panel__tabs-strip` and `.switcher__tabs`
 * — now hide their native scrollbar outright (see the comments beside
 * `scrollbar-width: none` in panel.css and switcher.css for why that
 * property, specifically, is what makes it disappear in this app's
 * WebView2/WebKit). What replaces it is this: a `motion.div` thumb, sized
 * and positioned by hand from the scroll container's own `scrollLeft` /
 * `scrollWidth` / `clientWidth`, which `framer-motion` can fade the way a
 * native scrollbar never could be.
 *
 * This component draws only the thumb, never the scroll container. The
 * element with `overflow-x: auto` stays the caller's — reached here only
 * through `targetRef`, read but never rendered — because a thumb that *was*
 * that container's own child would scroll away with its content: an
 * absolutely positioned element's containing block is still the box it
 * scrolls inside, not the viewport of it. What the caller owns instead is
 * *where* this component's JSX is mounted — some ancestor box, sized to
 * exactly the strip it's tracking, that is not itself the thing that
 * scrolls. See panel.css / switcher.css for which existing box already is
 * that ancestor in each of the two callers, and why.
 *
 * The thumb is draggable — this replaces two scrollbars that were, and a
 * fade-in indicator that couldn't be dragged would be a regression dressed up
 * as a redesign. Dragging writes `targetRef.current.scrollLeft` directly
 * rather than going through anything else that might scroll the strip, which
 * is also why it needs no coordination with the tab/cluster drag gesture in
 * `useDrag.tsx`: the two never run at once, because a pointerdown that lands
 * on the thumb (see `overlay-scrollbar__thumb`'s `pointer-events: auto`) is a
 * pointerdown that never reaches a chip underneath it, and there is no other
 * way to start that gesture. It rests at the ordinary arrow cursor
 * (`cursor: default`) rather than `grab`, though, and only switches to
 * `grabbing` once a drag actually starts — `useDrag.tsx`'s own tab handles
 * already claim `grab` on hover to mean "drag this tab out", and this thumb
 * sitting right over the bottom of the same chips cannot reuse that cursor
 * on hover without making the two gestures look identical before either one
 * has started.
 *
 * `el` also gains one behaviour that isn't the thumb's own rendering at all:
 * a `wheel` handler that redirects a plain mouse wheel's `deltaY` into
 * `scrollLeft`. Native scrolling already handles a trackpad's horizontal
 * swipe or a held-Shift wheel (both report on `deltaX`) — this is only for
 * the axis nothing else drives, which is otherwise the only way a mouse
 * (no trackpad, no shift) could ever move these strips besides this thumb.
 * It lives in the same effect that measures `el`, rather than in the two
 * callers, so neither has to remember to wire it up separately. The thumb
 * carries the same redirection itself, through its own `onWheel` — it is
 * `el`'s sibling rather than its descendant (see above), so a wheel tick
 * that lands on the thumb never bubbles to `el`'s listener at all, and
 * without this a wheel spun exactly over the visible scrollbar would do
 * nothing.
 *
 * Hover is tracked the same rect-based way `dropZones.ts` resolves a drop —
 * `pointermove` on `window`, checked against `el.getBoundingClientRect()` —
 * rather than `pointerenter`/`pointerleave` on `el` itself. Those follow
 * real hit-testing, and the thumb sitting on top of `el`'s own bottom edge
 * once it's visible means the moment it mounts over the cursor, `el` stops
 * being hit-tested and fires `pointerleave` — which drops `hovering`,
 * unmounts the thumb, hands the cursor back to `el`, fires `pointerenter`
 * again, and remounts it: a loop, several times a frame, each lap landing on
 * a different element with a different resting cursor. Geometry doesn't
 * care which element is on top, so it can't feed back on itself this way.
 */
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { AnimatePresence, motion } from "framer-motion";
import { instant, instantOut } from "./motion";
import "./overlayScrollbar.css";

/**
 * How long the thumb stays up after the last scroll event, if the pointer
 * isn't over the strip to keep it up on its own. Picked from the middle of
 * the "a couple hundred ms to just over half a second" range VS Code's own
 * overlay scrollbar uses — the reference the visual spec names — since there
 * is no handoff crop for a scrollbar's own timing to measure against.
 */
const SCROLL_IDLE_MS = 700;

/**
 * Below this many pixels of `scrollWidth - clientWidth`, the strip counts as
 * not overflowing at all — the fix for a known bug, not a stylistic choice.
 *
 * `ClusterBar`'s `AnimatePresence mode="popLayout"` briefly extends the
 * row's scroll range while a tab or a cluster's members animate out (see the
 * comments on `fade` and around the `popLayout` blocks in `ClusterBar.tsx`).
 * That used to flash the native scrollbar on for exactly one of those
 * transients. A 2px floor treats sub-pixel layout rounding as "not
 * overflowing" without needing to know anything about *why* the transient
 * happened; a real overflow in a tab strip is never this small; the
 * narrowest tab in either row is well over 2px on its own.
 */
const OVERFLOW_EPSILON = 2;

/**
 * CSS pixels per "line" for a wheel event reporting `deltaMode: 1`
 * (`DOM_DELTA_LINE`) rather than `0` (`DOM_DELTA_PIXEL`). Some devices and
 * OS wheel-speed settings report in lines, where a `deltaY` of `1` means
 * "one notch" rather than "one pixel" — applied unscaled, a wheel like that
 * would nudge `scrollLeft` by a couple of pixels per notch and read as
 * "barely scrolls at all". 16 is the approximation most browsers themselves
 * use to turn a line into pixels; there is no more authoritative number to
 * take it from; `deltaMode: 2` (`DOM_DELTA_PAGE`) is rarer still and scaled
 * by `el`'s own width instead, since a "page" on the axis this redirects
 * *into* is the strip's width, not its height.
 */
const WHEEL_LINE_PX = 16;

/**
 * How far a wheel tick should move `scrollLeft`, or `null` if this tick is
 * not this component's to take.
 *
 * `null` whenever `deltaX` is already the larger of the two axes: a
 * trackpad's horizontal swipe or a held-Shift wheel report there, native
 * scrolling already drives `scrollLeft` from it directly, and redirecting on
 * top of that would double the movement. Strictly greater rather than
 * greater-or-equal, so a dead-even tick — including the common all-zero
 * case on a plain vertical wheel — still redirects instead of being read as
 * "already horizontal" and dropped; this container has no vertical overflow
 * for an equal `deltaY` to go to instead.
 */
function horizontalWheelDelta(
  el: HTMLElement,
  deltaX: number,
  deltaY: number,
  deltaMode: number,
): number | null {
  if (Math.abs(deltaX) > Math.abs(deltaY)) return null;
  if (deltaMode === 1) return deltaY * WHEEL_LINE_PX;
  if (deltaMode === 2) return deltaY * el.clientWidth;
  return deltaY;
}

export interface OverlayScrollbarProps {
  /**
   * The scroll container this thumb tracks — the element with
   * `overflow-x: auto`. Measured only; never rendered. See the file header
   * for why this component cannot render it.
   */
  targetRef: RefObject<HTMLElement | null>;
}

export default function OverlayScrollbar({ targetRef }: OverlayScrollbarProps) {
  // Null means "not overflowing" — the one state that must draw nothing,
  // which is also what keeps a mid-animation transient (see OVERFLOW_EPSILON
  // above) from ever having a rect to fade in with in the first place.
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null);
  const [hovering, setHovering] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [dragging, setDragging] = useState(false);
  const idleTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;

    // `el`'s rect, cached rather than re-read on every `pointermove` — see
    // `onWindowPointerMove` below for why the naive version of this is a real
    // cost here, not a theoretical one. Kept alongside `measure`'s other
    // reads because it needs the same invalidation `measure` already has:
    // `ResizeObserver` fires whenever `el`'s own box changes size for *any*
    // reason (the window resizing, the panel dragged wider, the search field
    // collapsing and handing `.switcher__tabs` its width back), and
    // `MutationObserver` fires when its content does (a tab or a cluster
    // opening, closing, or switching). Both already exist below to keep
    // `scrollWidth`/`clientWidth` current for the thumb itself; this rides
    // along for free rather than adding a third observer.
    //
    // Two cases that sound like gaps aren't, in this app specifically:
    //
    // - The window moving (not resizing) doesn't change `getBoundingClientRect`
    //   at all — it's already viewport-relative, and moving the OS window
    //   carries the viewport, and everything positioned in it, along with it.
    // - The panel *collapsing* isn't a live reposition of this element with
    //   neither observer noticing — it's `SecondaryPanel` swapping
    //   `.panel__tabs-strip` out for an entirely different `CollapsedStrip`
    //   tree (see `SecondaryPanel.tsx`'s `if (collapsed) return
    //   <CollapsedStrip ... />`), which unmounts this component along with
    //   it. Restoring the panel mounts a fresh instance with a fresh
    //   `measure()` call; there's no live instance carrying a stale rect
    //   through the transition.
    //
    // What this genuinely depends on: every bar `.panel__tabs-strip` and
    // `.switcher__tabs` can sit in has a *fixed* height
    // (`--h-titlebar`/`--h-switcher`/`--h-paneltabs`, none ever changed at
    // runtime), so nothing in this shell repositions either strip vertically
    // without also resizing something in the observed chain. If that ever
    // stops being true — a bar gains a dynamic height — this cache would need
    // an observer on whatever grew, not on `el`.
    let rect: DOMRect | null = null;

    const measure = () => {
      rect = el.getBoundingClientRect();
      const overflow = el.scrollWidth - el.clientWidth;
      if (overflow < OVERFLOW_EPSILON) {
        setThumb(null);
        return;
      }
      setThumb({
        left: (el.scrollLeft / el.scrollWidth) * el.clientWidth,
        width: (el.clientWidth / el.scrollWidth) * el.clientWidth,
      });
    };

    measure();

    const onScroll = () => {
      measure();
      setScrolling(true);
      window.clearTimeout(idleTimer.current);
      idleTimer.current = window.setTimeout(() => setScrolling(false), SCROLL_IDLE_MS);
    };
    // See the file header for why this is rect containment on `window`
    // `pointermove` rather than `pointerenter`/`pointerleave` on `el` — hit-
    // testing and the thumb occluding `el`'s own bottom edge fight each other
    // otherwise.
    //
    // Reads the cache above rather than calling `getBoundingClientRect`
    // itself, and that part is not a micro-optimisation.
    // `getBoundingClientRect` forces a synchronous style and layout flush
    // whenever the DOM is dirty, and in this shell it usually is:
    // framer-motion is mid-flight on a `layoutId` handoff (`cluster-fill`,
    // `tool-rule`, `panel-rule`) for much of any interaction, and `useDrag` is
    // mutating the DOM through exactly the gestures that fire `pointermove`
    // hardest. Reading fresh on every move — even coalesced to once per
    // animation frame — would still force that flush every frame for the
    // length of any drag or hover, which is the same class of jank this
    // component exists to remove elsewhere. Reading the cache costs a
    // property lookup; setting the same boolean the result usually produces
    // is a no-op render under React's `Object.is` bail-out, so the common
    // case — a move that doesn't cross the boundary — costs nothing further.
    const onWindowPointerMove = (ev: PointerEvent) => {
      if (!rect) return;
      setHovering(
        ev.clientX >= rect.left &&
          ev.clientX < rect.right &&
          ev.clientY >= rect.top &&
          ev.clientY < rect.bottom,
      );
    };
    // `pointermove` alone never fires again once the cursor leaves the
    // window outright — there is nothing left inside the document to move
    // over — which would leave `hovering` stuck true. `document`'s
    // `pointerleave` (unlike `el`'s, which this replaces) fires only when
    // the pointer leaves the whole viewport, covering exactly that gap.
    const onWindowPointerLeave = () => setHovering(false);

    // A plain mouse wheel reports only `deltaY` — there is no horizontal
    // scroll gesture on a mouse the way a trackpad's two-finger swipe or a
    // held Shift give one, and neither of those needs help: the browser
    // already drives `scrollLeft` from `deltaX` on its own. Redirecting
    // `deltaY` here (through `horizontalWheelDelta`, see above) is what lets
    // a plain wheel scroll these strips at all, which is the whole point of
    // drawing a horizontal scrollbar for them.
    //
    // `{ passive: false }` because redirecting *is* calling
    // `preventDefault()`: left passive, the browser would still try to
    // scroll something vertically with the same event after this handler
    // returns (most likely nothing local, since there is nowhere for it to
    // go here, but possibly an ancestor) — a second reaction to a wheel tick
    // this handler already spent.
    const onWheel = (e: WheelEvent) => {
      const delta = horizontalWheelDelta(el, e.deltaX, e.deltaY, e.deltaMode);
      if (delta === null) return;
      el.scrollLeft += delta;
      e.preventDefault();
    };

    el.addEventListener("scroll", onScroll, { passive: true });
    el.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("pointermove", onWindowPointerMove);
    document.addEventListener("pointerleave", onWindowPointerLeave);

    // Catches the *container* resizing — the panel dragged wider, the window
    // resized, the search field collapsing and handing the row's width back.
    const resize = new ResizeObserver(measure);
    resize.observe(el);

    // Catches the *content* changing instead, which `ResizeObserver` on `el`
    // alone cannot see: `el`'s own box is fixed by the flex layout around
    // it, so a tab being added or removed changes `scrollWidth` without
    // changing anything a `ResizeObserver` on `el` reports. `subtree: true`
    // because a cluster's members sit two levels below `.switcher__tabs`
    // itself (a group, then a members list, then the member) — a tab or a
    // cluster opening, closing, or being renamed all land here.
    const mutations = new MutationObserver(measure);
    mutations.observe(el, { childList: true, subtree: true });

    return () => {
      el.removeEventListener("scroll", onScroll);
      el.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointermove", onWindowPointerMove);
      document.removeEventListener("pointerleave", onWindowPointerLeave);
      resize.disconnect();
      mutations.disconnect();
      window.clearTimeout(idleTimer.current);
    };
  }, [targetRef]);

  // Pointer down on the thumb starts a drag; `scrollLeft` follows the
  // pointer directly rather than through `measure()`/`onScroll` — those still
  // fire (setting `scrollLeft` dispatches a native `scroll` event same as a
  // user scroll does), which is what keeps this thumb's own size and
  // position in sync with the drag and, after release, is what hands the
  // idle-fade countdown its normal `SCROLL_IDLE_MS` head start with no extra
  // code here for that part.
  //
  // Two listener mechanisms doing the one job, matching `useDrag.tsx`'s own
  // tab-drag gesture rather than inventing a second convention: capture is
  // what keeps events routed to this pointer once the cursor leaves the
  // thumb's own 5px band, which a drag does on its very first move off axis;
  // `window`-level `pointermove`/`pointerup`/`pointercancel` are what actually
  // consume them once that's true, since capture alone can silently fail (the
  // browser throws for a pointer id it no longer considers active) and
  // `useDrag.tsx` already established the guarded-try pattern for that.
  const onThumbPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = targetRef.current;
    if (!el) return;

    // No text selection, no native drag-image, and no bubbling to a chip
    // underneath — though the last of those is already moot: the thumb is
    // the pointerdown's actual target (see the file header), so there is no
    // chip handler in this event's path to reach regardless.
    e.preventDefault();
    e.stopPropagation();

    const thumbEl = e.currentTarget;
    try {
      thumbEl.setPointerCapture(e.pointerId);
    } catch {
      // Nothing to do; the window listeners below are the mechanism, this is
      // the optimisation. See the comment above.
    }

    const pointerId = e.pointerId;
    const startClientX = e.clientX;
    const startScrollLeft = el.scrollLeft;
    // Content pixels per pointer pixel, snapshotted once at the start of the
    // drag rather than recomputed on every move — the same ratio `measure()`
    // sizes and places the thumb with, inverted. A live recompute would feed
    // this drag's own `scrollLeft` writes (and the `measure()` they trigger)
    // back into the mapping mid-drag, which is exactly the kind of loop a
    // snapshot avoids.
    const contentPerTrackPx = el.scrollWidth / el.clientWidth;

    setDragging(true);

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const target = targetRef.current;
      if (!target) return;
      target.scrollLeft = startScrollLeft + (ev.clientX - startClientX) * contentPerTrackPx;
    };

    const endDrag = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", endDrag);
      window.removeEventListener("pointercancel", endDrag);
      try {
        thumbEl.releasePointerCapture(pointerId);
      } catch {
        // Already released, or never captured — either way, nothing to do.
      }
      setDragging(false);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  };

  // The same redirection the effect above wires onto `el`, repeated here
  // because the thumb is `el`'s sibling rather than its descendant — a wheel
  // tick whose target is the thumb itself never bubbles to that listener.
  // Without this, spinning the wheel exactly over the visible scrollbar
  // (the most natural place to try it) would silently do nothing.
  const onThumbWheel = (e: ReactWheelEvent<HTMLDivElement>) => {
    const el = targetRef.current;
    if (!el) return;
    const delta = horizontalWheelDelta(el, e.deltaX, e.deltaY, e.deltaMode);
    if (delta === null) return;
    el.scrollLeft += delta;
    e.preventDefault();
  };

  return (
    <AnimatePresence>
      {/* `dragging` is its own term rather than folded into `scrolling`: a
          drag that pauses without moving fires no `scroll` event to keep
          `scrolling`'s idle timer from expiring, and the thumb must not fade
          out from under a pointer that is still holding it down. */}
      {thumb && (hovering || scrolling || dragging) && (
        <motion.div
          className="overlay-scrollbar__thumb"
          data-dragging={dragging || undefined}
          style={{ left: thumb.left, width: thumb.width }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: instant }}
          exit={{ opacity: 0, transition: instantOut }}
          onPointerDown={onThumbPointerDown}
          onWheel={onThumbWheel}
          aria-hidden="true"
        />
      )}
    </AnimatePresence>
  );
}
