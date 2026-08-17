import { useCallback, useEffect, useRef } from "react";
import { animate, motion, useMotionValue } from "framer-motion";
import type { FrameSlots, WindowKind } from "../contract";
import { settle } from "../motion";
import "./frame.css";

/**
 * The window's geometry, and nothing else.
 *
 * Five bands stacked in a column, only the middle one growing. The frame knows
 * how tall each bar is and how the middle row splits; it knows nothing about
 * what any of them contain. Regions arrive as slots, already built, and cannot
 * affect each other's size — which is the property that lets them be built in
 * parallel.
 *
 * The panel's width lives here rather than inside the panel for the same
 * reason the bars' heights do: it is the shape of the window, and the thing
 * being resized is the *split*, not the panel. The panel receives a box.
 */
export const PANEL_MIN = 240;
export const PANEL_COLLAPSED = 34;
/** The tool window's floor while dragging normally — past this, the drag
 * stops resizing and starts maximizing instead. */
export const TOOLWINDOW_MIN = 240;
/** How far past `maxNormal` the pointer has to travel before the panel snaps
 * to full width. See the hysteresis note on the drag handler below. */
export const MAXIMIZE_OVERSHOOT = 80;

/** The shortest the terminal band opens to. Below this it snaps shut instead. */
export const BOTTOM_MIN = 120;
/** What the band opens to the first time, before anyone has dragged it. */
export const BOTTOM_DEFAULT = 260;
/** The tool window's floor, so the band can never swallow the panes entirely. */
export const TOOLWINDOW_MIN_H = 120;
/**
 * How far *below* `BOTTOM_MIN` the pointer must travel before the band snaps
 * shut, and the gap it must climb back over to reopen.
 *
 * This is the "clicks into place" of the gesture. One shared threshold would
 * let a hand resting near the line flap the band open and shut several times in
 * one drag; the dead zone between the two means closing it takes a deliberate
 * shove and reopening takes a deliberate lift.
 */
export const BOTTOM_COLLAPSE_OVERSHOOT = 60;

