/**
 * The drag layer.
 *
 * Two interactions, one gesture machine. A tool tab dragged clear of the
 * switcher bar detaches into its own window; dragged sideways while still
 * over the bar it reorders instead. A terminal tab dropped into a HELVE
 * window's panel moves it there. Nothing else in the shell is draggable.
 *
 * This hook owns the whole gesture — press-and-hold, movement threshold,
 * `pointermove`/`pointerup`/`pointercancel` tracked on `window` the same way
 * `Frame.tsx`'s resize handle does — and hands back a small, stable surface
 * that `WindowRoot` wires into the switcher bar and the panel: a handle
 * factory per drag source, and one `overlay` node for `FrameSlots.overlay`.
 *
 * Reading `[data-region="switcher"]` / `[data-region="panel"]` off the DOM
 * (set by `Frame.tsx`) rather than importing anything from those regions is
 * what keeps this file inside its own directory — it never reaches across
 * into `switcher/` or `panel/` source, only their rendered geometry.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { AnimatePresence, useMotionValue, useSpring } from "framer-motion";
import type { DragHandleProps, DragPayload, DragState } from "../contract";
import { snap } from "../motion";
import {
  detachTool,
  moveTerminal,
  setDockedTools,
  useShellState,
  windowAtCursor,
  windowLabel,
} from "../state/shellState";
import DragGhost from "./DragGhost";
import { DetachOutline, PanelDropOutline } from "./DropTargets";
import "./drag.css";

type ToolPayload = Extract<DragPayload, { kind: "tool" }>;
type TerminalPayload = Extract<DragPayload, { kind: "terminal" }>;

/**
 * How far the pointer has to travel from the press point before a press
 * becomes a drag. Below this it stays a click — `ToolSwitcherBar` and
 * `SecondaryPanel` both spread this handle's `onPointerDown` alongside their
 * own `onClick` and rely on a press that never moves still selecting the
 * tab.
 */
const PRESS_THRESHOLD = 4;

/**
 * How far clear of the source switcher bar the pointer has to get before a
 * tool drag counts as a detach rather than a reorder — `DragState.clearOfSource`.
 * The handoff's caption ("2 — clear of the bar") draws the moment but gives
 * no number. 16px is about half the bar's own height (`--h-switcher` is
 * 36px): enough that grazing the bar's bottom hairline mid-reorder doesn't
 * false-trigger a detach, small enough the gesture still reads as immediate.
 * Flagged in the report rather than silently picked — there was nothing to
 * measure this against.
 */
const CLEAR_THRESHOLD = 16;

/**
 * The ghost's spring, derived from `snap` rather than invented. `snap` is
 * the scale's answer for "the default, for anything the pointer just
 * caused" — its stiffness is the highest in the scale, which is what "light
 * lag only, it should read as attached to the cursor" calls for. `motion.ts`
 * types `snap` as the general `Transition` shape (it has to, `settle` and
 * `instant` share the export), so its spring fields are read with a narrow
 * cast here rather than by widening the shared type for one caller.
 */
const springSource = snap as unknown as { stiffness: number; damping: number; mass?: number };
const ghostSpring = { stiffness: springSource.stiffness, damping: springSource.damping, mass: springSource.mass };

interface Session {
  payload: DragPayload;
  pointerId: number;
  startX: number;
  startY: number;
  began: boolean;
  /** The switcher bar (tool) or panel (terminal) this drag started from,
   *  measured once — the bars never move, so one measurement holds for the
   *  whole gesture. */
  sourceBarRect: DOMRect | null;
  /** Tool only: this window's docked order, kept live as reordering happens
   *  so each pointermove reorders from the last order it produced rather
   *  than the one at drag start. */
  toolOrder: string[];
}

