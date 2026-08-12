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

export default function Frame({
  kind,
  slots,
  panelCollapsed,
  panelWidth,
  onPanelWidthChange,
}: {
  kind: WindowKind;
  slots: FrameSlots;
  panelCollapsed: boolean;
  /** Last uncollapsed width. Restored when the panel reopens. */
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
}) {
  // The panel's width is a motion value rather than React state on purpose.
  // Dragging has to be exactly 1:1 with the cursor, and routing every frame of
  // a drag through a re-render can't promise that under load. Writing straight
  // to the motion value updates the DOM outside React's cycle; React only hears
  // the final width, on pointer up.
  const width = useMotionValue(panelCollapsed ? PANEL_COLLAPSED : panelWidth);
  const rowRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Collapsing and restoring *is* animated — it's a state change, not a
  // gesture, and the handoff lists it as one of the seven moments. The guard
  // matters: without it, a collapse landing mid-drag would start a spring that
  // fights the pointer.
  useEffect(() => {
    if (dragging.current) return;
    const target = panelCollapsed ? PANEL_COLLAPSED : panelWidth;
    const controls = animate(width, target, settle);
    return () => controls.stop();
  }, [panelCollapsed, panelWidth, width]);

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

      const rowRight = row.getBoundingClientRect().right;
      const max = row.getBoundingClientRect().width - PANEL_MIN;

      const onMove = (ev: PointerEvent) => {
        // The panel is on the trailing edge, so its width is the distance from
        // the pointer to the right of the row. Clamped, then written directly —
        // no spring, no easing, no rAF batching. The pixel under the cursor is
        // the pixel that moves.
        const next = Math.min(Math.max(rowRight - ev.clientX, PANEL_MIN), Math.max(max, PANEL_MIN));
        width.set(next);
      };

      const onUp = (ev: PointerEvent) => {
        dragging.current = false;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        void ev;
        onPanelWidthChange(width.get());
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [panelCollapsed, onPanelWidthChange, width],
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
        <div className="frame__toolwindow" data-region="toolwindow">
          {slots.toolWindow}
        </div>

        <div
          className="frame__handle"
          data-region="handle"
          onPointerDown={onHandleDown}
          data-collapsed={panelCollapsed || undefined}
        >
          <div className="frame__grip" />
        </div>

        <motion.div className="frame__panel" data-region="panel" style={{ width }}>
          {slots.secondaryPanel}
        </motion.div>
      </div>

      <div className="frame__statusbar" data-region="statusbar">
        {slots.statusBar}
      </div>

      {slots.overlay}
    </div>
  );
}