export default function Frame({
  kind,
  slots,
  panelCollapsed,
  panelWidth,
  onPanelWidthChange,
  panelMaximized,
  onPanelMaximizedChange,
  bottomHeight = BOTTOM_DEFAULT,
  bottomCollapsed = true,
  onBottomHeightChange,
  onBottomCollapsedChange,
}: {
  kind: WindowKind;
  slots: FrameSlots;
  panelCollapsed: boolean;
  /** Last uncollapsed, un-maximized width. Restored when the panel returns to
   * normal, whether that's from collapsed or from maximized. */
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
  /** The panel has taken the whole split row and the tool window is at 0. */
  panelMaximized: boolean;
  onPanelMaximizedChange: (maximized: boolean) => void;
  /**
   * The terminal band's last open height, and whether it is shut.
   *
   * Defaulted rather than required so a caller with no `slots.bottomPanel` — a
   * detached window — needs no opinion about a band it does not draw. A caller
   * that *does* pass the slot owns this state, the same way it owns the panel's
   * width: the thing being resized is the split, not the band.
   *
   * Shut is the default because the band holds no sessions until something asks
   * for one, and a window that opened with an empty terminal band every launch
   * would be spending height on nothing.
   */
  bottomHeight?: number;
  bottomCollapsed?: boolean;
  onBottomHeightChange?: (height: number) => void;
  onBottomCollapsedChange?: (collapsed: boolean) => void;
}) {
  // The panel's width is a motion value rather than React state on purpose.
  // Dragging has to be exactly 1:1 with the cursor, and routing every frame of
  // a drag through a re-render can't promise that under load. Writing straight
  // to the motion value updates the DOM outside React's cycle; React only hears
  // the final width, on pointer up.
  const width = useMotionValue(panelCollapsed ? PANEL_COLLAPSED : panelWidth);
  const rowRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // The band's height, on the same terms as the panel's width above and for the
  // same reason: a drag has to be 1:1 with the cursor, and routing every frame
  // through a re-render cannot promise that under load.
  const bottom = useMotionValue(bottomCollapsed ? 0 : bottomHeight);
  const mainRef = useRef<HTMLDivElement>(null);
  const bottomHandleRef = useRef<HTMLDivElement>(null);
  const bottomDragging = useRef(false);

  // The handle's width is read off the element rather than repeated as a
  // second literal — `--w-resize-handle` already defines it once, in
  // frame.css, and a JS-side copy of that number is just a second place for
  // the two to quietly disagree. The fallback only matters for the instant
  // before the handle has laid out.
  const handleWidth = () => handleRef.current?.getBoundingClientRect().width ?? 6;

  // Collapsing and restoring *is* animated — it's a state change, not a
  // gesture, and the handoff lists it as one of the seven moments. Maximizing
  // outside a drag (the not-yet-built toggle, or a collapse restoring into a
  // panel that was maximized before it collapsed) rides the same effect. The
  // dragging guard matters: without it, a collapse or maximize landing mid-drag
  // would start a spring that fights the pointer.
  useEffect(() => {
    if (dragging.current) return;
    const row = rowRef.current;
    const target = panelCollapsed
      ? PANEL_COLLAPSED
      : panelMaximized && row
        ? row.getBoundingClientRect().width - handleWidth()
        : panelWidth;
    const controls = animate(width, target, settle);
    return () => controls.stop();
  }, [panelCollapsed, panelMaximized, panelWidth, width]);

  // The maximized width is "the row, minus the handle" — a fraction of the OS
  // window, not a fixed pixel count. Resizing the window has to re-derive it
  // live, or a maximized panel would either leave a gap or overflow the row
  // the next time the window changed size. Guarded the same way the collapse
  // effect above is: a resize landing mid-drag must not fight the pointer.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const observer = new ResizeObserver(() => {
      if (dragging.current || panelCollapsed || !panelMaximized) return;
      width.set(row.getBoundingClientRect().width - handleWidth());
    });
    observer.observe(row);
    return () => observer.disconnect();
  }, [panelCollapsed, panelMaximized, width]);

  // Opening and shutting the band is animated for the same reason collapsing
  // the panel is: it is a state change rather than a gesture. Guarded against a
  // drag in flight, or a toggle landing mid-drag would start a spring that
  // fights the pointer.
  useEffect(() => {
    if (bottomDragging.current) return;
    const controls = animate(bottom, bottomCollapsed ? 0 : bottomHeight, settle);
    return () => controls.stop();
  }, [bottomCollapsed, bottomHeight, bottom]);

  /**
   * Pull the band up, or shove it shut.
   *
   * The handle is a live grab strip whether the band is open or not — that is
   * what makes "reach for the bottom of the window and pull" work with nothing
   * on screen to pull. It is deliberately *not* a click target: opening this
   * band never spawns a terminal, it only reveals whatever is already there.
   */
  const onBottomHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const col = mainRef.current;
      if (!col) return;

      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Optimisation only; the window listeners below are the mechanism.
      }
      bottomDragging.current = true;

      const colRect = col.getBoundingClientRect();
      const colBottom = colRect.bottom;
      const handleH = bottomHandleRef.current?.getBoundingClientRect().height ?? 6;
      const maxNormal = colRect.height - handleH - TOOLWINDOW_MIN_H;

      // Read once and mutated locally, never re-derived from raw position each
      // frame — re-deriving is exactly what the dead zone below exists to stop.
      let collapsed = bottomCollapsed;

      const onMove = (ev: PointerEvent) => {
        const raw = colBottom - ev.clientY;

        if (raw < BOTTOM_MIN - BOTTOM_COLLAPSE_OVERSHOOT) collapsed = true;
        else if (raw > BOTTOM_MIN) collapsed = false;

        bottom.set(
          collapsed ? 0 : Math.min(Math.max(raw, BOTTOM_MIN), Math.max(maxNormal, BOTTOM_MIN)),
        );
      };

      const onUp = () => {
        bottomDragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        onBottomCollapsedChange?.(collapsed);
        // `bottomHeight` means "last open height" — shut, it must keep whatever
        // it was, or the next pull would open onto zero.
        if (!collapsed) onBottomHeightChange?.(bottom.get());
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [bottomCollapsed, onBottomHeightChange, onBottomCollapsedChange, bottom],
  );

  const onHandleDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (panelCollapsed) return;
      const row = rowRef.current;
      if (!row) return;

      e.preventDefault();
      // Capture keeps the gesture alive when the cursor outruns the 6px handle,
      // which it always does. But it is an optimisation, not the mechanism —
      // the window listeners below are what actually track the drag — and it
      // throws for a pointer id the browser no longer considers active. Bare,
      // it sat above those listeners, so a throw here would abort the handler
      // and lose the drag entirely. Guarded, the worst case degrades to a
      // slightly less forgiving gesture.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Nothing to do; see above.
      }
      dragging.current = true;

      const rowRect = row.getBoundingClientRect();
      const rowRight = rowRect.right;
      const rowWidth = rowRect.width;
      const hw = handleWidth();
      // The widest the panel can get without taking over the row — past this,
      // the tool window would be squeezed under its floor, which is exactly
      // the point at which dragging further should stop resizing and start
      // maximizing instead.
      const maxNormal = rowWidth - hw - TOOLWINDOW_MIN;

      // Whether *this* gesture is currently maximized. Read from the prop at
      // the start and mutated locally as the pointer crosses the thresholds
      // below — re-deriving it from raw position on every move is exactly
      // what the hysteresis gap is there to prevent, so once the drag decides
      // it's in one state, that decision has to persist until a threshold is
      // crossed again, not be recomputed from scratch each frame.
      let maximized = panelMaximized;

      const onMove = (ev: PointerEvent) => {
        // The panel is on the trailing edge, so its width is the distance from
        // the pointer to the right of the row.
        const raw = rowRight - ev.clientX;

        // Two thresholds, not one: entering maximized requires overshooting
        // `maxNormal` by MAXIMIZE_OVERSHOOT, leaving it only requires falling
        // back under `maxNormal` itself. A single shared threshold would let a
        // pointer trembling right on the line flip the panel in and out of
        // maximized several times in the same gesture; the dead zone between
        // the two means a hand has to travel a real, deliberate distance to
        // change the outcome once it's near the edge.
        if (raw > maxNormal + MAXIMIZE_OVERSHOOT) {
          maximized = true;
        } else if (raw < maxNormal) {
          maximized = false;
        }

        // Written directly — no spring, no easing, no rAF batching. The pixel
        // under the cursor is the pixel that moves, whether that pixel is
        // mid-drag or pinned to the maximized edge.
        const next = maximized
          ? rowWidth - hw
          : Math.min(Math.max(raw, PANEL_MIN), Math.max(maxNormal, PANEL_MIN));
        width.set(next);
      };

      const onUp = (ev: PointerEvent) => {
        dragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        void ev;
        onPanelMaximizedChange(maximized);
        // panelWidth means "last normal width" — while maximized it must not
        // be overwritten with the maximized edge, or un-maximizing later would
        // land on the row's width instead of restoring where the user actually
        // left the drag.
        if (!maximized) onPanelWidthChange(width.get());
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [panelCollapsed, panelMaximized, onPanelWidthChange, onPanelMaximizedChange, width],
  );

  return (
    <div className="frame" data-window-kind={kind}>
      {/* Plain divs, fixed heights, no `layout` prop. The four bars never
          animate — only what sits inside them does. */}
      <div className="frame__titlebar" data-region="titlebar">
        {slots.titleBar}
      </div>

      {slots.switcherBar !== undefined && (
        <div className="frame__switcher" data-region="switcher">
          {slots.switcherBar}
        </div>
      )}

      <div className="frame__split" ref={rowRef}>
        {/* The tool window and the terminal band are one column, so the band
            stops at the secondary panel's edge instead of spanning the window.
            See `FrameSlots.bottomPanel` for why that is the arrangement. */}
        <div className="frame__main" ref={mainRef}>
          <div className="frame__toolwindow" data-region="toolwindow">
            {slots.toolWindow}
          </div>

          {slots.bottomPanel !== undefined && (
            <>
              <div
                className="frame__bottomhandle"
                data-region="bottomhandle"
                ref={bottomHandleRef}
                onPointerDown={onBottomHandleDown}
                data-collapsed={bottomCollapsed || undefined}
              >
                <div className="frame__bottomgrip" />
              </div>

              <motion.div className="frame__bottom" data-region="bottom" style={{ height: bottom }}>
                {slots.bottomPanel}
              </motion.div>
            </>
          )}
        </div>

        <div
          className="frame__handle"
          data-region="handle"
          ref={handleRef}
          onPointerDown={onHandleDown}
          data-collapsed={panelCollapsed || undefined}
        >
          <div className="frame__grip" />
        </div>

        <motion.div className="frame__panel" data-region="panel" style={{ width }}>
          {slots.secondaryPanel}
        </motion.div>

        {/* Last child, and positioned against this row rather than the frame,
            so it covers the tool window, the handle and the panel without
            reaching the bars above or below. The row keeps its own layout
            underneath — nothing here resizes anything, so closing the overlay
            restores the split exactly as it was. */}
        {slots.splitOverlay}
      </div>

      <div className="frame__statusbar" data-region="statusbar">
        {slots.statusBar}
      </div>

      {slots.overlay}
    </div>
  );
}