export function useDrag(): {
  toolHandle(payload: ToolPayload): DragHandleProps;
  terminalHandle(payload: TerminalPayload): DragHandleProps;
  overlay: React.ReactNode;
  dragging: boolean;
} {
  const shell = useShellState();
  const label = useMemo(() => windowLabel(), []);
  const placement = shell?.windows.find((w) => w.label === label) ?? null;
  // The pointer handlers below are added once per gesture and read this on
  // every move — a plain closure over `placement` would freeze on whatever
  // order was current when the drag began.
  const placementRef = useRef(placement);
  placementRef.current = placement;

  const [drag, setDrag] = useState<DragState | null>(null);
  const [overPanel, setOverPanel] = useState(false);
  const sessionRef = useRef<Session | null>(null);

  // Raw pointer position, written directly on every move — no animation of
  // its own, this is what the spring below chases. `useSpring` on a source
  // motion value is the documented pattern for "this value, but lagging."
  const rawX = useMotionValue(0);
  const rawY = useMotionValue(0);
  const ghostX = useSpring(rawX, ghostSpring);
  const ghostY = useSpring(rawY, ghostSpring);

  const beginPress = useCallback(
    (payload: DragPayload, e: ReactPointerEvent) => {
      if (e.button !== 0) return;

      const sourceEl = e.currentTarget as HTMLElement;
      const barSelector = payload.kind === "tool" ? '[data-region="switcher"]' : '[data-region="panel"]';
      const sourceBarRect = sourceEl.closest(barSelector)?.getBoundingClientRect() ?? null;

      const session: Session = {
        payload,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        began: false,
        sourceBarRect,
        toolOrder: placementRef.current?.toolIds ?? [],
      };
      sessionRef.current = session;

      // An optimisation, not the mechanism — the window listeners below are
      // what actually track the drag — and it throws for a pointer id the
      // browser no longer considers active. Guarded so a throw here can't
      // abort the gesture; same pattern as Frame.tsx's resize handle.
      try {
        sourceEl.setPointerCapture(e.pointerId);
      } catch {
        // Nothing to do; see above.
      }

      const onMove = (ev: PointerEvent) => {
        const s = sessionRef.current;
        if (!s || ev.pointerId !== s.pointerId) return;

        if (!s.began) {
          const dx = ev.clientX - s.startX;
          const dy = ev.clientY - s.startY;
          if (Math.hypot(dx, dy) < PRESS_THRESHOLD) return;
          s.began = true;
          // Park the ghost at the current pointer position before the spring
          // has a source value to chase, so the first visible frame doesn't
          // fly in from wherever the previous drag ended (or from 0,0).
          rawX.set(ev.clientX);
          rawY.set(ev.clientY);
          ghostX.set(ev.clientX);
          ghostY.set(ev.clientY);
          setDrag({ payload: s.payload, x: ev.clientX, y: ev.clientY, clearOfSource: false });
        }

        rawX.set(ev.clientX);
        rawY.set(ev.clientY);

        const clearOfSource = computeClearOfSource(s.sourceBarRect, ev.clientY);

        if (s.payload.kind === "tool") {
          if (!clearOfSource) {
            const bar = sourceEl.closest('[data-region="switcher"]');
            const tabs = bar ? Array.from(bar.querySelectorAll<HTMLElement>(".switcher__tab")) : [];
            if (tabs.length === s.toolOrder.length) {
              const targetIndex = indexForX(tabs, ev.clientX);
              const next = reorder(s.toolOrder, s.payload.toolId, targetIndex);
              if (next !== s.toolOrder) {
                s.toolOrder = next;
                void setDockedTools(label, next);
              }
            }
          }
        } else {
          setOverPanel(pointerOverPanel(ev.clientX, ev.clientY));
        }

        setDrag((prev) => (prev ? { ...prev, x: ev.clientX, y: ev.clientY, clearOfSource } : prev));
      };

      const onUp = (ev: PointerEvent) => {
        const s = sessionRef.current;
        cleanup();
        // Clear the gesture immediately rather than after `windowAtCursor()`
        // resolves below — the pointer is already up, the answer arrives
        // asynchronously, and nothing about ending the gesture should wait
        // on or race it.
        setDrag(null);
        setOverPanel(false);
        if (!s || ev.pointerId !== s.pointerId || !s.began) return;

        if (s.payload.kind === "tool") {
          if (computeClearOfSource(s.sourceBarRect, ev.clientY)) {
            void detachTool(s.payload.toolId);
          }
          // Otherwise the reorder already happened live, one
          // `setDockedTools` call per crossing — nothing left to do on
          // release.
        } else {
          // Only the backend can say which HELVE window the cursor is over —
          // a page-local listener can't see past this window's own edge.
          // `null` means the terminal was dropped outside every HELVE
          // window, which is a cancelled drag, not a move.
          const payload = s.payload;
          void windowAtCursor().then((toLabel) => {
            if (toLabel) void moveTerminal(payload.sessionId, toLabel);
          });
        }
      };

      const onCancel = (ev: PointerEvent) => {
        const s = sessionRef.current;
        cleanup();
        if (!s || ev.pointerId !== s.pointerId) return;
        setDrag(null);
        setOverPanel(false);
      };

      function cleanup() {
        sessionRef.current = null;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
    },
    [ghostX, ghostY, rawX, rawY, label],
  );

  const toolHandle = useCallback(
    (payload: ToolPayload): DragHandleProps => ({
      onPointerDown: (e) => beginPress(payload, e),
      style: { cursor: "grab" },
    }),
    [beginPress],
  );

  const terminalHandle = useCallback(
    (payload: TerminalPayload): DragHandleProps => ({
      onPointerDown: (e) => beginPress(payload, e),
      style: { cursor: "grab" },
    }),
    [beginPress],
  );

  const overlay = drag ? (
    <div className="drag-overlay">
      <DragGhost payload={drag.payload} x={ghostX} y={ghostY} />
      <AnimatePresence>
        {drag.payload.kind === "tool" && drag.clearOfSource && (
          <DetachOutline key="detach" x={ghostX} y={ghostY} />
        )}
        {drag.payload.kind === "terminal" && overPanel && <PanelDropOutline key="panel-drop" />}
      </AnimatePresence>
    </div>
  ) : null;

  return { toolHandle, terminalHandle, overlay, dragging: drag !== null };
}

function computeClearOfSource(bar: DOMRect | null, y: number): boolean {
  if (!bar) return true;
  return y > bar.bottom + CLEAR_THRESHOLD || y < bar.top - CLEAR_THRESHOLD;
}

/**
 * Whether the pointer is over this window's own panel. The only drop target
 * a page-local pointer listener can ever see — see the report on why a
 * second HELVE window's panel is out of reach from here.
 */
function pointerOverPanel(x: number, y: number): boolean {
  const panel = document.querySelector('[data-region="panel"]');
  if (!panel) return false;
  const rect = panel.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/** How many tab midpoints the pointer has passed — the insertion index. */
function indexForX(tabs: HTMLElement[], x: number): number {
  let idx = 0;
  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    if (x > rect.left + rect.width / 2) idx++;
  }
  return idx;
}

function reorder(order: string[], id: string, targetIndex: number): string[] {
  const from = order.indexOf(id);
  if (from === -1) return order;
  const clamped = Math.max(0, Math.min(targetIndex, order.length - 1));
  if (from === clamped) return order;
  const next = order.slice();
  next.splice(from, 1);
  next.splice(clamped, 0, id);
  return next;
}
